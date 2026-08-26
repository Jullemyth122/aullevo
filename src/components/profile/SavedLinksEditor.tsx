import { useState } from 'react';
import { Trash2, Plus, ExternalLink } from 'lucide-react';
import type { SavedLink } from '../../types';

export interface SavedLinksEditorProps {
    savedLinks: SavedLink[];
    onAdd: (link: SavedLink) => void;
    onRemove: (id: string) => void;
    inputClass?: string;
    labelClass?: string;
    btnClass?: string;
    cardClass?: string;
    disabled?: boolean;
}

export function SavedLinksEditor({
    savedLinks,
    onAdd,
    onRemove,
    inputClass = 'av-input',
    labelClass = 'av-label',
    btnClass = 'av-filelib__add-btn',
    cardClass = 'av-link-item',
    disabled = false,
}: SavedLinksEditorProps) {
    const [title, setTitle] = useState('');
    const [url, setUrl] = useState('');
    const [autoFill, setAutoFill] = useState(true);

    const handleAdd = () => {
        if (!title.trim() || !url.trim()) return;
        onAdd({
            id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            title: title.trim(),
            url: url.trim(),
            autoFill,
        });
        setTitle('');
        setUrl('');
        setAutoFill(true);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {savedLinks.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--av-text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
                    No saved links yet. Add portfolio links, projects, or certifications.
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {savedLinks.map((link) => (
                        <div
                            key={link.id}
                            className={cardClass}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: 8,
                                borderRadius: 6,
                                background: 'var(--av-surface-alt, rgba(255,255,255,0.03))',
                                border: '1px solid var(--av-border, rgba(255,255,255,0.08))',
                            }}
                        >
                            <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                                <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--av-text, #ffffff)' }}>
                                    {link.title}
                                    {link.autoFill && (
                                        <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'rgba(99,102,241,0.15)', color: 'var(--av-violet, #818cf8)' }}>
                                            Auto-Fill
                                        </span>
                                    )}
                                </div>
                                <a
                                    href={link.url.startsWith('http') ? link.url : `https://${link.url}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{
                                        fontSize: 12,
                                        color: 'var(--av-violet, #818cf8)',
                                        textDecoration: 'none',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 3,
                                        marginTop: 2,
                                        maxWidth: '100%',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {link.url} <ExternalLink size={10} />
                                </a>
                            </div>
                            {!disabled && (
                                <button
                                    type="button"
                                    onClick={() => onRemove(link.id)}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'var(--av-error, #f87171)',
                                        cursor: 'pointer',
                                        padding: 4,
                                        display: 'flex',
                                        alignItems: 'center',
                                    }}
                                    title="Delete link"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {!disabled && (
                <div
                    style={{
                        padding: 10,
                        borderRadius: 8,
                        background: 'var(--av-surface-alt, rgba(255,255,255,0.02))',
                        border: '1px dashed var(--av-border, rgba(255,255,255,0.12))',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                    }}
                >
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--av-text-muted)' }}>
                        Add Link
                    </div>
                    <div>
                        <label className={labelClass}>Link Title / Label</label>
                        <input
                            className={inputClass}
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="e.g. Design Portfolio, Personal Blog"
                        />
                    </div>
                    <div>
                        <label className={labelClass}>URL</label>
                        <input
                            className={inputClass}
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="https://..."
                        />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--av-text)' }}>
                        <input
                            type="checkbox"
                            checked={autoFill}
                            onChange={(e) => setAutoFill(e.target.checked)}
                        />
                        Include in auto-fill matching
                    </label>
                    <button
                        type="button"
                        className={btnClass}
                        style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}
                        onClick={handleAdd}
                    >
                        <Plus size={14} /> Add Link
                    </button>
                </div>
            )}
        </div>
    );
}
