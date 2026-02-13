import { extractFormFields, fillFormField, clickNextButton, clickElement } from '../services/formAnalyzer';
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
                // Handle button clicks for dynamic forms
                if (mapping.action === 'click_add' && mapping.id) {
                    const { success } = clickElement(mapping.id);
                    if (success) filledCount++; // Count as an action taken
                    return;
                }

                // Priority: Selected Value (for selects) -> User Data (for standard fields)
                let value = mapping.selectedValue;
                
                if (!value && userData && mapping.fieldType in userData) {
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

console.log('🚗 Aulle content script loaded!');