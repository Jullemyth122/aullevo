import { useSidebarState } from './modules/sidebar/useSidebarState';
import type { Tab } from './modules/sidebar/sidebarTypes';
import { FillTab } from './modules/sidebar/components/FillTab';
import { ProfileTab } from './modules/sidebar/components/ProfileTab';
import { KnowledgeTab } from './modules/sidebar/components/KnowledgeTab';
import { LinksTab } from './modules/sidebar/components/LinksTab';
import { SettingsTab } from './modules/sidebar/components/SettingsTab';
import { LogoA } from '../components/LogoA';
import { X } from 'lucide-react';

export default function Sidebar() {
    const state = useSidebarState();

    return (
        <div className={state.isDark ? 'av-dark' : ''}>
            {/* Trigger pill */}
            <div
                className={`av-trigger ${state.isOpen ? 'av-trigger--open' : 'av-trigger--closed'}`}
                onClick={() => state.setIsOpen(p => !p)}
                title="Aullevo — Ctrl+M or Alt+A"
            >
                <span className="av-trigger__stripe" />
                <span className="av-trigger__label">Aullevo</span>
                {state.fieldCount > 0 && (
                    <span className="av-trigger__badge">{state.fieldCount}</span>
                )}
            </div>

            {/* Panel */}
            {state.isOpen && (
                <div className="av-panel">
                    {/* Header */}
                    <div className="av-panel__header">
                        <div className="av-panel__brand">
                            <div className="av-panel__logo">
                                <LogoA size={18} />
                            </div>
                            <div>
                                <div className="av-panel__brand-name">Aullevo</div>
                                <div className="av-panel__brand-sub">AI Form Filler</div>
                            </div>
                        </div>
                        <button className="av-panel__close" onClick={() => state.setIsOpen(false)} title="Close">
                            <X size={18} />
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="av-panel__tabs">
                        {([
                            { id: 'fill', label: 'Fill Form' },
                            { id: 'profile', label: 'My Profile' },
                            { id: 'knowledge', label: 'Memories' },
                            { id: 'links', label: 'Links' },
                            { id: 'settings', label: 'Settings' },
                        ] as { id: Tab; label: string }[]).map(t => (
                            <button
                                key={t.id}
                                className={`av-panel__tab ${state.activeTab === t.id ? 'av-panel__tab--active' : ''}`}
                                onClick={() => state.setActiveTab(t.id)}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>

                    {/* Body */}
                    <div className="av-panel__body">
                        {state.activeTab === 'fill' && (
                            <FillTab
                                uploadedFile={state.uploadedFile}
                                handleResumeUpload={state.handleResumeUpload}
                                fileLibrary={state.fileLibrary}
                                setActiveTab={state.setActiveTab}
                                fieldCount={state.fieldCount}
                                scanFields={state.scanFields}
                                isProcessing={state.isProcessing}
                                matchingMode={state.matchingMode}
                                handleFill={state.handleFill}
                                fillStatus={state.fillStatus}
                                apiKey={state.apiKey}
                            />
                        )}
                        {state.activeTab === 'profile' && (
                            <ProfileTab
                                userData={state.userData}
                                setUserData={state.setUserData}
                                handleInput={state.handleInput}
                                handleSave={state.handleSave}
                                saveMsg={state.saveMsg}
                                activeProfile={state.activeProfile}
                                handleSwitchProfile={state.handleSwitchProfile}
                                handleDeleteProfile={state.handleDeleteProfile}
                                profiles={state.profiles}
                                showNewProfileInput={state.showNewProfileInput}
                                setShowNewProfileInput={state.setShowNewProfileInput}
                                newProfileName={state.newProfileName}
                                setNewProfileName={state.setNewProfileName}
                                handleCreateProfile={state.handleCreateProfile}
                                openSections={state.openSections}
                                toggleSection={state.toggleSection}
                                fileLibrary={state.fileLibrary}
                                fileDragging={state.fileDragging}
                                setFileDragging={state.setFileDragging}
                                fileLibInputRef={state.fileLibInputRef}
                                addFilesToLibrary={state.addFilesToLibrary}
                                removeFromLibrary={state.removeFromLibrary}
                                pageFields={state.pageFields}
                                skillsInput={state.skillsInput}
                                setSkillsInput={state.setSkillsInput}
                                newCFLabel={state.newCFLabel}
                                setNewCFLabel={state.setNewCFLabel}
                                newCFValue={state.newCFValue}
                                setNewCFValue={state.setNewCFValue}
                                newCFContext={state.newCFContext}
                                setNewCFContext={state.setNewCFContext}
                                addCustomField={state.addCustomField}
                                removeCustomField={state.removeCustomField}
                            />
                        )}
                        {state.activeTab === 'knowledge' && (
                            <KnowledgeTab
                                userData={state.userData}
                                newMemTitle={state.newMemTitle}
                                setNewMemTitle={state.setNewMemTitle}
                                newMemContent={state.newMemContent}
                                setNewMemContent={state.setNewMemContent}
                                addMemory={state.addMemory}
                                removeMemory={state.removeMemory}
                                handleSave={state.handleSave}
                                saveMsg={state.saveMsg}
                            />
                        )}
                        {state.activeTab === 'links' && (
                            <LinksTab
                                userData={state.userData}
                                newLinkTitle={state.newLinkTitle}
                                setNewLinkTitle={state.setNewLinkTitle}
                                newLinkUrl={state.newLinkUrl}
                                setNewLinkUrl={state.setNewLinkUrl}
                                addLink={state.addLink}
                                removeLink={state.removeLink}
                                triggerAutopilot={state.triggerAutopilot}
                                handleSave={state.handleSave}
                                saveMsg={state.saveMsg}
                            />
                        )}
                        {state.activeTab === 'settings' && (
                            <SettingsTab
                                isPro={state.isPro}
                                apiKey={state.apiKey}
                                setApiKey={state.setApiKey}
                                handleSaveApiKey={state.handleSaveApiKey}
                                saveMsg={state.saveMsg}
                                isDark={state.isDark}
                                setIsDark={state.setIsDark}
                                matchingMode={state.matchingMode}
                                setMatchingMode={state.setMatchingMode}
                                autoSubmit={state.autoSubmit}
                                setAutoSubmit={state.setAutoSubmit}
                            />
                        )}
                    </div>

                    {/* Footer */}
                    <div className="av-panel__footer">
                        <span className="av-panel__footer-text">Powered by Gemini 3 Flash</span>
                        <span className="av-panel__footer-text">Ctrl+M to toggle</span>
                    </div>
                </div>
            )}
        </div>
    );
}