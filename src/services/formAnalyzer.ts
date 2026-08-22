import type { FormField, FieldMapping } from "../types";
import {
  findElementByIdOrSelector,
  activateTabForField,
  find2DMatrixInput,
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

// Re-export all submodules so existing imports throughout the codebase remain 100% compatible
export * from "./form";
export type { FormField, FieldMapping };

/**
 * Fills a form field with the provided value based on field type and accessibility metadata.
 */

export async function fillFormField(
  fieldIdentifier: FieldMapping,
  value: string | string[] | boolean,
  contextOpts?: {
    resumeFileData?: string;
    resumeFileName?: string;
    autoSubmit?: boolean;
  },
): Promise<boolean> {
  if (
    value === undefined ||
    value === null ||
    value === "[MANUAL_INPUT_NEEDED]"
  ) {
    return false;
  }

  let input = findElementByIdOrSelector(fieldIdentifier.id || "");
  let inputs: NodeListOf<Element> | null = null;

  // Tab panel activation: if the field is inside a hidden tabpanel, click its tab first
  if (input) {
    activateTabForField(input);
  }

  if (fieldIdentifier.id) {
    input = findElementByIdOrSelector(fieldIdentifier.id);

    // If the id resolves to a container div (not an input),
    // check if it wraps radio/checkbox inputs and handle as a group
    if (
      input &&
      !(input instanceof HTMLInputElement) &&
      !(input instanceof HTMLSelectElement) &&
      !(input instanceof HTMLTextAreaElement) &&
      !(input instanceof HTMLButtonElement)
    ) {
      const childRadios = input.querySelectorAll<HTMLInputElement>(
        'input[type="radio"]',
      );
      const childCheckboxes = input.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]',
      );

      if (childRadios.length > 0) {
        return fillRadioGroup(childRadios, value);
      }
      if (childCheckboxes.length > 0) {
        return fillCheckboxGroup(childCheckboxes, value);
      }

      // Handle toggle/switch divs
      if (
        input.classList.contains("toggle") ||
        input.getAttribute("role") === "switch" ||
        input.classList.contains("switch") ||
        input.classList.contains("toggle-switch")
      ) {
        return fillToggle(input, value);
      }

      // Handle div-based ARIA slider and spinbutton
      if (input.getAttribute("role") === "slider") {
        return fillAriaSlider(input, value);
      }
      if (input.getAttribute("role") === "spinbutton") {
        return fillAriaSpinbutton(input, value);
      }
    }

    if (!input) {
      inputs = document.querySelectorAll(`[name="${fieldIdentifier.id}"]`);
      if (inputs.length === 0) inputs = null;
    }
  }

  // ── 2D Matrix Cell Lookup for Inputs (Tables, Grids, Multiplication tables, Availability) ──
  if (!input && !inputs) {
    if (fieldIdentifier.rowHeader || fieldIdentifier.colHeader || fieldIdentifier.compoundLabel) {
      input = find2DMatrixInput({
        rowHeader: fieldIdentifier.rowHeader,
        colHeader: fieldIdentifier.colHeader,
        compoundLabel: fieldIdentifier.compoundLabel,
      });
    }

    if (!input && fieldIdentifier.fieldType?.startsWith("custom_field:")) {
      const customLabel = fieldIdentifier.fieldType.slice("custom_field:".length);
      const tokens = customLabel
        .split(/[\s\-_/\\|:*xX]+/)
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0);
      if (tokens.length >= 2) {
        input = find2DMatrixInput({ tokens });
      }
    }

    if (!input && (fieldIdentifier as any).label) {
      const tokens = String((fieldIdentifier as any).label)
        .split(/[\s\-_/\\|:*xX]+/)
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0);
      if (tokens.length >= 2) {
        input = find2DMatrixInput({ tokens });
      }
    }
  }

  // ── 2D Matrix Row Lookup for Radios/Checkboxes ──
  if (!input && !inputs && fieldIdentifier.rowHeader) {
    const rowNorm = fieldIdentifier.rowHeader.toLowerCase().trim();

    // Strategy A: Inspect table/grid rows with matching row header cell
    const allRows = document.querySelectorAll<HTMLElement>(
      "tr, [role='row'], [class*='matrix-row'], [class*='table-row'], [class*='matrix_row']",
    );
    for (const row of Array.from(allRows)) {
      const firstCell = row.querySelector(
        "th, td:first-child, [role='rowheader'], [class*='row-header'], [class*='rowHeader']",
      );
      const firstCellText = firstCell
        ? cleanLabelText(firstCell.textContent || "")
            .toLowerCase()
            .trim()
        : "";

      if (firstCellText === rowNorm) {
        const rowRadios = row.querySelectorAll<HTMLInputElement>(
          'input[type="radio"], [role="radio"]',
        );
        if (rowRadios.length > 0) {
          return fillRadioGroup(rowRadios, value);
        }

        const rowCheckboxes = row.querySelectorAll<HTMLInputElement>(
          'input[type="checkbox"], [role="checkbox"]',
        );
        if (rowCheckboxes.length > 0) {
          return fillCheckboxGroup(rowCheckboxes, value);
        }
      }
    }

    // Strategy B: Raycasting & Matrix header extraction matching
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
      const isRadio =
        matchingRowInputs[0].type === "radio" ||
        matchingRowInputs[0].getAttribute("role") === "radio";
      if (isRadio) {
        return fillRadioGroup(matchingRowInputs, value);
      } else {
        return fillCheckboxGroup(matchingRowInputs, value);
      }
    }
  }

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

  // Fallback for Messenger/React chat boxes that strip IDs on re-render
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

  if (!input && !inputs && fieldIdentifier.id) {
    const isCustomSelect =
      fieldIdentifier.id.startsWith("custom_select_") ||
      document.querySelector(`[data-testid="${fieldIdentifier.id}"]`);
    if (isCustomSelect) {
      return fillCustomSelect(fieldIdentifier.id, String(value));
    }
  }

  if (!input && !inputs) return false;

  if (inputs && inputs.length > 0) {
    let filledAny = false;
    const allInputs = Array.from(inputs).filter(
      (el): el is HTMLInputElement => el instanceof HTMLInputElement,
    );

    if (allInputs.length > 0) {
      const candidateInputs = allInputs;
      const firstType = candidateInputs[0]?.type;

      if (firstType === "radio") {
        return fillRadioGroup(candidateInputs, value);
      }
      if (firstType === "checkbox") {
        return fillCheckboxGroup(candidateInputs, value);
      }

      candidateInputs.forEach((el) => {
        const valStr = String(value).toLowerCase().trim();
        const label = findLabel(el).toLowerCase().trim();
        if (
          el.value.toLowerCase() === valStr ||
          label.includes(valStr) ||
          valStr.includes(label) ||
          fuzzyMatch(label, valStr) ||
          fuzzyMatch(el.value, valStr)
        ) {
          setCheckboxState(el, true);
          filledAny = true;
        }
      });
      if (filledAny) return true;
    }
  }

  if (input) {
    if (input instanceof HTMLSelectElement) {
      fillSelect(input, value as string);
      return select_was_filled(input);
    } else if (input instanceof HTMLInputElement) {
      if (input.type === "checkbox") {
        const valLower = String(value).toLowerCase().trim();
        const isExplicitTrue =
          ["true", "yes", "y", "1", "checked", "on"].includes(valLower) ||
          /\b(agree|accept|consent|confirm)\b/i.test(valLower);

        const isExplicitFalse = [
          "false",
          "no",
          "n",
          "0",
          "unchecked",
          "off",
          "disagree",
          "decline",
        ].includes(valLower);

        if (isExplicitTrue) {
          setCheckboxState(input, true);
          return true;
        } else if (isExplicitFalse) {
          setCheckboxState(input, false);
          return true;
        }

        const descriptors = getOptionDescriptors(input);
        const valuesToCheck = parseValueTokens(valLower);
        const matches = valuesToCheck.some((valStr) =>
          optionMatchesValue(descriptors, valStr),
        );

        if (matches) {
          setCheckboxState(input, true);
          return true;
        } else {
          setCheckboxState(input, false);
          return false;
        }
      } else if (input.type === "file") {
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
      } else if (input.type === "radio") {
        return fillRadio(input, value as string);
      } else if (input.type === "range") {
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
        }
      } else if (input.type === "number") {
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
          console.log(
            `Aullevo number: "${valStr}" → ${clamped} (min=${min}, max=${max})`,
          );
        } else {
          console.warn(
            `Aullevo: Could not extract number from "${valStr}" for input#${input.id}`,
          );
          return false;
        }
      } else if (
        input.type === "date" ||
        fieldIdentifier.fieldType === "dateOfBirth" ||
        input.id.toLowerCase().includes("date") ||
        input.id.toLowerCase().includes("dob") ||
        input.name.toLowerCase().includes("date") ||
        input.name.toLowerCase().includes("dob") ||
        findLabel(input).toLowerCase().includes("date") ||
        findLabel(input).toLowerCase().includes("dob")
      ) {
        const valStr = String(value);
        const isoDate = parseDateString(valStr);
        if (isoDate) {
          let setVal = isoDate;
          if (input.type === "text") {
            setVal = formatDateForDisplay(isoDate);
          }

          const nativeSetter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(input),
            "value",
          )?.set;
          if (nativeSetter) {
            nativeSetter.call(input, setVal);
          } else {
            input.value = setVal;
          }
          triggerEvents(input);

          // For custom date pickers, if there is a sibling hidden input, fill that too!
          const container = input.closest(
            ".field-block, .form-group, .date-trigger-container, div",
          );
          if (container) {
            const hiddenInputs = container.querySelectorAll(
              'input[type="hidden"]',
            );
            hiddenInputs.forEach((hiddenInput) => {
              if (hiddenInput instanceof HTMLInputElement) {
                const hiddenSetter = Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  "value",
                )?.set;
                if (hiddenSetter) {
                  hiddenSetter.call(hiddenInput, isoDate);
                } else {
                  hiddenInput.value = isoDate;
                }
                hiddenInput.dispatchEvent(
                  new Event("input", { bubbles: true }),
                );
                hiddenInput.dispatchEvent(
                  new Event("change", { bubbles: true }),
                );
              }
            });
          }
        } else {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(input),
            "value",
          )?.set;
          if (nativeSetter) {
            nativeSetter.call(input, valStr);
          } else {
            input.value = valStr;
          }
          triggerEvents(input);
        }
      } else {
        const storage = await chrome.storage.local.get("stealthMode");
        const isStealth = storage.stealthMode === true;
        if (isStealth) {
          await humanTypeValue(input, value as string);
        } else {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(input),
            "value",
          )?.set;
          if (nativeSetter) {
            nativeSetter.call(input, value as string);
          } else {
            input.value = value as string;
          }
          triggerEvents(input);
        }
      }
    } else if (input instanceof HTMLTextAreaElement) {
      const storage = await chrome.storage.local.get("stealthMode");
      const isStealth = storage.stealthMode === true;
      if (isStealth) {
        await humanTypeValue(input, value as string);
      } else {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        if (nativeSetter) {
          nativeSetter.call(input, value as string);
        } else {
          input.value = value as string;
        }
        triggerEvents(input);
      }
    } else if (
      input.isContentEditable ||
      input.getAttribute("role") === "textbox"
    ) {
      const injected = fillChatInputField(input, value as string);
      const isError =
        String(value).includes("[Error") || String(value).includes("I'm sorry");

      if (injected && contextOpts?.autoSubmit && !isError) {
        setTimeout(() => {
          if (!input) return;
          submitChatField(input);
        }, 300);
      }
    } else {
      return fillCustomSelect(fieldIdentifier.id || "", String(value));
    }
    return true;
  }

  return false;
}

/**
 * React / Vue / Angular Compatible Native Value Setter
 */
export function setNativeInputValue(input: HTMLElement, value: string): void {
  if (
    input instanceof HTMLInputElement ||
    input instanceof HTMLTextAreaElement ||
    input instanceof HTMLSelectElement
  ) {
    const nativeInputValueSetter =
      Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(input),
        "value",
      )?.set ||
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, value);
    } else {
      (input as any).value = value;
    }
  }

  triggerEvents(input);
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

    const rawTokens = label
      .split(/[\s\-_/\\|:*xX]+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);

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
