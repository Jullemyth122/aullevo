/**
 * Structured profile vault repository for user profile data and multi-profile vaults.
 * Accounts are strictly isolated by account namespace (authenticated user vs guest).
 */

import type { UserData } from '../types';

const LEGACY_PROFILES_KEY = 'aullevo_profiles';
const LEGACY_ACTIVE_KEY = 'aullevo_active_profile';
const LEGACY_CRYPTO_KEY_RAW = 'aullevo_ck';

// Account namespace resolution
export async function getAccountKey(explicitKey?: string | null): Promise<string> {
    if (explicitKey !== undefined) {
        if (!explicitKey || explicitKey === 'guest') return 'guest';
        const sanitized = explicitKey.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        return `user_${sanitized}`;
    }

    return new Promise((resolve) => {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) {
            return resolve('guest');
        }
        chrome.storage.local.get(['userUid', 'userEmail'], (result) => {
            const uid = (result?.userUid as string) || (result?.userEmail as string);
            if (uid && typeof uid === 'string' && uid.trim().length > 0) {
                const sanitized = uid.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
                resolve(`user_${sanitized}`);
            } else {
                resolve('guest');
            }
        });
    });
}

async function getStorageKeys(explicitKey?: string | null) {
    const accountKey = await getAccountKey(explicitKey);
    return {
        accountKey,
        profilesKey: `aullevo_profiles_${accountKey}`,
        activeKey: `aullevo_active_profile_${accountKey}`,
        legacyCryptoKey: `aullevo_ck_${accountKey}`,
    };
}

// Legacy decryption helper for transparent migration from older versions
function base64ToBuffer(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function tryDecryptLegacy(ciphertext: string, rawKeyBase64?: string): Promise<Record<string, UserData> | null> {
    if (!rawKeyBase64 || !ciphertext.includes('.')) return null;
    try {
        const raw = base64ToBuffer(rawKeyBase64);
        const key = await crypto.subtle.importKey(
            'raw',
            raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
            { name: 'AES-GCM' },
            false,
            ['decrypt']
        );
        const [ivB64, dataB64] = ciphertext.split('.');
        const ivArr = base64ToBuffer(ivB64);
        const dataArr = base64ToBuffer(dataB64);
        const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: ivArr.buffer.slice(ivArr.byteOffset, ivArr.byteOffset + ivArr.byteLength) as ArrayBuffer },
            key,
            dataArr.buffer.slice(dataArr.byteOffset, dataArr.byteOffset + dataArr.byteLength) as ArrayBuffer
        );
        return JSON.parse(new TextDecoder().decode(plain));
    } catch {
        return null;
    }
}

// Vault read and write operations
async function readVault(profilesKey: string, legacyCryptoKey: string): Promise<Record<string, UserData>> {
    return new Promise((resolve) => {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) {
            return resolve({});
        }

        chrome.storage.local.get(
            [profilesKey, LEGACY_PROFILES_KEY, legacyCryptoKey, LEGACY_CRYPTO_KEY_RAW],
            async (result) => {
                const rawCurrent = result[profilesKey] as unknown;

                // Case 1: Current profiles is already a clean JavaScript object/record
                if (rawCurrent && typeof rawCurrent === 'object' && !Array.isArray(rawCurrent)) {
                    return resolve(rawCurrent as Record<string, UserData>);
                }

                // Case 2: Current profiles is a legacy encrypted string
                if (typeof rawCurrent === 'string') {
                    const legacyKey = (result[legacyCryptoKey] || result[LEGACY_CRYPTO_KEY_RAW]) as string | undefined;
                    const decrypted = await tryDecryptLegacy(rawCurrent, legacyKey);
                    if (decrypted && Object.keys(decrypted).length > 0) {
                        // Persist clean JSON and clean up legacy crypto key
                        await writeVault(decrypted, profilesKey);
                        chrome.storage.local.remove([legacyCryptoKey, LEGACY_CRYPTO_KEY_RAW]);
                        return resolve(decrypted);
                    }
                }

                // Case 3: Migration from legacy unscoped vault if current vault is empty
                const rawLegacy = result[LEGACY_PROFILES_KEY] as unknown;
                if (rawLegacy) {
                    if (typeof rawLegacy === 'object' && !Array.isArray(rawLegacy)) {
                        const legacyVault = rawLegacy as Record<string, UserData>;
                        await writeVault(legacyVault, profilesKey);
                        return resolve(legacyVault);
                    }
                    if (typeof rawLegacy === 'string') {
                        const legacyKey = (result[legacyCryptoKey] || result[LEGACY_CRYPTO_KEY_RAW]) as string | undefined;
                        const decrypted = await tryDecryptLegacy(rawLegacy, legacyKey);
                        if (decrypted && Object.keys(decrypted).length > 0) {
                            await writeVault(decrypted, profilesKey);
                            chrome.storage.local.remove([legacyCryptoKey, LEGACY_CRYPTO_KEY_RAW]);
                            return resolve(decrypted);
                        }
                    }
                }

                resolve({});
            }
        );
    });
}

async function writeVault(vault: Record<string, UserData>, profilesKey: string): Promise<void> {
    return new Promise((resolve) => {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return resolve();
        chrome.storage.local.set({ [profilesKey]: vault }, resolve);
    });
}

// Profile storage service API

export const storageService = {
    /** Get current account key namespace */
    async getCurrentAccountKey(explicitKey?: string | null): Promise<string> {
        return getAccountKey(explicitKey);
    },

    /** Save a named profile for the active account */
    async saveProfile(name: string, data: UserData, explicitAccountKey?: string | null): Promise<void> {
        const { profilesKey, legacyCryptoKey } = await getStorageKeys(explicitAccountKey);
        const vault = await readVault(profilesKey, legacyCryptoKey);
        vault[name] = data;
        await writeVault(vault, profilesKey);

        const activeName = await this.getActiveProfileName(explicitAccountKey);
        if (name === activeName && typeof chrome !== 'undefined' && chrome.storage?.local) {
            await chrome.storage.local.set({ userData: data });
        }
    },

    /** Load a named profile for the active account */
    async loadProfile(name: string, explicitAccountKey?: string | null): Promise<UserData | null> {
        const { profilesKey, legacyCryptoKey } = await getStorageKeys(explicitAccountKey);
        const vault = await readVault(profilesKey, legacyCryptoKey);
        return vault[name] ?? null;
    },

    /** List all profile names for the active account */
    async listProfiles(explicitAccountKey?: string | null): Promise<string[]> {
        const { profilesKey, legacyCryptoKey } = await getStorageKeys(explicitAccountKey);
        const vault = await readVault(profilesKey, legacyCryptoKey);
        const keys = Object.keys(vault);
        return keys.length > 0 ? keys : ['Default'];
    },

    /** Delete a profile for the active account */
    async deleteProfile(name: string, explicitAccountKey?: string | null): Promise<void> {
        const { profilesKey, legacyCryptoKey } = await getStorageKeys(explicitAccountKey);
        const vault = await readVault(profilesKey, legacyCryptoKey);
        delete vault[name];
        await writeVault(vault, profilesKey);
    },

    /** Get active profile name for the active account */
    async getActiveProfileName(explicitAccountKey?: string | null): Promise<string> {
        const { activeKey } = await getStorageKeys(explicitAccountKey);
        return new Promise((resolve) => {
            if (typeof chrome === 'undefined' || !chrome.storage?.local) return resolve('Default');
            chrome.storage.local.get([activeKey, LEGACY_ACTIVE_KEY], (r) => {
                const name = (r[activeKey] as string) || (r[LEGACY_ACTIVE_KEY] as string) || 'Default';
                resolve(name);
            });
        });
    },

    /** Set active profile name for the active account and sync to userData */
    async setActiveProfileName(name: string, explicitAccountKey?: string | null): Promise<void> {
        const { activeKey } = await getStorageKeys(explicitAccountKey);
        await new Promise<void>((resolve) => {
            if (typeof chrome === 'undefined' || !chrome.storage?.local) return resolve();
            chrome.storage.local.set({ [activeKey]: name }, () => resolve());
        });
        const data = await this.loadProfile(name, explicitAccountKey);
        if (data && typeof chrome !== 'undefined' && chrome.storage?.local) {
            await chrome.storage.local.set({ userData: data });
        }
    },

    /** Load active profile data for the active account */
    async loadActiveProfile(explicitAccountKey?: string | null): Promise<UserData | null> {
        const name = await this.getActiveProfileName(explicitAccountKey);
        return this.loadProfile(name, explicitAccountKey);
    },

    /** Export all profiles for the active account as a JSON string */
    async exportAllProfiles(explicitAccountKey?: string | null): Promise<string> {
        const { profilesKey, legacyCryptoKey, accountKey } = await getStorageKeys(explicitAccountKey);
        const vault = await readVault(profilesKey, legacyCryptoKey);
        return JSON.stringify(
            {
                version: 2,
                account: accountKey,
                profiles: vault,
                exportedAt: new Date().toISOString(),
            },
            null,
            2
        );
    },

    /** Import profiles from a JSON string */
    async importProfiles(json: string, merge = true, explicitAccountKey?: string | null): Promise<void> {
        const parsed = JSON.parse(json);
        if (!parsed.profiles || typeof parsed.profiles !== 'object') {
            throw new Error('Invalid export format: missing "profiles" object.');
        }
        const { profilesKey, legacyCryptoKey } = await getStorageKeys(explicitAccountKey);
        const existing = merge ? await readVault(profilesKey, legacyCryptoKey) : {};
        const merged = { ...existing, ...parsed.profiles };
        await writeVault(merged, profilesKey);
    },

    /** Switch active account namespace, load its profile, and synchronize userData */
    async switchAccount(newUidOrEmail?: string | null): Promise<void> {
        const targetAccount = await getAccountKey(newUidOrEmail);
        const activeName = await this.getActiveProfileName(targetAccount);
        let activeData = await this.loadProfile(activeName, targetAccount);

        if (!activeData) {
            // Check Default profile
            activeData = await this.loadProfile('Default', targetAccount);
        }

        if (!activeData && typeof chrome !== 'undefined' && chrome.storage?.local) {
            // Check if legacy userData exists to populate Default
            const stored = await chrome.storage.local.get(['userData']);
            if (stored.userData && Object.keys(stored.userData).length > 0) {
                activeData = stored.userData as UserData;
                await this.saveProfile('Default', activeData, targetAccount);
            }
        }

        if (activeData && typeof chrome !== 'undefined' && chrome.storage?.local) {
            await chrome.storage.local.set({ userData: activeData });
        }
    },

    /** Migrate legacy unencrypted or un-scoped userData to the active vault */
    async migrateLegacyData(explicitAccountKey?: string | null): Promise<void> {
        return new Promise((resolve) => {
            if (typeof chrome === 'undefined' || !chrome.storage?.local) return resolve();
            chrome.storage.local.get(['userData'], async (result) => {
                if (result.userData && Object.keys(result.userData).length > 0) {
                    const legacyData = result.userData as UserData;
                    const existing = await this.loadProfile('Default', explicitAccountKey);
                    if (!existing || Object.keys(existing).length === 0) {
                        await this.saveProfile('Default', legacyData, explicitAccountKey);
                    }
                }
                resolve();
            });
        });
    },
};
