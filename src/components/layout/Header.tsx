import { Sun, Moon, X, Code2, Maximize2 } from 'lucide-react';

interface HeaderProps {
    isDark: boolean;
    onToggleTheme: () => void;
    onClose?: () => void;          // side panel only
    onOpenFullPage?: () => void;   // side panel only
    onOpenJsonModal: () => void;
}

export function Header({
    isDark,
    onToggleTheme,
    onClose,
    onOpenFullPage,
    onOpenJsonModal
}: HeaderProps) {
    return (
        <header className="av-panel__header">
            <div className="av-panel__brand">
                <div className="av-panel__logo">
                    <img
                        src="/icons/icon128.png"
                        alt="Aullevo Logo"
                        onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                        }}
                    />
                </div>
                <div>
                    <div className="av-panel__brand-name">Aullevo</div>
                    <div className="av-panel__brand-sub">v{chrome.runtime.getManifest().version} • Autofill</div>
                </div>
            </div>
            <div className="av-panel__actions">
                <button
                    className="av-panel__icon-btn"
                    onClick={onToggleTheme}
                    title={isDark ? 'Light theme' : 'Dark theme'}
                >
                    {isDark ? <Sun size={15} /> : <Moon size={15} />}
                </button>
                <button
                    className="av-panel__icon-btn"
                    onClick={onOpenJsonModal}
                    title="JSON Configuration"
                >
                    <Code2 size={15} />
                </button>
                {onOpenFullPage && (
                    <button
                        className="av-panel__icon-btn"
                        onClick={onOpenFullPage}
                        title="Open full page"
                    >
                        <Maximize2 size={15} />
                    </button>
                )}
                {onClose && (
                    <button
                        className="av-panel__icon-btn"
                        onClick={onClose}
                        title="Close side panel"
                    >
                        <X size={15} />
                    </button>
                )}
            </div>
        </header>
    );
}
