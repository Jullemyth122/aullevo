// rewards.ts - Free plan: an allowance every day, and the pass: 2 short ads on aullevo-web unlock EVERYTHING for
// 5 hours, without limits, including document uploads and JSON export. The ads can be watched any time; 2 more ads
// add 5 more hours. When a pass ends nothing is deleted: extra profiles and links are only paused.
//
//             free every day
//   ai        6 AI fills (server)
//   voice     3 voice sessions (server)
//   paginate  2 hours from the first use (server)
//   typing    2 hours from the first use (server)
//   json      4 imports (counted here, importQuota.ts)
//   links     5 links in the queue
//   profiles  3 active
//
// The server decides what the account may use (aullevo-web api/rewards.ts, rules in api/_rewards-core.ts): free
// uses left today, the pass, and unlocks watched under the old per-feature ads (they run until they end). While a
// pass runs it also reports every feature as unlocked, which is what older extensions read. This file keeps a copy
// in chrome.storage.local (so the side panel and background.ts read it instantly), refreshes it from the server, and
// spends uses there. Keep FREE_RULES / PASS_* in sync with the server and the website (src/config/rewards.ts).
//
// The extension signs in to the API with its own token, handed out when the account connects (WEB_AUTH_SYNC):
// Firebase ID tokens from the website expire after an hour.

import { ACCOUNT_STORAGE_KEY, activeProfileLimit, getStoredAccount, type AccountInfo } from './tier';

export type RewardFeature = 'ai' | 'profiles' | 'paginate' | 'typing' | 'json' | 'links' | 'voice';

export interface FreeRule {
    counted: boolean;   // spent one use at a time (the others are a time window or a limit)
    freeUses?: number;  // free every day, counted on the server
    freeHours?: number; // one free window a day, from the first use
}

export const FREE_RULES: Record<RewardFeature, FreeRule> = {
    ai: { counted: true, freeUses: 6 },
    voice: { counted: true, freeUses: 3 },
    json: { counted: true },
    paginate: { counted: false, freeHours: 2 },
    typing: { counted: false, freeHours: 2 },
    links: { counted: false },
    profiles: { counted: false },
};

// The pass: this many ads unlock everything for this many hours
export const PASS_ADS = 2;
export const PASS_HOURS = 5;

export const REWARD_FEATURES = Object.keys(FREE_RULES) as RewardFeature[];
export const isCounted = (feature: RewardFeature) => FREE_RULES[feature].counted;
/** Free uses (counted) or free windows (time) a day kept on the server; 0 = none. */
export const dailyFree = (feature: RewardFeature) => FREE_RULES[feature].freeUses ?? (FREE_RULES[feature].freeHours ? 1 : 0);

// Multi-link queue size: Free, and Free with an old "links" unlock (Pro or a pass: no limit)
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
    passUntil?: number;         // server time; the running pass (everything unlocked) ends
    passAds?: number;           // ads already watched toward the next pass
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

/** A pass runs: everything is unlocked, without limits. */
export const passActive = (cache: RewardsCache | null | undefined): boolean =>
    Boolean(cache?.passUntil && cache.passUntil > serverNow(cache));

/** Milliseconds until the running pass ends (0 when none). */
export const passMsLeft = (cache: RewardsCache | null | undefined): number =>
    passActive(cache) ? cache!.passUntil! - serverNow(cache) : 0;

export function isUnlocked(cache: RewardsCache | null | undefined, feature: RewardFeature): boolean {
    if (!cache) return false;
    if (cache.pro || passActive(cache)) return true;
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

/** Uses left on a counted unlock (0 when none is running; no limit during a pass). */
export function usesLeft(cache: RewardsCache | null | undefined, feature: RewardFeature): number {
    if (passActive(cache)) return Infinity;
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

/** What the Free plan may use right now: today's free allowance plus a running pass (Pro: everything). */
export interface PlanAccess {
    pass: boolean;      // a pass runs: everything below is unlocked, without limits
    profiles: boolean;  // more than 3 active profiles (a pass, or an old "profiles" ad unlock)
    paginate: boolean;  // running, or today's free hours not started yet (they start on the first use)
    typing: boolean;    // Slow and custom typing speeds; same as paginate
    ai: boolean;        // an AI fill is available (free today, or a pass)
    json: boolean;      // a JSON import beyond the free ones (importQuota.ts) is available
    voice: boolean;     // a voice session is running (or Pro)
    files: boolean;     // documents are uploaded into forms (Pro or a pass)
    exportJson: boolean; // a profile can be downloaded as JSON (Pro or a pass)
    linkLimit: number;
    profileLimit: number;
}

export function planAccess(isPro: boolean, cache: RewardsCache | null | undefined): PlanAccess {
    if (isPro || passActive(cache)) {
        return {
            pass: !isPro, profiles: true, paginate: true, typing: true, ai: true, json: true, files: true, exportJson: true,
            voice: isPro || voiceSessionActive(cache), linkLimit: Infinity, profileLimit: Infinity
        };
    }
    // Unlocks watched under the old per-feature ads keep their old limits until they end
    const profiles = isUnlocked(cache, 'profiles');
    return {
        pass: false,
        profiles,
        paginate: canUse(cache, 'paginate'),
        typing: canUse(cache, 'typing'),
        ai: canUse(cache, 'ai'),
        json: isUnlocked(cache, 'json'),
        voice: voiceSessionActive(cache),
        files: false,
        exportJson: false,
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
    pass?: { until: number } | null;
    passAds?: number;
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
        ...(state.pass?.until ? { passUntil: state.pass.until } : {}),
        passAds: state.passAds ?? 0,
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

/** "1h 32m" / "12m" / "45s" */
export function formatTimeLeft(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
}

/** "Watch 2 short ads to unlock everything for 5 hours, or upgrade to Pro." (used in background messages) */
export const PASS_HINT = `Watch ${PASS_ADS} short ads to unlock everything for ${PASS_HOURS} hours, or upgrade to Pro.`;

/** "Next free uses: 8:00 AM" — when today's free allowance comes back, in local time. */
export function freeResetTime(cache: RewardsCache | null | undefined): string {
    const at = cache?.freeResetsAt ? cache.freeResetsAt - (cache.offset ?? 0) : null;
    return at ? new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'midnight UTC';
}
