import { useState } from 'react';
import { FolderOpen, Check, X, Save } from 'lucide-react';
import type { CustomField, UserData } from '../../../../types';
import { SectionHeader } from './SectionHeader';
import { FileIcon } from './FileIcon';
import { fileSizeStr } from '../sidebarTypes';
import { fileMatchesField } from '../../../../utils/fileMatch';
import { useSidebar } from '../SidebarContext';
import { storageService } from '../../../../services/storageService';
import {
    PersonalInfoFields,
    JobDetailsFields,
    MedicalFields,
    SurveyFields,
    CustomFieldsEditor,
} from '../../../../components/profile';

export const ProfileTab = () => {
    const {
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
        newProfileType,
        setNewProfileType,
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
        isPro,
    } = useSidebar();

    const [draftCF, setDraftCF] = useState({ label: '', value: '', context: '' });

    const profileType = userData.profileType || 'job';
    const customFields = (userData.customFields as CustomField[]) || [];

    const handleAddCustomField = (field: CustomField) => {
        setUserData((p) => {
            const updated = {
                ...p,
                customFields: [...((p.customFields as CustomField[]) || []), field],
            };
            if (typeof chrome !== 'undefined' && chrome?.storage) {
                storageService.saveProfile(activeProfile, updated as UserData).catch(() => {
                    chrome.storage.local.set({ userData: updated });
                });
            }
            return updated;
        });
    };

    const handleRemoveCustomField = (idx: number) => {
        setUserData((p) => {
            const updated = {
                ...p,
                customFields: ((p.customFields as CustomField[]) || []).filter((_, i) => i !== idx),
            };
            if (typeof chrome !== 'undefined' && chrome?.storage) {
                storageService.saveProfile(activeProfile, updated as UserData).catch(() => {
                    chrome.storage.local.set({ userData: updated });
                });
            }
            return updated;
        });
    };

    const onSaveProfileClick = async () => {
        let extra: CustomField | undefined = undefined;
        if (draftCF.label.trim() || draftCF.value.trim()) {
            extra = {
                label: draftCF.label.trim() || draftCF.value.trim() || 'Custom Field',
                value: draftCF.value.trim(),
                context: draftCF.context.trim(),
            };
            setDraftCF({ label: '', value: '', context: '' });
        }
        await handleSave(extra);
    };

    return (
        <div className="av-profile-tab">
            {/* Active Profile Selection */}
            <div className="av-settings__how-card" style={{ marginBottom: 15, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', color: 'var(--av-text-muted)' }}>
                        Active Profile (Vault)
                    </span>
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
                        style={{ flex: 1, padding: '6px 10px', height: 'auto', fontWeight: 600 }}
                        value={activeProfile}
                        onChange={(e) => handleSwitchProfile(e.target.value)}
                    >
                        {profiles.map((name, idx) => (
                            <option key={name} value={name}>
                                {!isPro && idx >= 1 ? `🔒 ${name} (Pro)` : name}
                            </option>
                        ))}
                    </select>
                    {!showNewProfileInput ? (
                        <button
                            className="av-filelib__add-btn"
                            style={{ height: '100%', padding: '6px 12px' }}
                            onClick={() => {
                                if (!isPro && profiles.length >= 1) {
                                    handleCreateProfile();
                                    return;
                                }
                                setShowNewProfileInput(true);
                            }}
                            title={!isPro && profiles.length >= 1 ? 'Upgrade to Pro for multiple profiles' : 'Create new profile'}
                        >
                            {!isPro && profiles.length >= 1 ? '🔒 + New' : '+ New'}
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
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, animation: 'av-fadeIn 0.2s ease', background: 'var(--av-surface-alt)', padding: 8, borderRadius: 8 }}>
                        <input
                            className="av-input"
                            style={{ width: '100%', padding: '6px 10px' }}
                            placeholder="Profile name (e.g. Freelance, Medical)"
                            value={newProfileName}
                            onChange={(e) => setNewProfileName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreateProfile()}
                        />
                        <div style={{ display: 'flex', gap: 6 }}>
                            <select
                                className="av-input"
                                style={{ flex: 1, padding: '4px 8px', fontSize: 12 }}
                                value={newProfileType}
                                onChange={(e) => setNewProfileType && setNewProfileType(e.target.value as 'job' | 'medical' | 'survey' | 'custom')}
                            >
                                <option value="job">💼 Job Application</option>
                                <option value="medical">🏥 Medical Record</option>
                                <option value="survey">📊 Survey / Demographic</option>
                                <option value="custom">⚙️ Custom Form</option>
                            </select>
                            <button
                                className="av-filelib__add-btn"
                                style={{ background: 'var(--av-violet)', color: 'white', padding: '4px 12px' }}
                                onClick={handleCreateProfile}
                            >
                                Create
                            </button>
                        </div>
                    </div>
                )}

                {/* Read-only template indicator for active profile */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                        <span style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', color: 'var(--av-text-muted)' }}>Template:</span>
                        <span style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '2px 7px',
                            borderRadius: 4,
                            background: 'var(--av-surface-alt)',
                            color: 'var(--av-text)'
                        }}>
                            {profileType === 'medical' && '🏥 Medical Record'}
                            {profileType === 'survey' && '📊 Survey'}
                            {profileType === 'custom' && '⚙️ Custom Form'}
                            {profileType === 'job' && '💼 Job Application'}
                        </span>
                    </div>
                    <button
                        className="av-filelib__add-btn"
                        style={{ padding: '2px 6px', fontSize: 10, background: 'transparent', borderColor: 'transparent', color: 'var(--av-violet)' }}
                        onClick={() => chrome.runtime.sendMessage({ action: 'openOptionsPage' })}
                    >
                        Edit in Options ↗
                    </button>
                </div>
            </div>

            {/* Section 1: Personal Information */}
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
                    <PersonalInfoFields
                        userData={userData}
                        onChange={handleInput}
                        showHeadline={profileType === 'job'}
                    />
                </div>
            )}

            {/* Section 2: Job-Specific Sections (Files, Links, Skills, Details) */}
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
                            <JobDetailsFields
                                userData={userData}
                                onChange={handleInput}
                            />
                        </div>
                    )}
                </>
            )}

            {/* Section 3: Medical Information */}
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
                            <MedicalFields
                                userData={userData}
                                onChange={handleInput}
                            />
                        </div>
                    )}
                </>
            )}

            {/* Section 4: Survey Details */}
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
                            <SurveyFields
                                userData={userData}
                                onChange={handleInput}
                            />
                        </div>
                    )}
                </>
            )}

            {/* Section 5: Custom Fields */}
            <SectionHeader
                label={`Custom Fields (${customFields.length})`}
                sectionKey="custom"
                isOpen={!!openSections.custom}
                onToggle={toggleSection}
            />
            {openSections.custom && (
                <div className="av-section__body">
                    <CustomFieldsEditor
                        customFields={customFields}
                        onAdd={handleAddCustomField}
                        onRemove={handleRemoveCustomField}
                        draft={draftCF}
                        onDraftChange={setDraftCF}
                    />
                </div>
            )}

            <button className="av-save-btn" onClick={onSaveProfileClick}>
                <Save size={14} /> {saveMsg || 'Save Profile'}
            </button>
        </div>
    );
};
