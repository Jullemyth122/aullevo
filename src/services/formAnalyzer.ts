import type { FormField, FieldMapping } from '../types';

/**
 * Extracts all form fields from the current page, prioritizing visible and modal fields
 */
export function extractFormFields(): FormField[] {
    // 1. Detect active modal
    const activeModal = findActiveModal();
    
    // 2. Select inputs - scope to modal if exists, otherwise document
    const rootElement = activeModal || document.body;
    const inputs = rootElement.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>(
        'input, textarea, select, button'
    );

    const fields: FormField[] = [];
    
    // Map to hold grouped fields temporarily
    const groupMap = new Map<string, FormField>();
    // Track IDs of inputs we've already processed
    const processedIds = new Set<string>();

    inputs.forEach((input, index) => {
        // Skip non-visible fields
        if (!isVisible(input)) {
            return;
        }

        const isButton = input.tagName === 'BUTTON' || (input instanceof HTMLInputElement && (input.type === 'submit' || input.type === 'button'));
        
        if (isButton) {
            // Only include buttons that look like "Add" actions
            const text = (input.textContent || (input as HTMLInputElement).value || '').trim().toLowerCase();
            const aria = (input.getAttribute('aria-label') || '').trim().toLowerCase();
            const isAddBtn = ['add', 'plus', 'create', 'new', 'more'].some(k => text.includes(k) || aria.includes(k));
            
            if (!isAddBtn) return; 
        } else if (input instanceof HTMLInputElement && input.type === 'hidden') {
            return;
        }

        // Logic for distinct handling of Radios/Checkboxes
        if (input instanceof HTMLInputElement && (input.type === 'radio' || input.type === 'checkbox')) {
            const name = input.name;
            if (!name) return;

            if (!groupMap.has(name)) {
                const groupType = input.type === 'radio' ? 'radio_group' : 'checkbox_group';
                const groupLabel = findGroupLabel(input) || findLabel(input);
                const context = findFieldContext(input);
                const section = findFieldSection(input);

                groupMap.set(name, {
                    id: name,
                    name: name,
                    type: groupType,
                    placeholder: '',
                    label: groupLabel,
                    ariaLabel: input.getAttribute('aria-label') || '',
                    autocomplete: input.getAttribute('autocomplete') || '',
                    required: input.required,
                    context: context,
                    section: section,
                    options: []
                });
            }

            const optionLabel = findLabel(input) || input.value;
            const group = groupMap.get(name)!;
            group.options?.push({
                label: optionLabel,
                value: input.value || 'on'
            });

            return;
        }

        // Standard handling for other inputs
        const context = findFieldContext(input);
        const section = findFieldSection(input);
        
        let options: { label: string; value: string }[] | undefined;
        if (input instanceof HTMLSelectElement) {
             options = Array.from(input.options).map(opt => ({
                 label: opt.text,
                 value: opt.value
             }));
        }

        const fieldId = input.id || `field_${index}`;
        processedIds.add(fieldId);

        const fieldInfo: FormField = {
            id: fieldId,
            name: input.name || '',
            type: input instanceof HTMLInputElement ? input.type : input.tagName.toLowerCase(),
            placeholder: input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement 
                ? input.placeholder || '' 
                : '',
            label: isButton ? (input.textContent || (input as HTMLInputElement).value || '').trim() : findLabel(input),
            ariaLabel: input.getAttribute('aria-label') || '',
            autocomplete: input.getAttribute('autocomplete') || '',
            required: (input as HTMLInputElement).required || input.getAttribute('aria-required') === 'true',
            context: context,
            section: section,
            options: options
        };

        fields.push(fieldInfo);
    });

    // Add grouped fields to the main list
    fields.push(...Array.from(groupMap.values()));

    // ── Detect custom/div-based selects (React-Select, MUI, Ant Design, etc.) ──
    const customSelectSelectors = [
        '[role="combobox"]',
        '[role="listbox"]',
        '[class*="react-select"]',
        '[class*="select__control"]',
        '[class*="MuiSelect"]',
        '[class*="ant-select"]',
        '[class*="choices"]',
        '[data-testid*="select"]',
        // Generic "Select..." placeholder containers
        '[class*="selectContainer"]',
        '[class*="select-container"]',
    ];

    const customSelects = rootElement.querySelectorAll<HTMLElement>(customSelectSelectors.join(','));
    customSelects.forEach((el, idx) => {
        if (!isVisible(el)) return;
        const elId = el.id || el.getAttribute('data-testid') || `custom_select_${idx}`;
        // Skip if we already have this element from native inputs
        if (processedIds.has(elId)) return;
        // Skip if this contains a native select we already captured
        if (el.querySelector('select')) return;

        const label = findLabel(el) || el.getAttribute('aria-label') || '';
        const context = findFieldContext(el);
        const section = findFieldSection(el);
        const placeholder = el.getAttribute('placeholder') ||
            el.querySelector('[class*="placeholder"]')?.textContent?.trim() || '';

        // Try to extract options from any existing dropdown/listbox
        const options = extractCustomSelectOptions(el);

        processedIds.add(elId);
        fields.push({
            id: elId,
            name: el.getAttribute('name') || '',
            type: 'custom_select',
            placeholder: placeholder,
            label: label,
            ariaLabel: el.getAttribute('aria-label') || '',
            autocomplete: '',
            required: el.getAttribute('aria-required') === 'true',
            context: context,
            section: section,
            options: options.length > 0 ? options : undefined
        });
    });

    return fields;
}

/**
 * Check if an element is visible
 */
function isVisible(element: HTMLElement): boolean {
    if (!element) return false;
    
    // Check if element or ancestors are hidden
    if (element.offsetParent === null) {
        // purely checking offsetParent isn't 100% (e.g. fixed position) 
        // but it's a good proxy. Let's add style checks.
        if (window.getComputedStyle(element).position !== 'fixed') {
             return false;
        }
    }
    
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           parseFloat(style.opacity) > 0;
}

/**
 * Find active modal if any
 */
function findActiveModal(): HTMLElement | null {
    // Common modal selectors
    const modalSelectors = [
        '[role="dialog"]',
        '.modal',
        '.popup',
        '.dialog',
        '[aria-modal="true"]'
    ];

    // Find all potential modals
    const potentials = document.querySelectorAll<HTMLElement>(modalSelectors.join(','));
    
    // Filter for visible ones
    const visibleModals = Array.from(potentials).filter(isVisible);

    if (visibleModals.length === 0) return null;

    // Return the one with highest z-index usually, or just the last one in DOM (often strictly on top)
    // Simple heuristic: last visible one
    return visibleModals[visibleModals.length - 1];
}

/**
 * Find context (header) for a field
 */
function findFieldContext(input: HTMLElement): string {
    // Look up for a container with a heading
    let parent = input.parentElement;
    let depth = 0;
    
    while (parent && depth < 5) {
        // Check for direct heading in this parent
        const heading = parent.querySelector('h1, h2, h3, h4, h5, h6, legend');
        if (heading && parent.contains(heading) && parent.contains(input)) {
             return heading.textContent?.trim() || '';
        }
        // Also check for descriptive <p> tags near the input (common on LinkedIn/Workday)
        const desc = parent.querySelector('p, .description, .helper-text, [class*="hint"], [class*="desc"]');
        if (desc && parent.contains(desc) && parent.contains(input) && (desc.textContent?.length || 0) < 100) {
            const headingText = parent.querySelector('h1, h2, h3, h4, h5, h6, legend')?.textContent?.trim() || '';
            const descText = desc.textContent?.trim() || '';
            if (headingText) return headingText;
            if (descText) return descText;
        }
        parent = parent.parentElement;
        depth++;
    }
    
    // Fallback: check closest section/article/fieldset
    const section = input.closest('section, article, fieldset, [role="group"]');
    if (section) {
         const heading = section.querySelector('h1, h2, h3, h4, h5, h6, legend');
         if (heading) return heading.textContent?.trim() || '';
    }

    return '';
}

/**
 * Find visual section name
 */
function findFieldSection(input: HTMLElement): string {
    const section = input.closest('section, div.section, div.group');
    if (section && section instanceof HTMLElement && section.id) {
        return section.id; // e.g. "personal-info"
    }
    return '';
}

/**
 * Find associated label for an input
 */
function findLabel(input: HTMLElement): string {
    if (input.id) {
        const label = document.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`);
        if (label) return label.textContent?.trim() || '';
    }

    const parentLabel = input.closest('label');
    if (parentLabel) {
        const clone = parentLabel.cloneNode(true) as HTMLElement;
        const inputInClone = clone.querySelector('input, select, textarea');
        if (inputInClone) inputInClone.remove();
        return clone.textContent?.trim() || '';
    }

    const prevSibling = input.previousElementSibling;
    if (prevSibling && prevSibling.tagName === 'LABEL') {
        return prevSibling.textContent?.trim() || '';
    }
    
    // Check previous sibling if it looks like a label (e.g. span with text)
    if (prevSibling && (prevSibling.tagName === 'SPAN' || prevSibling.tagName === 'DIV')) {
         return prevSibling.textContent?.trim() || '';
    }

    // Check aria-describedby for additional context
    const describedBy = input.getAttribute('aria-describedby');
    if (describedBy) {
        const descEl = document.getElementById(describedBy);
        if (descEl && (descEl.textContent?.length || 0) < 80) {
            return descEl.textContent?.trim() || '';
        }
    }

    // Check title attribute
    const title = input.getAttribute('title');
    if (title) return title;

    // Check data-label or data-field-label (some frameworks)
    const dataLabel = input.getAttribute('data-label') || input.getAttribute('data-field-label');
    if (dataLabel) return dataLabel;

    // Check parent element for text content (common in Material UI / Ant Design)
    const parentEl = input.parentElement;
    if (parentEl) {
        const sibLabel = parentEl.querySelector('label, .label, [class*="label"], [class*="Label"]');
        if (sibLabel && sibLabel !== input && (sibLabel.textContent?.length || 0) < 60) {
            return sibLabel.textContent?.trim() || '';
        }
    }

    // Check if it's inside a table cell
    const cell = input.closest('td');
    if (cell) {
        const prevCell = cell.previousElementSibling;
        if (prevCell && (prevCell.tagName === 'TD' || prevCell.tagName === 'TH')) {
            if ((prevCell.textContent?.length || 0) < 50) {
                 return prevCell.textContent?.trim() || '';
            }
        }
    }

    return '';
}

/**
 * Find a group-level label (e.g. Matrix Row Header)
 */
function findGroupLabel(input: HTMLElement): string {
    // 1. Check for fieldset legend
    const fieldset = input.closest('fieldset');
    if (fieldset) {
        const legend = fieldset.querySelector('legend');
        if (legend) return legend.textContent?.trim() || '';
    }

    // 2. Check for Table Row Header
    const row = input.closest('tr');
    if (row) {
        // Look for the *first* cell in the row; usually the label/question
        const firstCell = row.firstElementChild;
        // Avoid picking the cell that contains the input itself if it's the first cell (unlikely for matrix)
        if (firstCell && !firstCell.contains(input)) {
            return firstCell.textContent?.trim() || '';
        }
    }

    // 3. Fallback to container heading logic (similar to context but closer)
    // Maybe a div with class "label" or "question"
    
    return '';
}

/**
 * Fill a form field with value
 */
export function fillFormField(fieldIdentifier: FieldMapping, value: string | boolean | string[]): boolean {
    let input: HTMLElement | null = null;
    let inputs: NodeListOf<HTMLElement> | null = null;

    if (fieldIdentifier.id) {
        input = document.getElementById(fieldIdentifier.id);
        
        // If not found by ID, it might be a group name we stored in 'id'
        if (!input) {
             inputs = document.querySelectorAll(`[name="${fieldIdentifier.id}"]`);
             if (inputs.length === 0) inputs = null;
        }
    }

    if (!input && !inputs && fieldIdentifier.name) {
        input = document.querySelector(`[name="${fieldIdentifier.name}"]`);
        if (!input) {
            inputs = document.querySelectorAll(`[name="${fieldIdentifier.name}"]`);
             if (inputs.length === 0) inputs = null;
        }
    }

    // If still not found, try custom select by ID pattern
    if (!input && !inputs && fieldIdentifier.id) {
        const isCustomSelect = fieldIdentifier.id.startsWith('custom_select_') ||
            document.querySelector(`[data-testid="${fieldIdentifier.id}"]`);
        if (isCustomSelect) {
            return fillCustomSelect(fieldIdentifier.id, String(value));
        }
    }

    if (!input && !inputs) return false;

    // Handle Group Filling (Radios / Checkboxes)
    if (inputs && inputs.length > 0) {
        let filledAny = false;
        inputs.forEach(el => {
            if (el instanceof HTMLInputElement) {
                 if (el.type === 'radio') {
                     const valStr = String(value).toLowerCase();
                     const label = findLabel(el).toLowerCase();
                     if (el.value.toLowerCase() === valStr || label.includes(valStr)) {
                         el.checked = true;
                         triggerEvents(el);
                         filledAny = true;
                     }
                 } else if (el.type === 'checkbox') {
                     let valuesToCheck: string[] = [];
                     if (Array.isArray(value)) valuesToCheck = value.map(v => String(v).toLowerCase());
                     else if (typeof value === 'boolean') valuesToCheck = value ? ['true', 'on', 'yes'] : [];
                     else valuesToCheck = [String(value).toLowerCase()];

                     const valStr = el.value.toLowerCase();
                     const label = findLabel(el).toLowerCase();
                     
                     if (valuesToCheck.some(v => valStr === v || label.includes(v))) {
                         el.checked = true;
                         triggerEvents(el);
                         filledAny = true;
                     }
                 }
            }
        });
        return filledAny;
    }

    // Handle Single Input Filling
    if (input) {
        if (input instanceof HTMLSelectElement) {
            fillSelect(input, value as string);
        } else if (input instanceof HTMLInputElement) {
            if (input.type === 'checkbox') {
                input.checked = value === 'true' || value === true;
            } else if (input.type === 'radio') {
                fillRadio(input, value as string);
            } else {
                input.value = value as string;
            }
        } else if (input instanceof HTMLTextAreaElement) {
            input.value = value as string;
        } else {
            // Element exists but is not a standard form element → likely a custom select
            return fillCustomSelect(fieldIdentifier.id || '', String(value));
        }

        triggerEvents(input);
        return true;
    }

    return false;
}

function fillSelect(select: HTMLSelectElement, value: string): void {
    const valLower = value.toLowerCase();
    
    // 1. Try exact match first
    for (const option of Array.from(select.options)) {
        if (option.value.toLowerCase() === valLower || option.text.toLowerCase() === valLower) {
            select.value = option.value;
            triggerEvents(select);
            return;
        }
    }
    
    // 2. Fuzzy match: check if value is contained in option text or vice versa
    for (const option of Array.from(select.options)) {
        const optText = option.text.toLowerCase();
        if (optText.includes(valLower) || valLower.includes(optText)) {
            select.value = option.value;
            triggerEvents(select);
            return;
        }
    }
}

function fillRadio(radio: HTMLInputElement, value: string): void {
    const name = radio.name;
    const radios = document.querySelectorAll<HTMLInputElement>(
        `input[type="radio"][name="${name}"]`
    );

    radios.forEach(r => {
        if (r.value.toLowerCase() === value.toLowerCase()) {
            r.checked = true;
            triggerEvents(r);
        }
    });
    triggerEvents(radio);
}

function triggerEvents(input: HTMLElement): void {
    // Fire focus first
    input.dispatchEvent(new Event('focus', { bubbles: true }));

    const events = ['input', 'change', 'blur', 'keyup'];
    events.forEach(eventType => {
        input.dispatchEvent(new Event(eventType, { bubbles: true }));
    });

    // Also fire MouseEvents for click (some frameworks listen to MouseEvent not Event)
    input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));

    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
        // React 16+ hack for value setter
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(input),
            'value'
        )?.set;

        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(input, input.value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    if (input instanceof HTMLSelectElement) {
        // React quirk: also use the native setter for selects
        const nativeSelectSetter = Object.getOwnPropertyDescriptor(
            HTMLSelectElement.prototype,
            'value'
        )?.set;

        if (nativeSelectSetter) {
            nativeSelectSetter.call(input, input.value);
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }
}

/**
 * Extract options from a custom select component (if dropdown is open or options exist in DOM)
 */
function extractCustomSelectOptions(el: HTMLElement): { label: string; value: string }[] {
    const options: { label: string; value: string }[] = [];
    
    // Check aria-owns or aria-controls for the listbox ID
    const listboxId = el.getAttribute('aria-owns') || el.getAttribute('aria-controls');
    let listbox: HTMLElement | null = null;
    if (listboxId) {
        listbox = document.getElementById(listboxId);
    }
    // Also try to find a listbox within or near the element
    if (!listbox) {
        listbox = el.querySelector('[role="listbox"], [role="menu"], [class*="menu"], [class*="options"], [class*="dropdown"]');
    }
    // Check parent too (some frameworks put listbox as sibling)
    if (!listbox && el.parentElement) {
        listbox = el.parentElement.querySelector('[role="listbox"], [role="menu"], [class*="menu-list"], [class*="options-list"]');
    }

    if (listbox) {
        const optionEls = listbox.querySelectorAll('[role="option"], [class*="option"], li');
        optionEls.forEach(opt => {
            const text = opt.textContent?.trim() || '';
            if (text && text.length < 100) {
                options.push({
                    label: text,
                    value: (opt as HTMLElement).getAttribute('data-value') || text
                });
            }
        });
    }

    return options;
}

/**
 * Fill a custom div-based select (React-Select, MUI Select, Ant Design, etc.)
 * Strategy: click to open → type to search → click the matching option
 */
export function fillCustomSelect(elementId: string, value: string): boolean {
    // Find the element
    let el = document.getElementById(elementId);
    if (!el) {
        // Try data-testid
        el = document.querySelector(`[data-testid="${elementId}"]`);
    }
    if (!el) {
        // Try class-based custom_select_N matching
        const customSelects = document.querySelectorAll<HTMLElement>(
            '[role="combobox"], [role="listbox"], [class*="react-select"], [class*="select__control"], [class*="MuiSelect"], [class*="ant-select"], [class*="choices"]'
        );
        const idx = parseInt(elementId.replace('custom_select_', ''));
        if (!isNaN(idx) && idx < customSelects.length) {
            el = customSelects[idx];
        }
    }
    if (!el) return false;

    const valLower = value.toLowerCase();

    // Step 1: Click to open the dropdown
    el.click();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('focus', { bubbles: true }));

    // Step 2: Type into the search input (if any)
    const searchInput = el.querySelector<HTMLInputElement>('input') ||
        el.parentElement?.querySelector<HTMLInputElement>('input[type="text"], input[role="combobox"]');
    
    if (searchInput) {
        searchInput.focus();
        // Use native value setter for React compatibility
        const nativeSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype, 'value'
        )?.set;
        if (nativeSetter) {
            nativeSetter.call(searchInput, value);
        } else {
            searchInput.value = value;
        }
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        searchInput.dispatchEvent(new Event('change', { bubbles: true }));
        // Also fire keyboard event
        searchInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value }));
    }

    // Step 3: Wait briefly then find and click the matching option
    setTimeout(() => {
        clickMatchingOption(el!, valLower);
    }, 300);

    return true;
}

/**
 * Find and click a matching option in an open dropdown
 */
function clickMatchingOption(container: HTMLElement, valLower: string): boolean {
    // Search in the container, its parent, and the entire document body for open dropdowns
    const searchRoots = [container, container.parentElement, document.body].filter(Boolean) as HTMLElement[];

    for (const root of searchRoots) {
        const optionEls = root.querySelectorAll<HTMLElement>(
            '[role="option"], [class*="option"], [class*="menu"] li, [class*="dropdown"] li, [class*="listbox"] > div'
        );

        // Try exact match first
        for (const opt of Array.from(optionEls)) {
            const text = opt.textContent?.trim().toLowerCase() || '';
            if (text === valLower) {
                opt.click();
                opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                opt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                return true;
            }
        }

        // Then fuzzy: option contains value or value contains option
        for (const opt of Array.from(optionEls)) {
            const text = opt.textContent?.trim().toLowerCase() || '';
            if (text && (text.includes(valLower) || valLower.includes(text))) {
                opt.click();
                opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                opt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                return true;
            }
        }
    }

    return false;
}

/**
 * Click a general element by ID
 */
export function clickElement(id: string): { success: boolean, message: string } {
    const el = document.getElementById(id);
    if (el) {
        el.click();
        return { success: true, message: `Clicked element #${id}` };
    }
    return { success: false, message: `Element #${id} not found` };
}

/**
 * Find the "Next" or "Continue" button
 */
export function findNextButton(): HTMLButtonElement | null {
    const activeModal = findActiveModal();
    const root = activeModal || document.body;
    
    // Select all buttons
    const buttons = root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input[type="submit"], input[type="button"]');
    
    // Filter for visible buttons with specific text
    const nextButton = Array.from(buttons).find(btn => {
        if (!isVisible(btn as HTMLElement)) return false;
        
        const text = (btn.textContent || (btn as HTMLInputElement).value || '').trim().toLowerCase();
        const ariaLabel = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
        
        // Keywords for next step
        const keywords = ['next', 'continue', 'proceed', 'review', 'submit application'];
        
        // Exact match or strong containment
        return keywords.some(keyword => text === keyword || ariaLabel === keyword || (text.includes(keyword) && text.length < 20));
    });

    return nextButton as HTMLButtonElement | null;
}

/**
 * Click the next button
 */
export function clickNextButton(): { success: boolean, message: string } {
    const btn = findNextButton();
    if (btn) {
        btn.click();
        return { success: true, message: `Clicked "${btn.textContent || 'Next'}" button.` };
    }
    return { success: false, message: 'No "Next" button found.' };
}