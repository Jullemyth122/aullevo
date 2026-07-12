import { createRoot } from 'react-dom/client';
import Sidebar from './Sidebar';
import {
    extractFormFields,
    fillFormField,
    clickNextButton,
    clickPrevButton,
    clickElement,
    detectPageCaptcha,
    findChatInputField,
    extractChatContext,
    fillChatInputField,
    submitChatField,
} from '../services/formAnalyzer';
import type { ChromeMessage, ChromeResponse, FieldMapping, UserData } from '../types';

import './sidebar.css';

/* ═══════════════════════════════════════════════════
   REACT SIDEBAR INJECTION (Shadow DOM)
   ═══════════════════════════════════════════════════ */

function injectSidebar() {
    const HOST_ID = 'aullevo-sidebar-host';
    if (document.getElementById(HOST_ID)) return;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;top:0;right:0;width:0;height:0;z-index:2147483646;pointer-events:none;';
    document.body.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: 'open' });

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('assets/content.css');
    shadowRoot.appendChild(link);

    const rootElement = document.createElement('div');
    rootElement.id = 'aullevo-react-root';
    rootElement.style.pointerEvents = 'auto';
    shadowRoot.appendChild(rootElement);

    const root = createRoot(rootElement);
    root.render(<Sidebar />);
}

/* ═══════════════════════════════════════════════════
   SHADOW DOM TOAST SYSTEM — fully isolated from page CSS
   ═══════════════════════════════════════════════════ */

let _toastShadowRoot: ShadowRoot | null = null;

function getToastShadowRoot(): ShadowRoot {
    if (_toastShadowRoot) return _toastShadowRoot;

    const TOAST_HOST_ID = 'aullevo-toast-host';
    let toastHost = document.getElementById(TOAST_HOST_ID);
    if (!toastHost) {
        toastHost = document.createElement('div');
        toastHost.id = TOAST_HOST_ID;
        toastHost.style.cssText =
            'position:fixed;top:0;right:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
        document.body.appendChild(toastHost);
    }

    const shadow = toastHost.shadowRoot || toastHost.attachShadow({ mode: 'open' });
    if (!shadow.querySelector('style')) {
        const style = document.createElement('style');
        style.textContent = `
            #aullevo-toast {
                position: fixed;
                top: 20px;
                right: 20px;
                max-width: 360px;
                padding: 12px 20px;
                border-radius: 12px;
                font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
                font-size: 13px;
                font-weight: 500;
                color: #fff;
                box-shadow: 0 8px 32px rgba(0,0,0,0.35);
                pointer-events: none;
                line-height: 1.5;
                opacity: 0;
                transform: translateY(-8px);
                transition: opacity 0.25s ease, transform 0.25s ease;
                z-index: 1;
            }
            #aullevo-toast.visible {
                opacity: 1;
                transform: translateY(0);
            }
        `;
        shadow.appendChild(style);
    }

    _toastShadowRoot = shadow;
    return shadow;
}

let _toastEl: HTMLElement | null = null;
let _toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(text: string, type: 'info' | 'success' | 'error' = 'info', duration = 4500) {
    const shadow = getToastShadowRoot();

    if (!_toastEl) {
        _toastEl = document.createElement('div');
        _toastEl.id = 'aullevo-toast';
        shadow.appendChild(_toastEl);
    }

    const colors: Record<string, string> = {
        info: 'linear-gradient(135deg, #3B82F6, #6366F1)',
        success: 'linear-gradient(135deg, #10B981, #059669)',
        error: 'linear-gradient(135deg, #EF4444, #DC2626)',
    };

    _toastEl.style.background = colors[type];
    _toastEl.textContent = text;
    _toastEl.classList.remove('visible');
    void _toastEl.offsetHeight;
    _toastEl.classList.add('visible');

    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => hideToast(), duration);
}

function hideToast() {
    if (_toastEl) _toastEl.classList.remove('visible');
}

/* ═══════════════════════════════════════════════════
   SPA WATCHER — detect route changes and form mutations
   ═══════════════════════════════════════════════════ */

function safeSendMessage(msg: any) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
        try {
            chrome.runtime.sendMessage(msg).catch(() => { });
        } catch (e) {
            // context invalidated, ignore
        }
    }
}

function initSPAWatcher() {
    let lastUrl = location.href;
    let mutationTimer: ReturnType<typeof setTimeout> | null = null;

    const domObserver = new MutationObserver(() => {
        if (mutationTimer) clearTimeout(mutationTimer);
        mutationTimer = setTimeout(() => {
            safeSendMessage({ action: 'domChanged' });
        }, 1000);
    });

    domObserver.observe(document.body, { childList: true, subtree: true });

    const urlCheckInterval = setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            safeSendMessage({ action: 'urlChanged', url: location.href });
        }
    }, 600);

    const _push = history.pushState.bind(history);
    const _replace = history.replaceState.bind(history);
    history.pushState = (...args) => {
        _push(...args);
        safeSendMessage({ action: 'urlChanged', url: location.href });
    };
    history.replaceState = (...args) => {
        _replace(...args);
        safeSendMessage({ action: 'urlChanged', url: location.href });
    };
    window.addEventListener('popstate', () => {
        safeSendMessage({ action: 'urlChanged', url: location.href });
    });

    window.addEventListener('beforeunload', () => {
        domObserver.disconnect();
        clearInterval(urlCheckInterval);
    });
}

/* ═══════════════════════════════════════════════════
   INITIALIZE
   ═══════════════════════════════════════════════════ */

function init() {
    // Only inject sidebar in the top-level frame, not inside iframes
    if (window === window.top) {
        injectSidebar();
        initSPAWatcher();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

/* ═══════════════════════════════════════════════════
   FIELD AGGREGATION — main frame
   ═══════════════════════════════════════════════════ */

/**
 * Extract form fields from the main frame.
 */
async function extractAllFields(): Promise<{ fields: import('../types').FormField[]; hasCaptcha: boolean; captchaTypes: string[] }> {
    // 1. Main frame fields
    const mainFields = extractFormFields();

    // 2. Detect CAPTCHA on page
    const captchaResult = detectPageCaptcha();

    return {
        fields: mainFields,
        hasCaptcha: captchaResult.found,
        captchaTypes: captchaResult.types,
    };
}

/* ═══════════════════════════════════════════════════
   MESSAGE HANDLER — popup / background orchestration
   ═══════════════════════════════════════════════════ */

chrome.runtime.onMessage.addListener(
    (request: ChromeMessage, _sender, sendResponse: (response: ChromeResponse) => void) => {

        if (request.action === 'analyzeForm') {
            // Use async aggregation (main frame + iframes)
            extractAllFields().then(({ fields, hasCaptcha, captchaTypes }) => {
                if (hasCaptcha) {
                    showToast(
                        `🔒 CAPTCHA detected (${captchaTypes.join(', ')}) — manual input required`,
                        'error',
                        6000
                    );
                }
                sendResponse({ success: true, fields });
            });
            return true;
        }

        if (request.action === 'fillForm') {
            (async () => {
                try {
                    const mappings = (request.data?.fieldMappings || []) as FieldMapping[];
                    const resumeFileData = request.data?.resumeFileData;
                    const resumeFileName = request.data?.resumeFileName;
                    const result = await chrome.storage.local.get("autoSubmit");
                    const autoSubmit = result.autoSubmit as boolean;
                    let filledCount = 0;
                    for (const mapping of mappings) {
                        try {
                             if (mapping.selectedValue !== undefined) {
                                 if (await fillFormField(mapping, mapping.selectedValue, { resumeFileData, resumeFileName, autoSubmit })) {
                                     filledCount++;
                                 }
                             }
                        } catch (err) { }
                    }
                    sendResponse({ success: true, filledCount, total: mappings.length });
                } catch (err: any) {
                    sendResponse({ success: false, error: err.message });
                }
            })();
            return true;
        }

        if (request.action === 'clickNext') {
            const { success, message } = clickNextButton();
            sendResponse({ success, message });
            return false;
        }

        if (request.action === 'clickPrev') {
            const { success, message } = clickPrevButton();
            sendResponse({ success, message });
            return false;
        }

        return false;
    }
);

/* ═══════════════════════════════════════════════════
   KEYBOARD SHORTCUT — Alt+F triggers AI fill directly
   ═══════════════════════════════════════════════════ */

function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

function sendToBackground(message: any): Promise<any> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Aullevo content→background error:', chrome.runtime.lastError);
                resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
                resolve(response);
            }
        });
    });
}

async function runShortcutFill() {
    // 1. First, check if the user is focused inside a Chat or contenteditable field
    const chatInput = findChatInputField();

    if (chatInput) {
        showToast('💬 Chat window detected. Gathering context...', 'info', 3000);

        // Extract recent messages from the DOM
        const conversationHistory = extractChatContext(chatInput);

        showToast('✨ Constructing RAG response via Gemini...', 'info', 3000);

        // Let the background script handle storage and Gemini
        const aiResponse = await sendToBackground({
            action: 'processChatAI',
            conversationHistory
        });

        if (aiResponse?.success && aiResponse.replyText) {
            const isError = aiResponse.replyText.includes("[Error") || aiResponse.replyText.includes("I'm sorry");
            const injectionSuccess = fillChatInputField(chatInput, aiResponse.replyText);

            if (injectionSuccess) {
                showToast('✅ Response loaded into chat box!', 'success');

                if (!isError) {
                    const storage = await chrome.storage.local.get("autoSubmit");
                    if (storage.autoSubmit) {
                        setTimeout(() => submitChatField(chatInput), 300);
                    }
                }
            } else {
                showToast('⚠️ Response generated, but DOM injection failed.', 'error');
            }
        } else {
            const errorMsg = aiResponse?.error || 'Gemini could not generate a reply from your data.';
            showToast(`❌ ${errorMsg}`, 'error');
        }

        return; // Stop here so traditional form filling doesn't run concurrently
    }

    // 2. Fallback to your original form processing system if no chat interface is active
    showToast('🚗 Aullevo: Starting AI Fill...', 'info', 3000);

    let totalFilled = 0;
    const fingerprintHistory: string[] = [];
    const maxSteps = 30;

    for (let step = 0; step < maxSteps; step++) {
        // ── Collect fields from main frame + all iframes ──
        const { fields, hasCaptcha, captchaTypes } = await extractAllFields();

        // ── CAPTCHA warning ──
        if (hasCaptcha) {
            showToast(
                `🔒 CAPTCHA detected (${captchaTypes.join(', ')}) — fill the CAPTCHA manually, then press Alt+F again`,
                'error',
                8000
            );
            return; // Stop — user must solve CAPTCHA first
        }

        if (fields.length === 0) {
            if (step === 0) showToast('❌ No form fields found on this page', 'error');
            break;
        }

        showToast(`🤖 Analyzing ${fields.length} field${fields.length !== 1 ? 's' : ''}...`, 'info', 8000);

        // Pass current tab URL so background can key the cache correctly
        const aiResponse = await sendToBackground({
            action: 'processFieldsAI',
            fields,
            tabUrl: location.href,
        });

        if (!aiResponse?.success) {
            const errorMsg = aiResponse?.error || 'Unknown error';
            showToast(`❌ ${errorMsg}`, 'error');
            return;
        }

        const mappings: FieldMapping[] = aiResponse.mappings || [];
        const addButtons: FieldMapping[] = aiResponse.addButtons || [];
        const userData: Partial<UserData> = aiResponse.userData || {};

        if (mappings.length === 0) {
            showToast('⚠️ AI could not match any fields. Check your saved data.', 'error');
            return;
        }

        // Loop safety / Fingerprint check
        const currentFingerprint = JSON.stringify(
            mappings.map(m => ({ id: m.id, value: m.selectedValue }))
        );
        if (fingerprintHistory.includes(currentFingerprint)) {
            showToast('⚠️ Stuck step detected (same values in same fields). Stopping.', 'error', 6000);
            break;
        }
        fingerprintHistory.push(currentFingerprint);

        // Fill fields
        let filledCount = 0;
        for (const mapping of mappings) {
            const value = mapping.selectedValue;
            if (value) {
                const success = await fillFormField(mapping, value);
                if (success) filledCount++;
            }
        }

        totalFilled += filledCount;

        if (filledCount === 0) {
            showToast(`✅ Done! Total: ${totalFilled} field${totalFilled !== 1 ? 's' : ''} filled.`, 'success');
            return;
        }

        showToast(`✅ Filled ${filledCount} field${filledCount !== 1 ? 's' : ''}`, 'success');

        // Handle Add buttons
        let needsReAnalysis = false;
        for (const addMapping of addButtons) {
            if (!addMapping.groupType || !addMapping.id) continue;

            const currentIndices = mappings
                .filter(m => m.groupType === addMapping.groupType && typeof m.groupIndex === 'number')
                .map(m => m.groupIndex!);
            const maxIndex = currentIndices.length > 0 ? Math.max(...currentIndices) : -1;

            let totalDataItems = 0;
            if (addMapping.groupType === 'experience') totalDataItems = ((userData as any).experience || []).length;
            if (addMapping.groupType === 'education') totalDataItems = ((userData as any).education || []).length;

            if (totalDataItems > maxIndex + 1) {
                showToast(`➕ Adding another ${addMapping.groupType}...`, 'info');
                clickElement(addMapping.id);
                await sleep(1500);
                needsReAnalysis = true;
                break;
            }
        }

        if (needsReAnalysis) {
            await sleep(500);
            continue;
        }

        // Try clicking Next
        if (filledCount > 0) {
            await sleep(1000);
            const nextResult = clickNextButton();
            if (nextResult.success) {
                showToast('➡️ Moving to next step...', 'info');
                await sleep(3000);
                continue;
            }
        }

        break;
    }

    showToast(`✅ Complete! Filled ${totalFilled} field${totalFilled !== 1 ? 's' : ''} total.`, 'success');
}

// Prevent re-entry
let isRunning = false;

document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        e.stopPropagation();

        if (isRunning) {
            showToast('⏳ Already running, please wait...', 'info');
            return;
        }

        isRunning = true;
        runShortcutFill()
            .catch(err => {
                console.error('Aullevo shortcut error:', err);
                showToast(`❌ Error: ${err.message}`, 'error');
            })
            .finally(() => {
                isRunning = false;
            });
    }
});

console.log('🚗 Aullevo content script loaded! Press Alt+F to fill, Alt+A to toggle sidebar.');