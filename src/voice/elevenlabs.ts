// ElevenLabs: speech-to-text (Scribe) for what you say, text-to-speech (Flash) for the agent's voice.
// Calls go straight from the side panel with the user's own API key (kept in the encrypted vault).
// Only the recorded command and the agent's reply text are sent; profile values never are.

const API = 'https://api.elevenlabs.io/v1';
const STT_MODEL = 'scribe_v2';

// The agent's voice model. v4 Turbo is the most human-sounding real-time model (~100 ms, 90+ languages incl.
// Filipino) at Flash's price; Flash v2.5 is the fallback when a plan or key can't use v4.
export type TtsModel = 'eleven_v4_turbo' | 'eleven_flash_v2_5';
export const TTS_MODELS: { id: TtsModel; name: string }[] = [
    { id: 'eleven_v4_turbo', name: 'v4 Turbo · most human' },
    { id: 'eleven_flash_v2_5', name: 'Flash v2.5 · fastest' },
];
export const DEFAULT_TTS_MODEL: TtsModel = 'eleven_v4_turbo';

// "Daniel" (premade): a calm British voice, the closest to a Jarvis-style assistant
export const DEFAULT_VOICE_ID = 'onwK4e9ZLuTAKqWW03F9';
// Premade voices every account can use, so a voice can be picked even when the key can't list voices
export const PRESET_VOICES: ElevenVoice[] = [
    { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel · British, calm (Jarvis)' },
    { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George · British, warm' },
    { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum · husky, intense' },
    { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian · American, deep' },
    { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger · American, easygoing' },
    { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie · Australian, natural' },
    { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice · British, confident' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah · American, soft' },
];

export interface ElevenVoice {
    id: string;
    name: string;
}

export class ElevenLabsError extends Error {
    readonly status: number;
    readonly code: string; // ElevenLabs' own reason, e.g. "invalid_api_key", "missing_permissions"
    constructor(status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

// ElevenLabs answers errors with {"detail": {"status": "invalid_api_key", "message": "Invalid API key"}}
// (or a plain string). A key made with limited permissions gets "missing_permissions" naming the one it lacks.
async function failure(res: Response, what: string): Promise<ElevenLabsError> {
    let code = '';
    let detail = '';
    try {
        const body = await res.json();
        if (typeof body?.detail === 'string') detail = body.detail;
        else {
            code = String(body?.detail?.status || body?.detail?.code || '');
            detail = String(body?.detail?.message || '');
        }
    } catch { /* not JSON */ }
    const reason = code === 'invalid_api_key' ? 'this API key is not valid (check that the whole key was copied)'
        : code === 'missing_permissions' ? `${detail.replace(/\.$/, '')} (edit the key's permissions on elevenlabs.io)`
        : res.status === 429 ? detail || 'too many requests, or no credits left'
        : detail || `HTTP ${res.status}`;
    return new ElevenLabsError(res.status, code, `ElevenLabs ${what} failed: ${reason}.`);
}

/** Turns one recorded command into text. Language is detected by Scribe (English, Tagalog, Taglish...). */
export async function transcribe(apiKey: string, audio: Blob, signal?: AbortSignal): Promise<string> {
    const form = new FormData();
    form.append('model_id', STT_MODEL);
    form.append('file', audio, 'command.wav');
    form.append('tag_audio_events', 'false');
    const res = await fetch(`${API}/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': apiKey }, body: form, signal });
    if (!res.ok) throw await failure(res, 'speech-to-text');
    const json = await res.json();
    return String(json?.text ?? '').trim();
}

// A little less stable than the default reads as more natural, less "announcer"
const VOICE_SETTINGS = { stability: 0.4, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true, speed: 1.03 };

/** The agent's reply as audio (MP3). `tuned: false` leaves the voice's own settings (some models refuse custom ones). */
export async function synthesize(apiKey: string, voiceId: string, text: string, model: TtsModel, tuned: boolean, signal?: AbortSignal): Promise<Blob> {
    const res = await fetch(`${API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_64`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: model, ...(tuned ? { voice_settings: VOICE_SETTINGS } : {}) }),
        signal
    });
    if (!res.ok) throw await failure(res, 'voice');
    return await res.blob();
}

/** The request itself was refused (model not on this plan, settings it doesn't take), not the key or the credits. */
export const isRequestRefused = (err: unknown) => err instanceof ElevenLabsError
    && [400, 403, 404, 422].includes(err.status) && err.code !== 'missing_permissions' && err.code !== 'invalid_api_key';

/** Voices on the account (premade and your own), for the voice picker. Also checks the key. */
export async function listVoices(apiKey: string): Promise<ElevenVoice[]> {
    const res = await fetch(`${API}/voices`, { headers: { 'xi-api-key': apiKey } });
    if (!res.ok) throw await failure(res, 'voice list');
    const json = await res.json();
    const voices: { voice_id?: unknown; name?: unknown }[] = Array.isArray(json?.voices) ? json.voices : [];
    return voices
        .filter((v): v is { voice_id: string; name?: unknown } => typeof v?.voice_id === 'string')
        .map(v => ({ id: v.voice_id, name: String(v.name || v.voice_id) }))
        .sort((a, b) => a.name.localeCompare(b.name));
}
