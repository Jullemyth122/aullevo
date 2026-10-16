// tier.ts - Free / Pro plan rules shared by the side panel and background.ts
// (No Firebase imports here, so the service worker bundle stays small.)

// ---------------------------------------------------------------------------
// 1. Account snapshot cached in chrome.storage.local after sign-in
// ---------------------------------------------------------------------------

export interface AccountInfo {
    uid: string;
    email: string;
    displayName: string;
    photoURL: string;
    isPro: boolean;               // raw flag from Firestore
    proExpiresAt: string | null;  // ISO date; null = no expiry (Lifetime / admin grant)
    syncedAt: number;             // last time the plan was verified against Firestore
}

export const ACCOUNT_STORAGE_KEY = 'aullevo_account';

// Same rule as aullevo-web's evaluateProStatus(): Pro only while not expired
export function isProActive(acc: Pick<AccountInfo, 'isPro' | 'proExpiresAt'> | null | undefined): boolean {
    if (!acc?.isPro) return false;
    if (!acc.proExpiresAt) return true;
    return new Date(acc.proExpiresAt).getTime() > Date.now();
}

export async function getStoredAccount(): Promise<AccountInfo | null> {
    const res = await chrome.storage.local.get(ACCOUNT_STORAGE_KEY);
    const acc = res?.[ACCOUNT_STORAGE_KEY] as AccountInfo | undefined;
    return acc && typeof acc.uid === 'string' ? acc : null;
}

export async function isProUser(): Promise<boolean> {
    return isProActive(await getStoredAccount());
}

// ---------------------------------------------------------------------------
// 2. Free plan limits
// ---------------------------------------------------------------------------

// More than this needs Pro or a pass (no limit for 5 hours); UNLOCKED_MAX_ACTIVE_PROFILES: old "profiles" ad unlocks
export const FREE_MAX_ACTIVE_PROFILES = 3;
export const UNLOCKED_MAX_ACTIVE_PROFILES = 6;

export function activeProfileLimit(isPro: boolean, unlocked = false): number {
    return isPro ? Infinity : unlocked ? UNLOCKED_MAX_ACTIVE_PROFILES : FREE_MAX_ACTIVE_PROFILES;
}

// Free: Instant (0ms) and Natural (25ms). Slow (65ms) and custom delays: Pro, 2 free hours a day, or a
// pass. Callers pass `isPro || access.typing` as isPro; background.ts starts the free hours.
export const FREE_TYPING_DELAYS = [0, 25] as const;
export const DEFAULT_TYPING_DELAY = 25;

export function canUseTypingDelay(ms: number, isPro: boolean): boolean {
    return isPro || (FREE_TYPING_DELAYS as readonly number[]).includes(ms);
}

export function effectiveTypingDelay(ms: number, isPro: boolean): number {
    return canUseTypingDelay(ms, isPro) ? ms : DEFAULT_TYPING_DELAY;
}

// File injection: Pro, or a running pass (2 short ads: everything for 5 hours). Callers pass `isPro || access.files`.
export function filesAllowedForPlan<T>(files: T[], allowed: boolean): T[] {
    return allowed ? files : [];
}

// Voice mode (the agent orb: speech commands, targeted and dictated fills): Pro, or a voice session: 3 free a day,
// or any number during a pass (see rewards.ts). background.ts refuses voice requests without one.
export const VOICE_PRO_MESSAGE = "Voice mode: today's free voice sessions are used. Watch 2 short ads to unlock everything for 5 hours, or upgrade to Pro.";

// Auto-pagination (fill every page of a multi-step form): Pro, 2 free hours a day, or a pass (2 ads: 5 hours).
// Callers pass `isPro || access.paginate` as isPro; background.ts starts the free hours.
export function autoPaginateAllowed(enabled: boolean, isPro: boolean): boolean {
    return isPro && enabled;
}

export const PROFILE_LIMIT_MESSAGE = `Free plan allows ${FREE_MAX_ACTIVE_PROFILES} active profiles. Turn extra profiles OFF, watch 2 short ads to use them all for 5 hours, or upgrade to Pro.`;

// True when a Free account has more profiles ON than allowed (e.g. after Pro expired, or after a pass
// ended). `unlocked`: more profiles are allowed right now (a pass, or an old "profiles" ad unlock).
export function exceedsFreeProfileLimit(profiles: { enabled: boolean }[], isPro: boolean, unlocked = false): boolean {
    return profiles.filter(p => p.enabled).length > activeProfileLimit(isPro, unlocked);
}

/**
 * Profiles that are ON beyond the plan's limit (e.g. after a pass ended). Nothing is deleted or switched off:
 * the first `limit` profiles that are ON, in their saved order, keep working; the rest are paused until another ad
 * (or Pro) allows them, or the user turns another profile OFF. Returns their keys (profile types).
 */
export function pausedProfileKeys(profiles: Array<{ enabled: boolean; profileType?: string }> | Record<string, { enabled: boolean }>, limit: number): string[] {
    if (!Number.isFinite(limit)) return [];
    const entries: [string, { enabled: boolean }][] = Array.isArray(profiles)
        ? profiles.map((p) => [p.profileType ?? '', p])
        : Object.entries(profiles);
    return entries.filter(([, p]) => p.enabled).slice(limit).map(([key]) => key);
}

export function countActiveProfiles(profiles: Record<string, { enabled: boolean }>, excludeKey?: string): number {
    return Object.entries(profiles).filter(([key, p]) => key !== excludeKey && p.enabled).length;
}
