import { useEffect, useState } from 'react';
import { Brain, Check, X, Trash2, Plus, ChevronDown } from 'lucide-react';
import type { Memory } from '../../types';

// Same key and shape background.ts already reads for RESOLVE_AI_QUESTIONS
// (enabled memories with content are sent to Gemini as "title: content")
const MEMORIES_STORAGE_KEY = 'aullevo_memories';

interface MemoriesCardProps {
    useAiFill: boolean;
}

export function MemoriesCard({ useAiFill }: MemoriesCardProps) {
    const [memories, setMemories] = useState<Memory[]>([]);
    const [isOpen, setIsOpen] = useState(true);
    const [newTitle, setNewTitle] = useState('');
    const [newContent, setNewContent] = useState('');

    useEffect(() => {
        chrome.storage?.local?.get([MEMORIES_STORAGE_KEY], (res) => {
            if (Array.isArray(res?.[MEMORIES_STORAGE_KEY])) setMemories(res[MEMORIES_STORAGE_KEY] as Memory[]);
        });

        // Side panel and options page stay in sync
        const handleChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
            if (area === 'local' && changes[MEMORIES_STORAGE_KEY]) {
                const next = changes[MEMORIES_STORAGE_KEY].newValue;
                setMemories(Array.isArray(next) ? (next as Memory[]) : []);
            }
        };
        chrome.storage?.onChanged?.addListener(handleChange);
        return () => chrome.storage?.onChanged?.removeListener(handleChange);
    }, []);

    const save = (next: Memory[]) => {
        setMemories(next);
        chrome.storage?.local?.set({ [MEMORIES_STORAGE_KEY]: next });
    };

    const handleAdd = () => {
        const title = newTitle.trim();
        const content = newContent.trim();
        if (!title || !content) return;
        save([...memories, { id: `mem_${Date.now()}`, title, content, createdAt: new Date().toISOString(), enabled: true }]);
        setNewTitle('');
        setNewContent('');
    };

    const updateMemory = (id: string, updates: Partial<Memory>) =>
        save(memories.map(m => m.id === id ? { ...m, ...updates } : m));

    const enabledCount = memories.filter(m => m.enabled).length;

    return (
        <div className="av-card">
            <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="av-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Brain size={12} />
                    <span>AI Memories</span>
                    <span style={{ fontSize: 10, opacity: 0.7 }}>({enabledCount}/{memories.length} on)</span>
                </div>
                <ChevronDown
                    size={14}
                    style={{ color: 'var(--av-text-muted)', transition: 'transform 0.2s ease', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                />
            </div>

            {isOpen && (
                <>
                    <div style={{ fontSize: 10, color: 'var(--av-text-muted)', lineHeight: 1.4, margin: '6px 0 8px' }}>
                        Facts about you the AI can use to answer open questions (e.g. "Work style: remote only").
                        {useAiFill ? ' ' : ' Used only when AI Smart Fill is on. '}
                        Enabled memories are sent to Google Gemini and stored unencrypted in this browser, so don't add passwords or ID numbers.
                    </div>

                    {memories.map((memory) => (
                        <div
                            key={memory.id}
                            className={`av-cf-card-${memory.enabled ? 'active' : 'disabled'}`}
                            style={{ marginBottom: 6 }}
                        >
                            <div>
                                <input
                                    className="av-cf-input-label"
                                    value={memory.title}
                                    onChange={(e) => updateMemory(memory.id, { title: e.target.value })}
                                    disabled={!memory.enabled}
                                    placeholder="Title"
                                />
                                <textarea
                                    className="av-cf-input-value"
                                    rows={2}
                                    style={{ resize: 'vertical' }}
                                    value={memory.content}
                                    onChange={(e) => updateMemory(memory.id, { content: e.target.value })}
                                    disabled={!memory.enabled}
                                    placeholder="What the AI should know"
                                />
                            </div>
                            <div className="av-cf-card__actions">
                                <button
                                    type="button"
                                    className={`av-switch-pill ${memory.enabled ? 'av-switch-pill--on' : 'av-switch-pill--off'}`}
                                    onClick={() => updateMemory(memory.id, { enabled: !memory.enabled })}
                                    title={memory.enabled ? 'Memory is sent to the AI' : 'Memory is not used'}
                                >
                                    {memory.enabled ? <Check size={9} /> : <X size={9} />}
                                    <span>{memory.enabled ? 'ON' : 'OFF'}</span>
                                </button>
                                <button
                                    type="button"
                                    className="av-cf-card__remove"
                                    onClick={() => save(memories.filter(m => m.id !== memory.id))}
                                    title="Delete memory"
                                >
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        </div>
                    ))}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                        <input
                            className="av-input"
                            placeholder="Title (e.g. Work style)"
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                        />
                        <div style={{ display: 'flex', gap: 4 }}>
                            <textarea
                                className="av-input"
                                rows={2}
                                style={{ resize: 'vertical' }}
                                placeholder="Content (e.g. Prefers fully remote roles, open to contract)"
                                value={newContent}
                                onChange={(e) => setNewContent(e.target.value)}
                            />
                            <button
                                type="button"
                                className="av-pill av-pill--active"
                                onClick={handleAdd}
                                disabled={!newTitle.trim() || !newContent.trim()}
                                title="Add memory"
                            >
                                <Plus size={14} />
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
