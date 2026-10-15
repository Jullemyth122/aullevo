import { useState, useEffect, useCallback, useRef } from 'react';
import type { UserData, CM, ProfileFile } from '../types';
import { getProfileCustomFields } from '../types';
import { effectiveTypingDelay, filesAllowedForPlan, autoPaginateAllowed } from '../services/tier';
import type { PaginationRunResult } from '../services/pagination';
import { describePaginationRun } from '../services/runText';
import type { PlanAccess } from '../services/rewards';
import { t } from '../i18n';
import type { AdvanceResult, FillOutcome, FillTarget } from '../voice/types';

// Tab Change Type Definition (extracting the exact Chrome event parameter)
export type TabChangeInfo = Parameters<Parameters<typeof chrome.tabs.onUpdated.addListener>[0]>[1];

export function useExtensionBridge(
    currentProfile: UserData | undefined,
    useAiFill: boolean,
    typingSpeed: number = 25,
    isPro: boolean = false,
    isPage: boolean = false, // full options page: no side-panel port, no active-tab scanning
    autoPaginate: boolean = false,
    access?: PlanAccess // Free plan: features unlocked with a short ad (rewards.ts)
) {
    const [detectedFields, setDetectedFields] = useState<string>('0');
    const [isHighlighting, setIsHighlighting] = useState<boolean>(false);
    const [isFilling, setIsFilling] = useState<boolean>(false);
    const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null);

    // Toast Notification Helper (a newer message cancels the older one's timer)
    const statusTimer = useRef<number | undefined>(undefined);
    const showStatus = useCallback((text: string, type: 'info' | 'success' | 'error', duration = 3000) => {
        setStatusMessage({ text, type });
        window.clearTimeout(statusTimer.current);
        statusTimer.current = window.setTimeout(() => setStatusMessage(null), duration);
    }, []);

    // Auto-pagination progress from background.ts for the tab being filled
    const paginatingTabId = useRef<number | null>(null);
    // The tab a fill is running in (voice "stop" cancels it there, even after switching tabs)
    const fillingTabId = useRef<number | null>(null);
    useEffect(() => {
        const handleProgress = (message: any) => {
            if (message?.action !== 'PAGINATION_PROGRESS' || message.tabId !== paginatingTabId.current) return;
            showStatus(t('status.pagination.progress', { page: message.page }), 'info', 120000);
        };
        chrome.runtime?.onMessage?.addListener(handleProgress);
        return () => chrome.runtime?.onMessage?.removeListener(handleProgress);
    }, [showStatus]);

    // Helper to query active tab (supports Side Panel window context)
    const getActiveTab = async (): Promise<chrome.tabs.Tab | undefined> => {
        try {
            const [focusedTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (focusedTab?.id) return focusedTab;
            const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            return currentTab;
        } catch {
            return undefined;
        }
    };

    // Rescan fields on the active webpage
    // Resolves with the number of fields found (0 when the page can't be reached)
    const checkActiveTabFields = useCallback(async (): Promise<number> => {
        try {
            const tab = await getActiveTab();
            if (!tab?.id) {
                setDetectedFields('0');
                setIsHighlighting(false);
                return 0;
            }
            return await new Promise<number>(resolve => chrome.tabs.sendMessage(tab.id!, { action: 'RESCAN' }, (res) => {
                if (chrome.runtime.lastError || !res) {
                    setDetectedFields('0');
                    setIsHighlighting(false);
                    resolve(0);
                    return;
                }
                setDetectedFields(String(res.fieldsCount ?? 0));
                if (res.isHighlighting !== undefined) {
                    setIsHighlighting(res.isHighlighting);
                }
                resolve(Number(res.fieldsCount) || 0);
            }));
        } catch {
            setDetectedFields('0');
            setIsHighlighting(false);
            return 0;
        }
    }, []);

    // -------------------------------------------------------------------
    // Lifecycle: Background Port & Tab Listeners (TabChangeInfo used here!)
    // -------------------------------------------------------------------
    useEffect(() => {
        // The side-panel port tells background.ts the panel is open; closing it disables the panel.
        // The options page must not pretend to be the side panel.
        if (isPage) return;

        let isMounted = true;
        let port: chrome.runtime.Port | null = null;

        // 1. Connect port to background worker
        chrome.windows?.getCurrent((currentWindow) => {
            if (!isMounted) return;
            const windowId = currentWindow?.id;
            if (windowId && chrome.runtime?.connect) {
                port = chrome.runtime.connect({ name: `sidepanel-${windowId}` });
            }
        });

        // 2. Initial field scan
        checkActiveTabFields();

        // 3. Tab switched
        const handleTabActivated = () => {
            checkActiveTabFields();
        };

        // 4. Tab updated/refreshed (Using your TabChangeInfo!)
        const handleTabUpdated = (_tabId: number, changeInfo: TabChangeInfo) => {
            if (changeInfo.status === 'complete') {
                checkActiveTabFields();
            }
        };

        chrome.tabs?.onActivated?.addListener(handleTabActivated);
        chrome.tabs?.onUpdated?.addListener(handleTabUpdated);

        return () => {
            isMounted = false;
            port?.disconnect();
            chrome.tabs?.onActivated?.removeListener(handleTabActivated);
            chrome.tabs?.onUpdated?.removeListener(handleTabUpdated);
        };
    }, [checkActiveTabFields, isPage]);

    // -------------------------------------------------------------------
    // Actions: Highlights, Form Injection, and Close Panel
    // (each one also resolves with its result, so the voice agent can say what happened)
    // -------------------------------------------------------------------
    // `turnOn` (voice "highlight" / "clear highlights"): only toggles when the page isn't in that state yet
    const handleToggleHighlight = async (turnOn?: boolean): Promise<{ active: boolean; count: number } | null> => {
        try {
            const tab = await getActiveTab();
            if (!tab?.id) {
                showStatus(t('status.highlight.noActiveTab'), 'error');
                return null;
            }
            const tabId = tab.id;
            if (turnOn !== undefined) {
                const state = await new Promise<any>(resolve =>
                    chrome.tabs.sendMessage(tabId, { action: 'RESCAN' }, (res) => resolve(chrome.runtime.lastError ? null : res)));
                if (state && Boolean(state.isHighlighting) === turnOn) {
                    return { active: turnOn, count: Number(state.fieldsCount) || 0 };
                }
            }
            return await new Promise(resolve => chrome.tabs.sendMessage(tabId, { action: 'TOGGLE_HIGHLIGHT_FIELDS' }, (res) => {
                if (chrome.runtime.lastError) {
                    console.warn('[Aullevo:Bridge] Message error:', chrome.runtime.lastError.message);
                    showStatus(t('status.highlight.refreshToConnect'), 'error');
                    resolve(null);
                    return;
                }
                if (res && res.active !== undefined) {
                    setIsHighlighting(res.active);
                    if (res.active) {
                        showStatus(t('status.highlight.on', { count: Number(res.count) || 0 }), 'info');
                        setDetectedFields(String(res.count));
                    } else {
                        showStatus(t('status.highlight.cleared'), 'info');
                        checkActiveTabFields();
                    }
                    resolve({ active: Boolean(res.active), count: Number(res.count) || 0 });
                    return;
                }
                resolve(null);
            }));
        } catch (err) {
            console.error('[Aullevo:Bridge] Failed to toggle highlights:', err);
            return null;
        }
    };

    // options.target (voice): fill only the questions named, or the one clicked. options.paginate overrides the setting.
    const triggerFormFill = async (options: { target?: FillTarget; paginate?: boolean } = {}): Promise<FillOutcome> => {
        const fail = (error: string): FillOutcome => ({ ok: false, filled: 0, usedAi: false, filledLabels: [], left: [], error });
        if (!currentProfile || !currentProfile.enabled) {
            showStatus(t('status.profile.disabled', { type: currentProfile?.profileType?.toUpperCase() || t('status.profile.defaultType') }), 'error');
            return fail('The profile is switched off.');
        }

        setIsFilling(true);
        showStatus(
            useAiFill
                ? t('status.fill.injectingAi', { type: currentProfile.profileType.toUpperCase() })
                : t('status.fill.injecting', { type: currentProfile.profileType.toUpperCase() }),
            'info'
        );

        try {
            const tab = await getActiveTab();
            if (!tab?.id) {
                showStatus(t('status.fill.noTab'), 'error');
                setIsFilling(false);
                return fail('No web page is open.');
            }
            const tabId = tab.id;
            fillingTabId.current = tabId;

            const fieldsToInject = getProfileCustomFields(currentProfile).filter((f: CM) => f.enabled);
            const enabledFiles = (currentProfile.files || []).filter((f: ProfileFile) => f.enabled);
            // Plan limits: document injection and Slow/custom speeds are Pro-only
            const filesToInject = filesAllowedForPlan(enabledFiles, isPro);
            const skippedFilesNote = enabledFiles.length > filesToInject.length
                ? ` ${t('status.plan.documentsSkipped', { count: enabledFiles.length })}`
                : '';
            const paginate = !options.target && (options.paginate ?? autoPaginateAllowed(autoPaginate, isPro || Boolean(access?.paginate)));

            // Pro: background.ts fills page after page (Next / Continue), then presses Submit
            if (paginate) {
                paginatingTabId.current = tabId;
                return await new Promise<FillOutcome>(resolve => chrome.runtime.sendMessage({
                    action: 'START_AUTO_PAGINATE',
                    tabId,
                    fields: fieldsToInject,
                    files: filesToInject,
                    useAi: useAiFill,
                    typingSpeed: effectiveTypingDelay(typingSpeed, isPro || Boolean(access?.typing))
                }, (res?: PaginationRunResult) => {
                    paginatingTabId.current = null;
                    fillingTabId.current = null;
                    setIsFilling(false);
                    if (chrome.runtime.lastError || !res) {
                        showStatus(t('status.pagination.lostConnection'), 'error', 5000);
                        resolve(fail('Lost the connection to the page.'));
                        return;
                    }
                    const { text, type } = describePaginationRun(res, t);
                    const notes = `${res.aiNotice ? ` ${res.aiNotice}` : ''}${skippedFilesNote}`;
                    showStatus(text + notes, notes && type === 'success' ? 'info' : type, 9000);
                    resolve({
                        ok: res.success || res.status === 'blocked' || res.status === 'max-pages',
                        filled: res.totalFilled,
                        usedAi: Boolean(res.useAi),
                        filledLabels: [],
                        left: (res.blockers ?? []).map(b => b.name),
                        notice: res.aiNotice,
                        error: res.error || res.errorText || (res.status === 'no-form' ? 'No form found on this page.' : undefined),
                        stopped: res.status === 'stopped',
                        pages: res.pages,
                        pageStatus: res.status,
                        blockedBy: res.status === 'blocked' ? res.blockers?.[0]?.name : undefined
                    });
                }));
            }
            // background.ts fills every frame that holds a form and adds up the counts
            return await new Promise<FillOutcome>(resolve => chrome.runtime.sendMessage({
                action: 'FILL_TAB',
                tabId,
                fields: fieldsToInject,
                files: filesToInject,
                useAi: useAiFill,
                typingSpeed: effectiveTypingDelay(typingSpeed, isPro || Boolean(access?.typing)),
                target: options.target
            }, (res) => {
                setIsFilling(false);
                fillingTabId.current = null;
                if (chrome.runtime.lastError) {
                    console.warn('[Aullevo:Bridge] Message error:', chrome.runtime.lastError.message);
                    showStatus(t('status.fill.refreshToConnect'), 'error');
                    resolve(fail('Refresh the page to connect autofill.'));
                    return;
                }
                const count = res?.matchedCount ?? res?.filledCount ?? fieldsToInject.length;
                // Report what actually ran: content.ts falls back to keyword mode when AI is unavailable
                const usedAi = typeof res?.useAi === 'boolean' ? res.useAi : useAiFill;
                if (res && res.success) {
                    if (res.aiNotice) {
                        const filled = usedAi
                            ? t('status.fill.aiPartlySkipped', { count })
                            : t('status.fill.keywordMode', { count });
                        showStatus(`${filled} ${res.aiNotice}${skippedFilesNote}`, 'error', 7000);
                    } else if (skippedFilesNote) {
                        const filled = usedAi ? t('status.fill.withAi', { count }) : t('status.fill.withoutAi', { count });
                        showStatus(`${filled}${skippedFilesNote}`, 'info', 6000);
                    } else {
                        const filled = usedAi ? t('status.fill.withAi', { count }) : t('status.fill.withoutAi', { count });
                        showStatus(filled, 'success', 4000);
                    }
                } else if (res && res.error) {
                    showStatus(t('status.fill.error', { error: String(res.error) }), 'error', 4000);
                    resolve(fail(String(res.error)));
                    return;
                } else {
                    showStatus(t('status.fill.injected', { count: fieldsToInject.length }), 'success', 4000);
                }
                resolve({
                    ok: true,
                    filled: count,
                    usedAi,
                    filledLabels: Array.isArray(res?.filledLabels) ? res.filledLabels : [],
                    left: Array.isArray(res?.left) ? res.left : [],
                    notice: res?.aiNotice,
                    stopped: Boolean(res?.stopped),
                    ...(options.target ? {
                        target: options.target.focused ? 'this field' : (options.target.texts ?? []).join(', '),
                        matched: Number(res?.matched) || 0
                    } : {})
                });
            }));
        } catch {
            setIsFilling(false);
            fillingTabId.current = null;
            showStatus(t('status.fill.cannotConnect'), 'error');
            return fail('Cannot connect to this page.');
        }
    };

    // Voice "stop": ends the fill running in the tab it started on. False when there is no tab to stop.
    const cancelFormFill = async (): Promise<boolean> => {
        const tabId = fillingTabId.current ?? (await getActiveTab())?.id;
        if (tabId === undefined) return false;
        chrome.runtime.sendMessage({ action: 'CANCEL_FILL', tabId }).catch(() => { });
        return true;
    };

    // Voice "next" / "submit": clicks the form's button once
    const advanceForm = async (submit: boolean): Promise<AdvanceResult> => {
        const tab = await getActiveTab();
        if (!tab?.id) return { action: 'none' };
        try {
            const res = await chrome.runtime.sendMessage({ action: 'ADVANCE_TAB', tabId: tab.id, submit });
            return res?.action ? res as AdvanceResult : { action: 'none' };
        } catch {
            return { action: 'none' };
        }
    };

    const handleClosePanel = () => {
        chrome.runtime?.sendMessage?.({ action: 'CLOSE_PANEL' }).catch(() => { });
        try {
            window.close();
        } catch { }
    };

    return {
        detectedFields,
        isHighlighting,
        isFilling,
        statusMessage,
        setStatusMessage,
        showStatus,
        checkActiveTabFields,
        handleToggleHighlight,
        triggerFormFill,
        cancelFormFill,
        advanceForm,
        getActiveTab,
        handleClosePanel
    };
}
