// importQuota.ts - Free plan: a few JSON imports every day, resetting at local midnight. Pro: unlimited.
// Once they are used, a pass (2 short ads) allows any number for 5 hours (rewards.ts).
// Side panel only (background.ts doesn't import JSON).

export const FREE_JSON_IMPORTS_PER_DAY = 4;

export const JSON_IMPORT_COUNT_KEY = 'aullevo_json_import_count';
const JSON_IMPORT_PERIOD_KEY = 'aullevo_json_import_period';

// Local date, so the reset lands at local midnight: "D2026-10-15"
function currentDay(date: Date = new Date()): string {
    return `D${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Next local midnight, when today's imports reset
export function nextJsonImportReset(date: Date = new Date()): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

// Imports used today (0 once a new day starts)
export async function getJsonImportsUsed(): Promise<number> {
    const res = await chrome.storage.local.get([JSON_IMPORT_COUNT_KEY, JSON_IMPORT_PERIOD_KEY]);
    const count = res?.[JSON_IMPORT_COUNT_KEY];
    return typeof count === 'number' && res?.[JSON_IMPORT_PERIOD_KEY] === currentDay() ? count : 0;
}

export async function recordJsonImport(): Promise<void> {
    const used = await getJsonImportsUsed();
    await chrome.storage.local.set({
        [JSON_IMPORT_COUNT_KEY]: used + 1,
        [JSON_IMPORT_PERIOD_KEY]: currentDay()
    });
}

export function jsonImportsLeft(used: number, isPro: boolean): number {
    return isPro ? Infinity : Math.max(0, FREE_JSON_IMPORTS_PER_DAY - used);
}
