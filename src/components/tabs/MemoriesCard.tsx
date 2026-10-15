import { useEffect, useRef, useState } from 'react';
import { Brain, Check, X, Trash2, Plus, ChevronDown } from 'lucide-react';
import type { Memory } from '../../types';
import { OWNER_SCOPED_KEYS, getScopedKey } from '../../services/owner';
import { useT } from '../../i18n';
import { AI_SETTINGS_STORAGE_KEYS, aiRecipientName, readAiSettings } from '../../services/aiService';

// Same shape background.ts reads for RESOLVE_AI_QUESTIONS (enabled memories with content are
// sent to the chosen AI provider as "title: content"). Stored per account: aullevo_memories[@<uid>]

function createMemory(title: string, content: string): Memory {
    return { id: `mem_${Date.now()}`, title, content, createdAt: new Date().toISOString(), enabled: true };
}

interface MemoriesCardProps {
    useAiFill: boolean;
}

export function MemoriesCard({ useAiFill }: MemoriesCardProps) {
    const { t } = useT();
    const [memories, setMemories] = useState<Memory[]>([]);
    const [isOpen, setIsOpen] = useState(true);
    const [newTitle, setNewTitle] = useState('');
    const [newContent, setNewContent] = useState('');
    const [aiRecipient, setAiRecipient] = useState(() => aiRecipientName(readAiSettings(undefined)));
    const storageKeyRef = useRef<string>(OWNER_SCOPED_KEYS.memories);

    useEffect(() => {
        getScopedKey(OWNER_SCOPED_KEYS.memories).then((key) => {
            storageKeyRef.current = key;
            chrome.storage?.local?.get([key], (res) => {
                if (Array.isArray(res?.[key])) setMemories(res[key] as Memory[]);
            });
        });
        // Names who the memories are sent to; follows the provider chosen in the AI card
        const readRecipient = () => chrome.storage?.local?.get(AI_SETTINGS_STORAGE_KEYS, (res) => setAiRecipient(aiRecipientName(readAiSettings(res))));
        readRecipient();

        // Side panel and options page stay in sync
        const handleChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
            const key = storageKeyRef.current;
            if (area === 'local' && changes[key]) {
                const next = changes[key].newValue;
                setMemories(Array.isArray(next) ? (next as Memory[]) : []);
            }
            if (area === 'local' && AI_SETTINGS_STORAGE_KEYS.some(k => changes[k])) readRecipient();
        };
        chrome.storage?.onChanged?.addListener(handleChange);
        return () => chrome.storage?.onChanged?.removeListener(handleChange);
    }, []);

    const save = (next: Memory[]) => {
        setMemories(next);
        chrome.storage?.local?.set({ [storageKeyRef.current]: next });
    };

    const handleAdd = () => {
        const title = newTitle.trim();
        const content = newContent.trim();
        if (!title || !content) return;
        save([...memories, createMemory(title, content)]);
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
                data-tour="memories"
            >
                <div className="av-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Brain size={12} />
                    <span>{t('settings.memories.title')}</span>
                    <span style={{ fontSize: 10, opacity: 0.7 }}>{t('settings.memories.count', { enabled: enabledCount, total: memories.length })}</span>
                </div>
                <ChevronDown
                    size={14}
                    style={{ color: 'var(--av-text-muted)', transition: 'transform 0.2s ease', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                />
            </div>

            {isOpen && (
                <>
                    <div style={{ fontSize: 10, color: 'var(--av-text-muted)', lineHeight: 1.4, margin: '6px 0 8px' }}>
                        {useAiFill
                            ? t('settings.memories.descriptionAiOn', { provider: aiRecipient })
                            : t('settings.memories.descriptionAiOff', { provider: aiRecipient })}
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
                                    placeholder={t('settings.memories.titlePlaceholder')}
                                />
                                <textarea
                                    className="av-cf-input-value"
                                    rows={2}
                                    style={{ resize: 'vertical' }}
                                    value={memory.content}
                                    onChange={(e) => updateMemory(memory.id, { content: e.target.value })}
                                    disabled={!memory.enabled}
                                    placeholder={t('settings.memories.contentPlaceholder')}
                                />
                            </div>
                            <div className="av-cf-card__actions">
                                <button
                                    type="button"
                                    className={`av-switch-pill ${memory.enabled ? 'av-switch-pill--on' : 'av-switch-pill--off'}`}
                                    onClick={() => updateMemory(memory.id, { enabled: !memory.enabled })}
                                    title={memory.enabled ? t('settings.memories.enabledTitle') : t('settings.memories.disabledTitle')}
                                >
                                    {memory.enabled ? <Check size={9} /> : <X size={9} />}
                                    <span>{memory.enabled ? t('settings.memories.on') : t('settings.memories.off')}</span>
                                </button>
                                <button
                                    type="button"
                                    className="av-cf-card__remove"
                                    onClick={() => save(memories.filter(m => m.id !== memory.id))}
                                    title={t('settings.memories.delete')}
                                >
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        </div>
                    ))}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                        <input
                            className="av-input"
                            placeholder={t('settings.memories.newTitlePlaceholder')}
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                        />
                        <div style={{ display: 'flex', gap: 4 }}>
                            <textarea
                                className="av-input"
                                rows={2}
                                style={{ resize: 'vertical' }}
                                placeholder={t('settings.memories.newContentPlaceholder')}
                                value={newContent}
                                onChange={(e) => setNewContent(e.target.value)}
                            />
                            <button
                                type="button"
                                className="av-pill av-pill--active"
                                onClick={handleAdd}
                                disabled={!newTitle.trim() || !newContent.trim()}
                                title={t('settings.memories.add')}
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
