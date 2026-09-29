import { useState } from 'react';
import type { UserData, CM, JobUserData, MedicalUserData } from '../types';
import { countActiveProfiles, FREE_MAX_ACTIVE_PROFILES } from '../services/tier';

const ACTIVE_LIMIT_MESSAGE = `Free plan allows ${FREE_MAX_ACTIVE_PROFILES} active profiles. Turn one OFF or upgrade to Pro.`;

interface UseProfileManagerProps {
    profiles: Record<string, UserData>;
    setProfiles: React.Dispatch<React.SetStateAction<Record<string, UserData>>>;
    selectedProfileType: string;
    setSelectedProfileType: (key: string) => void;
    currentProfile: UserData | undefined;
    isPro: boolean;
    onNotify?: (text: string, type: 'info' | 'success' | 'error', duration?: number) => void;
}

export function useProfileManager({
    profiles,
    setProfiles,
    selectedProfileType,
    setSelectedProfileType,
    currentProfile,
    isPro,
    onNotify
}: UseProfileManagerProps) {
    // Input state for new profiles and fields
    const [newProfileName, setNewProfileName] = useState<string>('');
    const [newFieldLabel, setNewFieldLabel] = useState<string>('');
    const [newFieldValue, setNewFieldValue] = useState<string>('');

    // -------------------------------------------------------------------
    // 1. Dynamic Profile Creation (Preserving your exact CustomProfileData)
    // -------------------------------------------------------------------
    const handleCreateProfile = () => {
        const name = newProfileName.trim();
        if (!name) return;
        if (profiles[name]) {
            alert('A profile with this name already exists!');
            return;
        }

        // Free plan: new profiles start OFF once the active-profile limit is reached
        const canActivate = isPro || countActiveProfiles(profiles) < FREE_MAX_ACTIVE_PROFILES;
        if (!canActivate) {
            onNotify?.(`Profile created as OFF. ${ACTIVE_LIMIT_MESSAGE}`, 'info', 5000);
        }

        const newProfile: any = {
            id: `prof_${Date.now()}`,
            profileType: name,
            profileName: name,
            enabled: canActivate,
            firstName: { id: `${name}_fn`, label: 'First Name', value: '', enabled: true, context: 'First name' },
            lastName: { id: `${name}_ln`, label: 'Last Name', value: '', enabled: true, context: 'Last name' },
            email: { id: `${name}_em`, label: 'Email Address', value: '', enabled: true, context: 'Email' },
            phone: { id: `${name}_ph`, label: 'Phone Number', value: '', enabled: true, context: 'Phone' },
            address: { id: `${name}_addr`, label: 'Residential Address', value: '', enabled: true, context: 'Address' },
            customFields: []
        };

        setProfiles(prev => ({
            ...prev,
            [name]: newProfile
        }));
        setSelectedProfileType(name);
        setNewProfileName('');
    };

    // -------------------------------------------------------------------
    // 2. Profile Level Updates
    // -------------------------------------------------------------------
    const updateCurrentProfile = (patch: Partial<UserData>) => {
        // Free plan: block turning ON a profile beyond the active-profile limit
        if (patch.enabled === true && !isPro && countActiveProfiles(profiles, selectedProfileType) >= FREE_MAX_ACTIVE_PROFILES) {
            onNotify?.(ACTIVE_LIMIT_MESSAGE, 'error', 5000);
            return;
        }
        setProfiles(prev => ({
            ...prev,
            [selectedProfileType]: {
                ...prev[selectedProfileType],
                ...patch
            } as UserData
        }));
    };

    // -------------------------------------------------------------------
    // 3. Core Field Updaters
    // -------------------------------------------------------------------
    const updateField = (fieldKey: string, updates: Partial<CM>) => {
        setProfiles(prev => {
            const prof = prev[selectedProfileType] as any;
            if (!prof || !prof[fieldKey]) return prev;
            return {
                ...prev,
                [selectedProfileType]: {
                    ...prof,
                    [fieldKey]: {
                        ...prof[fieldKey],
                        ...updates
                    }
                }
            };
        });
    };

    const toggleField = (fieldKey: string) => {
        const prof = currentProfile as any;
        if (prof && prof[fieldKey]) {
            updateField(fieldKey, { enabled: !prof[fieldKey].enabled });
        }
    };

    // -------------------------------------------------------------------
    // 4. Domain Specific Array Helpers (Job skills & Medical allergies)
    // -------------------------------------------------------------------
    const updateJobSkills = (updates: Partial<CM>) => {
        setProfiles(prev => {
            const job = prev.job as JobUserData;
            const current = job.skills?.[0] || { id: 'job_sk1', label: 'Skills', value: '', enabled: true, isSensitive: false, context: 'Skills' };
            return {
                ...prev,
                job: {
                    ...job,
                    skills: [{ ...current, ...updates }]
                }
            };
        });
    };

    const updateMedicalAllergies = (updates: Partial<CM>) => {
        setProfiles(prev => {
            const med = prev.medical as MedicalUserData;
            const current = med.allergies?.[0] || { id: 'med_alg', label: 'Allergies', value: '', enabled: true, isSensitive: false, context: 'Allergies' };
            return {
                ...prev,
                medical: {
                    ...med,
                    allergies: [{ ...current, ...updates }]
                }
            };
        });
    };

    // -------------------------------------------------------------------
    // 5. Ad-Hoc Custom Fields CRUD
    // -------------------------------------------------------------------
    const handleAddCustomField = () => {
        if (!newFieldLabel.trim()) return;
        const newField: CM = {
            id: `cf_${Date.now()}`,
            label: newFieldLabel.trim(),
            value: newFieldValue.trim(),
            enabled: true,
            isSensitive: false, // Default new custom fields to AI-safe
            context: `Custom field for ${newFieldLabel.trim()}`
        };
        setProfiles(prev => ({
            ...prev,
            [selectedProfileType]: {
                ...prev[selectedProfileType],
                customFields: [...(prev[selectedProfileType].customFields || []), newField]
            }
        }));
        setNewFieldLabel('');
        setNewFieldValue('');
    };

    const handleToggleCustomField = (id: string) => {
        setProfiles(prev => ({
            ...prev,
            [selectedProfileType]: {
                ...prev[selectedProfileType],
                customFields: (prev[selectedProfileType].customFields || []).map(f =>
                    f.id === id ? { ...f, enabled: !f.enabled } : f
                )
            }
        }));
    };

    const handleUpdateCustomField = (id: string, updates: Partial<CM>) => {
        setProfiles(prev => ({
            ...prev,
            [selectedProfileType]: {
                ...prev[selectedProfileType],
                customFields: (prev[selectedProfileType].customFields || []).map(f =>
                    f.id === id ? { ...f, ...updates } : f
                )
            }
        }));
    };

    const handleRemoveCustomField = (id: string) => {
        setProfiles(prev => ({
            ...prev,
            [selectedProfileType]: {
                ...prev[selectedProfileType],
                customFields: (prev[selectedProfileType].customFields || []).filter(f => f.id !== id)
            }
        }));
    };

    // -------------------------------------------------------------------
    // 6. JSON Import Engine
    // -------------------------------------------------------------------
    const handleImportJson = (importedFields: CM[]) => {
        if (!isPro) {
            onNotify?.('JSON import is a Pro feature.', 'error', 4000);
            return;
        }
        setProfiles(prev => {
            const current = { ...prev[selectedProfileType] } as any;
            if (!current) return prev;

            const remainingCustomFields: CM[] = [];
            const RESERVED = new Set(["id", "label", "value", "enabled", "context", "content"]);

            importedFields.forEach(imported => {
                const cleanLabel = (imported.label || '').toLowerCase().trim();

                // Skip schema keywords
                if (!cleanLabel || RESERVED.has(cleanLabel)) return;

                let matched = false;

                // 1. Check direct profile fields
                for (const key of Object.keys(current)) {
                    const prop = current[key];
                    if (prop && typeof prop === 'object' && 'label' in prop && 'value' in prop) {
                        const propLabel = (prop.label || '').toLowerCase().trim();
                        if (propLabel === cleanLabel || (imported.id && prop.id === imported.id) || key.toLowerCase() === cleanLabel) {
                            current[key] = {
                                ...prop,
                                value: imported.value,
                                enabled: imported.enabled ?? prop.enabled,
                                context: imported.context || prop.context
                            };
                            matched = true;
                            break;
                        }
                    }
                }

                // 2. Check skills in Job profile
                if (!matched && current.profileType === 'job' && (cleanLabel.includes('skill') || (imported.id && imported.id.includes('sk')))) {
                    const existingSkill = current.skills?.[0] || { id: 'job_sk1', label: 'Skills', enabled: true, isSensitive: false, context: 'Core technical skills' };
                    current.skills = [{
                        ...existingSkill,
                        value: imported.value,
                        enabled: imported.enabled ?? existingSkill.enabled
                    }];
                    matched = true;
                }

                // 3. True extra questions go to customFields
                if (!matched) {
                    remainingCustomFields.push({
                        ...imported,
                        isSensitive: imported.isSensitive ?? false,
                        group: imported.group || 'Custom Fields'
                    });
                }
            });

            current.customFields = remainingCustomFields;

            return {
                ...prev,
                [selectedProfileType]: current
            };
        });

        onNotify?.(
            `Successfully imported ${importedFields.length} fields into ${selectedProfileType.toUpperCase()}!`,
            'success',
            4000
        );
    };

    return {
        newProfileName,
        setNewProfileName,
        newFieldLabel,
        setNewFieldLabel,
        newFieldValue,
        setNewFieldValue,
        handleCreateProfile,
        handleImportJson,
        updateCurrentProfile,
        updateField,
        toggleField,
        updateJobSkills,
        updateMedicalAllergies,
        handleAddCustomField,
        handleToggleCustomField,
        handleUpdateCustomField,
        handleRemoveCustomField
    };
}
