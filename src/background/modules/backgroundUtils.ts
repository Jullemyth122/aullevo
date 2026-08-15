import { storageService } from "../../services/storageService";
import type {
  UserData,
  CustomField,
  ChromeResponse,
  FormField,
} from "../../types";

/**
 * Helper to fetch the active user data reliably from storageService or local storage fallback.
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

// ─── Rate limiter: minimum 500ms between Gemini API calls ───
let lastApiCallTime = 0;
export function checkRateLimit(): boolean {
  const now = Date.now();
  if (now - lastApiCallTime < 500) return false;
  lastApiCallTime = now;
  return true;
}

export function buildFieldSignature(fields: FormField[]): string {
  return fields
    .map((f) => `${f.id}|${f.label}|${f.type}`)
    .join(",")
    .slice(0, 500);
}

export function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function migrateCustomFields(raw: any): CustomField[] {
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

export function sendToTab(
  tabId: number,
  message: any,
): Promise<ChromeResponse> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
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

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function showBadge(text: string, color: string) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

export function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
}

export function sendSidebarStatus(
  tabId: number,
  message: string,
  statusType: "idle" | "scanning" | "filling" | "success" | "error" | "info",
) {
  sendToTab(tabId, { action: "sidebarStatus", message, statusType }).catch(
    () => {},
  );
}
