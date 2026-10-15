import { Sun, Moon, X, Code2, Maximize2, AudioLines } from 'lucide-react';
import { LanguageMenu } from '../language/LanguageMenu';
import { useT } from '../../i18n';

interface HeaderProps {
    isDark: boolean;
    onToggleTheme: () => void;
    onClose?: () => void;          // side panel only
    onOpenFullPage?: () => void;   // side panel only
    onOpenJsonModal: () => void;
    voiceMode?: boolean;              // side panel only: Classic (tabs) or Voice (agent orb)
    onToggleVoiceMode?: () => void;
    voiceLocked?: boolean;            // Free plan: Voice mode can be opened and seen, not used
}

export function Header({
    isDark,
    onToggleTheme,
    onClose,
    onOpenFullPage,
    onOpenJsonModal,
    voiceMode,
    onToggleVoiceMode,
    voiceLocked
}: HeaderProps) {
    const { t } = useT();
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
                    <div className="av-panel__brand-sub">{t('header.versionLine', { version: chrome.runtime.getManifest().version })}</div>
                </div>
            </div>
            <div className="av-panel__actions">
                {onToggleVoiceMode && (
                    // Voice mode speaks English / Tagalog only for now, so its labels aren't translated yet
                    <button
                        className={`av-panel__icon-btn ${voiceMode ? 'av-panel__icon-btn--active' : ''}`}
                        onClick={onToggleVoiceMode}
                        aria-pressed={voiceMode}
                        data-tour="voice-mode"
                        title={voiceMode ? 'Voice mode on · switch to the classic view' : voiceLocked ? 'Voice mode: talk to Aullevo (Pro)' : 'Voice mode: talk to Aullevo'}
                    >
                        <AudioLines size={15} />
                        {voiceLocked && <span className="av-panel__pro-tag">PRO</span>}
                    </button>
                )}
                <LanguageMenu />
                <button
                    className="av-panel__icon-btn"
                    onClick={onToggleTheme}
                    data-tour="theme"
                    title={isDark ? t('header.lightTheme') : t('header.darkTheme')}
                >
                    {isDark ? <Sun size={15} /> : <Moon size={15} />}
                </button>
                <button
                    className="av-panel__icon-btn"
                    onClick={onOpenJsonModal}
                    data-tour="json"
                    title={t('header.jsonConfig')}
                >
                    <Code2 size={15} />
                </button>
                {onOpenFullPage && (
                    <button
                        className="av-panel__icon-btn"
                        onClick={onOpenFullPage}
                        data-tour="full-page"
                        title={t('header.openFullPage')}
                    >
                        <Maximize2 size={15} />
                    </button>
                )}
                {onClose && (
                    <button
                        className="av-panel__icon-btn"
                        onClick={onClose}
                        data-tour="close"
                        title={t('header.closeSidePanel')}
                    >
                        <X size={15} />
                    </button>
                )}
            </div>
        </header>
    );
}
