// Voice settings (plain chrome.storage; the ElevenLabs key is in the encrypted vault) and the panel mode.
import type { VoiceSettings } from './types';
import { DEFAULT_TTS_MODEL, DEFAULT_VOICE_ID } from './elevenlabs';

const SETTINGS_KEY = 'aullevo_voice_settings';
// 'classic' (tabs) or 'voice' (the agent orb). Side panel only; the full page is always classic.
export const PANEL_MODE_KEY = 'aullevo_panel_mode';
export type PanelMode = 'classic' | 'voice';

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { language: 'en', talkBack: true, live: false, voiceId: DEFAULT_VOICE_ID, voiceModel: DEFAULT_TTS_MODEL };

export async function loadVoiceSettings(): Promise<VoiceSettings> {
    const saved = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<VoiceSettings> | undefined;
    return { ...DEFAULT_VOICE_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
}

export function saveVoiceSettings(settings: VoiceSettings): void {
    chrome.storage.local.set({ [SETTINGS_KEY]: settings }).catch(() => { });
}
