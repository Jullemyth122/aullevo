import { extractFormFields, fillFormField, clickNextButton } from '../services/formAnalyzer';
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
                // Priority: Selected Value (for selects) -> User Data (for standard fields)
                let value = mapping.selectedValue;
                
                if (!value && userData && mapping.fieldType in userData) {
                    value = String(userData[mapping.fieldType as keyof typeof userData]);
                } 
                
                // If it's a custom question answer passed via some mechanism, we might need to handle it.
                // For now, let's assume the popup passes the ANSWER as 'selectedValue' or we look it up.
                // Actually, the popup will fill 'selectedValue' with the answer for custom questions too?
                // Or we can just use the value if it's not null.
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

console.log('🚗 Aulle content script loaded!');