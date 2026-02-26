/**
 * storageService.ts
 * ─────────────────────────────────────────────────────────
 * AES-256-GCM encrypted storage for all user profile data.
 * Multi-profile vault with import/export support.
 *
 * Architecture Design System — Layer 4: Data Layer
 * ─────────────────────────────────────────────────────────
 */

import type { UserData } from '../types';

const PROFILES_KEY = 'aullevo_profiles';       // encrypted profiles vault
const ACTIVE_KEY   = 'aullevo_active_profile'; // name of active profile
const CRYPTO_KEY_RAW = 'aullevo_ck';           // raw key material (base64)

/* ─────────────────────────────────────────────────────────
   KEY MANAGEMENT — derive/load a persistent AES-256 key
───────────────────────────────────────────────────────── */

async function getOrCreateKey(): Promise<CryptoKey> {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get([CRYPTO_KEY_RAW], async (result) => {
            try {
                if (result[CRYPTO_KEY_RAW]) {
                    // Import existing key
                    const raw = base64ToBuffer(result[CRYPTO_KEY_RAW] as string);
                    const key = await crypto.subtle.importKey(
                        'raw', raw.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
                    );
                    resolve(key);
                } else {
                    // Generate new AES-256-GCM key
                    const key = await crypto.subtle.generateKey(
                        { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
                    );
                    const raw = await crypto.subtle.exportKey('raw', key);
                    chrome.storage.local.set({ [CRYPTO_KEY_RAW]: bufferToBase64(raw) });
                    resolve(key);
                }
            } catch (err) {
                reject(err);
            }
        });
    });
}

/* ─────────────────────────────────────────────────────────
   ENCRYPT / DECRYPT
───────────────────────────────────────────────────────── */

async function encrypt(data: object, key: CryptoKey): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(data));
    const cipher = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as unknown as BufferSource },
        key,
        encoded as unknown as BufferSource
    );
    // Pack: base64(iv) + '.' + base64(ciphertext)
    return `${bufferToBase64(iv)}.${bufferToBase64(cipher)}`;
}

async function decrypt(ciphertext: string, key: CryptoKey): Promise<object> {
    const [ivB64, dataB64] = ciphertext.split('.');
    const ivArr = base64ToBuffer(ivB64);
    const dataArr = base64ToBuffer(dataB64);
    // Cast to ArrayBuffer to satisfy WebCrypto strict BufferSource overloads
    const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivArr.buffer.slice(ivArr.byteOffset, ivArr.byteOffset + ivArr.byteLength) as ArrayBuffer },
        key,
        dataArr.buffer.slice(dataArr.byteOffset, dataArr.byteOffset + dataArr.byteLength) as ArrayBuffer
    );
    return JSON.parse(new TextDecoder().decode(plain));
}

/* ─────────────────────────────────────────────────────────
   PROFILE CRUD
───────────────────────────────────────────────────────── */

/** Read the raw encrypted vault from storage */
async function readVault(key: CryptoKey): Promise<Record<string, UserData>> {
    return new Promise((resolve) => {
        chrome.storage.local.get([PROFILES_KEY], async (result) => {
            const raw = result[PROFILES_KEY] as string | undefined;
            if (!raw) return resolve({});
            try {
                const vault = await decrypt(raw, key) as Record<string, UserData>;
                resolve(vault);
            } catch {
                // Decryption failed (e.g. key rotation) — return empty
                resolve({});
            }
        });
    });
}

/** Write the encrypted vault back to storage */
async function writeVault(vault: Record<string, UserData>, key: CryptoKey): Promise<void> {
    const encrypted = await encrypt(vault, key);
    return new Promise((resolve) => {
        chrome.storage.local.set({ [PROFILES_KEY]: encrypted }, resolve);
    });
}

export const storageService = {
    /* ── Save a profile (creates or overwrites) ── */
    async saveProfile(name: string, data: UserData): Promise<void> {
        const key = await getOrCreateKey();
        const vault = await readVault(key);
        vault[name] = data;
        await writeVault(vault, key);
    },

    /* ── Load a named profile ── */
    async loadProfile(name: string): Promise<UserData | null> {
        const key = await getOrCreateKey();
        const vault = await readVault(key);
        return vault[name] ?? null;
    },

    /* ── List all saved profile names ── */
    async listProfiles(): Promise<string[]> {
        const key = await getOrCreateKey();
        const vault = await readVault(key);
        return Object.keys(vault);
    },

    /* ── Delete a profile ── */
    async deleteProfile(name: string): Promise<void> {
        const key = await getOrCreateKey();
        const vault = await readVault(key);
        delete vault[name];
        await writeVault(vault, key);
    },

    /* ── Get / set active profile name ── */
    async getActiveProfileName(): Promise<string> {
        return new Promise(resolve => {
            chrome.storage.local.get([ACTIVE_KEY], (r) => resolve((r[ACTIVE_KEY] as string) || 'Default'));
        });
    },

    async setActiveProfileName(name: string): Promise<void> {
        return new Promise(resolve => chrome.storage.local.set({ [ACTIVE_KEY]: name }, resolve));
    },

    /* ── Load the active profile's userData ── */
    async loadActiveProfile(): Promise<UserData | null> {
        const name = await this.getActiveProfileName();
        return this.loadProfile(name);
    },

    /* ── Export all profiles as a JSON string (for download) ── */
    async exportAllProfiles(): Promise<string> {
        const key = await getOrCreateKey();
        const vault = await readVault(key);
        return JSON.stringify({ version: 1, profiles: vault, exportedAt: new Date().toISOString() }, null, 2);
    },

    /* ── Import profiles from a JSON string ── */
    async importProfiles(json: string, merge = true): Promise<void> {
        const parsed = JSON.parse(json);
        if (!parsed.profiles || typeof parsed.profiles !== 'object') {
            throw new Error('Invalid export format: missing "profiles" object.');
        }
        const key = await getOrCreateKey();
        const existing = merge ? await readVault(key) : {};
        const merged = { ...existing, ...parsed.profiles };
        await writeVault(merged, key);
    },

    /* ── Migrate legacy unencrypted userData to vault ── */
    async migrateLegacyData(): Promise<void> {
        return new Promise(resolve => {
            chrome.storage.local.get(['userData'], async (result) => {
                if (result.userData) {
                    const legacyData = result.userData as UserData;
                    // Save it under 'Default' profile in encrypted vault
                    await this.saveProfile('Default', legacyData);
                    // Remove plaintext userData
                    chrome.storage.local.remove(['userData'], resolve);
                } else {
                    resolve();
                }
            });
        });
    },
};

/* ─────────────────────────────────────────────────────────
   UTILITIES
───────────────────────────────────────────────────────── */

function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
}

function base64ToBuffer(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
