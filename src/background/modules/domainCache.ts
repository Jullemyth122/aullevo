/**
 * @file domainCache.ts
 * @module background/modules
 *
 * ─── ROLE IN THE ARCHITECTURE ───────────────────────────────────────────────
 * In-memory cache for AI field-mapping results, keyed by domain hostname.
 *
 * WHY THIS EXISTS:
 *   Calling Gemini AI to analyse a form is expensive (latency + quota).
 *   If the user fills two pages on the same site in quick succession
 *   (e.g. multi-step application wizard), the form fields are often
 *   identical.  This cache returns the previous AI result instantly
 *   without a second API call.
 *
 * CACHE INVALIDATION TRIGGERS (in background.ts):
 *   chrome.storage.onChanged → if userData, matchingMode, or geminiApiKey
 *   changes, domainCache.clear() is called so stale mappings don't linger.
 *
 * WHO IMPORTS THIS FILE:
 *   • formStepProcessor.ts  — reads and writes the cache around every
 *                             Gemini analyzeFormFields() call.
 *   • background.ts         — clears the whole cache on config change.
 *
 * DEPENDENCY DIRECTION:
 *   background.ts
 *     └── formStepProcessor.ts
 *           └── domainCache.ts   ← YOU ARE HERE (no further deps)
 * ────────────────────────────────────────────────────────────────────────────
 */

/* 
   DOMAIN-LEVEL AI RESULT CACHE
*/

/**
 * How long a cached result is considered fresh.
 * After 10 minutes the entry is treated as expired and evicted on next read.
 */
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * CacheEntry
 * ──────────
 * The shape of a single cache slot.
 *
 * @property fieldSignature - A short fingerprint of the form fields at the
 *                            time the AI call was made (built by buildFieldSignature
 *                            in backgroundUtils.ts).  If the form changes
 *                            (new fields appear), the signature won't match
 *                            and the cached result is ignored.
 * @property mappings       - The raw AI mapping result (array of field→value
 *                            objects) returned by geminiService.analyzeFormFields().
 * @property timestamp      - Unix ms when this entry was stored, used for TTL.
 */
interface CacheEntry {
  fieldSignature: string;
  mappings: any[];
  timestamp: number;
}

/**
 * domainCache
 * ───────────
 * The underlying Map.  Key = hostname (e.g. "jobs.lever.co"),
 * Value = CacheEntry.
 *
 * Exported so background.ts can call domainCache.clear() on config changes.
 */
export const domainCache = new Map<string, CacheEntry>();

/**
 * getCachedMappings
 * ─────────────────
 * Attempts to return a previously computed AI mapping result for a
 * given hostname + field signature combination.
 *
 * Fails (returns null) if:
 *   • No entry exists for the hostname.
 *   • The entry has expired (older than CACHE_TTL_MS).
 *   • The field signature doesn't match (form fields changed since caching).
 *
 * On a cache HIT, it returns a deep copy so callers can mutate the
 * mappings without corrupting the cached original.
 *
 * CALLED BY: formStepProcessor.ts → processFieldsAI(), processFormStep()
 *
 * @param hostname  - Extracted from the tab URL via getHostname().
 * @param signature - Built by buildFieldSignature() from the current fields.
 * @returns The cached mappings array, or null if miss/expired/mismatch.
 */
export function getCachedMappings(hostname: string, signature: string): any[] | null {
  const entry = domainCache.get(hostname);
  if (!entry) return null;

  const age = Date.now() - entry.timestamp;
  if (age > CACHE_TTL_MS) {
    // Entry has expired — evict it now to keep memory clean.
    domainCache.delete(hostname);
    return null;
  }

  if (entry.fieldSignature !== signature) return null; // Form changed → cache miss

  console.log(
    `Aullevo cache HIT for ${hostname} (age: ${Math.round(age / 1000)}s)`,
  );

  // Deep copy: callers can safely mutate selectedValue on each mapping
  // without altering what's stored in the cache.
  return JSON.parse(JSON.stringify(entry.mappings));
}

/**
 * setCachedMappings
 * ─────────────────
 * Stores a fresh AI mapping result in the cache for future fast lookups.
 *
 * Called immediately after a successful geminiService.analyzeFormFields()
 * call if the hostname is known (not empty).
 *
 * Stores a deep copy so later mutations to the live mappings object
 * don't corrupt the cached version.
 *
 * CALLED BY: formStepProcessor.ts → processFieldsAI(), processFormStep()
 *
 * @param hostname  - The site's hostname (cache key).
 * @param signature - The field signature at the time of caching.
 * @param mappings  - The raw AI mapping array to cache.
 */
export function setCachedMappings(
  hostname: string,
  signature: string,
  mappings: any[],
): void {
  domainCache.set(hostname, {
    fieldSignature: signature,
    mappings: JSON.parse(JSON.stringify(mappings)), // deep copy for safety
    timestamp: Date.now(),
  });
  console.log(
    `Aullevo cache SET for ${hostname} (${mappings.length} mappings)`,
  );
}

/**
 * invalidateCache
 * ───────────────
 * Removes the cached entry for a specific hostname.
 *
 * Called in formStepProcessor.ts after clicking "Next" on a multi-step
 * form, because the next page may have completely different fields even
 * though the hostname is the same.
 *
 * Also called after clicking an "Add" button (which causes new form rows
 * to appear), so the scanner picks up the expanded field set correctly.
 *
 * CALLED BY: formStepProcessor.ts → processFormStep() (next-step and add-button paths)
 *
 * @param hostname - The hostname whose cache entry should be evicted.
 */
export function invalidateCache(hostname: string): void {
  if (domainCache.has(hostname)) {
    domainCache.delete(hostname);
    console.log(`Aullevo cache INVALIDATED for ${hostname}`);
  }
}
