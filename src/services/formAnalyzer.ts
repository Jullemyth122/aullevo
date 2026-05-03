import type { FormField, FieldMapping } from "../types";

/* ═══════════════════════════════════════════════════
   CAPTCHA DETECTION
   ═══════════════════════════════════════════════════ */

/**
 * Detect if an element is a CAPTCHA widget.
 * Checks id, className, name, src, and data-* attributes.
 */
export function isCaptchaField(el: HTMLElement): boolean {
  const CAPTCHA_SIGNALS = [
    "captcha",
    "recaptcha",
    "hcaptcha",
    "turnstile",
    "cf-challenge",
    "arkose",
    "funcaptcha",
    "geetest",
    "px-captcha",
    "datadome",
    "mtcaptcha",
  ];

  const haystack = [
    el.id,
    el.className,
    el.getAttribute("name") || "",
    el.getAttribute("src") || "",
    el.getAttribute("data-sitekey") || "",
    el.getAttribute("data-type") || "",
  ]
    .join(" ")
    .toLowerCase();

  return CAPTCHA_SIGNALS.some((s) => haystack.includes(s));
}

/**
 * Scan the entire DOM for CAPTCHA widgets (iframes, divs, scripts).
 * Returns true if any CAPTCHA is found on the page.
 */
export function detectPageCaptcha(): { found: boolean; types: string[] } {
  const types: string[] = [];

  // Google reCAPTCHA
  if (
    document.querySelector(
      '.g-recaptcha, [data-sitekey], iframe[src*="recaptcha"]',
    )
  ) {
    types.push("reCAPTCHA");
  }
  // hCaptcha
  if (document.querySelector('.h-captcha, iframe[src*="hcaptcha"]')) {
    types.push("hCaptcha");
  }
  // Cloudflare Turnstile
  if (
    document.querySelector(
      '.cf-turnstile, iframe[src*="challenges.cloudflare"]',
    )
  ) {
    types.push("Turnstile");
  }
  // Arkose / FunCaptcha
  if (
    document.querySelector(
      '[id*="FunCaptcha"], [id*="arkose"], iframe[src*="arkoselabs"]',
    )
  ) {
    types.push("Arkose");
  }
  // Generic: any iframe with captcha in src
  document.querySelectorAll("iframe").forEach((iframe) => {
    const src = (
      iframe.src ||
      iframe.getAttribute("data-src") ||
      ""
    ).toLowerCase();
    if (src.includes("captcha") && !types.includes("Generic")) {
      types.push("Generic CAPTCHA iframe");
    }
  });

  return { found: types.length > 0, types };
}

/* ═══════════════════════════════════════════════════
   IFRAME FIELD EXTRACTION
   ═══════════════════════════════════════════════════ */

/**
 * Request form fields from all child iframes via postMessage.
 * Returns a Promise that resolves with all collected iframe fields.
 * The iframe content scripts must have the IFRAME_FIELD_RESPONDER
 * listener active (injected via manifest all_frames: true).
 *
 * Usage: const iframeFields = await extractIframeFields(2000);
 */
export function extractIframeFields(timeoutMs = 2000): Promise<FormField[]> {
  return new Promise((resolve) => {
    const collected: FormField[] = [];
    const iframes = Array.from(
      document.querySelectorAll<HTMLIFrameElement>("iframe"),
    );

    if (iframes.length === 0) return resolve([]);

    let pending = iframes.length;
    const REQUEST_ID = `aullevo_iframe_${Date.now()}`;

    const onMessage = (event: MessageEvent) => {
      if (
        event.data?.type === "AULLEVO_IFRAME_FIELDS_RESPONSE" &&
        event.data?.requestId === REQUEST_ID
      ) {
        const fields: FormField[] = event.data.fields || [];
        // Tag each field so we know it came from an iframe
        fields.forEach((f) => {
          (f as any)._fromIframe = true;
        });
        collected.push(...fields);
        pending--;
        if (pending === 0) finish();
      }
    };

    window.addEventListener("message", onMessage);

    // Send request to each iframe
    iframes.forEach((iframe) => {
      try {
        iframe.contentWindow?.postMessage(
          { type: "AULLEVO_EXTRACT_FIELDS", requestId: REQUEST_ID },
          "*",
        );
      } catch {
        // cross-origin iframe — can't reach, just decrement
        pending--;
        if (pending === 0) finish();
      }
    });

    // Timeout fallback
    const timer = setTimeout(finish, timeoutMs);

    function finish() {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(collected);
    }
  });
}

/**
 * Register this content script as an iframe responder.
 * Call this once when the content script loads inside an iframe.
 * It listens for AULLEVO_EXTRACT_FIELDS and replies with fields.
 */
export function registerIframeFieldResponder(): void {
  // Only activate inside actual iframes, not the top frame
  if (window === window.top) return;

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.data?.type !== "AULLEVO_EXTRACT_FIELDS") return;

    const fields = extractFormFields();

    // Reply to parent
    window.parent.postMessage(
      {
        type: "AULLEVO_IFRAME_FIELDS_RESPONSE",
        requestId: event.data.requestId,
        fields,
      },
      "*",
    );
  });
}

/* ═══════════════════════════════════════════════════
   FORM FIELD EXTRACTION (with CAPTCHA skip)
   ═══════════════════════════════════════════════════ */

/**
 * Extracts all form fields from the current page, prioritizing visible and modal fields.
 * CAPTCHA fields are automatically detected and skipped.
 */
export function extractFormFields(): FormField[] {
  // 1. Select all inputs from the entire document
  // (Hidden inputs will be filtered out by the isVisible check below)
  const inputs = Array.from(
    document.body.querySelectorAll<HTMLElement>(
      "input, textarea, select, button, [contenteditable='true'], [role='textbox'], [role='radio'], [role='checkbox']"
    ),
  );

  const fields: FormField[] = [];

  // Map to hold grouped fields temporarily
  const groupMap = new Map<string, FormField>();
  // Track IDs of inputs we've already processed
  const processedIds = new Set<string>();

  inputs.forEach((input, index) => {
    // Skip non-visible fields, EXCEPT for file inputs which are often hidden visually in custom uploaders
    const isFileInput =
      input.tagName === "INPUT" && (input as HTMLInputElement).type === "file";
    if (!isVisible(input) && !isFileInput) return;

    // ── CAPTCHA SKIP ──
    // Check the input itself and its closest wrapper container
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

    // Logic for distinct handling of Radios/Checkboxes
    const isRadio = (input instanceof HTMLInputElement && input.type === "radio") || input.getAttribute("role") === "radio";
    const isCheckbox = (input instanceof HTMLInputElement && input.type === "checkbox") || input.getAttribute("role") === "checkbox";

    if (isRadio || isCheckbox) {
      let name = input.getAttribute("name") || "";

      // RC1 FIX: When checkboxes/radios have no `name`, synthesize a group key
      // from the closest container element's id (e.g. <div class="checkbox-group" id="techskills">)
      if (!name) {
        const container = input.closest(
          '.checkbox-group, .radio-group, fieldset, [role="group"], ' +
            '[role="radiogroup"], [class*="checkbox"], [class*="radio"], ' +
            '[class*="check-group"], [class*="radio-group"]',
        ) as HTMLElement | null;
        if (container?.id) {
          name = container.id;
        } else {
          // Fallback: walk up to find any parent with an id
          const wrapper = input.closest(
            "div, fieldset, section",
          ) as HTMLElement;
          if (wrapper) {
            name = wrapper.id || `unnamed_group_${index}`;
            if (!wrapper.id) wrapper.id = name;
          }
        }
        if (!name) return; // Truly orphaned, skip
      }

      if (!groupMap.has(name)) {
        const groupType = isRadio ? "radio_group" : "checkbox_group";
        const groupLabel = findGroupLabel(input) || findLabel(input);
        const context = findFieldContext(input);
        const section = findFieldSection(input);

        groupMap.set(name, {
          id: name,
          name: name,
          type: groupType,
          placeholder: "",
          label: groupLabel,
          ariaLabel: input.getAttribute("aria-label") || "",
          autocomplete: input.getAttribute("autocomplete") || "",
          required: (input as HTMLInputElement).required || input.getAttribute("aria-required") === "true",
          context: context,
          section: section,
          options: [],
        });
      }

      const inputValue = (input as HTMLInputElement).value || input.getAttribute("value") || input.textContent?.trim() || "on";
      const optionLabel = findLabel(input) || inputValue;
      const group = groupMap.get(name)!;
      group.options?.push({
        label: optionLabel,
        value: inputValue,
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
    
    const isContentEditable = input.isContentEditable || input.getAttribute("role") === "textbox";
    let chatContext: string[] | undefined = undefined;
    if (isContentEditable) {
      chatContext = extractChatContext(input);
    }

    const fieldInfo: FormField = {
      id: fieldId,
      name: input.getAttribute("name") || "",
      type: isContentEditable 
          ? "contenteditable"
          : input instanceof HTMLInputElement
          ? input.type
          : input.tagName.toLowerCase(),
      placeholder:
        input instanceof HTMLInputElement ||
        input instanceof HTMLTextAreaElement
          ? input.placeholder || ""
          : "",
      label: isButton
        ? (input.textContent || (input as HTMLInputElement).value || "").trim()
        : findLabel(input),
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
      // RC3 FIX: Include range metadata so AI knows valid bounds
      min: isRangeInput ? (input as HTMLInputElement).min : undefined,
      max: isRangeInput ? (input as HTMLInputElement).max : undefined,
      step: isRangeInput ? (input as HTMLInputElement).step : undefined,
      chatContext: chatContext,
    };

    fields.push(fieldInfo);
  });

  // Add grouped fields to the main list
  fields.push(...Array.from(groupMap.values()));

  // ── Detect custom/div-based selects (React-Select, MUI, Ant Design, etc.) ──
  const customSelectSelectors = [
    '[role="combobox"]',
    '[role="listbox"]',
    '[class*="react-select"]',
    '[class*="select__control"]',
    '[class*="MuiSelect"]',
    '[class*="ant-select"]',
    '[class*="choices"]',
    '[data-testid*="select"]',
    '[class*="selectContainer"]',
    '[class*="select-container"]',
  ];

  const customSelects = document.querySelectorAll<HTMLElement>(
    customSelectSelectors.join(","),
  );
  customSelects.forEach((el, idx) => {
    if (!isVisible(el)) return;

    // ── CAPTCHA SKIP for custom elements ──
    if (isCaptchaField(el)) return;

    const elId =
      el.id || el.getAttribute("data-testid") || `custom_select_${idx}`;
    if (!el.id) el.id = elId;
    if (processedIds.has(elId)) return;
    if (el.querySelector("select")) return;

    const label = findLabel(el) || el.getAttribute("aria-label") || "";
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

  // ── RC2 FIX: Detect div-based toggle switches (not real inputs) ──
  const toggleSelectors = [
    '[role="switch"]',
    ".toggle:not(input):not(button)",
    '[class*="toggle-switch"]',
  ];
  const toggleEls = document.querySelectorAll<HTMLElement>(
    toggleSelectors.join(","),
  );
  toggleEls.forEach((el, idx) => {
    if (!isVisible(el)) return;
    if (isCaptchaField(el)) return;

    const elId = el.id || `toggle_${idx}`;
    if (!el.id) el.id = elId;
    if (processedIds.has(elId)) return;

    // Skip if this element contains actual inputs (already processed)
    if (el.querySelector("input, select, textarea")) return;

    // Determine current state
    const isOn =
      el.classList.contains("on") ||
      el.getAttribute("aria-checked") === "true" ||
      el.classList.contains("active");

    const label = findLabel(el);
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

  return fields;
}

// ─── All helpers below are unchanged from the original ───

function isVisible(element: HTMLElement): boolean {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  if (style.display === "none") return false;

  if (element.offsetParent === null) {
    if (style.position !== "fixed" && style.position !== "absolute") {
      let p = element.parentElement;
      let isNone = false;
      while (p) {
        if (window.getComputedStyle(p).display === "none") {
          isNone = true;
          break;
        }
        p = p.parentElement;
      }
      if (isNone) return false;
    }
  }
  return true;
}

function findActiveModals(): HTMLElement[] {
  const modalSelectors = [
    '[role="dialog"]',
    ".modal",
    ".popup",
    ".dialog",
    ".artdeco-modal",
    '[aria-modal="true"]',
  ];
  const potentials = document.querySelectorAll<HTMLElement>(
    modalSelectors.join(","),
  );
  return Array.from(potentials).filter(isVisible);
}

function findFieldContext(input: HTMLElement): string {
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

function findFieldSection(input: HTMLElement): string {
  const section = input.closest("section, div.section, div.group");
  if (section && section instanceof HTMLElement && section.id) {
    return section.id;
  }
  return "";
}

function findLabel(input: HTMLElement): string {
  if (input.id) {
    const label = document.querySelector<HTMLLabelElement>(
      `label[for="${input.id}"]`,
    );
    if (label) return label.textContent?.trim() || "";
  }
  const parentLabel = input.closest("label");
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    const innerInput = clone.querySelector("input, select, textarea");
    if (innerInput) innerInput.remove();
    return clone.textContent?.trim() || "";
  }

  // Custom UI components often place the label text in a generic div right before the input container
  let el: HTMLElement | null = input;
  for (let i = 0; i < 4 && el; i++) {
    let prev = el.previousElementSibling as HTMLElement;
    while (prev) {
      if (!prev.matches("input, select, textarea, button, form")) {
        const text = prev.textContent?.trim() || "";
        if (text && text.length < 100 && text.length > 2) return text;
      }
      prev = prev.previousElementSibling as HTMLElement;
    }
    el = el.parentElement;
  }

  const prevSibling = input.previousElementSibling;
  if (prevSibling && prevSibling.tagName === "LABEL") {
    return prevSibling.textContent?.trim() || "";
  }
  if (
    prevSibling &&
    (prevSibling.tagName === "SPAN" || prevSibling.tagName === "DIV")
  ) {
    return prevSibling.textContent?.trim() || "";
  }
  const describedBy = input.getAttribute("aria-describedby");
  if (describedBy) {
    const descEl = document.getElementById(describedBy);
    if (descEl && (descEl.textContent?.length || 0) < 80) {
      return descEl.textContent?.trim() || "";
    }
  }
  const title = input.getAttribute("title");
  if (title) return title;
  const dataLabel =
    input.getAttribute("data-label") || input.getAttribute("data-field-label");
  if (dataLabel) return dataLabel;
  const parentEl = input.parentElement;
  if (parentEl) {
    const sibLabel = parentEl.querySelector(
      'label, .label, [class*="label"], [class*="Label"]',
    );
    if (
      sibLabel &&
      sibLabel !== input &&
      (sibLabel.textContent?.length || 0) < 60
    ) {
      return sibLabel.textContent?.trim() || "";
    }
  }
  const cell = input.closest("td");
  if (cell) {
    const prevCell = cell.previousElementSibling;
    if (prevCell && (prevCell.tagName === "TD" || prevCell.tagName === "TH")) {
      if ((prevCell.textContent?.length || 0) < 50) {
        return prevCell.textContent?.trim() || "";
      }
    }
  }
  return "";
}

function findGroupLabel(input: HTMLElement): string {
  const fieldset = input.closest("fieldset");
  if (fieldset) {
    const legend = fieldset.querySelector("legend");
    if (legend) return legend.textContent?.trim() || "";
  }
  const row = input.closest("tr");
  if (row) {
    const firstCell = row.firstElementChild;
    if (firstCell && !firstCell.contains(input)) {
      return firstCell.textContent?.trim() || "";
    }
  }

  // RC6 FIX: Check parent/sibling divs with label-like classes
  // Modern UIs use divs not fieldsets, e.g.:
  //   <div class="field">
  //     <div class="field-label">Technical Skills</div>
  //     <div class="checkbox-group" id="techskills">...</div>
  //   </div>
  const container = input.closest(
    '.field, .form-group, .form-field, [class*="field-wrapper"], ' +
      '[class*="form-item"], [class*="field-container"]',
  ) as HTMLElement | null;
  if (container) {
    const labelEl = container.querySelector(
      '.field-label, .label, [class*="label"], [class*="Label"], legend, label',
    );
    if (
      labelEl &&
      !labelEl.contains(input) &&
      (labelEl.textContent?.length || 0) < 100
    ) {
      return labelEl.textContent?.trim() || "";
    }
  }

  // Also check immediate previous sibling of the group container
  const groupContainer = input.closest(
    '.checkbox-group, .radio-group, [role="group"], [role="radiogroup"]',
  ) as HTMLElement | null;
  if (groupContainer) {
    const prevSib = groupContainer.previousElementSibling;
    if (
      prevSib &&
      (prevSib.textContent?.length || 0) < 100 &&
      (prevSib.textContent?.length || 0) > 2
    ) {
      return prevSib.textContent?.trim() || "";
    }
  }

  return "";
}

export function fillFormField(
  fieldIdentifier: FieldMapping,
  value: string | boolean | string[],
  resumeFileInfo?: { resumeFileData?: string; resumeFileName?: string },
): boolean {
  let input: HTMLElement | null = null;
  let inputs: NodeListOf<HTMLElement> | null = null;

  if (fieldIdentifier.id) {
    input = document.getElementById(fieldIdentifier.id);

    // RC4+RC5 FIX: If the id resolves to a container div (not an input),
    // check if it wraps radio/checkbox inputs and handle as a group
    if (
      input &&
      !(input instanceof HTMLInputElement) &&
      !(input instanceof HTMLSelectElement) &&
      !(input instanceof HTMLTextAreaElement) &&
      !(input instanceof HTMLButtonElement)
    ) {
      const childRadios = input.querySelectorAll<HTMLInputElement>(
        'input[type="radio"]',
      );
      const childCheckboxes = input.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]',
      );

      if (childRadios.length > 0) {
        return fillRadioGroup(childRadios, value);
      }
      if (childCheckboxes.length > 0) {
        return fillCheckboxGroup(childCheckboxes, value);
      }

      // RC2 FIX: Handle toggle/switch divs
      if (
        input.classList.contains("toggle") ||
        input.getAttribute("role") === "switch" ||
        input.classList.contains("switch") ||
        input.classList.contains("toggle-switch")
      ) {
        return fillToggle(input, value);
      }
    }

    if (!input) {
      inputs = document.querySelectorAll(`[name="${fieldIdentifier.id}"]`);
      if (inputs.length === 0) inputs = null;
    }
  }

  if (!input && !inputs && fieldIdentifier.name) {
    input = document.querySelector(`[name="${fieldIdentifier.name}"]`);
    if (!input) {
      inputs = document.querySelectorAll(`[name="${fieldIdentifier.name}"]`);
      if (inputs.length === 0) inputs = null;
    }
  }

  if (!input && !inputs && fieldIdentifier.id) {
    const isCustomSelect =
      fieldIdentifier.id.startsWith("custom_select_") ||
      document.querySelector(`[data-testid="${fieldIdentifier.id}"]`);
    if (isCustomSelect) {
      return fillCustomSelect(fieldIdentifier.id, String(value));
    }
  }

  if (!input && !inputs) return false;

  if (inputs && inputs.length > 0) {
    let filledAny = false;
    inputs.forEach((el) => {
      if (el instanceof HTMLInputElement) {
        if (el.type === "radio") {
          const valStr = String(value).toLowerCase().trim();
          const label = findLabel(el).toLowerCase().trim();
          if (
            el.value.toLowerCase() === valStr ||
            label.includes(valStr) ||
            valStr.includes(label) ||
            fuzzyMatch(label, valStr) ||
            fuzzyMatch(el.value, valStr)
          ) {
            setCheckboxState(el, true);
            filledAny = true;
          }
        } else if (el.type === "checkbox") {
          let valuesToCheck: string[] = [];
          if (Array.isArray(value))
            valuesToCheck = value.map((v) => String(v).toLowerCase().trim());
          else if (typeof value === "boolean")
            valuesToCheck = value ? ["true", "on", "yes", "1"] : [];
          else
            valuesToCheck = String(value)
              .split(",")
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean);

          const isPositiveString = [
            "true",
            "yes",
            "on",
            "1",
            "checked",
          ].includes(String(value).toLowerCase());
          const valStr = el.value.toLowerCase().trim();
          const label = findLabel(el).toLowerCase().trim();

          if (
            isPositiveString ||
            valuesToCheck.some(
              (v) =>
                valStr === v ||
                label.includes(v) ||
                v.includes(label) ||
                fuzzyMatch(label, v) ||
                fuzzyMatch(valStr, v),
            )
          ) {
            setCheckboxState(el, true);
            filledAny = true;
          }
        }
      }
    });
    return filledAny;
  }

  if (input) {
    if (input instanceof HTMLSelectElement) {
      // fillSelect uses applySelectValue which handles React native setter + events
      fillSelect(input, value as string);
      // Return based on whether a value was actually set
      return select_was_filled(input);
    } else if (input instanceof HTMLInputElement) {
      if (input.type === "checkbox") {
        const valLower = String(value).toLowerCase();
        const isPositive = ["true", "yes", "on", "1", "checked"].includes(
          valLower,
        );
        setCheckboxState(input, isPositive);
      } else if (input.type === "file") {
        if (value === "FILE_UPLOAD") {
          if (fieldIdentifier.files && fieldIdentifier.files.length > 0) {
            return fillMultiFileInput(input, fieldIdentifier.files);
          }
          const fData =
            fieldIdentifier.fileData || resumeFileInfo?.resumeFileData;
          const fName =
            fieldIdentifier.fileName || resumeFileInfo?.resumeFileName;
          if (fData && fName) {
            return fillFileInput(input, fData, fName);
          }
        }
        return false;
      } else if (input.type === "radio") {
        fillRadio(input, value as string);
      } else if (input.type === "range") {
        // RC3 FIX: Dedicated range slider handler
        const numVal = Number(value);
        if (!isNaN(numVal)) {
          const min = Number(input.min) || 0;
          const max = Number(input.max) || 100;
          const clamped = Math.max(min, Math.min(max, numVal));
          const nativeSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )?.set;
          if (nativeSetter) nativeSetter.call(input, String(clamped));
          else input.value = String(clamped);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } else if (input.type === "number") {
        // RC7 FIX: Number inputs reject non-numeric strings like "2026-2027".
        // Extract the first valid number from the value and clamp to min/max.
        const valStr = String(value);
        const numMatch = valStr.match(/-?\d+(\.\d+)?/);
        const numVal = numMatch ? Number(numMatch[0]) : NaN;
        if (!isNaN(numVal)) {
          const min = input.min !== "" ? Number(input.min) : -Infinity;
          const max = input.max !== "" ? Number(input.max) : Infinity;
          const clamped = Math.max(min, Math.min(max, numVal));
          const nativeSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )?.set;
          if (nativeSetter) nativeSetter.call(input, String(clamped));
          else input.value = String(clamped);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          console.log(
            `Aullevo number: "${valStr}" → ${clamped} (min=${min}, max=${max})`,
          );
        } else {
          console.warn(
            `Aullevo: Could not extract number from "${valStr}" for input#${input.id}`,
          );
          return false;
        }
      } else {
        // Use native setter for React text inputs too
        const nativeSetter = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(input),
          "value",
        )?.set;
        if (nativeSetter) {
          nativeSetter.call(input, value as string);
        } else {
          input.value = value as string;
        }
        triggerEvents(input);
      }
    } else if (input instanceof HTMLTextAreaElement) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(input, value as string);
      } else {
        input.value = value as string;
      }
      triggerEvents(input);
    } else if (input.isContentEditable || input.getAttribute("role") === "textbox") {
      // Modern chat automation (Messenger, Slack, etc.)
      input.focus();
      document.execCommand("insertText", false, value as string);
      triggerEvents(input);
    } else {
      return fillCustomSelect(fieldIdentifier.id || "", String(value));
    }
    return true;
  }

  return false;
}

/**
 * Check if a select element has a non-empty value selected (i.e. fill succeeded).
 */
function select_was_filled(select: HTMLSelectElement): boolean {
  return select.value !== "" && select.selectedIndex > 0;
}

/**
 * Apply a select value using React-native property setter so React/Vue/Angular
 * state syncs correctly. Direct assignment (select.value = x) is silently
 * ignored by React because it wraps the setter.
 */
function applySelectValue(
  select: HTMLSelectElement,
  optionValue: string,
): void {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set;
  if (nativeSetter) {
    nativeSetter.call(select, optionValue);
  } else {
    select.value = optionValue;
  }
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  select.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

/**
 * Score how well an option matches the target value (0 = no match).
 * Handles: dial codes like "Philippines (+63)", country abbreviations, partials.
 */
function scoreOptionMatch(
  optText: string,
  optValue: string,
  valLower: string,
): number {
  const tl = optText.toLowerCase().trim();
  const vl = optValue.toLowerCase().trim();

  if (vl === valLower || tl === valLower) return 100;

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

function dataURLtoFile(dataurl: string, filename: string): File {
  let arr = dataurl.split(","),
    mimeMatch = arr[0].match(/:(.*?);/);
  let mime = mimeMatch ? mimeMatch[1] : "";
  let bstr = atob(arr[1]),
    n = bstr.length,
    u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
}

function fillFileInput(
  input: HTMLInputElement,
  dataUrl: string,
  fileName: string,
): boolean {
  return fillMultiFileInput(input, [{ dataUrl, name: fileName }]);
}

function fillMultiFileInput(
  input: HTMLInputElement,
  files: { dataUrl: string; name: string }[],
): boolean {
  try {
    const dt = new DataTransfer();
    for (const fileInfo of files) {
      const file = dataURLtoFile(fileInfo.dataUrl, fileInfo.name);
      dt.items.add(file);
    }

    // Standard injection via DataTransfer
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // ATS frameworks (Greenhouse, Lever, Workday) often wrap hidden file inputs
    // in a custom dropzone container. We try to dispatch drag-and-drop events
    // on the nearest dropzone wrapper so the framework's JS picks up the file.
    const dropzoneSelectors = [
      '[class*="dropzone"]',
      '[class*="file-upload"]',
      '[class*="upload-area"]',
      '[class*="drop-area"]',
      '[class*="drag-drop"]',
      '[class*="file-input"]',
      '[class*="attachment"]',
      '[data-testid*="upload"]',
      '[data-testid*="file"]',
    ];
    let dropzone: HTMLElement | null = null;
    for (const sel of dropzoneSelectors) {
      dropzone = input.closest(sel) as HTMLElement | null;
      if (dropzone) break;
    }
    // Also check up to 3 parent levels for a likely wrapper
    if (!dropzone) {
      let el: HTMLElement | null = input.parentElement;
      for (let i = 0; i < 3 && el; i++) {
        const cls = (el.className || "").toLowerCase();
        const testId = (el.getAttribute("data-testid") || "").toLowerCase();
        if (
          cls.includes("upload") ||
          cls.includes("drop") ||
          cls.includes("file") ||
          testId.includes("upload") ||
          testId.includes("file")
        ) {
          dropzone = el;
          break;
        }
        el = el.parentElement;
      }
    }

    if (dropzone && dropzone !== input) {
      const dropEvent = new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      });
      dropzone.dispatchEvent(dropEvent);
      console.log(
        "Aullevo: Also dispatched drop event on wrapper:",
        dropzone.className,
      );
    }

    return true;
  } catch (e) {
    console.error("Aullevo: Failed to inject file", e);
    return false;
  }
}

function fillSelect(select: HTMLSelectElement, value: string): void {
  if (!value) return;
  const valLower = value.toLowerCase().trim();
  const options = Array.from(select.options).filter(
    (o) => o.value !== "" && o.text.trim() !== "",
  );

  let bestOption: HTMLOptionElement | null = null;
  let bestScore = 0;

  for (const option of options) {
    const score = scoreOptionMatch(option.text, option.value, valLower);
    if (score > bestScore) {
      bestScore = score;
      bestOption = option;
    }
  }

  if (bestOption && bestScore >= 50) {
    applySelectValue(select, bestOption.value);
    console.log(
      "Aullevo select: " + bestOption.text + " (score: " + bestScore + ")",
    );
  } else {
    console.warn("Aullevo: No select match for " + JSON.stringify(value));
  }
}

function fillRadio(radio: HTMLInputElement, value: string): void {
  const name = radio.name;
  if (!name) return;
  const radios = document.querySelectorAll<HTMLInputElement>(
    `input[type="radio"][name="${name}"]`,
  );
  radios.forEach((r) => {
    if (r.value.toLowerCase().trim() === value.toLowerCase().trim()) {
      setCheckboxState(r, true);
    }
  });
}

function fuzzyMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const aNorm = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const bNorm = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!aNorm || !bNorm) return false;
  return aNorm.includes(bNorm) || bNorm.includes(aNorm);
}

/**
 * RC4+RC5 FIX: Fill a group of radio buttons found inside a container div.
 * Matches by value or label text (fuzzy).
 */
function fillRadioGroup(
  radios: NodeListOf<HTMLInputElement>,
  value: string | boolean | string[],
): boolean {
  const valStr = String(value).toLowerCase().trim();
  for (const radio of Array.from(radios)) {
    const radioLabel = findLabel(radio).toLowerCase().trim();
    const radioVal = radio.value.toLowerCase().trim();
    if (
      radioVal === valStr ||
      radioLabel === valStr ||
      radioLabel.includes(valStr) ||
      valStr.includes(radioLabel) ||
      fuzzyMatch(radioLabel, valStr) ||
      fuzzyMatch(radioVal, valStr)
    ) {
      if (!radio.checked) {
        setCheckboxState(radio, true);
      }

      // Fallback: Toggle CSS classes on parent label for custom UI frameworks if click didn't do it
      const parentLabel = radio.closest("label");
      if (parentLabel && !parentLabel.classList.contains("selected")) {
        const groupContainer = radio.closest(
          '.radio-group, [role="radiogroup"], fieldset',
        );
        groupContainer
          ?.querySelectorAll("label")
          .forEach((l) => l.classList.remove("selected"));
        parentLabel.classList.add("selected");
      }
      return true;
    }
  }
  return false;
}

/**
 * RC4 FIX: Fill a group of checkboxes found inside a container div.
 * Matches by value or label text (fuzzy). Supports arrays and comma-separated strings.
 */
function fillCheckboxGroup(
  checkboxes: NodeListOf<HTMLInputElement>,
  value: string | boolean | string[],
): boolean {
  let valuesToCheck: string[] = [];
  if (Array.isArray(value)) {
    valuesToCheck = value.map((v) => String(v).toLowerCase().trim());
  } else if (typeof value === "boolean") {
    valuesToCheck = value ? ["true", "on", "yes", "1"] : [];
  } else {
    // Could be comma-separated or single value
    valuesToCheck = String(value)
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
  }

  if (valuesToCheck.length === 0) return false;

  let filledAny = false;
  for (const cb of Array.from(checkboxes)) {
    const cbVal = cb.value.toLowerCase().trim();
    const cbLabel = findLabel(cb).toLowerCase().trim();

    const shouldCheck = valuesToCheck.some(
      (v) =>
        cbVal === v ||
        cbLabel === v ||
        cbLabel.includes(v) ||
        v.includes(cbLabel) ||
        fuzzyMatch(cbLabel, v) ||
        fuzzyMatch(cbVal, v),
    );

    if (shouldCheck && !cb.checked) {
      setCheckboxState(cb, true);

      // Fallback: Toggle CSS class on parent label for custom UI if click didn't do it
      const parentLabel = cb.closest("label");
      if (parentLabel && !parentLabel.classList.contains("selected")) {
        parentLabel.classList.add("selected");
      }
      filledAny = true;
    }
  }
  return filledAny;
}

/**
 * RC2 FIX: Fill a div-based toggle/switch element.
 */
function fillToggle(
  el: HTMLElement,
  value: string | boolean | string[],
): boolean {
  const valStr = String(value).toLowerCase().trim();
  const shouldBeOn = ["true", "yes", "on", "1", "checked"].includes(valStr);
  const isCurrentlyOn =
    el.classList.contains("on") ||
    el.getAttribute("aria-checked") === "true" ||
    el.classList.contains("active");

  if (shouldBeOn !== isCurrentlyOn) {
    el.click(); // Trigger the toggle's own click handler
    el.setAttribute("aria-checked", String(shouldBeOn));
  }
  return true;
}

function triggerEvents(input: HTMLElement): void {
  input.dispatchEvent(new Event("focus", { bubbles: true }));
  input.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  input.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
  );
  input.dispatchEvent(
    new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
  );

  if (
    input instanceof HTMLInputElement ||
    input instanceof HTMLTextAreaElement
  ) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "value",
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, input.value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  input.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, key: "a" }),
  );
  input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }));

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true }));
}

/**
 * Universal helper to safely set check state for checkboxes or radios natively and in React
 */
function setCheckboxState(input: HTMLInputElement, desiredState: boolean) {
  if (input.checked === desiredState) return;

  const parentLabel =
    input.closest("label") ||
    (input.id ? document.querySelector(`label[for="${input.id}"]`) : null);
  if (parentLabel) (parentLabel as HTMLElement).click();
  else input.click();

  if (input.checked !== desiredState) {
    input.checked = desiredState;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "checked",
    )?.set;
    if (nativeSetter) nativeSetter.call(input, desiredState);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function extractCustomSelectOptions(
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

export function fillCustomSelect(elementId: string, value: string): boolean {
  let el = document.getElementById(elementId);
  if (!el) el = document.querySelector(`[data-testid="${elementId}"]`);
  if (!el) {
    const customSelects = document.querySelectorAll<HTMLElement>(
      '[role="combobox"], [role="listbox"], [class*="react-select"], [class*="select__control"], [class*="MuiSelect"], [class*="ant-select"], [class*="choices"]',
    );
    const idx = parseInt(elementId.replace("custom_select_", ""));
    if (!isNaN(idx) && idx < customSelects.length) el = customSelects[idx];
  }
  if (!el) return false;

  const valLower = value.toLowerCase();
  el.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
  );
  el.dispatchEvent(
    new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
  );
  el.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  el.dispatchEvent(new Event("focus", { bubbles: true }));

  const searchInput =
    el.querySelector<HTMLInputElement>("input") ||
    el.parentElement?.querySelector<HTMLInputElement>(
      'input[type="text"], input[role="combobox"]',
    );
  if (searchInput) {
    searchInput.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (nativeSetter) nativeSetter.call(searchInput, value);
    else searchInput.value = value;
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    searchInput.dispatchEvent(new Event("change", { bubbles: true }));
    searchInput.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: value }),
    );
  }

  setTimeout(() => clickMatchingOption(el!, valLower), 300);
  return true;
}

function clickMatchingOption(
  container: HTMLElement,
  valLower: string,
): boolean {
  const searchRoots = [
    container,
    container.parentElement,
    document.body,
  ].filter(Boolean) as HTMLElement[];

  let bestOpt: HTMLElement | null = null;
  let bestScore = 0;

  for (const root of searchRoots) {
    const optionEls = root.querySelectorAll<HTMLElement>(
      '[role="option"], [class*="option"], [class*="menu"] li, [class*="dropdown"] li, [class*="listbox"] > div',
    );
    for (const opt of Array.from(optionEls)) {
      const text = opt.textContent?.trim() || "";
      const valAttr = opt.getAttribute("data-value") || "";
      const score = scoreOptionMatch(text, valAttr, valLower);
      if (score > bestScore) {
        bestScore = score;
        bestOpt = opt;
      }
    }
    if (bestScore >= 50) break; // Found a good enough match in this root
  }

  if (bestOpt && bestScore >= 50) {
    bestOpt.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    bestOpt.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
    );
    bestOpt.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    console.log(
      `Aullevo custom select matched: ${bestOpt.textContent?.trim()} (score: ${bestScore})`,
    );
    return true;
  }

  return false;
}

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

export function findNextButton(): HTMLElement | null {
  // Always prefer scoping to active modal (LinkedIn Easy Apply, Workday, etc.)
  const activeModals = findActiveModals();
  const root =
    activeModals.length > 0
      ? activeModals[activeModals.length - 1]
      : document.body;

  const buttons = root.querySelectorAll<HTMLElement>(
    'button, input[type="submit"], input[type="button"], [role="button"], a.btn, a.button',
  );

  const NEXT_KEYWORDS = [
    "submit application",
    "review application",
    "next",
    "continue",
    "proceed",
    "review",
    "apply now",
    "easy apply",
    "save and continue",
    "save & continue",
    "next step",
    "next page",
  ];

  // Exclude back/cancel/close buttons
  const EXCLUDE_KEYWORDS = [
    "back",
    "cancel",
    "skip",
    "close",
    "dismiss",
    "sign in",
    "login",
  ];

  const candidates = Array.from(buttons).filter((btn) => {
    if (!isVisible(btn as HTMLElement)) return false;
    const text = (btn.textContent || (btn as HTMLInputElement).value || "")
      .trim()
      .toLowerCase();
    const ariaLabel = (btn.getAttribute("aria-label") || "")
      .trim()
      .toLowerCase();
    const combined = text || ariaLabel;
    if (!combined) return false;
    if (EXCLUDE_KEYWORDS.some((k) => combined === k || combined.startsWith(k)))
      return false;
    return NEXT_KEYWORDS.some(
      (keyword) => combined === keyword || combined.includes(keyword),
    );
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

export function findPrevButton(): HTMLElement | null {
  const activeModals = findActiveModals();
  const root =
    activeModals.length > 0
      ? activeModals[activeModals.length - 1]
      : document.body;

  const buttons = root.querySelectorAll<HTMLElement>(
    'button, input[type="button"], [role="button"], a.btn, a.button',
  );

  const PREV_KEYWORDS = [
    "back",
    "previous",
    "prev",
    "go back",
    "previous step",
    "previous page",
    "return",
  ];

  const EXCLUDE_KEYWORDS = [
    "next",
    "continue",
    "submit",
    "apply",
    "cancel",
    "close",
    "skip",
    "dismiss",
    "sign in",
    "login",
  ];

  const candidates = Array.from(buttons).filter((btn) => {
    if (!isVisible(btn as HTMLElement)) return false;
    const text = (btn.textContent || (btn as HTMLInputElement).value || "")
      .trim()
      .toLowerCase();
    const ariaLabel = (btn.getAttribute("aria-label") || "")
      .trim()
      .toLowerCase();
    const combined = text || ariaLabel;
    if (!combined) return false;

    // Check exclusions first
    if (
      EXCLUDE_KEYWORDS.some(
        (k) => combined === k || combined.startsWith(k) || combined.includes(k),
      )
    )
      return false;

    return PREV_KEYWORDS.some(
      (keyword) => combined === keyword || combined.includes(keyword),
    );
  });

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] as HTMLElement;

  // Multiple candidates: prefer bottommost + leftmost (standard Back button placement)
  const scored = candidates.map((btn) => {
    const rect = (btn as HTMLElement).getBoundingClientRect();
    // Prefer right at the bottom but more left aligned
    const score = rect.bottom - rect.left;
    return { btn, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].btn as HTMLElement;
}

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

/**
 * Extracts recent chat context from the DOM near a contenteditable input.
 */
export function extractChatContext(input: HTMLElement): string[] {
  const context: string[] = [];
  
  // Try to find the closest chat container
  const chatContainer = input.closest(
    '[role="log"], [role="main"], .chat-history, .message-list, [class*="chat"], [class*="message"]'
  ) || document.body;

  // Look for message bubbles
  const messageNodes = chatContainer.querySelectorAll(
    '[role="row"], .message, [class*="bubble"], [class*="message"]'
  );

  // Take the last 5 messages
  const recentMessages = Array.from(messageNodes).slice(-5);
  recentMessages.forEach((msg) => {
    const text = msg.textContent?.trim();
    if (text && text.length > 0 && text.length < 500) {
      context.push(text);
    }
  });

  return context;
}
