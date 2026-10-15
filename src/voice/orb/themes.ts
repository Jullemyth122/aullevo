// Colour themes for the voice agent's orb (ported from Autonoma). Solar matches Aullevo's blue + amber.
export const ORB_THEMES = [
    { id: 'solar', name: 'Solar', pair: 'Yellow + Blue', base: '#2495ff', accent: '#ffd447', hot: '#d7eeff' },
    { id: 'aurora', name: 'Aurora', pair: 'Violet + Cyan', base: '#9d78ff', accent: '#45edff', hot: '#eee5ff' },
    { id: 'mint', name: 'Mint', pair: 'Mint + Blue', base: '#398bff', accent: '#64ffc1', hot: '#dcfff3' },
    { id: 'sunset', name: 'Sunset', pair: 'Coral + Gold', base: '#ff667f', accent: '#ffcf69', hot: '#ffebe0' },
    { id: 'nebula', name: 'Nebula', pair: 'Pink + Violet', base: '#9174ff', accent: '#ff79d7', hot: '#fce3ff' },
    { id: 'glacier', name: 'Glacier', pair: 'Ice + Blue', base: '#408bff', accent: '#b4f3ff', hot: '#effcff' },
    { id: 'voltage', name: 'Voltage', pair: 'Lime + Violet', base: '#a27bff', accent: '#d4ff54', hot: '#efffd9' },
    { id: 'ember', name: 'Ember', pair: 'Orange + Cyan', base: '#26c8f5', accent: '#ff9b45', hot: '#ffecd9' },
] as const;

export type OrbTheme = (typeof ORB_THEMES)[number];
export type OrbThemeId = OrbTheme['id'];
export const THEME_STORAGE_KEY = 'aullevo.orb.theme';

export function readOrbTheme(): OrbTheme {
    try {
        const saved = localStorage.getItem(THEME_STORAGE_KEY);
        return ORB_THEMES.find(theme => theme.id === saved) ?? ORB_THEMES[0];
    } catch {
        return ORB_THEMES[0];
    }
}

export function saveOrbTheme(id: OrbThemeId) {
    try { localStorage.setItem(THEME_STORAGE_KEY, id); }
    catch { /* the current selection still works when storage is unavailable */ }
}
