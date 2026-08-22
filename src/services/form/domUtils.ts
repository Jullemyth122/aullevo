import { MODAL_SELECTORS } from "./constants";
import {
  cleanLabelText,
  getAxesText,
  calculate2DIntersectionScore,
} from "./labels";

/**
 * Deep query selector that pierces through open Shadow DOM boundaries.
 */
export function querySelectorAllDeep<T extends HTMLElement = HTMLElement>(
  selector: string,
  root: Document | Element | ShadowRoot = document,
  _visited?: WeakSet<ShadowRoot>,
): T[] {
  const visited = _visited || new WeakSet<ShadowRoot>();
  const results: T[] = [];
  try {
    const matched = root.querySelectorAll<T>(selector);
    results.push(...Array.from(matched));

    const allElements = root.querySelectorAll<HTMLElement>("*");
    allElements.forEach((el) => {
      if (el.shadowRoot && !visited.has(el.shadowRoot)) {
        visited.add(el.shadowRoot);
        results.push(
          ...querySelectorAllDeep<T>(selector, el.shadowRoot, visited),
        );
      }
    });
  } catch (_err) {
    // Ignore query syntax errors gracefully
  }
  return results;
}

/**
 * Checks whether an element is visible in the viewport or layout.
 * Hidden file inputs in custom upload dropzones are treated as visible.
 */
export function isVisible(element: HTMLElement): boolean {
  if (!element) return false;

  // File inputs can be hidden visually in custom drag-and-drop file uploaders
  const isFileInput =
    element instanceof HTMLInputElement && element.type === "file";
  if (isFileInput) return true;

  try {
    const style = window.getComputedStyle(element);
    if (style.display === "none") return false;
    if (style.visibility === "hidden") return false;

    // Check bounding rect in layout-enabled environments (skip in JSDOM/headless where dimensions are always 0)
    const isHeadless =
      typeof navigator !== "undefined" &&
      navigator.userAgent &&
      (navigator.userAgent.includes("jsdom") ||
        navigator.userAgent.includes("Node.js"));

    const rect = element.getBoundingClientRect
      ? element.getBoundingClientRect()
      : ({
          width: 0,
          height: 0,
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
        } as DOMRect);

    if (!isHeadless) {
      const isZeroSize = rect.width === 0 && rect.height === 0;
      if (
        isZeroSize &&
        element.offsetWidth === 0 &&
        element.offsetHeight === 0
      ) {
        return false;
      }
    }

    const isOffScreen =
      rect.right < -1000 ||
      rect.bottom < -1000 ||
      rect.left > window.innerWidth + 1000 ||
      rect.top > window.innerHeight + 1000;

    if (
      isOffScreen &&
      (style.position === "absolute" || style.position === "fixed")
    ) {
      return false;
    }

    // Ensure parents aren't display:none or visibility:hidden
    let p = element.parentElement;
    while (p && p.tagName !== "BODY" && p.tagName !== "HTML") {
      const pStyle = window.getComputedStyle(p);
      if (pStyle.display === "none" || pStyle.visibility === "hidden") {
        return false;
      }
      // If a parent dialog/modal is explicitly closed with aria-hidden
      if (
        p.getAttribute("aria-hidden") === "true" &&
        (p.classList.contains("modal") || p.getAttribute("role") === "dialog")
      ) {
        return false;
      }
      p = p.parentElement;
    }

    // Only reject if element ITSELF is explicitly hidden with aria-hidden and not an interactive control
    if (
      element.getAttribute("aria-hidden") === "true" &&
      element.tabIndex < 0 &&
      !element.matches("input, select, textarea")
    ) {
      return false;
    }
  } catch (_e) {
    return true;
  }

  return true;
}

/**
 * Finds all active and visible modals on the page.
 */
export function findActiveModals(): HTMLElement[] {
  const potentials = document.querySelectorAll<HTMLElement>(
    MODAL_SELECTORS.join(","),
  );
  return Array.from(potentials).filter(isVisible);
}

/**
 * Locates an element by its ID or falls back to deep query or name / data-testid attributes.
 */
export function findElementByIdOrSelector(id: string): HTMLElement | null {
  if (!id) return null;
  const byId = document.getElementById(id);
  if (byId) return byId;

  try {
    const deepMatches = querySelectorAllDeep<HTMLElement>(`[id="${id}"]`);
    if (deepMatches.length > 0) return deepMatches[0];

    const byName = querySelectorAllDeep<HTMLElement>(
      `[name="${id}"], [data-testid="${id}"]`,
    );
    if (byName.length > 0) return byName[0];
  } catch (_e) {
    // Ignore query syntax errors
  }
  return null;
}

/**
 * Activate the tab associated with a field inside a [role="tabpanel"].
 * Returns true if a tab was found and clicked.
 */
export function activateTabForField(input: HTMLElement): boolean {
  const tabpanel = input.closest('[role="tabpanel"]') as HTMLElement | null;
  if (!tabpanel) return false;

  // Check if panel is already active/visible
  const panelStyle = window.getComputedStyle(tabpanel);
  if (
    !tabpanel.hidden &&
    tabpanel.getAttribute("aria-hidden") !== "true" &&
    panelStyle.display !== "none"
  ) {
    return false; // Already visible, no action needed
  }

  // Find the corresponding tab
  let tab: HTMLElement | null = null;
  const labelledBy = tabpanel.getAttribute("aria-labelledby");
  if (labelledBy) {
    tab = document.getElementById(labelledBy);
  }
  if (!tab && tabpanel.id) {
    tab = document.querySelector<HTMLElement>(
      `[role="tab"][aria-controls="${tabpanel.id}"]`,
    );
  }

  if (tab) {
    tab.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    tab.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    tab.click();
    tab.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, cancelable: true }),
    );
    tab.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
    );
    console.log(
      `Aullevo: Activated tab "${tab.textContent?.trim()}" for field in tabpanel#${tabpanel.id}`,
    );
    return true;
  }

  return false;
}

/**
 * Finds a 2D matrix input element matching rowHeader and colHeader coordinates, compoundLabel, or raw tokens.
 */
export function find2DMatrixInput(opts: {
  rowHeader?: string;
  colHeader?: string;
  compoundLabel?: string;
  tokens?: string[];
}): HTMLElement | null {
  const { rowHeader, colHeader, compoundLabel, tokens: explicitTokens } = opts;

  const rawTokens: string[] =
    explicitTokens && explicitTokens.length > 0
      ? explicitTokens
      : [
          ...(rowHeader ? rowHeader.split(/[\s\-_/\\|:]+/) : []),
          ...(colHeader ? colHeader.split(/[\s\-_/\\|:]+/) : []),
          ...(compoundLabel ? compoundLabel.split(/[\s\-_/\\|:]+/) : []),
        ]
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length > 0);

  if (rawTokens.length === 0 && !rowHeader && !colHeader) return null;

  const rowNorm = rowHeader
    ? cleanLabelText(rowHeader).toLowerCase().trim()
    : "";
  const colNorm = colHeader
    ? cleanLabelText(colHeader).toLowerCase().trim()
    : "";

  const inputs = Array.from(
    document.querySelectorAll<HTMLElement>(
      "input:not([type='hidden']):not([type='submit']):not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable='true']",
    ),
  );

  let bestInput: HTMLElement | null = null;
  let highestScore = 0;

  for (const input of inputs) {
    const axes = getAxesText(input);
    const rowText = axes.rowText.toLowerCase();
    const colText = axes.colText.toLowerCase();

    // Exact coordinate match pass
    if (
      rowNorm &&
      colNorm &&
      rowText.includes(rowNorm) &&
      colText.includes(colNorm)
    ) {
      return input;
    }

    // Heuristic 2D intersection scoring
    if (rawTokens.length > 0) {
      const score = calculate2DIntersectionScore(rawTokens, rowText, colText);
      if (score > highestScore) {
        highestScore = score;
        bestInput = input;
      }
    }
  }

  if (bestInput && highestScore >= 2) {
    return bestInput;
  }

  return null;
}
