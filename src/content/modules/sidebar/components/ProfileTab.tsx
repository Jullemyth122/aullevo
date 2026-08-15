import type { RefObject, ChangeEvent } from 'react';
import { FolderOpen, Check, X, MapPin, Save } from 'lucide-react';
import type { UserData, CustomField, SavedFile, FormField } from '../../../../types';
import { SectionHeader } from './SectionHeader';
import { FileIcon } from './FileIcon';
import { fileSizeStr } from '../sidebarTypes';
import { fileMatchesField } from '../../../../utils/fileMatch';

interface ProfileTabProps {
    userData: Partial<UserData>;
    setUserData: React.Dispatch<React.SetStateAction<Partial<UserData>>>;
    handleInput: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    handleSave: () => void;
    saveMsg: string;
    activeProfile: string;
    handleSwitchProfile: (name: string) => void;
    handleDeleteProfile: (name: string) => void;
    profiles: string[];
    showNewProfileInput: boolean;
    setShowNewProfileInput: (show: boolean) => void;
    newProfileName: string;
    setNewProfileName: (name: string) => void;
    handleCreateProfile: () => void;
    openSections: Record<string, boolean>;
    toggleSection: (key: string) => void;
    fileLibrary: SavedFile[];
    fileDragging: boolean;
    setFileDragging: (dragging: boolean) => void;
    fileLibInputRef: RefObject<HTMLInputElement | null>;
    addFilesToLibrary: (files: File[]) => void;
    removeFromLibrary: (id: string) => void;
    pageFields: FormField[];
    skillsInput: string | null;
    setSkillsInput: (val: string | null) => void;
    newCFLabel: string;
    setNewCFLabel: (val: string) => void;
    newCFValue: string;
    setNewCFValue: (val: string) => void;
    newCFContext: string;
    setNewCFContext: (val: string) => void;
    addCustomField: () => void;
    removeCustomField: (i: number) => void;
}

export const ProfileTab = ({
    userData,
    setUserData,
    handleInput,
    handleSave,
    saveMsg,
    activeProfile,
    handleSwitchProfile,
    handleDeleteProfile,
    profiles,
    showNewProfileInput,
    setShowNewProfileInput,
    newProfileName,
    setNewProfileName,
    handleCreateProfile,
    openSections,
    toggleSection,
    fileLibrary,
    fileDragging,
    setFileDragging,
    fileLibInputRef,
    addFilesToLibrary,
    removeFromLibrary,
    pageFields,
    skillsInput,
    setSkillsInput,
    newCFLabel,
    setNewCFLabel,
    newCFValue,
    setNewCFValue,
    newCFContext,
    setNewCFContext,
    addCustomField,
    removeCustomField,
}: ProfileTabProps) => {
    const profileType = userData.profileType || 'job';
    const customFields = (userData.customFields as CustomField[]) || [];

    return (
        <div className="av-profile-tab">
            {/* Active Profile Selection */}
            <div className="av-settings__how-card" style={{ marginBottom: 15, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', color: 'var(--av-text-muted)' }}>Active Profile</span>
                    {activeProfile !== 'Default' && (
                        <button
                            className="av-filelib__add-btn"
                            style={{ background: 'var(--av-error-bg)', color: 'var(--av-error)', borderColor: 'rgba(208,50,50,0.2)', padding: '2px 8px', fontSize: 10 }}
                            onClick={() => handleDeleteProfile(activeProfile)}
                        >
                            Delete
                        </button>
                    )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    <select
                        className="av-input"
                        style={{ flex: 1, padding: '6px 10px', height: 'auto' }}
                        value={activeProfile}
                        onChange={(e) => handleSwitchProfile(e.target.value)}
                    >
                        {profiles.map(name => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                    </select>
                    {!showNewProfileInput ? (
                        <button
                            className="av-filelib__add-btn"
                            style={{ height: '100%', padding: '6px 12px' }}
                            onClick={() => setShowNewProfileInput(true)}
                        >
                            + New
                        </button>
                    ) : (
                        <button
                            className="av-filelib__add-btn"
                            style={{ height: '100%', padding: '6px 12px', background: 'var(--av-surface-alt)', color: 'var(--av-text-muted)' }}
                            onClick={() => setShowNewProfileInput(false)}
                        >
                            Cancel
                        </button>
                    )}
                </div>

                {showNewProfileInput && (
                    <div style={{ marginTop: 10, display: 'flex', gap: 6, animation: 'av-fadeIn 0.2s ease' }}>
                        <input
                            className="av-input"
                            style={{ flex: 1, padding: '6px 10px' }}
                            placeholder="Profile name (e.g. Freelance)"
                            value={newProfileName}
                            onChange={(e) => setNewProfileName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreateProfile()}
                        />
                        <button
                            className="av-filelib__add-btn"
                            style={{ background: 'var(--av-violet)', color: 'white' }}
                            onClick={handleCreateProfile}
                        >
                            Create
                        </button>
                    </div>
                )}

                <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', color: 'var(--av-text-muted)', whiteSpace: 'nowrap' }}>Profile Type:</span>
                    <select
                        className="av-input"
                        style={{ flex: 1, padding: '4px 8px', height: 'auto', fontSize: 12 }}
                        value={profileType}
                        onChange={(e) => setUserData(p => ({ ...p, profileType: e.target.value as any }))}
                    >
                        <option value="job">Job Application / Resume</option>
                        <option value="medical">Medical Form</option>
                        <option value="survey">Survey</option>
                        <option value="custom">Custom / General</option>
                    </select>
                </div>
            </div>

            {profileType !== 'custom' && (
                <SectionHeader
                    label="Personal Information"
                    sectionKey="personal"
                    isOpen={!!openSections.personal}
                    onToggle={toggleSection}
                />
            )}
            {profileType !== 'custom' && openSections.personal && (
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
                    {profileType === 'job' && (
                        <div>
                            <label className="av-label">Headline</label>
                            <input className="av-input" name="headline" value={userData.headline || ''} onChange={handleInput} placeholder="e.g. Full-Stack Developer" />
                        </div>
                    )}
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

            {profileType === 'job' && (
                <>
                    <SectionHeader
                        label={`File Library (${fileLibrary.length})`}
                        sectionKey="filelib"
                        isOpen={!!openSections.filelib}
                        onToggle={toggleSection}
                    />
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

                    <SectionHeader
                        label="Links & URLs"
                        sectionKey="links"
                        isOpen={!!openSections.links}
                        onToggle={toggleSection}
                    />
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

                    <SectionHeader
                        label="Skills & Summary"
                        sectionKey="skills"
                        isOpen={!!openSections.skills}
                        onToggle={toggleSection}
                    />
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

                    <SectionHeader
                        label="Job Platform Fields"
                        sectionKey="job"
                        isOpen={!!openSections.job}
                        onToggle={toggleSection}
                    />
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
                </>
            )}

            {profileType === 'medical' && (
                <>
                    <SectionHeader
                        label="Medical Information"
                        sectionKey="medical_sec"
                        isOpen={!!openSections.medical_sec}
                        onToggle={toggleSection}
                    />
                    {openSections.medical_sec && (
                        <div className="av-section__body">
                            <div className="av-row">
                                <div>
                                    <label className="av-label">Blood Type</label>
                                    <input className="av-input" name="bloodType" value={userData.bloodType || ''} onChange={handleInput} placeholder="O+" />
                                </div>
                                <div>
                                    <label className="av-label">Allergies</label>
                                    <input className="av-input" name="allergies" value={userData.allergies || ''} onChange={handleInput} placeholder="e.g. Peanuts, Penicillin" />
                                </div>
                            </div>
                            <div>
                                <label className="av-label">Medical Conditions</label>
                                <textarea className="av-input" name="medicalConditions" value={userData.medicalConditions || ''} onChange={handleInput} placeholder="e.g. Asthma, Hypertension" rows={2} />
                            </div>
                            <div>
                                <label className="av-label">Current Medications</label>
                                <textarea className="av-input" name="medications" value={userData.medications || ''} onChange={handleInput} placeholder="e.g. Albuterol daily" rows={2} />
                            </div>
                            <div className="av-divider" style={{ margin: '10px 0', borderTop: '1px solid rgba(255,255,255,0.08)' }} />
                            <div>
                                <label className="av-label">Emergency Contact Name</label>
                                <input className="av-input" name="emergencyContactName" value={userData.emergencyContactName || ''} onChange={handleInput} placeholder="Jane Doe Sr." />
                            </div>
                            <div className="av-row">
                                <div>
                                    <label className="av-label">Relationship</label>
                                    <input className="av-input" name="emergencyContactRelationship" value={userData.emergencyContactRelationship || ''} onChange={handleInput} placeholder="Mother" />
                                </div>
                                <div>
                                    <label className="av-label">Contact Phone</label>
                                    <input className="av-input" name="emergencyContactPhone" type="tel" value={userData.emergencyContactPhone || ''} onChange={handleInput} placeholder="+1 555 000 0000" />
                                </div>
                            </div>
                            <div className="av-divider" style={{ margin: '10px 0', borderTop: '1px solid rgba(255,255,255,0.08)' }} />
                            <div className="av-row">
                                <div>
                                    <label className="av-label">Insurance Provider</label>
                                    <input className="av-input" name="insuranceProvider" value={userData.insuranceProvider || ''} onChange={handleInput} placeholder="Blue Cross" />
                                </div>
                                <div>
                                    <label className="av-label">Policy Number</label>
                                    <input className="av-input" name="policyNumber" value={userData.policyNumber || ''} onChange={handleInput} placeholder="X1234567" />
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {profileType === 'survey' && (
                <>
                    <SectionHeader
                        label="Survey Details"
                        sectionKey="survey_sec"
                        isOpen={!!openSections.survey_sec}
                        onToggle={toggleSection}
                    />
                    {openSections.survey_sec && (
                        <div className="av-section__body">
                            <div className="av-row">
                                <div>
                                    <label className="av-label">Occupation</label>
                                    <input className="av-input" name="occupation" value={userData.occupation || ''} onChange={handleInput} placeholder="Software Engineer" />
                                </div>
                                <div>
                                    <label className="av-label">Industry</label>
                                    <input className="av-input" name="industry" value={userData.industry || ''} onChange={handleInput} placeholder="Tech" />
                                </div>
                            </div>
                            <div className="av-row">
                                <div>
                                    <label className="av-label">Education Level</label>
                                    <input className="av-input" name="educationLevel" value={userData.educationLevel || ''} onChange={handleInput} placeholder="Bachelor's Degree" />
                                </div>
                                <div>
                                    <label className="av-label">Marital Status</label>
                                    <input className="av-input" name="maritalStatus" value={userData.maritalStatus || ''} onChange={handleInput} placeholder="Single" />
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            <SectionHeader
                label={`Custom Fields (${customFields.length})`}
                sectionKey="custom"
                isOpen={!!openSections.custom}
                onToggle={toggleSection}
            />
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
                                placeholder="Label (e.g. Mon — From or Pronouns)"
                                value={newCFLabel}
                                onChange={e => setNewCFLabel(e.target.value)}
                            />
                            <input
                                className="av-input av-input--flex"
                                placeholder="Value (e.g. He/Him)"
                                value={newCFValue}
                                onChange={e => setNewCFValue(e.target.value)}
                            />
                            <input
                                className="av-input av-input--flex"
                                placeholder="AI Context (e.g. Use when asked about preferred pronouns)"
                                value={newCFContext}
                                onChange={e => setNewCFContext(e.target.value)}
                            />
                            <button className="av-cf-form__add-btn" onClick={addCustomField}>+</button>
                        </div>
                    </div>
                </div>
            )}

            <button className="av-save-btn" onClick={handleSave}>
                <Save size={14} /> {saveMsg || 'Save Profile'}
            </button>
        </div>
    );
};
