import type { CustomField } from '../types';

/**
 * Normalizes custom fields from legacy Record<string, string> or raw inputs to a structured CustomField[] array.
 * Single source of truth across options, popup, sidebar, and background worker.
 */
export function migrateCustomFields(raw: unknown): CustomField[] {
    if (Array.isArray(raw)) {
        return raw.map((item) => {
            if (typeof item === 'object' && item !== null) {
                const rec = item as Record<string, unknown>;
                return {
                    label: String(rec.label || ''),
                    value: String(rec.value || ''),
                    context: String(rec.context || ''),
                };
            }
            return { label: String(item), value: '', context: '' };
        }).filter((cf) => cf.label.trim().length > 0 || cf.value.trim().length > 0);
    }

    if (raw && typeof raw === 'object') {
        return Object.entries(raw).map(([key, value]) => ({
            label: String(key).trim(),
            value: String(value ?? '').trim(),
            context: '',
        })).filter((cf) => cf.label.length > 0 || cf.value.length > 0);
    }

    return [];
}
