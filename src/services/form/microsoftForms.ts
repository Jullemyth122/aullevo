/**
 * Microsoft Forms Injection Engine
 *
 * Specialized high-performance container-first filler for Microsoft Forms (forms.office.com / forms.cloud.microsoft).
 * Uses question-container traversal, Fluent UI / React event suites, and automated option matching.
 */

import { setNativeInputValue } from "../formAnalyzer";
import { highlightElement } from "./domUtils";
import { dispatchSinglePointerClick } from "./events";
import { scoreOptionMatch } from "./matchers";

export interface MicrosoftFormFieldMatch {
  label: string;
  value: string | boolean | string[];
  matched: boolean;
}

export interface MicrosoftFormFillResult {
  matchedCount: number;
  details: MicrosoftFormFieldMatch[];
}

/**
 * Check if the current page is a Microsoft Form
 */
export function isMicrosoftFormPage(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined")
    return false;
  return (
    window.location.hostname.includes("forms.office.com") ||
    window.location.hostname.includes("forms.cloud.microsoft") ||
    window.location.hostname.includes("forms.microsoft.com") ||
    document.querySelector(
      "[data-automation-id='questionItem'], .office-form-question",
    ) !== null
  );
}

/**
 * Check if element is specifically a Microsoft Forms dropdown component
 */
export function isMicrosoftFormsDropdown(
  dropdownEl: HTMLElement | null,
): boolean {
  if (!dropdownEl) return false;
  const cl = (dropdownEl.className || "").toString();
  const autoId = dropdownEl.getAttribute("data-automation-id") || "";
  return !!(
    autoId === "select" ||
    autoId.includes("select") ||
    dropdownEl.querySelector("[data-automation-id='select']") ||
    cl.includes("office-form-question-dropdown") ||
    (dropdownEl.closest("[data-automation-id='questionItem']") &&
      (dropdownEl.getAttribute("role") === "combobox" ||
        dropdownEl.getAttribute("role") === "listbox"))
  );
}

/**
 * Normalize Microsoft Form text by stripping question numbers, asterisks, punctuation
 */
export function normalizeMicrosoftFormText(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(
      /^\s*(?:question\s*\d+[:\-.]?|\d+[.)\-:]|[a-zA-Z][.)\-:])\s*/i,
      "",
    )
    .replace(/[*?:!#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract Question Header text from a Microsoft Form container
 */
export function getMicrosoftFormQuestionHeading(
  container: HTMLElement,
): string {
  const headerEl = container.querySelector<HTMLElement>(
    "[data-automation-id='questionTitle'], .office-form-question-title, .text-format-content, [role='heading']",
  );
  if (headerEl) {
    return headerEl.innerText || headerEl.textContent || "";
  }
  return container.innerText || container.textContent || "";
}

/**
 * Dedicated Microsoft Forms dropdown interactor
 */
export async function fillMicrosoftFormsDropdown(
  dropdownEl: HTMLElement,
  targetValue: string,
): Promise<boolean> {
  if (!dropdownEl || !targetValue) return false;

  // 1. Scroll dropdown smoothly into view
  try {
    dropdownEl.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    // Suppress scroll error in restricted environments
    dropdownEl.scrollIntoView(true);
  }
  await new Promise((r) => setTimeout(r, 150));

  // 2. Locate the dropdown button / combobox element
  const trigger =
    dropdownEl.querySelector<HTMLElement>(
      "[data-automation-id='select'], [role='combobox'], [role='listbox'], button",
    ) || dropdownEl;

  // 3. Open dropdown
  dispatchSinglePointerClick(trigger);
  await new Promise((r) => setTimeout(r, 300));

  // 4. Locate popup options container (Fluent UI callout or dropdown list)
  const questionCard =
    dropdownEl.closest<HTMLElement>(
      "[data-automation-id='questionItem'], .office-form-question",
    ) || dropdownEl.parentElement || dropdownEl;

  let popupContainer =
    dropdownEl.querySelector<HTMLElement>(
      "[data-automation-id='selectOptionsContainer'], .ms-Dropdown-callout, .ms-Callout-main, [role='listbox']",
    ) ||
    questionCard.querySelector<HTMLElement>(
      "[data-automation-id='selectOptionsContainer'], .ms-Dropdown-callout, .ms-Callout-main, [role='listbox']",
    ) ||
    document.querySelector<HTMLElement>(
      "[data-automation-id='selectOptionsContainer'], .ms-Dropdown-callout, .ms-Callout-main, div[role='listbox']",
    );

  if (!popupContainer) {
    dispatchSinglePointerClick(trigger);
    await new Promise((r) => setTimeout(r, 300));
    popupContainer =
      document.querySelector<HTMLElement>(
        "[data-automation-id='selectOptionsContainer'], .ms-Dropdown-callout, .ms-Callout-main, div[role='listbox']",
      ) || dropdownEl;
  }

  // 5. Find matching option element
  const allOptionElements = Array.from(
    popupContainer.querySelectorAll<HTMLElement>(
      "[data-automation-id='selectOption'], .ms-Dropdown-item, [role='option'], li[role='option'], div.office-form-question-dropdown-item",
    ),
  );

  let bestOpt: HTMLElement | null = null;
  let bestScore = -1;

  for (const opt of allOptionElements) {
    const text = (
      opt.getAttribute("title") ||
      opt.getAttribute("aria-label") ||
      opt.textContent ||
      ""
    ).trim();

    const normTarget = targetValue.toLowerCase().trim();
    const score = scoreOptionMatch(text, "", normTarget);
    if (score > bestScore) {
      bestScore = score;
      bestOpt = opt;
    }
  }

  if (!bestOpt || bestScore < 60) {
    console.warn(
      `Aullevo: Could not match target "${targetValue}" in Microsoft Forms dropdown options`,
    );
    dispatchSinglePointerClick(trigger);
    return false;
  }

  // 6. Scroll into view and click
  try {
    bestOpt.scrollIntoView({ behavior: "instant", block: "nearest" });
  } catch {
    // Suppress scroll error in headless/virtual DOM environments
  }
  await new Promise((r) => setTimeout(r, 80));

  const clickTarget =
    bestOpt.querySelector<HTMLElement>(
      "[data-automation-id='selectOptionText'], span",
    ) || bestOpt;
  dispatchSinglePointerClick(clickTarget);

  try {
    bestOpt.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        bubbles: true,
        cancelable: true,
      }),
    );
  } catch {
    // Suppress keyboard dispatch failure in unsupported environments
  }

  await new Promise((r) => setTimeout(r, 250));
  highlightElement(dropdownEl);
  return true;
}

/**
 * Fill a single Microsoft Form question container with target value
 */
export async function fillMicrosoftFormQuestionContainer(
  container: HTMLElement,
  targetValue: string | boolean | string[],
): Promise<boolean> {
  const strVal = Array.isArray(targetValue)
    ? targetValue.join(", ")
    : String(targetValue ?? "");

  // 1. Text Input
  const textInput = container.querySelector<HTMLInputElement>(
    "input[data-automation-id='textInput'], textarea[data-automation-id='textInput'], input:not([type='hidden']):not([type='radio']):not([type='checkbox']), textarea",
  );
  if (textInput && !textInput.disabled) {
    setNativeInputValue(textInput, strVal);
    highlightElement(textInput);
    return true;
  }

  // 2. Radio Choices
  const radioItems = Array.from(
    container.querySelectorAll<HTMLElement>(
      "input[data-automation-id='radio'], input[type='radio'], [role='radio'], [data-automation-id='choiceItem']",
    ),
  );
  if (radioItems.length > 0) {
    const valNorm = normalizeMicrosoftFormText(strVal);
    for (const rItem of radioItems) {
      const choiceLabel =
        rItem
          .closest("[data-automation-id='choiceItem']")
          ?.querySelector<HTMLElement>("[data-automation-id='choiceLabel']") ||
        rItem;
      const rText = normalizeMicrosoftFormText(
        choiceLabel.innerText || choiceLabel.textContent || "",
      );
      if (
        rText &&
        (rText === valNorm ||
          rText.includes(valNorm) ||
          valNorm.includes(rText))
      ) {
        dispatchSinglePointerClick(rItem);
        highlightElement(rItem);
        return true;
      }
    }
  }

  // 3. Checkbox Choices
  const checkboxItems = Array.from(
    container.querySelectorAll<HTMLElement>(
      "input[data-automation-id='checkbox'], input[type='checkbox'], [role='checkbox']",
    ),
  );
  if (checkboxItems.length > 0) {
    const valNorm = normalizeMicrosoftFormText(strVal);
    for (const cItem of checkboxItems) {
      const choiceLabel =
        cItem
          .closest("[data-automation-id='choiceItem']")
          ?.querySelector<HTMLElement>("[data-automation-id='choiceLabel']") ||
        cItem;
      const cText = normalizeMicrosoftFormText(
        choiceLabel.innerText || choiceLabel.textContent || "",
      );
      if (
        cText &&
        (cText === valNorm ||
          cText.includes(valNorm) ||
          valNorm.includes(cText))
      ) {
        dispatchSinglePointerClick(cItem);
        highlightElement(cItem);
        return true;
      }
    }
  }

  // 4. Dropdown Select
  const dropdownEl =
    container.querySelector<HTMLElement>(
      "[data-automation-id='select'], .office-form-question-dropdown, [role='combobox'], [role='listbox']",
    ) || (isMicrosoftFormsDropdown(container) ? container : null);
  if (dropdownEl) {
    return await fillMicrosoftFormsDropdown(dropdownEl, strVal);
  }

  return false;
}

/**
 * Execute full Microsoft Form fill pass over target field entries
 */
export async function fillMicrosoftForm(
  fields: { label: string; value: string | boolean | string[] }[],
): Promise<MicrosoftFormFillResult> {
  let matchedCount = 0;
  const details: MicrosoftFormFieldMatch[] = [];

  const questionContainers = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-automation-id='questionItem'], .office-form-question",
    ),
  );

  for (const field of fields) {
    let fieldMatched = false;
    const targetLabel = field.label;
    const targetValue = field.value;

    for (const container of questionContainers) {
      const heading = getMicrosoftFormQuestionHeading(container);
      const normHeading = normalizeMicrosoftFormText(heading);
      const normTarget = normalizeMicrosoftFormText(targetLabel);

      if (
        normHeading === normTarget ||
        normHeading.includes(normTarget) ||
        normTarget.includes(normHeading) ||
        scoreOptionMatch(normHeading, "", normTarget) >= 60
      ) {
        fieldMatched = await fillMicrosoftFormQuestionContainer(
          container,
          targetValue,
        );
        if (fieldMatched) {
          matchedCount++;
          break;
        }
      }
    }

    details.push({
      label: field.label,
      value: field.value,
      matched: fieldMatched,
    });
  }

  return { matchedCount, details };
}
