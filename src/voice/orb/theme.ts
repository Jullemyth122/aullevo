// The orb's colour theme, shared by every open extension page (side panel, full page).
import { useEffect, useSyncExternalStore } from 'react';
import { readOrbTheme, saveOrbTheme, THEME_STORAGE_KEY, type OrbTheme } from './themes';

let currentTheme = readOrbTheme();
const listeners = new Set<() => void>();
const snapshot = () => currentTheme;
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

function publish(theme: OrbTheme) {
    currentTheme = theme;
    listeners.forEach(listener => listener());
}

export function setOrbTheme(theme: OrbTheme) {
    saveOrbTheme(theme.id);
    publish(theme);
}

/** The current theme; follows changes made on other extension pages. */
export function useOrbTheme() {
    useEffect(() => {
        const sync = (event: StorageEvent) => {
            if (event.key === THEME_STORAGE_KEY || event.key === null) publish(readOrbTheme());
        };
        window.addEventListener('storage', sync);
        return () => window.removeEventListener('storage', sync);
    }, []);
    return { theme: useSyncExternalStore(subscribe, snapshot), setTheme: setOrbTheme };
}

/** CSS variables the orb and the voice view read their colours from. */
export function themeVars(theme: OrbTheme): Record<string, string> {
    return { '--theme-primary': theme.accent, '--theme-secondary': theme.base, '--theme-highlight': theme.hot };
}
