import type { FormField } from "../../types";
import {
  INTERACTIVE_INPUT_SELECTORS,
  BROAD_INPUT_FALLBACK_SELECTORS,
  CUSTOM_SELECT_SELECTORS,
  TOGGLE_SELECTORS,
} from "./constants";
import { querySelectorAllDeep, isVisible } from "./domUtils";
import { isCaptchaField, isHoneypot } from "./captcha";
import {
  cleanLabelText,
  findLabel,
  findGroupLabel,
  findMatrixHeaders,
  findFieldContext,
  findFieldSection,
  type LabelRectItem,
} from "./labels";
import { extractCustomSelectOptions } from "./matchers";
import { extractChatContext } from "./chat";

/**
 * Extracts all form fields from the current page, prioritizing visible and modal fields.
 * CAPTCHA and Honeypot fields are automatically detected and skipped.
 */
export function extractFormFields(): FormField[] {
  // Find all candidate label elements on the page (including Shadow DOM)
  const labelCandidates = querySelectorAllDeep<HTMLElement>(
    'label, .x-lbl, .label, [class*="label" i], [class*="lbl" i], [class*="title" i], span, div',
    document.body || document.documentElement,
  ).filter((el) => {
    if (
      el.tagName === "INPUT" ||
      el.tagName === "SELECT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "BUTTON" ||
      el.tagName === "FORM"
    ) {
      return false;
    }
    const text = el.textContent?.trim() || "";
    if (text.length < 2 || text.length > 80) return false;

    // Skip if it contains inputs (we only want actual text labels/headers)
    if (el.querySelector("input, select, textarea, button")) return false;

    return true;
  });

  const labelRects: LabelRectItem[] = labelCandidates
    .map((el) => ({
      element: el,
      rect: el.getBoundingClientRect(),
      text: cleanLabelText(el.textContent || ""),
    }))
    .filter(
      (item) =>
        item.rect.width > 0 && item.rect.height > 0 && item.text.length >= 2,
    );

  // 1. Select all inputs deep inside Light DOM and Shadow DOM roots
  let inputs = querySelectorAllDeep<HTMLElement>(
    INTERACTIVE_INPUT_SELECTORS,
    document.body || document.documentElement,
  );

  // ── Tab Panel Awareness: Activate hidden tab panels to extract their fields ──
  const tabPanels = querySelectorAllDeep<HTMLElement>(
    '[role="tabpanel"]',
    document.body || document.documentElement,
  );
  const hiddenTabPanels: {
    panel: HTMLElement;
    tab: HTMLElement | null;
    originalAriaHidden: string | null;
    originalDisplay: string;
    originalHiddenProp: boolean;
  }[] = [];

  for (const panel of tabPanels) {
    const panelStyle = window.getComputedStyle(panel);
    const isHidden =
      panel.hidden ||
      panel.getAttribute("aria-hidden") === "true" ||
      panelStyle.display === "none";
    if (isHidden) {
      let associatedTab: HTMLElement | null = null;
      const labelledBy = panel.getAttribute("aria-labelledby");
      if (labelledBy) {
        associatedTab = document.getElementById(labelledBy);
      }
      if (!associatedTab && panel.id) {
        associatedTab = document.querySelector<HTMLElement>(
          `[role="tab"][aria-controls="${panel.id}"]`,
        );
      }
      hiddenTabPanels.push({
        panel,
        tab: associatedTab,
        originalAriaHidden: panel.getAttribute("aria-hidden"),
        originalDisplay: panelStyle.display,
        originalHiddenProp: panel.hidden,
      });
      panel.removeAttribute("aria-hidden");
      panel.hidden = false;
      if (panelStyle.display === "none") {
        panel.style.display = "";
      }
    }
  }

  // After revealing hidden tab panels, re-query to pick up newly visible fields
  if (hiddenTabPanels.length > 0) {
    const additionalInputs = querySelectorAllDeep<HTMLElement>(
      INTERACTIVE_INPUT_SELECTORS,
      document.body || document.documentElement,
    );
    const inputSet = new Set(inputs);
    for (const el of additionalInputs) {
      if (!inputSet.has(el)) {
        inputs.push(el);
        inputSet.add(el);
      }
    }
  }

  // Fallback: If no inputs were found via standard selectors, query broader interactive input wrappers
  if (inputs.length === 0) {
    inputs = Array.from(
      document.querySelectorAll<HTMLElement>(BROAD_INPUT_FALLBACK_SELECTORS),
    );
  }

  const fields: FormField[] = [];
  const groupMap = new Map<string, FormField>();
  const processedIds = new Set<string>();

  inputs.forEach((input, index) => {
    // Skip non-visible fields, EXCEPT for file inputs which are often hidden visually in custom uploaders
    const isFileInput =
      input.tagName === "INPUT" && (input as HTMLInputElement).type === "file";
    if (!isVisible(input) && !isFileInput) return;

    // ── HONEYPOT SKIP ──
    if (isHoneypot(input)) {
      console.log(
        "Aullevo: honeypot field detected — skipping:",
        input.id || input.getAttribute("name"),
      );
      return;
    }

    // ── CAPTCHA SKIP ──
    const captchaWrapper = input.closest(
      '[class*="captcha"], [id*="captcha"], [data-sitekey]',
    ) as HTMLElement | null;
    if (
      isCaptchaField(input) ||
      (captchaWrapper && isCaptchaField(captchaWrapper))
    ) {
      console.log(
        "Aullevo: CAPTCHA field detected — skipping:",
        input.id || input.getAttribute("name"),
      );
      return;
    }

    const isButton =
      input.tagName === "BUTTON" ||
      (input instanceof HTMLInputElement &&
        (input.type === "submit" || input.type === "button"));

    if (isButton) {
      // Only include buttons that look like "Add" actions
      const text = (
        input.textContent ||
        (input as HTMLInputElement).value ||
        ""
      )
        .trim()
        .toLowerCase();
      const aria = (input.getAttribute("aria-label") || "")
        .trim()
        .toLowerCase();
      const isAddBtn = ["add", "plus", "create", "new", "more"].some(
        (k) => text.includes(k) || aria.includes(k),
      );

      if (!isAddBtn) return;
    } else if (input instanceof HTMLInputElement && input.type === "hidden") {
      return;
    }

    const matrixInfo = findMatrixHeaders(input, labelRects);

    // Logic for distinct handling of Radios/Checkboxes
    const isRadio =
      (input instanceof HTMLInputElement && input.type === "radio") ||
      input.getAttribute("role") === "radio";
    const isCheckbox =
      (input instanceof HTMLInputElement && input.type === "checkbox") ||
      input.getAttribute("role") === "checkbox";

    const is2DMatrixCheckbox =
      isCheckbox && !!(matrixInfo.rowHeader && matrixInfo.colHeader);

    if ((isRadio || isCheckbox) && !is2DMatrixCheckbox) {
      let name = input.getAttribute("name") || "";

      if (!name) {
        const container = input.closest(
          '.checkbox-group, .radio-group, fieldset, [role="group"], ' +
            '[role="radiogroup"], [class*="checkbox"], [class*="radio"], ' +
            '[class*="check-group"], [class*="radio-group"]',
        ) as HTMLElement | null;
        if (container?.id) {
          name = container.id;
        } else {
          const wrapper = input.closest(
            "div, fieldset, section",
          ) as HTMLElement;
          if (wrapper) {
            name = wrapper.id || `unnamed_group_${index}`;
            if (!wrapper.id) wrapper.id = name;
          }
        }
        if (!name) return;
      }

      let groupKey: string;
      if (matrixInfo.rowHeader) {
        const matrixContainer =
          input.closest(
            'table, [role="grid"], [role="table"], [class*="grid" i], [class*="matrix" i], [class*="table" i], [class*="availability" i], section, fieldset',
          ) || input.parentElement;
        const containerId =
          matrixContainer?.id ||
          (matrixContainer?.className &&
          typeof matrixContainer.className === "string"
            ? matrixContainer.className.split(/\s+/)[0]
            : "") ||
          "matrix";
        const groupType = isRadio ? "radio_group" : "checkbox_group";
        groupKey = `matrix_${groupType}_${containerId}_${matrixInfo.rowHeader.toLowerCase().replace(/[^a-z0-9]/gi, "_")}`;
      } else {
        groupKey = name;
      }

      if (!groupMap.has(groupKey)) {
        const groupType = isRadio ? "radio_group" : "checkbox_group";
        const rawGroupLabel =
          findGroupLabel(input, labelRects) || findLabel(input, labelRects);
        const groupLabel = matrixInfo.rowHeader
          ? rawGroupLabel &&
            !rawGroupLabel
              .toLowerCase()
              .includes(matrixInfo.rowHeader.toLowerCase())
            ? `${rawGroupLabel} — ${matrixInfo.rowHeader}`
            : matrixInfo.rowHeader
          : rawGroupLabel;
        const context = findFieldContext(input);
        const section = findFieldSection(input);

        groupMap.set(groupKey, {
          id: groupKey,
          name: name,
          type: groupType,
          placeholder: "",
          label: groupLabel,
          ariaLabel: input.getAttribute("aria-label") || "",
          autocomplete: input.getAttribute("autocomplete") || "",
          required:
            (input as HTMLInputElement).required ||
            input.getAttribute("aria-required") === "true",
          context: context,
          section: section,
          rowHeader: matrixInfo.rowHeader,
          options: [],
        });
      }

      const inputValue =
        (input as HTMLInputElement).value ||
        input.getAttribute("value") ||
        input.getAttribute("name") ||
        input.textContent?.trim() ||
        "on";
      const rawOptionLabel = findLabel(input, labelRects) || inputValue;
      const optionLabel =
        matrixInfo.colHeader ||
        matrixInfo.compoundLabel ||
        rawOptionLabel;
      const group = groupMap.get(groupKey)!;
      group.options?.push({
        label: optionLabel,
        value: inputValue,
        rowHeader: matrixInfo.rowHeader,
        colHeader: matrixInfo.colHeader,
        compoundLabel: matrixInfo.compoundLabel,
      });

      return;
    }

    // Standard handling for other inputs
    const context = findFieldContext(input);
    const section = findFieldSection(input);

    let options: { label: string; value: string }[] | undefined;
    if (input instanceof HTMLSelectElement) {
      options = Array.from(input.options).map((opt) => ({
        label: opt.text,
        value: opt.value,
      }));
    }

    const fieldId = input.id || `field_${index}`;
    if (!input.id) input.id = fieldId;
    processedIds.add(fieldId);

    const isRangeInput =
      input instanceof HTMLInputElement && input.type === "range";

    // Detect ARIA role-based widget types for div-based custom components
    const ariaRole = input.getAttribute("role") || "";
    const isAriaSlider = ariaRole === "slider";
    const isAriaSpinbutton = ariaRole === "spinbutton";
    const isAriaGrid = ariaRole === "grid";
    const isAriaGridcell = ariaRole === "gridcell";
    const isAriaTree = ariaRole === "tree";
    const isAriaTreeitem = ariaRole === "treeitem";
    const isRangeOrSlider = isRangeInput || isAriaSlider;

    const isContentEditable = input.isContentEditable || ariaRole === "textbox";
    let chatContext: string[] | undefined = undefined;
    if (isContentEditable) {
      chatContext = extractChatContext(input);
    }

    // Determine the field type, preferring ARIA roles for custom components
    let fieldType: string;
    if (isContentEditable) {
      fieldType = "contenteditable";
    } else if (isAriaSlider) {
      fieldType = "slider";
    } else if (isAriaSpinbutton) {
      fieldType = "spinbutton";
    } else if (isAriaGrid) {
      fieldType = "grid";
    } else if (isAriaGridcell) {
      fieldType = "gridcell";
    } else if (isAriaTree) {
      fieldType = "tree";
    } else if (isAriaTreeitem) {
      fieldType = "treeitem";
    } else if (input instanceof HTMLInputElement) {
      fieldType = input.type;
    } else {
      fieldType = input.tagName.toLowerCase();
    }

    let resolvedLabel = isButton
      ? (input.textContent || (input as HTMLInputElement).value || "").trim()
      : findLabel(input, labelRects);

    if (matrixInfo.compoundLabel && matrixInfo.rowHeader && matrixInfo.colHeader) {
      resolvedLabel = matrixInfo.compoundLabel;
    } else if (matrixInfo.colHeader && (!resolvedLabel || resolvedLabel.length < 2)) {
      resolvedLabel = matrixInfo.colHeader;
    }

    const fieldInfo: FormField = {
      id: fieldId,
      name: input.getAttribute("name") || "",
      type: fieldType,
      placeholder:
        input instanceof HTMLInputElement ||
        input instanceof HTMLTextAreaElement
          ? input.placeholder || ""
          : "",
      label: resolvedLabel,
      ariaLabel: input.getAttribute("aria-label") || "",
      autocomplete: input.getAttribute("autocomplete") || "",
      required:
        (input as HTMLInputElement).required ||
        input.getAttribute("aria-required") === "true",
      context: context,
      section: section,
      accept: isFileInput
        ? (input as HTMLInputElement).accept || ""
        : undefined,
      multiple: isFileInput ? (input as HTMLInputElement).multiple : undefined,
      options: options,
      min: isRangeOrSlider
        ? (input as HTMLInputElement).min ||
          input.getAttribute("aria-valuemin") ||
          undefined
        : isAriaSpinbutton
          ? input.getAttribute("aria-valuemin") || undefined
          : undefined,
      max: isRangeOrSlider
        ? (input as HTMLInputElement).max ||
          input.getAttribute("aria-valuemax") ||
          undefined
        : isAriaSpinbutton
          ? input.getAttribute("aria-valuemax") || undefined
          : undefined,
      step: isRangeInput ? (input as HTMLInputElement).step : undefined,
      currentValue:
        isAriaSlider || isAriaSpinbutton
          ? input.getAttribute("aria-valuenow") ||
            input.getAttribute("aria-valuetext") ||
            undefined
          : undefined,
      chatContext: chatContext,
      rowHeader: matrixInfo.rowHeader,
      colHeader: matrixInfo.colHeader,
      compoundLabel: matrixInfo.compoundLabel,
    };

    fields.push(fieldInfo);
  });

  // Add grouped fields to the main list
  fields.push(...Array.from(groupMap.values()));

  // ── Detect custom/div-based selects (React-Select, MUI, Ant Design, etc.) ──
  const customSelects = querySelectorAllDeep<HTMLElement>(
    CUSTOM_SELECT_SELECTORS.join(","),
    document.body || document.documentElement,
  );
  customSelects.forEach((el, idx) => {
    if (!isVisible(el)) return;

    if (isCaptchaField(el)) return;

    const elId =
      el.id || el.getAttribute("data-testid") || `custom_select_${idx}`;
    if (!el.id) el.id = elId;
    if (processedIds.has(elId)) return;
    if (el.querySelector("select")) return;

    const label =
      findLabel(el, labelRects) || el.getAttribute("aria-label") || "";
    const context = findFieldContext(el);
    const section = findFieldSection(el);
    const placeholder =
      el.getAttribute("placeholder") ||
      el.querySelector('[class*="placeholder"]')?.textContent?.trim() ||
      "";

    const options = extractCustomSelectOptions(el);

    processedIds.add(elId);
    fields.push({
      id: elId,
      name: el.getAttribute("name") || "",
      type: "custom_select",
      placeholder: placeholder,
      label: label,
      ariaLabel: el.getAttribute("aria-label") || "",
      autocomplete: "",
      required: el.getAttribute("aria-required") === "true",
      context: context,
      section: section,
      options: options.length > 0 ? options : undefined,
    });
  });

  // ── Detect div-based toggle switches (not real inputs) ──
  const toggleEls = document.querySelectorAll<HTMLElement>(
    TOGGLE_SELECTORS.join(","),
  );
  toggleEls.forEach((el, idx) => {
    if (!isVisible(el)) return;
    if (isCaptchaField(el)) return;

    const elId = el.id || `toggle_${idx}`;
    if (!el.id) el.id = elId;
    if (processedIds.has(elId)) return;

    // Skip if this element contains actual inputs (already processed)
    if (el.querySelector("input, select, textarea")) return;

    const isOn =
      el.classList.contains("on") ||
      el.getAttribute("aria-checked") === "true" ||
      el.classList.contains("active");

    const label = findLabel(el, labelRects);
    const context = findFieldContext(el);
    const section = findFieldSection(el);

    processedIds.add(elId);
    fields.push({
      id: elId,
      name: el.getAttribute("name") || "",
      type: "toggle",
      placeholder: "",
      label: label,
      ariaLabel: el.getAttribute("aria-label") || "",
      autocomplete: "",
      required: false,
      context: context,
      section: section,
      currentValue: isOn ? "true" : "false",
    });
  });

  // ── Restore hidden tab panels after extraction ──
  for (const {
    panel,
    originalAriaHidden,
    originalDisplay,
    originalHiddenProp,
  } of hiddenTabPanels) {
    if (originalAriaHidden !== null) {
      panel.setAttribute("aria-hidden", originalAriaHidden);
    } else {
      panel.removeAttribute("aria-hidden");
    }
    if (originalDisplay === "none") {
      panel.style.display = "none";
    }
    panel.hidden = originalHiddenProp;
  }

  return fields;
}
