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

export async function processFieldsAI(fields: FormField[], hostname = "") {
  try {
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

    if (useAI && !isPro) {
      return {
        success: false,
        error:
          "🔒 Gemini AI matching is a Pro feature. Please upgrade to unlock!",
      };
    }

    const customFields = migrateCustomFields(userData.customFields);

    let fieldMappings: any[] | null = null;

    if (useAI) {
      // ── AI Mode: requires API key, uses Gemini ──
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
      const signature = buildFieldSignature(fields);
      fieldMappings = hostname ? getCachedMappings(hostname, signature) : null;

      if (!fieldMappings) {
        try {
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
      // ── Heuristic Mode: instant, zero API calls ──
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

    // Build virtual library (real library + legacy resume)
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

    // Resolve ALL values using the shared helper
    await resolveFieldValues(
      fieldMappings,
      fields,
      userData,
      customFields,
      virtualLibrary,
      useAI,
    );

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

/* ─── Popup / Ctrl+M flow ─── */

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

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) {
      showBadge("!", "#f87171");
      return;
    }

    const tabId = tab.id;
    const tabHostname = getHostname(tab.url || "");
    const autoSubmit = !!stored.autoSubmit;

    if (autoSubmit) {
      await chrome.storage.local.set({
        autopilotSession: {
          tabId: tabId,
          step: 0,
          hostname: tabHostname,
          fingerprints: [],
        },
      });
    } else {
      await chrome.storage.local.remove(["autopilotSession"]);
    }

    showBadge("⏳", "#3B82F6");
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

export async function processFormStep(
  tabId: number,
  userData: Partial<UserData>,
  step: number,
  hostname: string,
  resumeFileData?: string,
  resumeFileName?: string,
) {
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
        fieldMappings = matchFieldsHeuristically(
          fields,
          customFields,
          userData,
        );
      }
      if (!fieldMappings) fieldMappings = [];

      // Build virtual library for file matching
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

      // Use shared resolver for ALL value types
      await resolveFieldValues(
        fieldMappings,
        fields,
        userData,
        customFields,
        virtualLibrary,
        useAI,
      );

      const fillMappings = fieldMappings.filter(
        (m: any) => m.action !== "click_add",
      );

      // Loop safety / Fingerprint check
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
        await chrome.storage.local.set({
          autopilotSession: {
            ...session,
            fingerprints: [...fingerprints, currentFingerprint],
          },
        });
      }

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

      const addButtons = fieldMappings.filter(
        (m: any) => m.action === "click_add",
      );
      for (const btn of addButtons) {
        if (!btn.groupType) continue;
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
          invalidateCache(hostname);
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

    if (needsReAnalysis) {
      await sleep(500);
      await processFormStep(tabId, userData, step + 1, hostname);
      return;
    }

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
    if (nextResponse?.success) {
      invalidateCache(hostname);
      const storedSess = await chrome.storage.local.get(["autopilotSession"]);
      if (storedSess.autopilotSession) {
        await chrome.storage.local.set({
          autopilotSession: { ...storedSess.autopilotSession, step: step + 1 },
        });
      }
      await sleep(3000);
      await processFormStep(
        tabId,
        userData,
        step + 1,
        hostname,
        resumeFileData,
        resumeFileName,
      );
    } else {
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
