/**
 * Centralized constants, keywords, selectors, and regex patterns
 * used across the form analyzer submodules.
 */

// ─── CAPTCHA & Security Signals ───
export const CAPTCHA_SIGNALS = [
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
] as const;

export const HONEYPOT_KEYWORDS = [
  "honeypot",
  "spambot",
  "bot-check",
  "prevent-bot",
  "nobot",
  "fake-field",
  "contact_me_by_fax_only",
  "email_address_confirm",
] as const;

// ─── DOM Query Selectors ───
export const INTERACTIVE_INPUT_SELECTORS =
  "input, textarea, select, button, [contenteditable='true'], [role='textbox'], " +
  "[role='radio'], [role='checkbox'], [role='combobox'], [role='searchbox'], " +
  "[role='slider'], [role='spinbutton'], [role='grid'], [role='gridcell'], " +
  "[role='tree'], [role='treeitem']";

export const BROAD_INPUT_FALLBACK_SELECTORS =
  "input, textarea, select, button, [contenteditable], [role='textbox'], " +
  "div[class*='input' i], div[class*='field' i]";

export const CUSTOM_SELECT_SELECTORS = [
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
] as const;

export const TOGGLE_SELECTORS = [
  '[role="switch"]',
  ".toggle:not(input):not(button)",
  '[class*="toggle-switch"]',
] as const;

export const MODAL_SELECTORS = [
  '[role="dialog"]',
  ".modal",
  ".popup",
  ".dialog",
  ".artdeco-modal",
  '[aria-modal="true"]',
] as const;

export const DROPZONE_SELECTORS = [
  '[class*="dropzone"]',
  '[class*="file-upload"]',
  '[class*="upload-area"]',
  '[class*="drop-area"]',
  '[class*="drag-drop"]',
  '[class*="file-input"]',
  '[class*="attachment"]',
  '[data-testid*="upload"]',
  '[data-testid*="file"]',
] as const;

export const SEND_BUTTON_SELECTORS = [
  '[aria-label="Send"]',
  '[aria-label="Send message"]',
  '[aria-label="Press Enter to send"]',
  '[data-tooltip="Send"]',
  'path[d^="M16.6915"]',
] as const;

// ─── Navigation Button Keywords ───
export const NEXT_KEYWORDS = [
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
] as const;

export const NEXT_CLASS_ID_KEYWORDS = [
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
] as const;

export const PREV_KEYWORDS = [
  "back",
  "previous",
  "prev",
  "go back",
  "previous step",
  "previous page",
  "return",
] as const;

export const PREV_CLASS_ID_KEYWORDS = [
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
] as const;

export const NAVIGATION_EXCLUDE_KEYWORDS = [
  "back",
  "cancel",
  "skip",
  "close",
  "dismiss",
  "sign in",
  "login",
] as const;

export const PREV_EXCLUDE_KEYWORDS = [
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
] as const;

export const NEXT_ARROW_SYMBOLS = ["→", "▶", "›", ">", "»", "arrow"] as const;
export const PREV_ARROW_SYMBOLS = ["←", "◀", "‹", "<", "«"] as const;

// ─── Matching & Text Normalization ───
export const STOP_WORDS = new Set([
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

export const MONTH_NAMES_SHORT = [
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
] as const;

export const MONTH_NAMES_FULL = [
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
] as const;

export const EXPLICIT_TRUE_VALUES = new Set([
  "true",
  "yes",
  "y",
  "1",
  "checked",
  "on",
]);

export const EXPLICIT_FALSE_VALUES = new Set([
  "false",
  "no",
  "n",
  "0",
  "unchecked",
  "off",
  "disagree",
  "decline",
]);

export const DAY_REGEX =
  /^(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;

export const CJK_REGEX =
  /[\u3000-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\u{20000}-\u{2FA1F}]/u;
