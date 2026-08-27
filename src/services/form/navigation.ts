import {
  NEXT_KEYWORDS,
  NEXT_CLASS_ID_KEYWORDS,
  NEXT_ARROW_SYMBOLS,
  PREV_KEYWORDS,
  PREV_CLASS_ID_KEYWORDS,
  PREV_ARROW_SYMBOLS,
  NAVIGATION_EXCLUDE_KEYWORDS,
  PREV_EXCLUDE_KEYWORDS,
} from "./constants";
import { findActiveModals, isVisible } from "./domUtils";

/**
 * Clicks an element by its ID.
 */
export function clickElement(id: string): {
  success: boolean;
  message: string;
} {
  const el = document.getElementById(id);
  if (el) {
    el.click();
    return { success: true, message: `Clicked element #${id}` };
  }
  return { success: false, message: `Element #${id} not found` };
}

/**
 * Finds the "Next", "Continue", or "Submit Application" button on the page or active modal.
 */
export function findNextButton(): HTMLElement | null {
  const activeModals = findActiveModals();
  const root =
    activeModals.length > 0
      ? activeModals[activeModals.length - 1]
      : document.body;

  const buttons = root.querySelectorAll<HTMLElement>(
    'button, input[type="submit"], input[type="button"], [role="button"], a.btn, a.button',
  );

  const candidates = Array.from(buttons).filter((btn) => {
    if (!isVisible(btn as HTMLElement)) return false;
    const text = (btn.textContent || (btn as HTMLInputElement).value || "")
      .trim()
      .toLowerCase();
    const ariaLabel = (btn.getAttribute("aria-label") || "")
      .trim()
      .toLowerCase();
    const combined = text || ariaLabel;

    const classAndId = (
      String(btn.className || "") +
      " " +
      String(btn.id || "")
    ).toLowerCase();
    const combinedWithMeta = (combined + " " + classAndId).trim();

    if (
      NAVIGATION_EXCLUDE_KEYWORDS.some(
        (k) =>
          combinedWithMeta === k ||
          combinedWithMeta.startsWith(k) ||
          combined.includes(k) ||
          classAndId.includes(k),
      )
    ) {
      return false;
    }

    // 1. Keyword match on visible text / aria-label
    const matchesKeyword = NEXT_KEYWORDS.some(
      (keyword) => combined === keyword || combined.includes(keyword),
    );
    if (matchesKeyword) return true;

    // 2. Class/ID naming patterns
    const matchesClassOrId = NEXT_CLASS_ID_KEYWORDS.some((term) =>
      classAndId.includes(term),
    );
    if (matchesClassOrId) return true;

    // 3. Arrow characters in text or aria-label
    const matchesArrow = NEXT_ARROW_SYMBOLS.some((symbol) =>
      combined.includes(symbol),
    );
    if (matchesArrow) return true;

    return false;
  });

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] as HTMLElement;

  // Multiple candidates: prefer bottommost + rightmost (standard Next button placement)
  const scored = candidates.map((btn) => {
    const rect = (btn as HTMLElement).getBoundingClientRect();
    return { btn, score: rect.right + rect.bottom };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].btn as HTMLElement;
}

export interface NavigationResult {
  success: boolean;
  navigated?: boolean;
  reason?: "validation_error" | "did_not_advance" | "no_button" | "navigated";
  message: string;
}

/**
 * Checks if the DOM currently displays visible form validation errors.
 */
export function hasFormValidationErrors(): boolean {
  // Google Forms specific error indicators
  const gfErrors = document.querySelectorAll(
    '[role="alert"], .oJeWuf, .RHiWh, .LXRPh, .kssQ7b, [data-error], .freebirdFormviewerComponentsQuestionBaseErrorText, div[jsname="BOHaEe"]'
  );
  for (const el of Array.from(gfErrors)) {
    if (isVisible(el as HTMLElement) && (el.textContent || "").trim().length > 0) {
      return true;
    }
  }

  // General HTML5 / Framework error indicators
  const generalErrors = document.querySelectorAll(
    ':invalid, [aria-invalid="true"], .is-invalid, .invalid-feedback, .error-message, .field-validation-error, [data-invalid="true"]'
  );
  for (const el of Array.from(generalErrors)) {
    if (isVisible(el as HTMLElement)) {
      return true;
    }
  }

  return false;
}

/**
 * Extracts a snapshot of current visible fields and pagination status.
 */
function getFormPageSnapshot(): { url: string; pageIndicator: string; visibleFieldIds: string } {
  const url = window.location.href;

  // Google Forms & web form page indicators e.g. "Page 2 of 4"
  const pageIndicatorEl = document.querySelector(
    '.freebirdFormviewerViewNavigationPageIndicator, [role="progressbar"], div[jsname="O42U8e"]'
  );
  const pageIndicator = pageIndicatorEl?.textContent?.trim() || "";

  // Visible field identifiers
  const inputs = Array.from(
    document.querySelectorAll<HTMLElement>(
      "input, select, textarea, [role='radiogroup'], [role='listbox']"
    )
  )
    .filter(isVisible)
    .map(
      (el) =>
        el.id || el.getAttribute("name") || el.getAttribute("aria-label") || ""
    )
    .filter(Boolean)
    .sort()
    .join(",");

  return { url, pageIndicator, visibleFieldIds: inputs };
}

/**
 * Asynchronously clicks the Next button and waits/verifies if navigation or page progression actually occurred.
 */
export async function clickNextButtonAsync(timeoutMs = 2500): Promise<NavigationResult> {
  const btn = findNextButton();
  if (!btn) {
    return { success: false, reason: "no_button", message: 'No "Next" button found.' };
  }

  const beforeSnapshot = getFormPageSnapshot();

  // Trigger natural click and pointer events
  btn.focus();
  btn.click();
  btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));

  // Poll for page state change or validation errors
  const startTime = Date.now();
  const pollInterval = 150;

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const currentSnapshot = getFormPageSnapshot();

    // 1. URL changed
    if (currentSnapshot.url !== beforeSnapshot.url) {
      return { success: true, navigated: true, reason: "navigated", message: "Navigated to next page URL." };
    }

    // 2. Page indicator changed (e.g. "Page 2 of 4" -> "Page 3 of 4")
    if (
      beforeSnapshot.pageIndicator &&
      currentSnapshot.pageIndicator &&
      beforeSnapshot.pageIndicator !== currentSnapshot.pageIndicator
    ) {
      return {
        success: true,
        navigated: true,
        reason: "navigated",
        message: `Advanced from ${beforeSnapshot.pageIndicator} to ${currentSnapshot.pageIndicator}.`,
      };
    }

    // 3. Visible fields changed significantly
    if (
      beforeSnapshot.visibleFieldIds &&
      currentSnapshot.visibleFieldIds &&
      beforeSnapshot.visibleFieldIds !== currentSnapshot.visibleFieldIds
    ) {
      return {
        success: true,
        navigated: true,
        reason: "navigated",
        message: "Advanced to next form section.",
      };
    }

    // 4. Check for validation errors (after 350ms to allow validation messages to render)
    if (Date.now() - startTime >= 350 && hasFormValidationErrors()) {
      return {
        success: false,
        reason: "validation_error",
        message: "Form has validation errors or missing required fields.",
      };
    }
  }

  // Timeout reached without visible advance
  if (hasFormValidationErrors()) {
    return {
      success: false,
      reason: "validation_error",
      message: "Form validation error prevented advancing.",
    };
  }

  return {
    success: false,
    reason: "did_not_advance",
    message: "Page did not advance to the next step.",
  };
}

/**
 * Synchronously clicks the Next button (legacy fallback).
 */
export function clickNextButton(): { success: boolean; message: string } {
  const btn = findNextButton();
  if (btn) {
    btn.click();
    return {
      success: true,
      message: `Clicked "${btn.textContent || "Next"}" button.`,
    };
  }
  return { success: false, message: 'No "Next" button found.' };
}

/**
 * Finds the "Previous", "Back", or "Return" button on the page or active modal.
 */
export function findPrevButton(): HTMLElement | null {
  const activeModals = findActiveModals();
  const root =
    activeModals.length > 0
      ? activeModals[activeModals.length - 1]
      : document.body;

  const buttons = root.querySelectorAll<HTMLElement>(
    'button, input[type="button"], [role="button"], a.btn, a.button',
  );

  const candidates = Array.from(buttons).filter((btn) => {
    if (!isVisible(btn as HTMLElement)) return false;
    const text = (btn.textContent || (btn as HTMLInputElement).value || "")
      .trim()
      .toLowerCase();
    const ariaLabel = (btn.getAttribute("aria-label") || "")
      .trim()
      .toLowerCase();
    const combined = text || ariaLabel;

    const classAndId = (
      String(btn.className || "") +
      " " +
      String(btn.id || "")
    ).toLowerCase();
    const combinedWithMeta = (combined + " " + classAndId).trim();

    if (
      PREV_EXCLUDE_KEYWORDS.some(
        (k) =>
          combinedWithMeta === k ||
          combinedWithMeta.startsWith(k) ||
          combined.includes(k) ||
          classAndId.includes(k),
      )
    ) {
      return false;
    }

    // 1. Keyword match on visible text / aria-label
    const matchesKeyword = PREV_KEYWORDS.some(
      (keyword) => combined === keyword || combined.includes(keyword),
    );
    if (matchesKeyword) return true;

    // 2. Class/ID naming patterns
    const matchesClassOrId = PREV_CLASS_ID_KEYWORDS.some((term) =>
      classAndId.includes(term),
    );
    if (matchesClassOrId) return true;

    // 3. Arrow characters in text or aria-label
    const matchesArrow = PREV_ARROW_SYMBOLS.some((symbol) =>
      combined.includes(symbol),
    );
    if (matchesArrow) return true;

    return false;
  });

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] as HTMLElement;

  // Multiple candidates: prefer bottommost + leftmost (standard Back button placement)
  const scored = candidates.map((btn) => {
    const rect = (btn as HTMLElement).getBoundingClientRect();
    const score = rect.bottom - rect.left;
    return { btn, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].btn as HTMLElement;
}

/**
 * Clicks the Previous / Back button if found.
 */
export function clickPrevButton(): { success: boolean; message: string } {
  const btn = findPrevButton();
  if (btn) {
    btn.click();
    return {
      success: true,
      message: `Clicked "${btn.textContent || "Previous"}" button.`,
    };
  }
  return { success: false, message: 'No "Previous" or "Back" button found.' };
}
