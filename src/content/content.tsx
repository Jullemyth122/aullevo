import { createRoot } from 'react-dom/client';
import Sidebar from './Sidebar';
import { extractFormFields, fillFormField, clickNextButton, clickElement } from '../services/formAnalyzer';
import type { ChromeMessage, ChromeResponse, CustomField, FieldMapping, UserData } from '../types';

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

    // Inject compiled CSS into the Shadow DOM
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
    // Inject base styles
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
        info: 'linear-gradient(135deg, #7c5cfc, #5b3fd4)',
        success: 'linear-gradient(135deg, #34d399, #059669)',
        error: 'linear-gradient(135deg, #f87171, #dc2626)',
    };

    _toastEl.style.background = colors[type];
    _toastEl.textContent = text;
    _toastEl.classList.remove('visible');

    // Force reflow to restart CSS transition
    void _toastEl.offsetHeight;
    _toastEl.classList.add('visible');

    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => hideToast(), duration);
}

function hideToast() {
    if (_toastEl) {
        _toastEl.classList.remove('visible');
    }
}

/* ═══════════════════════════════════════════════════
   SPA WATCHER — detect route changes and form mutations
   ═══════════════════════════════════════════════════ */

function initSPAWatcher() {
    let lastUrl = location.href;
    let mutationTimer: ReturnType<typeof setTimeout> | null = null;

    // 1. DOM mutation observer — debounced, notifies sidebar to rescan
    const domObserver = new MutationObserver(() => {
        if (mutationTimer) clearTimeout(mutationTimer);
        mutationTimer = setTimeout(() => {
            // Let sidebar know it should rescan (it has its own MutationObserver too)
            // This is belt-and-suspenders for iframes / lazy sections
            chrome.runtime.sendMessage({ action: 'domChanged' }).catch(() => {/* background may not be ready */ });
        }, 1000);
    });

    domObserver.observe(document.body, { childList: true, subtree: true });

    // 2. URL change polling — catches pushState / replaceState SPA navigation
    const urlCheckInterval = setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            chrome.runtime.sendMessage({ action: 'urlChanged', url: location.href }).catch(() => { });
        }
    }, 600);

    // 3. Patch history API to catch immediate navigation events
    const _push = history.pushState.bind(history);
    const _replace = history.replaceState.bind(history);
    history.pushState = (...args) => {
        _push(...args);
        chrome.runtime.sendMessage({ action: 'urlChanged', url: location.href }).catch(() => { });
    };
    history.replaceState = (...args) => {
        _replace(...args);
        chrome.runtime.sendMessage({ action: 'urlChanged', url: location.href }).catch(() => { });
    };
    window.addEventListener('popstate', () => {
        chrome.runtime.sendMessage({ action: 'urlChanged', url: location.href }).catch(() => { });
    });

    // Cleanup on page unload (best effort)
    window.addEventListener('beforeunload', () => {
        domObserver.disconnect();
        clearInterval(urlCheckInterval);
    });
}

/* ═══════════════════════════════════════════════════
   INITIALIZE
   ═══════════════════════════════════════════════════ */

function init() {
    injectSidebar();
    initSPAWatcher();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

/* ═══════════════════════════════════════════════════
   MESSAGE HANDLER — popup / background orchestration
   ═══════════════════════════════════════════════════ */

chrome.runtime.onMessage.addListener(
    (request: ChromeMessage, _sender, sendResponse: (response: ChromeResponse) => void) => {
        if (request.action === 'analyzeForm') {
            const fields = extractFormFields();
            sendResponse({ success: true, fields });
        }

        if (request.action === 'fillForm') {
            const { fieldMappings, userData } = request.data!;
            let filledCount = 0;

            fieldMappings?.forEach(mapping => {
                // Handle button clicks for dynamic forms
                if (mapping.action === 'click_add' && mapping.id) {
                    const { success } = clickElement(mapping.id);
                    if (success) filledCount++;
                    return;
                }

                // Priority: Selected Value (for selects) -> Custom Fields -> User Data
                let value = mapping.selectedValue;

                // Resolve custom_field:LABEL
                if (!value && mapping.fieldType?.startsWith('custom_field:') && userData?.customFields) {
                    const label = mapping.fieldType.slice('custom_field:'.length);
                    const customFields = userData.customFields as unknown as CustomField[];
                    const match = customFields.find(cf => cf.label === label);
                    if (match) value = match.value;
                }

                if (!value && userData && mapping.fieldType && mapping.fieldType in userData) {
                    value = String(userData[mapping.fieldType as keyof typeof userData]);
                }

                if (value) {
                    const success = fillFormField(mapping, value);
                    if (success) filledCount++;
                }
            });

            sendResponse({
                success: true,
                filledCount,
                total: fieldMappings?.length || 0
            });
        }

        if (request.action === 'clickNext') {
            const { success, message } = clickNextButton();
            sendResponse({ success, message });
        }

        return true;
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
    showToast('🚗 Aullevo: Starting AI Fill...', 'info', 3000);

    let totalFilled = 0;

    for (let step = 0; step < 10; step++) {
        const fields = extractFormFields();
        if (fields.length === 0) {
            if (step === 0) {
                showToast('❌ No form fields found on this page', 'error');
            }
            break;
        }

        showToast(`🤖 Analyzing ${fields.length} fields...`, 'info', 8000);

        const aiResponse = await sendToBackground({
            action: 'processFieldsAI',
            fields: fields
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

        // Fill fields
        let filledCount = 0;
        for (const mapping of mappings) {
            const value = mapping.selectedValue;
            if (value) {
                const success = fillFormField(mapping, value);
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