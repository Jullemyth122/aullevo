import type { FormField, FieldMapping } from '../types';

/**
 * Extracts all form fields from the current page
 */
/**
 * Extracts all form fields from the current page, prioritizing visible and modal fields
 */
export function extractFormFields(): FormField[] {
    // 1. Detect active modal
    const activeModal = findActiveModal();
    
    // 2. Select inputs - scope to modal if exists, otherwise document
    const rootElement = activeModal || document.body;
    const inputs = rootElement.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        'input, textarea, select'
    );

    const fields: FormField[] = [];

    inputs.forEach((input, index) => {
        // Skip non-visible fields
        if (!isVisible(input)) {
            return;
        }

        if (input instanceof HTMLInputElement) {
            if (input.type === 'hidden' || input.type === 'submit' || input.type === 'button') {
                return;
            }
        }

        const context = findFieldContext(input);
        const section = findFieldSection(input);
        
        let options: { label: string; value: string }[] | undefined;
        if (input instanceof HTMLSelectElement) {
             options = Array.from(input.options).map(opt => ({
                 label: opt.text,
                 value: opt.value
             }));
        }

        const fieldInfo: FormField = {
            id: input.id || `field_${index}`,
            name: input.name || '',
            type: input instanceof HTMLInputElement ? input.type : input.tagName.toLowerCase(),
            placeholder: input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement 
                ? input.placeholder || '' 
                : '',
            label: findLabel(input),
            ariaLabel: input.getAttribute('aria-label') || '',
            autocomplete: input.getAttribute('autocomplete') || '',
            required: input.required,
            context: context,
            section: section,
            options: options
        };

        fields.push(fieldInfo);
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
             // Ensure heading is "before" the input in document order, broadly speaking
             // or just part of the same container.
             return heading.textContent?.trim() || '';
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
        // Clone and remove input to get just the text
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

    return '';
}

/**
 * Fill a form field with value
 */
export function fillFormField(fieldIdentifier: FieldMapping, value: string | boolean): boolean {
    let input: HTMLElement | null = null;

    if (fieldIdentifier.id) {
        input = document.getElementById(fieldIdentifier.id);
    }

    if (!input && fieldIdentifier.name) {
        input = document.querySelector(`[name="${fieldIdentifier.name}"]`);
    }

    if (!input) return false;

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
    }

    triggerEvents(input);
    return true;
}

function fillSelect(select: HTMLSelectElement, value: string): void {
    for (let option of Array.from(select.options)) {
        if (
            option.value.toLowerCase() === value.toLowerCase() ||
            option.text.toLowerCase() === value.toLowerCase()
        ) {
            select.value = option.value;
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
        }
    });
}

function triggerEvents(input: HTMLElement): void {
    const events = ['input', 'change', 'blur', 'keyup'];

    events.forEach(eventType => {
        input.dispatchEvent(new Event(eventType, { bubbles: true }));
    });

    if (input instanceof HTMLInputElement) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
        )?.set;

        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(input, input.value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
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