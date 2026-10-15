import { useState } from 'react';
import type { UserData, CM, JobUserData, MedicalUserData } from '../types';
import { activeProfileLimit, countActiveProfiles, FREE_MAX_ACTIVE_PROFILES, UNLOCKED_MAX_ACTIVE_PROFILES } from '../services/tier';
import { t } from '../i18n';
import { getProfileCustomFields } from '../types';
import type { RewardFeature } from '../services/rewards';
import { FREE_JSON_IMPORTS_PER_DAY, getJsonImportsUsed, recordJsonImport } from '../services/importQuota';

interface UseProfileManagerProps {
    profiles: Record<string, UserData>;
    setProfiles: React.Dispatch<React.SetStateAction<Record<string, UserData>>>;
    selectedProfileType: string;
    setSelectedProfileType: (key: string) => void;
    currentProfile: UserData | undefined;
    isPro: boolean;
    profilesUnlocked?: boolean; // Free plan: more than 3 active profiles (2-hour ad unlock)
    jsonUnlocked?: boolean;     // Free plan: JSON imports from an ad unlock are left
    consumeReward?: (feature: RewardFeature) => Promise<{ ok: boolean; error?: string }>;
    onNotify?: (text: string, type: 'info' | 'success' | 'error', duration?: number) => void;
}

export function useProfileManager({
    profiles,
    setProfiles,
    selectedProfileType,
    setSelectedProfileType,
    currentProfile,
    isPro,
    profilesUnlocked = false,
    jsonUnlocked = false,
    consumeReward,
    onNotify
}: UseProfileManagerProps) {
    // Input state for new profiles and fields
    const [newProfileName, setNewProfileName] = useState<string>('');
    const [newFieldLabel, setNewFieldLabel] = useState<string>('');
    const [newFieldValue, setNewFieldValue] = useState<string>('');

    // The active-profile limit was reached: Free (3) offers the ad, the ad unlock (6) only Pro
    const profileLimitText = () => profilesUnlocked
        ? t('rewards.status.profilesMax', { max: UNLOCKED_MAX_ACTIVE_PROFILES })
        : t('rewards.status.profilesLocked', { max: FREE_MAX_ACTIVE_PROFILES, unlocked: UNLOCKED_MAX_ACTIVE_PROFILES });

    // -------------------------------------------------------------------
    // 1. Dynamic Profile Creation (Preserving your exact CustomProfileData)
    // -------------------------------------------------------------------
    const handleCreateProfile = () => {
        const name = newProfileName.trim();
        if (!name) return;
        if (profiles[name]) {
            alert(t('status.profile.nameExists'));
            return;
        }
        createProfileNamed(name);
        setNewProfileName('');
    };

    // Also used by the voice agent ("create a profile called Work"): a name that already exists switches to that profile
    const createProfileNamed = (rawName: string): { key: string; created: boolean; enabled: boolean } | null => {
        const name = rawName.trim();
        if (!name) return null;
        const existing = Object.values(profiles).find(p =>
            p.profileType.toLowerCase() === name.toLowerCase() || (p.profileName || '').toLowerCase() === name.toLowerCase());
        if (existing) {
            setSelectedProfileType(existing.profileType);
            return { key: existing.profileType, created: false, enabled: existing.enabled };
        }

        // Free plan: new profiles start OFF once the active-profile limit is reached (3, or 6 while the ad unlock runs)
        const canActivate = countActiveProfiles(profiles) < activeProfileLimit(isPro, profilesUnlocked);
        if (!canActivate) onNotify?.(profileLimitText(), 'info', 6000);

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
        return { key: name, created: true, enabled: canActivate };
    };

    // -------------------------------------------------------------------
    // 2. Profile Level Updates
    // -------------------------------------------------------------------
    const updateCurrentProfile = (patch: Partial<UserData>) => {
        // Free plan: block turning ON a profile beyond the active-profile limit
        if (patch.enabled === true && countActiveProfiles(profiles, selectedProfileType) >= activeProfileLimit(isPro, profilesUnlocked)) {
            onNotify?.(profileLimitText(), 'error', 6000);
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

    // Voice agent: "set my phone to 0917...", "add a field called Nickname with value Xen".
    // Updates the current profile's field with that label (any group, custom fields too), or adds a custom field.
    const setFieldByLabel = (label: string, value: string): { status: 'updated' | 'added'; label: string } => {
        const normalize = (text: string) => text.toLowerCase().replace(/e[\s-]?mail/g, 'email').replace(/[^a-z0-9]+/g, ' ').trim();
        const wanted = normalize(label);
        const wantedWords = wanted.split(' ').filter(Boolean);
        const score = (field: CM) => {
            const have = normalize(field.label);
            if (have === wanted) return 2;
            const haveWords = have.split(' ');
            // "phone" names "Phone Number"; the shortest label containing every word wins
            return wantedWords.length && wantedWords.every(w => haveWords.includes(w)) ? 1 + 1 / haveWords.length : 0;
        };
        const best = currentProfile
            ? getProfileCustomFields(currentProfile).map(field => ({ field, score: score(field) })).filter(m => m.score > 0).sort((a, b) => b.score - a.score)[0]
            : undefined;

        if (best) {
            const id = best.field.id;
            const update = (cm: any) => (cm && typeof cm === 'object' && cm.id === id ? { ...cm, value, enabled: true } : cm);
            setProfiles(prev => {
                const prof: any = prev[selectedProfileType];
                if (!prof) return prev;
                const next: any = {};
                for (const [key, val] of Object.entries(prof)) next[key] = Array.isArray(val) ? val.map(update) : update(val);
                return { ...prev, [selectedProfileType]: next as UserData };
            });
            return { status: 'updated', label: best.field.label };
        }

        const cleanLabel = label.trim().charAt(0).toUpperCase() + label.trim().slice(1);
        const newField: CM = {
            id: `cf_${Date.now()}`,
            label: cleanLabel,
            value,
            enabled: true,
            isSensitive: false,
            context: `Custom field for ${cleanLabel}`
        };
        setProfiles(prev => ({
            ...prev,
            [selectedProfileType]: {
                ...prev[selectedProfileType],
                customFields: [...(prev[selectedProfileType].customFields || []), newField]
            }
        }));
        return { status: 'added', label: cleanLabel };
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
    const handleImportJson = async (importedFields: CM[]) => {
        // Free plan: FREE_JSON_IMPORTS_PER_DAY imports a day (reset at local midnight); after those, each import
        // uses one of the 10 a short ad unlocks (5 hours). Pro: unlimited.
        if (!isPro && (await getJsonImportsUsed()) >= FREE_JSON_IMPORTS_PER_DAY) {
            if (!jsonUnlocked || !consumeReward) {
                onNotify?.(t('rewards.status.jsonLocked'), 'error', 7000);
                return;
            }
            const used = await consumeReward('json');
            if (!used.ok) {
                onNotify?.(t('rewards.status.jsonFailed', { error: used.error ?? '' }), 'error', 7000);
                return;
            }
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

        if (!isPro) await recordJsonImport();

        onNotify?.(
            t('status.profile.imported', { count: importedFields.length, type: selectedProfileType.toUpperCase() }),
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
        createProfileNamed,
        setFieldByLabel,
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
