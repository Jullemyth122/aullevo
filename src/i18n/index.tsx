// i18n - UI translations for the side panel and full page.
//
// English lives in src/i18n/en/<namespace>.json and is bundled (it is also the fallback for any missing text).
// Other languages are public/locales/<code>.json (all namespaces in one file), fetched only when chosen,
// so each user loads one language. Keys are "<namespace>.<path>", e.g. t('autofill.detection.title').
//
//   t('profiles.fieldCount', { count: 3 })   -> plural forms: "fieldCount": { "one": "...", "other": "..." }
//   tRich('tour.json.step4')                 -> <b>bold</b> in the text becomes <strong>
//
// en/content.json is for content.ts only (it gets other languages from background.ts);
// en/manifest.json becomes public/_locales (store listing, shortcut names) via scripts/i18n-manifest.mjs.

import { Fragment, useSyncExternalStore, type ReactNode } from 'react';
import {
    AUTO_LANGUAGE,
    DEFAULT_LANGUAGE,
    LANGUAGE_STORAGE_KEY,
    getLanguage,
    resolveLanguage
} from './languages';

export type Vars = Record<string, string | number | Date>;
type Messages = Record<string, string>;
type Nested = { [key: string]: string | Nested };

// "a": { "b": "x" } -> { "a.b": "x" }
export function flattenMessages(obj: Nested, prefix = '', out: Messages = {}): Messages {
    for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') out[path] = value;
        else if (value && typeof value === 'object') flattenMessages(value, path, out);
    }
    return out;
}

const enModules = import.meta.glob<Nested>(['./en/*.json', '!./en/content.json', '!./en/manifest.json'], { eager: true, import: 'default' });
const EN: Messages = {};
for (const [path, json] of Object.entries(enModules)) {
    const namespace = path.replace(/^.*\/(.+)\.json$/, '$1');
    flattenMessages(json, namespace, EN);
}

// ── Store ──────────────────────────────────────────────────────────────

export interface LanguageChange {
    from: string; // preference before the change ('auto' or a code)
    to: string;
}

let preference: string = AUTO_LANGUAGE;
let language: string = DEFAULT_LANGUAGE;
let messages: Messages = {};
let lastChange: LanguageChange | null = null;
let version = 0;
const listeners = new Set<() => void>();
const cache = new Map<string, Messages>();

const emit = () => {
    version++;
    listeners.forEach(l => l());
};

async function loadMessages(code: string): Promise<Messages> {
    if (code === DEFAULT_LANGUAGE) return {};
    const cached = cache.get(code);
    if (cached) return cached;
    try {
        const url = chrome.runtime?.getURL ? chrome.runtime.getURL(`locales/${code}.json`) : `/locales/${code}.json`;
        const res = await fetch(url);
        const loaded = flattenMessages(await res.json());
        cache.set(code, loaded);
        return loaded;
    } catch (err) {
        console.warn(`[Aullevo:i18n] Could not load ${code}, using English.`, err);
        return {};
    }
}

async function apply(nextPreference: string): Promise<void> {
    const code = resolveLanguage(nextPreference);
    const loaded = await loadMessages(code);
    preference = nextPreference;
    language = code;
    messages = loaded;
    document.documentElement.lang = code;
    document.documentElement.dir = getLanguage(code)?.rtl ? 'rtl' : 'ltr';
    emit();
}

let initPromise: Promise<void> | null = null;

// Call once before the first render, so the panel never flashes English
export function initI18n(): Promise<void> {
    if (initPromise) return initPromise;
    initPromise = (async () => {
        let saved: unknown;
        try {
            saved = (await chrome.storage?.local?.get(LANGUAGE_STORAGE_KEY))?.[LANGUAGE_STORAGE_KEY];
        } catch { /* storage unavailable: follow the browser */ }
        await apply(typeof saved === 'string' ? saved : AUTO_LANGUAGE);

        // Side panel and full page stay in the same language
        chrome.storage?.onChanged?.addListener((changes, area) => {
            const change = changes[LANGUAGE_STORAGE_KEY];
            if (area !== 'local' || !change) return;
            const next = typeof change.newValue === 'string' ? change.newValue : AUTO_LANGUAGE;
            if (next !== preference) apply(next);
        });
    })();
    return initPromise;
}

// Switches language and remembers the old one, so the "Language changed" bar can undo it
export async function setLanguagePreference(next: string): Promise<void> {
    if (next === preference) return;
    lastChange = { from: preference, to: next };
    await apply(next);
    chrome.storage?.local?.set({ [LANGUAGE_STORAGE_KEY]: next });
}

export function undoLanguageChange(): void {
    if (!lastChange) return;
    const { from } = lastChange;
    lastChange = null;
    apply(from);
    chrome.storage?.local?.set({ [LANGUAGE_STORAGE_KEY]: from });
}

export function dismissLanguageChange(): void {
    lastChange = null;
    emit();
}

// ── Translation ────────────────────────────────────────────────────────

const pluralCategory = (code: string, count: number): string => {
    try { return new Intl.PluralRules(code).select(count); } catch { return count === 1 ? 'one' : 'other'; }
};

function lookup(key: string, vars?: Vars): string {
    const count = vars?.count;
    if (typeof count === 'number') {
        const local = messages[`${key}.${pluralCategory(language, count)}`] ?? messages[`${key}.other`];
        if (local !== undefined) return local;
        const en = EN[`${key}.${pluralCategory('en', count)}`] ?? EN[`${key}.other`];
        if (en !== undefined) return en;
    }
    const found = messages[key] ?? EN[key];
    if (found !== undefined) return found;
    if (import.meta.env.DEV) console.warn(`[Aullevo:i18n] Missing text: ${key}`);
    return key;
}

function interpolate(text: string, vars?: Vars): string {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (match, name: string) => {
        const value = vars[name];
        if (value === undefined) return match;
        if (value instanceof Date) return new Intl.DateTimeFormat(language, { month: 'long', day: 'numeric' }).format(value);
        return typeof value === 'number' ? new Intl.NumberFormat(language).format(value) : value;
    });
}

export function t(key: string, vars?: Vars): string {
    return interpolate(lookup(key, vars), vars);
}

// Same as t(), with <b>...</b> rendered as <strong>
export function tRich(key: string, vars?: Vars): ReactNode {
    const parts = t(key, vars).split(/<b>(.*?)<\/b>/g);
    return parts.map((part, i) => i % 2 === 1
        ? <strong key={i}>{part}</strong>
        : <Fragment key={i}>{part}</Fragment>);
}

// Always English, whatever the UI language (for the way back to English)
export function tEnglish(key: string, vars?: Vars): string {
    const count = vars?.count;
    const text = (typeof count === 'number' ? EN[`${key}.${pluralCategory('en', count)}`] ?? EN[`${key}.other`] : undefined) ?? EN[key] ?? key;
    return vars ? text.replace(/\{(\w+)\}/g, (m, n: string) => (vars[n] !== undefined ? String(vars[n]) : m)) : text;
}

// ── React ──────────────────────────────────────────────────────────────

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
const getVersion = () => version;

// Re-renders the component when the language changes
export function useT() {
    useSyncExternalStore(subscribe, getVersion);
    return { t, tRich, language, preference, lastChange };
}
