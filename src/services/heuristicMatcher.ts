import type { FormField, CustomField, FieldMapping } from '../types';

export function matchFieldsHeuristically(
    fields: FormField[],
    customFields: CustomField[] = []
): FieldMapping[] {
    const mappings: FieldMapping[] = [];

    // Simple robust keyword matchers for standard fields
    const STANDARD_RULES: Record<string, RegExp> = {
        firstName: /(first|given)\s*name/i,
        lastName: /(last|family|sur)\s*name/i,
        email: /e?-?mail/i,
        phoneCountryCode: /country\s*code|dial\s*code/i,
        phone: /phone|mobile|cell/i, // Will be overridden if countryCode matches first
        address: /address|street\s*1/i,
        city: /city/i,
        state: /state|province/i,
        zipCode: /zip|postal/i,
        country: /country(?!.*code)/i, // Matches country, but not country code
        linkedin: /linkedin/i,
        portfolio: /portfolio|website|personal\s*site/i,
        github: /github/i,
        headline: /headline/i,
        dateOfBirth: /birth|dob/i,
        gender: /gender|sex/i,
        salaryExpectation: /(expected|desired)\s*(salary|pay|compensation)/i,
        noticePeriod: /notice\s*period|availability|start/i,
        workAuthorization: /work\s*authorization|visa|sponsorship|eligible\s*to\s*work/i,
        yearsOfExperience: /years\s*of\s*experience/i,
        resumeUpload: /resume|cv|upload/i,
    };

    // Helper to evaluate text against all custom fields
    function matchCustomField(text: string): CustomField | null {
        if (!text) return null;
        text = text.toLowerCase();
        for (const cf of customFields) {
            const labelLogic = cf.label.toLowerCase();
            const contextLogic = cf.context?.toLowerCase() || '';

            if (text.includes(labelLogic)) return cf;
            if (contextLogic && text.includes(contextLogic)) return cf;
        }
        return null;
    }

    for (const field of fields) {
        // Priority 1: Action Add Buttons
        if (field.type === 'button' || field.type === 'submit') {
            const labelLower = (field.label || '').toLowerCase();
            const contextLower = (field.context || '').toLowerCase();
            if (labelLower.includes('add') || labelLower.includes('plus')) {
                let groupType: any = null;
                if (labelLower.includes('experience') || contextLower.includes('experience') || labelLower.includes('job')) groupType = 'experience';
                else if (labelLower.includes('education') || contextLower.includes('education') || labelLower.includes('school')) groupType = 'education';
                else if (labelLower.includes('project')) groupType = 'project';
                else if (labelLower.includes('skill')) groupType = 'skill';

                if (groupType) {
                    mappings.push({
                        fieldId: field.id,
                        id: field.id,
                        fieldType: '',
                        action: 'click_add',
                        groupType,
                        confidence: 0.9,
                    });
                }
            }
            continue;
        }

        const compositeText = [field.label, field.placeholder, field.name, field.context, field.id].join(' ').toLowerCase();

        // Priority 2: Custom Question Text Areas (fallback manual input)
        if (field.type === 'textarea') {
            let matchedRule: string | null = null;
            for (const [key, regex] of Object.entries(STANDARD_RULES)) {
                if (regex.test(compositeText)) {
                    matchedRule = key;
                    break;
                }
            }
            if (!matchedRule) {
                // If it's asking a custom question
                if (compositeText.includes('why') || compositeText.includes('describe') || compositeText.includes('explain') || compositeText.includes('essay')) {
                    mappings.push({
                        fieldId: field.id,
                        id: field.id,
                        fieldType: 'custom_question',
                        confidence: 0.8,
                        originalQuestion: field.label || field.placeholder || 'Unknown question',
                        selectedValue: '[MANUAL_INPUT_NEEDED]',
                    });
                }
                continue; // Do not map a long textarea to a random field
            }
        }

        // Priority 3: Groups (Experience / Education repeating sections)
        let groupType: 'experience' | 'education' | 'project' | 'skill' | undefined;
        let groupIndex = 0;
        
        const contextStr = (field.context || field.section || '').toLowerCase();
        
        // Very basic repeater index extraction (e.g., "Experience 1", "Experience #2")
        const indexMatch = contextStr.match(/(?:experience|education|project)\s*(?:#|no\.?)?\s*(\d+)/i);
        if (indexMatch) {
            groupIndex = Math.max(0, parseInt(indexMatch[1], 10) - 1);
        }

        if (contextStr.includes('experience') || contextStr.includes('employment') || contextStr.includes('work history')) {
            groupType = 'experience';
        } else if (contextStr.includes('education') || contextStr.includes('school') || contextStr.includes('university')) {
            groupType = 'education';
        }

        // Priority 4: Custom fields mapping 
        const matchedCustom = matchCustomField(compositeText);
        if (matchedCustom) {
            mappings.push({
                fieldId: field.id,
                id: field.id,
                fieldType: `custom_field:${matchedCustom.label}`,
                confidence: 0.85,
                groupType,
                groupIndex: groupType ? groupIndex : undefined,
            });
            continue;
        }

        // Priority 5: Standard Field matching
        let bestMatch: keyof typeof STANDARD_RULES | null = null;
        for (const [key, regex] of Object.entries(STANDARD_RULES)) {
            if (regex.test(compositeText)) {
                // Handle overlap between "phone" and "phoneCountryCode"
                if (bestMatch === 'phone' && key === 'phoneCountryCode') {
                    // keep bestMatch = phoneCountryCode
                    bestMatch = key;
                } else if (bestMatch === 'phoneCountryCode' && key === 'phone') {
                    // skip overriding
                } else {
                    bestMatch = key;
                }
            }
        }

        if (bestMatch) {
            mappings.push({
                fieldId: field.id,
                id: field.id,
                fieldType: bestMatch,
                confidence: 0.9,
                groupType,
                groupIndex: groupType ? groupIndex : undefined,
            });
            continue;
        }

        // Priority 6: Specific array groups (Skills, Language) inside Checkbox/Radio
        if ((field.type === 'checkbox_group' || field.type === 'radio_group') && !bestMatch) {
            if (compositeText.includes('skill') || compositeText.includes('tech') || compositeText.includes('language') || compositeText.includes('framework')) {
                mappings.push({
                    fieldId: field.id,
                    id: field.id,
                    fieldType: 'skill',
                    confidence: 0.8,
                });
            } else if (compositeText.includes('proficiency') || compositeText.includes('level')) { // Handle standard "Proficiency Level" mapping to a custom field context
                 const profMatched = matchCustomField('proficiency level');
                 if (profMatched) {
                      mappings.push({
                            fieldId: field.id,
                            id: field.id,
                            fieldType: `custom_field:${profMatched.label}`,
                            confidence: 0.8,
                      });
                 }
            }
        }
    }

    return mappings;
}
