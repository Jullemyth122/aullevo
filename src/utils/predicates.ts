import type { CM } from '../types';

/**
 * Checks if a field belongs to Identity & Contact.
 * Matches any field whose group contains 'identity' or 'contact' (case-insensitive).
 */
export const isIdentityField = (f: CM): boolean => {
    return !!(f.group && /identity|contact/i.test(f.group));
};

/**
 * Checks if a field belongs to Domain Attributes for the given profile type.
 * Excludes identity and custom fields, and matches 'attribute' or the active profile type.
 */
export const isAttributeField = (f: CM, selectedProfileType?: string): boolean => {
    if (!f.group) return false;
    const g = f.group.toLowerCase().trim();
    if (/identity|contact/i.test(g)) return false;
    if (g === 'custom fields' || g === 'custom') return false;
    return /attribute/i.test(g) || (Boolean(selectedProfileType) && g === selectedProfileType!.toLowerCase().trim());
};

/**
 * Catch-all predicate: general custom fields are neither identity nor attribute fields.
 */
export const isGeneralCustomField = (f: CM, selectedProfileType?: string): boolean => {
    return !isIdentityField(f) && !isAttributeField(f, selectedProfileType);
};
