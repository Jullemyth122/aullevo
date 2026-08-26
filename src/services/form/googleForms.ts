/**
 * Google Forms Injection Engine
 * 
 * Specialized high-performance container-first filler for Google Forms (docs.google.com/forms).
 * Uses question-container traversal, heading extraction, synonym matching, and native React/Closure event suites.
 */

import { setNativeInputValue } from "../formAnalyzer";
import { highlightElement } from "./domUtils";

export interface GoogleFormFieldMatch {
  label: string;
  value: string | boolean | string[];
  matched: boolean;
}

export interface GoogleFormFillResult {
  matchedCount: number;
  details: GoogleFormFieldMatch[];
}

/**
 * Check if the current page is a Google Form
 */
export function isGoogleFormPage(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  return (
    (window.location.hostname.includes("docs.google.com") &&
      window.location.pathname.includes("/forms/")) ||
    document.querySelector("div[role='listitem'], div.Qr7Oae, div[jsmodel], div.geS5n") !== null
  );
}

/**
 * Normalize text by removing asterisks, excess whitespace, and punctuation
 */
export function normalizeGoogleFormText(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[*?:!#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Common synonyms mapping for form fields
 */
const SYNONYMS: Record<string, string[]> = {
  first: ["given", "forename", "fname"],
  last: ["surname", "family", "lname"],
  surname: ["last", "family", "lname"],
  address: ["residential", "street", "residence", "addr", "location"],
  residential: ["address", "residence", "addr", "street"],
  phone: ["mobile", "tel", "contact", "cell", "telephone"],
  email: ["mail", "e-mail"],
  salutation: ["title", "prefix", "honorific"],
  gender: ["sex"],
  city: ["municipality", "town"],
  zip: ["postal", "postcode", "zipcode"],
};

/**
 * Label matching logic (handles asterisks, punctuation, synonyms, prefixes/suffixes)
 */
export function isGoogleFormLabelMatch(targetLabel: string, sourceText: string): boolean {
  if (!targetLabel || !sourceText) return false;

  const normTarget = normalizeGoogleFormText(targetLabel);
  const normSource = normalizeGoogleFormText(sourceText);

  // Exact or direct substring match
  if (
    normSource === normTarget ||
    normSource.includes(normTarget) ||
    normTarget.includes(normSource)
  ) {
    return true;
  }

  // Tokenized fuzzy matching
  const targetTokens = normTarget
    .split(/[\s\-_/\\|:,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const sourceTokens = normSource
    .split(/[\s\-_/\\|:,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (targetTokens.length === 0 || sourceTokens.length === 0) return false;

  let matchedTokensCount = 0;
  targetTokens.forEach((tTok) => {
    const tLower = tTok.toLowerCase();
    const inSource = sourceTokens.some((sTok) => {
      const sLower = sTok.toLowerCase();
      if (sLower === tLower || sLower.includes(tLower) || tLower.includes(sLower)) return true;
      if (SYNONYMS[tLower] && SYNONYMS[tLower].includes(sLower)) return true;
      if (SYNONYMS[sLower] && SYNONYMS[sLower].includes(tLower)) return true;
      return false;
    });
    if (inSource) matchedTokensCount++;
  });

  // If >= 60% of tokens match
  return matchedTokensCount / targetTokens.length >= 0.6;
}

/**
 * Extract Question Header text from a Google Form container
 */
export function getGoogleFormQuestionHeading(container: HTMLElement): string {
  const headerEl = container.querySelector<HTMLElement>(
    "div[role='heading'], span.M7eMe, div.M7eMe, div.HofdId, div.c2gGi, .HoFid, [aria-label]"
  );
  if (headerEl) {
    return headerEl.innerText || headerEl.textContent || "";
  }
  return container.innerText || container.textContent || "";
}

/**
 * Visual highlight indicator pulse
 */
export function highlightGoogleFormElement(el: HTMLElement): void {
  highlightElement(el);
}

/**
 * Fill a single Google Form question container with target value
 */
export function fillGoogleFormQuestionContainer(
  container: HTMLElement,
  targetValue: string | boolean | string[]
): boolean {
  const strVal = Array.isArray(targetValue)
    ? targetValue.join(", ")
    : String(targetValue ?? "");

  // 1. Text Input (Short answer)
  const textInput = container.querySelector<HTMLInputElement>(
    "input.whsOnd, input[type='text'], input[type='email'], input[type='number'], input[type='tel'], input[type='url'], input:not([type='hidden'])"
  );
  if (textInput && !textInput.disabled && textInput.type !== "radio" && textInput.type !== "checkbox") {
    setNativeInputValue(textInput, strVal);
    highlightGoogleFormElement(textInput);
    return true;
  }

  // 2. Textarea (Paragraph answer)
  const textarea = container.querySelector<HTMLTextAreaElement>(
    "textarea.KHxj8b, textarea.tL9Q4c, textarea"
  );
  if (textarea && !textarea.disabled) {
    setNativeInputValue(textarea, strVal);
    highlightGoogleFormElement(textarea);
    return true;
  }

  // 3. Radio Buttons (Multiple choice)
  const radioItems = Array.from(
    container.querySelectorAll<HTMLElement>(
      "div[role='radio'], label, .docssharedWizToggleLabeledContainer"
    )
  );
  if (radioItems.length > 0) {
    const valText = normalizeGoogleFormText(strVal);
    for (const rItem of radioItems) {
      const rText = normalizeGoogleFormText(
        rItem.innerText || rItem.getAttribute("data-value") || rItem.getAttribute("aria-label") || ""
      );
      if (rText && (rText === valText || rText.includes(valText) || valText.includes(rText))) {
        const clickable = (rItem.querySelector<HTMLElement>("div[role='radio']") || rItem) as HTMLElement;
        clickable.click();
        clickable.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: typeof window !== "undefined" ? window : undefined,
          })
        );
        highlightGoogleFormElement(clickable);
        return true;
      }
    }
  }

  // 4. Checkboxes (Checkboxes question)
  const checkboxItems = Array.from(
    container.querySelectorAll<HTMLElement>(
      "div[role='checkbox'], input[type='checkbox']"
    )
  );
  if (checkboxItems.length > 0) {
    const valText = normalizeGoogleFormText(strVal);
    for (const cItem of checkboxItems) {
      const cContainer = cItem.closest<HTMLElement>("label, .docssharedWizToggleLabeledContainer");
      const cText = normalizeGoogleFormText(
        cContainer?.innerText || cItem.getAttribute("aria-label") || ""
      );
      if (cText && (cText === valText || cText.includes(valText) || valText.includes(cText))) {
        cItem.click();
        highlightGoogleFormElement(cItem);
        return true;
      }
    }
  }

  // 5. Dropdown (Listbox)
  const listbox = container.querySelector<HTMLElement>("div[role='listbox']");
  if (listbox) {
    listbox.click();
    setTimeout(() => {
      const optionElements = Array.from(document.querySelectorAll<HTMLElement>("div[role='option']"));
      for (const opt of optionElements) {
        if (normalizeGoogleFormText(opt.innerText).includes(normalizeGoogleFormText(strVal))) {
          opt.click();
          highlightGoogleFormElement(listbox);
          break;
        }
      }
    }, 100);
    return true;
  }

  return false;
}

/**
 * Execute full Google Form fill pass over target field entries
 */
export function fillGoogleForm(
  fields: { label: string; value: string | boolean | string[] }[]
): GoogleFormFillResult {
  let matchedCount = 0;
  const details: GoogleFormFieldMatch[] = [];

  const questionContainers = Array.from(
    document.querySelectorAll<HTMLElement>(
      "div[role='listitem'], div.Qr7Oae, div.geS5n, div.m7Wjg"
    )
  );

  fields.forEach((field) => {
    let fieldMatched = false;
    const targetLabel = field.label;
    const targetValue = field.value;

    for (const container of questionContainers) {
      const containerHeading = getGoogleFormQuestionHeading(container);
      if (isGoogleFormLabelMatch(targetLabel, containerHeading)) {
        fieldMatched = fillGoogleFormQuestionContainer(container, targetValue);
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
  });

  return { matchedCount, details };
}
