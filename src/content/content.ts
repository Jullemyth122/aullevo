import { extractFormFields, fillFormField } from '../services/formAnalyzer';
import type { ChromeMessage, ChromeResponse } from '../types';

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
                const value = userData?.[mapping.fieldType];
                if (value) {
                    const success = fillFormField(mapping, String(value));
                    if (success) filledCount++;
                }
            });

            sendResponse({ 
                success: true, 
                filledCount, 
                total: fieldMappings?.length || 0 
            });
        }

        return true;
    }
);

console.log('🚗 Aulle content script loaded!');