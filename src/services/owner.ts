// owner.ts - Keeps each account's data separate on one device
//
// Every signed-in account gets its own copy of the personal data keys:
//   aullevo_vault@<uid>, aullevo_vault_device_key@<uid>, aullevo_memories@<uid>, aullevo_saved_links@<uid>
// With no account connected the owner is "local" and the original key names are used,
// so data saved before accounts were separated stays where it was (no migration needed).
// Firebase only syncs the plan; the data itself never leaves the device.

import { ACCOUNT_STORAGE_KEY, type AccountInfo } from './tier';

export const LOCAL_OWNER = 'local';

// Personal data that belongs to one account
export const OWNER_SCOPED_KEYS = {
    vault: 'aullevo_vault',
    vaultKey: 'aullevo_vault_device_key', // the key that opens this owner's vault on this device (vault.ts)
    memories: 'aullevo_memories',
    links: 'aullevo_saved_links'
} as const;

const SCOPED_BASES = Object.values(OWNER_SCOPED_KEYS);

export function scopedKey(base: string, owner: string): string {
    return owner === LOCAL_OWNER ? base : `${base}@${owner}`;
}

/** Owner a storage key belongs to, or null if it isn't a per-account key of `base`. */
export function ownerFromKey(base: string, key: string): string | null {
    if (key === base) return LOCAL_OWNER;
    return key.startsWith(`${base}@`) ? key.slice(base.length + 1) : null;
}

/** The connected account's uid, or "local" when no account is connected. */
export async function getActiveOwner(): Promise<string> {
    const res = await chrome.storage.local.get(ACCOUNT_STORAGE_KEY);
    const account = res?.[ACCOUNT_STORAGE_KEY] as AccountInfo | undefined;
    return account?.uid || LOCAL_OWNER;
}

export async function getScopedKey(base: string): Promise<string> {
    return scopedKey(base, await getActiveOwner());
}

export interface OwnerDataSummary {
    owner: string;
    email: string;     // from the vault's plaintext metadata; '' if unknown
    bytes: number;     // approximate size on disk
    isActive: boolean;
}

/** Every account (and the local owner) that has data on this device. */
export async function listOwnersOnDevice(): Promise<OwnerDataSummary[]> {
    const [all, active] = await Promise.all([chrome.storage.local.get(null), getActiveOwner()]);
    const owners = new Map<string, OwnerDataSummary>();

    for (const [key, value] of Object.entries(all)) {
        for (const base of SCOPED_BASES) {
            const owner = ownerFromKey(base, key);
            if (!owner) continue;
            const entry = owners.get(owner) ?? { owner, email: '', bytes: 0, isActive: owner === active };
            entry.bytes += JSON.stringify(value ?? '').length;
            if (base === OWNER_SCOPED_KEYS.vault && typeof (value as { ownerEmail?: unknown })?.ownerEmail === 'string') {
                entry.email = (value as { ownerEmail: string }).ownerEmail;
            }
            owners.set(owner, entry);
        }
    }
    return Array.from(owners.values());
}

/** Permanently deletes one owner's personal data from this device. */
export async function deleteOwnerData(owner: string): Promise<void> {
    await chrome.storage.local.remove(SCOPED_BASES.map(base => scopedKey(base, owner)));
}

/** Moves one owner's personal data to another (only where the target has nothing yet). */
export async function moveOwnerData(from: string, to: string): Promise<void> {
    const sourceKeys = SCOPED_BASES.map(base => scopedKey(base, from));
    const targetKeys = SCOPED_BASES.map(base => scopedKey(base, to));
    const current = await chrome.storage.local.get([...sourceKeys, ...targetKeys]);

    const patch: Record<string, unknown> = {};
    const moved: string[] = [];
    SCOPED_BASES.forEach((_, i) => {
        if (current[sourceKeys[i]] !== undefined && current[targetKeys[i]] === undefined) {
            patch[targetKeys[i]] = current[sourceKeys[i]];
            moved.push(sourceKeys[i]);
        }
    });
    if (moved.length === 0) return;
    await chrome.storage.local.set(patch);
    await chrome.storage.local.remove(moved);
}
