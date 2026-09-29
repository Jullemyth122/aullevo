import { Zap, Users, Settings, Link2 } from 'lucide-react';

export type ActiveTab = 'fill' | 'profiles' | 'multilink' | 'settings';

interface NavTabsProps {
    activeTab: ActiveTab;
    onSelectTab: (tab: ActiveTab) => void;
    profileCount: number;
    tabs?: ActiveTab[]; // defaults to all tabs
}

export function NavTabs({
    activeTab,
    onSelectTab,
    profileCount,
    tabs = ['fill', 'profiles', 'multilink', 'settings']
}: NavTabsProps) {
    return (
        <nav className="av-panel__tabs">
            {tabs.includes('fill') && (
            <button
                className={`av-panel__tab ${activeTab === 'fill' ? 'av-panel__tab--active' : ''}`}
                onClick={() => onSelectTab('fill')}
            >
                <Zap size={13} />
                <span>Autofill</span>
            </button>
            )}
            <button
                className={`av-panel__tab ${activeTab === 'profiles' ? 'av-panel__tab--active' : ''}`}
                onClick={() => onSelectTab('profiles')}
            >
                <Users size={13} />
                <span>Profiles ({profileCount})</span>
            </button>

            <button
                className={`av-panel__tab ${activeTab === 'multilink' ? 'av-panel__tab--active' : ''}`}
                onClick={() => onSelectTab('multilink')}
            >
                <Link2 size={13} />
                <span>Multi-link</span>
            </button>

            <button
                className={`av-panel__tab ${activeTab === 'settings' ? 'av-panel__tab--active' : ''}`}
                onClick={() => onSelectTab('settings')}
            >
                <Settings size={13} />
                <span>Settings</span>
            </button>
        </nav>
    );
}
