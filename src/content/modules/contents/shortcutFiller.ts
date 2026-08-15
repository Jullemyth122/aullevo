import { showToast } from "./toastSystem";
import {
  extractFormFields,
  fillFormField,
  clickNextButton,
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

function sendToBackground(message: any): Promise<any> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.warn(
          "Aullevo content→background notice:",
          chrome.runtime.lastError.message,
        );
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response);
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
    const aiResponse = await sendToBackground({
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
    const aiResponse = await sendToBackground({
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
    const currentFingerprint = JSON.stringify(
      mappings.map((m) => ({ id: m.id, value: m.selectedValue })),
    );
    if (fingerprintHistory.includes(currentFingerprint)) {
      showToast(
        "⚠️ Stuck step detected (same values in same fields). Stopping.",
        "error",
        6000,
      );
      break;
    }
    fingerprintHistory.push(currentFingerprint);

    // Fill fields
    let filledCount = 0;
    for (const mapping of mappings) {
      const value = mapping.selectedValue;
      if (value) {
        const success = await fillFormField(mapping, value);
        if (success) filledCount++;
      }
    }

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
      if (!addMapping.groupType || !addMapping.id) continue;

      const currentIndices = mappings
        .filter(
          (m) =>
            m.groupType === addMapping.groupType &&
            typeof m.groupIndex === "number",
        )
        .map((m) => m.groupIndex!);
      const maxIndex =
        currentIndices.length > 0 ? Math.max(...currentIndices) : -1;

      let totalDataItems = 0;
      if (addMapping.groupType === "experience")
        totalDataItems = ((userData as any).experience || []).length;
      if (addMapping.groupType === "education")
        totalDataItems = ((userData as any).education || []).length;

      if (totalDataItems > maxIndex + 1) {
        showToast(`➕ Adding another ${addMapping.groupType}...`, "info");
        clickElement(addMapping.id);
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
      const nextResult = clickNextButton();
      if (nextResult.success) {
        showToast("➡️ Moving to next step...", "info");
        await sleep(3000);
        continue;
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
  document.addEventListener("keydown", (e) => {
    if (e.altKey && (e.key === "f" || e.key === "F")) {
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
  });
}
