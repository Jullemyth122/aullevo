import { type ChangeEvent } from 'react';
import { FileText, FolderOpen, ChevronRight, RefreshCw, Sparkles, AlertTriangle } from 'lucide-react';
import type { SavedFile } from '../../../../types';
import type { Tab, FillStatus } from '../sidebarTypes';

interface FillTabProps {
    uploadedFile: string;
    handleResumeUpload: (e: ChangeEvent<HTMLInputElement>) => void;
    fileLibrary: SavedFile[];
    setActiveTab: (tab: Tab) => void;
    fieldCount: number;
    scanFields: () => void;
    isProcessing: boolean;
    matchingMode: 'ai' | 'heuristic';
    handleFill: () => void;
    fillStatus: FillStatus;
    apiKey: string;
}

export const FillTab = ({
    uploadedFile,
    handleResumeUpload,
    fileLibrary,
    setActiveTab,
    fieldCount,
    scanFields,
    isProcessing,
    matchingMode,
    handleFill,
    fillStatus,
    apiKey,
}: FillTabProps) => {
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
