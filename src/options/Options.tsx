/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { storageService } from '../services/storageService';
import type { UserData, SavedFile, Experience, Education } from '../types';
import { createEmptyUserData } from '../types';
import './Options.css';
import { LogoA } from '../components/LogoA';
import { auth, db } from '../config/firebase';
import { signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import {
    Sparkles, Key, User, FolderKanban, Lock, Keyboard, Info,
    UploadCloud, Trash2, Download, Upload, Plus, Edit3, Check,
    ArrowLeft, LogOut, RefreshCw, Zap, ShieldCheck, CheckCircle2,
    X, ExternalLink, FileText, Image as ImageIcon, Archive, File as FileIcon,
    Save, Shield, Sun, Moon, Monitor, Briefcase, Activity, FileQuestion, Layers,
    MapPin, Building, GraduationCap, PlusCircle, Clock
} from 'lucide-react';

// Type definitions
type NavSection = 'account' | 'api' | 'profiles' | 'files' | 'privacy' | 'shortcuts' | 'about';
type StatusType = 'success' | 'error' | 'info' | '';
type ThemeMode = 'dark' | 'light' | 'system';
interface StatusMsg { text: string; type: StatusType; }

const EMPTY_USER: UserData = createEmptyUserData('job');

// Profile template configuration
export const PROFILE_TEMPLATES: Record<string, { label: string; icon: React.ReactNode; desc: string; badgeClass: string }> = {
    job: {
        label: 'Job Application',
        icon: <Briefcase size={14} />,
        desc: 'Resume, work experience, education, skills, career details & links',
        badgeClass: 'badge-job'
    },
    medical: {
        label: 'Medical Record',
        icon: <Activity size={14} />,
        desc: 'Emergency contact, blood type, allergies, conditions & medications',
        badgeClass: 'badge-medical'
    },
    survey: {
        label: 'Survey / Demographics',
        icon: <FileQuestion size={14} />,
        desc: 'Occupation, industry, education level & demographics for questionnaires',
        badgeClass: 'badge-survey'
    },
    custom: {
        label: 'Custom Form',
        icon: <Layers size={14} />,
        desc: 'Blank template for arbitrary forms, custom fields & unique workflows',
        badgeClass: 'badge-custom'
    },
};

// File type icon resolver
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

// Navigation sidebar items
const NAV_ITEMS: { id: NavSection; icon: React.ReactNode; label: string }[] = [
    { id: 'account', icon: <Sparkles size={16} />, label: 'Account & Plan' },
    { id: 'api', icon: <Key size={16} />, label: 'API Keys' },
    { id: 'profiles', icon: <User size={16} />, label: 'Profiles & Vault' },
    { id: 'files', icon: <FolderKanban size={16} />, label: 'File Library' },
    { id: 'privacy', icon: <Lock size={16} />, label: 'Privacy' },
    { id: 'shortcuts', icon: <Keyboard size={16} />, label: 'Shortcuts' },
    { id: 'about', icon: <Info size={16} />, label: 'About' },
];

// Status banner component
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

// Options main dashboard component
function Options() {
    const [section, setSection] = useState<NavSection>('account');
    const [status, setStatus] = useState<StatusMsg>({ text: '', type: '' });

    // Theme Management
    const [themeMode, setThemeMode] = useState<ThemeMode>('system');
    const [systemIsDark, setSystemIsDark] = useState<boolean>(() =>
        typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : true
    );

    const effectiveTheme = themeMode === 'system' ? (systemIsDark ? 'dark' : 'light') : themeMode;

    // Auth & Pro Status
    const [user, setUser] = useState<{ uid?: string; email?: string | null; displayName?: string | null; photoURL?: string | null } | null>(null);
    const [isPro, setIsPro] = useState(false);
    const [proExpiresAt, setProExpiresAt] = useState<string | null>(null);
    const [manualEmail, setManualEmail] = useState('');
    const [authConnecting, setAuthConnecting] = useState(false);

    // API Key
    const [apiKey, setApiKey] = useState('');
    const [apiTesting, setApiTesting] = useState(false);

    // Profiles & Vault
    const [profiles, setProfiles] = useState<string[]>([]);
    const [profileVaultMap, setProfileVaultMap] = useState<Record<string, UserData>>({});
    const [activeProfile, setActiveProfile] = useState('Default');
    const [newProfileName, setNewProfileName] = useState('');
    const [newProfileType, setNewProfileType] = useState<'job' | 'medical' | 'survey' | 'custom'>('job');
    const [editingProfile, setEditingProfile] = useState<string | null>(null);
    const [profileData, setProfileData] = useState<UserData>(EMPTY_USER);

    // Custom Fields Editor
    const [newCFLabel, setNewCFLabel] = useState('');
    const [newCFValue, setNewCFValue] = useState('');
    const [newCFContext, setNewCFContext] = useState('');

    // Privacy & Automation
    const [allowQAContext, setAllowQAContext] = useState(true);
    const [autoSubmit, setAutoSubmit] = useState(false);
    const [typingDelayMs, setTypingDelayMs] = useState<number>(0);

    // File Vault
    const [fileLibrary, setFileLibrary] = useState<SavedFile[]>([]);
    const [fileDragging, setFileDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const flash = (text: string, type: StatusType = 'success', ms = 4500) => {
        setStatus({ text, type });
        setTimeout(() => setStatus({ text: '', type: '' }), ms);
    };

    // Apply theme to document
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', effectiveTheme);
    }, [effectiveTheme]);

    // Load initial data and storage configurations
    useEffect(() => {
        // Theme preference & sync
        chrome.storage.local.get(['themeMode', 'geminiApiKey', 'allowQAContext', 'autoSubmit', 'isPro', 'proExpiresAt', 'userUid', 'userEmail', 'displayName', 'photoURL', 'typingDelayMs', 'stealthMode'], (r) => {
            if (r.themeMode) setThemeMode(r.themeMode as ThemeMode);
            if (r.geminiApiKey) setApiKey(r.geminiApiKey as string);
            if (r.allowQAContext !== undefined) setAllowQAContext(r.allowQAContext as boolean);
            if (r.autoSubmit !== undefined) setAutoSubmit(r.autoSubmit as boolean);
            if (r.typingDelayMs !== undefined) {
                setTypingDelayMs(Number(r.typingDelayMs));
            } else if (r.stealthMode) {
                setTypingDelayMs(25);
            }
            if (r.proExpiresAt) setProExpiresAt(r.proExpiresAt as string);
            if (r.isPro !== undefined) {
                const isStillValid = r.proExpiresAt ? new Date(r.proExpiresAt as string).getTime() > Date.now() : (r.isPro as boolean);
                setIsPro(isStillValid);
            }
            if (r.userEmail || r.displayName) {
                setUser({
                    uid: r.userUid as string | undefined,
                    email: r.userEmail as string | null | undefined,
                    displayName: (r.displayName as string) || 'Aullevo User',
                    photoURL: r.photoURL as string | null | undefined
                });
            }
        });

        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
        mq.addEventListener('change', handler);

        refreshProfileList();
        loadFileLibrary();

        // Listen to Auth State from Firebase if available
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
                setAuthConnecting(false);
                const userRef = doc(db, 'users', currentUser.uid);

                const unsubSnap = onSnapshot(userRef, async (docSnap) => {
                    let proStatus = false;
                    let expiresAt: string | null = null;
                    if (docSnap.exists()) {
                        const data = docSnap.data();
                        expiresAt = data.proExpiresAt || null;
                        if (data.isPro && expiresAt) {
                            proStatus = new Date(expiresAt).getTime() > Date.now();
                        }
                    }
                    setIsPro(proStatus);
                    setProExpiresAt(expiresAt);
                    await new Promise<void>(resolve => {
                        chrome.storage.local.set({
                            isPro: proStatus,
                            proExpiresAt: expiresAt,
                            userUid: currentUser.uid,
                            userEmail: currentUser.email || '',
                            displayName: currentUser.displayName || '',
                            photoURL: currentUser.photoURL || ''
                        }, () => resolve());
                    });
                    await storageService.switchAccount(currentUser.uid);
                    await refreshProfileList();
                    await loadFileLibrary();
                });
                return () => unsubSnap();
            }
        });

        // Storage listener for live sync from web app or popup
        const storageListener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
            if (areaName === 'local') {
                if (changes.themeMode) {
                    setThemeMode(changes.themeMode.newValue as ThemeMode);
                }
                if (changes.proExpiresAt !== undefined) {
                    setProExpiresAt((changes.proExpiresAt.newValue as string) || null);
                }
                if (changes.isPro !== undefined) {
                    setIsPro(!!changes.isPro.newValue);
                }
                if (changes.userEmail || changes.displayName || changes.userUid) {
                    chrome.storage.local.get(['userUid', 'userEmail', 'displayName', 'photoURL', 'isPro', 'proExpiresAt'], async (r) => {
                        if (r.userEmail || r.displayName || r.userUid) {
                            setUser({
                                uid: r.userUid as string | undefined,
                                email: r.userEmail as string | null | undefined,
                                displayName: (r.displayName as string) || 'Aullevo User',
                                photoURL: r.photoURL as string | null | undefined
                            });
                            if (r.proExpiresAt !== undefined) setProExpiresAt((r.proExpiresAt as string) || null);
                            if (r.isPro !== undefined) setIsPro(!!r.isPro);
                            setAuthConnecting(false);
                            await storageService.switchAccount((r.userUid as string) || (r.userEmail as string) || 'guest');
                            await refreshProfileList();
                            await loadFileLibrary();
                            flash(`✨ Account synced: ${r.displayName || r.userEmail}`, 'success');
                        } else {
                            setUser(null);
                            setIsPro(false);
                            setProExpiresAt(null);
                            await storageService.switchAccount('guest');
                            await refreshProfileList();
                            await loadFileLibrary();
                        }
                    });
                }
            }
        };
        chrome.storage.onChanged.addListener(storageListener);

        return () => {
            unsubscribe();
            mq.removeEventListener('change', handler);
            chrome.storage.onChanged.removeListener(storageListener);
        };
    }, []);

    const handleThemeChange = (mode: ThemeMode) => {
        setThemeMode(mode);
        chrome.storage.local.set({ themeMode: mode });
    };

    // Web Authentication and synchronization handlers
    const openAuthWindow = (url: string) => {
        const width = 520;
        const height = 680;
        const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
        const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));

        try {
            if (typeof chrome !== 'undefined' && chrome.windows?.create) {
                chrome.windows.create({
                    url,
                    type: 'popup',
                    width,
                    height,
                    left,
                    top,
                    focused: true,
                });
                return;
            }
        } catch {
            // Fall through to window.open
        }

        try {
            window.open(url, 'AullevoAuth', `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`);
        } catch {
            if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
                chrome.tabs.create({ url });
            } else {
                window.open(url, '_blank');
            }
        }
    };

    const handleDirectGoogleSignIn = () => {
        setAuthConnecting(true);
        flash('Opening Google sign-in window... Complete login to automatically pair your account.', 'info', 7000);
        openAuthWindow('https://aullevo-web.vercel.app/login?provider=google&action=signin&source=extension');
    };

    const handleSignInViaWeb = () => {
        setAuthConnecting(true);
        flash('Opening Aullevo Web App... Log in or sign up to activate your features.', 'info', 7000);
        openAuthWindow('https://aullevo-web.vercel.app/login');
    };

    const handleSyncByEmail = () => {
        const targetEmail = manualEmail.trim() || (user?.email || '');
        if (!targetEmail) {
            return flash('Please enter your Aullevo account email address.', 'error');
        }
        flash('Searching for account and verifying membership...', 'info', 4000);
        chrome.runtime.sendMessage({ action: 'SYNC_WEB_USER', email: targetEmail }, (res) => {
            if (res && res.success) {
                flash(res.isPro ? '✨ Pro membership verified and active!' : `Account paired with ${targetEmail} (Free Tier).`, res.isPro ? 'success' : 'info');
            } else {
                flash('Sync failed. Make sure your account exists on Aullevo Web.', 'error');
            }
        });
    };

    const handleRefreshProStatus = async () => {
        chrome.storage.local.get(['userUid', 'userEmail'], async (r) => {
            if (!r.userUid && !r.userEmail) {
                flash('No account synced yet. Please click "Sign In with Google" or enter your email below.', 'info', 5000);
                return;
            }
            flash('Checking Pro subscription status...', 'info', 3000);
            try {
                let proStatus = false;
                let foundExpiry: string | null = null;
                let foundDoc = false;
                let foundEmail = r.userEmail || '';
                let foundName = '';
                let foundPhoto = '';

                if (r.userUid) {
                    try {
                        const userRef = doc(db, 'users', r.userUid as string);
                        const userSnap = await getDoc(userRef);
                        if (userSnap.exists()) {
                            const data = userSnap.data();
                            foundExpiry = data.proExpiresAt || null;
                            if (data.isPro && foundExpiry) {
                                proStatus = new Date(foundExpiry).getTime() > Date.now();
                            }
                            foundDoc = true;
                            if (data.email) foundEmail = data.email;
                            if (data.displayName) foundName = data.displayName;
                            if (data.photoURL) foundPhoto = data.photoURL;
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
                            const data = docSnap.data();
                            const exp = data.proExpiresAt || null;
                            if (data.isPro && exp && new Date(exp).getTime() > Date.now()) {
                                proStatus = true;
                                foundExpiry = exp;
                            }
                            foundDoc = true;
                            if (data.displayName) foundName = data.displayName;
                            if (data.photoURL) foundPhoto = data.photoURL;
                        });
                    } catch (e) {
                        console.warn('query by email error:', e);
                    }
                }
                setIsPro(proStatus);
                setProExpiresAt(foundExpiry);
                await new Promise<void>((resolve) => {
                    chrome.storage.local.set({
                        isPro: proStatus,
                        proExpiresAt: foundExpiry,
                        userEmail: foundEmail,
                        displayName: foundName || undefined,
                        photoURL: foundPhoto || undefined
                    }, () => resolve());
                });
                await storageService.switchAccount((r.userUid as string) || (r.userEmail as string) || 'guest');
                await refreshProfileList();
                await loadFileLibrary();
                flash(proStatus ? '✨ Pro monthly subscription verified and active!' : (foundExpiry ? 'Subscription expired. Please renew on Aullevo Web ($2.50/mo).' : 'Account synced (Free Tier).'), proStatus ? 'success' : 'info');
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                flash(`Sync failed: ${msg}`, 'error');
            }
        });
    };

    const handleSignOut = async () => {
        try {
            await signOut(auth);
        } catch {
            // Ignore sign-out error
        }
        setUser(null);
        setIsPro(false);
        setProExpiresAt(null);
        await new Promise<void>((resolve) => {
            chrome.storage.local.set({
                isPro: false,
                proExpiresAt: null,
                userUid: null,
                userEmail: null,
                displayName: null,
                photoURL: null
            }, () => resolve());
        });
        await storageService.switchAccount('guest');
        await refreshProfileList();
        await loadFileLibrary();
        flash('Signed out successfully. Switched to guest profile.');
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

        const vaultMap: Record<string, UserData> = {};
        for (const name of list) {
            const data = await storageService.loadProfile(name);
            if (data) vaultMap[name] = data;
        }
        setProfileVaultMap(vaultMap);
    };

    // Gemini API Key management
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
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            flash(`Key test failed: ${msg}`, 'error', 6000);
        } finally {
            setApiTesting(false);
        }
    };

    // Profile vault management
    const createProfile = async () => {
        if (!isPro && profiles.length >= 1) {
            return flash('Profiles are limited to 1 on the Free tier. Upgrade to Pro for unlimited profiles!', 'error', 5000);
        }
        const name = newProfileName.trim();
        if (!name) return flash('Enter a profile name.', 'error');
        if (profiles.includes(name)) return flash('Profile name already exists.', 'error');
        const newProf: UserData = { ...EMPTY_USER, profileType: newProfileType };
        await storageService.saveProfile(name, newProf);
        setNewProfileName('');
        setNewProfileType('job');
        await refreshProfileList();
        flash(`Profile "${name}" created.`);
    };

    const activateProfile = async (name: string) => {
        if (!isPro && profiles.length > 1 && name !== profiles[0] && name !== 'Default') {
            return flash('🔒 Switching between multiple profiles is exclusive to Pro members. Upgrade to Pro to use all your profiles!', 'error', 5000);
        }
        await storageService.setActiveProfileName(name);
        const data = await storageService.loadProfile(name);
        if (data) chrome.storage.local.set({ userData: data });
        setActiveProfile(name);
        flash(`Switched active profile to "${name}".`);
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
        setProfileData(data || { ...EMPTY_USER, profileType: 'job' });
        setEditingProfile(name);
    };

    const saveEditedProfile = async (andActivate = false) => {
        if (!editingProfile) return;
        await storageService.saveProfile(editingProfile, profileData);
        if (andActivate || editingProfile === activeProfile) {
            await activateProfile(editingProfile);
        }
        await refreshProfileList();
        setEditingProfile(null);
        flash(`Profile "${editingProfile}" saved successfully.`);
    };

    // Subfield helpers (Experience, Education, Custom Fields)
    const addExperience = () => {
        setProfileData(prev => ({
            ...prev,
            experience: [...(prev.experience || []), { company: '', position: '', duration: '', description: '' }]
        }));
    };

    const updateExperience = (index: number, field: keyof Experience, val: string) => {
        setProfileData(prev => {
            const list = [...(prev.experience || [])];
            if (list[index]) {
                list[index] = { ...list[index], [field]: val };
            }
            return { ...prev, experience: list };
        });
    };

    const removeExperience = (index: number) => {
        setProfileData(prev => ({
            ...prev,
            experience: (prev.experience || []).filter((_, i) => i !== index)
        }));
    };

    const addEducation = () => {
        setProfileData(prev => ({
            ...prev,
            education: [...(prev.education || []), { school: '', degree: '', year: '' }]
        }));
    };

    const updateEducation = (index: number, field: keyof Education, val: string) => {
        setProfileData(prev => {
            const list = [...(prev.education || [])];
            if (list[index]) {
                list[index] = { ...list[index], [field]: val };
            }
            return { ...prev, education: list };
        });
    };

    const removeEducation = (index: number) => {
        setProfileData(prev => ({
            ...prev,
            education: (prev.education || []).filter((_, i) => i !== index)
        }));
    };

    const addCustomField = () => {
        if (!newCFLabel.trim()) return;
        setProfileData(prev => ({
            ...prev,
            customFields: [...(prev.customFields || []), { label: newCFLabel.trim(), value: newCFValue.trim(), context: newCFContext.trim() }]
        }));
        setNewCFLabel('');
        setNewCFValue('');
        setNewCFContext('');
    };

    const removeCustomField = (index: number) => {
        setProfileData(prev => ({
            ...prev,
            customFields: (prev.customFields || []).filter((_, i) => i !== index)
        }));
    };

    // Profile backup import and export
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
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            flash(`Import failed: ${msg}`, 'error');
        }
        e.target.value = '';
    };

    // Privacy and auto-submit preferences
    const savePrivacy = () => {
        chrome.storage.local.set({
            allowQAContext,
            autoSubmit,
            typingDelayMs: Math.max(0, Number(typingDelayMs) || 0),
            stealthMode: typingDelayMs > 0,
        }, () => {
            flash('Privacy & Automation settings saved!');
        });
    };

    const handleField = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setProfileData(prev => ({ ...prev, [name]: value }));
    };

    // Render dashboard interface
    return (
        <div className="options-layout" data-theme={effectiveTheme}>
            {/* Sidebar navigation */}
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

                {/* Theme switcher in navigation footer */}
                <div className="nav-footer">
                    <div className="theme-switcher-label">Theme</div>
                    <div className="theme-toggle-group">
                        <button
                            className={`theme-btn ${themeMode === 'light' ? 'active' : ''}`}
                            onClick={() => handleThemeChange('light')}
                            title="Light Mode"
                            type="button"
                        >
                            <Sun size={13} />
                            <span>Light</span>
                        </button>
                        <button
                            className={`theme-btn ${themeMode === 'dark' ? 'active' : ''}`}
                            onClick={() => handleThemeChange('dark')}
                            title="Dark Mode"
                            type="button"
                        >
                            <Moon size={13} />
                            <span>Dark</span>
                        </button>
                        <button
                            className={`theme-btn ${themeMode === 'system' ? 'active' : ''}`}
                            onClick={() => handleThemeChange('system')}
                            title="System Mode (Auto)"
                            type="button"
                        >
                            <Monitor size={13} />
                            <span>Auto</span>
                        </button>
                    </div>
                </div>
            </nav>

            {/* Main content viewport */}
            <main className="options-main">
                <StatusBanner status={status} />

                {/* Account & Pro plan tab */}
                {section === 'account' && (
                    <>
                        <div className="page-header">
                            <h1 className="page-title">
                                {isPro ? <Sparkles className="header-icon" size={24} /> : <Shield className="header-icon" size={24} />} {isPro ? 'Pro Account' : 'Free Account'}
                            </h1>
                            <p className="page-subtitle">
                                {isPro
                                    ? 'Your Pro membership is active across all browser features.'
                                    : 'Sync your membership from Aullevo Web to activate all features across your browser.'}
                            </p>
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
                                        <span>{isPro ? (proExpiresAt ? `Pro Monthly (Valid until ${new Date(proExpiresAt).toLocaleDateString()})` : 'Pro Monthly Active') : (proExpiresAt ? 'Subscription Expired' : 'Free Tier')}</span>
                                    </div>
                                    {!isPro && (
                                        <div className="pro-upgrade-banner">
                                            <p>
                                                Upgrade on the <a href="https://aullevo-web.vercel.app/login" target="_blank" rel="noopener noreferrer">Aullevo Web App</a> ($2.50/mo) to unlock unlimited profiles, files, memories, and smart AI form matching.
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
                                        Sign in via Google or Aullevo Web App to instantly pair your Pro membership with this extension.
                                    </p>
                                    <div className="btn-group">
                                        <button
                                            className="btn btn-primary"
                                            onClick={handleDirectGoogleSignIn}
                                            disabled={authConnecting}
                                        >
                                            {authConnecting ? (
                                                <>
                                                    <RefreshCw size={16} className="spinning" /> Connecting...
                                                </>
                                            ) : (
                                                <>
                                                    <Sparkles size={16} /> Sign In with Google
                                                </>
                                            )}
                                        </button>
                                        <button className="btn btn-secondary" onClick={handleSignInViaWeb}>
                                            <ExternalLink size={16} /> Web App Login
                                        </button>
                                        <button className="btn btn-secondary" onClick={handleRefreshProStatus}>
                                            <RefreshCw size={15} /> Check Status
                                        </button>
                                    </div>

                                    {authConnecting && (
                                        <div className="auth-connecting-hint">
                                            <RefreshCw size={13} className="spinning" />
                                            <span>Sign in completed on the opened window will automatically sync to this extension in real-time.</span>
                                        </div>
                                    )}

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

                {/* API Key tab */}
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

                {/* Profiles list tab */}
                {section === 'profiles' && !editingProfile && (
                    <>
                        <div className="page-header">
                            <h1 className="page-title">
                                <User className="header-icon" size={20} /> Profile Vault
                            </h1>
                            <p className="page-subtitle">Manage multiple profiles. Select one to activate it for smart form filling.</p>
                        </div>

                        {/* Saved Profiles */}
                        <div className="card">
                            <div className="card-title">
                                <User size={16} /> Saved Profiles ({profiles.length})
                            </div>
                            <div className="profile-list">
                                {profiles.length === 0 && (
                                    <p className="empty-text">No profiles created yet. Create one below.</p>
                                )}
                                {profiles.map((name, idx) => {
                                    const prof = profileVaultMap[name] || {};
                                    const pType = prof.profileType || 'job';
                                    const tpl = PROFILE_TEMPLATES[pType] || PROFILE_TEMPLATES.job;
                                    const isActive = name === activeProfile;
                                    const isLocked = !isPro && idx >= 1;

                                    return (
                                        <div key={name} className={`profile-item ${isActive ? 'active' : ''}`}>
                                            <div className="profile-item-details">
                                                <div className="profile-item-name">
                                                    <User size={15} />
                                                    <span>{name}</span>
                                                    {isActive && (
                                                        <span className="active-badge">
                                                            <CheckCircle2 size={11} /> Active
                                                        </span>
                                                    )}
                                                    {isLocked && (
                                                        <span className="active-badge" style={{ background: 'rgba(239, 68, 68, 0.12)', color: '#EF4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                                                            <Lock size={10} /> Pro
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="profile-item-meta">
                                                    <span className={`profile-type-badge ${tpl.badgeClass}`}>
                                                        {tpl.icon} {tpl.label}
                                                    </span>
                                                    {prof.email && (
                                                        <span className="profile-meta-email">&bull; {prof.email}</span>
                                                    )}
                                                    {prof.headline && (
                                                        <span className="profile-meta-headline">&bull; {prof.headline}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="profile-actions">
                                                <button className="btn btn-secondary btn-sm" onClick={() => openEditProfile(name)}>
                                                    <Edit3 size={13} /> Edit
                                                </button>
                                                {!isActive && (
                                                    <button
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => activateProfile(name)}
                                                        title={isLocked ? 'Upgrade to Pro to activate this profile' : 'Select Active'}
                                                    >
                                                        {isLocked ? <Lock size={13} /> : <Check size={13} />} Select Active
                                                    </button>
                                                )}
                                                <button className="btn btn-danger btn-sm" onClick={() => deleteProfile(name)} title="Delete profile">
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Create New Profile */}
                        <div className="card">
                            <div className="card-title">
                                <Plus size={16} /> Create New Profile
                            </div>
                            <div className="input-group">
                                <label>Profile Name</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Senior Frontend Dev, Dental Clinic, Government..."
                                    value={newProfileName}
                                    onChange={e => setNewProfileName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && createProfile()}
                                />
                            </div>

                            <div className="input-group">
                                <label>Profile Template</label>
                                <div className="template-grid">
                                    {Object.entries(PROFILE_TEMPLATES).map(([key, t]) => (
                                        <div
                                            key={key}
                                            className={`template-card ${newProfileType === key ? 'selected' : ''}`}
                                            onClick={() => setNewProfileType(key as 'job' | 'medical' | 'survey' | 'custom')}
                                        >
                                            <div className="template-card-header">
                                                <span className={`template-icon ${t.badgeClass}`}>{t.icon}</span>
                                                <span className="template-title">{t.label}</span>
                                            </div>
                                            <p className="template-desc">{t.desc}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <button className="btn btn-primary" onClick={createProfile}>
                                <Plus size={15} /> Create Profile
                            </button>
                        </div>

                        {/* Import / Export */}
                        <div className="card">
                            <div className="card-title">
                                <Download size={16} /> Import & Export Backup
                            </div>
                            <p className="card-desc">
                                Export all profiles to an encrypted JSON backup file or restore from a previous backup.
                            </p>
                            <div className="btn-group">
                                <button className="btn btn-secondary btn-sm" onClick={handleExport}>
                                    <Download size={14} /> Export All
                                </button>
                                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                                    <Upload size={14} /> Import Profiles
                                    <input type="file" accept=".json" onChange={handleImport} hidden />
                                </label>
                            </div>
                        </div>
                    </>
                )}

                {/* Profile edit tab */}
                {section === 'profiles' && editingProfile && (
                    <>
                        <div className="page-header">
                            <h1 className="page-title">
                                <Edit3 className="header-icon" size={20} /> Editing Profile: {editingProfile}
                            </h1>
                            <p className="page-subtitle">Configure your profile template and fields.</p>
                        </div>

                        {/* Template Selection */}
                        <div className="card">
                            <div className="card-title">
                                <Layers size={16} /> Profile Template
                            </div>
                            <div className="template-grid">
                                {Object.entries(PROFILE_TEMPLATES).map(([key, t]) => (
                                    <div
                                        key={key}
                                        className={`template-card ${(profileData.profileType || 'job') === key ? 'selected' : ''}`}
                                        onClick={() => setProfileData(prev => ({ ...prev, profileType: key as 'job' | 'medical' | 'survey' | 'custom' }))}
                                    >
                                        <div className="template-card-header">
                                            <span className={`template-icon ${t.badgeClass}`}>{t.icon}</span>
                                            <span className="template-title">{t.label}</span>
                                        </div>
                                        <p className="template-desc">{t.desc}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Personal Information (Only for non-custom templates) */}
                        {profileData.profileType !== 'custom' && (
                            <div className="card">
                                <div className="card-title">
                                    <User size={16} /> Personal Information
                                </div>
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
                                <div className="input-row">
                                    <div className="input-group">
                                        <label>Email Address</label>
                                        <input name="email" type="email" value={profileData.email || ''} onChange={handleField} placeholder="john@example.com" />
                                    </div>
                                    <div className="input-group">
                                        <label>Phone Number</label>
                                        <input name="phone" type="tel" value={profileData.phone || ''} onChange={handleField} placeholder="+1 555 000 0000" />
                                    </div>
                                </div>
                                <div className="input-group">
                                    <label>Street Address</label>
                                    <input name="address" value={profileData.address || ''} onChange={handleField} placeholder="123 Main St, Apt 4B" />
                                </div>
                                <div className="input-row">
                                    <div className="input-group">
                                        <label>City</label>
                                        <input name="city" value={profileData.city || ''} onChange={handleField} placeholder="San Francisco" />
                                    </div>
                                    <div className="input-group">
                                        <label>State / Province</label>
                                        <input name="state" value={profileData.state || ''} onChange={handleField} placeholder="California" />
                                    </div>
                                </div>
                                <div className="input-row">
                                    <div className="input-group">
                                        <label>ZIP / Postal Code</label>
                                        <input name="zipCode" value={profileData.zipCode || ''} onChange={handleField} placeholder="94105" />
                                    </div>
                                    <div className="input-group">
                                        <label>Country</label>
                                        <input name="country" value={profileData.country || ''} onChange={handleField} placeholder="United States" />
                                    </div>
                                </div>
                                <div className="input-row">
                                    <div className="input-group">
                                        <label>Date of Birth</label>
                                        <input name="dateOfBirth" type="date" value={profileData.dateOfBirth || ''} onChange={handleField} />
                                    </div>
                                    <div className="input-group">
                                        <label>Gender</label>
                                        <input name="gender" value={profileData.gender || ''} onChange={handleField} placeholder="e.g. Male, Female, Non-binary" />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Job application specific fields */}
                        {(profileData.profileType || 'job') === 'job' && (
                            <>
                                <div className="card">
                                    <div className="card-title">
                                        <Briefcase size={18} /> Professional Links
                                    </div>
                                    <div className="input-group">
                                        <label>LinkedIn Profile</label>
                                        <input name="linkedin" type="url" value={profileData.linkedin || ''} onChange={handleField} placeholder="https://linkedin.com/in/username" />
                                    </div>
                                    <div className="input-group">
                                        <label>GitHub Profile</label>
                                        <input name="github" type="url" value={profileData.github || ''} onChange={handleField} placeholder="https://github.com/username" />
                                    </div>
                                    <div className="input-group">
                                        <label>Portfolio / Website</label>
                                        <input name="portfolio" type="url" value={profileData.portfolio || ''} onChange={handleField} placeholder="https://yourportfolio.com" />
                                    </div>
                                </div>

                                <div className="card">
                                    <div className="card-title">
                                        <Briefcase size={18} /> Career Details
                                    </div>
                                    <div className="input-group">
                                        <label>Professional Headline</label>
                                        <input name="headline" value={profileData.headline || ''} onChange={handleField} placeholder="e.g. Senior Full-Stack Engineer" />
                                    </div>
                                    <div className="input-row">
                                        <div className="input-group">
                                            <label>Years of Experience</label>
                                            <input name="yearsOfExperience" value={profileData.yearsOfExperience || ''} onChange={handleField} placeholder="5" />
                                        </div>
                                        <div className="input-group">
                                            <label>Salary Expectation</label>
                                            <input name="salaryExpectation" value={profileData.salaryExpectation || ''} onChange={handleField} placeholder="$120,000" />
                                        </div>
                                    </div>
                                    <div className="input-row">
                                        <div className="input-group">
                                            <label>Notice Period</label>
                                            <input name="noticePeriod" value={profileData.noticePeriod || ''} onChange={handleField} placeholder="2 weeks" />
                                        </div>
                                        <div className="input-group">
                                            <label>Work Authorization</label>
                                            <input name="workAuthorization" value={profileData.workAuthorization || ''} onChange={handleField} placeholder="US Citizen / Green Card" />
                                        </div>
                                    </div>
                                    <div className="input-group">
                                        <label>Professional Summary</label>
                                        <textarea name="summary" value={profileData.summary || ''} onChange={handleField} rows={4} placeholder="Summary of your background and strengths..." />
                                    </div>
                                    <div className="input-group">
                                        <label>Skills (comma-separated)</label>
                                        <textarea
                                            placeholder="React, TypeScript, Node.js, Python, AWS, Docker..."
                                            value={profileData.skills?.join(', ') || ''}
                                            onChange={e => setProfileData(prev => ({
                                                ...prev,
                                                skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                                            }))}
                                            rows={3}
                                        />
                                    </div>
                                </div>

                                {/* Work Experience Repeater */}
                                <div className="card">
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                        <div className="card-title" style={{ marginBottom: 0 }}>
                                            <Building size={18} /> Work Experience ({(profileData.experience || []).length})
                                        </div>
                                        <button className="btn btn-secondary btn-sm" onClick={addExperience} type="button">
                                            <Plus size={14} /> Add Job
                                        </button>
                                    </div>

                                    {(profileData.experience || []).length === 0 && (
                                        <p className="empty-text">No work experience added yet.</p>
                                    )}

                                    {(profileData.experience || []).map((exp, idx) => (
                                        <div key={idx} className="repeater-item">
                                            <div className="repeater-header">
                                                <span className="repeater-title">Job #{idx + 1}</span>
                                                <button className="btn btn-danger btn-sm" onClick={() => removeExperience(idx)} type="button">
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                            <div className="input-row">
                                                <div className="input-group">
                                                    <label>Company</label>
                                                    <input value={exp.company} onChange={e => updateExperience(idx, 'company', e.target.value)} placeholder="e.g. Acme Corp" />
                                                </div>
                                                <div className="input-group">
                                                    <label>Position / Role</label>
                                                    <input value={exp.position} onChange={e => updateExperience(idx, 'position', e.target.value)} placeholder="e.g. Software Engineer" />
                                                </div>
                                            </div>
                                            <div className="input-group">
                                                <label>Duration / Dates</label>
                                                <input value={exp.duration} onChange={e => updateExperience(idx, 'duration', e.target.value)} placeholder="e.g. 2021 - Present" />
                                            </div>
                                            <div className="input-group">
                                                <label>Description & Accomplishments</label>
                                                <textarea value={exp.description} onChange={e => updateExperience(idx, 'description', e.target.value)} rows={3} placeholder="Key responsibilities and achievements..." />
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Education Repeater */}
                                <div className="card">
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                        <div className="card-title" style={{ marginBottom: 0 }}>
                                            <GraduationCap size={18} /> Education ({(profileData.education || []).length})
                                        </div>
                                        <button className="btn btn-secondary btn-sm" onClick={addEducation} type="button">
                                            <Plus size={14} /> Add Education
                                        </button>
                                    </div>

                                    {(profileData.education || []).length === 0 && (
                                        <p className="empty-text">No education entries added yet.</p>
                                    )}

                                    {(profileData.education || []).map((edu, idx) => (
                                        <div key={idx} className="repeater-item">
                                            <div className="repeater-header">
                                                <span className="repeater-title">Education #{idx + 1}</span>
                                                <button className="btn btn-danger btn-sm" onClick={() => removeEducation(idx)} type="button">
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                            <div className="input-row">
                                                <div className="input-group">
                                                    <label>School / University</label>
                                                    <input value={edu.school} onChange={e => updateEducation(idx, 'school', e.target.value)} placeholder="e.g. University of California" />
                                                </div>
                                                <div className="input-group">
                                                    <label>Degree & Major</label>
                                                    <input value={edu.degree} onChange={e => updateEducation(idx, 'degree', e.target.value)} placeholder="e.g. B.S. in Computer Science" />
                                                </div>
                                            </div>
                                            <div className="input-group">
                                                <label>Graduation Year</label>
                                                <input value={edu.year} onChange={e => updateEducation(idx, 'year', e.target.value)} placeholder="e.g. 2020" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}

                        {/* Medical form specific fields */}
                        {profileData.profileType === 'medical' && (
                            <>
                                <div className="card">
                                    <div className="card-title">
                                        <Activity size={18} /> Health & Medical Details
                                    </div>
                                    <div className="input-row">
                                        <div className="input-group">
                                            <label>Blood Type</label>
                                            <input name="bloodType" value={profileData.bloodType || ''} onChange={handleField} placeholder="e.g. O+, A-, B+" />
                                        </div>
                                        <div className="input-group">
                                            <label>Known Allergies</label>
                                            <input name="allergies" value={profileData.allergies || ''} onChange={handleField} placeholder="e.g. Penicillin, Peanuts" />
                                        </div>
                                    </div>
                                    <div className="input-group">
                                        <label>Medical Conditions / Diagnoses</label>
                                        <textarea name="medicalConditions" value={profileData.medicalConditions || ''} onChange={handleField} rows={3} placeholder="e.g. Asthma, Hypertension..." />
                                    </div>
                                    <div className="input-group">
                                        <label>Current Medications</label>
                                        <textarea name="medications" value={profileData.medications || ''} onChange={handleField} rows={3} placeholder="e.g. Albuterol inhaler as needed..." />
                                    </div>
                                </div>

                                <div className="card">
                                    <div className="card-title">
                                        <User size={18} /> Emergency Contact
                                    </div>
                                    <div className="input-group">
                                        <label>Contact Full Name</label>
                                        <input name="emergencyContactName" value={profileData.emergencyContactName || ''} onChange={handleField} placeholder="e.g. Mary Jane" />
                                    </div>
                                    <div className="input-row">
                                        <div className="input-group">
                                            <label>Relationship</label>
                                            <input name="emergencyContactRelationship" value={profileData.emergencyContactRelationship || ''} onChange={handleField} placeholder="e.g. Spouse, Mother, Brother" />
                                        </div>
                                        <div className="input-group">
                                            <label>Contact Phone Number</label>
                                            <input name="emergencyContactPhone" type="tel" value={profileData.emergencyContactPhone || ''} onChange={handleField} placeholder="+1 555 000 0000" />
                                        </div>
                                    </div>
                                </div>

                                <div className="card">
                                    <div className="card-title">
                                        <Shield size={18} /> Health Insurance
                                    </div>
                                    <div className="input-row">
                                        <div className="input-group">
                                            <label>Insurance Provider</label>
                                            <input name="insuranceProvider" value={profileData.insuranceProvider || ''} onChange={handleField} placeholder="e.g. Blue Cross Blue Shield" />
                                        </div>
                                        <div className="input-group">
                                            <label>Policy / Member ID</label>
                                            <input name="policyNumber" value={profileData.policyNumber || ''} onChange={handleField} placeholder="e.g. X123456789" />
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Survey and demographics specific fields */}
                        {profileData.profileType === 'survey' && (
                            <div className="card">
                                <div className="card-title">
                                    <FileQuestion size={18} /> Survey & Demographic Details
                                </div>
                                <div className="input-row">
                                    <div className="input-group">
                                        <label>Occupation</label>
                                        <input name="occupation" value={profileData.occupation || ''} onChange={handleField} placeholder="e.g. Software Engineer" />
                                    </div>
                                    <div className="input-group">
                                        <label>Industry</label>
                                        <input name="industry" value={profileData.industry || ''} onChange={handleField} placeholder="e.g. Technology / Internet" />
                                    </div>
                                </div>
                                <div className="input-row">
                                    <div className="input-group">
                                        <label>Highest Education Level</label>
                                        <input name="educationLevel" value={profileData.educationLevel || ''} onChange={handleField} placeholder="e.g. Bachelor's Degree" />
                                    </div>
                                    <div className="input-group">
                                        <label>Marital Status</label>
                                        <input name="maritalStatus" value={profileData.maritalStatus || ''} onChange={handleField} placeholder="e.g. Single, Married" />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Custom fields section */}
                        <div className="card">
                            <div className="card-title">
                                <Layers size={18} /> Custom Q&A Fields ({(profileData.customFields || []).length})
                            </div>
                            <p className="card-desc">
                                Add personalized key-value questions so Aullevo knows how to answer domain-specific questions on forms.
                            </p>

                            {(profileData.customFields || []).length > 0 && (
                                <div className="custom-fields-list">
                                    {(profileData.customFields || []).map((cf, idx) => (
                                        <div key={idx} className="custom-field-item">
                                            <div className="custom-field-info">
                                                <div className="custom-field-label">{cf.label}</div>
                                                <div className="custom-field-value">{cf.value || '—'}</div>
                                                {cf.context && (
                                                    <div className="custom-field-context">
                                                        <MapPin size={11} /> {cf.context}
                                                    </div>
                                                )}
                                            </div>
                                            <button className="vault-file-remove" onClick={() => removeCustomField(idx)} title="Remove custom field">
                                                <X size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="custom-field-add-box" style={{ marginTop: '12px' }}>
                                <div className="input-row">
                                    <div className="input-group">
                                        <label>Question / Field Label</label>
                                        <input
                                            value={newCFLabel}
                                            onChange={e => setNewCFLabel(e.target.value)}
                                            placeholder="e.g. Preferred Pronouns, Clearance Level..."
                                        />
                                    </div>
                                    <div className="input-group">
                                        <label>Your Value / Answer</label>
                                        <input
                                            value={newCFValue}
                                            onChange={e => setNewCFValue(e.target.value)}
                                            placeholder="e.g. He/Him, Top Secret..."
                                        />
                                    </div>
                                </div>
                                <div className="input-group">
                                    <label>AI Matching Context (Optional)</label>
                                    <input
                                        value={newCFContext}
                                        onChange={e => setNewCFContext(e.target.value)}
                                        placeholder="e.g. Use when form asks about security clearance"
                                    />
                                </div>
                                <button className="btn btn-secondary btn-sm" onClick={addCustomField} type="button">
                                    <PlusCircle size={14} /> Add Custom Field
                                </button>
                            </div>
                        </div>

                        {/* Save Action Bar */}
                        <div className="btn-group" style={{ marginBottom: '40px' }}>
                            <button className="btn btn-primary" onClick={() => saveEditedProfile(false)}>
                                <Save size={16} /> Save Profile
                            </button>
                            <button className="btn btn-secondary" onClick={() => saveEditedProfile(true)}>
                                <Check size={16} /> Save & Set Active
                            </button>
                            <button className="btn btn-secondary" onClick={() => setEditingProfile(null)}>
                                <ArrowLeft size={16} /> Back to Vault
                            </button>
                        </div>
                    </>
                )}

                {/* Privacy and Automation tab */}
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

                        {/* Typing Speed Card */}
                        <div className="card">
                            <div className="card-title">
                                <Keyboard size={18} /> Human Typing Speed &amp; Anti-Bot Stealth
                            </div>
                            <p className="card-desc">
                                Emulates realistic keyboard typing with character-by-character events and millisecond delays to bypass bot detection on sensitive job boards (Workday, Taleo, Greenhouse, etc.).
                            </p>

                            <div className="speed-preset-grid">
                                <button
                                    type="button"
                                    className={`speed-preset-card ${typingDelayMs === 0 ? 'active' : ''}`}
                                    onClick={() => setTypingDelayMs(0)}
                                >
                                    <Zap size={18} />
                                    <span className="speed-preset-title">Instant (0ms)</span>
                                    <span className="speed-preset-sub">Fast bulk fill</span>
                                </button>
                                <button
                                    type="button"
                                    className={`speed-preset-card ${typingDelayMs === 25 ? 'active' : ''}`}
                                    onClick={() => setTypingDelayMs(25)}
                                >
                                    <User size={18} />
                                    <span className="speed-preset-title">Natural (25ms)</span>
                                    <span className="speed-preset-sub">Realistic cadence</span>
                                </button>
                                <button
                                    type="button"
                                    className={`speed-preset-card ${typingDelayMs === 65 ? 'active' : ''}`}
                                    onClick={() => setTypingDelayMs(65)}
                                >
                                    <Clock size={18} />
                                    <span className="speed-preset-title">Slow (65ms)</span>
                                    <span className="speed-preset-sub">Maximum stealth</span>
                                </button>
                            </div>

                            <div className="speed-custom-container">
                                <div>
                                    <div className="toggle-label">Custom Millisecond Delay</div>
                                    <div className="toggle-desc">Set an exact delay per character (0 - 1000ms)</div>
                                </div>
                                <div className="speed-custom-input-box">
                                    <input
                                        type="number"
                                        min="0"
                                        max="1000"
                                        step="5"
                                        value={typingDelayMs}
                                        onChange={e => setTypingDelayMs(Math.max(0, parseInt(e.target.value, 10) || 0))}
                                    />
                                    <span className="text-muted" style={{ fontSize: '11px', fontWeight: 'bold' }}>ms</span>
                                </div>
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

                {/* Shortcuts tab */}
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
                                { key: 'Ctrl + Shift + E', desc: 'Toggle sidebar panel' },
                                { key: 'Ctrl + Shift + F', desc: 'Quick AI fill — instantly analyze and fill current page' },
                                { key: 'Alt + Shift + E', desc: 'Toggle sidebar panel (alternative)' },
                            ].map(({ key, desc }) => (
                                <div key={key} className="shortcut-row">
                                    <span className="shortcut-desc">{desc}</span>
                                    <span className="shortcut-key">{key}</span>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {/* File vault library tab */}
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

                {/* About tab */}
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
                            <div className="about-version">Aullevo v1.0.0</div>
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

// Application root mount
const container = document.getElementById('options-root') || document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<Options />);
}
