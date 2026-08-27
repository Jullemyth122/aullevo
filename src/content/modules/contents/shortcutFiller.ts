import { showToast } from "./toastSystem";
import {
  extractFormFields,
  computeStepFingerprint,
  executeFormFillStep,
  shouldAddNextGroupItem,
  clickNextButtonAsync,
  clickElement,
  detectPageCaptcha,
  findChatInputField,
  extractChatContext,
  fillChatInputField,
  submitChatField,
} from "../../../services/formAnalyzer";
import type { FieldMapping, UserData } from "../../../types";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface ChatAIResponse {
  success?: boolean;
  error?: string;
  replyText?: string;
}

interface FieldAIResponse {
  success?: boolean;
  error?: string;
  mappings?: FieldMapping[];
  addButtons?: FieldMapping[];
  userData?: Partial<UserData>;
}

type BackgroundResponse = ChatAIResponse | FieldAIResponse | { success?: boolean; error?: string };

function sendToBackground<T extends BackgroundResponse = BackgroundResponse>(message: unknown): Promise<T> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.warn(
          "Aullevo content→background notice:",
          chrome.runtime.lastError.message,
        );
        resolve({ success: false, error: chrome.runtime.lastError.message } as T);
      } else {
        resolve(response as T);
      }
    });
  });
}

export async function extractAllFields(): Promise<{
  fields: import("../../../types").FormField[];
  hasCaptcha: boolean;
  captchaTypes: string[];
}> {
  const mainFields = extractFormFields();
  const captchaResult = detectPageCaptcha();

  return {
    fields: mainFields,
    hasCaptcha: captchaResult.found,
    captchaTypes: captchaResult.types,
  };
}

export async function runShortcutFill() {
  // 1. First, check if the user is focused inside a Chat or contenteditable field
  const chatInput = findChatInputField();

  if (chatInput) {
    showToast("💬 Chat window detected. Gathering context...", "info", 3000);

    // Extract recent messages from the DOM
    const conversationHistory = extractChatContext(chatInput);

    showToast("✨ Constructing RAG response via Gemini...", "info", 3000);

    // Let the background script handle storage and Gemini
    const aiResponse = await sendToBackground<ChatAIResponse>({
      action: "processChatAI",
      conversationHistory,
    });

    if (aiResponse?.success && aiResponse.replyText) {
      const isError =
        aiResponse.replyText.includes("[Error") ||
        aiResponse.replyText.includes("I'm sorry");
      const injectionSuccess = fillChatInputField(
        chatInput,
        aiResponse.replyText,
      );

      if (injectionSuccess) {
        showToast("✅ Response loaded into chat box!", "success");

        if (!isError) {
          const storage = await chrome.storage.local.get("autoSubmit");
          if (storage.autoSubmit) {
            setTimeout(() => submitChatField(chatInput), 300);
          }
        }
      } else {
        showToast("⚠️ Response generated, but DOM injection failed.", "error");
      }
    } else {
      const errorMsg =
        aiResponse?.error ||
        "Gemini could not generate a reply from your data.";
      showToast(`❌ ${errorMsg}`, "error");
    }

    return; // Stop here so traditional form filling doesn't run concurrently
  }

  // 2. Fallback to original form processing system if no chat interface is active
  showToast("🚗 Aullevo: Starting AI Fill...", "info", 3000);

  let totalFilled = 0;
  const fingerprintHistory: string[] = [];
  const maxSteps = 30;

  for (let step = 0; step < maxSteps; step++) {
    // Collect fields from main frame
    const { fields, hasCaptcha, captchaTypes } = await extractAllFields();

    // CAPTCHA warning
    if (hasCaptcha) {
      showToast(
        `🔒 CAPTCHA detected (${captchaTypes.join(", ")}) — fill the CAPTCHA manually, then press Alt+F again`,
        "error",
        8000,
      );
      return; // Stop — user must solve CAPTCHA first
    }

    if (fields.length === 0) {
      if (step === 0)
        showToast("❌ No form fields found on this page", "error");
      break;
    }

    showToast(
      `🤖 Analyzing ${fields.length} field${fields.length !== 1 ? "s" : ""}...`,
      "info",
      8000,
    );

    // Pass current tab URL so background can key the cache correctly
    const aiResponse = await sendToBackground<FieldAIResponse>({
      action: "processFieldsAI",
      fields,
      tabUrl: location.href,
    });

    if (!aiResponse?.success) {
      const errorMsg = aiResponse?.error || "Unknown error";
      showToast(`❌ ${errorMsg}`, "error");
      return;
    }

    const mappings: FieldMapping[] = aiResponse.mappings || [];
    const addButtons: FieldMapping[] = aiResponse.addButtons || [];
    const userData: Partial<UserData> = aiResponse.userData || {};

    if (mappings.length === 0) {
      showToast(
        "⚠️ AI could not match any fields. Check your saved data.",
        "error",
      );
      return;
    }

    // Loop safety / Fingerprint check
    const currentFingerprint = computeStepFingerprint(mappings);
    if (fingerprintHistory.includes(currentFingerprint)) {
      showToast(
        "⚠️ Stuck step detected (same values in same fields). Stopping.",
        "error",
        6000,
      );
      break;
    }
    fingerprintHistory.push(currentFingerprint);

    // Fill fields using the pipeline executor
    const { filledCount } = await executeFormFillStep(mappings);
    totalFilled += filledCount;

    if (filledCount === 0) {
      showToast(
        `✅ Done! Total: ${totalFilled} field${totalFilled !== 1 ? "s" : ""} filled.`,
        "success",
      );
      return;
    }

    showToast(
      `✅ Filled ${filledCount} field${filledCount !== 1 ? "s" : ""}`,
      "success",
    );

    // Handle Add buttons
    let needsReAnalysis = false;
    for (const addMapping of addButtons) {
      const { shouldAdd, groupType, buttonId } = shouldAddNextGroupItem(
        addMapping,
        mappings,
        userData
      );

      if (shouldAdd && buttonId) {
        showToast(`➕ Adding another ${groupType}...`, "info");
        clickElement(buttonId);
        await sleep(1500);
        needsReAnalysis = true;
        break;
      }
    }

    if (needsReAnalysis) {
      await sleep(500);
      continue;
    }

    // Try clicking Next
    if (filledCount > 0) {
      await sleep(1000);
      const nextResult = await clickNextButtonAsync();
      if (nextResult.success && nextResult.navigated) {
        showToast("➡️ Moving to next step...", "info");
        await sleep(1500);
        continue;
      } else if (nextResult.reason === "validation_error") {
        showToast(
          "⚠️ Form has validation errors. Please review highlighted fields.",
          "error",
        );
        break;
      }
    }

    break;
  }

  showToast(
    `✅ Complete! Filled ${totalFilled} field${totalFilled !== 1 ? "s" : ""} total.`,
    "success",
  );
}

let isRunning = false;

export function initShortcutFiller() {
  document.addEventListener(
    "keydown",
    (e) => {
      const isCtrlShiftF =
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "f" || e.key === "F");
      const isAltF = e.altKey && (e.key === "f" || e.key === "F");
      const isAltShiftF =
        e.altKey && e.shiftKey && (e.key === "f" || e.key === "F");

      if (isCtrlShiftF || isAltF || isAltShiftF) {
        e.preventDefault();
        e.stopPropagation();

        if (isRunning) {
          showToast("⏳ Already running, please wait...", "info");
          return;
        }

        isRunning = true;
        runShortcutFill()
          .catch((err) => {
            console.error("Aullevo shortcut error:", err);
            showToast(`❌ Error: ${err.message}`, "error");
          })
          .finally(() => {
            isRunning = false;
          });
      }
    },
    true,
  );
}
