import { useState } from 'react';
import { Plus, Trash2, ExternalLink, Play } from 'lucide-react';
import type { SavedLink, UserData } from '../../types';

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
    const [inputUrl, setInputUrl] = useState('');
    const enabledCount = links.filter(l => l.enabled).length;

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
            <div className="av-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--av-text)' }}>
                        Batch Autofill Queue
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--av-violet)', fontWeight: 600 }}>
                        {enabledCount} of {links.length} active
                    </span>
                </div>

                <div style={{ fontSize: 11, color: 'var(--av-text-muted)', marginBottom: 10, lineHeight: 1.4 }}>
                    Automate opening and filling forms across multiple tabs using your active <strong>{currentProfile.profileType.toUpperCase()}</strong> profile.
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
                    <span>{isBatchRunning ? 'Batch Autofilling in Progress...' : `Fill ${enabledCount} Forms in Batch`}</span>
                </button>
            </div>

            {/* Add Link Input Card */}
            <div className="av-card">
                <div className="av-label">Add Form / Job Link</div>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div className="av-label" style={{ margin: 0 }}>Saved Links ({links.length})</div>
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
                            Clear All
                        </button>
                    )}
                </div>

                {links.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '16px 0', fontSize: 11, color: 'var(--av-text-muted)' }}>
                        No links added yet. Paste a form URL above to start.
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

                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 6 }}>
                                    <a
                                        href={link.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        title="Open link"
                                        style={{ color: 'var(--av-text-muted)', padding: 4, display: 'flex' }}
                                    >
                                        <ExternalLink size={12} />
                                    </a>
                                    <button
                                        type="button"
                                        onClick={() => onDeleteLink(link.id)}
                                        title="Remove link"
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
