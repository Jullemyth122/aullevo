import { ShieldCheck, Moon, Sun, Check, Sparkles, ChevronRight } from 'lucide-react';

interface SettingsTabProps {
    isPro: boolean;
    apiKey: string;
    setApiKey: (key: string) => void;
    handleSaveApiKey: () => void;
    saveMsg: string;
    isDark: boolean;
    setIsDark: React.Dispatch<React.SetStateAction<boolean>>;
    matchingMode: 'ai' | 'heuristic';
    setMatchingMode: (mode: 'ai' | 'heuristic') => void;
    autoSubmit: boolean;
    setAutoSubmit: (autoSubmit: boolean) => void;
}

export const SettingsTab = ({
    isPro,
    apiKey,
    setApiKey,
    handleSaveApiKey,
    saveMsg,
    isDark,
    setIsDark,
    matchingMode,
    setMatchingMode,
    autoSubmit,
    setAutoSubmit,
}: SettingsTabProps) => (
    <div className="av-settings">
        <div className="av-settings__privacy-card" style={{ marginBottom: '15px', cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={() => {
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                chrome.runtime.sendMessage({ action: 'openOptionsPage' });
            }
        }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                <div style={{ fontWeight: '700', fontSize: '13px', color: 'var(--av-violet)' }}>
                    {isPro ? '✨ Aullevo Pro Lifetime Active' : '✨ Aullevo Free Version'}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--av-text-muted)' }}>
                    {isPro ? 'Thank you for your support!' : 'Unlock unlimited profiles, memories, and AI filling.'}
                </div>
            </div>
            <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--av-violet)', paddingLeft: '8px' }}>
                Manage →
            </div>
        </div>

        <div className="av-divider" style={{ margin: '15px 0' }} />

        <div>
            <div className="av-settings__title">Gemini API Key</div>
            <p className="av-settings__desc">
                Your key is stored locally and never sent to any server. Get yours free at{' '}
                <span
                    className="av-settings__link"
                    onClick={() => window.open('https://aistudio.google.com/app/apikey', '_blank')}
                >
                    aistudio.google.com
                </span>.
            </p>
            <label className="av-label">API Key</label>
            <input
                className="av-input"
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="AIza…"
            />
            <button className="av-settings__save-btn" onClick={handleSaveApiKey}>
                {saveMsg || 'Save API Key'}
            </button>
        </div>

        <div className="av-divider" />

        <div className="av-settings__privacy-card">
            <ShieldCheck size={16} />
            <div><strong>Privacy-first</strong> — Gemini only sees form field labels, never the data you type into fields.</div>
        </div>

        <div className="av-settings__how-card">
            <div className="av-settings__how-title">How it works</div>
            <p>
                Aullevo scans the current page for form inputs, sends only the field labels to Gemini,
                gets back suggested values from your saved profile, then fills the form — all locally.
            </p>
        </div>

        {/* Dark mode toggle */}
        <div className="av-toggle-row">
            <div>
                <div className="av-toggle-row__label">Appearance</div>
                <div className="av-toggle-row__hint">{isDark ? 'Dark mode' : 'Light mode'}</div>
            </div>
            <button className={`av-toggle ${isDark ? 'av-toggle--active' : ''}`} onClick={() => setIsDark(d => !d)}>
                <span className="av-toggle__thumb">
                    {isDark ? <Moon size={10} /> : <Sun size={10} />}
                </span>
            </button>
        </div>

        {/* Matching Mode toggle */}
        <div className="av-toggle-row">
            <div>
                <div className="av-toggle-row__label">Form Matching Mode</div>
                <div className="av-toggle-row__hint">
                    {matchingMode === 'heuristic'
                        ? 'Keyword Match (Fast & Free)'
                        : 'Gemini AI (Smart)'}
                </div>
            </div>
            <button
                className={`av-toggle ${matchingMode === 'heuristic' ? 'av-toggle--active' : ''}`}
                onClick={() => {
                    const newMode = matchingMode === 'heuristic' ? 'ai' : 'heuristic';
                    setMatchingMode(newMode);
                    if (typeof chrome !== 'undefined' && chrome?.storage) {
                        chrome.storage.local.set({ matchingMode: newMode });
                    }
                }}
            >
                <span className="av-toggle__thumb">
                    {matchingMode === 'heuristic' ? <Check size={10} /> : <Sparkles size={10} />}
                </span>
            </button>
        </div>

        {/* Auto Submit toggle */}
        <div className="av-toggle-row">
            <div>
                <div className="av-toggle-row__label">Auto-Submit / Paginate</div>
                <div className="av-toggle-row__hint">
                    {autoSubmit ? 'Automatically move to next page' : 'Fill current page only'}
                </div>
            </div>
            <button
                className={`av-toggle ${autoSubmit ? 'av-toggle--active' : ''}`}
                onClick={() => {
                    const newVal = !autoSubmit;
                    setAutoSubmit(newVal);
                    if (typeof chrome !== 'undefined' && chrome?.storage) {
                        chrome.storage.local.set({ autoSubmit: newVal });
                    }
                }}
            >
                <span className="av-toggle__thumb">
                    {autoSubmit ? <Check size={10} /> : <ChevronRight size={10} />}
                </span>
            </button>
        </div>
    </div>
);
