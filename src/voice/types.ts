// Voice agent: what a spoken command asks for, and what Aullevo reports back.
import type { TtsModel } from './elevenlabs';

export type VoiceLanguage = 'en' | 'tl';

/** Fill only some questions: those matching spoken words ("email", "first name"), or the one last clicked on the page. */
export interface FillTarget {
    texts?: string[];
    focused?: boolean;
    said?: string; // the whole sentence, so the AI can judge which question was meant
    value?: string; // "answer": the user's own words, typed into the question instead of a profile value
    indices?: number[];       // the AI's picks: positions in the page's question list (PageQuestions)
    questionTexts?: string[]; // their texts, to find them again if the page changed
    frameId?: number;         // the frame that list came from
}

/** One question on the page, as the voice agent's AI sees it (never the user's saved values). */
export interface PageQuestion {
    text: string;
    kind: string;
    options?: string[];
    answered: boolean;
    inView: boolean;
    lastTouched: boolean;
}

/** The form's questions in page order, and the frame they came from. */
export interface PageQuestions {
    frameId: number;
    questions: PageQuestion[];
}

export type VoicePage = 'autofill' | 'profiles' | 'multilink' | 'settings' | 'voice_settings' | 'full_page' | 'classic';

export type VoiceIntent =
    // Filling and moving through the form
    | 'fill' | 'fill_field' | 'fill_focused' | 'fill_all' | 'answer' | 'stop' | 'next' | 'submit' | 'left'
    // The page
    | 'highlight' | 'clear_highlight' | 'rescan'
    // Profiles
    | 'profile' | 'profiles' | 'create_profile' | 'set_field' | 'enable_profile' | 'disable_profile'
    // Multi-Link
    | 'add_link' | 'fill_links'
    // The panel and settings
    | 'open' | 'ai_on' | 'ai_off' | 'dark' | 'light' | 'hush' | 'mute' | 'unmute' | 'english' | 'tagalog' | 'help' | 'end_live'
    | 'none';

export interface VoiceCommand {
    intent: VoiceIntent;
    targets?: string[];   // fill_field: the questions named or pointed at
    said?: string;        // fill_field: the whole sentence they came from
    profileKey?: string;  // profile: which profile to switch to
    name?: string;        // create_profile: the new profile's name
    label?: string;       // set_field: which profile field
    value?: string;       // set_field: its new value · answer: the words to type in
    page?: VoicePage;     // open: where to go
    focused?: boolean;    // answer: into the question the user clicked ("answer this with …")
    questionIndices?: number[]; // fill_field / answer, decided by the AI: positions in the page's question list
    questionTexts?: string[];   // ... and those questions' texts
    frameId?: number;
}

/** Result of one fill started from Voice mode, in a form the agent can talk about. */
export interface FillOutcome {
    ok: boolean;
    filled: number;
    usedAi: boolean;
    filledLabels: string[]; // questions filled (targeted fills name them)
    left: string[];         // questions still empty
    target?: string;        // targeted fill: what was asked for ("email", "this field")
    matched?: number;       // targeted fill: how many questions matched what was asked for
    notice?: string;        // e.g. why AI was skipped
    error?: string;
    stopped?: boolean;
    pages?: number;         // all pages: how many pages were filled
    pageStatus?: string;    // all pages: how the run ended (see services/pagination.ts)
    blockedBy?: string;     // all pages: the first question that needs the user
    dictated?: string;      // "answer": the words the user asked to type in
}

/** Clicking Next / Submit by voice: clicked Next, submitted (or tried to), stopped at a required question, or nothing to click. */
export interface AdvanceResult {
    action: 'next' | 'submitted' | 'not-submitted' | 'ready-to-submit' | 'blocked' | 'none';
    blockedBy?: string;
}

/** Voice settings (plain storage; the ElevenLabs key lives in the encrypted vault). */
export interface VoiceSettings {
    language: VoiceLanguage;
    talkBack: boolean;   // say what happened after each fill
    live: boolean;       // keep listening for one command after another
    voiceId: string;     // ElevenLabs voice
    voiceModel: TtsModel; // ElevenLabs voice model (v4 Turbo, or Flash)
}
