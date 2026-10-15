// rewards.ts - Free plan: an allowance every day; once it is used, a short ad on aullevo-web unlocks more for a few
// hours. Ads are only offered when the day's free allowance is used up. Each ad adds to what is running (uses and
// hours stack up). When an unlock ends nothing is deleted: extra profiles and links are only paused.
//
//             free every day                       one ad
//   ai        6 AI fills (server)                  10 AI fills, +2 hours
//   voice     3 voice sessions (server)            6 voice sessions, +2 hours
//   paginate  2 hours from the first use (server)  +4 hours
//   typing    2 hours from the first use (server)  +4 hours
//   json      4 imports (counted here, importQuota.ts)  10 imports, +5 hours
//   links     5 links in the queue                 10 links, +5 hours
//   profiles  3 active                             6 active, +2 hours
//
// The server decides what the account may use (aullevo-web api/rewards.ts, rules in api/_rewards-core.ts): free
// uses left today, which unlocks are running, how many uses are left. This file keeps a copy in
// chrome.storage.local (so the side panel and background.ts read it instantly), refreshes it from the server, and
// spends uses there. Keep REWARD_RULES in sync with the server and the website (src/config/rewards.ts).
//
// The extension signs in to the API with its own token, handed out when the account connects (WEB_AUTH_SYNC):
// Firebase ID tokens from the website expire after an hour.

import { ACCOUNT_STORAGE_KEY, activeProfileLimit, getStoredAccount, type AccountInfo } from './tier';

export type RewardFeature = 'ai' | 'profiles' | 'paginate' | 'typing' | 'json' | 'links' | 'voice';

export interface RewardRule {
    adSeconds: number;
    hours: number;
    uses?: number;
    freeUses?: number;  // free every day, counted on the server
    freeHours?: number; // one free window a day, from the first use
}

export const REWARD_RULES: Record<RewardFeature, RewardRule> = {
    ai: { adSeconds: 60, hours: 2, uses: 10, freeUses: 6 },
    profiles: { adSeconds: 30, hours: 2 },
    paginate: { adSeconds: 60, hours: 4, freeHours: 2 },
    typing: { adSeconds: 20, hours: 4, freeHours: 2 },
    json: { adSeconds: 60, hours: 5, uses: 10 },
    links: { adSeconds: 60, hours: 5 },
    voice: { adSeconds: 60, hours: 2, uses: 6, freeUses: 3 },
};

export const REWARD_FEATURES = Object.keys(REWARD_RULES) as RewardFeature[];
export const isCounted = (feature: RewardFeature) => typeof REWARD_RULES[feature].uses === 'number';
/** Free uses (counted) or free windows (time) a day kept on the server; 0 = none. */
export const dailyFree = (feature: RewardFeature) => REWARD_RULES[feature].freeUses ?? (REWARD_RULES[feature].freeHours ? 1 : 0);

// Multi-link queue size: Free, and Free with the "links" unlock (Pro: no limit)
export const FREE_LINK_LIMIT = 5;
export const UNLOCKED_LINK_LIMIT = 10;

export const REWARDS_STORAGE_KEY = 'aullevo_rewards';
export const EXT_TOKEN_STORAGE_KEY = 'aullevo_ext_token';

export interface Unlock {
    until: number;      // server time, epoch ms
    remaining?: number; // counted unlocks only
    free?: boolean;     // the day's free window (auto-pagination, typing), not an ad
}

export interface RewardsCache {
    uid: string;
    pro: boolean;
    live: boolean;          // real ads (Google Ad Manager) vs test ads
    unlocks: Partial<Record<RewardFeature, Unlock>>;
    offset: number;         // server clock minus this computer's clock
    fetchedAt: number;
    adsToday: number;
    dailyLimit: number;
    free?: Partial<Record<RewardFeature, number>>; // free uses (or free windows) left today
    freeResetsAt?: number;                          // server time; next UTC midnight
    voiceSessionUntil?: number; // server time; the voice session started last
}

// Release builds always talk to the live site; `npm run build:dev` may point at a local aullevo-web
const PROD_WEB_URL = 'https://aullevo.com';
export function rewardsWebUrl(): string {
    const dev = import.meta.env.MODE === 'development' ? String(import.meta.env.VITE_AULLEVO_WEB_URL ?? '').trim() : '';
    return (dev || PROD_WEB_URL).replace(/\/+$/, '');
}

export function rewardsPageUrl(feature: RewardFeature): string {
    return `${rewardsWebUrl()}/rewards?feature=${feature}&source=extension`;
}

// ---------------------------------------------------------------------------
// Reading the cached state
// ---------------------------------------------------------------------------

export const serverNow = (cache: Pick<RewardsCache, 'offset'> | null | undefined) => Date.now() + (cache?.offset ?? 0);

export function isUnlocked(cache: RewardsCache | null | undefined, feature: RewardFeature): boolean {
    if (!cache) return false;
    if (cache.pro) return true;
    const u = cache.unlocks[feature];
    if (!u || u.until <= serverNow(cache)) return false;
    return !isCounted(feature) || (u.remaining ?? 0) > 0;
}

/** Free uses (or the free window, as 1) left today. 0 without a connected account. */
export function freeLeft(cache: RewardsCache | null | undefined, feature: RewardFeature): number {
    const daily = dailyFree(feature);
    if (!cache || !daily) return 0;
    if (cache.freeResetsAt && serverNow(cache) >= cache.freeResetsAt) return daily; // a new day began since
    return Math.max(0, cache.free?.[feature] ?? 0);
}

/** Usable now: an unlock is running (ad or free window), or a free use / window is left today. */
export function canUse(cache: RewardsCache | null | undefined, feature: RewardFeature): boolean {
    return Boolean(cache?.pro) || isUnlocked(cache, feature) || freeLeft(cache, feature) > 0;
}

/** Uses left on a counted unlock (0 when none is running). */
export function usesLeft(cache: RewardsCache | null | undefined, feature: RewardFeature): number {
    const u = cache?.unlocks[feature];
    return u && u.until > serverNow(cache) ? Math.max(0, u.remaining ?? 0) : 0;
}

/** Milliseconds until a running unlock ends (0 when none). */
export function msLeft(cache: RewardsCache | null | undefined, feature: RewardFeature): number {
    const u = cache?.unlocks[feature];
    return u ? Math.max(0, u.until - serverNow(cache)) : 0;
}

export const voiceSessionActive = (cache: RewardsCache | null | undefined) =>
    Boolean(cache?.voiceSessionUntil && cache.voiceSessionUntil > serverNow(cache));

/** What the Free plan may use right now: today's free allowance plus the ads watched (Pro: everything). */
export interface PlanAccess {
    profiles: boolean;  // the "profiles" ad unlock runs (UNLOCKED_MAX_ACTIVE_PROFILES active)
    paginate: boolean;  // running, or today's free hours not started yet (they start on the first use)
    typing: boolean;    // Slow and custom typing speeds; same as paginate
    ai: boolean;        // an AI fill is available (free today or from an ad)
    json: boolean;      // a JSON import from an ad is available (the free ones: importQuota.ts)
    voice: boolean;     // a voice session is running (or Pro)
    linkLimit: number;
    profileLimit: number;
}

export function planAccess(isPro: boolean, cache: RewardsCache | null | undefined): PlanAccess {
    if (isPro) return { profiles: true, paginate: true, typing: true, ai: true, json: true, voice: true, linkLimit: Infinity, profileLimit: Infinity };
    const profiles = isUnlocked(cache, 'profiles');
    return {
        profiles,
        paginate: canUse(cache, 'paginate'),
        typing: canUse(cache, 'typing'),
        ai: canUse(cache, 'ai'),
        json: isUnlocked(cache, 'json'),
        voice: voiceSessionActive(cache),
        linkLimit: isUnlocked(cache, 'links') ? UNLOCKED_LINK_LIMIT : FREE_LINK_LIMIT,
        profileLimit: activeProfileLimit(false, profiles)
    };
}

/** The cached state, if it belongs to the account connected now. */
export async function readRewards(): Promise<RewardsCache | null> {
    const res = await chrome.storage.local.get([REWARDS_STORAGE_KEY, ACCOUNT_STORAGE_KEY]);
    const cache = res?.[REWARDS_STORAGE_KEY] as RewardsCache | undefined;
    const account = res?.[ACCOUNT_STORAGE_KEY] as AccountInfo | undefined;
    return cache && account?.uid && cache.uid === account.uid ? cache : null;
}

// ---------------------------------------------------------------------------
// Talking to the server
// ---------------------------------------------------------------------------

interface ServerState {
    pro: boolean;
    live?: boolean;
    now: number;
    unlocks: Partial<Record<RewardFeature, Unlock>>;
    adsToday: number;
    dailyLimit: number;
    free?: Partial<Record<RewardFeature, number>>;
    freeResetsAt?: number;
}

async function callApi<T>(action: string, token: string, body?: unknown): Promise<T> {
    const res = await fetch(`${rewardsWebUrl()}/api/rewards?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body ?? {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data?.error || `Aullevo server error (${res.status})`) as Error & { status?: number; code?: string };
        err.status = res.status;
        err.code = data?.code;
        throw err;
    }
    return data as T;
}

async function saveState(uid: string, state: ServerState, keep?: RewardsCache | null): Promise<RewardsCache> {
    const cache: RewardsCache = {
        uid,
        pro: Boolean(state.pro),
        live: Boolean(state.live),
        unlocks: state.unlocks ?? {},
        offset: typeof state.now === 'number' ? state.now - Date.now() : 0,
        fetchedAt: Date.now(),
        adsToday: state.adsToday ?? 0,
        dailyLimit: state.dailyLimit ?? 0,
        free: state.free ?? {},
        freeResetsAt: state.freeResetsAt,
        ...(keep?.uid === uid && keep.voiceSessionUntil ? { voiceSessionUntil: keep.voiceSessionUntil } : {})
    };
    await chrome.storage.local.set({ [REWARDS_STORAGE_KEY]: cache });
    return cache;
}

/** Account connected: get the extension's own API token (Firebase ID tokens expire in an hour). */
export async function linkExtension(uid: string, idToken: string): Promise<RewardsCache> {
    const data = await callApi<ServerState & { token: string }>('link', idToken);
    await chrome.storage.local.set({ [EXT_TOKEN_STORAGE_KEY]: { uid, token: data.token } });
    return saveState(uid, data, await readRewards());
}

async function extToken(): Promise<{ uid: string; token: string } | null> {
    const [account, res] = await Promise.all([getStoredAccount(), chrome.storage.local.get(EXT_TOKEN_STORAGE_KEY)]);
    const saved = res?.[EXT_TOKEN_STORAGE_KEY] as { uid?: string; token?: string } | undefined;
    return account && saved?.token && saved.uid === account.uid ? { uid: account.uid, token: saved.token } : null;
}

const FRESH_MS = 30_000;

/**
 * The account's unlocks from the server (or the cached copy when fresh or offline).
 * Null when no account is connected (Free features that need an ad then need a sign-in first).
 */
export async function refreshRewards(force = false): Promise<RewardsCache | null> {
    const cached = await readRewards();
    if (!force && cached && Date.now() - cached.fetchedAt < FRESH_MS) return cached;
    const auth = await extToken();
    if (!auth) return cached;
    try {
        return await saveState(auth.uid, await callApi<ServerState>('status', auth.token), cached);
    } catch (err) {
        console.warn('[Aullevo:Rewards] Could not refresh unlocks:', err instanceof Error ? err.message : err);
        return cached;
    }
}

export interface ConsumeResult {
    ok: boolean;
    error?: string;
    cache: RewardsCache | null;
}

/**
 * Spends one use on the server: an ad's uses first, then today's free ones (AI fill, JSON import from an ad, voice
 * session). Auto-pagination / typing: starts today's free window when none runs. Pro always succeeds.
 * The cached copy is updated either way, so the panel shows the new count at once.
 */
export async function consumeReward(feature: RewardFeature): Promise<ConsumeResult> {
    const auth = await extToken();
    const cached = await readRewards();
    if (!auth) return { ok: false, error: 'Connect your Aullevo account (Settings) to use the free daily allowance.', cache: cached };
    try {
        const data = await callApi<ServerState & { sessionUntil?: number }>('consume', auth.token, { feature });
        if (data.pro) return { ok: true, cache: cached ? { ...cached, pro: true } : cached };
        const next = await saveState(auth.uid, data, cached);
        if (!data.sessionUntil) return { ok: true, cache: next };
        const withSession: RewardsCache = { ...next, voiceSessionUntil: data.sessionUntil };
        await chrome.storage.local.set({ [REWARDS_STORAGE_KEY]: withSession });
        return { ok: true, cache: withSession };
    } catch (err) {
        const status = (err as { status?: number }).status;
        // The server refused (locked / used up): its view is the truth, so refresh the copy
        const cache = status === 403 ? await refreshRewards(true) : cached;
        return { ok: false, error: err instanceof Error ? err.message : String(err), cache };
    }
}

/**
 * Auto-pagination / Slow and custom typing at the moment they are used: true when an unlock (ad or today's free
 * window) is running; otherwise starts today's free window if it is still unused.
 */
export async function ensureTimeUnlock(feature: 'paginate' | 'typing'): Promise<boolean> {
    const cache = await refreshRewards();
    if (cache?.pro || isUnlocked(cache, feature)) return true;
    if (freeLeft(cache, feature) <= 0) return false;
    return (await consumeReward(feature)).ok;
}

/** Disconnect: forget the token and the cached unlocks. */
export async function clearRewards(): Promise<void> {
    await chrome.storage.local.remove([REWARDS_STORAGE_KEY, EXT_TOKEN_STORAGE_KEY]);
}

// ---------------------------------------------------------------------------
// Wording shared by the panel and background.ts
// ---------------------------------------------------------------------------

/** "1-minute" / "30-second" */
export function adLengthLabel(seconds: number): string {
    return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60}-minute` : `${seconds}-second`;
}

/** "1h 32m" / "12m" / "45s" */
export function formatTimeLeft(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
}

const GIVES: Record<RewardFeature, string> = {
    ai: '10 AI Smart Fills for 2 hours',
    profiles: 'up to 6 active profiles for 2 hours',
    paginate: 'auto-pagination for 4 hours',
    typing: 'Slow and custom typing speeds for 4 hours',
    json: '10 JSON imports for 5 hours',
    links: 'up to 10 Multi-link links for 5 hours',
    voice: '6 voice sessions for 2 hours'
};

/** "Watch a 1-minute ad to get 10 AI Smart Fills for 2 hours, or upgrade to Pro." (used in background messages) */
export function unlockHint(feature: RewardFeature): string {
    return `Watch a ${adLengthLabel(REWARD_RULES[feature].adSeconds)} ad to get ${GIVES[feature]}, or upgrade to Pro.`;
}

/** "Next free uses: 8:00 AM" — when today's free allowance comes back, in local time. */
export function freeResetTime(cache: RewardsCache | null | undefined): string {
    const at = cache?.freeResetsAt ? cache.freeResetsAt - (cache.offset ?? 0) : null;
    return at ? new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'midnight UTC';
}
