import { SidebarProvider, useSidebar } from './modules/sidebar/SidebarContext';
import type { Tab } from './modules/sidebar/sidebarTypes';
import { FillTab } from './modules/sidebar/components/FillTab';
import { ProfileTab } from './modules/sidebar/components/ProfileTab';
import { KnowledgeTab } from './modules/sidebar/components/KnowledgeTab';
import { LinksTab } from './modules/sidebar/components/LinksTab';
import { SettingsTab } from './modules/sidebar/components/SettingsTab';
import { LogoA } from '../components/LogoA';
import { X } from 'lucide-react';

function SidebarInner() {
    const {
        isDark,
        isOpen,
        setIsOpen,
        fieldCount,
        activeTab,
        setActiveTab,
        isProcessing,
    } = useSidebar();

    return (
        <div className={isDark ? 'av-dark' : ''}>
            {/* Trigger pill */}
            <div
                className={`av-trigger ${isOpen ? 'av-trigger--open' : 'av-trigger--closed'}`}
                onClick={() => setIsOpen(p => !p)}
                title="Aullevo — Ctrl+Shift+E to toggle"
            >
                <span className="av-trigger__stripe" />
                <span className="av-trigger__label">Aullevo</span>
                {fieldCount > 0 && (
                    <span className="av-trigger__badge">{fieldCount}</span>
                )}
            </div>

            {/* Panel */}
            {isOpen && (
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
                        <button className="av-panel__close" onClick={() => setIsOpen(false)} title="Close">
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
                        ] as { id: Tab; label: string }[]).map(t => {
                            const isTabDisabled = isProcessing && t.id !== 'fill';
                            return (
                                <button
                                    key={t.id}
                                    className={`av-panel__tab ${activeTab === t.id ? 'av-panel__tab--active' : ''} ${isTabDisabled ? 'av-panel__tab--disabled' : ''}`}
                                    onClick={() => {
                                        if (isTabDisabled) return;
                                        setActiveTab(t.id);
                                    }}
                                    disabled={isTabDisabled}
                                    title={isTabDisabled ? 'Form filling in progress... Tabs locked until finished.' : t.label}
                                >
                                    {t.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Body */}
                    <div className="av-panel__body">
                        {activeTab === 'fill' && <FillTab />}
                        {activeTab === 'profile' && <ProfileTab />}
                        {activeTab === 'knowledge' && <KnowledgeTab />}
                        {activeTab === 'links' && <LinksTab />}
                        {activeTab === 'settings' && <SettingsTab />}
                    </div>

                    {/* Footer */}
                    <div className="av-panel__footer">
                        <span className="av-panel__footer-text">Powered by Gemini 3 Flash</span>
                        <span className="av-panel__footer-text">Ctrl+Shift+E to toggle</span>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function Sidebar() {
    return (
        <SidebarProvider>
            <SidebarInner />
        </SidebarProvider>
    );
}