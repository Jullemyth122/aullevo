import type { FieldMapping, UserData } from '../../types';
import { fillFormField } from '../formAnalyzer';

/**
 * Form Pipeline Engine
 * 
 * Provides unified orchestration for form filling, multi-step automation,
 * stuck-step detection (fingerprinting), and repeating section ("Add Another") handling.
 */

export interface FillStepOptions {
    resumeFileData?: string;
    resumeFileName?: string;
    autoSubmit?: boolean;
    stealthMode?: boolean;
    typingDelayMs?: number;
}

export interface FillStepResult {
    filledCount: number;
    total: number;
    failedFields: string[];
}

/**
 * Generates a deterministic signature of field IDs and mapped values
 * to detect looping/stuck steps in multi-step wizard forms.
 */
export function computeStepFingerprint(mappings: FieldMapping[]): string {
    const normalized = mappings
        .map((m) => ({
            id: m.id || m.fieldId,
            val: m.selectedValue ?? '',
        }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return JSON.stringify(normalized);
}

/**
 * Checks if an "Add" button (e.g. "+ Add Experience") should be clicked to append
 * more entries from the user's data into the form.
 */
export function shouldAddNextGroupItem(
    addMapping: FieldMapping,
    currentMappings: FieldMapping[],
    userData: Partial<UserData>
): { shouldAdd: boolean; groupType: string; buttonId?: string } {
    const groupType = addMapping.groupType;
    const buttonId = addMapping.id || addMapping.fieldId;
    if (!groupType || !buttonId) {
        return { shouldAdd: false, groupType: '' };
    }

    const currentIndices = currentMappings
        .filter((m) => m.groupType === groupType && typeof m.groupIndex === 'number')
        .map((m) => m.groupIndex as number);

    const maxIndex = currentIndices.length > 0 ? Math.max(...currentIndices) : -1;

    let totalDataItems = 0;
    if (groupType === 'experience') totalDataItems = (userData.experience || []).length;
    if (groupType === 'education') totalDataItems = (userData.education || []).length;
    if (groupType === 'skill') totalDataItems = (userData.skills || []).length;

    if (totalDataItems > maxIndex + 1) {
        return { shouldAdd: true, groupType, buttonId };
    }

    return { shouldAdd: false, groupType, buttonId };
}

/**
 * Sequentially or safely fills an array of field mappings into the active DOM.
 */
export async function executeFormFillStep(
    mappings: FieldMapping[],
    options?: FillStepOptions
): Promise<FillStepResult> {
    let filledCount = 0;
    const failedFields: string[] = [];

    let stealthMode = options?.stealthMode;
    let typingDelayMs = options?.typingDelayMs;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        try {
            const stored = await chrome.storage.local.get(['stealthMode', 'typingDelayMs']);
            if (stealthMode === undefined) {
                stealthMode = !!stored.stealthMode;
            }
            if (typingDelayMs === undefined) {
                typingDelayMs = stored.typingDelayMs !== undefined ? Number(stored.typingDelayMs) : (stored.stealthMode ? 25 : 0);
            }
        } catch {
            if (stealthMode === undefined) stealthMode = false;
            if (typingDelayMs === undefined) typingDelayMs = 0;
        }
    }

    const fillOpts = {
        resumeFileData: options?.resumeFileData,
        resumeFileName: options?.resumeFileName,
        autoSubmit: options?.autoSubmit,
        stealthMode,
        typingDelayMs: typingDelayMs ?? 0,
    };

    for (const mapping of mappings) {
        // Skip non-fill mappings like click_add
        if (mapping.action === 'click_add') continue;

        const value = mapping.selectedValue;
        if (value === undefined || value === null || value === '[MANUAL_INPUT_NEEDED]') {
            continue;
        }

        try {
            const success = await fillFormField(mapping, value, fillOpts);
            if (success) {
                filledCount++;
            } else {
                failedFields.push(mapping.id || mapping.fieldId);
            }
        } catch (err) {
            failedFields.push(mapping.id || mapping.fieldId);
            console.warn(`Aullevo: Field fill error for ${mapping.id || mapping.fieldId}:`, err);
        }
    }

    return {
        filledCount,
        total: mappings.filter((m) => m.action !== 'click_add').length,
        failedFields,
    };
}
