/**
 * @file formStepProcessor.ts
 * @module background/modules
 *
 * ─── ROLE IN THE ARCHITECTURE
 * The ORCHESTRATION LAYER — coordinates the full form-filling pipeline
 * from start to finish.
 *
 * This file owns the three exported functions that background.ts calls:
 *
 *   1. processFieldsAI()  — "processFieldsAI" message handler
 *      Called when the content script has already detected fields and
 *      asks the background to resolve values for them.
 *      Returns a JSON-serialisable result object (no side-effects on tabs).
 *
 *   2. runAIFill()        — "triggerFillFromPopup" message handler
 *      Entry point for the popup button or Ctrl+M keyboard shortcut.
 *      Locates the active tab, optionally starts an autopilot session,
 *      then delegates to processFormStep().
 *
 *   3. processFormStep()  — Core recursive fill loop
 *      Scans the page → matches fields → resolves values → fills the form.
 *      If autoSubmit is on, clicks "Next" and recurses for the next step.
 *      Also called by background.ts's onUpdated listener when the page
 *      navigates during an active autopilot session.
 *
 * DATA FLOW:
 *   background.ts (message handler)
 *     → runAIFill()  or  processFormStep() directly
 *           → sendToTab("analyzeForm")          [page → background: field list]
 *           → matchFieldsHeuristically()  OR
 *             geminiService.analyzeFormFields()  [AI mapping: field → fieldType]
 *           → resolveFieldValues()               [fieldType → actual string/file]
 *           → sendToTab("fillForm")              [background → page: inject values]
 *           → sendToTab("clickNext")  (autoSubmit only)
 *           → processFormStep(step+1) (recursive)
 *
 * DEPENDENCY DIRECTION:
 *   background.ts
 *     └── formStepProcessor.ts   ← YOU ARE HERE
 *           ├── backgroundUtils  (utils, tab messaging, badge, sleep)
 *           ├── domainCache      (cache read/write/invalidate)
 *           ├── fieldResolver    (resolveFieldValues)
 *           ├── geminiService    (AI field analysis + API key management)
 *           └── heuristicMatcher (keyword-based fallback matching)
 *
 */

import { geminiService } from "../../services/geminiService";
import { matchFieldsHeuristically } from "../../services/heuristicMatcher";
import type { UserData, FormField, SavedFile } from "../../types";
import {
  getActiveUserData,
  checkRateLimit,
  buildFieldSignature,
  getHostname,
  migrateCustomFields,
  sendToTab,
  sleep,
  showBadge,
  clearBadge,
  sendSidebarStatus,
} from "./backgroundUtils";
import {
  getCachedMappings,
  setCachedMappings,
  invalidateCache,
} from "./domainCache";
import { resolveFieldValues } from "./fieldResolver";

// processFieldsAI

/**
 * processFieldsAI
 *
 * Handles the "processFieldsAI" message sent from the content script.
 *
 * The content script has already scanned the page and collected a FormField[]
 * array. It sends that array here and asks: "what values should I put in these?"
 *
 * This function:
 *   1. Loads user data + settings from storage.
 *   2. Selects matching strategy (AI or heuristic).
 *   3. Runs the strategy to get fieldMappings (field → fieldType).
 *   4. Calls resolveFieldValues() to attach actual data values.
 *   5. Returns { success, mappings, addButtons, userData } to the caller.
 *
 * NOTE: This function does NOT communicate with the tab directly.
 * It only returns a data object — the content script is responsible for
 * applying the returned mappings to the DOM.
 *
 * CALLED BY: background.ts → "processFieldsAI" message handler (line ~213)
 *
 * @param fields   - FormField[] detected by the content script.
 * @param hostname - The hostname of the current page (for cache keying).
 * @returns A result object: { success, mappings, addButtons, userData, ... }
 */
export async function processFieldsAI(fields: FormField[], hostname = "") {
  try {
    // Load everything we need from storage in one batch call
    const stored = await chrome.storage.local.get([
      "geminiApiKey",
      "resumeFileData",
      "resumeFileName",
      "fileLibrary",
      "matchingMode",
    ]);
    const userData = await getActiveUserData();
    const apiKey = ((stored.geminiApiKey || "") as string).trim();
    const resumeFileData = stored.resumeFileData as string | undefined;
    const resumeFileName = stored.resumeFileName as string | undefined;
    const matchingMode = (stored.matchingMode || "heuristic") as string;
    const useAI = matchingMode === "ai";
    const isPro = !!stored.isPro;

    // AI mode is gated behind the Pro subscription
    if (useAI && !isPro) {
      return {
        success: false,
        error:
          "🔒 Gemini AI matching is a Pro feature. Please upgrade to unlock!",
      };
    }

    // Normalise custom fields format (old object shape → new array shape)
    const customFields = migrateCustomFields(userData.customFields);

    let fieldMappings: any[] | null = null;

    if (useAI) {
      // ── AI Mode ──────────────────────────────────────────────────
      // Requires a Gemini API key and respects the 500 ms rate limit.
      // Tries the domain cache first — only calls Gemini on a cache miss.
      // Falls back to heuristic if AI returns zero results or errors.
      if (apiKey) geminiService.setApiKey(apiKey);
      if (!apiKey)
        return {
          success: false,
          error:
            "No API key found. Save your Gemini API key in the extension settings.",
        };
      if (!checkRateLimit())
        return {
          success: false,
          error: "Please wait a moment before requesting another fill.",
        };

      // Check domain cache before calling Gemini
      // getCachedMappings() returns null on miss, expired TTL, or signature mismatch
      const signature = buildFieldSignature(fields);
      fieldMappings = hostname ? getCachedMappings(hostname, signature) : null;

      if (!fieldMappings) {
        try {
          // Call Gemini to map each field to a fieldType + confidence score
          fieldMappings = await geminiService.analyzeFormFields(
            fields,
            customFields,
          );
          if (!fieldMappings || fieldMappings.length === 0) {
            console.warn(
              "Aullevo: AI returned 0 mappings, falling back to heuristic for",
              fields.length,
              "fields",
            );
            // AI confused — heuristic is more reliable than empty mappings
            fieldMappings = matchFieldsHeuristically(
              fields,
              customFields,
              userData,
            );
          } else if (hostname) {
            // Store successful AI result so next visit to this page is instant
            setCachedMappings(hostname, signature, fieldMappings);
          }
        } catch (aiErr: any) {
          console.warn(
            "Aullevo: AI matching failed in processFieldsAI, falling back to heuristic:",
            aiErr,
          );
          fieldMappings = matchFieldsHeuristically(
            fields,
            customFields,
            userData,
          );
        }
      }
    } else {
      // ── Heuristic Mode ───────────────────────────────────────────
      // Keyword + label-based matching. Instant, no API calls.
      // Used when user hasn't enabled AI mode or has no API key.
      console.log(
        `Aullevo: Using HEURISTIC matching for ${fields.length} fields`,
      );
      fieldMappings = matchFieldsHeuristically(fields, customFields, userData);
      if (!fieldMappings || fieldMappings.length === 0) {
        console.warn(
          "Aullevo: Heuristic returned 0 mappings for",
          fields.length,
          "fields",
        );
        return { success: true, mappings: [], addButtons: [], userData };
      }
    }

    // Build the virtual file library:
    //   • Start with the user's saved file library (PDFs, cover letters, etc.)
    //   • Add the legacy "resume" field (older versions stored one file only)
    //     as a virtual entry so the file resolver can still match it.
    const fileLibrary: SavedFile[] = (stored.fileLibrary as SavedFile[]) || [];
    const virtualLibrary = [...fileLibrary];
    if (resumeFileData && resumeFileName) {
      if (!virtualLibrary.some((sf) => sf.name === resumeFileName)) {
        virtualLibrary.push({
          id: "legacy-resume",
          name: resumeFileName,
          size: 0,
          type: "application/pdf",
          dataUrl: resumeFileData,
          savedAt: "Legacy",
        });
      }
    }

    // Resolve ALL values using the shared helper.
    // This mutates fieldMappings in-place, setting mapping.selectedValue
    // (and mapping.fileData / mapping.files for file inputs).
    await resolveFieldValues(
      fieldMappings,
      fields,
      userData,
      customFields,
      virtualLibrary,
      useAI,
    );

    // Separate "fill" instructions from "add-more-entries" button instructions
    const fillMappings = fieldMappings.filter(
      (m: any) => m.action !== "click_add",
    );
    const addButtons = fieldMappings.filter(
      (m: any) => m.action === "click_add",
    );

    if (useAI && fillMappings.length === 0 && fields.length > 0) {
      throw new Error(
        "AI analysis returned zero mappings. The form configuration may be too complex or confused the AI.",
      );
    }

    console.log(
      `Aullevo ${useAI ? "AI" : "Heuristic"}: ${fillMappings.length} fill mappings, ${addButtons.length} add buttons`,
    );

    return {
      success: true,
      mappings: fillMappings,
      addButtons,
      userData,
      resumeFileData,
      resumeFileName,
    };
  } catch (error: any) {
    console.error("Aullevo processFieldsAI error:", error);
    const msg = error.message || String(error);
    // Surface friendly error messages for common API failure codes
    if (
      msg.includes("429") ||
      msg.includes("Rate limit") ||
      msg.toLowerCase().includes("rate")
    ) {
      return {
        success: false,
        error: "⏱️ Rate limit exceeded. Wait 30 seconds and try again.",
      };
    }
    if (msg.includes("500") || msg.includes("server error")) {
      return {
        success: false,
        error: "🔧 Gemini server error. Try again in a moment.",
      };
    }
    return { success: false, error: msg || "Processing failed" };
  }
}

// runAIFill  (Popup / Keyboard Shortcut entry point)

/**
 * runAIFill
 * ─────────
 * Entry point triggered by the popup "Fill" button or the Ctrl+M
 * keyboard shortcut (via "triggerFillFromPopup" message in background.ts).
 *
 * Responsibilities:
 *   1. Load API key and user data from storage.
 *   2. Find the currently active tab.
 *   3. Initialise or clear the autopilot session in local storage.
 *   4. Show the ⏳ loading badge.
 *   5. Kick off processFormStep() at step 0.
 *
 * This is a "fire and forget" wrapper around processFormStep() — it
 * just sets up the session and hands off.
 *
 * CALLED BY: background.ts → "triggerFillFromPopup" message handler (line ~150)
 */
export async function runAIFill() {
  try {
    const stored = await chrome.storage.local.get([
      "geminiApiKey",
      "resumeFileData",
      "resumeFileName",
      "autoSubmit",
    ]);
    const userData = await getActiveUserData();
    const apiKey = ((stored.geminiApiKey || "") as string).trim();
    if (apiKey) geminiService.setApiKey(apiKey);

    // Get the currently focused tab — this is where we'll fill the form
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) {
      showBadge("!", "#f87171"); // Red "!" if no active tab found
      return;
    }

    const tabId = tab.id;
    const tabHostname = getHostname(tab.url || "");
    const autoSubmit = !!stored.autoSubmit;

    // Autopilot session: persists across page navigations so the onUpdated
    // listener knows to continue filling after a form "Next" button navigation.
    if (autoSubmit) {
      await chrome.storage.local.set({
        autopilotSession: {
          tabId: tabId,
          step: 0,
          hostname: tabHostname,
          fingerprints: [], // Used to detect stuck/looping steps
        },
      });
    } else {
      // No autopilot — clear any stale session from a previous run
      await chrome.storage.local.remove(["autopilotSession"]);
    }

    showBadge("⏳", "#3B82F6"); // Blue hourglass = working

    // Delegate to the main fill loop at step 0
    await processFormStep(
      tabId,
      userData,
      0,
      tabHostname,
      stored.resumeFileData as string | undefined,
      stored.resumeFileName as string | undefined,
    );
  } catch (error: any) {
    console.error("Aullevo shortcut error:", error);
    showBadge("✗", "#f87171");
    setTimeout(clearBadge, 3000);
  }
}

// processFormStep  (Core recursive fill loop)

/**
 * processFormStep
 *
 * The heart of the fill engine. Processes one "step" of a (potentially
 * multi-page) application form.
 *
 * One call handles:
 *   1. Safety check: stop if we've exceeded 30 steps (loop guard).
 *   2. Scan: send "analyzeForm" to the page to get current FormField[].
 *   3. Match: use AI or heuristic to create field → fieldType mappings.
 *   4. Fingerprint check: detect if autopilot is stuck (same values repeating).
 *   5. Fill: send "fillForm" to the page with the resolved mappings.
 *   6. Add-button loop: if experience/education needs more rows, click
 *      the "+" button and recurse (step+1) to fill new rows.
 *   7. Next-step navigation (autoSubmit only): click "Next" → wait 3s →
 *      recurse (step+1) to fill the next page.
 *
 * CALLED BY:
 *   • runAIFill()                — step 0, popup/shortcut flow
 *   • background.ts (line ~154)  — step 0, sidebar "Fill" button
 *   • background.ts onUpdated    — continuing autopilot after navigation
 *   • itself (recursion)         — each step after "Next" or "Add" row
 *
 * @param tabId          - Chrome tab to operate on.
 * @param userData       - Active user profile.
 * @param step           - Current step index (0-based). Safety cap at 30.
 * @param hostname       - Site hostname for cache keying.
 * @param resumeFileData - Base64 data URL of the user's resume file.
 * @param resumeFileName - File name of the resume, used for matching.
 */
export async function processFormStep(
  tabId: number,
  userData: Partial<UserData>,
  step: number,
  hostname: string,
  resumeFileData?: string,
  resumeFileName?: string,
) {
  // ── Safety cap: prevent infinite recursion on misbehaving forms ──
  if (step > 30) {
    showBadge("✓", "#34d399");
    setTimeout(clearBadge, 4000);
    chrome.storage.local.remove(["autopilotSession"]);
    sendSidebarStatus(
      tabId,
      "Form filling completed (maximum step limit reached).",
      "success",
    );
    return;
  }

  try {
    // ── Step 1: Scan
    // Ask the content script to analyse the current DOM and return all
    // visible, fillable fields (FormField[]).
    sendSidebarStatus(
      tabId,
      `Scanning page fields (Step ${step + 1})...`,
      "scanning",
    );
    const response = await sendToTab(tabId, { action: "analyzeForm" });
    if (!response?.success) {
      showBadge("✗", "#f87171");
      setTimeout(clearBadge, 3000);
      sendSidebarStatus(
        tabId,
        `Could not analyze form: ${response?.message || "unknown"}`,
        "error",
      );
      return;
    }

    const fields: FormField[] = response.fields || [];
    let needsReAnalysis = false; // Set to true when "Add row" button was clicked
    let filledCount = 0;

    if (fields.length > 0) {
      // ── Step 2: Match
      // Determine AI vs heuristic mode, then produce fieldMappings:
      // an array of { fieldId, fieldType, confidence } objects.
      const storedMode = await chrome.storage.local.get([
        "matchingMode",
        "geminiApiKey",
      ]);
      const matchingMode = (storedMode.matchingMode || "heuristic") as string;
      const useAI = matchingMode === "ai";

      sendSidebarStatus(
        tabId,
        useAI
          ? `Matching ${fields.length} field(s) with Gemini AI...`
          : `Matching ${fields.length} field(s) by keyword...`,
        "scanning",
      );

      const customFields = migrateCustomFields(userData.customFields);
      let fieldMappings: any[] | null = null;

      if (useAI) {
        // AI Mode: validate key, try cache, call Gemini, cache result
        const apiKey = ((storedMode.geminiApiKey || "") as string).trim();
        if (!apiKey) {
          showBadge("!", "#f87171");
          setTimeout(clearBadge, 3000);
          sendSidebarStatus(
            tabId,
            "No Gemini API key found. Please add your API key in Settings.",
            "error",
          );
          return;
        }
        geminiService.setApiKey(apiKey);

        // Cache check: if this exact set of fields was seen before on this
        // domain (within 10 minutes), use the cached mappings directly.
        const signature = buildFieldSignature(fields);
        fieldMappings = getCachedMappings(hostname, signature);
        if (!fieldMappings) {
          try {
            fieldMappings = await geminiService.analyzeFormFields(
              fields,
              customFields,
            );
            if (!fieldMappings || fieldMappings.length === 0) {
              console.warn(
                "Aullevo: AI returned 0 mappings, falling back to keyword matching",
              );
              fieldMappings = matchFieldsHeuristically(
                fields,
                customFields,
                userData,
              );
            } else if (hostname) {
              setCachedMappings(hostname, signature, fieldMappings);
            }
          } catch (aiErr: any) {
            console.warn(
              "Aullevo: AI matching failed, falling back to keyword matching:",
              aiErr,
            );
            sendSidebarStatus(
              tabId,
              `AI matching notice: ${aiErr.message || "error"}. Using keyword matching fallback...`,
              "info",
            );
            fieldMappings = matchFieldsHeuristically(
              fields,
              customFields,
              userData,
            );
          }
        }
      } else {
        // Heuristic Mode: keyword + label matching, no API calls
        fieldMappings = matchFieldsHeuristically(
          fields,
          customFields,
          userData,
        );
      }
      if (!fieldMappings) fieldMappings = [];

      // Build virtual library (saved files + legacy resume backup)
      const stored = await chrome.storage.local.get(["fileLibrary"]);
      const fileLibrary: SavedFile[] =
        (stored.fileLibrary as SavedFile[]) || [];
      const virtualLibrary = [...fileLibrary];
      if (resumeFileData && resumeFileName) {
        if (!virtualLibrary.some((sf) => sf.name === resumeFileName)) {
          virtualLibrary.push({
            id: "legacy-resume",
            name: resumeFileName,
            size: 0,
            type: "application/pdf",
            dataUrl: resumeFileData,
            savedAt: "Legacy",
          });
        }
      }

      // ── Step 3: Resolve values
      // Attach actual data (strings, arrays, files) to each mapping.
      // After this call, every mapping has a .selectedValue / .fileData.
      await resolveFieldValues(
        fieldMappings,
        fields,
        userData,
        customFields,
        virtualLibrary,
        useAI,
      );

      // Split mappings into fill instructions vs. "Add row" button clicks
      const fillMappings = fieldMappings.filter(
        (m: any) => m.action !== "click_add",
      );

      // ── Step 4: Fingerprint / Loop guard
      // If the autopilot fills the same values into the same fields twice,
      // it's stuck in a loop (e.g. "Next" didn't navigate away).
      // Compare a fingerprint of this step's fill intent against past steps.
      const currentFingerprint = JSON.stringify(
        fillMappings.map((m: any) => ({ id: m.id, value: m.selectedValue })),
      );
      const sessionData = await chrome.storage.local.get(["autopilotSession"]);
      const session = sessionData.autopilotSession as any;
      if (session) {
        const fingerprints = session.fingerprints || [];
        if (fingerprints.includes(currentFingerprint)) {
          console.warn("Aullevo Autopilot: Stuck step detected. Stopping.");
          showBadge("✗", "#f87171");
          setTimeout(clearBadge, 3000);
          chrome.storage.local.remove(["autopilotSession"]);
          sendSidebarStatus(
            tabId,
            "Autopilot stopped: stuck step detected (same values in same fields).",
            "error",
          );
          return;
        }
        // Record this fingerprint so future steps can detect loops
        await chrome.storage.local.set({
          autopilotSession: {
            ...session,
            fingerprints: [...fingerprints, currentFingerprint],
          },
        });
      }

      // ── Step 5: Fill
      // Send the resolved mappings to the content script which injects
      // the values into the DOM (sets input values, triggers React events, etc.)
      sendSidebarStatus(
        tabId,
        `Filling ${fillMappings.length} matched field(s)...`,
        "filling",
      );
      const fillResponse = await sendToTab(tabId, {
        action: "fillForm",
        data: {
          fieldMappings: fillMappings,
          userData,
          resumeFileData,
          resumeFileName,
        },
      });

      filledCount = fillResponse?.filledCount ?? 0;
      if (fillResponse?.success) {
        showBadge(`${filledCount}`, "#34d399"); // Green badge: number of filled fields
      } else {
        showBadge("✗", "#f87171");
        setTimeout(clearBadge, 3000);
        sendSidebarStatus(
          tabId,
          `Fill action failed: ${fillResponse?.error || "unknown"}`,
          "error",
        );
        chrome.storage.local.remove(["autopilotSession"]);
        return;
      }

      // If nothing was filled and no re-analysis needed, we're done
      if (filledCount === 0 && !needsReAnalysis) {
        showBadge("✓", "#34d399");
        setTimeout(clearBadge, 4000);
        chrome.storage.local.remove(["autopilotSession"]);
        sendSidebarStatus(tabId, "Form filling complete!", "success");
        return;
      }

      // ── Step 6: Add-button handling
      // Some forms use an "Add another experience" button to reveal extra rows.
      // If the user's data has more items than are currently shown, click the
      // button, invalidate the cache (so new fields are detected), wait, then
      // recurse to fill the newly revealed row.
      const addButtons = fieldMappings.filter(
        (m: any) => m.action === "click_add",
      );
      for (const btn of addButtons) {
        if (!btn.groupType) continue;
        // How many rows of this type are currently mapped?
        const currentIndices = fieldMappings
          .filter(
            (m: any) =>
              m.groupType === btn.groupType && typeof m.groupIndex === "number",
          )
          .map((m: any) => m.groupIndex!);
        const maxIndex =
          currentIndices.length > 0 ? Math.max(...currentIndices) : -1;
        let totalDataItems = 0;
        if (btn.groupType === "experience")
          totalDataItems = (userData.experience || []).length;
        if (btn.groupType === "education")
          totalDataItems = (userData.education || []).length;

        // Only click "Add" if there's more data than currently visible rows
        if (totalDataItems > maxIndex + 1) {
          sendSidebarStatus(
            tabId,
            `Adding another ${btn.groupType} entry...`,
            "info",
          );
          await sendToTab(tabId, {
            action: "fillForm",
            data: { fieldMappings: [{ ...btn }] }, // Send only the add-button instruction
          });
          await sleep(1500); // Wait for the new row to appear in the DOM
          invalidateCache(hostname); // Force re-scan: new fields are now visible
          needsReAnalysis = true; // Signal outer code to recurse
          break; // Only process one "Add" per step to avoid race conditions
        }
      }
    } else {
      // No fields found at all — the form may be complete or already filled
      showBadge("✓", "#34d399");
      setTimeout(clearBadge, 4000);
      chrome.storage.local.remove(["autopilotSession"]);
      sendSidebarStatus(
        tabId,
        "Form filling complete! No fields found.",
        "success",
      );
      return;
    }

    // ── Step 6b: Recurse if new rows were added
    // After clicking "Add row", come back after 500 ms to fill the new row.
    if (needsReAnalysis) {
      await sleep(500);
      await processFormStep(tabId, userData, step + 1, hostname);
      return;
    }

    // ── Step 7: Auto-Submit / Next navigation
    // If autoSubmit is disabled: show success, done.
    // If autoSubmit is enabled: click "Next" → wait 3 s → recurse for step+1.
    const storedSessSettings = await chrome.storage.local.get(["autoSubmit"]);
    const autoSubmit = !!storedSessSettings.autoSubmit;

    if (!autoSubmit) {
      showBadge("✓", "#34d399");
      setTimeout(clearBadge, 4000);
      chrome.storage.local.remove(["autopilotSession"]);
      sendSidebarStatus(
        tabId,
        `Filled ${filledCount} field(s) successfully!`,
        "success",
      );
      return;
    }

    // Autopilot: send "clickNext" → if successful, the page navigates.
    // The onUpdated listener in background.ts will resume from here next time.
    // But we also recurse directly in case the "Next" click only reveals
    // a new section on the SAME page (no navigation).
    await sleep(1000); // Let the user see the filled fields briefly
    sendSidebarStatus(tabId, "➡️ Moving to next step...", "info");
    const nextResponse = await sendToTab(tabId, { action: "clickNext" });
    if (nextResponse?.success) {
      invalidateCache(hostname); // Next page will have different fields
      // Update autopilot session step counter
      const storedSess = await chrome.storage.local.get(["autopilotSession"]);
      if (storedSess.autopilotSession) {
        await chrome.storage.local.set({
          autopilotSession: { ...storedSess.autopilotSession, step: step + 1 },
        });
      }
      await sleep(3000); // Wait for page transition / animation
      // Recurse: process the next step (either same page new section, or new page)
      await processFormStep(
        tabId,
        userData,
        step + 1,
        hostname,
        resumeFileData,
        resumeFileName,
      );
    } else {
      // "Next" button not found — we're probably on the last step
      showBadge("✓", "#34d399");
      setTimeout(clearBadge, 4000);
      chrome.storage.local.remove(["autopilotSession"]);
      sendSidebarStatus(
        tabId,
        "Form filling complete! (Next page not found).",
        "success",
      );
    }
  } catch (error: any) {
    console.error("Aullevo fill step error:", error);
    showBadge("✗", "#f87171");
    setTimeout(clearBadge, 3000);
    sendSidebarStatus(
      tabId,
      `Filling failed: ${error.message || error}`,
      "error",
    );
    chrome.storage.local.remove(["autopilotSession"]);
  }
}
