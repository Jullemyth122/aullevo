// The agent's voice: ElevenLabs only. A new line interrupts the previous one; the orb's mute button silences it.
// Without a key, or when ElevenLabs can't speak, the line is shown under the orb instead (for as long as reading it takes).
import { useEffect, useState } from 'react';
import { DEFAULT_TTS_MODEL, isRequestRefused, synthesize, type TtsModel } from './elevenlabs';
import { isOrbSoundMuted } from './orb/sfx';

type Listener = (speaking: boolean, text: string) => void;
const listeners = new Set<Listener>();
let current = { speaking: false, text: '' };
let startedAt = 0;
let lastLine = '';
function update(speaking: boolean, text: string) {
    if (speaking && !current.speaking) startedAt = Date.now();
    if (speaking) lastLine = text;
    current = { speaking, text };
    listeners.forEach(listener => listener(speaking, text));
}

let voiceConfig: { apiKey: string; voiceId: string; model: TtsModel } = { apiKey: '', voiceId: '', model: DEFAULT_TTS_MODEL };
/** Called by the voice view whenever the key, the voice or the model changes. */
export function configureVoice(apiKey: string, voiceId: string, model: TtsModel = DEFAULT_TTS_MODEL) {
    voiceConfig = { apiKey: apiKey.trim(), voiceId, model };
    workingRequest = null;
}

// Why ElevenLabs could not speak (shown in Voice settings), and a note when it fell back to another model
let lastVoiceError = '';
let fallbackNote = '';
export const getVoiceError = () => lastVoiceError;
export const getVoiceFallbackNote = () => fallbackNote;

// Tried in order until one is accepted; the one that worked is kept for the rest of the session.
// A plan without v4, or a model that refuses custom voice settings, still gets a voice.
type Request = { model: TtsModel; tuned: boolean };
let workingRequest: Request | null = null;
function requestsToTry(): Request[] {
    if (workingRequest) return [workingRequest];
    const chosen = voiceConfig.model;
    const list: Request[] = [{ model: chosen, tuned: true }, { model: chosen, tuned: false }];
    if (chosen !== 'eleven_flash_v2_5') list.push({ model: 'eleven_flash_v2_5', tuned: true });
    return list;
}

async function synthesizeWithFallback(text: string, signal: AbortSignal): Promise<Blob> {
    let lastError: unknown;
    for (const request of requestsToTry()) {
        try {
            const blob = await synthesize(voiceConfig.apiKey, voiceConfig.voiceId, text, request.model, request.tuned, signal);
            workingRequest = request;
            fallbackNote = request.model !== voiceConfig.model
                ? 'v4 Turbo is not available with this key or plan, so the agent speaks with Flash v2.5.'
                : '';
            return blob;
        } catch (err) {
            lastError = err;
            if (!isRequestRefused(err)) throw err; // a bad key, no credits or no network: another model won't help
        }
    }
    throw lastError;
}

// Replies repeat a lot ("On it", "Next page"): keep recent audio so they don't cost credits again
const audioCache = new Map<string, string>();
const CACHE_LIMIT = 40;

let player: HTMLAudioElement | null = null;
let fetching: AbortController | null = null;
let finishCurrent: (() => void) | null = null;

async function elevenLabsAudio(text: string): Promise<string> {
    const key = `${voiceConfig.voiceId}|${voiceConfig.model}|${text}`;
    const cached = audioCache.get(key);
    if (cached) return cached;
    fetching = new AbortController();
    const blob = await synthesizeWithFallback(text, fetching.signal);
    const url = URL.createObjectURL(blob);
    audioCache.set(key, url);
    if (audioCache.size > CACHE_LIMIT) {
        const [oldestKey, oldestUrl] = audioCache.entries().next().value!;
        audioCache.delete(oldestKey);
        URL.revokeObjectURL(oldestUrl);
    }
    return url;
}

function playUrl(url: string, text: string): Promise<void> {
    return new Promise<void>((resolve) => {
        const audio = new Audio(url);
        player = audio;
        const done = () => {
            if (player === audio) player = null;
            if (current.text === text) update(false, '');
            finishCurrent = null;
            resolve();
        };
        finishCurrent = () => { audio.pause(); done(); };
        audio.onended = done;
        audio.onerror = done;
        update(true, text);
        audio.play().catch(done);
    });
}

/** No voice available: the line stays under the orb for about as long as it would take to say. */
function showLine(text: string): Promise<void> {
    return new Promise<void>((resolve) => {
        const timer = setTimeout(() => done(), Math.min(9000, 1200 + text.split(/\s+/).length * 330));
        const done = () => {
            clearTimeout(timer);
            if (current.text === text) update(false, '');
            finishCurrent = null;
            resolve();
        };
        finishCurrent = done;
        update(true, text);
    });
}

/** Says `text` in the ElevenLabs voice and resolves when finished. */
export async function speak(text: string): Promise<void> {
    if (!text.trim() || isOrbSoundMuted()) return;
    stopSpeaking();
    if (!voiceConfig.apiKey || !voiceConfig.voiceId) return showLine(text);
    // The orb shows the line while the audio is on its way
    update(true, text);
    try {
        const url = await elevenLabsAudio(text);
        lastVoiceError = '';
        if (current.text !== text) return; // interrupted while loading
        return await playUrl(url, text);
    } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        lastVoiceError = err instanceof Error ? err.message : String(err);
        console.warn('[Aullevo:Voice] ElevenLabs voice failed:', lastVoiceError);
        if (current.text === text) return showLine(text);
    }
}

export function stopSpeaking() {
    fetching?.abort();
    fetching = null;
    finishCurrent?.();
    update(false, '');
}

export const isSpeaking = () => current.speaking || Boolean(player);
/** When the agent last started talking (Date.now()): a recording made meanwhile may hold its own voice. */
export const lastSpokeAt = () => startedAt;
/** The agent's latest line, to tell its own voice (picked up by the mic) from the user's. */
export const lastSpokenLine = () => lastLine;

/** Calls `fn` each time the agent stops talking. Returns the unsubscribe function. */
export function onSpeechEnd(fn: () => void): () => void {
    // Only a real end of talking: stopSpeaking() also reports "not speaking" when nothing was playing
    let wasSpeaking = current.speaking;
    const listener: Listener = (speaking) => {
        if (wasSpeaking && !speaking) fn();
        wasSpeaking = speaking;
    };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** What the agent is saying right now, for the orb and its caption. */
export function useSpeech() {
    const [state, setState] = useState(current);
    useEffect(() => {
        const listener: Listener = (speaking, text) => setState({ speaking, text });
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, []);
    return state;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** Resolves once the agent is silent. A reply about to start gets `graceMs` to begin, so the mic never hears it. */
export async function waitUntilQuiet(graceMs = 900): Promise<void> {
    const started = performance.now();
    while (!isSpeaking() && performance.now() - started < graceMs) await sleep(100);
    while (isSpeaking()) await sleep(120);
}
