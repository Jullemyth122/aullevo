import { GoogleGenAI } from '@google/genai';
import type { CM, Memory, UserData } from '../types';

// ---------------------------------------------------------------------------
// 1. Supported Models
// ---------------------------------------------------------------------------

export const GEMINI_MODELS = [
    { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite (Fastest & Ultra-Cheap)', recommended: true },
    { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash (Balanced Reasoning)' },
    { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash (Fast & Capable)' },
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Highest Intelligence)' },
    { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite (Legacy Fast)' }
] as const;

export type GeminiModelId = typeof GEMINI_MODELS[number]['id'];

export const FREE_TIER_WEEKLY_LIMIT = 10;

// ---------------------------------------------------------------------------
// Hosted AI Backend (Aullevo proxy that holds the shared Gemini key)
// Set VITE_AULLEVO_AI_PROXY_URL in .env once the backend is deployed.
// Until then, users without their own key get a clear message instead of a silent failure.
// ---------------------------------------------------------------------------

export const AULLEVO_AI_PROXY_URL: string = (import.meta.env.VITE_AULLEVO_AI_PROXY_URL ?? '').trim();

export function isHostedAiAvailable(): boolean {
    return AULLEVO_AI_PROXY_URL.length > 0;
}

// Usage counter is bucketed per ISO week (Monday–Sunday), e.g. "2026-W40"
export function getCurrentUsageWeek(date: Date = new Date()): string {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7;           // Mon=1 … Sun=7
    d.setUTCDate(d.getUTCDate() + 4 - day);   // the week's Thursday decides its year
    const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
    const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Returns this week's usage count, treating a count from a previous week as 0
export function getEffectiveUsageCount(storedCount: unknown, storedWeek: unknown): number {
    if (typeof storedCount !== 'number') return 0;
    return storedWeek === getCurrentUsageWeek() ? storedCount : 0;
}

export function checkAiPermission(
    isPro: boolean,
    hasApiKey: boolean,
    usageCount: number
): { allowed: boolean; reason?: string } {
    // 1. Free plan: limited AI fills per week, even with the user's own Gemini key
    if (!isPro && usageCount >= FREE_TIER_WEEKLY_LIMIT) {
        return {
            allowed: false,
            reason: `Free plan limit reached (${FREE_TIER_WEEKLY_LIMIT}/${FREE_TIER_WEEKLY_LIMIT} AI fills this week, resets Monday). Upgrade to Pro for unlimited AI fills.`
        };
    }

    // 2. Something has to run the AI: the user's own key, or the hosted backend
    if (!hasApiKey && !isHostedAiAvailable()) {
        return {
            allowed: false,
            reason: 'Add your free Gemini API key in Settings to use AI Smart Fill.'
        };
    }

    // Pro: unlimited. Free: under the weekly limit.
    return { allowed: true };
}

/** Whether this AI fill counts toward the Free plan's weekly limit (Pro is never counted). */
export function countsTowardFreeLimit(isPro: boolean): boolean {
    return !isPro;
}

// ---------------------------------------------------------------------------
// 2. Data Interfaces
// ---------------------------------------------------------------------------

export interface AiQuestionToResolve {
    id: string;
    label: string;
    type: 'text' | 'textarea' | 'radio' | 'checkbox' | 'select';
    options?: string[];
    context?: string;
}

// Privacy Schema: Sent to AI without ANY private values
export interface AiPrivacyFieldRef {
    key: string;       // e.g. "phone", "email", "customField_1"
    label: string;     // e.g. "Primary Phone"
    context?: string;  // e.g. "Mobile number" (NO raw phone numbers)
}

export interface AiResolutionAnswer {
    id: string;
    matchedKey?: string;     // If this question maps to a single local profile field
    matchedKeys?: string[];  // If this question maps to multiple combined fields (e.g. ["firstName", "middleName", "lastName"])
    answer?: string;         // If it's a radio option ("Yes") or synthesized essay
}

export interface AiResolutionResult {
    answers: AiResolutionAnswer[];
    tokensUsed: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
    };
    error?: string;
}


export function isFieldSensitive(cm?: CM): boolean {
    return Boolean(cm?.isSensitive);
}


// ---------------------------------------------------------------------------
// 3. Privacy Sanitizer: Strips ALL `value` properties completely!
// ---------------------------------------------------------------------------

export function extractPrivacySafeFields(profile: UserData): AiPrivacyFieldRef[] {
    const fields: AiPrivacyFieldRef[] = [];

    Object.entries(profile).forEach(([key, val]) => {
        if (!val || key === 'id' || key === 'files' || key === 'profileType' || key === 'profileName') {
            return;
        }

        // Case A: Array of CMs (e.g. skills, customFields)
        if (Array.isArray(val)) {
            val.forEach((item, index) => {
                if (item && item.enabled) {
                    const sensitive = isFieldSensitive(item);
                    fields.push({
                        key: `${key}[${index}]`,
                        label: item.label || `${key} #${index + 1}`,
                        // If sensitive: hide value. If non-sensitive: provide value for reasoning!
                        context: sensitive
                            ? item.context || undefined
                            : (item.value?.trim() ? `Value: ${item.value.trim()}` : item.context || undefined)
                    });
                }
            });
            return;
        }

        // Case B: Single CM object (e.g. phone, address, status, headline)
        if (typeof val === 'object' && 'enabled' in val && (val as CM).enabled) {
            const cm = val as CM;
            const sensitive = isFieldSensitive(cm);
            fields.push({
                key,
                label: cm.label?.trim() || key,
                // If sensitive: hide value. If non-sensitive: provide value for reasoning!
                context: sensitive
                    ? cm.context?.trim() || undefined
                    : (cm.value?.trim() ? `Value: ${cm.value.trim()}` : cm.context?.trim() || undefined)
            });
        }
    });

    return fields;
}


// ---------------------------------------------------------------------------
// Helper: Resolves a privacy-safe key back to the actual stored value
// This runs LOCALLY in the service worker — values never leave the browser
// ---------------------------------------------------------------------------

export function resolveFieldValue(profile: UserData, matchedKey: string | string[]): string | null {
    if (!profile || !matchedKey) return null;

    // Case 1: Array of keys (e.g. ["firstName", "middleName", "lastName"])
    if (Array.isArray(matchedKey)) {
        const parts = matchedKey
            .map(k => resolveSingleFieldValue(profile, k))
            .filter((val): val is string => Boolean(val && val.trim()));
        return parts.length > 0 ? parts.join(' ') : null;
    }

    // Case 2: String containing '+' or ',' combination (e.g. "firstName + lastName")
    if (typeof matchedKey === 'string' && (matchedKey.includes('+') || matchedKey.includes(','))) {
        const keys = matchedKey.split(/[+,]/).map(k => k.trim()).filter(Boolean);
        const parts = keys
            .map(k => resolveSingleFieldValue(profile, k))
            .filter((val): val is string => Boolean(val && val.trim()));
        return parts.length > 0 ? parts.join(' ') : null;
    }

    return resolveSingleFieldValue(profile, matchedKey);
}

function resolveSingleFieldValue(profile: UserData, rawKey: string): string | null {
    if (!profile || !rawKey) return null;
    const key = rawKey.trim();

    // Case 1: Array key like "customFields[2]" or "skills[0]"
    const arrayMatch = key.match(/^(.+)\[(\d+)\]$/);
    if (arrayMatch) {
        const [, arrayName, indexStr] = arrayMatch;
        const arr = (profile as any)[arrayName];
        if (Array.isArray(arr)) {
            const item = arr[parseInt(indexStr, 10)];
            if (item && item.value) return item.value;
        }
    }

    // Case 2: Direct property key like "firstName", "email", "desiredSalary"
    const directField = (profile as any)[key];
    if (directField && typeof directField === 'object' && 'value' in directField) {
        return (directField as CM).value || null;
    }

    // Case 3: Match by label text (AI might return the label instead of the key)
    for (const [, val] of Object.entries(profile)) {
        if (!val) continue;

        if (Array.isArray(val)) {
            for (const item of val) {
                if (item && item.label && cleanLabel(item.label) === cleanLabel(key)) {
                    return item.value || null;
                }
            }
        } else if (typeof val === 'object' && 'label' in val) {
            if (cleanLabel((val as CM).label) === cleanLabel(key)) {
                return (val as CM).value || null;
            }
        }
    }

    return null;
}

function cleanLabel(s: string): string {
    return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}


// ---------------------------------------------------------------------------
// Transport: same request shape for both paths, so the proxy just forwards it
// ---------------------------------------------------------------------------

interface GeminiRequest {
    model: string;
    contents: string;
    config: { responseMimeType: string; temperature: number };
}

interface GeminiResponseLike {
    text?: string;
    usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
    };
}

async function callGeminiDirect(apiKey: string, request: GeminiRequest): Promise<GeminiResponseLike> {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent(request);
    return { text: response.text, usageMetadata: response.usageMetadata };
}

// Backend contract: POST { model, contents, config } → { text, usageMetadata }
async function callHostedProxy(request: GeminiRequest): Promise<GeminiResponseLike> {
    const res = await fetch(AULLEVO_AI_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
    });
    if (!res.ok) {
        throw new Error(`Hosted AI request failed (HTTP ${res.status}).`);
    }
    return await res.json() as GeminiResponseLike;
}


// ---------------------------------------------------------------------------
// 4. Main Batch AI Resolution Engine (Zero-Knowledge)
// ---------------------------------------------------------------------------

export async function resolveFormQuestionsWithAI(
    apiKey: string,
    questions: AiQuestionToResolve[],
    profile: UserData,
    memories: Memory[] = [],
    modelName: string = 'gemini-3.5-flash-lite'
): Promise<AiResolutionResult> {
    const hasOwnKey = Boolean(apiKey?.trim());

    if (!hasOwnKey && !isHostedAiAvailable()) {
        return {
            answers: [],
            tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            error: 'No Gemini API key provided and hosted AI is not available yet. Add your key in Settings.'
        };
    }

    if (!questions || questions.length === 0) {
        return {
            answers: [],
            tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
        };
    }

    try {
        // 1. Extract ONLY labels and context — ZERO raw values!
        const privacySafeFields = extractPrivacySafeFields(profile);

        // 2. Include enabled non-sensitive memories
        const activeMemories = memories
            .filter(m => m.enabled && m.content?.trim())
            .map(m => `${m.title}: ${m.content}`);

        // 3. Zero-Knowledge semantic matching prompt
        const systemPrompt = `You are Aullevo, a privacy-first autofill engine.
            You are given a list of questions from a web form and a catalog of available User Profile Field references (Keys, Labels, and Context notes).
            Notice: For privacy, values of sensitive fields are NOT provided to you. Non-sensitive fields may include "Value: ..." in their context.

            Your task:
            1. For text/textarea fields that correspond to a single profile field, return "matchedKey": "field_key".
            2. If a question requires COMBINING multiple profile fields (e.g. "Full Name" or "Full Legal Name" = ["firstName", "middleName", "lastName"] or ["firstName", "lastName"], or full address parts), return "matchedKeys" as an array of ALL relevant profile field keys in order. Any number of keys can be combined (2, 3, or more). Only include keys that exist in the profile catalog.
            3. For multiple choice questions (radio, dropdown, select, checkbox): ALWAYS select the most reasonable option from the provided options list. Use profile context if available, otherwise use your best professional judgment. Return the verbatim option text in the "answer" property.
            4. For text/textarea fields with NO matching profile field, return a brief professional answer in the "answer" property if you can reasonably infer one.
            5. Only leave matchedKey/matchedKeys and answer empty if the question is completely unanswerable.
            6. Return ONLY a valid JSON array of objects with format:
            [ { "id": "question_id", "matchedKey": "field_key" } ] OR [ { "id": "question_id", "matchedKeys": ["key1", "key2", "key3"] } ] OR [ { "id": "question_id", "answer": "Selected Option" } ]`;

        const userPrompt = JSON.stringify({
            availableProfileFields: privacySafeFields,
            generalMemories: activeMemories,
            questionsToResolve: questions.map(q => ({
                id: q.id,
                question: q.label,
                type: q.type,
                options: q.options || []
            }))
        });

        // 4. Execute API call: own key → Gemini directly, otherwise → Aullevo hosted proxy
        const request: GeminiRequest = {
            model: modelName,
            contents: `${systemPrompt}\n\nInput:\n${userPrompt}`,
            config: {
                responseMimeType: 'application/json',
                temperature: 0.1
            }
        };
        const response = hasOwnKey
            ? await callGeminiDirect(apiKey.trim(), request)
            : await callHostedProxy(request);

        const rawText = response.text?.trim() || '[]';
        let parsedAnswers: AiResolutionAnswer[] = [];

        try {
            const cleanJson = rawText.replace(/^```json/i, '').replace(/```$/, '').trim();
            parsedAnswers = JSON.parse(cleanJson);
        } catch (parseErr) {
            console.warn('[Aullevo:AI] Failed to parse JSON response:', rawText, parseErr);
        }

        const inputTokens = response.usageMetadata?.promptTokenCount || 0;
        const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
        const totalTokens = response.usageMetadata?.totalTokenCount || (inputTokens + outputTokens);

        return {
            answers: Array.isArray(parsedAnswers) ? parsedAnswers : [],
            tokensUsed: { inputTokens, outputTokens, totalTokens }
        };

    } catch (err: any) {
        console.error('[Aullevo:AI] Generation error:', err);
        return {
            answers: [],
            tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            error: err.message || 'AI generation failed.'
        };
    }
}
