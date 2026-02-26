import { useState, useEffect, type ChangeEvent } from 'react';
import { Upload, Save, Sparkles, Loader2, ChevronDown, Plus, Trash2, User, Link, Briefcase, PenTool } from 'lucide-react';
import { geminiService } from '../services/geminiService';
import { resumeParser } from '../services/resumeParser';
import type { UserData, CustomField, Status, ChromeResponse } from '../types';
import './Popup.css';

/* ─── helpers ─── */

function migrateCustomFields(raw: any): CustomField[] {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
        // Old Record<string, string> → CustomField[]
        return Object.entries(raw).map(([key, value]) => ({
            label: key,
            value: String(value),
            context: '',
        }));
    }
    return [];
}

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

    const [apiKey, setApiKey] = useState<string>('');
    const [showSettings, setShowSettings] = useState<boolean>(false);

    // Custom field add form
    const [newCFLabel, setNewCFLabel] = useState('');
    const [newCFValue, setNewCFValue] = useState('');
    const [newCFContext, setNewCFContext] = useState('');

    useEffect(() => {
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            chrome.storage.local.get(['userData', 'geminiApiKey'], (result) => {
                if (result?.userData) {
                    const loaded = result.userData as any;
                    // Migrate old customFields format
                    loaded.customFields = migrateCustomFields(loaded.customFields);
                    setUserData(loaded as Partial<UserData>);
                }
                if (result?.geminiApiKey) {
                    setApiKey(result.geminiApiKey as string);
                }
            });
        }
    }, []);

    /* ── Custom Fields CRUD ── */

    const addCustomField = () => {
        if (!newCFLabel.trim()) return;
        const newField: CustomField = {
            label: newCFLabel.trim(),
            value: newCFValue.trim(),
            context: newCFContext.trim(),
        };
        setUserData(prev => ({
            ...prev,
            customFields: [...(prev.customFields as CustomField[] || []), newField]
        }));
        setNewCFLabel('');
        setNewCFValue('');
        setNewCFContext('');
    };

    const removeCustomField = (index: number) => {
        setUserData(prev => ({
            ...prev,
            customFields: (prev.customFields as CustomField[] || []).filter((_, i) => i !== index)
        }));
    };

    /* ── Resume Upload ── */

    const handleResumeUpload = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploadedFileName(file.name);
        setIsProcessing(true);
        setStatus({ message: '🤖 Gemini AI is parsing your resume...', type: 'info' });

        try {
            if (!apiKey && !(import.meta as any).env.VITE_GEMINI_API_KEY) {
                throw new Error("Please set your Gemini API Key in Settings first.");
            }

            if (apiKey) {
                geminiService.setApiKey(apiKey);
            }

            const resumeText = await resumeParser.parseFile(file);
            const parsedData = await geminiService.parseResume(resumeText);

            const newData = { ...userData, ...parsedData };
            // Preserve existing custom fields
            newData.customFields = userData.customFields || [];
            setUserData(newData);

            setStatus({ message: '✅ Resume parsed successfully by Gemini!', type: 'success' });

            if (typeof chrome !== 'undefined' && chrome?.storage) {
                chrome.storage.local.set({ userData: newData });
            }
        } catch (error: any) {
            console.error(error);
            setStatus({ message: `❌ ${error.message || 'Error parsing resume'}`, type: 'error' });
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

    const handleSave = () => {
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
                        let arraySource: any[] = [];
                        if (mapping.groupType === 'experience') arraySource = userData.experience || [];
                        if (mapping.groupType === 'education') arraySource = userData.education || [];
                        if (mapping.groupType === 'project') arraySource = userData.portfolio ? JSON.parse(JSON.stringify(userData.portfolio)) : [];
                        if (mapping.groupType === 'skill') arraySource = userData.skills || [];

                        const item = arraySource[mapping.groupIndex];
                        if (item) {
                            if (typeof item === 'object' && item !== null) {
                                if (mapping.fieldType in item) {
                                    mapping.selectedValue = (item as any)[mapping.fieldType];
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
        } catch (error: any) {
            console.error(error);
            setStatus({ message: `❌ Error: ${error.message}`, type: 'error' });
            setIsProcessing(false);
        }
    };

    const sendMessagePromise = (tabId: number, message: any): Promise<ChromeResponse> => {
        return new Promise((resolve) => {
            chrome.tabs.sendMessage(tabId, message, (response) => {
                if (chrome.runtime.lastError) {
                    console.error(chrome.runtime.lastError);
                    resolve({ success: false, message: chrome.runtime.lastError.message });
                } else {
                    resolve(response);
                }
            });
        });
    };

    const handleAIFillForm = async () => {
        setIsProcessing(true);
        setStatus({ message: '🤖 Starting AI Form Filler...', type: 'info' });

        if (typeof chrome === 'undefined' || !chrome.tabs) {
            setStatus({ message: '⚠️ Form filling only works in real extension', type: 'error' });
            setIsProcessing(false);
            return;
        }

        try {
            if (!apiKey && !(import.meta as any).env.VITE_GEMINI_API_KEY) {
                throw new Error("Please set your Gemini API Key in Settings first.");
            }

            if (apiKey) geminiService.setApiKey(apiKey);

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab.id) throw new Error("No active tab found");

            processFormStep(tab.id, 0);
        } catch (error: any) {
            console.error(error);
            setStatus({ message: `❌ ${error.message || 'Error filling form'}`, type: 'error' });
            setIsProcessing(false);
        }
    };

    const saveApiKey = () => {
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            chrome.storage.local.set({ geminiApiKey: apiKey }, () => {
                setStatus({ message: '🔑 API Key saved!', type: 'success' });
                setTimeout(() => setStatus({ message: '', type: '' }), 2000);
            });
        }
    };

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       RENDER
       ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    const customFields = (userData.customFields as CustomField[]) || [];

    return (
        <div className="popup-container">
            <header className="header">
                <h1>🚗 Aullevo</h1>
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

                    {/* Upload */}
                    <div className="upload-section">
                        <label className="upload-btn">
                            <Upload size={16} />
                            {uploadedFileName || 'Upload Resume (PDF/DOCX)'}
                            <input
                                type="file"
                                accept=".pdf,.docx,.doc,.txt"
                                onChange={handleResumeUpload}
                                disabled={isProcessing}
                                hidden
                            />
                        </label>
                    </div>

                    {/* ── SECTION: Personal Info ── */}
                    <Section icon={<User size={14} />} title="Personal Information" defaultOpen={true}>
                        <div className="form-row">
                            <Field label="First Name" name="firstName" value={userData.firstName || ''} onChange={handleInputChange} />
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