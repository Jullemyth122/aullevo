import { useState, useEffect, type ChangeEvent } from 'react';
import { Save, Sparkles, Loader2, ChevronDown, Plus, Trash2, User, Link, Briefcase, PenTool, Database, Zap, ShieldAlert, FileText, CheckCircle2, X, UploadCloud } from 'lucide-react';
import { geminiService } from '../services/geminiService';
import { resumeParser } from '../services/resumeParser';
import { storageService } from '../services/storageService';
import type { UserData, CustomField, Status, ChromeResponse, Memory, SavedLink } from '../types';
import './Popup.css';
import { LogoA } from '../components/LogoA';

import { migrateCustomFields } from '../types';

/* ─── collapsible section component ─── */

interface SectionProps {
    icon: React.ReactNode;
    title: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
}

function Section({ icon, title, defaultOpen = true, children }: SectionProps) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="section-group">
            <div className="section-header" onClick={() => setOpen(!open)}>
                <div className="section-header-left">
                    <span className="section-icon">{icon}</span>
                    <span className="section-title">{title}</span>
                </div>
                <span className={`section-chevron ${open ? 'open' : ''}`}>
                    <ChevronDown size={14} />
                </span>
            </div>
            {open && <div className="section-body">{children}</div>}
        </div>
    );
}

/* ─── floating-label field helper ─── */

interface FieldProps {
    label: string;
    name: string;
    value: string;
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    type?: string;
    placeholder?: string;
    textarea?: boolean;
    rows?: number;
}

function Field({ label, name, value, onChange, type = 'text', placeholder, textarea, rows }: FieldProps) {
    return (
        <div className="field-wrapper">
            {textarea ? (
                <textarea
                    name={name}
                    placeholder={placeholder || label}
                    value={value}
                    onChange={onChange}
                    rows={rows || 3}
                />
            ) : (
                <input
                    type={type}
                    name={name}
                    placeholder={placeholder || label}
                    value={value}
                    onChange={onChange}
                />
            )}
            <span className="field-label">{label}</span>
        </div>
    );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   POPUP MAIN COMPONENT
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function Popup() {
    const [userData, setUserData] = useState<Partial<UserData>>({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        address: '',
        city: '',
        state: '',
        zipCode: '',
        country: '',
        linkedin: '',
        portfolio: '',
        github: '',
        skills: [],
        summary: '',
        experience: [],
        education: [],
        // Extended fields
        headline: '',
        dateOfBirth: '',
        gender: '',
        salaryExpectation: '',
        noticePeriod: '',
        workAuthorization: '',
        yearsOfExperience: '',
        customFields: []
    });

    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [status, setStatus] = useState<Status>({ message: '', type: '' });
    const [uploadedFileName, setUploadedFileName] = useState<string>('');
    const [pendingFile, setPendingFile] = useState<File | null>(null);
    const [resumeConsent, setResumeConsent] = useState(false);
    const [resumeParseSuccess, setResumeParseSuccess] = useState(false);

    const [apiKey, setApiKey] = useState<string>('');
    const [isPro, setIsPro] = useState<boolean>(false);
    const [showSettings, setShowSettings] = useState<boolean>(false);

    // Custom field add form
    const [newCFLabel, setNewCFLabel] = useState('');
    const [newCFValue, setNewCFValue] = useState('');
    const [newCFContext, setNewCFContext] = useState('');

    const [newMemTitle, setNewMemTitle] = useState('');
    const [newMemContent, setNewMemContent] = useState('');
    const [newLinkTitle, setNewLinkTitle] = useState('');
    const [newLinkUrl, setNewLinkUrl] = useState('');
    const [newLinkAutoFill, setNewLinkAutoFill] = useState(true);

    const customFields = (userData.customFields as CustomField[]) || [];
    const memories = (userData.memories as Memory[]) || [];
    const savedLinks = (userData.savedLinks as SavedLink[]) || [];

    useEffect(() => {
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            chrome.storage.local.get(['userData', 'geminiApiKey', 'isPro'], (result) => {
                if (result?.userData) {
                    const loaded = result.userData as UserData;
                    // Migrate old customFields format
                    loaded.customFields = migrateCustomFields(loaded.customFields);
                    setUserData(loaded as Partial<UserData>);
                }
                if (result?.geminiApiKey) {
                    setApiKey(result.geminiApiKey as string);
                }
                if (result?.isPro !== undefined) {
                    setIsPro(!!result.isPro);
                }
            });

            // Listen to live changes to local storage (e.g. options page sign-in)
            const storageListener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
                if (areaName === 'local' && changes.isPro !== undefined) {
                    setIsPro(!!changes.isPro.newValue);
                }
            };
            chrome.storage.onChanged.addListener(storageListener);
            return () => {
                chrome.storage.onChanged.removeListener(storageListener);
            };
        }
    }, []);

    /* ── Custom Fields CRUD ── */

    const addCustomField = () => {
        if (!newCFLabel.trim()) return;
        const updated = [...customFields, { label: newCFLabel.trim(), value: newCFValue.trim(), context: newCFContext.trim() }];
        setUserData({ ...userData, customFields: updated });
        setNewCFLabel('');
        setNewCFValue('');
        setNewCFContext('');
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            chrome.storage.local.set({ userData: { ...userData, customFields: updated } });
        }
    };

    const removeCustomField = (index: number) => {
        const updated = customFields.filter((_, i) => i !== index);
        setUserData({ ...userData, customFields: updated });
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            chrome.storage.local.set({ userData: { ...userData, customFields: updated } });
        }
    };

    /* ── Memories CRUD ── */
    const addMemory = () => {
        if (!isPro && memories.length >= 2) {
            setStatus({ message: '🔒 Memories are limited to 2 on the Free tier. Please upgrade to Pro!', type: 'error' });
            return;
        }
        if (!newMemTitle.trim() || !newMemContent.trim()) return;
        const newMem: Memory = { id: `mem_${Date.now()}`, title: newMemTitle.trim(), content: newMemContent.trim(), createdAt: new Date().toISOString() };
        const updated = [...memories, newMem];
        setUserData({ ...userData, memories: updated });
        setNewMemTitle(''); setNewMemContent('');
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            chrome.storage.local.set({ userData: { ...userData, memories: updated } });
        }
    };

    const removeMemory = (id: string) => {
        const updated = memories.filter(m => m.id !== id);
        setUserData({ ...userData, memories: updated });
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            chrome.storage.local.set({ userData: { ...userData, memories: updated } });
        }
    };

    /* ── Links CRUD ── */
    const addLink = () => {
        if (!isPro && savedLinks.length >= 2) {
            setStatus({ message: '🔒 Links are limited to 2 on the Free tier. Please upgrade to Pro!', type: 'error' });
            return;
        }
        if (!newLinkTitle.trim() || !newLinkUrl.trim()) return;
        const newLink: SavedLink = { id: `link_${Date.now()}`, title: newLinkTitle.trim(), url: newLinkUrl.trim(), autoFill: newLinkAutoFill, createdAt: new Date().toISOString() };
        const updated = [...savedLinks, newLink];
        setUserData({ ...userData, savedLinks: updated });
        setNewLinkTitle(''); setNewLinkUrl(''); setNewLinkAutoFill(true);
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            chrome.storage.local.set({ userData: { ...userData, savedLinks: updated } });
        }
    };

    const removeLink = (id: string) => {
        const updated = savedLinks.filter(l => l.id !== id);
        setUserData({ ...userData, savedLinks: updated });
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            chrome.storage.local.set({ userData: { ...userData, savedLinks: updated } });
        }
    };

    const triggerAutopilot = (url: string) => {
        if (typeof chrome !== 'undefined' && chrome?.tabs) {
            chrome.tabs.create({ url }, (tab) => {
                if (tab.id) {
                    chrome.runtime.sendMessage({ action: 'openAutopilotLink', url, tabId: tab.id });
                }
            });
        }
    };

    /* ── Resume Upload Handlers ── */

    const handleSelectFile = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setPendingFile(file);
        setResumeConsent(false);
        setResumeParseSuccess(false);
        e.target.value = '';
    };

    const handleCancelFile = () => {
        setPendingFile(null);
        setResumeConsent(false);
    };

    const dismissParseSuccess = () => {
        setResumeParseSuccess(false);
    };

    const handleConfirmFile = async () => {
        if (!pendingFile) return;
        const file = pendingFile;
        setUploadedFileName(file.name);
        setIsProcessing(true);
        setStatus({ message: 'Extracting text and parsing with Gemini AI...', type: 'info' });

        try {
            const metaEnv = (import.meta as unknown as { env?: { VITE_GEMINI_API_KEY?: string } }).env;
            if (!apiKey && !metaEnv?.VITE_GEMINI_API_KEY) {
                throw new Error("Please set your Gemini API Key in Settings first.");
            }

            if (apiKey) {
                geminiService.setApiKey(apiKey);
            }

            const resumeText = await resumeParser.parseFile(file);
            const parsedData = await geminiService.parseResume(resumeText);

            const newData = { ...userData, ...parsedData };
            newData.customFields = userData.customFields || [];
            setUserData(newData);

            setPendingFile(null);
            setResumeParseSuccess(true);
            setStatus({ message: 'Resume parsed successfully! Review your fields below.', type: 'success' });

            if (typeof chrome !== 'undefined' && chrome?.storage) {
                chrome.storage.local.set({ userData: newData });
            }
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(error);
            setStatus({ message: msg || 'Error parsing resume', type: 'error' });
        } finally {
            setIsProcessing(false);
        }
    };

    /* ── Generic Input Handler ── */

    const handleInputChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setUserData({ ...userData, [name]: value });
    };

    /* ── Save ── */

    const handleSave = async () => {
        try {
            const activeName = await storageService.getActiveProfileName();
            await storageService.saveProfile(activeName, userData as UserData);
        } catch (e) {
            console.warn('storageService save fallback:', e);
        }
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            chrome.storage.local.set({ userData }, () => {
                setStatus({ message: '💾 Data saved!', type: 'success' });
                setTimeout(() => setStatus({ message: '', type: '' }), 2000);
            });
        } else {
            setStatus({ message: '💾 Data saved! (mocked in dev preview)', type: 'success' });
            setTimeout(() => setStatus({ message: '', type: '' }), 2000);
        }
    };

    /* ── AI Form Filler ── */

    const processFormStep = async (tabId: number, step: number) => {
        if (step > 15) {
            setStatus({ message: '🛑 Max steps reached (safety limit).', type: 'info' });
            setIsProcessing(false);
            return;
        }

        setStatus({ message: `Step ${step + 1}: Analyzing...`, type: 'info' });

        try {
            const response = await sendMessagePromise(tabId, { action: 'analyzeForm' });

            if (!response?.success) {
                setStatus({ message: '❌ Analysis failed or no form found.', type: 'error' });
                setIsProcessing(false);
                return;
            }

            const fields = response.fields || [];
            let needsReAnalysis = false;

            if (fields.length > 0) {
                // Send full custom field objects for rich AI matching
                const customFields = (userData.customFields as CustomField[]) || [];
                const fieldMappings = await geminiService.analyzeFormFields(fields, customFields);

                for (const mapping of fieldMappings) {
                    if (mapping.fieldType === 'custom_question' && mapping.originalQuestion) {
                        setStatus({ message: `🤔 Thinking: "${mapping.originalQuestion}"...`, type: 'info' });
                        const answer = await geminiService.answerFormQuestion(mapping.originalQuestion, userData);
                        mapping.selectedValue = answer;
                    }

                    // Resolve custom_field:LABEL from our array
                    if (mapping.fieldType?.startsWith('custom_field:')) {
                        const label = mapping.fieldType.slice('custom_field:'.length);
                        const match = customFields.find(cf => cf.label === label);
                        if (match) mapping.selectedValue = match.value;
                    }

                    // Handle Array Mapping
                    if (mapping.groupType && typeof mapping.groupIndex === 'number' && mapping.action !== 'click_add') {
                        let arraySource: unknown[] = [];
                        if (mapping.groupType === 'experience') arraySource = userData.experience || [];
                        if (mapping.groupType === 'education') arraySource = userData.education || [];
                        if (mapping.groupType === 'project') arraySource = userData.portfolio ? JSON.parse(JSON.stringify(userData.portfolio)) : [];
                        if (mapping.groupType === 'skill') arraySource = userData.skills || [];

                        const item = arraySource[mapping.groupIndex];
                        if (item) {
                            if (typeof item === 'object' && item !== null) {
                                const rec = item as Record<string, unknown>;
                                if (mapping.fieldType in rec) {
                                    mapping.selectedValue = String(rec[mapping.fieldType] ?? '');
                                }
                            } else if (mapping.groupType === 'skill') {
                                mapping.selectedValue = String(item);
                            }
                        }
                    }
                }

                const fillMappings = fieldMappings.filter(m => m.action !== 'click_add');
                const fillResponse = await sendMessagePromise(tabId, {
                    action: 'fillForm',
                    data: { fieldMappings: fillMappings, userData }
                });

                if (fillResponse?.success) {
                    setStatus({
                        message: `✅ Step ${step + 1}: Filled ${fillResponse.filledCount} fields.`,
                        type: 'success'
                    });
                }

                // Handle "Add" Buttons
                const addButtons = fieldMappings.filter(m => m.action === 'click_add');
                for (const btn of addButtons) {
                    if (!btn.groupType) continue;

                    const currentIndices = fieldMappings
                        .filter(m => m.groupType === btn.groupType && typeof m.groupIndex === 'number')
                        .map(m => m.groupIndex!);

                    const maxIndex = currentIndices.length > 0 ? Math.max(...currentIndices) : -1;

                    let totalDataItems = 0;
                    if (btn.groupType === 'experience') totalDataItems = (userData.experience || []).length;
                    if (btn.groupType === 'education') totalDataItems = (userData.education || []).length;

                    if (totalDataItems > maxIndex + 1) {
                        setStatus({ message: `➕ Adding another ${btn.groupType}...`, type: 'info' });
                        await sendMessagePromise(tabId, {
                            action: 'fillForm',
                            data: { fieldMappings: [{ ...btn }] }
                        });

                        await new Promise(r => setTimeout(r, 1500));
                        needsReAnalysis = true;
                        break;
                    }
                }
            }

            if (needsReAnalysis) {
                setTimeout(() => processFormStep(tabId, step + 1), 500);
                return;
            }

            await new Promise(r => setTimeout(r, 1000));

            const nextResponse = await sendMessagePromise(tabId, { action: 'clickNext' });

            if (nextResponse?.success) {
                setStatus({ message: `➡️ Moving to next step...`, type: 'info' });
                setTimeout(() => processFormStep(tabId, step + 1), 3000);
            } else {
                setIsProcessing(false);
                setStatus({ message: '✨ Form filling complete!', type: 'success' });
            }
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(error);
            setStatus({ message: `❌ Error: ${msg}`, type: 'error' });
            setIsProcessing(false);
        }
    };

    const sendMessagePromise = (tabId: number, message: unknown): Promise<ChromeResponse> => {
        return new Promise((resolve) => {
            chrome.tabs.sendMessage(tabId, message, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn('Aullevo popup notice:', chrome.runtime.lastError.message);
                    resolve({ success: false, message: chrome.runtime.lastError.message });
                } else {
                    resolve(response);
                }
            });
        });
    };

    const handleAIFillForm = async () => {
        if (!isPro) {
            setStatus({ message: '🔒 Gemini AI matching is a Pro feature. Please upgrade!', type: 'error' });
            return;
        }

        const hasBasicData = Boolean(
            userData.firstName || userData.lastName || userData.email || userData.phone ||
            (userData.experience && userData.experience.length > 0) ||
            (userData.education && userData.education.length > 0) ||
            (userData.customFields && userData.customFields.length > 0) ||
            (userData.memories && userData.memories.length > 0)
        );
        if (!hasBasicData) {
            setStatus({ message: '⚠️ Your profile is empty! Please fill in your basic info or upload a resume first.', type: 'error' });
            return;
        }

        setIsProcessing(true);
        setStatus({ message: '🤖 Starting AI Form Filler...', type: 'info' });

        if (typeof chrome === 'undefined' || !chrome.tabs) {
            setStatus({ message: '⚠️ Form filling only works in real extension', type: 'error' });
            setIsProcessing(false);
            return;
        }

        try {
            const metaEnv = (import.meta as unknown as { env?: { VITE_GEMINI_API_KEY?: string } }).env;
            if (!apiKey && !metaEnv?.VITE_GEMINI_API_KEY) {
                throw new Error("Please set your Gemini API Key in Settings first.");
            }

            if (apiKey) geminiService.setApiKey(apiKey);

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab.id) throw new Error("No active tab found");

            processFormStep(tab.id, 0);
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(error);
            setStatus({ message: `❌ ${msg || 'Error filling form'}`, type: 'error' });
            setIsProcessing(false);
        }
    };

    const saveApiKey = () => {
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            chrome.storage.local.set({ geminiApiKey: apiKey.trim() }, () => {
                setStatus({ message: '🔑 API Key saved!', type: 'success' });
                setTimeout(() => setStatus({ message: '', type: '' }), 2000);
            });
        }
    };

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       RENDER
       ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    return (
        <div className="popup-container">
            <header className="header">
                <h1 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <LogoA size={22} />
                    <span>Aullevo</span>
                </h1>
                <button
                    className="settings-btn"
                    onClick={() => setShowSettings(!showSettings)}
                    title="Settings"
                >
                    ⚙️
                </button>
            </header>

            {showSettings ? (
                <div className="settings-section">
                    <h3>Settings</h3>
                    <div className="input-group">
                        <label>Gemini API Key</label>
                        <input
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="Enter Gemini API Key"
                        />
                        <button onClick={saveApiKey} className="save-btn small">Save Key</button>
                    </div>
                </div>
            ) : (
                <>
                    <p className="tagline">AI-Powered Form Filler by Gemini</p>

                    {/* First-time Onboarding Banner */}
                    {!userData.firstName && !userData.email && (
                        <div style={{
                            margin: '10px 0 14px 0',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            background: 'rgba(99, 102, 241, 0.12)',
                            border: '1px solid rgba(99, 102, 241, 0.3)',
                            fontSize: '12px',
                            lineHeight: '1.45',
                            color: '#c7d2fe',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            <Sparkles size={16} style={{ color: '#818cf8', flexShrink: 0 }} />
                            <span><strong>First time using Aullevo?</strong> Fill in your basic information below or upload your resume above to start auto-filling forms!</span>
                        </div>
                    )}

                    {/* AI Parsing File Upload with Privacy Warning & Staged Confirmation */}
                    <div className="ai-parse-box">
                        <div className="ai-parse-box-header">
                            <span className="ai-parse-badge">
                                <Sparkles size={10} /> AI Parser
                            </span>
                            <span className="ai-parse-title">AI Parsing File Upload</span>
                        </div>
                        <p className="ai-parse-desc">
                            Auto-extract details into profile fields using Gemini AI.
                        </p>

                        {pendingFile ? (
                            /* Staged Confirmation Checker */
                            <div className="popup-staged-box">
                                <div className="popup-staged-file">
                                    <FileText size={14} style={{ color: 'var(--accent-secondary)' }} />
                                    <span>{pendingFile.name} ({(pendingFile.size / 1024).toFixed(1)} KB)</span>
                                </div>

                                <label className="popup-confirm-check">
                                    <input
                                        type="checkbox"
                                        checked={resumeConsent}
                                        onChange={e => setResumeConsent(e.target.checked)}
                                        disabled={isProcessing}
                                    />
                                    <span>I confirm this is my document and authorize AI text extraction.</span>
                                </label>

                                <div className="popup-disclaimer">
                                    <ShieldAlert size={12} style={{ color: '#F59E0B', flexShrink: 0, marginTop: 1 }} />
                                    <span>
                                        <strong>Caution:</strong> Text is processed via your Gemini API key. Aullevo operates client-side and is not liable for document content or AI outputs. Always verify extracted fields.
                                    </span>
                                </div>

                                <div className="popup-staged-actions">
                                    <button
                                        type="button"
                                        className="popup-btn popup-btn-primary"
                                        disabled={!resumeConsent || isProcessing}
                                        onClick={handleConfirmFile}
                                    >
                                        {isProcessing ? (
                                            <>
                                                <Loader2 size={12} className="spinning" />
                                                Processing…
                                            </>
                                        ) : (
                                            <>
                                                <Sparkles size={12} />
                                                Confirm &amp; Process
                                            </>
                                        )}
                                    </button>
                                    <button
                                        type="button"
                                        className="popup-btn popup-btn-sec"
                                        onClick={handleCancelFile}
                                        disabled={isProcessing}
                                    >
                                        <X size={12} />
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            /* Initial Upload Button */
                            <>
                                <label className="upload-btn">
                                    <UploadCloud size={14} />
                                    {uploadedFileName ? uploadedFileName : 'Upload Resume / Document (PDF/DOCX)'}
                                    <input
                                        type="file"
                                        accept=".pdf,.docx,.doc,.txt"
                                        onChange={handleSelectFile}
                                        disabled={isProcessing}
                                        hidden
                                    />
                                </label>
                                <div className="ai-privacy-notice">
                                    <ShieldAlert size={13} className="ai-privacy-icon" />
                                    <span>
                                        <strong>Notice:</strong> Document text is sent to Gemini AI to extract profile data. Use only for non-sensitive data.
                                    </span>
                                </div>
                            </>
                        )}

                        {resumeParseSuccess && (
                            <div className="popup-success-banner">
                                <CheckCircle2 size={14} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} />
                                <div style={{ flex: 1 }}>
                                    <strong style={{ color: 'var(--success)', display: 'block', marginBottom: 2 }}>Parsing Complete</strong>
                                    <span>Please verify all extracted fields below before auto-filling forms.</span>
                                </div>
                                <button type="button" onClick={dismissParseSuccess} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>
                                    <X size={12} />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ── SECTION: Personal Info ── */}
                    <Section icon={<User size={14} />} title="Personal Information" defaultOpen={true}>
                        <div className="form-row">
                            <Field label="First Name" name="firstName" value={userData.firstName || ''} onChange={handleInputChange} />
                            <Field label="Middle Name" name="middleName" value={userData.middleName || ''} onChange={handleInputChange} placeholder="Optional" />
                            <Field label="Last Name" name="lastName" value={userData.lastName || ''} onChange={handleInputChange} />
                        </div>
                        <Field label="Email" name="email" value={userData.email || ''} onChange={handleInputChange} type="email" />
                        <Field label="Phone" name="phone" value={userData.phone || ''} onChange={handleInputChange} type="tel" />
                        <Field label="Headline" name="headline" value={userData.headline || ''} onChange={handleInputChange} placeholder="e.g. Full-Stack Developer" />
                        <Field label="Address" name="address" value={userData.address || ''} onChange={handleInputChange} />
                        <div className="form-row">
                            <Field label="City" name="city" value={userData.city || ''} onChange={handleInputChange} />
                            <Field label="State" name="state" value={userData.state || ''} onChange={handleInputChange} />
                        </div>
                        <div className="form-row">
                            <Field label="ZIP Code" name="zipCode" value={userData.zipCode || ''} onChange={handleInputChange} />
                            <Field label="Country" name="country" value={userData.country || ''} onChange={handleInputChange} />
                        </div>
                    </Section>

                    {/* ── SECTION: Links ── */}
                    <Section icon={<Link size={14} />} title="Links & URLs" defaultOpen={false}>
                        <Field label="LinkedIn" name="linkedin" value={userData.linkedin || ''} onChange={handleInputChange} type="url" />
                        <Field label="GitHub" name="github" value={userData.github || ''} onChange={handleInputChange} type="url" />
                        <Field label="Portfolio" name="portfolio" value={userData.portfolio || ''} onChange={handleInputChange} type="url" />
                    </Section>

                    {/* ── SECTION: Skills & Summary ── */}
                    <Section icon={<PenTool size={14} />} title="Skills & Summary" defaultOpen={false}>
                        <div className="input-group">
                            <label>Skills (comma-separated)</label>
                            <textarea
                                placeholder="React, TypeScript, Node.js, Python..."
                                value={userData.skills?.join(', ') || ''}
                                onChange={(e) => {
                                    const vals = e.target.value.split(',').map(s => s.trim()).filter(s => s);
                                    setUserData(prev => ({ ...prev, skills: vals }));
                                }}
                                rows={3}
                            />
                        </div>
                        <Field
                            label="Summary"
                            name="summary"
                            value={userData.summary || ''}
                            onChange={handleInputChange}
                            textarea
                            rows={3}
                            placeholder="Professional summary..."
                        />
                    </Section>

                    {/* ── SECTION: Extended Fields ── */}
                    <Section icon={<Briefcase size={14} />} title="Job Platform Fields" defaultOpen={false}>
                        <div className="extended-fields-grid">
                            <Field label="Years of Exp." name="yearsOfExperience" value={userData.yearsOfExperience || ''} onChange={handleInputChange} />
                            <Field label="Salary Expect." name="salaryExpectation" value={userData.salaryExpectation || ''} onChange={handleInputChange} />
                        </div>
                        <div className="extended-fields-grid">
                            <Field label="Notice Period" name="noticePeriod" value={userData.noticePeriod || ''} onChange={handleInputChange} />
                            <Field label="Work Auth." name="workAuthorization" value={userData.workAuthorization || ''} onChange={handleInputChange} />
                        </div>
                        <div className="extended-fields-grid">
                            <Field label="Date of Birth" name="dateOfBirth" value={userData.dateOfBirth || ''} onChange={handleInputChange} />
                            <Field label="Gender" name="gender" value={userData.gender || ''} onChange={handleInputChange} />
                        </div>
                    </Section>

                    {/* ── SECTION: Custom Fields ── */}
                    <Section icon={<Plus size={14} />} title={`Custom Fields (${customFields.length})`} defaultOpen={true}>
                        <div className="custom-fields-list">
                            {customFields.length === 0 && (
                                <p className="no-custom-fields">
                                    No custom fields yet. Add labels below so the AI knows where to use them.
                                </p>
                            )}
                            {customFields.map((cf, i) => (
                                <div key={`${cf.label}-${i}`} className="custom-field-item">
                                    <div className="custom-field-info">
                                        <div className="custom-field-label">{cf.label}</div>
                                        <div className="custom-field-value">{cf.value || '<empty>'}</div>
                                        {cf.context && (
                                            <div className="custom-field-context">📍 {cf.context}</div>
                                        )}
                                    </div>
                                    <button
                                        className="icon-btn delete"
                                        onClick={() => removeCustomField(i)}
                                        title="Delete"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>

                        <div className="add-custom-field">
                            <div className="add-custom-field-row">
                                <input
                                    type="text"
                                    placeholder="Label (e.g. Pronouns)"
                                    value={newCFLabel}
                                    onChange={(e) => setNewCFLabel(e.target.value)}
                                />
                                <input
                                    type="text"
                                    placeholder="Value (e.g. He/Him)"
                                    value={newCFValue}
                                    onChange={(e) => setNewCFValue(e.target.value)}
                                />
                                <button className="icon-btn add" onClick={addCustomField} title="Add custom field">
                                    <Plus size={16} />
                                </button>
                            </div>
                            <input
                                type="text"
                                className="context-input"
                                placeholder="AI Context (e.g. Use when asked about preferred pronouns)"
                                value={newCFContext}
                                onChange={(e) => setNewCFContext(e.target.value)}
                            />
                        </div>
                    </Section>

                    {/* ── SECTION: Knowledge Base ── */}
                    <Section icon={<Database size={14} />} title={`Knowledge Base (${((userData.memories as Memory[]) || []).length})`} defaultOpen={false}>
                        <div className="custom-fields-list">
                            {((userData.memories as Memory[]) || []).length === 0 && (
                                <p className="no-custom-fields">
                                    No memories yet. Add common chat answers or FAQs here.
                                </p>
                            )}
                            {((userData.memories as Memory[]) || []).map((m) => (
                                <div key={m.id} className="custom-field-item">
                                    <div className="custom-field-info">
                                        <div className="custom-field-label">{m.title}</div>
                                        <div className="custom-field-value">{m.content}</div>
                                    </div>
                                    <button className="icon-btn delete" onClick={() => removeMemory(m.id)}>
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>

                        <div className="add-custom-field">
                            <div className="add-custom-field-row">
                                <input
                                    type="text"
                                    placeholder="Title (e.g. Greeting)"
                                    value={newMemTitle}
                                    onChange={(e) => setNewMemTitle(e.target.value)}
                                />
                                <button className="icon-btn add" onClick={addMemory} title="Add Memory">
                                    <Plus size={16} />
                                </button>
                            </div>
                            <input
                                type="text"
                                className="context-input"
                                placeholder="Content (e.g. Hello, how can I help you today?)"
                                value={newMemContent}
                                onChange={(e) => setNewMemContent(e.target.value)}
                            />
                        </div>
                    </Section>

                    {/* ── SECTION: Autopilot Links ── */}
                    <Section icon={<Zap size={14} />} title={`Autopilot Links (${((userData.savedLinks as SavedLink[]) || []).length})`} defaultOpen={false}>
                        <div className="custom-fields-list">
                            {((userData.savedLinks as SavedLink[]) || []).length === 0 && (
                                <p className="no-custom-fields">
                                    No autopilot links yet.
                                </p>
                            )}
                            {((userData.savedLinks as SavedLink[]) || []).map((l) => (
                                <div key={l.id} className="custom-field-item" style={{ display: 'flex', flexDirection: 'column' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                        <div className="custom-field-info">
                                            <div className="custom-field-label">{l.title}</div>
                                            <div className="custom-field-context">{l.url}</div>
                                        </div>
                                        <button className="icon-btn delete" onClick={() => removeLink(l.id)}>
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                    <button className="save-btn small" style={{ marginTop: 5, background: 'var(--av-surface)', color: 'var(--av-primary)' }} onClick={() => triggerAutopilot(l.url)}>
                                        <Sparkles size={12} style={{ marginRight: 5 }} /> Open & Autofill
                                    </button>
                                </div>
                            ))}
                        </div>

                        <div className="add-custom-field">
                            <div className="add-custom-field-row">
                                <input
                                    type="text"
                                    placeholder="Title (e.g. Messenger)"
                                    value={newLinkTitle}
                                    onChange={(e) => setNewLinkTitle(e.target.value)}
                                />
                                <button className="icon-btn add" onClick={addLink} title="Add Link">
                                    <Plus size={16} />
                                </button>
                            </div>
                            <input
                                type="url"
                                className="context-input"
                                placeholder="URL (e.g. https://www.messenger.com/)"
                                value={newLinkUrl}
                                onChange={(e) => setNewLinkUrl(e.target.value)}
                            />
                        </div>
                    </Section>

                    {/* ── ACTION BUTTONS ── */}
                    <button className="save-btn" onClick={handleSave} disabled={isProcessing}>
                        <Save size={16} />
                        Save Data
                    </button>

                    <button
                        className="fill-btn"
                        onClick={handleAIFillForm}
                        disabled={isProcessing}
                    >
                        {isProcessing ? (
                            <>
                                <Loader2 size={16} className="spinning" />
                                Processing...
                            </>
                        ) : (
                            <>
                                <Sparkles size={16} />
                                Gemini AI Fill Form
                            </>
                        )}
                    </button>
                </>
            )}

            {status.message && (
                <div className={`status status-${status.type}`}>
                    {status.message}
                </div>
            )}

            <footer className="footer">
                <small>Powered by Gemini 2.5 Flash</small>
            </footer>
        </div>
    );
}

export default Popup;