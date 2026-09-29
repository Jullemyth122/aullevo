// background.ts - Service Worker managing per-tab side panel triggers, shortcuts, and tab messaging

import { resolveFormQuestionsWithAI, checkAiPermission, resolveFieldValue, getEffectiveUsageCount, getCurrentUsageWeek, countsTowardFreeLimit } from '../services/aiService';
import { readVault } from '../services/vault';
import { verifyAndSyncAccount, TRUSTED_WEB_ORIGINS } from '../services/account';
import { isProUser, effectiveTypingDelay, filesAllowedForPlan, exceedsFreeProfileLimit, DEFAULT_TYPING_DELAY } from '../services/tier';


// ---------------------------------------------------------------------------
// Auto-Reinject Content Script into all open tabs on extension install/reload
// (Prevents "Extension context invalidated" and eliminates manual F5 refreshing!)
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
    console.log("[Aullevo] Extension reloaded/installed. Auto-refreshing content scripts across tabs...");
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const tab of tabs) {
        if (!tab.id) continue;
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                files: ["content.js"],
            });
        } catch {
            // Ignore restricted internal pages (like chrome://extensions)
        }
    }
});

// 1. Helpers & State Tracking

// Tracks which browser windows have an active side panel port connection
const openWindowIds = new Set<number>();
const windowSidePanelPorts = new Map<number, chrome.runtime.Port>();

// 🎯 Tracks specifically which TAB IDs have their side panel toggled ON
const enabledTabIds = new Set<number>();

// Listen for connections from the side panel specifying its windowId
chrome.runtime.onConnect.addListener((port) => {
    if (port.name.startsWith("sidepanel-")) {
        const windowId = Number(port.name.replace("sidepanel-", ""));
        if (!windowId) return;

        openWindowIds.add(windowId);
        windowSidePanelPorts.set(windowId, port);

        // When the user closes the panel via the browser's native "X" button:
        port.onDisconnect.addListener(() => {
            openWindowIds.delete(windowId);
            windowSidePanelPorts.delete(windowId);

            // Clean up the active tab's toggle state
            getActiveTab().then((activeTab) => {
                if (activeTab?.id) {
                    enabledTabIds.delete(activeTab.id);
                    chrome.sidePanel.setOptions({ tabId: activeTab.id, enabled: false }).catch(() => { });
                }
            });
        });
    }
});

// Clean up state when a browser window closes
chrome.windows.onRemoved.addListener((windowId) => {
    openWindowIds.delete(windowId);
    windowSidePanelPorts.delete(windowId);
});

// Clean up state when a tab is closed
chrome.tabs.onRemoved.addListener((closedTabId) => {
    enabledTabIds.delete(closedTabId);
});

/**
 * Automatically hide/show the side panel as the user switches between tabs.
 */
// chrome.tabs.onActivated.addListener(async (activeInfo) => {
//     const tabId = activeInfo.tabId;
//     if (enabledTabIds.has(tabId)) {
//         // Tab is toggled ON: display side panel
//         await chrome.sidePanel.setOptions({
//             tabId,
//             path: "index.html",
//             enabled: true
//         });
//     } else {
//         // Tab is toggled OFF: hide side panel
//         await chrome.sidePanel.setOptions({
//             tabId,
//             enabled: false
//         });
//     }
// });

/**
 * Safely sends a message to the content script running on a specific tab.
 */

async function sendToTab(tabId: number, message: unknown): Promise<void> {
    try {
        await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
        console.warn("[Aullevo] Content script not reachable yet — refresh the page.", err);
    }
}

/**
 * Helper to get the currently active tab in the focused window.
 */
async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
    });
    return tab;
}

/**
 * Decrypts the vault and applies plan limits for fills started from background.ts
 * (keyboard shortcut and batch). Returns null while the vault is locked.
 */
async function loadFillContext() {
    const [vault, settings, isPro] = await Promise.all([
        readVault(),
        chrome.storage.local.get(['aullevo_use_ai', 'aullevo_typing_delay']) as Promise<any>,
        isProUser()
    ]);
    if (!vault) return null;

    const activeProfile: any = vault.activeProfile;
    const rawFields = Array.isArray(vault.fields) ? vault.fields : [];
    const rawFiles = Array.isArray(activeProfile?.files) ? activeProfile.files : [];
    const typingDelay = typeof settings?.aullevo_typing_delay === 'number' ? settings.aullevo_typing_delay : DEFAULT_TYPING_DELAY;

    return {
        profileEnabled: Boolean(activeProfile?.enabled),
        overProfileLimit: exceedsFreeProfileLimit(vault.userProfiles?.profiles ?? [], isPro),
        fields: rawFields.filter((f: any) => f.enabled && f.value?.trim()),
        files: filesAllowedForPlan(rawFiles.filter((f: any) => f.enabled), isPro), // Pro-only
        useAi: Boolean(settings?.aullevo_use_ai),
        typingSpeed: effectiveTypingDelay(typingDelay, isPro)                   // Slow/custom are Pro-only
    };
}

/** Shows a lock badge on the toolbar icon when a shortcut is pressed while the vault is locked. */
function flashLockedBadge(): void {
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }).catch(() => { });
    chrome.action.setBadgeText({ text: 'LOCK' }).catch(() => { });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }).catch(() => { }), 4000);
}

// --- 2. Per-Tab Toggle Helper ---
function toggleSidePanel(tab?: chrome.tabs.Tab): void {
    if (!tab?.id) return;
    const tabId = tab.id;

    const isOpen = enabledTabIds.has(tabId);

    if (isOpen) {
        // 🛑 TOGGLE OFF for THIS tab
        enabledTabIds.delete(tabId);

        chrome.sidePanel.setOptions({
            tabId,
            enabled: false
        }).catch(() => { });

    } else {
        // 🟢 TOGGLE ON for THIS tab
        enabledTabIds.add(tabId);

        chrome.sidePanel.setOptions({
            tabId,
            path: "index.html",
            enabled: true
        }).catch((err) => console.warn("[Aullevo] setOptions error:", err));

        // Synchronous call to preserve the active user gesture
        chrome.sidePanel.open({ tabId }).catch((err) => {
            console.warn("[Aullevo] Could not open side panel for tab:", err);
            enabledTabIds.delete(tabId);
        });
    }
}

// ---------------------------------------------------------------------------
// 3. The 3 Doors to Toggle the Native Side Panel
// ---------------------------------------------------------------------------

// 🚪 DOOR 1: Clicking the extension icon in the browser toolbar
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: false })
        .catch((err: unknown) => console.warn("[Aullevo] Error configuring side panel behavior:", err));
}

chrome.action.onClicked.addListener((tab: chrome.tabs.Tab) => {
    toggleSidePanel(tab);
});

// 🚪 DOOR 2: Pressing Alt+Q (or command fallback)
chrome.commands.onCommand.addListener((command: string, tab?: chrome.tabs.Tab) => {
    if (command === "toggle-sidebar" || command === "_execute_action") {
        if (tab?.id) {
            toggleSidePanel(tab);
        } else {
            getActiveTab().then((activeTab) => {
                if (activeTab) toggleSidePanel(activeTab);
            });
        }
    } else if (command === "trigger-ai-fill") {
        (async () => {
            const activeTab = await getActiveTab();
            if (!activeTab?.id) return;

            const ctx = await loadFillContext();
            if (!ctx) {
                console.log("[Aullevo] Vault is locked. Open the side panel and unlock to use shortcuts.");
                flashLockedBadge();
                return;
            }
            // Same rule as the side panel Fill button: a profile switched OFF must not autofill
            if (!ctx.profileEnabled) {
                console.log("[Aullevo] Active profile is disabled. Shortcut autofill skipped.");
                return;
            }
            if (ctx.overProfileLimit) {
                console.log("[Aullevo] Free plan: more than 2 profiles are ON. Shortcut autofill skipped.");
                return;
            }

            sendToTab(activeTab.id, {
                action: "INJECT_FORM_FIELDS",
                fields: ctx.fields,
                files: ctx.files,
                useAi: ctx.useAi,
                typingSpeed: ctx.typingSpeed
            });
        })();
    } else if (command === "trigger-batch-fill") {
        // 🚀 Shortcut pressed: Alt+Shift+B / Option+Shift+B
        chrome.storage?.local?.get(['aullevo_saved_links'], (storage: any) => {
            const rawLinks = Array.isArray(storage?.aullevo_saved_links) ? storage.aullevo_saved_links : [];
            const activeLinks = rawLinks.filter((l: any) => l.enabled);
            if (activeLinks.length > 0) {
                runBatchAutofill(activeLinks);
            } else {
                console.log("[Aullevo:Batch] No active links in queue to fill.");
            }
        });
    }


});

// One form fill can send several AI requests (one per iframe). Count them as one free fill.
const AI_FILL_WINDOW_MS = 60_000;
const lastCountedAiFill = new Map<number, number>();

function shouldCountAiFill(tabId: number | undefined): boolean {
    if (tabId === undefined) return true;
    const now = Date.now();
    const last = lastCountedAiFill.get(tabId);
    if (last !== undefined && now - last < AI_FILL_WINDOW_MS) return false;
    lastCountedAiFill.set(tabId, now);
    return true;
}

// 🚪 DOOR 3: Clicking the blue floating icon button on the webpage & AI Resolution
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "OPEN_SIDE_PANEL") {
        toggleSidePanel(sender.tab);
    } else if (message.action === "CLOSE_PANEL") {
        getActiveTab().then((activeTab) => {
            if (activeTab?.id) {
                enabledTabIds.delete(activeTab.id);
                chrome.sidePanel.setOptions({ tabId: activeTab.id, enabled: false }).catch(() => { });
            }
        });
    } else if (message.action === "START_BATCH_FILL") {
        // 🚀 Button clicked inside MultiLinkTab:
        const activeLinks = Array.isArray(message.links) ? message.links : [];
        runBatchAutofill(activeLinks);
    } else if (message.action === "WEB_AUTH_SYNC") {
        // 🔗 Account sync from aullevo-web: only accept tokens relayed from the real website
        const senderOrigin = sender.origin || (sender.url ? new URL(sender.url).origin : '');
        if (!TRUSTED_WEB_ORIGINS.includes(senderOrigin) || typeof message.idToken !== 'string') {
            sendResponse({ success: false, error: "Untrusted sender." });
            return false;
        }
        verifyAndSyncAccount(message.idToken)
            .then((account) => sendResponse({ success: true, isPro: account.isPro }))
            .catch((err) => sendResponse({ success: false, error: err.message || "Account sync failed." }));
        return true; // Keep channel open for async response
    } else if (message.action === "CHECK_AI_PERMISSION") {
        // 🔐 Preflight: lets content.ts fall back to full keyword mode when AI can't run
        (async () => {
            const [vault, storage, isPro]: [any, any, boolean] = await Promise.all([
                readVault(),
                chrome.storage.local.get(['aullevo_ai_usage_count', 'aullevo_ai_usage_week']),
                isProUser()
            ]);
            if (!vault) {
                sendResponse({ allowed: false, reason: "Aullevo is locked. Unlock it in the side panel." });
                return;
            }
            const apiKey = typeof vault.geminiApiKey === 'string' ? vault.geminiApiKey : "";
            const usageCount = getEffectiveUsageCount(storage?.aullevo_ai_usage_count, storage?.aullevo_ai_usage_week);
            sendResponse(checkAiPermission(isPro, Boolean(apiKey.trim()), usageCount));
        })();
        return true; // Keep channel open for async response
    } else if (message.action === "RESOLVE_AI_QUESTIONS") {
        // 🧠 AI Smart Fill: Resolve leftover questions using Privacy-Safe Gemini Engine
        (async () => {
            try {
                const [vault, storage, isPro]: [any, any, boolean] = await Promise.all([
                    readVault(),
                    chrome.storage.local.get([
                        'aullevo_gemini_model',
                        'aullevo_ai_usage_count',
                        'aullevo_ai_usage_week',
                        'aullevo_memories'
                    ]),
                    isProUser()
                ]);
                if (!vault) {
                    sendResponse({ success: false, error: "Aullevo is locked. Unlock it in the side panel." });
                    return;
                }

                const activeProfile = vault.activeProfile;
                if (!activeProfile) {
                    sendResponse({ success: false, error: "No active profile found in storage." });
                    return;
                }

                const apiKey: string = vault.geminiApiKey || "";
                const model = storage?.aullevo_gemini_model || "gemini-3.5-flash-lite";
                const usageCount = getEffectiveUsageCount(storage?.aullevo_ai_usage_count, storage?.aullevo_ai_usage_week);
                const memories = Array.isArray(storage?.aullevo_memories) ? storage.aullevo_memories : [];

                // Check quota & permissions
                const perm = checkAiPermission(isPro, Boolean(apiKey.trim()), usageCount);
                if (!perm.allowed) {
                    sendResponse({ success: false, error: perm.reason });
                    return;
                }

                // Call Privacy-First Zero-Knowledge resolution
                const result = await resolveFormQuestionsWithAI(
                    apiKey,
                    message.questions || [],
                    activeProfile,
                    memories,
                    model
                );

                if (result.error) {
                    sendResponse({ success: false, error: result.error });
                    return;
                }

                // Free plan: every AI fill counts toward the weekly limit, own key or not
                // (once per fill: every iframe of a page sends its own request)
                if (countsTowardFreeLimit(isPro) && shouldCountAiFill(sender.tab?.id)) {
                    chrome.storage?.local?.set({
                        aullevo_ai_usage_count: usageCount + 1,
                        aullevo_ai_usage_week: getCurrentUsageWeek()
                    });
                }

                // Resolve matchedKey or matchedKeys → actual value LOCALLY before sending to content.ts
                const resolvedAnswers = result.answers.map(ans => {
                    const keys = (Array.isArray(ans.matchedKeys) && ans.matchedKeys.length > 0)
                        ? ans.matchedKeys
                        : (ans.matchedKey ? ans.matchedKey : null);

                    if (keys) {
                        const resolvedValue = resolveFieldValue(activeProfile, keys);
                        const effectiveKey = Array.isArray(keys) ? keys.join('+') : keys;
                        return {
                            id: ans.id,
                            matchedKey: effectiveKey,
                            matchedKeys: Array.isArray(keys) ? keys : undefined,
                            answer: resolvedValue || ans.answer || '',
                            resolvedFromProfile: Boolean(resolvedValue)
                        };
                    }
                    return ans;
                });

                sendResponse({
                    success: true,
                    answers: resolvedAnswers,
                    tokensUsed: result.tokensUsed
                });


            } catch (err: any) {
                console.error("[Aullevo:Background] AI resolution error:", err);
                sendResponse({ success: false, error: err.message || "Failed to resolve with AI." });
            }
        })();
        return true; // Keep channel open for async response
    }
});


// ---------------------------------------------------------------------------
// 4. Multi-Link Batch Autofill Engine
// ---------------------------------------------------------------------------
// Helper: Waits for a tab to finish loading before attempting form injection
function waitForTabComplete(tabId: number, timeoutMs = 25000): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(); // Timeout fallback: proceed anyway so the batch loop doesn't freeze
        }, timeoutMs);

        // ✅ Replace `chrome.tabs.TabChangeInfo` with `{ status?: string }`
        const listener = (id: number, changeInfo: { status?: string }) => {
            if (id === tabId && changeInfo.status === 'complete') {
                clearTimeout(timer);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
}


// Main Runner: Iterates through each enabled link in sequence
async function runBatchAutofill(links: Array<{ id: string; url: string }>) {
    console.log(`[Aullevo:Batch] Starting batch autofill for ${links.length} links...`);
    // 1. Decrypt profile data and apply plan limits (files, speed)
    const ctx = await loadFillContext();
    if (!ctx) {
        console.log("[Aullevo:Batch] Vault is locked. Batch autofill skipped.");
        flashLockedBadge();
        chrome.runtime.sendMessage({ action: "BATCH_COMPLETE", total: 0 }).catch(() => { });
        return;
    }
    // A profile switched OFF must not autofill (also unblocks the side panel's running state)
    if (!ctx.profileEnabled || ctx.overProfileLimit) {
        console.log("[Aullevo:Batch] Profile is disabled or Free plan profile limit exceeded. Batch autofill skipped.");
        chrome.runtime.sendMessage({ action: "BATCH_COMPLETE", total: 0 }).catch(() => { });
        return;
    }
    const { fields: fieldsToInject, files: filesToInject, typingSpeed, useAi } = ctx;
    for (let i = 0; i < links.length; i++) {
        const link = links[i];
        console.log(`[Aullevo:Batch] Processing [${i + 1}/${links.length}]: ${link.url}`);
        // Broadcast progress to side panel UI
        chrome.runtime.sendMessage({
            action: "BATCH_PROGRESS",
            current: i + 1,
            total: links.length,
            url: link.url
        }).catch(() => { });
        try {
            // 2. Open tab in background so it doesn't interrupt your current screen
            const tab = await chrome.tabs.create({ url: link.url, active: false });
            if (!tab?.id) continue;
            // 3. Wait for the page DOM to finish loading
            await waitForTabComplete(tab.id);
            // 4. Grace period for dynamic SPAs (Workday, Greenhouse, React) to render inputs
            await new Promise(r => setTimeout(r, 2000));
            // 5. Inject fields + files into the new tab
            await new Promise<void>((resolve) => {
                chrome.tabs.sendMessage(tab.id!, {
                    action: "INJECT_FORM_FIELDS",
                    fields: fieldsToInject,
                    files: filesToInject,
                    useAi: useAi,
                    typingSpeed: typingSpeed
                }, (res) => {
                    console.log(`[Aullevo:Batch] Tab ${tab.id} filled ${res?.matchedCount ?? 0} inputs.`);
                    resolve();
                });
            });
            // 6. Pause 1 second before the next link to avoid browser throttling
            await new Promise(r => setTimeout(r, 1000));
        } catch (err) {
            console.error(`[Aullevo:Batch] Failed to autofill link: ${link.url}`, err);
        }
    }
    console.log("[Aullevo:Batch] All batch links finished.");
    chrome.runtime.sendMessage({ action: "BATCH_COMPLETE", total: links.length }).catch(() => { });
}

