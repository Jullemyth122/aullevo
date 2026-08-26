import { FileText, FolderOpen, ChevronRight, RefreshCw, Sparkles, AlertTriangle, ShieldAlert, CheckCircle2, X, ArrowRight, UploadCloud } from 'lucide-react';
import { useSidebar } from '../SidebarContext';

export const FillTab = () => {
    const {
        uploadedFile,
        pendingResumeFile,
        resumeConsent,
        setResumeConsent,
        resumeParseSuccess,
        dismissParseSuccess,
        handleSelectResumeFile,
        handleConfirmResumeParse,
        handleCancelResumeParse,
        fileLibrary,
        setActiveTab,
        fieldCount,
        scanFields,
        isProcessing,
        matchingMode,
        handleFill,
        fillStatus,
        apiKey,
    } = useSidebar();

    const fillDisabled = isProcessing || fieldCount === 0;

    return (
        <div className="av-fill-tab">
            {/* AI Parsing File Upload Card */}
            <div className="av-card av-ai-parse-card">
                <div className="av-ai-parse-card__header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="av-ai-parse-card__badge">
                            <Sparkles size={11} /> AI Parser
                        </span>
                        <span className="av-ai-parse-card__title">AI Parsing File Upload</span>
                    </div>
                </div>

                <p className="av-ai-parse-card__desc">
                    Auto-extract details (name, skills, career) into your profile fields via Gemini AI.
                </p>

                {/* Staged Confirmation Checker when a file is selected */}
                {pendingResumeFile ? (
                    <div className="av-staged-box">
                        <div className="av-staged-file-info">
                            <FileText size={15} className="av-staged-icon" />
                            <div className="av-staged-meta">
                                <span className="av-staged-name">{pendingResumeFile.name}</span>
                                <span className="av-staged-size">({(pendingResumeFile.size / 1024).toFixed(1)} KB)</span>
                            </div>
                        </div>

                        {/* Confirmation Checkbox */}
                        <label className="av-confirm-checkbox">
                            <input
                                type="checkbox"
                                checked={resumeConsent}
                                onChange={e => setResumeConsent(e.target.checked)}
                                disabled={isProcessing}
                            />
                            <span>I confirm this is my document and authorize sending its text to Gemini AI.</span>
                        </label>

                        {/* Caution & Legal Disclaimer */}
                        <div className="av-disclaimer-notice">
                            <ShieldAlert size={12} className="av-disclaimer-icon" />
                            <span className="av-disclaimer-text">
                                <strong>Caution:</strong> Aullevo processes documents client-side via your Gemini API key. Aullevo is not responsible for document contents or AI interpretation. You must review all generated data before submitting forms.
                            </span>
                        </div>

                        {/* Action Buttons */}
                        <div className="av-staged-actions">
                            <button
                                type="button"
                                className="av-confirm-btn av-confirm-btn--primary"
                                disabled={!resumeConsent || isProcessing}
                                onClick={handleConfirmResumeParse}
                            >
                                {isProcessing ? (
                                    <>
                                        <span className="av-btn-spinner" />
                                        Processing…
                                    </>
                                ) : (
                                    <>
                                        <Sparkles size={12} />
                                        Confirm &amp; Process with AI
                                    </>
                                )}
                            </button>
                            <button
                                type="button"
                                className="av-confirm-btn av-confirm-btn--secondary"
                                onClick={handleCancelResumeParse}
                                disabled={isProcessing}
                            >
                                <X size={12} />
                                Cancel
                            </button>
                        </div>
                    </div>
                ) : (
                    /* Initial Upload Input */
                    <>
                        <label className="av-upload">
                            <span className="av-upload__icon"><UploadCloud size={16} /></span>
                            <span className="av-upload__text">
                                {uploadedFile ? uploadedFile : 'Upload Resume / Document (PDF / DOCX)'}
                            </span>
                            <input
                                type="file"
                                accept=".pdf,.docx,.doc,.txt"
                                onChange={handleSelectResumeFile}
                                hidden
                                disabled={isProcessing}
                            />
                        </label>

                        {/* Permanent Privacy Notice */}
                        <div className="av-privacy-notice">
                            <ShieldAlert size={14} className="av-privacy-notice__icon" />
                            <span className="av-privacy-notice__text">
                                <strong>Notice:</strong> Document text is sent to Gemini AI to extract profile data. Use only for non-sensitive resumes/documents.
                            </span>
                        </div>
                    </>
                )}

                {/* Post-Parse Review Verification Banner */}
                {resumeParseSuccess && (
                    <div className="av-parse-success-banner">
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                            <CheckCircle2 size={14} className="av-success-icon" />
                            <div style={{ flex: 1 }}>
                                <div className="av-success-title">Parsing Complete</div>
                                <div className="av-success-desc">
                                    Please review all extracted fields in your Profile tab to verify accuracy before auto-filling forms.
                                </div>
                            </div>
                            <button type="button" className="av-banner-dismiss" onClick={dismissParseSuccess} title="Dismiss">
                                <X size={12} />
                            </button>
                        </div>
                        <button
                            type="button"
                            className="av-review-btn"
                            onClick={() => { dismissParseSuccess(); setActiveTab('profile'); }}
                        >
                            <span>Review Profile Tab</span>
                            <ArrowRight size={12} />
                        </button>
                    </div>
                )}
            </div>

            {/* Direct Injection File Library badge */}
            <div className="av-card av-filelib-badge" onClick={() => setActiveTab('profile')}>
                <div className="av-filelib-badge__left">
                    <span className="av-filelib-badge__icon"><FolderOpen size={16} /></span>
                    <div>
                        <div className="av-filelib-badge__count">
                            {fileLibrary.length > 0
                                ? `${fileLibrary.length} file${fileLibrary.length !== 1 ? 's' : ''} in File Library`
                                : 'File Library (Direct Form Injections)'}
                        </div>
                        <div className="av-filelib-badge__hint">
                            {fileLibrary.length > 0
                                ? 'Auto-injected directly into webpage file inputs →'
                                : 'Add resumes & files to auto-attach to web forms →'}
                        </div>
                    </div>
                </div>
                <span className="av-filelib-badge__arrow"><ChevronRight size={14} /></span>
            </div>

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
                    { key: 'Ctrl+Shift+E', desc: 'Toggle sidebar' },
                    { key: 'Ctrl+Shift+F', desc: 'Quick fill form' },
                    { key: 'Alt+Shift+E', desc: 'Toggle sidebar (alternative)' },
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
