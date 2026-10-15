import { useState } from 'react';
import { Clapperboard, Gift, Play, Timer } from 'lucide-react';
import { useT } from '../i18n';
import {
    REWARD_FEATURES, REWARD_RULES, adLengthLabel, dailyFree, formatTimeLeft, freeLeft, freeResetTime, isCounted, isUnlocked,
    msLeft, usesLeft, type RewardFeature, type RewardsCache
} from '../services/rewards';
import { usePlanRewards } from '../hooks/useRewards';
import styles from './UnlockCard.module.scss';

interface UnlockProps {
    feature: RewardFeature;
    cache: RewardsCache | null;
    isPro: boolean;
    signedIn: boolean;
    onWatch: (feature: RewardFeature) => void;
    onConnect: () => void;
    /** Why the card shows (e.g. "AI Smart Fill needs an unlock…"); defaults to what the ad gives */
    reason?: string;
}

const lengthOf = (feature: RewardFeature) => adLengthLabel(REWARD_RULES[feature].adSeconds).replace('-minute', ' min').replace('-second', ' s');

// Today's free window (auto-pagination, typing) is running
const freeWindowRuns = (cache: RewardsCache | null, feature: RewardFeature) =>
    Boolean(cache?.unlocks[feature]?.free) && msLeft(cache, feature) > 0;

// An ad is only offered once today's free allowance is used (the server refuses one before)
const freeStillLeft = (cache: RewardsCache | null, feature: RewardFeature) =>
    freeLeft(cache, feature) > 0 || freeWindowRuns(cache, feature);

/** What the plan gives right now: "4 AI fills left · 1h 32m", "2 of 3 free today", "Free today · 1h 12m left". */
function statusText(t: ReturnType<typeof useT>['t'], cache: RewardsCache | null, feature: RewardFeature): string | null {
    if (!cache || cache.pro) return null;
    const running = msLeft(cache, feature) > 0;
    const time = formatTimeLeft(msLeft(cache, feature));
    const free = freeLeft(cache, feature);
    const unit = t(`rewards.feature.${feature}.unit`);
    if (isCounted(feature)) {
        const fromAd = running ? usesLeft(cache, feature) : 0;
        if (fromAd > 0) return t('rewards.card.activeUses', { left: `${fromAd + free} ${unit}`, time });
        if (free > 0) return t('rewards.card.freeLeft', { left: free, total: dailyFree(feature), unit });
        return running ? t('rewards.card.usedUp') : null;
    }
    if (running) return cache.unlocks[feature]?.free ? t('rewards.card.freeRunning', { time }) : t('rewards.card.active', { time });
    if (free > 0) return t('rewards.card.freeReady', { hours: REWARD_RULES[feature].freeHours ?? 0 });
    return null;
}

/** The running unlock or today's free allowance. Null when there is neither. */
export function UnlockStatus({ feature, cache }: { feature: RewardFeature; cache: RewardsCache | null }) {
    const { t } = useT();
    const text = statusText(t, cache, feature);
    if (!text) return null;
    const free = !isUnlocked(cache, feature) || freeWindowRuns(cache, feature);
    return (
        <div className={styles.active} role="status">
            {free ? <Gift size={12} /> : <Timer size={12} />}
            <span className={styles.activeLabel}>{t(`rewards.feature.${feature}.title`)}</span>
            <span>{text}</span>
        </div>
    );
}

/**
 * Free plan: today's free allowance first; once it is used, "Watch a 1-minute ad for 6 AI fills (2 hours)".
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
        ? t('rewards.card.freeUsed', { gives: t(`rewards.feature.${feature}.gives`), time: freeResetTime(cache) })
        : `${t(`rewards.feature.${feature}.gives`)}.`;
    return (
        <div className={styles.card}>
            <div className={styles.top}>
                <Clapperboard size={13} className={styles.icon} />
                <span>{t(`rewards.feature.${feature}.title`)}</span>
            </div>
            <p className={styles.text}>{reason ?? fallback}</p>
            <div className={styles.actions}>
                {signedIn ? (
                    <button type="button" className={styles.watch} onClick={watch}>
                        <Play size={11} /> {t('rewards.card.watch', { length: lengthOf(feature) })}
                    </button>
                ) : (
                    <button type="button" className={styles.watch} onClick={onConnect}>
                        {t('rewards.card.connect')}
                    </button>
                )}
                <span className={styles.pro}>{t('rewards.card.pro')}</span>
            </div>
            {!signedIn && <p className={styles.note}>{t(dailyFree(feature) > 0 ? 'rewards.card.connectFree' : 'rewards.card.connectHint')}</p>}
            {opened && signedIn && <p className={styles.note}>{t('rewards.card.opened')}</p>}
        </div>
    );
}

/** UnlockCard wired to the panel's plan (PlanRewardsContext). */
export function PlanUnlock({ feature, reason }: { feature: RewardFeature; reason?: string }) {
    const plan = usePlanRewards();
    return <UnlockCard feature={feature} reason={reason} cache={plan.cache} isPro={plan.isPro} signedIn={plan.signedIn}
        onWatch={plan.openUnlock} onConnect={plan.connect} />;
}

/** Settings: every feature, what is free each day, what an ad gives, and what runs now. */
export function UnlockList({ cache, signedIn, onWatch, onConnect }: Omit<UnlockProps, 'feature' | 'isPro' | 'reason'>) {
    const { t } = useT();
    const order: RewardFeature[] = ['ai', 'paginate', 'voice', 'profiles', 'links', 'json', 'typing'];
    return (
        <div>
            {order.filter(f => REWARD_FEATURES.includes(f)).map((feature) => {
                const status = statusText(t, cache, feature);
                const waitForFree = signedIn && freeStillLeft(cache, feature);
                return (
                    <div key={feature} className={styles.row}>
                        <div className={styles.rowText}>
                            <b>{t(`rewards.feature.${feature}.title`)}</b>
                            <span>{t('rewards.card.freeAndAd', { free: t(`rewards.feature.${feature}.free`), length: lengthOf(feature), gives: t(`rewards.feature.${feature}.gives`) })}</span>
                            {status && <em>{status}</em>}
                        </div>
                        <button type="button" className={styles.watch} disabled={waitForFree}
                            title={waitForFree ? t('rewards.card.useFreeFirst') : undefined}
                            onClick={() => (signedIn ? onWatch(feature) : onConnect())}>
                            <Play size={11} /> {signedIn ? lengthOf(feature) : t('rewards.card.connect')}
                        </button>
                    </div>
                );
            })}
            {signedIn && cache?.freeResetsAt && (
                <p className={styles.note}>{t('rewards.card.resets', { time: freeResetTime(cache) })} {t('rewards.card.adds')}</p>
            )}
        </div>
    );
}
