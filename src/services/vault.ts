// vault.ts - Passphrase-encrypted local storage for profiles, documents, and the Gemini key
//
// Design:
// - PBKDF2-SHA256 (600k iterations) turns the passphrase + random salt into an AES-256-GCM key.
// - Encrypted blob lives in chrome.storage.local (on disk).
// - Unlocked key lives only in chrome.storage.session (memory, cleared when the browser closes,
//   not readable by content scripts), so background.ts can fill while the vault is unlocked.
// - AES-GCM's auth tag doubles as the passphrase check: wrong passphrase → decrypt fails.

import type { CM, UserData, UserProfileStore } from '../types';

export interface VaultData {
    userProfiles?: UserProfileStore;
    activeProfile?: UserData;
    fields?: CM[];
    geminiApiKey?: string;
}

interface EncryptedVault {
    v: 1;
    kdf: 'PBKDF2-SHA256';
    iterations: number;
    salt: string; // base64
    iv: string;   // base64
    data: string; // base64 ciphertext
    writer?: string; // WRITER_ID of the page that saved it (lets other pages detect external changes)
}

export type VaultStatus = 'none' | 'locked' | 'unlocked';

export const VAULT_STORAGE_KEY = 'aullevo_vault';
export const VAULT_SESSION_KEY = 'aullevo_vault_key';
export const MIN_PASSPHRASE_LENGTH = 8;

// Plaintext keys used before the vault existed (migrated then deleted)
const LEGACY_PLAINTEXT_KEYS = ['userProfiles', 'activeProfile', 'fields', 'aullevo_gemini_api_key'];

const PBKDF2_ITERATIONS = 600_000;

// Unique per extension page (side panel, options page): each has its own copy of this module
const WRITER_ID = crypto.randomUUID();

/** True when a chrome.storage change to the vault was saved by another page (e.g. options page vs side panel). */
export function isExternalVaultChange(change: chrome.storage.StorageChange | undefined): boolean {
    const next = change?.newValue as EncryptedVault | undefined;
    return Boolean(next) && next!.writer !== WRITER_ID;
}

// ---------------------------------------------------------------------------
// 1. Encoding helpers (chunked, so multi-MB documents don't overflow the call stack)
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

// ---------------------------------------------------------------------------
// 2. Crypto primitives
// ---------------------------------------------------------------------------

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
    const baseKey = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        true, // extractable: needed to hand the key to chrome.storage.session
        ['encrypt', 'decrypt']
    );
}

async function encryptData(key: CryptoKey, data: VaultData, salt: Uint8Array, iterations: number): Promise<EncryptedVault> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    return {
        v: 1,
        kdf: 'PBKDF2-SHA256',
        iterations,
        salt: bytesToBase64(salt),
        iv: bytesToBase64(iv),
        data: bytesToBase64(new Uint8Array(ciphertext))
    };
}

async function decryptData(key: CryptoKey, vault: EncryptedVault): Promise<VaultData> {
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBytes(vault.iv) },
        key,
        base64ToBytes(vault.data)
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as VaultData;
}

// ---------------------------------------------------------------------------
// 3. Storage access
// ---------------------------------------------------------------------------

async function getEncryptedVault(): Promise<EncryptedVault | null> {
    const res = await chrome.storage.local.get(VAULT_STORAGE_KEY);
    const vault = res?.[VAULT_STORAGE_KEY] as EncryptedVault | undefined;
    return vault?.v === 1 ? vault : null;
}

async function getSessionKey(): Promise<CryptoKey | null> {
    const res = await chrome.storage.session.get(VAULT_SESSION_KEY);
    const raw = res?.[VAULT_SESSION_KEY];
    if (typeof raw !== 'string') return null;
    return crypto.subtle.importKey('raw', base64ToBytes(raw), 'AES-GCM', true, ['encrypt', 'decrypt']);
}

async function setSessionKey(key: CryptoKey): Promise<void> {
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
    await chrome.storage.session.set({ [VAULT_SESSION_KEY]: bytesToBase64(raw) });
}

// ---------------------------------------------------------------------------
// 4. Public API
// ---------------------------------------------------------------------------

export async function getVaultStatus(): Promise<VaultStatus> {
    if (!(await getEncryptedVault())) return 'none';
    return (await getSessionKey()) ? 'unlocked' : 'locked';
}

/** Reads pre-vault plaintext data so it can be moved into a new vault. */
export async function readLegacyPlaintext(): Promise<VaultData> {
    const res = await chrome.storage.local.get(LEGACY_PLAINTEXT_KEYS);
    return {
        userProfiles: res?.userProfiles as UserProfileStore | undefined,
        activeProfile: res?.activeProfile as UserData | undefined,
        fields: res?.fields as CM[] | undefined,
        geminiApiKey: typeof res?.aullevo_gemini_api_key === 'string' ? res.aullevo_gemini_api_key : undefined
    };
}

/** Creates the vault (migrating any legacy plaintext), unlocks it, then deletes the plaintext copies. */
export async function createVault(passphrase: string): Promise<void> {
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
        throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
    const initialData = await readLegacyPlaintext();

    const encrypted = await encryptData(key, initialData, salt, PBKDF2_ITERATIONS);
    await chrome.storage.local.set({ [VAULT_STORAGE_KEY]: encrypted });
    await setSessionKey(key);
    await chrome.storage.local.remove(LEGACY_PLAINTEXT_KEYS);
}

/** Returns false when the passphrase is wrong. */
export async function unlockVault(passphrase: string): Promise<boolean> {
    const vault = await getEncryptedVault();
    if (!vault) return false;
    const key = await deriveKey(passphrase, base64ToBytes(vault.salt), vault.iterations);
    try {
        await decryptData(key, vault);
    } catch {
        return false;
    }
    await setSessionKey(key);
    return true;
}

export async function lockVault(): Promise<void> {
    await chrome.storage.session.remove(VAULT_SESSION_KEY);
}

/** Permanently deletes the encrypted vault (used for "Forgot passphrase"). */
export async function resetVault(): Promise<void> {
    await chrome.storage.session.remove(VAULT_SESSION_KEY);
    await chrome.storage.local.remove([VAULT_STORAGE_KEY, ...LEGACY_PLAINTEXT_KEYS]);
}

/** Returns null when the vault is missing or locked. */
export async function readVault(): Promise<VaultData | null> {
    const [vault, key] = await Promise.all([getEncryptedVault(), getSessionKey()]);
    if (!vault || !key) return null;
    try {
        return await decryptData(key, vault);
    } catch {
        return null;
    }
}

// Serializes writes in this context so concurrent read-modify-write calls can't drop each other's changes
let writeQueue: Promise<void> = Promise.resolve();

/** Merges `patch` into the vault and re-encrypts with a fresh IV. Throws when locked. */
export function writeVault(patch: Partial<VaultData>): Promise<void> {
    const task = writeQueue.then(async () => {
        const [vault, key] = await Promise.all([getEncryptedVault(), getSessionKey()]);
        if (!vault || !key) throw new Error('Vault is locked.');
        const current = await decryptData(key, vault);
        const next = await encryptData(key, { ...current, ...patch }, base64ToBytes(vault.salt), vault.iterations);
        await chrome.storage.local.set({ [VAULT_STORAGE_KEY]: { ...next, writer: WRITER_ID } });
    });
    writeQueue = task.catch(() => { });
    return task;
}
