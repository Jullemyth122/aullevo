import { STOP_WORDS } from "./constants";
import { cleanLabelText, findLabel, findMatrixHeaders } from "./labels";

/**
 * Normalizes strings and checks for substring containment.
 */
export function fuzzyMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const aNorm = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const bNorm = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!aNorm || !bNorm) return false;
  return aNorm.includes(bNorm) || bNorm.includes(aNorm);
}

/**
 * Smart matching helper for checkbox / radio labels and values with stop-word filtering
 * and token intersection ratio calculation.
 */
export function smartMatch(label: string, value: string): boolean {
  if (!label || !value) return false;
  const lLower = label.toLowerCase().trim();
  const vLower = value.toLowerCase().trim();

  if (lLower === vLower || lLower.includes(vLower) || vLower.includes(lLower)) {
    return true;
  }

  const lNorm = lLower.replace(/[^a-z0-9]/g, "");
  const vNorm = vLower.replace(/[^a-z0-9]/g, "");
  if (lNorm.includes(vNorm) || vNorm.includes(lNorm)) {
    return true;
  }

  const getWords = (str: string) =>
    str
      .replace(/[^a-z0-9\s]/gi, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  const labelWords = getWords(lLower);
  const valWords = getWords(vLower);

  if (labelWords.length > 0 && valWords.length > 0) {
    const intersection = labelWords.filter((w) => valWords.includes(w));
    const ratio =
      intersection.length / Math.min(labelWords.length, valWords.length);
    if (ratio >= 0.75) {
      return true;
    }
  }

  return false;
}

/**
 * Score how well an option matches the target value (0 = no match, 100 = exact match).
 * Handles: dial codes like "Philippines (+63)", country abbreviations, partials.
 */
export function scoreOptionMatch(
  optText: string,
  optValue: string,
  valLower: string,
): number {
  const tl = optText.toLowerCase().trim();
  const vl = optValue.toLowerCase().trim();

  if (vl === valLower || tl === valLower) return 100;
  if (smartMatch(optText, valLower) || smartMatch(optValue, valLower))
    return 95;

  // Strip parenthetical parts like "(+63)" from option text
  const strippedText = tl.replace(/\s*\([^)]*\)\s*/g, "").trim();
  if (strippedText === valLower) return 90;

  // Match dial code digits: "+63" or "63" inside "Philippines (+63)"
  const dialMatch = tl.match(/\(?\+?(\d+)\)?/);
  if (dialMatch) {
    const dialDigits = dialMatch[1];
    const valDigits = valLower.replace(/^\+/, "");
    if (dialDigits === valDigits) return 85;
  }

  if (tl.startsWith(valLower) || valLower.startsWith(tl)) return 80;
  if (tl.includes(valLower)) return 70;
  if (valLower.includes(tl) && tl.length > 2) return 60;

  const words = tl.split(/\s+/);
  if (words.some((w) => w === valLower && w.length > 2)) return 50;

  return 0;
}

/**
 * Splits raw input string into matchable tokens by delimiters (comma, semicolon, slash, or/and).
 */
export function parseValueTokens(raw: string): string[] {
  if (!raw) return [];
  // Strip day prefix if user entered e.g. "Mon - Evening or Morning" or "Mon: Evening"
  let cleaned = raw
    .replace(
      /^(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)[\s:—-]+/i,
      "",
    )
    .trim();
  if (!cleaned) cleaned = raw.trim();

  // Split by comma, semicolon, slash, "or", "and", "&", "|"
  const tokens = cleaned
    .split(/[,;/|&]|\b(?:or|and)\b/i)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  return tokens.length > 0 ? tokens : [raw.toLowerCase().trim()];
}

/**
 * Extracts all possible text descriptors for a radio or checkbox option,
 * including native value, label, matrix column header, compound label,
 * aria-label, title, data attributes, and direct parent label text.
 */
export function getOptionDescriptors(
  el: HTMLInputElement | HTMLElement,
): string[] {
  const descriptors = new Set<string>();

  // 1. Native value and data attributes
  if (el instanceof HTMLInputElement && el.value) {
    descriptors.add(el.value.toLowerCase().trim());
  }
  const dataValue = el.getAttribute("data-value");
  if (dataValue) descriptors.add(dataValue.toLowerCase().trim());
  const dataLabel = el.getAttribute("data-label");
  if (dataLabel) descriptors.add(dataLabel.toLowerCase().trim());

  // 2. Direct / Sibling Label
  const label = findLabel(el);
  if (label) descriptors.add(label.toLowerCase().trim());

  // 3. Matrix Column Header & Compound Label ONLY (NEVER rowHeader)
  const matrixInfo = findMatrixHeaders(el);
  if (matrixInfo.colHeader)
    descriptors.add(matrixInfo.colHeader.toLowerCase().trim());
  if (matrixInfo.compoundLabel)
    descriptors.add(matrixInfo.compoundLabel.toLowerCase().trim());

  // 4. Accessibility attributes
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) descriptors.add(ariaLabel.toLowerCase().trim());
  const title = el.getAttribute("title");
  if (title) descriptors.add(title.toLowerCase().trim());

  // 5. Direct parent label text (e.g. <label><input> Afternoon</label>)
  const parentLabel = el.closest("label");
  if (parentLabel && parentLabel !== el) {
    const pText = cleanLabelText(parentLabel.textContent || "")
      .toLowerCase()
      .trim();
    if (pText && pText.length < 40) descriptors.add(pText);
  }

  // 6. Name attribute tokens e.g. avail_Mon_pm -> ["pm", "afternoon"]
  const nameAttr = el.getAttribute("name");
  if (nameAttr) {
    const nameStr = nameAttr.toLowerCase();
    descriptors.add(nameStr);
    if (nameStr.includes("_am") || nameStr.includes("morning"))
      descriptors.add("morning");
    if (nameStr.includes("_pm") || nameStr.includes("afternoon"))
      descriptors.add("afternoon");
    if (nameStr.includes("_eve") || nameStr.includes("evening"))
      descriptors.add("evening");
  }

  return Array.from(descriptors).filter((s) => s.length > 0);
}

/**
 * Helper to match an option's descriptors against a target value string.
 */
export function optionMatchesValue(
  descriptors: string[],
  valStr: string,
): boolean {
  return descriptors.some((desc) => {
    if (desc === valStr) return true;
    if (fuzzyMatch(desc, valStr)) return true;
    if (smartMatch(desc, valStr)) return true;
    // Safe boundary match for multi-word or short/special tokens
    if (valStr.length >= 2 && desc.length >= 2) {
      const escaped = valStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(?:^|\\b|\\s)${escaped}(?:$|\\b|\\s)`, "i").test(desc)) return true;
    }
    return false;
  });
}

/**
 * Extracts options from a custom div-based select/dropdown component.
 */
export function extractCustomSelectOptions(
  el: HTMLElement,
): { label: string; value: string }[] {
  const options: { label: string; value: string }[] = [];
  const listboxId =
    el.getAttribute("aria-owns") || el.getAttribute("aria-controls");
  let listbox: HTMLElement | null = null;
  if (listboxId) listbox = document.getElementById(listboxId);
  if (!listbox) {
    listbox = el.querySelector(
      '[role="listbox"], [role="menu"], [class*="menu"], [class*="options"], [class*="dropdown"]',
    );
  }
  if (!listbox && el.parentElement) {
    listbox = el.parentElement.querySelector(
      '[role="listbox"], [role="menu"], [class*="menu-list"], [class*="options-list"]',
    );
  }
  if (listbox) {
    const optionEls = listbox.querySelectorAll(
      '[role="option"], [class*="option"], li',
    );
    optionEls.forEach((opt) => {
      const text = opt.textContent?.trim() || "";
      if (text && text.length < 100) {
        options.push({
          label: text,
          value: (opt as HTMLElement).getAttribute("data-value") || text,
        });
      }
    });
  }
  return options;
}
