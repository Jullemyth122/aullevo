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

/**
 * Clicks the Next button if found.
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
