import { findElementByIdOrSelector } from "./domUtils";
import { CJK_REGEX } from "./constants";

/**
 * Dispatches standard focus, pointer, mouse, key, input, change, and blur events
 * on an input to ensure reactive state updates in frameworks like React, Vue, Angular.
 */
export function triggerEvents(input: HTMLElement): void {
  input.dispatchEvent(new Event("focus", { bubbles: true }));

  // Pointer & Mouse events
  input.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
  );
  input.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
  );
  input.dispatchEvent(
    new PointerEvent("pointerup", { bubbles: true, cancelable: true }),
  );
  input.dispatchEvent(
    new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
  );
  input.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
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
 * Simulates human-like pointer interactions with random jitter and delays.
 */
export async function humanTriggerEvents(input: HTMLElement): Promise<void> {
  const rect = input.getBoundingClientRect();
  const x = rect.left + Math.random() * rect.width;
  const y = rect.top + Math.random() * rect.height;

  const mouseOpts = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x + window.screenX,
    screenY: y + window.screenY,
  };

  const pointerOpts = {
    ...mouseOpts,
    pointerId: 1,
    pointerType: "mouse" as const,
    isPrimary: true,
    width: 1,
    height: 1,
    pressure: 0.5,
  };

  input.dispatchEvent(new PointerEvent("pointerdown", pointerOpts));
  input.dispatchEvent(new MouseEvent("mousedown", mouseOpts));
  await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 50) + 15));

  input.dispatchEvent(new PointerEvent("pointerup", pointerOpts));
  input.dispatchEvent(new MouseEvent("mouseup", mouseOpts));
  await new Promise((r) => setTimeout(r, 5));

  input.click();
  await new Promise((r) => setTimeout(r, 5));

  input.dispatchEvent(new Event("focus", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 5));
}

/**
 * Types a string character-by-character simulating human keystrokes,
 * handling CJK composition, React/Vue synthetic events, and DOM re-binding.
 */
export async function humanTypeValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  const targetId = input.id;
  await humanTriggerEvents(input);
  await new Promise((r) => setTimeout(r, 5));

  let currentEl: HTMLInputElement | HTMLTextAreaElement = input;

  const getSetter = (el: HTMLElement) =>
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;

  let nativeSetter = getSetter(currentEl);
  if (nativeSetter) {
    nativeSetter.call(currentEl, "");
  } else {
    currentEl.value = "";
  }
  currentEl.dispatchEvent(new Event("input", { bubbles: true }));

  // Detect CJK characters
  const hasCJK = CJK_REGEX.test(value);
  if (hasCJK) {
    currentEl.dispatchEvent(
      new CompositionEvent("compositionstart", {
        bubbles: true,
        cancelable: true,
        data: "",
      }),
    );
  }

  // Type character by character with DOM re-binding
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    const isLastChar = i === value.length - 1;

    // Re-bind element if React state update unmounted/replaced the DOM node
    if (!currentEl.isConnected && targetId) {
      const freshEl = findElementByIdOrSelector(targetId) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null;
      if (freshEl) {
        currentEl = freshEl;
        nativeSetter = getSetter(currentEl);
      }
    }

    const isCJKChar = CJK_REGEX.test(char);

    const keydownEvent = new KeyboardEvent("keydown", {
      key: isCJKChar ? "Process" : char,
      code: isCJKChar ? "" : `Key${char.toUpperCase()}`,
      bubbles: true,
      cancelable: true,
      ...(isCJKChar ? { keyCode: 229, which: 229 } : {}),
    });
    currentEl.dispatchEvent(keydownEvent);

    if (isCJKChar && hasCJK) {
      currentEl.dispatchEvent(
        new CompositionEvent("compositionupdate", {
          bubbles: true,
          cancelable: true,
          data: char,
        }),
      );
    }

    const beforeInputEvent = new InputEvent("beforeinput", {
      data: char,
      inputType: isCJKChar ? "insertCompositionText" : "insertText",
      bubbles: true,
      cancelable: true,
    });
    currentEl.dispatchEvent(beforeInputEvent);

    const currentValue = currentEl.value;
    const newValue = currentValue + char;
    if (nativeSetter) {
      nativeSetter.call(currentEl, newValue);
    } else {
      currentEl.value = newValue;
    }

    const inputEvent = new InputEvent("input", {
      data: char,
      inputType: isCJKChar ? "insertCompositionText" : "insertText",
      bubbles: true,
      cancelable: true,
    });
    currentEl.dispatchEvent(inputEvent);

    const nextIsCJK = !isLastChar && CJK_REGEX.test(value[i + 1]);
    if (isCJKChar && hasCJK && (isLastChar || !nextIsCJK)) {
      currentEl.dispatchEvent(
        new CompositionEvent("compositionend", {
          bubbles: true,
          cancelable: true,
          data: char,
        }),
      );
    }

    if (!isCJKChar && !isLastChar && nextIsCJK) {
      currentEl.dispatchEvent(
        new CompositionEvent("compositionstart", {
          bubbles: true,
          cancelable: true,
          data: "",
        }),
      );
    }

    const keyupEvent = new KeyboardEvent("keyup", {
      key: isCJKChar ? "Process" : char,
      code: isCJKChar ? "" : `Key${char.toUpperCase()}`,
      bubbles: true,
      cancelable: true,
    });
    currentEl.dispatchEvent(keyupEvent);
  }

  // Final verification: ensure complete string value is in input
  if (currentEl.value !== value) {
    if (nativeSetter) {
      nativeSetter.call(currentEl, value);
    } else {
      currentEl.value = value;
    }
    currentEl.dispatchEvent(new Event("input", { bubbles: true }));
  }

  currentEl.dispatchEvent(new Event("change", { bubbles: true }));
  currentEl.dispatchEvent(new Event("blur", { bubbles: true }));
}
