import { useState, useEffect } from 'react';
import { Check, X, Trash2, Plus, ChevronDown, ChevronLeft, ChevronRight, Lock, Globe } from 'lucide-react';
import type { UserData, CM } from '../../../types';
import { ContextPopover } from '../../ContextPopover';
import { isGeneralCustomField } from '../../../utils/predicates';

interface CustomFieldsCardProps {
    currentProfile: UserData;
    selectedProfileType: string;
    newFieldLabel: string;
    onChangeNewFieldLabel: (label: string) => void;
    newFieldValue: string;
    onChangeNewFieldValue: (val: string) => void;
    onAddCustomField: () => void;
    onToggleCustomField: (id: string) => void;
    onUpdateCustomField: (id: string, updates: Partial<CM>) => void;
    onRemoveCustomField: (id: string) => void;
}

// 10 items per page limit
const ITEMS_PER_PAGE = 10;

export function CustomFieldsCard({
    currentProfile,
    selectedProfileType,
    newFieldLabel,
    onChangeNewFieldLabel,
    newFieldValue,
    onChangeNewFieldValue,
    onAddCustomField,
    onToggleCustomField,
    onUpdateCustomField,
    onRemoveCustomField
}: CustomFieldsCardProps) {
    const [isOpen, setIsOpen] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);

    const isGeneral = (f: CM) => isGeneralCustomField(f, selectedProfileType);
    const allGeneralFields = (currentProfile.customFields || []).filter(isGeneral);

    // Pagination calculations
    const totalPages = Math.max(1, Math.ceil(allGeneralFields.length / ITEMS_PER_PAGE));
    const safeCurrentPage = Math.min(currentPage, totalPages);
    const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
    const paginatedFields = allGeneralFields.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    // Auto-clamp page if items get deleted
    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    return (
        <div
            className={`av-card-${currentProfile.enabled ? 'active' : 'disabled'}`}
            aria-disabled={!currentProfile.enabled}
        >
            {/* Clickable Header for Collapsing */}
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
                    <span>Custom Fields</span>
                    <span style={{ fontSize: 10, opacity: 0.7 }}>({allGeneralFields.length})</span>
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

            {/* Collapsible Content */}
            {isOpen && (
                <>
                    {paginatedFields.map((field) => (
                        <div
                            key={field.id}
                            className={`av-cf-card-${field.enabled ? 'active' : 'disabled'}`}
                            aria-disabled={!field.enabled}
                        >
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <ContextPopover
                                        label={field.label}
                                        context={field.context}
                                        onChange={(ctx) => onUpdateCustomField(field.id, { context: ctx })}
                                        disabled={!field.enabled}
                                    />
                                    <input
                                        className="av-cf-input-label"
                                        value={field.label}
                                        onChange={(e) => onUpdateCustomField(field.id, { label: e.target.value })}
                                        disabled={!field.enabled}
                                        placeholder="Field Label"
                                    />
                                </div>
                                <input
                                    className="av-cf-input-value"
                                    value={field.value}
                                    onChange={(e) => onUpdateCustomField(field.id, { value: e.target.value })}
                                    disabled={!field.enabled}
                                    placeholder="Field Value"
                                />
                            </div>
                            <div className="av-cf-card__actions">
                                <button
                                    type="button"
                                    className={`av-privacy-pill ${field.isSensitive ? 'av-privacy-pill--sensitive' : 'av-privacy-pill--safe'}`}
                                    onClick={() => onUpdateCustomField(field.id, { isSensitive: !field.isSensitive })}
                                    title={field.isSensitive
                                        ? "Sensitive: Value is hidden from AI"
                                        : "AI Safe: Value is shared with AI"}
                                >
                                    {field.isSensitive ? <Lock size={8.5} /> : <Globe size={8.5} />}
                                    <span>{field.isSensitive ? 'SENSITIVE' : 'AI SAFE'}</span>
                                </button>
                                <button
                                    type="button"
                                    className={`av-switch-pill ${field.enabled ? 'av-switch-pill--on' : 'av-switch-pill--off'}`}
                                    onClick={() => onToggleCustomField(field.id)}
                                    title={field.enabled ? 'Field enabled' : 'Field disabled'}
                                >
                                    {field.enabled ? <Check size={9} /> : <X size={9} />}
                                    <span>{field.enabled ? 'ON' : 'OFF'}</span>
                                </button>
                                <button
                                    type="button"
                                    className="av-cf-card__remove"
                                    onClick={() => onRemoveCustomField(field.id)}
                                    title="Delete field"
                                >
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        </div>
                    ))}

                    {/* Pagination Controls (Always shows if > 0 items, buttons disable when on first/last page) */}
                    {allGeneralFields.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 4px', fontSize: 11, color: 'var(--av-text-muted)' }}>
                            <span>Page {safeCurrentPage} of {totalPages} ({allGeneralFields.length} items)</span>
                            {totalPages > 1 && (
                                <div style={{ display: 'flex', gap: 4 }}>
                                    <button
                                        type="button"
                                        className="av-pill"
                                        style={{ padding: '2px 8px', opacity: safeCurrentPage === 1 ? 0.4 : 1, cursor: safeCurrentPage === 1 ? 'not-allowed' : 'pointer' }}
                                        disabled={safeCurrentPage === 1}
                                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                    >
                                        <ChevronLeft size={12} />
                                    </button>
                                    <button
                                        type="button"
                                        className="av-pill"
                                        style={{ padding: '2px 8px', opacity: safeCurrentPage === totalPages ? 0.4 : 1, cursor: safeCurrentPage === totalPages ? 'not-allowed' : 'pointer' }}
                                        disabled={safeCurrentPage === totalPages}
                                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                    >
                                        <ChevronRight size={12} />
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Add Custom Field Form */}
                    <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                        <input
                            className="av-input"
                            placeholder="Label"
                            value={newFieldLabel}
                            onChange={(e) => onChangeNewFieldLabel(e.target.value)}
                        />
                        <input
                            className="av-input"
                            placeholder="Value"
                            value={newFieldValue}
                            onChange={(e) => onChangeNewFieldValue(e.target.value)}
                        />
                        <button
                            type="button"
                            className="av-pill av-pill--active"
                            onClick={onAddCustomField}
                            title="Add custom field"
                            style={{ padding: '0 8px' }}
                        >
                            <Plus size={14} />
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
