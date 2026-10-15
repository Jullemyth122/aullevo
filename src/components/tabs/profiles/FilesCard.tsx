import { useState, useRef } from 'react';
import { Upload, FileText, Trash2, Check, X, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ProfileFile, UserData } from '../../../types';
import { useT } from '../../../i18n';

interface FilesCardProps {
    currentProfile: UserData;
    onUpdateProfile: (patch: Partial<UserData>) => void;
}

const ITEMS_PER_PAGE = 10;

export type DocCategory = 'Resume / CV' | 'Cover Letter' | 'Identity / ID' | 'Academic Record' | 'Portfolio' | 'Other';

export function FilesCard({ currentProfile, onUpdateProfile }: FilesCardProps) {
    const { t } = useT();
    const [isOpen, setIsOpen] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [fileLabel, setFileLabel] = useState<DocCategory>('Resume / CV');

    const files: ProfileFile[] = currentProfile.files || [];
    const totalPages = Math.max(1, Math.ceil(files.length / ITEMS_PER_PAGE));
    const safeCurrentPage = Math.min(currentPage, totalPages);
    const paginatedFiles = files.slice((safeCurrentPage - 1) * ITEMS_PER_PAGE, safeCurrentPage * ITEMS_PER_PAGE);

    // Auto-cleans file name into a human label (e.g. "my_passport_photo.jpg" -> "Identity Document")
    const cleanFileNameToLabel = (fileName: string): string => {
        const base = fileName.replace(/\.[^/.]+$/, "").replace(/[_\-\.]+/g, " ").trim();
        if (/resume|cv/i.test(base)) return "Resume / CV";
        if (/cover\s*letter/i.test(base)) return "Cover Letter";
        if (/passport|profile|photo|2x2|id/i.test(base)) return "Identity / ID";
        if (/transcript|diploma|grades|tor|bsit/i.test(base)) return "Academic Record";
        if (/portfolio|project/i.test(base)) return "Portfolio";
        return base;
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            const base64String = reader.result as string;
            // If user explicitly picked a specific category, use it; otherwise auto-detect from file name!
            const initialLabel = fileLabel !== 'Other' ? fileLabel : cleanFileNameToLabel(file.name);

            const newFile: ProfileFile = {
                id: `file_${Date.now()}`,
                label: initialLabel,
                fileName: file.name,
                mimeType: file.type || 'application/pdf',
                fileSize: file.size,
                dataBase64: base64String,
                enabled: true
            };

            onUpdateProfile({ files: [...files, newFile] });
            if (fileInputRef.current) fileInputRef.current.value = '';
        };
        reader.readAsDataURL(file);
    };

    // Allows updating the label dynamically per card
    const updateFileLabel = (id: string, newLabel: string) => {
        onUpdateProfile({
            files: files.map(f => f.id === id ? { ...f, label: newLabel } : f)
        });
    };

    const toggleFile = (id: string) => {
        onUpdateProfile({
            files: files.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f)
        });
    };

    const removeFile = (id: string) => {
        onUpdateProfile({
            files: files.filter(f => f.id !== id)
        });
    };

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return t('profiles.documents.size.bytes', { size: bytes });
        if (bytes < 1024 * 1024) return t('profiles.documents.size.kilobytes', { size: Number((bytes / 1024).toFixed(1)) });
        return t('profiles.documents.size.megabytes', { size: Number((bytes / (1024 * 1024)).toFixed(1)) });
    };

    // Categories are stored in English (they become the file's label); only their display is translated
    const categoryText: Record<DocCategory, { option: string; upload: string }> = {
        'Resume / CV': { option: t('profiles.documents.categories.resume'), upload: t('profiles.documents.upload.resume') },
        'Cover Letter': { option: t('profiles.documents.categories.coverLetter'), upload: t('profiles.documents.upload.coverLetter') },
        'Identity / ID': { option: t('profiles.documents.categories.identity'), upload: t('profiles.documents.upload.identity') },
        'Academic Record': { option: t('profiles.documents.categories.academic'), upload: t('profiles.documents.upload.academic') },
        'Portfolio': { option: t('profiles.documents.categories.portfolio'), upload: t('profiles.documents.upload.portfolio') },
        'Other': { option: t('profiles.documents.categories.other'), upload: t('profiles.documents.upload.other') }
    };

    return (
        <div className={`av-card-${currentProfile.enabled ? 'active' : 'disabled'}`}>
            {/* Clickable Header */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    userSelect: 'none',
                    paddingBottom: isOpen ? 8 : 0
                }}
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="av-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{t('profiles.documents.title')}</span>
                    <span style={{ fontSize: 10, opacity: 0.7 }}>({files.length})</span>
                </div>
                <ChevronDown
                    size={14}
                    style={{
                        color: 'var(--av-text-muted)',
                        transition: 'transform 0.2s ease',
                        transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)'
                    }}
                />
            </div>

            {isOpen && (
                <>
                    {paginatedFiles.map((file) => (
                        <div key={file.id} className={`av-cf-card-${file.enabled ? 'active' : 'disabled'}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', marginBottom: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', flex: 1, marginInlineEnd: 8 }}>
                                <FileText size={16} color="var(--av-accent, #6366f1)" style={{ flexShrink: 0 }} />
                                <div style={{ overflow: 'hidden', flex: 1 }}>
                                    {/* Editable Document Label Input (like CM fields!) */}
                                    <input
                                        className="av-cf-input-label"
                                        style={{
                                            width: '100%',
                                            fontSize: 11,
                                            fontWeight: 600,
                                            background: 'transparent',
                                            border: '1px solid transparent',
                                            borderRadius: 3,
                                            padding: '1px 2px',
                                            color: 'var(--av-text)',
                                            outline: 'none'
                                        }}
                                        value={file.label}
                                        onChange={(e) => updateFileLabel(file.id, e.target.value)}
                                        placeholder={t('profiles.documents.labelPlaceholder')}
                                        title={t('profiles.documents.labelTooltip')}
                                    />
                                    {/* Read-only Filename & Size */}
                                    <div style={{ fontSize: 10, color: 'var(--av-text-muted)', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden', paddingInlineStart: 2 }}>
                                        {file.fileName} ({formatSize(file.fileSize)})
                                    </div>
                                </div>
                            </div>

                            <div className="av-cf-card__actions" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <button
                                    type="button"
                                    className={`av-switch-pill ${file.enabled ? 'av-switch-pill--on' : 'av-switch-pill--off'}`}
                                    onClick={() => toggleFile(file.id)}
                                >
                                    {file.enabled ? <Check size={9} /> : <X size={9} />}
                                    <span>{file.enabled ? t('profiles.badges.on') : t('profiles.badges.off')}</span>
                                </button>
                                <button className="av-cf-card__remove" onClick={() => removeFile(file.id)} title={t('profiles.documents.remove')}>
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        </div>
                    ))}

                    {/* Pagination if files > 10 */}
                    {totalPages > 1 && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px', fontSize: 11, color: 'var(--av-text-muted)' }}>
                            <span>{t('profiles.documents.pagination', { page: safeCurrentPage, total: totalPages })}</span>
                            <div style={{ display: 'flex', gap: 4 }}>
                                <button type="button" className="av-pill" disabled={safeCurrentPage === 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>
                                    <ChevronLeft size={12} />
                                </button>
                                <button type="button" className="av-pill" disabled={safeCurrentPage === totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>
                                    <ChevronRight size={12} />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Upload Document Controls */}
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }} data-tour="documents">
                        <select
                            className="av-input"
                            style={{ width: '130px', fontSize: 11 }}
                            value={fileLabel}
                            onChange={(e) => setFileLabel(e.target.value as DocCategory)}
                        >
                            {(Object.keys(categoryText) as DocCategory[]).map((category) => (
                                <option key={category} value={category}>{categoryText[category].option}</option>
                            ))}
                        </select>

                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileSelect}
                            style={{ display: 'none' }}
                            accept=".pdf,.doc,.docx,.txt,.png,.jpg"
                        />

                        <button
                            type="button"
                            className="av-save-btn"
                            style={{ flex: 1, margin: 0, padding: '6px 12px', fontSize: 11 }}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <Upload size={12} />
                            <span>{categoryText[fileLabel].upload}</span>
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
