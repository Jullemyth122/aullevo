import type { ProfileFile } from "../types";

// Keep in sync with TRUSTED_WEB_ORIGINS in services/account.ts.
// (Duplicated on purpose: importing a runtime module shared with background.ts would make Vite
// emit a shared chunk + `import` statement, which breaks classic content scripts.)
const TRUSTED_WEB_ORIGINS = import.meta.env.MODE === "development"
    ? ["https://aullevo-web.vercel.app", "http://localhost:5173", "http://127.0.0.1:5173"]
    : ["https://aullevo-web.vercel.app"];

console.log("[Aullevo] Content script loaded on:", window.location.href);

// LAYER 1: Message Listener (Ready for triggers from background/sidepanel)

let isHighlightsActive = false;

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
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
        injectFormFields(message.fields || [], Boolean(message.useAi), speed, message.files || [])
            .then((result) => _sendResponse(result))
            .catch(err => {
                console.error("[InjectToGoogle] Form injection error:", err);
                _sendResponse({ success: false, error: err.message });
            });
        return true;
    }

    return false;
});

// ---------------------------------------------------------------------------
// Account sync: relay aullevo-web's sign-in token to background.ts
// (background verifies it against Firestore; nothing here is trusted as-is)
// ---------------------------------------------------------------------------

if (window === window.top && TRUSTED_WEB_ORIGINS.includes(window.location.origin)) {
    const origin = window.location.origin;

    window.addEventListener("message", (event) => {
        if (event.source !== window || event.origin !== origin) return;
        const data = event.data;
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
    triggerBtn.title = "Open Aullevo Sidebar";
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

//---------------------------------------------
/**
 * Normalizes question strings by stripping bullets, question numbers,
 * required markers, asterisks, and punctuation.
 */
export function cleanText(text: string | null | undefined): string {
    if (!text) return "";
    return String(text)
        // Strip leading numbers or bullets (e.g. "1.", "1)", "1 -", "Q1:", "- ", "* ")
        .replace(/^\s*(?:question\s*\d+[:\-.]?|\d+[\.\)\-:]|[a-zA-Z][\.\)\-:]|[-*•·⁃‣])\s*/i, "")
        // Strip required / optional markers and asterisks
        .replace(/\*+/g, " ")
        .replace(/\((?:required|optional|mandatory|required field|if applicable)\)/gi, " ")
        .replace(/\[(?:required|optional|mandatory)\]/gi, " ")
        // Replace punctuation and symbols with spaces
        .replace(/[:!?|/\\–—()[\]{}_,;'"‘“”`~]/g, " ")
        .replace(/\s+/g, " ")
        .toLowerCase()
        .trim();
}

/**
 * Common stem / prefix matching (e.g. "developer" vs "development", "engineer" vs "engineering")
 */
export function wordsMatchStem(w1: string, w2: string): number {
    if (w1 === w2) return 1.0;
    if (w1.length >= 3 && w2.length >= 3) {
        if (w1.includes(w2) || w2.includes(w1)) return 0.95;
        const minLen = Math.min(w1.length, w2.length);
        if (minLen >= 5) {
            const prefixLen = Math.max(4, minLen - 2);
            if (w1.slice(0, prefixLen) === w2.slice(0, prefixLen)) {
                return 0.92;
            }
        }
    }
    return 0;
}

/**
 * Dynamic conversational token overlap algorithm.
 * Measures how well a profile label matches a form question without hardcoded dictionaries.
 */
export function computeStringSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;

    const s1 = cleanText(str1);
    const s2 = cleanText(str2);
    if (!s1 || !s2) return 0;

    // 1. Exact string match
    if (s1 === s2) return 1.0;

    // 2. Full phrase containment
    if (s2.includes(s1)) return 0.88 + (0.12 * (s1.length / s2.length));
    if (s1.includes(s2)) return 0.88 + (0.12 * (s2.length / s1.length));

    // 3. Dynamic Token Analysis
    const tokens1 = s1.split(/\s+/).filter(Boolean);
    const tokens2 = s2.split(/\s+/).filter(Boolean);

    const sub1 = tokens1.filter(t => t.length >= 3);
    const sub2 = tokens2.filter(t => t.length >= 3);

    if (sub1.length === 0 || sub2.length === 0) {
        const set2 = new Set(tokens2);
        let inter = 0;
        for (const t of tokens1) if (set2.has(t)) inter++;
        const union = tokens1.length + tokens2.length - inter;
        return union > 0 ? (inter / union) : 0;
    }

    // Check how many substantial tokens of label (str1) are in question (str2)
    let matchedIn2 = 0;
    const unmatchedIn1: string[] = [];
    for (const t of sub1) {
        let bestTScore = 0;
        for (const q of sub2) {
            const score = wordsMatchStem(t, q);
            if (score > bestTScore) bestTScore = score;
        }
        if (bestTScore >= 0.90) {
            matchedIn2 += bestTScore;
        } else {
            unmatchedIn1.push(t);
        }
    }

    // Check how many substantial tokens of question (str2) are in label (str1)
    let matchedIn1 = 0;
    const unmatchedIn2: string[] = [];
    for (const q of sub2) {
        let bestQScore = 0;
        for (const t of sub1) {
            const score = wordsMatchStem(q, t);
            if (score > bestQScore) bestQScore = score;
        }
        if (bestQScore >= 0.90) {
            matchedIn1 += bestQScore;
        } else {
            unmatchedIn2.push(q);
        }
    }

    const coverage1 = matchedIn2 / sub1.length;
    const coverage2 = matchedIn1 / sub2.length;

    const isQuestionLong = sub2.length >= 5;
    const isLabelLong = sub1.length >= 5;

    // Detect subject conflict (e.g. "React" vs "Vue")
    const hasSubjectConflict = !isQuestionLong && !isLabelLong && unmatchedIn1.length > 0 && unmatchedIn2.length > 0;

    const minCoverage = isQuestionLong ? 0.65 : 0.75;
    if (coverage1 >= minCoverage && !hasSubjectConflict) {
        return 0.86 + (0.12 * Math.min(coverage1, 1.0));
    }

    if (coverage2 >= 0.75 && matchedIn2 >= 1 && !hasSubjectConflict) {
        return 0.85 + (0.12 * Math.min(coverage2, 1.0));
    }

    if (hasSubjectConflict) {
        const jaccard = matchedIn2 / (sub1.length + sub2.length - matchedIn2);
        return Math.min(jaccard * 0.4, 0.35); // Disqualified (< 0.45)
    }

    const totalSub = sub1.length + sub2.length - matchedIn2;
    return totalSub > 0 ? (matchedIn2 / totalSub) : 0;
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

/**
 * Splits slash-separated labels into alias variations
 * (e.g. "Degree / Year Level" -> ["Degree", "Year Level", "Degree / Year Level"])
 */
export function getFieldLabelAliases(label: string): string[] {
    if (!label) return [];
    const str = String(label).trim();
    if (str.includes("/") || str.includes("|") || str.includes(";")) {
        const parts = str.split(/[/|;]+/).map(p => p.trim()).filter(Boolean);
        if (parts.length > 1) {
            return [...parts, str];
        }
    }
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

    return "";

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

    // 8.5e. Placeholder fallback — last resort for unlabelled inputs
    // Many forms use placeholder text as the only identifier:
    //   <input type="text" placeholder="Enter your email address" />
    // This is not ideal for accessibility but is extremely common in the wild.
    if (!isChoice && labels.size === 0) {
        const placeholder = (control as HTMLInputElement).placeholder;
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

    return Array.from(labels).map(t => cleanText(t)).filter(t => t.length > 0);
}


// Finds all form controls across standard HTML, Google Forms, modern frameworks, and pierced Shadow DOMs.
export function harvestAllControls(): HarvestedControl[] {
    const selector = [
        // 1. Standard HTML5 Inputs
        "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset'])",
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
        const isCountryCode = !isChoice && tagName !== "TEXTAREA" && (
            /country\s*code|dial\s*code|calling\s*code|phone\s*prefix/i.test(nameAttr + " " + ariaLabel + " " + classList)
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

/**
 * Async sleep utility for pacing DOM events
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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

/**
 * Normalizes various date string formats into standard YYYY-MM-DD for HTML5 inputs
 */
export function normalizeDateForInput(value: any): string {
    if (!value) return "";
    const trimmed = String(value).trim();

    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

    // DD/MM/YYYY or MM/DD/YYYY
    const slashMatch = trimmed.match(/^(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{4})$/);
    if (slashMatch) {
        const num1 = parseInt(slashMatch[1], 10);
        const num2 = parseInt(slashMatch[2], 10);
        const year = slashMatch[3];
        const day = num1 > 12 ? num1 : (num2 > 12 ? num2 : num1);
        const month = num1 > 12 ? num2 : (num2 > 12 ? num1 : num2);
        return `${year.padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    // YYYY/MM/DD
    const ymdMatch = trimmed.match(/^(\d{4})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})$/);
    if (ymdMatch) {
        return `${ymdMatch[1]}-${String(parseInt(ymdMatch[2], 10)).padStart(2, "0")}-${String(parseInt(ymdMatch[3], 10)).padStart(2, "0")}`;
    }

    return trimmed;
}

/**
 * Resolves the best candidate value for a text input when "/" is used in the value.
 * e.g. Value "Bachelor's Degree / 4th Year" for Question "Year Level" -> "4th Year"
 */
export function resolveBestTextCandidate(value: any, matchedAlias: string = "", element?: HTMLElement): string {
    if (!value || typeof value !== "string") return String(value || "");
    if (!value.includes("/")) return value;
    if (isDateValue(value)) return value;

    const candidates = value.split(/\s*\/\s*/).map(c => c.trim()).filter(Boolean);
    if (candidates.length <= 1) return value;

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
        element.innerText = value;
        element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
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
        const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
        if (accept.includes(ext) || (accept.includes("image/*") && /\.(png|jpg|jpeg|webp)$/.test(ext))) {
            score += 0.05;
        } else if (!accept.includes("*") && !accept.includes(ext)) {
            score -= 0.50; // Penalize wrong file type (e.g. .docx into image-only field)
        }
    }

    return score;
}


export function injectFileIntoControl(
    inputEl: HTMLInputElement,
    containerEl: HTMLElement,
    fileObj: ProfileFile
): boolean {
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

        // Native input change
        inputEl.files = dt.files;
        inputEl.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        inputEl.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

        // Synthetic drag & drop for Workday and custom dropzones
        if (containerEl && containerEl !== inputEl) {
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
        element.innerText = "";
        for (const char of strValue) {
            element.innerText += char;
            element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
            await sleep(getJitteredDelay(charDelayMs));
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


/**
 * Toggles a radio button or checkbox control to the target checked state.
 * Universal across standard HTML, Google Forms, Microsoft Forms, and modern custom cards.
 */
export function toggleChoiceControl(control: HTMLElement, choiceType: "radio" | "checkbox", targetChecked: boolean = true): boolean {
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

    // 2. Native HTML input updates (for React / standard forms)
    const nativeInput = (realControl.tagName === "INPUT" ? realControl : realControl.querySelector("input[type='checkbox'], input[type='radio']")) as HTMLInputElement | null;
    if (nativeInput) {
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
    speedConfig: SpeedConfig = { charDelayMs: 0, actionDelayMs: 0 }
): Promise<boolean | string> {
    if (!element) return false;

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
    } else if (
        inputType === "radio" || inputType === "checkbox" ||
        role === "radio" || role === "checkbox" ||
        classList.includes("docssharedWizToggleLabeledContainer") ||
        classList.includes("form-radio-item") ||
        classList.includes("form-checkbox-item")
    ) {
        const isRadio = inputType === "radio" || role === "radio" || classList.includes("radio");
        return toggleChoiceControl(element, isRadio ? "radio" : "checkbox", true);
    } else if (inputType === "date" || inputType === "datetime-local") {
        const isoDate = normalizeDateForInput(value);
        if (isoDate) {
            setNativeInputValue(element, isoDate);
            if ((element as HTMLInputElement).value === isoDate || (element as HTMLInputElement).value !== "") {
                return (element as HTMLInputElement).value || isoDate;
            }
        }
        setNativeInputValue(element, String(value || ""));
        return (element as HTMLInputElement).value ? (element as HTMLInputElement).value : (isoDate || false);
    } else {
        let resolvedValue = resolveBestTextCandidate(value, matchedAlias, element);

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
        return `Option: "Choice"`;


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
export function highlightFilledElement(el: HTMLElement, badgeText: string = "FILLED"): void {
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
    setTimeout(() => {
        if (badge) {
            badge.classList.add("aullevo-badge-fading");
        }
        targetContainer.classList.remove("aullevo-inspected-field");
        setTimeout(() => {
            badge?.remove();
        }, 400);
    }, 3800);
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

    const dialMap: Record<string, string> = {
        "63": "philippines", "1": "united states", "44": "united kingdom", "91": "india",
        "61": "australia", "81": "japan", "49": "germany", "33": "france", "65": "singapore",
        "82": "south korea", "86": "china", "971": "united arab emirates", "966": "saudi arabia",
        "60": "malaysia", "62": "indonesia", "84": "vietnam", "66": "thailand", "34": "spain",
        "39": "italy", "31": "netherlands", "41": "switzerland", "46": "sweden", "47": "norway",
        "48": "poland", "55": "brazil", "52": "mexico", "27": "south africa", "64": "new zealand"
    };

    if (tDial && dialMap[tDial]) {
        const countryName = dialMap[tDial];
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
        if (el.getAttribute("aria-haspopup") === "listbox" || el.getAttribute("aria-haspopup") === "true") return false;
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

    return candidates;
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
export async function fillCustomDropdown(dropdownEl: HTMLElement, targetValue: any, matchedAlias: string = ""): Promise<string | boolean> {
    if (!dropdownEl || !targetValue) return false;

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

    // 3. Check for Searchable Filter Input strictly scoped to this dropdown or active popup
    const activePopup = Array.from(document.querySelectorAll<HTMLElement>(`
        [data-automation-id='promptSearch-results'], [data-automation-id='select-results'],
        [data-automation-id*='popup'], [data-automation-id*='prompt'], .cx-select__options,
        [role='dialog'], [role='listbox'], .c-select__menu
    `)).find(p => isElementVisible(p));

    const searchInput = (dropdownEl.tagName === "INPUT" || dropdownEl.tagName === "TEXTAREA")
        ? (dropdownEl as HTMLInputElement)
        : (dropdownEl.querySelector<HTMLInputElement>("input[type='text'], input[role='combobox'], input[class*='input'], input:not([type='hidden'])") ||
            (activePopup ? activePopup.querySelector<HTMLInputElement>("input[placeholder*='Search' i], input[data-automation-id='searchBox'], input[data-automation-id='promptSearchInput'], input[type='text']") : null));

    const clearButton = dropdownEl.parentElement
        ? dropdownEl.parentElement.querySelector<HTMLElement>(".clear-button, button[aria-label*='clear' i], [class*='clear-indicator'], .c-select__clear-indicator, [class*='indicatorContainer'] svg, [data-automation-id='clear-button'], button[aria-label*='delete' i]")
        : null;

    if (clearButton && isElementVisible(clearButton)) {
        dispatchSinglePointerClick(clearButton);
        await sleep(80);
    }

    // 4. If a dedicated Search box is present, type search term
    if (searchInput && searchInput !== document.body) {
        try {
            searchInput.focus();

            const isDialTarget = /^\+\d{1,4}$/.test(String(targetValue).trim());
            const searchTerm = isDialTarget ? String(targetValue).trim() : String(targetValue);

            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
            if (nativeSetter) {
                nativeSetter.call(searchInput, searchTerm);
            } else {
                searchInput.value = searchTerm;
            }

            searchInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
            try {
                searchInput.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: searchTerm, inputType: "insertText" }));
            } catch { }
            searchInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

            // Trigger Enter inside search box if required (e.g. Workday prompt search)
            if (searchInput.getAttribute("data-automation-id") === "searchBox" || /search/i.test(searchInput.placeholder || "")) {
                searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, code: "Enter", bubbles: true }));
                await sleep(250);
            } else {
                await sleep(150);
            }
        } catch (err) {
            console.warn("[Aullevo] Search input typing error:", err);
        }
    }

    // 5. Poll for dropdown options in DOM (Wait up to 600ms for dynamic filtered portal options)
    let options: HTMLElement[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
        await sleep(attempt === 0 ? 150 : 100);
        options = findAllDropdownOptions(dropdownEl);
        if (options.length > 0) break;
        if (attempt === 2) {
            dispatchSinglePointerClick(dropdownEl);
        }
    }

    if (options.length === 0) {
        console.warn("[Aullevo] No dropdown options discovered for dropdown:", dropdownEl);
        return false;
    }

    // 6. Match candidate options against target value with candidate filtering
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
    let appliedText = "";

    for (const cand of candidates) {
        for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            const rawText = opt.getAttribute("data-value") ||
                opt.querySelector(".vRMGwf, [data-automation-id='selectOptionText'], [data-automation-id='promptOption'], span[jsslot], span")?.textContent ||
                opt.innerText ||
                opt.textContent ||
                opt.getAttribute("aria-label") || "";
            const optText = cleanText(rawText);
            if (!optText) continue;

            if (/^(choose|select|select an option|please select|none)$/i.test(optText) && cand !== optText) {
                continue;
            }

            const score = computeDialCodeMatchScore(cand, optText);
            if (score > bestScore) {
                bestScore = score;
                bestOpt = opt;
                appliedText = (opt.getAttribute("data-value") || rawText || cand).trim();
            }
        }
        if (bestScore >= 0.90) break;
    }

    // 7. Select the best matched option
    if (bestOpt && bestScore >= 0.40) {
        const optLabel = (bestOpt.getAttribute("data-value") || bestOpt.innerText || bestOpt.textContent || targetValue).trim();
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
        console.warn(`[Aullevo] Could not match target "${targetValue}" among options:`, options.map(o => o.getAttribute("data-value") || o.innerText || o.textContent));

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
export async function injectFormFields(fields: any[], useAi: boolean = false, speedPreset: string | SpeedConfig = "human", attachedFiles: ProfileFile[] = []) {
    if (!Array.isArray(fields) || fields.length === 0) {
        return { success: false, error: "No fields provided." };
    }

    // Preflight: if AI can't run, fall back to full keyword mode for this run.
    // Otherwise the heuristic pass would skip medium-confidence fields (< 0.80) expecting AI to fill them.
    let aiNotice: string | undefined;
    if (useAi) {
        const perm = await requestAiPermission();
        if (!perm.allowed) {
            useAi = false;
            aiNotice = perm.reason;
            console.warn("[Aullevo:AI] AI unavailable, using keyword fill:", perm.reason);
        }
    }


    const speedConfig = resolveSpeedConfig(speedPreset); // <--- RESOLVE SPEED HERE
    console.log(`[Aullevo] Form injection triggered with ${fields.length} fields. AI Mode: ${useAi ? 'ENABLED' : 'DISABLED'} | Speed:`, speedConfig);

    closeAnyOpenDropdown();
    clearAllHighlights();
    await sleep(80);

    const matchedMap = new Map<string, any>();
    const assignedControls = new Set<HTMLElement>();
    const candidatePairs: CandidatePair[] = [];
    let filledCount = 0;
    const assignedFields = new Set<string>();


    // Step 1: Harvest all visible controls & descriptors across all DOM roots
    const harvestedControls = harvestAllControls();
    console.log(`[Aullevo] Harvesting complete: ${harvestedControls.length} interactive controls found on page.`);

    // Step 1.5: File Upload Matching & Injection (Supports Multi-File & Sequential Uploads)
    if (Array.isArray(attachedFiles) && attachedFiles.length > 0) {
        const activeUploads = harvestActiveFileInputs();
        console.log(`[Aullevo] Found ${activeUploads.length} active/visible file upload inputs on page.`);

        const usedFileIds = new Set<string>();

        for (const { input, container } of activeUploads) {
            if (assignedControls.has(input)) continue;
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
                    const success = injectFileIntoControl(input, container, file);
                    if (success) {
                        usedFileIds.add(file.id);
                        filledCount++;
                        console.log(`[Aullevo] Injected "${file.fileName}" into file input.`);
                        await sleep(90);
                    }
                }

                // Highlight the visible container with count
                const targetToHighlight = (container && container.offsetWidth > 0) ? container : input;
                const labelMsg = filesToInject.length === 1
                    ? `File: ${filesToInject[0].fileName}`
                    : `Injected ${filesToInject.length} files`;
                highlightFilledElement(targetToHighlight, labelMsg);
                assignedControls.add(input);
            }
        }
    }


    // =======================================================================
    // GOOGLE FORMS SPECIAL FILE HANDLER (docs.google.com/forms)
    // =======================================================================
    const isGoogleForms = window.location.hostname.includes("docs.google.com") && window.location.pathname.includes("/forms");

    if (isGoogleForms) {
        // 1. Check if a Google Picker modal is ALREADY open on screen (Screenshot 4)
        const pickerIframe = document.querySelector<HTMLIFrameElement>(".picker-frame, iframe[src*='picker']");
        const pickerDoc = pickerIframe?.contentDocument || document;
        const openPickerInput = pickerDoc.querySelector<HTMLInputElement>("input[type='file']");
        const openPickerDrop = pickerDoc.querySelector<HTMLElement>(".picker-drop-zone, [role='button'][aria-label*='Browse' i], [aria-label*='drop' i]") || openPickerInput;

        if (openPickerInput) {
            // Modal is already open: find the best file (e.g. Resume) and inject directly into it!
            const resumeFile = attachedFiles.find(f => f.enabled && /resume|cv/i.test(f.label || f.fileName)) || attachedFiles.find(f => f.enabled);
            if (resumeFile) {
                injectFileIntoControl(openPickerInput, openPickerDrop as HTMLElement, resumeFile);
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
                    highlightFilledElement(addFileBtn, `Matched: ${matchedFile.fileName}`);
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
                            injectFileIntoControl(pickerInput, (dropArea as HTMLElement) || pickerInput, matchedFile);
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
    const allRankItems = Array.from(document.querySelectorAll<HTMLElement>(".rank-item, [class*='rank-item']"));
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
                    highlightFilledElement(card, `Ranked: ${field.value}`);
                    assignedFields.add(cleanText(field.label));
                    filledCount++;
                }
                break;
            }
        }
    }



    // Step 2: Score every field against every harvested control dynamically


    fields.forEach((field) => {
        if (!field || !field.label || field.value === undefined || field.value === null || field.value === "") {
            return;
        }

        const targetValues = parseTargetValues(field.value);
        const labelAliases = getFieldLabelAliases(field.label);
        const isDialPrefixVal = /^\+\d{1,4}$/.test(String(field.value || "").trim());

        harvestedControls.forEach(({ control, labelTexts, isCustomDropdown, isCountryCode, isChoice, choiceType, choiceText }) => {
            let maxScore = 0;
            let matchedTargetValue: string | null = null;
            let bestMatchedAlias = field.label;

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
                        }
                    }
                }

                // Universal HTML5 type validation
                const controlType = ((control as HTMLInputElement).type || control.getAttribute("type") || "").toLowerCase();

                if (controlType === "email" && !String(field.value).includes("@")) {
                    maxScore = 0;
                } else if (controlType === "url" && !/^https?:\/\//i.test(String(field.value).trim())) {
                    maxScore = 0;
                } else if (controlType === "number" && isNaN(Number(String(field.value).replace(/[,$\s]/g, "")))) {
                    maxScore = 0;
                } else if (controlType === "tel" && !/[\d+()-]/.test(String(field.value))) {
                    maxScore = 0;
                }

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
    const deferredToAi: CandidatePair[] = [];
    for (const pair of candidatePairs) {
        if (useAi && pair.score < 0.80) {
            deferredToAi.push(pair);
            continue;
        }
        await tryAssignPair(pair);
    }

    // Step 5: Secondary Pass for Conditionally Revealed Inputs (e.g. textareas revealed by radios)
    const remainingFields = fields.filter((f) => !assignedFields.has(cleanText(f.label)));
    if (remainingFields.length > 0) {
        await sleep(150);
        const newlyVisibleControls = harvestAllControls().filter(c => !assignedControls.has(c.control) && !c.isChoice);

        for (const field of remainingFields) {
            const fieldKey = cleanText(field.label);
            const aliases = getFieldLabelAliases(field.label);

            for (const ctrl of newlyVisibleControls) {
                if (assignedControls.has(ctrl.control)) continue;

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
    // Step 6: Privacy-First AI Smart Fill Pass for Unresolved Controls
    // =======================================================================
    if (useAi) {
        console.log("[Aullevo:AI] Running AI smart resolution on remaining unfilled controls...");

        // 1. Gather all unfilled interactive controls on the page
        const unfilled = harvestedControls.filter(c => !assignedControls.has(c.control));

        // Group choice controls (radios/checkboxes) by their question label
        const choiceGroups = new Map<string, { questionLabel: string; type: 'radio' | 'checkbox'; controls: HarvestedControl[] }>();
        const directInputs: HarvestedControl[] = [];

        for (const item of unfilled) {
            if (item.isChoice) {
                const qLabel = item.labelTexts[0] || "Options";
                const groupKey = `${item.choiceType}_${cleanText(qLabel)}`;
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

            const qId = `ai_q_${qIndex++}`;
            const tagName = item.control.tagName.toLowerCase();
            const isTextarea = tagName === 'textarea' || item.control.getAttribute('role') === 'textbox';

            aiQuestions.push({
                id: qId,
                label: label,
                type: isTextarea ? 'textarea' : (tagName === 'select' || item.isCustomDropdown ? 'select' : 'text'),
                options: tagName === 'select'
                    ? Array.from((item.control as HTMLSelectElement).options || []).map(o => o.text).filter(Boolean)
                    : undefined
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

            const qId = `ai_q_${qIndex++}`;
            aiQuestions.push({
                id: qId,
                label: group.questionLabel,
                type: group.type,
                options: options
            });

            aiTargetMap.set(qId, {
                type: 'choice',
                choiceGroup: group.controls,
                choiceType: group.type
            });
        }

        // 3. Dispatch to background.ts (Calls Gemini Zero-Knowledge Engine)
        if (aiQuestions.length > 0) {
            console.log(`[Aullevo:AI] Sending ${aiQuestions.length} unresolved questions to Gemini Flash-Lite...`);

            try {
                const aiResponse: any = await Promise.race([
                    new Promise((resolve) => {
                        chrome.runtime.sendMessage({
                            action: "RESOLVE_AI_QUESTIONS",
                            questions: aiQuestions
                        }, (res) => resolve(res || { success: false, error: "Empty response" }));
                    }),
                    new Promise((resolve) => setTimeout(() => resolve({ success: false, error: "AI timed out (30s)" }), 30000))
                ]);


                if (aiResponse?.success && Array.isArray(aiResponse.answers)) {
                    console.log(`[Aullevo:AI] Received ${aiResponse.answers.length} answers from AI.`);

                    for (const ans of aiResponse.answers) {
                        const target = aiTargetMap.get(ans.id);
                        if (!target) continue;

                        // Case A: AI mapped this question to local profile field(s) (Zero-Knowledge)
                        // background.ts already resolved matchedKey / matchedKeys → actual value
                        const effectiveKey = ans.matchedKey || (Array.isArray(ans.matchedKeys) ? ans.matchedKeys.join('+') : undefined);
                        if (effectiveKey && ans.answer) {
                            if (target.type === 'choice' && target.choiceGroup) {
                                // 1. First look for an exact match
                                let chosenCtrl = target.choiceGroup.find(c =>
                                    cleanText(c.choiceText) === cleanText(ans.answer)
                                );

                                // 2. If no exact match, find the option with the HIGHEST similarity score
                                if (!chosenCtrl) {
                                    let bestScore = 0.70;
                                    for (const c of target.choiceGroup) {
                                        const score = computeChoiceMatchScore(ans.answer, c.choiceText);
                                        if (score > bestScore) {
                                            bestScore = score;
                                            chosenCtrl = c;
                                        }
                                    }
                                }


                                if (chosenCtrl && !assignedControls.has(chosenCtrl.control)) {
                                    toggleChoiceControl(chosenCtrl.control, target.choiceType || 'radio', true);
                                    highlightFilledElement(chosenCtrl.control, `[AI] ${ans.answer}`);
                                    assignedControls.add(chosenCtrl.control);
                                    filledCount++;
                                    await sleep(speedConfig.actionDelayMs > 0 ? getJitteredDelay(speedConfig.actionDelayMs) : 60);
                                }
                            } else if (target.control && !assignedControls.has(target.control)) {
                                // For text/textarea: type the resolved value
                                if (target.isCustomDropdown) {
                                    await fillCustomDropdown(target.control, ans.answer, effectiveKey);
                                } else {
                                    await applyValueToControl(target.control, ans.answer, effectiveKey, speedConfig);
                                }

                                highlightFilledElement(target.control, `[AI] ${effectiveKey}`);
                                assignedControls.add(target.control);
                                filledCount++;
                                await sleep(speedConfig.actionDelayMs > 0 ? getJitteredDelay(speedConfig.actionDelayMs) : 60);
                            }
                        }

                        // Case B: Direct answer (e.g. for radio choices or generated essay text)
                        else if (ans.answer && ans.answer.trim()) {
                            if (target.type === 'choice' && target.choiceGroup) {
                                // 1. First look for an exact or whitespace-stripped match
                                let chosenCtrl = target.choiceGroup.find(c => {
                                    const a = c.choiceText.trim().toLowerCase();
                                    const b = ans.answer.trim().toLowerCase();
                                    return a === b ||
                                        a.replace(/\s+/g, '') === b.replace(/\s+/g, '') ||
                                        cleanText(c.choiceText) === cleanText(ans.answer);
                                });

                                // 2. If no exact match, pick the option with the highest similarity score
                                if (!chosenCtrl) {
                                    let bestScore = 0.70;
                                    for (const c of target.choiceGroup) {
                                        const score = computeChoiceMatchScore(ans.answer, c.choiceText);
                                        if (score > bestScore) {
                                            bestScore = score;
                                            chosenCtrl = c;
                                        }
                                    }
                                }

                                if (chosenCtrl && !assignedControls.has(chosenCtrl.control)) {
                                    toggleChoiceControl(chosenCtrl.control, target.choiceType || 'radio', true);
                                    highlightFilledElement(chosenCtrl.control, `[AI] ${ans.answer}`);
                                    assignedControls.add(chosenCtrl.control);
                                    filledCount++;
                                    await sleep(speedConfig.actionDelayMs > 0 ? getJitteredDelay(speedConfig.actionDelayMs) : 60);
                                }


                            } else if (target.type === 'input' && target.control && !assignedControls.has(target.control)) {
                                if (target.isCustomDropdown) {
                                    await fillCustomDropdown(target.control, ans.answer, "AI Choice");
                                } else {
                                    await applyValueToControl(target.control, ans.answer, "AI Response", speedConfig);
                                }

                                highlightFilledElement(target.control, `[AI] Generated`);
                                assignedControls.add(target.control);
                                filledCount++;
                                await sleep(speedConfig.actionDelayMs > 0 ? getJitteredDelay(speedConfig.actionDelayMs) : 60);
                            }
                        }
                    }
                } else if (aiResponse?.error) {
                    console.warn("[Aullevo:AI] Resolution returned notice:", aiResponse.error);
                    aiNotice = aiResponse.error;
                }
            } catch (err) {
                console.error("[Aullevo:AI] Failed to communicate with background AI worker:", err);
                aiNotice = "Could not reach the AI worker.";
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

    const details = fields.map((field) => {
        const match = matchedMap.get(cleanText(field.label));
        return match || { label: field.label, value: field.value, matched: false };
    });

    console.log(`[Aullevo] Form injection complete: ${filledCount}/${fields.length} fields filled.`);
    setTimeout(() => {
        clearAllHighlights();
    }, 4500);
    return {
        success: true,
        matchedCount: filledCount,
        totalAttempted: fields.length,
        useAi,
        aiNotice,
        details
    };
}
