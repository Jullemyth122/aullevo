/**
 * Session-backed cache for AI field-mapping results, keyed by domain hostname.
 * Uses chrome.storage.session with in-memory fallback for test runners.
 */

import type { FieldMapping } from "../../types";

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const CACHE_KEY_PREFIX = "aullevo_cache_";

interface CacheEntry {
  fieldSignature: string;
  mappings: FieldMapping[];
  timestamp: number;
}

// In-memory fallback map for test runners / non-extension contexts
const memoryFallbackMap = new Map<string, CacheEntry>();

function getStorageKey(hostname: string): string {
  return `${CACHE_KEY_PREFIX}${hostname}`;
}

function hasSessionStorage(): boolean {
  return (
    typeof chrome !== "undefined" &&
    typeof chrome.storage !== "undefined" &&
    typeof chrome.storage.session !== "undefined"
  );
}

/**
 * Returns a previously computed AI mapping result for a hostname and field signature.
 */
export async function getCachedMappings(
  hostname: string,
  signature: string,
): Promise<FieldMapping[] | null> {
  if (!hostname) return null;

  try {
    let entry: CacheEntry | undefined;

    if (hasSessionStorage()) {
      const key = getStorageKey(hostname);
      const res = await chrome.storage.session.get([key]);
      entry = res[key] as CacheEntry | undefined;
    } else {
      entry = memoryFallbackMap.get(hostname);
    }

    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > CACHE_TTL_MS) {
      await invalidateCache(hostname);
      return null;
    }

    if (entry.fieldSignature !== signature) {
      return null; // Form fields changed
    }

    console.log(
      `Aullevo session cache HIT for ${hostname} (age: ${Math.round(age / 1000)}s)`,
    );

    return JSON.parse(JSON.stringify(entry.mappings)) as FieldMapping[];
  } catch (err) {
    console.warn("Aullevo: getCachedMappings error:", err);
    return null;
  }
}

/**
 * Stores a fresh AI mapping result in session cache for fast lookup.
 */
export async function setCachedMappings(
  hostname: string,
  signature: string,
  mappings: FieldMapping[],
): Promise<void> {
  if (!hostname) return;

  const entry: CacheEntry = {
    fieldSignature: signature,
    mappings: JSON.parse(JSON.stringify(mappings)) as FieldMapping[],
    timestamp: Date.now(),
  };

  try {
    if (hasSessionStorage()) {
      const key = getStorageKey(hostname);
      await chrome.storage.session.set({ [key]: entry });
    } else {
      memoryFallbackMap.set(hostname, entry);
    }

    console.log(
      `Aullevo session cache SET for ${hostname} (${mappings.length} mappings)`,
    );
  } catch (err) {
    console.warn("Aullevo: setCachedMappings error:", err);
  }
}

/**
 * Removes the cached entry for a specific hostname.
 */
export async function invalidateCache(hostname: string): Promise<void> {
  if (!hostname) return;

  try {
    if (hasSessionStorage()) {
      const key = getStorageKey(hostname);
      await chrome.storage.session.remove([key]);
    }
    memoryFallbackMap.delete(hostname);
    console.log(`Aullevo cache INVALIDATED for ${hostname}`);
  } catch (err) {
    console.warn("Aullevo: invalidateCache error:", err);
  }
}

/**
 * Clears all cached domain AI mappings.
 */
export async function clearDomainCache(): Promise<void> {
  try {
    if (hasSessionStorage()) {
      const all = await chrome.storage.session.get(null);
      const keysToRemove = Object.keys(all).filter((k) =>
        k.startsWith(CACHE_KEY_PREFIX),
      );
      if (keysToRemove.length > 0) {
        await chrome.storage.session.remove(keysToRemove);
      }
    }
    memoryFallbackMap.clear();
    console.log("Aullevo domain cache cleared completely.");
  } catch (err) {
    console.warn("Aullevo: clearDomainCache error:", err);
  }
}

/** Exported domainCache compatibility object */
export const domainCache = {
  get: getCachedMappings,
  set: setCachedMappings,
  invalidate: invalidateCache,
  clear: clearDomainCache,
};
