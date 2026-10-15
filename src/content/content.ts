import type { ProfileFile } from "../types";
import type { PaginationBlocker, PaginationStepResult } from "../services/pagination";
import CONTENT_EN from "../i18n/en/content.json";
import {
    cleanText, computeStringSimilarity, getFieldLabelAliases, coversLabelInLongQuestion,
    FORMAT_HINT_RE, titleNeedsWriting, questionCoverage, INSTANT_FILL_SCORE, QUESTION_EXPLAINED
} from "./matching";
import { matchTargets, questionPosition } from "./target";

// Keep in sync with TRUSTED_WEB_ORIGINS in services/account.ts.
// (Duplicated on purpose: importing a runtime module shared with background.ts would make Vite
// emit a shared chunk + `import` statement, which breaks classic content scripts.)
const TRUSTED_WEB_ORIGINS = import.meta.env.MODE === "development"
    ? ["https://aullevo.com", "https://www.aullevo.com", "https://aullevo-web.vercel.app", "http://localhost:5173", "http://127.0.0.1:5173"]
    : ["https://aullevo.com", "https://www.aullevo.com", "https://aullevo-web.vercel.app"];

console.log("[Aullevo] Content script loaded on:", window.location.href);

// Texts shown on web pages, in the UI language picked in the side panel.
// English is built in; other languages come from background.ts (this classic script can't import the panel's i18n).
// Keep LANGUAGE_STORAGE_KEY in sync with i18n/languages.ts.
const LANGUAGE_STORAGE_KEY = "aullevo_language";
type ContentMessages = Record<string, string | Record<string, string>>;
let contentLanguage = "en";
let contentMessages: ContentMessages = {};

function loadContentStrings(): void {
    chrome.runtime.sendMessage({ action: "GET_CONTENT_STRINGS" })
        .then((res) => {
            if (!res) return;
            contentLanguage = res.language || "en";
            contentMessages = res.messages || {};
            const trigger = document.getElementById("aullevo-floating-trigger");
            if (trigger) trigger.title = ct("openSidebar");
        })
        .catch(() => { /* extension reloaded: keep English */ });
}
loadContentStrings();
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[LANGUAGE_STORAGE_KEY]) loadContentStrings();
});

function ct(key: keyof typeof CONTENT_EN, vars?: Record<string, string | number>): string {
    const pick = (source: ContentMessages, lang: string): string | undefined => {
        const entry = source[key];
        if (typeof entry === "string") return entry;
        if (entry && typeof vars?.count === "number") {
            let category = "other";
            try { category = new Intl.PluralRules(lang).select(vars.count); } catch { /* unknown locale */ }
            return entry[category] ?? entry.other;
        }
        return undefined;
    };
    const text = pick(contentMessages, contentLanguage) ?? pick(CONTENT_EN as ContentMessages, "en") ?? key;
    return text.replace(/\{(\w+)\}/g, (m, name: string) => (vars?.[name] !== undefined ? String(vars[name]) : m));
}

// One live copy per frame: background.ts re-injects content.js into open tabs on install/reload,
// which can land on top of the manifest's copy. Two copies would fill the same form at once and
// type over each other, so the newest copy answers and older ones stand down.
// The token lives in this function's scope: top-level bindings are shared by every copy in the frame.
type MessageHandler = (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => boolean;
function listenAsNewestCopy(handler: MessageHandler) {
    const token = {};
    (globalThis as any).__aullevoInstance = token;
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) =>
        (globalThis as any).__aullevoInstance === token ? handler(message, sender, sendResponse) : false);
}

// LAYER 1: Message Listener (Ready for triggers from background/sidepanel)

let isHighlightsActive = false;

listenAsNewestCopy((message, _sender, _sendResponse) => {
    console.log("[Aullevo] Message received:", message?.action);

    // 1. Toggle Highlighting ON / OFF
    if (message.action === "TOGGLE_HIGHLIGHT_FIELDS") {
        const result = togglePageHighlights();
        // Only send response if this is the main page OR if this frame found elements
        if (window === window.top || result.count > 0) {
            _sendResponse(result);
        }
        return false;
    }

    // 2. Ready for future actions (e.g., RESCAN, FILL_FORM_FIELDS)
    if (message.action === "RESCAN") {
        const harvested = harvestAllControls();
        const activeUploads = harvestActiveFileInputs();
        const totalCount = harvested.length + activeUploads.length;

        if (window === window.top || totalCount > 0) {
            _sendResponse({
                success: true,
                fieldsCount: totalCount,
                isHighlighting: isHighlightsActive
            });
        }
        return false;
    }


    // 3. Injection of the form fields
    if (message.action === "INJECT_FORM_FIELDS") {
        const speed = message.typingSpeed !== undefined ? message.typingSpeed : "human";
        fillCancelled = false;
        whileFilling(() => fillPage(message.fields || [], Boolean(message.useAi), speed, message.files || [], message.target))
            .then((result) => _sendResponse(result))
            .catch(err => {
                console.error("[InjectToGoogle] Form injection error:", err);
                _sendResponse({ success: false, error: err.message });
            });
        return true;
    }

    // 4. Auto-pagination (Pro): background.ts picked this frame and drives one page per message
    if (message.action === "AUTO_PAGINATE_STEP") {
        const speed = message.typingSpeed !== undefined ? message.typingSpeed : "human";
        fillCancelled = false;
        whileFilling(() => runPaginationStep(message.fields || [], Boolean(message.useAi), speed, message.files || [], message.advance !== false))
            .then((result) => _sendResponse(result))
            .catch(err => {
                console.error("[Aullevo] Auto-pagination step error:", err);
                _sendResponse({ success: false, error: err.message, pagination: { status: "error" } });
            });
        return true;
    }

    // 5. Voice agent: "stop" while filling. The fill ends at the next answer it would have typed.
    if (message.action === "CANCEL_FILL") {
        fillCancelled = true;
        return false;
    }

    // 6. Voice agent: the form's questions in page order, so the AI can pick which ones the user means
    if (message.action === "LIST_VOICE_QUESTIONS") {
        _sendResponse({ questions: listVoiceQuestions() });
        return false;
    }

    // 7. Voice agent: "next" / "submit" clicks the form's button once, without filling
    if (message.action === "ADVANCE_PAGE") {
        advancePage(Boolean(message.submit))
            .then((result) => _sendResponse(result))
            .catch(err => _sendResponse({ action: "none", error: err.message }));
        return true;
    }

    // 8. A fill started with the keyboard shortcut or from Multi-link: how it went (there is no side panel to say it)
    if (message.action === "SHOW_RUN_NOTICE") {
        if (window === window.top) showRunNotice(String(message.text || ""), String(message.type || "info"));
        return false;
    }

    return false;
});

// Set by CANCEL_FILL; every fill message starts with it cleared
let fillCancelled = false;

// ---------------------------------------------------------------------------
// Voice agent: "fill this one" means the question last clicked or typed in on the page, or, after
// scrolling, the one in the middle of the screen (ported from Autonoma). Times are Date.now() so
// background.ts can tell which frame the user touched last.
// ---------------------------------------------------------------------------
const VOICE_FIELD_SELECTOR = "input, textarea, select, [role='combobox'], [role='radio'], [role='checkbox'], [role='textbox'], [contenteditable='true']";
let lastFocused: HTMLElement | null = null, lastFocusedAt = 0;
let lastPointer: Element | null = null, lastPointerAt = 0, lastScrollAt = 0;
// Aullevo's own typing and scrolling are not the user pointing at something: ignored while a fill runs, and
// for a moment after (a smooth scroll keeps going)
let fillsRunning = 0, fillEndedAt = 0;
const userActing = () => fillsRunning === 0 && Date.now() - fillEndedAt > 1500;
async function whileFilling<T>(work: () => Promise<T>): Promise<T> {
    fillsRunning++;
    try {
        return await work();
    } finally {
        fillsRunning--;
        fillEndedAt = Date.now();
    }
}
document.addEventListener("focusin", (event) => {
    const el = event.composedPath()[0];
    if (userActing() && el instanceof HTMLElement && el.matches(VOICE_FIELD_SELECTOR)) { lastFocused = el; lastFocusedAt = Date.now(); }
}, true);
document.addEventListener("pointerdown", (event) => {
    const el = event.composedPath()[0];
    if (event.isTrusted && el instanceof Element) { lastPointer = el; lastPointerAt = Date.now(); }
}, true);
addEventListener("scroll", () => { if (userActing()) lastScrollAt = Date.now(); }, { capture: true, passive: true });
(globalThis as any).__aullevoLastInteraction = () => Math.max(lastFocusedAt, lastPointerAt);

// ---------------------------------------------------------------------------
// Account sync: relay aullevo-web's sign-in token to background.ts
// (background verifies it against Firestore; nothing here is trusted as-is)
// ---------------------------------------------------------------------------

if (window === window.top && TRUSTED_WEB_ORIGINS.includes(window.location.origin)) {
    const origin = window.location.origin;

    window.addEventListener("message", (event) => {
        if (event.source !== window || event.origin !== origin) return;
        const data = event.data;
        // aullevo-web/rewards: an ad finished; background.ts fetches the new unlock from the server itself
        if (data?.type === "AULLEVO_REWARD_GRANTED") {
            if (chrome.runtime?.id) chrome.runtime.sendMessage({ action: "REWARD_GRANTED" }).catch(() => { });
            return;
        }
        if (data?.type !== "AULLEVO_WEB_AUTH" || typeof data.idToken !== "string") return;
        if (!chrome.runtime?.id) return; // extension reloaded; page needs a refresh

        chrome.runtime.sendMessage({ action: "WEB_AUTH_SYNC", idToken: data.idToken }, (res) => {
            const error = chrome.runtime.lastError?.message || (res?.success ? undefined : res?.error || "No response from extension.");
            console.log("[Aullevo] Account sync:", error ? error : "connected");
            // Tell the website the real result (drives its "Extension License HUD")
            window.postMessage({ type: "AULLEVO_EXTENSION_STATUS", success: !error, isPro: Boolean(res?.isPro), error }, origin);
        });
    });

    // Handshake: ask the website to (re)send the sign-in token now that we're listening
    window.postMessage({ type: "AULLEVO_EXTENSION_READY" }, origin);
}

/**
 * Temporary toggle function (We will build the real DOM logic in Step 2 & 3!)
 */

function togglePageHighlights() {
    isHighlightsActive = !isHighlightsActive;
    console.log("[Aullevo] Highlighting toggled. Current state:", isHighlightsActive);

    let foundCount = 0;

    if (isHighlightsActive) {
        // clear any existing highlights first to be clean.
        clearAllHighlights();

        // find all form inputs + active file dropzones
        const harvested = harvestAllControls();
        const activeUploads = harvestActiveFileInputs();
        foundCount = harvested.length + activeUploads.length;

        // apply outlines and badges to inputs AND visible dropzone containers!
        const allElementsToHighlight = [
            ...harvested.map(h => h.control),
            ...activeUploads.map(u => u.container)
        ];
        applyHighlightsToElements(allElementsToHighlight);
        console.log(`[Aullevo] Ready to highlight ${foundCount} elements (including ${activeUploads.length} file dropzones)!`);

    } else {

        // remove all outlines and badges.
        clearAllHighlights();
        // The fields are still there: the side panel keeps showing their count
        foundCount = harvestAllControls().length + harvestActiveFileInputs().length;

        console.log("[Aullevo] Highlights cleared.");
    }
    return {
        active: isHighlightsActive,
        count: foundCount // Will return the real element count in Step 2
    };
}

// ---------------------------------------------------------------------------
// Floating Webpage Icon to Activate Sidebar

function createFloatingSidebarTrigger() {
    // Only the top-level page gets the button (content script also runs in ads, embeds, captchas)
    if (window !== window.top) return;
    if (!document.body) return;

    // Avoid creating duplicates if already on page
    if (document.getElementById("aullevo-floating-trigger")) return;

    const triggerBtn = document.createElement("button");
    triggerBtn.id = "aullevo-floating-trigger";
    triggerBtn.title = ct("openSidebar");
    const iconUrl = chrome.runtime.getURL("icons/icon128.png");
    triggerBtn.innerHTML = `
        <img src="${iconUrl}" alt="Aullevo" width="24" height="24" style="display:block; object-fit:contain; pointer-events:none;" />
    `;

    // Modern floating tab docked on right edge with clean white background
    triggerBtn.style.cssText = `
        position: fixed;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        z-index: 2147483647;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-right: none;
        border-radius: 10px 0 0 10px;
        width: 42px;
        height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        padding: 0;
        box-shadow: -3px 4px 16px rgba(0, 0, 0, 0.12), -1px 1px 4px rgba(0, 0, 0, 0.05);
        transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s ease, background 0.2s ease;
    `;

    triggerBtn.addEventListener("mouseenter", () => {
        triggerBtn.style.transform = "translateY(-50%) scale(1.08) translateX(-2px)";
        triggerBtn.style.boxShadow = "-5px 6px 20px rgba(0, 0, 0, 0.18), -2px 2px 6px rgba(0, 0, 0, 0.08)";
        triggerBtn.style.background = "#f8fafc";
    });

    triggerBtn.addEventListener("mouseleave", () => {
        triggerBtn.style.transform = "translateY(-50%) scale(1) translateX(0)";
        triggerBtn.style.boxShadow = "-3px 4px 16px rgba(0, 0, 0, 0.12), -1px 1px 4px rgba(0, 0, 0, 0.05)";
        triggerBtn.style.background = "#ffffff";
    });

    // When clicked, message background.ts to open the native side panel
    triggerBtn.addEventListener("click", () => {
        // If extension was reloaded and tab is orphaned, warn and reload cleanly
        if (!chrome.runtime?.id) {
            console.warn("[Aullevo] Extension was updated. Reloading page...");
            window.location.reload();
            return;
        }

        chrome.runtime.sendMessage({ action: "OPEN_SIDE_PANEL" });
    });


    document.body.appendChild(triggerBtn);
}

// Helper to remove trigger button from DOM
function removeFloatingSidebarTrigger() {
    const existing = document.getElementById("aullevo-floating-trigger");
    if (existing) existing.remove();
}

// Initialize floating trigger based on user preference in storage
function initFloatingSidebarTrigger() {
    chrome.storage?.local?.get(['aullevo_show_floating_icon'], (res) => {
        // If explicitly set to false, don't show the button
        if (res?.aullevo_show_floating_icon === false) {
            removeFloatingSidebarTrigger();
        } else {
            createFloatingSidebarTrigger();
        }
    });
}

// React in real-time if the user toggles the setting in the Side Panel
chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes.aullevo_show_floating_icon !== undefined) {
        if (changes.aullevo_show_floating_icon.newValue === false) {
            removeFloatingSidebarTrigger();
        } else {
            createFloatingSidebarTrigger();
        }
    }
});

// Inject button once DOM is ready (respecting settings)
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFloatingSidebarTrigger);
} else {
    initFloatingSidebarTrigger();
}

// Layer 2: Universal Element Harvester (Google Forms + React + Vue + HTML5)

// Checks if an element is actually visible to user screen
// prevents highlighting hidden inputs, zero height wrappers, or invisibile dropdowns.
function isVisible(el: HTMLElement): boolean {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
    }
    return !(el as any).disabled;
}

function isElementVisible(el: HTMLElement): boolean {
    if (!el || (el as any).disabled) return false;

    // Check type attribute safely
    const inputType = el.getAttribute("type") || (el as HTMLInputElement).type || "";
    if (inputType.toLowerCase() === "hidden") return false;

    // 1. Direct standard visibility check
    if (isVisible(el)) return true;

    // 2. For native inputs, checkboxes, radios, selects, textareas:
    // Check if the element is in an active DOM container (handles opacity:0 / width:0 / custom checkbox frameworks)
    if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.getAttribute("role") === "checkbox" || el.getAttribute("role") === "radio") {
        const style = window.getComputedStyle(el);
        if (style.display === "none") {
            // If element is display:none, check if an explicit label[for="id"] is visible on page
            if (el.id) {
                try {
                    const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
                    if (lbl && isVisible(lbl as HTMLElement)) return true;
                } catch { }
            }
            return false;
        }

        // Check if parent container is visible
        const parent = el.closest("label, div, li, tr, fieldset, form, [role='listitem'], [role='group']");
        if (parent && isVisible(parent as HTMLElement)) {
            return true;
        }
    }

    return false;
}

// Helper to pierce both open and closed shadow roots using Chrome's extension API
function getElementShadowRoot(el: Element): ShadowRoot | null {
    try {
        return (chrome as any).dom?.openOrClosedShadowRoot?.(el) || el.shadowRoot || null;
    } catch {
        return el.shadowRoot || null;
    }
}

/**
 * Recursively discovers all Document and ShadowRoot boundaries on the page,
 * piercing through open AND closed shadow roots (e.g. Cloudflare Ray ID pages).
 */
function getAllDOMRoots(rootNode: Node = document.documentElement): (Document | ShadowRoot)[] {
    const roots: (Document | ShadowRoot)[] = [document];
    const visited = new Set<Node>();

    function traverse(node: Node) {
        if (!node || visited.has(node)) return;
        visited.add(node);

        if (node instanceof Element) {
            const shadow = getElementShadowRoot(node);
            if (shadow && !roots.includes(shadow)) {
                roots.push(shadow);
                Array.from(shadow.children).forEach((child) => traverse(child));
            }
        }

        if (node.childNodes) {
            Array.from(node.childNodes).forEach((child) => traverse(child));
        }
    }

    if (rootNode) {
        traverse(rootNode);
    }
    return roots;
}

/**
 * Computes similarity between a field value and a radio/checkbox choice option text
 */
export function computeChoiceMatchScore(targetVal: string, choiceText: string): number {
    if (!targetVal || !choiceText) return 0;

    const normTarget = cleanText(targetVal);
    const normChoice = cleanText(choiceText);
    if (!normTarget || !normChoice) return 0;

    // 1. Exact match
    if (normTarget === normChoice) return 1.0;

    // 1.5 Whitespace-stripped match (e.g. "Sample2" vs "Sample 2", "Part-time" vs "Part time")
    if (normTarget.replace(/\s+/g, '') === normChoice.replace(/\s+/g, '')) return 0.98;

    // 2. Phrase containment (Option-Driven Matching)
    if (normChoice.length >= 3 && normTarget.includes(normChoice)) {
        return 0.95;
    }
    if (normTarget.length >= 3 && normChoice.includes(normTarget)) {
        return 0.92;
    }

    // 3. Direct digit match for rating scales/stars/Likert (handles attached digits like "Sample2")
    const targetDigit = normTarget.match(/\d+/)?.[0];
    const choiceDigit = normChoice.match(/\d+/)?.[0];
    if (targetDigit && choiceDigit && targetDigit === choiceDigit) {
        // If both contain the exact same digit and share words or stem
        const targetWithoutNum = normTarget.replace(/\d+/g, '').trim();
        const choiceWithoutNum = normChoice.replace(/\d+/g, '').trim();
        if (!targetWithoutNum || !choiceWithoutNum || computeStringSimilarity(targetWithoutNum, choiceWithoutNum) >= 0.50) {
            return 0.96;
        }
    }

    // 4. Token overlap fallback
    const targetTokens = new Set(normTarget.split(/\s+/).filter(t => t.length > 0));
    const choiceTokens = new Set(normChoice.split(/\s+/).filter(t => t.length > 0));

    if (targetTokens.size > 1 && choiceTokens.size > 1) {
        let matchCount = 0;
        for (const t of targetTokens) {
            if (choiceTokens.has(t)) matchCount++;
        }
        const sim = matchCount / Math.max(targetTokens.size, choiceTokens.size);
        if (sim >= 0.70) return 0.85 + (0.15 * sim);
    }

    // 5. String similarity fallback (handles typos and slight wording differences)
    const sim = computeStringSimilarity(normTarget, normChoice);
    if (sim >= 0.70) {
        return 0.86 + (0.14 * sim);
    }

    return 0;
}



/**
 * Parses multi-value fields (e.g. "React, Node.js, TypeScript") into separate target tokens
 */
export function parseTargetValues(rawVal: any): string[] {
    if (rawVal === null || rawVal === undefined) return [];
    if (Array.isArray(rawVal)) {
        return rawVal.map(v => String(v).trim()).filter(Boolean);
    }

    const str = String(rawVal).trim();
    if (!str) return [];

    // 1. JSON Array format: ["Choice 1", "Choice 2"]
    if (str.startsWith("[") && str.endsWith("]")) {
        try {
            const parsed = JSON.parse(str);
            if (Array.isArray(parsed)) {
                return parsed.map(v => String(v).trim()).filter(Boolean);
            }
        } catch { }
    }

    // 2. Safe delimiters:
    // - Real newlines (\r, \n)
    // - Literal typed \n (backslash + n)
    // - Double semicolons (;;)
    // - Pipes (|)
    // - Semicolons (;)
    // - Commas (,)
    const delimiterRegex = /[\r\n]+|\\n|;;|\||;|,/;
    if (delimiterRegex.test(str)) {
        const tokens = str.split(delimiterRegex)
            .map(t => t.trim())
            .filter(t => t.length > 0);
        if (tokens.length > 1) {
            // Keep split tokens AND the un-split original string.
            // This ensures compound choices with commas (e.g. "Yes, I agree") or full sentences
            // never break while allowing comma / \n / ;; multi-value lists to match all choices!
            return Array.from(new Set([...tokens, str]));
        }
    }

    // 3. Fallback: return the full string as a token for phrase containment
    return [str];
}

// ----------------------------------------------------
// RICH CONTROL DESCRIPTOR HARVESTING & LABEL EXTRACTION
// (Ported directly from injectToGoogle/content.js lines 510-990 & 1040-1080)

export interface HarvestedControl {
    control: HTMLElement;
    labelTexts: string[];
    isCustomDropdown: boolean;
    isCountryCode: boolean;
    isChoice: boolean;
    choiceType: "radio" | "checkbox" | "other";
    choiceText: string;
}

/**
 * Checks whether an input, radio, or checkbox is currently checked
 */
export function isControlChecked(control: HTMLElement): boolean {
    if (!control) return false;

    // 1. Native HTML input checked property
    if (typeof (control as HTMLInputElement).checked === "boolean") {
        return (control as HTMLInputElement).checked;
    }

    // 2. ARIA checked / selected
    const ariaChecked = control.getAttribute("aria-checked");
    if (ariaChecked === "true") return true;
    if (ariaChecked === "false") return false;

    const ariaSelected = control.getAttribute("aria-selected");
    if (ariaSelected === "true") return true;

    // 3. Google Forms checkbox/radio checked state (.N2x2zb, [aria-checked="true"])
    if (control.querySelector("[aria-checked='true'], .N2x2zb, .isChecked")) {
        return true;
    }

    // 4. Inner input checked
    const innerInput = control.querySelector<HTMLInputElement>("input[type='checkbox'], input[type='radio']");
    if (innerInput && innerInput.checked) {
        return true;
    }

    // 5. Common UI class indicators
    const classList = (control.className || "").toString();
    if (/\b(is-checked|isChecked|checked|selected|active|is-selected)\b/i.test(classList)) {
        return true;
    }

    // 6. Closest parent choice state
    const parentContainer = control.closest("[aria-checked], [data-checked], .is-checked, .checked");
    if (parentContainer) {
        if (parentContainer.getAttribute("aria-checked") === "true") return true;
        if (parentContainer.getAttribute("data-checked") === "true") return true;
    }

    return false;
}

/**
 * Resolves choice text for Radio / Checkbox inputs across all platforms
 */
export function resolveChoiceText(control: HTMLElement): string {
    if (!control) return "";

    // 1. Explicit HTML <label for="control.id">
    if (control.id) {
        try {
            const labelEl = document.querySelector<HTMLElement>(`label[for="${CSS.escape(control.id)}"]`);
            if (labelEl) {
                const text = (labelEl.innerText || labelEl.textContent || "").trim();
                if (text) return text;
            }
        } catch { }
    }

    // 2. Parent / Enclosing <label>
    const labelParent = control.closest("label");
    if (labelParent) {
        const clone = labelParent.cloneNode(true) as HTMLElement;
        Array.from(clone.querySelectorAll("input, select, textarea, button")).forEach(el => el.remove());
        const text = (clone.innerText || clone.textContent || "").trim();
        if (text) return text;
    }

    // 3. Option row container
    const optionRow = control.closest("div, li, tr, [role='listitem'], .form-check, .custom-control, .choice-item, [class*='pwyvhm'], [class*='_242qvk']");
    if (optionRow) {
        const rowLabel = optionRow.querySelector<HTMLElement>("label, span[class*='label'], .choice-label, .option-text, .form-check-label, [data-qa*='choice-label']");
        if (rowLabel && !rowLabel.contains(control)) {
            const text = (rowLabel.innerText || rowLabel.textContent || "").trim();
            if (text) return text;
        }
    }

    // 4. Google Forms radio / checkbox label (.aDTYNe, .docssharedWizToggleLabeledLabelText)
    const googleLabel = control.querySelector<HTMLElement>(".aDTYNe, .docssharedWizToggleLabeledLabelText, .BD20dn, span[dir='auto']") ||
        control.closest(".docssharedWizToggleLabeledContainer, .geS5n")?.querySelector<HTMLElement>(".aDTYNe, .docssharedWizToggleLabeledLabelText");
    if (googleLabel) {
        const text = (googleLabel.innerText || googleLabel.textContent || "").trim();
        if (text) return text;
    }

    // 5. Microsoft Forms choice label ([data-automation-id='choiceLabel'] or card text)
    const msChoiceContainer = control.closest<HTMLElement>("[data-automation-id='choiceItem'], [data-automation-id*='choice' i], [data-automation-id*='ranking' i], .office-form-question-choice-row");
    if (msChoiceContainer) {
        const msChoiceLabel = msChoiceContainer.querySelector<HTMLElement>("[data-automation-id='choiceLabel'], [data-automation-id*='label' i], [data-automation-id*='text' i], .text-format-content, label, span");
        if (msChoiceLabel && !msChoiceLabel.querySelector("input, select, textarea")) {
            const text = (msChoiceLabel.innerText || msChoiceLabel.textContent || "").trim();
            if (text) return text;
        }
        // Fallback: extract clean text directly from the container itself
        const clone = msChoiceContainer.cloneNode(true) as HTMLElement;
        Array.from(clone.querySelectorAll("input, button, svg, img")).forEach(el => el.remove());
        const text = (clone.innerText || clone.textContent || "").trim();
        if (text) return text;
    }

    // 6. Next Sibling Text (Common in React / Vue custom checkboxes)
    let sib = control.nextElementSibling as HTMLElement | null;
    while (sib) {
        const sibText = (sib.innerText || sib.textContent || "").trim();
        if (sibText && sibText.length <= 60 && !sib.querySelector("input, select, textarea")) {
            return sibText;
        }
        sib = sib.nextElementSibling as HTMLElement | null;
    }

    // 7. Grid / Table Column Header resolution
    const gridRow = control.closest<HTMLElement>("[role='row'], .EzyPc, tr");
    if (gridRow) {
        // Method A: Check data-value first (Google Forms often has the clean column value here)
        const dataVal = control.getAttribute("data-value");
        if (dataVal && dataVal.trim()) return dataVal.trim();

        // Method B: Separate combined aria-label ("Very satisfied, Customer service")
        const ariaLabel = control.getAttribute("aria-label");
        if (ariaLabel && ariaLabel.includes(",")) {
            const parts = ariaLabel.split(/\s*,\s*/).map(p => p.trim()).filter(Boolean);
            const rowHeader = gridRow.querySelector<HTMLElement>("[role='rowheader'], .O1WfFe, th")?.textContent?.trim().toLowerCase();
            if (rowHeader && parts.length > 1) {
                // Return the part that is NOT the row title (which is the column title!)
                const columnPart = parts.find(p => !p.toLowerCase().includes(rowHeader));
                if (columnPart) return columnPart;
            }
            return parts[0];
        }

        // Method C: Find corresponding columnheader in table/grid header row
        const cell = control.closest<HTMLElement>("[role='gridcell'], td");
        if (cell && cell.parentElement === gridRow) {
            const colIndex = Array.from(gridRow.children).indexOf(cell);
            const gridContainer = gridRow.closest<HTMLElement>("[role='table'], [role='grid'], table, .geS5n, .Qr7Oae");
            if (gridContainer && colIndex >= 0) {
                const headerRow = gridContainer.querySelector<HTMLElement>("[role='row']:first-child, thead tr, tr:first-child");
                if (headerRow && headerRow !== gridRow && headerRow.children[colIndex]) {
                    const colText = (headerRow.children[colIndex].textContent || "").trim();
                    if (colText) return colText;
                }
            }
        }
    }

    // 8. Direct data-value, aria-label, or value
    const dataVal = control.getAttribute("data-value");
    if (dataVal) return dataVal.trim();

    const ariaLabel = control.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();

    const val = (control as HTMLInputElement).value;
    if (val && val !== "on") return val.trim();

    // Last resorts, for option cards the steps above can't read (e.g. a radio inside its own
    // wrapper, its text beside that wrapper):
    // 9. The element(s) aria-labelledby points at: the option's accessible name
    const root = control.getRootNode() as Document | ShadowRoot;
    const named = (control.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
        .map(id => getCleanElementText(root.getElementById?.(id) as HTMLElement | null))
        .filter(Boolean).join(" ").trim();
    if (named) return named;

    // 10. The text of the option's own card: the block around it that holds no other option,
    // grown only while its text stays option-sized
    let cardText = "";
    for (let el = control.parentElement, depth = 0; el && el !== document.body && depth < 5; el = el.parentElement, depth++) {
        if (el.tagName === "FORM" || Array.from(el.querySelectorAll(CHOICE_CONTROL_SELECTOR)).some(o => !o.contains(control) && !control.contains(o))) break;
        const text = getVisibleText(el, 200).replace(/\s+/g, " ").trim();
        if (text.length > 120) break;
        if (text) cardText = text;
    }
    return cardText;

}

/**
 * Resolves question / title labels for any control across all platforms
 */
export function resolveControlLabels(control: HTMLElement, isChoice: boolean = false): string[] {
    const labels = new Set<string>();

    // 1. Google Forms Question Title (.M7eMe, .exportItemTitle) inside Question Container (.geS5n, .Qr7Oae)
    const googleCard = control.closest(".geS5n, .Qr7Oae, .freebirdFormviewerViewNumberedItemContainer, .freebirdFormviewerViewItemsItemItem, [role='listitem']");
    if (googleCard) {
        const titleEl = googleCard.querySelector<HTMLElement>(".M7eMe, .exportItemTitle, .freebirdFormviewerComponentsQuestionBaseTitle, [role='heading']");
        if (titleEl && !titleEl.contains(control) && titleEl !== control) {
            const text = (titleEl.innerText || titleEl.textContent || "").trim();
            if (text.length >= 2 && text.length <= 250) {
                labels.add(text);
            }
        }
    }

    // 1.5 Grid / Matrix Question Row Headers (Google Forms, MS Forms, Assessment Grids)
    const gridRow = control.closest<HTMLElement>("[role='row'], .EzyPc, tr, [class*='Row'], [class*='row']");
    if (gridRow) {
        const rowHeader = gridRow.querySelector<HTMLElement>("[role='rowheader'], .O1WfFe, .K1LRrc, .V4d7Ke, .c2yPue, .b3uxdc, th, [class*='rowheader' i]");
        if (rowHeader && !rowHeader.contains(control) && rowHeader !== control) {
            const rowText = (rowHeader.innerText || rowHeader.textContent || "").trim();
            if (rowText.length >= 2 && rowText.length <= 250) {
                labels.add(rowText); // e.g. "Customer service"

                // Also add combined format: "Rate each area. - Customer service"
                if (googleCard) {
                    const cardTitle = googleCard.querySelector<HTMLElement>(".M7eMe, [role='heading']")?.textContent?.trim();
                    if (cardTitle) {
                        labels.add(`${cardTitle} - ${rowText}`);
                        labels.add(`${cardTitle}: ${rowText}`);
                    }
                }
            }
        }
    }

    // 2. Microsoft Forms Question Title ([data-automation-id='questionTitle'])
    const msCard = control.closest("[data-automation-id='questionItem'], [data-automation-id='question-item'], .office-form-question");
    if (msCard) {
        const msTitle = msCard.querySelector<HTMLElement>("[data-automation-id='questionTitle'], [data-automation-id='question-title'], .office-form-question-title");
        if (msTitle && !msTitle.contains(control) && msTitle !== control) {
            const text = (msTitle.innerText || msTitle.textContent || "").trim();
            if (text.length >= 2 && text.length <= 250) {
                labels.add(text);
            }
        }
    }

    // 3. Typeform / Tally / Fillout Question Wrapper
    const typeformCard = control.closest("[data-qa='block-wrapper'], [data-qa-block], .FieldWrapper, [data-tally-block], [data-fillout-block]");
    if (typeformCard) {
        const tfTitle = typeformCard.querySelector<HTMLElement>("[data-qa='block-title'], [data-qa='question-title'], h1, h2, h3, h4, h5, h6");
        if (tfTitle && !tfTitle.contains(control) && tfTitle !== control) {
            const text = (tfTitle.innerText || tfTitle.textContent || "").trim();
            if (text.length >= 2 && text.length <= 250) {
                labels.add(text);
            }
        }
    }

    // 4. Form Builder Cards (JotForm, Salesforce, Zoho, etc.)
    const formBuilderCard = control.closest(".form-line, .fsRow, .fsField, .c-field, .hs-form-field, .zf-tempContDiv, .QuestionOuter, .slds-form-element");
    if (formBuilderCard) {
        const fbTitle = formBuilderCard.querySelector<HTMLElement>(".form-label, .fsLabel, .c-label, .hs-label, .zf-labelName, .QuestionText, .slds-form-element__label, label");
        if (fbTitle && !fbTitle.contains(control) && fbTitle !== control) {
            const text = (fbTitle.innerText || fbTitle.textContent || "").trim();
            if (text.length >= 2 && text.length <= 250) {
                labels.add(text);
            }
        }
    }

    // 5. Standard non-choice HTML <label for="control.id">
    if (!isChoice && control.id) {
        try {
            const labelEl = document.querySelector<HTMLElement>(`label[for="${CSS.escape(control.id)}"]`);
            if (labelEl) labels.add(labelEl.innerText || labelEl.textContent || "");
        } catch { }
    }

    // 6. Enclosing parent <label> if not a choice
    if (!isChoice) {
        const parentLabel = control.closest("label");
        if (parentLabel) {
            labels.add(parentLabel.innerText || parentLabel.textContent || "");
        }
    }

    // 7. Fieldsets & Question Group Containers
    const questionContainer = control.closest("[role='listitem'], [role='group'], [role='radiogroup'], fieldset, .form-group, .question-card, .survey-question, .form-field, .form-row");
    if (questionContainer && !googleCard && !msCard && !typeformCard && !formBuilderCard) {
        const heading = questionContainer.querySelector<HTMLElement>("legend, [role='heading'], h2, h3, h4, h5, h6, .question-title");
        if (heading && !heading.contains(control) && heading !== control) {
            const text = (heading.innerText || heading.textContent || "").trim();
            if (text.length >= 2 && text.length <= 250) {
                labels.add(text);
            }
        }
    }

    // 8. ARIA attributes (aria-label, aria-labelledby)
    if (!isChoice && control.getAttribute("aria-label")) {
        labels.add(control.getAttribute("aria-label")!);
    }
    const labelledBy = control.getAttribute("aria-labelledby");
    if (labelledBy) {
        for (const id of labelledBy.split(/\s+/)) {
            if (!id) continue;
            const el = document.getElementById(id);
            if (el) labels.add(el.innerText || el.textContent || "");
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // [NEW] Steps 8.5a-8.5e: Universal Standard HTML Form Label Resolution
    // These handle forms that don't use any of the platform-specific patterns
    // above (Google Forms, MS Forms, Typeform, etc.).
    //
    // Real-world examples this fixes:
    //   • McDonald's application (odysseus/index.html) uses:
    //     <div class="form-group"><label>Last Name</label><input type="text"/></div>
    //     (No id/for binding, label is a SIBLING not a parent)
    //
    //   • Radio question groups use:
    //     <div class="checkbox-row"><span>Are you presently employed?</span>
    //       <label><input type="radio"> Yes</label>
    //     </div>
    //     (Question text is in a <span> sibling, not a heading)
    //
    //   • HTML table inputs (Availability grid) use:
    //     <th>Mon</th> column headers and <td><strong>From:</strong></td> row headers
    //     (No labels at all — context comes from table structure)
    // ──────────────────────────────────────────────────────────────────────

    // 8.5a. Sibling <label> immediately before the control
    // Pattern: <label>Last Name</label><input type="text" />
    // The <label> has no `for` attribute and the <input> has no `id`,
    // so step 5 (label[for]) and step 6 (closest label) both miss it.
    // This checks if the previous sibling is a label/span containing text.
    if (!isChoice && labels.size === 0) {
        const prevSibling = control.previousElementSibling as HTMLElement | null;
        if (prevSibling) {
            const sibTag = prevSibling.tagName.toUpperCase();
            // Accept <label>, <span>, or <div> siblings that look like labels
            if (sibTag === "LABEL" || sibTag === "SPAN" || (sibTag === "DIV" && prevSibling.classList.contains("label"))) {
                const text = (prevSibling.innerText || prevSibling.textContent || "").trim();
                if (text.length >= 2 && text.length <= 120) {
                    labels.add(text);
                }
            }
        }
    }

    // 8.5b. Parent group label — <div class="form-group"><label>Phone No.</label><input/></div>
    // The parent container (.form-group, .form-row, .field, .input-group) may have
    // a <label> child that describes all inputs inside it. This is extremely common
    // in Bootstrap, Bulma, and hand-coded HTML forms.
    if (!isChoice && labels.size === 0) {
        const parentGroup = control.closest<HTMLElement>(".form-group, .form-row, .field, .input-group, .form-field, .form-control-group, .mb-3, .mb-2");
        if (parentGroup) {
            // Look for a <label> that is a direct or near child of the parent group
            const groupLabel = parentGroup.querySelector<HTMLElement>(":scope > label, :scope > span.label, :scope > .form-label, :scope > .control-label");
            if (groupLabel && !groupLabel.contains(control) && groupLabel !== control) {
                const text = (groupLabel.innerText || groupLabel.textContent || "").trim();
                if (text.length >= 2 && text.length <= 120) {
                    labels.add(text);
                }
            }
        }
    }

    // 8.5c. Checkbox / Radio group question text from sibling <span>
    // Pattern: <div class="checkbox-row">
    //            <span>Are you presently employed?</span>
    //            <label><input type="radio" name="employed" value="yes"> Yes</label>
    //          </div>
    // The question text "Are you presently employed?" lives in a <span> sibling
    // of the radio <label>. Neither step 1 (Google title) nor step 7 (fieldset/heading)
    // will find it because it's not a heading element.
    if (isChoice && labels.size === 0) {
        const choiceParent = control.closest<HTMLElement>(".checkbox-row, .radio-row, .choice-group, .form-check-inline, .radio-group, .checkbox-group");
        if (choiceParent) {
            // Find the first <span> or <p> or <div> that contains the question text
            // (but is NOT one of the choice labels wrapping an input)
            const questionSpan = choiceParent.querySelector<HTMLElement>(":scope > span, :scope > p, :scope > div.question-text");
            if (questionSpan && !questionSpan.querySelector("input") && !questionSpan.contains(control)) {
                const text = (questionSpan.innerText || questionSpan.textContent || "").trim();
                if (text.length >= 3 && text.length <= 250) {
                    labels.add(text);
                }
            }
        }
    }

    // 8.5d. HTML <table> column and row header resolution
    // Pattern (Availability table):
    //   <thead><tr><th>Time</th><th>Mon</th><th>Tue</th>...</tr></thead>
    //   <tbody><tr>
    //     <td><strong>From:</strong></td>
    //     <td><input type="text" /></td>  ← this input at cellIndex=1 → "Mon"
    //   </tr></tbody>
    //
    // We resolve BOTH the column header ("Mon") and the row header ("From:")
    // so the scoring engine can match fields like "Mon From" or "Availability Mon".
    if (labels.size === 0) {
        const tableCell = control.closest<HTMLElement>("td, th");
        const tableRow = control.closest<HTMLElement>("tr");
        if (tableCell && tableRow) {
            const table = tableRow.closest<HTMLElement>("table");
            if (table) {
                // Column header: find <th> in <thead> at the same cellIndex
                const cellIndex = Array.from(tableRow.children).indexOf(tableCell);
                if (cellIndex >= 0) {
                    const headerRow = table.querySelector<HTMLElement>("thead tr, tr:first-child");
                    if (headerRow && headerRow !== tableRow && headerRow.children[cellIndex]) {
                        const colText = (headerRow.children[cellIndex].textContent || "").trim();
                        if (colText.length >= 1 && colText.length <= 60) {
                            labels.add(colText); // e.g. "Mon", "Company Name"
                        }
                    }
                }

                // Row header: first cell in the same row (e.g. <td><strong>From:</strong></td>)
                const firstCell = tableRow.querySelector<HTMLElement>("td:first-child, th:first-child");
                if (firstCell && firstCell !== tableCell) {
                    const rowText = (firstCell.textContent || "").trim();
                    if (rowText.length >= 1 && rowText.length <= 60) {
                        labels.add(rowText); // e.g. "From:", "To:"
                    }
                }

                // Section header: look for a preceding .section-header div
                // (e.g. "Availability" or "Employment Background" above the table)
                const sectionHeader = table.previousElementSibling as HTMLElement | null;
                if (sectionHeader && /section-header|form-section|table-title/i.test(sectionHeader.className || "")) {
                    const sectionText = (sectionHeader.textContent || "").trim();
                    if (sectionText.length >= 2 && sectionText.length <= 60) {
                        labels.add(sectionText); // e.g. "Availability"
                    }
                }
            }
        }
    }

    // 8.5d2. The label of the block around the control that holds no other field:
    //   <div class="item"><p class="form__label">Role applying for</p><div role="button" aria-haspopup="listbox">…
    //   <label for="control-4">Cover Letter</label><div class="box"><…><div contenteditable>  (label points at a wrapper)
    if (!isChoice && labels.size === 0) {
        const wrapperLabel = findWrapperLabel(control);
        if (wrapperLabel) labels.add(wrapperLabel);
    }

    // 8.5e. Placeholder fallback — last resort for unlabelled inputs
    // Many forms use placeholder text as the only identifier:
    //   <input type="text" placeholder="Enter your email address" />
    // This is not ideal for accessibility but is extremely common in the wild.
    if (!isChoice && labels.size === 0) {
        // Rich text editors keep theirs in data-placeholder / aria-placeholder
        const placeholder = (control as HTMLInputElement).placeholder ||
            control.getAttribute("aria-placeholder") || control.getAttribute("data-placeholder") || "";
        if (placeholder && placeholder.trim().length >= 3 && placeholder.trim().length <= 120) {
            // Strip common filler prefixes so "e.g. Phone Number" becomes "Phone Number"
            const cleaned = placeholder.replace(/^(e\.g\.?\s*|enter\s+(your\s+)?|type\s+(your\s+)?)/i, "").trim();
            if (cleaned.length >= 3) {
                labels.add(cleaned);
            }
        }
    }

    // 9. Traversal fallback for radio/checkbox groups or unlabelled inputs
    if (isChoice || labels.size === 0) {
        let curr = control.parentElement;
        for (let depth = 0; depth < 6 && curr && curr !== document.body && curr !== document.documentElement; depth++) {
            const currTag = curr.tagName.toUpperCase();
            if (currTag === "FORM" || currTag === "MAIN" || currTag === "BODY") break;
            // Past the block that holds other fields, a heading names a section or the page, not this field
            if (!isChoice && holdsOtherFields(curr, control)) break;

            const heading = curr.querySelector<HTMLElement>("legend, [role='heading'], .M7eMe, [data-automation-id='questionTitle'], h1, h2, h3, h4, .question-title, .title");
            if (heading && !heading.contains(control) && heading !== control) {
                const text = (heading.innerText || heading.textContent || "").trim();
                if (text.length >= 3 && text.length <= 250) {
                    labels.add(text);
                    break;
                }
            }
            curr = curr.parentElement;
        }
    }

    // An option's own text is not its question: "None" read as the title of None / Beginner / Advanced
    // made each option a question of its own, and the AI picked the only option it was shown
    if (isChoice) {
        const block = choiceOptionsBlock(control);
        if (block) {
            const optionTexts = new Set(Array.from(block.querySelectorAll<HTMLElement>(CHOICE_CONTROL_SELECTOR))
                .map(el => cleanText(resolveChoiceText(el))).filter(Boolean));
            const titles = Array.from(labels).filter(l => !optionTexts.has(cleanText(l)));
            if (titles.length === 0) {
                const title = findChoiceQuestionTitle(block, optionTexts);
                if (title) titles.push(title);
            }
            if (titles.length > 0) return titles.map(t => cleanText(t)).filter(t => t.length > 0);
        }
    }

    return Array.from(labels).map(t => cleanText(t)).filter(t => t.length > 0);
}

// What a question block can hold besides its own control
const FIELD_CONTROL_SELECTOR = "input:not([type='hidden']):not([type='file']), textarea, select, [contenteditable='true'], [role='textbox'], [role='combobox'], [aria-haspopup='listbox']";

// True when `block` holds a visible field other than `control` (and other than parts of it)
function holdsOtherFields(block: HTMLElement, control: HTMLElement): boolean {
    return Array.from(block.querySelectorAll<HTMLElement>(FIELD_CONTROL_SELECTOR))
        .some(el => !el.contains(control) && !control.contains(el) && isElementVisible(el));
}

/**
 * The label inside the smallest block around `control` that holds no other field, placed before
 * the control. "" when the control's own block has none.
 */
function findWrapperLabel(control: HTMLElement): string {
    let block = control.parentElement;
    for (let depth = 0; depth < 10 && block && block !== document.body; depth++) {
        if (block.tagName === "FORM" || holdsOtherFields(block, control)) break;
        const labelEl = Array.from(block.querySelectorAll<HTMLElement>("label, legend, [class*='label' i], [id*='label' i]"))
            .find(el => !el.contains(control) && !control.contains(el) && el.getClientRects().length > 0 &&
                !el.querySelector(FIELD_CONTROL_SELECTOR) &&
                (control.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) !== 0);
        const text = getCleanElementText(labelEl);
        if (text.length >= 2 && text.length <= 250) return text;
        block = block.parentElement;
    }
    return "";
}

const CHOICE_CONTROL_SELECTOR = "input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox']";

/**
 * The block holding all the options of `control`'s question: the radio group or fieldset when the page
 * marks one, else the smallest block around it with another option of the same question in it.
 * Null for a lone checkbox ("I agree to the terms").
 */
function choiceOptionsBlock(control: HTMLElement): HTMLElement | null {
    if (control instanceof HTMLInputElement && control.type === "radio" && control.name) {
        const members = choiceGroupMembers(control);
        if (members.length > 1) return lowestCommonAncestor(members);
    }
    const radioGroup = control.closest<HTMLElement>("[role='radiogroup']");
    if (radioGroup) return radioGroup;
    let block = control.parentElement;
    for (let depth = 0; depth < 8 && block && block !== document.body; depth++) {
        if (block.tagName === "FORM") return null;
        const hasOtherOption = Array.from(block.querySelectorAll<HTMLElement>(CHOICE_CONTROL_SELECTOR))
            .some(el => !el.contains(control) && !control.contains(el));
        if (hasOtherOption) return block;
        // A text box or dropdown before any other option: this box stands alone
        if (holdsOtherFields(block, control)) return null;
        block = block.parentElement;
    }
    return null;
}

/**
 * The title of a radio/checkbox question read from the page layout, not from any site's class names:
 * the nearest text placed before its options block, that is not one of its options
 * ("Rate your comfort level with: Next.js..." above None / Beginner / Intermediate / Advanced).
 * A row of options before it (options laid out two per row) is passed over; a text box or dropdown
 * ends the search, as the text before it belongs to that field.
 */
function findChoiceQuestionTitle(block: HTMLElement, optionTexts: Set<string>): string {
    return textsBefore(block, 1, text => !optionTexts.has(cleanText(text)))[0] || "";
}

/**
 * Up to `limit` texts placed just before `block`, nearest first, read from the page layout (no site's
 * class names): a question's title and helper text above its options or upload box. Stops at a text
 * box or dropdown, as the text before it belongs to that field.
 */
function textsBefore(block: HTMLElement, limit: number, accept: (text: string) => boolean = () => true): string[] {
    const texts: string[] = [];
    let node: HTMLElement = block;
    for (let depth = 0; depth < 6 && node.parentElement && node.parentElement !== document.body; depth++) {
        for (let sib = node.previousElementSibling as HTMLElement | null; sib; sib = sib.previousElementSibling as HTMLElement | null) {
            // Another upload box: the text before it is that box's
            if (sib.matches("input[type='file']") || sib.querySelector("input[type='file']")) return texts;
            const fields = sib.matches(FIELD_CONTROL_SELECTOR) ? [sib] : Array.from(sib.querySelectorAll<HTMLElement>(FIELD_CONTROL_SELECTOR));
            if (fields.length > 0) {
                if (fields.every(f => f.matches(CHOICE_CONTROL_SELECTOR))) continue;
                return texts;
            }
            const text = getVisibleText(sib, 300).replace(/\s+/g, " ").replace(/[*∗＊]\s*$/, "").trim();
            if (text.length >= 3 && text.length <= 250 && accept(text)) {
                texts.push(text);
                if (texts.length >= limit) return texts;
            }
        }
        node = node.parentElement;
        if (node.tagName === "FORM") break;
    }
    return texts;
}

// Helper text under a question title: descriptions, hints, examples
const HINT_SELECTOR = [
    ".gubaDc", ".freebirdFormviewerComponentsQuestionBaseDescription",          // Google Forms
    "[data-automation-id='questionSubtitle']",                                   // Microsoft Forms
    "[data-qa='block-description']",                                             // Typeform
    ".form-sub-label", ".form-description",                                      // JotForm
    ".help-block", ".form-text", ".helper-text", ".hint", ".description",
    "[class*='help-text' i]", "[class*='helptext' i]", "[class*='hint' i]",
    "[class*='description' i]", "[class*='instruction' i]", "small"
].join(", ");

const QUESTION_SCOPE_SELECTOR = ".geS5n, .Qr7Oae, [role='listitem'], [data-automation-id='questionItem'], .office-form-question, [data-qa='block-wrapper'], .form-line, .fsRow, .c-field, .hs-form-field, .slds-form-element, .form-group, .form-field";

/**
 * Reads the instructions that come with a question ("Format: Surname, Given Names (e.g., Dela Cruz, Juan).
 * No middle initials."). The title says WHAT to answer; these say HOW to write it. "" when there are none.
 */
export function resolveControlHint(control: HTMLElement, labelTexts: string[] = []): string {
    const hints: string[] = [];
    const seen = new Set(labelTexts.map(l => cleanText(l)));
    const add = (text: string) => {
        const t = text.replace(/\s+/g, " ").trim();
        const key = cleanText(t);
        if (t.length < 3 || t.length > 400 || seen.has(key)) return;
        // Skip a piece already contained in a longer one (a hint nested inside its own container)
        if (hints.some(h => cleanText(h).includes(key))) return;
        seen.add(key);
        hints.push(t);
    };
    const isOurs = (el: Element) => Boolean(el.closest(".aullevo-blocker-badge, .aullevo-field-badge"));

    // 1. Linked on purpose: aria-describedby (Google Forms links its description and error here)
    const root = control.getRootNode() as Document | ShadowRoot;
    for (const id of (control.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean)) {
        const ref = root.getElementById?.(id);
        if (ref && !isOurs(ref)) add(getCleanElementText(ref));
    }

    // 2. Description / hint elements inside the question's own block
    const scope = control.closest<HTMLElement>(QUESTION_SCOPE_SELECTOR);
    // A block holding several text fields is a section, not one question: its hints may belong to a neighbour
    const textFields = scope?.querySelectorAll("input:not([type='hidden']):not([type='radio']):not([type='checkbox']), textarea, select").length ?? 0;
    if (scope && textFields <= 2) {
        for (const el of Array.from(scope.querySelectorAll<HTMLElement>(HINT_SELECTOR))) {
            if (el.contains(control) || isOurs(el) || el.querySelector("input, textarea, select")) continue;
            add(getCleanElementText(el));
        }
    }

    // 3. A placeholder that isn't the label is often an example ("Dela Cruz, Juan")
    const placeholder = ((control as HTMLInputElement).placeholder || "").trim();
    if (placeholder) add(`Placeholder: ${placeholder}`);

    return hints.join(" | ").slice(0, 600);
}


// Finds all form controls across standard HTML, Google Forms, modern frameworks, and pierced Shadow DOMs.
export function harvestAllControls(): HarvestedControl[] {
    const selector = [
        // 1. Standard HTML5 Inputs (file inputs are found by harvestActiveFileInputs: text typed into one throws)
        "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']):not([type='file'])",
        "textarea",
        "select",

        // 2. Modern Framework Custom Controls (React, Vue, Radix, Shadcn, MUI, AntD, Chakra)
        "[role='textbox']",
        "[role='combobox']",
        "[role='listbox']",
        "[aria-haspopup='listbox']",
        "[aria-haspopup='menu']",
        "[aria-haspopup='true']",
        "[role='radio']",
        "[role='checkbox']",
        "[contenteditable='true']",
        "[data-radix-select-trigger]",
        "[id*='headlessui-listbox-button']",
        CALENDAR_TRIGGER_SELECTOR,
        ".ant-select-selector",
        ".MuiSelect-select",
        ".MuiAutocomplete-root",
        ".mat-select-trigger",
        ".chakra-select",
        ".v-select",
        ".select2-selection",
        ".choices__list",
        ".react-select__control",
        ".ant-checkbox-wrapper",
        ".ant-radio-wrapper",
        ".MuiCheckbox-root",
        ".MuiRadio-root",
        ".chakra-checkbox",
        ".chakra-radio",
        ".v-checkbox",
        ".v-radio",

        // 3. Google Forms Specific Selectors
        ".exportSelect",
        ".quantumWizMenuPaperselectDropDown",
        ".quantumWizMenuPaperselectEl",
        ".ry3kXd",
        "div[jsname='W7NXsf']",
        "div[jsname='LgbsSe']",
        // ".docssharedWizToggleLabeledContainer",

        // 3.5 Microsoft Forms (Respondent & Design Mode)
        "[data-automation-id='textInput']",
        "[data-automation-id='dateInput']",
        "[data-automation-id='select']",
        "[data-automation-id='radio']",
        "[data-automation-id='checkbox']",
        "[data-automation-id='choiceItem']",
        "[data-automation-id*='rankingItem']",
        "[data-automation-id*='nps']",


        // 3.6 Form Builders (Typeform, Tally, Fillout, JotForm, Zoho, Salesforce)
        "[data-qa*='choice']",
        "[data-qa='dropdown']",
        "[data-tally-block]",
        "[data-fillout-block]",
        "[data-type='control_dropdown']",
        ".form-dropdown",
        ".fsSelect",
        ".c-dropdown",
        ".zf-select",
        ".form-radio-item",
        ".form-checkbox-item",
        ".fsRadio",
        ".fsCheckbox",
        ".c-radio",
        ".c-choice",
        "lightning-combobox",
        "lightning-input",
        "lightning-textarea",
        ".slds-combobox",
        ".slds-checkbox",
        ".slds-radio",

        // 4. CAPTCHA & Anti-Bot Verification Widgets (Cloudflare, reCAPTCHA, hCaptcha)
        "iframe[src*='challenges.cloudflare.com']",
        "iframe[src*='challenge-platform']",
        "iframe[src*='cdn-cgi']",
        "iframe[src*='cloudflare']",
        "iframe[src*='turnstile']",
        "iframe[title*='Cloudflare' i]",
        "iframe[title*='challenge' i]",
        "iframe[title*='Turnstile' i]",
        "iframe[title*='reCAPTCHA' i]",
        "iframe[title*='hCaptcha' i]",
        "#challenge-stage",
        "#challenge-form",
        ".cf-turnstile",
        ".g-recaptcha",
        ".h-captcha",
        "[data-sitekey]",
        "#cf-turnstile",
        "div[id*='turnstile']"
    ];

    const selectorStr = selector.join(",");
    const allRoots = getAllDOMRoots();
    const rawElements: HTMLElement[] = [];

    // Query across the main document AND any shadow roots (open or closed)
    allRoots.forEach((root) => {
        try {
            const found = Array.from(root.querySelectorAll<HTMLElement>(selectorStr));
            rawElements.push(...found);
        } catch (e) {
            console.warn("[Aullevo] Error querying root:", e);
        }
    });

    // Deduplicate and filter only elements visible on screen
    const uniqueElements = Array.from(new Set(rawElements));
    const visibleElements = uniqueElements.filter((el) => isElementVisible(el));

    const results: HarvestedControl[] = [];
    const processed = new Set<HTMLElement>();

    for (const control of visibleElements) {
        if (processed.has(control)) continue;
        // The month/year boxes of an open calendar belong to its date field
        if (control.closest(CALENDAR_POPUP_SELECTOR)) continue;

        // Skip child elements if they are nested inside an outer custom dropdown container
        const parentDropdown = control.parentElement ? control.parentElement.closest<HTMLElement>([
            "[role='listbox']",
            "[role='combobox']",
            "[aria-haspopup='listbox']",
            ".exportSelect",
            ".quantumWizMenuPaperselectDropDown",
            ".quantumWizMenuPaperselectEl",
            ".ry3kXd",
            "[data-automation-id='select']",
            "[data-radix-select-trigger]",
            ".ant-select",
            ".react-select__control",
            ".MuiSelect-root",
            "lightning-combobox"
        ].join(", ")) : null;

        if (parentDropdown && parentDropdown !== control && isElementVisible(parentDropdown)) {
            continue;
        }

        const role = (control.getAttribute("role") || "").toLowerCase();
        const type = ((control as HTMLInputElement).type || control.getAttribute("type") || "").toLowerCase();
        const tagName = control.tagName.toUpperCase();
        const classList = (control.className || "").toString();

        // 1. Identify CAPTCHAs & Security Widgets (Preserve them for highlighting, but don't inject form text)
        const src = (control.getAttribute("src") || "").toLowerCase();
        const title = (control.getAttribute("title") || "").toLowerCase();
        const idAndClass = (control.id + " " + classList).toLowerCase();
        const isSecurity =
            src.includes("cloudflare") || src.includes("challenge-platform") ||
            src.includes("recaptcha") || src.includes("hcaptcha") ||
            title.includes("cloudflare") || title.includes("challenge") || title.includes("turnstile") ||
            idAndClass.includes("turnstile") || idAndClass.includes("cf-") || idAndClass.includes("challenge") ||
            control.hasAttribute("data-sitekey");

        if (isSecurity) {
            processed.add(control);
            results.push({
                control,
                labelTexts: [], // empty so form injection skips it
                isCustomDropdown: false,
                isCountryCode: false,
                isChoice: false,
                choiceType: "other",
                choiceText: ""
            });
            continue;
        }

        // 2. Identify Custom Dropdowns
        const isCustomDropdown =
            tagName === "SELECT" ? false :
                role === "listbox" ||
                role === "combobox" ||
                control.getAttribute("aria-haspopup") === "listbox" ||
                control.getAttribute("aria-haspopup") === "menu" ||
                control.getAttribute("aria-haspopup") === "true" ||
                control.hasAttribute("data-radix-select-trigger") ||
                classList.includes("quantumWizMenuPaperselect") ||
                classList.includes("exportSelect") ||
                classList.includes("ry3kXd") ||
                classList.includes("ant-select") ||
                classList.includes("MuiSelect") ||
                classList.includes("mat-select");

        // 3. Identify Radios and Checkboxes
        const isChoice =
            type === "radio" || type === "checkbox" ||
            role === "radio" || role === "checkbox" ||
            classList.includes("docssharedWizToggleLabeledContainer") ||
            classList.includes("form-radio-item") ||
            classList.includes("form-checkbox-item") ||
            control.getAttribute("data-automation-id") === "radio" ||
            control.getAttribute("data-automation-id") === "checkbox" ||
            control.getAttribute("data-automation-id") === "choiceItem" ||
            (control.hasAttribute("data-qa") && (control.getAttribute("data-qa") || "").includes("choice"));

        let choiceType: "radio" | "checkbox" | "other" = "other";
        let choiceText = "";

        if (isChoice) {
            const isRadio = type === "radio" || role === "radio" ||
                /radio/i.test(classList) ||                     // <-- Case-insensitive check
                control.getAttribute("data-automation-id") === "radio";
            choiceType = isRadio ? "radio" : "checkbox";
            choiceText = resolveChoiceText(control);
        }


        // 4. Identify Country Code / Phone Dial Selectors
        const ariaLabel = (control.getAttribute("aria-label") || "").toLowerCase();
        const nameAttr = ((control as HTMLInputElement).name || control.id || "").toLowerCase();
        // The page's own autocomplete hint decides first: "tel-country-code" is the code alone, "tel" the whole
        // number. "Phone number with country code" asks for the whole number too.
        const autocomplete = (control.getAttribute("autocomplete") || "").toLowerCase();
        const isCountryCode = !isChoice && tagName !== "TEXTAREA" && (
            /\btel-country-code\b/.test(autocomplete) ||
            (!/\btel(?:-national|-local)?\b/.test(autocomplete) &&
                /country\s*code|dial\s*code|calling\s*code|phone\s*prefix/i.test(nameAttr + " " + ariaLabel + " " + classList) &&
                !/\b(?:with|incl(?:uding|\.)?|plus)\s+(?:the\s+|a\s+)?(?:country|dial|calling)\s*code/i.test(ariaLabel))
        );

        // 5. Resolve Question Header Labels
        const labelTexts = resolveControlLabels(control, isChoice);
        if (isCountryCode) {
            labelTexts.unshift("country code", "dial code", "phone prefix");
        }

        // Include any control with discovered context or choices
        if (labelTexts.length > 0 || choiceText || tagName === "INPUT" || tagName === "SELECT" || tagName === "TEXTAREA") {
            processed.add(control);
            results.push({
                control,
                labelTexts,
                isCustomDropdown,
                isCountryCode,
                isChoice,
                choiceType,
                choiceText
            });
        }
    }

    console.log(`[Aullevo] Harvested ${results.length} descriptors across ${allRoots.length} DOM root(s):`, results);
    return results;
}

// NATIVE INJECTION & SYNTHETIC EVENT DISPATCHERS
// (Ported directly from injectToGoogle/content.js lines 1083-1200 & 2010-2290)

// Brave Shields' "Block scripts" (or JavaScript turned off for the site) also stops this script's
// setTimeout from ever firing, while extension messaging keeps working. The first sleep finds out;
// from then on background.ts does the waiting, so a fill can't hang on its first pause.
let pageTimersBlocked: boolean | null = null;

// False when background.ts could not be reached (extension reloaded)
function backgroundDelay(ms: number): Promise<boolean> {
    return new Promise(resolve => {
        try {
            chrome.runtime.sendMessage({ action: "AULLEVO_DELAY", ms }, (res) => {
                resolve(!chrome.runtime.lastError && res === true);
            });
        } catch {
            resolve(false);
        }
    });
}

/**
 * Async sleep utility for pacing DOM events
 */
export async function sleep(ms: number): Promise<void> {
    // A page out of sight (Alt+Tab to another app covering Chrome, minimized, another tab) gets its
    // timers held to once a second or slower: 25ms keystrokes took a second each. Wait in background.ts then.
    if (document.hidden && await backgroundDelay(ms)) return;
    if (pageTimersBlocked === false) return new Promise(resolve => setTimeout(resolve, ms));
    if (pageTimersBlocked) {
        await backgroundDelay(ms);
        return;
    }
    let fired = false;
    const timer = new Promise<void>(resolve => setTimeout(() => { fired = true; resolve(); }, ms));
    await Promise.race([timer, backgroundDelay(ms + 1000).then(ok => ok ? undefined : timer)]);
    pageTimersBlocked = !fired;
}

// Speed for Typing
export interface SpeedConfig {
    charDelayMs: number;
    actionDelayMs: number;
}

export function resolveSpeedConfig(preset: string | number | SpeedConfig | undefined): SpeedConfig {
    // 1. If passed an explicit numeric millisecond value (from Custom Delay input)
    if (typeof preset === "number") {
        const charDelayMs = Math.max(0, preset);
        // Inter-action delay (between clicking choices or moving to next field)
        const actionDelayMs = charDelayMs > 0 ? Math.max(80, charDelayMs * 3.5) : 0;
        return { charDelayMs, actionDelayMs };
    }

    // 2. If passed a full SpeedConfig object
    if (typeof preset === "object" && preset !== null) {
        return preset;
    }

    // 3. String presets fallback
    switch (preset) {
        case "fast":
        case "instant":
            return { charDelayMs: 0, actionDelayMs: 0 };
        case "stealth":
        case "slow":
            return { charDelayMs: 65, actionDelayMs: 250 };
        case "human":
        case "natural":
        default:
            return { charDelayMs: 25, actionDelayMs: 120 };
    }
}

export function getJitteredDelay(baseMs: number, variancePercent: number = 0.25): number {
    if (baseMs <= 0) return 0;
    const delta = baseMs * variancePercent;
    const min = Math.max(1, baseMs - delta);
    const max = baseMs + delta;
    return Math.floor(Math.random() * (max - min + 1) + min);
}


/**
 * Checks if a string looks like a standard date
 */
export function isDateValue(value: any): boolean {
    if (!value) return false;
    const str = String(value).trim();
    return /^\d{4}\s*[\/\-\.]\s*\d{1,2}\s*[\/\-\.]\s*\d{1,2}$/.test(str) ||
        /^\d{1,2}\s*[\/\-\.]\s*\d{1,2}\s*[\/\-\.]\s*\d{4}$/.test(str) ||
        /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}$/i.test(str) ||
        /^\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}$/i.test(str);
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function monthFromName(name: string): number {
    return MONTH_NAMES.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

function toIsoDate(year: number, month: number, day: number): string {
    if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return "";
    const daysInMonth = new Date(year, month, 0).getDate();
    if (day > daysInMonth) return "";
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Normalizes various date string formats into standard YYYY-MM-DD for HTML5 inputs.
 * Partial dates are completed to the first day ("2021" -> "2021-01-01", "May 2021" -> "2021-05-01").
 * Returns "" when the value is not a date, so callers never write invalid text into a date input.
 */
export function normalizeDateForInput(value: unknown): string {
    if (!value) return "";
    const trimmed = String(value).trim();
    let m: RegExpMatchArray | null;

    // YYYY-MM-DD, YYYY/MM/DD, optionally followed by a time ("2021-05-03T10:00")
    if ((m = trimmed.match(/^(\d{4})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:[T\s].*)?$/))) {
        return toIsoDate(+m[1], +m[2], +m[3]);
    }

    // DD/MM/YYYY or MM/DD/YYYY
    if ((m = trimmed.match(/^(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})$/))) {
        const num1 = +m[1];
        const num2 = +m[2];
        const day = num1 > 12 ? num1 : (num2 > 12 ? num2 : num1);
        const month = num1 > 12 ? num2 : (num2 > 12 ? num1 : num2);
        return toIsoDate(+m[3], month, day);
    }

    // "Jan 5, 2021" / "January 5 2021"
    if ((m = trimmed.match(/^([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i)) && monthFromName(m[1])) {
        return toIsoDate(+m[3], monthFromName(m[1]), +m[2]);
    }

    // "5 Jan 2021" / "5th January, 2021"
    if ((m = trimmed.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,})\.?,?\s+(\d{4})$/i)) && monthFromName(m[2])) {
        return toIsoDate(+m[3], monthFromName(m[2]), +m[1]);
    }

    // "May 2021" / "May, 2021"
    if ((m = trimmed.match(/^([a-z]{3,})\.?,?\s+(\d{4})$/i)) && monthFromName(m[1])) {
        return toIsoDate(+m[2], monthFromName(m[1]), 1);
    }

    // "2021-05" / "2021/5"
    if ((m = trimmed.match(/^(\d{4})\s*[/.-]\s*(\d{1,2})$/))) {
        return toIsoDate(+m[1], +m[2], 1);
    }

    // "05/2021"
    if ((m = trimmed.match(/^(\d{1,2})\s*[/.-]\s*(\d{4})$/))) {
        return toIsoDate(+m[2], +m[1], 1);
    }

    // Year only: "2021"
    if ((m = trimmed.match(/^(\d{4})$/))) {
        return toIsoDate(+m[1], 1, 1);
    }

    return "";
}

/**
 * Resolves the best candidate value for a text input when "/" is used in the value.
 * e.g. Value "Bachelor's Degree / 4th Year" for Question "Year Level" -> "4th Year"
 */
export function resolveBestTextCandidate(value: any, matchedAlias: string = "", element?: HTMLElement): string {
    if (!value || typeof value !== "string") return String(value || "");
    if (!value.includes("/")) return value;
    if (isDateValue(value)) return value;
    // Links are one value, not "A / B" choices: https://..., www..., linkedin.com/in/name
    if (/^[a-z][\w+.-]*:\/\//i.test(value.trim()) || /(^|\s)(www\.)?[\w-]+(\.[\w-]+)+\/\S/i.test(value)) return value;

    const candidates = value.split(/\s*\/\s*/).map(c => c.trim()).filter(Boolean);
    if (candidates.length <= 1) return value;
    // "N/A", "w/o", "24/7", "He/Him": one value written with a slash, not a choice between parts
    if (candidates.some(c => c.length < 3)) return value;

    if (matchedAlias) {
        let bestCand: string | null = null;
        let bestScore = 0;
        for (const cand of candidates) {
            const score = computeStringSimilarity(matchedAlias, cand);
            if (score > bestScore) {
                bestScore = score;
                bestCand = cand;
            }
        }
        if (bestCand && bestScore >= 0.40) {
            return bestCand;
        }
    }

    if (element) {
        const labelsText = (element as any).labels?.[0]?.innerText || "";
        const placeholder = (element as HTMLInputElement).placeholder || "";
        const nameAttr = (element as HTMLInputElement).name || "";
        const idAttr = element.id || "";
        const context = `${labelsText} ${placeholder} ${nameAttr} ${idAttr}`.toLowerCase();

        let bestCand: string | null = null;
        let bestScore = 0;
        for (const cand of candidates) {
            const score = computeStringSimilarity(context, cand);
            if (score > bestScore) {
                bestScore = score;
                bestCand = cand;
            }
        }
        if (bestCand && bestScore >= 0.40) {
            return bestCand;
        }
    }

    return value;
}


/**
 * Dispatches a complete single-sequence pointer and mouse event cycle.
 * Prevents double-toggling and Google Forms Closure compiler race conditions.
 */
export function dispatchSinglePointerClick(element: HTMLElement): void {
    if (!element) return;

    try {
        element.focus();
    } catch { }

    const rect = element.getBoundingClientRect();
    const clientX = rect.left + Math.max(rect.width / 2, 5);
    const clientY = rect.top + Math.max(rect.height / 2, 5);

    const baseOpts = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX,
        clientY,
        screenX: clientX,
        screenY: clientY
    };

    try {
        element.dispatchEvent(new PointerEvent("pointerover", { ...baseOpts, button: 0, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    } catch { }
    try {
        element.dispatchEvent(new MouseEvent("mouseover", { ...baseOpts, button: 0, buttons: 0, which: 0 }));
    } catch { }
    try {
        element.dispatchEvent(new PointerEvent("pointerenter", { ...baseOpts, button: 0, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    } catch { }
    try {
        element.dispatchEvent(new PointerEvent("pointerdown", { ...baseOpts, button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true, pressure: 0.5, which: 1 }));
    } catch { }
    try {
        element.dispatchEvent(new MouseEvent("mousedown", { ...baseOpts, button: 0, buttons: 1, which: 1 }));
    } catch { }
    try {
        element.dispatchEvent(new PointerEvent("pointerup", { ...baseOpts, button: 0, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true, pressure: 0, which: 1 }));
    } catch { }
    try {
        element.dispatchEvent(new MouseEvent("mouseup", { ...baseOpts, button: 0, buttons: 0, which: 1 }));
    } catch { }
    try {
        element.dispatchEvent(new MouseEvent("click", { ...baseOpts, button: 0, buttons: 0, which: 1 }));
    } catch { }
    try {
        if (typeof element.click === "function") {
            element.click();
        }
    } catch { }

    // [FIX: Star Rating Hover State Stuck]
    // Previously, we dispatched pointerover/mouseover/pointerenter at the START
    // of the click sequence but never dispatched the LEAVE events at the END.
    //
    // For Google Forms star ratings, this caused the hover visual (gold stars 1-N)
    // to persist permanently — masking whether the selection actually took effect.
    // The user would only see the "selected" visual by hovering away and back.
    //
    // Dispatching pointerleave/mouseout/mouseleave tells the browser (and Google's
    // Closure event handlers) that the mouse has left the element, which:
    //   - Clears any JS-managed hover classes
    //   - Removes the CSS :hover pseudo-state
    //   - Reveals the underlying "checked/selected" visual state
    try {
        element.dispatchEvent(new PointerEvent("pointerout", { ...baseOpts, button: 0, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    } catch { }
    try {
        element.dispatchEvent(new MouseEvent("mouseout", { ...baseOpts, button: 0, buttons: 0, relatedTarget: document.body }));
    } catch { }
    try {
        element.dispatchEvent(new PointerEvent("pointerleave", { ...baseOpts, button: 0, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    } catch { }
    try {
        element.dispatchEvent(new MouseEvent("mouseleave", { ...baseOpts, button: 0, buttons: 0, relatedTarget: document.body }));
    } catch { }
}

/**
 * Types into a rich text editor (Quill, ProseMirror, Lexical, Draft.js) the way the keyboard does:
 * they keep their own model of the text and ignore innerText changes made behind their back.
 * `replace` selects the current text first. False when the browser could not insert it.
 */
function insertEditableText(element: HTMLElement, text: string, replace: boolean): boolean {
    try {
        element.focus();
        const selection = window.getSelection();
        if (!selection) return false;
        if (replace || !element.contains(selection.anchorNode)) {
            const range = document.createRange();
            range.selectNodeContents(element);
            if (!replace) range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
        }
        if (!text) {
            return replace ? (document.execCommand("delete", false) || !getCleanElementText(element)) : true;
        }
        return document.execCommand("insertText", false, text);
    } catch {
        return false;
    }
}

/**
 * Sets values on native inputs while triggering synthetic events for React, Vue, and Angular.
 *
 * [FIX: "Illegal invocation" crash]
 * Previously, this function called HTMLInputElement.prototype.value.set.call(element, value)
 * on ANY element — including <div role="textbox">, <div role="combobox">, and other
 * non-input elements. The native setter throws "Illegal invocation" when `this` is not
 * an actual <input> or <textarea> element. Now we:
 *   1. Check element.tagName to confirm it's INPUT or TEXTAREA before using prototype setter
 *   2. Wrap the setter call in try/catch as a safety net
 *   3. Wrap event dispatches in try/catch so a failed setter doesn't skip events
 */
export function setNativeInputValue(element: HTMLElement, value: string): void {
    if (!element) return;

    try {
        element.focus();
    } catch { }

    try {
        if (typeof FocusEvent !== "undefined") {
            element.dispatchEvent(new FocusEvent("focus", { bubbles: true, composed: true }));
            element.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
        } else {
            element.dispatchEvent(new Event("focus", { bubbles: true, composed: true }));
            element.dispatchEvent(new Event("focusin", { bubbles: true, composed: true }));
        }
    } catch { }

    // ContentEditable elements (rich text editors like Quill, TipTap, ProseMirror)
    // use .innerText instead of .value — handle them separately
    if (element.isContentEditable || element.getAttribute("contenteditable") === "true") {
        if (!insertEditableText(element, value, true)) {
            element.innerText = value;
            element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        }
        element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        return;
    }

    const tagName = element.tagName.toUpperCase();
    const isTextArea = tagName === "TEXTAREA" || element instanceof HTMLTextAreaElement;
    const isInput = tagName === "INPUT" || element instanceof HTMLInputElement;

    // [FIX] Only use the native prototype setter on actual <input> / <textarea> elements.
    // Calling HTMLInputElement.prototype.value.set on a <div>, <span>, or any custom
    // framework element (e.g. div[role="textbox"]) will throw "Illegal invocation".
    const isNativeFormElement = isInput || isTextArea;

    const inputEl = element as HTMLInputElement | HTMLTextAreaElement;
    let previousValue = "";
    try {
        previousValue = inputEl.value || "";
    } catch { }

    // [FIX] Guard: Only use prototype value descriptor on real <input>/<textarea>
    if (isNativeFormElement) {
        const prototype = isTextArea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const valueDescriptor = Object.getOwnPropertyDescriptor(prototype, "value");

        try {
            if (valueDescriptor && valueDescriptor.set) {
                // This is the React-compatible way to set values:
                // React wraps the native value setter to track changes internally.
                // Using the prototype setter bypasses React's wrapper, so React
                // will see the subsequent "input" event as a real user change.
                valueDescriptor.set.call(element, value);
            } else {
                inputEl.value = value;
            }
        } catch (e) {
            // Safety net: if the prototype setter still fails somehow, fall back to direct assignment
            console.warn("[Aullevo] Prototype setter failed, using direct assignment:", e);
            try { inputEl.value = value; } catch { }
        }
    } else {
        // For non-native elements (div[role="textbox"], custom components, etc.)
        // we can only try direct .value assignment or .innerText as a fallback
        try {
            (element as any).value = value;
        } catch {
            try { element.innerText = value; } catch { }
        }
    }

    // For HTML5 date inputs, also set valueAsDate for maximum browser compatibility
    if (isInput && inputEl.type === "date" && typeof value === "string" && value.includes("-")) {
        try {
            inputEl.value = value;
            const parts = value.split("-").map(Number);
            if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
                (inputEl as HTMLInputElement).valueAsDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
            }
        } catch { }
    }

    // Reset React's synthetic event valueTracker so React detects the change.
    // React stores the previous value internally via _valueTracker. If we don't
    // reset it, React's onChange won't fire even if the DOM value changed.
    if ((inputEl as any)._valueTracker) {
        (inputEl as any)._valueTracker.setValue(previousValue);
    }

    // [FIX] Wrap event dispatches in try/catch — if the element is a non-standard
    // DOM node (e.g., a custom Web Component), some events might not be supported
    try {
        element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "a" }));
        element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: "a" }));
        element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    } catch (e) {
        console.warn("[Aullevo] Event dispatch failed on element:", element.tagName, e);
    }

    try {
        if (typeof FocusEvent !== "undefined") {
            element.dispatchEvent(new FocusEvent("blur", { bubbles: true, composed: true }));
            element.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
        } else {
            element.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
            element.dispatchEvent(new Event("focusout", { bubbles: true, composed: true }));
        }
    } catch { }

    try {
        element.blur();
    } catch { }
}

export function harvestActiveFileInputs(): { input: HTMLInputElement; container: HTMLElement }[] {
    const allRoots = getAllDOMRoots();
    const rawInputs: HTMLInputElement[] = [];

    allRoots.forEach((root) => {
        try {
            const found = Array.from(root.querySelectorAll<HTMLInputElement>("input[type='file']"));
            rawInputs.push(...found);
        } catch { }
    });

    const activeUploads: { input: HTMLInputElement; container: HTMLElement }[] = [];

    for (const input of rawInputs) {
        if (input.disabled) continue;

        // Visual dropzone or container
        const container = (
            input.closest<HTMLElement>(
                ".drop-zone, [data-automation-id*='upload'], [data-automation-id*='drop-zone'], " +
                "[data-testid*='FilePicker'], [data-testid*='file-upload'], .file-upload, " +
                ".upload-container, .f, .form-group, fieldset, label"
            ) || input.parentElement || input
        );

        // Filter out inactive multi-step pages (like hidden #p1, #p2 in index5.html)
        const isHiddenParent = container.closest("[style*='display: none'], [style*='display:none'], [hidden], [aria-hidden='true']");
        const isVisible = typeof container.checkVisibility === "function"
            ? container.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })
            : (container.offsetWidth > 0 || container.offsetHeight > 0 || container.getClientRects().length > 0);
        if (!isHiddenParent && isVisible) {
            activeUploads.push({ input, container });
        }
    }

    return activeUploads;
}

export function extractFileContext(input: HTMLInputElement, container: HTMLElement): { contextText: string; accept: string } {
    const texts = new Set<string>();

    // 1. Google Forms Heading
    const googleCard = input.closest(".geS5n, .Qr7Oae, [role='listitem']");
    if (googleCard) {
        const title = googleCard.querySelector<HTMLElement>(".M7eMe, [role='heading']");
        if (title?.textContent) texts.add(title.textContent);
    }

    // 2. Microsoft Forms Heading
    const msCard = input.closest("[data-automation-id='questionItem']");
    if (msCard) {
        const title = msCard.querySelector<HTMLElement>("[data-automation-id='questionTitle']");
        if (title?.textContent) texts.add(title.textContent);
    }

    // 3. Workday & Indeed
    const workdayLabel = input.closest("[data-automation-id*='file-upload']")?.querySelector<HTMLElement>("label, [data-automation-id*='label']");
    if (workdayLabel?.textContent) texts.add(workdayLabel.textContent);

    const indeedLabel = input.closest("[data-testid*='FilePicker']")?.querySelector<HTMLElement>("h2, h3, label, p");
    if (indeedLabel?.textContent) texts.add(indeedLabel.textContent);

    // 4. Standard Field & Multi-Step Headers (e.g., index5.html)
    const sectionOrField = input.closest(".f, .form-group, fieldset, section, [class*='step']");
    if (sectionOrField) {
        const header = sectionOrField.querySelector<HTMLElement>(".f-lbl-row, .f-lbl-inline, .pt, label, legend, h1, h2, h3, h4");
        if (header?.textContent) texts.add(header.textContent);
    }

    // 5. Dropzone hints & data-category
    if (container) {
        const dropText = container.querySelector<HTMLElement>(".drop-text, .drop-hint, [class*='hint'], [class*='subtitle']");
        if (dropText?.textContent) texts.add(dropText.textContent);
        const cat = container.getAttribute("data-category") || input.getAttribute("data-category");
        if (cat) texts.add(cat);
    }

    // 6. The input's own labels: <label for>, aria-labelledby / aria-describedby, and the label of its
    //    block (<p class="field-label">Resume (Must include your photo)</p> above a hidden input)
    Array.from(input.labels || []).forEach(l => texts.add(getCleanElementText(l)));
    const root = input.getRootNode() as Document | ShadowRoot;
    for (const attr of ["aria-labelledby", "aria-describedby"]) {
        for (const id of (input.getAttribute(attr) || "").split(/\s+/).filter(Boolean)) {
            const ref = root.getElementById?.(id);
            if (ref) texts.add(getCleanElementText(ref));
        }
    }
    const blockLabel = findWrapperLabel(input);
    if (blockLabel) texts.add(blockLabel);

    // 7. The upload box's own label, and the title and hint placed above it, read from the layout:
    //    builders with generated class names (Fillout) put "Upload your updated resume" in a plain block
    if (container && container !== input) {
        if (container.id) {
            try {
                const forBox = root.querySelector?.<HTMLElement>(`label[for="${CSS.escape(container.id)}"]`);
                if (forBox) texts.add(getCleanElementText(forBox));
            } catch { }
        }
        for (const id of (container.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)) {
            const ref = root.getElementById?.(id);
            if (ref) texts.add(getCleanElementText(ref));
        }
        const boxLabel = container.getAttribute("aria-label");
        if (boxLabel) texts.add(boxLabel);
    }
    textsBefore(container && container !== input ? container : input, 3).forEach(t => texts.add(t));

    if (input.name) texts.add(input.name);
    if (input.id) texts.add(input.id);
    if (input.getAttribute("aria-label")) texts.add(input.getAttribute("aria-label")!);

    return {
        contextText: Array.from(texts).join(" ").toLowerCase(),
        accept: (input.getAttribute("accept") || "").toLowerCase()
    };
}

export function scoreFileMatch(file: ProfileFile, contextText: string, accept: string): number {
    let score = 0;
    const label = (file.label || "").trim().toLowerCase();
    const fileName = (file.fileName || "").toLowerCase();
    const cleanFileName = fileName.replace(/\.[^/.]+$/, "").replace(/[_\W]+/g, " ");

    // =========================================================================
    // PRIORITY 1: DYNAMIC LABEL MATCHING (Just like CM Custom Fields!)
    // =========================================================================
    if (label.length >= 2) {
        // A. Direct full-phrase containment (e.g. "driver's license" inside "Upload Driver's License")
        if (contextText.includes(label)) {
            score = Math.max(score, 0.95);
        }

        // B. Word-by-word token overlap
        const labelWords = label.split(/\s+/).filter(w => w.length >= 3);
        let matchedWordCount = 0;
        for (const word of labelWords) {
            if (contextText.includes(word)) {
                matchedWordCount++;
            }
        }
        if (labelWords.length > 0 && matchedWordCount > 0) {
            const tokenScore = (matchedWordCount / labelWords.length) * 0.85;
            score = Math.max(score, tokenScore);
        }

        // C. String similarity against aliases
        const aliases = getFieldLabelAliases(label);
        for (const alias of aliases) {
            const sim = computeStringSimilarity(alias, contextText);
            if (sim > score) score = sim;
        }

        // D. Category semantic synonyms
        if (/resume|cv/i.test(label) && /\b(resume|cv|curriculum\s*vitae|bio[- ]?data)\b/i.test(contextText)) {
            score = Math.max(score, 0.90);
        }
        if (/cover\s*letter/i.test(label) && /cover\s*letter|letter\s*of\s*intent|motivation/i.test(contextText)) {
            score = Math.max(score, 0.90);
        }
        if (/id|passport|identity/i.test(label) && /identity|passport|government\s*id|license|2x2|photo/i.test(contextText)) {
            score = Math.max(score, 0.90);
        }
        if (/transcript|diploma|academic/i.test(label) && /academic|transcript|diploma|tor|grade|education/i.test(contextText)) {
            score = Math.max(score, 0.90);
        }
        if (/portfolio|project/i.test(label) && /portfolio|case\s*stud|project\s*asset|deliverable|work\s*sample/i.test(contextText)) {
            score = Math.max(score, 0.90);
        }
    }

    // =========================================================================
    // PRIORITY 2: FILENAME FALLBACK (If label didn't match strongly)
    // =========================================================================
    if (score < 0.60) {
        const fileWords = cleanFileName.split(/\s+/).filter(w => w.length >= 3);
        let fileWordMatches = 0;
        for (const word of fileWords) {
            if (contextText.includes(word)) {
                fileWordMatches++;
            }
        }
        if (fileWords.length > 0 && fileWordMatches > 0) {
            const fileScore = (fileWordMatches / fileWords.length) * 0.75;
            score = Math.max(score, fileScore);
        }
    }

    // =========================================================================
    // PRIORITY 3: EXTENSION / MIME SANITY CHECK
    // =========================================================================
    if (accept) {
        if (fileFitsAccept(file, accept)) {
            score += 0.05;
        } else {
            score -= 0.50; // Penalize wrong file type (e.g. .docx into image-only field)
        }
    }

    return score;
}

const MIME_BY_EXTENSION: Record<string, string> = {
    ".pdf": "application/pdf", ".doc": "application/msword", ".rtf": "application/rtf", ".txt": "text/plain",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".heic": "image/heic"
};

/**
 * True when the file is one the input's accept="" allows. accept lists extensions (".pdf"),
 * types ("application/pdf") or type families ("image/*"): "PDF only" is often written as the type,
 * and a PDF must not count as the wrong kind of file there.
 */
function fileFitsAccept(file: ProfileFile, accept: string): boolean {
    const fileName = (file.fileName || "").toLowerCase();
    const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
    const mime = (file.mimeType || MIME_BY_EXTENSION[ext] || "").toLowerCase();
    return accept.split(",").map(t => t.trim().toLowerCase()).filter(Boolean).some(token =>
        token === "*" || token === "*/*" ||
        (token.startsWith(".") && token === ext) ||
        (token.endsWith("/*") && mime.startsWith(token.slice(0, -1))) ||
        (mime !== "" && token === mime));
}


// A block around an upload box that outlives the site swapping the drop zone for its file list:
// up to two levels above it, never one that holds another upload box
function uploadAnchor(container: HTMLElement): HTMLElement {
    let anchor = container;
    for (let depth = 0; depth < 2; depth++) {
        const parent = anchor.parentElement;
        if (!parent || /^(FORM|BODY|HTML)$/.test(parent.tagName)) break;
        const uploads = parent.querySelectorAll("input[type='file']");
        if (Array.from(uploads).some(u => !composedContains(container, u))) break;
        anchor = parent;
    }
    return anchor;
}

const QUESTION_CONTROL_SELECTOR = "input:not([type='hidden']), select, textarea, [role='combobox']";

// The upload question's own block: the box plus what the site shows for it below or beside it
// (file rows, "Uploading...", progress bars), up to where another question starts
function uploadQuestionBlock(container: HTMLElement): HTMLElement {
    let block = container;
    for (;;) {
        const parent = block.parentElement;
        if (!parent || /^(FORM|BODY|HTML)$/.test(parent.tagName)) return block;
        const controls = Array.from(parent.querySelectorAll(QUESTION_CONTROL_SELECTOR));
        if (controls.some(el => !composedContains(container, el))) return block;
        block = parent;
    }
}

// The block and what follows it up to the next question: flat forms put the file rows right after
// the box, as siblings, instead of inside a wrapper
function uploadArea(block: HTMLElement): HTMLElement[] {
    const area = [block];
    for (let next = block.nextElementSibling; next instanceof HTMLElement; next = next.nextElementSibling) {
        if (next.matches(QUESTION_CONTROL_SELECTOR) || next.querySelector(QUESTION_CONTROL_SELECTOR)) break;
        area.push(next);
    }
    return area;
}

function uploadAreaText(block: HTMLElement): string {
    return uploadArea(block).map(el => getVisibleText(el, 20000)).join("\n");
}

/**
 * True when the page shows the file it was handed: its name appears by the upload box, or a visible
 * native file input holds it (the browser draws the name inside the input). A box the site rebuilt or
 * changed since the file was handed over ("Uploading...", a progress bar) counts as taken too:
 * there is no telling, and a second copy is worse than none.
 */
function uploadShowsFile(input: HTMLInputElement, anchor: HTMLElement, fileName: string, before?: { block: HTMLElement; text: string }): boolean {
    if (!anchor.isConnected) return true;
    if (before && (!before.block.isConnected || uploadAreaText(before.block) !== before.text)) return true;
    if (input.isConnected && isRendered(input) && (input.files?.length ?? 0) > 0) return true;
    const name = fileName.toLowerCase();
    const base = name.replace(/\.[^/.]+$/, "");
    const text = getVisibleText(anchor, 20000).toLowerCase();
    return text.includes(name) || (base.length >= 4 && text.includes(base));
}

export async function injectFileIntoControl(
    inputEl: HTMLInputElement,
    containerEl: HTMLElement,
    fileObj: ProfileFile
): Promise<boolean> {
    if (!inputEl) return false;

    try {
        const base64Data = fileObj.dataBase64.replace(/^data:[^;]+;base64,/, "");
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const file = new File([bytes], fileObj.fileName, {
            type: fileObj.mimeType || "application/pdf",
            lastModified: Date.now()
        });

        const dt = new DataTransfer();
        dt.items.add(file);

        // Whether the upload box reacts to the input's change (a file row, "Uploading...", a progress bar)
        const hasDropzone = Boolean(containerEl && containerEl !== inputEl);
        let reacted = false;
        const block = uploadQuestionBlock(containerEl);
        const inArea = (node: Node) => uploadArea(block).some(el => el.contains(node));
        const watcher = hasDropzone ? new MutationObserver(records => {
            if (records.some(r => inArea(r.target) || Array.from(r.addedNodes).some(inArea))) reacted = true;
        }) : null;
        watcher?.observe(block.parentElement || block, { childList: true, subtree: true, characterData: true });

        // Native input change
        inputEl.files = dt.files;
        inputEl.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        inputEl.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

        // Synthetic drag & drop for Workday and custom dropzones that ignore the input. Only when the box
        // did not react: dropzones that read both (react-dropzone, Dropzone.js) would upload the file twice.
        if (hasDropzone) {
            await sleep(400);
            watcher?.disconnect();
            if (reacted) return true;
            try {
                const dropEvent = new DragEvent("drop", {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    dataTransfer: dt
                });
                containerEl.dispatchEvent(dropEvent);
            } catch { }
        }

        return true;
    } catch (err) {
        console.error("[Aullevo] File injection failed:", err);
        return false;
    }
}

export function injectFileIntoInput(
    inputEl: HTMLInputElement,
    fileObj: { fileName: string; mimeType: string; dataBase64: string }
): boolean {
    if (!inputEl) return false;

    try {
        // 1. Decode base64 string to byte array
        const base64Data = fileObj.dataBase64.replace(/^data:[^;]+;base64,/, "");
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        // 2. Create native File object
        const file = new File([bytes], fileObj.fileName, {
            type: fileObj.mimeType || "application/pdf"
        });

        // 3. Populate FileList via DataTransfer
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        inputEl.files = dataTransfer.files;

        // 4. Dispatch synthetic events for React, Vue, Angular, and vanilla forms
        inputEl.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        inputEl.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

        return true;
    } catch (err) {
        console.error("[Aullevo] File injection failed on input:", err);
        return false;
    }
}

export async function typeTextStealth(
    element: HTMLElement,
    value: string,
    charDelayMs: number = 35
): Promise<void> {
    if (!element) return;
    const strValue = String(value ?? "");
    try { element.focus(); } catch { }
    try {
        element.dispatchEvent(new FocusEvent("focus", { bubbles: true, composed: true }));
        element.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
    } catch { }
    if (charDelayMs <= 0) {
        setNativeInputValue(element, strValue);
        return;
    }
    const tagName = element.tagName.toUpperCase();
    const isTextArea = tagName === "TEXTAREA" || element instanceof HTMLTextAreaElement;
    const isInput = tagName === "INPUT" || element instanceof HTMLInputElement;
    const isNative = isInput || isTextArea;
    if (element.isContentEditable || element.getAttribute("contenteditable") === "true") {
        // Typed like a person (word by word: an editor re-renders on every insert, so long answers stay quick)
        const words = strValue.match(/\S+\s*|\s+/g) || [];
        let typed = insertEditableText(element, "", true);
        for (const word of words) {
            if (!typed || !insertEditableText(element, word, false)) {
                typed = false;
                break;
            }
            await sleep(getJitteredDelay(charDelayMs * 2));
        }
        if (!typed) {
            element.innerText = strValue;
            element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        }
        element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        return;
    }
    const inputEl = element as HTMLInputElement | HTMLTextAreaElement;
    const prototype = isTextArea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const valueDescriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    let currentTyped = "";
    if (isNative && valueDescriptor?.set) {
        valueDescriptor.set.call(element, "");
    } else {
        try { inputEl.value = ""; } catch { }
    }
    if ((inputEl as any)._valueTracker) {
        (inputEl as any)._valueTracker.setValue("___clear___");
    }
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    for (let i = 0; i < strValue.length; i++) {
        const char = strValue[i];
        const prevValue = currentTyped;
        currentTyped += char;
        if (isNative && valueDescriptor?.set) {
            try {
                valueDescriptor.set.call(element, currentTyped);
            } catch {
                inputEl.value = currentTyped;
            }
        } else {
            try { (element as any).value = currentTyped; } catch { }
        }
        if ((inputEl as any)._valueTracker) {
            (inputEl as any)._valueTracker.setValue(prevValue);
        }
        try {
            element.dispatchEvent(new KeyboardEvent("keydown", { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true }));
            element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
            element.dispatchEvent(new KeyboardEvent("keyup", { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true }));
        } catch { }
        const isPauseChar = /[\s,.\-!?;:]/.test(char);
        const delay = isPauseChar
            ? getJitteredDelay(charDelayMs * 1.5)
            : getJitteredDelay(charDelayMs);
        await sleep(delay);
    }
    try {
        element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        element.dispatchEvent(new FocusEvent("blur", { bubbles: true, composed: true }));
        element.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
    } catch { }
}


// True while Aullevo clicks a box itself: Chrome marks the change event a native .click()
// fires as trusted, and it must not be taken for the user's own edit
let aullevoClicking = false;

/**
 * Toggles a radio button or checkbox control to the target checked state.
 * Universal across standard HTML, Google Forms, Microsoft Forms, and modern custom cards.
 */
export function toggleChoiceControl(control: HTMLElement, choiceType: "radio" | "checkbox", targetChecked: boolean = true): boolean {
    if (fillCancelled) return false;
    aullevoClicking = true;
    try {
        return toggleChoiceControlNow(control, choiceType, targetChecked);
    } finally {
        aullevoClicking = false;
    }
}

function toggleChoiceControlNow(control: HTMLElement, choiceType: "radio" | "checkbox", targetChecked: boolean): boolean {
    if (!control) return false;

    // 1. Resolve actual interactive element if a container was passed
    const realControl = control.getAttribute("role") === "radio" ||
        control.getAttribute("role") === "checkbox" ||
        control.tagName === "INPUT" ||
        control.tagName === "BUTTON"
        ? control
        : (control.querySelector<HTMLElement>("[role='radio'], [role='checkbox'], input[type='radio'], input[type='checkbox'], button") || control);

    const currentlyChecked = isControlChecked(realControl);

    // If checkbox and already checked, do not click (prevent deselecting)
    if (choiceType === "checkbox" && currentlyChecked === targetChecked) {
        return true;
    }

    try {
        realControl.scrollIntoView({ behavior: "instant", block: "nearest" });
    } catch { }

    const nativeInput = (realControl.tagName === "INPUT" ? realControl : realControl.querySelector("input[type='checkbox'], input[type='radio']")) as HTMLInputElement | null;

    // [FIX: Label-wrapped checkboxes ending up unticked]
    // A native box flips on every click. Presetting .checked and then clicking its <label>
    // (plus the label/input fallback clicks below) flipped <label><input type="checkbox">…</label>
    // an even number of times, so the box was left unticked while the badge said "✓".
    // One native click is what a person does: it flips the box once and fires the page's own
    // click/input/change handlers (React included).
    if (nativeInput && nativeInput.checked !== targetChecked && !nativeInput.disabled) {
        nativeInput.click();
        if (nativeInput.checked === targetChecked) {
            if (realControl !== nativeInput && (realControl.getAttribute("role") === "radio" || realControl.getAttribute("role") === "checkbox")) {
                realControl.setAttribute("aria-checked", String(targetChecked));
            }
            return true;
        }
    }

    // 2. Native HTML input updates (for React / standard forms)
    if (nativeInput && nativeInput.checked !== targetChecked) {
        nativeInput.checked = targetChecked;
        if (nativeInput.hasAttribute("aria-checked")) {
            nativeInput.setAttribute("aria-checked", String(targetChecked));
        }
        if ((nativeInput as any)._valueTracker) {
            (nativeInput as any)._valueTracker.setValue(!targetChecked);
        }
        nativeInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        nativeInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }

    // 3. Find associated label, Google Forms container, or MS Forms / custom choice card
    let clickableTarget: HTMLElement | null = null;
    if (realControl.id) {
        try {
            clickableTarget = document.querySelector<HTMLElement>(`label[for="${CSS.escape(realControl.id)}"]`);
        } catch { }
    }
    if (!clickableTarget) {
        clickableTarget = realControl.closest("label") ||
            realControl.closest(".docssharedWizToggleLabeledContainer")?.querySelector<HTMLElement>(".docssharedWizToggleLabeledLabelText, .aDTYNe") ||
            realControl.closest<HTMLElement>("[data-automation-id='choiceItem'], [data-automation-id*='choice' i], [data-qa*='choice'], .form-radio-item, .form-checkbox-item, .office-form-question-choice-row, .choice-item") ||
            (control !== realControl ? control : null) ||
            realControl.parentElement?.querySelector("label") || null;
    }

    // 4. Click the clickable target first (How humans click choices across all platforms)
    let clickWorked = false;

    if (clickableTarget) {
        dispatchSinglePointerClick(clickableTarget);
        try {
            if (typeof clickableTarget.click === "function") clickableTarget.click();
        } catch { }

        // [GUARD: Prevent Double-Toggle]
        // If clicking the container/label already put the control in the target state,
        // STOP here — do NOT click realControl!
        const checkedAfterTargetClick = isControlChecked(realControl);
        if (checkedAfterTargetClick === targetChecked) {
            clickWorked = true;
        }
    }

    // 5. Fallback click on realControl ONLY if clicking the container didn't do the job
    // (Handles standalone buttons, stars, ratings, or inputs without wrapper containers)
    if (!clickWorked) {
        dispatchSinglePointerClick(realControl);
    }

    // 6. Update ARIA state for custom framework buttons (Radix, MUI, etc.)
    if (realControl.getAttribute("role") === "radio" || realControl.getAttribute("role") === "checkbox" || realControl.hasAttribute("data-state")) {
        realControl.setAttribute("aria-checked", String(targetChecked));
        realControl.setAttribute("data-state", targetChecked ? "checked" : "unchecked");
    }

    return true;
}


/**
 * Matches and selects the best option in a native HTML <select> dropdown.
 *
 * [FIX: Workday / React <select> Dropdowns Not Updating Visually]
 * Previously, we set element.value and bestOption.selected directly, then
 * dispatched change/input events. This works for plain HTML forms, but NOT
 * for React-controlled <select> elements (like Workday's "Job level" and
 * "Functional role" dropdowns).
 *
 * React wraps the native value setter to track state changes internally.
 * When we set .value directly, React's internal state stays stale. On the
 * next re-render, React resets the <select> back to its old value — making
 * it look like our fill didn't work (even though the badge showed success).
 *
 * The fix mirrors what we do in setNativeInputValue for text inputs:
 *   1. Use HTMLSelectElement.prototype.value setter via .call() to bypass
 *      React's wrapper and set the raw DOM value
 *   2. Reset _valueTracker so React sees our "input" event as a real change
 *   3. Dispatch both "input" and "change" events with bubbles: true
 */
export function fillSelectElement(element: HTMLSelectElement, value: any, matchedAlias: string = ""): boolean | string {
    if (!element || !element.options) return false;
    const options = Array.from(element.options);
    const targetValues = parseTargetValues(value);

    // Multi-select dropdown
    if (element.multiple) {
        let matchedAny = false;
        for (const opt of options) {
            const optText = opt.text || opt.value || "";
            const matches = targetValues.some(targetVal => computeChoiceMatchScore(targetVal, optText) >= 0.60);
            if (matches) {
                opt.selected = true;
                matchedAny = true;
            }
        }
        // [FIX] Use React-compatible event dispatch for multi-select too
        commitSelectValue(element);
        return matchedAny ? (element.selectedOptions ? Array.from(element.selectedOptions).map(o => o.text).join(", ") : true) : false;
    }

    // Single-select dropdown
    const candidates = [...targetValues];
    if (!candidates.includes(String(value).trim())) {
        candidates.push(String(value).trim());
    }

    if (matchedAlias) {
        candidates.sort((a, b) => {
            const scoreA = computeStringSimilarity(matchedAlias, a);
            const scoreB = computeStringSimilarity(matchedAlias, b);
            return scoreB - scoreA;
        });
    }

    let bestOption: HTMLOptionElement | null = null;
    let bestScore = 0;
    let appliedText = "";

    for (const cand of candidates) {
        const normCand = cleanText(cand);
        if (!normCand) continue;

        for (const opt of options) {
            const optTextRaw = (opt.text || "").trim();
            const optValRaw = (opt.value || "").trim();
            const normOptText = cleanText(optTextRaw);
            const normOptVal = cleanText(optValRaw);

            // Skip placeholder options (e.g. "-- Select role --", "Choose", "Select level")
            if ((!optValRaw || /^(select|choose|please select|select an option|select level|select role|none|--)$/i.test(normOptText.replace(/^--\s*|\s*--$/g, ""))) && normCand !== normOptText) {
                continue;
            }

            // 1. Exact match
            if (normOptText === normCand || normOptVal === normCand) {
                bestOption = opt;
                bestScore = 1.0;
                appliedText = optTextRaw || cand;
                break;
            }

            // 2. Exact digit match (e.g. "4th Year" matches value "4")
            const candDigits = cand.match(/\b\d+\b/);
            if (candDigits && optValRaw === candDigits[0]) {
                const s = 0.96;
                if (s > bestScore) {
                    bestScore = s;
                    bestOption = opt;
                    appliedText = optTextRaw || cand;
                }
            }

            // 3. String similarity
            const score = Math.max(
                computeChoiceMatchScore(cand, optTextRaw),
                computeStringSimilarity(cand, optTextRaw),
                computeStringSimilarity(cand, optValRaw)
            );

            if (score > bestScore) {
                bestScore = score;
                bestOption = opt;
                appliedText = optTextRaw || cand;
            }
        }

        if (bestScore >= 0.90) break;
    }

    if (bestOption && bestScore >= 0.45) {
        // [FIX] Use React-compatible prototype setter to set the selected value.
        // This is critical for React-controlled <select> elements (Workday, HubSpot, etc.)
        // where direct .value assignment gets overridden on the next re-render.
        const previousValue = element.value;
        bestOption.selected = true;

        // Use the prototype setter to bypass React's value wrapper
        const selectProto = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value");
        try {
            if (selectProto && selectProto.set) {
                selectProto.set.call(element, bestOption.value);
            } else {
                element.value = bestOption.value;
            }
        } catch {
            element.value = bestOption.value;
        }

        // Reset React's _valueTracker so React's onChange fires correctly.
        // Without this, React thinks the value hasn't changed and ignores
        // our synthetic "change" event — leaving the dropdown display stale.
        if ((element as any)._valueTracker) {
            (element as any)._valueTracker.setValue(previousValue);
        }

        // Commit the value with events
        commitSelectValue(element);
        return appliedText || bestOption.text || bestOption.value;
    }

    return false;
}

/**
 * Dispatches the full event sequence needed for a <select> value change
 * to register across all frameworks (React, Vue, Angular, Svelte, vanilla).
 *
 * React specifically requires:
 *   - "input" event with bubbles:true (triggers React's onChange handler)
 *   - "change" event with bubbles:true (fallback for older React versions)
 *
 * Angular requires:
 *   - "change" event (triggers ngModelChange)
 *
 * Vue requires:
 *   - "change" event (triggers v-model update)
 *
 * We also dispatch focus/blur to ensure validation runs on the new value.
 */
function commitSelectValue(element: HTMLSelectElement): void {
    try { element.focus(); } catch { }
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    try {
        element.dispatchEvent(new FocusEvent("blur", { bubbles: true, composed: true }));
        element.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
    } catch { }
    try { element.blur(); } catch { }
}

/**
 * Master value applicator router across text, choice, date, and select controls
 */
export async function applyValueToControl(
    element: HTMLElement,
    value: any,
    matchedAlias: string = "",
    speedConfig: SpeedConfig = { charDelayMs: 0, actionDelayMs: 0 },
    // The value was written for this field (an AI answer): never pick one part of an "A / B" value
    exact: boolean = false
): Promise<boolean | string> {
    if (!element || fillCancelled) return false;

    // Check for Google Forms 3-part split date field in parent question card
    const googleCard = element.closest<HTMLElement>(".geS5n, .Qr7Oae, [role='listitem']");
    if (googleCard && isDateValue(value)) {
        const splitFilled = fillGoogleSplitDate(googleCard, value);
        if (splitFilled) return true;
    }

    const tagName = element.tagName.toUpperCase();
    const inputType = ((element as HTMLInputElement).type || element.getAttribute("type") || "").toLowerCase();
    const role = (element.getAttribute("role") || "").toLowerCase();
    const classList = (element.className || "").toString();

    if (tagName === "SELECT") {
        return fillSelectElement(element as HTMLSelectElement, value, matchedAlias);
    } else if (isCalendarTrigger(element)) {
        return fillCalendarPicker(element, value);
    } else if (
        inputType === "radio" || inputType === "checkbox" ||
        role === "radio" || role === "checkbox" ||
        classList.includes("docssharedWizToggleLabeledContainer") ||
        classList.includes("form-radio-item") ||
        classList.includes("form-checkbox-item")
    ) {
        const isRadio = inputType === "radio" || role === "radio" || classList.includes("radio");
        return toggleChoiceControl(element, isRadio ? "radio" : "checkbox", true);
    } else if (inputType === "date" || inputType === "datetime-local" || inputType === "month") {
        // These inputs only accept one exact format; anything else is rejected with a console warning
        const isoDate = normalizeDateForInput(value);
        if (!isoDate) {
            console.info(`[Aullevo] Skipped ${inputType} field: "${String(value)}" is not a date.`);
            return false;
        }
        const time = String(value).match(/T?(\d{2}:\d{2})/)?.[1] || "00:00";
        const formatted = inputType === "month" ? isoDate.slice(0, 7)
            : inputType === "datetime-local" ? `${isoDate}T${time}`
            : isoDate;
        setNativeInputValue(element, formatted);
        return (element as HTMLInputElement).value || false;
    } else {
        let resolvedValue = exact ? String(value ?? "") : resolveBestTextCandidate(value, matchedAlias, element);

        // Auto-adapt date format if input is a date field (e.g. MS Forms M/d/yyyy)
        const placeholder = ((element as HTMLInputElement).placeholder || "").toLowerCase();
        const isDateInput = element.getAttribute("data-automation-id") === "dateInput" || /date/i.test(placeholder);

        if (isDateInput && isDateValue(resolvedValue)) {
            const dateStr = String(resolvedValue).trim();
            const slashMatch = dateStr.match(/^(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{4})$/);
            if (slashMatch) {
                const n1 = parseInt(slashMatch[1], 10);
                const n2 = parseInt(slashMatch[2], 10);
                const yr = slashMatch[3];
                // If n1 > 12 (like 20/11/2003), day=20, month=11
                const day = n1 > 12 ? n1 : (n2 > 12 ? n2 : n1);
                const month = n1 > 12 ? n2 : (n2 > 12 ? n1 : n2);

                if (/m\s*[\/\-\.]\s*d\s*[\/\-\.]\s*y/i.test(placeholder) || element.getAttribute("data-automation-id") === "dateInput") {
                    resolvedValue = `${month}/${day}/${yr}`;
                } else if (/d\s*[\/\-\.]\s*m\s*[\/\-\.]\s*y/i.test(placeholder)) {
                    resolvedValue = `${day}/${month}/${yr}`;
                }
            }
        }

        // Respect the input's own rules: "5 years" into a number-only box becomes "5"
        const inputRules = readFormatFromControl(element);
        if (inputRules.numeric || inputRules.digitsOnly || inputRules.maxLength) {
            resolvedValue = conformValue(String(resolvedValue), inputRules) || resolvedValue;
        }

        // "+63 985 304 7403" into a phone box with a country picker beside it: the picker says Philippines too
        if (element instanceof HTMLInputElement && /^\s*\+\s*\d/.test(String(resolvedValue))) {
            await syncPhoneCountry(element, String(resolvedValue));
        }

        if (speedConfig.charDelayMs > 0) {
            await typeTextStealth(element, resolvedValue, speedConfig.charDelayMs);
        } else {
            setNativeInputValue(element, resolvedValue);
        }
        return resolvedValue;
    }

}

/**
 * Automatically reorders items in a Microsoft Forms ranking question.
 * Supports:
 *   - Single top pick: e.g. "Hard" -> moves "Hard" to #1 (top)
 *   - Ordered list: e.g. "Hard, Medium, Easy" or "Hard > Medium > Easy" -> arranges in exact order
 */
export async function fillMicrosoftRankingQuestion(
    card: HTMLElement,
    targetValue: string
): Promise<boolean> {
    if (!card || !targetValue) return false;

    // 1. Parse desired order tokens
    const rawTokens = targetValue.includes(">")
        ? targetValue.split(">")
        : targetValue.includes(",")
            ? targetValue.split(",")
            : targetValue.includes(";")
                ? targetValue.split(";")
                : [targetValue];

    const tokens = rawTokens.map(t => cleanText(t)).filter(Boolean);
    if (tokens.length === 0) return false;

    // Helper to get all ranking cards using the exact MS Forms .rank-item class
    function getRankingItems(): HTMLElement[] {
        return Array.from(card.querySelectorAll<HTMLElement>(
            ".rank-item, [class*='rank-item'], [data-automation-id='choiceItem']"
        ));
    }

    // Helper to get clean card text (excluding buttons)
    function getItemText(item: HTMLElement): string {
        const clone = item.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("button, svg, i").forEach(b => b.remove());
        return cleanText(clone.innerText || clone.textContent || "");
    }

    // In MS Forms, the first button is ALWAYS the UP arrow
    function getUpButton(item: HTMLElement): HTMLElement | null {
        const buttons = Array.from(item.querySelectorAll<HTMLElement>("button"));
        return buttons.length >= 1 ? buttons[0] : null;
    }

    let movedAny = false;

    // Arrange each token into its position (token 0 -> index 0, token 1 -> index 1, etc.)
    for (let targetIndex = 0; targetIndex < tokens.length; targetIndex++) {
        const targetText = tokens[targetIndex];
        let currentItems = getRankingItems();

        // Find the card matching this target
        let foundIndex = -1;
        for (let i = 0; i < currentItems.length; i++) {
            const itemText = getItemText(currentItems[i]);
            if (itemText === targetText || itemText.includes(targetText) || targetText.includes(itemText) || computeStringSimilarity(itemText, targetText) >= 0.70) {
                foundIndex = i;
                break;
            }
        }

        if (foundIndex === -1) continue;

        // Click the UP button repeatedly until the item reaches targetIndex
        let safetyCount = 0;
        while (foundIndex > targetIndex && safetyCount < 10) {
            safetyCount++;
            currentItems = getRankingItems();
            const currentItem = currentItems[foundIndex];
            if (!currentItem) break;

            const upButton = getUpButton(currentItem);

            if (upButton) {
                try { upButton.focus(); } catch { }
                dispatchSinglePointerClick(upButton);
                try { if (typeof upButton.click === "function") upButton.click(); } catch { }
                movedAny = true;
                await sleep(250); // Wait for MS Forms DOM swap animation
                currentItems = getRankingItems();

                foundIndex = currentItems.findIndex(el => {
                    const t = getItemText(el);
                    return t === targetText || computeStringSimilarity(t, targetText) >= 0.70;
                });
            } else {
                break;
            }
        }
    }

    return movedAny;
}



// LAYER 3: Visual and higlighting engine & badges
// Injects a self contained CSS style sheet in to the webpage
// uses outline instead of borderr so the webpage layout does not shift itself.
function injectHighlightStylesToRoot(root: Document | ShadowRoot) {
    const styleId = "aullevo-highlight-styles";
    if (root.querySelector(`#${styleId}`)) return;
    const styleEl = document.createElement("style");
    styleEl.id = styleId;
    styleEl.textContent = `
        /* Non-destructive blue outline with smooth fade */
        .aullevo-inspected-field {
            outline: 2px dashed #4e73f5ff !important;
            outline-offset: 3px !important;
            position: relative !important;
            transition: outline 0.3s ease-in-out !important;
        }
        .aullevo-inspected-field:hover {
            outline-color: #4e73f5ff !important;
            outline-width: 3px !important;
        }
        /* Floating Pill Badge */
        .aullevo-field-badge {
            position: absolute !important;
            top: 50% !important;                        
            transform: translateY(-50%) !important;    
            right: 10px !important;  
            background: linear-gradient(135deg, #84a5ffff, #4e73f5ff) !important;
            color: #ffffff !important;
            font-size: 11px !important;
            font-weight: 700 !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
            padding: 2px 8px !important;
            border-radius: 6px !important;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25) !important;
            pointer-events: none !important;
            z-index: 2147483640 !important;
            white-space: nowrap !important;
            line-height: 1.4 !important;
            opacity: 1 !important;
            transition: opacity 0.4s ease, transform 0.4s ease !important;
        }
        /* Smooth fade-out class */
        .aullevo-badge-fading {
            opacity: 0 !important;
            transform: translateY(-50%) scale(0.92) !important;
        }
        /* Auto-pagination: question that stops the run */
        .aullevo-needs-input {
            outline: 2px solid #ef4444 !important;
            outline-offset: 3px !important;
        }
        .aullevo-blocker-badge {
            position: absolute !important;
            top: 4px !important;
            right: 8px !important;
            background: #dc2626 !important;
            color: #ffffff !important;
            font-size: 11px !important;
            font-weight: 700 !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
            padding: 2px 8px !important;
            border-radius: 6px !important;
            box-shadow: 0 2px 8px rgba(220, 38, 38, 0.35) !important;
            pointer-events: none !important;
            z-index: 2147483640 !important;
            white-space: nowrap !important;
            line-height: 1.4 !important;
        }
    `;

    if (root instanceof Document) {
        (root.head || root.documentElement || root.body).appendChild(styleEl);
    } else {
        root.appendChild(styleEl);
    }
}

// extract text from any DOM element.
//  uses. inner to preserve natiural spaces betweeen child spans/tags across frameworks. 
function getCleanElementText(el: HTMLElement | null | undefined): string {
    if (!el) return "";
    return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
}

// Extract a human-readable title for any field (Google, MS Forms, & Nonstandard)
function extractFieldLabel(el: HTMLElement): string {
    const type = (el.getAttribute("type") || "").toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();
    const isChoice = type === "radio" || type === "checkbox" || role === "radio" || role === "checkbox";

    // CASE A: Radios, Checkboxes, and Scales (React, Vue, Google, MS Forms)

    if (isChoice) {
        // 1. Check data-value attribute (Used by scales & rating groups: "1", "2", "3")
        const dataVal = el.getAttribute("data-value");
        if (dataVal) return `Option: "${dataVal.trim()}"`;
        // 2. Standard HTML <label for="elementId">
        if (el.id) {
            const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            if (labelEl && labelEl.textContent?.trim()) {
                return `Option: "${labelEl.textContent.trim().substring(0, 30)}"`;
            }
        }
        // 3. Parent / Enclosing <label> tag
        const parentLabel = el.closest("label");
        if (parentLabel) {
            const clone = parentLabel.cloneNode(true) as HTMLElement;
            clone.querySelectorAll("input, select, textarea, button").forEach(sub => sub.remove());
            const text = (clone.textContent || "").trim().replace(/\s+/g, ' ');
            if (text) return `Option: "${text}"`;
        }
        // 4. Framework & Platform Specific Option Text:
        // - Google Forms: .aDTYNe, .docssharedWizToggleLabeledLabelText
        // - Microsoft Forms: [data-automation-id='choiceLabel']
        // - React / Vue / Bootstrap: .form-check-label, .v-label, .ant-radio-wrapper
        const choiceContainer = el.closest(
            ".docssharedWizToggleLabeledContainer, [data-automation-id='choiceItem'], .form-check, .v-radio, .v-checkbox, [role='listitem'], [class*='pwyvhm']"
        );
        if (choiceContainer) {
            const optLabel = choiceContainer.querySelector(
                ".aDTYNe, .docssharedWizToggleLabeledLabelText, [data-automation-id='choiceLabel'], .form-check-label, span[dir='auto']"
            );
            if (optLabel && optLabel.textContent?.trim()) {
                return `Option: "${optLabel.textContent.trim().substring(0, 30)}"`;
            }
        }
        // 5. Next Sibling Text (Common in React / Vue custom checkboxes)
        let sib = el.nextElementSibling;
        while (sib) {
            const sibText = (sib.textContent || "").trim();
            if (sibText && sibText.length <= 40) {
                return `Option: "${sibText}"`;
            }
            sib = sib.nextElementSibling;
        }
        // 6. Direct aria-label or value
        const ariaLabel = el.getAttribute("aria-label");
        if (ariaLabel) return `Option: "${ariaLabel.trim().substring(0, 30)}"`;
        const val = (el as HTMLInputElement).value;
        if (val && val !== "on") return `Option: "${val.trim().substring(0, 30)}"`;
        const choiceText = resolveChoiceText(el);
        return `Option: "${choiceText ? choiceText.substring(0, 30) : "Choice"}"`;


    }

    // CASE B: Text Inputs, Textareas, Dropdowns, Date/Time
    // 0. Detect CAPTCHAs & Security Verification (Cloudflare, reCAPTCHA, hCaptcha)
    const src = (el.getAttribute("src") || "").toLowerCase();
    const title = (el.getAttribute("title") || "").toLowerCase();
    const idAndClass = (el.id + " " + el.className).toLowerCase();

    // Cloudflare Turnstile & Ray ID Challenges

    if (
        src.includes("cloudflare") ||
        src.includes("challenge-platform") ||
        title.includes("cloudflare") ||
        title.includes("challenge") ||
        idAndClass.includes("turnstile") ||
        idAndClass.includes("challenge") ||
        idAndClass.includes("cf-")
    ) {
        return `Security: "Cloudflare Turnstile"`;
    }

    // Google reCAPTCHA
    if (src.includes("recaptcha") || idAndClass.includes("recaptcha") || el.hasAttribute("data-sitekey")) {
        return `Security: "Google reCAPTCHA"`;
    }

    // hCaptcha
    if (src.includes("hcaptcha") || idAndClass.includes("hcaptcha")) {
        return `Security: "hCaptcha"`;
    }

    // 1. Time & Date sub-inputs (Hour, Minute, Day, Month)
    const ariaLabel = el.getAttribute("aria-label") || "";
    if (/hour|minute|day|month|year/i.test(ariaLabel)) {
        return `Field: "${ariaLabel.trim()}"`;
    }

    // 2. Standard HTML <label for="elementId">
    if (el.id) {
        const labelEl = document.querySelector<HTMLElement>(`label[for="${CSS.escape(el.id)}"]`);
        const text = getCleanElementText(labelEl);
        if (text) return `Field: "${text.substring(0, 45)}"`;
    }

    // 3. Parent / Enclosing <label> tag
    const parentLabel = el.closest("label") as HTMLElement | null;
    const parentText = getCleanElementText(parentLabel);
    if (parentText) return `Field: "${parentText.substring(0, 45)}"`;

    // 4. NONSTANDARD COMPANY FORMS (Immediate sibling label or parent group label)
    const prev = el.previousElementSibling as HTMLElement | null;
    const prevText = getCleanElementText(prev);
    if (prevText && prevText.length >= 2 && prevText.length <= 45) {
        return `Field: "${prevText}"`;
    }

    const parentBox = el.parentElement;
    if (parentBox && parentBox.tagName !== "BODY" && parentBox.tagName !== "FORM") {
        const localLabel = parentBox.querySelector<HTMLElement>("label, [class*='label' i], [class*='title' i]");
        if (localLabel && localLabel !== el && !localLabel.contains(el)) {
            const text = getCleanElementText(localLabel);
            if (text && text.length >= 2 && text.length <= 45) {
                return `Field: "${text}"`;
            }
        }
    }

    // 5. Table Cell Header (e.g. schedules, availability, employment background tables)
    const td = el.closest("td");
    if (td) {
        const colIndex = (td as HTMLTableCellElement).cellIndex;
        const th = td.closest("table")?.querySelectorAll("tr th")?.[colIndex] as HTMLElement | undefined;
        const thText = getCleanElementText(th);
        if (thText) return `Field: "${thText.substring(0, 40)}"`;
    }

    // 6. Multi-platform question headers:
    // - Google Forms: .geS5n, .Qr7Oae (.M7eMe)
    // - Workday: [data-automation-id='formField']
    // - Standard HTML: <fieldset><legend>
    const questionCard = el.closest(
        ".geS5n, .Qr7Oae, [data-automation-id='questionItem'], .office-form-question, [data-automation-id='formField'], fieldset, [role='listitem']"
    );
    if (questionCard) {
        const titleEl = questionCard.querySelector<HTMLElement>(
            ".M7eMe, [data-automation-id='questionTitle'], .office-form-question-title, [role='heading'], legend, [data-automation-id='formLabel']"
        );
        const cardTitle = getCleanElementText(titleEl);
        if (cardTitle) return `Field: "${cardTitle.substring(0, 45)}"`;
    }

    // 6.5 The label of the field's own block (custom dropdowns, rich text editors)
    const wrapperLabel = findWrapperLabel(el);
    if (wrapperLabel) return `Field: "${wrapperLabel.substring(0, 45)}"`;

    // 7. Placeholder or aria-label
    if (ariaLabel) return `Field: "${ariaLabel.trim().substring(0, 35)}"`;
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return `Field: "${placeholder.trim().substring(0, 35)}"`;

    // 8. Name attribute fallback
    const nameAttr = el.getAttribute("name");
    if (nameAttr) return `Field: "${nameAttr.trim()}"`;
    return `Field: "${el.tagName.toLowerCase()}"`;
}


/**
 * Discovers the enclosing row or field container so the outline 
 * hugs the entire question/input unit (Workaday, Google, MS Forms, Bootstrap).
 */
function findOptionRowContainer(el: HTMLElement): HTMLElement {
    if (!el) return el;

    const row = el.closest<HTMLElement>([
        "._242qvk0",                              // Workday Canvas / modern web
        "[class*='pwyvhm']",                      // Workday Canvas
        ".form-check",                            // Bootstrap checkboxes/radios
        ".custom-control",                        // Custom checkbox frameworks
        ".choice-item",                           // Survey/form choices
        ".form-radio-item",                       // JotForm / Zoho
        ".form-checkbox-item",                    // JotForm / Zoho
        ".docssharedWizToggleLabeledContainer",  // Google Forms choices
        "[data-automation-id='choiceItem']",      // Microsoft Forms choices
        "li",
        "tr",
        "label"
    ].join(", "));

    if (row && row !== document.body && row !== document.documentElement) {
        return row;
    }

    return (el.parentElement as HTMLElement) || el;
}

// addvs visual outline and floating badge to each detected element.
function applyHighlightsToElements(elements: HTMLElement[]) {
    // 1. Inject styles into main document AND every shadow root containing highlighted elements
    const rootsToStyle = new Set<Document | ShadowRoot>();
    rootsToStyle.add(document);

    elements.forEach((el) => {
        const root = el.getRootNode();
        if (root instanceof ShadowRoot) {
            rootsToStyle.add(root);
        }
    });
    rootsToStyle.forEach((root) => injectHighlightStylesToRoot(root));

    // 2. Apply outlines and badges using the Row Container
    elements.forEach((el) => {
        // Step 1: Find the full field/row box
        const targetContainer = findOptionRowContainer(el);
        // Step 2: Put the dashed outline on the entire row box
        targetContainer.classList.add("aullevo-inspected-field");
        // Step 3: Create and attach the badge
        const badge = document.createElement("div");
        badge.className = "aullevo-field-badge";
        const labelText = extractFieldLabel(el);
        badge.textContent = labelText;
        targetContainer.appendChild(badge);
    });
}

// clears all outlines and removes all badges from the page.
export function clearAllHighlights() {
    const allRoots = getAllDOMRoots();
    allRoots.forEach((root) => {
        root.querySelectorAll(".aullevo-inspected-field").forEach((el) => {
            el.classList.remove("aullevo-inspected-field");
        });
        root.querySelectorAll(".aullevo-field-badge").forEach((badge) => {
            badge.remove();
        });

    });
}

/**
 * Highlights a single filled element with an outline and confirmation badge,
 * and automatically fades and removes it after 4 seconds to keep the UI clean.
 */
export function highlightFilledElement(el: HTMLElement, badgeText: string = ct("filled")): void {
    const root = (el.getRootNode ? el.getRootNode() : document) as Document | ShadowRoot;
    injectHighlightStylesToRoot(root);

    const targetContainer = findOptionRowContainer(el);
    targetContainer.classList.add("aullevo-inspected-field");

    let badge = targetContainer.querySelector<HTMLElement>(".aullevo-field-badge");
    if (!badge) {
        badge = document.createElement("div");
        badge.className = "aullevo-field-badge";
        targetContainer.appendChild(badge);
    }
    badge.textContent = `✓ ${badgeText}`;

    // Auto-fade and remove outline & badge after 3.8 - 4.2 seconds
    sleep(3800).then(() => {
        if (badge) {
            badge.classList.add("aullevo-badge-fading");
        }
        targetContainer.classList.remove("aullevo-inspected-field");
        return sleep(400);
    }).then(() => {
        badge?.remove();
    });
}


// ============================================================================
// STEP 5: GOOGLE FORMS SPLIT DATES & CUSTOM DROPDOWN ENGINE
// (Ported directly from injectToGoogle/content.js lines 1212-1785 & 2065-2085)
// ============================================================================

/**
 * Closes any stray active dropdown popup or blur active listbox
 */
export function closeAnyOpenDropdown(): void {
    try {
        const activeEl = document.activeElement as HTMLElement | null;
        if (activeEl && (activeEl.getAttribute("role") === "listbox" || activeEl.getAttribute("role") === "option")) {
            activeEl.blur();
        }
    } catch { }
}

/**
 * Google Forms 3-Part Split Date Field Handler (Day, Month, Year sub-inputs)
 */
export function fillGoogleSplitDate(container: HTMLElement, value: any): boolean {
    const isoDate = normalizeDateForInput(value);
    if (!isoDate || !isoDate.includes("-")) return false;
    const parts = isoDate.split("-");
    const year = parts[0];
    const month = parts[1];
    const day = parts[2];

    const dayInput = container.querySelector<HTMLElement>("input[aria-label*='Day' i], input[aria-label*='Araw' i], input[data-initial-value='Day']");
    const monthInput = container.querySelector<HTMLElement>("input[aria-label*='Month' i], input[aria-label*='Buwan' i], input[data-initial-value='Month']");
    const yearInput = container.querySelector<HTMLElement>("input[aria-label*='Year' i], input[aria-label*='Taon' i], input[data-initial-value='Year']");

    if (dayInput && monthInput && yearInput) {
        setNativeInputValue(dayInput, day);
        setNativeInputValue(monthInput, month);
        setNativeInputValue(yearInput, year);
        return true;
    }
    return false;
}

// ----------------------------------------------------------------------------
// Calendar date pickers (flatpickr, react-datepicker, MUI...): a button or read-only box that only
// takes a date picked from its calendar. Their day cells name their date ("October 6, 2026").
// ----------------------------------------------------------------------------

const CALENDAR_TRIGGER_SELECTOR = ".flatpickr-input:not([type='hidden']), [mwlflatpickr], .react-datepicker__input-container input, [aria-haspopup='dialog'][class*='date' i]";
// Parts of an open calendar: never questions of their own (the "Year" box inside flatpickr)
const CALENDAR_POPUP_SELECTOR = ".flatpickr-calendar, .react-datepicker, .react-datepicker-popper, .MuiDateCalendar-root, .MuiPickersLayout-root, .ui-datepicker, .datepicker-dropdown";
const CALENDAR_DAY_SELECTOR = ".flatpickr-day, .react-datepicker__day, .MuiPickersDay-root, [role='gridcell'], td[data-date], button[name='day']";
const CALENDAR_NEXT_SELECTOR = ".flatpickr-next-month, .react-datepicker__navigation--next, [aria-label*='next month' i], [title*='next month' i]";
const CALENDAR_PREV_SELECTOR = ".flatpickr-prev-month, .react-datepicker__navigation--previous, [aria-label*='previous month' i], [title*='previous month' i]";

function isCalendarTrigger(el: HTMLElement): boolean {
    if (el.matches(CALENDAR_TRIGGER_SELECTOR)) return true;
    // A read-only box that calls itself a date picker
    return el instanceof HTMLInputElement && el.readOnly &&
        /date|calendar/i.test(`${el.className} ${el.placeholder} ${el.name}`);
}

// "Choose Tuesday, October 6th, 2026" / "October 6, 2026" / "2026-10-06" -> "2026-10-06"; "" when no date
function readCalendarDayDate(cell: HTMLElement): string {
    const raw = cell.getAttribute("aria-label") || cell.getAttribute("data-date") || cell.getAttribute("title") || "";
    if (/^\d{12,13}$/.test(raw.trim())) {
        const d = new Date(Number(raw.trim()));
        return toIsoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
    const cleaned = raw
        .replace(/^(?:choose|select|pick)\s+/i, "")
        .replace(/\b(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?\b,?\s*/i, "")
        .trim();
    return normalizeDateForInput(cleaned);
}

// One press with exactly one click event: calendars toggle on every click, so the usual
// synthetic click + .click() pair would open one and close it again
function pressOnce(el: HTMLElement): void {
    try { el.focus(); } catch { }
    const rect = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0 };
    try {
        el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true }));
        el.dispatchEvent(new MouseEvent("mousedown", { ...opts, buttons: 1 }));
        el.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }));
        el.dispatchEvent(new MouseEvent("mouseup", { ...opts, buttons: 0 }));
    } catch { }
    el.click();
}

/**
 * Picks a date in a calendar picker: opens it, pages to the month (up to 6 years away) and clicks the day.
 * Returns the picked date, or false when the calendar or the day could not be found.
 */
async function fillCalendarPicker(trigger: HTMLElement, value: unknown): Promise<string | false> {
    const target = normalizeDateForInput(value);
    if (!target) {
        console.info(`[Aullevo] Skipped date picker ${describeElementForLog(trigger)}: "${String(value)}" is not a date.`);
        return false;
    }

    pressOnce(trigger);
    for (let step = 0; step < 72; step++) {
        await sleep(step === 0 ? 250 : 120);
        const days = Array.from(document.querySelectorAll<HTMLElement>(CALENDAR_DAY_SELECTOR))
            .filter(isVisible)
            .map(cell => ({ cell, date: readCalendarDayDate(cell) }))
            .filter(d => d.date);
        if (days.length === 0) break;

        const match = days.find(d => d.date === target);
        if (match) {
            pressOnce(match.cell);
            await sleep(200);
            if (days.some(d => isVisible(d.cell))) closeDropdownMenu();
            return target;
        }

        // Page toward the target month
        const calendar = days[0].cell.closest<HTMLElement>(CALENDAR_POPUP_SELECTOR) ||
            days[0].cell.closest<HTMLElement>("[role='dialog'], [role='grid']")?.parentElement || document.body;
        const forward = target > days[days.length - 1].date;
        const nav = Array.from(calendar.querySelectorAll<HTMLElement>(forward ? CALENDAR_NEXT_SELECTOR : CALENDAR_PREV_SELECTOR)).find(isVisible);
        if (!nav) break;
        pressOnce(nav);
    }

    console.info(`[Aullevo] Could not pick ${target} in the date picker ${describeElementForLog(trigger)}.`);
    closeDropdownMenu();
    return false;
}

/**
 * Checks if a dropdown belongs to Google Forms
 */
export function isGoogleFormsDropdown(dropdownEl: HTMLElement): boolean {
    if (!dropdownEl) return false;
    const cl = (dropdownEl.className || "").toString();
    return !!(
        dropdownEl.querySelector("[jsname='LgbsSe']") ||
        dropdownEl.querySelector(".quantumWizMenuPaperselectDropDown, .exportSelect, .OA0qNb, [jsname='V68bde']") ||
        dropdownEl.getAttribute("jsname") === "W7NXsf" ||
        cl.includes("quantumWizMenuPaperselect") ||
        cl.includes("exportSelect") ||
        cl.includes("ry3kXd") ||
        dropdownEl.closest(".geS5n, .Qr7Oae")
    );
}

// The main country of a dial code several countries share ("+1": US, Canada, Jamaica...)
const DIAL_CODE_COUNTRIES: Record<string, string> = {
    "63": "philippines", "1": "united states", "44": "united kingdom", "91": "india",
    "61": "australia", "81": "japan", "49": "germany", "33": "france", "65": "singapore",
    "82": "south korea", "86": "china", "971": "united arab emirates", "966": "saudi arabia",
    "60": "malaysia", "62": "indonesia", "84": "vietnam", "66": "thailand", "34": "spain",
    "39": "italy", "31": "netherlands", "41": "switzerland", "46": "sweden", "47": "norway",
    "48": "poland", "55": "brazil", "52": "mexico", "27": "south africa", "64": "new zealand"
};

// ----------------------------------------------------------------------------
// Phone boxes with a country picker beside them (flag button, "+63" dropdown):
// typing "+63 985..." into the box leaves the picker on its default country
// ----------------------------------------------------------------------------

// A picker that names countries or dial codes (it sits next to a phone box, so "country" is enough)
function looksLikeCountryPicker(el: HTMLElement): boolean {
    const attrs = `${el.className} ${el.id} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""} ${el.getAttribute("name") || ""} ${el.getAttribute("data-test") || ""} ${el.getAttribute("data-id") || ""} ${el.getAttribute("data-testid") || ""}`;
    if (/country|dial|calling.?code|flag/i.test(attrs)) return true;
    if (el.querySelector("[class*='flag' i], img[src*='flag' i]")) return true;
    if (el instanceof HTMLSelectElement) {
        const options = Array.from(el.options);
        return options.length > 5 && options.filter(o => /\+\s?\d{1,4}\b/.test(o.text)).length > options.length / 2;
    }
    // "+63" or a flag emoji and "+63" on the button
    return /^\s*(?:[\u{1F1E6}-\u{1F1FF}]{2})?\s*\+\d{1,4}\s*$/u.test(el.innerText || "");
}

// The country picker in the phone box's own block, or null
function findPhoneCountryPicker(input: HTMLElement): HTMLElement | null {
    let block = input.parentElement;
    for (let depth = 0; depth < 4 && block && block !== document.body && block.tagName !== "FORM"; depth++) {
        const pickers = Array.from(block.querySelectorAll<HTMLElement>("select, button, [role='combobox'], [role='button'], [aria-haspopup]"))
            .filter(el => el !== input && !el.contains(input) && isElementVisible(el) && looksLikeCountryPicker(el));
        if (pickers.length > 0) return pickers[0];
        if (holdsOtherFields(block, input)) break;
        block = block.parentElement;
    }
    return null;
}

/**
 * The option for the number's dial code: the longest code that starts the digits ("+1 345" is the
 * Cayman Islands, not the US). Where countries share it, the main one (DIAL_CODE_COUNTRIES);
 * null when unsure. `selected` marks options already chosen: nothing to change then.
 */
function pickDialCodeOption<T>(options: { item: T; text: string; selected: boolean }[], digits: string): T | null {
    const withDial = options
        .map(o => ({ ...o, dial: o.text.match(/\+\s?(\d{1,4})\b(?!.*\+\s?\d)/)?.[1] || "" }))
        .filter(o => o.dial && digits.startsWith(o.dial));
    if (withDial.length === 0) return null;
    const longest = Math.max(...withDial.map(o => o.dial.length));
    const matching = withDial.filter(o => o.dial.length === longest);
    const already = matching.find(o => o.selected);
    if (already) return already.item;
    if (matching.length === 1) return matching[0].item;
    const main = DIAL_CODE_COUNTRIES[matching[0].dial];
    return (main && matching.find(o => o.text.toLowerCase().includes(main))?.item) || null;
}

// Sets the country picker beside a phone box to the country of "+63 985 304 7403". Unchanged when unsure.
async function syncPhoneCountry(input: HTMLElement, value: string): Promise<void> {
    const digits = value.trim().match(/^\+\s*(\d[\d\s().-]*)/)?.[1]?.replace(/\D/g, "");
    if (!digits) return;
    const picker = findPhoneCountryPicker(input);
    if (!picker) return;

    if (picker instanceof HTMLSelectElement) {
        const options = Array.from(picker.options).map(o => ({ item: o, text: `${o.text} ${o.value}`, selected: o.selected && picker.selectedIndex > 0 }));
        const option = pickDialCodeOption(options, digits);
        if (option && !option.selected) {
            picker.value = option.value;
            commitSelectValue(picker);
            console.log(`[Aullevo] Set the phone country to "${option.text.trim()}"`);
        }
        return;
    }

    pressOnce(picker);
    let options: HTMLElement[] = [];
    for (let attempt = 0; attempt < 6 && options.length === 0; attempt++) {
        await sleep(attempt === 0 ? 200 : 100);
        options = findAllDropdownOptions(picker);
    }
    const option = pickDialCodeOption(options.map(o => ({
        item: o,
        text: (o.innerText || o.textContent || "").replace(/\s+/g, " "),
        selected: o.getAttribute("aria-selected") === "true" || o.getAttribute("aria-checked") === "true"
    })), digits);
    if (option) {
        try { option.scrollIntoView({ block: "nearest" }); } catch { }
        pressOnce(option);
        console.log(`[Aullevo] Set the phone country to "${(option.innerText || "").replace(/\s+/g, " ").trim()}"`);
        await sleep(200);
    }
    // Still open: nothing was picked, or picking does not close it
    if (picker.getAttribute("aria-expanded") === "true") {
        closeDropdownMenu();
        await sleep(120);
    }
    try { input.focus(); } catch { }
}

/**
 * Dial code and country name matching helper
 * (Matches "+63" -> "+63 (Philippines)" / "Philippines (+63)")
 */
export function computeDialCodeMatchScore(targetValue: string, optText: string): number {
    if (!targetValue || !optText) return 0;
    const tNorm = cleanText(targetValue).toLowerCase();
    const oNorm = cleanText(optText).toLowerCase();

    if (tNorm === oNorm) return 1.0;

    const tDial = (targetValue.match(/\+?(\d{1,4})/) || [])[1];
    const oDial = (optText.match(/\+?(\d{1,4})/) || [])[1];

    if (tDial && oDial && tDial === oDial) {
        return 0.98;
    }

    if (tDial && DIAL_CODE_COUNTRIES[tDial]) {
        const countryName = DIAL_CODE_COUNTRIES[tDial];
        if (oNorm.includes(countryName)) return 0.96;
    }

    if (tNorm.length >= 3 && (oNorm.includes(tNorm) || tNorm.includes(oNorm))) {
        return 0.95;
    }

    return computeStringSimilarity(targetValue, optText);
}

/**
 * Discovers option elements from dropdown element or portal overlay
 */
export function findAllDropdownOptions(dropdownEl: HTMLElement): HTMLElement[] {
    const candidates: HTMLElement[] = [];
    const seen = new Set<HTMLElement>();

    function isOptionElement(el: HTMLElement): boolean {
        if (!el || seen.has(el) || el === dropdownEl) return false;
        if (el.getAttribute("jsname") === "LgbsSe" && !el.hasAttribute("data-value")) return false;
        if (/^(listbox|menu|true)$/.test(el.getAttribute("aria-haspopup") || "")) return false;
        if (el.classList.contains("ry3kXd") && !el.hasAttribute("data-value")) return false;
        return true;
    }

    function add(el: HTMLElement) {
        if (isOptionElement(el)) {
            seen.add(el);
            candidates.push(el);
        }
    }

    const optionSelectors = [
        "[data-automation-id='promptOption']",
        "[data-automation-id='selectOption']",
        "[role='option']",
        "[role='radio']",
        "[role='menuitemradio']",
        "[role='menuitemcheckbox']",
        "[role='menuitem']",
        ".MocG8c",
        ".quantumWizMenuPaperselectOption",
        "[data-value]",
        "[data-radix-select-item]",
        "[data-radix-collection-item]",
        "[id*='headlessui-listbox-option']",
        ".ant-select-item-option",
        ".MuiMenuItem-root",
        ".mat-option",
        "li"
    ].join(", ");

    // 1. Scoped search inside dropdown container
    dropdownEl.querySelectorAll<HTMLElement>(optionSelectors).forEach(add);
    if (candidates.length > 0) return candidates;

    // 2. Scoped search inside parent question card
    const questionCard = dropdownEl.closest(".geS5n, .Qr7Oae, [role='listitem'], .office-form-question, [data-automation-id='questionItem'], fieldset, div");
    if (questionCard) {
        questionCard.querySelectorAll<HTMLElement>(optionSelectors).forEach(add);
        if (candidates.length > 0) return candidates;
    }

    // 3. Floating Portal Overlay containers (Radix, MUI, Google Forms)
    const popups = document.querySelectorAll<HTMLElement>(".OA0qNb, [data-radix-select-content], .ant-select-dropdown, .MuiMenu-paper, .mat-select-panel");
    popups.forEach((popup) => {
        popup.querySelectorAll<HTMLElement>(optionSelectors).forEach(add);
    });
    if (candidates.length > 0) return candidates;

    // 4. The menu the trigger names (aria-controls / aria-owns), wherever the page rendered it
    const root = dropdownEl.getRootNode() as Document | ShadowRoot;
    const triggers = [dropdownEl, ...Array.from(dropdownEl.querySelectorAll<HTMLElement>("[aria-controls], [aria-owns]"))];
    for (const trigger of triggers) {
        for (const attr of ["aria-controls", "aria-owns"]) {
            for (const id of (trigger.getAttribute(attr) || "").split(/\s+/).filter(Boolean)) {
                root.getElementById?.(id)?.querySelectorAll<HTMLElement>(optionSelectors).forEach(add);
            }
        }
    }
    if (candidates.length > 0) return candidates;

    // 5. A menu opened in an overlay at the end of <body> (Angular CDK, Floating UI, React portals):
    // closed menus show no options, so the options on screen belong to the one just opened
    document.querySelectorAll<HTMLElement>("[role='option'], [role='menuitemradio'], [role='menuitemcheckbox']").forEach(el => {
        if (isElementVisible(el)) add(el);
    });

    return candidates;
}

// The text an option shows ("Senior Helpdesk Engineer"), not its markup
// What a person reads on the option. data-value comes last: on some sites it is an internal id ("1", "2", ...)
function dropdownOptionText(opt: HTMLElement): string {
    return (opt.querySelector(".vRMGwf, [data-automation-id='selectOptionText'], [data-automation-id='promptOption'], span[jsslot], span")?.textContent?.trim() ||
        opt.innerText?.trim() ||
        opt.textContent?.trim() ||
        opt.getAttribute("aria-label") ||
        opt.getAttribute("data-value") || "").replace(/\s+/g, " ").trim();
}

function closeDropdownMenu(): void {
    const target = (document.activeElement as HTMLElement | null) || document.body;
    for (const type of ["keydown", "keyup"]) {
        try {
            target.dispatchEvent(new KeyboardEvent(type, { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true, composed: true }));
        } catch { }
    }
}

/**
 * The choices a custom dropdown offers, so the AI can answer with one of them: read where they
 * already are, or by opening the menu and closing it again. [] when it shows none.
 */
async function readCustomDropdownChoices(dropdownEl: HTMLElement): Promise<string[]> {
    let options = findAllDropdownOptions(dropdownEl);
    let opened = false;
    if (options.length === 0 && dropdownEl.getAttribute("aria-expanded") !== "true") {
        pressOnce(dropdownEl);
        opened = true;
        for (let attempt = 0; attempt < 6 && options.length === 0; attempt++) {
            await sleep(100);
            options = findAllDropdownOptions(dropdownEl);
        }
    }
    const texts = [...new Set(options.map(dropdownOptionText))]
        .filter(t => t.length > 0 && !PLACEHOLDER_CHOICE_RE.test(t))
        .slice(0, 150);

    if (opened) {
        closeDropdownMenu();
        await sleep(120);
        if (dropdownEl.getAttribute("aria-expanded") === "true") {
            dispatchSinglePointerClick(dropdownEl);
            await sleep(120);
        }
    }
    return texts;
}

/**
 * Dedicated Google Forms Dropdown Interactor
 */
export async function fillGoogleFormsDropdown(dropdownEl: HTMLElement, targetValue: any, matchedAlias: string = ""): Promise<string | boolean> {
    console.log(`[InjectToGoogle] Google Forms Dropdown -> target: "${targetValue}"`);

    try {
        dropdownEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
        dropdownEl.scrollIntoView(true);
    }
    await sleep(150);

    const trigger = dropdownEl.querySelector<HTMLElement>("[jsname='LgbsSe']") ||
        dropdownEl.querySelector<HTMLElement>(".quantumWizMenuPaperselectDropDown, .exportSelect, .ry3kXd") ||
        dropdownEl;

    dispatchSinglePointerClick(trigger);
    await sleep(300);

    const questionCard = dropdownEl.closest(".geS5n, .Qr7Oae, [role='listitem']") || dropdownEl.parentElement || dropdownEl;
    let popupContainer = dropdownEl.querySelector<HTMLElement>(".OA0qNb, [jsname='V68bde']") ||
        questionCard.querySelector<HTMLElement>(".OA0qNb, [jsname='V68bde']") ||
        document.querySelector<HTMLElement>(".OA0qNb:not([style*='display: none']), .OA0qNb");

    if (!popupContainer || !isElementVisible(popupContainer)) {
        dispatchSinglePointerClick(trigger);
        await sleep(250);
        popupContainer = dropdownEl.querySelector<HTMLElement>(".OA0qNb, [jsname='V68bde']") ||
            questionCard.querySelector<HTMLElement>(".OA0qNb, [jsname='V68bde']") ||
            document.querySelector<HTMLElement>(".OA0qNb:not([style*='display: none']), .OA0qNb");
    }

    let optionEls: HTMLElement[] = [];
    if (popupContainer) {
        optionEls = Array.from(popupContainer.querySelectorAll<HTMLElement>("[jsname='Nmvb'], .MocG8c[data-value], [role='option'], .MocG8c"));
    }
    if (optionEls.length === 0) {
        optionEls = Array.from(questionCard.querySelectorAll<HTMLElement>("[jsname='Nmvb'], .MocG8c[data-value], [role='option']"));
    }

    optionEls = optionEls.filter(el => el !== trigger && el !== dropdownEl && el.getAttribute("jsname") !== "LgbsSe");

    if (optionEls.length === 0) {
        return false;
    }

    const candidates = parseTargetValues(targetValue);
    if (!candidates.includes(String(targetValue).trim())) {
        candidates.push(String(targetValue).trim());
    }

    if (matchedAlias) {
        candidates.sort((a, b) => {
            const scoreA = computeStringSimilarity(matchedAlias, a);
            const scoreB = computeStringSimilarity(matchedAlias, b);
            return scoreB - scoreA;
        });
    }

    let bestOpt: HTMLElement | null = null;
    let bestScore = 0;

    for (const cand of candidates) {
        const normCand = cleanText(cand);

        for (const opt of optionEls) {
            const dataVal = (opt.getAttribute("data-value") || "").trim();
            const textVal = (opt.querySelector(".vRMGwf, span")?.textContent || opt.textContent || "").trim();
            const rawText = dataVal || textVal;
            const optText = cleanText(rawText);

            if ((!rawText || optText === "choose" || optText === "select") && normCand !== optText) {
                continue;
            }

            if (optText === normCand || cleanText(dataVal) === normCand || cleanText(textVal) === normCand) {
                bestOpt = opt;
                bestScore = 1.0;
                break;
            }

            const score = Math.max(
                computeChoiceMatchScore(cand, rawText),
                computeStringSimilarity(cand, optText)
            );

            if (score > bestScore) {
                bestScore = score;
                bestOpt = opt;
            }
        }

        if (bestScore >= 0.90) break;
    }

    if (!bestOpt || bestScore < 0.40) {
        dispatchSinglePointerClick(trigger);
        return false;
    }

    const optLabel = bestOpt.getAttribute("data-value") || bestOpt.querySelector(".vRMGwf")?.textContent || bestOpt.textContent || targetValue;

    try {
        bestOpt.scrollIntoView({ behavior: "instant", block: "nearest" });
    } catch { }
    await sleep(80);

    const clickTarget = bestOpt.querySelector<HTMLElement>(".vRMGwf, span") || bestOpt;
    dispatchSinglePointerClick(clickTarget);

    try {
        bestOpt.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
        bestOpt.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
    } catch { }

    await sleep(300);
    return optLabel;
}

/**
 * Universal Multi-Platform Custom Dropdown & Combobox Interactor
 * Supports Searchable Comboboxes (Culture Index, React-Select, Radix, MUI, Workday)
 */
/**
 * Readable one-line description of a control for console logs, e.g. `"Country" <input#country>`
 * (logging the element itself prints "[object HTMLInputElement]" in chrome://extensions)
 */
function describeElementForLog(el: Element): string {
    const id = el.id ? `#${el.id}` : "";
    const name = !id && el.getAttribute("name") ? `[name="${el.getAttribute("name")}"]` : "";
    const tag = `<${el.tagName.toLowerCase()}${id}${name}>`;
    const labelledBy = el.getAttribute("aria-labelledby")?.split(/\s+/)
        .map(ref => document.getElementById(ref)?.textContent?.trim())
        .filter(Boolean).join(" ");
    const label = (el.getAttribute("aria-label") || labelledBy ||
        (el as HTMLInputElement).labels?.[0]?.textContent ||
        el.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim();
    return label ? `"${label.length > 60 ? label.slice(0, 57) + "..." : label}" ${tag}` : tag;
}

export async function fillCustomDropdown(dropdownEl: HTMLElement, targetValue: any, matchedAlias: string = ""): Promise<string | boolean> {
    if (!dropdownEl || !targetValue || fillCancelled) return false;

    if (isGoogleFormsDropdown(dropdownEl)) {
        return await fillGoogleFormsDropdown(dropdownEl, targetValue, matchedAlias);
    }

    console.log(`[Aullevo] Custom Dropdown -> target: "${targetValue}"`);

    // 1. Scroll dropdown smoothly into center view
    try {
        dropdownEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
        dropdownEl.scrollIntoView(true);
    }
    await sleep(150);

    // 2. Click the open trigger / dropdown container to display menu
    const isAlreadyOpen = dropdownEl.getAttribute("aria-expanded") === "true";
    if (!isAlreadyOpen) {
        const openTrigger =
            dropdownEl.querySelector<HTMLElement>("[jsname='LgbsSe']") ||
            dropdownEl.querySelector<HTMLElement>(".quantumWizMenuPaperselectDropDown, .exportSelect, [data-automation-id='select'], [data-radix-select-trigger], [data-automation-id='prompt']") ||
            dropdownEl.querySelector<HTMLElement>(".ry3kXd, .c-select__control, .select__control, [class*='select-control'], [class*='control'], [data-automation-id*='select']") ||
            dropdownEl;

        dispatchSinglePointerClick(openTrigger);
        await sleep(150);
    }

    // 3. Read the options the open menu shows (up to ~600ms for menus that render late)
    const pollOptions = async (): Promise<HTMLElement[]> => {
        let found: HTMLElement[] = [];
        for (let attempt = 0; attempt < 6; attempt++) {
            await sleep(attempt === 0 ? 150 : 100);
            found = findAllDropdownOptions(dropdownEl);
            if (found.length > 0) break;
            // Try again with a single press: a menu that toggles on every click was opened and
            // closed by the double click above (an open one says aria-expanded="true": left alone)
            if (attempt === 2 && dropdownEl.getAttribute("aria-expanded") !== "true") {
                pressOnce(dropdownEl);
            }
        }
        return found;
    };

    // 4. Match candidate options against target value with candidate filtering
    const candidates = parseTargetValues(targetValue);
    if (!candidates.includes(String(targetValue).trim())) {
        candidates.push(String(targetValue).trim());
    }

    if (matchedAlias) {
        candidates.sort((a, b) => {
            const scoreA = computeStringSimilarity(matchedAlias, a);
            const scoreB = computeStringSimilarity(matchedAlias, b);
            return scoreB - scoreA;
        });
    }

    const pickBest = (opts: HTMLElement[]) => {
        let opt: HTMLElement | null = null;
        let score = 0;
        let text = "";
        for (const cand of candidates) {
            for (const candidateOpt of opts) {
                const rawText = dropdownOptionText(candidateOpt);
                const optText = cleanText(rawText);
                if (!optText) continue;

                if (/^(choose|select|select an option|please select|none)$/i.test(optText) && cand !== optText) {
                    continue;
                }

                const candScore = computeDialCodeMatchScore(cand, optText);
                if (candScore > score) {
                    score = candScore;
                    opt = candidateOpt;
                    text = (rawText || cand).trim();
                }
            }
            if (score >= 0.90) break;
        }
        return { opt, score, text };
    };

    let options = await pollOptions();
    let best = pickBest(options);

    // 5. Searchable menus may only list what matches the typed text (long country lists, Workday prompts):
    // search when the options on screen hold no clear match
    const activePopup = Array.from(document.querySelectorAll<HTMLElement>(`
        [data-automation-id='promptSearch-results'], [data-automation-id='select-results'],
        [data-automation-id*='popup'], [data-automation-id*='prompt'], .cx-select__options,
        [role='dialog'], [role='listbox'], .c-select__menu
    `)).find(p => isElementVisible(p));
    // Menus in an overlay often move focus to their own search box when they open
    const focused = document.activeElement;
    const focusedSearch = focused instanceof HTMLInputElement && focused !== dropdownEl && /^(text|search|)$/.test(focused.type) && isElementVisible(focused)
        ? focused : null;

    const searchInput = (dropdownEl.tagName === "INPUT" || dropdownEl.tagName === "TEXTAREA")
        ? (dropdownEl as HTMLInputElement)
        : (dropdownEl.querySelector<HTMLInputElement>("input[type='text'], input[role='combobox'], input[class*='input'], input:not([type='hidden'])") ||
            (activePopup ? activePopup.querySelector<HTMLInputElement>("input[placeholder*='Search' i], input[data-automation-id='searchBox'], input[data-automation-id='promptSearchInput'], input[type='text']") : null) ||
            focusedSearch);

    const setSearchText = (text: string) => {
        if (!searchInput) return;
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        if (nativeSetter) {
            nativeSetter.call(searchInput, text);
        } else {
            searchInput.value = text;
        }
        searchInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        try {
            searchInput.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: text, inputType: "insertText" }));
        } catch { }
        searchInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    };

    if (searchInput && searchInput !== document.body && best.score < 0.90) {
        const clearButton = dropdownEl.parentElement
            ? dropdownEl.parentElement.querySelector<HTMLElement>(".clear-button, button[aria-label*='clear' i], [class*='clear-indicator'], .c-select__clear-indicator, [class*='indicatorContainer'] svg, [data-automation-id='clear-button'], button[aria-label*='delete' i]")
            : null;

        if (clearButton && isElementVisible(clearButton)) {
            dispatchSinglePointerClick(clearButton);
            await sleep(80);
        }

        try {
            searchInput.focus();

            const isDialTarget = /^\+\d{1,4}$/.test(String(targetValue).trim());
            const searchTerm = isDialTarget ? String(targetValue).trim() : String(targetValue);
            setSearchText(searchTerm);

            // Trigger Enter inside search box if required (e.g. Workday prompt search)
            if (searchInput.getAttribute("data-automation-id") === "searchBox" || /search/i.test(searchInput.placeholder || "")) {
                searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, code: "Enter", bubbles: true }));
                await sleep(250);
            }

            const searched = await pollOptions();
            const bestSearched = pickBest(searched);
            if (searched.length > 0 && bestSearched.score >= best.score) {
                options = searched;
                best = bestSearched;
            } else if (searchInput !== dropdownEl) {
                // The search hid the better option (or every option): back to the full list
                setSearchText("");
                options = await pollOptions();
                best = pickBest(options);
            }
        } catch (err) {
            console.warn("[Aullevo] Search input typing error:", err);
        }
    }

    if (options.length === 0) {
        console.info(`[Aullevo] Dropdown ${describeElementForLog(dropdownEl)} showed no options to choose from — skipped.`);
        return false;
    }

    const bestOpt = best.opt;
    const bestScore = best.score;
    const appliedText = best.text;

    // 7. Select the best matched option
    if (bestOpt && bestScore >= 0.40) {
        const optLabel = (dropdownOptionText(bestOpt) || String(targetValue)).trim();
        console.log(`[Aullevo] Selecting option "${optLabel}" (score: ${bestScore.toFixed(2)})`);

        try {
            bestOpt.scrollIntoView({ behavior: "instant", block: "nearest" });
        } catch { }
        await sleep(80);

        const innerTarget = bestOpt.querySelector<HTMLElement>("span, div, b, strong, label, input[type='radio']") || bestOpt;
        dispatchSinglePointerClick(innerTarget);
        dispatchSinglePointerClick(bestOpt);

        const radio = bestOpt.querySelector<HTMLInputElement>("input[type='radio']");
        if (radio) {
            radio.checked = true;
            radio.dispatchEvent(new Event("change", { bubbles: true }));
        }

        // 8. Workday Cascading / Drill-down submenu handling:
        await sleep(250);
        const subOptions = findAllDropdownOptions(dropdownEl);
        if (subOptions.length > 0) {
            for (const subOpt of subOptions) {
                const subRaw = subOpt.getAttribute("data-value") ||
                    subOpt.querySelector(".vRMGwf, [data-automation-id='selectOptionText'], [data-automation-id='promptOption'], span, div")?.textContent ||
                    subOpt.innerText ||
                    subOpt.textContent || "";
                const subText = cleanText(subRaw);
                if (subText && (subText.toLowerCase() === String(targetValue).toLowerCase() || computeStringSimilarity(String(targetValue), subText) >= 0.70)) {
                    console.log(`[Aullevo] Workday drill-down: Clicking child leaf option "${subText}"`);
                    const subInner = subOpt.querySelector<HTMLElement>("span, div, b, strong, label, input[type='radio']") || subOpt;
                    dispatchSinglePointerClick(subInner);
                    dispatchSinglePointerClick(subOpt);
                    const subRadio = subOpt.querySelector<HTMLInputElement>("input[type='radio']");
                    if (subRadio) {
                        subRadio.checked = true;
                        subRadio.dispatchEvent(new Event("change", { bubbles: true }));
                    }
                    await sleep(200);
                    break;
                }
            }
        }

        await sleep(200);
        return appliedText || optLabel;
    } else {
        const optionTexts = options.slice(0, 10).map(dropdownOptionText);
        console.info(`[Aullevo] Dropdown ${describeElementForLog(dropdownEl)}: no option matched "${targetValue}". Options: ${optionTexts.join(", ")}${options.length > 10 ? `, … (${options.length} total)` : ""}`);

        try {
            dispatchSinglePointerClick(dropdownEl);
        } catch { }
        await sleep(150);
        return false;
    }
}


// Main Injection of Form fields
interface CandidatePair {
    field: { label: string; value: any;[key: string]: any };
    control: HTMLElement;
    isCustomDropdown: boolean;
    isCountryCode: boolean;
    isChoice: boolean;
    choiceType: "radio" | "checkbox" | "other";
    choiceText: string;
    matchedTargetValue: string | null;
    matchedAlias: string;
    // The control's label text the alias scored best against
    matchedText: string;
    score: number;
}

/**
 * True when any option in this control's question (native radio name group, ARIA radiogroup,
 * or checkbox group/fieldset) is already selected.
 */
function isChoiceGroupAnswered(control: HTMLElement): boolean {
    if (control instanceof HTMLInputElement && control.type === "radio" && control.name) {
        const root = control.form ?? control.getRootNode();
        const siblings = (root as ParentNode).querySelectorAll?.(`input[type="radio"][name="${CSS.escape(control.name)}"]`);
        if (siblings && Array.from(siblings).some(r => (r as HTMLInputElement).checked)) return true;
    }
    const group = control.closest('[role="radiogroup"], [role="group"], [role="list"], fieldset');
    if (!group) return false;
    const options = group.querySelectorAll<HTMLElement>('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]');
    return Array.from(options).some(isControlChecked);
}

/**
 * True for a checkbox question whose ticked boxes were all ticked by the current fill.
 * More options may still apply ("I can cook, be funny" ticks two of six), so the AI may add
 * ticks there; a question the site or the user ticked is left alone.
 */
function checkboxGroupTickedOnlyBy(control: HTMLElement, filler: Set<HTMLElement>): boolean {
    const members = choiceGroupMembers(control);
    if (members.length < 2) return false;
    const ticked = members.filter(isControlChecked);
    // The filler may hold the box itself or its wrapper (<label><input>…</label>)
    const tickedByFiller = (m: HTMLElement) => filler.has(m) || [...filler].some(f => f.contains(m));
    return ticked.length > 0 && ticked.every(m => tickedByFiller(m) && !userEdited.has(m));
}

// Where Aullevo got the value it typed: a SENSITIVE profile value must never be sent to the AI
// when asking it to correct an answer the form rejected
const filledOrigin = new WeakMap<HTMLElement, "profile" | "sensitive" | "ai">();

// Controls the user typed into or changed by hand on this page. Only trusted events count:
// Aullevo's own typing dispatches synthetic events, so it never lands here.
// ("input" is composed, so this also sees typing inside shadow roots)
const userEdited = new WeakSet<HTMLElement>();
for (const type of ["input", "change"]) {
    document.addEventListener(type, (e) => {
        const target = e.composedPath()[0];
        if (e.isTrusted && !aullevoClicking && target instanceof HTMLElement) userEdited.add(target);
    }, true);
}

// The options of a radio/checkbox question (just the control itself when it has no group)
function choiceGroupMembers(control: HTMLElement): HTMLElement[] {
    if (control instanceof HTMLInputElement && control.type === "radio" && control.name) {
        const root = (control.form ?? control.getRootNode()) as ParentNode;
        return Array.from(root.querySelectorAll<HTMLElement>(`input[type="radio"][name="${CSS.escape(control.name)}"]`));
    }
    const group = control.closest('[role="radiogroup"], [role="group"], [role="list"], fieldset');
    return group
        ? Array.from(group.querySelectorAll<HTMLElement>('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]'))
        : [control];
}

/**
 * Which answers a fill leaves as they are:
 * - "touched": ones Aullevo or the user already gave on this page (so pressing Fill again after a
 *   pause continues instead of retyping everything, and never undoes what the user fixed by hand)
 * - "all": every control that already holds an answer (a catch-up pass for questions that appeared later)
 */
type KeepAnswers = "touched" | "all";

// Words that mark a question as being about someone other than the user
const OTHER_PERSON_RE = /\b(?:team\s*mates?|team\s+members?|members?\s*\d+|co-?applicants?|references?|referees?|emergency|next\s+of\s+kin|spouse|guardians?|parents?|mother|father|beneficiar(?:y|ies)|dependents?|recommenders?|contact\s+person)\b/i;

/**
 * A text box or dropdown inside a block about another person ("Teammate 1", "Reference 2",
 * "Emergency contact"), read from its fieldset legend, group label and name/id
 * (e.g. name="member[1].email"). The user's own name, e-mail or phone must never go there:
 * only profile fields that name that role ("Emergency contact phone") may fill it.
 * Radios/checkboxes are left out ("Do you have references?" is still about the user).
 */
function aboutAnotherPerson(item: HarvestedControl): boolean {
    if (item.isChoice) return false;
    const el = item.control;
    const legend = el.closest("fieldset")?.querySelector(":scope > legend")?.textContent || "";
    const groupLabel = el.closest('[role="group"], [role="region"]')?.getAttribute("aria-label") || "";
    const attrs = `${el.getAttribute("name") || ""} ${el.id}`.replace(/[_\-.[\]]+/g, " ");
    return OTHER_PERSON_RE.test(`${legend} ${groupLabel} ${attrs}`);
}

const fieldNamesOtherPerson = (field: { label?: string }) => OTHER_PERSON_RE.test(String(field.label || ""));

// Profile fields that hold (part of) the user's address, and dropdown questions that ask for part of one
const ADDRESS_FIELD_RE = /\b(?:address|residen\w*|location|city|town|province|state|country|home\s*town|barangay)\b/i;
const LOCATION_QUESTION_RE = /\b(?:city|town|municipality|province|state|region|country|location|barangay|district)\b/i;

/**
 * The dropdown option that the saved address names, e.g. "Manila" in "Caloocan City, Metro Manila,
 * Philippines". Whole words only; the one named earliest wins (addresses go from specific to
 * general), then the longer one ("Metro Manila" over "Manila"). For a country question the
 * latest wins instead (the country ends an address; "Georgia St." near the start must not).
 */
function pickOptionNamedInAddress(select: HTMLSelectElement, addresses: { value: string; sensitive: boolean }[], countryQuestion: boolean) {
    let best: { option: string; at: number; sensitive: boolean } | null = null;
    for (const opt of Array.from(select.options)) {
        const text = opt.text.trim();
        if (!opt.value || opt.disabled || text.length < 3 || PLACEHOLDER_CHOICE_RE.test(text)) continue;
        const word = new RegExp(`(?:^|[^\\p{L}\\p{N}])${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "iu");
        for (const address of addresses) {
            const m = word.exec(address.value);
            if (!m) continue;
            // Distance from the end for countries, so "smaller is better" holds either way
            const at = countryQuestion ? address.value.length - (m.index + m[0].length) : m.index;
            if (!best || at < best.at || (at === best.at && text.length > best.option.length)) {
                best = { option: text, at, sensitive: address.sensitive };
            }
        }
    }
    return best;
}

function keepsExistingAnswer(item: HarvestedControl, keep: KeepAnswers | undefined): boolean {
    if (!keep || !hasExistingAnswer(item)) return false;
    if (keep === "all") return true;
    const members = item.isChoice ? choiceGroupMembers(item.control) : [item.control];
    return members.some(m => filledOrigin.has(m) || userEdited.has(m));
}

/**
 * True when a control already holds an answer (typed, selected or ticked), whoever put it there.
 */
function hasExistingAnswer(item: HarvestedControl): boolean {
    const el = item.control;
    if (item.isChoice) return isChoiceGroupAnswered(el) || isControlChecked(el);
    if (el instanceof HTMLSelectElement) return isSelectAnswered(el);
    if (item.isCustomDropdown) return isDropdownAnswered(el);
    return readControlText(el).length > 0;
}

// The input's HTML5 type accepts this value as it is ("@handle" is not a URL, "Single" is not a number)
function valueFitsInputType(control: HTMLElement, value: unknown): boolean {
    const type = ((control as HTMLInputElement).type || control.getAttribute("type") || "").toLowerCase();
    const v = String(value ?? "").trim();
    if (type === "email") return v.includes("@");
    if (type === "url") return /^https?:\/\//i.test(v);
    if (type === "number") return !isNaN(Number(v.replace(/[,$\s]/g, "")));
    if (type === "tel") return /[\d+()-]/.test(v);
    return true;
}

// ---------------------------------------------------------------------------
// Voice agent: targeted fills ("fill the email", "fill this one")
// ---------------------------------------------------------------------------

export interface VoiceFillTarget {
    texts?: string[];
    focused?: boolean;
    said?: string;       // the whole sentence, for the AI
    value?: string;      // "answer": the user's own words go in, not a profile value
    indices?: number[];  // the AI's choice: positions in listVoiceQuestions() order
    questionTexts?: string[]; // the texts of those questions, to find them again if the page changed
    mainFrame?: boolean; // false in a side frame: positions ("question 1") only count in the main form
}

// The options of one radio / checkbox question belong together; every other control is its own question
function questionGroups(controls: HarvestedControl[]): HarvestedControl[][] {
    const groups = new Map<unknown, HarvestedControl[]>();
    for (const item of controls) {
        let key: unknown = item.control;
        if (item.isChoice) {
            const el = item.control;
            key = el instanceof HTMLInputElement && el.type === "radio" && el.name
                ? `name:${el.name}`
                : el.closest("[role='radiogroup'], [role='group'], fieldset") || el.closest(QUESTION_SCOPE_SELECTOR) || el;
        }
        const list = groups.get(key);
        if (list) list.push(item); else groups.set(key, [item]);
    }
    return Array.from(groups.values());
}

const groupHolds = (group: HarvestedControl[], el: Element) =>
    group.some(item => item.control === el || composedContains(item.control, el));

/** The question containing `start`: the closest ancestor that holds exactly one question. */
function questionAround(start: Element, groups: HarvestedControl[][]): HarvestedControl[][] {
    let node: Element | null = start;
    for (let depth = 0; node && depth < 12; node = composedParent(node), depth++) {
        const box: Element = node;
        const inside = groups.filter(group => group.some(item => composedContains(box, item.control)));
        if (inside.length === 1) return inside;
        if (inside.length > 1) return [];
    }
    return [];
}

/** The visible question nearest the middle of the screen. */
function questionInView(groups: HarvestedControl[][]): HarvestedControl[][] {
    let best: HarvestedControl[] | null = null;
    let distance = Infinity;
    for (const group of groups) {
        const box = group[0].control.getBoundingClientRect();
        if (box.bottom < 0 || box.top > innerHeight || (!box.width && !box.height)) continue;
        const gap = Math.abs((box.top + box.bottom) / 2 - innerHeight / 2);
        if (gap < distance) { best = group; distance = gap; }
    }
    return best ? [best] : [];
}

/** "Fill this one": the question last clicked or typed in, or the one in view after scrolling. */
function questionMeant(groups: HarvestedControl[][]): HarvestedControl[][] {
    const touchedAt = Math.max(lastFocusedAt, lastPointerAt);
    if (!touchedAt || lastScrollAt > touchedAt + 300) return questionInView(groups); // nothing clicked, or scrolled since
    const focused = lastFocused?.isConnected ? lastFocused : null;
    const byFocus = focused ? groups.filter(group => groupHolds(group, focused)) : [];
    const byClick = lastPointer?.isConnected ? questionAround(lastPointer, groups) : [];
    // Whichever happened last: clicking into a box focuses it right after the click; clicking a question's text doesn't
    if (byFocus.length && (lastFocusedAt >= lastPointerAt || !byClick.length)) return byFocus;
    if (byClick.length) return byClick;
    return questionInView(groups);
}

/** Scrolls a targeted question into view and makes it glow for a moment, so you can see what the agent works on. */
function spotlight(element: HTMLElement, scroll: boolean): void {
    if (scroll) {
        try { element.scrollIntoView({ behavior: "smooth", block: "center" }); } catch { }
    }
    const previous = { outline: element.style.outline, boxShadow: element.style.boxShadow, transition: element.style.transition };
    element.style.transition = "box-shadow 300ms ease, outline-color 300ms ease";
    element.style.outline = "2px solid #8b5cf6";
    element.style.boxShadow = "0 0 0 6px #8b5cf633, 0 0 24px #8b5cf688";
    setTimeout(() => Object.assign(element.style, previous), 1800);
}

interface VoiceTargetPick {
    controls: Set<HTMLElement>;
    uploads: Set<HTMLInputElement>;
    matched: number; // questions picked
}

// What the AI is told about one question when it decides which one the user meant
interface VoiceQuestionInfo {
    text: string;
    kind: "text" | "choice" | "checkboxes" | "dropdown" | "file";
    options?: string[];
    answered: boolean;
    inView: boolean;
    lastTouched: boolean;
}

/**
 * Voice: the questions the AI thinks the user meant. `ok` is false when the AI couldn't be asked (no key, offline),
 * so the caller can fall back to its own best guess; an empty answer from the AI means "none of these".
 */
function askAiForTargets(said: string, targets: string[], questions: VoiceQuestionInfo[]): Promise<{ ok: boolean; matches: number[] }> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, matches: [] }), 20000);
        try {
            chrome.runtime.sendMessage({ action: "FIND_VOICE_TARGETS", said, targets, questions }, (res) => {
                clearTimeout(timer);
                if (chrome.runtime.lastError || !res || res.error) {
                    resolve({ ok: false, matches: [] });
                    return;
                }
                const matches = Array.isArray(res.matches) ? res.matches : [];
                resolve({ ok: true, matches: matches.filter((i: unknown): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < questions.length) });
            });
        } catch {
            clearTimeout(timer);
            resolve({ ok: false, matches: [] });
        }
    });
}

function describeQuestion(group: HarvestedControl[], touched: Set<HarvestedControl[]>): VoiceQuestionInfo {
    const first = group[0];
    const el = first.control;
    const kind: VoiceQuestionInfo["kind"] = first.isChoice ? (first.choiceType === "checkbox" ? "checkboxes" : "choice")
        : el instanceof HTMLSelectElement || first.isCustomDropdown ? "dropdown" : "text";
    const options = first.isChoice ? group.map(item => item.choiceText).filter(Boolean)
        : el instanceof HTMLSelectElement ? Array.from(el.options).map(o => o.text.trim()).filter(t => t && !PLACEHOLDER_CHOICE_RE.test(t))
        : [];
    const box = el.getBoundingClientRect();
    return {
        text: truncateLabel(first.labelTexts[0] || first.labelTexts[1] || "", 160),
        kind,
        ...(options.length ? { options: options.slice(0, 8).map(o => truncateLabel(o, 60)) } : {}),
        answered: group.some(hasExistingAnswer),
        inView: box.bottom > 0 && box.top < innerHeight && (box.width > 0 || box.height > 0),
        lastTouched: touched.has(group)
    };
}

/**
 * The form's questions in page order: what "question 3" counts and what the AI's question numbers refer to.
 * Site headers, menus and search boxes are left out (unless they are all there is).
 */
function orderedQuestionGroups(controls: HarvestedControl[]): { groups: HarvestedControl[][]; ordered: HarvestedControl[][] } {
    const groups = questionGroups(controls);
    const formGroups = groups.filter(group => !group[0].control.closest(PAGE_CHROME_SELECTOR));
    return { groups, ordered: formGroups.length ? formGroups : groups };
}

const questionTitle = (group: HarvestedControl[]) => truncateLabel(group[0].labelTexts[0] || group[0].labelTexts[1] || "", 160);

/** Every question on the page as the voice agent's AI sees it (never the user's saved values). */
function listVoiceQuestions(): VoiceQuestionInfo[] {
    const { groups, ordered } = orderedQuestionGroups(harvestAllControls());
    const touched = new Set(questionMeant(groups));
    return ordered.slice(0, 150).map(group => describeQuestion(group, touched));
}

/**
 * The questions (and upload boxes) a voice command points at.
 * Decided here only when it's certain: a position ("the first question", "the last one") or exactly one question
 * holding every word said. Anything else goes to the AI with the whole sentence and every question's text, type,
 * options and state, so it can judge like a person looking at the form. Never more than a few per thing named.
 */
async function pickVoiceTarget(controls: HarvestedControl[], target: VoiceFillTarget): Promise<VoiceTargetPick> {
    const { groups, ordered } = orderedQuestionGroups(controls);
    const uploads = harvestActiveFileInputs();
    const pickedUploads = new Set<HTMLInputElement>();
    let picked: HarvestedControl[][] = [];

    if (target.indices?.length) {
        // The AI already chose, by number in the list it was shown; check each one is still the same question
        const found = target.indices.map((index, i) => {
            const expected = target.questionTexts?.[i];
            const atIndex = ordered[index];
            if (atIndex && (!expected || questionTitle(atIndex) === expected)) return atIndex;
            return expected ? ordered.find(group => questionTitle(group) === expected) : undefined;
        });
        picked = Array.from(new Set(found.filter((group): group is HarvestedControl[] => Boolean(group))));
    } else if (target.focused) {
        // A frame the user never touched has nothing "here" (background.ts asks the frame touched last)
        picked = window === window.top || lastFocusedAt || lastPointerAt ? questionMeant(groups) : [];
    } else {
        const titles = [
            ...groups.map(group => group[0].labelTexts[0] || ""),
            ...uploads.map(({ input, container }) => extractFileContext(input, container).contextText)
        ];
        // Positions count the form's own questions (`ordered`): a search box in the site header is not "question 1"

        const hits = new Set<number>();
        const unsure: { text: string; guesses: number[] }[] = [];
        for (const text of target.texts || []) {
            const position = questionPosition(text);
            if (position !== null) {
                // Several frames: only the main form counts positions, so "question 1" isn't filled in each of them
                if (target.mainFrame === false) continue;
                const group = ordered[position < 0 ? ordered.length + position : position - 1];
                if (group) hits.add(groups.indexOf(group));
                continue;
            }
            const { indices, sure } = matchTargets(text, titles);
            if (sure) indices.forEach(i => hits.add(i));
            else unsure.push({ text, guesses: indices });
        }

        if (unsure.length && titles.some(Boolean)) {
            const touched = new Set(questionMeant(groups));
            const questions: VoiceQuestionInfo[] = [
                ...groups.map(group => describeQuestion(group, touched)),
                ...uploads.map(({ input }, i) => ({
                    text: truncateLabel(titles[groups.length + i], 160),
                    kind: "file" as const,
                    answered: Boolean(input.files?.length),
                    inView: input.getBoundingClientRect().bottom > 0,
                    lastTouched: false
                }))
            ];
            const ai = await askAiForTargets(target.said || unsure.map(u => u.text).join(", "), unsure.map(u => u.text), questions);
            // Never "everything": a targeted fill that would touch every question of a real form is a misunderstanding
            const plausible = ai.matches.length < questions.length || questions.length <= 2;
            const aiPicks = plausible ? ai.matches.slice(0, unsure.length * 3) : [];
            if (ai.ok) {
                console.log(`[Aullevo:Voice] AI matched "${unsure.map(u => u.text).join(", ")}" to: ${aiPicks.map(i => `"${titles[i]}"`).join(", ") || "nothing"}`);
                aiPicks.forEach(i => hits.add(i));
            } else {
                // No AI: the closest question by its words, one per thing named
                unsure.forEach(u => { if (u.guesses.length) hits.add(u.guesses[0]); });
            }
        }
        picked = groups.filter((_, i) => hits.has(i));
        uploads.forEach(({ input }, i) => { if (hits.has(groups.length + i)) pickedUploads.add(input); });
    }

    picked.forEach((group, i) => spotlight(group[0].control, i === 0));
    return {
        controls: new Set(picked.flat().map(item => item.control)),
        uploads: pickedUploads,
        matched: picked.length + pickedUploads.size
    };
}

/** Questions still without an answer, by name (what the voice agent reads out as "left for you"). */
function unansweredQuestions(): string[] {
    const names: string[] = [];
    for (const group of questionGroups(harvestAllControls())) {
        if (group.some(hasExistingAnswer)) continue;
        const name = truncateLabel(group[0].labelTexts[0] || "", 80);
        if (name && !names.includes(name)) names.push(name);
        if (names.length >= 12) break;
    }
    return names;
}

/**
 * Asks background.ts whether AI can run right now (API key, hosted backend, quota).
 */
function requestAiPermission(): Promise<{ allowed: boolean; reason?: string }> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "CHECK_AI_PERMISSION" }, (res) => {
            if (chrome.runtime.lastError || !res) {
                resolve({ allowed: false, reason: "Could not reach the AI worker." });
                return;
            }
            resolve(res);
        });
    });
}

/**
 * Main Injection Orchestrator:
 * Executes candidate scoring matrix, optimal collision-free assignment,
 * and native synthetic value dispatching.
 */
export async function injectFormFields(
    fields: any[],
    useAi: boolean = false,
    speedPreset: string | SpeedConfig = "human",
    attachedFiles: ProfileFile[] = [],
    // target: a voice command named some questions ("fill the email") or "this one": only those are filled,
    // and an answer already there may be replaced
    options: { keep?: KeepAnswers; target?: VoiceFillTarget } = {}
) {
    if (!Array.isArray(fields) || fields.length === 0) {
        return { success: false as const, error: "No fields provided." };
    }

    // Preflight: if AI can't run, fall back to full keyword mode for this run.
    // Otherwise the heuristic pass would skip medium-confidence fields (< 0.80) expecting AI to fill them.
    let aiNotice: string | undefined;
    if (useAi) {
        const perm = await requestAiPermission();
        if (!perm.allowed) {
            useAi = false;
            aiNotice = perm.reason;
            console.info(`[Aullevo:AI] AI unavailable, using keyword fill: ${perm.reason}`);
        }
    }


    const speedConfig = resolveSpeedConfig(speedPreset); // <--- RESOLVE SPEED HERE
    console.log(`[Aullevo] Form injection triggered with ${fields.length} fields. AI Mode: ${useAi ? 'ENABLED' : 'DISABLED'} | Speed:`, speedConfig);

    closeAnyOpenDropdown();
    // A catch-up pass adds to the badges of the pass before it
    if (options.keep !== "all") clearAllHighlights();
    await sleep(80);

    const matchedMap = new Map<string, any>();
    const assignedControls = new Set<HTMLElement>();
    const candidatePairs: CandidatePair[] = [];
    let filledCount = 0;
    const assignedFields = new Set<string>();


    // Step 1: Harvest all visible controls & descriptors across all DOM roots
    const pageControls = harvestAllControls().filter(c => !keepsExistingAnswer(c, options.keep));
    const voiceTarget = options.target ? await pickVoiceTarget(pageControls, options.target) : null;
    const harvestedControls = voiceTarget ? pageControls.filter(c => voiceTarget.controls.has(c.control)) : pageControls;
    const inTarget = (el: HTMLElement) => !voiceTarget || voiceTarget.controls.has(el);
    console.log(`[Aullevo] Harvesting complete: ${harvestedControls.length} interactive controls found on page.`);
    if (voiceTarget) console.log(`[Aullevo:Voice] Targeted fill: ${voiceTarget.matched} question(s) picked.`);

    // Step 1.5: File Upload Matching & Injection (Supports Multi-File & Sequential Uploads)
    // Each file handed to an upload box, checked again at the end of the fill (Step 7b)
    const injectedUploads: { input: HTMLInputElement; anchor: HTMLElement; file: ProfileFile; before: { block: HTMLElement; text: string } }[] = [];
    if (Array.isArray(attachedFiles) && attachedFiles.length > 0) {
        const activeUploads = harvestActiveFileInputs();
        console.log(`[Aullevo] Found ${activeUploads.length} active/visible file upload inputs on page.`);

        const usedFileIds = new Set<string>();

        for (const { input, container } of activeUploads) {
            if (assignedControls.has(input)) continue;
            if (voiceTarget && !voiceTarget.uploads.has(input)) continue;
            // Running again on the same page: files already chosen stay, no duplicate uploads
            if (options.keep && input.files && input.files.length > 0) continue;
            const { contextText, accept } = extractFileContext(input, container);
            console.log(`[Aullevo] File input context: "${contextText}" | accept: "${accept}"`);

            // 1. Collect ALL files that match this dropzone (score >= 0.55)
            const matchedFiles: { file: ProfileFile; score: number }[] = [];

            for (const file of attachedFiles) {
                if (!file.enabled || usedFileIds.has(file.id)) continue;

                const score = scoreFileMatch(file, contextText, accept);
                if (score >= 0.55) {
                    matchedFiles.push({ file, score });
                }
            }

            // Sort from highest match score to lowest
            matchedFiles.sort((a, b) => b.score - a.score);
            if (matchedFiles.length === 0) {
                const scores = attachedFiles.filter(f => f.enabled && !usedFileIds.has(f.id))
                    .map(f => `"${f.fileName}" ${scoreFileMatch(f, contextText, accept).toFixed(2)}`);
                console.info(`[Aullevo] No attached file fits this upload box (needs 0.55): ${scores.join(", ") || "none left to use"}`);
            }

            // 2. Decide if input is strictly single-file (e.g. dedicated Resume slot) or multi-file
            const isStrictlySingle = /\b(resume|cv|cover\s*letter)\b/i.test(contextText) &&
                !/multiple|documents|records|assets|files|one\s*by\s*one|sequentially|portfolio/i.test(contextText) &&
                !input.multiple;

            const filesToInject = isStrictlySingle
                ? matchedFiles.slice(0, 1).map(m => m.file)
                : matchedFiles.map(m => m.file);

            // 3. Inject matching files (sequentially with 90ms delay so web forms process each)
            if (filesToInject.length > 0) {
                for (const file of filesToInject) {
                    const block = uploadQuestionBlock(container);
                    const before = { block, text: uploadAreaText(block) };
                    const success = await injectFileIntoControl(input, container, file);
                    if (success) {
                        usedFileIds.add(file.id);
                        filledCount++;
                        injectedUploads.push({ input, anchor: uploadAnchor(container), file, before });
                        console.log(`[Aullevo] Injected "${file.fileName}" into file input.`);
                        await sleep(90);
                    }
                }

                // Highlight the visible container with count
                const targetToHighlight = (container && container.offsetWidth > 0) ? container : input;
                const labelMsg = filesToInject.length === 1
                    ? ct("file", { name: filesToInject[0].fileName })
                    : ct("files", { count: filesToInject.length });
                highlightFilledElement(targetToHighlight, labelMsg);
                assignedControls.add(input);
            }
        }
    }


    // =======================================================================
    // GOOGLE FORMS SPECIAL FILE HANDLER (docs.google.com/forms)
    // =======================================================================
    const isGoogleForms = window.location.hostname.includes("docs.google.com") && window.location.pathname.includes("/forms");

    if (isGoogleForms && !voiceTarget) {
        // 1. Check if a Google Picker modal is ALREADY open on screen (Screenshot 4)
        const pickerIframe = document.querySelector<HTMLIFrameElement>(".picker-frame, iframe[src*='picker']");
        const pickerDoc = pickerIframe?.contentDocument || document;
        const openPickerInput = pickerDoc.querySelector<HTMLInputElement>("input[type='file']");
        const openPickerDrop = pickerDoc.querySelector<HTMLElement>(".picker-drop-zone, [role='button'][aria-label*='Browse' i], [aria-label*='drop' i]") || openPickerInput;

        if (openPickerInput) {
            // Modal is already open: find the best file (e.g. Resume) and inject directly into it!
            const resumeFile = attachedFiles.find(f => f.enabled && /resume|cv/i.test(f.label || f.fileName)) || attachedFiles.find(f => f.enabled);
            if (resumeFile) {
                await injectFileIntoControl(openPickerInput, openPickerDrop as HTMLElement, resumeFile);
                filledCount++;
                console.log(`[Aullevo] Injected "${resumeFile.fileName}" into Google Picker!`);
            }
        } else {
            // 2. Modal is NOT open yet: scan question cards for the "Add file" button (Screenshot 1)
            const googleCards = Array.from(document.querySelectorAll<HTMLElement>(".geS5n, .Qr7Oae"));

            for (const card of googleCards) {
                const addFileBtn = card.querySelector<HTMLElement>("[role='button'][aria-label*='file' i], .uArJ5e, [aria-label*='Add file' i]");
                if (!addFileBtn) continue;

                // Extract question title (e.g. "Resume")
                const titleEl = card.querySelector<HTMLElement>(".M7eMe, [role='heading']");
                const questionText = (titleEl?.textContent || "").toLowerCase();

                // Find matching attached file
                const matchedFile = attachedFiles.find(f => f.enabled && scoreFileMatch(f, questionText, "") >= 0.60);

                if (matchedFile) {
                    highlightFilledElement(addFileBtn, ct("matched", { name: matchedFile.fileName }));
                    console.log(`[Aullevo] Found Google Form file question "${questionText}". Opening picker for "${matchedFile.fileName}"...`);

                    // 1. Click the "Add file" button to open Google Drive Picker
                    addFileBtn.click();

                    // 2. Await up to 5 seconds for Google Picker iframe to render and inject
                    const maxWaitMs = 5000;
                    const startWait = Date.now();
                    let injected = false;

                    while (Date.now() - startWait < maxWaitMs) {
                        await sleep(150);

                        const iframe = document.querySelector<HTMLIFrameElement>(".picker-frame, iframe[src*='picker'], iframe[class*='picker']");
                        let doc: Document | null = null;
                        try {
                            doc = iframe?.contentDocument || null;
                        } catch { }

                        const pickerInput = (doc ? doc.querySelector<HTMLInputElement>("input[type='file']") : null) ||
                            document.querySelector<HTMLInputElement>(".picker-dialog input[type='file'], [aria-label*='Insert file'] input[type='file']");

                        if (pickerInput) {
                            // Brief 120ms pause to ensure Google's JS listeners have attached to the input
                            await sleep(120);
                            const dropArea = (doc ? doc.querySelector<HTMLElement>(".picker-drop-zone, [role='button'][aria-label*='Browse' i], [aria-label*='drop' i]") : null) || pickerInput;
                            await injectFileIntoControl(pickerInput, (dropArea as HTMLElement) || pickerInput, matchedFile);
                            console.log(`[Aullevo] Injected "${matchedFile.fileName}" into Google Picker on 1st try!`);
                            injected = true;
                            break;
                        }
                    }

                    if (injected) {
                        filledCount++;
                        break; // Process one Google file picker at a time
                    }
                }
            }

        }
    }

    // =======================================================================
    // MICROSOFT FORMS RANKING QUESTIONS HANDLER (Uses .rank-item)
    // =======================================================================
    // (a catch-up pass only fills empty questions, and a ranking always holds some order)
    const allRankItems = options.keep === "all" || voiceTarget ? [] : Array.from(document.querySelectorAll<HTMLElement>(".rank-item, [class*='rank-item']"));
    const rankingCards = Array.from(new Set(
        allRankItems.map(item => item.closest<HTMLElement>(
            "[data-automation-id*='question' i], .office-form-question, .office-form-question-element, div[class*='question']"
        ) || item.parentElement)
    )).filter(Boolean) as HTMLElement[];

    for (const card of rankingCards) {
        const titleEl = card.querySelector<HTMLElement>(
            "[data-automation-id='questionTitle'], [data-automation-id*='title' i], .office-form-question-title, [role='heading'], span, div"
        );
        const titleText = cleanText(titleEl?.innerText || titleEl?.textContent || "");
        if (!titleText) continue;

        for (const field of fields) {
            if (!field.value) continue;
            const aliases = getFieldLabelAliases(field.label);
            const isMatch = aliases.some(alias => computeStringSimilarity(alias, titleText) >= 0.60);

            if (isMatch) {
                console.log(`[Aullevo] Found MS Forms Ranking question: "${titleText}". Applying saved order...`);
                const success = await fillMicrosoftRankingQuestion(card, String(field.value));
                if (success) {
                    highlightFilledElement(card, ct("ranked", { value: field.value }));
                    assignedFields.add(cleanText(field.label));
                    filledCount++;
                }
                break;
            }
        }
    }



    // Step 2: Score every field against every harvested control dynamically


    // Questions about a teammate, reference, emergency contact...: not for the user's own details
    const otherPersonControls = new Set(harvestedControls.filter(aboutAnotherPerson).map(c => c.control));

    fields.forEach((field) => {
        if (!field || !field.label || field.value === undefined || field.value === null || field.value === "") {
            return;
        }

        const targetValues = parseTargetValues(field.value);
        const labelAliases = getFieldLabelAliases(field.label);
        const isDialPrefixVal = /^\+\d{1,4}$/.test(String(field.value || "").trim());
        const forOtherPerson = fieldNamesOtherPerson(field);

        harvestedControls.forEach(({ control, labelTexts, isCustomDropdown, isCountryCode, isChoice, choiceType, choiceText }) => {
            if (otherPersonControls.has(control) && !forOtherPerson) return;
            let maxScore = 0;
            let matchedTargetValue: string | null = null;
            let bestMatchedAlias = field.label;
            let bestMatchedText = "";

            if (isChoice && choiceText) {
                // Radio / Checkbox choice matching: requires both question AND choice option to match
                let questionScore = 0;
                for (const alias of labelAliases) {
                    for (const text of labelTexts) {
                        const score = computeStringSimilarity(alias, text);
                        if (score > questionScore) {
                            questionScore = score;
                            bestMatchedAlias = alias;
                        }
                    }
                }

                if (questionScore >= 0.40) {
                    let bestChoiceScore = 0;
                    let bestMatchedVal: string | null = null;

                    for (const targetVal of targetValues) {
                        const cScore = computeChoiceMatchScore(targetVal, choiceText);
                        if (cScore > bestChoiceScore) {
                            bestChoiceScore = cScore;
                            bestMatchedVal = targetVal;
                        }
                    }

                    if (bestChoiceScore >= 0.60) {
                        maxScore = (questionScore * 0.35) + (bestChoiceScore * 0.65);
                        matchedTargetValue = bestMatchedVal;
                    }
                }
            } else {
                // Standard text, textarea, select, or custom dropdown:
                for (const alias of labelAliases) {
                    for (const text of labelTexts) {
                        const score = computeStringSimilarity(alias, text);
                        if (score > maxScore) {
                            maxScore = score;
                            bestMatchedAlias = alias;
                            bestMatchedText = text;
                        }
                    }
                }
                // A long question that holds only some of the label's words ("Where do you live?" shares
                // "where" and "you" with "Give an example of a situation where you had to choose...") is
                // asking something else
                if (maxScore > 0 && !coversLabelInLongQuestion(bestMatchedAlias, bestMatchedText)) maxScore = 0;

                const controlType = ((control as HTMLInputElement).type || control.getAttribute("type") || "").toLowerCase();
                if (!valueFitsInputType(control, field.value)) maxScore = 0;

                // Dial prefix country code protection
                if (isCountryCode) {
                    if (isDialPrefixVal || /country\s*code|dial\s*code|calling\s*code/i.test(field.label)) {
                        maxScore = Math.max(maxScore, 0.99);
                    } else {
                        maxScore = 0;
                    }
                } else if (isDialPrefixVal && controlType !== "text") {
                    maxScore = 0;
                }
            }

            // Must satisfy threshold
            if (maxScore >= 0.45) {
                candidatePairs.push({
                    field,
                    control,
                    isCustomDropdown,
                    isCountryCode,
                    isChoice,
                    choiceType,
                    choiceText,
                    matchedTargetValue,
                    matchedAlias: bestMatchedAlias,
                    matchedText: bestMatchedText,
                    score: maxScore
                });
            }
        });
    });

    // Step 3: Sort candidate pairs by score DESCENDING (Highest confidence claims input first)
    candidatePairs.sort((a, b) => b.score - a.score);

    // Step 4: Strict Optimal Assignment & Execution
    const assignedRadioGroups = new Set<string>();

    // Fills one candidate pair if its control/field/radio group is still free
    const tryAssignPair = async (pair: CandidatePair): Promise<void> => {
        const fieldKey = cleanText(pair.field.label);
        // Check if control is already claimed
        if (assignedControls.has(pair.control)) {
            return;
        }


        // Non-choice inputs allow at most 1 control per field
        if (!pair.isChoice && assignedFields.has(fieldKey)) {
            return;
        }

        // Radio buttons allow at most 1 selection per question group
        if (pair.isChoice && pair.choiceType === "radio") {
            const radioGroupKey = fieldKey + "_radio";
            if (assignedRadioGroups.has(radioGroupKey)) {
                return;
            }
        }

        let fillSuccess: boolean | string = true;

        if (pair.isCustomDropdown) {
            fillSuccess = await fillCustomDropdown(pair.control, pair.field.value, pair.matchedAlias);
            await sleep(speedConfig.actionDelayMs > 0 ? getJitteredDelay(speedConfig.actionDelayMs) : 100);
        } else if (pair.isChoice) {
            // Optional pre-click pause for stealth
            if (speedConfig.actionDelayMs > 0) {
                try { pair.control.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch { }
                await sleep(getJitteredDelay(Math.min(60, speedConfig.actionDelayMs / 3)));
            }

            fillSuccess = toggleChoiceControl(pair.control, pair.choiceType as "radio" | "checkbox", true);

            // Inter-choice pause (e.g. 160ms on human, 320ms on stealth)
            if (speedConfig.actionDelayMs > 0) {
                await sleep(getJitteredDelay(speedConfig.actionDelayMs));
            } else {
                await sleep(40);
            }
        } else {
            // Standard text / textarea typing
            fillSuccess = await applyValueToControl(pair.control, pair.field.value, pair.matchedAlias, speedConfig);

            // Inter-field pause before moving to the next question
            if (speedConfig.actionDelayMs > 0) {
                await sleep(getJitteredDelay(speedConfig.actionDelayMs));
            } else {
                await sleep(60);
            }
        }


        if (fillSuccess !== false) {
            let badgeLabel = typeof fillSuccess === "string" && fillSuccess.trim() !== ""
                ? fillSuccess
                : (pair.choiceText || pair.matchedTargetValue || pair.field.label);

            if (badgeLabel && badgeLabel.length > 28) {
                badgeLabel = badgeLabel.substring(0, 25).trim() + "...";
            }
            highlightFilledElement(pair.control, badgeLabel);

            assignedControls.add(pair.control);
            filledOrigin.set(pair.control, pair.field.isSensitive ? "sensitive" : "profile");

            if (pair.isChoice && pair.choiceType === "radio") {
                assignedRadioGroups.add(fieldKey + "_radio");
            } else if (!pair.isChoice) {
                assignedFields.add(fieldKey);
            }

            filledCount++;

            // Record match details
            const existing = matchedMap.get(fieldKey);
            if (existing) {
                if (pair.choiceText) {
                    existing.filledChoices = existing.filledChoices || [];
                    if (!existing.filledChoices.includes(pair.choiceText)) {
                        existing.filledChoices.push(pair.choiceText);
                    }
                }
                if (pair.score > existing.score) existing.score = pair.score;
            } else {
                matchedMap.set(fieldKey, {
                    label: pair.field.label,
                    value: pair.field.value,
                    matched: true,
                    score: pair.score,
                    filledChoices: pair.choiceText ? [pair.choiceText] : []
                });
            }
        }
    };

    // When AI is enabled, only HIGH confidence matches (≥0.80) are filled now.
    // Lower ones are deferred: AI gets first try, then they fill whatever AI left empty.
    // Questions with writing instructions ("Format: Surname, Given Names") also go to the AI first:
    // a keyword match knows which profile value fits, not how the form wants it written.
    const hintCache = new Map<HTMLElement, string>();
    const hintFor = (item: { control: HTMLElement; labelTexts?: string[] }): string => {
        if (!hintCache.has(item.control)) hintCache.set(item.control, resolveControlHint(item.control, item.labelTexts));
        return hintCache.get(item.control)!;
    };
    const labelsByControl = new Map(harvestedControls.map(h => [h.control, h.labelTexts]));
    const needsFormatting = (pair: CandidatePair) =>
        !pair.isChoice && !pair.isCustomDropdown && pair.control.tagName !== "SELECT" &&
        (FORMAT_HINT_RE.test(hintFor({ control: pair.control, labelTexts: labelsByControl.get(pair.control) })) ||
            titleNeedsWriting(pair.matchedAlias, labelsByControl.get(pair.control) || []));

    // The score says the profile label fits the question; the backward check says whether the question
    // asks for more than that label ("First Name" explains half of "Full Name (Surname, First Name, MI)").
    // The visible title counts too: a hidden name="first_name" may score best while the title asks more.
    const asksBeyondLabel = (pair: CandidatePair) =>
        !pair.isChoice && !pair.isCountryCode &&
        [pair.matchedText, labelsByControl.get(pair.control)?.[0] || ""]
            .some(question => questionCoverage(pair.matchedAlias, question) < QUESTION_EXPLAINED);

    // A box several profile values fit ("Legal Full Name (First Name MI Last Name)" names both First Name
    // and Last Name) likely wants them combined: the AI writes that, keyword fill would pick just one
    const strongValuesByControl = new Map<HTMLElement, Set<string>>();
    for (const pair of candidatePairs) {
        if (pair.isChoice || pair.score < 0.80) continue;
        if (!strongValuesByControl.has(pair.control)) strongValuesByControl.set(pair.control, new Set());
        strongValuesByControl.get(pair.control)!.add(String(pair.field.value).trim().toLowerCase());
    }
    const sharedByFields = (pair: CandidatePair) =>
        !pair.isChoice && pair.score < 1 && (strongValuesByControl.get(pair.control)?.size ?? 0) > 1;

    // A long question ("List your references, including their name, job title...") shares a word or two
    // with many profile labels ("Title", "Where do you live?"): that says little about what it asks.
    // The AI answers it, unless a profile label of several words appears in it whole.
    const words = (text: string) => cleanText(text).split(" ").filter(w => w.length >= 3);
    const looseFitForLongQuestion = (pair: CandidatePair) => {
        if (pair.isChoice) return false;
        const labels = labelsByControl.get(pair.control) || [];
        if (!labels.some(l => words(l).length >= 5)) return false;
        const alias = cleanText(pair.matchedAlias);
        return !(words(alias).length >= 2 && labels.some(l => ` ${cleanText(l)} `.includes(` ${alias} `)));
    };

    const deferredToAi: CandidatePair[] = [];
    for (const pair of candidatePairs) {
        if (useAi && (pair.score < INSTANT_FILL_SCORE || asksBeyondLabel(pair) || needsFormatting(pair) || sharedByFields(pair) || looseFitForLongQuestion(pair))) {
            if (pair.score >= INSTANT_FILL_SCORE) console.log(`[Aullevo] "${pair.field.label}" fits "${pair.matchedText}" only in part (format, several values or more asked): letting the AI answer first`);
            deferredToAi.push(pair);
            continue;
        }
        await tryAssignPair(pair);
    }

    // Step 5: Secondary Pass for Conditionally Revealed Inputs (e.g. textareas revealed by radios)
    // Only controls that were not on the page at the harvest: the others were scored above
    // (and may be waiting for the AI on purpose)
    const harvestedSet = new Set(harvestedControls.map(c => c.control));
    const remainingFields = fields.filter((f) => !assignedFields.has(cleanText(f.label)));
    if (remainingFields.length > 0 && !voiceTarget) {
        await sleep(150);
        const newlyVisibleControls = harvestAllControls()
            .filter(c => !harvestedSet.has(c.control) && !assignedControls.has(c.control) && !c.isChoice && !c.isCustomDropdown && !keepsExistingAnswer(c, options.keep));

        for (const field of remainingFields) {
            const fieldKey = cleanText(field.label);
            const aliases = getFieldLabelAliases(field.label);
            const forOtherPerson = fieldNamesOtherPerson(field);

            for (const ctrl of newlyVisibleControls) {
                if (assignedControls.has(ctrl.control)) continue;
                if (!forOtherPerson && aboutAnotherPerson(ctrl)) continue;
                if (!valueFitsInputType(ctrl.control, field.value)) continue;

                let bestScore = 0;
                for (const alias of aliases) {
                    for (const text of ctrl.labelTexts) {
                        const score = computeStringSimilarity(alias, text);
                        if (score > bestScore) bestScore = score;
                    }
                }

                if (bestScore >= 0.45) {
                    const fillSuccess = await applyValueToControl(ctrl.control, field.value, field.label);
                    if (fillSuccess !== false) {
                        let displayBadge = field.label || field.value;
                        if (displayBadge && displayBadge.length > 28) {
                            displayBadge = displayBadge.substring(0, 25).trim() + "...";
                        }
                        highlightFilledElement(ctrl.control, displayBadge);
                        assignedControls.add(ctrl.control);
                        filledOrigin.set(ctrl.control, field.isSensitive ? "sensitive" : "profile");
                        assignedFields.add(fieldKey);
                        filledCount++;

                        matchedMap.set(fieldKey, {
                            label: field.label,
                            value: field.value,
                            matched: true,
                            score: bestScore
                        });
                        break;
                    }
                }
            }
        }
    }

    // =======================================================================
    // Step 5b: Location dropdowns (City, Province, Country...) answered from an address the
    // profile already holds. Runs locally: a SENSITIVE address never goes to the AI, but an
    // option it names ("Metro Manila" -> Manila, "... Philippines" -> Philippines) can be picked here.
    // =======================================================================
    const addressValues = fields
        .filter(f => f?.value && ADDRESS_FIELD_RE.test(String(f.label || "")))
        .map(f => ({ value: String(f.value), sensitive: Boolean(f.isSensitive) }));
    if (addressValues.length > 0) {
        for (const item of harvestAllControls()) {
            const select = item.control;
            if (!(select instanceof HTMLSelectElement) || assignedControls.has(select) || otherPersonControls.has(select) || !inTarget(select)) continue;
            if (keepsExistingAnswer(item, options.keep) || isSelectAnswered(select) || aboutAnotherPerson(item)) continue;
            if (!item.labelTexts.some(t => LOCATION_QUESTION_RE.test(t))) continue;

            const pick = pickOptionNamedInAddress(select, addressValues, item.labelTexts.some(t => /\bcountry\b/i.test(t)));
            if (!pick) continue;
            const ok = await applyValueToControl(select, pick.option, item.labelTexts[0] || "", speedConfig);
            if (ok === false || !isSelectAnswered(select)) continue;
            highlightFilledElement(select, pick.option.length > 28 ? pick.option.substring(0, 25) + "..." : pick.option);
            assignedControls.add(select);
            filledOrigin.set(select, pick.sensitive ? "sensitive" : "profile");
            filledCount++;
            console.log(`[Aullevo] Picked "${pick.option}" for "${item.labelTexts[0]}" from the saved address`);
        }
    }

    // =======================================================================
    // Step 6: Privacy-First AI Smart Fill Pass for Unresolved Controls
    // =======================================================================
    if (useAi && !fillCancelled) {
        console.log("[Aullevo:AI] Running AI smart resolution on remaining unfilled controls...");

        // 1. Gather all unfilled interactive controls on the page
        // Skip controls that already hold an answer: the site pre-filled them (e.g. a PDF viewer's
        // page box, the applicant's saved e-mail) and an AI guess must not overwrite that
        // and questions about someone else (a teammate's name): only the user can answer those
        // A checkbox question only this fill ticked stays open: the AI may tick more of its boxes
        // (a targeted voice fill may replace what's there: the user asked for that question)
        const unfilled = harvestedControls.filter(c => !assignedControls.has(c.control) && !otherPersonControls.has(c.control) &&
            (!hasExistingAnswer(c) || Boolean(voiceTarget) || (c.choiceType === "checkbox" && !isControlChecked(c.control) && checkboxGroupTickedOnlyBy(c.control, assignedControls))));

        // Group choice controls (radios/checkboxes) by their question: its label AND its own container
        // (radio name, radiogroup, question block). By label alone, two quiz questions with the same
        // title became one: the AI's single answer ticked the first and the second stayed empty.
        const choiceGroups = new Map<string, { questionLabel: string; type: 'radio' | 'checkbox'; controls: HarvestedControl[] }>();
        const directInputs: HarvestedControl[] = [];
        const containerIds = new Map<Element, number>();
        const questionContainerId = (el: HTMLElement): string => {
            if (el instanceof HTMLInputElement && el.type === "radio" && el.name) return `name:${el.name}`;
            const box = el.closest('[role="radiogroup"], [role="group"], fieldset') || el.closest(QUESTION_SCOPE_SELECTOR);
            if (!box) return "";
            if (!containerIds.has(box)) containerIds.set(box, containerIds.size);
            return `box:${containerIds.get(box)}`;
        };

        for (const item of unfilled) {
            if (item.isChoice) {
                const qLabel = item.labelTexts[0] || "Options";
                const groupKey = `${item.choiceType}_${questionContainerId(item.control)}_${cleanText(qLabel)}`;
                if (!choiceGroups.has(groupKey)) {
                    choiceGroups.set(groupKey, { questionLabel: qLabel, type: item.choiceType as 'radio' | 'checkbox', controls: [] });
                }
                choiceGroups.get(groupKey)!.controls.push(item);
            } else if (!item.isCountryCode) {
                // Standard text input, textarea, or dropdown
                directInputs.push(item);
            }
        }

        // 2. Build privacy-safe question list (NO personal values, only questions & options)
        const aiQuestions: Array<{
            id: string;
            label: string;
            type: 'text' | 'textarea' | 'radio' | 'checkbox' | 'select';
            options?: string[];
            alreadyChecked?: string[];
            format?: string;
            context?: string;
        }> = [];

        // Track how to reach the DOM element from the question ID
        const aiTargetMap = new Map<string, {
            type: 'input' | 'choice';
            control?: HTMLElement;
            isCustomDropdown?: boolean;
            choiceGroup?: HarvestedControl[];
            choiceType?: 'radio' | 'checkbox';
        }>();

        let qIndex = 0;

        // Add direct text / textarea / select inputs
        for (const item of directInputs) {
            const label = item.labelTexts[0];
            if (!label || label.trim().length < 2) continue;

            const tagName = item.control.tagName.toLowerCase();
            const isTextarea = tagName === 'textarea' || item.control.getAttribute('role') === 'textbox' || item.control.isContentEditable;
            // The AI must answer a dropdown with one of its options: an answer it guesses blind matches none
            const dropdownChoices = item.isCustomDropdown ? await readCustomDropdownChoices(item.control) : undefined;
            if (dropdownChoices && dropdownChoices.length === 0) continue;

            const qId = `ai_q_${qIndex++}`;
            aiQuestions.push({
                id: qId,
                label: label,
                type: isTextarea ? 'textarea' : (tagName === 'select' || item.isCustomDropdown ? 'select' : 'text'),
                options: tagName === 'select'
                    ? Array.from((item.control as HTMLSelectElement).options || []).map(o => o.text).filter(Boolean)
                    : dropdownChoices,
                format: isCalendarTrigger(item.control) || (item.control as HTMLInputElement).type === "date"
                    ? "a date as YYYY-MM-DD"
                    : describeFormat(readFormatFromControl(item.control)) || undefined,
                context: hintFor(item) || undefined
            });

            aiTargetMap.set(qId, {
                type: 'input',
                control: item.control,
                isCustomDropdown: item.isCustomDropdown
            });
        }

        // Add choice groups (radios/checkboxes)
        for (const [groupKey, group] of choiceGroups.entries()) {
            if (assignedRadioGroups.has(groupKey)) continue;

            const options = group.controls.map(c => c.choiceText).filter(Boolean);
            if (options.length === 0) continue;
            // Titled by one of its own options: the real question was not found, and the AI would only
            // pick the option it is shown. Left for the user (a lone "I agree" box is still asked)
            if ((group.type === 'radio' || options.length > 1) && options.some(o => cleanText(o) === cleanText(group.questionLabel))) {
                console.info(`[Aullevo:AI] Skipped the options "${options.join(" / ")}": their question's title was not found.`);
                continue;
            }

            // Boxes this fill already ticked: shown as options too, so the AI sees the whole question
            // (option text from the harvest: the label now also holds the fill badge).
            // Only ticks from AI SAFE fields: SENSITIVE ones and the site's own ticks are never sent
            // (AI choices only add ticks, so leaving them out never unticks them).
            const tickedBoxes = group.type === "checkbox" ? choiceGroupMembers(group.controls[0].control).filter(isControlChecked) : [];
            const alreadyChecked = harvestedControls
                .filter(h => h.choiceText && filledOrigin.get(h.control) === "profile" && tickedBoxes.some(m => h.control === m || h.control.contains(m)))
                .map(h => h.choiceText);

            const qId = `ai_q_${qIndex++}`;
            const groupHint = hintFor(group.controls[0]);
            aiQuestions.push({
                id: qId,
                label: group.questionLabel,
                type: group.type,
                options: [...alreadyChecked, ...options],
                ...(groupHint ? { context: groupHint } : {}),
                ...(alreadyChecked.length > 0 ? { alreadyChecked } : {})
            });

            aiTargetMap.set(qId, {
                type: 'choice',
                choiceGroup: group.controls,
                choiceType: group.type
            });
        }

        // 3. Dispatch to background.ts (Calls the Zero-Knowledge AI Engine)
        if (aiQuestions.length > 0) {
            console.log(`[Aullevo:AI] Sending ${aiQuestions.length} unresolved questions to the AI...`);

            const askAi = (questions: typeof aiQuestions): Promise<any> => Promise.race([
                new Promise((resolve) => {
                    chrome.runtime.sendMessage({
                        action: "RESOLVE_AI_QUESTIONS",
                        questions
                    }, (res) => resolve(res || { success: false, error: "Empty response" }));
                }),
                sleep(30000).then(() => ({ success: false, error: "The AI did not answer within 30 seconds, so fields were filled without it." }))
            ]);

            try {
                const aiResponse: any = await askAi(aiQuestions);


                if (aiResponse?.success && Array.isArray(aiResponse.answers)) {
                    console.log(`[Aullevo:AI] Received ${aiResponse.answers.length} answers from AI.`);

                    // Ticks the option(s) an AI answer names. A checkbox question gets every option
                    // listed in "choices"; a profile value listing several things
                    // ("I can cook, be funny, good listener") is split into its parts.
                    // False when no option on the page matches what the AI named
                    const applyAiChoice = async (group: HarvestedControl[], type: 'radio' | 'checkbox', ans: any): Promise<boolean> => {
                        const exact = (text: string) => group.find(c =>
                            c.choiceText.trim().toLowerCase() === text.trim().toLowerCase() ||
                            c.choiceText.replace(/\s+/g, '').toLowerCase() === text.replace(/\s+/g, '').toLowerCase() ||
                            cleanText(c.choiceText) === cleanText(text));
                        const closest = (text: string) => {
                            let chosen: HarvestedControl | undefined;
                            let bestScore = 0.70;
                            for (const c of group) {
                                const score = computeChoiceMatchScore(text, c.choiceText);
                                if (score > bestScore) {
                                    bestScore = score;
                                    chosen = c;
                                }
                            }
                            return chosen;
                        };

                        const texts: string[] = (Array.isArray(ans.choices) && ans.choices.length > 0 ? ans.choices : [ans.answer])
                            .map((t: unknown) => String(t ?? '').trim())
                            .filter(Boolean);
                        const picked = new Set<HarvestedControl>();
                        for (const text of type === 'checkbox' ? texts : texts.slice(0, 1)) {
                            const whole = exact(text);
                            if (whole) {
                                picked.add(whole);
                                continue;
                            }
                            const parts = type === 'checkbox'
                                ? text.split(/\s*(?:[,;\n/&]|\band\b)\s*/i).filter(p => p.length > 1)
                                : [];
                            const partPicks = parts.length > 1 ? parts.map(p => exact(p) || closest(p)).filter(Boolean) as HarvestedControl[] : [];
                            if (partPicks.length > 0) partPicks.forEach(c => picked.add(c));
                            else {
                                const best = closest(text);
                                if (best) picked.add(best);
                            }
                        }

                        for (const chosenCtrl of picked) {
                            if (assignedControls.has(chosenCtrl.control) || isControlChecked(chosenCtrl.control)) continue;
                            toggleChoiceControl(chosenCtrl.control, type, true);
                            highlightFilledElement(chosenCtrl.control, ct("ai", { text: chosenCtrl.choiceText || ans.answer }));
                            assignedControls.add(chosenCtrl.control);
                            filledCount++;
                            await sleep(speedConfig.actionDelayMs > 0 ? getJitteredDelay(speedConfig.actionDelayMs) : 60);
                        }
                        return picked.size > 0;
                    };

                    // Types or picks one AI answer; false when the control did not take it
                    const applyAiInput = async (control: HTMLElement, isCustomDropdown: boolean | undefined, answer: string, alias: string): Promise<boolean> => {
                        const result = isCustomDropdown
                            ? await fillCustomDropdown(control, answer, alias)
                            // The AI wrote this answer for this field: used as is ("N/A" is not "N" or "A")
                            : await applyValueToControl(control, answer, alias, speedConfig, true);
                        return result !== false;
                    };

                    const returnedIds = new Set<string>();
                    const appliedIds = new Set<string>();
                    const applyAiAnswers = async (answers: any[]) => {
                        for (const raw of answers) {
                            // The model may answer with a number (a salary) or null: everything below expects text
                            const ans = {
                                ...raw,
                                answer: raw?.answer === undefined || raw?.answer === null ? "" : String(raw.answer),
                                choices: Array.isArray(raw?.choices) ? raw.choices.map((c: unknown) => String(c ?? "")) : raw?.choices
                            };
                            const target = aiTargetMap.get(ans.id);
                            if (!target) continue;
                            returnedIds.add(ans.id);

                            // One answer that fails to apply must not cost the rest
                            try {
                                // Case A: AI mapped this question to local profile field(s) (Zero-Knowledge)
                                // background.ts already resolved matchedKey / matchedKeys → actual value
                                const effectiveKey = ans.matchedKey || (Array.isArray(ans.matchedKeys) ? ans.matchedKeys.join('+') : undefined);
                                const hasAnswer = Boolean(ans.answer.trim()) || (Array.isArray(ans.choices) && ans.choices.length > 0);
                                if (!hasAnswer) continue;

                                if (target.type === 'choice' && target.choiceGroup) {
                                    if (await applyAiChoice(target.choiceGroup, target.choiceType || 'radio', ans)) appliedIds.add(ans.id);
                                    else console.info(`[Aullevo:AI] No option matches the AI's answer "${ans.answer || ans.choices?.join(", ")}".`);
                                } else if (target.type === 'input' && target.control && !assignedControls.has(target.control) && ans.answer.trim()) {
                                    const filled = await applyAiInput(target.control, target.isCustomDropdown, ans.answer, effectiveKey || "AI Response");
                                    if (!filled) {
                                        console.info(`[Aullevo:AI] Could not put the AI's answer into ${describeElementForLog(target.control)}.`);
                                        continue;
                                    }
                                    highlightFilledElement(target.control, effectiveKey ? ct("ai", { text: effectiveKey }) : ct("aiGenerated"));
                                    assignedControls.add(target.control);
                                    filledOrigin.set(target.control, effectiveKey ? "sensitive" : "ai");
                                    filledCount++;
                                    appliedIds.add(ans.id);
                                    await sleep(speedConfig.actionDelayMs > 0 ? getJitteredDelay(speedConfig.actionDelayMs) : 60);
                                }
                            } catch (err) {
                                console.warn(`[Aullevo:AI] Failed to apply the AI's answer to ${target.control ? describeElementForLog(target.control) : "a choice question"}:`, err);
                            }
                        }
                    };
                    await applyAiAnswers(aiResponse.answers);

                    // A long list can come back with questions skipped, or with an option the page doesn't have.
                    // Those are asked once more on their own (counted as the same fill for the Free plan).
                    // A text question the AI returned empty is left: it found no answer.
                    const missed = aiQuestions.filter(q => !appliedIds.has(q.id) &&
                        (!returnedIds.has(q.id) || aiTargetMap.get(q.id)?.type === 'choice'));
                    if (missed.length > 0) {
                        console.log(`[Aullevo:AI] ${missed.length} question(s) came back without a usable answer: asking again.`);
                        const retry = await askAi(missed);
                        if (retry?.success && Array.isArray(retry.answers)) await applyAiAnswers(retry.answers);
                    }
                } else if (aiResponse?.error) {
                    // Already logged with full detail by the background worker; the side panel shows aiNotice
                    console.info(`[Aullevo:AI] AI skipped this fill: ${aiResponse.error}`);
                    aiNotice = aiResponse.error;
                }
            } catch (err) {
                const message = (err as Error)?.message || String(err);
                console.error(`[Aullevo:AI] Failed to communicate with background AI worker: ${message}`);
                aiNotice = /context invalidated/i.test(message)
                    ? "Aullevo was updated since this page loaded: refresh the page to use AI."
                    : "Could not reach the AI worker.";
            }
        } else {
            console.log("[Aullevo:AI] All controls were already resolved by heuristic pass. 0 AI tokens spent.");
        }
    }

    // Step 7: Keyword fallback for deferred matches the AI didn't fill (AI failed, timed out, or skipped them)
    if (deferredToAi.length > 0) {
        const before = filledCount;
        for (const pair of deferredToAi) {
            // Never override an answer the AI already picked in the same radio/checkbox question
            if (pair.isChoice && isChoiceGroupAnswered(pair.control)) continue;
            await tryAssignPair(pair);
        }
        if (filledCount > before) {
            console.log(`[Aullevo] Keyword fallback filled ${filledCount - before} controls the AI left empty.`);
        }
    }

    // Step 7b: Uploads the site let slip. Some uploaders (Fillout) drop a file handed to them right as
    // the fill starts; pressing Fill again attached it. Done here instead: a file the page doesn't
    // show by now is handed over once more
    if (injectedUploads.length > 0) {
        await sleep(400);
        for (const { input, anchor, file, before } of injectedUploads) {
            if (uploadShowsFile(input, anchor, file.fileName, before)) continue;
            const target = input.isConnected
                ? harvestActiveFileInputs().find(u => u.input === input)
                : harvestActiveFileInputs().find(u => composedContains(anchor, u.input));
            if (!target) continue;
            if (await injectFileIntoControl(target.input, target.container, file)) {
                console.log(`[Aullevo] The page did not take "${file.fileName}" the first time: attached it again.`);
                await sleep(90);
            }
        }
    }

    // Step 8: Forms that check answers as they're typed (Google Forms' "Format: Surname, Given Names")
    // already show their error: correct those answers now instead of leaving them red
    await sleep(250);
    const liveErrors = findFieldErrors().filter(e => assignedControls.has(e.el) && readControlText(e.el));
    if (liveErrors.length > 0) {
        const repaired = await repairRejectedFields(liveErrors, useAi, speedConfig);
        if (repaired > 0) console.log(`[Aullevo] Corrected ${repaired} answer(s) the form flagged right after filling.`);
    }

    const details = fields.map((field) => {
        const match = matchedMap.get(cleanText(field.label));
        return match || { label: field.label, value: field.value, matched: false };
    });

    // For the voice agent: the questions this fill answered, by name
    const questionNames = new Map(harvestedControls.map(c => [c.control, c.labelTexts[0] || ""]));
    const filledLabels = Array.from(new Set(Array.from(assignedControls)
        .map(el => truncateLabel(questionNames.get(el) || "", 80))
        .filter(Boolean))).slice(0, 12);

    console.log(`[Aullevo] Form injection complete: ${filledCount}/${fields.length} fields filled.`);
    sleep(4500).then(clearAllHighlights);
    return {
        success: true as const,
        matchedCount: filledCount,
        totalAttempted: fields.length,
        useAi,
        aiNotice,
        details,
        filledLabels,
        ...(voiceTarget ? { matched: voiceTarget.matched } : {}),
        ...(fillCancelled ? { stopped: true } : {})
    };
}


// ============================================================================
// LAYER 6: AUTO-PAGINATION (Pro)
// background.ts drives the loop and sends one AUTO_PAGINATE_STEP per page.
// A step fills the page, audits it, then clicks Next / Continue (Submit on the last page).
// The site is the judge of what it needs:
//   - answered (by us or pre-filled by the site, incl. an uploaded file) or labeled optional: fine
//   - empty and marked required on its own (required, aria-required, *, "required"): pause first,
//     so a form with a required gap is never submitted
//   - empty and unmarked: click anyway and verify. If the page moves on, the site did not need it;
//     if it stays or shows an error, pause and point at those fields.
// Back / Previous buttons are recognized but never clicked.
//
// Fixes over injectToGoogle's autoPaginateForm:
//   - "optional" / "*" are read from the question's own block, not the nearest <div>,
//     so a neighbour's "(optional)" can no longer let a required question be skipped
//   - "Accepted: .pdf, .docx" hint text is not mistaken for an uploaded file
//   - Next is clicked once (the inner-span + element double click could skip a page)
//   - carousel / date picker "Next" and "Continue with Google" buttons are ignored
// ============================================================================

interface PaginationButton {
    element: HTMLElement;
    kind: "next" | "submit" | "start";
    label: string;
    disabled: boolean;
}

type AuditKind = "text" | "select" | "dropdown" | "radio" | "checkbox" | "file";

interface AuditQuestion {
    kind: AuditKind;
    members: HTMLElement[];
    label: string;
    scope: HTMLElement; // the question's own block of the page
    fileArea?: HTMLElement; // file questions: the whole upload widget, up to the next upload field
}

type AuditBlocker = PaginationBlocker & { scope: HTMLElement };

// Buttons that carry the application forward from an in-between page. Checked before Submit:
// "Apply anyway" starts with "Apply" but is not the final submit.
const PROCEED_BUTTON_RE = /^((?:apply|continue|proceed)\s+anyway|continue\s+(?:to\s+)?(?:the\s+)?(?:application|applying|apply)|(?:start|begin)\s+(?:my\s+|the\s+|your\s+)?application|get\s+started|(?:i\s+)?(?:agree|accept|acknowledge|understand)\s*(?:&|and)\s*(?:continue|proceed)|review\s+(?:your\s+|my\s+)?application)\b/i;
// Start screens that ask how to give your info ("Use my resume" / "Type it in myself"): the route that opens the
// empty form. Aullevo fills that from the profile; the resume goes into the form's own upload field.
const MANUAL_ENTRY_RE = /^(?:i'?ll\s+|let\s+me\s+)?(?:type|enter|fill|apply|input|complete|add|continue|proceed|start)\b.{0,30}?\b(?:manual(?:ly)?|myself|by\s+hand|without\s+(?:a\s+|my\s+)?(?:resume|cv))\b|^manual(?:ly)?\s+(?:entry|input|application|apply)\b|\b(?:manualmente|manuellement|manuell)\b/i;
// The Apply button of a job post (only counts on a page without fields, see findEntryGate)
const OPEN_APPLICATION_RE = /^apply(?:\s+(?:now|online|here|today|for\s+(?:this\s+)?(?:job|position|role|opening)))?$/i;
// Leave the application: never clicked
const EXIT_BUTTON_RE = /^(return\s+to|back\s+to|save\s*(?:&|and)\s*(?:close|exit)|exit|cancel|withdraw|discard)\b/i;
const NEXT_BUTTON_RE = /^(next|continue|proceed|save\s*(?:&|and)\s*(?:continue|next|proceed)|go\s+to\s+(?:the\s+)?next|siguiente|continuar|suivant|continuer|weiter|avanti|pr[oó]ximo|volgende|dalej|susunod|magpatuloy)\b/i;
const NOT_A_STEP_RE = /^(continue\s+(?:with|as|using|shopping|reading|browsing)|next\s+(?:article|post|story|image|photo|slide|video|month|year|week|day))\b/i;
const SUBMIT_BUTTON_RE = /^(submit|apply|send|finish|complete|done|confirm|review\s*(?:&|and)\s*submit|enviar|soumettre|absenden|isumite)\b/i;
const BACK_BUTTON_RE = /^(back|prev|previous|return|go\s+back|atr[aá]s|anterior|pr[eé]c[eé]dent|zur[uü]ck|bumalik)\b/i;
// Next buttons of carousels, date pickers and search results are not form steps
const NON_FORM_NAV_SELECTOR = "[class*='carousel' i], [class*='swiper' i], [class*='slick' i], [aria-roledescription='carousel'], [role='tablist'], [class*='datepicker' i], [class*='calendar' i], .pagination, [aria-label*='pagination' i]";
// Site chrome (search bars, newsletter boxes) never blocks a step
const PAGE_CHROME_SELECTOR = "header, nav, footer, [role='banner'], [role='navigation'], [role='contentinfo'], [role='search']";
// One question per card on these platforms (keeps grid rows and split dates under their title)
const QUESTION_CARD_SELECTOR = ".Qr7Oae, .geS5n, [data-automation-id='questionItem'], .office-form-question";

const OPTIONAL_LABEL_RE = /\b(optional|opcional|facultatif|facultative|optionnel(?:le)?|facoltativo|opsyonal)\b|\(\s*if\s+(?:applicable|any)\s*\)|\bnot\s+(?:required|mandatory)\b/i;
const NOT_OPTIONAL_RE = /\bnot\s+optional\b/i;
const REQUIRED_WORD_RE = /\b(required|mandatory|obligatorio|obligatoire|erforderlich|pflichtfeld|obbligatorio)\b/i;
const REQUIRED_CLASS_RE = /(^|[-_])(required|req|asterisk|mandatory)($|[-_])/i;
const PLACEHOLDER_CHOICE_RE = /^(?:-+\s*)?(?:please\s+)?(?:select|choose|pick)\b|^[-—–\s]*$|^none selected$/i;
// "resume.pdf" (a word character before the dot), not "Accepted: .pdf, .docx"
const UPLOADED_FILE_NAME_RE = /[\w)\]-]\.(?:pdf|docx?|rtf|txt|odt|pages|png|jpe?g|heic|webp|xlsx?|csv|pptx?|zip)\b/i;
const UPLOAD_BUTTON_RE = /\b(add|upload|attach|choose|select|browse)\b.{0,20}\b(files?|documents?|resume|cv|attachments?)\b/i;
const FILE_REMOVE_BUTTON_RE = /^(remove|delete|replace|change|clear)\b/i;
// "Uploaded Sep 5, 2026", "Uploaded on 05/09", "Uploaded today"
const UPLOADED_ON_RE = /\buploaded\s+(?:on\s+|at\s+)?(?:\d|[a-z]{3,9}\.?\s+\d|today|yesterday)/i;
// Words that make a label describe a file field (not e.g. the name heading inside a resume preview)
const FILE_LABEL_WORDS_RE = /\b(resume|cv|cover\s+letter|files?|documents?|upload|attach(?:ment)?|photo|picture|transcript|portfolio|certificate)\b/i;
const DROPDOWN_HOST_SELECTOR = "[class*='select__control'], .ant-select, .MuiAutocomplete-root, .MuiInputBase-root, .slds-combobox, lightning-combobox, .v-select, .select2-container, .choices";
const DROPDOWN_VALUE_SELECTOR = "[class*='single-value'], [class*='singleValue'], [class*='multi-value'], [class*='multiValue'], .ant-select-selection-item, .MuiChip-root, .choices__item--selectable";
const UPLOAD_BUSY_SELECTOR = ".picker-dialog, iframe[src*='picker'], [class*='upload' i] [role='progressbar'], [class*='upload' i][aria-busy='true'], [data-automation-id*='upload' i] [role='progressbar']";
const VALIDATION_ERROR_SELECTOR = "[role='alert'], [aria-live='assertive'], .error, .errors, .is-invalid, .invalid-feedback, .field-error, .form-error, [class*='error-message' i], [class*='errorMessage'], [class*='error-text' i], [data-automation-id*='error' i]";
const SCOPE_TEXT_SKIP_SELECTOR = "select, option, [role='option'], script, style, noscript, template, textarea, [contenteditable='true'], .aullevo-field-badge, .aullevo-blocker-badge, #aullevo-run-notice";
const BLOCKER_CLASS = "aullevo-needs-input";

// Parent across shadow-root boundaries
function composedParent(el: Element): HTMLElement | null {
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode();
    return root instanceof ShadowRoot ? (root.host as HTMLElement) : null;
}

function composedContains(ancestor: Element, node: Element): boolean {
    if (ancestor.contains(node)) return true;
    if (node.getRootNode() === ancestor.getRootNode()) return false;
    for (let curr = composedParent(node); curr; curr = composedParent(curr)) {
        if (curr === ancestor) return true;
    }
    return false;
}

function lowestCommonAncestor(els: HTMLElement[]): HTMLElement {
    let anc: HTMLElement | null = els[0];
    while (anc && !els.every(el => composedContains(anc as HTMLElement, el))) {
        anc = composedParent(anc);
    }
    return anc || els[0];
}

// On screen (unlike isVisible, disabled buttons still count)
function isRendered(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function truncateLabel(text: string, max = 60): string {
    const clean = text.replace(/\s+/g, " ").trim();
    return clean.length > max ? clean.substring(0, max - 3).trim() + "..." : clean;
}

function hashString(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
}

// ---------------------------------------------------------------------------
// Next / Submit buttons
// ---------------------------------------------------------------------------

function getButtonText(el: HTMLElement): string {
    const raw = el instanceof HTMLInputElement ? el.value : (el.innerText || el.textContent || "");
    const text = raw.trim() || el.getAttribute("aria-label") || el.getAttribute("title") || "";
    return text.replace(/[→›»←‹«✓✔>]+/g, " ").replace(/\s+/g, " ").trim();
}

function findPaginationButtons(): PaginationButton[] {
    const selector = "button, input[type='submit'], input[type='button'], input[type='image'], a, [role='button']";
    const found: PaginationButton[] = [];

    for (const root of getAllDOMRoots()) {
        let elements: HTMLElement[];
        try {
            elements = Array.from(root.querySelectorAll<HTMLElement>(selector));
        } catch {
            continue;
        }

        for (const el of elements) {
            if (el.id === "aullevo-floating-trigger" || !isRendered(el)) continue;
            // A <span role="button"> inside an already found <button> is the same button
            if (found.some(b => b.element.contains(el))) continue;
            if (el.closest(NON_FORM_NAV_SELECTOR)) continue;

            const label = getButtonText(el);
            if (label.length > 40 || BACK_BUTTON_RE.test(label) || NOT_A_STEP_RE.test(label) || EXIT_BUTTON_RE.test(label)) continue;

            // Links that load another page are site navigation, except same-site "Apply anyway"-style steps
            if (el.tagName === "A") {
                const href = (el.getAttribute("href") || "").trim();
                const isPageLink = href && !href.startsWith("#") && !/^javascript:/i.test(href);
                if (isPageLink) {
                    let sameSite = false;
                    try { sameSite = new URL(href, location.href).origin === location.origin; } catch { }
                    if (!sameSite || !(PROCEED_BUTTON_RE.test(label) || MANUAL_ENTRY_RE.test(label))) continue;
                }
            }

            const automationId = (el.getAttribute("data-automation-id") || "").toLowerCase();
            const testId = (el.getAttribute("data-testid") || el.getAttribute("data-test") || el.getAttribute("data-qa") || "").toLowerCase();
            const jsname = (el.getAttribute("jsname") || "").toLowerCase();
            const classTokens = Array.from(el.classList).map(c => c.toLowerCase());

            let kind: PaginationButton["kind"] | null = null;
            // Before Next: "Continue without a resume" opens the form, it is not a page of it
            if (MANUAL_ENTRY_RE.test(label)) {
                kind = "start";
            } else if (
                NEXT_BUTTON_RE.test(label) ||
                PROCEED_BUTTON_RE.test(label) ||
                jsname === "ocpkoe" ||                                   // Google Forms Next
                automationId.includes("next") ||                         // Workday, Microsoft Forms
                /(^|[-_])(next|continue)([-_]|$)/.test(testId) ||
                classTokens.some(c => ["btn-next", "next-btn", "btn-continue", "continue-btn"].includes(c))
            ) {
                kind = "next";
            } else if (
                SUBMIT_BUTTON_RE.test(label) ||
                jsname === "m2uyvd" ||                                   // Google Forms Submit
                automationId.includes("submit") ||
                /(^|[-_])submit([-_]|$)/.test(testId)
            ) {
                kind = "submit";
            }
            if (!kind) continue;

            found.push({
                element: el,
                kind,
                label: label || (kind === "submit" ? "Submit" : "Next"),
                disabled: (el as HTMLButtonElement).disabled === true ||
                    el.getAttribute("aria-disabled") === "true" ||
                    el.classList.contains("disabled") ||
                    el.classList.contains("is-disabled")
            });
        }
    }
    return found;
}

// Prefers an enabled button of the given kind inside the <form> that holds the fields
function pickPaginationButton(buttons: PaginationButton[], kind: PaginationButton["kind"], controls: HTMLElement[]): PaginationButton | null {
    let best: PaginationButton | null = null;
    let bestScore = -1;
    for (const btn of buttons) {
        if (btn.kind !== kind) continue;
        const form = btn.element.closest("form");
        const score = (form && controls.some(c => composedContains(form, c)) ? 2 : 0) + (btn.disabled ? 0 : 1);
        if (score > bestScore) {
            best = btn;
            bestScore = score;
        }
    }
    return best;
}

// The "Type it in myself" button of a start screen. Only on a page without questions:
// "Enter address manually" inside a form is part of that form, not a step.
function findEntryGate(buttons: PaginationButton[] = findPaginationButtons()): PaginationButton | null {
    if (harvestAllControls().length > 0) return null;
    const manual = buttons.find(b => b.kind === "start" && !b.disabled);
    if (manual) return manual;
    // A job post: "Apply" opens the application. With nothing filled in or uploaded there is nothing to submit.
    if (harvestActiveFileInputs().length > 0) return null;
    return buttons.find(b => b.kind === "submit" && !b.disabled && OPEN_APPLICATION_RE.test(b.label)) ?? null;
}

// One activation only: a second click could skip a whole page
function clickPaginationButton(el: HTMLElement): void {
    try {
        el.scrollIntoView({ block: "center" });
    } catch { }
    const rect = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0 };
    try { el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true })); } catch { }
    try { el.dispatchEvent(new MouseEvent("mousedown", { ...opts, buttons: 1 })); } catch { }
    try { el.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true })); } catch { }
    try { el.dispatchEvent(new MouseEvent("mouseup", { ...opts, buttons: 0 })); } catch { }
    el.click();
}

// ---------------------------------------------------------------------------
// Question audit: which empty questions may be skipped
// ---------------------------------------------------------------------------

function classifyAuditControl(item: HarvestedControl): AuditKind | null {
    const el = item.control;
    const tag = el.tagName.toUpperCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "INPUT" && type === "file") return "file";
    if (item.isChoice) return item.choiceType === "radio" ? "radio" : "checkbox";
    if (item.isCountryCode) return null; // dial code pickers come pre-set
    if (tag === "SELECT") return "select";
    if (item.isCustomDropdown || tag === "LIGHTNING-COMBOBOX") return "dropdown";
    if (tag === "INPUT") return ["search", "range", "color", "image", "reset", "submit", "button"].includes(type) ? null : "text";
    if (tag === "TEXTAREA" || tag === "LIGHTNING-INPUT" || tag === "LIGHTNING-TEXTAREA") return "text";
    if (el.isContentEditable || el.getAttribute("role") === "textbox") return "text";
    return null; // CAPTCHA widgets, framework wrappers
}

// Radios / checkboxes answering the same question share a key
function getChoiceGroupKey(control: HTMLElement, kind: AuditKind, entries: { el: HTMLElement; kind: AuditKind }[]): string | HTMLElement {
    const card = control.closest<HTMLElement>(QUESTION_CARD_SELECTOR);
    if (card) return card;

    if (control instanceof HTMLInputElement && control.name) {
        const sameName = entries.filter(e => e.el instanceof HTMLInputElement && e.el.name === control.name && e.el.form === control.form);
        if (kind === "radio" || sameName.length > 1) return `${kind}:${control.name}`;
    }

    const container = control.closest<HTMLElement>("[role='radiogroup'], [role='group'], fieldset, [role='list']");
    if (container) {
        const inside = entries.filter(e => composedContains(container, e.el));
        if (inside.length > 1 && inside.every(e => e.kind === kind)) return container;
    }
    return control;
}

// The question's own block: grows from its controls until the next ancestor would also hold another question
function findQuestionScope(start: HTMLElement, others: HTMLElement[], root: HTMLElement | null): HTMLElement {
    const card = start.closest<HTMLElement>(QUESTION_CARD_SELECTOR);
    if (card) return card;

    let scope = start;
    for (let parent = composedParent(scope); parent; parent = composedParent(scope)) {
        if (parent === root || /^(FORM|BODY|HTML|MAIN|DIALOG)$/.test(parent.tagName)) break;
        const role = parent.getAttribute("role");
        if (role === "main" || role === "dialog") break;
        if (others.some(o => composedContains(parent as HTMLElement, o))) break;
        if ((parent.innerText || "").length > 1500) break;
        scope = parent;
    }
    return scope;
}

// Visible text of an element, without dropdown options, typed answers or Aullevo badges
function getVisibleText(el: HTMLElement, maxLength = 4000): string {
    const parts: string[] = [];
    let total = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node && total < maxLength; node = walker.nextNode()) {
        const parent = node.parentElement;
        const text = node.nodeValue?.trim();
        if (!parent || !text || parent.closest(SCOPE_TEXT_SKIP_SELECTOR)) continue;
        if (typeof parent.checkVisibility === "function" && !parent.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) continue;
        parts.push(text);
        total += text.length;
    }
    return parts.join(" ");
}

function getQuestionText(q: AuditQuestion): string {
    const parts = [getVisibleText(q.scope)];
    for (const el of q.members) {
        (el as HTMLInputElement).labels?.forEach(label => parts.push(getVisibleText(label)));
        for (const attr of ["aria-labelledby", "aria-describedby"]) {
            for (const id of (el.getAttribute(attr) || "").split(/\s+/).filter(Boolean)) {
                const ref = (el.getRootNode() as Document | ShadowRoot).getElementById(id);
                if (ref) parts.push(getVisibleText(ref));
            }
        }
        parts.push(el.getAttribute("aria-label") || "", (el as HTMLInputElement).placeholder || "", el.getAttribute("title") || "");
    }
    return parts.join(" ").replace(/\s+/g, " ");
}

function readRequirementMarkers(q: AuditQuestion, text: string): { hardRequired: boolean; softRequired: boolean; optionalLabel: boolean } {
    // required / aria-required: the site itself will refuse to continue without an answer
    const hardRequired = q.members.some(el => {
        if ((el as HTMLInputElement).required === true || el.getAttribute("aria-required") === "true" || el.getAttribute("data-required") === "true") return true;
        const marked = el.closest("[aria-required='true']");
        return Boolean(marked && composedContains(q.scope, marked));
    });

    const optionalLabel = OPTIONAL_LABEL_RE.test(text) && !NOT_OPTIONAL_RE.test(text);

    const markerEls = [q.scope, ...Array.from(q.scope.querySelectorAll<HTMLElement>("[class*='req' i], [class*='asterisk' i], [class*='mandatory' i]"))];
    const hasRequiredClass = markerEls.some(el => Array.from(el.classList).some(c => REQUIRED_CLASS_RE.test(c) && !/not[-_]?required|optional/i.test(c)));
    const softRequired = !optionalLabel && (/[*∗＊]/.test(text) || REQUIRED_WORD_RE.test(text) || hasRequiredClass);

    return { hardRequired, softRequired, optionalLabel };
}

function readControlText(el: HTMLElement): string {
    const value = (el as HTMLInputElement).value;
    return typeof value === "string" ? value.trim() : (el.innerText || "").trim();
}

function isSelectAnswered(select: HTMLSelectElement): boolean {
    if (select.multiple) return select.selectedOptions.length > 0;
    const opt = select.options[select.selectedIndex];
    return Boolean(opt) && select.value.trim() !== "" && !opt.disabled && !PLACEHOLDER_CHOICE_RE.test(opt.text.trim());
}

function isDropdownAnswered(el: HTMLElement): boolean {
    const host = el.closest<HTMLElement>(DROPDOWN_HOST_SELECTOR) || el;
    if (host.querySelector(DROPDOWN_VALUE_SELECTOR)) return true;

    // Google Forms / ARIA listbox: the chosen option carries aria-selected (Google's "Choose" has data-value="")
    const selected = host.querySelector<HTMLElement>("[role='option'][aria-selected='true']");
    if (selected) {
        const dataValue = selected.getAttribute("data-value");
        return dataValue !== null ? dataValue.trim() !== "" : !PLACEHOLDER_CHOICE_RE.test(getCleanElementText(selected));
    }

    if (el instanceof HTMLInputElement && el.value.trim()) return !PLACEHOLDER_CHOICE_RE.test(el.value.trim());

    let text = host.innerText || "";
    host.querySelectorAll<HTMLElement>("[class*='placeholder' i]").forEach(p => {
        if (p.innerText) text = text.replace(p.innerText, "");
    });
    text = text.replace(/\s+/g, " ").trim();
    return text.length > 0 && !PLACEHOLDER_CHOICE_RE.test(text);
}

// Grows a file question's block past its neighbours (e.g. the selected-resume card around a hidden
// "replace file" input) until the next ancestor would also hold another upload field.
// No size limit: a resume preview rendered as text makes the card thousands of characters long.
function findUploadArea(scope: HTMLElement, otherFileEls: HTMLElement[], root: HTMLElement | null): HTMLElement {
    let area = scope;
    for (let parent = composedParent(area); parent; parent = composedParent(area)) {
        if (parent === root || /^(FORM|BODY|HTML)$/.test(parent.tagName)) break;
        if (otherFileEls.some(o => composedContains(parent as HTMLElement, o))) break;
        area = parent;
    }
    return area;
}

// Page shows a picked file: a selected option (radio / card) whose text names a file,
// e.g. Indeed's "JULLE MYTH VICENTILLO RESUME.pdf ✓ Uploaded Sep 5, 2026" card
function hasSelectedFileOption(area: HTMLElement): boolean {
    const selected = Array.from(area.querySelectorAll<HTMLElement>(
        "input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox'], [role='option'], [aria-selected='true'], [aria-checked='true'], [aria-pressed='true']"
    )).filter(isControlChecked);
    return selected.some((el) => {
        const option = el.closest<HTMLElement>("label, [role='radio'], [role='option'], li, [class*='card' i]") || el.parentElement;
        const optionText = option ? getVisibleText(option, 400) : "";
        return UPLOADED_FILE_NAME_RE.test(optionText) || UPLOADED_ON_RE.test(optionText);
    });
}

function hasUploadedFile(q: AuditQuestion, text: string): boolean {
    if (q.members.some(el => el instanceof HTMLInputElement && (el.files?.length ?? 0) > 0)) return true;
    const area = q.fileArea || q.scope;
    const areaText = area === q.scope ? text : `${text} ${getVisibleText(area, 20000)}`;
    if (UPLOADED_FILE_NAME_RE.test(areaText) || UPLOADED_ON_RE.test(areaText)) return true;
    if (hasSelectedFileOption(area)) return true;

    const fileItem = Array.from(area.querySelectorAll<HTMLElement>(
        "[class*='uploaded' i], [class*='file-name' i], [class*='filename' i], [class*='file-item' i], [data-automation-id*='file-upload-item' i], [data-automation-id*='uploaded' i]"
    )).some(el => {
        const itemText = getCleanElementText(el);
        return itemText.length > 0 && !/no\s+file|not\s+uploaded|^none$/i.test(itemText);
    });
    if (fileItem) return true;

    // "Remove" / "Replace" next to the upload only shows once a file is attached
    return Array.from(q.scope.querySelectorAll<HTMLElement>("button, [role='button']"))
        .some(btn => isRendered(btn) && FILE_REMOVE_BUTTON_RE.test(getButtonText(btn)));
}

function isQuestionAnswered(q: AuditQuestion, text: string): boolean {
    switch (q.kind) {
        case "radio":
        case "checkbox":
            return q.members.some(isControlChecked);
        case "select":
            return q.members.some(el => isSelectAnswered(el as HTMLSelectElement));
        case "dropdown":
            return q.members.some(isDropdownAnswered);
        case "file":
            return hasUploadedFile(q, text);
        default:
            return q.members.some(el => readControlText(el).length > 0);
    }
}

// Upload widgets without an <input type="file"> on the page (e.g. Google Forms "Add file")
function findCustomUploadButtons(inScope: (el: HTMLElement) => boolean): HTMLElement[] {
    const result: HTMLElement[] = [];
    for (const root of getAllDOMRoots()) {
        root.querySelectorAll<HTMLElement>("button, [role='button']").forEach((btn) => {
            if (!isRendered(btn) || !inScope(btn) || result.some(r => r.contains(btn) || btn.contains(r))) return;
            const text = getButtonText(btn);
            if (text.length > 60 || !UPLOAD_BUTTON_RE.test(text)) return;
            // Buttons that open a real file input are audited through that input
            let anc: HTMLElement | null = btn;
            for (let i = 0; i < 4 && anc; i++, anc = composedParent(anc)) {
                if (anc.querySelector("input[type='file']")) return;
            }
            result.push(btn);
        });
    }
    return result;
}

function collectAuditQuestions(root: HTMLElement | null): AuditQuestion[] {
    const inScope = (el: HTMLElement) => root ? composedContains(root, el) : !el.closest(PAGE_CHROME_SELECTOR);

    const entries = harvestAllControls()
        .map(item => ({ item, el: item.control, kind: classifyAuditControl(item) }))
        .filter((e): e is { item: HarvestedControl; el: HTMLElement; kind: AuditKind } => e.kind !== null && e.kind !== "file" && inScope(e.el));
    // Keep the innermost control when a framework wrapper and its native input were both harvested
    const controls = entries.filter(e => !entries.some(o => o !== e && composedContains(e.el, o.el)));

    const groups = new Map<string | HTMLElement, { kind: AuditKind; members: HTMLElement[]; item: HarvestedControl; start: HTMLElement }>();
    for (const { item, el, kind } of controls) {
        const key = kind === "radio" || kind === "checkbox" ? getChoiceGroupKey(el, kind, controls) : el;
        const group = groups.get(key);
        if (group) group.members.push(el);
        else groups.set(key, { kind, members: [el], item, start: key instanceof HTMLElement ? key : el });
    }

    const uploads = harvestActiveFileInputs().filter(u => inScope(u.input));
    const uploadButtons = findCustomUploadButtons(inScope);
    const allQuestionEls = [...controls.map(c => c.el), ...uploads.map(u => u.input), ...uploadButtons];

    const questions: AuditQuestion[] = [];
    const fileEls = [...uploads.map(u => u.input), ...uploadButtons];
    const addQuestion = (kind: AuditKind, members: HTMLElement[], start: HTMLElement, label: string) => {
        const others = allQuestionEls.filter(el => !members.includes(el));
        const scope = findQuestionScope(start, others, root);
        const fileArea = kind === "file" ? findUploadArea(scope, fileEls.filter(el => !members.includes(el)), root) : undefined;
        questions.push({ kind, members, label: truncateLabel(label || "Unlabeled field"), scope, fileArea });
    };
    // The page's own wording for the side panel message (harvested labelTexts are normalized to lowercase)
    const labelOf = (el: HTMLElement, labelTexts: string[], isChoice = false) => {
        const own = isChoice
            ? el.closest("fieldset")?.querySelector("legend")
            : (el as HTMLInputElement).labels?.[0];
        const ownText = own ? getVisibleText(own as HTMLElement).replace(/[*∗＊]/g, "").trim() : "";
        return ownText || labelTexts.find(Boolean) || el.getAttribute("aria-label") || (el as HTMLInputElement).placeholder || (el as HTMLInputElement).name || "";
    };

    for (const group of groups.values()) {
        const start = group.members.length > 1 ? lowestCommonAncestor(group.members) : group.start;
        const isChoice = group.kind === "radio" || group.kind === "checkbox";
        addQuestion(group.kind, group.members, start, labelOf(group.item.control, group.item.labelTexts, isChoice));
    }

    // File inputs are often hidden behind a button: only trust labels that talk about files
    const fileLabelOf = (input: HTMLInputElement) => {
        const own = input.labels?.[0] ? getVisibleText(input.labels[0]).replace(/[*∗＊]/g, "").trim() : "";
        const candidates = [own, input.getAttribute("aria-label") || "", input.title, ...resolveControlLabels(input)];
        return candidates.find(t => t && FILE_LABEL_WORDS_RE.test(t)) || "File upload";
    };

    for (const { input, container } of uploads) {
        const holdsOthers = allQuestionEls.some(o => o !== input && composedContains(container, o));
        addQuestion("file", [input], holdsOthers ? input : container, fileLabelOf(input));
    }

    for (const btn of uploadButtons) {
        if (questions.some(q => q.kind === "file" && composedContains(q.fileArea || q.scope, btn))) continue;
        const title = btn.closest(QUESTION_CARD_SELECTOR)?.querySelector<HTMLElement>("[role='heading'], .M7eMe");
        addQuestion("file", [btn], btn, cleanText(getCleanElementText(title)) || getButtonText(btn));
    }

    return questions;
}

// blockers: empty and marked required -> never click past them
// unsure:   empty and unmarked -> click, and blame them if the site refuses to move on
function auditQuestions(questions: AuditQuestion[]): { blockers: AuditBlocker[]; unsure: AuditBlocker[] } {
    const blockers: AuditBlocker[] = [];
    const unsure: AuditBlocker[] = [];

    for (const q of questions) {
        const text = getQuestionText(q);
        if (isQuestionAnswered(q, text)) continue;

        const { hardRequired, softRequired, optionalLabel } = readRequirementMarkers(q, text);
        if (hardRequired) blockers.push({ name: q.label, reason: q.kind === "file" ? "required file" : "required", scope: q.scope });
        else if (optionalLabel) continue;
        else if (softRequired) blockers.push({ name: q.label, reason: q.kind === "file" ? "required file" : "marked required", scope: q.scope });
        else if (q.kind === "checkbox" && q.members.length === 1) continue; // an unticked single box is a valid answer
        else unsure.push({ name: q.label, reason: "empty", scope: q.scope });
    }
    return { blockers, unsure };
}

// ---------------------------------------------------------------------------
// Blocker highlights (kept apart from the fill badges, which clear after 4.5s)
// ---------------------------------------------------------------------------

let blockerHighlightTimer: number | undefined;

function clearBlockerHighlights(): void {
    getAllDOMRoots().forEach((root) => {
        root.querySelectorAll<HTMLElement>(`.${BLOCKER_CLASS}`).forEach((el) => {
            el.classList.remove(BLOCKER_CLASS);
            if (el.dataset.aullevoPrevPosition !== undefined) {
                el.style.position = el.dataset.aullevoPrevPosition;
                delete el.dataset.aullevoPrevPosition;
            }
        });
        root.querySelectorAll(".aullevo-blocker-badge").forEach(badge => badge.remove());
    });
}

function highlightBlockers(targets: HTMLElement[], badgeText: string): void {
    clearBlockerHighlights();
    for (const scope of targets) {
        const target = /^(INPUT|SELECT|TEXTAREA)$/.test(scope.tagName) ? findOptionRowContainer(scope) : scope;
        injectHighlightStylesToRoot(target.getRootNode() as Document | ShadowRoot);
        target.classList.add(BLOCKER_CLASS);
        if (window.getComputedStyle(target).position === "static") {
            target.dataset.aullevoPrevPosition = target.style.position;
            target.style.position = "relative";
        }
        const badge = document.createElement("div");
        badge.className = "aullevo-blocker-badge";
        badge.textContent = badgeText;
        target.appendChild(badge);
    }
    try {
        targets[0]?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch { }
    window.clearTimeout(blockerHighlightTimer);
    blockerHighlightTimer = window.setTimeout(clearBlockerHighlights, 10000);
}

// The outcome of a shortcut or Multi-link fill, in the corner of the page (the side panel's words). Click to close.
const RUN_NOTICE_ID = "aullevo-run-notice";
let runNoticeTimer: number | undefined;
function showRunNotice(text: string, type: string): void {
    if (!text) return;
    document.getElementById(RUN_NOTICE_ID)?.remove();
    const accent = type === "error" ? "#ef4444" : type === "success" ? "#10b981" : "#3b82f6";
    const box = document.createElement("div");
    box.id = RUN_NOTICE_ID;
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    box.style.cssText = [
        "position: fixed", "right: 16px", "bottom: 16px", "z-index: 2147483646", "max-width: min(380px, calc(100vw - 32px))",
        "padding: 10px 30px 10px 12px", "border-radius: 10px", `border-left: 4px solid ${accent}`,
        "background: #0f172a", "color: #e2e8f0", "box-shadow: 0 8px 28px rgba(2, 6, 23, 0.45)",
        "font: 500 12.5px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", "cursor: pointer",
        "text-align: left", "letter-spacing: normal"
    ].map(rule => `${rule} !important`).join("; ");
    const title = document.createElement("div");
    title.textContent = "Aullevo";
    title.style.cssText = `font-weight: 700 !important; font-size: 11px !important; color: ${accent} !important; margin-bottom: 2px !important; letter-spacing: 0.04em !important;`;
    const body = document.createElement("div");
    body.textContent = text;
    const close = document.createElement("span");
    close.textContent = "×";
    close.setAttribute("aria-hidden", "true");
    close.style.cssText = "position: absolute !important; top: 6px !important; right: 10px !important; font-size: 16px !important; color: #94a3b8 !important;";
    box.append(title, body, close);
    box.addEventListener("click", () => box.remove());
    (document.body || document.documentElement).appendChild(box);
    window.clearTimeout(runNoticeTimer);
    runNoticeTimer = window.setTimeout(() => box.remove(), type === "success" ? 6000 : 20000);
}

// "I'm not a robot" checks still to solve (reCAPTCHA, hCaptcha, Cloudflare Turnstile): the visible checkbox widgets
// whose answer field next to them is still empty. Invisible checks (the reCAPTCHA corner badge, score-based ones)
// and widgets whose state can't be read never stop a run. Returns the boxes to highlight.
const VERIFICATION_WIDGET_SELECTOR = "iframe[src*='recaptcha/api2/anchor'], iframe[src*='recaptcha/enterprise/anchor'], iframe[src*='hcaptcha.com'][src*='frame=checkbox'], iframe[src*='challenges.cloudflare.com']";
const VERIFICATION_ANSWER_SELECTOR = "textarea[name='g-recaptcha-response'], textarea[name='h-captcha-response'], input[name='cf-turnstile-response']";
function pendingVerifications(): HTMLElement[] {
    const boxes: HTMLElement[] = [];
    for (const root of getAllDOMRoots()) {
        root.querySelectorAll<HTMLIFrameElement>(VERIFICATION_WIDGET_SELECTOR).forEach(frame => {
            if (frame.closest(".grecaptcha-badge")) return;
            const rect = frame.getBoundingClientRect();
            if (rect.width < 100 || rect.height < 40 || !isRendered(frame)) return;
            let box: HTMLElement | null = null;
            let answer: HTMLInputElement | HTMLTextAreaElement | null = null;
            for (let el = frame.parentElement, depth = 0; el && depth < 4; el = el.parentElement, depth++) {
                answer = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(VERIFICATION_ANSWER_SELECTOR);
                if (answer) { box = el; break; }
            }
            if (!box || !answer || answer.value.trim()) return;
            if (!boxes.includes(box)) boxes.push(box);
        });
    }
    return boxes;
}

// ---------------------------------------------------------------------------
// Step runner
// ---------------------------------------------------------------------------

// Visible loading indicators. Step progress bars (aria-valuenow, e.g. Indeed's "50%") are not loading.
const PAGE_BUSY_SELECTOR = "[aria-busy='true'], [role='progressbar']:not([aria-valuenow]), [class*='spinner' i], [class*='loader' i], [class*='loading' i], [data-testid*='loading' i], [data-testid*='spinner' i]";

function getBusyIndicators(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(PAGE_BUSY_SELECTOR))
        .filter(el => isRendered(el) && !el.closest("#aullevo-floating-trigger, #aullevo-run-notice, .aullevo-field-badge, .aullevo-blocker-badge"));
}

// Waits (up to maxMs) until no loading indicator shows, ignoring ones that were already there
// (a decorative "loading" class that never goes away must not cost 20s per page)
async function waitForPageIdle(maxMs: number, ignore: Set<HTMLElement> = new Set(), isReady?: () => boolean): Promise<void> {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
        if (isReady?.()) return;
        if (!getBusyIndicators().some(el => !ignore.has(el))) return;
        await sleep(400);
    }
}

async function waitForUploadsToSettle(maxMs: number): Promise<void> {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
        const busy = Array.from(document.querySelectorAll<HTMLElement>(UPLOAD_BUSY_SELECTOR)).some(isRendered);
        if (!busy) return;
        await sleep(400);
    }
}

/**
 * Answers can unlock more questions: City after Country (options load later), a branch after a
 * radio. Fills the ones that appeared empty, without touching anything already answered.
 * Returns how many controls those extra passes filled.
 */
async function fillAppearedQuestions(
    fields: any[],
    useAi: boolean,
    speedPreset: string | SpeedConfig,
    controlsBeforeFill: Set<HTMLElement>,
    busyBeforeFill: Set<HTMLElement>,
    patienceMs: number
): Promise<number> {
    let matchedCount = 0;
    for (let pass = 0; pass < MAX_CATCH_UP_PASSES && !fillCancelled; pass++) {
        const appeared = harvestAllControls().filter(c => !controlsBeforeFill.has(c.control) && !hasExistingAnswer(c));
        if (appeared.length === 0) break;
        appeared.forEach(c => controlsBeforeFill.add(c.control));
        console.log(`[Aullevo] ${appeared.length} question(s) appeared after filling, filling them too`);
        const more = await injectFormFields(fields, useAi, speedPreset, [], { keep: "all" });
        if (!more.success) break;
        matchedCount += more.matchedCount ?? 0;
        await sleep(500);
        await waitForPageIdle(patienceMs, busyBeforeFill);
    }
    return matchedCount;
}

/**
 * The Fill button on a single page: one fill, then the questions its answers unlocked
 * (a City list that loads after Country). Auto-pagination does the same per page.
 */
/**
 * Voice "answer the gym question with: I jog every day": the user's own words go into the one question they named
 * (the best match). Text boxes get the words as said; a choice, list or dropdown gets the option they name.
 */
async function writeDictatedAnswer(target: VoiceFillTarget, speedPreset: string | SpeedConfig) {
    const speedConfig = resolveSpeedConfig(speedPreset);
    const value = String(target.value || "").trim();
    clearAllHighlights();
    const controls = harvestAllControls();
    const pick = await pickVoiceTarget(controls, target);
    const group = questionGroups(controls.filter(c => pick.controls.has(c.control)))[0];
    let filled = 0;
    const filledLabels: string[] = [];
    if (group && value) {
        const first = group[0];
        const el = first.control;
        const label = first.labelTexts[0] || "";
        let ok: boolean | string = false;
        if (first.isChoice) {
            const best = group
                .map(item => ({ item, score: computeChoiceMatchScore(value, item.choiceText) }))
                .sort((a, b) => b.score - a.score)[0];
            if (best && best.score >= 0.5) ok = toggleChoiceControl(best.item.control, first.choiceType === "checkbox" ? "checkbox" : "radio", true);
        } else if (el instanceof HTMLSelectElement) {
            ok = fillSelectElement(el, value);
        } else if (first.isCustomDropdown) {
            ok = await fillCustomDropdown(el, value);
        } else {
            ok = await applyValueToControl(el, value, label, speedConfig, true);
        }
        if (ok !== false) {
            filled = 1;
            filledLabels.push(truncateLabel(label, 80));
            highlightFilledElement(el);
        }
    }
    sleep(4500).then(clearAllHighlights);
    return { success: true as const, matchedCount: filled, useAi: false, filledLabels, matched: pick.matched };
}

async function fillPage(fields: any[], useAi: boolean, speedPreset: string | SpeedConfig, files: ProfileFile[], target?: VoiceFillTarget) {
    if (target?.value) return writeDictatedAnswer(target, speedPreset);
    if (!target) await openEntryGate();
    const busyBeforeFill = new Set(getBusyIndicators());
    const controlsBeforeFill = new Set(harvestAllControls().map(c => c.control));
    const fill = await injectFormFields(fields, useAi, speedPreset, files, { target });
    if (!fill.success) return fill;
    // A voice fill of named questions ("fill the email") stops here: it touched only those
    if (target || fill.stopped) return fill;

    await sleep(500);
    await waitForPageIdle(CATCH_UP_PATIENCE_MS, busyBeforeFill);
    const more = await fillAppearedQuestions(fields, Boolean(fill.useAi), speedPreset, controlsBeforeFill, busyBeforeFill, CATCH_UP_PATIENCE_MS);
    // The page's own code never saw the answers: no City list after Country, no validation
    const scriptsNotice = pageTimersBlocked
        ? "This site's scripts are blocked (Brave Shields → Block scripts), so the page may not react to the answers."
        : undefined;
    const aiNotice = [fill.aiNotice, scriptsNotice].filter(Boolean).join(" ") || undefined;
    return {
        ...fill,
        matchedCount: (fill.matchedCount ?? 0) + more,
        aiNotice,
        left: unansweredQuestions(),
        ...(fillCancelled ? { stopped: true } : {})
    };
}

// A start screen hides the form behind "Type it in myself": open it, and leave its resume upload alone
// (that one hands the file to the site's own reader instead of showing the form)
// Job post → "Apply" → "Type it in myself" → form: up to three screens before the first question
async function openEntryGate(): Promise<void> {
    for (let screen = 0; screen < 3; screen++) {
        const gate = findEntryGate();
        if (!gate || !(await clickEntryGate(gate))) return;
        await sleep(500);
        await waitForPageIdle(CATCH_UP_PATIENCE_MS);
    }
}

// True once the page moved on. The next start screen has no fields either: its new buttons show it.
async function clickEntryGate(gate: PaginationButton): Promise<boolean> {
    console.log(`[Aullevo] Start screen: clicking "${gate.label}" to open the form`);
    const before = getVisibleControlSet();
    const beforeButtons = findPaginationButtons().map(b => b.element);
    clickPaginationButton(gate.element);
    const newButtons = () => findPaginationButtons().some(b => !beforeButtons.includes(b.element));
    return waitForStepChange(location.href, before, PAGE_LOAD_PATIENCE_MS, newButtons);
}

function getVisibleControlSet(): Set<HTMLElement> {
    return new Set([...harvestAllControls().map(c => c.control), ...harvestActiveFileInputs().map(u => u.input)]);
}

// True once the click led somewhere: new URL, most fields replaced, or new fields revealed
async function waitForStepChange(beforeUrl: string, before: Set<HTMLElement>, timeoutMs: number, isDone?: () => boolean, isRefused?: () => boolean): Promise<boolean> {
    const start = Date.now();
    const deadline = start + timeoutMs;
    while (Date.now() < deadline) {
        await sleep(400);
        if (location.href !== beforeUrl || isDone?.()) return true;
        // Errors appeared and the page stayed for a moment: it refused (a slow page load still gets its time)
        if (isRefused && Date.now() - start > 1500 && isRefused()) return false;
        const now = getVisibleControlSet();
        let gone = 0;
        before.forEach((el) => {
            if (!now.has(el)) gone++;
        });
        const added = Array.from(now).some(el => !before.has(el));
        if (added || (before.size > 0 && gone >= Math.ceil(before.size / 2))) return true;
    }
    return false;
}

const SUBMIT_CONFIRMATION_RE = /\b(thank\s*you|thanks|(?:successfully\s+)?submitted|has\s+been\s+(?:received|recorded|sent)|response\s+(?:was\s+|has\s+been\s+)?recorded|application\s+(?:was\s+|has\s+been\s+)?(?:received|sent))\b/i;

// A confirmation line that was not on the page before the Submit click
function hasNewSubmitConfirmation(beforeText: string): boolean {
    const lines = (document.body?.innerText || "").split("\n").map(l => l.trim()).filter(Boolean);
    return lines.some(line => line.length <= 200 && SUBMIT_CONFIRMATION_RE.test(line) && !beforeText.includes(line));
}

function collectValidationErrors(): string[] {
    const texts: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(VALIDATION_ERROR_SELECTOR))) {
        if (!isRendered(el) || el.closest(".aullevo-blocker-badge, #aullevo-floating-trigger, #aullevo-run-notice")) continue;
        const text = getCleanElementText(el);
        if (text.length >= 3 && text.length <= 200 && !texts.includes(text)) texts.push(text);
        if (texts.length >= 3) break;
    }
    return texts;
}

async function runPaginationStep(
    fields: any[],
    useAi: boolean,
    speedPreset: string | SpeedConfig,
    files: ProfileFile[],
    advance: boolean
): Promise<PaginationStepResult> {
    clearBlockerHighlights();

    // A step that is still loading shows a spinner and no fields or buttons yet
    const hasContent = () => harvestAllControls().length > 0 || findPaginationButtons().length > 0;
    await waitForPageIdle(PAGE_LOAD_PATIENCE_MS, new Set(), hasContent);

    // A start screen ("Use my resume" / "Type it in myself"): open the form, it is filled as the next page
    const gate = findEntryGate();
    if (gate) {
        if (!advance) return { success: true, matchedCount: 0, pagination: { status: "max-pages", buttonLabel: gate.label } };
        const moved = await clickEntryGate(gate);
        return { success: true, matchedCount: 0, pagination: { status: moved ? "advanced" : "stuck", buttonLabel: gate.label } };
    }

    const busyBeforeFill = new Set(getBusyIndicators());
    const controlsBeforeFill = new Set(harvestAllControls().map(c => c.control));
    // Pressing Fill again after a pause continues: answers already given on this page (by Aullevo or by hand) stay
    const fill = await injectFormFields(fields, useAi, speedPreset, files, { keep: "touched" });
    if (!fill.success) {
        return { success: false, error: fill.error, pagination: { status: "error" } };
    }
    let matchedCount = fill.matchedCount ?? 0;
    const speedConfig = resolveSpeedConfig(speedPreset);

    // Let frameworks validate and reveal conditional questions, and uploads finish
    await sleep(500);
    await waitForUploadsToSettle(files.length > 0 ? PAGE_LOAD_PATIENCE_MS : 3000);
    // Spinners our answers triggered (e.g. the site checking an answer) must finish before clicking
    await waitForPageIdle(PAGE_LOAD_PATIENCE_MS, busyBeforeFill);

    matchedCount += await fillAppearedQuestions(fields, Boolean(fill.useAi), speedPreset, controlsBeforeFill, busyBeforeFill, PAGE_LOAD_PATIENCE_MS);

    // Answers the browser already knows break the field's format (pattern, e-mail, number range):
    // reshape them now instead of waiting for the site to refuse
    let repaired = await conformInvalidAnswers(speedConfig);
    if (repaired > 0) {
        await sleep(400);
        await waitForPageIdle(PAGE_LOAD_PATIENCE_MS, busyBeforeFill);
    }
    const filled = { success: true, matchedCount, useAi: fill.useAi, aiNotice: fill.aiNotice };
    // Voice "stop": never click Next / Submit after the user asked to stop
    if (fillCancelled) return { ...filled, pagination: { status: "stopped" } };

    const controlEls = harvestAllControls().map(c => c.control);
    const buttons = findPaginationButtons();
    const next = pickPaginationButton(buttons, "next", controlEls);
    const submit = pickPaginationButton(buttons, "submit", controlEls);
    const auditForm = (next ?? submit)?.element.closest("form");
    const auditRoot = auditForm && controlEls.some(c => composedContains(auditForm, c)) ? auditForm : null;

    const { blockers, unsure } = auditQuestions(collectAuditQuestions(auditRoot));
    const toInfo = (list: AuditBlocker[]) => list.map(({ name, reason }) => ({ name, reason }));
    const blockerInfo = toInfo(blockers);
    // An unsolved "I'm not a robot" check: the user has to do it, so stop here and point at it
    const verifications = next || submit ? pendingVerifications() : [];
    if (blockers.length > 0 || verifications.length > 0) {
        highlightBlockers([...blockers.map(b => b.scope), ...verifications], "Needs your input");
    }

    // Next on middle pages, Submit on the last one
    const target = next ?? submit;
    if (!target) {
        return { ...filled, pagination: { status: "no-next", blockers: toInfo([...blockers, ...unsure]) } };
    }
    const isSubmit = target === submit;
    if (blockers.length > 0) {
        return { ...filled, pagination: { status: "blocked", blockers: blockerInfo, buttonLabel: target.label } };
    }
    if (verifications.length > 0) {
        // reason matches VERIFICATION_BLOCKER in services/runText.ts (the panel's and the notice's wording)
        return { ...filled, pagination: { status: "blocked", blockers: [{ name: "I'm not a robot", reason: "verification" }], buttonLabel: target.label } };
    }
    if (target.disabled) {
        return { ...filled, pagination: { status: "next-disabled", buttonLabel: target.label } };
    }
    if (!isSubmit && !advance) {
        return { ...filled, pagination: { status: "max-pages", buttonLabel: target.label } };
    }

    const errorsBefore = collectValidationErrors();
    let lastFieldErrors: FieldError[] = [];
    let serverStatus: number | undefined;

    for (let round = 0; ; round++) {
        const { outcome, serverStatus: failedStatus } = await clickAndWaitForStep(target, isSubmit, matchedCount, errorsBefore);
        serverStatus = failedStatus;
        if (outcome) {
            return { ...filled, repaired, pagination: { status: outcome, buttonLabel: target.label } };
        }

        // The site refused: read the error under each field, correct those answers, press again
        lastFieldErrors = findFieldErrors();
        if (round >= MAX_REPAIR_ROUNDS || lastFieldErrors.length === 0) break;
        const fixed = await repairRejectedFields(lastFieldErrors, Boolean(fill.useAi), speedConfig);
        if (fixed === 0) break;
        repaired += fixed;
        console.log(`[Aullevo] Auto-pagination: corrected ${fixed} rejected answer(s), retrying "${target.label}"`);
        // The site may re-check the new answer (e.g. "Checking availability…"): let it finish first
        await sleep(400);
        await waitForPageIdle(PAGE_LOAD_PATIENCE_MS, busyBeforeFill);
    }

    // Still refused: point at the fields the site complained about, then the unmarked empty ones
    const errors = collectValidationErrors();
    const errorText = lastFieldErrors[0]?.error || errors.find(e => !errorsBefore.includes(e)) || errors[0];
    const invalid = harvestAllControls().map(c => c.control).filter(el => el.getAttribute("aria-invalid") === "true");
    const suspects = [...lastFieldErrors.map(e => e.scope), ...invalid, ...unsure.map(u => u.scope)];
    if (suspects.length > 0) {
        highlightBlockers(suspects, "Check this field");
    }
    const named = [...lastFieldErrors.map(e => ({ name: e.label, reason: e.error })), ...toInfo(unsure)];
    return {
        ...filled,
        repaired,
        pagination: {
            status: errorText || invalid.length > 0 ? "validation-error" : "stuck",
            errorText: errorText ? truncateLabel(errorText, 120) : undefined,
            serverStatus,
            blockers: named,
            buttonLabel: target.label
        }
    };
}

/**
 * Voice "next" / "submit": clicks the form's Next button once (Submit when there is no Next and the user said
 * submit). Nothing is filled; a required question left empty stops it, like auto-pagination.
 */
async function advancePage(submit: boolean): Promise<{ action: string; blockedBy?: string }> {
    clearBlockerHighlights();
    const controlEls = harvestAllControls().map(c => c.control);
    const buttons = findPaginationButtons();
    const next = pickPaginationButton(buttons, "next", controlEls) ?? findEntryGate(buttons);
    const submitButton = pickPaginationButton(buttons, "submit", controlEls);
    const target = next ?? (submit ? submitButton : null);
    if (!target) return { action: submitButton ? "ready-to-submit" : "none" };
    const isSubmit = target === submitButton;

    const auditForm = target.element.closest("form");
    const auditRoot = auditForm && controlEls.some(c => composedContains(auditForm, c)) ? auditForm : null;
    const { blockers } = auditQuestions(collectAuditQuestions(auditRoot));
    if (blockers.length > 0) {
        highlightBlockers(blockers.map(b => b.scope), "Needs your input");
        return { action: "blocked", blockedBy: blockers[0].name };
    }
    if (target.disabled) return { action: "blocked", blockedBy: target.label };

    const { outcome } = await clickAndWaitForStep(target, isSubmit, 0, collectValidationErrors());
    if (outcome === "advanced") return { action: "next" };
    if (outcome === "submitted") return { action: "submitted" };
    if (isSubmit) return { action: "not-submitted" };
    const errors = findFieldErrors();
    if (errors.length > 0) highlightBlockers(errors.map(e => e.scope), "Check this field");
    return { action: "blocked", blockedBy: errors[0]?.label || collectValidationErrors()[0] };
}

// Clicks Next / Submit once and waits for the page to move on. Outcome null when the site refused;
// serverStatus then holds the error code of the request the click sent, if the server rejected it.
async function clickAndWaitForStep(
    target: PaginationButton, isSubmit: boolean, matchedCount: number, errorsBefore: string[]
): Promise<{ outcome: "advanced" | "submitted" | null; serverStatus?: number }> {
    const beforeUrl = location.href;
    const beforeControls = getVisibleControlSet();
    const beforeText = isSubmit ? (document.body?.innerText || "") : "";
    const invalidBefore = new Set(Array.from(document.querySelectorAll("[aria-invalid='true']")));

    // If the click loads a new page, this script dies before replying: report the count first
    // (throws synchronously when the extension was reloaded; that must not stop the click)
    try {
        chrome.runtime.sendMessage({ action: "PAGINATION_PAGE_FILLED", matchedCount, clicked: isSubmit ? "submit" : "next" }).catch(() => { });
    } catch { }
    console.log(`[Aullevo] Auto-pagination: clicking "${target.label}"`);
    const requests = watchPageRequests();
    clickPaginationButton(target.element);

    // A full page load ends this script before it answers; background.ts handles that.
    // Some sites submit in the background and only show a confirmation next to the form.
    const confirmed = isSubmit ? () => hasNewSubmitConfirmation(beforeText) : undefined;
    // Stop waiting early once the site shows new errors (the page is not going anywhere)
    const refused = () =>
        Array.from(document.querySelectorAll("[aria-invalid='true']")).some(el => !invalidBefore.has(el)) ||
        collectValidationErrors().some(e => !errorsBefore.includes(e));
    const moved = await waitForStepChange(beforeUrl, beforeControls, PAGE_LOAD_PATIENCE_MS, confirmed, refused);
    const failed = requests.stop().find(r => r.responseStatus >= 400);
    if (moved) return { outcome: isSubmit ? "submitted" : "advanced" };
    if (failed) console.warn(`[Aullevo] Auto-pagination: the page's request after "${target.label}" failed (HTTP ${failed.responseStatus}): ${failed.name}`);
    return { outcome: null, serverStatus: failed?.responseStatus };
}

// The requests the page itself sends (fetch / XHR), from the browser's own request log. A site that
// swallows a failed save shows nothing, yet its request still carries the status code.
// (Cross-site requests without Timing-Allow-Origin report status 0 and are never counted as failed.)
function watchPageRequests(): { stop: () => PerformanceResourceTiming[] } {
    const seen: PerformanceResourceTiming[] = [];
    let observer: PerformanceObserver | null = null;
    try {
        observer = new PerformanceObserver(list => {
            for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
                if (entry.initiatorType === "fetch" || entry.initiatorType === "xmlhttprequest") seen.push(entry);
            }
        });
        observer.observe({ type: "resource" });
    } catch { }
    return { stop: () => { observer?.disconnect(); return seen; } };
}

// ---------------------------------------------------------------------------
// Self-correction: read the site's error under a field, fix the value, try again
// ---------------------------------------------------------------------------

const MAX_REPAIR_ROUNDS = 2;
// Fill passes for questions that appear after earlier answers (City after Country, ...)
const MAX_CATCH_UP_PASSES = 2;
const CATCH_UP_PATIENCE_MS = 5000; // single-page Fill: wait this long for questions an answer unlocked
// How long a slow site gets to load a step or react to a click (errors still end the wait early)
const PAGE_LOAD_PATIENCE_MS = 20000;

interface ValueFormat {
    numeric?: boolean;
    integer?: boolean;
    digitsOnly?: boolean;
    min?: number;
    max?: number;
    maxLength?: number;
    pattern?: string;
    url?: boolean;    // <input type="url">: only a full web address passes
    email?: boolean;  // <input type="email">
}

// ---- Native format rules (pattern, type=email/url/number, min/max/step) ----

function breaksNativeFormat(v: ValidityState): boolean {
    return v.patternMismatch || v.typeMismatch || v.rangeOverflow || v.rangeUnderflow || v.stepMismatch || v.badInput;
}

// The browser's own verdict on a value for this input, tested on a detached copy (the page never sees it)
function passesNativeFormat(el: HTMLInputElement, value: string): boolean {
    const probe = document.createElement("input");
    for (const attr of ["type", "pattern", "min", "max", "step"]) {
        const v = el.getAttribute(attr);
        if (v !== null) probe.setAttribute(attr, v);
    }
    probe.value = value;
    // Number/date inputs silently drop values they can't parse
    return probe.value === value && !breaksNativeFormat(probe.validity);
}

// Reshapes of a value, gentlest first: "+63-985-304-7403" -> "+639853047403",
// "https://github.com/Name" -> "name" (a handle), "a@b.com" -> "a", "Foo Bar" -> "foo-bar"
function formatCandidates(value: string, maxLength: number): string[] {
    const v = value.trim();
    const compact = v.replace(/[\s\-().]/g, "");
    const lastSegment = v.replace(/[?#].*$/, "").split("/").filter(Boolean).pop()?.replace(/^@/, "") || "";
    const local = v.includes("@") && !v.includes("/") ? v.split("@")[0] : "";
    const digits = v.replace(/\D/g, "");
    const slug = (s: string) => s.toLowerCase().replace(/[\s_.]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
    const cased = (s: string) => (s ? [s, s.toLowerCase(), s.toUpperCase()] : []);

    const list = [
        ...cased(v), ...cased(compact),
        ...cased(lastSegment), slug(lastSegment),
        ...cased(local), slug(local),
        ...(digits ? [(v.startsWith("+") ? "+" : "") + digits, "+" + digits, digits] : []),
        slug(v)
    ];
    if (maxLength > 0) list.push(...list.map(s => s.slice(0, maxLength)));
    return [...new Set(list)].filter(Boolean);
}

// The gentlest reshape the browser accepts for this field, or "" when none fits
function conformToControl(el: HTMLElement, value: string): string {
    if (!(el instanceof HTMLInputElement) || !value) return "";
    // (the browser takes any "word:text" as a URL; a web address must start with http(s)://)
    return formatCandidates(value, el.maxLength).find(c => c !== value && passesNativeFormat(el, c) && valueFitsInputType(el, c)) ?? "";
}

// Before clicking: answers Aullevo typed that break the field's own format rules get reshaped.
// Values the user typed by hand are left alone (the site's error will point at them instead).
async function conformInvalidAnswers(speedConfig: SpeedConfig): Promise<number> {
    let fixed = 0;
    for (const { control: el, labelTexts } of harvestAllControls()) {
        if (!(el instanceof HTMLInputElement) || !filledOrigin.has(el) || userEdited.has(el)) continue;
        if (!el.value || !breaksNativeFormat(el.validity)) continue;
        const value = conformToControl(el, el.value);
        if (!value) continue;
        console.log(`[Aullevo] Reshaped "${labelTexts[0] || el.name}" to match the field's format`);
        await applyValueToControl(el, value, labelTexts[0] || "", speedConfig, true);
        highlightFilledElement(el, ct("fixed", { value: value.length > 20 ? value.substring(0, 17) + "..." : value }));
        fixed++;
    }
    return fixed;
}

interface FieldError {
    el: HTMLElement;
    label: string;
    error: string;
    scope: HTMLElement;
}

// Sentences that read like a validation message
const FIELD_ERROR_RE = /\b(must\s+(?:be|contain|include|have)|(?:is|are)\s+required|this\s+field|invalid|not\s+(?:a\s+)?valid|(?:please\s+)?enter\s+a\s+valid|please\s+(?:enter|provide|use|select|choose|add)|too\s+(?:long|short)|exceeds?|at\s+(?:least|most)|no\s+(?:more|less|fewer)\s+than|only\s+(?:numbers|digits|letters)|(?:numbers|digits|letters)\s+only)\b/i;
const FIELD_ERROR_SELECTOR = `${VALIDATION_ERROR_SELECTOR}, [id*='error' i], [class*='error' i], [class*='invalid' i], [data-testid*='error' i]`;

function readFormatFromControl(el: HTMLElement): ValueFormat {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return {};
    const f: ValueFormat = {};
    const type = (el.getAttribute("type") || "").toLowerCase();
    const mode = (el.getAttribute("inputmode") || "").toLowerCase();
    const pattern = el.getAttribute("pattern") || "";
    const step = (el.getAttribute("step") || "").toLowerCase();

    if (type === "number" || mode === "numeric" || mode === "decimal" || /^\^?(?:\\d|\[0-9\])[+*]\$?$/.test(pattern)) {
        f.numeric = true;
        f.integer = mode === "numeric" || /^\^?(?:\\d|\[0-9\])/.test(pattern) || (type === "number" && step !== "any" && !step.includes("."));
        const min = parseFloat(el.getAttribute("min") || "");
        const max = parseFloat(el.getAttribute("max") || "");
        if (!isNaN(min)) f.min = min;
        if (!isNaN(max)) f.max = max;
    }
    if (el.maxLength > 0) f.maxLength = el.maxLength;
    if (pattern) f.pattern = pattern;
    if (type === "url") f.url = true;
    if (type === "email") f.email = true;
    return f;
}

function readFormatFromError(text: string): ValueFormat {
    const f: ValueFormat = {};
    // "4–24 lowercase letters, numbers, or hyphens" lists allowed characters: it doesn't ask for a number
    const charsetHint = /\b(letters?|alphanumeric|hyphens?|underscores?|characters?|symbols?)\b/i.test(text);
    if (!charsetHint && /\b(numbers?|numeric|digits?|whole|integer)\b/i.test(text)) {
        if (/\bdigits?\b|\b(?:numbers|numerals)\s+only\b|\bonly\s+numbers\b/i.test(text) && !/\bvalid\s+number\b/i.test(text)) {
            f.digitsOnly = true;
        } else {
            f.numeric = true;
            f.integer = /no\s+decimals?|whole|integer|without\s+decimals?/i.test(text);
        }
    }
    const between = text.match(/between\s+(-?\d+(?:\.\d+)?)\s+and\s+(-?\d+(?:\.\d+)?)/i);
    if (between && !/char/i.test(text)) {
        f.numeric = true;
        f.min = parseFloat(between[1]);
        f.max = parseFloat(between[2]);
    }
    const maxChars = text.match(/(?:maximum|max\.?|at\s+most|up\s+to|no\s+more\s+than|fewer\s+than|less\s+than)\s+(?:of\s+)?(\d+)\s*char/i)
        || text.match(/(\d+)\s*char\w*\s*(?:or\s+(?:less|fewer)|max(?:imum)?|limit)/i);
    if (maxChars) f.maxLength = parseInt(maxChars[1], 10);
    const maxValue = !/char/i.test(text) && text.match(/(?:less\s+than\s+or\s+equal\s+to|at\s+most|no\s+more\s+than|maximum(?:\s+of)?|cannot\s+exceed)\s+(-?\d+(?:\.\d+)?)/i);
    if (maxValue) {
        f.numeric = true;
        f.max = parseFloat(maxValue[1]);
    }
    const minValue = !/char/i.test(text) && text.match(/(?:greater\s+than\s+or\s+equal\s+to|at\s+least|no\s+less\s+than|minimum(?:\s+of)?)\s+(-?\d+(?:\.\d+)?)/i);
    if (minValue) {
        f.numeric = true;
        f.min = parseFloat(minValue[1]);
    }
    return f;
}

// Reshapes a value to a format; "" when it cannot (e.g. no number in "Senior level")
function conformValue(value: string, f: ValueFormat): string {
    let v = String(value ?? "").trim();
    if (f.numeric) {
        // "5 years" -> 5, "5 - 7 years" -> 5 (first number), "1,200" -> 1200
        const match = v.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/-?\d+(?:\.\d+)?/);
        if (!match) return "";
        let n = parseFloat(match[0]);
        if (f.integer) n = Math.floor(n);
        if (f.min !== undefined) n = Math.max(f.min, n);
        if (f.max !== undefined) n = Math.min(f.max, n);
        v = String(n);
    } else if (f.digitsOnly) {
        v = v.replace(/\D/g, "");
    }
    if (f.maxLength && v.length > f.maxLength) {
        const cut = v.slice(0, f.maxLength);
        const lastSpace = cut.lastIndexOf(" ");
        v = (lastSpace > f.maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
    }
    return v;
}

// Plain-language format for the AI prompt
function describeFormat(f: ValueFormat): string {
    const parts: string[] = [];
    if (f.integer) parts.push("whole number only, digits only (e.g. 5)");
    else if (f.numeric) parts.push("number only (e.g. 5 or 2.5)");
    else if (f.digitsOnly) parts.push("digits only, no spaces or symbols");
    if (f.min !== undefined && f.max !== undefined) parts.push(`between ${f.min} and ${f.max}`);
    else if (f.min !== undefined) parts.push(`at least ${f.min}`);
    else if (f.max !== undefined) parts.push(`at most ${f.max}`);
    if (f.maxLength) parts.push(`at most ${f.maxLength} characters`);
    if (f.pattern) parts.push(`must fully match the regular expression ${f.pattern}`);
    if (f.url) parts.push("a full web address starting with https:// (a profile link, not an @handle)");
    if (f.email) parts.push("an email address");
    return parts.join("; ");
}

// The site's error message for each text answer it rejected
function findFieldErrors(): FieldError[] {
    const result: FieldError[] = [];
    for (const q of collectAuditQuestions(null)) {
        if (q.kind !== "text") continue;
        const el = q.members[0];
        const invalid = el.getAttribute("aria-invalid") === "true";
        let error = "";

        // 0. An error summary that links to this field: <a href="#member-1-email">Teammate 1: email must be unique.</a>
        //    (the site's actual reason, better than a format hint under the field)
        if (el.id) {
            const link = Array.from(document.querySelectorAll<HTMLElement>(`a[href="#${CSS.escape(el.id)}"]`))
                .find(a => isRendered(a) && !a.closest(".aullevo-blocker-badge, .aullevo-field-badge"));
            const text = link ? getCleanElementText(link) : "";
            if (text.length >= 3 && text.length <= 200) error = text;
        }

        // 1. Linked on purpose: aria-errormessage / aria-describedby
        for (const attr of error ? [] : ["aria-errormessage", "aria-describedby"]) {
            for (const id of (el.getAttribute(attr) || "").split(/\s+/).filter(Boolean)) {
                const ref = (el.getRootNode() as Document | ShadowRoot).getElementById(id);
                const text = ref && isRendered(ref) ? getCleanElementText(ref) : "";
                if (text && (attr === "aria-errormessage" || invalid || FIELD_ERROR_RE.test(text))) {
                    error = text;
                    break;
                }
            }
            if (error) break;
        }

        // 2. Shown under the field inside its question block (after it in the page, so not the question itself)
        if (!error) {
            const candidates = Array.from(q.scope.querySelectorAll<HTMLElement>(`${FIELD_ERROR_SELECTOR}, div, span, p, small`))
                .filter(e => !e.contains(el) && isRendered(e) && !e.closest(".aullevo-blocker-badge, .aullevo-field-badge") &&
                    (el.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
                .map(e => ({ e, text: getCleanElementText(e) }))
                .filter(({ text }) => text.length >= 3 && text.length <= 200 && FIELD_ERROR_RE.test(text))
                .sort((a, b) => a.text.length - b.text.length); // innermost element first
            if (candidates[0]) error = candidates[0].text;
        }

        if (error || invalid) {
            result.push({ el, label: q.label, error: error || "The form marked this answer as invalid.", scope: q.scope });
        }
    }
    return result;
}

// Same privacy pipeline as the fill: background.ts only sends AI SAFE values to Gemini
function askAiToCorrect(questions: object[]): Promise<Array<{ id: string; answer?: string }>> {
    return new Promise((resolve) => {
        sleep(30000).then(() => resolve([]));
        try {
            chrome.runtime.sendMessage({ action: "RESOLVE_AI_QUESTIONS", questions }, (res) => {
                resolve(!chrome.runtime.lastError && res?.success && Array.isArray(res.answers) ? res.answers : []);
            });
        } catch {
            resolve([]);
        }
    });
}

// Fixes rejected answers: by rule when the error says what it wants, otherwise by asking the AI. Returns how many changed.
async function repairRejectedFields(errors: FieldError[], useAi: boolean, speedConfig: SpeedConfig): Promise<number> {
    let fixed = 0;
    const apply = async (e: FieldError, value: string) => {
        await applyValueToControl(e.el, value, e.label, speedConfig, true);
        highlightFilledElement(e.el, `Fixed: ${value.length > 20 ? value.substring(0, 17) + "..." : value}`);
        filledOrigin.set(e.el, filledOrigin.get(e.el) === "sensitive" ? "sensitive" : "ai");
        fixed++;
    };

    const forAi: { e: FieldError; current: string; format: ValueFormat }[] = [];
    for (const e of errors) {
        // What the user typed by hand is theirs to change: the error stays highlighted for them
        if (userEdited.has(e.el)) continue;
        const current = readControlText(e.el);
        const format = { ...readFormatFromControl(e.el), ...readFormatFromError(e.error) };
        // The field's own rules (pattern, type) beat guesses from the error text
        const nativeBroken = e.el instanceof HTMLInputElement && breaksNativeFormat(e.el.validity);
        const conformed = !current ? "" : (nativeBroken && conformToControl(e.el, current)) || conformValue(current, format);
        if (conformed && conformed !== current && (!nativeBroken || passesNativeFormat(e.el as HTMLInputElement, conformed))) {
            await apply(e, conformed);
        } else {
            forAi.push({ e, current, format });
        }
    }

    if (forAi.length > 0 && useAi) {
        const answers = await askAiToCorrect(forAi.map(({ e, current, format }, i) => {
            const origin = filledOrigin.get(e.el);
            return {
                id: `fix_${i}`,
                label: e.label,
                type: e.el.tagName === "TEXTAREA" ? "textarea" : "text",
                format: describeFormat(format) || undefined,
                context: resolveControlHint(e.el, [e.label]) || undefined,
                rejectedBecause: e.error,
                // Only answers Aullevo generated or took from AI SAFE fields; never sensitive or site-filled values
                previousAnswer: current && (origin === "ai" || origin === "profile") ? current : undefined
            };
        }));
        for (const ans of answers) {
            const target = forAi[parseInt(String(ans.id).replace("fix_", ""), 10)];
            if (!target || !ans.answer?.trim()) continue;
            const hasRule = target.format.numeric || target.format.digitsOnly || target.format.maxLength;
            let value = hasRule ? conformValue(ans.answer, target.format) : ans.answer.trim();
            // An AI answer that still breaks the field's pattern gets the same reshaping
            const el = target.e.el;
            if (value && el instanceof HTMLInputElement && !passesNativeFormat(el, value)) value = conformToControl(el, value);
            if (value && value !== target.current) await apply(target.e, value);
        }
    }
    return fixed;
}

// background.ts calls this in every frame (chrome.scripting.executeScript) to find the one holding the form
function probePaginationFrame() {
    const harvested = harvestAllControls();
    const buttons = findPaginationButtons();
    return {
        controls: harvested.length + harvestActiveFileInputs().length,
        hasNext: buttons.some(b => b.kind === "next") || (harvested.length === 0 && buttons.some(b => b.kind === "start")),
        hasSubmit: buttons.some(b => b.kind === "submit"),
        // Same signature before and after a Next click = the page did not really change
        // Buttons count too: "Apply" and "Type it in myself" screens have no fields and the same URL
        signature: hashString(location.href + "|" + harvested.map(c => c.labelTexts[0] || c.control.tagName).join("|") + "|" + buttons.map(b => b.label).join("|"))
    };
}

(globalThis as any).__aullevoProbePagination = probePaginationFrame;
