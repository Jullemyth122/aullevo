import { Save, Sparkles } from 'lucide-react';
import type { UserData, SavedLink } from '../../../../types';

interface LinksTabProps {
    userData: Partial<UserData>;
    newLinkTitle: string;
    setNewLinkTitle: (title: string) => void;
    newLinkUrl: string;
    setNewLinkUrl: (url: string) => void;
    addLink: () => void;
    removeLink: (id: string) => void;
    triggerAutopilot: (url: string) => void;
    handleSave: () => void;
    saveMsg: string;
}

export const LinksTab = ({
    userData,
    newLinkTitle,
    setNewLinkTitle,
    newLinkUrl,
    setNewLinkUrl,
    addLink,
    removeLink,
    triggerAutopilot,
    handleSave,
    saveMsg,
}: LinksTabProps) => {
    const links = (userData.savedLinks as SavedLink[]) || [];

    return (
        <div className="av-profile-tab">
            <div className="av-settings__how-card" style={{ marginBottom: 10 }}>
                <div className="av-settings__how-title">Autopilot Links</div>
                <p>Save URLs here to quickly open them and have Aullevo automatically fill them instantly.</p>
            </div>

            {links.length === 0 && (
                <p className="av-cf-empty">No quick links saved yet.</p>
            )}
            {links.map(l => (
                <div key={l.id} className="av-cf-card" style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div className="av-cf-card__label">{l.title}</div>
                            <div className="av-cf-card__context" style={{ color: 'var(--av-violet)' }}>{l.url}</div>
                        </div>
                        <button className="av-cf-card__remove" onClick={() => removeLink(l.id)}>×</button>
                    </div>
                    <button className="av-save-btn" style={{ marginTop: 10, background: 'var(--av-surface)' }} onClick={() => triggerAutopilot(l.url)}>
                        <Sparkles size={12} /> Open & Autofill
                    </button>
                </div>
            ))}

            <div className="av-cf-form" style={{ marginTop: 10 }}>
                <input className="av-input" placeholder="Title (e.g. Daily Check-in)" value={newLinkTitle} onChange={e => setNewLinkTitle(e.target.value)} />
                <input className="av-input" type="url" placeholder="https://example.com/form" value={newLinkUrl} onChange={e => setNewLinkUrl(e.target.value)} />
                <button className="av-save-btn" style={{ marginTop: 5 }} onClick={addLink}>+ Add Link</button>
            </div>

            <button className="av-save-btn" style={{ marginTop: 15 }} onClick={handleSave}>
                <Save size={14} /> {saveMsg || 'Save Changes'}
            </button>
        </div>
    );
};
