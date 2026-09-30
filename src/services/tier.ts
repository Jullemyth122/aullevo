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

export const FREE_MAX_ACTIVE_PROFILES = 2;

// Free: Instant (0ms) and Natural (25ms). Pro: Slow (65ms) and any custom delay.
export const FREE_TYPING_DELAYS = [0, 25] as const;
export const DEFAULT_TYPING_DELAY = 25;

export function canUseTypingDelay(ms: number, isPro: boolean): boolean {
    return isPro || (FREE_TYPING_DELAYS as readonly number[]).includes(ms);
}

export function effectiveTypingDelay(ms: number, isPro: boolean): number {
    return canUseTypingDelay(ms, isPro) ? ms : DEFAULT_TYPING_DELAY;
}

// File injection is Pro-only
export function filesAllowedForPlan<T>(files: T[], isPro: boolean): T[] {
    return isPro ? files : [];
}

// Auto-pagination (fill every page of a multi-step form) is Pro-only
export function autoPaginateAllowed(enabled: boolean, isPro: boolean): boolean {
    return isPro && enabled;
}

export const PROFILE_LIMIT_MESSAGE = `Free plan allows ${FREE_MAX_ACTIVE_PROFILES} active profiles. Turn extra profiles OFF or upgrade to Pro.`;

// True when a Free account has more profiles ON than allowed (e.g. after Pro expired)
export function exceedsFreeProfileLimit(profiles: { enabled: boolean }[], isPro: boolean): boolean {
    return !isPro && profiles.filter(p => p.enabled).length > FREE_MAX_ACTIVE_PROFILES;
}

export function countActiveProfiles(profiles: Record<string, { enabled: boolean }>, excludeKey?: string): number {
    return Object.entries(profiles).filter(([key, p]) => key !== excludeKey && p.enabled).length;
}
