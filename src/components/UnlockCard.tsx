import { useState } from 'react';
import { Clapperboard, Gift, Play, Timer } from 'lucide-react';
import { useT } from '../i18n';
import {
    FREE_RULES, PASS_ADS, PASS_HOURS, REWARD_FEATURES, dailyFree, formatTimeLeft, freeLeft, freeResetTime, isCounted,
    isUnlocked, msLeft, passActive, passMsLeft, usesLeft, type RewardFeature, type RewardsCache
} from '../services/rewards';
import { usePlanRewards } from '../hooks/useRewards';
import { CollapsibleCard } from './CollapsibleCard';
import styles from './UnlockCard.module.scss';

interface UnlockProps {
    feature: RewardFeature;
    cache: RewardsCache | null;
    isPro: boolean;
    signedIn: boolean;
    onWatch: (feature: RewardFeature) => void;
    onConnect: () => void;
    /** Why the card shows (e.g. "AI Smart Fill: today's free uses are used"); defaults to what the pass gives */
    reason?: string;
}

// Today's free window (auto-pagination, typing) is running
const freeWindowRuns = (cache: RewardsCache | null, feature: RewardFeature) =>
    Boolean(cache?.unlocks[feature]?.free) && msLeft(cache, feature) > 0;

/** What the plan gives right now: "Everything unlocked · 4h 12m", "2 of 3 free today", "Free today · 1h 12m left". */
function statusText(t: ReturnType<typeof useT>['t'], cache: RewardsCache | null, feature: RewardFeature): string | null {
    if (!cache || cache.pro) return null;
    if (passActive(cache)) return t('rewards.pass.active', { time: formatTimeLeft(passMsLeft(cache)) });
    const running = msLeft(cache, feature) > 0;
    const time = formatTimeLeft(msLeft(cache, feature));
    const free = freeLeft(cache, feature);
    const unit = t(`rewards.feature.${feature}.unit`);
    if (isCounted(feature)) {
        // An unlock watched under the old per-feature ads, until it ends
        const fromAd = running ? usesLeft(cache, feature) : 0;
        if (fromAd > 0) return t('rewards.card.activeUses', { left: `${fromAd + free} ${unit}`, time });
        if (free > 0) return t('rewards.card.freeLeft', { left: free, total: dailyFree(feature), unit });
        return null;
    }
    if (running) return cache.unlocks[feature]?.free ? t('rewards.card.freeRunning', { time }) : t('rewards.card.active', { time });
    if (free > 0) return t('rewards.card.freeReady', { hours: FREE_RULES[feature].freeHours ?? 0 });
    return null;
}

/** The running pass or unlock, or today's free allowance. Null when there is neither. */
export function UnlockStatus({ feature, cache }: { feature: RewardFeature; cache: RewardsCache | null }) {
    const { t } = useT();
    const text = statusText(t, cache, feature);
    if (!text) return null;
    const free = !passActive(cache) && (!isUnlocked(cache, feature) || freeWindowRuns(cache, feature));
    return (
        <div className={styles.active} role="status">
            {free ? <Gift size={12} /> : <Timer size={12} />}
            <span className={styles.activeLabel}>{t(`rewards.feature.${feature}.title`)}</span>
            <span>{text}</span>
        </div>
    );
}

/** "▶ Watch 2 ads · 5 h of everything" (or "Ad 2 of 2" when one is already watched) */
function WatchButton({ cache, onClick }: { cache: RewardsCache | null; onClick: () => void }) {
    const { t } = useT();
    const done = cache?.passAds ?? 0;
    return (
        <button type="button" className={styles.watch} onClick={onClick}>
            <Play size={11} /> {done > 0
                ? t('rewards.pass.watchNext', { next: done + 1, total: PASS_ADS })
                : t('rewards.pass.watch', { count: PASS_ADS, hours: PASS_HOURS })}
        </button>
    );
}

/**
 * Free plan: today's free allowance first; once it is used, "Watch 2 short ads to unlock everything for 5 hours".
 * Nothing for Pro.
 */
export function UnlockCard({ feature, cache, isPro, signedIn, onWatch, onConnect, reason }: UnlockProps) {
    const { t } = useT();
    const [opened, setOpened] = useState(false);
    if (isPro || cache?.pro) return null;
    if (isUnlocked(cache, feature) || freeLeft(cache, feature) > 0) return <UnlockStatus feature={feature} cache={cache} />;

    const watch = () => {
        setOpened(true);
        onWatch(feature);
    };
    const fallback = dailyFree(feature) > 0 && signedIn
        ? t('rewards.pass.freeUsed', { count: PASS_ADS, hours: PASS_HOURS, time: freeResetTime(cache) })
        : t('rewards.pass.gives', { count: PASS_ADS, hours: PASS_HOURS });
    return (
        <div className={styles.card}>
            <div className={styles.top}>
                <Clapperboard size={13} className={styles.icon} />
                <span>{t(`rewards.feature.${feature}.title`)}</span>
            </div>
            <p className={styles.text}>{reason ?? fallback}</p>
            <div className={styles.actions}>
                {signedIn ? <WatchButton cache={cache} onClick={watch} /> : (
                    <button type="button" className={styles.watch} onClick={onConnect}>
                        {t('rewards.card.connect')}
                    </button>
                )}
                <span className={styles.pro}>{t('rewards.card.pro')}</span>
            </div>
            {!signedIn && <p className={styles.note}>{t(dailyFree(feature) > 0 ? 'rewards.card.connectFree' : 'rewards.card.connectHint')}</p>}
            {opened && signedIn && <p className={styles.note}>{t('rewards.pass.opened', { count: PASS_ADS })}</p>}
        </div>
    );
}

/** UnlockCard wired to the panel's plan (PlanRewardsContext). */
export function PlanUnlock({ feature, reason }: { feature: RewardFeature; reason?: string }) {
    const plan = usePlanRewards();
    return <UnlockCard feature={feature} reason={reason} cache={plan.cache} isPro={plan.isPro} signedIn={plan.signedIn}
        onWatch={plan.openUnlock} onConnect={plan.connect} />;
}

/** Settings: the pass (watch it, or how long it runs) and what is free every day. */
export function UnlockList({ cache, signedIn, onWatch, onConnect }: Omit<UnlockProps, 'feature' | 'isPro' | 'reason'>) {
    const { t } = useT();
    const order: RewardFeature[] = ['ai', 'paginate', 'voice', 'profiles', 'links', 'json', 'typing'];
    const running = passActive(cache);
    return (
        <div>
            <div className={styles.card}>
                <div className={styles.top}>
                    {running ? <Timer size={13} className={styles.icon} /> : <Clapperboard size={13} className={styles.icon} />}
                    <span>{t('rewards.pass.title', { hours: PASS_HOURS })}</span>
                </div>
                <p className={styles.text}>
                    {running
                        ? t('rewards.pass.running', { time: formatTimeLeft(passMsLeft(cache)), count: PASS_ADS, hours: PASS_HOURS })
                        : t('rewards.pass.gives', { count: PASS_ADS, hours: PASS_HOURS })}
                </p>
                <div className={styles.actions}>
                    {signedIn ? <WatchButton cache={cache} onClick={() => onWatch('ai')} /> : (
                        <button type="button" className={styles.watch} onClick={onConnect}>{t('rewards.card.connect')}</button>
                    )}
                </div>
            </div>
            {/* What's free every day: folded by default, the pass above is what most people look for */}
            <CollapsibleCard id="free-daily" className={styles.daily} defaultOpen={false} title={t('rewards.pass.dailyTitle')}>
                {order.filter(f => REWARD_FEATURES.includes(f)).map((feature) => {
                    const status = statusText(t, cache, feature);
                    return (
                        <div key={feature} className={styles.row}>
                            <div className={styles.rowText}>
                                <b>{t(`rewards.feature.${feature}.title`)}</b>
                                <span>{t('rewards.pass.freeEveryDay', { free: t(`rewards.feature.${feature}.free`) })}</span>
                                {status && <em>{status}</em>}
                            </div>
                        </div>
                    );
                })}
                <div className={styles.row}>
                    <div className={styles.rowText}>
                        <b>{t('rewards.pass.extrasTitle')}</b>
                        <span>{t('rewards.pass.extras')}</span>
                        {running && <em>{t('rewards.pass.active', { time: formatTimeLeft(passMsLeft(cache)) })}</em>}
                    </div>
                </div>
            </CollapsibleCard>
            {signedIn && cache?.freeResetsAt && (
                <p className={styles.note}>{t('rewards.card.resets', { time: freeResetTime(cache) })} {t('rewards.pass.adds', { count: PASS_ADS, hours: PASS_HOURS })}</p>
            )}
        </div>
    );
}
