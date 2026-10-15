// Records spoken commands from the microphone as 16 kHz mono audio (ported from Autonoma). Each command ends by
// itself after a short pause, or when `stop()` is called. Sound is only kept while it's your turn to speak.

/**
 * Why the microphone could not be opened:
 * - permission: Chrome hasn't been allowed (or was told "Allow this time", which ends when that tab closes)
 * - system: Windows / macOS privacy settings block the microphone for Chrome
 * - missing: no microphone is connected
 * - busy: another app is using it
 */
export type MicrophoneProblem = 'permission' | 'system' | 'missing' | 'busy' | 'other';

export class MicrophoneBlockedError extends Error {
    readonly reason: MicrophoneProblem;
    constructor(reason: MicrophoneProblem, message: string) {
        super(message);
        this.reason = reason;
    }
}

/** Chrome's own answer for this extension: 'granted', 'denied', 'prompt', or 'unknown' when it can't be asked. */
export async function microphonePermission(): Promise<PermissionState | 'unknown'> {
    try {
        return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state;
    } catch {
        return 'unknown';
    }
}

/** Turns a getUserMedia failure into the reason a person can act on. */
async function problemOf(error: unknown): Promise<MicrophoneProblem> {
    const name = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : String(error);
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'missing';
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        // Chrome says "Permission denied by system" when the operating system blocks it; and if Chrome itself
        // already allows the microphone, asking again in a tab can't help either
        if (/system/i.test(message) || (await microphonePermission()) === 'granted') return 'system';
        return 'permission';
    }
    return 'other';
}

async function getMicrophoneStream(constraints: MediaStreamConstraints): Promise<MediaStream> {
    try {
        return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
        throw new MicrophoneBlockedError(await problemOf(error), error instanceof Error ? error.message : String(error));
    }
}

const SAMPLE_RATE = 16000;
const SPEECH_LEVEL = 0.015;
// Loud chunks (128 ms each) needed before a sound counts as speech: about 0.4 s, so clicks and coughs are ignored.
const SPEECH_CHUNKS = 3;
export interface ListenOptions { maxMs?: number; pauseMs?: number; waitMs?: number }

interface Take {
    chunks: Float32Array[];
    heard: boolean;
    voiced: number;
    started: number;
    lastSound: number;
    options: Required<ListenOptions>;
    resolve: (audio: Float32Array | null) => void;
}

export interface Microphone {
    /** Collects the next spoken command; null when nothing was said. */
    next(options?: ListenOptions): Promise<Float32Array | null>;
    /** Ends the current command now (what was heard so far is kept). */
    stop(): void;
    /** Ends the current command and throws away what was recorded (the next() call gets null). */
    cancel(): void;
    /** True once the current recording holds speech (about 0.4 s of sound). */
    hearing(): boolean;
    close(): void;
}

/**
 * Opens the microphone once. Sound that arrives while nobody is waiting for a command (the agent talking or
 * filling) is thrown away, so the agent never hears itself.
 */
export async function openMicrophone(): Promise<Microphone> {
    const stream = await getMicrophoneStream({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = context.createMediaStreamSource(stream);
    // 128 ms chunks arrive from an audio worklet (public/mic-worklet.js), off the main thread
    let chunker: AudioWorkletNode;
    try {
        await context.audioWorklet.addModule(chrome.runtime.getURL('mic-worklet.js'));
        chunker = new AudioWorkletNode(context, 'aullevo-mic-chunker', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    } catch (error) {
        stream.getTracks().forEach(track => track.stop());
        void context.close();
        throw new MicrophoneBlockedError('other', `The microphone recorder could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
    let take: Take | null = null;

    const finish = () => {
        if (!take) return;
        const done = take;
        take = null;
        if (!done.heard) return done.resolve(null);
        const audio = new Float32Array(done.chunks.reduce((total, chunk) => total + chunk.length, 0));
        let offset = 0;
        for (const chunk of done.chunks) { audio.set(chunk, offset); offset += chunk.length; }
        done.resolve(audio);
    };
    chunker.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!take) return;
        const input = event.data;
        take.chunks.push(input);
        let sum = 0;
        for (const sample of input) sum += sample * sample;
        const now = performance.now();
        if (Math.sqrt(sum / input.length) > SPEECH_LEVEL) {
            take.lastSound = now;
            if (++take.voiced >= SPEECH_CHUNKS) take.heard = true;
        }
        const { pauseMs, maxMs, waitMs } = take.options;
        // Stop after a pause once you've spoken, at the time limit, or if nothing was said at all
        if ((take.heard && now - take.lastSound > pauseMs) || now - take.started > maxMs || (!take.heard && now - take.started > waitMs)) finish();
    };
    // Its output is silence; being connected to the speakers keeps Chrome running it
    source.connect(chunker);
    chunker.connect(context.destination);

    return {
        next({ maxMs = 8000, pauseMs = 1100, waitMs = 5000 }: ListenOptions = {}) {
            finish();
            return new Promise(resolve => {
                const now = performance.now();
                take = { chunks: [], heard: false, voiced: 0, started: now, lastSound: now, options: { maxMs, pauseMs, waitMs }, resolve };
            });
        },
        stop: finish,
        cancel() {
            if (!take) return;
            const dropped = take;
            take = null;
            dropped.resolve(null);
        },
        hearing: () => Boolean(take?.heard),
        close() {
            finish();
            chunker.port.onmessage = null;
            chunker.disconnect();
            source.disconnect();
            stream.getTracks().forEach(track => track.stop());
            void context.close();
        },
    };
}

/** 16-bit PCM WAV, the simplest format Scribe accepts. */
export function toWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);              // PCM
    view.setUint16(22, 1, true);              // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // bytes per second
    view.setUint16(32, 2, true);              // bytes per sample
    view.setUint16(34, 16, true);             // bits per sample
    text(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
}

/** Asks for microphone access from a normal tab (the side panel can't show Chrome's permission prompt). */
export async function requestMicrophone(): Promise<'allowed' | MicrophoneProblem> {
    try {
        const stream = await getMicrophoneStream({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        return 'allowed';
    } catch (error) {
        return error instanceof MicrophoneBlockedError ? error.reason : 'other';
    }
}
