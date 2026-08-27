/**
 * Reusable helper functions shared across all background modules.
 */

import { storageService } from "../../services/storageService";
import type {
  UserData,
  ChromeResponse,
  FormField,
} from "../../types";

export { migrateCustomFields } from "../../utils/customFields";

/**
 * Loads the currently active user profile with multi-profile and local storage fallback.
 */
export async function getActiveUserData(): Promise<Partial<UserData>> {
  try {
    const activeData = await storageService.loadActiveProfile();
    if (activeData && Object.keys(activeData).length > 0) {
      if (typeof chrome !== "undefined" && chrome.storage) {
        chrome.storage.local.set({ userData: activeData });
      }
      return activeData;
    }
  } catch (e) {
    console.warn(
      "Aullevo: storageService load failed, falling back to local storage:",
      e,
    );
  }
  const stored = await chrome.storage.local.get(["userData"]);
  return (stored.userData || {}) as Partial<UserData>;
}

/**
 * Throttles Gemini API requests to ensure a minimum 500 ms gap between calls.
 */
let lastApiCallTime = 0;
export function checkRateLimit(): boolean {
  const now = Date.now();
  if (now - lastApiCallTime < 500) return false;
  lastApiCallTime = now;
  return true;
}

/**
 * Creates a deterministic string fingerprint representing the current page form fields.
 */
export function buildFieldSignature(fields: FormField[]): string {
  return fields
    .map((f) => `${f.id}|${f.label}|${f.type}`)
    .join(",")
    .slice(0, 500);
}

/**
 * Safely extracts hostname from a full URL.
 */
export function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Sends a message to a specific tab and returns the response as a Promise.
 */
export function sendToTab(
  tabId: number,
  message: unknown,
  options?: chrome.tabs.MessageSendOptions,
): Promise<ChromeResponse> {
  return new Promise((resolve) => {
    const sendOptions: chrome.tabs.MessageSendOptions = options ?? { frameId: 0 };
    chrome.tabs.sendMessage(tabId, message, sendOptions, (response) => {
      if (chrome.runtime.lastError) {
        const errMsg =
          chrome.runtime.lastError.message || "Tab communication notice";
        console.warn("Aullevo sendToTab notice:", errMsg);
        resolve({ success: false, message: errMsg });
      } else {
        resolve(response || { success: true });
      }
    });
  });
}

/**
 * Pauses execution for a specified duration in milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Sets a short text badge and background color on the extension action icon.
 */
export function showBadge(text: string, color: string): void {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

/**
 * Clears the extension action icon badge text.
 */
export function clearBadge(): void {
  chrome.action.setBadgeText({ text: "" });
}

/**
 * Sends status updates to the sidebar content script running in the active tab.
 */
export function sendSidebarStatus(
  tabId: number,
  message: string,
  statusType: "idle" | "scanning" | "filling" | "success" | "error" | "info",
): void {
  sendToTab(tabId, { action: "sidebarStatus", message, statusType }).catch(
    () => {},
  );
}
