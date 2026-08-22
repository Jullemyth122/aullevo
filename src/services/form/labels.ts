import { querySelectorAllDeep } from "./domUtils";

export interface MatrixHeaderInfo {
  rowHeader?: string;
  colHeader?: string;
  compoundLabel?: string;
}

export interface LabelRectItem {
  element: HTMLElement;
  rect: DOMRect;
  text: string;
}

/**
 * Strips HTML formatting, newlines, asterisks, field notices, and redundant whitespace.
 * Also collapses spaced-out characters (e.g. "U s e r n a m e").
 */
export function cleanLabelText(text: string): string {
  if (!text) return "";
  // Strip all newlines and carriage returns completely
  let cleaned = text.replace(/[\r\n]+/g, " ");
  // Strip asterisks and mandatory symbols
  cleaned = cleaned.replace(/[*∗★•]/g, "");
  // Strip field notices e.g. "(required)", "(optional)", "(if not applicable...)"
  cleaned = cleaned.replace(
    /\s*\((?:required|optional|leave blank if not applicable|if not applicable[^)]*)\)/gi,
    "",
  );
  // Strip trailing colon
  cleaned = cleaned.replace(/:\s*$/, "");
  // Replace multiple spaces with a single space
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // If the result contains spaced-out characters like "U s e r n a m e" or "S e c u r e   T o k e n", collapse them
  const parts = cleaned.split(/ {2,}/);
  const processedParts = parts.map((part) => {
    const words = part.split(" ");
    const singleLetterCount = words.filter((w) => w.length === 1).length;
    if (words.length > 1 && singleLetterCount / words.length > 0.6) {
      return words.join("");
    }
    return part;
  });
  cleaned = processedParts.join(" ");

  if (
    /^([A-Za-z]\s)+[A-Za-z]?$/.test(cleaned) ||
    /^([A-Z]\s)+[A-Z]?$/i.test(cleaned)
  ) {
    cleaned = cleaned.replace(/\s+/g, "");
  }

  return cleaned.trim();
}

/**
 * Finds a visually adjacent label for an input using spatial raycasting/distance scoring.
 */
export function findVisualLabelForInput(
  input: HTMLElement,
  labelRects: LabelRectItem[],
): string {
  const inputRect = input.getBoundingClientRect();
  if (inputRect.width === 0 || inputRect.height === 0) return "";

  let bestLabel = "";
  let minScore = Infinity;

  const inputCenterY = inputRect.top + inputRect.height / 2;

  for (const item of labelRects) {
    const labelRect = item.rect;
    const labelCenterY = labelRect.top + labelRect.height / 2;

    // Check if the label is the input itself or contains the input (unlikely, but safety first)
    if (item.element.contains(input) || input.contains(item.element)) continue;

    // 1. Above Layout: Label is above the input (Label's bottom is above input's top with 5px buffer)
    const isAbove = labelRect.bottom <= inputRect.top + 5;
    const distYAbove = inputRect.top - labelRect.bottom;
    const overlapX =
      Math.min(labelRect.right, inputRect.right) -
      Math.max(labelRect.left, inputRect.left);
    const distXAbove = Math.abs(labelRect.left - inputRect.left);

    // 2. Left Layout: Label is to the left of the input (Label's right is to the left of input's left with 5px buffer)
    const isLeft = labelRect.right <= inputRect.left + 5;
    const distXLeft = inputRect.left - labelRect.right;
    const distYLeft = Math.abs(labelCenterY - inputCenterY);

    // 3. Right Layout (mainly for checkboxes/radios)
    const isRight = labelRect.left >= inputRect.right - 5;
    const distXRight = labelRect.left - inputRect.right;
    const distYRight = Math.abs(labelCenterY - inputCenterY);

    // 4. Below Layout: Label below the input (floating labels, helper text)
    const isBelow = labelRect.top >= inputRect.bottom - 5;
    const distYBelow = labelRect.top - inputRect.bottom;

    let score = Infinity;

    if (isAbove && distYAbove < 120) {
      const alignmentPenalty = overlapX > -10 ? distXAbove : distXAbove * 3;
      score = distYAbove + alignmentPenalty;
    } else if (isLeft && distXLeft < 250 && distYLeft < 30) {
      score = distXLeft + distYLeft * 2;
    } else if (isRight && distXRight < 150 && distYRight < 20) {
      score = distXRight + distYRight * 3;
    } else if (isBelow && distYBelow < 60) {
      const distXBelow = Math.abs(labelRect.left - inputRect.left);
      if (distXBelow < 200) {
        score = distYBelow + distXBelow * 2 + 20; // +20 penalty: below-label is less common
      }
    }

    if (score < minScore) {
      minScore = score;
      bestLabel = item.text;
    }
  }

  // Only return if the score is reasonably close
  return minScore < 150 ? bestLabel : "";
}

/**
 * Finds the human-readable label for a form field through multiple strategies:
 * 1. ARIA attributes (aria-label, aria-labelledby, placeholder, title, data-label)
 * 2. label[for="..."] and wrapping <label> elements (Shadow DOM aware)
 * 3. Nearest Common Ancestor container inspection
 * 4. Spatial positioning raycasting
 * 5. Sibling and nested component parent scanning
 */
export function findLabel(
  input: HTMLElement,
  labelRects?: LabelRectItem[],
): string {
  // 1. Direct ARIA attributes and title
  const ariaLabel = input.getAttribute("aria-label");
  if (ariaLabel) {
    const cleaned = cleanLabelText(ariaLabel);
    if (cleaned && cleaned.length > 1) return cleaned;
  }

  const ariaLabelledby = input.getAttribute("aria-labelledby");
  if (ariaLabelledby) {
    const ids = ariaLabelledby.split(/\s+/);
    let combinedText = "";
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) {
        combinedText += " " + (el.textContent || "");
      }
    }
    const cleaned = cleanLabelText(combinedText);
    if (cleaned && cleaned.length > 1) return cleaned;
  }

  const title = input.getAttribute("title");
  if (title) {
    const cleaned = cleanLabelText(title);
    if (cleaned && cleaned.length > 1) return cleaned;
  }

  const dataLabel =
    input.getAttribute("data-label") || input.getAttribute("data-field-label");
  if (dataLabel) {
    const cleaned = cleanLabelText(dataLabel);
    if (cleaned && cleaned.length > 1) return cleaned;
  }

  // 2. Standard Label elements with for="" attribute or wrapping parent label
  if (input.id) {
    let label = document.querySelector<HTMLLabelElement>(
      `label[for="${input.id}"]`,
    );
    if (!label) {
      const deepLabels = querySelectorAllDeep<HTMLLabelElement>(
        `label[for="${input.id}"]`,
        document.body || document.documentElement,
      );
      if (deepLabels.length > 0) label = deepLabels[0];
    }
    if (label) {
      const text = cleanLabelText(label.textContent || "");
      if (text) return text;
    }
  }

  const parentLabel = input.closest("label");
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    const innerInput = clone.querySelector("input, select, textarea");
    if (innerInput) innerInput.remove();
    const text = cleanLabelText(clone.textContent || "");
    if (text) return text;
  }

  const describedBy = input.getAttribute("aria-describedby");
  if (describedBy) {
    const descEl = document.getElementById(describedBy);
    if (descEl && (descEl.textContent?.length || 0) < 80) {
      const text = cleanLabelText(descEl.textContent || "");
      if (text) return text;
    }
  }

  // 3. Immediate and preceding siblings (highest local proximity)
  let prevSibling = input.previousElementSibling as HTMLElement | null;
  while (prevSibling) {
    if (!prevSibling.matches("input, select, textarea, button, form")) {
      const text = cleanLabelText(prevSibling.textContent || "");
      if (text && text.length >= 2 && text.length <= 100) {
        return text;
      }
    }
    prevSibling = prevSibling.previousElementSibling as HTMLElement | null;
  }

  // 4. Single-field container wrapper check (ONLY if wrapper contains ONLY this interactive input)
  let container: HTMLElement | null = input.parentElement;
  let depth = 0;
  while (
    container &&
    depth < 4 &&
    container.tagName !== "BODY" &&
    container.tagName !== "FORM"
  ) {
    // Only inspect container if it is dedicated to this single field
    const siblingInputs = container.querySelectorAll("input, select, textarea");
    if (siblingInputs.length <= 1) {
      const labelEl = container.querySelector<HTMLElement>(
        "label, .label, [class*='label' i], [class*='lbl' i], [class*='title' i]",
      );
      if (labelEl && labelEl !== input && !labelEl.contains(input)) {
        const text = cleanLabelText(labelEl.textContent || "");
        if (text && text.length >= 2 && text.length <= 100) {
          return text;
        }
      }
    }

    // Check previous siblings of the container level
    let prevContainerSib =
      container.previousElementSibling as HTMLElement | null;
    while (prevContainerSib) {
      if (!prevContainerSib.matches("input, select, textarea, button, form")) {
        const text = cleanLabelText(prevContainerSib.textContent || "");
        if (text && text.length >= 2 && text.length <= 100) {
          return text;
        }
      }
      prevContainerSib =
        prevContainerSib.previousElementSibling as HTMLElement | null;
    }

    container = container.parentElement;
    depth++;
  }

  // 5. Table cell previous header check
  const cell = input.closest("td");
  if (cell) {
    const prevCell = cell.previousElementSibling;
    if (prevCell && (prevCell.tagName === "TD" || prevCell.tagName === "TH")) {
      if ((prevCell.textContent?.length || 0) < 50) {
        const text = cleanLabelText(prevCell.textContent || "");
        if (text) return text;
      }
    }
  }

  // 6. Placeholder fallback (only when no direct label elements exist)
  const placeholder = input.getAttribute("placeholder");
  if (placeholder) {
    const cleaned = cleanLabelText(placeholder);
    if (cleaned && cleaned.length > 1) return cleaned;
  }

  // 7. Attempt spatial/visual positioning label matching (geometry raycasting)
  if (labelRects) {
    const visualLabel = findVisualLabelForInput(input, labelRects);
    if (visualLabel) return visualLabel;
  }

  return "";
}

/**
 * Escapes regex special characters.
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Checks if a source string contains a token (case-insensitive with word boundary / whitespace tolerance).
 */
export function fuzzyIncludes(sourceText: string, token: string): boolean {
  if (!sourceText || !token) return false;
  const safeToken = escapeRegExp(token.trim().toLowerCase());
  const regex = new RegExp(`(?:^|\\b|\\s)${safeToken}`, "i");
  return regex.test(sourceText.toLowerCase());
}

/**
 * Calculates a 2D intersection score for given search tokens against rowText and colText axes.
 * Awards bonus when tokens intersect BOTH row and column axes.
 */
export function calculate2DIntersectionScore(
  tokens: string[],
  rowText: string,
  colText: string,
): number {
  let matchedTokens = 0;
  let matchesRow = false;
  let matchesCol = false;

  for (const token of tokens) {
    if (!token) continue;
    const inRow = fuzzyIncludes(rowText, token);
    const inCol = fuzzyIncludes(colText, token);

    if (inRow || inCol) {
      matchedTokens++;
      if (inRow) matchesRow = true;
      if (inCol) matchesCol = true;
    }
  }

  if (matchesRow && matchesCol) {
    return matchedTokens + 2;
  }

  return matchedTokens;
}

/**
 * Computes the 2D row and column axes text for an input using both DOM table structure and geometry bounding boxes.
 */
export function getAxesText(
  input: HTMLElement,
  inputRect?: DOMRect,
  labelRects?: LabelRectItem[],
): { rowText: string; colText: string } {
  let rowLabels: string[] = [];
  let colLabels: string[] = [];

  // 1. Precise DOM Table & Grid Intersection
  const cell = input.closest("td, th, [role='gridcell'], [role='cell']") as HTMLElement | null;
  const table = input.closest("table, [role='grid'], [role='table']") as HTMLElement | null;

  if (cell && table) {
    const row = cell.closest("tr, [role='row']") as HTMLElement | null;
    if (row) {
      // Calculate column index accounting for colspans of preceding siblings
      let cellColIndex = 0;
      let sib = cell.previousElementSibling as HTMLElement | null;
      while (sib) {
        const colspan = parseInt(sib.getAttribute("colspan") || "1", 10);
        cellColIndex += isNaN(colspan) ? 1 : colspan;
        sib = sib.previousElementSibling as HTMLElement | null;
      }

      // Collect row text from preceding non-input cells in the same row
      let prevCell = cell.previousElementSibling as HTMLElement | null;
      while (prevCell) {
        const hasInput = prevCell.querySelector("input, select, textarea, button");
        const txt = prevCell.textContent?.trim();
        if (!hasInput && txt) {
          rowLabels.unshift(cleanLabelText(txt));
        }
        prevCell = prevCell.previousElementSibling as HTMLElement | null;
      }

      // If no sibling text found, check if first cell is explicit rowheader or <th>
      if (rowLabels.length === 0) {
        const firstCell = row.querySelector("th, [role='rowheader'], [class*='row-header'], [class*='rowHeader']") as HTMLElement | null;
        if (firstCell && firstCell !== cell && !firstCell.contains(input)) {
          const txt = firstCell.textContent?.trim();
          if (txt) rowLabels.push(cleanLabelText(txt));
        }
      }

      // Find column header from candidate header rows
      const theadRows = Array.from(table.querySelectorAll<HTMLElement>("thead tr"));
      const allRows = Array.from(table.querySelectorAll<HTMLElement>("tr, [role='row']"));
      const headerRows: HTMLElement[] = theadRows.length > 0
        ? theadRows
        : allRows.filter((r) => r !== row && !r.contains(input) && !r.querySelector("input, select, textarea"));

      for (const hRow of headerRows) {
        let currentCol = 0;
        for (const child of Array.from(hRow.children) as HTMLElement[]) {
          const colspan = parseInt(child.getAttribute("colspan") || "1", 10);
          const span = isNaN(colspan) ? 1 : colspan;
          if (currentCol <= cellColIndex && cellColIndex < currentCol + span) {
            const hasInput = child.querySelector("input, select, textarea");
            const txt = child.textContent?.trim();
            if (!hasInput && txt) {
              const cleaned = cleanLabelText(txt);
              if (cleaned && !colLabels.includes(cleaned)) {
                colLabels.push(cleaned);
              }
            }
            break;
          }
          currentCol += span;
        }
      }
    }
  }

  // 2. Geometry Bounding-Box Fallback (CSS Grids / Divs / non-table matrices)
  if (rowLabels.length === 0 || colLabels.length === 0) {
    try {
      const rect = inputRect || input.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        const TOLERANCE_Y = 20;
        const TOLERANCE_X = 25;
        const container = input.closest("table, form, [class*='grid'], [class*='matrix'], [class*='table'], [class*='container'], [role='grid']") || document.body;
        const elements =
          labelRects && labelRects.length > 0
            ? labelRects.map((l) => l.element)
            : Array.from(
                container.querySelectorAll<HTMLElement>(
                  "th, td, label, div, span, p, h1, h2, h3, h4, h5, h6, [role='rowheader'], [role='columnheader']",
                ),
              );

        for (const el of elements) {
          if (el.contains(input) || el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.tagName === "BUTTON") continue;
          const elRect = el.getBoundingClientRect();
          if (elRect.width === 0 || elRect.height === 0) continue;
          const text = el.textContent ? el.textContent.trim() : "";
          if (!text || text.length > 50) continue;

          const isSameRow = Math.abs(elRect.top - rect.top) < TOLERANCE_Y || (elRect.bottom > rect.top && elRect.top < rect.bottom);
          const isLeft = elRect.right <= rect.left + 5;
          if (isSameRow && isLeft && rowLabels.length === 0) {
            const cleaned = cleanLabelText(text);
            if (cleaned) rowLabels.push(cleaned);
          }

          const isSameCol = Math.abs(elRect.left - rect.left) < TOLERANCE_X || (elRect.right > rect.left && elRect.left < rect.right);
          const isAbove = elRect.bottom <= rect.top + 5;
          if (isSameCol && isAbove && colLabels.length === 0) {
            const cleaned = cleanLabelText(text);
            if (cleaned) colLabels.push(cleaned);
          }
        }
      }
    } catch (_e) {
      // Ignore geometry errors in headless environments
    }
  }

  return {
    rowText: rowLabels.join(" ").trim(),
    colText: colLabels.join(" ").trim(),
  };
}

/**
 * Extracts 2D Matrix headers (row and column) for tabular forms, availability grids, and multiplication tables.
 * Returns rowHeader, colHeader, and compoundLabel when both coordinates exist.
 */
export function findMatrixHeaders(
  input: HTMLElement,
  labelRects?: LabelRectItem[],
): MatrixHeaderInfo {
  const axes = getAxesText(input, undefined, labelRects);

  const cleanedRow = cleanLabelText(axes.rowText)
    .replace(/^[:\s—-]+|[:\s—-]+$/g, "")
    .trim();
  const cleanedCol = cleanLabelText(axes.colText)
    .replace(/^[:\s—-]+|[:\s—-]+$/g, "")
    .trim();

  // A compound label is ONLY formed when BOTH row and col headers exist (genuine 2D coordinate)
  let compoundLabel: string | undefined = undefined;
  if (cleanedRow && cleanedCol) {
    compoundLabel = `${cleanedRow} — ${cleanedCol}`;
  }

  return {
    rowHeader: cleanedRow || undefined,
    colHeader: cleanedCol || undefined,
    compoundLabel: compoundLabel,
  };
}

/**
 * Finds group heading or legend for radio / checkbox collections.
 */
export function findGroupLabel(
  input: HTMLElement,
  labelRects?: LabelRectItem[],
): string {
  const fieldset = input.closest("fieldset");
  if (fieldset) {
    const legend = fieldset.querySelector("legend");
    if (legend) return cleanLabelText(legend.textContent || "");
  }
  const row = input.closest("tr");
  if (row) {
    const firstCell = row.firstElementChild;
    if (firstCell && !firstCell.contains(input)) {
      return cleanLabelText(firstCell.textContent || "");
    }
  }

  // Inspect container wrappers (e.g. .checkbox-row, .radio-row, .form-group, field container)
  let parent: HTMLElement | null = input.parentElement;
  let depth = 0;
  while (
    parent &&
    depth < 3 &&
    parent.tagName !== "BODY" &&
    parent.tagName !== "FORM"
  ) {
    const labelCandidates = parent.querySelectorAll<HTMLElement>(
      "span, p, strong, b, h1, h2, h3, h4, h5, h6, .label, [class*='label' i], [class*='title' i], [class*='question' i]",
    );
    for (const el of Array.from(labelCandidates)) {
      if (!el.contains(input) && !input.contains(el)) {
        const hasChildInput = el.querySelector("input, select, textarea");
        if (!hasChildInput) {
          const txt = cleanLabelText(el.textContent || "");
          if (txt && txt.length >= 2 && txt.length <= 150) {
            return txt;
          }
        }
      }
    }

    const prevSib = parent.previousElementSibling as HTMLElement | null;
    if (prevSib && !prevSib.matches("input, select, textarea, button, form")) {
      const txt = cleanLabelText(prevSib.textContent || "");
      if (txt && txt.length >= 2 && txt.length <= 150) {
        return txt;
      }
    }

    parent = parent.parentElement;
    depth++;
  }

  if (labelRects) {
    const visualLabel = findVisualLabelForInput(input, labelRects);
    if (visualLabel) return visualLabel;
  }

  return "";
}

/**
 * Extracts descriptive context (surrounding headings, helper texts, legends).
 */
export function findFieldContext(input: HTMLElement): string {
  let parent = input.parentElement;
  let depth = 0;
  while (parent && depth < 10) {
    const heading = parent.querySelector("h1, h2, h3, h4, h5, h6, legend");
    if (heading && parent.contains(heading) && parent.contains(input)) {
      return heading.textContent?.trim() || "";
    }
    const desc = parent.querySelector(
      'p, .description, .helper-text, [class*="hint"], [class*="desc"]',
    );
    if (
      desc &&
      parent.contains(desc) &&
      parent.contains(input) &&
      (desc.textContent?.length || 0) < 100
    ) {
      const headingText =
        parent
          .querySelector("h1, h2, h3, h4, h5, h6, legend")
          ?.textContent?.trim() || "";
      const descText = desc.textContent?.trim() || "";
      if (headingText) return headingText;
      if (descText) return descText;
    }
    parent = parent.parentElement;
    depth++;
  }
  const section = input.closest('section, article, fieldset, [role="group"]');
  if (section) {
    const heading = section.querySelector("h1, h2, h3, h4, h5, h6, legend");
    if (heading) return heading.textContent?.trim() || "";
  }
  return "";
}

/**
 * Identifies the section ID enclosing the field.
 */
export function findFieldSection(input: HTMLElement): string {
  const section = input.closest("section, div.section, div.group");
  if (section && section instanceof HTMLElement && section.id) {
    return section.id;
  }
  return "";
}
