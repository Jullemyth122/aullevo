import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { extractFormFields } from '../services/formAnalyzer';
import { geminiService } from '../services/geminiService';
import { resumeParser } from '../services/resumeParser';
import { fileMatchesField } from '../utils/fileMatch';
import type { UserData, CustomField, SavedFile, FormField, Memory, SavedLink } from '../types';
import {
    FileText, FolderOpen, Image, FileType, Paperclip, Archive,
    MapPin, Save, AlertTriangle, ShieldCheck, Moon, Sun,
    Sparkles, X, Check, RefreshCw, ChevronRight, ChevronDown,
} from 'lucide-react';

/* ────────────────────────────────────────────────────────────
   TYPES
──────────────────────────────────────────────────────────── */
type Tab = 'fill' | 'profile' | 'knowledge' | 'links' | 'settings';

interface FillStatus {
    message: string;
    type: 'idle' | 'scanning' | 'filling' | 'success' | 'error' | 'info';
}

function migrateCustomFields(raw: any): CustomField[] {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
        return Object.entries(raw).map(([key, value]) => ({
            label: key,
            value: String(value),
            context: '',
        }));
    }
    return [];
}

/* ────────────────────────────────────────────────────────────
   FILE TYPE → ICON COMPONENT
──────────────────────────────────────────────────────────── */
const FileIcon = ({ type }: { type: string }) => {
    if (type.startsWith('image/')) return <Image size={16} />;
    if (type === 'application/pdf') return <FileType size={16} />;
    if (type.includes('word') || type.includes('document')) return <FileText size={16} />;
    if (type.includes('zip') || type.includes('archive')) return <Archive size={16} />;
    return <Paperclip size={16} />;
};

/* ────────────────────────────────────────────────────────────
   SIDEBAR COMPONENT
──────────────────────────────────────────────────────────── */
export default function Sidebar() {
    const [isDark, setIsDark] = useState(() =>
        typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    );
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<Tab>('fill');
    const [fieldCount, setFieldCount] = useState(0);
    const [pageFields, setPageFields] = useState<FormField[]>([]);
    const [fillStatus, setFillStatus] = useState<FillStatus>({ message: '', type: 'idle' });
    const [isProcessing, setIsProcessing] = useState(false);
    const [matchingMode, setMatchingMode] = useState<'ai' | 'heuristic'>('heuristic');
    const [skillsInput, setSkillsInput] = useState<string | null>(null);
    const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [userData, setUserData] = useState<Partial<UserData>>({
        firstName: '', lastName: '', email: '', phone: '',
        address: '', city: '', state: '', zipCode: '', country: '',
        linkedin: '', portfolio: '', github: '',
        headline: '', summary: '', skills: [],
        yearsOfExperience: '', salaryExpectation: '',
        noticePeriod: '', workAuthorization: '',
        dateOfBirth: '', gender: '',
        customFields: [], experience: [], education: [],
    });
    const [apiKey, setApiKey] = useState('');
    const [saveMsg, setSaveMsg] = useState('');
    const [uploadedFile, setUploadedFile] = useState('');
    const [newCFLabel, setNewCFLabel] = useState('');
    const [newCFValue, setNewCFValue] = useState('');
    const [newCFContext, setNewCFContext] = useState('');
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({
        personal: true, filelib: true, links: false, skills: false, job: false, custom: true,
    });

    const [newMemTitle, setNewMemTitle] = useState('');
    const [newMemContent, setNewMemContent] = useState('');
    const [newLinkTitle, setNewLinkTitle] = useState('');
    const [newLinkUrl, setNewLinkUrl] = useState('');
    const [newLinkAutoFill, setNewLinkAutoFill] = useState(true);

    // ── File Library state ──
    const [fileLibrary, setFileLibrary] = useState<SavedFile[]>([]);
    const [fileDragging, setFileDragging] = useState(false);
    const fileLibInputRef = useRef<HTMLInputElement>(null);
    let fileUid = 0;
    const newFileId = () => `sf-${Date.now()}-${fileUid++}`;

    const fileSizeStr = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const loadFileLibrary = () => {
        if (typeof chrome === 'undefined' || !chrome.storage) return;
        chrome.storage.local.get('fileLibrary', (r) => {
            setFileLibrary((r.fileLibrary as SavedFile[]) || []);
        });
    };

    const addFilesToLibrary = async (files: File[]) => {
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

        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ fileLibrary: updated }, () => {
                if (chrome.runtime.lastError) {
                    console.error('Aullevo Storage Error:', chrome.runtime.lastError);
                    setFillStatus({ message: 'File too large! Could not save to local storage (Quota exceeded).', type: 'error' });
                } else {
                    setFileLibrary(updated);
                    setFillStatus({ message: `Saved ${entries.length} file(s) to library.`, type: 'success' });
                    setTimeout(() => setFillStatus({ message: '', type: 'idle' }), 3000);
                }
            });
        } else {
            setFileLibrary(updated);
        }
    };

    const removeFromLibrary = (id: string) => {
        const updated = fileLibrary.filter(f => f.id !== id);
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ fileLibrary: updated });
        }
        setFileLibrary(updated);
    };

    /* ── Dark mode listener ── */
    useEffect(() => {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    /* ── Load from storage on mount ── */
    useEffect(() => {
        if (typeof chrome === 'undefined' || !chrome.storage) return;
        chrome.storage.local.get(['userData', 'geminiApiKey', 'matchingMode'], (result) => {
            if (result.userData) {
                const loaded = result.userData as any;
                loaded.customFields = migrateCustomFields(loaded.customFields);
                setUserData(loaded);
                setSkillsInput((loaded.skills || []).join(', '));
            }
            if (result.geminiApiKey) setApiKey(result.geminiApiKey as string);
            if (result.matchingMode) setMatchingMode(result.matchingMode as 'ai' | 'heuristic');
        });
        loadFileLibrary();
    }, []);

    useEffect(() => {
        if (isOpen && activeTab === 'fill') scanFields();
    }, [isOpen, activeTab]);

    useEffect(() => {
        if (!isOpen || activeTab !== 'fill') return;
        const observer = new MutationObserver(() => {
            if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
            scanTimerRef.current = setTimeout(scanFields, 800);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return () => {
            observer.disconnect();
            if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
        };
    }, [isOpen, activeTab]);

    useEffect(() => {
        const handleMessage = (request: any, _sender: any, sendResponse: any) => {
            if (request.action === 'toggleSidebar') { setIsOpen(p => !p); sendResponse({ success: true }); }
            if (request.action === 'openSidebar') { setIsOpen(true); sendResponse({ success: true }); }
            if (request.action === 'sidebarStatus') {
                setFillStatus({ message: request.message, type: request.statusType || 'idle' });
                if (request.statusType === 'success' || request.statusType === 'error') setIsProcessing(false);
            }
        };
        if (typeof chrome !== 'undefined') chrome.runtime.onMessage.addListener(handleMessage);
        return () => { if (typeof chrome !== 'undefined') chrome.runtime.onMessage.removeListener(handleMessage); };
    }, []);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.altKey && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); setIsOpen(p => !p); }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    /* ── Global Error Catching ── */
    useEffect(() => {
        const handleGlobalError = (event: ErrorEvent) => {
            // Ignore benign React ResizeObserver loop errors and Chrome extension reload errors
            if (event.message === 'ResizeObserver loop limit exceeded' || event.message === 'ResizeObserver loop completed with undelivered notifications.') return;
            if (event.message.includes('Extension context invalidated')) return;

            console.error('Aullevo Global Error Caught:', event.error);
            setFillStatus({ message: `Whoops! Extension error: ${event.message}`, type: 'error' });
            setIsProcessing(false);
        };

        const handlePromiseRejection = (event: PromiseRejectionEvent) => {
            console.error('Aullevo Unhandled Promise Rejection:', event.reason);
            const msg = event.reason?.message || String(event.reason);
            // Don't show rate-limit as global crash, handled gracefully
            if (!msg.includes('Rate limit') && !msg.toLowerCase().includes('already running')) {
                setFillStatus({ message: `Aullevo task failed: ${msg}`, type: 'error' });
            }
            setIsProcessing(false);
        };

        window.addEventListener('error', handleGlobalError);
        window.addEventListener('unhandledrejection', handlePromiseRejection);

        return () => {
            window.removeEventListener('error', handleGlobalError);
            window.removeEventListener('unhandledrejection', handlePromiseRejection);
        };
    }, []);

    /* ── Helpers ── */
    const scanFields = () => {
        try {
            const fields = extractFormFields();
            setFieldCount(fields.length);
            setPageFields(fields);
        } catch {
            setFieldCount(0);
            setPageFields([]);
        }
    };

    const toggleSection = (key: string) => setOpenSections(p => ({ ...p, [key]: !p[key] }));

    const handleInput = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setUserData(p => ({ ...p, [name]: value }));
    };

    const handleSave = () => {
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            chrome.storage.local.set({ userData }, () => {
                setSaveMsg('Saved!');
                setTimeout(() => setSaveMsg(''), 2000);
            });
        }
    };

    const handleSaveApiKey = () => {
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            chrome.storage.local.set({ geminiApiKey: apiKey }, () => {
                setSaveMsg('API key saved!');
                setTimeout(() => setSaveMsg(''), 2000);
            });
        }
    };

    const addCustomField = () => {
        if (!newCFLabel.trim()) return;
        const cf: CustomField = { label: newCFLabel.trim(), value: newCFValue.trim(), context: newCFContext.trim() };
        setUserData(p => ({ ...p, customFields: [...((p.customFields as CustomField[]) || []), cf] }));
        setNewCFLabel(''); setNewCFValue(''); setNewCFContext('');
    };

    const removeCustomField = (i: number) => {
        setUserData(p => ({ ...p, customFields: ((p.customFields as CustomField[]) || []).filter((_, idx) => idx !== i) }));
    };

    const addMemory = () => {
        if (!newMemTitle.trim() || !newMemContent.trim()) return;
        const memory: Memory = { id: Date.now().toString(), title: newMemTitle.trim(), content: newMemContent.trim() };
        setUserData(p => ({ ...p, memories: [...((p.memories as Memory[]) || []), memory] }));
        setNewMemTitle(''); setNewMemContent('');
    };

    const removeMemory = (id: string) => {
        setUserData(p => ({ ...p, memories: ((p.memories as Memory[]) || []).filter(m => m.id !== id) }));
    };

    const addLink = () => {
        if (!newLinkTitle.trim() || !newLinkUrl.trim()) return;
        const link: SavedLink = { id: Date.now().toString(), title: newLinkTitle.trim(), url: newLinkUrl.trim(), autoFill: newLinkAutoFill };
        setUserData(p => ({ ...p, savedLinks: [...((p.savedLinks as SavedLink[]) || []), link] }));
        setNewLinkTitle(''); setNewLinkUrl(''); setNewLinkAutoFill(true);
    };

    const removeLink = (id: string) => {
        setUserData(p => ({ ...p, savedLinks: ((p.savedLinks as SavedLink[]) || []).filter(l => l.id !== id) }));
    };

    const triggerAutopilot = (url: string) => {
        if (typeof chrome !== 'undefined') {
            chrome.runtime.sendMessage({ action: 'openAutopilotLink', url });
        }
        setIsOpen(false);
    };

    const handleResumeUpload = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!apiKey) {
            setFillStatus({ message: 'Please add your Gemini API key in Settings first.', type: 'error' });
            setActiveTab('settings');
            return;
        }
        setUploadedFile(file.name);
        setIsProcessing(true);
        setFillStatus({ message: 'Parsing your resume with AI…', type: 'info' });
        try {
            geminiService.setApiKey(apiKey);
            const text = await resumeParser.parseFile(file);
            const parsed = await geminiService.parseResume(text);
            const merged = { ...userData, ...parsed, customFields: userData.customFields || [] };
            setUserData(merged);

            const reader = new FileReader();
            reader.onload = (ev) => {
                const base64 = ev.target?.result as string;
                if (typeof chrome !== 'undefined' && chrome?.storage) {
                    chrome.storage.local.set({ userData: merged, resumeFileData: base64, resumeFileName: file.name });
                }
            };
            reader.readAsDataURL(file);

            setFillStatus({ message: 'Resume parsed! Review your profile and save.', type: 'success' });
            setActiveTab('profile');
        } catch (err: any) {
            setFillStatus({ message: err.message || 'Failed to parse resume.', type: 'error' });
        } finally { setIsProcessing(false); }
    };

    const handleFill = async () => {
        if (matchingMode === 'ai' && !apiKey) {
            setFillStatus({ message: 'Add your Gemini API key in Settings first.', type: 'error' });
            setActiveTab('settings');
            return;
        }
        setIsProcessing(true);
        setFillStatus({ message: matchingMode === 'heuristic' ? 'Matching fields by keyword…' : 'Scanning form fields…', type: 'scanning' });
        try {
            chrome.runtime.sendMessage({ action: 'triggerFillFromSidebar' }, (response) => {
                if (chrome.runtime?.lastError) {
                    console.warn('Aullevo: Extension context error (safe to ignore)', chrome.runtime.lastError);
                    setFillStatus({ message: 'Extension reloaded. Please refresh the page.', type: 'error' });
                    setIsProcessing(false);
                    return;
                }
                if (response?.success) {
                    setFillStatus({ message: `Filled ${response.filledCount ?? '?'} fields successfully!`, type: 'success' });
                } else {
                    setFillStatus({ message: response?.error || 'Fill failed', type: 'error' });
                }
                setIsProcessing(false);
            });
        } catch (err: any) {
            setFillStatus({ message: err.message, type: 'error' });
            setIsProcessing(false);
        }
    };

    const customFields = (userData.customFields as CustomField[]) || [];

    /* ────────────────────────────────────────────────────────────
       ⚠️  CRITICAL: All "tab" content is rendered as plain function
       calls — NOT as <Component /> JSX. This prevents React from
       treating them as separate component trees that get unmounted
       on every parent re-render, which was causing inputs to lose
       focus after the first keystroke.
    ──────────────────────────────────────────────────────────── */

    /* ── Section Header ── */
    const renderSectionHeader = (label: string, sectionKey: string) => (
        <button key={`sh-${sectionKey}`} className="av-section__toggle" onClick={() => toggleSection(sectionKey)}>
            <span>{label}</span>
            <span className={`av-section__arrow ${openSections[sectionKey] ? 'av-section__arrow--open' : ''}`}>
                <ChevronDown size={12} />
            </span>
        </button>
    );

    /* ═══════════════════════════════════════
       FILL TAB
    ═══════════════════════════════════════ */
    const renderFillTab = () => {
        const fillDisabled = isProcessing || fieldCount === 0;

        return (
            <div className="av-fill-tab">
                {/* Upload */}
                <label className="av-upload">
                    <span className="av-upload__icon"><FileText size={16} /></span>
                    <span className="av-upload__text">
                        {uploadedFile || 'Upload Resume (PDF / DOCX)'}
                    </span>
                    <input type="file" accept=".pdf,.docx,.doc,.txt" onChange={handleResumeUpload} hidden disabled={isProcessing} />
                </label>

                {/* File Library badge */}
                {fileLibrary.length > 0 && (
                    <div className="av-card av-filelib-badge" onClick={() => setActiveTab('profile')}>
                        <div className="av-filelib-badge__left">
                            <span className="av-filelib-badge__icon"><FolderOpen size={16} /></span>
                            <div>
                                <div className="av-filelib-badge__count">
                                    {fileLibrary.length} file{fileLibrary.length !== 1 ? 's' : ''} in library
                                </div>
                                <div className="av-filelib-badge__hint">Manage in My Profile →</div>
                            </div>
                        </div>
                        <span className="av-filelib-badge__arrow"><ChevronRight size={14} /></span>
                    </div>
                )}

                {/* Detection card */}
                <div className="av-card av-detection">
                    <div>
                        <div className="av-detection__eyebrow">Page Detection</div>
                        <div className={`av-detection__count ${fieldCount > 0 ? 'av-detection__count--active' : 'av-detection__count--empty'}`}>
                            {fieldCount}
                        </div>
                        <div className="av-detection__sub">
                            {fieldCount === 0 ? 'No fields found' : fieldCount === 1 ? 'form field' : 'form fields'}
                        </div>
                    </div>
                    <button className="av-detection__rescan" onClick={scanFields}>
                        <RefreshCw size={12} /> Rescan
                    </button>
                </div>

                {/* Fill button */}
                <button
                    className={`av-fill-btn ${fillDisabled ? 'av-fill-btn--disabled' : ''}`}
                    onClick={handleFill}
                    disabled={fillDisabled}
                >
                    {isProcessing ? (
                        <>
                            <span className="av-fill-btn__spinner" />
                            Filling…
                        </>
                    ) : (
                        <>
                            <span className="av-fill-btn__icon"><Sparkles size={14} /></span>
                            {fieldCount > 0
                                ? (matchingMode === 'heuristic'
                                    ? `Fill ${fieldCount} Fields (Keyword)`
                                    : `Fill ${fieldCount} Fields with AI`)
                                : 'No Fields Detected'}
                        </>
                    )}
                </button>

                {/* Status */}
                {fillStatus.message && (
                    <div className={`av-status av-status--${fillStatus.type}`}>
                        {fillStatus.message}
                    </div>
                )}

                {/* No API key warning (only relevant in AI mode) */}
                {matchingMode === 'ai' && !apiKey && (
                    <div className="av-api-warn" onClick={() => setActiveTab('settings')}>
                        <AlertTriangle size={14} /> No API key set. Click here to add your Gemini API key.
                    </div>
                )}

                {/* Shortcuts */}
                <div className="av-card av-shortcuts">
                    <div className="av-shortcuts__title">Shortcuts</div>
                    {[
                        { key: 'Alt+F', desc: 'Quick fill form' },
                        { key: 'Alt+A', desc: 'Toggle sidebar' },
                        { key: 'Ctrl+M', desc: 'Toggle sidebar' },
                    ].map(({ key, desc }) => (
                        <div key={key} className="av-shortcuts__item">
                            <code className="av-shortcuts__key">{key}</code>
                            <span className="av-shortcuts__desc">{desc}</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    /* ═══════════════════════════════════════
       PROFILE TAB
    ═══════════════════════════════════════ */
    const renderProfileTab = () => (
        <div className="av-profile-tab">

            {renderSectionHeader('Personal Information', 'personal')}
            {openSections.personal && (
                <div className="av-section__body">
                    <div className="av-row">
                        <div>
                            <label className="av-label">First Name</label>
                            <input className="av-input" name="firstName" value={userData.firstName || ''} onChange={handleInput} placeholder="Jane" />
                        </div>
                        <div>
                            <label className="av-label">Last Name</label>
                            <input className="av-input" name="lastName" value={userData.lastName || ''} onChange={handleInput} placeholder="Doe" />
                        </div>
                    </div>
                    <div>
                        <label className="av-label">Email</label>
                        <input className="av-input" name="email" type="email" value={userData.email || ''} onChange={handleInput} placeholder="jane@example.com" />
                    </div>
                    <div>
                        <label className="av-label">Phone</label>
                        <input className="av-input" name="phone" type="tel" value={userData.phone || ''} onChange={handleInput} placeholder="+1 555 000 0000" />
                    </div>
                    <div>
                        <label className="av-label">Headline</label>
                        <input className="av-input" name="headline" value={userData.headline || ''} onChange={handleInput} placeholder="e.g. Full-Stack Developer" />
                    </div>
                    <div>
                        <label className="av-label">Address</label>
                        <input className="av-input" name="address" value={userData.address || ''} onChange={handleInput} placeholder="Street address" />
                    </div>
                    <div className="av-row">
                        <div>
                            <label className="av-label">City</label>
                            <input className="av-input" name="city" value={userData.city || ''} onChange={handleInput} />
                        </div>
                        <div>
                            <label className="av-label">State</label>
                            <input className="av-input" name="state" value={userData.state || ''} onChange={handleInput} />
                        </div>
                    </div>
                    <div className="av-row">
                        <div>
                            <label className="av-label">ZIP</label>
                            <input className="av-input" name="zipCode" value={userData.zipCode || ''} onChange={handleInput} />
                        </div>
                        <div>
                            <label className="av-label">Country</label>
                            <input className="av-input" name="country" value={userData.country || ''} onChange={handleInput} />
                        </div>
                    </div>
                </div>
            )}

            {renderSectionHeader(`File Library (${fileLibrary.length})`, 'filelib')}
            {openSections.filelib && (
                <div className="av-section__body">
                    <div className="av-filelib__header">
                        <div className="av-filelib__hint">
                            Files are auto-matched to form inputs by filename keywords.
                        </div>
                        <button className="av-filelib__add-btn" onClick={() => fileLibInputRef.current?.click()}>
                            + Add
                        </button>
                        <input
                            ref={fileLibInputRef}
                            type="file"
                            multiple
                            style={{ display: 'none' }}
                            onChange={(e) => {
                                addFilesToLibrary(Array.from(e.target.files || []));
                                e.target.value = '';
                            }}
                        />
                    </div>

                    {/* Dropzone */}
                    <div
                        className={`av-filelib__dropzone ${fileDragging ? 'av-filelib__dropzone--dragging' : ''} ${fileLibrary.length === 0 ? 'av-filelib__dropzone--empty' : ''}`}
                        onDragOver={(e) => { e.preventDefault(); setFileDragging(true); }}
                        onDragLeave={() => setFileDragging(false)}
                        onDrop={(e) => { e.preventDefault(); setFileDragging(false); addFilesToLibrary(Array.from(e.dataTransfer.files)); }}
                    >
                        {fileLibrary.length === 0 ? (
                            <div className="av-filelib__empty">
                                <div className="av-filelib__empty-icon"><FolderOpen size={22} /></div>
                                <span>Drop files here or click <strong style={{ color: 'var(--av-violet)' }}>+ Add</strong></span>
                                <div className="av-filelib__empty-hint">
                                    e.g. <code className="av-filelib__empty-code">my_resume.pdf</code> → Resume Upload
                                </div>
                            </div>
                        ) : (
                            <div className="av-filelib__list">
                                {fileLibrary.map((sf) => {
                                    const matchedFields = pageFields.filter(f =>
                                        f.type === 'file' && fileMatchesField(f, sf)
                                    );
                                    return (
                                        <div key={sf.id} className="av-file-row">
                                            <span className="av-file-row__icon"><FileIcon type={sf.type} /></span>
                                            <div className="av-file-row__info">
                                                <div className="av-file-row__name">{sf.name}</div>
                                                <div className="av-file-row__meta">
                                                    {fileSizeStr(sf.size)} · {sf.savedAt}
                                                </div>
                                                {matchedFields.length > 0 && (
                                                    <div className="av-file-row__matches">
                                                        {matchedFields.map((mf, i) => (
                                                            <span key={i} className="av-file-row__match-tag">
                                                                <Check size={9} /> Matches: {mf.label || mf.context || mf.name || 'Field'}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <button className="av-file-row__remove" onClick={() => removeFromLibrary(sf.id)} title="Remove">
                                                <X size={14} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {renderSectionHeader('Links & URLs', 'links')}
            {openSections.links && (
                <div className="av-section__body">
                    <div>
                        <label className="av-label">LinkedIn</label>
                        <input className="av-input" name="linkedin" type="url" value={userData.linkedin || ''} onChange={handleInput} placeholder="linkedin.com/in/you" />
                    </div>
                    <div>
                        <label className="av-label">GitHub</label>
                        <input className="av-input" name="github" type="url" value={userData.github || ''} onChange={handleInput} placeholder="github.com/you" />
                    </div>
                    <div>
                        <label className="av-label">Portfolio</label>
                        <input className="av-input" name="portfolio" type="url" value={userData.portfolio || ''} onChange={handleInput} placeholder="yoursite.com" />
                    </div>
                </div>
            )}

            {renderSectionHeader('Skills & Summary', 'skills')}
            {openSections.skills && (
                <div className="av-section__body">
                    <div>
                        <label className="av-label">Skills (comma-separated)</label>
                        <textarea
                            className="av-input"
                            placeholder="React, TypeScript, Node.js…"
                            value={skillsInput !== null ? skillsInput : (userData.skills?.join(', ') || '')}
                            onChange={(e) => {
                                const val = e.target.value;
                                setSkillsInput(val);
                                setUserData(p => ({ ...p, skills: val.split(',').map(s => s.trim()).filter(Boolean) }));
                            }}
                            rows={3}
                        />
                    </div>
                    <div>
                        <label className="av-label">Summary</label>
                        <textarea
                            className="av-input"
                            name="summary" placeholder="Professional summary…"
                            value={userData.summary || ''} onChange={handleInput} rows={3}
                        />
                    </div>
                </div>
            )}

            {renderSectionHeader('Job Platform Fields', 'job')}
            {openSections.job && (
                <div className="av-section__body">
                    <div className="av-row">
                        <div>
                            <label className="av-label">Years of Exp.</label>
                            <input className="av-input" name="yearsOfExperience" value={userData.yearsOfExperience || ''} onChange={handleInput} placeholder="5" />
                        </div>
                        <div>
                            <label className="av-label">Salary Expect.</label>
                            <input className="av-input" name="salaryExpectation" value={userData.salaryExpectation || ''} onChange={handleInput} placeholder="e.g. $80k" />
                        </div>
                    </div>
                    <div className="av-row">
                        <div>
                            <label className="av-label">Notice Period</label>
                            <input className="av-input" name="noticePeriod" value={userData.noticePeriod || ''} onChange={handleInput} placeholder="2 weeks" />
                        </div>
                        <div>
                            <label className="av-label">Work Auth.</label>
                            <input className="av-input" name="workAuthorization" value={userData.workAuthorization || ''} onChange={handleInput} placeholder="Citizen" />
                        </div>
                    </div>
                    <div className="av-row">
                        <div>
                            <label className="av-label">Date of Birth</label>
                            <input className="av-input" name="dateOfBirth" type="date" value={userData.dateOfBirth || ''} onChange={handleInput} />
                        </div>
                        <div>
                            <label className="av-label">Gender</label>
                            <input className="av-input" name="gender" value={userData.gender || ''} onChange={handleInput} placeholder="e.g. Male" />
                        </div>
                    </div>
                </div>
            )}

            {renderSectionHeader(`Custom Fields (${customFields.length})`, 'custom')}
            {openSections.custom && (
                <div className="av-section__body">
                    {customFields.length === 0 && (
                        <p className="av-cf-empty">
                            No custom fields yet. Add one below so the AI knows what to fill.
                        </p>
                    )}
                    {customFields.map((cf, i) => (
                        <div key={i} className="av-cf-card">
                            <div>
                                <div className="av-cf-card__label">{cf.label}</div>
                                <div className="av-cf-card__value">{cf.value || '—'}</div>
                                {cf.context && (
                                    <div className="av-cf-card__context">
                                        <MapPin size={11} /> {cf.context}
                                    </div>
                                )}
                            </div>
                            <button className="av-cf-card__remove" onClick={() => removeCustomField(i)}>×</button>
                        </div>
                    ))}
                    <div className="av-cf-form">
                        <div className="av-cf-form__row">
                            <input
                                className="av-input av-input--flex"
                                placeholder="Label (e.g. Pronouns)"
                                value={newCFLabel}
                                onChange={e => setNewCFLabel(e.target.value)}
                            />
                            <input
                                className="av-input av-input--flex"
                                placeholder="Value (e.g. He/Him)"
                                value={newCFValue}
                                onChange={e => setNewCFValue(e.target.value)}
                            />
                            <button className="av-cf-form__add-btn" onClick={addCustomField}>+</button>
                        </div>
                        <input
                            className="av-input"
                            placeholder="AI Context (e.g. Use when asked about preferred pronouns)"
                            value={newCFContext}
                            onChange={e => setNewCFContext(e.target.value)}
                        />
                    </div>
                </div>
            )}

            <button className="av-save-btn" onClick={handleSave}>
                <Save size={14} /> {saveMsg || 'Save Profile'}
            </button>
        </div>
    );

    /* ═══════════════════════════════════════
       KNOWLEDGE BASE TAB
    ═══════════════════════════════════════ */
    const renderKnowledgeTab = () => {
        const memories = (userData.memories as Memory[]) || [];
        return (
            <div className="av-profile-tab">
                <div className="av-settings__how-card" style={{marginBottom: 10}}>
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
                
                <div className="av-cf-form" style={{marginTop: 10}}>
                    <input className="av-input" placeholder="Title (e.g. Late Policy)" value={newMemTitle} onChange={e => setNewMemTitle(e.target.value)} />
                    <textarea className="av-input" placeholder="Content/Response text..." rows={3} value={newMemContent} onChange={e => setNewMemContent(e.target.value)} />
                    <button className="av-save-btn" style={{marginTop: 5}} onClick={addMemory}>+ Add Memory</button>
                </div>
                
                <button className="av-save-btn" style={{marginTop: 15}} onClick={handleSave}>
                    <Save size={14} /> {saveMsg || 'Save Changes'}
                </button>
            </div>
        );
    };

    /* ═══════════════════════════════════════
       LINKS TAB
    ═══════════════════════════════════════ */
    const renderLinksTab = () => {
        const links = (userData.savedLinks as SavedLink[]) || [];
        return (
            <div className="av-profile-tab">
                <div className="av-settings__how-card" style={{marginBottom: 10}}>
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
                                <div className="av-cf-card__context" style={{color: 'var(--av-violet)'}}>{l.url}</div>
                            </div>
                            <button className="av-cf-card__remove" onClick={() => removeLink(l.id)}>×</button>
                        </div>
                        <button className="av-save-btn" style={{marginTop: 10, background: 'var(--av-surface)'}} onClick={() => triggerAutopilot(l.url)}>
                            <Sparkles size={12}/> Open & Autofill
                        </button>
                    </div>
                ))}
                
                <div className="av-cf-form" style={{marginTop: 10}}>
                    <input className="av-input" placeholder="Title (e.g. Daily Check-in)" value={newLinkTitle} onChange={e => setNewLinkTitle(e.target.value)} />
                    <input className="av-input" type="url" placeholder="https://example.com/form" value={newLinkUrl} onChange={e => setNewLinkUrl(e.target.value)} />
                    <button className="av-save-btn" style={{marginTop: 5}} onClick={addLink}>+ Add Link</button>
                </div>
                
                <button className="av-save-btn" style={{marginTop: 15}} onClick={handleSave}>
                    <Save size={14} /> {saveMsg || 'Save Changes'}
                </button>
            </div>
        );
    };

    /* ═══════════════════════════════════════
       SETTINGS TAB
    ═══════════════════════════════════════ */
    const renderSettingsTab = () => (
        <div className="av-settings">
            <div>
                <div className="av-settings__title">Gemini API Key</div>
                <p className="av-settings__desc">
                    Your key is stored locally and never sent to any server. Get yours free at{' '}
                    <span
                        className="av-settings__link"
                        onClick={() => window.open('https://aistudio.google.com/app/apikey', '_blank')}
                    >
                        aistudio.google.com
                    </span>.
                </p>
                <label className="av-label">API Key</label>
                <input
                    className="av-input"
                    type="password"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder="AIza…"
                />
                <button className="av-settings__save-btn" onClick={handleSaveApiKey}>
                    {saveMsg || 'Save API Key'}
                </button>
            </div>

            <div className="av-divider" />

            <div className="av-settings__privacy-card">
                <ShieldCheck size={16} />
                <div><strong>Privacy-first</strong> — Gemini only sees form field labels, never the data you type into fields.</div>
            </div>

            <div className="av-settings__how-card">
                <div className="av-settings__how-title">How it works</div>
                <p>
                    Aullevo scans the current page for form inputs, sends only the field labels to Gemini,
                    gets back suggested values from your saved profile, then fills the form — all locally.
                </p>
            </div>

            {/* Dark mode toggle */}
            <div className="av-toggle-row">
                <div>
                    <div className="av-toggle-row__label">Appearance</div>
                    <div className="av-toggle-row__hint">{isDark ? 'Dark mode' : 'Light mode'}</div>
                </div>
                <button className={`av-toggle ${isDark ? 'av-toggle--active' : ''}`} onClick={() => setIsDark(d => !d)}>
                    <span className="av-toggle__thumb">
                        {isDark ? <Moon size={10} /> : <Sun size={10} />}
                    </span>
                </button>
            </div>

            {/* Matching Mode toggle */}
            <div className="av-toggle-row">
                <div>
                    <div className="av-toggle-row__label">Form Matching Mode</div>
                    <div className="av-toggle-row__hint">
                        {matchingMode === 'heuristic'
                            ? 'Keyword Match (Fast & Free)'
                            : 'Gemini AI (Smart)'}
                    </div>
                </div>
                <button
                    className={`av-toggle ${matchingMode === 'heuristic' ? 'av-toggle--active' : ''}`}
                    onClick={() => {
                        const newMode = matchingMode === 'heuristic' ? 'ai' : 'heuristic';
                        setMatchingMode(newMode);
                        if (typeof chrome !== 'undefined' && chrome?.storage) {
                            chrome.storage.local.set({ matchingMode: newMode });
                        }
                    }}
                >
                    <span className="av-toggle__thumb">
                        {matchingMode === 'heuristic' ? <Check size={10} /> : <Sparkles size={10} />}
                    </span>
                </button>
            </div>
        </div>
    );

    /* ═══════════════════════════════════════
       RENDER
    ═══════════════════════════════════════ */
    return (
        <div className={isDark ? 'av-dark' : ''}>
            {/* Trigger pill */}
            <div
                className={`av-trigger ${isOpen ? 'av-trigger--open' : 'av-trigger--closed'}`}
                onClick={() => setIsOpen(p => !p)}
                title="Aullevo — Ctrl+M or Alt+A"
            >
                <span className="av-trigger__stripe" />
                <span className="av-trigger__label">Aullevo</span>
                {fieldCount > 0 && (
                    <span className="av-trigger__badge">{fieldCount}</span>
                )}
            </div>

            {/* Panel */}
            {isOpen && (
                <div className="av-panel">
                    {/* Header */}
                    <div className="av-panel__header">
                        <div className="av-panel__brand">
                            <div className="av-panel__logo">
                                <Sparkles size={15} />
                            </div>
                            <div>
                                <div className="av-panel__brand-name">Aullevo</div>
                                <div className="av-panel__brand-sub">AI Form Filler</div>
                            </div>
                        </div>
                        <button className="av-panel__close" onClick={() => setIsOpen(false)} title="Close">
                            <X size={18} />
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="av-panel__tabs">
                        {([
                            { id: 'fill', label: 'Fill Form' },
                            { id: 'profile', label: 'My Profile' },
                            { id: 'knowledge', label: 'Memories' },
                            { id: 'links', label: 'Links' },
                            { id: 'settings', label: 'Settings' },
                        ] as { id: Tab; label: string }[]).map(t => (
                            <button
                                key={t.id}
                                className={`av-panel__tab ${activeTab === t.id ? 'av-panel__tab--active' : ''}`}
                                onClick={() => setActiveTab(t.id)}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>

                    {/* Body */}
                    <div className="av-panel__body">
                        {activeTab === 'fill' && renderFillTab()}
                        {activeTab === 'profile' && renderProfileTab()}
                        {activeTab === 'knowledge' && renderKnowledgeTab()}
                        {activeTab === 'links' && renderLinksTab()}
                        {activeTab === 'settings' && renderSettingsTab()}
                    </div>

                    {/* Footer */}
                    <div className="av-panel__footer">
                        <span className="av-panel__footer-text">Powered by Gemini 2.5 Flash</span>
                        <span className="av-panel__footer-text">Ctrl+M to toggle</span>
                    </div>
                </div>
            )}
        </div>
    );
}