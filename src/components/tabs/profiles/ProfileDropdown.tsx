import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Sliders, Check, Plus } from 'lucide-react';
import type { UserData } from '../../../types';
import { PROFILE_OPTIONS } from '../../../config/profileOptions';
import { useT } from '../../../i18n';
import { usePlanRewards } from '../../../hooks/useRewards';
import { pausedProfileKeys } from '../../../services/tier';

interface ProfileDropdownProps {
    profiles: Record<string, UserData>;
    selectedProfileType: string;
    onSelectProfile: (key: string) => void;
    currentProfile: UserData;
    newProfileName: string;
    onChangeNewProfileName: (name: string) => void;
    onCreateProfile: () => void;
}

export function ProfileDropdown({
    profiles,
    selectedProfileType,
    onSelectProfile,
    currentProfile,
    newProfileName,
    onChangeNewProfileName,
    onCreateProfile
}: ProfileDropdownProps) {
    const { t } = useT();
    const plan = usePlanRewards();
    const paused = pausedProfileKeys(profiles, plan.access.profileLimit);
    const [isOpen, setIsOpen] = useState<boolean>(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const currentOpt = PROFILE_OPTIONS.find((o) => o.type === selectedProfileType);
    const Icon = currentOpt?.icon || Sliders;
    const label = currentOpt?.label() || currentProfile.profileName || selectedProfileType;

    return (
        <div className="av-profile-dropdown" ref={dropdownRef} data-tour="profile-switcher">
            <button
                type="button"
                className={`av-profile-dropdown__trigger ${isOpen ? 'av-profile-dropdown__trigger--open' : ''}`}
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="av-profile-dropdown__current">
                    <Icon size={13} className="av-profile-dropdown__icon" />
                    <span className="av-profile-dropdown__label">{label}</span>
                    {!currentProfile.enabled && (
                        <span className="av-badge av-badge--off">{t('profiles.badges.disabled')}</span>
                    )}
                </div>
                <ChevronDown
                    size={13}
                    className={`av-profile-dropdown__chevron ${isOpen ? 'av-profile-dropdown__chevron--rotated' : ''}`}
                />
            </button>

            {isOpen && (
                <div className="av-profile-dropdown__menu">
                    {/* Loop through all profiles */}
                    {/* Free plan: profiles ON beyond the limit are paused (kept, back with an ad or Pro) */}
                    {Object.keys(profiles).map((key) => {
                        const targetProf = profiles[key];
                        if (!targetProf) return null;

                        const isSelected = selectedProfileType === key;
                        const builtInOpt = PROFILE_OPTIONS.find((o) => o.type === key);
                        const ItemIcon = builtInOpt?.icon || Sliders;
                        const displayLabel = builtInOpt?.label() || targetProf.profileName || key;

                        return (
                            <button
                                key={key}
                                type="button"
                                className={`av-profile-dropdown__item ${isSelected ? 'av-profile-dropdown__item--selected' : ''}`}
                                onClick={() => {
                                    onSelectProfile(key);
                                    setIsOpen(false);
                                }}
                            >
                                <div className="av-profile-dropdown__item-left">
                                    <ItemIcon size={12} />
                                    <span>{displayLabel}</span>
                                </div>
                                <div className="av-profile-dropdown__item-right">
                                    <span className={`av-badge ${targetProf.enabled && !paused.includes(key) ? 'av-badge--on' : 'av-badge--off'}`}>
                                        {paused.includes(key) ? t('rewards.paused') : targetProf.enabled ? t('profiles.badges.on') : t('profiles.badges.off')}
                                    </span>
                                    {isSelected && <Check size={11} className="av-profile-dropdown__check" />}
                                </div>
                            </button>
                        );
                    })}

                    {/* New profile creator */}
                    <div style={{ padding: '8px', borderTop: '1px solid var(--av-border)', display: 'flex', gap: '6px' }}>
                        <input
                            className="av-input"
                            placeholder={t('profiles.dropdown.newProfilePlaceholder')}
                            value={newProfileName}
                            onChange={(e) => onChangeNewProfileName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    onCreateProfile();
                                }
                            }}
                        />
                        <button
                            type="button"
                            className="av-pill av-pill--active"
                            style={{ padding: '0 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                            onClick={onCreateProfile}
                        >
                            <Plus size={12} />
                            <span>{t('profiles.dropdown.add')}</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
