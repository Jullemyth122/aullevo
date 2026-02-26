import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { extractFormFields } from '../services/formAnalyzer';
import { geminiService } from '../services/geminiService';
import { resumeParser } from '../services/resumeParser';
import type { UserData, CustomField } from '../types';

/* ────────────────────────────────────────────────────────────
   TYPES
──────────────────────────────────────────────────────────── */
type Tab = 'fill' | 'profile' | 'settings';

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
   THEME TOKENS
──────────────────────────────────────────────────────────── */
const LIGHT = {
    bg: '#f7f6fb',
    surface: '#ffffff',
    surfaceAlt: '#f0edf9',
    surfaceHover: '#e9e4f7',
    border: '#ddd8f0',
    borderSoft: '#eae6f5',

    violet: '#5535d4',
    violetDark: '#3d22b0',
    violetMid: '#7157e0',
    violetLight: '#ede8ff',
    violetXLight: '#f5f3ff',

    yellow: '#e8a80c',
    yellowDark: '#b07e00',
    yellowLight: '#fff8e1',
    yellowMid: '#fdd96a',

    text: '#1a1535',
    textMid: '#3e3666',
    textMuted: '#8a82ac',
    textOnDark: '#ffffff',
    textOnYellow: '#2a1f00',

    success: '#1a9e6e',
    successBg: '#edfaf5',
    error: '#d03232',
    errorBg: '#fff0f0',
    info: '#2562c4',
    infoBg: '#edf3ff',
    warning: '#b86a00',
    warningBg: '#fff8ed',

    shadow: 'rgba(85, 53, 212, 0.10)',
    shadowPanel: 'rgba(20, 10, 60, 0.13)',
};

const DARK = {
    bg: '#100e1f',
    surface: '#1a1730',
    surfaceAlt: '#231f3a',
    surfaceHover: '#2c2848',
    border: '#302b50',
    borderSoft: '#2a2545',

    violet: '#8066f0',
    violetDark: '#6347d4',
    violetMid: '#9b85f7',
    violetLight: '#2a2248',
    violetXLight: '#201c3a',

    yellow: '#f0bc30',
    yellowDark: '#c49010',
    yellowLight: '#2a2200',
    yellowMid: '#a07800',

    text: '#eeeaff',
    textMid: '#c0b8e8',
    textMuted: '#7870a0',
    textOnDark: '#ffffff',
    textOnYellow: '#1e1500',

    success: '#28c484',
    successBg: '#0e2820',
    error: '#f06060',
    errorBg: '#2a1010',
    info: '#6090f0',
    infoBg: '#101830',
    warning: '#e8a020',
    warningBg: '#241800',

    shadow: 'rgba(0,0,0,0.4)',
    shadowPanel: 'rgba(0,0,0,0.5)',
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
    const [fillStatus, setFillStatus] = useState<FillStatus>({ message: '', type: 'idle' });
    const [isProcessing, setIsProcessing] = useState(false);
    const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const C = isDark ? DARK : LIGHT;

    const [userData, setUserData] = useState<Partial<UserData>>({
        firstName: '', lastName: '', email: '', phone: '',
        address: '', city: '', state: '', zipCode: '', country: '',
        linkedin: '', portfolio: '', github: '',
        headline: '', summary: '', skills: [],
        yearsOfExperience: '', salaryExpectation: '',
        noticePeriod: '', workAuthorization: '',
        dateOfBirth: '', gender: '',
        customFields: [],
        experience: [], education: [],
    });
    const [apiKey, setApiKey] = useState('');
    const [saveMsg, setSaveMsg] = useState('');
    const [uploadedFile, setUploadedFile] = useState('');
    const [newCFLabel, setNewCFLabel] = useState('');
    const [newCFValue, setNewCFValue] = useState('');
    const [newCFContext, setNewCFContext] = useState('');
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({
        personal: true, links: false, skills: false, job: false, custom: true,
    });

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
        chrome.storage.local.get(['userData', 'geminiApiKey'], (result) => {
            if (result.userData) {
                const loaded = result.userData as any;
                loaded.customFields = migrateCustomFields(loaded.customFields);
                setUserData(loaded);
            }
            if (result.geminiApiKey) setApiKey(result.geminiApiKey as string);
        });
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

    /* ── Helpers ── */
    const scanFields = () => {
        try { setFieldCount(extractFormFields().length); } catch { setFieldCount(0); }
    };

    const toggleSection = (key: string) => setOpenSections(p => ({ ...p, [key]: !p[key] }));

    const handleInput = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setUserData(p => ({ ...p, [name]: value }));
    };

    const handleSave = () => {
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            chrome.storage.local.set({ userData }, () => { setSaveMsg('Saved!'); setTimeout(() => setSaveMsg(''), 2000); });
        }
    };

    const handleSaveApiKey = () => {
        if (typeof chrome !== 'undefined' && chrome?.storage) {
            chrome.storage.local.set({ geminiApiKey: apiKey }, () => { setSaveMsg('API key saved!'); setTimeout(() => setSaveMsg(''), 2000); });
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

    const handleResumeUpload = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!apiKey) { setFillStatus({ message: 'Please add your Gemini API key in Settings first.', type: 'error' }); setActiveTab('settings'); return; }
        setUploadedFile(file.name);
        setIsProcessing(true);
        setFillStatus({ message: 'Parsing your resume with AI…', type: 'info' });
        try {
            geminiService.setApiKey(apiKey);
            const text = await resumeParser.parseFile(file);
            const parsed = await geminiService.parseResume(text);
            const merged = { ...userData, ...parsed, customFields: userData.customFields || [] };
            setUserData(merged);
            if (typeof chrome !== 'undefined' && chrome?.storage) chrome.storage.local.set({ userData: merged });
            setFillStatus({ message: 'Resume parsed! Review your profile and save.', type: 'success' });
            setActiveTab('profile');
        } catch (err: any) {
            setFillStatus({ message: err.message || 'Failed to parse resume.', type: 'error' });
        } finally { setIsProcessing(false); }
    };

    const handleFill = async () => {
        if (!apiKey) { setFillStatus({ message: 'Add your Gemini API key in Settings first.', type: 'error' }); setActiveTab('settings'); return; }
        setIsProcessing(true);
        setFillStatus({ message: 'Scanning form fields…', type: 'scanning' });
        try {
            chrome.runtime.sendMessage({ action: 'triggerFillFromSidebar' }, (response) => {
                if (response?.success) {
                    setFillStatus({ message: `Filled ${response.filledCount ?? '?'} fields successfully!`, type: 'success' });
                } else {
                    setFillStatus({ message: response?.error || 'Fill failed', type: 'error' });
                }
                setIsProcessing(false);
            });
        } catch (err: any) { setFillStatus({ message: err.message, type: 'error' }); setIsProcessing(false); }
    };

    const customFields = (userData.customFields as CustomField[]) || [];

    /* ── Status colors ── */
    const statusColors: Record<FillStatus['type'], { color: string; bg: string; border: string }> = {
        idle: { color: C.textMuted, bg: C.surfaceAlt, border: C.border },
        scanning: { color: C.info, bg: C.infoBg, border: C.info + '44' },
        filling: { color: C.violet, bg: C.violetLight, border: C.violet + '44' },
        info: { color: C.info, bg: C.infoBg, border: C.info + '44' },
        success: { color: C.success, bg: C.successBg, border: C.success + '44' },
        error: { color: C.error, bg: C.errorBg, border: C.error + '44' },
    };

    /* ────────────────────────────────────────────────────────────
       STYLE HELPERS
    ──────────────────────────────────────────────────────────── */
    const inputSt: React.CSSProperties = {
        width: '100%',
        padding: '9px 12px',
        border: `1.5px solid ${C.border}`,
        borderRadius: '9px',
        fontSize: '13px',
        color: C.text,
        background: C.surface,
        outline: 'none',
        boxSizing: 'border-box',
        fontFamily: 'inherit',
        transition: 'border-color 0.18s, box-shadow 0.18s',
    };

    const labelSt: React.CSSProperties = {
        display: 'block',
        fontSize: '10px',
        fontWeight: '700',
        color: C.textMuted,
        marginBottom: '4px',
        textTransform: 'uppercase',
        letterSpacing: '0.65px',
    };

    const rowSt: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' };

    const cardSt: React.CSSProperties = {
        background: C.surface,
        border: `1.5px solid ${C.border}`,
        borderRadius: '12px',
        padding: '14px 16px',
        boxShadow: `0 1px 6px ${C.shadow}`,
    };

    /* ── Section Header ── */
    function SectionHeader({ label, sectionKey }: { label: string; sectionKey: string }) {
        return (
            <button onClick={() => toggleSection(sectionKey)} style={{
                width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '9px 13px',
                background: C.surfaceAlt,
                border: `1px solid ${C.borderSoft}`,
                borderRadius: '9px',
                cursor: 'pointer',
                fontSize: '11px', fontWeight: '700', color: C.textMid,
                letterSpacing: '0.5px', textTransform: 'uppercase',
                fontFamily: 'inherit',
            }}>
                <span>{label}</span>
                <span style={{
                    fontSize: '9px', color: C.textMuted,
                    display: 'inline-block',
                    transition: 'transform 0.22s',
                    transform: openSections[sectionKey] ? 'rotate(180deg)' : 'rotate(0deg)',
                }}>▼</span>
            </button>
        );
    }

    /* ── Section Body wrapper ── */
    function SectionBody({ children }: { children: React.ReactNode }) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '2px 1px 4px' }}>
                {children}
            </div>
        );
    }

    /* ═══════════════════════════════════════
       FILL TAB
    ═══════════════════════════════════════ */
    function FillTab() {
        const fillDisabled = isProcessing || fieldCount === 0;
        const sc = statusColors[fillStatus.type];

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

                {/* Upload */}
                <label style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    padding: '12px 16px',
                    background: C.surface,
                    border: `2px dashed ${C.border}`,
                    borderRadius: '12px',
                    cursor: 'pointer', fontSize: '13px', color: C.textMid, fontWeight: '500',
                    transition: 'border-color 0.2s, background 0.2s',
                    fontFamily: 'inherit',
                }}>
                    <span style={{ fontSize: '16px' }}>📄</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                        {uploadedFile || 'Upload Resume (PDF / DOCX)'}
                    </span>
                    <input type="file" accept=".pdf,.docx,.doc,.txt" onChange={handleResumeUpload} hidden disabled={isProcessing} />
                </label>

                {/* Detection card */}
                <div style={{ ...cardSt, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <div style={{ fontSize: '10px', fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '5px' }}>
                            Page Detection
                        </div>
                        <div style={{ fontSize: '30px', fontWeight: '900', lineHeight: 1, letterSpacing: '-1.5px', color: fieldCount > 0 ? C.violet : C.textMuted }}>
                            {fieldCount}
                        </div>
                        <div style={{ fontSize: '12px', color: C.textMuted, marginTop: '3px' }}>
                            {fieldCount === 0 ? 'No fields found' : fieldCount === 1 ? 'form field' : 'form fields'}
                        </div>
                    </div>
                    <button onClick={scanFields} style={{
                        padding: '8px 14px',
                        background: C.violetLight,
                        border: `1px solid ${C.violet}30`,
                        borderRadius: '8px',
                        fontSize: '12px', color: C.violet, fontWeight: '600',
                        cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                        ↻ Rescan
                    </button>
                </div>

                {/* Fill button — YELLOW CTA */}
                <button onClick={handleFill} disabled={fillDisabled} style={{
                    padding: '14px 20px',
                    background: fillDisabled
                        ? C.surfaceAlt
                        : `linear-gradient(135deg, ${C.yellow}, ${C.yellowDark})`,
                    border: fillDisabled ? `1.5px solid ${C.border}` : 'none',
                    borderRadius: '12px',
                    color: fillDisabled ? C.textMuted : C.textOnYellow,
                    fontSize: '14px', fontWeight: '800',
                    cursor: fillDisabled ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    boxShadow: fillDisabled ? 'none' : `0 4px 20px ${C.yellow}55`,
                    transition: 'all 0.18s',
                    fontFamily: 'inherit',
                    letterSpacing: '-0.2px',
                }}>
                    {isProcessing ? (
                        <>
                            <span style={{
                                display: 'inline-block', width: 14, height: 14,
                                border: `2px solid ${C.textOnYellow}30`,
                                borderTopColor: C.textOnYellow,
                                borderRadius: '50%',
                                animation: 'av-spin 0.7s linear infinite',
                            }} />
                            Filling…
                        </>
                    ) : (
                        <>
                            <span style={{ fontSize: '14px' }}>✦</span>
                            {fieldCount > 0 ? `Fill ${fieldCount} Fields with AI` : 'No Fields Detected'}
                        </>
                    )}
                </button>

                {/* Status */}
                {fillStatus.message && (
                    <div style={{
                        padding: '10px 14px',
                        background: sc.bg,
                        border: `1px solid ${sc.border}`,
                        borderRadius: '9px',
                        fontSize: '13px', color: sc.color, fontWeight: '500', lineHeight: '1.5',
                    }}>
                        {fillStatus.message}
                    </div>
                )}

                {/* No API key */}
                {!apiKey && (
                    <div onClick={() => setActiveTab('settings')} style={{
                        padding: '10px 14px',
                        background: C.warningBg,
                        border: `1px solid ${C.warning}40`,
                        borderRadius: '9px',
                        fontSize: '12px', color: C.warning, cursor: 'pointer', fontWeight: '500',
                    }}>
                        ⚠️ No API key set. Click here to add your Gemini API key.
                    </div>
                )}

                {/* Shortcuts */}
                <div style={{ ...cardSt }}>
                    <div style={{ fontSize: '10px', fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px' }}>
                        Shortcuts
                    </div>
                    {[
                        { key: 'Alt+F', desc: 'Quick fill form' },
                        { key: 'Alt+A', desc: 'Toggle sidebar' },
                        { key: 'Ctrl+M', desc: 'Toggle sidebar' },
                    ].map(({ key, desc }) => (
                        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <code style={{
                                fontSize: '11px',
                                background: C.yellowLight,
                                color: C.yellowDark,
                                border: `1px solid ${C.yellow}40`,
                                borderRadius: '5px', padding: '2px 8px', fontWeight: '700',
                                fontFamily: 'monospace',
                            }}>{key}</code>
                            <span style={{ fontSize: '12px', color: C.textMuted }}>{desc}</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    /* ═══════════════════════════════════════
       PROFILE TAB
    ═══════════════════════════════════════ */
    function ProfileTab() {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

                <SectionHeader label="Personal Information" sectionKey="personal" />
                {openSections.personal && (
                    <SectionBody>
                        <div style={rowSt}>
                            <div><label style={labelSt}>First Name</label><input style={inputSt} name="firstName" value={userData.firstName || ''} onChange={handleInput} placeholder="Jane" /></div>
                            <div><label style={labelSt}>Last Name</label><input style={inputSt} name="lastName" value={userData.lastName || ''} onChange={handleInput} placeholder="Doe" /></div>
                        </div>
                        <div><label style={labelSt}>Email</label><input style={inputSt} name="email" type="email" value={userData.email || ''} onChange={handleInput} placeholder="jane@example.com" /></div>
                        <div><label style={labelSt}>Phone</label><input style={inputSt} name="phone" type="tel" value={userData.phone || ''} onChange={handleInput} placeholder="+1 555 000 0000" /></div>
                        <div><label style={labelSt}>Headline</label><input style={inputSt} name="headline" value={userData.headline || ''} onChange={handleInput} placeholder="e.g. Full-Stack Developer" /></div>
                        <div><label style={labelSt}>Address</label><input style={inputSt} name="address" value={userData.address || ''} onChange={handleInput} placeholder="Street address" /></div>
                        <div style={rowSt}>
                            <div><label style={labelSt}>City</label><input style={inputSt} name="city" value={userData.city || ''} onChange={handleInput} /></div>
                            <div><label style={labelSt}>State</label><input style={inputSt} name="state" value={userData.state || ''} onChange={handleInput} /></div>
                        </div>
                        <div style={rowSt}>
                            <div><label style={labelSt}>ZIP</label><input style={inputSt} name="zipCode" value={userData.zipCode || ''} onChange={handleInput} /></div>
                            <div><label style={labelSt}>Country</label><input style={inputSt} name="country" value={userData.country || ''} onChange={handleInput} /></div>
                        </div>
                    </SectionBody>
                )}

                <SectionHeader label="Links & URLs" sectionKey="links" />
                {openSections.links && (
                    <SectionBody>
                        <div><label style={labelSt}>LinkedIn</label><input style={inputSt} name="linkedin" type="url" value={userData.linkedin || ''} onChange={handleInput} placeholder="linkedin.com/in/you" /></div>
                        <div><label style={labelSt}>GitHub</label><input style={inputSt} name="github" type="url" value={userData.github || ''} onChange={handleInput} placeholder="github.com/you" /></div>
                        <div><label style={labelSt}>Portfolio</label><input style={inputSt} name="portfolio" type="url" value={userData.portfolio || ''} onChange={handleInput} placeholder="yoursite.com" /></div>
                    </SectionBody>
                )}

                <SectionHeader label="Skills & Summary" sectionKey="skills" />
                {openSections.skills && (
                    <SectionBody>
                        <div>
                            <label style={labelSt}>Skills (comma-separated)</label>
                            <textarea style={{ ...inputSt, resize: 'vertical', minHeight: '72px' }}
                                placeholder="React, TypeScript, Node.js…"
                                value={userData.skills?.join(', ') || ''}
                                onChange={(e) => setUserData(p => ({ ...p, skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                                rows={3}
                            />
                        </div>
                        <div>
                            <label style={labelSt}>Summary</label>
                            <textarea style={{ ...inputSt, resize: 'vertical', minHeight: '80px' }}
                                name="summary" placeholder="Professional summary…"
                                value={userData.summary || ''} onChange={handleInput} rows={3}
                            />
                        </div>
                    </SectionBody>
                )}

                <SectionHeader label="Job Platform Fields" sectionKey="job" />
                {openSections.job && (
                    <SectionBody>
                        <div style={rowSt}>
                            <div><label style={labelSt}>Years of Exp.</label><input style={inputSt} name="yearsOfExperience" value={userData.yearsOfExperience || ''} onChange={handleInput} placeholder="5" /></div>
                            <div><label style={labelSt}>Salary Expect.</label><input style={inputSt} name="salaryExpectation" value={userData.salaryExpectation || ''} onChange={handleInput} placeholder="e.g. $80k" /></div>
                        </div>
                        <div style={rowSt}>
                            <div><label style={labelSt}>Notice Period</label><input style={inputSt} name="noticePeriod" value={userData.noticePeriod || ''} onChange={handleInput} placeholder="2 weeks" /></div>
                            <div><label style={labelSt}>Work Auth.</label><input style={inputSt} name="workAuthorization" value={userData.workAuthorization || ''} onChange={handleInput} placeholder="Citizen" /></div>
                        </div>
                        <div style={rowSt}>
                            <div><label style={labelSt}>Date of Birth</label><input style={inputSt} name="dateOfBirth" type="date" value={userData.dateOfBirth || ''} onChange={handleInput} /></div>
                            <div><label style={labelSt}>Gender</label><input style={inputSt} name="gender" value={userData.gender || ''} onChange={handleInput} placeholder="e.g. Male" /></div>
                        </div>
                    </SectionBody>
                )}

                <SectionHeader label={`Custom Fields (${customFields.length})`} sectionKey="custom" />
                {openSections.custom && (
                    <SectionBody>
                        {customFields.length === 0 && (
                            <p style={{ fontSize: '12px', color: C.textMuted, fontStyle: 'italic', margin: '0 0 4px' }}>
                                No custom fields yet. Add one below so the AI knows what to fill.
                            </p>
                        )}
                        {customFields.map((cf, i) => (
                            <div key={i} style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                                background: C.yellowLight,
                                borderRadius: '9px', padding: '10px 12px',
                                border: `1px solid ${C.yellow}40`,
                            }}>
                                <div>
                                    <div style={{ fontSize: '12px', fontWeight: '700', color: C.yellowDark }}>{cf.label}</div>
                                    <div style={{ fontSize: '12px', color: C.textMid, marginTop: '2px' }}>{cf.value || '—'}</div>
                                    {cf.context && <div style={{ fontSize: '11px', color: C.textMuted, marginTop: '3px' }}>📍 {cf.context}</div>}
                                </div>
                                <button onClick={() => removeCustomField(i)} style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    color: C.error, fontSize: '16px', padding: '0 0 0 8px', lineHeight: 1,
                                    fontFamily: 'inherit',
                                }}>×</button>
                            </div>
                        ))}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '2px' }}>
                            <div style={{ display: 'flex', gap: '6px' }}>
                                <input style={{ ...inputSt, flex: 1 }} placeholder="Label (e.g. Pronouns)" value={newCFLabel} onChange={e => setNewCFLabel(e.target.value)} />
                                <input style={{ ...inputSt, flex: 1 }} placeholder="Value (e.g. He/Him)" value={newCFValue} onChange={e => setNewCFValue(e.target.value)} />
                                <button onClick={addCustomField} style={{
                                    width: '38px', height: '38px', flexShrink: 0,
                                    background: C.yellow,
                                    border: 'none', borderRadius: '9px',
                                    color: C.textOnYellow, fontSize: '20px', fontWeight: '700',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontFamily: 'inherit',
                                }}>+</button>
                            </div>
                            <input style={inputSt} placeholder="AI Context (e.g. Use when asked about preferred pronouns)" value={newCFContext} onChange={e => setNewCFContext(e.target.value)} />
                        </div>
                    </SectionBody>
                )}

                <button onClick={handleSave} style={{
                    padding: '13px',
                    background: `linear-gradient(135deg, ${C.violet}, ${C.violetDark})`,
                    border: 'none', borderRadius: '12px',
                    color: '#fff', fontSize: '14px', fontWeight: '700',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
                    boxShadow: `0 4px 18px ${C.violet}44`,
                    marginTop: '4px', fontFamily: 'inherit',
                }}>
                    💾 {saveMsg || 'Save Profile'}
                </button>
            </div>
        );
    }

    /* ═══════════════════════════════════════
       SETTINGS TAB
    ═══════════════════════════════════════ */
    function SettingsTab() {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: C.text, marginBottom: '6px' }}>Gemini API Key</div>
                    <p style={{ fontSize: '12px', color: C.textMuted, marginBottom: '12px', lineHeight: '1.65', marginTop: 0 }}>
                        Your key is stored locally and never sent to any server. Get yours free at{' '}
                        <span onClick={() => window.open('https://aistudio.google.com/app/apikey', '_blank')}
                            style={{ color: C.violet, textDecoration: 'underline', cursor: 'pointer' }}>
                            aistudio.google.com
                        </span>.
                    </p>
                    <label style={labelSt}>API Key</label>
                    <input style={inputSt} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="AIza…" />
                    <button onClick={handleSaveApiKey} style={{
                        marginTop: '10px', width: '100%', padding: '12px',
                        background: `linear-gradient(135deg, ${C.violet}, ${C.violetDark})`,
                        border: 'none', borderRadius: '12px',
                        color: '#fff', fontSize: '14px', fontWeight: '700',
                        cursor: 'pointer', boxShadow: `0 4px 16px ${C.violet}44`,
                        fontFamily: 'inherit',
                    }}>
                        {saveMsg || 'Save API Key'}
                    </button>
                </div>

                <div style={{ height: '1px', background: C.border }} />

                <div style={{
                    padding: '13px 14px',
                    background: C.successBg,
                    borderRadius: '12px',
                    border: `1px solid ${C.success}30`,
                    fontSize: '12px', color: C.success, lineHeight: '1.65',
                }}>
                    🔒 <strong>Privacy-first</strong> — Gemini only sees form field labels, never the data you type into fields.
                </div>

                <div style={{
                    padding: '13px 14px',
                    background: C.surfaceAlt,
                    borderRadius: '12px',
                    border: `1px solid ${C.border}`,
                    fontSize: '12px', color: C.textMid, lineHeight: '1.65',
                }}>
                    <div style={{ fontWeight: '700', marginBottom: '6px', color: C.text }}>How it works</div>
                    <p style={{ margin: 0 }}>
                        Aullevo scans the current page for form inputs, sends only the field labels to Gemini,
                        gets back suggested values from your saved profile, then fills the form — all locally.
                    </p>
                </div>

                {/* Dark mode toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: C.surfaceAlt, borderRadius: '12px', border: `1px solid ${C.border}` }}>
                    <div>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: C.text }}>Appearance</div>
                        <div style={{ fontSize: '11px', color: C.textMuted, marginTop: '2px' }}>{isDark ? 'Dark mode' : 'Light mode'}</div>
                    </div>
                    <button onClick={() => setIsDark(d => !d)} style={{
                        width: '44px', height: '24px',
                        background: isDark ? `linear-gradient(90deg, ${C.violet}, ${C.yellow})` : C.border,
                        border: 'none', borderRadius: '12px',
                        cursor: 'pointer', position: 'relative', transition: 'background 0.25s',
                        flexShrink: 0,
                    }}>
                        <span style={{
                            position: 'absolute', top: '3px',
                            left: isDark ? '23px' : '3px',
                            width: '18px', height: '18px',
                            background: '#fff',
                            borderRadius: '50%',
                            transition: 'left 0.22s',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '10px',
                        }}>{isDark ? '🌙' : '☀️'}</span>
                    </button>
                </div>
            </div>
        );
    }

    /* ═══════════════════════════════════════
       RENDER
    ═══════════════════════════════════════ */
    return (
        <>
            <style>{`
                @keyframes av-slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to   { transform: translateX(0);    opacity: 1; }
                }
                @keyframes av-spin {
                    to { transform: rotate(360deg); }
                }
                @keyframes av-pulse {
                    0%, 100% { box-shadow: -2px 0 18px rgba(85,53,212,0.28), 0 0 0 0 rgba(85,53,212,0.4); }
                    50%      { box-shadow: -2px 0 18px rgba(85,53,212,0.28), 0 0 0 7px rgba(85,53,212,0); }
                }
            `}</style>

            {/* ── Trigger pill ── */}
            <div
                onClick={() => setIsOpen(p => !p)}
                title="Aullevo — Ctrl+M or Alt+A"
                style={{
                    position: 'fixed',
                    right: isOpen ? '-4px' : '0',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: `linear-gradient(160deg, ${C.violet}, ${C.violetDark})`,
                    width: '26px',
                    height: '82px',
                    borderRadius: '10px 0 0 10px',
                    cursor: 'pointer',
                    zIndex: 2147483646,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'right 0.35s cubic-bezier(0.16,1,0.3,1), opacity 0.25s',
                    opacity: isOpen ? 0.3 : 1,
                    animation: !isOpen ? 'av-pulse 2.8s ease-in-out infinite' : 'none',
                    userSelect: 'none',
                }}
            >
                {/* Yellow accent stripe at top of pill */}
                <span style={{
                    position: 'absolute', top: 0, left: 0, right: 0,
                    height: '4px',
                    background: C.yellow,
                    borderRadius: '10px 0 0 0',
                }} />
                <span style={{
                    fontSize: '8px',
                    color: 'rgba(255,255,255,0.9)',
                    writingMode: 'vertical-rl',
                    textOrientation: 'mixed',
                    letterSpacing: '1.6px',
                    fontWeight: '700',
                    transform: 'rotate(180deg)',
                    fontFamily: 'system-ui, sans-serif',
                    textTransform: 'uppercase',
                }}>Aullevo</span>
                {fieldCount > 0 && (
                    <span style={{
                        fontSize: '9px', fontWeight: '800', color: C.textOnYellow,
                        background: C.yellow,
                        borderRadius: '5px', padding: '1px 3px', lineHeight: 1.3, marginTop: '5px',
                    }}>{fieldCount}</span>
                )}
            </div>

            {/* ── Panel ── */}
            {isOpen && (
                <div style={{
                    position: 'fixed',
                    top: 0, right: 0, bottom: 0,
                    width: '360px',
                    background: C.bg,
                    borderLeft: `1.5px solid ${C.border}`,
                    boxShadow: `-6px 0 40px ${C.shadowPanel}`,
                    zIndex: 2147483647,
                    display: 'flex',
                    flexDirection: 'column',
                    fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
                    animation: 'av-slideIn 0.3s cubic-bezier(0.16,1,0.3,1)',
                    WebkitFontSmoothing: 'antialiased',
                } as React.CSSProperties}>

                    {/* Header */}
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '13px 16px',
                        background: C.surface,
                        borderBottom: `1.5px solid ${C.border}`,
                        flexShrink: 0,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            {/* Logo — violet bg, yellow star */}
                            <div style={{
                                width: '32px', height: '32px',
                                background: `linear-gradient(135deg, ${C.violet}, ${C.violetDark})`,
                                borderRadius: '9px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '15px', color: C.yellow,
                                boxShadow: `0 2px 8px ${C.violet}44`,
                                flexShrink: 0,
                            }}>✦</div>
                            <div>
                                <div style={{ fontSize: '15px', fontWeight: '800', color: C.text, letterSpacing: '-0.3px', lineHeight: 1.1 }}>Aullevo</div>
                                <div style={{ fontSize: '10px', color: C.textMuted, fontWeight: '500', marginTop: '1px' }}>AI Form Filler</div>
                            </div>
                        </div>
                        <button onClick={() => setIsOpen(false)} style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: C.textMuted, fontSize: '20px', fontWeight: '600', lineHeight: 1,
                            padding: '4px 7px', borderRadius: '6px', fontFamily: 'inherit',
                        }} title="Close">×</button>
                    </div>

                    {/* Tabs */}
                    <div style={{
                        display: 'flex',
                        background: C.surface,
                        borderBottom: `1.5px solid ${C.border}`,
                        flexShrink: 0,
                    }}>
                        {([
                            { id: 'fill', label: 'Fill Form' },
                            { id: 'profile', label: 'My Profile' },
                            { id: 'settings', label: 'Settings' },
                        ] as { id: Tab; label: string }[]).map(t => (
                            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                                flex: 1, padding: '10px 0',
                                background: 'none', border: 'none',
                                borderBottom: activeTab === t.id ? `2.5px solid ${C.violet}` : '2.5px solid transparent',
                                color: activeTab === t.id ? C.violet : C.textMuted,
                                fontSize: '12px', fontWeight: activeTab === t.id ? '700' : '500',
                                cursor: 'pointer', transition: 'all 0.16s',
                                fontFamily: 'inherit',
                            }}>
                                {t.label}
                            </button>
                        ))}
                    </div>

                    {/* Body */}
                    <div style={{
                        flex: 1, overflowY: 'auto',
                        padding: '16px 14px',
                        display: 'flex', flexDirection: 'column',
                    }}>
                        {activeTab === 'fill' && <FillTab />}
                        {activeTab === 'profile' && <ProfileTab />}
                        {activeTab === 'settings' && <SettingsTab />}
                    </div>

                    {/* Footer */}
                    <div style={{
                        padding: '9px 16px',
                        borderTop: `1.5px solid ${C.border}`,
                        background: C.surface,
                        flexShrink: 0,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                        <span style={{ fontSize: '10px', color: C.textMuted }}>Powered by Gemini 2.5 Flash</span>
                        <span style={{ fontSize: '10px', color: C.textMuted }}>Ctrl+M to toggle</span>
                    </div>
                </div>
            )}
        </>
    );
}