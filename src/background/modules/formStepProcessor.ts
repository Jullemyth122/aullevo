/**
 * Form filling pipeline orchestration: coordinates scanning, AI/heuristic matching,
 * value resolution, multi-step navigation, and recursive filling.
 */

import { geminiService } from "../../services/geminiService";
import { matchFieldsHeuristically } from "../../services/heuristicMatcher";
import type { UserData, FormField, SavedFile, FieldMapping } from "../../types";
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

/**
 * Checks if a user's profile has any data entered (personal info, experience, education, custom fields, etc.)
 */
export function isUserProfileEmpty(userData?: Partial<UserData>): boolean {
  if (!userData) return true;
  const hasName = Boolean(userData.firstName || userData.lastName || userData.fullName);
  const hasContact = Boolean(userData.email || userData.phone);
  const hasAddress = Boolean(userData.address || userData.city || userData.country);
  const hasExp = Boolean(userData.experience && userData.experience.length > 0);
  const hasEdu = Boolean(userData.education && userData.education.length > 0);
  const hasCustom = Boolean(
    userData.customFields &&
      (Array.isArray(userData.customFields)
        ? userData.customFields.length > 0
        : Object.keys(userData.customFields).length > 0),
  );
  const hasMem = Boolean(userData.memories && userData.memories.length > 0);
  const hasLinks = Boolean(userData.savedLinks && userData.savedLinks.length > 0);

  return !(hasName || hasContact || hasAddress || hasExp || hasEdu || hasCustom || hasMem || hasLinks);
}

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
      "isPro",
    ]);
    const userData = await getActiveUserData();

    // Check if user has an empty profile
    if (isUserProfileEmpty(userData)) {
      return {
        success: false,
        error:
          "Your profile is empty! Click the Aullevo icon or press Ctrl+Shift+E to configure your profile details.",
      };
    }

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

    let fieldMappings: FieldMapping[] | null = null;

    if (useAI) {
      // AI Mode: requires Gemini API key and respects 500 ms rate limit
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

      // Split: 2D matrix cells are deterministic → heuristic matching
      const matrixFields = fields.filter((f) => !!(f.rowHeader && f.colHeader));
      const nonMatrixFields = fields.filter(
        (f) => !(f.rowHeader && f.colHeader),
      );
      const matrixMappings: FieldMapping[] =
        matrixFields.length > 0
          ? matchFieldsHeuristically(matrixFields, customFields, userData)
          : [];

      if (matrixFields.length > 0) {
        console.log(
          `Aullevo: Bypassing AI for ${matrixFields.length} 2D-matrix cell(s) — using heuristic`,
        );
      }

      // Check domain cache before calling Gemini (keyed on non-matrix fields only)
      const signature = buildFieldSignature(nonMatrixFields);
      fieldMappings = hostname
        ? await getCachedMappings(hostname, signature)
        : null;

      if (!fieldMappings) {
        try {
          fieldMappings =
            nonMatrixFields.length > 0
              ? await geminiService.analyzeFormFields(
                  nonMatrixFields,
                  customFields,
                )
              : [];

          if (!fieldMappings || fieldMappings.length === 0) {
            console.warn(
              "Aullevo: AI returned 0 mappings, falling back to heuristic for",
              nonMatrixFields.length,
              "non-matrix fields",
            );
            fieldMappings = matchFieldsHeuristically(
              nonMatrixFields,
              customFields,
              userData,
            );
          } else if (hostname) {
            await setCachedMappings(hostname, signature, fieldMappings);
          }
        } catch (aiErr: unknown) {
          console.warn(
            "Aullevo: AI matching failed in processFieldsAI, falling back to heuristic:",
            aiErr,
          );
          fieldMappings = matchFieldsHeuristically(
            nonMatrixFields,
            customFields,
            userData,
          );
        }
      }

      // Merge AI mappings + heuristic matrix mappings
      fieldMappings = [...(fieldMappings ?? []), ...matrixMappings];
    } else {
      // Heuristic Mode: keyword and label matching
      console.log(
        `Aullevo: Using HEURISTIC matching for ${fields.length} fields`,
      );
      fieldMappings = matchFieldsHeuristically(fields, customFields, userData);
    }

    if (!fieldMappings) fieldMappings = [];

    // Ensure 100% coverage: supplement any fields unmapped by AI with heuristic matching
    const mappedIds = new Set(fieldMappings.map((m) => m.id || m.fieldId));
    const unmappedFields = fields.filter((f) => !mappedIds.has(f.id));
    if (unmappedFields.length > 0) {
      const fallbacks = matchFieldsHeuristically(
        unmappedFields,
        customFields,
        userData,
      );
      fieldMappings.push(...fallbacks);
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
      (m: FieldMapping) => m.action !== "click_add",
    );
    const addButtons = fieldMappings.filter(
      (m: FieldMapping) => m.action === "click_add",
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
  } catch (error: unknown) {
    console.error("Aullevo processFieldsAI error:", error);
    const msg = error instanceof Error ? error.message : String(error);
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

/**
 * Entry point triggered by popup or shortcut to initialize autopilot session and run processFormStep.
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
  } catch (error: unknown) {
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
  // Safety cap: prevent infinite recursion on misbehaving forms
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

  // First-time check: guide user if profile is completely empty
  if (step === 0 && isUserProfileEmpty(userData)) {
    showBadge("!", "#eab308");
    setTimeout(clearBadge, 4000);
    sendSidebarStatus(
      tabId,
      "⚠️ Profile is empty! Click the Aullevo icon or press Ctrl+Shift+E to add your details.",
      "info",
    );
    sendToTab(tabId, {
      action: "showToast",
      message:
        "⚠️ Profile is empty! Click the Aullevo icon or press Ctrl+Shift+E to add your details.",
      type: "error",
    });
    return;
  }

  try {
    // Step 1: Scan current visible form fields
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
    let needsReAnalysis = false;
    let filledCount = 0;

    if (fields.length > 0) {
      // Step 2: Match fields via AI or heuristic
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
      let fieldMappings: FieldMapping[] | null = null;

      if (useAI) {
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

        const matrixFields = fields.filter(
          (f) => !!(f.rowHeader && f.colHeader),
        );
        const nonMatrixFields = fields.filter(
          (f) => !(f.rowHeader && f.colHeader),
        );
        const matrixMappings: FieldMapping[] =
          matrixFields.length > 0
            ? matchFieldsHeuristically(matrixFields, customFields, userData)
            : [];

        if (matrixFields.length > 0) {
          console.log(
            `Aullevo: Bypassing AI for ${matrixFields.length} 2D-matrix cell(s) — using heuristic`,
          );
          sendSidebarStatus(
            tabId,
            `Matching ${nonMatrixFields.length} field(s) with Gemini AI (+ ${matrixFields.length} table cell(s) via keyword)...`,
            "scanning",
          );
        }

        const signature = buildFieldSignature(nonMatrixFields);
        fieldMappings = await getCachedMappings(hostname, signature);
        if (!fieldMappings) {
          try {
            fieldMappings =
              nonMatrixFields.length > 0
                ? await geminiService.analyzeFormFields(
                    nonMatrixFields,
                    customFields,
                  )
                : [];

            if (!fieldMappings || fieldMappings.length === 0) {
              console.warn(
                "Aullevo: AI returned 0 mappings, falling back to keyword matching",
              );
              fieldMappings = matchFieldsHeuristically(
                nonMatrixFields,
                customFields,
                userData,
              );
            } else if (hostname) {
              await setCachedMappings(hostname, signature, fieldMappings);
            }
          } catch (aiErr: unknown) {
            const aiMsg =
              aiErr instanceof Error ? aiErr.message : String(aiErr);
            console.warn(
              "Aullevo: AI matching failed, falling back to keyword matching:",
              aiErr,
            );
            sendSidebarStatus(
              tabId,
              `AI matching notice: ${aiMsg || "error"}. Using keyword matching fallback...`,
              "info",
            );
            fieldMappings = matchFieldsHeuristically(
              nonMatrixFields,
              customFields,
              userData,
            );
          }
        }

        fieldMappings = [...(fieldMappings ?? []), ...matrixMappings];
      } else {
        fieldMappings = matchFieldsHeuristically(
          fields,
          customFields,
          userData,
        );
      }

      if (!fieldMappings) fieldMappings = [];

      const mappedIds = new Set(fieldMappings.map((m) => m.id || m.fieldId));
      const unmappedFields = fields.filter((f) => !mappedIds.has(f.id));
      if (unmappedFields.length > 0) {
        const fallbacks = matchFieldsHeuristically(
          unmappedFields,
          customFields,
          userData,
        );
        fieldMappings.push(...fallbacks);
      }

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

      // Step 3: Resolve concrete field values
      await resolveFieldValues(
        fieldMappings,
        fields,
        userData,
        customFields,
        virtualLibrary,
        useAI,
      );

      const fillMappings = fieldMappings.filter(
        (m: FieldMapping) => m.action !== "click_add",
      );

      // Step 4: Fingerprint and loop detection guard
      const currentFingerprint = JSON.stringify(
        fillMappings.map((m: FieldMapping) => ({
          id: m.id,
          value: m.selectedValue,
        })),
      );
      const sessionData = await chrome.storage.local.get(["autopilotSession"]);
      const session = sessionData.autopilotSession as
        | { fingerprints?: string[] }
        | undefined;
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
        await chrome.storage.local.set({
          autopilotSession: {
            ...session,
            fingerprints: [...fingerprints, currentFingerprint],
          },
        });
      }

      // Step 5: Fill fields on the active page
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
        showBadge(`${filledCount}`, "#34d399");
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

      if (filledCount === 0 && !needsReAnalysis) {
        showBadge("✓", "#34d399");
        setTimeout(clearBadge, 4000);
        chrome.storage.local.remove(["autopilotSession"]);
        sendSidebarStatus(tabId, "Form filling complete!", "success");
        return;
      }

      // Step 6: Repeater Add-button handling
      const addButtons = fieldMappings.filter(
        (m: FieldMapping) => m.action === "click_add",
      );
      for (const btn of addButtons) {
        if (!btn.groupType) continue;
        const currentIndices = fieldMappings
          .filter(
            (m: FieldMapping) =>
              m.groupType === btn.groupType && typeof m.groupIndex === "number",
          )
          .map((m: FieldMapping) => m.groupIndex!);
        const maxIndex =
          currentIndices.length > 0 ? Math.max(...currentIndices) : -1;
        let totalDataItems = 0;
        if (btn.groupType === "experience")
          totalDataItems = (userData.experience || []).length;
        if (btn.groupType === "education")
          totalDataItems = (userData.education || []).length;

        if (totalDataItems > maxIndex + 1) {
          sendSidebarStatus(
            tabId,
            `Adding another ${btn.groupType} entry...`,
            "info",
          );
          await sendToTab(tabId, {
            action: "fillForm",
            data: { fieldMappings: [{ ...btn }] },
          });
          await sleep(1500);
          await invalidateCache(hostname);
          needsReAnalysis = true;
          break;
        }
      }
    } else {
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

    // Step 6b: Recurse if new rows were added
    if (needsReAnalysis) {
      await sleep(500);
      await processFormStep(tabId, userData, step + 1, hostname);
      return;
    }

    // Step 7: Auto-Submit and multi-page step progression
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

    await sleep(1000);
    sendSidebarStatus(tabId, "➡️ Moving to next step...", "info");
    const nextResponse = await sendToTab(tabId, { action: "clickNext" });

    if (nextResponse?.success && nextResponse.navigated) {
      // Step advanced successfully to a new page or section
      const storedSess = await chrome.storage.local.get(["autopilotSession"]);
      if (storedSess.autopilotSession) {
        await chrome.storage.local.set({
          autopilotSession: { ...storedSess.autopilotSession, step: step + 1 },
        });
      }
      await sleep(1500);
      await processFormStep(
        tabId,
        userData,
        step + 1,
        hostname,
        resumeFileData,
        resumeFileName,
      );
    } else {
      chrome.storage.local.remove(["autopilotSession"]);

      if (nextResponse?.reason === "validation_error") {
        showBadge("!", "#f59e0b");
        setTimeout(clearBadge, 5000);
        sendSidebarStatus(
          tabId,
          "⚠️ Form has validation errors or missing required fields. Please review highlighted fields.",
          "error",
        );
        sendToTab(tabId, {
          action: "showToast",
          message: "⚠️ Form validation errors detected. Please review required fields.",
          type: "error",
        });
      } else if (nextResponse?.reason === "did_not_advance") {
        showBadge("✓", "#34d399");
        setTimeout(clearBadge, 4000);
        sendSidebarStatus(
          tabId,
          "Form filling complete. (Page did not advance to next section).",
          "success",
        );
      } else {
        showBadge("✓", "#34d399");
        setTimeout(clearBadge, 4000);
        sendSidebarStatus(
          tabId,
          "Form filling complete! (Final step reached).",
          "success",
        );
      }
    }
  } catch (error: unknown) {
    console.error("Aullevo fill step error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    showBadge("✗", "#f87171");
    setTimeout(clearBadge, 3000);
    sendSidebarStatus(tabId, `Filling failed: ${msg}`, "error");
    chrome.storage.local.remove(["autopilotSession"]);
  }
}
