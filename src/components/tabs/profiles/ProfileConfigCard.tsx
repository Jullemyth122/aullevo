import { Check, X } from 'lucide-react';
import type { UserData } from '../../../types';
import { useT } from '../../../i18n';

interface ProfileConfigCardProps {
    currentProfile: UserData;
    selectedProfileType: string;
    onUpdateProfile: (patch: Partial<UserData>) => void;
}

export function ProfileConfigCard({
    currentProfile,
    selectedProfileType,
    onUpdateProfile
}: ProfileConfigCardProps) {
    const { t } = useT();
    return (
        <div className="av-card" data-tour="profile-config">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="av-label">{t('profiles.config.title')}</label>
                <button
                    type="button"
                    className={`av-switch-pill ${currentProfile.enabled ? 'av-switch-pill--on' : 'av-switch-pill--off'}`}
                    onClick={() => onUpdateProfile({ enabled: !currentProfile.enabled })}
                    title={currentProfile.enabled
                        ? t('profiles.config.activeTooltip', { type: selectedProfileType.toUpperCase() })
                        : t('profiles.config.disabledTooltip', { type: selectedProfileType.toUpperCase() })}
                >
                    {currentProfile.enabled ? <Check size={9} /> : <X size={9} />}
                    <span>{currentProfile.enabled ? t('profiles.config.on') : t('profiles.config.off')}</span>
                </button>
            </div>

            <div className="av-field" style={{ marginTop: 4 }}>
                <input
                    className="av-input"
                    value={currentProfile.profileName}
                    onChange={(e) => onUpdateProfile({ profileName: e.target.value })}
                    placeholder={t('profiles.config.namePlaceholder')}
                />
            </div>
        </div>
    );
}
