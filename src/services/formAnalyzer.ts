import type { FormField, FieldMapping } from "../types";
import {
  findElementByIdOrSelector,
  activateTabForField,
  find2DMatrixInput,
  highlightElement,
} from "./form/domUtils";
import {
  cleanLabelText,
  findLabel,
  findMatrixHeaders,
  fuzzyIncludes,
} from "./form/labels";
import {
  fillRadioGroup,
  fillCheckboxGroup,
  fillToggle,
  fillAriaSlider,
  fillAriaSpinbutton,
  fillSelect,
  select_was_filled,
  setCheckboxState,
  fillFileInput,
  fillMultiFileInput,
  fillCustomSelect,
  fillRadio,
} from "./form/fieldFillers";
import { parseDateString, formatDateForDisplay } from "./form/dateUtils";
import { triggerEvents, humanTypeValue } from "./form/events";
import {
  fuzzyMatch,
  getOptionDescriptors,
  parseValueTokens,
  optionMatchesValue,
} from "./form/matchers";
import { fillChatInputField, submitChatField } from "./form/chat";
import {
  getGoogleFormQuestionHeading,
  isGoogleFormLabelMatch,
  fillGoogleFormQuestionContainer,
} from "./form/googleForms";
import {
  getMicrosoftFormQuestionHeading,
  fillMicrosoftFormQuestionContainer,
} from "./form/microsoftForms";

// Re-export submodules for full backwards compatibility
export * from "./form";
export type { FormField, FieldMapping };

export interface FillContextOpts {
  resumeFileData?: string;
  resumeFileName?: string;
  autoSubmit?: boolean;
  stealthMode?: boolean;
  typingDelayMs?: number;
}

/**
 * Splits a text into search tokens across whitespace and delimiters.
 */
function extractTokens(text: string): string[] {
  return text
    .split(/[\s\-_/\\|:*xX]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
}

/**
 * Determines if an element is a container element rather than a standard input.
 */
function isContainerElement(el: HTMLElement): boolean {
  return (
    el.tagName !== "INPUT" &&
    el.tagName !== "SELECT" &&
    el.tagName !== "TEXTAREA" &&
    el.tagName !== "BUTTON"
  );
}

/**
 * Resolves target input elements for a given FieldMapping using multi-stage lookup:
 * 1. Direct ID / selector lookup
 * 2. 2D Matrix cell lookup (rowHeader, colHeader, compoundLabel, tokens)
 * 3. 2D Matrix row lookup for radio/checkbox groups
 * 4. Name attribute lookup
 * 5. Chat / contenteditable fallback
 */
function resolveTargetElement(fieldIdentifier: FieldMapping): {
  input: HTMLElement | null;
  inputs: NodeListOf<Element> | null;
} {
  let input: HTMLElement | null = null;
  let inputs: NodeListOf<Element> | null = null;

  // 1. Direct ID / selector lookup
  if (fieldIdentifier.id) {
    input = findElementByIdOrSelector(fieldIdentifier.id);
    if (!input) {
      inputs = document.querySelectorAll(`[name="${fieldIdentifier.id}"]`);
      if (inputs.length === 0) inputs = null;
    }
  }

  // 2. 2D Matrix Cell Lookup for Inputs
  if (!input && !inputs) {
    if (
      fieldIdentifier.rowHeader ||
      fieldIdentifier.colHeader ||
      fieldIdentifier.compoundLabel
    ) {
      input = find2DMatrixInput({
        rowHeader: fieldIdentifier.rowHeader,
        colHeader: fieldIdentifier.colHeader,
        compoundLabel: fieldIdentifier.compoundLabel,
      });
    }

    if (!input && fieldIdentifier.fieldType?.startsWith("custom_field:")) {
      const customLabel = fieldIdentifier.fieldType.slice("custom_field:".length);
      const tokens = extractTokens(customLabel);
      if (tokens.length >= 2) {
        input = find2DMatrixInput({ tokens });
      }
    }

    if (!input && (fieldIdentifier as Partial<FormField>).label) {
      const tokens = extractTokens(String((fieldIdentifier as Partial<FormField>).label));
      if (tokens.length >= 2) {
        input = find2DMatrixInput({ tokens });
      }
    }
  }

  // 3. 2D Matrix Row Lookup for Radios/Checkboxes
  if (!input && !inputs && fieldIdentifier.rowHeader) {
    const rowNorm = fieldIdentifier.rowHeader.toLowerCase().trim();

    // Strategy A: Table/grid rows with matching header cell
    const allRows = document.querySelectorAll<HTMLElement>(
      "tr, [role='row'], [class*='matrix-row'], [class*='table-row'], [class*='matrix_row']",
    );
    for (const row of Array.from(allRows)) {
      const firstCell = row.querySelector(
        "th, td:first-child, [role='rowheader'], [class*='row-header'], [class*='rowHeader']",
      );
      const firstCellText = firstCell
        ? cleanLabelText(firstCell.textContent || "").toLowerCase().trim()
        : "";

      if (firstCellText === rowNorm) {
        const rowRadios = row.querySelectorAll<HTMLInputElement>(
          'input[type="radio"], [role="radio"]',
        );
        if (rowRadios.length > 0) {
          inputs = rowRadios as unknown as NodeListOf<Element>;
          break;
        }

        const rowCheckboxes = row.querySelectorAll<HTMLInputElement>(
          'input[type="checkbox"], [role="checkbox"]',
        );
        if (rowCheckboxes.length > 0) {
          inputs = rowCheckboxes as unknown as NodeListOf<Element>;
          break;
        }
      }
    }

    // Strategy B: Raycasting & Matrix header extraction matching
    if (!inputs) {
      const allMatrixInputs = document.querySelectorAll<HTMLInputElement>(
        'input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]',
      );
      const matchingRowInputs = Array.from(allMatrixInputs).filter((el) => {
        const mInfo = findMatrixHeaders(el);
        return (
          mInfo.rowHeader && mInfo.rowHeader.toLowerCase().trim() === rowNorm
        );
      });

      if (matchingRowInputs.length > 0) {
        inputs = matchingRowInputs as unknown as NodeListOf<Element>;
      }
    }
  }

  // 4. Name attribute lookup
  if (!input && !inputs && fieldIdentifier.name) {
    const namedInputs = document.querySelectorAll(
      `[name="${fieldIdentifier.name}"]`,
    );
    if (namedInputs.length === 1) {
      input = namedInputs[0] as HTMLElement;
    } else if (namedInputs.length > 1) {
      inputs = namedInputs;
    }
  }

  // 5. Fallback for chat boxes / contenteditable
  if (
    !input &&
    !inputs &&
    (fieldIdentifier.fieldType === "contenteditable" ||
      fieldIdentifier.fieldType === "custom_question")
  ) {
    input = document.querySelector(
      '[role="textbox"], [contenteditable="true"]',
    );
  }

  return { input, inputs };
}

/**
 * Attempts to handle container elements (custom radios/checkboxes, sliders, spinbuttons, toggles).
 */
async function tryFillContainerDiv(
  input: HTMLElement,
  value: string | string[] | boolean,
): Promise<boolean> {
  const isSelfRadio = input.getAttribute("role") === "radio";
  const isSelfCheckbox = input.getAttribute("role") === "checkbox";

  if (isSelfRadio || isSelfCheckbox) {
    const groupContainer =
      input.closest(
        '[role="radiogroup"], [role="group"], [role="listitem"], fieldset, [data-params], [jscontroller], [jsmodel], [class*="radio" i], [class*="check" i], form',
      ) || input.parentElement;

    if (groupContainer) {
      if (isSelfRadio) {
        const siblingRadios = groupContainer.querySelectorAll<
          HTMLElement | HTMLInputElement
        >('input[type="radio"], [role="radio"]');
        if (siblingRadios.length > 0) {
          return fillRadioGroup(siblingRadios, value);
        }
      } else {
        const siblingCheckboxes = groupContainer.querySelectorAll<
          HTMLElement | HTMLInputElement
        >('input[type="checkbox"], [role="checkbox"]');
        if (siblingCheckboxes.length > 0) {
          return fillCheckboxGroup(siblingCheckboxes, value);
        }
      }
    }
    if (isSelfRadio) return fillRadioGroup([input], value);
    if (isSelfCheckbox) return fillCheckboxGroup([input], value);
  }

  const childRadios = input.querySelectorAll<HTMLInputElement | HTMLElement>(
    'input[type="radio"], [role="radio"]',
  );
  if (childRadios.length > 0) {
    return fillRadioGroup(childRadios, value);
  }

  const childCheckboxes = input.querySelectorAll<HTMLInputElement | HTMLElement>(
    'input[type="checkbox"], [role="checkbox"]',
  );
  if (childCheckboxes.length > 0) {
    return fillCheckboxGroup(childCheckboxes, value);
  }

  // Toggles and switches
  if (
    input.classList.contains("toggle") ||
    input.getAttribute("role") === "switch" ||
    input.classList.contains("switch") ||
    input.classList.contains("toggle-switch")
  ) {
    return fillToggle(input, value);
  }

  // ARIA role slider and spinbutton
  if (input.getAttribute("role") === "slider") {
    return fillAriaSlider(input, value);
  }
  if (input.getAttribute("role") === "spinbutton") {
    return fillAriaSpinbutton(input, value);
  }

  return false;
}

/**
 * Attempts platform-specific question container fallbacks for Google Forms and Microsoft Forms.
 */
async function tryFillQuestionContainers(
  fieldIdentifier: FieldMapping,
  value: string | string[] | boolean,
): Promise<boolean> {
  const targetLabel =
    (fieldIdentifier as Partial<FormField>).label ||
    (fieldIdentifier.fieldType?.startsWith("custom_field:")
      ? fieldIdentifier.fieldType.slice("custom_field:".length)
      : "") ||
    fieldIdentifier.id;

  if (!targetLabel) return false;

  // 1. Google Forms Question Containers
  const googleQuestionContainers = Array.from(
    document.querySelectorAll<HTMLElement>(
      "div[role='listitem'], div.Qr7Oae, div.geS5n, div.m7Wjg",
    ),
  );
  for (const container of googleQuestionContainers) {
    const heading = getGoogleFormQuestionHeading(container);
    if (isGoogleFormLabelMatch(targetLabel, heading)) {
      const filled = await fillGoogleFormQuestionContainer(container, value);
      if (filled) return true;
    }
  }

  // 2. Microsoft Forms Question Containers
  const msQuestionContainers = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-automation-id='questionItem'], .office-form-question",
    ),
  );
  for (const container of msQuestionContainers) {
    const heading = getMicrosoftFormQuestionHeading(container);
    if (isGoogleFormLabelMatch(targetLabel, heading)) {
      const filled = await fillMicrosoftFormQuestionContainer(container, value);
      if (filled) return true;
    }
  }

  return false;
}

/**
 * Fills multiple candidate elements (e.g. named radio or checkbox groups).
 */
function fillMultipleElements(
  inputs: NodeListOf<Element> | HTMLElement[],
  value: string | string[] | boolean,
): boolean {
  const candidateInputs = Array.from(inputs).filter(
    (el): el is HTMLInputElement | HTMLElement =>
      el instanceof HTMLInputElement ||
      el.getAttribute("role") === "radio" ||
      el.getAttribute("role") === "checkbox",
  );

  if (candidateInputs.length === 0) return false;

  const firstEl = candidateInputs[0];
  const firstType =
    firstEl instanceof HTMLInputElement
      ? firstEl.type
      : firstEl.getAttribute("role") || "";

  if (firstType === "radio") {
    return fillRadioGroup(candidateInputs, value);
  }
  if (firstType === "checkbox") {
    return fillCheckboxGroup(candidateInputs, value);
  }

  let filledAny = false;
  candidateInputs.forEach((el) => {
    const valStr = String(value).toLowerCase().trim();
    const label = findLabel(el).toLowerCase().trim();
    const elVal =
      el instanceof HTMLInputElement
        ? el.value.toLowerCase()
        : (
            el.getAttribute("data-value") ||
            el.getAttribute("value") ||
            ""
          ).toLowerCase();

    if (
      elVal === valStr ||
      label.includes(valStr) ||
      valStr.includes(label) ||
      fuzzyMatch(label, valStr) ||
      (elVal && fuzzyMatch(elVal, valStr))
    ) {
      if (el instanceof HTMLInputElement) {
        setCheckboxState(el, true);
      } else {
        el.click();
      }
      filledAny = true;
    }
  });

  return filledAny;
}

/**
 * Fills a single resolved input element according to its HTML tag and attributes.
 */
async function fillSingleInputElement(
  input: HTMLElement,
  fieldIdentifier: FieldMapping,
  value: string | string[] | boolean,
  contextOpts?: FillContextOpts,
): Promise<boolean> {
  // 1. Select element
  if (input instanceof HTMLSelectElement) {
    fillSelect(input, value as string);
    return select_was_filled(input);
  }

  // 2. Input element
  if (input instanceof HTMLInputElement) {
    const inputType = input.type.toLowerCase();

    if (inputType === "checkbox") {
      const valLower = String(value).toLowerCase().trim();
      const isExplicitTrue =
        ["true", "yes", "y", "1", "checked", "on"].includes(valLower) ||
        /\b(agree|accept|consent|confirm)\b/i.test(valLower);
      const isExplicitFalse =
        ["false", "no", "n", "0", "unchecked", "off", "disagree", "decline"].includes(valLower);

      if (isExplicitTrue) {
        setCheckboxState(input, true);
        return true;
      }
      if (isExplicitFalse) {
        setCheckboxState(input, false);
        return true;
      }

      const descriptors = getOptionDescriptors(input);
      const valuesToCheck = parseValueTokens(valLower);
      const matches = valuesToCheck.some((valStr) =>
        optionMatchesValue(descriptors, valStr),
      );

      setCheckboxState(input, matches);
      return matches;
    }

    if (inputType === "file") {
      if (value === "FILE_UPLOAD") {
        if (fieldIdentifier.files && fieldIdentifier.files.length > 0) {
          return fillMultiFileInput(input, fieldIdentifier.files);
        }
        const fData = fieldIdentifier.fileData || contextOpts?.resumeFileData;
        const fName = fieldIdentifier.fileName || contextOpts?.resumeFileName;
        if (fData && fName) {
          return fillFileInput(input, fData, fName);
        }
      }
      return false;
    }

    if (inputType === "radio") {
      return fillRadio(input, value as string);
    }

    if (inputType === "range") {
      const numVal = Number(value);
      if (!isNaN(numVal)) {
        const min = Number(input.min) || 0;
        const max = Number(input.max) || 100;
        const clamped = Math.max(min, Math.min(max, numVal));
        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        if (nativeSetter) nativeSetter.call(input, String(clamped));
        else input.value = String(clamped);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      return false;
    }

    if (inputType === "number") {
      const valStr = String(value);
      const numMatch = valStr.match(/-?\d+(\.\d+)?/);
      const numVal = numMatch ? Number(numMatch[0]) : NaN;
      if (!isNaN(numVal)) {
        const min = input.min !== "" ? Number(input.min) : -Infinity;
        const max = input.max !== "" ? Number(input.max) : Infinity;
        const clamped = Math.max(min, Math.min(max, numVal));
        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        if (nativeSetter) nativeSetter.call(input, String(clamped));
        else input.value = String(clamped);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      return false;
    }

    // Date inputs or date-related labels
    const isDateField =
      inputType === "date" ||
      fieldIdentifier.fieldType === "dateOfBirth" ||
      input.id.toLowerCase().includes("date") ||
      input.id.toLowerCase().includes("dob") ||
      input.name.toLowerCase().includes("date") ||
      input.name.toLowerCase().includes("dob") ||
      findLabel(input).toLowerCase().includes("date") ||
      findLabel(input).toLowerCase().includes("dob");

    if (isDateField) {
      const valStr = String(value);
      const isoDate = parseDateString(valStr);
      if (isoDate) {
        const setVal = inputType === "text" ? formatDateForDisplay(isoDate) : isoDate;
        const nativeSetter = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(input),
          "value",
        )?.set;
        if (nativeSetter) nativeSetter.call(input, setVal);
        else input.value = setVal;
        triggerEvents(input);

        // Fill sibling hidden date inputs if present in custom pickers
        const container = input.closest(".field-block, .form-group, .date-trigger-container, div");
        if (container) {
          const hiddenInputs = container.querySelectorAll('input[type="hidden"]');
          hiddenInputs.forEach((hiddenInput) => {
            if (hiddenInput instanceof HTMLInputElement) {
              const hiddenSetter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value",
              )?.set;
              if (hiddenSetter) hiddenSetter.call(hiddenInput, isoDate);
              else hiddenInput.value = isoDate;
              hiddenInput.dispatchEvent(new Event("input", { bubbles: true }));
              hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
            }
          });
        }
      } else {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(input),
          "value",
        )?.set;
        if (nativeSetter) nativeSetter.call(input, valStr);
        else input.value = valStr;
        triggerEvents(input);
      }
      return true;
    }

    // Standard text input
    const delayMs =
      contextOpts?.typingDelayMs !== undefined
        ? contextOpts.typingDelayMs
        : contextOpts?.stealthMode
          ? 25
          : 0;

    if (delayMs > 0 || contextOpts?.stealthMode) {
      await humanTypeValue(input, value as string, delayMs);
    } else {
      setNativeInputValue(input, value as string);
    }
    return true;
  }

  // 3. Textarea element
  if (input instanceof HTMLTextAreaElement) {
    const delayMs =
      contextOpts?.typingDelayMs !== undefined
        ? contextOpts.typingDelayMs
        : contextOpts?.stealthMode
          ? 25
          : 0;

    if (delayMs > 0 || contextOpts?.stealthMode) {
      await humanTypeValue(input, value as string, delayMs);
    } else {
      setNativeInputValue(input, value as string);
    }
    return true;
  }

  // 4. Contenteditable / Chat Input
  if (input.isContentEditable || input.getAttribute("role") === "textbox") {
    const injected = fillChatInputField(input, value as string);
    const isError =
      String(value).includes("[Error") || String(value).includes("I'm sorry");

    if (injected && contextOpts?.autoSubmit && !isError) {
      setTimeout(() => {
        if (!input) return;
        submitChatField(input);
      }, 300);
    }
    return injected;
  }

  // 5. Custom Select fallback
  return await fillCustomSelect(fieldIdentifier.id || "", String(value));
}

/**
 * Fills a form field with the provided value based on field type and accessibility metadata.
 */
export async function fillFormField(
  fieldIdentifier: FieldMapping,
  value: string | string[] | boolean,
  contextOpts?: FillContextOpts,
): Promise<boolean> {
  if (
    value === undefined ||
    value === null ||
    value === "[MANUAL_INPUT_NEEDED]"
  ) {
    return false;
  }

  // 1. Resolve element(s) from DOM
  const { input, inputs } = resolveTargetElement(fieldIdentifier);

  // 2. Tab panel activation if field is inside a hidden tab
  if (input) {
    activateTabForField(input);
  }

  // 3. Container element handling (divs acting as radio/checkbox groups, sliders, toggles)
  if (input && isContainerElement(input)) {
    const filled = await tryFillContainerDiv(input, value);
    if (filled) return true;
  }

  // 4. Platform-specific question container fallbacks (Google Forms & Microsoft Forms)
  if (!input && !inputs) {
    const filled = await tryFillQuestionContainers(fieldIdentifier, value);
    if (filled) return true;
  }

  // 5. Fill multiple elements (e.g. named radio or checkbox groups)
  if (inputs && inputs.length > 0) {
    return fillMultipleElements(inputs, value);
  }

  // 6. Fill single resolved element
  if (input) {
    return fillSingleInputElement(input, fieldIdentifier, value, contextOpts);
  }

  return false;
}

/**
 * React / Vue / Angular / Google Forms Compatible Native Value Setter
 */
export function setNativeInputValue(input: HTMLElement, value: string): void {
  if (!input) return;

  if (
    input instanceof HTMLInputElement ||
    input instanceof HTMLTextAreaElement ||
    input instanceof HTMLSelectElement
  ) {
    try {
      input.focus();
    } catch {
      // Ignore focus error in headless/test environments
    }

    try {
      if (typeof FocusEvent !== "undefined") {
        input.dispatchEvent(
          new FocusEvent("focus", { bubbles: true, composed: true }),
        );
        input.dispatchEvent(
          new FocusEvent("focusin", { bubbles: true, composed: true }),
        );
      } else {
        input.dispatchEvent(
          new Event("focus", { bubbles: true, composed: true }),
        );
        input.dispatchEvent(
          new Event("focusin", { bubbles: true, composed: true }),
        );
      }
    } catch {
      // Ignore dispatch errors in test environment
    }

    const isTextArea =
      input instanceof HTMLTextAreaElement || input.tagName === "TEXTAREA";
    const prototype = isTextArea
      ? (typeof window !== "undefined"
          ? window.HTMLTextAreaElement?.prototype
          : null) || Object.getPrototypeOf(input)
      : (typeof window !== "undefined"
          ? window.HTMLInputElement?.prototype
          : null) || Object.getPrototypeOf(input);

    const valueDescriptor =
      Object.getOwnPropertyDescriptor(prototype, "value") ||
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");

    const previousValue = (input as HTMLInputElement | HTMLTextAreaElement).value;
    if (valueDescriptor && valueDescriptor.set) {
      valueDescriptor.set.call(input, value);
    } else {
      (input as HTMLInputElement | HTMLTextAreaElement).value = value;
    }

    const tracker = (input as unknown as { _valueTracker?: { setValue: (v: string) => void } })._valueTracker;
    if (tracker && typeof tracker.setValue === "function") {
      tracker.setValue(previousValue);
    }

    // Key and input simulation for framework change detection
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "a",
      }),
    );
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(
      new KeyboardEvent("keyup", {
        bubbles: true,
        cancelable: true,
        key: "a",
      }),
    );
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

    try {
      if (typeof FocusEvent !== "undefined") {
        input.dispatchEvent(
          new FocusEvent("blur", { bubbles: true, composed: true }),
        );
        input.dispatchEvent(
          new FocusEvent("focusout", { bubbles: true, composed: true }),
        );
      } else {
        input.dispatchEvent(
          new Event("blur", { bubbles: true, composed: true }),
        );
        input.dispatchEvent(
          new Event("focusout", { bubbles: true, composed: true }),
        );
      }
    } catch {
      // Ignore dispatch errors in test environment
    }

    try {
      input.blur();
    } catch {
      // Ignore blur errors in headless
    }

    highlightElement(input);
  }
}

/**
 * Heuristically finds and fills a 2D matrix field by matching token coordinates to row/col axes.
 */
export function fill2DFieldHeuristically(
  tokens: string[],
  value: string,
): boolean {
  const input = find2DMatrixInput({ tokens });
  if (input) {
    setNativeInputValue(input, value);
    return true;
  }
  return false;
}

/**
 * Fills a 1D field heuristically by token search across name, id, labels, and placeholders.
 */
export function fill1DField(token: string, value: string): boolean {
  const inputs = Array.from(
    document.querySelectorAll<HTMLElement>(
      "input:not([type='hidden']):not([type='submit']):not([disabled]), textarea:not([disabled]), select:not([disabled])",
    ),
  );

  for (const input of inputs) {
    const context = (
      (input.getAttribute("name") || "") +
      " " +
      (input.id || "") +
      " " +
      (findLabel(input) || "") +
      " " +
      (input.getAttribute("placeholder") || "")
    ).toLowerCase();

    if (fuzzyIncludes(context, token)) {
      setNativeInputValue(input, value);
      return true;
    }
  }

  return false;
}

/**
 * Processes custom field array (both 1D fields and 2D matrix fields) dynamically.
 */
export function processCustomFields(
  fields: Array<{ label: string; value: string }>,
): number {
  let filledCount = 0;
  fields.forEach(({ label, value }) => {
    if (!label || !value) return;

    const rawTokens = extractTokens(label);

    if (rawTokens.length < 2) {
      if (fill1DField(rawTokens[0] || label, value)) filledCount++;
    } else {
      if (fill2DFieldHeuristically(rawTokens, value)) {
        filledCount++;
      } else if (fill1DField(label, value)) {
        filledCount++;
      }
    }
  });

  return filledCount;
}
