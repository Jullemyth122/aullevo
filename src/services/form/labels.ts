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
 * Extracts 2D Matrix headers (row and column) for tabular forms or availability grids.
 * Strictly verifies that the element is part of a real 2D matrix (row x col grid),
 * and NOT a multi-column 1D form layout table or standard vertical form.
 */
export function findMatrixHeaders(
  input: HTMLElement,
  labelRects?: LabelRectItem[],
): MatrixHeaderInfo {
  let rowHeader = "";
  let colHeader = "";

  // 1. DOM Table & Grid Inspection (HTML table, role="grid", role="table")
  const cell = input.closest(
    "td, th, [role='gridcell'], [role='cell']",
  ) as HTMLElement | null;
  const table = input.closest(
    "table, [role='grid'], [role='table']",
  ) as HTMLElement | null;

  if (cell && table) {
    const row = cell.closest("tr, [role='row']") as HTMLElement | null;
    if (row) {
      const cells = Array.from(row.children) as HTMLElement[];
      const colIndex = cells.indexOf(cell);

      // Check if this row is an interleaved 1D layout row
      // (e.g. <td>LAST NAME</td><td><input></td><td>FIRST NAME</td><td><input></td>)
      const isInterleavedLayout = cells.some((c, idx) => {
        const hasInput = c.querySelector("input, select, textarea");
        const nextCell = cells[idx + 1];
        const nextHasInput = nextCell?.querySelector("input, select, textarea");
        return (
          !hasInput && nextHasInput && (c.textContent?.trim().length || 0) > 0
        );
      });

      if (!isInterleavedLayout) {
        // Find column header from candidate header rows
        // Prioritize the last row inside <thead>, or scan candidate header rows before the current row
        const theadRows = Array.from(table.querySelectorAll<HTMLElement>("thead tr"));
        const candidateRows: HTMLElement[] = theadRows.length > 0
          ? [...theadRows].reverse()
          : (Array.from(table.querySelectorAll<HTMLElement>("tr, [role='row']"))
              .filter((r) => r !== row && !r.contains(input)));

        for (const hRow of candidateRows) {
          const headerCells = Array.from(hRow.children) as HTMLElement[];
          if (colIndex >= 0 && colIndex < headerCells.length) {
            const targetHeaderCell = headerCells[colIndex];
            if (targetHeaderCell && !targetHeaderCell.contains(input)) {
              // Avoid banner rows that span all columns or contain no header text
              const colSpan = targetHeaderCell.getAttribute("colspan");
              if (colSpan && parseInt(colSpan, 10) > 1 && headerCells.length === 1) {
                continue;
              }
              const txt = cleanLabelText(targetHeaderCell.textContent || "");
              if (txt && txt.length >= 1 && txt.length <= 60) {
                colHeader = txt;
                break;
              }
            }
          }
        }

        // Row header: Scan all predecessor siblings in the same row for text/th elements
        let sibling = cell.previousElementSibling as HTMLElement | null;
        const rowLabels: string[] = [];
        while (sibling) {
          const siblingHasInput = sibling.querySelector("input, select, textarea");
          if (!siblingHasInput && (sibling.textContent?.trim().length || 0) > 0) {
            const txt = cleanLabelText(sibling.textContent || "");
            if (txt && txt.length >= 1 && txt.length <= 60) {
              rowLabels.unshift(txt);
            }
          }
          sibling = sibling.previousElementSibling as HTMLElement | null;
        }

        if (rowLabels.length > 0) {
          rowHeader = rowLabels.join(" ");
        } else if (colIndex > 0) {
          // Fallback check on first cell if it was explicit <th> or rowheader
          const firstCell = cells[0];
          const firstCellHasInput = firstCell?.querySelector("input, select, textarea");
          const isExplicitHeader =
            firstCell?.tagName === "TH" ||
            firstCell?.getAttribute("role") === "rowheader" ||
            (!firstCellHasInput && (firstCell?.textContent?.trim().length || 0) > 0);

          if (isExplicitHeader && firstCell && !firstCell.contains(input)) {
            const txt = cleanLabelText(firstCell.textContent || "");
            if (txt && txt.length >= 1 && txt.length <= 60) {
              rowHeader = txt;
            }
          }
        }
      }
    }
  }

  // 2. Spatial 2D Raycasting (Fallback for Div-based Flexbox / CSS-Grid Matrices ONLY)
  // Only triggers if the input does NOT have an enclosing table and has BOTH a valid row candidate AND column candidate
  if ((!rowHeader || !colHeader) && !table) {
    let rects = labelRects;
    if (rects && rects.length > 0) {
      try {
        const inputRect = input.getBoundingClientRect();
        if (inputRect.width > 0 && inputRect.height > 0) {
          const inputCenterX = inputRect.left + inputRect.width / 2;
          const inputCenterY = inputRect.top + inputRect.height / 2;

          let candidateCol = "";
          let candidateRow = "";
          let minRowDist = Infinity;
          let minColDist = Infinity;

          for (const item of rects) {
            if (item.element.contains(input) || input.contains(item.element))
              continue;

            const rect = item.rect;
            const labelCenterX = rect.left + rect.width / 2;
            const labelCenterY = rect.top + rect.height / 2;

            // Candidate Column Header: Strictly above input, horizontally centered with input
            const isAboveXOverlap =
              Math.abs(labelCenterX - inputCenterX) <
              Math.max(inputRect.width / 2, rect.width / 2, 40);
            const isAbove =
              rect.bottom <= inputRect.top + 5 && rect.top < inputRect.top;
            if (isAbove && isAboveXOverlap && !candidateCol) {
              const distY = inputRect.top - rect.bottom;
              if (distY < minColDist && distY < 150) {
                minColDist = distY;
                candidateCol = item.text;
              }
            }

            // Candidate Row Header: Strictly to the left of input, vertically centered
            const isLeftYOverlap =
              Math.abs(labelCenterY - inputCenterY) <
              Math.max(inputRect.height / 2, rect.height / 2, 20);
            const isLeft =
              rect.right <= inputRect.left + 5 && rect.left < inputRect.left;
            if (isLeft && isLeftYOverlap && !candidateRow) {
              const distX = inputRect.left - rect.right;
              if (distX < minRowDist && distX < 250) {
                minRowDist = distX;
                candidateRow = item.text;
              }
            }
          }

          if (candidateCol && candidateRow) {
            colHeader = candidateCol;
            rowHeader = candidateRow;
          }
        }
      } catch (_e) {
        // Ignore spatial errors
      }
    }
  }

  const cleanedRow = cleanLabelText(rowHeader)
    .replace(/^[:\s—-]+|[:\s—-]+$/g, "")
    .trim();
  const cleanedCol = cleanLabelText(colHeader)
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
