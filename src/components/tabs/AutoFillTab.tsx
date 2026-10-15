import { Zap, RefreshCw } from 'lucide-react';
import type { UserData, CM } from '../../types';
import { getProfileCustomFields } from '../../types';
import { useT } from '../../i18n';
import { usePlanRewards } from '../../hooks/useRewards';
import { PlanUnlock, UnlockStatus } from '../UnlockCard';

interface AutofillTabProps {
    currentProfile: UserData;
    detectedFields: string;
    isHighlighting: boolean;
    isFilling: boolean;
    useAiFill: boolean;
    autoPaginate: boolean;
    onToggleHighlight: () => void;
    onRescan: () => void;
    onFill: () => void;
}

export function AutofillTab({
    currentProfile,
    detectedFields,
    isHighlighting,
    isFilling,
    useAiFill,
    autoPaginate,
    onToggleHighlight,
    onRescan,
    onFill
}: AutofillTabProps) {
    const { t } = useT();
    const plan = usePlanRewards();
    const profileType = currentProfile.profileType.toUpperCase();
    const enabledFieldsCount = getProfileCustomFields(currentProfile).filter((f: CM) => f.enabled).length;
    const enabledFilesCount = (currentProfile.files || []).filter(f => f.enabled).length;

    return (
        <>
            {/* Detection Card */}
            <div className="av-card av-detection" data-tour="detection">
                <div>
                    <div className="av-detection__eyebrow">{t('autofill.detection.title')}</div>
                    <div className="av-detection__count av-detection__count--active">
                        {detectedFields}
                    </div>
                    <div className="av-detection__sub">{t('autofill.detection.sub')}</div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                        className={`av-detection__rescan ${isHighlighting ? 'active' : ''}`}
                        onClick={onToggleHighlight}
                        data-tour="highlight"
                        title={t('autofill.detection.highlightTitle')}
                    >
                        <span>{isHighlighting ? t('autofill.detection.clear') : t('autofill.detection.highlight')}</span>
                    </button>
                    <button className="av-detection__rescan" onClick={onRescan} title={t('autofill.detection.rescanTitle')} data-tour="rescan">
                        <RefreshCw size={11} />
                        <span>{t('autofill.detection.rescan')}</span>
                    </button>
                </div>
            </div>

            {/* Hero Fill Button */}
            <button
                className={`av-fill-btn ${isFilling || !currentProfile.enabled ? 'av-fill-btn--disabled' : ''}`}
                onClick={onFill}
                disabled={isFilling || !currentProfile.enabled}
                data-tour="fill"
            >
                <Zap size={15} />
                <span>
                    {isFilling
                        ? t('autofill.fill.injecting')
                        : !currentProfile.enabled
                            ? t('autofill.fill.disabled', { type: profileType })
                            : useAiFill
                                ? t('autofill.fill.withAi', { type: profileType })
                                : t('autofill.fill.standard', { type: profileType })}
                </span>
            </button>
            {autoPaginate && currentProfile.enabled && (
                <div style={{ fontSize: 10, color: 'var(--av-text-muted)', textAlign: 'center', marginTop: -4, marginBottom: 10 }}>
                    {t('autofill.fill.autoPaginate')}
                </div>
            )}

            {/* Free plan: AI fills left today (free, then from a short ad; keyword fill stays free), auto-pagination hours */}
            {!plan.isPro && (useAiFill || autoPaginate) && (
                <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
                    {useAiFill && <PlanUnlock feature="ai" />}
                    {autoPaginate && <UnlockStatus feature="paginate" cache={plan.cache} />}
                </div>
            )}

            {/* Active Profile Snapshot Card */}
            <div className="av-card" data-tour="active-profile">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div className="av-label">{t('autofill.activeProfile.title')}</div>
                    <span className="av-pill av-pill--active">
                        {profileType}
                    </span>
                </div>
                <div className="av-active-profile-name">
                    {currentProfile.profileName}
                </div>
                <div style={{ fontSize: 11, color: 'var(--av-text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{t('autofill.activeProfile.summary', {
                        fields: t('autofill.activeProfile.fieldCount', { count: enabledFieldsCount }),
                        docs: t('autofill.activeProfile.docCount', { count: enabledFilesCount })
                    })}</span>
                    <span style={{ color: currentProfile.enabled ? 'var(--av-success)' : 'var(--av-error)', fontWeight: 700, fontSize: 10 }}>
                        {currentProfile.enabled ? t('autofill.activeProfile.ready') : t('autofill.activeProfile.disabled')}
                    </span>
                </div>
            </div>

            {/* Shortcuts Helper */}
            <div className="av-card av-shortcuts" data-tour="shortcuts">
                <div className="av-shortcuts__title">{t('autofill.shortcuts.title')}</div>
                <div className="av-shortcuts__item">
                    <span className="av-shortcuts__desc">{t('autofill.shortcuts.toggleSidePanel')}</span>
                    <span className="av-shortcuts__key">Alt+Q / Option+Q</span>
                </div>
                <div className="av-shortcuts__item">
                    <span className="av-shortcuts__desc">{t('autofill.shortcuts.formFill')}</span>
                    <span className="av-shortcuts__key">Alt+Shift+L / Option+Shift+L</span>
                </div>
                <div className="av-shortcuts__item">
                    <span className="av-shortcuts__desc">{t('autofill.shortcuts.batchFill')}</span>
                    <span className="av-shortcuts__key">Alt+Shift+B / Option+Shift+B</span>
                </div>
            </div>
        </>
    );
}
