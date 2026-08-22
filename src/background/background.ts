/**
 * @file background.ts
 * @module background
 *
 * ─── ROLE IN THE ARCHITECTURE
 * The Chrome Extension SERVICE WORKER — the top-level event hub that boots
 * when the extension loads and never unloads until the browser closes.
 *
 * This file is the ENTRY POINT for everything in the background.
 * It does NOT contain business logic — it only:
 *   • Listens for browser/Chrome events (commands, messages, tab updates, storage)
 *   • Validates/pre-processes incoming data
 *   • Delegates to the modules in ./modules/
 *
 * ─── MESSAGE FLOW OVERVIEW
 *
 *  User / UI            background.ts           Module
 *
 *  Ctrl+M shortcut  →   onCommand("toggle-sidebar") → sendMessage("toggleSidebar")
 *  Extension icon   →   action.onClicked           → sendMessage("toggleSidebar")
 *  Options page btn →   "openOptionsPage"           → chrome.runtime.openOptionsPage()
 *  Web page login   →   "SYNC_WEB_USER"             → Firestore uid/email lookup
 *  Popup Fill btn   →   "triggerFillFromPopup"      → runAIFill()
 *  Sidebar Fill btn →   "triggerFillFromSidebar"    → processFormStep()
 *  Content script   →   "processFieldsAI"           → processFieldsAI()
 *  Sidebar chat     →   "processChatAI"             → geminiService.generateChatReply()
 *  Autopilot link   →   "openAutopilotLink"         → chrome.tabs.create()
 *
 *  Tab navigation   →   tabs.onUpdated              → processFormStep() (autopilot)
 *  Storage change   →   storage.onChanged           → domainCache.clear()
 *
 * ─── DEPENDENCY DIRECTION
 *   background.ts  ← YOU ARE HERE (top of the tree)
 *     ├── geminiService         (direct: only for processChatAI)
 *     ├── backgroundUtils       (getActiveUserData, getHostname, badge, status)
 *     ├── domainCache           (domainCache.clear() on config change)
 *     └── formStepProcessor     (processFieldsAI, runAIFill, processFormStep)
 *           └── (see formStepProcessor.ts for its own deps)
 *
 */

import { geminiService } from "../services/geminiService";
import {
  getActiveUserData,
  getHostname,
  showBadge,
  clearBadge,
  sendSidebarStatus,
} from "./modules/backgroundUtils";
import { domainCache } from "./modules/domainCache";
import {
  processFieldsAI,
  runAIFill,
  processFormStep,
} from "./modules/formStepProcessor";

/**
 * Background service worker for Aullevo.
 * Ctrl+M (toggle-sidebar command) → toggles the sidebar via content script.
 * Alt+F (via content script keydown) → triggers AI form fill directly.
 */

/* 
   COMMANDS & MESSAGE HANDLING
*/

// KEYBOARD SHORTCUT: Ctrl+M  →  Toggle Sidebar

/**
 * Keyboard shortcut listener.
 * "toggle-sidebar" is defined in manifest.json under "commands".
 *
 * Finds the active tab and tells the content script to toggle the sidebar panel.
 * The content script handles the actual DOM show/hide animation.
 */
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

// EXTENSION ICON CLICK  →  Toggle Sidebar

/**
 * Clicking the extension toolbar icon does the same thing as Ctrl+M:
 * sends a "toggleSidebar" message to the current page's content script.
 *
 * Falls back with a warning if the content script hasn't loaded yet
 * (e.g. on chrome:// pages or freshly opened tabs).
 */
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { action: "toggleSidebar" }).catch(() => {
    console.warn("Aullevo: Content script not loaded yet — refresh the page.");
  });
});

// MAIN MESSAGE ROUTER

/**
 * Central message handler. All chrome.runtime.sendMessage() calls from
 * popup, options page, sidebar, and content scripts arrive here.
 *
 * Each `if (request.action === "...")` block handles one specific action.
 * Blocks that need async work return `true` to keep the message channel open
 * until sendResponse() is called.
 */
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  // ── openOptionsPage ─────────────────────────────────────────
  // Opens the extension's settings page. Sent by the popup when the user
  // clicks the "Settings" icon. Uses openOptionsPage() API with a fallback
  // to creating a new tab manually for older Chrome versions.
  if (request.action === "openOptionsPage") {
    if (typeof chrome !== "undefined" && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage().catch(() => {
        chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
      });
    } else if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
    }
    sendResponse({ success: true });
    return true;
  }

  // ── SYNC_WEB_USER ───────────────────────────────────────────
  // Fired by the web app (aullevo.com) when the user logs in or updates
  // their subscription status. Syncs Firebase Firestore user data into
  // chrome.storage.local so the extension always knows if the user is Pro.
  //
  // Flow:
  //   1. Try to load by UID from Firestore "users" collection.
  //   2. If not Pro and email is known, search by email as a fallback.
  //   3. Persist { isPro, userUid, userEmail, displayName, photoURL } locally.
  //
  // The double-lookup (uid → email) handles cases where the uid wasn't
  // stored locally yet but the email was.
  if (request.action === "SYNC_WEB_USER" && (request.uid || request.email)) {
    (async () => {
      try {
        const { doc, getDoc, collection, query, where, getDocs } =
          await import("firebase/firestore");
        const { db } = await import("../config/firebase");

        // Preserve existing local storage values if not explicitly provided in request
        const currentLocal = await chrome.storage.local.get([
          "isPro",
          "userUid",
          "userEmail",
          "displayName",
          "photoURL",
        ]);
        let isPro =
          request.isPro !== undefined
            ? !!request.isPro
            : currentLocal.isPro || false;
        let uid = request.uid || currentLocal.userUid;
        let email = request.email || currentLocal.userEmail || "";
        let displayName = request.displayName || currentLocal.displayName || "";
        let photoURL = request.photoURL || currentLocal.photoURL || "";

        // Attempt Firestore verification
        if (uid) {
          try {
            const userRef = doc(db, "users", uid);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
              const data = userSnap.data();
              isPro = !!data.isPro;
              if (!email) email = data.email || "";
              if (!displayName) displayName = data.displayName || "";
              if (!photoURL) photoURL = data.photoURL || "";
            }
          } catch (err) {
            console.warn(
              "Aullevo: getDoc by uid failed (using existing value, isPro=" +
                isPro +
                ")",
              err,
            );
          }
        }

        // Secondary lookup by email if UID lookup didn't set isPro
        if (!isPro && email) {
          try {
            const q = query(
              collection(db, "users"),
              where("email", "==", email),
            );
            const querySnap = await getDocs(q);
            querySnap.forEach((docSnap) => {
              const data = docSnap.data();
              if (data.isPro) {
                isPro = true;
                if (!uid) uid = docSnap.id;
                if (!displayName) displayName = data.displayName || "";
                if (!photoURL) photoURL = data.photoURL || "";
              }
            });
          } catch (err) {
            console.warn(
              "Aullevo: query by email failed (using existing value, isPro=" +
                isPro +
                ")",
              err,
            );
          }
        }

        // Persist the final verified values to local storage
        await chrome.storage.local.set({
          isPro,
          userUid: uid || null,
          userEmail: email,
          displayName,
          photoURL,
        });
        sendResponse({ success: true, isPro });
      } catch (e) {
        console.warn("Aullevo: SYNC_WEB_USER outer error", e);
        sendResponse({ success: false });
      }
    })();
    return true; // Keep message channel open for async response
  }

  // ── triggerFillFromPopup ────────────────────────────────────
  // Fired when the user clicks the "Fill Form" button in the popup.
  // Also triggered by the Ctrl+M keyboard shortcut in some configurations.
  //
  // Delegates entirely to runAIFill() which sets up the autopilot session
  // and starts the processFormStep() loop.
  if (request.action === "triggerFillFromPopup") {
    runAIFill().then(() => sendResponse({ success: true }));
    return true;
  }

  // ── triggerFillFromSidebar ──────────────────────────────────
  // Fired when the user clicks "Fill" inside the sidebar panel.
  // Similar to triggerFillFromPopup but:
  //   • Reads the active tab from within the handler (sidebar has its own tabId).
  //   • Sends sendResponse({ success: true }) immediately (fire and forget)
  //     so the sidebar UI can update right away.
  //   • processFormStep() runs asynchronously and updates the sidebar via
  //     sendSidebarStatus() messages throughout the fill process.
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

        const stored = await chrome.storage.local.get([
          "resumeFileData",
          "resumeFileName",
          "autoSubmit",
        ]);
        const userData = await getActiveUserData();
        const autoSubmit = !!stored.autoSubmit;

        // Initialise or clear the autopilot session before starting
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

        showBadge("⏳", "#3B82F6"); // Blue hourglass = working

        // Kick off recursive processFormStep asynchronously so callback completes immediately
        // The sidebar will receive status updates via sendSidebarStatus() as filling progresses.
        processFormStep(
          tabId,
          userData,
          0,
          tabHostname,
          stored.resumeFileData as string | undefined,
          stored.resumeFileName as string | undefined,
        ).catch((err) => {
          console.error("Sidebar initiated fill failed:", err);
          sendSidebarStatus(tabId, err.message || "Filling failed", "error");
        });

        sendResponse({ success: true }); // Immediately ACK the sidebar
      } catch (err: any) {
        showBadge("✗", "#f87171");
        setTimeout(clearBadge, 3000);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── processFieldsAI ─────────────────────────────────────────
  // Fired by the content script when it has already collected FormField[]
  // and wants the background to match + resolve values.
  //
  // The content script is responsible for injecting the returned mappings
  // into the DOM — background.ts just returns data, no DOM interaction here.
  if (request.action === "processFieldsAI") {
    const hostname = getHostname(request.tabUrl || "");
    processFieldsAI(request.fields, hostname)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // ── processChatAI ───────────────────────────────────────────
  // Fired by the sidebar chat panel when the user sends a message.
  // Uses geminiService.generateChatReply() to produce an AI response
  // given the full conversation history and the user's profile data.
  //
  // This is the only place geminiService is used directly in background.ts;
  // all form-related AI calls go through formStepProcessor.ts instead.
  if (request.action === "processChatAI") {
    (async () => {
      try {
        const stored = await chrome.storage.local.get(["geminiApiKey"]);
        const userData = await getActiveUserData();
        const apiKey = ((stored.geminiApiKey || "") as string).trim();

        if (!apiKey) {
          sendResponse({
            success: false,
            error:
              "No API key found. Save your Gemini API key in the extension settings.",
          });
          return;
        }

        geminiService.setApiKey(apiKey);
        const replyText = await geminiService.generateChatReply(
          request.conversationHistory || [],
          userData,
        );

        sendResponse({ success: true, replyText });
      } catch (err: any) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── urlChanged ──────────────────────────────────────────────
  // Notification from the content script that the URL changed (SPA navigation).
  // Currently just ACKs. Could be used to trigger re-analysis in the future.
  if (request.action === "urlChanged") {
    sendResponse({ success: true });
    return false; // Synchronous response, no need to keep channel open
  }

  // ── domChanged ──────────────────────────────────────────────
  // Notification from the content script that the DOM changed significantly.
  // Currently just ACKs. Could be used to re-trigger scanning in the future.
  if (request.action === "domChanged") {
    sendResponse({ success: true });
    return false;
  }

  // ── openAutopilotLink ───────────────────────────────────────
  // Opens a new tab at the given URL and initialises an autopilot session
  // for it. Used when the AI suggests applying to a job at an external link.
  // The tab's onUpdated event will pick up the session and start filling.
  if (request.action === "openAutopilotLink") {
    chrome.tabs.create({ url: request.url }, (tab) => {
      if (tab.id) {
        chrome.storage.local.set({
          autopilotSession: {
            // tabId: tab.id,
            step: 0,
            hostname: getHostname(request.url || ""),
          },
        });
      }
    });
    sendResponse({ success: true });
    return false;
  }
});

// TAB NAVIGATION LISTENER  (Autopilot continuation)

/**
 * Fires whenever a tab finishes loading (changeInfo.status === "complete").
 *
 * PURPOSE: Autopilot multi-page support.
 * When processFormStep() clicks "Next" and the page navigates away,
 * the background script can't await the new page load.  Instead, this
 * listener detects when the SAME tab finishes loading and resumes the
 * autopilot session from where it left off.
 *
 * Safety checks:
 *   • Is there an active autopilot session for this specific tab? (session.tabId === tabId)
 *   • Has the user navigated AWAY from the original hostname?
 *     If yes → cancel autopilot (they left the job site).
 *   • Has the step counter exceeded 30? → stop to avoid infinite loops.
 *
 * A 2-second delay (setTimeout) is applied before resuming to let the new
 * page's content script fully initialise before "analyzeForm" is sent.
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    chrome.storage.local.get(["autopilotSession"], (result) => {
      const session = result.autopilotSession as any;
      if (session && session.tabId === tabId) {
        const currentHostname = getHostname(tab.url || "");

        // If the user navigated to a different domain, cancel autopilot
        if (session.hostname && currentHostname !== session.hostname) {
          chrome.storage.local.remove(["autopilotSession"]);
          clearBadge();
          return;
        }

        console.log(
          `Aullevo Autopilot: Tab loaded, resuming auto-fill step ${session.step}...`,
        );
        showBadge("⏳", "#3B82F6");

        // Delay 2 s to let the new page's content script inject and initialise
        setTimeout(async () => {
          try {
            const stored = await chrome.storage.local.get([
              "resumeFileData",
              "resumeFileName",
            ]);
            const userData = await getActiveUserData();

            const nextStep = session.step + 1;
            if (nextStep > 30) {
              // Hard cap: stop if we've been through 30+ steps
              chrome.storage.local.remove(["autopilotSession"]);
              showBadge("✓", "#34d399");
              setTimeout(clearBadge, 4000);
              return;
            }

            // Increment the step counter in storage so the next navigation
            // starts at the right step if the page loads again.
            await chrome.storage.local.set({
              autopilotSession: { ...session, step: nextStep },
            });

            // Resume the fill loop for the new page
            await processFormStep(
              tabId,
              userData,
              session.step,
              currentHostname,
              stored.resumeFileData as string | undefined,
              stored.resumeFileName as string | undefined,
            );
          } catch (error) {
            console.error("Autopilot fill error:", error);
            showBadge("✗", "#f87171");
            setTimeout(clearBadge, 3000);
            chrome.storage.local.remove(["autopilotSession"]);
          }
        }, 2000); // 2 s grace period for new page to load
      }
    });
  }
});

// STORAGE CHANGE LISTENER  (Cache invalidation)

/**
 * Clears the entire domain cache whenever the user changes settings that
 * would affect how fields are mapped:
 *
 *   • userData       — profile changed → different values to fill
 *   • matchingMode   — switched AI ↔ heuristic → different mapping results
 *   • geminiApiKey   — API key changed → need to re-authenticate with Gemini
 *
 * Without this, a cached AI result from the old profile/mode would be used
 * on the next fill, causing incorrect data to be entered.
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local") {
    if (changes.userData || changes.matchingMode || changes.geminiApiKey) {
      domainCache.clear();
      console.log(
        "Aullevo: domainCache cleared due to configuration/profile change.",
      );
    }
  }
});

// Service worker successfully loaded
console.log("Aullevo background service worker loaded!");
