import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ACCOUNT_STORAGE_KEY } from '../services/tier';
import { REWARDS_STORAGE_KEY, consumeReward, planAccess, readRewards, type PlanAccess, type RewardFeature, type RewardsCache } from '../services/rewards';

/**
 * The account's Free plan (daily allowance and pass), kept fresh: read from the cached copy, refreshed by background.ts when the
 * panel opens or regains focus (an ad watched on aullevo-web, or on another computer), re-rendered every 30 s so
 * the time left counts down.
 */
export function useRewards(accountUid: string | undefined) {
    const [cache, setCache] = useState<RewardsCache | null>(null);
    const [, setTick] = useState(0);

    const refresh = useCallback((force = true) => {
        chrome.runtime?.sendMessage?.({ action: 'REFRESH_REWARDS', force })?.catch?.(() => { });
    }, []);

    useEffect(() => {
        let alive = true;
        readRewards().then(c => { if (alive) setCache(c); });
        const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
            if (area === 'local' && (changes[REWARDS_STORAGE_KEY] || changes[ACCOUNT_STORAGE_KEY])) {
                readRewards().then(c => { if (alive) setCache(c); });
            }
        };
        chrome.storage?.onChanged?.addListener(onChange);
        if (accountUid) refresh(true);
        const onVisible = () => { if (document.visibilityState === 'visible' && accountUid) refresh(false); };
        window.addEventListener('focus', onVisible);
        document.addEventListener('visibilitychange', onVisible);
        const timer = window.setInterval(() => setTick(t => t + 1), 30_000);
        return () => {
            alive = false;
            chrome.storage?.onChanged?.removeListener(onChange);
            window.removeEventListener('focus', onVisible);
            document.removeEventListener('visibilitychange', onVisible);
            window.clearInterval(timer);
        };
    }, [accountUid, refresh]);

    /** Opens aullevo-web/rewards for this feature (background.ts brings the user back after the ad). */
    const openUnlock = useCallback((feature: RewardFeature) => {
        chrome.runtime?.sendMessage?.({ action: 'OPEN_REWARDS', feature })?.catch?.(() => { });
    }, []);

    /** Spends one use (JSON import, voice session) on the server. */
    const consume = useCallback(async (feature: RewardFeature) => {
        const result = await consumeReward(feature);
        if (result.cache) setCache(result.cache);
        return result;
    }, []);

    return { cache, refresh, openUnlock, consume };
}

export type RewardsState = ReturnType<typeof useRewards>;

/** Shared with the tabs (App provides it): the unlocks, what the plan allows now, and the actions. */
export interface PlanRewards {
    cache: RewardsCache | null;
    access: PlanAccess;
    isPro: boolean;
    signedIn: boolean;
    openUnlock: (feature: RewardFeature) => void;
    consume: (feature: RewardFeature) => Promise<{ ok: boolean; error?: string }>;
    connect: () => void;
}

export const PlanRewardsContext = createContext<PlanRewards>({
    cache: null,
    access: planAccess(false, null),
    isPro: false,
    signedIn: false,
    openUnlock: () => { },
    consume: async () => ({ ok: false }),
    connect: () => { }
});

export const usePlanRewards = () => useContext(PlanRewardsContext);
