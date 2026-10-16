import { Zap, User, Clock, Sliders, Keyboard, Bot, Lock, EyeOff, Eye, KeyRound, ExternalLink, ShieldCheck, Sparkles, Crown, LogIn, LogOut, ChevronsRight, Compass } from 'lucide-react';
import {
    AI_PROVIDERS, AI_SETTINGS_STORAGE_KEYS, AI_PROVIDER_STORAGE_KEY, AI_MODELS_STORAGE_KEY, AI_BASE_URL_STORAGE_KEY,
    aiRecipientName, getAiProvider, getProviderApiKey, hasAiAccess, readAiSettings,
    type AiModelOption, type AiModelTier, type AiProvider, type AiProviderId, type AiSettings
} from '../../services/aiService';
import { readVault, writeVault } from '../../services/vault';
import { canUseTypingDelay } from '../../services/tier';
import { formatTimeLeft, freeLeft, passActive, passMsLeft, usesLeft } from '../../services/rewards';
import { usePlanRewards } from '../../hooks/useRewards';
import { PlanUnlock, UnlockList } from '../UnlockCard';
import { CollapsibleCard } from '../CollapsibleCard';
import type { useAccount } from '../../hooks/useAccount';
import { AULLEVO_WEB_URL } from '../../services/account';
import { useEffect, useRef, useState } from 'react';
import { MemoriesCard } from './MemoriesCard';
import { DeviceDataCard } from './DeviceDataCard';
import { KeyGuide } from '../KeyGuide';
import { useT, setLanguagePreference } from '../../i18n';
import { LANGUAGES, AUTO_LANGUAGE, DEFAULT_LANGUAGE, getLanguage, getBrowserLanguage } from '../../i18n/languages';

// Model dropdown value that opens the text field for any other model ID
const OTHER_MODEL = '__other__';
const MODEL_ID_EXAMPLES: Record<AiProviderId, string> = {
    gemini: 'gemini-3.5-flash',
    openai: 'gpt-5.4',
    anthropic: 'claude-fable-5-1',
    custom: 'meta-llama/llama-4-maverick'
};

const fieldLabelStyle = { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--av-text)', marginBottom: 4 } as const;
const selectStyle = {
    width: '100%',
    padding: '6px 8px',
    borderRadius: 6,
    background: 'var(--av-surface-alt, #0f172a)',
    border: '1px solid var(--av-border)',
    color: 'var(--av-text)',
    fontSize: 11,
    outline: 'none',
    cursor: 'pointer'
} as const;
const textInputStyle = { ...selectStyle, cursor: 'text', boxSizing: 'border-box' } as const;

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
    onReplayTour?: () => void;
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
    accountState,
    onReplayTour
}: SettingsTabProps) {
    const { account, isPro, isConnecting, connect, disconnect } = accountState;
    // Free plan: a daily free allowance, and a pass (2 short ads on aullevo-web: everything for 5 hours; rewards.ts)
    const plan = usePlanRewards();
    const typingOk = isPro || plan.access.typing;
    const paginateOk = isPro || plan.access.paginate;
    const { t, tRich, language, preference } = useT();
    const browserLanguage = getLanguage(getBrowserLanguage());

    // -----------------------------------------------------------------------
    // AI Configuration State (one API key per provider in the encrypted vault;
    // provider, model per provider, server URL and usage in chrome.storage.local)
    // -----------------------------------------------------------------------
    const [aiSettings, setAiSettings] = useState<AiSettings>(() => readAiSettings(undefined));
    const [apiKeys, setApiKeys] = useState<Partial<Record<AiProviderId, string>>>({});
    const [showKey, setShowKey] = useState(false);
    const apiKeySaveTimer = useRef<number | null>(null);
    useEffect(() => {
        readVault().then((vault) => {
            setApiKeys(Object.fromEntries(AI_PROVIDERS.map(p => [p.id, getProviderApiKey(vault, p.id)])));
        });
        chrome.storage?.local?.get(
            [...AI_SETTINGS_STORAGE_KEYS],
            (res) => {
                setAiSettings(readAiSettings(res));
            }
        );
    }, []);
    const provider = getAiProvider(aiSettings.provider);
    const apiKey = apiKeys[provider.id] ?? '';
    const selectedModel = aiSettings.models[provider.id];
    // A model typed in by hand (or none yet) shows the "Other model" text field
    const isOtherModel = !provider.models.some(m => m.id === selectedModel);

    const handleApiKeyChange = (val: string) => {
        const next = { ...apiKeys, [provider.id]: val };
        setApiKeys(next);
        // Debounced: each save re-encrypts the whole vault
        if (apiKeySaveTimer.current) clearTimeout(apiKeySaveTimer.current);
        apiKeySaveTimer.current = window.setTimeout(() => {
            const trimmed = Object.fromEntries(Object.entries(next).map(([id, key]) => [id, (key ?? '').trim()]));
            writeVault({ aiApiKeys: trimmed }).catch((err) => console.error('[Aullevo:Settings] API key save failed:', err));
        }, 500);
    };
    const handleProviderChange = (id: AiProviderId) => {
        setAiSettings(s => ({ ...s, provider: id }));
        setShowKey(false);
        chrome.storage?.local?.set({ [AI_PROVIDER_STORAGE_KEY]: id });
    };
    const handleModelChange = (modelId: string) => {
        const models = { ...aiSettings.models, [provider.id]: modelId };
        setAiSettings(s => ({ ...s, models }));
        chrome.storage?.local?.set({ [AI_MODELS_STORAGE_KEY]: models });
    };
    const handleBaseUrlChange = (url: string) => {
        setAiSettings(s => ({ ...s, baseUrl: url }));
        chrome.storage?.local?.set({ [AI_BASE_URL_STORAGE_KEY]: url.trim() });
    };

    const getSpeedBadge = (ms: number) => {
        if (ms === 0) return t('settings.typing.instant', { ms: 0 });
        if (ms === 25) return t('settings.typing.natural', { ms: 25 });
        if (ms === 65) return t('settings.typing.slow', { ms: 65 });
        return t('settings.typing.custom', { ms });
    };

    // Product name stays as-is; only the descriptor in brackets is translated
    const modelDescriptions: Record<AiModelTier, string> = {
        fastest: t('settings.ai.models.fastest'),
        balanced: t('settings.ai.models.balanced'),
        capable: t('settings.ai.models.capable'),
        smartest: t('settings.ai.models.smartest'),
        legacy: t('settings.ai.models.legacy')
    };
    const modelLabel = (m: AiModelOption) => t('settings.ai.modelOption', { name: m.name, description: modelDescriptions[m.tier] });
    // ✓ marks providers that are ready to use, so keys can be added one by one and switched between
    const providerLabel = (p: AiProvider) => {
        const label = p.id === 'custom' ? t('settings.ai.customProvider') : p.label;
        const ready = p.id === 'custom' ? Boolean(aiSettings.baseUrl.trim()) : Boolean(apiKeys[p.id]?.trim());
        return ready ? `${label} ✓` : label;
    };
    // The custom server is named by its URL's host, so its name needs no translation
    const providerName = provider.id === 'custom' ? 'OpenAI-compatible' : provider.name;

    const hasAccess = hasAiAccess({ provider: provider.id, model: selectedModel, apiKey, baseUrl: aiSettings.baseUrl });
    const isUnlimited = (isPro || plan.access.pass) && hasAccess;
    const aiBadgeText = isUnlimited
        ? t('settings.ai.unlimited')
        : !hasAccess ? t('settings.ai.keyRequired')
            : plan.access.ai ? t('rewards.settings.aiLeft', { left: usesLeft(plan.cache, 'ai') + freeLeft(plan.cache, 'ai') }) : t('rewards.settings.aiLocked');


    return (
        <>
            {/* Account & Plan Card (synced with aullevo-web) */}
            <CollapsibleCard
                id="account"
                tour="account"
                title={t('settings.account.title')}
                summary={account ? account.displayName || account.email : t('settings.sections.notConnected')}
                badge={
                    <span className={`av-plan-badge ${isPro ? 'av-plan-badge--pro' : ''}`}>
                        {isPro && <Crown size={10} />}
                        {isPro ? 'PRO' : 'FREE'}
                    </span>
                }
            >
                {account ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {account.photoURL && (
                            <img src={account.photoURL} alt="" width={28} height={28} style={{ borderRadius: '50%', flexShrink: 0 }} referrerPolicy="no-referrer" />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{account.displayName || account.email}</div>
                            <div style={{ fontSize: 10, color: 'var(--av-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {isPro
                                    ? account.proExpiresAt
                                        ? t('settings.account.proUntil', { date: new Date(account.proExpiresAt).toLocaleDateString() })
                                        : t('settings.account.proLifetime')
                                    : account.email}
                            </div>
                        </div>
                        <button type="button" className="av-pill av-pill--danger" onClick={disconnect} title={t('settings.account.disconnect')}>
                            <LogOut size={11} />
                        </button>
                    </div>
                ) : (
                    <button type="button" className="av-save-btn" onClick={connect} style={{ margin: 0 }}>
                        <LogIn size={12} />
                        <span>{isConnecting ? t('settings.account.waiting') : t('settings.account.connect')}</span>
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
                        <span>{account?.isPro ? t('settings.account.renew') : t('settings.account.upgrade')}</span>
                    </a>
                )}
            </CollapsibleCard>

            {/* Free plan: the 2-ad pass and what is free every day */}
            {!isPro && (
                <CollapsibleCard
                    id="free-plan"
                    tour="free-unlocks"
                    title={t('rewards.settings.title')}
                    summary={passActive(plan.cache) ? t('rewards.pass.active', { time: formatTimeLeft(passMsLeft(plan.cache)) }) : undefined}
                >
                    <div style={{ fontSize: 10.5, color: 'var(--av-text-muted)', lineHeight: 1.45, marginBottom: 6 }}>
                        {t('rewards.settings.intro')}
                    </div>
                    <UnlockList cache={plan.cache} signedIn={plan.signedIn} onWatch={plan.openUnlock} onConnect={plan.connect} />
                    {plan.cache && (
                        <div style={{ fontSize: 10, color: 'var(--av-text-muted)', marginTop: 6 }}>
                            {t('rewards.settings.adsToday', { count: plan.cache.adsToday, limit: plan.cache.dailyLimit })}
                            {!plan.cache.live && <> · {t('rewards.settings.testMode')}</>}
                        </div>
                    )}
                </CollapsibleCard>
            )}

            {/* Language Card ("Language" always also in English, so it can be found in any language) */}
            <CollapsibleCard
                id="language"
                tour="language-settings"
                defaultOpen={false}
                title={<>{t('language.title')}{language !== DEFAULT_LANGUAGE && <span lang="en"> · Language</span>}</>}
                summary={getLanguage(language)?.native ?? 'English'}
            >
                <select
                    className="av-input"
                    value={preference}
                    onChange={(e) => setLanguagePreference(e.target.value)}
                    style={{ fontSize: 12 }}
                >
                    <option value={DEFAULT_LANGUAGE}>English</option>
                    <option value={AUTO_LANGUAGE}>{t('language.auto', { name: browserLanguage?.native ?? 'English' })}</option>
                    {LANGUAGES.filter(l => l.code !== DEFAULT_LANGUAGE).map(l => (
                        <option key={l.code} value={l.code}>
                            {l.native === l.english ? l.native : `${l.native} · ${l.english}`}
                        </option>
                    ))}
                </select>
                <div style={{ fontSize: 10, color: 'var(--av-text-muted)', marginTop: 6 }}>
                    {t('language.settingsHint')}
                </div>
            </CollapsibleCard>

            {/* Theme Card */}
            <CollapsibleCard
                id="theme"
                defaultOpen={false}
                title={t('settings.theme.title')}
                summary={isDark ? t('settings.sections.dark') : t('settings.sections.light')}
            >
                <div className="av-toggle-row">
                    <div>
                        <div className="av-toggle-title">{t('settings.theme.dark')}</div>
                        <div style={{ fontSize: 10, color: 'var(--av-text-muted)' }}>
                            {t('settings.theme.description')}
                        </div>
                    </div>
                    <button
                        className={`av-toggle ${isDark ? 'av-toggle--active' : ''}`}
                        onClick={onToggleTheme}
                    >
                        <div className="av-toggle__thumb" />
                    </button>
                </div>
            </CollapsibleCard>

            {/* Autofill Mode Card */}
            <CollapsibleCard
                id="ai-mode"
                tour="ai-mode"
                title={t('settings.mode.title')}
                summary={useAiFill ? t('settings.mode.aiActive') : t('settings.mode.standard')}
            >
                <div className="av-toggle-row">
                    <div>
                        <div className="av-toggle-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {useAiFill ? (
                                <>
                                    <Bot size={13} color="var(--av-accent, #6366f1)" />
                                    <span>{t('settings.mode.aiActive')}</span>
                                </>
                            ) : (
                                <>
                                    <Zap size={13} color="var(--av-text-muted)" />
                                    <span>{t('settings.mode.standard')}</span>
                                </>
                            )}
                        </div>

                        <div style={{ fontSize: 10, color: 'var(--av-text-muted)' }}>
                            {useAiFill
                                ? t('settings.mode.aiDescription')
                                : t('settings.mode.standardDescription')}
                        </div>
                    </div>
                    <button
                        className={`av-toggle ${useAiFill ? 'av-toggle--active' : ''}`}
                        onClick={onToggleAiFill}
                        title={t('settings.mode.toggle')}
                    >
                        <div className="av-toggle__thumb" />
                    </button>
                </div>
            </CollapsibleCard>

            {/* AI Smart Fill Configuration Card */}
            {useAiFill && (
                <CollapsibleCard
                    id="ai-engine"
                    tour="ai-engine"
                    style={{ border: '1px solid rgba(99, 102, 241, 0.25)' }}
                    title={<><Sparkles size={13} color="var(--av-accent, #6366f1)" /><span>{t('settings.ai.title')}</span></>}
                    summary={provider.id === 'custom' ? providerName : `${providerName} · ${selectedModel}`}
                    badge={
                        <span
                            style={{
                                flexShrink: 0,
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
                    }
                >
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
                        <span>{tRich('settings.ai.privacy', { provider: aiRecipientName(aiSettings) })}</span>
                    </div>
                    {/* Provider Selector Dropdown */}
                    <div style={{ marginBottom: 12 }}>
                        <label style={fieldLabelStyle}>
                            {t('settings.ai.provider')}
                        </label>
                        <select
                            value={provider.id}
                            onChange={(e) => handleProviderChange(e.target.value as AiProviderId)}
                            style={selectStyle}
                        >
                            {AI_PROVIDERS.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {providerLabel(p)}
                                </option>
                            ))}
                        </select>
                    </div>
                    {/* Server URL (custom OpenAI-compatible provider only) */}
                    {provider.id === 'custom' && (
                        <div style={{ marginBottom: 12 }}>
                            <label style={fieldLabelStyle}>
                                {t('settings.ai.baseUrl')}
                            </label>
                            <input
                                type="url"
                                value={aiSettings.baseUrl}
                                onChange={(e) => handleBaseUrlChange(e.target.value)}
                                placeholder="https://openrouter.ai/api/v1"
                                spellCheck={false}
                                style={textInputStyle}
                            />
                            <div style={{ fontSize: 10, color: 'var(--av-text-muted)', lineHeight: 1.4, marginTop: 4 }}>
                                {t('settings.ai.customHint')}
                            </div>
                        </div>
                    )}
                    {/* Model Selector Dropdown (+ any other model by its exact ID) */}
                    <div style={{ marginBottom: 12 }}>
                        <label style={fieldLabelStyle}>
                            {t('settings.ai.model')}
                        </label>
                        {provider.models.length > 0 && (
                            <select
                                value={isOtherModel ? OTHER_MODEL : selectedModel}
                                onChange={(e) => handleModelChange(e.target.value === OTHER_MODEL ? '' : e.target.value)}
                                style={selectStyle}
                            >
                                {provider.models.map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {modelLabel(m)}
                                    </option>
                                ))}
                                <option value={OTHER_MODEL}>{t('settings.ai.otherModel')}</option>
                            </select>
                        )}
                        {isOtherModel && (
                            <input
                                type="text"
                                value={selectedModel}
                                onChange={(e) => handleModelChange(e.target.value)}
                                placeholder={t('settings.ai.modelIdPlaceholder', { example: MODEL_ID_EXAMPLES[provider.id] })}
                                spellCheck={false}
                                style={{ ...textInputStyle, marginTop: provider.models.length > 0 ? 6 : 0 }}
                            />
                        )}
                    </div>
                    {/* API Key Input Field (each provider keeps its own key) */}
                    <div style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--av-text)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <KeyRound size={12} color="var(--av-text-muted)" />
                                <span>{t('settings.ai.apiKey', { provider: providerName })}</span>
                            </label>
                            {provider.keyUrl && (
                                <a
                                    href={provider.keyUrl}
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
                                    <span>{t('settings.ai.getKey')}</span>
                                    <ExternalLink size={9} />
                                </a>
                            )}
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
                                placeholder={t('settings.ai.keyPlaceholder', { provider: providerName })}
                                spellCheck={false}
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
                                title={showKey ? t('settings.ai.hideKey') : t('settings.ai.showKey')}
                            >
                                {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                            </button>
                        </div>
                    </div>
                    {/* New to API keys: the steps, and a button to the provider's page */}
                    <KeyGuide
                        key={provider.id}
                        toggleLabel={t('settings.ai.guide.toggle')}
                        defaultOpen={!apiKey.trim() && provider.id !== 'custom'}
                        note={<>{t(`settings.ai.guide.${provider.id}.note`)} {t('settings.ai.guide.optional')}</>}
                        steps={(provider.id === 'custom' ? [1, 2, 3] : [1, 2, 3, 4]).map(n => tRich(`settings.ai.guide.${provider.id}.step${n}`))}
                        link={provider.keyUrl ? { url: provider.keyUrl, label: t(`settings.ai.guide.${provider.id}.open`) } : undefined}
                    />
                    <div style={{ fontSize: 10, color: 'var(--av-text-muted)', lineHeight: 1.4, marginTop: 6 }}>
                        {!hasAccess
                            ? provider.id === 'custom' || apiKey.trim() ? null : t('settings.ai.addKeyHint', { provider: providerName })
                            : isPro
                                ? t('settings.ai.proHint')
                                : null}
                    </div>
                    {!isPro && hasAccess && <div style={{ marginTop: 8 }}><PlanUnlock feature="ai" /></div>}
                </CollapsibleCard>
            )}

            {/* AI Memories (read by background.ts for AI Smart Fill) */}
            <MemoriesCard useAiFill={useAiFill} />

            {/* Auto-Pagination Card (Pro) */}
            <CollapsibleCard
                id="auto-paginate"
                tour="auto-paginate"
                defaultOpen={false}
                title={t('settings.paginate.title')}
                summary={paginateOk && autoPaginate ? t('settings.sections.on') : t('settings.sections.off')}
                badge={!paginateOk ? (
                    <span className="av-plan-badge av-plan-badge--pro">
                        <Crown size={10} />
                        PRO / AD
                    </span>
                ) : undefined}
            >
                <div className="av-toggle-row">
                    <div>
                        <div className="av-toggle-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <ChevronsRight size={13} color={paginateOk ? 'var(--av-accent, #6366f1)' : 'var(--av-text-muted)'} />
                            <span>{t('settings.paginate.toggleTitle')}</span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--av-text-muted)' }}>
                            {t('settings.paginate.description')}
                        </div>
                    </div>
                    <button
                        className={`av-toggle ${paginateOk && autoPaginate ? 'av-toggle--active' : ''}`}
                        onClick={onToggleAutoPaginate}
                        disabled={!paginateOk}
                        title={paginateOk ? t('settings.paginate.toggle') : t('rewards.status.paginateLocked')}
                    >
                        <div className="av-toggle__thumb" />
                    </button>
                </div>
                {!isPro && <div style={{ marginTop: 8 }}><PlanUnlock feature="paginate" /></div>}
            </CollapsibleCard>

            {/* Webpage Floating Trigger Card */}
            <CollapsibleCard
                id="floating-icon"
                tour="floating-icon"
                defaultOpen={false}
                title={t('settings.floating.title')}
                summary={showFloatingIcon ? t('settings.sections.on') : t('settings.sections.off')}
            >
                <div className="av-toggle-row">
                    <div>
                        <div className="av-toggle-title">{t('settings.floating.toggleTitle')}</div>
                        <div style={{ fontSize: 10, color: 'var(--av-text-muted)' }}>
                            {t('settings.floating.description')}
                        </div>
                    </div>
                    <button
                        className={`av-toggle ${showFloatingIcon ? 'av-toggle--active' : ''}`}
                        onClick={onToggleFloatingIcon}
                        title={t('settings.floating.toggle')}
                    >
                        <div className="av-toggle__thumb" />
                    </button>
                </div>
            </CollapsibleCard>

            {/* Human Typing Speed Card */}
            <CollapsibleCard
                id="typing-speed"
                tour="typing-speed"
                defaultOpen={false}
                title={<><Keyboard size={13} color="var(--av-violet, #6366f1)" /><span>{t('settings.typing.title')}</span></>}
                badge={
                    <span
                        style={{
                            flexShrink: 0,
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 12,
                            background: 'rgba(99, 102, 241, 0.15)',
                            color: 'var(--av-violet, #6366f1)',
                            border: '1px solid rgba(99, 102, 241, 0.3)'
                        }}
                    >
                        {canUseTypingDelay(typingDelayMs, typingOk) ? getSpeedBadge(typingDelayMs) : t('settings.typing.naturalFree', { ms: 25 })}
                    </span>
                }
            >

                {/* Subtitle Description */}
                <div style={{ fontSize: 11, color: 'var(--av-text-muted)', marginBottom: 12, lineHeight: 1.4 }}>
                    {t('settings.typing.description')}
                </div>

                {/* 3 Preset Buttons */}
                <div className="av-speed-presets" style={{ marginBottom: 12 }}>
                    <button
                        type="button"
                        className={`av-speed-preset-btn ${typingDelayMs === 0 ? 'active' : ''}`}
                        onClick={() => onChangeTypingDelay(0)}
                    >
                        <Zap size={11} />
                        <span>{t('settings.typing.instant', { ms: 0 })}</span>
                    </button>
                    <button
                        type="button"
                        className={`av-speed-preset-btn ${typingDelayMs === 25 ? 'active' : ''}`}
                        onClick={() => onChangeTypingDelay(25)}
                    >
                        <User size={11} />
                        <span>{t('settings.typing.natural', { ms: 25 })}</span>
                    </button>
                    <button
                        type="button"
                        className={`av-speed-preset-btn ${typingDelayMs === 65 ? 'active' : ''}`}
                        onClick={() => onChangeTypingDelay(65)}
                        disabled={!typingOk}
                        title={typingOk ? undefined : t('rewards.status.typingLocked')}
                    >
                        {typingOk ? <Clock size={11} /> : <Crown size={11} />}
                        <span>{t('settings.typing.slow', { ms: 65 })}</span>
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
                        <span>{t('settings.typing.customDelay')}</span>
                        {!typingOk && <Crown size={11} color="#eab308" />}
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
                            disabled={!typingOk}
                            title={typingOk ? undefined : t('rewards.status.typingLocked')}
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
                        <span style={{ fontSize: 11, color: 'var(--av-text-muted)', fontWeight: 600 }}>{t('settings.typing.unitMs')}</span>
                    </div>
                </div>
                {!isPro && <div style={{ marginTop: 10 }}><PlanUnlock feature="typing" /></div>}
            </CollapsibleCard>

            {/* Guided Tour Card */}
            {onReplayTour && (
                <CollapsibleCard id="replay-tour" tour="replay-tour" defaultOpen={false} title={t('settings.tour.title')}>
                    <div className="av-toggle-row">
                        <div>
                            <div className="av-toggle-title">{t('settings.tour.toggleTitle')}</div>
                            <div style={{ fontSize: 10, color: 'var(--av-text-muted)' }}>
                                {t('settings.tour.description')}
                            </div>
                        </div>
                        <button type="button" className="av-pill" onClick={onReplayTour}>
                            <Compass size={11} />
                            <span>{t('settings.tour.replay')}</span>
                        </button>
                    </div>
                </CollapsibleCard>
            )}

            {/* Per-account data stored on this device */}
            <DeviceDataCard />

            {/* Where the data lives: encrypted in this browser, one vault per account and the guest (no passphrase) */}
            <div className="av-card" data-tour="device">
                <div className="av-label" style={{ color: 'var(--av-success)', display: 'flex', alignItems: 'center', gap: 4, margin: 0 }}>
                    <Lock size={11} />
                    <span>{t('settings.security.title')}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--av-text-muted)', marginTop: 2, lineHeight: 1.45 }}>{t('settings.security.descriptionDevice')}</div>
            </div>
        </>
    );
}
