import { Save } from 'lucide-react';
import type { UserData, Memory } from '../../../../types';

interface KnowledgeTabProps {
    userData: Partial<UserData>;
    newMemTitle: string;
    setNewMemTitle: (title: string) => void;
    newMemContent: string;
    setNewMemContent: (content: string) => void;
    addMemory: () => void;
    removeMemory: (id: string) => void;
    handleSave: () => void;
    saveMsg: string;
}

export const KnowledgeTab = ({
    userData,
    newMemTitle,
    setNewMemTitle,
    newMemContent,
    setNewMemContent,
    addMemory,
    removeMemory,
    handleSave,
    saveMsg,
}: KnowledgeTabProps) => {
    const memories = (userData.memories as Memory[]) || [];

    return (
        <div className="av-profile-tab">
            <div className="av-settings__how-card" style={{ marginBottom: 10 }}>
                <div className="av-settings__how-title">Knowledge Base (RAG)</div>
                <p>Save common answers, FAQs, or chat replies here. Aullevo's AI will prioritize these memories when answering chat questions or custom fields.</p>
            </div>

            {memories.length === 0 && (
                <p className="av-cf-empty">No memories yet. Add your first memory below.</p>
            )}
            {memories.map(m => (
                <div key={m.id} className="av-cf-card">
                    <div>
                        <div className="av-cf-card__label">{m.title}</div>
                        <div className="av-cf-card__context">{m.content}</div>
                    </div>
                    <button className="av-cf-card__remove" onClick={() => removeMemory(m.id)}>×</button>
                </div>
            ))}

            <div className="av-cf-form" style={{ marginTop: 10 }}>
                <input className="av-input" placeholder="Title (e.g. Late Policy)" value={newMemTitle} onChange={e => setNewMemTitle(e.target.value)} />
                <textarea className="av-input" placeholder="Content/Response text..." rows={3} value={newMemContent} onChange={e => setNewMemContent(e.target.value)} />
                <button className="av-save-btn" style={{ marginTop: 5 }} onClick={addMemory}>+ Add Memory</button>
            </div>

            <button className="av-save-btn" style={{ marginTop: 15 }} onClick={handleSave}>
                <Save size={14} /> {saveMsg || 'Save Changes'}
            </button>
        </div>
    );
};
