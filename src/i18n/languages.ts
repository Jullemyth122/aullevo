// languages.ts - Supported UI languages and how the browser's language maps onto them.
// Shared by the panel (i18n/index.ts) and background.ts; content.ts must not import it (classic script).

export interface Language {
    code: string;      // our code, also the file name in public/locales/<code>.json
    native: string;    // name in the language itself
    english: string;   // name in English, always shown too so nobody gets lost
    chrome: string;    // Chrome _locales folder name (store listing, manifest strings)
    rtl?: boolean;
}

export const DEFAULT_LANGUAGE = 'en';

export const LANGUAGES: Language[] = [
    { code: 'en', native: 'English', english: 'English', chrome: 'en' },
    { code: 'ar', native: 'العربية', english: 'Arabic', chrome: 'ar', rtl: true },
    { code: 'bn', native: 'বাংলা', english: 'Bengali', chrome: 'bn' },
    { code: 'cs', native: 'Čeština', english: 'Czech', chrome: 'cs' },
    { code: 'da', native: 'Dansk', english: 'Danish', chrome: 'da' },
    { code: 'de', native: 'Deutsch', english: 'German', chrome: 'de' },
    { code: 'el', native: 'Ελληνικά', english: 'Greek', chrome: 'el' },
    { code: 'es', native: 'Español', english: 'Spanish', chrome: 'es' },
    { code: 'fa', native: 'فارسی', english: 'Persian', chrome: 'fa', rtl: true },
    { code: 'fi', native: 'Suomi', english: 'Finnish', chrome: 'fi' },
    { code: 'fil', native: 'Filipino', english: 'Filipino', chrome: 'fil' },
    { code: 'fr', native: 'Français', english: 'French', chrome: 'fr' },
    { code: 'he', native: 'עברית', english: 'Hebrew', chrome: 'he', rtl: true },
    { code: 'hi', native: 'हिन्दी', english: 'Hindi', chrome: 'hi' },
    { code: 'hu', native: 'Magyar', english: 'Hungarian', chrome: 'hu' },
    { code: 'id', native: 'Bahasa Indonesia', english: 'Indonesian', chrome: 'id' },
    { code: 'it', native: 'Italiano', english: 'Italian', chrome: 'it' },
    { code: 'ja', native: '日本語', english: 'Japanese', chrome: 'ja' },
    { code: 'ko', native: '한국어', english: 'Korean', chrome: 'ko' },
    { code: 'ms', native: 'Bahasa Melayu', english: 'Malay', chrome: 'ms' },
    { code: 'nl', native: 'Nederlands', english: 'Dutch', chrome: 'nl' },
    { code: 'no', native: 'Norsk', english: 'Norwegian', chrome: 'no' },
    { code: 'pl', native: 'Polski', english: 'Polish', chrome: 'pl' },
    { code: 'pt-BR', native: 'Português (Brasil)', english: 'Portuguese (Brazil)', chrome: 'pt_BR' },
    { code: 'pt-PT', native: 'Português (Portugal)', english: 'Portuguese (Portugal)', chrome: 'pt_PT' },
    { code: 'ro', native: 'Română', english: 'Romanian', chrome: 'ro' },
    { code: 'ru', native: 'Русский', english: 'Russian', chrome: 'ru' },
    { code: 'sv', native: 'Svenska', english: 'Swedish', chrome: 'sv' },
    { code: 'th', native: 'ไทย', english: 'Thai', chrome: 'th' },
    { code: 'tr', native: 'Türkçe', english: 'Turkish', chrome: 'tr' },
    { code: 'uk', native: 'Українська', english: 'Ukrainian', chrome: 'uk' },
    { code: 'vi', native: 'Tiếng Việt', english: 'Vietnamese', chrome: 'vi' },
    { code: 'zh-CN', native: '简体中文', english: 'Chinese (Simplified)', chrome: 'zh_CN' },
    { code: 'zh-TW', native: '繁體中文', english: 'Chinese (Traditional)', chrome: 'zh_TW' }
];

// Saved choice: a language code, or 'auto' to follow the browser's language
export const LANGUAGE_STORAGE_KEY = 'aullevo_language';
export const AUTO_LANGUAGE = 'auto';

export const getLanguage = (code: string): Language | undefined => LANGUAGES.find(l => l.code === code);

// Browser codes that don't match ours directly
const ALIASES: Record<string, string> = {
    tl: 'fil', iw: 'he', nb: 'no', nn: 'no', pt: 'pt-BR', zh: 'zh-CN',
    'zh-HK': 'zh-TW', 'zh-MO': 'zh-TW', 'zh-Hant': 'zh-TW', 'zh-Hans': 'zh-CN', 'zh-SG': 'zh-CN'
};

// "fil-PH" -> "fil", "pt-PT" -> "pt-PT", "zh-HK" -> "zh-TW", anything unknown -> English
export function matchBrowserLanguage(browserCode: string | undefined): string {
    if (!browserCode) return DEFAULT_LANGUAGE;
    const tag = browserCode.replace('_', '-');
    const lower = tag.toLowerCase();
    const exact = LANGUAGES.find(l => l.code.toLowerCase() === lower);
    if (exact) return exact.code;
    const alias = Object.keys(ALIASES).find(a => a.toLowerCase() === lower);
    if (alias) return ALIASES[alias];
    const base = lower.split('-')[0];
    const byBase = LANGUAGES.find(l => l.code.toLowerCase() === base);
    if (byBase) return byBase.code;
    return ALIASES[base] ?? DEFAULT_LANGUAGE;
}

export function getBrowserLanguage(): string {
    let ui: string | undefined;
    try { ui = chrome.i18n?.getUILanguage?.(); } catch { /* not in an extension context */ }
    return matchBrowserLanguage(ui || (typeof navigator !== 'undefined' ? navigator.language : undefined));
}

// Preference ('auto' or a code) -> the language actually shown
export function resolveLanguage(preference: unknown): string {
    if (typeof preference === 'string' && getLanguage(preference)) return preference;
    return getBrowserLanguage();
}
