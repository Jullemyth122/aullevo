/* 
   DOMAIN-LEVEL AI RESULT CACHE
*/

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  fieldSignature: string;
  mappings: any[];
  timestamp: number;
}

export const domainCache = new Map<string, CacheEntry>();

export function getCachedMappings(hostname: string, signature: string): any[] | null {
  const entry = domainCache.get(hostname);
  if (!entry) return null;
  const age = Date.now() - entry.timestamp;
  if (age > CACHE_TTL_MS) {
    domainCache.delete(hostname);
    return null;
  }
  if (entry.fieldSignature !== signature) return null;
  console.log(
    `Aullevo cache HIT for ${hostname} (age: ${Math.round(age / 1000)}s)`,
  );
  return JSON.parse(JSON.stringify(entry.mappings));
}

export function setCachedMappings(
  hostname: string,
  signature: string,
  mappings: any[],
): void {
  domainCache.set(hostname, {
    fieldSignature: signature,
    mappings: JSON.parse(JSON.stringify(mappings)),
    timestamp: Date.now(),
  });
  console.log(
    `Aullevo cache SET for ${hostname} (${mappings.length} mappings)`,
  );
}

export function invalidateCache(hostname: string): void {
  if (domainCache.has(hostname)) {
    domainCache.delete(hostname);
    console.log(`Aullevo cache INVALIDATED for ${hostname}`);
  }
}
