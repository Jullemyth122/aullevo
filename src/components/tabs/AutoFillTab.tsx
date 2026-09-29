import { Zap, RefreshCw } from 'lucide-react';
import type { UserData, CM } from '../../types';
import { getProfileCustomFields } from '../../types';

interface AutofillTabProps {
    currentProfile: UserData;
    detectedFields: string;
    isHighlighting: boolean;
    isFilling: boolean;
    useAiFill: boolean;
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
    onToggleHighlight,
    onRescan,
    onFill
}: AutofillTabProps) {
    const profileType = currentProfile.profileType.toUpperCase();
    const enabledFieldsCount = getProfileCustomFields(currentProfile).filter((f: CM) => f.enabled).length;
    const enabledFilesCount = (currentProfile.files || []).filter(f => f.enabled).length;

    return (
        <>
            {/* Detection Card */}
            <div className="av-card av-detection">
                <div>
                    <div className="av-detection__eyebrow">Form Detection</div>
                    <div className="av-detection__count av-detection__count--active">
                        {detectedFields}
                    </div>
                    <div className="av-detection__sub">Fields on active tab</div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                        className={`av-detection__rescan ${isHighlighting ? 'active' : ''}`}
                        onClick={onToggleHighlight}
                        title="Inspect and highlight fields on page"
                    >
                        <span>{isHighlighting ? 'Clear' : 'Highlight'}</span>
                    </button>
                    <button className="av-detection__rescan" onClick={onRescan} title="Rescan page">
                        <RefreshCw size={11} />
                        <span>Rescan</span>
                    </button>
                </div>
            </div>

            {/* Hero Fill Button */}
            <button
                className={`av-fill-btn ${isFilling || !currentProfile.enabled ? 'av-fill-btn--disabled' : ''}`}
                onClick={onFill}
                disabled={isFilling || !currentProfile.enabled}
            >
                <Zap size={15} />
                <span>
                    {isFilling
                        ? 'Injecting...'
                        : !currentProfile.enabled
                            ? `${profileType} Disabled`
                            : useAiFill
                                ? `Fill Form with AI (${profileType})`
                                : `Fill Form (${profileType})`}
                </span>
            </button>

            {/* Active Profile Snapshot Card */}
            <div className="av-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div className="av-label">Active Profile</div>
                    <span className="av-pill av-pill--active">
                        {profileType}
                    </span>
                </div>
                <div className="av-active-profile-name">
                    {currentProfile.profileName}
                </div>
                <div style={{ fontSize: 11, color: 'var(--av-text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{enabledFieldsCount} fields &bull; {enabledFilesCount} docs ready</span>
                    <span style={{ color: currentProfile.enabled ? 'var(--av-success)' : 'var(--av-error)', fontWeight: 700, fontSize: 10 }}>
                        {currentProfile.enabled ? 'READY' : 'DISABLED'}
                    </span>
                </div>
            </div>

            {/* Shortcuts Helper */}
            <div className="av-card av-shortcuts">
                <div className="av-shortcuts__title">Keyboard Shortcuts</div>
                <div className="av-shortcuts__item">
                    <span className="av-shortcuts__desc">Toggle Side Panel</span>
                    <span className="av-shortcuts__key">Alt+Q / Option+Q</span>
                </div>
                <div className="av-shortcuts__item">
                    <span className="av-shortcuts__desc">AI / Keyword Form Fill</span>
                    <span className="av-shortcuts__key">Alt+Shift+L / Option+Shift+L</span>
                </div>
                <div className="av-shortcuts__item">
                    <span className="av-shortcuts__desc">Multi-Link Batch Fill</span>
                    <span className="av-shortcuts__key">Alt+Shift+B / Option+Shift+B</span>
                </div>
            </div>
        </>
    );
}
