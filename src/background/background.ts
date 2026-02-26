import { geminiService } from '../services/geminiService';
import type { UserData, CustomField, ChromeResponse, FormField } from '../types';

/**
 * Background service worker for Aullevo.
 * Ctrl+M (toggle-sidebar command) → toggles the sidebar via content script.
 * Alt+F (via content script keydown) → triggers AI form fill directly.
 */

// ─── Rate limiter: minimum 500ms between Gemini API calls ───
let lastApiCallTime = 0;
function checkRateLimit(): boolean {
    const now = Date.now();
    if (now - lastApiCallTime < 500) return false;
    lastApiCallTime = now;
    return true;
}

// Listen for keyboard shortcut command
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-sidebar') {
        console.log('Aullevo: Ctrl+M — toggling sidebar!');
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' }).catch((err) => {
                console.warn('Aullevo: Sidebar toggle via shortcut failed (content script might not be loaded yet)', err);
            });
        }
    }
});

// Listen for extension icon click — toggle the sidebar (no popup)
chrome.action.onClicked.addListener((tab) => {
    if (!tab.id) return;
    chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' }).catch(() => {
        // Content script not ready — user needs to refresh the tab once after install/reload
        console.warn('Aullevo: Content script not loaded yet — refresh the page and try again.');
    });
});

// Listen for messages from popup and content script
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'triggerFillFromPopup') {
        runAIFill().then(() => sendResponse({ success: true }));
        return true;
    }

    // Sidebar fill — returns filledCount for sidebar status
    if (request.action === 'triggerFillFromSidebar') {
        (async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab?.id) return sendResponse({ success: false, error: 'No active tab found' });

                const tabId = tab.id;
                showBadge('⏳', '#7c5cfc');

                // Extract fields from content script
                const analyzeResp = await sendToTab(tabId, { action: 'analyzeForm' });
                if (!analyzeResp?.success) return sendResponse({ success: false, error: 'Could not analyze form' });

                const fields = analyzeResp.fields || [];
                if (fields.length === 0) return sendResponse({ success: false, error: 'No form fields found on this page' });

                // Process through AI
                const aiResult = await processFieldsAI(fields);
                if (!aiResult.success) return sendResponse({ success: false, error: aiResult.error });

                // Fill via content script
                const fillResp = await sendToTab(tabId, {
                    action: 'fillForm',
                    data: { fieldMappings: aiResult.mappings, userData: aiResult.userData }
                });

                const filledCount = fillResp?.filledCount ?? 0;
                showBadge(`${filledCount}`, '#34d399');
                setTimeout(clearBadge, 4000);

                sendResponse({ success: true, filledCount });
            } catch (err: any) {
                showBadge('✗', '#f87171');
                setTimeout(clearBadge, 3000);
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // Process form fields through AI and return resolved mappings
    // Used by the Alt+F keyboard shortcut (content script orchestration)
    if (request.action === 'processFieldsAI') {
        processFieldsAI(request.fields)
            .then(result => sendResponse(result))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    // SPA navigation events — ignore silently (sidebar handles its own rescan)
    if (request.action === 'urlChanged' || request.action === 'domChanged') {
        sendResponse({ success: true });
        return false;
    }
});

/* ─── Standard field keys from UserData ─── */
const STANDARD_FIELD_KEYS = new Set([
    'firstName', 'lastName', 'email', 'phone', 'address', 'city', 'state',
    'zipCode', 'country', 'linkedin', 'portfolio', 'github', 'summary',
    'headline', 'dateOfBirth', 'gender', 'salaryExpectation', 'noticePeriod',
    'workAuthorization', 'yearsOfExperience'
]);

/**
 * Process fields through AI and fully resolve ALL values before sending back.
 * The content script only needs to call fillFormField() — no value lookup needed.
 */
async function processFieldsAI(fields: FormField[]) {
    try {
        // 1. Get stored data
        const stored = await chrome.storage.local.get(['userData', 'geminiApiKey']);
        const userData = (stored.userData || {}) as Partial<UserData>;
        const apiKey = (stored.geminiApiKey || '') as string;

        if (apiKey) {
            geminiService.setApiKey(apiKey);
        }

        if (!apiKey) {
            return { success: false, error: 'No API key found. Save your Gemini API key in the extension settings.' };
        }

        // Rate limit guard
        if (!checkRateLimit()) {
            return { success: false, error: 'Please wait a moment before requesting another fill.' };
        }

        // 2. Get AI mappings
        const customFields = migrateCustomFields(userData.customFields);
        const fieldMappings = await geminiService.analyzeFormFields(fields, customFields);

        if (!fieldMappings || fieldMappings.length === 0) {
            console.warn('Aullevo: AI returned 0 mappings for', fields.length, 'fields');
            return { success: true, mappings: [], addButtons: [], userData };
        }

        // 3. Resolve ALL values — standard, custom, array, and questions
        for (const mapping of fieldMappings) {
            if (mapping.action === 'click_add') continue;

            // A. Custom questions — ask AI
            if (mapping.fieldType === 'custom_question' && mapping.originalQuestion) {
                try {
                    const answer = await geminiService.answerFormQuestion(mapping.originalQuestion, userData);
                    mapping.selectedValue = answer;
                } catch (e: any) {
                    console.warn('Aullevo: Failed to answer question:', e.message);
                }
                continue;
            }

            // B. Custom fields — user-defined key/value pairs
            if (mapping.fieldType?.startsWith('custom_field:')) {
                const label = mapping.fieldType.slice('custom_field:'.length);
                const match = customFields.find(cf => cf.label === label);
                if (match) mapping.selectedValue = match.value;
                continue;
            }

            // C. Array mapping (experience, education, skills in groups)
            if (mapping.groupType && typeof mapping.groupIndex === 'number') {
                let arraySource: any[] = [];
                if (mapping.groupType === 'experience') arraySource = userData.experience || [];
                if (mapping.groupType === 'education') arraySource = userData.education || [];
                if (mapping.groupType === 'skill') arraySource = userData.skills || [];

                const item = arraySource[mapping.groupIndex];
                if (item) {
                    if (typeof item === 'object' && item !== null && mapping.fieldType && mapping.fieldType in item) {
                        mapping.selectedValue = String((item as any)[mapping.fieldType]);
                    } else if (mapping.groupType === 'skill') {
                        mapping.selectedValue = String(item);
                    }
                }
                continue;
            }

            // D. Standard fields (firstName, email, phone, etc.) — resolve from userData
            //    Only resolve if selectedValue is not already set by the AI (e.g. for selects)
            if (!mapping.selectedValue && mapping.fieldType && STANDARD_FIELD_KEYS.has(mapping.fieldType)) {
                const val = (userData as any)[mapping.fieldType];
                if (val !== undefined && val !== null && val !== '') {
                    if (Array.isArray(val)) {
                        mapping.selectedValue = val.join(', ');
                    } else {
                        mapping.selectedValue = String(val);
                    }
                }
            }
        }

        // 4. Split into fill mappings and add buttons
        const fillMappings = fieldMappings.filter(m => m.action !== 'click_add');
        const addButtons = fieldMappings.filter(m => m.action === 'click_add');

        console.log(`Aullevo AI: ${fillMappings.length} fill mappings, ${addButtons.length} add buttons`);

        return {
            success: true,
            mappings: fillMappings,
            addButtons: addButtons,
            userData
        };

    } catch (error: any) {
        console.error('Aullevo processFieldsAI error:', error);
        
        // Specific error handling
        const msg = error.message || String(error);
        if (msg.includes('429') || msg.includes('Rate limit') || msg.toLowerCase().includes('rate')) {
            return { success: false, error: '⏱️ Rate limit exceeded. Wait 30 seconds and try again.' };
        }
        if (msg.includes('500') || msg.includes('server error')) {
            return { success: false, error: '🔧 Gemini server error. Try again in a moment.' };
        }
        
        return { success: false, error: msg || 'AI processing failed' };
    }
}

/* ─── Ctrl+M / popup flow (background-orchestrated) ─── */

async function runAIFill() {
    try {
        // 1. Get stored data
        const stored = await chrome.storage.local.get(['userData', 'geminiApiKey']);
        const userData = (stored.userData || {}) as Partial<UserData>;
        const apiKey = (stored.geminiApiKey || '') as string;

        if (apiKey) {
            geminiService.setApiKey(apiKey);
        }

        // 2. Get active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
            console.error('Aullevo: No active tab found');
            showBadge('!', '#f87171');
            return;
        }

        const tabId = tab.id;

        // Show "working" badge
        showBadge('⏳', '#7c5cfc');

        // 3. Run the fill loop
        await processFormStep(tabId, userData, 0);

    } catch (error: any) {
        console.error('Aullevo shortcut error:', error);
        showBadge('✗', '#f87171');
        setTimeout(() => clearBadge(), 3000);
    }
}

async function processFormStep(tabId: number, userData: Partial<UserData>, step: number) {
    // Hard cap on steps to prevent infinite loops
    if (step > 10) {
        showBadge('✓', '#34d399');
        setTimeout(() => clearBadge(), 4000);
        return;
    }

    try {
        // 1. Analyze form via content script
        const response = await sendToTab(tabId, { action: 'analyzeForm' });
        if (!response?.success) {
            showBadge('✗', '#f87171');
            setTimeout(() => clearBadge(), 3000);
            return;
        }

        const fields: FormField[] = response.fields || [];
        let needsReAnalysis = false;

        if (fields.length > 0) {
            // 2. Get AI mappings
            const customFields = migrateCustomFields(userData.customFields);
            const fieldMappings = await geminiService.analyzeFormFields(fields, customFields);

            // 3. Resolve custom questions and custom fields
            for (const mapping of fieldMappings) {
                if (mapping.fieldType === 'custom_question' && mapping.originalQuestion) {
                    const answer = await geminiService.answerFormQuestion(mapping.originalQuestion, userData);
                    mapping.selectedValue = answer;
                }

                if (mapping.fieldType?.startsWith('custom_field:')) {
                    const label = mapping.fieldType.slice('custom_field:'.length);
                    const match = customFields.find(cf => cf.label === label);
                    if (match) mapping.selectedValue = match.value;
                }

                // Array mapping
                if (mapping.groupType && typeof mapping.groupIndex === 'number' && mapping.action !== 'click_add') {
                    let arraySource: any[] = [];
                    if (mapping.groupType === 'experience') arraySource = userData.experience || [];
                    if (mapping.groupType === 'education') arraySource = userData.education || [];
                    if (mapping.groupType === 'skill') arraySource = userData.skills || [];

                    const item = arraySource[mapping.groupIndex];
                    if (item) {
                        if (typeof item === 'object' && item !== null && mapping.fieldType in item) {
                            mapping.selectedValue = (item as any)[mapping.fieldType];
                        } else if (mapping.groupType === 'skill') {
                            mapping.selectedValue = String(item);
                        }
                    }
                }
            }

            // 4. Fill
            const fillMappings = fieldMappings.filter(m => m.action !== 'click_add');
            const fillResponse = await sendToTab(tabId, {
                action: 'fillForm',
                data: { fieldMappings: fillMappings, userData }
            });

            const filledCount = fillResponse?.filledCount ?? 0;

            if (fillResponse?.success) {
                showBadge(`${filledCount}`, '#34d399');
            }

            // ★ STOP if we filled 0 fields — no point continuing
            if (filledCount === 0 && !needsReAnalysis) {
                console.log('Aullevo: Filled 0 fields, stopping.');
                showBadge('✓', '#34d399');
                setTimeout(() => clearBadge(), 4000);
                return;
            }

            // 5. Handle "Add" buttons
            const addButtons = fieldMappings.filter(m => m.action === 'click_add');
            for (const btn of addButtons) {
                if (!btn.groupType) continue;

                const currentIndices = fieldMappings
                    .filter(m => m.groupType === btn.groupType && typeof m.groupIndex === 'number')
                    .map(m => m.groupIndex!);
                const maxIndex = currentIndices.length > 0 ? Math.max(...currentIndices) : -1;

                let totalDataItems = 0;
                if (btn.groupType === 'experience') totalDataItems = (userData.experience || []).length;
                if (btn.groupType === 'education') totalDataItems = (userData.education || []).length;

                if (totalDataItems > maxIndex + 1) {
                    await sendToTab(tabId, {
                        action: 'fillForm',
                        data: { fieldMappings: [{ ...btn }] }
                    });
                    await sleep(1500);
                    needsReAnalysis = true;
                    break;
                }
            }
        }

        if (needsReAnalysis) {
            await sleep(500);
            await processFormStep(tabId, userData, step + 1);
            return;
        }

        // 6. Try clicking Next — but ONLY if we actually filled something this step
        await sleep(1000);
        const nextResponse = await sendToTab(tabId, { action: 'clickNext' });

        if (nextResponse?.success) {
            await sleep(3000);
            await processFormStep(tabId, userData, step + 1);
        } else {
            // Done!
            showBadge('✓', '#34d399');
            setTimeout(() => clearBadge(), 4000);
        }

    } catch (error: any) {
        console.error('Aullevo fill step error:', error);
        showBadge('✗', '#f87171');
        setTimeout(() => clearBadge(), 3000);
    }
}

/* ─── Helpers ─── */

function sendToTab(tabId: number, message: any): Promise<ChromeResponse> {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError);
                resolve({ success: false, message: chrome.runtime.lastError.message });
            } else {
                resolve(response);
            }
        });
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

function migrateCustomFields(raw: any): CustomField[] {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
        return Object.entries(raw).map(([key, value]) => ({
            label: key,
            value: String(value),
            context: '',
        }));
    }
    return [];
}

function showBadge(text: string, color: string) {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
}

function clearBadge() {
    chrome.action.setBadgeText({ text: '' });
}

console.log('🚗 Aullevo background service worker loaded!');
