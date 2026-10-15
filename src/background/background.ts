// background.ts - Service Worker managing per-tab side panel triggers, shortcuts, and tab messaging

import { resolveFormQuestionsWithAI, parseVoiceCommand, findVoiceTargets, understandVoiceCommand, checkAiPermission, loadAiConfig, resolveFieldValue, resolveTemplate } from '../services/aiService';
import { readVault } from '../services/vault';
import { OWNER_SCOPED_KEYS, getScopedKey } from '../services/owner';
import { verifyAndSyncAccount, TRUSTED_WEB_ORIGINS } from '../services/account';
import { refreshRewards, readRewards, consumeReward, linkExtension, planAccess, canUse, ensureTimeUnlock, voiceSessionActive, rewardsPageUrl, REWARD_FEATURES, type RewardFeature } from '../services/rewards';
import { isProUser, canUseTypingDelay, filesAllowedForPlan, pausedProfileKeys, DEFAULT_TYPING_DELAY, VOICE_PRO_MESSAGE } from '../services/tier';
import { LANGUAGE_STORAGE_KEY, DEFAULT_LANGUAGE, resolveLanguage } from '../i18n/languages';
import { AUTO_PAGINATE_STORAGE_KEY, AUTO_PAGINATE_MAX_PAGES, AUTO_PAGINATE_PRO_MESSAGE, type PaginationRunResult, type PaginationStepResult } from '../services/pagination';
import { describeFill, describePaginationRun, type RunTone, type Translate } from '../services/runText';


// ---------------------------------------------------------------------------
// Auto-Reinject Content Script into all open tabs on extension install/reload
// (Prevents "Extension context invalidated" and eliminates manual F5 refreshing!)
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
    console.log("[Aullevo] Extension reloaded/installed. Auto-refreshing content scripts across tabs...");
    // file:// pages too (local test forms), when "Allow access to file URLs" is on
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*", "file:///*"] });
    for (const tab of tabs) {
        if (tab.id) await injectContentScript(tab.id);
    }
});

// Chrome waits for every frame to finish loading before it runs a script there. One frame that never finishes
// (an ad, captcha or tracking iframe, e.g. on careers.deltek.com) would hold a fill forever, so frame scripts give
// up after a few seconds; the quick probes also run at once instead of waiting for the frame to load.
const FRAME_SCRIPT_TIMEOUT_MS = 4000;
function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
    return Promise.race([work, new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))]);
}

// A fresh content.js in every frame of the tab (it stands down any older copy itself). False on
// restricted pages (chrome://, Web Store) or file:// without file access.
async function injectContentScript(tabId: number): Promise<boolean> {
    try {
        // Timed out: the loaded frames have it by then; only a frame still loading is waited for
        return await withTimeout(
            chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] }).then(() => true),
            FRAME_SCRIPT_TIMEOUT_MS, true);
    } catch {
        return false;
    }
}

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
    const [vault, settings, isPro, rewards] = await Promise.all([
        readVault(),
        chrome.storage.local.get(['aullevo_use_ai', 'aullevo_typing_delay', AUTO_PAGINATE_STORAGE_KEY]) as Promise<any>,
        isProUser(),
        refreshRewards()
    ]);
    if (!vault) return null;
    // Free plan: today's free allowance, plus whatever an ad unlocked (rewards.ts)
    const access = planAccess(isPro, rewards);

    const activeProfile: any = vault.activeProfile;
    const rawFields = Array.isArray(vault.fields) ? vault.fields : [];
    const rawFiles = Array.isArray(activeProfile?.files) ? activeProfile.files : [];
    const typingDelay = typeof settings?.aullevo_typing_delay === 'number' ? settings.aullevo_typing_delay : DEFAULT_TYPING_DELAY;

    return {
        profileEnabled: Boolean(activeProfile?.enabled),
        profileName: String(activeProfile?.profileName || activeProfile?.profileType || 'Profile'),
        profileLimit: access.profileLimit,
        // Free plan: ON beyond the active-profile limit (the ad unlock ended): paused, not deleted
        overProfileLimit: pausedProfileKeys(vault.userProfiles?.profiles ?? [], access.profileLimit).includes(activeProfile?.profileType),
        fields: rawFields.filter((f: any) => f.enabled && f.value?.trim()),
        files: filesAllowedForPlan(rawFiles.filter((f: any) => f.enabled), isPro), // Pro-only
        useAi: Boolean(settings?.aullevo_use_ai),
        typingSpeed: await planTypingSpeed(typingDelay),                           // Slow/custom: Pro, free hours or ad
        autoPaginate: Boolean(settings?.[AUTO_PAGINATE_STORAGE_KEY]) && (await paginateAllowed()),
        linkLimit: access.linkLimit                                                // Multi-link queue size
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
                void showPageNotice(activeTab.id, t => ({ text: t('status.profile.disabled', { type: ctx.profileName }), type: 'error' }));
                return;
            }
            if (ctx.overProfileLimit) {
                console.log("[Aullevo] Free plan: this profile is paused (more profiles are ON than the plan allows). Shortcut autofill skipped.");
                void showPageNotice(activeTab.id, t => ({ text: t('rewards.status.profilePaused', { max: ctx.profileLimit }), type: 'error' }));
                return;
            }

            if (ctx.autoPaginate) {
                const result = await runAutoPaginate(activeTab.id, ctx);
                console.log("[Aullevo] Shortcut auto-pagination finished:", result);
                await showPageNotice(activeTab.id, t => describePaginationRun(result, t));
                return;
            }

            const result = await fillTabFrames(activeTab.id, ctx);
            console.log("[Aullevo] Shortcut fill finished:", result);
            await showPageNotice(activeTab.id, t => describeFill(result, t));
        })();
    } else if (command === "trigger-batch-fill") {
        // 🚀 Shortcut pressed: Alt+Shift+B / Option+Shift+B (the connected account's queue)
        getScopedKey(OWNER_SCOPED_KEYS.links).then((linksKey) => {
            chrome.storage?.local?.get([linksKey], (storage: any) => {
                const rawLinks = Array.isArray(storage?.[linksKey]) ? storage[linksKey] : [];
                const activeLinks = rawLinks.filter((l: any) => l.enabled);
                if (activeLinks.length > 0) {
                    runBatchAutofill(activeLinks);
                } else {
                    console.log("[Aullevo:Batch] No active links in queue to fill.");
                }
            });
        });
    }


});

// Free plan: each page the AI helps fill uses one AI fill (6 free a day, an ad gives 10). A page = one Fill click, one
// auto-pagination step or one batch link: its iframes and its catch-up passes send several AI requests, counted once.
const AI_PAGE_MAX_MS = 10 * 60_000; // a fill started without beginAiFillPage (rare) still counts again after this
const aiPageCounted = new Map<number, number>();

function beginAiFillPage(tabId: number): void {
    aiPageCounted.delete(tabId);
}

function shouldCountAiFill(tabId: number | undefined): boolean {
    if (tabId === undefined) return true;
    const at = aiPageCounted.get(tabId);
    if (at !== undefined && Date.now() - at < AI_PAGE_MAX_MS) return false;
    aiPageCounted.set(tabId, Date.now());
    return true;
}

// Voice requests: Pro, or a voice session started from an ad unlock (VoiceView spends one per session)
async function voiceAllowed(): Promise<boolean> {
    return (await isProUser()) || voiceSessionActive(await readRewards());
}

// Auto-pagination: Pro, today's 2 free hours (they start here, on the first use), or the 4-hour ad unlock
async function paginateAllowed(): Promise<boolean> {
    return (await isProUser()) || ensureTimeUnlock('paginate');
}

// Slow and custom typing speeds: same rule as auto-pagination; otherwise the fill types at the Natural speed
async function planTypingSpeed(raw: unknown): Promise<number> {
    const ms = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_TYPING_DELAY;
    if (canUseTypingDelay(ms, false) || (await isProUser()) || (await ensureTimeUnlock('typing'))) return ms;
    return DEFAULT_TYPING_DELAY;
}

// The rewards page the side panel opened, and the tab to go back to once the ad has unlocked the feature
let rewardsTrip: { rewardsTabId: number; returnTabId?: number } | null = null;

async function openRewardsPage(feature: RewardFeature): Promise<void> {
    const [current] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = await chrome.tabs.create({ url: rewardsPageUrl(feature), active: true });
    rewardsTrip = tab.id ? { rewardsTabId: tab.id, returnTabId: current?.id } : null;
}

function returnFromRewards(tabId: number | undefined): void {
    const trip = rewardsTrip;
    if (!trip || tabId !== trip.rewardsTabId) return;
    rewardsTrip = null;
    // Long enough to read "Unlocked!" on the page
    setTimeout(() => {
        chrome.tabs.remove(trip.rewardsTabId).catch(() => { });
        if (trip.returnTabId) chrome.tabs.update(trip.returnTabId, { active: true }).catch(() => { });
    }, 2500);
}

// Texts content.ts shows on web pages (floating button, field badges) in the chosen UI language
// ---------------------------------------------------------------------------
// Notices on the page: a fill started with a keyboard shortcut or from Multi-link has no side panel to report in,
// so the page shows the panel's words (what was filled, and what needs the user: a required field, "I'm not a robot")
// ---------------------------------------------------------------------------

type NestedText = { [key: string]: string | NestedText };
function flattenText(obj: NestedText | undefined, prefix: string, out: Record<string, string> = {}): Record<string, string> {
    for (const [key, value] of Object.entries(obj ?? {})) {
        const path = `${prefix}.${key}`;
        if (typeof value === 'string') out[path] = value;
        else if (value && typeof value === 'object') flattenText(value, path, out);
    }
    return out;
}
const NOTICE_EN: Record<string, string> = {};
for (const [path, json] of Object.entries(import.meta.glob<NestedText>(['../i18n/en/status.json', '../i18n/en/rewards.json'], { eager: true, import: 'default' }))) {
    flattenText(json, path.replace(/^.*\/(.+)\.json$/, '$1'), NOTICE_EN);
}

/** t() for notices: the chosen language's status / rewards texts, English for anything missing. */
async function noticeTranslator(): Promise<Translate> {
    const language = resolveLanguage((await chrome.storage.local.get(LANGUAGE_STORAGE_KEY))[LANGUAGE_STORAGE_KEY]);
    let local: Record<string, string> = {};
    if (language !== DEFAULT_LANGUAGE) {
        try {
            const json = await (await fetch(chrome.runtime.getURL(`locales/${language}.json`))).json();
            local = { ...flattenText(json?.status, 'status'), ...flattenText(json?.rewards, 'rewards') };
        } catch { /* English */ }
    }
    const plural = (lang: string, n: number) => { try { return new Intl.PluralRules(lang).select(n); } catch { return n === 1 ? 'one' : 'other'; } };
    return (key, vars) => {
        const count = vars?.count;
        const text = (typeof count === 'number'
            ? local[`${key}.${plural(language, count)}`] ?? local[`${key}.other`] ?? NOTICE_EN[`${key}.${plural('en', count)}`] ?? NOTICE_EN[`${key}.other`]
            : undefined) ?? local[key] ?? NOTICE_EN[key] ?? key;
        return text.replace(/\{(\w+)\}/g, (m, name: string) => (vars?.[name] !== undefined ? String(vars[name]) : m));
    };
}

/** Shows the outcome on the tab (top frame), where the user is looking. */
async function showPageNotice(tabId: number, describe: (t: Translate) => { text: string; type: RunTone }): Promise<void> {
    const { text, type } = describe(await noticeTranslator());
    await chrome.tabs.sendMessage(tabId, { action: "SHOW_RUN_NOTICE", text, type }, { frameId: 0 }).catch(() => { });
}

async function getContentStrings(): Promise<{ language: string; messages: Record<string, unknown> }> {
    const saved = (await chrome.storage.local.get(LANGUAGE_STORAGE_KEY))[LANGUAGE_STORAGE_KEY];
    const language = resolveLanguage(saved);
    if (language === DEFAULT_LANGUAGE) return { language, messages: {} };
    try {
        const res = await fetch(chrome.runtime.getURL(`locales/${language}.json`));
        const json = await res.json();
        return { language, messages: json?.content ?? {} };
    } catch {
        return { language: DEFAULT_LANGUAGE, messages: {} };
    }
}

// 🚪 DOOR 3: Clicking the blue floating icon button on the webpage & AI Resolution
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "GET_CONTENT_STRINGS") {
        // content.ts can't load language files itself (classic script); it keeps English as its fallback
        getContentStrings().then(sendResponse);
        return true;
    } else if (message.action === "OPEN_SIDE_PANEL") {
        toggleSidePanel(sender.tab);
    } else if (message.action === "CLOSE_PANEL") {
        getActiveTab().then((activeTab) => {
            if (activeTab?.id) {
                enabledTabIds.delete(activeTab.id);
                chrome.sidePanel.setOptions({ tabId: activeTab.id, enabled: false }).catch(() => { });
            }
        });
    } else if (message.action === "START_AUTO_PAGINATE") {
        // 📄 Fill button in the side panel with Auto-Pagination ON (Pro): fill every page of the form
        // Only extension pages (side panel) may start a run, never a content script on a web page
        if (!sender.url?.startsWith(chrome.runtime.getURL('')) || typeof message.tabId !== 'number') {
            return false;
        }
        (async () => {
            if (!(await paginateAllowed())) {
                sendResponse({ success: false, status: 'error', pages: 0, totalFilled: 0, error: AUTO_PAGINATE_PRO_MESSAGE } satisfies PaginationRunResult);
                return;
            }
            sendResponse(await runAutoPaginate(message.tabId, {
                fields: Array.isArray(message.fields) ? message.fields : [],
                files: Array.isArray(message.files) ? message.files : [],
                useAi: Boolean(message.useAi),
                typingSpeed: await planTypingSpeed(message.typingSpeed)
            }));
        })();
        return true; // Keep channel open for async response
    } else if (message.action === "FILL_TAB") {
        // 📝 Fill button in the side panel: one fill across the frames that hold a form
        if (!sender.url?.startsWith(chrome.runtime.getURL('')) || typeof message.tabId !== 'number') {
            return false;
        }
        // Voice mode (Pro): a fill that targets questions only comes from the voice agent
        if (message.target && typeof message.target === 'object') {
            voiceAllowed().then(async (pro) => {
                if (!pro) {
                    sendResponse({ success: false, error: VOICE_PRO_MESSAGE });
                    return;
                }
                fillTabFrames(message.tabId, {
                    fields: Array.isArray(message.fields) ? message.fields : [],
                    files: Array.isArray(message.files) ? message.files : [],
                    useAi: Boolean(message.useAi),
                    typingSpeed: await planTypingSpeed(message.typingSpeed),
                    target: voiceTargetFrom(message.target)
                }).then(sendResponse);
            });
            return true; // Keep channel open for async response
        }
        planTypingSpeed(message.typingSpeed).then((typingSpeed) => fillTabFrames(message.tabId, {
            fields: Array.isArray(message.fields) ? message.fields : [],
            files: Array.isArray(message.files) ? message.files : [],
            useAi: Boolean(message.useAi),
            typingSpeed
        })).then(sendResponse);
        return true; // Keep channel open for async response
    } else if (message.action === "CANCEL_FILL") {
        // 🎙️ Voice agent "stop": end the fill running in this tab
        if (!sender.url?.startsWith(chrome.runtime.getURL('')) || typeof message.tabId !== 'number') {
            return false;
        }
        cancelFill(message.tabId);
    } else if (message.action === "ADVANCE_TAB") {
        // 🎙️ Voice agent "next" / "submit": click the form's button once (Pro)
        if (!sender.url?.startsWith(chrome.runtime.getURL('')) || typeof message.tabId !== 'number') {
            return false;
        }
        voiceAllowed().then((pro) => pro
            ? advanceTab(message.tabId, Boolean(message.submit)).then(sendResponse)
            : sendResponse({ action: 'none', error: VOICE_PRO_MESSAGE }));
        return true; // Keep channel open for async response
    } else if (message.action === "GET_VOICE_QUESTIONS") {
        // 🎙️ Voice agent: the questions of the form in this tab (the frame that holds most of it), for the AI
        if (!sender.url?.startsWith(chrome.runtime.getURL('')) || typeof message.tabId !== 'number') {
            return false;
        }
        (async () => {
            if (!(await voiceAllowed())) {
                sendResponse({ frameId: 0, questions: [], error: VOICE_PRO_MESSAGE });
                return;
            }
            const frames = await probePaginationFrames(message.tabId);
            const frameId = [...frames].sort((a, b) => b.controls - a.controls)[0]?.frameId ?? 0;
            const res = await chrome.tabs.sendMessage(message.tabId, { action: 'LIST_VOICE_QUESTIONS' }, { frameId }).catch(() => null);
            sendResponse({ frameId, questions: Array.isArray(res?.questions) ? res.questions : [] });
        })().catch(() => sendResponse({ frameId: 0, questions: [] }));
        return true; // Keep channel open for async response
    } else if (message.action === "UNDERSTAND_VOICE") {
        // 🎙️ Voice agent: what one spoken sentence asks for, decided by the AI with the page's questions
        if (!sender.url?.startsWith(chrome.runtime.getURL('')) || typeof message.text !== 'string') {
            return false;
        }
        (async () => {
            const [vault, pro] = await Promise.all([readVault(), voiceAllowed()]);
            if (!pro) {
                sendResponse({ commands: [], error: VOICE_PRO_MESSAGE });
                return;
            }
            if (!vault) {
                sendResponse({ commands: [], error: "Aullevo is locked." });
                return;
            }
            const profiles = Array.isArray(message.profiles) ? message.profiles.map(String).slice(0, 40) : [];
            const questions = (Array.isArray(message.questions) ? message.questions : []).slice(0, 150).map((q: any) => ({
                text: String(q?.text ?? '').slice(0, 200),
                kind: String(q?.kind ?? 'text'),
                ...(Array.isArray(q?.options) ? { options: q.options.slice(0, 8).map((o: unknown) => String(o).slice(0, 80)) } : {}),
                answered: Boolean(q?.answered),
                inView: Boolean(q?.inView),
                lastTouched: Boolean(q?.lastTouched)
            }));
            sendResponse(await understandVoiceCommand(
                await loadAiConfig(vault),
                message.text.slice(0, 600),
                profiles,
                typeof message.currentProfile === 'string' ? message.currentProfile.slice(0, 80) : '',
                questions
            ));
        })().catch((err) => sendResponse({ commands: [], error: err?.message || String(err) }));
        return true; // Keep channel open for async response
    } else if (message.action === "FIND_VOICE_TARGETS") {
        // 🎙️ Voice agent: content.ts couldn't find the question the user named by its words; the AI picks it
        if (!Array.isArray(message.targets) || !Array.isArray(message.questions)) {
            return false;
        }
        (async () => {
            const [vault, pro] = await Promise.all([readVault(), voiceAllowed()]);
            if (!vault || !pro) {
                sendResponse({ matches: [], error: pro ? undefined : VOICE_PRO_MESSAGE });
                return;
            }
            const targets = message.targets.map(String).slice(0, 8);
            const said = typeof message.said === 'string' ? message.said.slice(0, 300) : targets.join(', ');
            const questions = message.questions.slice(0, 200).map((q: any) => ({
                text: String(q?.text ?? '').slice(0, 200),
                kind: String(q?.kind ?? 'text'),
                ...(Array.isArray(q?.options) ? { options: q.options.slice(0, 8).map((o: unknown) => String(o).slice(0, 80)) } : {}),
                answered: Boolean(q?.answered),
                inView: Boolean(q?.inView),
                lastTouched: Boolean(q?.lastTouched)
            }));
            sendResponse(await findVoiceTargets(await loadAiConfig(vault), said, targets, questions));
        })().catch((err) => sendResponse({ matches: [], error: err?.message || String(err) }));
        return true; // Keep channel open for async response
    } else if (message.action === "PARSE_VOICE_COMMAND") {
        // 🎙️ Voice agent: a sentence the panel's rules didn't recognise, worked out by the AI
        if (!sender.url?.startsWith(chrome.runtime.getURL('')) || typeof message.text !== 'string') {
            return false;
        }
        (async () => {
            const [vault, pro] = await Promise.all([readVault(), voiceAllowed()]);
            if (!pro) {
                sendResponse({ intent: 'none', error: VOICE_PRO_MESSAGE });
                return;
            }
            if (!vault) {
                sendResponse({ intent: 'none', error: "Aullevo is locked." });
                return;
            }
            const profiles = Array.isArray(message.profiles) ? message.profiles.map(String).slice(0, 40) : [];
            sendResponse(await parseVoiceCommand(await loadAiConfig(vault), message.text.slice(0, 500), profiles));
        })().catch((err) => sendResponse({ intent: 'none', error: err?.message || String(err) }));
        return true; // Keep channel open for async response
    } else if (message.action === "PAGINATION_PAGE_FILLED") {
        // content.ts reports a page's fill count before clicking Next (a full page load drops its reply)
        if (sender.tab?.id !== undefined && typeof message.matchedCount === 'number') {
            lastPageFillCount.set(sender.tab.id, message.matchedCount);
            lastPageClick.set(sender.tab.id, message.clicked === 'submit' ? 'submit' : 'next');
        }
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
            .then(async (account) => {
                // The extension's own token for ad unlocks (aullevo-web /api/rewards); sign-in works without it
                try {
                    await linkExtension(account.uid, message.idToken);
                } catch (err: any) {
                    console.warn("[Aullevo:Background] Could not link ad unlocks:", err?.message || err);
                }
                sendResponse({ success: true, isPro: account.isPro });
            })
            .catch((err) => sendResponse({ success: false, error: err.message || "Account sync failed." }));
        return true; // Keep channel open for async response
    } else if (message.action === "OPEN_REWARDS") {
        // 🎬 Free plan: the side panel opens aullevo-web/rewards to watch a short ad for one feature
        if (!sender.url?.startsWith(chrome.runtime.getURL('')) || !REWARD_FEATURES.includes(message.feature)) {
            return false;
        }
        openRewardsPage(message.feature)
            .then(() => sendResponse({ ok: true }))
            .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
        return true; // Keep channel open for async response
    } else if (message.action === "REWARD_GRANTED") {
        // 🎬 aullevo-web: an ad finished and the server opened an unlock. Fetch it, then go back to the form.
        const senderOrigin = sender.origin || (sender.url ? new URL(sender.url).origin : '');
        if (!TRUSTED_WEB_ORIGINS.includes(senderOrigin)) {
            return false;
        }
        refreshRewards(true).finally(() => returnFromRewards(sender.tab?.id));
        return false;
    } else if (message.action === "REFRESH_REWARDS") {
        // The side panel opened or regained focus: the unlocks may have changed on another device
        if (!sender.url?.startsWith(chrome.runtime.getURL(''))) {
            return false;
        }
        refreshRewards(Boolean(message.force)).then((cache) => sendResponse({ cache }));
        return true; // Keep channel open for async response
    } else if (message.action === "AULLEVO_DELAY") {
        // content.ts waits here when the site blocks its timers (Brave Shields "Block scripts")
        const ms = Math.min(Math.max(Number(message.ms) || 0, 0), 60_000);
        setTimeout(() => sendResponse(true), ms);
        return true; // Keep channel open for async response
    } else if (message.action === "CHECK_AI_PERMISSION") {
        // 🔐 Preflight: lets content.ts fall back to full keyword mode when AI can't run
        (async () => {
            const [vault, isPro, rewards] = await Promise.all([readVault(), isProUser(), refreshRewards()]);
            if (!vault) {
                sendResponse({ allowed: false, reason: "Aullevo is locked. Unlock it in the side panel." });
                return;
            }
            sendResponse(checkAiPermission(isPro, await loadAiConfig(vault), canUse(rewards, 'ai')));
        })().catch((err) => {
            // Without an answer the content script can only report "could not reach the AI worker"
            console.error("[Aullevo:Background] AI permission check failed:", err);
            sendResponse({ allowed: false, reason: `AI check failed: ${err?.message || err}` });
        });
        return true; // Keep channel open for async response
    } else if (message.action === "RESOLVE_AI_QUESTIONS") {
        // 🧠 AI Smart Fill: Resolve leftover questions using the Privacy-Safe AI Engine
        (async () => {
            try {
                // Memories belong to the connected account
                const memoriesKey = await getScopedKey(OWNER_SCOPED_KEYS.memories);
                const [vault, storage, isPro, rewards]: [any, any, boolean, Awaited<ReturnType<typeof refreshRewards>>] = await Promise.all([
                    readVault(),
                    chrome.storage.local.get([memoriesKey]),
                    isProUser(),
                    refreshRewards()
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

                const aiConfig = await loadAiConfig(vault);
                const memories = Array.isArray(storage?.[memoriesKey]) ? storage[memoriesKey] : [];

                // Check the plan (Free: 3 AI fills a day, more from an ad) & the AI setup
                const perm = checkAiPermission(isPro, aiConfig, canUse(rewards, 'ai'));
                if (!perm.allowed) {
                    sendResponse({ success: false, error: perm.reason });
                    return;
                }

                // Call Privacy-First Zero-Knowledge resolution
                const result = await resolveFormQuestionsWithAI(
                    aiConfig,
                    message.questions || [],
                    activeProfile,
                    memories
                );

                if (result.error) {
                    sendResponse({ success: false, error: result.error });
                    return;
                }

                // Free plan: this page uses one AI fill (an ad's first, then today's free ones), own key or not
                // (once per page: every iframe and catch-up pass sends its own request)
                if (!isPro && shouldCountAiFill(sender.tab?.id)) {
                    void consumeReward('ai');
                }

                // Resolve matchedKey or matchedKeys → actual value LOCALLY before sending to content.ts
                const resolvedAnswers = result.answers.map(ans => {
                    // A template shapes profile values into the form's format: "{lastName}, {firstName}"
                    const templated = ans.template ? resolveTemplate(activeProfile, ans.template) : null;
                    if (templated) {
                        return {
                            id: ans.id,
                            matchedKey: ans.template,
                            answer: templated,
                            resolvedFromProfile: true
                        };
                    }

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
                            choices: ans.choices,
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
        console.log("[Aullevo:Batch] Profile is OFF or paused by the Free plan's profile limit. Batch autofill skipped.");
        chrome.runtime.sendMessage({ action: "BATCH_COMPLETE", total: 0 }).catch(() => { });
        return;
    }
    const { fields: fieldsToInject, files: filesToInject, typingSpeed, useAi, autoPaginate } = ctx;
    // Free: 3 links (10 with the Multi-link ad unlock); the side panel already stops more from being added
    links = links.slice(0, ctx.linkLimit);
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
            // 5. Inject fields + files into the new tab (every page of it with Auto-Pagination, Pro)
            if (autoPaginate) {
                const result = await runAutoPaginate(tab.id, ctx);
                console.log(`[Aullevo:Batch] Tab ${tab.id} auto-pagination: ${result.status}, ${result.totalFilled} inputs over ${result.pages} page(s).`);
                void showPageNotice(tab.id, t => describePaginationRun(result, t));
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }
            const res = await fillTabFrames(tab.id, { fields: fieldsToInject, files: filesToInject, useAi, typingSpeed });
            console.log(`[Aullevo:Batch] Tab ${tab.id} filled ${res.matchedCount ?? 0} inputs.`);
            void showPageNotice(tab.id, t => describeFill(res, t));
            // 6. Pause 1 second before the next link to avoid browser throttling
            await new Promise(r => setTimeout(r, 1000));
        } catch (err) {
            console.error(`[Aullevo:Batch] Failed to autofill link: ${link.url}`, err);
        }
    }
    console.log("[Aullevo:Batch] All batch links finished.");
    chrome.runtime.sendMessage({ action: "BATCH_COMPLETE", total: links.length }).catch(() => { });
}


// ---------------------------------------------------------------------------
// 5. Auto-Pagination Engine (Pro)
// Each step: content.ts fills the page and clicks Next / Continue (Submit on the
// last page) only when no question it must not skip is left empty.
// ---------------------------------------------------------------------------

interface FillPayload {
    fields: unknown[];
    files: unknown[];
    useAi: boolean;
    typingSpeed: unknown;
    // Voice agent: fill only these questions (indices: the AI's picks from the list one frame gave it)
    target?: { texts?: string[]; focused?: boolean; said?: string; value?: string; indices?: number[]; questionTexts?: string[]; frameId?: number };
}

interface FrameProbe {
    frameId: number;
    controls: number;
    hasNext: boolean;
    hasSubmit: boolean;
    signature: string;
}

const PAGINATION_STEP_TIMEOUT_MS = 180_000; // AI + slow typing on a long page
const PAGE_SETTLE_MS = 1200;                // render time after a step change
const PAGE_LOAD_PATIENCE_MS = 20_000;       // a slow next step still gets found
const FRAME_BUTTON_GRACE_MS = 4000;         // fields are there: give Next / Submit a moment to render
const activePaginationTabs = new Set<number>();
const lastPageFillCount = new Map<number, number>();
const lastPageClick = new Map<number, 'next' | 'submit'>();

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// Asks the content script of every frame (same isolated world) how much form it holds
async function probePaginationFrames(tabId: number): Promise<FrameProbe[]> {
    try {
        const results = await withTimeout(chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            injectImmediately: true,
            func: () => {
                const probe = (globalThis as any).__aullevoProbePagination;
                return typeof probe === "function" ? probe() : null;
            }
        }), FRAME_SCRIPT_TIMEOUT_MS, []);
        return results
            .filter(r => r.result)
            .map(r => ({ frameId: r.frameId, ...(r.result as Omit<FrameProbe, 'frameId'>) }));
    } catch {
        return []; // restricted page (chrome://, Web Store), tab closed, or mid-navigation
    }
}

const NO_FRAME_ANSWERED = 'Refresh the tab to connect autofill.';

interface FillTabResult {
    success: boolean;
    matchedCount?: number;
    useAi?: boolean;
    aiNotice?: string;
    error?: string;
    // For the voice agent
    filledLabels?: string[]; // questions filled, by name
    left?: string[];         // questions still empty
    matched?: number;        // targeted fill: questions that matched what was asked for
    stopped?: boolean;
}

const unique = (lists: (string[] | undefined)[]) => Array.from(new Set(lists.flatMap(list => list ?? []))).slice(0, 12);

// Voice agent fill target from the side panel, with every field checked
function voiceTargetFrom(raw: any): FillPayload['target'] {
    return {
        texts: Array.isArray(raw.texts) ? raw.texts.map(String).slice(0, 8) : undefined,
        focused: Boolean(raw.focused),
        said: typeof raw.said === 'string' ? raw.said.slice(0, 300) : undefined,
        value: typeof raw.value === 'string' ? raw.value.slice(0, 2000) : undefined,
        indices: Array.isArray(raw.indices)
            ? raw.indices.filter((i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < 500).slice(0, 8)
            : undefined,
        questionTexts: Array.isArray(raw.questionTexts) ? raw.questionTexts.map(String).slice(0, 8) : undefined,
        frameId: Number.isInteger(raw.frameId) ? raw.frameId : undefined
    };
}

// One fill across every frame that holds a form, with the counts added up. A plain tabs.sendMessage
// reaches all frames but keeps only the FIRST reply: an empty or hidden iframe (ads, embeds, a later
// step's form) answers "0 filled" within milliseconds while the real form is still being typed.
async function fillTabFrames(tabId: number, fill: FillPayload): Promise<FillTabResult> {
    // Extension API calls keep the service worker alive while a long form is being typed
    const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => { }), 20_000);
    try {
        const result = await fillTabFramesNow(tabId, fill);
        if (result.success || result.error !== NO_FRAME_ANSWERED) return result;
        // Nobody answered: usually the page reloaded mid-fill (a dev server's live reload, a site
        // refreshing itself), which also wiped what was typed. Fill the fresh page once more.
        console.warn("[Aullevo] No frame answered the fill; retrying once the page has loaded.");
        if (!(await waitForTabSettled(tabId))) return result;
        await delay(PAGE_SETTLE_MS);
        return await fillTabFramesNow(tabId, fill);
    } finally {
        clearInterval(keepAlive);
    }
}

async function fillTabFramesNow(tabId: number, fill: FillPayload): Promise<FillTabResult> {
    beginAiFillPage(tabId);
    const frames = await probePaginationFrames(tabId);
    const targets = new Set(frames.filter(f => f.controls > 0).map(f => f.frameId));
    targets.add(0); // the page itself always answers (also when the probe could not run)
    // Voice "fill this one": only the frame the user clicked or typed in last
    if (fill.target?.focused) {
        const touched = await lastTouchedFrame(tabId);
        targets.clear();
        targets.add(touched ?? 0);
    }

    // Voice "question 3": counted in the frame that holds the most of the form
    const mainFrameId = [...frames].sort((a, b) => b.controls - a.controls)[0]?.frameId ?? 0;
    // A dictated answer goes in once: into the main form (or the frame clicked, for "answer this with …")
    if (fill.target?.value && !fill.target.focused) {
        targets.clear();
        targets.add(mainFrameId);
    }
    // The AI picked questions from one frame's list: only that frame
    if (typeof fill.target?.frameId === 'number') {
        targets.clear();
        targets.add(fill.target.frameId);
    }
    const message = { action: "INJECT_FORM_FIELDS", fields: fill.fields, files: fill.files, useAi: fill.useAi, typingSpeed: fill.typingSpeed, target: fill.target };
    const send = (frameId: number) => chrome.tabs.sendMessage(tabId, fill.target
        ? { ...message, target: { ...fill.target, mainFrame: frameId === mainFrameId } }
        : message, { frameId }).catch((err) => {
        console.warn(`[Aullevo] Frame ${frameId} did not answer the fill:`, err?.message || err);
        return null;
    });
    const replies: any[] = await Promise.all(Array.from(targets, send));

    // No answer: that frame only holds a copy from before the extension was reloaded (or none).
    // Inject a fresh one and ask again, instead of making the user refresh the page.
    const unanswered = Array.from(targets).filter((_, i) => !replies[i]);
    if (unanswered.length > 0 && await injectContentScript(tabId)) {
        const retried = await Promise.all(unanswered.map(send));
        retried.forEach((reply, i) => { replies[Array.from(targets).indexOf(unanswered[i])] = reply; });
    }

    const filled = replies.filter(r => r?.success);
    if (filled.length === 0) {
        return { success: false, error: replies.find(r => r?.error)?.error || NO_FRAME_ANSWERED };
    }
    return {
        success: true,
        matchedCount: filled.reduce((sum, r) => sum + (r.matchedCount ?? 0), 0),
        useAi: filled.some(r => r.useAi === true),
        aiNotice: filled.find(r => r.aiNotice)?.aiNotice,
        filledLabels: unique(filled.map(r => r.filledLabels)),
        left: unique(filled.map(r => r.left)),
        ...(fill.target ? { matched: filled.reduce((sum, r) => sum + (r.matched ?? 0), 0) } : {}),
        ...(filled.some(r => r.stopped) ? { stopped: true } : {})
    };
}

// The frame the user clicked or typed in most recently (content.ts records it), or null when none was touched
async function lastTouchedFrame(tabId: number): Promise<number | null> {
    try {
        const results = await withTimeout(chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            injectImmediately: true,
            func: () => {
                const read = (globalThis as any).__aullevoLastInteraction;
                return typeof read === "function" ? read() as number : 0;
            }
        }), FRAME_SCRIPT_TIMEOUT_MS, []);
        const best = results
            .filter(r => typeof r.result === 'number' && r.result > 0)
            .sort((a, b) => (b.result as number) - (a.result as number))[0];
        return best ? best.frameId : null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Voice agent: "stop" and "next" / "submit"
// ---------------------------------------------------------------------------

// Tabs whose fill the user asked to stop (auto-pagination checks this before every page)
const cancelledTabs = new Set<number>();

function cancelFill(tabId: number): void {
    cancelledTabs.add(tabId);
    // Every frame stops at the next answer it would have typed
    chrome.tabs.sendMessage(tabId, { action: "CANCEL_FILL" }).catch(() => { });
    setTimeout(() => cancelledTabs.delete(tabId), 60_000);
}

interface AdvanceTabResult {
    action: 'next' | 'submitted' | 'not-submitted' | 'ready-to-submit' | 'blocked' | 'none';
    blockedBy?: string;
}

// Clicks Next (or Submit) once in the frame that holds the form's buttons
async function advanceTab(tabId: number, submit: boolean): Promise<AdvanceTabResult> {
    const frame = await findPaginationFrame(tabId, 3000);
    if (!frame || (!frame.hasNext && !frame.hasSubmit)) return { action: 'none' };
    const reply = await sendPaginationStep(tabId, frame.frameId, { action: "ADVANCE_PAGE", submit });
    const result = reply.result as unknown as AdvanceTabResult | undefined;
    // No reply: the click loaded a new page, which ended the content script before it could answer
    if (reply.disconnected) return { action: submit && !frame.hasNext ? 'submitted' : 'next' };
    if (reply.timedOut || !result?.action) return { action: 'none' };
    return result;
}

// The frame with a Next button, else Submit, else the most fields. Waits for slow pages:
// up to waitMs while nothing shows, and a few more seconds for buttons once fields have rendered.
// Frames with only a button count too (e.g. Indeed's "Apply anyway" page has no fields).
async function findPaginationFrame(tabId: number, waitMs: number): Promise<FrameProbe | null> {
    const rank = (f: FrameProbe) => (f.hasNext ? 100_000 : 0) + (f.hasSubmit ? 50_000 : 0) + f.controls;
    const deadline = Date.now() + waitMs;
    let fieldsSeenAt = 0;
    for (;;) {
        const frames = (await probePaginationFrames(tabId))
            .filter(f => f.controls > 0 || f.hasNext || f.hasSubmit)
            .sort((a, b) => rank(b) - rank(a));
        const best = frames[0] ?? null;
        if (best && (best.hasNext || best.hasSubmit)) return best;
        if (best && !fieldsSeenAt) fieldsSeenAt = Date.now();
        const buttonsGraceOver = fieldsSeenAt > 0 && Date.now() - fieldsSeenAt >= FRAME_BUTTON_GRACE_MS;
        if (buttonsGraceOver || Date.now() >= deadline) return best;
        await delay(700);
    }
}

function watchTabNavigation(tabId: number) {
    let navigated = false;
    const listener = (id: number, info: { status?: string; url?: string }) => {
        if (id === tabId && (info.status === 'loading' || info.url)) navigated = true;
    };
    chrome.tabs.onUpdated.addListener(listener);
    return {
        get navigated() { return navigated; },
        stop: () => chrome.tabs.onUpdated.removeListener(listener)
    };
}

// False when the tab was closed. Polls: a get-then-listen pair can miss a 'complete' that lands in between.
async function waitForTabSettled(tabId: number, timeoutMs = 25000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    try {
        while ((await chrome.tabs.get(tabId)).status !== 'complete' && Date.now() < deadline) {
            await delay(250);
        }
        return true;
    } catch {
        return false;
    }
}

function sendPaginationStep(tabId: number, frameId: number, message: object): Promise<{ result?: PaginationStepResult; disconnected: boolean; timedOut: boolean }> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ disconnected: false, timedOut: true }), PAGINATION_STEP_TIMEOUT_MS);
        chrome.tabs.sendMessage(tabId, message, { frameId }, (res?: PaginationStepResult) => {
            clearTimeout(timer);
            // No reply: the page unloaded (Next loaded a new page) or the frame went away
            const lost = Boolean(chrome.runtime.lastError) || !res;
            resolve({ result: lost ? undefined : res, disconnected: lost, timedOut: false });
        });
    });
}

async function runAutoPaginate(tabId: number, fill: FillPayload): Promise<PaginationRunResult> {
    if (activePaginationTabs.has(tabId)) {
        return { success: false, status: 'error', pages: 0, totalFilled: 0, error: 'Auto-pagination is already running on this tab.' };
    }
    activePaginationTabs.add(tabId);
    cancelledTabs.delete(tabId);
    // Extension API calls keep the service worker alive while a long page is being filled
    const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => { }), 20_000);

    const fillMessage = { fields: fill.fields, files: fill.files, useAi: fill.useAi, typingSpeed: fill.typingSpeed };
    let totalFilled = 0;
    let repaired = 0;
    let useAi = fill.useAi;
    let aiNotice: string | undefined;
    let lastSignature = '';

    try {
        for (let page = 1; page <= AUTO_PAGINATE_MAX_PAGES; page++) {
            if (cancelledTabs.has(tabId)) {
                return { success: false, status: 'stopped', pages: page - 1, totalFilled, useAi, aiNotice, error: 'Stopped by you.' };
            }
            const frame = await findPaginationFrame(tabId, PAGE_LOAD_PATIENCE_MS);
            if (!frame) {
                return page === 1
                    ? { success: false, status: 'no-form', pages: 0, totalFilled, error: 'No form found on this page (or Aullevo cannot run here).' }
                    : { success: true, status: 'no-next', pages: page - 1, totalFilled, useAi, aiNotice }; // e.g. a confirmation screen
            }

            // Single-page form: the usual fill in every frame
            if (page === 1 && !frame.hasNext && !frame.hasSubmit) {
                const res = await fillTabFrames(tabId, fill);
                return {
                    success: res.success,
                    status: res.success ? 'no-next' : 'error',
                    pages: 1,
                    totalFilled: res.matchedCount ?? 0,
                    useAi: res.useAi ?? useAi,
                    aiNotice: res.aiNotice,
                    error: res.error
                };
            }

            // Same fields as before the click: the page did not really move on
            if (page > 1 && frame.signature === lastSignature) {
                return { success: false, status: 'stuck', pages: page - 1, totalFilled, useAi, aiNotice };
            }
            lastSignature = frame.signature;

            chrome.runtime.sendMessage({ action: "PAGINATION_PROGRESS", tabId, page, totalFilled }).catch(() => { });

            lastPageFillCount.delete(tabId);
            lastPageClick.delete(tabId);
            const nav = watchTabNavigation(tabId);
            beginAiFillPage(tabId);
            const reply = await sendPaginationStep(tabId, frame.frameId, {
                action: "AUTO_PAGINATE_STEP",
                ...fillMessage,
                advance: page < AUTO_PAGINATE_MAX_PAGES
            });
            nav.stop();

            const result = reply.result;
            if (!result) totalFilled += lastPageFillCount.get(tabId) ?? 0;
            if (result) {
                totalFilled += result.matchedCount ?? 0;
                repaired += result.repaired ?? 0;
                if (typeof result.useAi === 'boolean') useAi = result.useAi;
                if (result.aiNotice) aiNotice = result.aiNotice;
            }
            if (reply.timedOut) {
                return { success: false, status: 'error', pages: page, totalFilled, useAi, aiNotice, error: 'The page took too long to respond.' };
            }

            const status = result?.pagination?.status;
            if (status === 'stopped') {
                return { success: false, status, pages: page, totalFilled, useAi, aiNotice, error: 'Stopped by you.' };
            }

            // Submit loaded a confirmation page (e.g. Google Forms): done
            if (reply.disconnected && lastPageClick.get(tabId) === 'submit') {
                return { success: true, status: 'submitted', pages: page, totalFilled, repaired, useAi, aiNotice };
            }
            if (reply.disconnected || status === 'advanced' || (status === 'stuck' && nav.navigated)) {
                if (!(await waitForTabSettled(tabId))) {
                    return { success: false, status: 'error', pages: page, totalFilled, useAi, aiNotice, error: 'The tab was closed.' };
                }
                await delay(PAGE_SETTLE_MS);
                continue;
            }

            return {
                success: status === 'submitted' || status === 'no-next',
                status: status ?? 'error',
                pages: page,
                totalFilled,
                repaired,
                useAi,
                aiNotice,
                blockers: result?.pagination.blockers,
                buttonLabel: result?.pagination.buttonLabel,
                errorText: result?.pagination.errorText,
                serverStatus: result?.pagination.serverStatus,
                error: result?.error
            };
        }
        return { success: false, status: 'max-pages', pages: AUTO_PAGINATE_MAX_PAGES, totalFilled, useAi, aiNotice };
    } finally {
        clearInterval(keepAlive);
        activePaginationTabs.delete(tabId);
        lastPageFillCount.delete(tabId);
        lastPageClick.delete(tabId);
    }
}

