import { useState } from 'react';
import { Plus, Trash2, ExternalLink, Play } from 'lucide-react';
import type { SavedLink, UserData } from '../../types';
import { useT } from '../../i18n';
import { usePlanRewards } from '../../hooks/useRewards';
import { PlanUnlock } from '../UnlockCard';
import { FREE_LINK_LIMIT, UNLOCKED_LINK_LIMIT } from '../../services/rewards';

interface MultiLinkTabProps {
    links: SavedLink[];
    onAddLink: (url: string, title?: string) => void;
    onToggleLink: (id: string) => void;
    onDeleteLink: (id: string) => void;
    onClearAll?: () => void;
    onStartBatchFill: () => void;
    currentProfile: UserData;
    isBatchRunning: boolean;
}

export function MultiLinkTab({
    links,
    onAddLink,
    onToggleLink,
    onDeleteLink,
    onClearAll,
    onStartBatchFill,
    currentProfile,
    isBatchRunning
}: MultiLinkTabProps) {
    const { t, tRich } = useT();
    const plan = usePlanRewards();
    const [inputUrl, setInputUrl] = useState('');
    // Free plan: the batch runs 5 links (all during a pass); Pro: all. Extra links stay saved.
    const limit = plan.access.linkLimit;
    const enabledCount = Math.min(links.filter(l => l.enabled).length, limit);
    const queueFull = Number.isFinite(limit) && links.length >= limit;

    const handleAdd = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = inputUrl.trim();
        if (!trimmed) return;
        onAddLink(trimmed);
        setInputUrl('');
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Run Batch Card */}
            <div className="av-card" data-tour="batch-run">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--av-text)' }}>
                        {t('multilink.batch.title')}
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--av-violet)', fontWeight: 600 }}>
                        {t('multilink.batch.activeCount', { enabled: enabledCount, total: links.length })}
                    </span>
                </div>

                <div style={{ fontSize: 11, color: 'var(--av-text-muted)', marginBottom: 10, lineHeight: 1.4 }}>
                    {tRich('multilink.batch.description', { type: currentProfile.profileType.toUpperCase() })}
                </div>

                <button
                    type="button"
                    onClick={onStartBatchFill}
                    disabled={isBatchRunning || enabledCount === 0}
                    style={{
                        width: '100%',
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: 'none',
                        background: isBatchRunning ? 'var(--av-border)' : 'linear-gradient(90deg, var(--av-yellow, #f59e0b), var(--av-violet, #6366f1))',
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: isBatchRunning || enabledCount === 0 ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        transition: 'opacity 0.2s',
                        opacity: enabledCount === 0 ? 0.5 : 1
                    }}
                >
                    <Play size={13} />
                    <span>{isBatchRunning ? t('multilink.batch.running') : t('multilink.batch.start', { count: enabledCount })}</span>
                </button>
            </div>

            {/* Add Link Input Card */}
            <div className="av-card" data-tour="add-link">
                <div className="av-label">{t('multilink.add.title')}</div>
                {Number.isFinite(limit) && (
                    <div style={{ fontSize: 10.5, color: queueFull ? 'var(--av-yellow)' : 'var(--av-text-muted)', marginBottom: 6 }}>
                        {t('rewards.links.count', { count: Math.min(links.length, limit), limit })}
                        {/* Links saved beyond the limit (a pass ended) stay in the queue, paused */}
                        {links.length > limit && <> · {t('rewards.links.paused', { count: links.length - limit })}</>}
                    </div>
                )}
                {!plan.isPro && (queueFull || plan.access.linkLimit > FREE_LINK_LIMIT) && (
                    <div style={{ marginBottom: 8 }}>
                        <PlanUnlock feature="links" reason={t('rewards.status.linkLimit', { max: FREE_LINK_LIMIT, unlocked: UNLOCKED_LINK_LIMIT })} />
                    </div>
                )}
                <form onSubmit={handleAdd} style={{ display: 'flex', gap: 6 }}>
                    <input
                        type="url"
                        placeholder="https://example.com/apply"
                        value={inputUrl}
                        onChange={(e) => setInputUrl(e.target.value)}
                        style={{
                            flex: 1,
                            background: 'var(--av-surface-alt)',
                            border: '1px solid var(--av-border)',
                            borderRadius: 6,
                            padding: '6px 10px',
                            color: 'var(--av-text)',
                            fontSize: 11,
                            outline: 'none'
                        }}
                    />
                    <button
                        type="submit"
                        disabled={!inputUrl.trim()}
                        style={{
                            background: 'var(--av-violet)',
                            border: 'none',
                            borderRadius: 6,
                            color: '#fff',
                            padding: '0 12px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        <Plus size={14} />
                    </button>
                </form>
            </div>

            {/* Links List */}
            <div className="av-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }} data-tour="saved-links">
                    <div className="av-label" style={{ margin: 0 }}>{t('multilink.saved.title', { count: links.length })}</div>
                    {links.length > 0 && onClearAll && (
                        <button
                            type="button"
                            onClick={onClearAll}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--av-text-muted)',
                                fontSize: 10,
                                cursor: 'pointer',
                                textDecoration: 'underline'
                            }}
                        >
                            {t('multilink.saved.clearAll')}
                        </button>
                    )}
                </div>

                {links.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '16px 0', fontSize: 11, color: 'var(--av-text-muted)' }}>
                        {t('multilink.saved.empty')}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {links.map((link) => (
                            <div
                                key={link.id}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '8px 10px',
                                    borderRadius: 6,
                                    background: 'var(--av-surface-alt)',
                                    border: '1px solid var(--av-border)'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                                    <input
                                        type="checkbox"
                                        checked={link.enabled}
                                        onChange={() => onToggleLink(link.id)}
                                        style={{ cursor: 'pointer' }}
                                    />
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--av-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {link.title || link.url}
                                        </div>
                                        <div style={{ fontSize: 10, color: 'var(--av-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {link.url}
                                        </div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginInlineStart: 6 }}>
                                    <a
                                        href={link.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        title={t('multilink.saved.open')}
                                        style={{ color: 'var(--av-text-muted)', padding: 4, display: 'flex' }}
                                    >
                                        <ExternalLink size={12} />
                                    </a>
                                    <button
                                        type="button"
                                        onClick={() => onDeleteLink(link.id)}
                                        title={t('multilink.saved.remove')}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: 'var(--av-text-muted)',
                                            cursor: 'pointer',
                                            padding: 4,
                                            display: 'flex'
                                        }}
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
