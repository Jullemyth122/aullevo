import { useState, useEffect, useRef, useMemo } from 'react';
import './styles/sidebar.scss';

// types core

import {
    getProfileCustomFields,
} from './types';
import type { SavedLink } from './types';

import { JsonConfigModal } from './components/JsonConfigModal';

// profile storage and function
import { useProfileStorage } from './hooks/useProfileStorage';

// extension to bridge with hooks
import { useExtensionBridge } from './hooks/useExtensionBridge';

// profile management
import { useProfileManager } from './hooks/useProfileManager';

// account sync with aullevo-web (plan status only)
import { useAccount } from './hooks/useAccount';
import { autoPaginateAllowed, pausedProfileKeys } from './services/tier';
import { planAccess, FREE_LINK_LIMIT, UNLOCKED_LINK_LIMIT } from './services/rewards';
import { useRewards, PlanRewardsContext, type PlanRewards } from './hooks/useRewards';
import { AUTO_PAGINATE_STORAGE_KEY } from './services/pagination';
import { useT } from './i18n';
import { OWNER_SCOPED_KEYS, getScopedKey } from './services/owner';
import { getTourState, markTourSeen, dismissTours, resetTours, hasProfileData } from './services/tour';


import { Header } from './components/layout/Header';
import { NavTabs, type ActiveTab } from './components/layout/NavTabs';
import { StatusBanner } from './components/layout/StatusBanner';
import { Footer } from './components/layout/Footer';
import { AutofillTab } from './components/tabs/AutoFillTab';
import { SettingsTab } from './components/tabs/SettingsTab';
import { ProfilesTab } from './components/tabs/ProfilesTab';
import { MultiLinkTab } from './components/tabs/MultiLinkTab';
import { GuidedTour } from './components/tour/GuidedTour';
import { getTourSteps } from './components/tour/tourSteps';
import { VoiceView, type VoiceActions } from './voice/VoiceView';
import { PANEL_MODE_KEY, type PanelMode } from './voice/settings';


interface AppProps {
    // 'panel' = browser side panel, 'page' = full options page (no Autofill tab: it needs the page being filled)
    layout?: 'panel' | 'page';
}

export default function App({ layout = 'panel' }: AppProps) {
    const isPage = layout === 'page';
    const { t, language } = useT();

    const [activeTab, setActiveTab] = useState<'fill' | 'profiles' | 'multilink' | 'settings'>(isPage ? 'profiles' : 'fill');
    // Side panel: Classic (tabs) or Voice (the agent orb). Both use the same profiles and actions.
    const [panelMode, setPanelMode] = useState<PanelMode>('classic');
    useEffect(() => {
        if (isPage) return;
        chrome.storage?.local?.get([PANEL_MODE_KEY], (res) => {
            if (res[PANEL_MODE_KEY] === 'voice') setPanelMode('voice');
        });
    }, [isPage]);
    const changePanelMode = (mode: PanelMode) => {
        setPanelMode(mode);
        chrome.storage?.local?.set({ [PANEL_MODE_KEY]: mode });
    };
    // The guided tour walks the classic tabs: while it runs the panel shows them, then returns to Voice mode
    const [isTourOpen, setIsTourOpen] = useState<boolean>(false);
    const isVoice = !isPage && panelMode === 'voice' && !isTourOpen;
    // Default to 25ms (Natural) or 0ms (Instant)
    const [typingDelayMs, setTypingDelayMs] = useState<number>(25);

    const [savedLinks, setSavedLinks] = useState<SavedLink[]>([]);
    const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);

    const [showFloatingIcon, setShowFloatingIcon] = useState<boolean>(true);

    // Auto-pagination (Pro): off by default
    const [autoPaginate, setAutoPaginate] = useState<boolean>(false);
    useEffect(() => {
        chrome.storage?.local?.get([AUTO_PAGINATE_STORAGE_KEY], (res) => {
            if (typeof res[AUTO_PAGINATE_STORAGE_KEY] === 'boolean') {
                setAutoPaginate(res[AUTO_PAGINATE_STORAGE_KEY]);
            }
        });
    }, []);

    // Hydrate floating icon toggle on mount
    useEffect(() => {
        chrome.storage?.local?.get(['aullevo_show_floating_icon'], (res) => {
            if (typeof res.aullevo_show_floating_icon === 'boolean') {
                setShowFloatingIcon(res.aullevo_show_floating_icon);
            }
        });
    }, []);

    const handleToggleFloatingIcon = () => {
        const next = !showFloatingIcon;
        setShowFloatingIcon(next);
        chrome.storage?.local?.set({ aullevo_show_floating_icon: next });
    };


    // Link queue belongs to the connected account (App remounts when the account changes, see VaultGate)
    const linksKeyRef = useRef<string>(OWNER_SCOPED_KEYS.links);
    const saveLinks = (links: SavedLink[]) => {
        chrome.storage?.local?.set({ [linksKeyRef.current]: links });
    };

    // Hydrate saved links on mount:
    useEffect(() => {
        getScopedKey(OWNER_SCOPED_KEYS.links).then((key) => {
            linksKeyRef.current = key;
            chrome.storage?.local?.get([key], (res) => {
                if (Array.isArray(res[key])) {
                    setSavedLinks(res[key] as SavedLink[]);
                }
            });
        });
    }, []);

    // Handlers for link queue (supports single OR multiple pasted links)
    const handleAddLink = (rawInput: string) => {
        // Split by newlines so you can paste multiple links at once
        const urls = rawInput.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
        if (urls.length === 0) return;

        const newItems: SavedLink[] = urls.map((rawUrl, idx) => {
            const validUrl = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
                ? rawUrl
                : `https://${rawUrl}`;

            let hostname = validUrl;
            try {
                hostname = new URL(validUrl).hostname;
            } catch { }

            return {
                id: 'link_' + (Date.now() + idx),
                url: validUrl,
                title: hostname,
                enabled: true,
                createdAt: new Date().toISOString()
            };
        });

        // Free plan: 5 links, no limit during a pass (2 short ads, 5 hours) or with Pro
        const room = Math.max(0, access.linkLimit - savedLinks.length);
        if (newItems.length > room) {
            showStatus(t('rewards.status.linkLimit', { max: FREE_LINK_LIMIT, unlocked: UNLOCKED_LINK_LIMIT }), 'error', 6000);
        }
        if (room === 0) return;
        const updated = [...newItems.slice(0, room), ...savedLinks];
        setSavedLinks(updated);
        saveLinks(updated);
    };

    // Starts the Multi-Link batch fill; returns how many links it started
    const startBatchFill = (): number => {
        const enabledLinks = savedLinks.filter(l => l.enabled).slice(0, access.linkLimit);
        if (enabledLinks.length === 0) return 0;
        setIsBatchRunning(true);
        showStatus(t('status.batch.starting', { count: enabledLinks.length }), 'info');
        chrome.runtime?.sendMessage?.({
            action: 'START_BATCH_FILL',
            links: enabledLinks
        });
        return enabledLinks.length;
    };

    const handleClearAllLinks = () => {
        setSavedLinks([]);
        saveLinks([]);
    };


    const handleToggleLink = (id: string) => {
        const updated = savedLinks.map(l => l.id === id ? { ...l, enabled: !l.enabled } : l);
        setSavedLinks(updated);
        saveLinks(updated);
    };

    const handleDeleteLink = (id: string) => {
        const updated = savedLinks.filter(l => l.id !== id);
        setSavedLinks(updated);
        saveLinks(updated);
    };

    // Hydrate from storage on mount (optional persistence):
    useEffect(() => {
        chrome.storage?.local?.get(['aullevo_typing_delay'], (res) => {
            if (typeof res.aullevo_typing_delay === 'number') {
                setTypingDelayMs(res.aullevo_typing_delay);
            }
        });
    }, []);

    // Update handler that also saves to storage:
    const handleUpdateTypingDelay = (ms: number) => {
        setTypingDelayMs(ms);
        chrome.storage?.local?.set({ aullevo_typing_delay: ms });
    };


    // JSON Modal
    const [isJsonModalOpen, setIsJsonModalOpen] = useState<boolean>(false);

    // profiles holds all profiles keyed by their profileType string

    // Debounced auto-save (ref-based, no keystroke churn), mount hydration
    const { profiles, setProfiles, selectedProfileType, setSelectedProfileType, currentProfile, isLoaded, isDark, toggleTheme, useAiFill, toggleAiFill, handleSaveProfile } = useProfileStorage();

    // Signed-in account & Free/Pro plan
    const accountState = useAccount();
    const { isPro } = accountState;

    // Free plan: short ads on aullevo-web unlock features on the account for a few hours (services/rewards.ts)
    const rewards = useRewards(accountState.account?.uid);
    const access = planAccess(isPro, rewards.cache);
    const planRewards = useMemo<PlanRewards>(() => ({
        cache: rewards.cache,
        access: planAccess(isPro, rewards.cache),
        isPro,
        signedIn: Boolean(accountState.account),
        openUnlock: rewards.openUnlock,
        consume: rewards.consume,
        connect: accountState.connect
    }), [rewards.cache, rewards.openUnlock, rewards.consume, isPro, accountState.account, accountState.connect]);

    // Tab lifecycle, ports to background.ts, content.ts messaging
    const {
        detectedFields,
        isHighlighting,
        isFilling,
        statusMessage,
        showStatus,
        checkActiveTabFields,
        handleToggleHighlight,
        triggerFormFill,
        cancelFormFill,
        advanceForm,
        getActiveTab,
        handleClosePanel
    } = useExtensionBridge(currentProfile, useAiFill, typingDelayMs, isPro, isPage, autoPaginate, access);

    const handleToggleAutoPaginate = () => {
        if (!isPro && !access.paginate) {
            showStatus(t('rewards.status.paginateLocked'), 'error', 6000);
            return;
        }
        const next = !autoPaginate;
        setAutoPaginate(next);
        chrome.storage?.local?.set({ [AUTO_PAGINATE_STORAGE_KEY]: next });
    };

    // CRUD for profiles, custom fields, and JSON import logic
    const {
        newProfileName, setNewProfileName, newFieldLabel,
        setNewFieldLabel, newFieldValue, setNewFieldValue,
        handleCreateProfile, createProfileNamed, setFieldByLabel, handleImportJson, updateCurrentProfile,
        updateField, toggleField, updateJobSkills,
        updateMedicalAllergies, handleAddCustomField, handleToggleCustomField,
        handleUpdateCustomField, handleRemoveCustomField
    } = useProfileManager({
        profiles,
        setProfiles,
        selectedProfileType,
        setSelectedProfileType,
        currentProfile,
        isPro,
        profilesUnlocked: access.profiles,
        jsonUnlocked: access.json,
        consumeReward: rewards.consume,
        onNotify: showStatus
    });

    useEffect(() => {
        document.documentElement.classList.toggle('av-dark', isDark);
        document.body.classList.toggle('av-dark', isDark);
    }, [isDark]);

    // Listen for Batch Autofill progress messages from background.ts:
    useEffect(() => {
        const handleMessage = (message: any) => {
            if (message.action === 'BATCH_PROGRESS') {
                try {
                    const host = new URL(message.url).hostname;
                    showStatus(t('status.batch.progress', { current: message.current, total: message.total, host }), 'info', 4000);
                } catch {
                    showStatus(t('status.batch.progressNoHost', { current: message.current, total: message.total }), 'info', 4000);
                }
            } else if (message.action === 'BATCH_COMPLETE') {
                setIsBatchRunning(false);
                showStatus(t('status.batch.complete', { count: Number(message.total) || 0 }), 'success', 5000);
            }
        };
        chrome.runtime?.onMessage?.addListener(handleMessage);
        return () => {
            chrome.runtime?.onMessage?.removeListener(handleMessage);
        };
    }, [showStatus, t]);


    // Guided tour: one walkthrough across all tabs, started after the vault is unlocked (App only mounts then).
    // After it's been seen, it still repeats each time the panel opens while no profile has data yet,
    // until the user fills something in or picks "Don't show again".
    const [isRepeatTour, setIsRepeatTour] = useState<boolean>(false);
    const [tourResetCount, setTourResetCount] = useState<number>(0);
    const tourShownRef = useRef<boolean>(false);      // once per panel session
    const tourReturnTabRef = useRef<ActiveTab>(activeTab); // tab to go back to when it ends
    const profilesHaveData = useMemo(() => hasProfileData(profiles), [profiles]);
    // getTourSteps resolves its text with t(), so the steps are rebuilt when the language changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const tourSteps = useMemo(() => getTourSteps({ isPage, useAiFill }), [isPage, useAiFill, language]);
    useEffect(() => {
        if (!isLoaded || tourShownRef.current) return;
        let cancelled = false;
        getTourState().then(({ seen, dismissed }) => {
            if (cancelled || dismissed || (seen && profilesHaveData)) return;
            tourShownRef.current = true;
            tourReturnTabRef.current = activeTab;
            setIsRepeatTour(seen);
            setIsTourOpen(true);
        });
        return () => { cancelled = true; };
        // activeTab only matters at the moment the tour starts
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoaded, profilesHaveData, tourResetCount]);

    const handleFinishTour = () => {
        markTourSeen();
        setIsTourOpen(false);
        setActiveTab(tourReturnTabRef.current);
    };

    const handleDismissTours = () => {
        dismissTours();
        handleFinishTour();
    };

    const handleReplayTour = async () => {
        await resetTours();
        tourShownRef.current = false;
        setActiveTab(isPage ? 'profiles' : 'fill');
        setTourResetCount((n) => n + 1);
    };

    const voiceActions: VoiceActions = {
        fill: (options) => triggerFormFill(options),
        cancelFill: cancelFormFill,
        advance: advanceForm,
        setHighlight: (on) => handleToggleHighlight(on),
        rescan: checkActiveTabFields,
        selectProfile: setSelectedProfileType,
        createProfile: createProfileNamed,
        setField: setFieldByLabel,
        setProfileEnabled: (on) => updateCurrentProfile({ enabled: on }),
        setAiFill: (on) => { if (on !== useAiFill) toggleAiFill(); },
        setDark: (on) => { if (on !== isDark) toggleTheme(); },
        addLink: handleAddLink,
        startBatchFill,
        open: (page) => {
            if (page === 'full_page') {
                chrome.runtime.openOptionsPage();
                return;
            }
            changePanelMode('classic');
            if (page === 'autofill') setActiveTab('fill');
            else if (page !== 'classic') setActiveTab(page);
        },
        activeTabUrl: async () => (await getActiveTab())?.url,
        pageQuestions: async () => {
            const tab = await getActiveTab();
            if (!tab?.id) return { frameId: 0, questions: [] };
            const res = await chrome.runtime.sendMessage({ action: 'GET_VOICE_QUESTIONS', tabId: tab.id }).catch(() => null);
            return { frameId: Number(res?.frameId) || 0, questions: Array.isArray(res?.questions) ? res.questions : [] };
        }
    };

    // Add this handler inside App() component:
    const handleManualSave = () => {
        handleSaveProfile(
            () => showStatus(t('status.save.success', { type: selectedProfileType.toUpperCase() }), 'success'),
            (err) => showStatus(t('status.save.failed', { error: err }), 'error')
        );
    };



    return (
        <PlanRewardsContext.Provider value={planRewards}>
        <div className={`av-panel ${isPage ? 'av-panel--page' : ''} ${isDark ? 'av-dark' : ''}`}>
            {/* Header */}
            <Header
                isDark={isDark}
                onToggleTheme={toggleTheme}
                onClose={isPage ? undefined : handleClosePanel}
                onOpenFullPage={isPage ? undefined : () => chrome.runtime.openOptionsPage()}
                onOpenJsonModal={() => setIsJsonModalOpen(true)}
                voiceMode={isPage ? undefined : isVoice}
                onToggleVoiceMode={isPage ? undefined : () => changePanelMode(isVoice ? 'classic' : 'voice')}
                voiceLocked={!isPro}
            />
            {/* Navigation Tabs */}
            {!isVoice && (
                <NavTabs
                    activeTab={activeTab}
                    onSelectTab={setActiveTab}
                    profileCount={Object.keys(profiles).length}
                    tabs={isPage ? ['profiles', 'multilink', 'settings'] : undefined}
                />
            )}


            {/* Body Content */}
            <main className="av-panel__body">
                <StatusBanner message={statusMessage} />

                {/* VOICE MODE: the agent orb in place of the tabs */}
                {isVoice && currentProfile && (
                    <VoiceView
                        profiles={profiles}
                        selectedProfileType={selectedProfileType}
                        currentProfile={currentProfile}
                        isPro={isPro}
                        isFilling={isFilling}
                        detectedFields={detectedFields}
                        isHighlighting={isHighlighting}
                        useAiFill={useAiFill}
                        isDark={isDark}
                        savedLinks={savedLinks}
                        actions={voiceActions}
                    />
                )}

                {/* TAB 1: FILL TAB */}
                {!isVoice && activeTab === 'fill' && currentProfile && (
                    <AutofillTab
                        currentProfile={currentProfile}
                        detectedFields={detectedFields}
                        isHighlighting={isHighlighting}
                        isFilling={isFilling}
                        useAiFill={useAiFill}
                        autoPaginate={autoPaginateAllowed(autoPaginate, isPro || access.paginate)}
                        onToggleHighlight={() => { handleToggleHighlight(); }}
                        onRescan={checkActiveTabFields}
                        onFill={() => {
                            // Free plan: a profile ON beyond the limit (the pass ended) is paused, never deleted
                            if (pausedProfileKeys(profiles, access.profileLimit).includes(selectedProfileType)) {
                                showStatus(t('rewards.status.profilePaused', { max: access.profileLimit }), 'error', 8000);
                                return;
                            }
                            triggerFormFill();
                        }}
                    />
                )}


                {/* TAB 2: PROFILES TAB (Strictly Independent Profiles!) */}
                {!isVoice && activeTab === 'profiles' && currentProfile && (
                    <ProfilesTab
                        profiles={profiles}
                        selectedProfileType={selectedProfileType}
                        onSelectProfile={setSelectedProfileType}
                        currentProfile={currentProfile}
                        newProfileName={newProfileName}
                        onChangeNewProfileName={setNewProfileName}
                        onCreateProfile={handleCreateProfile}
                        onUpdateProfile={updateCurrentProfile}
                        onUpdateField={updateField}
                        onToggleField={toggleField}
                        onUpdateJobSkills={updateJobSkills}
                        onUpdateMedicalAllergies={updateMedicalAllergies}
                        newFieldLabel={newFieldLabel}
                        onChangeNewFieldLabel={setNewFieldLabel}
                        newFieldValue={newFieldValue}
                        onChangeNewFieldValue={setNewFieldValue}
                        onAddCustomField={handleAddCustomField}
                        onToggleCustomField={handleToggleCustomField}
                        onUpdateCustomField={handleUpdateCustomField}
                        onRemoveCustomField={handleRemoveCustomField}
                        onSaveProfile={handleManualSave}
                    />
                )}

                {/* TAB: MULTI-LINK TAB */}
                {!isVoice && activeTab === 'multilink' && currentProfile && (
                    <MultiLinkTab
                        links={savedLinks}
                        onAddLink={handleAddLink}
                        onToggleLink={handleToggleLink}
                        onDeleteLink={handleDeleteLink}
                        onClearAll={handleClearAllLinks}
                        onStartBatchFill={() => { startBatchFill(); }}
                        currentProfile={currentProfile}
                        isBatchRunning={isBatchRunning}
                    />
                )}



                {/* TAB 3: SETTINGS TAB */}
                {!isVoice && activeTab === 'settings' && (
                    <SettingsTab
                        isDark={isDark}
                        onToggleTheme={toggleTheme}
                        useAiFill={useAiFill}
                        onToggleAiFill={toggleAiFill}
                        typingDelayMs={typingDelayMs}
                        onChangeTypingDelay={handleUpdateTypingDelay}
                        showFloatingIcon={showFloatingIcon}
                        onToggleFloatingIcon={handleToggleFloatingIcon}
                        autoPaginate={autoPaginate}
                        onToggleAutoPaginate={handleToggleAutoPaginate}
                        accountState={accountState}
                        onReplayTour={handleReplayTour}
                    />
                )}

            </main>

            {/* Footer */}
            <Footer />

            {isTourOpen && currentProfile && (
                <GuidedTour
                    steps={tourSteps}
                    activeTab={activeTab}
                    onSelectTab={setActiveTab}
                    onFinish={handleFinishTour}
                    onDismiss={isRepeatTour ? handleDismissTours : undefined}
                />
            )}

            <JsonConfigModal
                isOpen={isJsonModalOpen}
                onClose={() => setIsJsonModalOpen(false)}
                fields={getProfileCustomFields(currentProfile)}
                onImport={handleImportJson}
                isPro={isPro}
                profileName={currentProfile?.profileName || selectedProfileType}
            />

        </div>
        </PlanRewardsContext.Provider>
    );
}