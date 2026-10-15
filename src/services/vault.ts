// vault.ts - Encrypted local storage for profiles, documents, and the AI provider / ElevenLabs keys
//
// Design:
// - The data is encrypted with AES-256-GCM and lives in chrome.storage.local (on disk), one vault per owner:
//   each signed-in account and the guest (no account) has its own vault and its own key (see owner.ts).
// - The key is made by Aullevo when the vault is created and kept on this device next to the vault
//   (aullevo_vault_device_key@<owner>), so there is no passphrase to type: the panel opens straight away and
//   keyboard shortcuts work right after the browser starts. Nothing ever leaves the device.
// - Vaults made before this used a passphrase (PBKDF2-SHA256, 600k iterations; the unlocked key lived only in
//   chrome.storage.session). Such a vault asks for its passphrase one last time and is then converted.
// - Only the connected owner's vault is read or written: after switching accounts the previous account's data
//   can't be reached from the app.

import type { CM, UserData, UserProfileStore } from '../types';
import type { AiProviderId } from './aiService';
import { getStoredAccount } from './tier';
import { LOCAL_OWNER, OWNER_SCOPED_KEYS, getActiveOwner, moveOwnerData, ownerFromKey, scopedKey } from './owner';

export interface VaultData {
    userProfiles?: UserProfileStore;
    activeProfile?: UserData;
    fields?: CM[];
    geminiApiKey?: string; // before aiApiKeys: still read as the Gemini key until one is saved there
    aiApiKeys?: Partial<Record<AiProviderId, string>>; // one key per AI provider (Gemini, OpenAI, Claude, custom server)
    elevenLabsApiKey?: string; // voice agent: speech-to-text and the agent's voice
}

interface EncryptedVault {
    v: 1;
    kdf: 'DEVICE' | 'PBKDF2-SHA256'; // DEVICE: the key is stored on this device; PBKDF2: an old passphrase vault
    iterations: number; // PBKDF2 only
    salt: string;       // PBKDF2 only (base64)
    iv: string;   // base64
    data: string; // base64 ciphertext
    writer?: string; // WRITER_ID of the page that saved it (lets other pages detect external changes)
    ownerEmail?: string; // plaintext label for "Data on this device" (the uid is in the storage key)
}

// Session key record (old passphrase vaults): which account's vault this key unlocks
interface SessionKeyRecord {
    owner: string;
    key: string; // base64 raw AES key
}

// 'locked' only happens to an old passphrase vault, until its passphrase is entered once
export type VaultStatus = 'none' | 'locked' | 'unlocked';

export const VAULT_STORAGE_KEY = OWNER_SCOPED_KEYS.vault; // "local" owner's key; accounts use `${VAULT_STORAGE_KEY}@<uid>`
export const VAULT_DEVICE_KEY = OWNER_SCOPED_KEYS.vaultKey;
export const VAULT_SESSION_KEY = 'aullevo_vault_key';

// Plaintext keys used before the vault existed (migrated then deleted)
const LEGACY_PLAINTEXT_KEYS = ['userProfiles', 'activeProfile', 'fields', 'aullevo_gemini_api_key'];

// Unique per extension page (side panel, options page): each has its own copy of this module
const WRITER_ID = crypto.randomUUID();

/** True when a chrome.storage change to the vault was saved by another page (e.g. options page vs side panel). */
export function isExternalVaultChange(change: chrome.storage.StorageChange | undefined): boolean {
    const next = change?.newValue as EncryptedVault | undefined;
    return Boolean(next) && next!.writer !== WRITER_ID;
}

/** True for any account's vault key (used to react to vault changes). */
export function isVaultStorageKey(key: string): boolean {
    return ownerFromKey(VAULT_STORAGE_KEY, key) !== null;
}

/** Storage key of the connected account's vault. */
export async function getActiveVaultStorageKey(): Promise<string> {
    return scopedKey(VAULT_STORAGE_KEY, await getActiveOwner());
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

// Old passphrase vaults only
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

const importAesKey = (raw: Uint8Array<ArrayBuffer>) => crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);

async function encryptData(key: CryptoKey, data: VaultData, format: Pick<EncryptedVault, 'kdf' | 'salt' | 'iterations'>): Promise<EncryptedVault> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    return {
        v: 1,
        ...format,
        iv: bytesToBase64(iv),
        data: bytesToBase64(new Uint8Array(ciphertext))
    };
}

const DEVICE_FORMAT = { kdf: 'DEVICE', salt: '', iterations: 0 } as const;

async function decryptData(key: CryptoKey, vault: EncryptedVault): Promise<VaultData> {
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBytes(vault.iv) },
        key,
        base64ToBytes(vault.data)
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as VaultData;
}

// ---------------------------------------------------------------------------
// 3. Storage access (always for one owner)
// ---------------------------------------------------------------------------

async function getEncryptedVault(owner: string): Promise<EncryptedVault | null> {
    const key = scopedKey(VAULT_STORAGE_KEY, owner);
    const res = await chrome.storage.local.get(key);
    const vault = res?.[key] as EncryptedVault | undefined;
    return vault?.v === 1 ? vault : null;
}

async function saveEncryptedVault(owner: string, vault: EncryptedVault): Promise<void> {
    const ownerEmail = owner === LOCAL_OWNER ? undefined : (await getStoredAccount())?.email;
    await chrome.storage.local.set({ [scopedKey(VAULT_STORAGE_KEY, owner)]: { ...vault, writer: WRITER_ID, ownerEmail } });
}

// The owner's own key on this device
async function getDeviceKey(owner: string): Promise<CryptoKey | null> {
    const storageKey = scopedKey(VAULT_DEVICE_KEY, owner);
    const raw = (await chrome.storage.local.get(storageKey))?.[storageKey];
    return typeof raw === 'string' ? importAesKey(base64ToBytes(raw)) : null;
}

async function newDeviceKey(owner: string): Promise<CryptoKey> {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
    await chrome.storage.local.set({ [scopedKey(VAULT_DEVICE_KEY, owner)]: bytesToBase64(raw) });
    return key;
}

// Old passphrase vaults: the unlocked key, only if it belongs to `owner`
async function getSessionKey(owner: string): Promise<CryptoKey | null> {
    const res = await chrome.storage.session.get(VAULT_SESSION_KEY);
    const raw = res?.[VAULT_SESSION_KEY] as SessionKeyRecord | string | undefined;
    // A bare string is a key saved before vaults were per account: it belongs to the local vault
    const record: SessionKeyRecord | null = typeof raw === 'string'
        ? { owner: LOCAL_OWNER, key: raw }
        : (raw && typeof raw.key === 'string' ? raw : null);
    if (!record || record.owner !== owner) return null;
    return importAesKey(base64ToBytes(record.key));
}

// The key that opens this vault right now (null: an old passphrase vault not unlocked yet)
async function keyFor(owner: string, vault: EncryptedVault): Promise<CryptoKey | null> {
    return vault.kdf === 'DEVICE' ? getDeviceKey(owner) : getSessionKey(owner);
}

/** Re-encrypts `data` with a new key on this device: the vault no longer needs a passphrase. */
async function saveAsDeviceVault(owner: string, data: VaultData): Promise<void> {
    const key = await newDeviceKey(owner);
    await saveEncryptedVault(owner, await encryptData(key, data, DEVICE_FORMAT));
    await chrome.storage.session.remove(VAULT_SESSION_KEY);
}

// ---------------------------------------------------------------------------
// 4. Public API (every call acts on the connected account's vault)
// ---------------------------------------------------------------------------

export async function getVaultStatus(): Promise<VaultStatus> {
    const owner = await getActiveOwner();
    const vault = await getEncryptedVault(owner);
    if (!vault) return 'none';
    return (await keyFor(owner, vault)) ? 'unlocked' : 'locked';
}

/** True when the connected account's vault is an old one that still needs its passphrase once. */
export async function needsPassphrase(): Promise<boolean> {
    const owner = await getActiveOwner();
    const vault = await getEncryptedVault(owner);
    return vault?.kdf === 'PBKDF2-SHA256' && !(await getSessionKey(owner));
}

/**
 * An old passphrase vault that is already unlocked in this browser session (unlocked before this version):
 * converts it right away, so it won't ask for the passphrase after the next browser restart.
 */
export async function upgradeUnlockedVault(): Promise<void> {
    const owner = await getActiveOwner();
    const vault = await getEncryptedVault(owner);
    const key = vault?.kdf === 'PBKDF2-SHA256' ? await getSessionKey(owner) : null;
    if (!vault || !key) return;
    try {
        await saveAsDeviceVault(owner, await decryptData(key, vault));
    } catch { /* key no longer matches: the passphrase screen handles it */ }
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

/**
 * Creates the connected account's vault (no passphrase). Only the guest (no account) picks up pre-vault
 * plaintext data; an account starts empty.
 */
export async function createVault(): Promise<void> {
    const owner = await getActiveOwner();
    if (await getEncryptedVault(owner)) return; // another page made it a moment ago
    const initialData = owner === LOCAL_OWNER ? await readLegacyPlaintext() : {};
    await saveAsDeviceVault(owner, initialData);
    if (owner === LOCAL_OWNER) await chrome.storage.local.remove(LEGACY_PLAINTEXT_KEYS);
}

/**
 * Old passphrase vault: opens it with the passphrase one last time and converts it, so it never asks again.
 * Returns false when the passphrase is wrong.
 */
export async function unlockVault(passphrase: string): Promise<boolean> {
    const owner = await getActiveOwner();
    const vault = await getEncryptedVault(owner);
    if (!vault || vault.kdf !== 'PBKDF2-SHA256') return false;
    const key = await deriveKey(passphrase, base64ToBytes(vault.salt), vault.iterations);
    let data: VaultData;
    try {
        data = await decryptData(key, vault);
    } catch {
        return false;
    }
    await saveAsDeviceVault(owner, data);
    return true;
}

/** Permanently deletes the connected account's vault, memories and link queue ("Forgot passphrase" on an old vault). */
export async function resetVault(): Promise<void> {
    const owner = await getActiveOwner();
    await chrome.storage.session.remove(VAULT_SESSION_KEY);
    await chrome.storage.local.remove([
        ...Object.values(OWNER_SCOPED_KEYS).map(base => scopedKey(base, owner)),
        ...(owner === LOCAL_OWNER ? LEGACY_PLAINTEXT_KEYS : [])
    ]);
}

/** Returns null when the connected account has no vault yet (or an old one still needs its passphrase). */
export async function readVault(): Promise<VaultData | null> {
    const owner = await getActiveOwner();
    const vault = await getEncryptedVault(owner);
    const key = vault && await keyFor(owner, vault);
    if (!vault || !key) return null;
    try {
        return await decryptData(key, vault);
    } catch {
        return null;
    }
}

// Serializes writes in this context so concurrent read-modify-write calls can't drop each other's changes
let writeQueue: Promise<void> = Promise.resolve();

/** Merges `patch` into the connected account's vault and re-encrypts with a fresh IV. Throws when it can't be opened. */
export function writeVault(patch: Partial<VaultData>): Promise<void> {
    const task = writeQueue.then(async () => {
        const owner = await getActiveOwner();
        const vault = await getEncryptedVault(owner);
        const key = vault && await keyFor(owner, vault);
        // After an account switch only the new account's vault is reachable: nothing is written into another's
        if (!vault || !key) throw new Error('Vault is locked.');
        const current = await decryptData(key, vault);
        await saveEncryptedVault(owner, await encryptData(key, { ...current, ...patch }, vault));
    });
    writeQueue = task.catch(() => { });
    return task;
}

// ---------------------------------------------------------------------------
// 5. Data saved as a guest (no account), seen by a signed-in account
// ---------------------------------------------------------------------------

/** True when an account is connected, has no vault yet, and there is a guest vault on this device. */
export async function canClaimLocalVault(): Promise<boolean> {
    const owner = await getActiveOwner();
    if (owner === LOCAL_OWNER || await getEncryptedVault(owner)) return false;
    return Boolean(await getEncryptedVault(LOCAL_OWNER));
}

/** True when the guest vault is an old one, so moving it needs its passphrase. */
export async function localVaultNeedsPassphrase(): Promise<boolean> {
    return (await getEncryptedVault(LOCAL_OWNER))?.kdf === 'PBKDF2-SHA256';
}

/**
 * Moves the guest's vault (plus its memories and link queue) to the connected account, when the user says the
 * guest data is theirs. An old guest vault needs its passphrase; returns false when it's wrong.
 */
export async function claimLocalVault(passphrase = ''): Promise<boolean> {
    const owner = await getActiveOwner();
    if (owner === LOCAL_OWNER || !(await canClaimLocalVault())) return false;

    const local = await getEncryptedVault(LOCAL_OWNER);
    if (!local) return false;
    if (local.kdf === 'PBKDF2-SHA256') {
        let data: VaultData;
        try {
            data = await decryptData(await deriveKey(passphrase, base64ToBytes(local.salt), local.iterations), local);
        } catch {
            return false;
        }
        await moveOwnerData(LOCAL_OWNER, owner);
        await saveAsDeviceVault(owner, data); // converted: no passphrase from now on
        return true;
    }
    await moveOwnerData(LOCAL_OWNER, owner); // the vault moves with its key
    const moved = await getEncryptedVault(owner);
    if (moved) await saveEncryptedVault(owner, moved); // re-save so it carries this account's email label
    return true;
}
