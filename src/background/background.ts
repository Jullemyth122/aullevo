/**
 * Background service worker for Aullevo.
 * Central event hub for Chrome commands, runtime message routing, and autopilot navigation.
 */

import { geminiService } from "../services/geminiService";
import { storageService } from "../services/storageService";
import type { UserData } from "../types";
import {
  getActiveUserData,
  getHostname,
  showBadge,
  clearBadge,
  sendSidebarStatus,
  sendToTab,
} from "./modules/backgroundUtils";
import { domainCache } from "./modules/domainCache";
import {
  processFieldsAI,
  runAIFill,
  processFormStep,
} from "./modules/formStepProcessor";

// Keyboard shortcut listener (Ctrl+M for sidebar toggle, trigger-ai-fill for auto fill)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-sidebar") {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      sendToTab(tab.id, { action: "toggleSidebar" }).catch((err: unknown) => {
        console.warn("Aullevo: Sidebar toggle failed", err);
      });
    }
  } else if (command === "trigger-ai-fill") {
    runAIFill().catch((err: unknown) => {
      console.warn("Aullevo: trigger-ai-fill failed", err);
    });
  }
});

// Extension toolbar icon click listener
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { action: "toggleSidebar" }).catch(() => {
    console.warn("Aullevo: Content script not loaded yet — refresh the page.");
  });
});

// Central message router
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  // Open options settings page
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

  // Synchronize authenticated web user from web app login
  if (request.action === "SYNC_WEB_USER" && (request.uid || request.email)) {
    (async () => {
      try {
        const { doc, getDoc, collection, query, where, getDocs } =
          await import("firebase/firestore");
        const { db } = await import("../config/firebase");

        const checkSubscriptionActive = (data: { isPro?: boolean; proExpiresAt?: string | number | Date } | null | undefined): boolean => {
          if (!data || !data.isPro) return false;
          if (data.proExpiresAt) {
            return new Date(data.proExpiresAt).getTime() > Date.now();
          }
          return false;
        };

        // Preserve existing local storage values if not explicitly provided in request
        const currentLocal = await chrome.storage.local.get([
          "isPro",
          "proExpiresAt",
          "userUid",
          "userEmail",
          "displayName",
          "photoURL",
        ]);
        let isPro =
          request.isPro !== undefined
            ? !!request.isPro
            : currentLocal.isPro || false;
        let proExpiresAt =
          request.proExpiresAt !== undefined
            ? request.proExpiresAt
            : currentLocal.proExpiresAt || null;
        let uid = request.uid || currentLocal.userUid;
        let email = request.email || currentLocal.userEmail || "";
        let displayName = request.displayName || currentLocal.displayName || "";
        let photoURL = request.photoURL || currentLocal.photoURL || "";

        // Attempt Firestore verification by UID
        if (uid) {
          try {
            const userRef = doc(db, "users", uid);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
              const data = userSnap.data();
              isPro = checkSubscriptionActive(data);
              proExpiresAt = data.proExpiresAt || null;
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
              if (checkSubscriptionActive(data)) {
                isPro = true;
                proExpiresAt = data.proExpiresAt || null;
              }
              if (!uid) uid = docSnap.id;
              if (!displayName && data.displayName) displayName = data.displayName;
              if (!photoURL && data.photoURL) photoURL = data.photoURL;
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

        // Check if proExpiresAt has passed
        if (proExpiresAt && new Date(proExpiresAt).getTime() <= Date.now()) {
          isPro = false;
        }

        const prevAccount = currentLocal.userUid || currentLocal.userEmail || "guest";
        const newAccount = uid || email || "guest";

        const hasChanged =
          isPro !== !!currentLocal.isPro ||
          proExpiresAt !== (currentLocal.proExpiresAt || null) ||
          (uid || null) !== (currentLocal.userUid || null) ||
          email !== (currentLocal.userEmail || "") ||
          displayName !== (currentLocal.displayName || "") ||
          photoURL !== (currentLocal.photoURL || "");

        if (hasChanged) {
          await chrome.storage.local.set({
            isPro,
            proExpiresAt,
            userUid: uid || null,
            userEmail: email,
            displayName,
            photoURL,
          });
        }

        if (prevAccount !== newAccount) {
          await storageService.switchAccount(newAccount);
        }

        sendResponse({ success: true, isPro, proExpiresAt });
      } catch (e) {
        console.warn("Aullevo: SYNC_WEB_USER outer error", e);
        sendResponse({ success: false });
      }
    })();
    return true;
  }

  // Trigger form filling from popup
  if (request.action === "triggerFillFromPopup") {
    runAIFill().then(() => sendResponse({ success: true }));
    return true;
  }

  // Trigger form filling from sidebar
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
        const userData = (request.data?.userData as UserData) || (await getActiveUserData());
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

        sendResponse({ success: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showBadge("✗", "#f87171");
        setTimeout(clearBadge, 3000);
        sendResponse({ success: false, error: msg });
      }
    })();
    return true;
  }

  // Process field AI matching and value resolution
  if (request.action === "processFieldsAI") {
    const hostname = getHostname(request.tabUrl || "");
    processFieldsAI(request.fields, hostname)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Process sidebar AI chat reply
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
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendResponse({ success: false, error: msg });
      }
    })();
    return true;
  }

  // SPA navigation notification
  if (request.action === "urlChanged") {
    sendResponse({ success: true });
    return false;
  }

  // DOM mutation notification
  if (request.action === "domChanged") {
    sendResponse({ success: true });
    return false;
  }

  // Open link with autopilot continuation session
  if (request.action === "openAutopilotLink") {
    chrome.tabs.create({ url: request.url }, (tab) => {
      if (tab.id) {
        chrome.storage.local.set({
          autopilotSession: {
            tabId: tab.id,
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

// Autopilot page navigation listener
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    chrome.storage.local.get(["autopilotSession"], (result) => {
      const session = result.autopilotSession as { tabId?: number; hostname?: string; step?: number } | undefined;
      if (session && session.tabId === tabId) {
        const currentHostname = getHostname(tab.url || "");

        if (session.hostname && currentHostname !== session.hostname) {
          chrome.storage.local.remove(["autopilotSession"]);
          clearBadge();
          return;
        }

        console.log(
          `Aullevo Autopilot: Tab loaded, resuming auto-fill step ${session.step}...`,
        );
        showBadge("⏳", "#3B82F6");

        setTimeout(async () => {
          try {
            const stored = await chrome.storage.local.get([
              "resumeFileData",
              "resumeFileName",
            ]);
            const userData = await getActiveUserData();

            const nextStep = (session.step ?? 0) + 1;
            if (nextStep > 30) {
              chrome.storage.local.remove(["autopilotSession"]);
              showBadge("✓", "#34d399");
              setTimeout(clearBadge, 4000);
              return;
            }

            await chrome.storage.local.set({
              autopilotSession: { ...session, step: nextStep },
            });

            await processFormStep(
              tabId,
              userData,
              nextStep,
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
        }, 2000);
      }
    });
  }
});

// Clear cache when profile or matching settings change
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === "local") {
    if (changes.userData || changes.matchingMode || changes.geminiApiKey) {
      await domainCache.clear();
      console.log(
        "Aullevo: domainCache cleared due to configuration/profile change.",
      );
    }
  }
});

console.log("Aullevo background service worker loaded!");
