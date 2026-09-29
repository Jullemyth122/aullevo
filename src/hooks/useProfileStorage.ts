import { useState, useEffect, useRef } from 'react';
import type { UserData } from '../types';
import { createDefaultProfiles, getProfileCustomFields } from '../types';
import { readVault, writeVault, isExternalVaultChange, VAULT_STORAGE_KEY, type VaultData } from '../services/vault';

// Keys saved profiles by profileType and fills in fields added in newer versions
function migrateLoadedProfiles(savedProfiles: any[]): Record<string, UserData> {
    const defaults = createDefaultProfiles();
    const loaded: Record<string, UserData> = {};

    for (const p of savedProfiles) {
        const def = (defaults as any)[p.profileType];

        // 1. Migrate standard fields: assign default sensitivity if undefined
        Object.entries(p).forEach(([key, val]) => {
            if (val && typeof val === 'object' && 'label' in val) {
                const cm = val as any;
                if (cm.isSensitive === undefined) {
                    cm.isSensitive = def?.[key]?.isSensitive ?? false;
                }
            }
        });

        // 2. Migrate custom fields: default to false (AI-Safe) if undefined
        if (Array.isArray(p.customFields)) {
            p.customFields.forEach((cf: any) => {
                if (cf && cf.isSensitive === undefined) {
                    cf.isSensitive = false;
                }
            });
        }

        loaded[p.profileType] = p;
    }
    return loaded;
}

export function useProfileStorage() {
    // 1. Core Profile & Theme State
    const [profiles, setProfiles] = useState<Record<string, UserData>>(() => createDefaultProfiles());
    const [selectedProfileType, setSelectedProfileType] = useState<string>('job');
    const [isDark, setIsDark] = useState<boolean>(true);
    const [useAiFill, setUseAiFill] = useState<boolean>(false);

    // 2. Critical Safety Latch: never overwrite storage before mount load finishes
    const isInitialLoaded = useRef<boolean>(false);

    // 3. Stable timer ref: avoids timer recreation churn on keystrokes
    const saveTimerRef = useRef<number | null>(null);

    // 4. Set when profiles were just reloaded from another page's save, so we don't echo it back
    const skipNextSaveRef = useRef<boolean>(false);

    // Active profile helper
    const currentProfile = profiles[selectedProfileType];

    // Encrypts and saves all profiles + the active profile's fields (read by background.ts for shortcuts)
    const persistProfiles = (): Promise<void> => writeVault({
        userProfiles: {
            activeProfileId: currentProfile.id,
            profiles: Object.values(profiles)
        },
        activeProfile: currentProfile,
        fields: getProfileCustomFields(currentProfile)
    });

    // ---------------------------------------------------------
    // Mount: Load settings + decrypt profiles from the vault
    // ---------------------------------------------------------
    useEffect(() => {
        // Settings are plaintext; profiles come from the encrypted vault (unlocked by VaultGate)
        Promise.all([
            chrome.storage.local.get(['aullevo_theme', 'aullevo_use_ai']),
            readVault()
        ]).then(([settings, vaultData]: [any, VaultData | null]) => {
            const result: any = { ...settings, userProfiles: vaultData?.userProfiles };

            if (result.aullevo_theme) {
                setIsDark(result.aullevo_theme === 'dark');
            }
            if (result.aullevo_use_ai !== undefined) {
                setUseAiFill(Boolean(result.aullevo_use_ai));
            }
            if (result.userProfiles?.profiles && result.userProfiles.profiles.length > 0) {
                console.log(`[Aullevo:Storage] Restoring ${result.userProfiles.profiles.length} saved profiles from vault.`);
                const loaded = migrateLoadedProfiles(result.userProfiles.profiles);

                setProfiles(prev => ({ ...prev, ...loaded }));

                // 3. Restore the last selected profile (profiles are keyed by profileType)
                const savedActiveId = result.userProfiles.activeProfileId;
                const activeEntry = Object.values(loaded).find(p => p.id === savedActiveId);
                if (activeEntry) {
                    setSelectedProfileType(activeEntry.profileType);
                }
            } else {
                console.log("[Aullevo:Storage] No saved profiles found, using default profiles.");
            }

            isInitialLoaded.current = true;
        });
    }, []);

    // ---------------------------------------------------------
    // Live sync: side panel and full options page edit the same vault.
    // When the OTHER page saves, reload its profiles instead of overwriting them.
    // ---------------------------------------------------------
    useEffect(() => {
        const handleVaultChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
            if (area !== 'local' || !isExternalVaultChange(changes[VAULT_STORAGE_KEY])) return;
            readVault().then((vaultData) => {
                const saved = vaultData?.userProfiles?.profiles;
                if (!saved?.length) return;
                skipNextSaveRef.current = true;
                setProfiles(prev => ({ ...prev, ...migrateLoadedProfiles(saved) }));
            });
        };
        chrome.storage?.onChanged?.addListener(handleVaultChange);
        return () => chrome.storage?.onChanged?.removeListener(handleVaultChange);
    }, []);

    // ---------------------------------------------------------
    // Debounced Auto-Save (800ms) with Ref Timer
    // ---------------------------------------------------------
    useEffect(() => {
        if (!isInitialLoaded.current) return;
        if (skipNextSaveRef.current) {
            skipNextSaveRef.current = false;
            return;
        }

        // Clear previous timer without re-binding everything
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
        }

        saveTimerRef.current = window.setTimeout(() => {
            if (!currentProfile) return;
            persistProfiles()
                .catch((err) => console.error("[Aullevo:Storage] Auto-save error:", err));
        }, 800);

        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
    }, [profiles, selectedProfileType]);

    // ---------------------------------------------------------
    // Manual Save Button Handler (Fallback)
    // ---------------------------------------------------------
    const handleSaveProfile = (onSuccess?: () => void, onError?: (err: string) => void) => {
        if (!currentProfile) {
            if (typeof onError === 'function') onError("No profile selected");
            return;
        }
        persistProfiles()
            .then(() => {
                // Safely check that onSuccess is actually a function (not a click MouseEvent)
                if (typeof onSuccess === 'function') onSuccess();
            })
            .catch((err) => {
                if (typeof onError === 'function') onError(err instanceof Error ? err.message : "Save failed");
            });
    };

    // ---------------------------------------------------------
    // Theme & Mode Toggles
    // ---------------------------------------------------------
    const toggleTheme = () => {
        const next = !isDark;
        setIsDark(next);
        chrome.storage?.local?.set({ aullevo_theme: next ? 'dark' : 'light' });
    };

    const toggleAiFill = () => {
        setUseAiFill(prev => {
            const next = !prev;
            chrome.storage?.local?.set({ aullevo_use_ai: next });
            return next;
        });
    };

    return {
        profiles,
        setProfiles,
        selectedProfileType,
        setSelectedProfileType,
        currentProfile,
        isDark,
        toggleTheme,
        useAiFill,
        toggleAiFill,
        handleSaveProfile
    };
}
