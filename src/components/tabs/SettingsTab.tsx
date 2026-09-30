import { Zap, User, Clock, Sliders, Keyboard, Bot, Lock, EyeOff, Eye, KeyRound, ExternalLink, ShieldCheck, Sparkles, Crown, LogIn, LogOut, ChevronsRight } from 'lucide-react';
import { GEMINI_MODELS, FREE_TIER_WEEKLY_LIMIT, getEffectiveUsageCount, isHostedAiAvailable } from '../../services/aiService';
import { readVault, writeVault, lockVault } from '../../services/vault';
import { canUseTypingDelay } from '../../services/tier';
import type { useAccount } from '../../hooks/useAccount';
import { AULLEVO_WEB_URL } from '../../services/account';
import { useEffect, useRef, useState } from 'react';
import { MemoriesCard } from './MemoriesCard';

interface SettingsTabProps {
    isDark: boolean;
    onToggleTheme: () => void;
    useAiFill: boolean;
    onToggleAiFill: () => void;
    typingDelayMs: number;
    onChangeTypingDelay: (delayMs: number) => void;
    showFloatingIcon: boolean;
    onToggleFloatingIcon: () => void;
    autoPaginate: boolean;
    onToggleAutoPaginate: () => void;
    accountState: ReturnType<typeof useAccount>;
}

export function SettingsTab({
    isDark,
    onToggleTheme,
    useAiFill,
    onToggleAiFill,
    typingDelayMs,
    onChangeTypingDelay,
    showFloatingIcon,
    onToggleFloatingIcon,
    autoPaginate,
    onToggleAutoPaginate,
    accountState
}: SettingsTabProps) {
    const { account, isPro, isConnecting, connect, disconnect } = accountState;

    // -----------------------------------------------------------------------
    // AI Configuration State (API key in the encrypted vault, model/usage in chrome.storage.local)
    // -----------------------------------------------------------------------
    const [apiKey, setApiKey] = useState('');
    const [selectedModel, setSelectedModel] = useState<string>('gemini-3.5-flash-lite');
    const [showKey, setShowKey] = useState(false);
    const [usageCount, setUsageCount] = useState(0);
    const apiKeySaveTimer = useRef<number | null>(null);
    useEffect(() => {
        readVault().then((vault) => {
            if (typeof vault?.geminiApiKey === 'string') {
                setApiKey(vault.geminiApiKey);
            }
        });
        chrome.storage?.local?.get(
            ['aullevo_gemini_model', 'aullevo_ai_usage_count', 'aullevo_ai_usage_week'],
            (res) => {
                if (typeof res?.aullevo_gemini_model === 'string') {
                    setSelectedModel(res.aullevo_gemini_model);
                }
                setUsageCount(getEffectiveUsageCount(res?.aullevo_ai_usage_count, res?.aullevo_ai_usage_week));
            }
        );
    }, []);
    const handleApiKeyChange = (val: string) => {
        setApiKey(val);
        // Debounced: each save re-encrypts the whole vault
        if (apiKeySaveTimer.current) clearTimeout(apiKeySaveTimer.current);
        apiKeySaveTimer.current = window.setTimeout(() => {
            writeVault({ geminiApiKey: val.trim() }).catch((err) => console.error('[Aullevo:Settings] API key save failed:', err));
        }, 500);
    };
    const handleModelChange = (modelId: string) => {
        setSelectedModel(modelId);
        chrome.storage?.local?.set({ aullevo_gemini_model: modelId });
    };

    const getSpeedBadge = (ms: number) => {
        if (ms === 0) return 'Instant (0ms)';
        if (ms === 25) return 'Natural (25ms)';
        if (ms === 65) return 'Slow (65ms)';
        return `Custom (${ms}ms)`;
    };

    const hasCustomKey = Boolean(apiKey.trim());
    const hostedAi = isHostedAiAvailable();
    const isUnlimited = isPro && (hasCustomKey || hostedAi);
    const aiBadgeText = isUnlimited
        ? 'Unlimited Access'
        : (!hasCustomKey && !hostedAi) ? 'API Key Required' : `Free: ${usageCount}/${FREE_TIER_WEEKLY_LIMIT} this week`;


    return (
        <>
            {/* Account & Plan Card (synced with aullevo-web) */}
            <div className="av-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div className="av-label" style={{ margin: 0 }}>Account</div>
                    <span className={`av-plan-badge ${isPro ? 'av-plan-badge--pro' : ''}`}>
                        {isPro && <Crown size={10} />}
                        {isPro ? 'PRO' : 'FREE'}
                    </span>
                </div>

                {account ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {account.photoURL && (
                            <img src={account.photoURL} alt="" width={28} height={28} style={{ borderRadius: '50%', flexShrink: 0 }} referrerPolicy="no-referrer" />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{account.displayName || account.email}</div>
                            <div style={{ fontSize: 10, color: 'var(--av-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {isPro && account.proExpiresAt
                                    ? `Pro until ${new Date(account.proExpiresAt).toLocaleDateString()}`
                                    : account.email}
                            </div>
                        </div>
                        <button type="button" className="av-pill av-pill--danger" onClick={disconnect} title="Disconnect account">
                            <LogOut size={11} />
                        </button>
                    </div>
                ) : (
                    <button type="button" className="av-save-btn" onClick={connect} style={{ margin: 0 }}>
                        <LogIn size={12} />
                        <span>{isConnecting ? 'Waiting for sign-in…' : 'Connect with Aullevo Web'}</span>
                    </button>
                )}

                {!isPro && (
                    <a
                        href={AULLEVO_WEB_URL}
                        target="_blank"
                        rel="noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 10.5, fontWeight: 600, color: 'var(--av-yellow)', textDecoration: 'none' }}
                    >
                        <Crown size={11} />
                        <span>{account?.isPro ? 'Pro expired · Renew' : 'Upgrade to Pro'}</span>
                    </a>
                )}
            </div>

            {/* Theme Card */}
            <div className="av-card">
                <div className="av-label">Theme Appearance</div>
                <div className="av-toggle-row">
                    <div>
                        <div className="av-toggle-title">Dark Theme</div>
                        <div style={{ fontSize: 10, color: 'var(--av-text-muted)' }}>
                            Toggle between Dark Slate and Light theme
                        </div>
                    </div>
                    <button
                        className={`av-toggle ${isDark ? 'av-toggle--active' : ''}`}
                        onClick={onToggleTheme}
                    >
                        <div className="av-toggle__thumb" />
                    </button>
                </div>
            </div>

            {/* Autofill Mode Card */}
            <div className="av-card">
                <div className="av-label">Autofill Engine Mode</div>
                <div className="av-toggle-row">
                    <div>
                        <div className="av-toggle-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {useAiFill ? (
                                <>
                                    <Bot size={13} color="var(--av-accent, #6366f1)" />
                                    <span>AI Smart Fill (Active)</span>
                                </>
                            ) : (
                                <>
                                    <Zap size={13} color="var(--av-text-muted)" />
                                    <span>Standard Fill (No AI)</span>
                                </>
                            )}
                        </div>

                        <div style={{ fontSize: 10, color: 'var(--av-text-muted)' }}>
                            {useAiFill
                                ? 'Uses AI reasoning to interpret questions & match complex fields'
                                : 'Direct profile attribute matching without AI calls'}
                        </div>
                    </div>
                    <button
                        className={`av-toggle ${useAiFill ? 'av-toggle--active' : ''}`}
                        onClick={onToggleAiFill}
                        title="Toggle AI Fill Mode"
                    >
                        <div className="av-toggle__thumb" />
                    </button>
                </div>
            </div>

            {/* AI Smart Fill Configuration Card */}
            {useAiFill && (
                <div className="av-card" style={{ border: '1px solid rgba(99, 102, 241, 0.25)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 12 }}>
                            <Sparkles size={14} color="var(--av-accent, #6366f1)" />
                            <span>Gemini AI Engine</span>
                        </div>
                        <span
                            style={{
                                fontSize: 10,
                                fontWeight: 600,
                                padding: '2px 8px',
                                borderRadius: 12,
                                background: isUnlimited ? 'rgba(16, 185, 129, 0.15)' : 'rgba(99, 102, 241, 0.15)',
                                color: isUnlimited ? 'var(--av-success)' : 'var(--av-accent, #6366f1)',
                                border: `1px solid ${isUnlimited ? 'rgba(16, 185, 129, 0.3)' : 'rgba(99, 102, 241, 0.3)'}`
                            }}
                        >
                            {aiBadgeText}
                        </span>
                    </div>
                    {/* Privacy Shield Notice */}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            background: 'rgba(16, 185, 129, 0.08)',
                            border: '1px solid rgba(16, 185, 129, 0.2)',
                            borderRadius: 6,
                            padding: '6px 8px',
                            marginBottom: 12,
                            fontSize: 10,
                            color: 'var(--av-text-mid)'
                        }}
                    >
                        <ShieldCheck size={14} color="var(--av-success)" style={{ flexShrink: 0 }} />
                        <span><strong>Privacy:</strong> Fields marked SENSITIVE are never sent to AI, only their labels. Values of AI SAFE fields and the form's questions are sent to Google Gemini.</span>
                    </div>
                    {/* Model Selector Dropdown */}
                    <div style={{ marginBottom: 12 }}>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--av-text)', marginBottom: 4 }}>
                            AI Model
                        </label>
                        <select
                            value={selectedModel}
                            onChange={(e) => handleModelChange(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '6px 8px',
                                borderRadius: 6,
                                background: 'var(--av-surface-alt, #0f172a)',
                                border: '1px solid var(--av-border)',
                                color: 'var(--av-text)',
                                fontSize: 11,
                                outline: 'none',
                                cursor: 'pointer'
                            }}
                        >
                            {GEMINI_MODELS.map((m) => (
                                <option key={m.id} value={m.id}>
                                    {m.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    {/* API Key Input Field */}
                    <div style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--av-text)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <KeyRound size={12} color="var(--av-text-muted)" />
                                <span>Gemini API Key</span>
                            </label>
                            <a
                                href="https://aistudio.google.com/app/apikey"
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                    fontSize: 10,
                                    color: 'var(--av-accent, #6366f1)',
                                    textDecoration: 'none',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 2
                                }}
                            >
                                <span>Get free key</span>
                                <ExternalLink size={9} />
                            </a>
                        </div>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                background: 'var(--av-surface-alt, #0f172a)',
                                border: '1px solid var(--av-border)',
                                borderRadius: 6,
                                padding: '4px 8px'
                            }}
                        >
                            <input
                                type={showKey ? 'text' : 'password'}
                                value={apiKey}
                                onChange={(e) => handleApiKeyChange(e.target.value)}
                                placeholder="Paste your Gemini API key (AIzaSy...)"
                                style={{
                                    flex: 1,
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--av-text)',
                                    fontSize: 11,
                                    outline: 'none'
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowKey(!showKey)}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--av-text-muted)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '2px'
                                }}
                                title={showKey ? 'Hide key' : 'Show key'}
                            >
                                {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                            </button>
                        </div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--av-text-muted)', lineHeight: 1.4 }}>
                        {!hasCustomKey && !hostedAi
                            ? 'Add your free Gemini key from AI Studio to use AI Smart Fill.'
                            : isPro
                                ? 'Pro: unlimited AI fills. Your key stays in this browser.'
                                : `Free plan: ${FREE_TIER_WEEKLY_LIMIT} AI fills per week. Upgrade to Pro for unlimited.`}
                    </div>
                </div>
            )}

            {/* AI Memories (read by background.ts for AI Smart Fill) */}
            <MemoriesCard useAiFill={useAiFill} />

            {/* Auto-Pagination Card (Pro) */}
            <div className="av-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div className="av-label" style={{ margin: 0 }}>Auto-Pagination</div>
                    <span className="av-plan-badge av-plan-badge--pro">
                        <Crown size={10} />
                        PRO
                    </span>
                </div>
                <div className="av-toggle-row">
                    <div>
                        <div className="av-toggle-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <ChevronsRight size={13} color={isPro ? 'var(--av-accent, #6366f1)' : 'var(--av-text-muted)'} />
                            <span>Fill Multi-Page Forms</span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--av-text-muted)' }}>
                            Fills each page, clicks Next / Continue, and presses Submit at the end. Corrects answers the form rejects; pauses when it can't.
                        </div>
                    </div>
                    <button
                        className={`av-toggle ${isPro && autoPaginate ? 'av-toggle--active' : ''}`}
                        onClick={onToggleAutoPaginate}
                        disabled={!isPro}
                        title={isPro ? 'Toggle Auto-Pagination' : 'Pro feature'}
                    >
                        <div className="av-toggle__thumb" />
                    </button>
                </div>
                {!isPro && (
                    <a
                        href={AULLEVO_WEB_URL}
                        target="_blank"
                        rel="noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 10.5, fontWeight: 600, color: 'var(--av-yellow)', textDecoration: 'none' }}
                    >
                        <Crown size={11} />
                        <span>Upgrade to Pro to use Auto-Pagination</span>
                    </a>
                )}
            </div>

            {/* Webpage Floating Trigger Card */}
            <div className="av-card">
                <div className="av-label">Webpage Floating Icon</div>
                <div className="av-toggle-row">
                    <div>
                        <div className="av-toggle-title">Show Floating Button</div>
                        <div style={{ fontSize: 10, color: 'var(--av-text-muted)' }}>
                            Display the quick-access Aullevo tab docked on webpage edges
                        </div>
                    </div>
                    <button
                        className={`av-toggle ${showFloatingIcon ? 'av-toggle--active' : ''}`}
                        onClick={onToggleFloatingIcon}
                        title="Toggle Webpage Floating Button"
                    >
                        <div className="av-toggle__thumb" />
                    </button>
                </div>
            </div>

            {/* Human Typing Speed Card */}
            <div className="av-card">
                {/* Header Row with Badge */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 12 }}>
                        <Keyboard size={14} color="var(--av-violet, #6366f1)" />
                        <span>Human Typing Speed</span>
                    </div>
                    <span
                        style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 12,
                            background: 'rgba(99, 102, 241, 0.15)',
                            color: 'var(--av-violet, #6366f1)',
                            border: '1px solid rgba(99, 102, 241, 0.3)'
                        }}
                    >
                        {canUseTypingDelay(typingDelayMs, isPro) ? getSpeedBadge(typingDelayMs) : 'Natural (25ms) · Free plan'}
                    </span>
                </div>

                {/* Subtitle Description */}
                <div style={{ fontSize: 11, color: 'var(--av-text-muted)', marginBottom: 12, lineHeight: 1.4 }}>
                    Simulates realistic keystrokes to bypass anti-bot form detectors on sensitive job portals.
                </div>

                {/* 3 Preset Buttons */}
                <div className="av-speed-presets" style={{ marginBottom: 12 }}>
                    <button
                        type="button"
                        className={`av-speed-preset-btn ${typingDelayMs === 0 ? 'active' : ''}`}
                        onClick={() => onChangeTypingDelay(0)}
                    >
                        <Zap size={11} />
                        <span>Instant (0ms)</span>
                    </button>
                    <button
                        type="button"
                        className={`av-speed-preset-btn ${typingDelayMs === 25 ? 'active' : ''}`}
                        onClick={() => onChangeTypingDelay(25)}
                    >
                        <User size={11} />
                        <span>Natural (25ms)</span>
                    </button>
                    <button
                        type="button"
                        className={`av-speed-preset-btn ${typingDelayMs === 65 ? 'active' : ''}`}
                        onClick={() => onChangeTypingDelay(65)}
                        disabled={!isPro}
                        title={isPro ? undefined : 'Pro feature'}
                    >
                        {isPro ? <Clock size={11} /> : <Crown size={11} />}
                        <span>Slow (65ms)</span>
                    </button>
                </div>

                {/* Custom Delay Divider & Input Row */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingTop: 10,
                        borderTop: '1px solid var(--av-border)'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--av-text)' }}>
                        <Sliders size={13} color="var(--av-text-muted)" />
                        <span>Custom Delay:</span>
                        {!isPro && <Crown size={11} color="#eab308" />}
                    </div>

                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            background: 'var(--av-surface-alt, #0f172a)',
                            border: '1px solid var(--av-border)',
                            borderRadius: 6,
                            padding: '3px 8px'
                        }}
                    >
                        <input
                            type="number"
                            min="0"
                            max="1000"
                            step="5"
                            value={typingDelayMs}
                            disabled={!isPro}
                            title={isPro ? undefined : 'Custom delay is a Pro feature'}
                            onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                onChangeTypingDelay(isNaN(val) ? 0 : Math.max(0, Math.min(1000, val)));
                            }}
                            style={{
                                width: 44,
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--av-text)',
                                fontWeight: 700,
                                fontSize: 12,
                                textAlign: 'center',
                                outline: 'none'
                            }}
                        />
                        <span style={{ fontSize: 11, color: 'var(--av-text-muted)', fontWeight: 600 }}>ms</span>
                    </div>
                </div>
            </div>

            {/* Security Card */}
            <div className="av-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div>
                    <div className="av-label" style={{ color: 'var(--av-success)', display: 'flex', alignItems: 'center', gap: 4, margin: 0 }}>
                        <Lock size={11} />
                        <span>Encrypted Locally</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--av-text-muted)', marginTop: 2 }}>AES-256 · stays in this browser</div>
                </div>
                <button type="button" className="av-pill" onClick={() => lockVault()}>
                    <Lock size={11} />
                    <span>Lock</span>
                </button>
            </div>
        </>
    );
}
