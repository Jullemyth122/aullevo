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
    return true;
  }

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

        const stored = await chrome.storage.local.get([
          "resumeFileData",
          "resumeFileName",
          "autoSubmit",
        ]);
        const userData = await getActiveUserData();
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

        // Kick off recursive processFormStep asynchronously so callback completes immediately
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

  if (request.action === "urlChanged") {
    sendResponse({ success: true });
    return false;
  }

  if (request.action === "domChanged") {
    sendResponse({ success: true });
    return false;
  }

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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    chrome.storage.local.get(["autopilotSession"], (result) => {
      const session = result.autopilotSession as any;
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

            const nextStep = session.step + 1;
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
        }, 2000);
      }
    });
  }
});

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

console.log("Aullevo background service worker loaded!");
