import type { FormField, FieldMapping } from '../types';

/**
 * Extracts all form fields from the current page
 */
export function extractFormFields(): FormField[] {
    const inputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        'input, textarea, select'
    );
    const fields: FormField[] = [];

    inputs.forEach((input, index) => {
        if (input instanceof HTMLInputElement) {
            if (input.type === 'hidden' || input.type === 'submit' || input.type === 'button') {
                return;
            }
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
        };

        fields.push(fieldInfo);
    });

    return fields;
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
    if (parentLabel) return parentLabel.textContent?.trim() || '';

    const prevSibling = input.previousElementSibling;
    if (prevSibling && prevSibling.tagName === 'LABEL') {
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