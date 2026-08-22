/**
 * @file backgroundUtils.ts
 * @module background/modules
 *
 * ─── ROLE IN THE ARCHITECTURE ───────────────────────────────────────────────
 * Pure utility functions shared across ALL background modules.
 * No business logic lives here — this file only provides reusable helpers.
 *
 * WHO IMPORTS THIS FILE:
 *   • formStepProcessor.ts  — uses every export here
 *   • background.ts         — uses getHostname, showBadge, clearBadge, sendSidebarStatus
 *
 * DEPENDENCY DIRECTION:
 *   background.ts
 *     └── formStepProcessor.ts
 *           └── backgroundUtils.ts   ← YOU ARE HERE
 *                 └── storageService  (reads active user profile)
 * ────────────────────────────────────────────────────────────────────────────
 */

import { storageService } from "../../services/storageService";
import type {
  UserData,
  CustomField,
  ChromeResponse,
  FormField,
} from "../../types";

// ─────────────────────────────────────────────────────────────
// USER DATA
// ─────────────────────────────────────────────────────────────

/**
 * getActiveUserData
 * ─────────────────
 * Loads the currently active user profile so the fill engine has
 * data (name, email, experience, etc.) to put into form fields.
 *
 * Strategy (waterfall):
 *   1. Try storageService.loadActiveProfile() — multi-profile aware.
 *   2. If that fails or returns empty → fall back to chrome.storage.local "userData".
 *
 * CALLED BY:
 *   • formStepProcessor.ts → processFieldsAI(), runAIFill(), processFormStep()
 *   • background.ts        → triggerFillFromSidebar handler, processChatAI handler
 *
 * @returns Partial<UserData> — may be partial if user hasn't fully set up a profile.
 */
export async function getActiveUserData(): Promise<Partial<UserData>> {
  try {
    const activeData = await storageService.loadActiveProfile();
    if (activeData && Object.keys(activeData).length > 0) {
      if (typeof chrome !== "undefined" && chrome.storage) {
        // Mirror the active profile to local storage so other parts
        // of the extension can read it quickly without awaiting.
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
  // Fallback: direct read from chrome.storage.local
  const stored = await chrome.storage.local.get(["userData"]);
  return (stored.userData || {}) as Partial<UserData>;
}

// ─────────────────────────────────────────────────────────────
// RATE LIMITING
// ─────────────────────────────────────────────────────────────

/** Timestamp of the last successful Gemini API call. Used to throttle requests. */
let lastApiCallTime = 0;

/**
 * checkRateLimit
 * ──────────────
 * Prevents the extension from hammering the Gemini API too fast.
 * Enforces a minimum 500 ms gap between calls.
 *
 * CALLED BY: formStepProcessor.ts → processFieldsAI() (AI mode only)
 *
 * @returns true  if enough time has passed (call is allowed)
 * @returns false if the gap is too small (caller should show "wait" error)
 */
export function checkRateLimit(): boolean {
  const now = Date.now();
  if (now - lastApiCallTime < 500) return false;
  lastApiCallTime = now;
  return true;
}

// ─────────────────────────────────────────────────────────────
// FIELD SIGNATURE
// ─────────────────────────────────────────────────────────────

/**
 * buildFieldSignature
 * ───────────────────
 * Creates a short string fingerprint that uniquely represents the
 * set of form fields currently on the page (id + label + type).
 *
 * PURPOSE: Used as a cache key inside domainCache.ts so that if the
 *          user revisits the same page with the same fields, AI results
 *          are served from cache instead of calling Gemini again.
 *
 * CALLED BY: formStepProcessor.ts → processFieldsAI(), processFormStep()
 *
 * @param fields - The FormField array detected on the page.
 * @returns A comma-joined string, max 500 chars, like "id1|Label 1|text,id2|Label 2|select"
 */
export function buildFieldSignature(fields: FormField[]): string {
  return fields
    .map((f) => `${f.id}|${f.label}|${f.type}`)
    .join(",")
    .slice(0, 500);
}

// ─────────────────────────────────────────────────────────────
// URL UTILITIES
// ─────────────────────────────────────────────────────────────

/**
 * getHostname
 * ───────────
 * Safely extracts the hostname (e.g. "jobs.lever.co") from a full URL.
 * Falls back to returning the raw string if the URL is malformed.
 *
 * PURPOSE: The domain cache (domainCache.ts) is keyed by hostname.
 *          The autopilot session also tracks hostname to detect navigation
 *          away from the original job site.
 *
 * CALLED BY:
 *   • background.ts        → triggerFillFromSidebar, onUpdated, openAutopilotLink
 *   • formStepProcessor.ts → runAIFill(), processFormStep()
 *
 * @param url - Full URL string (e.g. "https://jobs.lever.co/apply/123")
 * @returns Hostname string (e.g. "jobs.lever.co")
 */
export function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ─────────────────────────────────────────────────────────────
// DATA MIGRATION
// ─────────────────────────────────────────────────────────────

/**
 * migrateCustomFields
 * ───────────────────
 * Normalises the customFields value coming out of storage into a
 * consistent CustomField[] array shape.
 *
 * WHY THIS EXISTS: Older versions of the extension stored customFields
 * as a plain object { label: value }. Newer versions use an array
 * [ { label, value, context } ]. This function bridges the two formats
 * so the rest of the code never has to worry about which format it has.
 *
 * CALLED BY: formStepProcessor.ts → processFieldsAI(), processFormStep()
 *
 * @param raw - Whatever came out of storage (could be array or object).
 * @returns Always returns CustomField[].
 */
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

// ─────────────────────────────────────────────────────────────
// TAB MESSAGING
// ─────────────────────────────────────────────────────────────

/**
 * sendToTab
 * ─────────
 * Wraps chrome.tabs.sendMessage in a Promise so callers can use
 * async/await cleanly.  Swallows Chrome's "no receiving end" errors
 * (which happen when the content script isn't injected yet) by
 * resolving with { success: false } instead of throwing.
 *
 * THIS IS THE ONLY WAY the background script talks to the page.
 * Every "fill form", "analyze form", "click next" instruction flows
 * through this function.
 *
 * CALLED BY: formStepProcessor.ts → processFormStep() (multiple times)
 *            backgroundUtils.ts   → sendSidebarStatus()
 *
 * @param tabId   - The Chrome tab to message.
 * @param message - Any serialisable object (action + payload).
 * @returns ChromeResponse — the content script's reply.
 */
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

// ─────────────────────────────────────────────────────────────
// TIMING
// ─────────────────────────────────────────────────────────────

/**
 * sleep
 * ─────
 * Simple promise-based delay helper.
 * Used between autopilot steps to give the page time to render
 * new form sections before the next scan.
 *
 * CALLED BY: formStepProcessor.ts → processFormStep()
 *
 * @param ms - Milliseconds to wait.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────
// EXTENSION BADGE UI
// ─────────────────────────────────────────────────────────────

/**
 * showBadge
 * ─────────
 * Displays a short text badge on the extension icon (e.g. "⏳", "✓", "3").
 * Gives the user visual feedback without opening a popup.
 *
 * CALLED BY:
 *   • background.ts        → triggerFillFromSidebar, onUpdated (autopilot)
 *   • formStepProcessor.ts → processFormStep(), runAIFill() (various states)
 *
 * @param text  - Badge label (keep short, 1-2 chars/emoji).
 * @param color - Background colour hex string (e.g. "#34d399" for green).
 */
export function showBadge(text: string, color: string) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

/**
 * clearBadge
 * ──────────
 * Removes the badge from the extension icon (resets to no badge).
 * Typically called after a short delay so the user can read the final state.
 *
 * CALLED BY:
 *   • background.ts        → triggerFillFromSidebar error, onUpdated
 *   • formStepProcessor.ts → processFormStep() (after success/error)
 */
export function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
}

// ─────────────────────────────────────────────────────────────
// SIDEBAR COMMUNICATION
// ─────────────────────────────────────────────────────────────

/**
 * sendSidebarStatus
 * ─────────────────
 * Sends a human-readable status message to the sidebar UI running
 * inside the content script on the active page.
 *
 * The sidebar listens for { action: "sidebarStatus" } messages and
 * updates its status indicator accordingly (e.g. spinning loader,
 * green check, red error icon).
 *
 * This is "fire and forget" — errors are silently ignored because
 * the sidebar may not always be open.
 *
 * CALLED BY: formStepProcessor.ts → processFormStep() (throughout the fill flow)
 *            background.ts        → triggerFillFromSidebar error path
 *
 * @param tabId      - The tab where the sidebar is open.
 * @param message    - Human-readable status text to display.
 * @param statusType - One of the sidebar's status icon types.
 */
export function sendSidebarStatus(
  tabId: number,
  message: string,
  statusType: "idle" | "scanning" | "filling" | "success" | "error" | "info",
) {
  sendToTab(tabId, { action: "sidebarStatus", message, statusType }).catch(
    () => {},
  );
}
