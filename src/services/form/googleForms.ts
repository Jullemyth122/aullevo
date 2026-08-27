/**
 * Google Forms Injection Engine
 *
 * Specialized high-performance container-first filler for Google Forms (docs.google.com/forms).
 * Uses question-container traversal, heading extraction, synonym matching, and native React/Closure event suites.
 */

import { setNativeInputValue } from "../formAnalyzer";
import { highlightElement, isVisible } from "./domUtils";
import { dispatchSinglePointerClick } from "./events";
import { scoreOptionMatch } from "./matchers";

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
  if (typeof window === "undefined" || typeof document === "undefined")
    return false;
  return (
    (window.location.hostname.includes("docs.google.com") &&
      window.location.pathname.includes("/forms/")) ||
    document.querySelector(
      "div[role='listitem'], div.Qr7Oae, div[jsmodel], div.geS5n",
    ) !== null
  );
}

/**
 * Check if element is specifically a Google Forms dropdown component
 */
export function isGoogleFormsDropdown(dropdownEl: HTMLElement | null): boolean {
  if (!dropdownEl) return false;
  const cl = (dropdownEl.className || "").toString();
  return !!(
    dropdownEl.querySelector("[jsname='LgbsSe']") ||
    dropdownEl.querySelector(
      ".quantumWizMenuPaperselectDropDown, .exportSelect, .OA0qNb, [jsname='V68bde']",
    ) ||
    dropdownEl.getAttribute("jsname") === "W7NXsf" ||
    cl.includes("quantumWizMenuPaperselect") ||
    cl.includes("exportSelect") ||
    cl.includes("ry3kXd") ||
    dropdownEl.closest(".geS5n, .Qr7Oae, [role='listitem']")
  );
}

/**
 * Dedicated Google Forms dropdown interactor (handles JSAction, Closure, and dynamic .OA0qNb popup)
 */
export async function fillGoogleFormsDropdown(
  dropdownEl: HTMLElement,
  targetValue: string,
): Promise<boolean> {
  if (!dropdownEl || !targetValue) return false;

  // 1. Scroll dropdown smoothly into center view
  try {
    dropdownEl.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    dropdownEl.scrollIntoView(true);
  }
  await new Promise((r) => setTimeout(r, 150));

  // 2. Identify the Google Forms trigger element (div[jsname="LgbsSe"] or .ry3kXd)
  const trigger =
    dropdownEl.querySelector<HTMLElement>("[jsname='LgbsSe']") ||
    dropdownEl.querySelector<HTMLElement>(
      ".quantumWizMenuPaperselectDropDown, .exportSelect, .ry3kXd",
    ) ||
    dropdownEl;

  // 3. Open the dropdown with clean pointer click sequence
  dispatchSinglePointerClick(trigger);
  await new Promise((r) => setTimeout(r, 300));

  // 4. Locate the Google Forms options popup container (div.OA0qNb or [jsname='V68bde'])
  const questionCard =
    dropdownEl.closest<HTMLElement>(
      ".geS5n, .Qr7Oae, [role='listitem']",
    ) || dropdownEl.parentElement || dropdownEl;

  let popupContainer =
    dropdownEl.querySelector<HTMLElement>(".OA0qNb, [jsname='V68bde']") ||
    questionCard.querySelector<HTMLElement>(".OA0qNb, [jsname='V68bde']") ||
    document.querySelector<HTMLElement>(
      ".OA0qNb:not([style*='display: none']), .OA0qNb",
    );

  // If popup didn't open on first attempt, retry opening once
  if (!popupContainer || !isVisible(popupContainer)) {
    dispatchSinglePointerClick(trigger);
    await new Promise((r) => setTimeout(r, 250));
    popupContainer =
      dropdownEl.querySelector<HTMLElement>(".OA0qNb, [jsname='V68bde']") ||
      questionCard.querySelector<HTMLElement>(".OA0qNb, [jsname='V68bde']") ||
      document.querySelector<HTMLElement>(
        ".OA0qNb:not([style*='display: none']), .OA0qNb",
      );
  }

  // 5. Query all options from popup or question card
  let optionEls: HTMLElement[] = [];
  if (popupContainer) {
    optionEls = Array.from(
      popupContainer.querySelectorAll<HTMLElement>(
        "[jsname='Nmvb'], .MocG8c[data-value], [role='option'], .MocG8c",
      ),
    );
  }
  if (optionEls.length === 0) {
    optionEls = Array.from(
      questionCard.querySelectorAll<HTMLElement>(
        "[jsname='Nmvb'], .MocG8c[data-value], [role='option']",
      ),
    );
  }

  // Filter out the trigger button itself if accidentally captured
  optionEls = optionEls.filter(
    (el) =>
      el !== trigger &&
      el !== dropdownEl &&
      el.getAttribute("jsname") !== "LgbsSe",
  );

  if (optionEls.length === 0) {
    console.warn(
      "Aullevo: No options discovered in Google Forms dropdown:",
      dropdownEl,
    );
    return false;
  }

  // 6. Match candidate options against target value
  const normTarget = normalizeGoogleFormText(targetValue);
  let bestOpt: HTMLElement | null = null;
  let bestScore = 0;

  for (const opt of optionEls) {
    const dataVal = (opt.getAttribute("data-value") || "").trim();
    const textVal = (
      opt.querySelector(".vRMGwf, span")?.textContent ||
      opt.textContent ||
      ""
    ).trim();
    const rawText = dataVal || textVal;
    const optNorm = normalizeGoogleFormText(rawText);

    // Skip the "Choose" placeholder option (data-value="" or text "choose")
    if (
      (!rawText || optNorm === "choose" || optNorm === "select") &&
      normTarget !== optNorm
    ) {
      continue;
    }

    // Exact match
    if (
      optNorm === normTarget ||
      normalizeGoogleFormText(dataVal) === normTarget ||
      normalizeGoogleFormText(textVal) === normTarget
    ) {
      bestOpt = opt;
      bestScore = 1.0;
      break;
    }

    // Match score
    const scoreVal = scoreOptionMatch(textVal, dataVal, normTarget);
    const normalizedScore = scoreVal / 100;
    if (normalizedScore > bestScore) {
      bestScore = normalizedScore;
      bestOpt = opt;
    }
  }

  if (!bestOpt || bestScore < 0.4) {
    console.warn(
      `Aullevo: Could not match target "${targetValue}" in Google Forms dropdown options`,
    );
    // Close dropdown cleanly
    dispatchSinglePointerClick(trigger);
    return false;
  }

  // 7. Scroll option into view
  try {
    bestOpt.scrollIntoView({ behavior: "instant", block: "nearest" });
  } catch {
    // Suppress scroll error in headless/virtual DOM environments
  }
  await new Promise((r) => setTimeout(r, 80));

  // 8. Focus and dispatch click sequence directly to option's text container (.vRMGwf) and option itself
  try {
    bestOpt.focus();
  } catch {
    // Suppress focus error in headless/virtual DOM environments
  }
  const clickTarget =
    bestOpt.querySelector<HTMLElement>(".vRMGwf, span") || bestOpt;
  dispatchSinglePointerClick(clickTarget);

  // 9. Dispatch keyboard Enter as robust secondary trigger
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
    bestOpt.dispatchEvent(
      new KeyboardEvent("keyup", {
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

  // 10. Allow Google Forms jsaction / jsmodel 300ms to commit the selection
  await new Promise((r) => setTimeout(r, 300));

  highlightGoogleFormElement(dropdownEl);
  return true;
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
export function isGoogleFormLabelMatch(
  targetLabel: string,
  sourceText: string,
): boolean {
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
      if (
        sLower === tLower ||
        sLower.includes(tLower) ||
        tLower.includes(sLower)
      )
        return true;
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
    "div[role='heading'], span.M7eMe, div.M7eMe, div.HofdId, div.c2gGi, .HoFid, [aria-label]",
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
export async function fillGoogleFormQuestionContainer(
  container: HTMLElement,
  targetValue: string | boolean | string[],
): Promise<boolean> {
  const strVal = Array.isArray(targetValue)
    ? targetValue.join(", ")
    : String(targetValue ?? "");

  // 1. Text Input (Short answer)
  const textInput = container.querySelector<HTMLInputElement>(
    "input.whsOnd, input[type='text'], input[type='email'], input[type='number'], input[type='tel'], input[type='url'], input:not([type='hidden'])",
  );
  if (
    textInput &&
    !textInput.disabled &&
    textInput.type !== "radio" &&
    textInput.type !== "checkbox"
  ) {
    setNativeInputValue(textInput, strVal);
    highlightGoogleFormElement(textInput);
    return true;
  }

  // 2. Textarea (Paragraph answer)
  const textarea = container.querySelector<HTMLTextAreaElement>(
    "textarea.KHxj8b, textarea.tL9Q4c, textarea",
  );
  if (textarea && !textarea.disabled) {
    setNativeInputValue(textarea, strVal);
    highlightGoogleFormElement(textarea);
    return true;
  }

  // 3. Radio Buttons (Multiple choice & Linear Scales)
  const radioItems = Array.from(
    container.querySelectorAll<HTMLElement>(
      "div[role='radio'], label, .docssharedWizToggleLabeledContainer, div.bz0duf, div.jT5eGX, div.g3VIId",
    ),
  );
  if (radioItems.length > 0) {
    const valText = normalizeGoogleFormText(strVal);
    const valHasDigits = /^\d+$/.test(valText);
    for (const rItem of radioItems) {
      const rText = normalizeGoogleFormText(
        rItem.getAttribute("data-value") ||
          rItem.getAttribute("aria-label") ||
          rItem.innerText ||
          "",
      );
      if (!rText) continue;

      const isBothDigits = valHasDigits && /^\d+$/.test(rText);
      const isMatch = isBothDigits
        ? rText === valText
        : rText === valText ||
          (rText.length > 2 &&
            valText.length > 2 &&
            (rText.includes(valText) || valText.includes(rText)));

      if (isMatch) {
        const target =
          rItem.closest("label") ||
          (rItem.id ? (document.querySelector(`label[for="${rItem.id}"]`) as HTMLElement | null) : null) ||
          (rItem.querySelector<HTMLElement>("div[role='radio']") || rItem);
        target.click();
        highlightGoogleFormElement(target);
        return true;
      }
    }
  }

  // 4. Checkboxes (Checkboxes question)
  const checkboxItems = Array.from(
    container.querySelectorAll<HTMLElement>(
      "div[role='checkbox'], input[type='checkbox']",
    ),
  );
  if (checkboxItems.length > 0) {
    const valText = normalizeGoogleFormText(strVal);
    const valHasDigits = /^\d+$/.test(valText);
    for (const cItem of checkboxItems) {
      const cContainer = cItem.closest<HTMLElement>(
        "label, .docssharedWizToggleLabeledContainer, div.bz0duf, div.jT5eGX, div.g3VIId",
      );
      const cText = normalizeGoogleFormText(
        cItem.getAttribute("data-value") ||
          cItem.getAttribute("aria-label") ||
          cContainer?.innerText ||
          "",
      );
      if (!cText) continue;

      const isBothDigits = valHasDigits && /^\d+$/.test(cText);
      const isMatch = isBothDigits
        ? cText === valText
        : cText === valText ||
          (cText.length > 2 &&
            valText.length > 2 &&
            (cText.includes(valText) || valText.includes(cText)));

      if (isMatch) {
        const target =
          cItem.closest("label") ||
          (cItem.id ? (document.querySelector(`label[for="${cItem.id}"]`) as HTMLElement | null) : null) ||
          cItem;
        target.click();
        highlightGoogleFormElement(target);
        return true;
      }
    }
  }

  // 5. Dropdown (Listbox)
  const dropdownEl =
    container.querySelector<HTMLElement>(
      "div[role='listbox'], div[jsname='W7NXsf'], div.quantumWizMenuPaperselectDropDown, div.exportSelect, div.ry3kXd",
    ) || (isGoogleFormsDropdown(container) ? container : null);
  if (dropdownEl) {
    return await fillGoogleFormsDropdown(dropdownEl, strVal);
  }

  return false;
}

/**
 * Execute full Google Form fill pass over target field entries
 */
export async function fillGoogleForm(
  fields: { label: string; value: string | boolean | string[] }[],
): Promise<GoogleFormFillResult> {
  let matchedCount = 0;
  const details: GoogleFormFieldMatch[] = [];

  const questionContainers = Array.from(
    document.querySelectorAll<HTMLElement>(
      "div[role='listitem'], div.Qr7Oae, div.geS5n, div.m7Wjg",
    ),
  );

  for (const field of fields) {
    let fieldMatched = false;
    const targetLabel = field.label;
    const targetValue = field.value;

    for (const container of questionContainers) {
      const containerHeading = getGoogleFormQuestionHeading(container);
      if (isGoogleFormLabelMatch(targetLabel, containerHeading)) {
        fieldMatched = await fillGoogleFormQuestionContainer(
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

