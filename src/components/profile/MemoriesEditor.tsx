import { useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import type { Memory } from '../../types';

export interface MemoriesEditorProps {
    memories: Memory[];
    onAdd: (memory: Memory) => void;
    onRemove: (id: string) => void;
    inputClass?: string;
    labelClass?: string;
    btnClass?: string;
    cardClass?: string;
    disabled?: boolean;
}

export function MemoriesEditor({
    memories,
    onAdd,
    onRemove,
    inputClass = 'av-input',
    labelClass = 'av-label',
    btnClass = 'av-filelib__add-btn',
    cardClass = 'av-memory-item',
    disabled = false,
}: MemoriesEditorProps) {
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');

    const handleAdd = () => {
        if (!title.trim() || !content.trim()) return;
        onAdd({
            id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            title: title.trim(),
            content: content.trim(),
        });
        setTitle('');
        setContent('');
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {memories.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--av-text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
                    No memories saved yet. Memories provide context for AI-driven answers.
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {memories.map((m) => (
                        <div
                            key={m.id}
                            className={cardClass}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'flex-start',
                                padding: 8,
                                borderRadius: 6,
                                background: 'var(--av-surface-alt, rgba(255,255,255,0.03))',
                                border: '1px solid var(--av-border, rgba(255,255,255,0.08))',
                            }}
                        >
                            <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--av-text, #ffffff)' }}>{m.title}</div>
                                <div style={{ fontSize: 12, color: 'var(--av-text-mid, #cbd5e1)', marginTop: 2, whiteSpace: 'pre-wrap' }}>
                                    {m.content}
                                </div>
                            </div>
                            {!disabled && (
                                <button
                                    type="button"
                                    onClick={() => onRemove(m.id)}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'var(--av-error, #f87171)',
                                        cursor: 'pointer',
                                        padding: 4,
                                        display: 'flex',
                                        alignItems: 'center',
                                    }}
                                    title="Delete memory"
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
                        Add Memory
                    </div>
                    <div>
                        <label className={labelClass}>Topic / Title</label>
                        <input
                            className={inputClass}
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="e.g. Leadership Experience, Why Aullevo"
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Details / Key Points</label>
                        <textarea
                            className={inputClass}
                            rows={3}
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder="Describe relevant achievements, stories, or situational context..."
                        />
                    </div>
                    <button
                        type="button"
                        className={btnClass}
                        style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}
                        onClick={handleAdd}
                    >
                        <Plus size={14} /> Add Memory
                    </button>
                </div>
            )}
        </div>
    );
}
