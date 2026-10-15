// Turns what you say into text: our own microphone recording, transcribed by ElevenLabs Scribe.
import { transcribe } from './elevenlabs';
import { openMicrophone, toWav, type ListenOptions } from './listen';

export interface HearOptions extends ListenOptions {
    /** Called when the recording has ended and the words are being worked out. */
    onCaptured?: () => void;
}

export interface Ear {
    /** The next thing said, as text; null when nothing was said. */
    next(options?: HearOptions): Promise<string | null>;
    /** Stops listening now (what was heard so far is kept). */
    stop(): void;
    /** Stops listening and throws the recording away. */
    cancel(): void;
    /** True once the current recording holds speech. */
    hearing(): boolean;
    close(): void;
}

/** Thrown when voice is used before an ElevenLabs key is saved. */
export class VoiceKeyMissingError extends Error {
    constructor() {
        super('Add your ElevenLabs API key in Voice settings to talk to Aullevo.');
    }
}

/** Opens the microphone for one command or a whole live session. Throws MicrophoneBlockedError without permission. */
export async function openEar(apiKey: string): Promise<Ear> {
    const key = apiKey.trim();
    if (!key) throw new VoiceKeyMissingError();
    const mic = await openMicrophone();
    return {
        async next(options = {}) {
            const audio = await mic.next(options);
            if (!audio) return null;
            options.onCaptured?.();
            return await transcribe(key, toWav(audio));
        },
        stop: () => mic.stop(),
        cancel: () => mic.cancel(),
        hearing: () => mic.hearing(),
        close: () => mic.close(),
    };
}
