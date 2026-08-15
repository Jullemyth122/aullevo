import {
  DROPZONE_SELECTORS,
  EXPLICIT_TRUE_VALUES,
} from "./constants";
import {
  scoreOptionMatch,
  parseValueTokens,
  getOptionDescriptors,
  optionMatchesValue,
} from "./matchers";

/**
 * Universal helper to safely set check state for checkboxes or radios natively and in React
 */
export function setCheckboxState(
  input: HTMLInputElement,
  desiredState: boolean,
): void {
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

/**
 * Updates the custom radio state via ARIA attributes, classes, and click dispatch.
 */
export function setCustomRadioState(
  el: HTMLElement,
  desiredState: boolean,
): void {
  try {
    el.click();
  } catch (_e) {}
  if (desiredState) {
    el.setAttribute("aria-checked", "true");
    el.classList.add("selected", "checked", "active");
  } else {
    el.setAttribute("aria-checked", "false");
    el.classList.remove("selected", "checked", "active");
  }
  el.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Check if a select element has a non-empty value selected.
 */
export function select_was_filled(select: HTMLSelectElement): boolean {
  return select.value !== "" && select.selectedIndex > 0;
}

/**
 * Apply a select value using React-native property setter so state syncs correctly.
 */
export function applySelectValue(
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
 * Matches and selects the best option in a standard HTML <select> element.
 */
export function fillSelect(select: HTMLSelectElement, value: string): void {
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

/**
 * Finds associated radios in the row or by name and fills the matching one.
 */
export function fillRadio(radio: HTMLInputElement, value: string): boolean {
  const name = radio.name;
  let radios: (HTMLInputElement | HTMLElement)[] = [];

  const rowContainer = radio.closest(
    "tr, [role='row'], .row, [class*='matrix-row']",
  );
  if (rowContainer) {
    radios = Array.from(
      rowContainer.querySelectorAll<HTMLInputElement>(
        'input[type="radio"], [role="radio"]',
      ),
    );
  }

  if (radios.length === 0 && name) {
    radios = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        `input[type="radio"][name="${name}"]`,
      ),
    );
  }

  if (radios.length === 0) {
    radios = [radio];
  }

  return fillRadioGroup(radios, value);
}

/**
 * Fill a group of radio buttons found inside a container div or matrix row.
 */
export function fillRadioGroup(
  radios: (HTMLInputElement | HTMLElement)[] | NodeListOf<HTMLElement>,
  value: string | boolean | string[],
): boolean {
  const valuesToCheck = Array.isArray(value)
    ? value.flatMap((v) => parseValueTokens(String(v)))
    : typeof value === "boolean"
      ? [value ? "true" : "false"]
      : parseValueTokens(String(value));

  if (valuesToCheck.length === 0) return false;

  for (const radio of Array.from(radios)) {
    const descriptors = getOptionDescriptors(radio);

    const isMatch = valuesToCheck.some((valStr) =>
      optionMatchesValue(descriptors, valStr),
    );

    if (isMatch) {
      if (radio instanceof HTMLInputElement) {
        if (!radio.checked) {
          setCheckboxState(radio, true);
        }
      } else {
        setCustomRadioState(radio, true);
      }

      const parentLabel = radio.closest("label");
      if (parentLabel && !parentLabel.classList.contains("selected")) {
        const groupContainer = radio.closest(
          '.radio-group, [role="radiogroup"], fieldset, table, tbody, [role="row"], tr',
        );
        groupContainer
          ?.querySelectorAll("label")
          .forEach((l) => l.classList.remove("selected", "checked", "active"));
        parentLabel.classList.add("selected", "checked", "active");
      }
      return true;
    }
  }
  return false;
}

/**
 * Fill a group of checkboxes found inside a container div or matrix row.
 */
export function fillCheckboxGroup(
  checkboxes: (HTMLInputElement | HTMLElement)[] | NodeListOf<HTMLElement>,
  value: string | boolean | string[],
): boolean {
  const cbArray = Array.from(checkboxes);
  if (cbArray.length === 0) return false;

  let valuesToCheck: string[] = [];
  if (Array.isArray(value)) {
    valuesToCheck = value.flatMap((v) => parseValueTokens(String(v)));
  } else if (typeof value === "boolean") {
    valuesToCheck = value ? ["true", "on", "yes", "1"] : [];
  } else {
    valuesToCheck = parseValueTokens(String(value));
  }

  if (valuesToCheck.length === 0) return false;

  const valLower = String(value).toLowerCase().trim();
  const isExplicitTrueSingle =
    cbArray.length === 1 &&
    (EXPLICIT_TRUE_VALUES.has(valLower) ||
      /\b(agree|accept|consent|confirm)\b/i.test(valLower));

  let filledAny = false;
  for (const cb of cbArray) {
    const descriptors = getOptionDescriptors(cb);

    const shouldCheck =
      isExplicitTrueSingle ||
      valuesToCheck.some((valStr) =>
        optionMatchesValue(descriptors, valStr),
      );

    if (shouldCheck) {
      if (cb instanceof HTMLInputElement) {
        if (!cb.checked) {
          setCheckboxState(cb, true);
        }
        filledAny = true;
      } else {
        setCustomRadioState(cb, true);
        filledAny = true;
      }

      const parentLabel = cb.closest("label");
      if (parentLabel && !parentLabel.classList.contains("selected")) {
        parentLabel.classList.add("selected", "checked", "active");
      }
    } else {
      if (cb instanceof HTMLInputElement && cb.checked) {
        setCheckboxState(cb, false);
      } else if (!(cb instanceof HTMLInputElement)) {
        setCustomRadioState(cb, false);
      }
      const parentLabel = cb.closest("label");
      if (parentLabel) {
        parentLabel.classList.remove("selected", "checked", "active");
      }
    }
  }
  return filledAny;
}

/**
 * Fills a div-based toggle/switch element.
 */
export function fillToggle(
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
    el.click();
    el.setAttribute("aria-checked", String(shouldBeOn));
  }
  return true;
}

/**
 * Fill a div-based role="slider" element by setting aria-valuenow and
 * dispatching pointer/mouse events for drag simulation.
 */
export function fillAriaSlider(
  el: HTMLElement,
  value: string | boolean | string[],
): boolean {
  const numVal = Number(value);
  if (isNaN(numVal)) return false;

  const min = Number(el.getAttribute("aria-valuemin")) || 0;
  const max = Number(el.getAttribute("aria-valuemax")) || 100;
  const clamped = Math.max(min, Math.min(max, numVal));

  el.setAttribute("aria-valuenow", String(clamped));
  if (el.getAttribute("aria-valuetext") !== null) {
    el.setAttribute("aria-valuetext", String(clamped));
  }

  const rect = el.getBoundingClientRect();
  const ratio = (clamped - min) / (max - min || 1);
  const targetX = rect.left + ratio * rect.width;
  const targetY = rect.top + rect.height / 2;

  const pointerOpts = {
    bubbles: true,
    cancelable: true,
    clientX: targetX,
    clientY: targetY,
    pointerId: 1,
    pointerType: "mouse" as const,
    isPrimary: true,
    pressure: 0.5,
  };

  const thumb =
    el.querySelector<HTMLElement>(
      '[role="slider"], [class*="thumb"], [class*="handle"], [class*="knob"]',
    ) || el;

  thumb.dispatchEvent(new PointerEvent("pointerdown", pointerOpts));
  thumb.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX: targetX,
      clientY: targetY,
    }),
  );
  thumb.dispatchEvent(new PointerEvent("pointermove", pointerOpts));
  thumb.dispatchEvent(
    new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      clientX: targetX,
      clientY: targetY,
    }),
  );
  thumb.dispatchEvent(new PointerEvent("pointerup", pointerOpts));
  thumb.dispatchEvent(
    new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      clientX: targetX,
      clientY: targetY,
    }),
  );

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));

  console.log(
    `Aullevo aria-slider: set to ${clamped} (min=${min}, max=${max})`,
  );
  return true;
}

/**
 * Fill a div-based role="spinbutton" element by updating inner input or ARIA attributes.
 */
export function fillAriaSpinbutton(
  el: HTMLElement,
  value: string | boolean | string[],
): boolean {
  const numVal = Number(value);
  if (isNaN(numVal)) return false;

  const min = Number(el.getAttribute("aria-valuemin")) || -Infinity;
  const max = Number(el.getAttribute("aria-valuemax")) || Infinity;
  const clamped = Math.max(
    isFinite(min) ? min : -Infinity,
    Math.min(isFinite(max) ? max : Infinity, numVal),
  );

  const innerInput = el.querySelector<HTMLInputElement>(
    'input[type="text"], input[type="number"], input',
  );
  if (innerInput) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (nativeSetter) nativeSetter.call(innerInput, String(clamped));
    else innerInput.value = String(clamped);
    innerInput.dispatchEvent(new Event("input", { bubbles: true }));
    innerInput.dispatchEvent(new Event("change", { bubbles: true }));
  }

  el.setAttribute("aria-valuenow", String(clamped));
  if (el.getAttribute("aria-valuetext") !== null) {
    el.setAttribute("aria-valuetext", String(clamped));
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));

  console.log(`Aullevo aria-spinbutton: set to ${clamped}`);
  return true;
}

/**
 * Converts a data URL to a File instance.
 */
export function dataURLtoFile(dataurl: string, filename: string): File {
  const arr = dataurl.split(",");
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "";
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
}

/**
 * Injects single file into file input and dropzone containers.
 */
export function fillFileInput(
  input: HTMLInputElement,
  dataUrl: string,
  fileName: string,
): boolean {
  return fillMultiFileInput(input, [{ dataUrl, name: fileName }]);
}

/**
 * Injects multiple files into file input and dropzone containers.
 */
export function fillMultiFileInput(
  input: HTMLInputElement,
  files: { dataUrl: string; name: string }[],
): boolean {
  try {
    const dt = new DataTransfer();
    for (const fileInfo of files) {
      const file = dataURLtoFile(fileInfo.dataUrl, fileInfo.name);
      dt.items.add(file);
    }

    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));

    let dropzone: HTMLElement | null = null;
    for (const sel of DROPZONE_SELECTORS) {
      dropzone = input.closest(sel) as HTMLElement | null;
      if (dropzone) break;
    }

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

/**
 * Clicks the best matching option inside an opened custom select container.
 */
export function clickMatchingOption(
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
    if (bestScore >= 50) break;
  }

  if (bestOpt && bestScore >= 50) {
    bestOpt.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    bestOpt.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
    );
    bestOpt.click();

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

    const displayTextEl =
      container.querySelector(
        '.current-value, [class*="value"], [class*="singleValue"], [class*="placeholder"]',
      ) ||
      container.querySelector("span") ||
      container;

    if (displayTextEl && displayTextEl !== bestOpt) {
      displayTextEl.textContent = bestOpt.textContent?.trim() || "";
    }

    container.setAttribute("aria-expanded", "false");

    const siblingOptions = container.querySelectorAll(
      '[role="option"], [class*="option"]',
    );
    siblingOptions.forEach((opt) => {
      opt.setAttribute("aria-selected", "false");
    });
    bestOpt.setAttribute("aria-selected", "true");

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

/**
 * Fills custom div-based selects (e.g. React-Select, MUI, Ant Design).
 */
export function fillCustomSelect(elementId: string, value: string): boolean {
  let el = document.getElementById(elementId);
  if (!el) el = document.querySelector(`[data-testid="${elementId}"]`);
  if (!el) {
    const customSelects = document.querySelectorAll<HTMLElement>(
      '[role="combobox"], [role="listbox"], [class*="react-select"], [class*="select__control"], [class*="MuiSelect"], [class*="ant-select"], [class*="choices"]',
    );
    const idx = parseInt(elementId.replace("custom_select_", ""), 10);
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
