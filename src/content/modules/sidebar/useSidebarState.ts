import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import type { UserData, CustomField, SavedFile, FormField, Memory, SavedLink } from '../../../types';
import type { Tab, FillStatus } from './sidebarTypes';
import { migrateCustomFields, createEmptyUserData } from './sidebarTypes';
import { extractFormFields, findChatInputField, extractChatContext, fillChatInputField } from '../../../services/formAnalyzer';
import { geminiService } from '../../../services/geminiService';
import { resumeParser } from '../../../services/resumeParser';
import { storageService } from '../../../services/storageService';

let fileUid = 0;
const newFileId = () => `sf-${Date.now()}-${fileUid++}`;

export function useSidebarState() {
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
    const [isPro, setIsPro] = useState(false);
    const [autoSubmit, setAutoSubmit] = useState(false);
    const [skillsInput, setSkillsInput] = useState<string | null>(null);

    const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fillTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Profile management states
    const [profiles, setProfiles] = useState<string[]>([]);
    const [activeProfile, setActiveProfile] = useState<string>('Default');
    const [newProfileName, setNewProfileName] = useState('');
    const [showNewProfileInput, setShowNewProfileInput] = useState(false);

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
        medical_sec: true, survey_sec: true,
    });

    const [newMemTitle, setNewMemTitle] = useState('');
    const [newMemContent, setNewMemContent] = useState('');
    const [newLinkTitle, setNewLinkTitle] = useState('');
    const [newLinkUrl, setNewLinkUrl] = useState('');
    const [newLinkAutoFill, setNewLinkAutoFill] = useState(true);

    // File Library state
    const [fileLibrary, setFileLibrary] = useState<SavedFile[]>([]);
    const [fileDragging, setFileDragging] = useState(false);
    const fileLibInputRef = useRef<HTMLInputElement>(null);

    const loadFileLibrary = () => {
        if (typeof chrome === 'undefined' || !chrome.storage) return;
        chrome.storage.local.get('fileLibrary', (r) => {
            setFileLibrary((r.fileLibrary as SavedFile[]) || []);
        });
    };

    const addFilesToLibrary = async (files: File[]) => {
        if (!isPro && fileLibrary.length + files.length > 2) {
            setFillStatus({ message: '🔒 File Vault is limited to 2 files on the Free tier. Upgrade on our web app!', type: 'error' });
            return;
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

    // Dark mode listener
    useEffect(() => {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    // Load profile data
    const loadAllProfileData = async () => {
        try {
            await storageService.migrateLegacyData();
            const list = await storageService.listProfiles();
            const activeName = await storageService.getActiveProfileName();
            const currentActive = list.length ? activeName : 'Default';

            setProfiles(list.length ? list : ['Default']);
            setActiveProfile(currentActive);

            const loaded = await storageService.loadProfile(currentActive);
            if (loaded) {
                loaded.customFields = migrateCustomFields(loaded.customFields);
                setUserData(loaded);
                setSkillsInput((loaded.skills || []).join(', '));
            }
        } catch (err) {
            console.warn("Storage vault load failed, using legacy fallback:", err);
            chrome.storage.local.get(['userData'], (result) => {
                if (result.userData) {
                    const loaded = result.userData as any;
                    loaded.customFields = migrateCustomFields(loaded.customFields);
                    setUserData(loaded);
                    setSkillsInput((loaded.skills || []).join(', '));
                }
            });
        }
    };

    const handleSwitchProfile = async (name: string) => {
        await storageService.setActiveProfileName(name);
        const data = await storageService.loadProfile(name);
        if (data) {
            chrome.storage.local.set({ userData: data });
            data.customFields = migrateCustomFields(data.customFields);
            setUserData(data);
            setSkillsInput((data.skills || []).join(', '));
        } else {
            const emptyData = createEmptyUserData();
            chrome.storage.local.set({ userData: emptyData });
            setUserData(emptyData);
            setSkillsInput('');
        }
        setActiveProfile(name);
        setSaveMsg('Switched profile!');
        setTimeout(() => setSaveMsg(''), 2000);
    };

    const handleCreateProfile = async () => {
        if (!isPro && profiles.length >= 1) {
            setSaveMsg('🔒 Profile limit (1) reached. Upgrade on web app!');
            setTimeout(() => setSaveMsg(''), 4000);
            return;
        }
        const name = newProfileName.trim();
        if (!name) return;
        if (profiles.includes(name)) {
            setSaveMsg('Profile exists!');
            setTimeout(() => setSaveMsg(''), 2000);
            return;
        }

        const emptyData = createEmptyUserData();
        await storageService.saveProfile(name, emptyData);
        setNewProfileName('');
        setShowNewProfileInput(false);
        await loadAllProfileData();
        await handleSwitchProfile(name);
    };

    const handleDeleteProfile = async (name: string) => {
        if (profiles.length <= 1) {
            setSaveMsg('Cannot delete last profile');
            setTimeout(() => setSaveMsg(''), 2000);
            return;
        }
        if (!confirm(`Are you sure you want to delete profile "${name}"?`)) return;

        await storageService.deleteProfile(name);
        const nextActive = profiles.find(p => p !== name) || 'Default';
        await loadAllProfileData();
        await handleSwitchProfile(nextActive);
        setSaveMsg('Profile deleted');
        setTimeout(() => setSaveMsg(''), 2000);
    };

    // Load settings from storage on mount
    useEffect(() => {
        if (typeof chrome === 'undefined' || !chrome.storage) return;
        chrome.storage.local.get(['geminiApiKey', 'matchingMode', 'isPro', 'autoSubmit'], (result) => {
            if (result.geminiApiKey) setApiKey(result.geminiApiKey as string);
            if (result.matchingMode) setMatchingMode(result.matchingMode as 'ai' | 'heuristic');
            if (result.isPro !== undefined) setIsPro(!!result.isPro);
            if (result.autoSubmit !== undefined) setAutoSubmit(!!result.autoSubmit);
        });
        loadAllProfileData();
        loadFileLibrary();

        const storageListener = (changes: any, areaName: string) => {
            if (areaName === 'local' && changes.isPro !== undefined) {
                setIsPro(!!changes.isPro.newValue);
            }
        };
        chrome.storage.onChanged.addListener(storageListener);
        return () => {
            chrome.storage.onChanged.removeListener(storageListener);
        };
    }, []);

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
                if (request.statusType === 'success' || request.statusType === 'error') {
                    setIsProcessing(false);
                    if (fillTimeoutRef.current) clearTimeout(fillTimeoutRef.current);
                }
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

    // Global Error Catching
    useEffect(() => {
        const handleGlobalError = (event: ErrorEvent) => {
            if (event.message === 'ResizeObserver loop limit exceeded' || event.message === 'ResizeObserver loop completed with undelivered notifications.') return;
            if (event.message.includes('Extension context invalidated')) return;

            console.error('Aullevo Global Error Caught:', event.error);
            setFillStatus({ message: `Whoops! Extension error: ${event.message}`, type: 'error' });
            setIsProcessing(false);
        };

        const handlePromiseRejection = (event: PromiseRejectionEvent) => {
            console.error('Aullevo Unhandled Promise Rejection:', event.reason);
            const msg = event.reason?.message || String(event.reason);
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

    const toggleSection = (key: string) => setOpenSections(p => ({ ...p, [key]: !p[key] }));

    const handleInput = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setUserData(p => ({ ...p, [name]: value }));
    };

    const handleSave = async () => {
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            try {
                await storageService.saveProfile(activeProfile, userData as UserData);
                chrome.storage.local.set({ userData }, () => {
                    setSaveMsg('Saved!');
                    setTimeout(() => setSaveMsg(''), 2000);
                });
            } catch (err: any) {
                console.error("Save error:", err);
                chrome.storage.local.set({ userData }, () => {
                    setSaveMsg('Saved (unencrypted fallback)!');
                    setTimeout(() => setSaveMsg(''), 2000);
                });
            }
        }
    };

    const handleSaveApiKey = () => {
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            const trimmedKey = apiKey.trim();
            chrome.storage.local.set({ geminiApiKey: trimmedKey }, () => {
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
        if (!isPro && (userData.memories || []).length >= 2) {
            setFillStatus({ message: '🔒 Memories are limited to 2 on the Free tier. Upgrade on our web app!', type: 'error' });
            return;
        }
        if (!newMemTitle.trim() || !newMemContent.trim()) return;
        const memory: Memory = { id: Date.now().toString(), title: newMemTitle.trim(), content: newMemContent.trim() };
        setUserData(p => ({ ...p, memories: [...((p.memories as Memory[]) || []), memory] }));
        setNewMemTitle(''); setNewMemContent('');
    };

    const removeMemory = (id: string) => {
        setUserData(p => ({ ...p, memories: ((p.memories as Memory[]) || []).filter(m => m.id !== id) }));
    };

    const addLink = () => {
        if (!isPro && (userData.savedLinks || []).length >= 2) {
            setFillStatus({ message: '🔒 Links are limited to 2 on the Free tier. Upgrade on our web app!', type: 'error' });
            return;
        }
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
        if (matchingMode === 'ai' && !isPro) {
            setFillStatus({ message: '🔒 Gemini AI matching is a Pro feature. Please upgrade!', type: 'error' });
            return;
        }
        if (matchingMode === 'ai' && !apiKey) {
            setFillStatus({ message: 'Add your Gemini API key in Settings first.', type: 'error' });
            setActiveTab('settings');
            return;
        }
        setIsProcessing(true);

        const chatInput = findChatInputField();
        if (chatInput && matchingMode === 'ai') {
            setFillStatus({ message: 'Chat window detected. Gathering context...', type: 'scanning' });
            try {
                const conversationHistory = extractChatContext(chatInput);
                setFillStatus({ message: 'Constructing AI reply...', type: 'scanning' });

                chrome.runtime.sendMessage({
                    action: 'processChatAI',
                    conversationHistory
                }, (response) => {
                    if (response?.success && response.replyText) {
                        const injectionSuccess = fillChatInputField(chatInput, response.replyText);
                        if (injectionSuccess) {
                            setFillStatus({ message: 'Reply injected successfully!', type: 'success' });
                        } else {
                            setFillStatus({ message: 'Generated reply, but failed to inject into DOM.', type: 'error' });
                        }
                    } else {
                        setFillStatus({ message: response?.error || 'Failed to generate reply.', type: 'error' });
                    }
                    setIsProcessing(false);
                });
                return;
            } catch (err: any) {
                setFillStatus({ message: err.message, type: 'error' });
                setIsProcessing(false);
                return;
            }
        }

        if (fillTimeoutRef.current) clearTimeout(fillTimeoutRef.current);
        fillTimeoutRef.current = setTimeout(() => {
            setIsProcessing(false);
            setFillStatus({ message: 'Filling safety timeout. Try again or switch to Keyword mode.', type: 'error' });
        }, 35000);

        setFillStatus({ message: matchingMode === 'heuristic' ? 'Matching fields by keyword…' : 'Scanning form fields…', type: 'scanning' });
        try {
            chrome.runtime.sendMessage({ action: 'triggerFillFromSidebar' }, (response) => {
                if (chrome.runtime?.lastError) {
                    console.warn('Aullevo: Extension context error (safe to ignore)', chrome.runtime.lastError);
                    setFillStatus({ message: 'Extension reloaded. Please refresh the page.', type: 'error' });
                    setIsProcessing(false);
                    if (fillTimeoutRef.current) clearTimeout(fillTimeoutRef.current);
                    return;
                }
                if (response?.success) {
                    // Handled via sidebarStatus
                } else {
                    setFillStatus({ message: response?.error || 'Fill failed', type: 'error' });
                    setIsProcessing(false);
                    if (fillTimeoutRef.current) clearTimeout(fillTimeoutRef.current);
                }
            });
        } catch (err: any) {
            setFillStatus({ message: err.message, type: 'error' });
            setIsProcessing(false);
            if (fillTimeoutRef.current) clearTimeout(fillTimeoutRef.current);
        }
    };

    return {
        isDark, setIsDark,
        isOpen, setIsOpen,
        activeTab, setActiveTab,
        fieldCount, pageFields, scanFields,
        fillStatus, setFillStatus,
        isProcessing, matchingMode, setMatchingMode,
        isPro, autoSubmit, setAutoSubmit,
        skillsInput, setSkillsInput,
        profiles, activeProfile, handleSwitchProfile,
        newProfileName, setNewProfileName,
        showNewProfileInput, setShowNewProfileInput,
        handleCreateProfile, handleDeleteProfile,
        userData, setUserData, handleInput, handleSave,
        apiKey, setApiKey, handleSaveApiKey, saveMsg,
        uploadedFile, handleResumeUpload, handleFill,
        openSections, toggleSection,
        newCFLabel, setNewCFLabel,
        newCFValue, setNewCFValue,
        newCFContext, setNewCFContext,
        addCustomField, removeCustomField,
        newMemTitle, setNewMemTitle,
        newMemContent, setNewMemContent,
        addMemory, removeMemory,
        newLinkTitle, setNewLinkTitle,
        newLinkUrl, setNewLinkUrl,
        newLinkAutoFill, setNewLinkAutoFill,
        addLink, removeLink, triggerAutopilot,
        fileLibrary, fileDragging, setFileDragging, fileLibInputRef,
        addFilesToLibrary, removeFromLibrary,
    };
}

export type SidebarState = ReturnType<typeof useSidebarState>;
