import { useState, useEffect, useCallback } from 'react';
import type { UserData, CM, ProfileFile } from '../types';
import { getProfileCustomFields } from '../types';
import { effectiveTypingDelay, filesAllowedForPlan } from '../services/tier';

// Tab Change Type Definition (extracting the exact Chrome event parameter)
export type TabChangeInfo = Parameters<Parameters<typeof chrome.tabs.onUpdated.addListener>[0]>[1];

export function useExtensionBridge(
    currentProfile: UserData | undefined,
    useAiFill: boolean,
    typingSpeed: number = 25,
    isPro: boolean = false,
    isPage: boolean = false // full options page: no side-panel port, no active-tab scanning
) {
    const [detectedFields, setDetectedFields] = useState<string>('0');
    const [isHighlighting, setIsHighlighting] = useState<boolean>(false);
    const [isFilling, setIsFilling] = useState<boolean>(false);
    const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null);

    // Toast Notification Helper
    const showStatus = (text: string, type: 'info' | 'success' | 'error', duration = 3000) => {
        setStatusMessage({ text, type });
        setTimeout(() => setStatusMessage(null), duration);
    };

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
    const checkActiveTabFields = useCallback(async () => {
        try {
            const tab = await getActiveTab();
            if (!tab?.id) {
                setDetectedFields('0');
                setIsHighlighting(false);
                return;
            }
            chrome.tabs.sendMessage(tab.id, { action: 'RESCAN' }, (res) => {
                if (chrome.runtime.lastError || !res) {
                    setDetectedFields('0');
                    setIsHighlighting(false);
                    return;
                }
                setDetectedFields(String(res.fieldsCount ?? 0));
                if (res.isHighlighting !== undefined) {
                    setIsHighlighting(res.isHighlighting);
                }
            });
        } catch {
            setDetectedFields('0');
            setIsHighlighting(false);
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
    // -------------------------------------------------------------------
    const handleToggleHighlight = async () => {
        try {
            const tab = await getActiveTab();
            if (!tab?.id) {
                showStatus('No active tab found.', 'error');
                return;
            }
            chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_HIGHLIGHT_FIELDS' }, (res) => {
                if (chrome.runtime.lastError) {
                    console.warn('[Aullevo:Bridge] Message error:', chrome.runtime.lastError.message);
                    showStatus('Refresh the page to connect highlights.', 'error');
                    return;
                }
                if (res && res.active !== undefined) {
                    setIsHighlighting(res.active);
                    if (res.active) {
                        showStatus(`Highlighted ${res.count} fields on page!`, 'info');
                        setDetectedFields(String(res.count));
                    } else {
                        showStatus('Highlights cleared.', 'info');
                        checkActiveTabFields();
                    }
                }
            });
        } catch (err) {
            console.error('[Aullevo:Bridge] Failed to toggle highlights:', err);
        }
    };

    const triggerFormFill = async () => {
        if (!currentProfile || !currentProfile.enabled) {
            showStatus(`${currentProfile?.profileType?.toUpperCase() || 'PROFILE'} is disabled. Turn it ON to autofill.`, 'error');
            return;
        }

        setIsFilling(true);
        showStatus(
            useAiFill
                ? `Injecting fields with AI (${currentProfile.profileType.toUpperCase()})...`
                : `Injecting fields (${currentProfile.profileType.toUpperCase()})...`,
            'info'
        );

        try {
            const tab = await getActiveTab();
            if (!tab?.id) {
                showStatus('Could not reach active tab.', 'error');
                setIsFilling(false);
                return;
            }

            const fieldsToInject = getProfileCustomFields(currentProfile).filter((f: CM) => f.enabled);
            const enabledFiles = (currentProfile.files || []).filter((f: ProfileFile) => f.enabled);
            // Plan limits: document injection and Slow/custom speeds are Pro-only
            const filesToInject = filesAllowedForPlan(enabledFiles, isPro);
            const skippedFilesNote = enabledFiles.length > filesToInject.length
                ? ` ${enabledFiles.length} document(s) not attached: upload into forms is a Pro feature.`
                : '';
            chrome.tabs.sendMessage(tab.id, {
                action: 'INJECT_FORM_FIELDS',
                fields: fieldsToInject,
                files: filesToInject,
                useAi: useAiFill,
                typingSpeed: effectiveTypingDelay(typingSpeed, isPro)
            }, (res) => {
                setIsFilling(false);
                if (chrome.runtime.lastError) {
                    console.warn('[Aullevo:Bridge] Message error:', chrome.runtime.lastError.message);
                    showStatus('Refresh the tab to connect autofill.', 'error');
                    return;
                }
                if (res && res.success) {
                    const count = res.matchedCount ?? res.filledCount ?? fieldsToInject.length;
                    // Report what actually ran: content.ts falls back to keyword mode when AI is unavailable
                    const usedAi = typeof res.useAi === 'boolean' ? res.useAi : useAiFill;
                    if (res.aiNotice) {
                        const mode = usedAi ? 'AI partly skipped' : 'keyword mode';
                        showStatus(`Filled ${count} inputs (${mode}). ${res.aiNotice}${skippedFilesNote}`, 'error', 7000);
                    } else if (skippedFilesNote) {
                        const mode = usedAi ? 'with AI' : 'without AI';
                        showStatus(`Form filled ${mode} (${count} inputs matched).${skippedFilesNote}`, 'info', 6000);
                    } else {
                        const mode = usedAi ? 'with AI' : 'without AI';
                        showStatus(`Form filled ${mode} (${count} inputs matched).`, 'success', 4000);
                    }
                } else if (res && res.error) {
                    showStatus(`Fill error: ${res.error}`, 'error', 4000);
                } else {
                    showStatus(`Injected ${fieldsToInject.length} fields into page.`, 'success', 4000);
                }
            });
        } catch {
            setIsFilling(false);
            showStatus('Could not connect to page. Refresh the tab.', 'error');
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
        handleClosePanel
    };
}
