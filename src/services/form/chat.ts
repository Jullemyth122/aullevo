import { SEND_BUTTON_SELECTORS } from "./constants";

/**
 * Detects if the current page has an active chat or email composition field.
 * Looks for modern rich text frameworks (Messenger, Gmail, Google Chat, Slack).
 */
export function findChatInputField(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
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
    messageNodes = chatContainer.querySelectorAll('div[dir="auto"]');
  }

  const validNodes = Array.from(messageNodes).filter((node) => {
    if (input === node || input.contains(node) || node.contains(input))
      return false;

    const tagName = node.tagName.toLowerCase();
    if (
      tagName === "input" ||
      tagName === "textarea" ||
      node.getAttribute("contenteditable") === "true"
    )
      return false;

    const text = node.textContent?.trim() || "";
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
 * Safely inserts generated text directly into state-driven chat components (Messenger, Slack, etc.).
 */
export function fillChatInputField(
  el: HTMLElement | null,
  text: string,
): boolean {
  if (!el) {
    console.warn("Aullevo: No chat input field found on this page.");
    return false;
  }

  try {
    el.focus();

    if (el.isContentEditable) {
      el.innerHTML = "";
    } else if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement
    ) {
      el.value = "";
    }

    document.execCommand("insertText", false, text);

    el.dispatchEvent(new Event("input", { bubbles: true }));

    el.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      }),
    );

    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      }),
    );

    return true;
  } catch (error) {
    console.error("Aullevo Modern Chat Injection Failure:", error);
    return false;
  }
}

/**
 * Submits the chat field using Enter key events and send button clicking.
 */
export function submitChatField(input: HTMLElement): void {
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

  for (const sel of SEND_BUTTON_SELECTORS) {
    const btn = document.querySelector(sel);
    if (btn) {
      const clickTarget = btn.closest('div[role="button"], button') || btn;
      (clickTarget as HTMLElement).click();
      break;
    }
  }
}
