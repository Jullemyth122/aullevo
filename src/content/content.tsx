import { injectSidebar } from './modules/contents/sidebarInjector';
import { showToast } from './modules/contents/toastSystem';
import { initSPAWatcher } from './modules/contents/spaWatcher';
import { initShortcutFiller, extractAllFields } from './modules/contents/shortcutFiller';
import { initWebAuthSync } from './modules/contents/webAuthSync';
import { fillFormField, clickNextButton, clickPrevButton } from '../services/formAnalyzer';
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

console.log('🚗 Aullevo content script loaded! Press Alt+F to fill, Alt+A to toggle sidebar.');