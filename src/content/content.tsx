import { injectSidebar } from './modules/contents/sidebarInjector';
import { showToast } from './modules/contents/toastSystem';
import { initSPAWatcher } from './modules/contents/spaWatcher';
import { initShortcutFiller, extractAllFields } from './modules/contents/shortcutFiller';
import { initWebAuthSync } from './modules/contents/webAuthSync';
import { executeFormFillStep, clickNextButtonAsync, clickPrevButton } from '../services/formAnalyzer';
import type { ChromeMessage, ChromeResponse, FieldMapping } from '../types';
import './sidebar.css';

/* 
   INITIALIZE & ENTRY POINT
*/

function init() {
    // Only inject sidebar and content modules in top-level frame, not inside iframes
    if (window === window.top) {
        injectSidebar();
        initSPAWatcher();
        initShortcutFiller();
        initWebAuthSync();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

/* 
   RUNTIME MESSAGE DISPATCHER — handles popup & background messages
*/

chrome.runtime.onMessage.addListener(
    (request: ChromeMessage, _sender, sendResponse: (response: ChromeResponse) => void) => {
        // Ignore messages in child iframes to prevent multi-frame message collisions
        if (window !== window.top) {
            return false;
        }

        if (request.action === 'analyzeForm') {
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
                    const result = await chrome.storage.local.get(["autoSubmit", "typingDelayMs", "stealthMode"]);
                    const autoSubmit = result.autoSubmit as boolean;
                    const typingDelayMs = result.typingDelayMs !== undefined ? Number(result.typingDelayMs) : undefined;
                    const stealthMode = result.stealthMode !== undefined ? Boolean(result.stealthMode) : undefined;

                    const { filledCount, total } = await executeFormFillStep(mappings, {
                        resumeFileData,
                        resumeFileName,
                        autoSubmit,
                        typingDelayMs,
                        stealthMode,
                    });

                    sendResponse({ success: true, filledCount, total });
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    sendResponse({ success: false, error: msg });
                }
            })();
            return true;
        }

        if (request.action === 'clickNext') {
            (async () => {
                const navResult = await clickNextButtonAsync();
                sendResponse(navResult);
            })();
            return true;
        }

        if (request.action === 'clickPrev') {
            const { success, message } = clickPrevButton();
            sendResponse({ success, message });
            return false;
        }

        if (request.action === 'showToast') {
            const toastType = (request.type as 'info' | 'success' | 'error') || 'info';
            showToast(request.message || '', toastType, 6000);
            sendResponse({ success: true });
            return false;
        }

        return false;
    }
);

console.log('🚗 Aullevo content script loaded! Press Alt+F to fill, Alt+A to toggle sidebar.');