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
   FORM FIELD EXTRACTION (with CAPTCHA skip)
   ═══════════════════════════════════════════════════ */

/**
 * Extracts all form fields from the current page, prioritizing visible and modal fields.
 * CAPTCHA fields are automatically detected and skipped.
 */
export function extractFormFields(): FormField[] {
  // Find all candidate label elements on the page once to cache their positions and text
  const labelCandidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      'label, .x-lbl, .label, [class*="label" i], [class*="lbl" i], [class*="title" i], span, div',
    ),
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

  const labelRects = labelCandidates
    .map((el) => {
      return {
        element: el,
        rect: el.getBoundingClientRect(),
        text: cleanLabelText(el.textContent || ""),
      };
    })
    .filter((item) => {
      return (
        item.rect.width > 0 && item.rect.height > 0 && item.text.length >= 2
      );
    });

  // 1. Select all inputs from the entire document
  // (Hidden inputs will be filtered out by the isVisible check below)
  const inputs = Array.from(
    document.body.querySelectorAll<HTMLElement>(
      "input, textarea, select, button, [contenteditable='true'], [role='textbox'], [role='radio'], [role='checkbox']",
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

    // ── HONEYPOT SKIP ──
    if (isHoneypot(input)) {
      console.log(
        "Aullevo: honeypot field detected — skipping:",
        input.id || input.getAttribute("name"),
      );
      return;
    }

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
    const isRadio =
      (input instanceof HTMLInputElement && input.type === "radio") ||
      input.getAttribute("role") === "radio";
    const isCheckbox =
      (input instanceof HTMLInputElement && input.type === "checkbox") ||
      input.getAttribute("role") === "checkbox";

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
        const groupLabel =
          findGroupLabel(input, labelRects) || findLabel(input, labelRects);
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
          required:
            (input as HTMLInputElement).required ||
            input.getAttribute("aria-required") === "true",
          context: context,
          section: section,
          options: [],
        });
      }

      const inputValue =
        (input as HTMLInputElement).value ||
        input.getAttribute("value") ||
        input.textContent?.trim() ||
        "on";
      const optionLabel = findLabel(input, labelRects) || inputValue;
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

    const isContentEditable =
      input.isContentEditable || input.getAttribute("role") === "textbox";
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
        : findLabel(input, labelRects),
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

  return fields;
}

// ─── All helpers below are unchanged from the original ───

function isVisible(element: HTMLElement): boolean {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  if (parseFloat(style.opacity || "1") === 0) return false;

  const rect = element.getBoundingClientRect();
  const isZeroSize = rect.width === 0 && rect.height === 0;

  const isFileInput = element instanceof HTMLInputElement && element.type === "file";
  if (isZeroSize && !isFileInput) return false;

  const isOffScreen =
    rect.right < -500 ||
    rect.bottom < -500 ||
    rect.left > window.innerWidth + 500 ||
    rect.top > window.innerHeight + 500;

  if (isOffScreen && style.position === "absolute" && !isFileInput) {
    return false;
  }

  if (element.offsetParent === null && style.position !== "fixed" && style.position !== "absolute") {
    let p = element.parentElement;
    let isNone = false;
    while (p) {
      const pStyle = window.getComputedStyle(p);
      if (pStyle.display === "none" || pStyle.visibility === "hidden" || parseFloat(pStyle.opacity || "1") === 0) {
        isNone = true;
        break;
      }
      p = p.parentElement;
    }
    if (isNone) return false;
  }

  if (element.getAttribute("aria-hidden") === "true") return false;

  let parent = element.parentElement;
  while (parent) {
    if (parent.getAttribute("aria-hidden") === "true") return false;
    parent = parent.parentElement;
  }

  return true;
}

function isHoneypot(element: HTMLElement): boolean {
  if (!element) return false;

  const HONEYPOT_KEYWORDS = [
    "honeypot",
    "spambot",
    "bot-check",
    "prevent-bot",
    "nobot",
    "fake-field",
    "contact_me_by_fax_only",
    "email_address_confirm",
  ];

  const name = (element.getAttribute("name") || "").toLowerCase();
  const id = (element.id || "").toLowerCase();
  const className = (element.className || "").toLowerCase();
  const autocomplete = (element.getAttribute("autocomplete") || "").toLowerCase();

  const isMatchedKeyword = HONEYPOT_KEYWORDS.some(
    (kw) => name.includes(kw) || id.includes(kw) || className.includes(kw),
  );
  if (isMatchedKeyword) return true;

  if (autocomplete === "nope" || autocomplete === "off-bot") return true;

  const style = window.getComputedStyle(element);
  if (style.position === "absolute") {
    const left = parseInt(style.left || "0", 10);
    const top = parseInt(style.top || "0", 10);
    const zIndex = parseInt(style.zIndex || "0", 10);
    if ((left < -100 || top < -100 || zIndex < -100) && (style.opacity === "0" || style.display === "none")) {
      return true;
    }
  }

  return false;
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

export function cleanLabelText(text: string): string {
  if (!text) return "";
  // Strip all newlines and carriage returns completely
  let cleaned = text.replace(/[\r\n]+/g, "");
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

  return cleaned;
}

function findVisualLabelForInput(
  input: HTMLElement,
  labelRects: Array<{ element: HTMLElement; rect: DOMRect; text: string }>,
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

    // 1. Above Layout: Label is above the input
    // Label's bottom is above input's top (with 5px buffer)
    const isAbove = labelRect.bottom <= inputRect.top + 5;
    const distYAbove = inputRect.top - labelRect.bottom;
    // Horizontal overlap or close alignment
    const overlapX =
      Math.min(labelRect.right, inputRect.right) -
      Math.max(labelRect.left, inputRect.left);
    const distXAbove = Math.abs(labelRect.left - inputRect.left);

    // 2. Left Layout: Label is to the left of the input
    // Label's right is to the left of input's left (with 5px buffer)
    const isLeft = labelRect.right <= inputRect.left + 5;
    const distXLeft = inputRect.left - labelRect.right;
    const distYLeft = Math.abs(labelCenterY - inputCenterY);

    // 3. Right Layout (mainly for checkboxes/radios)
    const isRight = labelRect.left >= inputRect.right - 5;
    const distXRight = labelRect.left - inputRect.right;
    const distYRight = Math.abs(labelCenterY - inputCenterY);

    let score = Infinity;

    if (isAbove && distYAbove < 120) {
      // Score based on vertical distance and horizontal alignment
      // We want to penalize horizontal misalignment
      const alignmentPenalty = overlapX > -10 ? distXAbove : distXAbove * 3;
      score = distYAbove + alignmentPenalty;
    } else if (isLeft && distXLeft < 250 && distYLeft < 30) {
      // Score based on horizontal distance and vertical alignment
      score = distXLeft + distYLeft * 2;
    } else if (isRight && distXRight < 150 && distYRight < 20) {
      // Score for checkboxes/radios
      score = distXRight + distYRight * 3;
    }

    if (score < minScore) {
      minScore = score;
      bestLabel = item.text;
    }
  }

  // Only return if the score is reasonably close
  return minScore < 150 ? bestLabel : "";
}

function findLabel(
  input: HTMLElement,
  labelRects?: Array<{ element: HTMLElement; rect: DOMRect; text: string }>,
): string {
  // 1. Direct ARIA attributes and placeholders (crucial for modern obfuscated forms like Facebook/Workday)
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

  const placeholder = input.getAttribute("placeholder");
  if (placeholder) {
    const cleaned = cleanLabelText(placeholder);
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

  // 2. Standard Label elements
  if (input.id) {
    const label = document.querySelector<HTMLLabelElement>(
      `label[for="${input.id}"]`,
    );
    if (label) return cleanLabelText(label.textContent || "");
  }
  const parentLabel = input.closest("label");
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    const innerInput = clone.querySelector("input, select, textarea");
    if (innerInput) innerInput.remove();
    return cleanLabelText(clone.textContent || "");
  }

  // 3. Attempt spatial/visual positioning label matching
  if (labelRects) {
    const visualLabel = findVisualLabelForInput(input, labelRects);
    if (visualLabel) return visualLabel;
  }

  // 4. Custom UI / Nested components parent scanning (e.g., Facebook login/register nested hierarchy)
  let el: HTMLElement | null = input;
  for (let i = 0; i < 5 && el; i++) {
    // Check all previous siblings of the current level
    let prev = el.previousElementSibling as HTMLElement;
    while (prev) {
      if (!prev.matches("input, select, textarea, button, form")) {
        const text = cleanLabelText(prev.textContent || "");
        if (text && text.length < 100 && text.length > 2) return text;
      }
      prev = prev.previousElementSibling as HTMLElement;
    }

    // Check descendants of parent if they are span/div/p that act as floating/placeholder labels
    if (el !== input) {
      const children = Array.from(el.querySelectorAll("span, p, div, label"));
      for (const child of children) {
        if (child !== input && !child.contains(input)) {
          const text = cleanLabelText(child.textContent || "");
          if (text && text.length < 100 && text.length > 2 && !child.querySelector("input, select, textarea")) {
            return text;
          }
        }
      }
    }
    el = el.parentElement;
  }

  const prevSibling = input.previousElementSibling;
  if (prevSibling && prevSibling.tagName === "LABEL") {
    return cleanLabelText(prevSibling.textContent || "");
  }
  if (
    prevSibling &&
    (prevSibling.tagName === "SPAN" || prevSibling.tagName === "DIV")
  ) {
    return cleanLabelText(prevSibling.textContent || "");
  }
  const describedBy = input.getAttribute("aria-describedby");
  if (describedBy) {
    const descEl = document.getElementById(describedBy);
    if (descEl && (descEl.textContent?.length || 0) < 80) {
      return cleanLabelText(descEl.textContent || "");
    }
  }

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
      return cleanLabelText(sibLabel.textContent || "");
    }
  }
  const cell = input.closest("td");
  if (cell) {
    const prevCell = cell.previousElementSibling;
    if (prevCell && (prevCell.tagName === "TD" || prevCell.tagName === "TH")) {
      if ((prevCell.textContent?.length || 0) < 50) {
        return cleanLabelText(prevCell.textContent || "");
      }
    }
  }
  return "";
}

function findGroupLabel(
  input: HTMLElement,
  labelRects?: Array<{ element: HTMLElement; rect: DOMRect; text: string }>,
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
      return cleanLabelText(labelEl.textContent || "");
    }
  }

  // Attempt spatial/visual positioning label matching
  if (labelRects) {
    const visualLabel = findVisualLabelForInput(input, labelRects);
    if (visualLabel) return visualLabel;
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
      return cleanLabelText(prevSib.textContent || "");
    }
  }

  return "";
}

export async function fillFormField(
  fieldIdentifier: FieldMapping,
  value: string | string[] | boolean,
  contextOpts?: {
    resumeFileData?: string;
    resumeFileName?: string;
    autoSubmit?: boolean;
  },
): Promise<boolean> {
  if (
    value === undefined ||
    value === null ||
    value === "[MANUAL_INPUT_NEEDED]"
  )
    return false;
  let input = document.getElementById(fieldIdentifier.id || "");
  let inputs: NodeListOf<Element> | null = null;

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

  // Fallback for Messenger/React chat boxes that strip IDs on re-render
  if (
    !input &&
    !inputs &&
    (fieldIdentifier.fieldType === "contenteditable" ||
      fieldIdentifier.fieldType === "custom_question")
  ) {
    input = document.querySelector(
      '[role="textbox"], [contenteditable="true"]',
    );
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
            "agree",
            "accept",
            "consent",
            "confirm",
          ].some((w) => String(value).toLowerCase().includes(w));
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
                fuzzyMatch(valStr, v) ||
                smartMatch(label, v) ||
                smartMatch(valStr, v),
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
        const isPositive = [
          "true",
          "yes",
          "on",
          "1",
          "checked",
          "agree",
          "accept",
          "consent",
          "confirm",
        ].some((w) => valLower.includes(w));
        setCheckboxState(input, isPositive);
      } else if (input.type === "file") {
        if (value === "FILE_UPLOAD") {
          if (fieldIdentifier.files && fieldIdentifier.files.length > 0) {
            return fillMultiFileInput(input, fieldIdentifier.files);
          }
          const fData = fieldIdentifier.fileData || contextOpts?.resumeFileData;
          const fName = fieldIdentifier.fileName || contextOpts?.resumeFileName;
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
      } else if (
        input.type === "date" ||
        fieldIdentifier.fieldType === "dateOfBirth" ||
        input.id.toLowerCase().includes("date") ||
        input.id.toLowerCase().includes("dob") ||
        input.name.toLowerCase().includes("date") ||
        input.name.toLowerCase().includes("dob") ||
        findLabel(input).toLowerCase().includes("date") ||
        findLabel(input).toLowerCase().includes("dob")
      ) {
        const valStr = String(value);
        const isoDate = parseDateString(valStr);
        if (isoDate) {
          let setVal = isoDate;
          if (input.type === "text") {
            setVal = formatDateForDisplay(isoDate);
          }

          const nativeSetter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(input),
            "value",
          )?.set;
          if (nativeSetter) {
            nativeSetter.call(input, setVal);
          } else {
            input.value = setVal;
          }
          triggerEvents(input);

          // For custom date pickers, if there is a sibling hidden input, fill that too!
          const container = input.closest(
            ".field-block, .form-group, .date-trigger-container, div",
          );
          if (container) {
            const hiddenInputs = container.querySelectorAll(
              'input[type="hidden"]',
            );
            hiddenInputs.forEach((hiddenInput) => {
              if (hiddenInput instanceof HTMLInputElement) {
                const hiddenSetter = Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  "value",
                )?.set;
                if (hiddenSetter) {
                  hiddenSetter.call(hiddenInput, isoDate);
                } else {
                  hiddenInput.value = isoDate;
                }
                hiddenInput.dispatchEvent(
                  new Event("input", { bubbles: true }),
                );
                hiddenInput.dispatchEvent(
                  new Event("change", { bubbles: true }),
                );
              }
            });
          }
        } else {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(input),
            "value",
          )?.set;
          if (nativeSetter) {
            nativeSetter.call(input, valStr);
          } else {
            input.value = valStr;
          }
          triggerEvents(input);
        }
      } else {
        const storage = await chrome.storage.local.get("stealthMode");
        const isStealth = storage.stealthMode !== false;
        if (isStealth) {
          await humanTypeValue(input, value as string);
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
      }
    } else if (input instanceof HTMLTextAreaElement) {
      const storage = await chrome.storage.local.get("stealthMode");
      const isStealth = storage.stealthMode !== false;
      if (isStealth) {
        await humanTypeValue(input, value as string);
      } else {
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
      }
    } else if (
      input.isContentEditable ||
      input.getAttribute("role") === "textbox"
    ) {
      // Modern chat automation (Messenger, Slack, etc.)
      const injected = fillChatInputField(input, value as string);

      const isError =
        String(value).includes("[Error") || String(value).includes("I'm sorry");

      if (injected && contextOpts?.autoSubmit && !isError) {
        setTimeout(() => {
          if (!input) return;
          submitChatField(input);
        }, 300);
      }
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
 * Helper to parse various date string formats and return standard YYYY-MM-DD.
 */
function parseDateString(str: string): string | null {
  if (!str) return null;
  const trimmed = str.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const monthNames = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const fullMonthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];

  let normalized = trimmed.toLowerCase();

  let monthIdx = -1;
  for (let i = 0; i < 12; i++) {
    if (
      normalized.includes(fullMonthNames[i]) ||
      normalized.includes(monthNames[i])
    ) {
      monthIdx = i;
      normalized = normalized
        .replace(fullMonthNames[i], ` ${i + 1} `)
        .replace(monthNames[i], ` ${i + 1} `);
      break;
    }
  }

  const parts = normalized
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length < 3) return null;

  let year = -1;
  let month = -1;
  let day = -1;

  const yearIdx = parts.findIndex((p) => p >= 1000 && p <= 9999);
  if (yearIdx !== -1) {
    year = parts[yearIdx];
    parts.splice(yearIdx, 1);
  } else {
    const lastPart = parts[parts.length - 1];
    if (lastPart < 100) {
      year = lastPart + (lastPart < 50 ? 2000 : 1900);
      parts.splice(parts.length - 1, 1);
    }
  }

  if (year === -1) return null;

  if (monthIdx !== -1) {
    month = monthIdx + 1;
    day = parts[0];
  } else {
    const [first, second] = parts;
    if (first > 12) {
      day = first;
      month = second;
    } else if (second > 12) {
      day = second;
      month = first;
    } else {
      day = first;
      month = second;
    }
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Format a YYYY-MM-DD date to a human readable display format like "November 20, 2003".
 */
function formatDateForDisplay(isoDate: string): string {
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  const year = parts[0];
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  if (month >= 1 && month <= 12) {
    return `${monthNames[month - 1]} ${day}, ${year}`;
  }
  return isoDate;
}

/**
 * Smart matching helper for checkbox labels/values.
 */
function smartMatch(label: string, value: string): boolean {
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

  const stopWords = new Set([
    "in",
    "of",
    "the",
    "a",
    "an",
    "to",
    "with",
    "do",
    "you",
    "how",
    "many",
    "have",
    "for",
    "and",
    "or",
    "is",
    "are",
    "what",
    "level",
    "your",
    "whether",
    "if",
  ]);

  const getWords = (str: string) =>
    str
      .replace(/[^a-z0-9\s]/gi, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stopWords.has(w));

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

    const isPositiveString =
      checkboxes.length === 1 &&
      [
        "true",
        "yes",
        "on",
        "1",
        "checked",
        "agree",
        "accept",
        "consent",
        "confirm",
      ].some((w) => String(value).toLowerCase().includes(w));

    const shouldCheck =
      isPositiveString ||
      valuesToCheck.some(
        (v) =>
          cbVal === v ||
          cbLabel === v ||
          cbLabel.includes(v) ||
          v.includes(cbLabel) ||
          fuzzyMatch(cbLabel, v) ||
          fuzzyMatch(cbVal, v) ||
          smartMatch(cbLabel, v) ||
          smartMatch(cbVal, v),
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

async function humanTriggerEvents(input: HTMLElement): Promise<void> {
  const rect = input.getBoundingClientRect();
  const x = rect.left + Math.random() * rect.width;
  const y = rect.top + Math.random() * rect.height;

  const eventOpts = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x + window.screenX,
    screenY: y + window.screenY,
  };

  input.dispatchEvent(new MouseEvent("mousedown", eventOpts));
  await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 50) + 15));

  input.dispatchEvent(new MouseEvent("mouseup", eventOpts));
  await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 30) + 10));

  input.click();
  await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 50) + 20));

  input.dispatchEvent(new Event("focus", { bubbles: true }));
  await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 50) + 10));
}

async function humanTypeValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  await humanTriggerEvents(input);
  await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 150) + 50));

  const nativeSetter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    "value",
  )?.set;
  if (nativeSetter) {
    nativeSetter.call(input, "");
  } else {
    input.value = "";
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));

  for (let i = 0; i < value.length; i++) {
    const char = value[i];

    const keydownEvent = new KeyboardEvent("keydown", {
      key: char,
      code: `Key${char.toUpperCase()}`,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(keydownEvent);

    const beforeInputEvent = new InputEvent("beforeinput", {
      data: char,
      inputType: "insertText",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(beforeInputEvent);

    const currentValue = input.value;
    const newValue = currentValue + char;
    if (nativeSetter) {
      nativeSetter.call(input, newValue);
    } else {
      input.value = newValue;
    }

    const inputEvent = new InputEvent("input", {
      data: char,
      inputType: "insertText",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(inputEvent);

    const keyupEvent = new KeyboardEvent("keyup", {
      key: char,
      code: `Key${char.toUpperCase()}`,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(keyupEvent);

    const delay = Math.floor(Math.random() * 55) + 20;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

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
    // 1. Dispatch events on the option element itself
    bestOpt.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    bestOpt.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
    );
    bestOpt.click(); // Trigger native click

    // 2. Dispatch events on the option's children (spans, divs) as listeners might be bound there
    const innerTextEl = bestOpt.querySelector("span, p, div");
    if (innerTextEl) {
      innerTextEl.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      innerTextEl.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
      );
      (innerTextEl as HTMLElement).click();
    }

    // 3. Fallback: Manually update display value & attributes for pure-CSS mockup dropdowns
    const displayTextEl =
      container.querySelector(
        '.current-value, [class*="value"], [class*="singleValue"], [class*="placeholder"]',
      ) ||
      container.querySelector("span") ||
      container;

    if (displayTextEl && displayTextEl !== bestOpt) {
      displayTextEl.textContent = bestOpt.textContent?.trim() || "";
    }

    // Update ARIA expand state
    container.setAttribute("aria-expanded", "false");

    // Clear other selections and mark this option as selected
    const siblingOptions = container.querySelectorAll(
      '[role="option"], [class*="option"]',
    );
    siblingOptions.forEach((opt) => {
      opt.setAttribute("aria-selected", "false");
    });
    bestOpt.setAttribute("aria-selected", "true");

    // Blur dropdown to close list (unfocuses pure CSS :focus-within dropdown menu)
    container.blur();
    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl && (container.contains(activeEl) || activeEl === container)) {
      activeEl.blur();
    }

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

    const classAndId = (
      String(btn.className || "") +
      " " +
      String(btn.id || "")
    ).toLowerCase();
    const combinedWithMeta = (combined + " " + classAndId).trim();

    if (
      EXCLUDE_KEYWORDS.some(
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

    // 2. Class/ID naming patterns (common next/continue class names)
    const matchesClassOrId = [
      "btn-next",
      "btn_next",
      "button-next",
      "button_next",
      "next-btn",
      "next_btn",
      "btn-continue",
      "btn_continue",
      "continue-btn",
      "continue_btn",
      "arrow-right",
      "arrowright",
      "arrow_right",
      "btn-submit",
      "submit-btn",
    ].some((term) => classAndId.includes(term));
    if (matchesClassOrId) return true;

    // 3. Arrow characters in text or aria-label
    const ARROW_SYMBOLS = ["→", "▶", "›", ">", "»", "arrow"];
    const matchesArrow = ARROW_SYMBOLS.some((symbol) =>
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

    const classAndId = (
      String(btn.className || "") +
      " " +
      String(btn.id || "")
    ).toLowerCase();
    const combinedWithMeta = (combined + " " + classAndId).trim();

    // Check exclusions first
    if (
      EXCLUDE_KEYWORDS.some(
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

    // 2. Class/ID naming patterns (common back/prev class names)
    const matchesClassOrId = [
      "btn-prev",
      "btn_prev",
      "button-prev",
      "button_prev",
      "prev-btn",
      "prev_btn",
      "btn-back",
      "btn_back",
      "back-btn",
      "back_btn",
      "arrow-left",
      "arrowleft",
      "arrow_left",
    ].some((term) => classAndId.includes(term));
    if (matchesClassOrId) return true;

    // 3. Arrow characters in text or aria-label
    const ARROW_SYMBOLS = ["←", "◀", "‹", "<", "«"];
    const matchesArrow = ARROW_SYMBOLS.some((symbol) =>
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
 * Detects if the current page has an active chat or email composition field.
 * Looks for modern rich text frameworks (Messenger, Gmail, Google Chat)
 */
export function findChatInputField(): HTMLElement | null {
  let active = document.activeElement as HTMLElement | null;
  if (
    active &&
    (active.isContentEditable ||
      active.getAttribute("role") === "textbox" ||
      active.tagName === "TEXTAREA")
  ) {
    return active;
  }
  return document.querySelector(
    '[contenteditable="true"][role="textbox"], [contenteditable="true"], textarea[placeholder*="message" i], textarea[placeholder*="reply" i]',
  ) as HTMLElement | null;
}

// export function fillChatInputField(el: HTMLElement | null, text: string): boolean {
//     // 1. Handle the null case safely (fixes the findChatInputField mismatch)
//     if (!el) {
//         console.warn("Aullevo: No chat input field found on this page.");
//         return false;
//     }

//     try {
//         el.focus();

//         // 2. Clear existing text based on the element type to prevent duplication
//         if (el.isContentEditable) {
//             el.innerHTML = '';
//         } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
//             el.value = '';
//         }

//         // 3. Inject text using execCommand (forces React/Draft.js to see it as a user action)
//         document.execCommand('insertText', false, text);

//         // 4. Dispatch events, bypassing TS strictness with 'as any'

//         // Standard event to wake up React's onChange handler
//         el.dispatchEvent(new Event('input', { bubbles: true }));

//         // Specific InputEvents to finalize the DOM update
//         el.dispatchEvent(new InputEvent('beforeinput', {
//             bubbles: true,
//             cancelable: true,
//             inputType: 'insertText',
//             data: text
//         } as any)); // <-- 'as any' silences the TS compiler error here

//         el.dispatchEvent(new InputEvent('input', {
//             bubbles: true,
//             cancelable: true,
//             inputType: 'insertText',
//             data: text
//         } as any));

//         return true;
//     } catch (error) {
//         console.error("Aullevo Modern Chat Injection Failure:", error);
//         return false;
//     }
// }

/**
 * Extracts recent chat context from the DOM near a contenteditable input.
 */
export function extractChatContext(input: HTMLElement): string[] {
  const context: string[] = [];

  // Find the closest parent chat container shell
  let chatContainer = input.closest(
    '[role="log"], [role="main"], [role="presentation"], .chat-history, .message-list, [class*="chat" i], [class*="message" i]',
  ) as HTMLElement | null;

  if (!chatContainer) chatContainer = document.body;

  // Look for historical text bubbles or rows containing messages
  let messageNodes = chatContainer.querySelectorAll(
    '[role="row"] [dir="auto"], [role="listitem"] [dir="auto"], .message, [class*="bubble" i], [class*="message-text" i], [data-message-id] div[dir="auto"], div[data-scope="message"]',
  );

  if (messageNodes.length === 0) {
    // Fallback for general divs that might be text
    messageNodes = chatContainer.querySelectorAll('div[dir="auto"]');
  }

  const validNodes = Array.from(messageNodes).filter((node) => {
    // Exclude the input field itself or its descendants
    if (input === node || input.contains(node) || node.contains(input))
      return false;

    const tagName = node.tagName.toLowerCase();
    // Exclude inputs
    if (
      tagName === "input" ||
      tagName === "textarea" ||
      node.getAttribute("contenteditable") === "true"
    )
      return false;

    const text = node.textContent?.trim() || "";
    // Exclude time stamps and metadata
    if (!text || text.length === 0) return false;
    if (text.match(/^[0-9]{1,2}:[0-9]{2}\s*[AP]M$/i)) return false;
    if (text.match(/^Active [0-9]+[mhd] ago$/i)) return false;
    if (text === "Seen" || text === "Delivered" || text === "Sent")
      return false;
    if (text.startsWith("You sent")) return false;

    const style = window.getComputedStyle(node);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    )
      return false;

    return true;
  });

  const recentNodes = validNodes.slice(-20);
  let lastText = "";

  recentNodes.forEach((node) => {
    const text = node.textContent?.trim();
    if (text && text !== lastText) {
      context.push(text);
      lastText = text;
    }
  });

  return context.slice(-10);
}

/**
 * Safely inserts the generated AI text response directly into state-driven chat components
 */
export function fillChatInputField(
  el: HTMLElement | null,
  text: string,
): boolean {
  // 1. Handle the null case safely (fixes the findChatInputField mismatch)
  if (!el) {
    console.warn("Aullevo: No chat input field found on this page.");
    return false;
  }

  try {
    el.focus();

    // 2. Clear existing text based on the element type to prevent duplication
    if (el.isContentEditable) {
      el.innerHTML = "";
    } else if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement
    ) {
      el.value = "";
    }

    // 3. Inject text using execCommand (forces React/Draft.js to see it as a user action)
    document.execCommand("insertText", false, text);

    // 4. Dispatch events, bypassing TS strictness with 'as any'

    // Standard event to wake up React's onChange handler
    el.dispatchEvent(new Event("input", { bubbles: true }));

    // Specific InputEvents to finalize the DOM update
    el.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      } as any),
    ); // <-- 'as any' silences the TS compiler error here

    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      } as any),
    );

    return true;
  } catch (error) {
    console.error("Aullevo Modern Chat Injection Failure:", error);
    return false;
  }
}

export function submitChatField(input: HTMLElement) {
  const keyOpts = {
    bubbles: true,
    cancelable: true,
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
  };
  input.dispatchEvent(new KeyboardEvent("keydown", keyOpts));
  input.dispatchEvent(new KeyboardEvent("keypress", keyOpts));
  input.dispatchEvent(new KeyboardEvent("keyup", keyOpts));

  const sendButtonSelectors = [
    '[aria-label="Send"]',
    '[aria-label="Send message"]',
    '[aria-label="Press Enter to send"]',
    '[data-tooltip="Send"]',
    'path[d^="M16.6915"]',
  ];
  for (const sel of sendButtonSelectors) {
    const btn = document.querySelector(sel);
    if (btn) {
      const clickTarget = btn.closest('div[role="button"], button') || btn;
      (clickTarget as HTMLElement).click();
      break;
    }
  }
}
