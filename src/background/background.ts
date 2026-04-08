import { geminiService } from "../services/geminiService";
import { matchFieldsHeuristically } from "../services/heuristicMatcher";
import { fileMatchesField, _tokenize } from "../utils/fileMatch";
import type {
  UserData,
  CustomField,
  ChromeResponse,
  FormField,
  SavedFile,
} from "../types";

/**
 * Background service worker for Aullevo.
 * Ctrl+M (toggle-sidebar command) → toggles the sidebar via content script.
 * Alt+F (via content script keydown) → triggers AI form fill directly.
 */

// ─── Rate limiter: minimum 500ms between Gemini API calls ───
let lastApiCallTime = 0;
function checkRateLimit(): boolean {
  const now = Date.now();
  if (now - lastApiCallTime < 500) return false;
  lastApiCallTime = now;
  return true;
}

/* ═══════════════════════════════════════════════════
   DOMAIN-LEVEL AI RESULT CACHE
   ═══════════════════════════════════════════════════ */

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  fieldSignature: string;
  mappings: any[];
  timestamp: number;
}

const domainCache = new Map<string, CacheEntry>();

function buildFieldSignature(fields: FormField[]): string {
  return fields
    .map((f) => `${f.id}|${f.label}|${f.type}`)
    .join(",")
    .slice(0, 500);
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function getCachedMappings(hostname: string, signature: string): any[] | null {
  const entry = domainCache.get(hostname);
  if (!entry) return null;
  const age = Date.now() - entry.timestamp;
  if (age > CACHE_TTL_MS) {
    domainCache.delete(hostname);
    return null;
  }
  if (entry.fieldSignature !== signature) return null;
  console.log(
    `Aullevo cache HIT for ${hostname} (age: ${Math.round(age / 1000)}s)`,
  );
  return entry.mappings;
}

function setCachedMappings(
  hostname: string,
  signature: string,
  mappings: any[],
): void {
  domainCache.set(hostname, {
    fieldSignature: signature,
    mappings,
    timestamp: Date.now(),
  });
  console.log(
    `Aullevo cache SET for ${hostname} (${mappings.length} mappings)`,
  );
}

function invalidateCache(hostname: string): void {
  if (domainCache.has(hostname)) {
    domainCache.delete(hostname);
    console.log(`Aullevo cache INVALIDATED for ${hostname}`);
  }
}

/* ═══════════════════════════════════════════════════
   SHARED HELPERS (deduplicated from two call sites)
   ═══════════════════════════════════════════════════ */

function migrateCustomFields(raw: any): CustomField[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    return Object.entries(raw).map(([key, value]) => ({
      label: key,
      value: String(value),
      context: "",
    }));
  }
  return [];
}

const STANDARD_FIELD_KEYS = new Set([
  "firstName",
  "lastName",
  "email",
  "phone",
  "phoneCountryCode",
  "address",
  "city",
  "state",
  "zipCode",
  "country",
  "linkedin",
  "portfolio",
  "github",
  "summary",
  "headline",
  "dateOfBirth",
  "gender",
  "salaryExpectation",
  "noticePeriod",
  "workAuthorization",
  "yearsOfExperience",
  "resumeUpload",
]);

/**
 * Resolve ALL field values — standard, custom, array, questions, and files.
 * This is the single source of truth for value resolution, used by both
 * processFieldsAI() and processFormStep().
 */
async function resolveFieldValues(
  fieldMappings: any[],
  fields: FormField[],
  userData: Partial<UserData>,
  customFields: CustomField[],
  virtualLibrary: SavedFile[],
  useAI = true,
): Promise<void> {
  const hasCountryCodeField = fieldMappings.some(
    (m) => m.fieldType === "phoneCountryCode",
  );

  for (const mapping of fieldMappings) {
    if (mapping.action === "click_add") continue;

    // A. Custom questions — ask AI only if in AI mode
    if (mapping.fieldType === "custom_question" && mapping.originalQuestion) {
      if (useAI) {
        try {
          mapping.selectedValue = await geminiService.answerFormQuestion(
            mapping.originalQuestion,
            userData,
          );
        } catch (e: any) {
          console.warn("Aullevo: Failed to answer question:", e.message);
          mapping.selectedValue = "[MANUAL_INPUT_NEEDED]";
        }
      } else {
        mapping.selectedValue = "[MANUAL_INPUT_NEEDED]";
      }
      continue;
    }

    // B. Custom fields — user-defined key/value pairs
    if (mapping.fieldType?.startsWith("custom_field:")) {
      const label = mapping.fieldType.slice("custom_field:".length);
      const matches = customFields.filter(
        (cf: CustomField) => cf.label === label,
      );
      if (matches.length > 0) {
        if (matches.length === 1) {
          mapping.selectedValue = matches[0].value;
        } else {
          mapping.selectedValue = matches.map((m) => m.value);
        }
      }
      continue;
    }

    // C. Array mapping (experience, education, skills in groups)
    if (mapping.groupType && typeof mapping.groupIndex === "number") {
      let arraySource: any[] = [];
      if (mapping.groupType === "experience")
        arraySource = userData.experience || [];
      if (mapping.groupType === "education")
        arraySource = userData.education || [];
      if (mapping.groupType === "skill") arraySource = userData.skills || [];

      const item = arraySource[mapping.groupIndex];
      if (item) {
        if (
          typeof item === "object" &&
          item !== null &&
          mapping.fieldType &&
          mapping.fieldType in item
        ) {
          mapping.selectedValue = String((item as any)[mapping.fieldType]);
        } else if (mapping.groupType === "skill") {
          mapping.selectedValue = String(item);
        }
      }
      continue;
    }

    // D. Standard fields (firstName, email, phone, etc.)
    if (
      !mapping.selectedValue &&
      mapping.fieldType &&
      (STANDARD_FIELD_KEYS.has(mapping.fieldType) ||
        mapping.fieldType === "skill")
    ) {
      if (mapping.fieldType === "phoneCountryCode") {
        const match = userData.phone?.match(/\+(\d+)/);
        mapping.selectedValue = match ? `+${match[1]}` : userData.phone || "";
      } else if (mapping.fieldType === "phone") {
        let val = userData.phone || "";
        if (hasCountryCodeField) val = val.replace(/^\+\d+[- ]?/, "");
        mapping.selectedValue = val;
      } else if (
        mapping.fieldType === "skill" &&
        mapping.groupType !== "skill"
      ) {
        mapping.selectedValue = userData.skills || [];
      } else {
        const val = (userData as any)[mapping.fieldType];
        if (val !== undefined && val !== null && val !== "") {
          mapping.selectedValue = Array.isArray(val)
            ? val.join(", ")
            : String(val);
        }
      }
    }
  }

  // E. File vault matching — match library files to ALL file-type fields
  if (virtualLibrary.length > 0) {
    // Iterate all file-type fields on the page, not just AI-mapped ones
    const fileFields = fields.filter((f) => f.type === "file");

    for (const fileField of fileFields) {
      // Find or create a mapping for this file field
      let mapping = fieldMappings.find(
        (m) =>
          m.action !== "click_add" &&
          (m.id === fileField.id || m.fieldId === fileField.id),
      );

      // If no AI mapping exists for this file field, create one
      if (!mapping) {
        mapping = {
          id: fileField.id,
          fieldId: fileField.id,
          fieldType: "resumeUpload",
          confidence: 0.8,
        };
        fieldMappings.push(mapping);
      }

      // Skip if already has file data
      if (mapping.fileData || (mapping.files && mapping.files.length > 0))
        continue;

      // Extract semantic tokens from the AI's determined fieldType (e.g. "resumeUpload" -> "resume", "upload")
      const extraKws = mapping.fieldType ? _tokenize(mapping.fieldType) : [];

      // Match using the full field object + AI extra keywords
      const matchedFiles = virtualLibrary.filter((sf) =>
        fileMatchesField(fileField, sf, extraKws),
      );

      if (matchedFiles.length > 0) {
        if (fileField.multiple) {
          mapping.files = matchedFiles.map((sf) => ({
            name: sf.name,
            dataUrl: sf.dataUrl,
          }));
          mapping.selectedValue = "FILE_UPLOAD";
          console.log(
            `Aullevo FileVault: ${matchedFiles.length} files matched to [${fileField.label || fileField.name || fileField.id}] (Multiple)`,
          );
        } else {
          const bestMatch = matchedFiles[0];
          mapping.fileData = bestMatch.dataUrl;
          mapping.fileName = bestMatch.name;
          mapping.selectedValue = "FILE_UPLOAD";
          console.log(
            `Aullevo FileVault: "${bestMatch.name}" matched to [${fileField.label || fileField.name || fileField.id}] (Single)`,
          );
        }
      }
    }
  }
}

/* ═══════════════════════════════════════════════════
   COMMANDS & MESSAGE HANDLING
   ═══════════════════════════════════════════════════ */

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-sidebar") {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      chrome.tabs
        .sendMessage(tab.id, { action: "toggleSidebar" })
        .catch((err) => {
          console.warn("Aullevo: Sidebar toggle failed", err);
        });
    }
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { action: "toggleSidebar" }).catch(() => {
    console.warn("Aullevo: Content script not loaded yet — refresh the page.");
  });
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === "triggerFillFromPopup") {
    runAIFill().then(() => sendResponse({ success: true }));
    return true;
  }

  if (request.action === "triggerFillFromSidebar") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab?.id)
          return sendResponse({ success: false, error: "No active tab found" });

        const tabId = tab.id;
        const tabHostname = getHostname(tab.url || "");
        showBadge("⏳", "#7c5cfc");

        const analyzeResp = await sendToTab(tabId, { action: "analyzeForm" });
        if (!analyzeResp?.success)
          return sendResponse({
            success: false,
            error: "Could not analyze form",
          });

        const fields = analyzeResp.fields || [];
        if (fields.length === 0)
          return sendResponse({
            success: false,
            error: "No form fields found on this page",
          });

        const aiResult = await processFieldsAI(fields, tabHostname);
        if (!aiResult.success)
          return sendResponse({ success: false, error: aiResult.error });

        const fillResp = await sendToTab(tabId, {
          action: "fillForm",
          data: {
            fieldMappings: aiResult.mappings,
            userData: aiResult.userData,
            resumeFileData: aiResult.resumeFileData,
            resumeFileName: aiResult.resumeFileName,
          },
        });

        const filledCount = fillResp?.filledCount ?? 0;
        showBadge(`${filledCount}`, "#34d399");
        setTimeout(clearBadge, 4000);
        sendResponse({ success: true, filledCount });
      } catch (err: any) {
        showBadge("✗", "#f87171");
        setTimeout(clearBadge, 3000);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === "processFieldsAI") {
    const hostname = getHostname(request.tabUrl || "");
    processFieldsAI(request.fields, hostname)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "urlChanged") {
    // DO NOT invalidate cache on url reload.
    // This fixes the 429 Too Many Requests error on page refresh.
    // Field signature comparison handles actual form changes.
    sendResponse({ success: true });
    return false;
  }

  if (request.action === "domChanged") {
    sendResponse({ success: true });
    return false;
  }
});

/* ═══════════════════════════════════════════════════
   CORE PROCESSING (AI or Heuristic, based on user setting)
   ═══════════════════════════════════════════════════ */

async function processFieldsAI(fields: FormField[], hostname = "") {
  try {
    const stored = await chrome.storage.local.get([
      "userData",
      "geminiApiKey",
      "resumeFileData",
      "resumeFileName",
      "fileLibrary",
      "matchingMode",
    ]);
    const userData = (stored.userData || {}) as Partial<UserData>;
    const apiKey = (stored.geminiApiKey || "") as string;
    const resumeFileData = stored.resumeFileData as string | undefined;
    const resumeFileName = stored.resumeFileName as string | undefined;
    const matchingMode = (stored.matchingMode || "heuristic") as string;
    const useAI = matchingMode === "ai";

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
      fieldMappings = hostname
        ? getCachedMappings(hostname, signature)
        : null;

      if (!fieldMappings) {
        fieldMappings = await geminiService.analyzeFormFields(
          fields,
          customFields,
        );
        if (!fieldMappings || fieldMappings.length === 0) {
          console.warn(
            "Aullevo: AI returned 0 mappings for",
            fields.length,
            "fields",
          );
          return { success: true, mappings: [], addButtons: [], userData };
        }
        if (hostname) setCachedMappings(hostname, signature, fieldMappings);
      }
    } else {
      // ── Heuristic Mode: instant, zero API calls ──
      console.log(`Aullevo: Using HEURISTIC matching for ${fields.length} fields`);
      fieldMappings = matchFieldsHeuristically(fields, customFields);
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

    console.log(
      `Aullevo ${useAI ? 'AI' : 'Heuristic'}: ${fillMappings.length} fill mappings, ${addButtons.length} add buttons`,
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

async function runAIFill() {
  try {
    const stored = await chrome.storage.local.get([
      "userData",
      "geminiApiKey",
      "resumeFileData",
      "resumeFileName",
    ]);
    const userData = (stored.userData || {}) as Partial<UserData>;
    const apiKey = (stored.geminiApiKey || "") as string;
    if (apiKey) geminiService.setApiKey(apiKey);

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) {
      showBadge("!", "#f87171");
      return;
    }

    showBadge("⏳", "#7c5cfc");
    await processFormStep(
      tab.id,
      userData,
      0,
      getHostname(tab.url || ""),
      stored.resumeFileData as string | undefined,
      stored.resumeFileName as string | undefined,
    );
  } catch (error: any) {
    console.error("Aullevo shortcut error:", error);
    showBadge("✗", "#f87171");
    setTimeout(clearBadge, 3000);
  }
}

async function processFormStep(
  tabId: number,
  userData: Partial<UserData>,
  step: number,
  hostname: string,
  resumeFileData?: string,
  resumeFileName?: string,
) {
  if (step > 10) {
    showBadge("✓", "#34d399");
    setTimeout(clearBadge, 4000);
    return;
  }

  try {
    const response = await sendToTab(tabId, { action: "analyzeForm" });
    if (!response?.success) {
      showBadge("✗", "#f87171");
      setTimeout(clearBadge, 3000);
      return;
    }

    const fields: FormField[] = response.fields || [];
    let needsReAnalysis = false;

    if (fields.length > 0) {
      const storedMode = await chrome.storage.local.get(["matchingMode"]);
      const matchingMode = (storedMode.matchingMode || "heuristic") as string;
      const useAI = matchingMode === "ai";
      const customFields = migrateCustomFields(userData.customFields);
      let fieldMappings: any[] | null = null;

      if (useAI) {
        const signature = buildFieldSignature(fields);
        fieldMappings = getCachedMappings(hostname, signature);
        if (!fieldMappings) {
          fieldMappings = await geminiService.analyzeFormFields(
            fields,
            customFields,
          );
          if (hostname && fieldMappings?.length)
            setCachedMappings(hostname, signature, fieldMappings);
        }
      } else {
        fieldMappings = matchFieldsHeuristically(fields, customFields);
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
      );

      const fillMappings = fieldMappings.filter(
        (m: any) => m.action !== "click_add",
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

      const filledCount = fillResponse?.filledCount ?? 0;
      if (fillResponse?.success) showBadge(`${filledCount}`, "#34d399");

      if (filledCount === 0 && !needsReAnalysis) {
        showBadge("✓", "#34d399");
        setTimeout(clearBadge, 4000);
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
    }

    if (needsReAnalysis) {
      await sleep(500);
      await processFormStep(tabId, userData, step + 1, hostname);
      return;
    }

    await sleep(1000);
    const nextResponse = await sendToTab(tabId, { action: "clickNext" });
    if (nextResponse?.success) {
      invalidateCache(hostname);
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
    }
  } catch (error: any) {
    console.error("Aullevo fill step error:", error);
    showBadge("✗", "#f87171");
    setTimeout(clearBadge, 3000);
  }
}

/* ─── Utilities ─── */

function sendToTab(tabId: number, message: any): Promise<ChromeResponse> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        resolve({ success: false, message: chrome.runtime.lastError.message });
      } else {
        resolve(response);
      }
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function showBadge(text: string, color: string) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
}

console.log("🚗 Aullevo background service worker loaded!");
