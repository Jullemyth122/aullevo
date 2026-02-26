import { useState, useEffect, type ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { storageService } from '../services/storageService';
import type { UserData } from '../types';
import './Options.css';

/* ─────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────── */
type NavSection = 'api' | 'profiles' | 'privacy' | 'shortcuts' | 'about';
type StatusType = 'success' | 'error' | 'info' | '';

interface StatusMsg { text: string; type: StatusType; }

const EMPTY_USER: UserData = {
    firstName: '', lastName: '', email: '', phone: '',
    address: '', city: '', state: '', zipCode: '', country: '',
    linkedin: '', portfolio: '', github: '', summary: '',
    headline: '', dateOfBirth: '', gender: '',
    salaryExpectation: '', noticePeriod: '', workAuthorization: '', yearsOfExperience: '',
    skills: [], experience: [], education: [], customFields: [],
};

/* ─────────────────────────────────────────────────────
   NAV ITEMS
───────────────────────────────────────────────────── */
const NAV: { id: NavSection; icon: string; label: string }[] = [
    { id: 'api', icon: '🔑', label: 'API Key' },
    { id: 'profiles', icon: '👤', label: 'Profiles' },
    { id: 'privacy', icon: '🔒', label: 'Privacy' },
    { id: 'shortcuts', icon: '⌨️', label: 'Shortcuts' },
    { id: 'about', icon: 'ℹ️', label: 'About' },
];

/* ─────────────────────────────────────────────────────
   STATUS COMPONENT
───────────────────────────────────────────────────── */
function StatusBanner({ status }: { status: StatusMsg }) {
    if (!status.text) return null;
    return (
        <div className={`status-bar status-${status.type}`}>{status.text}</div>
    );
}

/* ─────────────────────────────────────────────────────
   OPTIONS ROOT
───────────────────────────────────────────────────── */
function Options() {
    const [section, setSection] = useState<NavSection>('api');
    const [status, setStatus] = useState<StatusMsg>({ text: '', type: '' });

    // API Key
    const [apiKey, setApiKey] = useState('');
    const [apiTesting, setApiTesting] = useState(false);

    // Profiles
    const [profiles, setProfiles] = useState<string[]>([]);
    const [activeProfile, setActiveProfile] = useState('Default');
    const [newProfileName, setNewProfileName] = useState('');
    const [editingProfile, setEditingProfile] = useState<string | null>(null);
    const [profileData, setProfileData] = useState<UserData>(EMPTY_USER);

    // Privacy
    const [allowQAContext, setAllowQAContext] = useState(true);

    const flash = (text: string, type: StatusType = 'success', ms = 3000) => {
        setStatus({ text, type });
        setTimeout(() => setStatus({ text: '', type: '' }), ms);
    };

    /* ── Load initial data ── */
    useEffect(() => {
        chrome.storage.local.get(['geminiApiKey', 'allowQAContext'], (r) => {
            if (r.geminiApiKey) setApiKey(r.geminiApiKey as string);
            if (r.allowQAContext !== undefined) setAllowQAContext(r.allowQAContext as boolean);
        });
        refreshProfileList();
    }, []);

    const refreshProfileList = async () => {
        // Run migration of legacy plaintext data first
        await storageService.migrateLegacyData();
        const list = await storageService.listProfiles();
        setProfiles(list.length ? list : ['Default']);
        const active = await storageService.getActiveProfileName();
        setActiveProfile(active);
    };

    /* ── API Key section ── */
    const saveApiKey = () => {
        chrome.storage.local.set({ geminiApiKey: apiKey }, () => flash('✅ API Key saved!'));
    };

    const testApiKey = async () => {
        if (!apiKey) return flash('⚠️ Enter an API key first.', 'error');
        setApiTesting(true);
        try {
            const { GoogleGenAI } = await import('@google/genai');
            const ai = new GoogleGenAI({ apiKey });
            await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: 'Hello' });
            flash('✅ API key is valid and working!');
        } catch (e: any) {
            flash(`❌ Key test failed: ${e.message}`, 'error', 6000);
        } finally {
            setApiTesting(false);
        }
    };

    /* ── Profile section ── */
    const createProfile = async () => {
        const name = newProfileName.trim();
        if (!name) return flash('⚠️ Enter a profile name.', 'error');
        if (profiles.includes(name)) return flash('⚠️ Profile name already exists.', 'error');
        await storageService.saveProfile(name, { ...EMPTY_USER });
        setNewProfileName('');
        await refreshProfileList();
        flash(`✅ Profile "${name}" created.`);
    };

    const activateProfile = async (name: string) => {
        await storageService.setActiveProfileName(name);
        // Also write to legacy userData key for background script compatibility
        const data = await storageService.loadProfile(name);
        if (data) chrome.storage.local.set({ userData: data });
        setActiveProfile(name);
        flash(`✅ Switched to profile "${name}".`);
    };

    const deleteProfile = async (name: string) => {
        if (profiles.length <= 1) return flash('⚠️ Cannot delete the only profile.', 'error');
        await storageService.deleteProfile(name);
        if (activeProfile === name) await activateProfile(profiles.find(p => p !== name) || 'Default');
        await refreshProfileList();
        flash(`🗑️ Profile "${name}" deleted.`);
    };

    const openEditProfile = async (name: string) => {
        const data = await storageService.loadProfile(name);
        setProfileData(data || { ...EMPTY_USER });
        setEditingProfile(name);
    };

    const saveEditedProfile = async () => {
        if (!editingProfile) return;
        await storageService.saveProfile(editingProfile, profileData);
        // If this is the active profile, sync legacy key
        if (editingProfile === activeProfile) {
            chrome.storage.local.set({ userData: profileData });
        }
        setEditingProfile(null);
        flash(`✅ Profile "${editingProfile}" saved.`);
    };

    /* ── Import / Export ── */
    const handleExport = async () => {
        const json = await storageService.exportAllProfiles();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `aullevo-profiles-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        flash('✅ Profiles exported!');
    };

    const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            await storageService.importProfiles(text, true);
            await refreshProfileList();
            flash('✅ Profiles imported successfully!');
        } catch (err: any) {
            flash(`❌ Import failed: ${err.message}`, 'error');
        }
        e.target.value = '';
    };

    /* ── Privacy ── */
    const savePrivacy = () => {
        chrome.storage.local.set({ allowQAContext: allowQAContext }, () => {
            flash('✅ Privacy settings saved!');
        });
    };

    /* ── Profile data field change ── */
    const handleField = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setProfileData(prev => ({ ...prev, [name]: value }));
    };

    /* ═══════════════════════════════════════════════════
       RENDER
    ═══════════════════════════════════════════════════ */
    return (
        <div className="options-layout">
            {/* ── Nav ── */}
            <nav className="options-nav">
                <div className="nav-brand">
                    <span style={{ fontSize: '22px' }}>🚗</span>
                    <span className="nav-brand-name">Aullevo</span>
                </div>
                {NAV.map(n => (
                    <button
                        key={n.id}
                        className={`nav-item ${section === n.id ? 'active' : ''}`}
                        onClick={() => { setSection(n.id); setStatus({ text: '', type: '' }); setEditingProfile(null); }}
                    >
                        <span className="nav-item-icon">{n.icon}</span>
                        {n.label}
                    </button>
                ))}
            </nav>

            {/* ── Main ── */}
            <main className="options-main">
                <StatusBanner status={status} />

                {/* ────── API KEY ────── */}
                {section === 'api' && (
                    <>
                        <div className="page-header">
                            <h1 className="page-title">🔑 Gemini API Key</h1>
                            <p className="page-subtitle">Required to power AI form filling. Stored locally — never sent to our servers.</p>
                        </div>
                        <div className="card">
                            <div className="card-title">🔐 API Configuration</div>
                            <div className="input-group">
                                <label>Gemini API Key</label>
                                <input
                                    type="password"
                                    placeholder="AIza..."
                                    value={apiKey}
                                    onChange={e => setApiKey(e.target.value)}
                                />
                            </div>
                            <div className="btn-group">
                                <button className="btn btn-primary" onClick={saveApiKey}>💾 Save Key</button>
                                <button className="btn btn-secondary" onClick={testApiKey} disabled={apiTesting}>
                                    {apiTesting ? <span className="spinning">⚙️</span> : '🧪'} Test Key
                                </button>
                            </div>
                        </div>
                        <div className="card">
                            <div className="card-title">ℹ️ How to get a Key</div>
                            <ol style={{ paddingLeft: '18px', fontSize: '13px', color: 'var(--muted)', lineHeight: '2' }}>
                                <li>Go to <a href="https://makersuite.google.com/app/apikey" target="_blank" style={{ color: 'var(--accent)' }}>Google AI Studio</a></li>
                                <li>Click <strong style={{ color: 'var(--text)' }}>Create API Key</strong> → select any project</li>
                                <li>Copy the key and paste it above</li>
                                <li>Save and test — you&apos;re ready!</li>
                            </ol>
                        </div>
                    </>
                )}

                {/* ────── PROFILES ────── */}
                {section === 'profiles' && !editingProfile && (
                    <>
                        <div className="page-header">
                            <h1 className="page-title">👤 Profile Vault</h1>
                            <p className="page-subtitle">Manage multiple profiles. All data is encrypted with AES-256.</p>
                        </div>

                        <div className="card">
                            <div className="card-title">📋 Your Profiles</div>
                            <div className="profile-list">
                                {profiles.length === 0 && (
                                    <p style={{ color: 'var(--muted)', fontSize: '13px' }}>No profiles yet. Create one below.</p>
                                )}
                                {profiles.map(name => (
                                    <div key={name} className={`profile-item ${name === activeProfile ? 'active' : ''}`}>
                                        <div className="profile-item-name">
                                            👤 {name}
                                            {name === activeProfile && <span className="active-badge">Active</span>}
                                        </div>
                                        <div className="profile-actions">
                                            <button className="btn btn-secondary btn-sm" onClick={() => openEditProfile(name)}>✏️ Edit</button>
                                            {name !== activeProfile && (
                                                <button className="btn btn-secondary btn-sm" onClick={() => activateProfile(name)}>✅ Use</button>
                                            )}
                                            <button className="btn btn-danger btn-sm" onClick={() => deleteProfile(name)}>🗑️</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="card">
                            <div className="card-title">➕ New Profile</div>
                            <div className="input-group">
                                <label>Profile Name</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Software Engineer, Freelance..."
                                    value={newProfileName}
                                    onChange={e => setNewProfileName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && createProfile()}
                                />
                            </div>
                            <button className="btn btn-primary" onClick={createProfile}>➕ Create Profile</button>
                        </div>

                        <div className="card">
                            <div className="card-title">📦 Import / Export</div>
                            <p style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '14px' }}>
                                Back up all your profiles as a JSON file, or restore from a previous backup.
                            </p>
                            <div className="btn-group">
                                <button className="btn btn-secondary" onClick={handleExport}>⬇️ Export All Profiles</button>
                                <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                                    ⬆️ Import Profiles
                                    <input type="file" accept=".json" onChange={handleImport} hidden />
                                </label>
                            </div>
                        </div>
                    </>
                )}

                {/* ────── PROFILE EDIT ────── */}
                {section === 'profiles' && editingProfile && (
                    <>
                        <div className="page-header">
                            <h1 className="page-title">✏️ Editing: {editingProfile}</h1>
                            <p className="page-subtitle">Fill in the fields you want Aullevo to auto-fill on your behalf.</p>
                        </div>
                        <div className="card">
                            <div className="card-title">👤 Personal Information</div>
                            <div className="input-row">
                                <div className="input-group">
                                    <label>First Name</label>
                                    <input name="firstName" value={profileData.firstName} onChange={handleField} placeholder="John" />
                                </div>
                                <div className="input-group">
                                    <label>Last Name</label>
                                    <input name="lastName" value={profileData.lastName} onChange={handleField} placeholder="Smith" />
                                </div>
                            </div>
                            <div className="input-group">
                                <label>Email</label>
                                <input name="email" type="email" value={profileData.email} onChange={handleField} placeholder="john@example.com" />
                            </div>
                            <div className="input-group">
                                <label>Phone</label>
                                <input name="phone" type="tel" value={profileData.phone} onChange={handleField} placeholder="+1 555 000 0000" />
                            </div>
                            <div className="input-group">
                                <label>Professional Headline</label>
                                <input name="headline" value={profileData.headline || ''} onChange={handleField} placeholder="Full-Stack Developer" />
                            </div>
                            <div className="input-row">
                                <div className="input-group">
                                    <label>City</label>
                                    <input name="city" value={profileData.city} onChange={handleField} />
                                </div>
                                <div className="input-group">
                                    <label>Country</label>
                                    <input name="country" value={profileData.country} onChange={handleField} placeholder="Philippines" />
                                </div>
                            </div>
                        </div>
                        <div className="card">
                            <div className="card-title">🔗 Links</div>
                            <div className="input-group"><label>LinkedIn</label><input name="linkedin" type="url" value={profileData.linkedin} onChange={handleField} placeholder="https://linkedin.com/in/..." /></div>
                            <div className="input-group"><label>GitHub</label><input name="github" type="url" value={profileData.github} onChange={handleField} placeholder="https://github.com/..." /></div>
                            <div className="input-group"><label>Portfolio</label><input name="portfolio" type="url" value={profileData.portfolio} onChange={handleField} placeholder="https://yourportfolio.com" /></div>
                        </div>
                        <div className="card">
                            <div className="card-title">💼 Job Platform Fields</div>
                            <div className="input-row">
                                <div className="input-group"><label>Years of Experience</label><input name="yearsOfExperience" value={profileData.yearsOfExperience || ''} onChange={handleField} placeholder="5" /></div>
                                <div className="input-group"><label>Salary Expectation</label><input name="salaryExpectation" value={profileData.salaryExpectation || ''} onChange={handleField} placeholder="$80,000" /></div>
                            </div>
                            <div className="input-row">
                                <div className="input-group"><label>Notice Period</label><input name="noticePeriod" value={profileData.noticePeriod || ''} onChange={handleField} placeholder="2 weeks" /></div>
                                <div className="input-group"><label>Work Authorization</label><input name="workAuthorization" value={profileData.workAuthorization || ''} onChange={handleField} placeholder="Authorized to work" /></div>
                            </div>
                            <div className="input-group">
                                <label>Summary</label>
                                <textarea name="summary" value={profileData.summary} onChange={handleField} rows={4} placeholder="Professional summary..." />
                            </div>
                            <div className="input-group">
                                <label>Skills (comma-separated)</label>
                                <textarea
                                    placeholder="React, TypeScript, Node.js..."
                                    value={profileData.skills?.join(', ') || ''}
                                    onChange={e => setProfileData(prev => ({
                                        ...prev,
                                        skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                                    }))}
                                    rows={3}
                                />
                            </div>
                        </div>
                        <div className="btn-group" style={{ marginBottom: '40px' }}>
                            <button className="btn btn-primary" onClick={saveEditedProfile}>💾 Save Profile</button>
                            <button className="btn btn-secondary" onClick={() => setEditingProfile(null)}>← Back</button>
                        </div>
                    </>
                )}

                {/* ────── PRIVACY ────── */}
                {section === 'privacy' && (
                    <>
                        <div className="page-header">
                            <h1 className="page-title">🔒 Privacy Settings</h1>
                            <p className="page-subtitle">Control exactly what Aullevo sends to Gemini AI.</p>
                        </div>
                        <div className="card">
                            <div className="card-title">🛡️ Data Handling</div>
                            <div className="toggle-row">
                                <div>
                                    <div className="toggle-label">Allow career context for Q&A fields</div>
                                    <div className="toggle-desc">Sends a brief career summary (no PII) to answer custom interview questions</div>
                                </div>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={allowQAContext}
                                        onChange={e => setAllowQAContext(e.target.checked)}
                                        style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }}
                                    />
                                    <span style={{ fontSize: '12px', color: allowQAContext ? 'var(--success)' : 'var(--muted)' }}>
                                        {allowQAContext ? 'Enabled' : 'Disabled'}
                                    </span>
                                </label>
                            </div>
                        </div>
                        <div className="card" style={{ background: 'rgba(52,211,153,0.05)', borderColor: 'rgba(52,211,153,0.2)' }}>
                            <div className="card-title" style={{ color: 'var(--success)' }}>✅ What we NEVER send to Gemini</div>
                            {['Your name, email, phone, address', 'Date of birth, gender', 'Actual form field values you fill', 'Custom field values', 'Raw resume file contents (except when you upload for parsing)'].map(item => (
                                <div key={item} style={{ fontSize: '13px', color: 'var(--success)', padding: '5px 0', borderBottom: '1px solid rgba(52,211,153,0.1)', display: 'flex', gap: '8px' }}>
                                    <span>🔒</span> {item}
                                </div>
                            ))}
                        </div>
                        <div className="card" style={{ background: 'rgba(124,92,252,0.05)', borderColor: 'rgba(124,92,252,0.2)' }}>
                            <div className="card-title" style={{ color: '#c5b3ff' }}>ℹ️ What IS sent to Gemini (for form filling)</div>
                            {['Field labels, placeholders, ARIA labels (e.g. "First Name", "Email Address")', 'Field type and context (e.g. "inside Work Experience section")', 'Available select/radio options (e.g. ["Yes", "No", "N/A"])'].map(item => (
                                <div key={item} style={{ fontSize: '13px', color: '#c5b3ff', padding: '5px 0', borderBottom: '1px solid rgba(124,92,252,0.1)', display: 'flex', gap: '8px' }}>
                                    <span>📋</span> {item}
                                </div>
                            ))}
                        </div>
                        <button className="btn btn-primary" onClick={savePrivacy}>💾 Save Privacy Settings</button>
                    </>
                )}

                {/* ────── SHORTCUTS ────── */}
                {section === 'shortcuts' && (
                    <>
                        <div className="page-header">
                            <h1 className="page-title">⌨️ Keyboard Shortcuts</h1>
                            <p className="page-subtitle">Speed up form filling with these shortcuts.</p>
                        </div>
                        <div className="card">
                            <div className="card-title">🚀 Available Shortcuts</div>
                            {[
                                { key: 'Alt + F', desc: 'Quick AI fill — immediately analyze and fill the current form' },
                                { key: 'Alt + A', desc: 'Toggle sidebar — open or close the Aullevo sidebar panel' },
                                { key: 'Ctrl + M', desc: 'Full AI fill — triggered via Chrome extension commands' },
                            ].map(({ key, desc }) => (
                                <div key={key} className="shortcut-row">
                                    <span className="shortcut-desc">{desc}</span>
                                    <span className="shortcut-key">{key}</span>
                                </div>
                            ))}
                        </div>
                        <div className="card">
                            <div className="card-title">ℹ️ Customize Ctrl+M</div>
                            <p style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '12px' }}>
                                You can reassign Ctrl+M in Chrome Extension shortcuts:
                            </p>
                            <ol style={{ paddingLeft: '18px', fontSize: '13px', color: 'var(--muted)', lineHeight: '2' }}>
                                <li>Open <code style={{ color: 'var(--accent)' }}>chrome://extensions/shortcuts</code></li>
                                <li>Find <strong style={{ color: 'var(--text)' }}>Aullevo</strong></li>
                                <li>Click the pen icon next to <em>&ldquo;Trigger AI Form Fill&rdquo;</em></li>
                                <li>Press your preferred key combination</li>
                            </ol>
                        </div>
                    </>
                )}

                {/* ────── ABOUT ────── */}
                {section === 'about' && (
                    <>
                        <div className="page-header">
                            <h1 className="page-title">ℹ️ About Aullevo</h1>
                        </div>
                        <div className="card" style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '40px', marginBottom: '12px' }}>🚗</div>
                            <div className="about-version">Aullevo v1.1.0</div>
                            <div className="about-desc">AI-Powered Form Filler — Powered by Gemini 2.5 Flash</div>
                            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                                <a href="https://github.com" target="_blank" className="btn btn-secondary btn-sm">GitHub</a>
                                <a href="https://makersuite.google.com" target="_blank" className="btn btn-secondary btn-sm">Google AI Studio</a>
                            </div>
                        </div>
                        <div className="card">
                            <div className="card-title">🏗️ Architecture Layers</div>
                            {[
                                { layer: 'Layer 1 — UI', desc: 'React sidebar overlay + options page' },
                                { layer: 'Layer 2 — Content Scripts', desc: 'Shadow DOM injection, MutationObserver, SPA watcher' },
                                { layer: 'Layer 3 — AI Engine', desc: 'Gemini 2.5 Flash with retry, confidence filtering, caching' },
                                { layer: 'Layer 4 — Data', desc: 'AES-256-GCM encrypted local storage, multi-profile vault' },
                                { layer: 'Layer 5 — Background', desc: 'Service worker, rate limiter, badge manager' },
                            ].map(({ layer, desc }) => (
                                <div key={layer} className="shortcut-row">
                                    <span className="shortcut-key" style={{ fontFamily: 'Inter', width: '180px', textAlign: 'center' }}>{layer}</span>
                                    <span className="shortcut-desc" style={{ fontSize: '12px' }}>{desc}</span>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}

/* ─────────────────────────────────────────────────────
   MOUNT
───────────────────────────────────────────────────── */
const container = document.getElementById('options-root')!;
createRoot(container).render(<Options />);
