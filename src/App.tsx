import { useState, useEffect } from 'react';
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
import { exceedsFreeProfileLimit, autoPaginateAllowed, PROFILE_LIMIT_MESSAGE } from './services/tier';
import { AUTO_PAGINATE_STORAGE_KEY, AUTO_PAGINATE_PRO_MESSAGE } from './services/pagination';


import { Header } from './components/layout/Header';
import { NavTabs } from './components/layout/NavTabs';
import { StatusBanner } from './components/layout/StatusBanner';
import { Footer } from './components/layout/Footer';
import { AutofillTab } from './components/tabs/AutoFillTab';
import { SettingsTab } from './components/tabs/SettingsTab';
import { ProfilesTab } from './components/tabs/ProfilesTab';
import { MultiLinkTab } from './components/tabs/MultiLinkTab';


interface AppProps {
    // 'panel' = browser side panel, 'page' = full options page (no Autofill tab: it needs the page being filled)
    layout?: 'panel' | 'page';
}

export default function App({ layout = 'panel' }: AppProps) {
    const isPage = layout === 'page';

    const [activeTab, setActiveTab] = useState<'fill' | 'profiles' | 'multilink' | 'settings'>(isPage ? 'profiles' : 'fill');
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


    // Hydrate saved links on mount:
    useEffect(() => {
        chrome.storage?.local?.get(['aullevo_saved_links'], (res) => {
            if (Array.isArray(res.aullevo_saved_links)) {
                setSavedLinks(res.aullevo_saved_links);
            }
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

        const updated = [...newItems, ...savedLinks];
        setSavedLinks(updated);
        chrome.storage?.local?.set({ aullevo_saved_links: updated });
    };

    const handleClearAllLinks = () => {
        setSavedLinks([]);
        chrome.storage?.local?.set({ aullevo_saved_links: [] });
    };


    const handleToggleLink = (id: string) => {
        const updated = savedLinks.map(l => l.id === id ? { ...l, enabled: !l.enabled } : l);
        setSavedLinks(updated);
        chrome.storage?.local?.set({ aullevo_saved_links: updated });
    };

    const handleDeleteLink = (id: string) => {
        const updated = savedLinks.filter(l => l.id !== id);
        setSavedLinks(updated);
        chrome.storage?.local?.set({ aullevo_saved_links: updated });
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
    const { profiles, setProfiles, selectedProfileType, setSelectedProfileType, currentProfile, isDark, toggleTheme, useAiFill, toggleAiFill, handleSaveProfile } = useProfileStorage();

    // Signed-in account & Free/Pro plan
    const accountState = useAccount();
    const { isPro } = accountState;

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
        handleClosePanel
    } = useExtensionBridge(currentProfile, useAiFill, typingDelayMs, isPro, isPage, autoPaginate);

    const handleToggleAutoPaginate = () => {
        if (!isPro) {
            showStatus(AUTO_PAGINATE_PRO_MESSAGE, 'error', 5000);
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
        handleCreateProfile, handleImportJson, updateCurrentProfile,
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
                    showStatus(`Filling ${message.current} of ${message.total}: ${host}`, 'info', 4000);
                } catch {
                    showStatus(`Filling ${message.current} of ${message.total}...`, 'info', 4000);
                }
            } else if (message.action === 'BATCH_COMPLETE') {
                setIsBatchRunning(false);
                showStatus(`Batch fill completed across ${message.total} forms!`, 'success', 5000);
            }
        };
        chrome.runtime?.onMessage?.addListener(handleMessage);
        return () => {
            chrome.runtime?.onMessage?.removeListener(handleMessage);
        };
    }, [showStatus]);


    // Add this handler inside App() component:
    const handleManualSave = () => {
        handleSaveProfile(
            () => showStatus(`${selectedProfileType.toUpperCase()} Profile saved successfully!`, 'success'),
            (err) => showStatus(`Save failed: ${err}`, 'error')
        );
    };



    return (
        <div className={`av-panel ${isPage ? 'av-panel--page' : ''} ${isDark ? 'av-dark' : ''}`}>
            {/* Header */}
            <Header
                isDark={isDark}
                onToggleTheme={toggleTheme}
                onClose={isPage ? undefined : handleClosePanel}
                onOpenFullPage={isPage ? undefined : () => chrome.runtime.openOptionsPage()}
                onOpenJsonModal={() => setIsJsonModalOpen(true)}
            />
            {/* Navigation Tabs */}
            <NavTabs
                activeTab={activeTab}
                onSelectTab={setActiveTab}
                profileCount={Object.keys(profiles).length}
                tabs={isPage ? ['profiles', 'multilink', 'settings'] : undefined}
            />


            {/* Body Content */}
            <main className="av-panel__body">
                <StatusBanner message={statusMessage} />


                {/* TAB 1: FILL TAB */}
                {activeTab === 'fill' && currentProfile && (
                    <AutofillTab
                        currentProfile={currentProfile}
                        detectedFields={detectedFields}
                        isHighlighting={isHighlighting}
                        isFilling={isFilling}
                        useAiFill={useAiFill}
                        autoPaginate={autoPaginateAllowed(autoPaginate, isPro)}
                        onToggleHighlight={handleToggleHighlight}
                        onRescan={checkActiveTabFields}
                        onFill={() => {
                            // Free plan: block filling while more than 2 profiles are ON (e.g. after Pro expired)
                            if (exceedsFreeProfileLimit(Object.values(profiles), isPro)) {
                                showStatus(PROFILE_LIMIT_MESSAGE, 'error', 5000);
                                return;
                            }
                            triggerFormFill();
                        }}
                    />
                )}


                {/* TAB 2: PROFILES TAB (Strictly Independent Profiles!) */}
                {activeTab === 'profiles' && currentProfile && (
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
                {activeTab === 'multilink' && currentProfile && (
                    <MultiLinkTab
                        links={savedLinks}
                        onAddLink={handleAddLink}
                        onToggleLink={handleToggleLink}
                        onDeleteLink={handleDeleteLink}
                        onClearAll={handleClearAllLinks}
                        onStartBatchFill={() => {
                            const enabledLinks = savedLinks.filter(l => l.enabled);
                            if (enabledLinks.length === 0) return;
                            setIsBatchRunning(true);
                            showStatus(`Starting batch fill for ${enabledLinks.length} forms...`, 'info');
                            chrome.runtime?.sendMessage?.({
                                action: 'START_BATCH_FILL',
                                links: enabledLinks
                            });
                        }}
                        currentProfile={currentProfile}
                        isBatchRunning={isBatchRunning}
                    />
                )}



                {/* TAB 3: SETTINGS TAB */}
                {activeTab === 'settings' && (
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
                    />
                )}

            </main>

            {/* Footer */}
            <Footer />

            <JsonConfigModal
                isOpen={isJsonModalOpen}
                onClose={() => setIsJsonModalOpen(false)}
                fields={getProfileCustomFields(currentProfile)}
                onImport={handleImportJson}
                isPro={isPro}
                profileName={currentProfile?.profileName || selectedProfileType}
            />

        </div>
    );
}