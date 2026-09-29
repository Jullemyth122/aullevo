import { Save } from 'lucide-react';
import type { UserData, CM } from '../../types';
import { ProfileDropdown } from './profiles/ProfileDropdown';
import { ProfileConfigCard } from './profiles/ProfileConfigCard';
import { IdentityCard } from './profiles/IdentityCard';
import { DomainAttributesCard } from './profiles/DomainAttributesCard';
import { CustomFieldsCard } from './profiles/CustomFieldCard';
import { useState } from 'react';
import { FilesCard } from './profiles/FilesCard';

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

            <ProfileConfigCard
                currentProfile={currentProfile}
                selectedProfileType={selectedProfileType}
                onUpdateProfile={onUpdateProfile}
            />

            <IdentityCard
                currentProfile={currentProfile}
                onUpdateField={onUpdateField}
                onToggleField={onToggleField}
                onUpdateCustomField={onUpdateCustomField}
                onToggleCustomField={onToggleCustomField}
            />

            <FilesCard currentProfile={currentProfile} onUpdateProfile={onUpdateProfile} />

            <DomainAttributesCard
                currentProfile={currentProfile}
                selectedProfileType={selectedProfileType}
                onUpdateField={onUpdateField}
                onToggleField={onToggleField}
                onUpdateJobSkills={onUpdateJobSkills}
                onUpdateMedicalAllergies={onUpdateMedicalAllergies}
                onUpdateCustomField={onUpdateCustomField}
                onToggleCustomField={onToggleCustomField}
            />

            <CustomFieldsCard
                currentProfile={currentProfile}
                selectedProfileType={selectedProfileType}
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
            >
                <Save size={14} />
                <span>{isSaved ? 'Saved ✓' : `Save ${selectedProfileType.toUpperCase()} Profile`}</span>
            </button>
        </>
    );
}
