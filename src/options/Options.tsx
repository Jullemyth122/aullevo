import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { storageService } from '../services/storageService';
import type { UserData, SavedFile } from '../types';
import './Options.css';
import { LogoA } from '../components/LogoA';
import { auth, db, googleProvider } from '../config/firebase';
import { signOut, onAuthStateChanged, signInWithPopup } from 'firebase/auth';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import {
    Sparkles, Key, User, FolderKanban, Lock, Keyboard, Info,
    UploadCloud, Trash2, Download, Upload, Plus, Edit3, Check,
    ArrowLeft, LogOut, RefreshCw, Zap, ShieldCheck, CheckCircle2,
    X, ExternalLink, FileText, Image as ImageIcon, Archive, File as FileIcon,
    Save, Shield
} from 'lucide-react';

/* ── TYPES ── */
type NavSection = 'account' | 'api' | 'profiles' | 'files' | 'privacy' | 'shortcuts' | 'about';
type StatusType = 'success' | 'error' | 'info' | '';
interface StatusMsg { text: string; type: StatusType; }

const EMPTY_USER: UserData = {
    firstName: '', lastName: '', email: '', phone: '',
    address: '', city: '', state: '', zipCode: '', country: '',
    linkedin: '', portfolio: '', github: '', summary: '',
    headline: '', dateOfBirth: '', gender: '',
    salaryExpectation: '', noticePeriod: '', workAuthorization: '', yearsOfExperience: '',
    skills: [], experience: [], education: [], customFields: [],
    memories: [], savedLinks: [],
};

/* ── FILE TYPE ICON HELPER ── */
function fileIconForType(type: string) {
    if (type.startsWith('image/')) return <ImageIcon size={18} className="icon-blue" />;
    if (type === 'application/pdf') return <FileText size={18} className="icon-red" />;
    if (type.includes('word') || type.includes('document')) return <FileText size={18} className="icon-cyan" />;
    if (type.includes('zip') || type.includes('archive') || type.includes('compressed')) return <Archive size={18} className="icon-amber" />;
    return <FileIcon size={18} className="icon-muted" />;
}

function fileSizeStr(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let fileUid = 0;
const newFileId = () => `sf-${Date.now()}-${fileUid++}`;

/* ── NAV ITEMS ── */
const NAV_ITEMS: { id: NavSection; icon: React.ReactNode; label: string }[] = [
    { id: 'account', icon: <Sparkles size={16} />, label: 'Pro Account' },
    { id: 'api', icon: <Key size={16} />, label: 'API Key' },
    { id: 'profiles', icon: <User size={16} />, label: 'Profiles' },
    { id: 'files', icon: <FolderKanban size={16} />, label: 'File Vault' },
    { id: 'privacy', icon: <Lock size={16} />, label: 'Privacy' },
    { id: 'shortcuts', icon: <Keyboard size={16} />, label: 'Shortcuts' },
    { id: 'about', icon: <Info size={16} />, label: 'About' },
];

/* ── STATUS COMPONENT ── */
function StatusBanner({ status }: { status: StatusMsg }) {
    if (!status.text) return null;
    return (
        <div className={`status-bar status-${status.type}`}>
            {status.type === 'success' && <CheckCircle2 size={16} />}
            {status.type === 'error' && <X size={16} />}
            {status.type === 'info' && <Info size={16} />}
            <span>{status.text}</span>
        </div>
    );
}

/* ── OPTIONS MAIN COMPONENT ── */
function Options() {
    const [section, setSection] = useState<NavSection>('account');
    const [status, setStatus] = useState<StatusMsg>({ text: '', type: '' });

    // Auth & Pro Status
    const [user, setUser] = useState<any>(null);
    const [isPro, setIsPro] = useState(false);
    const [manualEmail, setManualEmail] = useState('');

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
    const [autoSubmit, setAutoSubmit] = useState(false);

    // File Vault
    const [fileLibrary, setFileLibrary] = useState<SavedFile[]>([]);
    const [fileDragging, setFileDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const flash = (text: string, type: StatusType = 'success', ms = 3500) => {
        setStatus({ text, type });
        setTimeout(() => setStatus({ text: '', type: '' }), ms);
    };

    /* ── Load initial data ── */
    useEffect(() => {
        chrome.storage.local.get(['geminiApiKey', 'allowQAContext', 'autoSubmit', 'isPro', 'userUid', 'userEmail', 'displayName', 'photoURL'], (r) => {
            if (r.geminiApiKey) setApiKey(r.geminiApiKey as string);
            if (r.allowQAContext !== undefined) setAllowQAContext(r.allowQAContext as boolean);
            if (r.autoSubmit !== undefined) setAutoSubmit(r.autoSubmit as boolean);
            if (r.isPro !== undefined) setIsPro(r.isPro as boolean);
            if (r.userEmail || r.displayName) {
                setUser({
                    uid: r.userUid,
                    email: r.userEmail,
                    displayName: r.displayName || 'Aullevo User',
                    photoURL: r.photoURL
                });
            }
        });

        refreshProfileList();
        loadFileLibrary();

        // Listen to Auth State from Firebase if available
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
                const userRef = doc(db, 'users', currentUser.uid);

                const unsubSnap = onSnapshot(userRef, (docSnap) => {
                    if (docSnap.exists()) {
                        const proStatus = !!docSnap.data().isPro;
                        setIsPro(proStatus);
                        chrome.storage.local.set({
                            isPro: proStatus,
                            userUid: currentUser.uid,
                            userEmail: currentUser.email || '',
                            displayName: currentUser.displayName || '',
                            photoURL: currentUser.photoURL || ''
                        });
                    }
                });
                return () => unsubSnap();
            }
        });

        // Storage listener for live sync from web app or popup
        const storageListener = (changes: any, areaName: string) => {
            if (areaName === 'local') {
                if (changes.isPro !== undefined) setIsPro(!!changes.isPro.newValue);
                if (changes.userEmail || changes.displayName || changes.userUid) {
                    chrome.storage.local.get(['userUid', 'userEmail', 'displayName', 'photoURL'], (r) => {
                        if (r.userEmail || r.displayName) {
                            setUser({
                                uid: r.userUid,
                                email: r.userEmail,
                                displayName: r.displayName || 'Aullevo User',
                                photoURL: r.photoURL
                            });
                        }
                    });
                }
            }
        };
        chrome.storage.onChanged.addListener(storageListener);

        return () => {
            unsubscribe();
            chrome.storage.onChanged.removeListener(storageListener);
        };
    }, []);

    /* ── Web Auth & Sync Handlers ── */
    const handleDirectGoogleSignIn = async () => {
        try {
            const res = await signInWithPopup(auth, googleProvider);
            if (res.user) {
                flash('✨ Authenticated with Firebase! Pro status live-synced.', 'success');
            }
        } catch (err: any) {
            flash(`Google sign-in error: ${err.message}`, 'error');
        }
    };

    const handleSignInViaWeb = () => {
        try {
            const syncUrl = 'https://aullevo-web.vercel.app/login';
            chrome.tabs.create({ url: syncUrl });
            flash('Sign-in page opened — log in on the web app, then click Refresh Status here!', 'info', 6000);
        } catch (e) {
            window.open('https://aullevo-web.vercel.app/login', '_blank');
        }
    };

    const handleSyncByEmail = () => {
        const targetEmail = manualEmail.trim() || (user?.email || '');
        if (!targetEmail) {
            return flash('Please enter your Aullevo account email address.', 'error');
        }
        chrome.runtime.sendMessage({ action: 'SYNC_WEB_USER', email: targetEmail }, (res) => {
            if (res && res.success) {
                flash(res.isPro ? '✨ Pro membership verified and active!' : `Account paired with ${targetEmail}.`, res.isPro ? 'success' : 'info');
            } else {
                flash('Sync failed. Make sure your account exists on Aullevo Web.', 'error');
            }
        });
    };

    const handleRefreshProStatus = async () => {
        chrome.storage.local.get(['userUid', 'userEmail'], async (r) => {
            if (!r.userUid && !r.userEmail) {
                flash('No account synced yet. Please click "Sign In & Sync via Web App".', 'info', 5000);
                return;
            }
            try {
                let proStatus = false;
                let foundDoc = false;
                if (r.userUid) {
                    try {
                        const userRef = doc(db, 'users', r.userUid as string);
                        const userSnap = await getDoc(userRef);
                        if (userSnap.exists()) {
                            proStatus = !!userSnap.data().isPro;
                            foundDoc = true;
                        }
                    } catch (e) {
                        console.warn('getDoc by uid error:', e);
                    }
                }
                if (!foundDoc && r.userEmail) {
                    try {
                        const { collection, query, where, getDocs } = await import('firebase/firestore');
                        const q = query(collection(db, 'users'), where('email', '==', r.userEmail));
                        const querySnap = await getDocs(q);
                        querySnap.forEach((docSnap) => {
                            if (docSnap.data().isPro) {
                                proStatus = true;
                            }
                            foundDoc = true;
                        });
                    } catch (e) {
                        console.warn('query by email error:', e);
                    }
                }
                setIsPro(proStatus);
                chrome.storage.local.set({ isPro: proStatus });
                flash(proStatus ? '✨ Pro membership verified and active!' : 'Account synced (Free Tier).', proStatus ? 'success' : 'info');
            } catch (err: any) {
                flash(`Sync failed: ${err.message}`, 'error');
            }
        });
    };

    const handleSignOut = async () => {
        try {
            await signOut(auth);
        } catch { }
        setUser(null);
        setIsPro(false);
        chrome.storage.local.set({ isPro: false, userUid: null, userEmail: null, displayName: null, photoURL: null }, () => {
            flash('Signed out successfully.');
        });
    };

    const loadFileLibrary = async () => {
        chrome.storage.local.get('fileLibrary', (r) => {
            setFileLibrary((r.fileLibrary as SavedFile[]) || []);
        });
    };

    const addFilesToVault = async (files: File[]) => {
        if (!isPro && fileLibrary.length + files.length > 2) {
            return flash('File Vault is limited to 2 files on the Free tier. Upgrade to Pro for unlimited files!', 'error', 5000);
        }
        const entries: SavedFile[] = [];
        for (const f of files) {
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(f);
            });
            entries.push({
                id: newFileId(),
                name: f.name,
                size: f.size,
                type: f.type || 'application/octet-stream',
                dataUrl,
                savedAt: new Date().toLocaleTimeString('en-US', { hour12: false }),
            });
        }
        const updated = [...fileLibrary, ...entries];
        chrome.storage.local.set({ fileLibrary: updated }, () => {
            setFileLibrary(updated);
            flash(`Saved ${entries.length} file${entries.length !== 1 ? 's' : ''} to vault`);
        });
    };

    const removeFileFromVault = (id: string) => {
        const updated = fileLibrary.filter(f => f.id !== id);
        chrome.storage.local.set({ fileLibrary: updated }, () => {
            setFileLibrary(updated);
            flash('File removed from vault');
        });
    };

    const clearAllFiles = () => {
        chrome.storage.local.set({ fileLibrary: [] }, () => {
            setFileLibrary([]);
            flash('All files cleared from vault');
        });
    };

    const refreshProfileList = async () => {
        await storageService.migrateLegacyData();
        const list = await storageService.listProfiles();
        setProfiles(list.length ? list : ['Default']);
        const active = await storageService.getActiveProfileName();
        setActiveProfile(active);
    };

    /* ── API Key section ── */
    const saveApiKey = () => {
        chrome.storage.local.set({ geminiApiKey: apiKey.trim() }, () => flash('API Key saved successfully!'));
    };

    const testApiKey = async () => {
        if (!apiKey) return flash('Enter an API key first.', 'error');
        setApiTesting(true);
        try {
            const { GoogleGenAI } = await import('@google/genai');
            const ai = new GoogleGenAI({ apiKey });
            await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: 'Hello' });
            flash('API key is valid and working!');
        } catch (e: any) {
            flash(`Key test failed: ${e.message}`, 'error', 6000);
        } finally {
            setApiTesting(false);
        }
    };

    /* ── Profile section ── */
    const createProfile = async () => {
        if (!isPro && profiles.length >= 1) {
            return flash('Profiles are limited to 1 on the Free tier. Upgrade to Pro for unlimited profiles!', 'error', 5000);
        }
        const name = newProfileName.trim();
        if (!name) return flash('Enter a profile name.', 'error');
        if (profiles.includes(name)) return flash('Profile name already exists.', 'error');
        await storageService.saveProfile(name, { ...EMPTY_USER });
        setNewProfileName('');
        await refreshProfileList();
        flash(`Profile "${name}" created.`);
    };

    const activateProfile = async (name: string) => {
        await storageService.setActiveProfileName(name);
        const data = await storageService.loadProfile(name);
        if (data) chrome.storage.local.set({ userData: data });
        setActiveProfile(name);
        flash(`Switched to profile "${name}".`);
    };

    const deleteProfile = async (name: string) => {
        if (profiles.length <= 1) return flash('Cannot delete the only profile.', 'error');
        await storageService.deleteProfile(name);
        if (activeProfile === name) await activateProfile(profiles.find(p => p !== name) || 'Default');
        await refreshProfileList();
        flash(`Profile "${name}" deleted.`);
    };

    const openEditProfile = async (name: string) => {
        const data = await storageService.loadProfile(name);
        setProfileData(data || { ...EMPTY_USER });
        setEditingProfile(name);
    };

    const saveEditedProfile = async () => {
        if (!editingProfile) return;
        await storageService.saveProfile(editingProfile, profileData);
        if (editingProfile === activeProfile) {
            chrome.storage.local.set({ userData: profileData });
        }
        setEditingProfile(null);
        flash(`Profile "${editingProfile}" saved.`);
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
        flash('Profiles exported!');
    };

    const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            await storageService.importProfiles(text, true);
            await refreshProfileList();
            flash('Profiles imported successfully!');
        } catch (err: any) {
            flash(`Import failed: ${err.message}`, 'error');
        }
        e.target.value = '';
    };

    /* ── Privacy & Auto-Submit ── */
    const savePrivacy = () => {
        chrome.storage.local.set({ allowQAContext, autoSubmit }, () => {
            flash('Privacy settings saved!');
        });
    };

    const handleField = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setProfileData(prev => ({ ...prev, [name]: value }));
    };

    /* ── RENDER ── */
    return (
        <div className="options-layout">
            {/* ── Sidebar Nav ── */}
            <nav className="options-nav">
                <div className="nav-brand">
                    <LogoA size={24} />
                    <span className="nav-brand-name">Aullevo</span>
                </div>
                <div className="nav-items">
                    {NAV_ITEMS.map(n => (
                        <button
                            key={n.id}
                            className={`nav-item ${section === n.id ? 'active' : ''}`}
                            onClick={() => { setSection(n.id); setStatus({ text: '', type: '' }); setEditingProfile(null); }}
                        >
                            <span className="nav-item-icon">{n.icon}</span>
                            <span>{n.label}</span>
                        </button>
                    ))}
                </div>
            </nav>

            {/* ── Main Content ── */}
            <main className="options-main">
                <StatusBanner status={status} />

                {/* ────── PRO ACCOUNT ────── */}
                {section === 'account' && (
                    <>
                        <div className="page-header">
                            <h1 className="page-title">
                                <Sparkles className="header-icon" size={24} /> Pro Account
                            </h1>
                            <p className="page-subtitle">Sync your membership from Aullevo Web to activate all features across your browser.</p>
                        </div>
                        <div className="card">
                            <div className="card-title">
                                <User size={18} /> Account Status
                            </div>
                            {user ? (
                                <div className="account-details-box">
                                    <div className="user-profile-row">
                                        <div className="user-avatar">
                                            {user.photoURL ? (
                                                <img src={user.photoURL} alt="avatar" />
                                            ) : (
                                                user.displayName?.charAt(0).toUpperCase() || 'U'
                                            )}
                                        </div>
                                        <div className="user-info">
                                            <div className="user-name">{user.displayName}</div>
                                            <div className="user-email">{user.email}</div>
                                        </div>
                                    </div>
                                    <div className={`pro-badge ${isPro ? 'pro-active' : 'free-tier'}`}>
                                        {isPro ? <Sparkles size={14} /> : <Shield size={14} />}
                                        <span>{isPro ? 'Pro Lifetime Active' : 'Free Tier'}</span>
                                    </div>
                                    {!isPro && (
                                        <div className="pro-upgrade-banner">
                                            <p>
                                                Upgrade on the <a href="https://aullevo-web.vercel.app/login" target="_blank" rel="noopener noreferrer">Aullevo Web App</a> to unlock unlimited profiles, files, memories, and smart AI form matching.
                                            </p>
                                        </div>
                                    )}
                                    <div className="btn-group" style={{ marginTop: '12px' }}>
                                        <button className="btn btn-secondary" onClick={handleRefreshProStatus}>
                                            <RefreshCw size={15} /> Check Status
                                        </button>
                                        <button className="btn btn-secondary" onClick={handleSignOut}>
                                            <LogOut size={15} /> Disconnect
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="account-connect-box">
                                    <p className="connect-desc">
                                        Sign in via Aullevo Web App or enter your account email to instantly pair your Pro membership with this extension.
                                    </p>
                                    <div className="btn-group">
                                        <button className="btn btn-primary" onClick={handleDirectGoogleSignIn}>
                                            <Sparkles size={16} /> Sign In with Google
                                        </button>
                                        <button className="btn btn-secondary" onClick={handleSignInViaWeb}>
                                            <ExternalLink size={16} /> Web App Login
                                        </button>
                                        <button className="btn btn-secondary" onClick={handleRefreshProStatus}>
                                            <RefreshCw size={15} /> Check Status
                                        </button>
                                    </div>

                                    <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--border)' }}>
                                        <label>Direct Sync by Email</label>
                                        <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                                            <input
                                                type="email"
                                                placeholder="mythicalxenon12@gmail.com"
                                                value={manualEmail}
                                                onChange={e => setManualEmail(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleSyncByEmail()}
                                            />
                                            <button className="btn btn-secondary" style={{ flexShrink: 0 }} onClick={handleSyncByEmail}>
                                                <RefreshCw size={15} /> Sync Email
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}

                {/* ────── API KEY ────── */}
                {section === 'api' && (
                    <>
                        <div className="page-header">
                            <h1 className="page-title">
                                <Key className="header-icon" size={24} /> Gemini API Key
                            </h1>
                            <p className="page-subtitle">Required to power AI form filling. Stored locally — never transmitted to any server.</p>
                        </div>
                        <div className="card">
                            <div className="card-title">
                                <Lock size={18} /> API Configuration
                            </div>
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
                                <button className="btn btn-primary" onClick={saveApiKey}>
                                    <Save size={16} /> Save Key
                                </button>
                                <button className="btn btn-secondary" onClick={testApiKey} disabled={apiTesting}>
                                    {apiTesting ? <RefreshCw size={16} className="spinning" /> : <Zap size={16} />} Test Key
                                </button>
                            </div>
                        </div>
                        <div className="card">
                            <div className="card-title">
                                <Info size={18} /> How to obtain a free API key
                            </div>
                            <ol className="instructions-list">
                                <li>Visit <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a></li>
                                <li>Click <strong>Create API Key</strong> → choose any project</li>
                                <li>Copy your key and paste it above</li>
                                <li>Click <strong>Save Key</strong> and click <strong>Test Key</strong> to verify</li>
                            </ol>
                        </div>
                    </>
                )}

                {/* ────── PROFILES LIST ────── */}
                {section === 'profiles' && !editingProfile && (
                    <>
                        <div className="page-header">
                            <h1 className="page-title">
                                <User className="header-icon" size={24} /> Profile Vault
                            </h1>
                            <p className="page-subtitle">Manage multiple profiles. All data is encrypted with AES-256 local encryption.</p>
                        </div>

                        <div className="card">
                            <div className="card-title">
                                <User size={18} /> Saved Profiles
                            </div>
                            <div className="profile-list">
                                {profiles.length === 0 && (
                                    <p className="empty-text">No profiles created yet. Create one below.</p>
                                )}
                                {profiles.map(name => (
                                    <div key={name} className={`profile-item ${name === activeProfile ? 'active' : ''}`}>
                                        <div className="profile-item-name">
                                            <User size={15} />
                                            <span>{name}</span>
                                            {name === activeProfile && (
                                                <span className="active-badge">
                                                    <CheckCircle2 size={12} /> Active
                                                </span>
                                            )}
                                        </div>
                                        <div className="profile-actions">
                                            <button className="btn btn-secondary btn-sm" onClick={() => openEditProfile(name)}>
                                                <Edit3 size={14} /> Edit
                                            </button>
                                            {name !== activeProfile && (
                                                <button className="btn btn-secondary btn-sm" onClick={() => activateProfile(name)}>
                                                    <Check size={14} /> Select
                                                </button>
                                            )}
                                            <button className="btn btn-danger btn-sm" onClick={() => deleteProfile(name)} title="Delete profile">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="card">
                            <div className="card-title">
                                <Plus size={18} /> New Profile
                            </div>
                            <div className="input-group">
                                <label>Profile Name</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Software Engineer, Medical, Freelance..."
                                    value={newProfileName}
                                    onChange={e => setNewProfileName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && createProfile()}
                                />
                            </div>
                            <button className="btn btn-primary" onClick={createProfile}>
                                <Plus size={16} /> Create Profile
                            </button>
                        </div>

                        <div className="card">
                            <div className="card-title">
                                <Download size={18} /> Import & Export Backup
                            </div>
                            <p className="card-desc">
                                Export all profiles to an encrypted JSON backup file or restore from a previous backup.
                            </p>
                            <div className="btn-group">
                                <button className="btn btn-secondary" onClick={handleExport}>
                                    <Download size={16} /> Export All Profiles
                                </button>
                                <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                                    <Upload size={16} /> Import Profiles
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
                            <h1 className="page-title">
                                <Edit3 className="header-icon" size={24} /> Editing: {editingProfile}
                            </h1>
                            <p className="page-subtitle">Fill in your information to allow Aullevo to auto-fill forms on your behalf.</p>
                        </div>

                        <div className="card">
                            <div className="card-title">Category</div>
                            <div className="input-group">
                                <label>Select Profile Type</label>
                                <select
                                    className="custom-select"
                                    value={profileData.profileType || 'job'}
                                    onChange={e => setProfileData(prev => ({ ...prev, profileType: e.target.value as any }))}
                                >
                                    <option value="job">Job Application / Resume</option>
                                    <option value="medical">Medical Form</option>
                                    <option value="survey">Survey</option>
                                    <option value="custom">Custom / General</option>
                                </select>
                            </div>
                        </div>

                        {profileData.profileType !== 'custom' && (
                            <div className="card">
                                <div className="card-title">Personal Information</div>
                                <div className="input-row">
                                    <div className="input-group">
                                        <label>First Name</label>
                                        <input name="firstName" value={profileData.firstName || ''} onChange={handleField} placeholder="John" />
                                    </div>
                                    <div className="input-group">
                                        <label>Last Name</label>
                                        <input name="lastName" value={profileData.lastName || ''} onChange={handleField} placeholder="Smith" />
                                    </div>
                                </div>
                                <div className="input-group">
                                    <label>Email</label>
                                    <input name="email" type="email" value={profileData.email || ''} onChange={handleField} placeholder="john@example.com" />
                                </div>
                                <div className="input-group">
                                    <label>Phone</label>
                                    <input name="phone" type="tel" value={profileData.phone || ''} onChange={handleField} placeholder="+1 555 000 0000" />
                                </div>
                                {profileData.profileType === 'job' && (
                                    <div className="input-group">
                                        <label>Professional Headline</label>
                                        <input name="headline" value={profileData.headline || ''} onChange={handleField} placeholder="Full-Stack Developer" />
                                    </div>
                                )}
                                <div className="input-row">
                                    <div className="input-group">
                                        <label>City</label>
                                        <input name="city" value={profileData.city || ''} onChange={handleField} />
                                    </div>
                                    <div className="input-group">
                                        <label>Country</label>
                                        <input name="country" value={profileData.country || ''} onChange={handleField} placeholder="United States" />
                                    </div>
                                </div>
                            </div>
                        )}

                        {profileData.profileType === 'job' && (
                            <>
                                <div className="card">
                                    <div className="card-title">Professional Links</div>
                                    <div className="input-group"><label>LinkedIn</label><input name="linkedin" type="url" value={profileData.linkedin || ''} onChange={handleField} placeholder="https://linkedin.com/in/..." /></div>
                                    <div className="input-group"><label>GitHub</label><input name="github" type="url" value={profileData.github || ''} onChange={handleField} placeholder="https://github.com/..." /></div>
                                    <div className="input-group"><label>Portfolio</label><input name="portfolio" type="url" value={profileData.portfolio || ''} onChange={handleField} placeholder="https://yourportfolio.com" /></div>
                                </div>
                                <div className="card">
                                    <div className="card-title">Career Details</div>
                                    <div className="input-row">
                                        <div className="input-group"><label>Years of Experience</label><input name="yearsOfExperience" value={profileData.yearsOfExperience || ''} onChange={handleField} placeholder="5" /></div>
                                        <div className="input-group"><label>Salary Expectation</label><input name="salaryExpectation" value={profileData.salaryExpectation || ''} onChange={handleField} placeholder="$80,000" /></div>
                                    </div>
                                    <div className="input-row">
                                        <div className="input-group"><label>Notice Period</label><input name="noticePeriod" value={profileData.noticePeriod || ''} onChange={handleField} placeholder="2 weeks" /></div>
                                        <div className="input-group"><label>Work Authorization</label><input name="workAuthorization" value={profileData.workAuthorization || ''} onChange={handleField} placeholder="Authorized to work" /></div>
                                    </div>
                                    <div className="input-group">
                                        <label>Professional Summary</label>
                                        <textarea name="summary" value={profileData.summary || ''} onChange={handleField} rows={4} placeholder="Summary of experience..." />
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
                            </>
                        )}

                        <div className="btn-group" style={{ marginBottom: '40px' }}>
                            <button className="btn btn-primary" onClick={saveEditedProfile}>
                                <Save size={16} /> Save Profile
                            </button>
                            <button className="btn btn-secondary" onClick={() => setEditingProfile(null)}>
                                <ArrowLeft size={16} /> Back
                            </button>
                        </div>
                    </>
                )}

                {/* ────── PRIVACY ────── */}
                {section === 'privacy' && (
                    <>
                        <div className="page-header">
                            <h1 className="page-title">
                                <Lock className="header-icon" size={24} /> Privacy & Automation
                            </h1>
                            <p className="page-subtitle">Configure data protection and form submission controls.</p>
                        </div>
                        <div className="card">
                            <div className="card-title">
                                <ShieldCheck size={18} /> Data Handling & Automation
                            </div>
                            <div className="toggle-row">
                                <div>
                                    <div className="toggle-label">Allow career context for Q&A fields</div>
                                    <div className="toggle-desc">Sends non-PII career summary to answer custom questionnaire prompts</div>
                                </div>
                                <label className="toggle-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={allowQAContext}
                                        onChange={e => setAllowQAContext(e.target.checked)}
                                    />
                                    <span className={allowQAContext ? 'text-success' : 'text-muted'}>
                                        {allowQAContext ? 'Enabled' : 'Disabled'}
                                    </span>
                                </label>
                            </div>
                            <div className="toggle-row">
                                <div>
                                    <div className="toggle-label">Auto-Submit Forms</div>
                                    <div className="toggle-desc">Automatically clicks Next/Submit after filling fields</div>
                                </div>
                                <label className="toggle-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={autoSubmit}
                                        onChange={e => setAutoSubmit(e.target.checked)}
                                    />
                                    <span className={autoSubmit ? 'text-success' : 'text-muted'}>
                                        {autoSubmit ? 'Enabled' : 'Disabled'}
                                    </span>
                                </label>
                            </div>
                        </div>
                        <div className="card card-alert-success">
                            <div className="card-title text-success">
                                <ShieldCheck size={18} /> Never sent to AI models
                            </div>
                            {['Your name, email, phone, street address', 'Date of birth, gender', 'Actual filled input values', 'Custom field values', 'Raw resume documents'].map(item => (
                                <div key={item} className="alert-item text-success">
                                    <Lock size={14} /> <span>{item}</span>
                                </div>
                            ))}
                        </div>
                        <button className="btn btn-primary" onClick={savePrivacy}>
                            <Save size={16} /> Save Settings
                        </button>
                    </>
                )}

                {/* ────── SHORTCUTS ────── */}
                {section === 'shortcuts' && (
                    <>
                        <div className="page-header">
                            <h1 className="page-title">
                                <Keyboard className="header-icon" size={24} /> Keyboard Shortcuts
                            </h1>
                            <p className="page-subtitle">Quick hotkeys for AI form filling and sidebar toggling.</p>
                        </div>
                        <div className="card">
                            <div className="card-title">
                                <Zap size={18} /> Hotkeys
                            </div>
                            {[
                                { key: 'Alt + F', desc: 'Quick AI fill — instantly analyze and fill current page' },
                                { key: 'Alt + A', desc: 'Toggle sidebar panel' },
                                { key: 'Ctrl + M', desc: 'Trigger AI form fill' },
                            ].map(({ key, desc }) => (
                                <div key={key} className="shortcut-row">
                                    <span className="shortcut-desc">{desc}</span>
                                    <span className="shortcut-key">{key}</span>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {/* ────── FILE VAULT ────── */}
                {section === 'files' && (
                    <>
                        <div className="page-header">
                            <h1 className="page-title">
                                <FolderKanban className="header-icon" size={24} /> File Vault
                            </h1>
                            <p className="page-subtitle">Store resumes, cover letters, and documents. Aullevo auto-fills file upload fields by matching filenames.</p>
                        </div>

                        <div className="card">
                            <div className="card-title">
                                <FolderKanban size={18} /> Saved Files
                                <span className="vault-count">{fileLibrary.length} saved</span>
                            </div>

                            <div
                                className={`vault-dropzone ${fileDragging ? 'drag-over' : ''}`}
                                onDragOver={(e) => { e.preventDefault(); setFileDragging(true); }}
                                onDragLeave={() => setFileDragging(false)}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    setFileDragging(false);
                                    addFilesToVault(Array.from(e.dataTransfer.files));
                                }}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    multiple
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                        addFilesToVault(Array.from(e.target.files || []));
                                        e.target.value = '';
                                    }}
                                />
                                <div className="vault-dropzone-inner">
                                    <UploadCloud size={32} />
                                    <span className="vault-drop-text">Drop files here or click to browse</span>
                                    <span className="vault-drop-sub">PDF, DOCX, images, and documents</span>
                                </div>
                            </div>

                            {fileLibrary.length > 0 && (
                                <div className="vault-file-list">
                                    {fileLibrary.map((sf) => (
                                        <div key={sf.id} className="vault-file-item">
                                            <span className="vault-file-icon">{fileIconForType(sf.type)}</span>
                                            <div className="vault-file-info">
                                                <span className="vault-file-name">{sf.name}</span>
                                                <span className="vault-file-meta">{fileSizeStr(sf.size)} &middot; {sf.savedAt}</span>
                                            </div>
                                            <span className="vault-file-type-tag">{sf.type.split('/').pop()}</span>
                                            <button className="vault-file-remove" onClick={(e) => { e.stopPropagation(); removeFileFromVault(sf.id); }} title="Remove file">
                                                <X size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {fileLibrary.length > 0 && (
                            <div className="card">
                                <div className="card-title">
                                    <Trash2 size={18} /> Clear Vault
                                </div>
                                <p className="card-desc">Remove all stored files from local extension storage.</p>
                                <button className="btn btn-danger" onClick={clearAllFiles}>
                                    <Trash2 size={16} /> Clear All Files
                                </button>
                            </div>
                        )}
                    </>
                )}

                {/* ────── ABOUT ────── */}
                {section === 'about' && (
                    <>
                        <div className="page-header">
                            <h1 className="page-title">
                                <Info className="header-icon" size={24} /> About Aullevo
                            </h1>
                        </div>
                        <div className="card text-center">
                            <div className="about-brand">
                                <LogoA size={48} />
                            </div>
                            <div className="about-version">Aullevo v1.1.0</div>
                            <div className="about-desc">AI-Powered Form Filler — Powered by Gemini 2.5 Flash</div>
                            <div className="btn-group justify-center">
                                <a href="https://aullevo-web.vercel.app" target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                                    <ExternalLink size={14} /> Web App
                                </a>
                                <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                                    <ExternalLink size={14} /> Google AI Studio
                                </a>
                            </div>
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}

/* ── MOUNT ── */
const container = document.getElementById('options-root')!;
createRoot(container).render(<Options />);
