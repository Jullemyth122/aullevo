import { Save } from 'lucide-react';
import type { UserData, CM } from '../../types';
import { ProfileDropdown } from './profiles/ProfileDropdown';
import { ProfileConfigCard } from './profiles/ProfileConfigCard';
import { IdentityCard } from './profiles/IdentityCard';
import { DomainAttributesCard } from './profiles/DomainAttributesCard';
import { CustomFieldsCard } from './profiles/CustomFieldCard';
import { useState } from 'react';
import { FilesCard } from './profiles/FilesCard';
import { useT } from '../../i18n';
import { usePlanRewards } from '../../hooks/useRewards';
import { PlanUnlock } from '../UnlockCard';
import { countActiveProfiles, pausedProfileKeys, FREE_MAX_ACTIVE_PROFILES, UNLOCKED_MAX_ACTIVE_PROFILES } from '../../services/tier';

interface ProfilesTabProps {
    profiles: Record<string, UserData>;
    selectedProfileType: string;
    onSelectProfile: (key: string) => void;
    currentProfile: UserData;
    newProfileName: string;
    onChangeNewProfileName: (name: string) => void;
    onCreateProfile: () => void;
    onUpdateProfile: (patch: Partial<UserData>) => void;
    onUpdateField: (fieldKey: string, updates: Partial<CM>) => void;
    onToggleField: (fieldKey: string) => void;
    onUpdateJobSkills: (updates: Partial<CM>) => void;
    onUpdateMedicalAllergies: (updates: Partial<CM>) => void;
    newFieldLabel: string;
    onChangeNewFieldLabel: (label: string) => void;
    newFieldValue: string;
    onChangeNewFieldValue: (val: string) => void;
    onAddCustomField: () => void;
    onToggleCustomField: (id: string) => void;
    onUpdateCustomField: (id: string, updates: Partial<CM>) => void;
    onRemoveCustomField: (id: string) => void;
    onSaveProfile: () => void;
}

export function ProfilesTab({
    profiles,
    selectedProfileType,
    onSelectProfile,
    currentProfile,
    newProfileName,
    onChangeNewProfileName,
    onCreateProfile,
    onUpdateProfile,
    onUpdateField,
    onToggleField,
    onUpdateJobSkills,
    onUpdateMedicalAllergies,
    newFieldLabel,
    onChangeNewFieldLabel,
    newFieldValue,
    onChangeNewFieldValue,
    onAddCustomField,
    onToggleCustomField,
    onUpdateCustomField,
    onRemoveCustomField,
    onSaveProfile
}: ProfilesTabProps) {
    const { t } = useT();
    const plan = usePlanRewards();
    const [isSaved, setIsSaved] = useState(false);

    const handleSaveClick = () => {
        onSaveProfile();
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 2000);
    };

    return (
        <>
            <ProfileDropdown
                profiles={profiles}
                selectedProfileType={selectedProfileType}
                onSelectProfile={onSelectProfile}
                currentProfile={currentProfile}
                newProfileName={newProfileName}
                onChangeNewProfileName={onChangeNewProfileName}
                onCreateProfile={onCreateProfile}
            />

            {/* Free plan: a 4th active profile needs a pass (2 short ads); profiles ON beyond the limit are paused, not deleted */}
            {!plan.isPro && (countActiveProfiles(profiles) >= FREE_MAX_ACTIVE_PROFILES || plan.access.profiles) && (
                <PlanUnlock feature="profiles" reason={pausedProfileKeys(profiles, plan.access.profileLimit).length > 0
                    ? t('rewards.status.profilesPausedSome', { count: pausedProfileKeys(profiles, plan.access.profileLimit).length, max: plan.access.profileLimit })
                    : t('rewards.status.profilesLocked', { max: FREE_MAX_ACTIVE_PROFILES, unlocked: UNLOCKED_MAX_ACTIVE_PROFILES })} />
            )}

            <ProfileConfigCard
                currentProfile={currentProfile}
                selectedProfileType={selectedProfileType}
                onUpdateProfile={onUpdateProfile}
            />

            <IdentityCard
                currentProfile={currentProfile}
                onUpdateField={onUpdateField}
                onToggleField={onToggleField}
            />

            <FilesCard currentProfile={currentProfile} onUpdateProfile={onUpdateProfile} />

            <DomainAttributesCard
                currentProfile={currentProfile}
                selectedProfileType={selectedProfileType}
                onUpdateField={onUpdateField}
                onToggleField={onToggleField}
                onUpdateJobSkills={onUpdateJobSkills}
                onUpdateMedicalAllergies={onUpdateMedicalAllergies}
            />

            <CustomFieldsCard
                currentProfile={currentProfile}
                newFieldLabel={newFieldLabel}
                onChangeNewFieldLabel={onChangeNewFieldLabel}
                newFieldValue={newFieldValue}
                onChangeNewFieldValue={onChangeNewFieldValue}
                onAddCustomField={onAddCustomField}
                onToggleCustomField={onToggleCustomField}
                onUpdateCustomField={onUpdateCustomField}
                onRemoveCustomField={onRemoveCustomField}
            />

            {/* Save Profile Button */}
            <button
                className={`av-save-btn ${isSaved ? 'av-save-btn--saved' : ''}`}
                onClick={handleSaveClick}
                data-tour="save-profile"
            >
                <Save size={14} />
                <span>{isSaved ? t('profiles.save.saved') : t('profiles.save.button', { type: selectedProfileType.toUpperCase() })}</span>
            </button>
        </>
    );
}
