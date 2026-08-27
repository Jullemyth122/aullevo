import { useState, type KeyboardEvent } from 'react';
import { Trash2, Plus } from 'lucide-react';
import type { CustomField } from '../../types';

export interface CustomFieldDraft {
    label: string;
    value: string;
    context: string;
}

export interface CustomFieldsEditorProps {
    customFields: CustomField[];
    onAdd: (field: CustomField) => void;
    onRemove: (index: number) => void;
    inputClass?: string;
    labelClass?: string;
    btnClass?: string;
    cardClass?: string;
    disabled?: boolean;
    draft?: CustomFieldDraft;
    onDraftChange?: (draft: CustomFieldDraft) => void;
}

export function CustomFieldsEditor({
    customFields,
    onAdd,
    onRemove,
    inputClass = 'av-input',
    labelClass = 'av-label',
    btnClass = 'av-filelib__add-btn',
    cardClass = 'av-custom-field-item',
    disabled = false,
    draft,
    onDraftChange,
}: CustomFieldsEditorProps) {
    const [localLabel, setLocalLabel] = useState('');
    const [localValue, setLocalValue] = useState('');
    const [localContext, setLocalContext] = useState('');

    const label = draft !== undefined ? draft.label : localLabel;
    const value = draft !== undefined ? draft.value : localValue;
    const context = draft !== undefined ? draft.context : localContext;

    const setLabel = (val: string) => {
        if (onDraftChange && draft) {
            onDraftChange({ ...draft, label: val });
        } else {
            setLocalLabel(val);
        }
    };

    const setValue = (val: string) => {
        if (onDraftChange && draft) {
            onDraftChange({ ...draft, value: val });
        } else {
            setLocalValue(val);
        }
    };

    const setContext = (val: string) => {
        if (onDraftChange && draft) {
            onDraftChange({ ...draft, context: val });
        } else {
            setLocalContext(val);
        }
    };

    const handleAdd = () => {
        const trimmedLabel = label.trim();
        const trimmedValue = value.trim();
        const trimmedContext = context.trim();

        if (!trimmedLabel && !trimmedValue) return;

        onAdd({
            label: trimmedLabel || trimmedValue || 'Custom Field',
            value: trimmedValue,
            context: trimmedContext,
        });

        if (onDraftChange) {
            onDraftChange({ label: '', value: '', context: '' });
        } else {
            setLocalLabel('');
            setLocalValue('');
            setLocalContext('');
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAdd();
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {customFields.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--av-text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
                    No custom fields defined yet.
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {customFields.map((cf, idx) => (
                        <div
                            key={`${cf.label}-${idx}`}
                            className={cardClass}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'flex-start',
                                padding: 8,
                                borderRadius: 6,
                                background: 'var(--av-surface-alt, rgba(255,255,255,0.03))',
                                border: '1px solid var(--av-border, rgba(255,255,255,0.08))',
                            }}
                        >
                            <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--av-text, #ffffff)' }}>{cf.label}</div>
                                <div style={{ fontSize: 12, color: 'var(--av-text-mid, #cbd5e1)', wordBreak: 'break-word', marginTop: 2 }}>
                                    {cf.value || <span style={{ opacity: 0.5 }}>(empty)</span>}
                                </div>
                                {cf.context && (
                                    <div style={{ fontSize: 11, color: 'var(--av-text-muted, #94a3b8)', marginTop: 2 }}>
                                        Context: {cf.context}
                                    </div>
                                )}
                            </div>
                            {!disabled && (
                                <button
                                    type="button"
                                    onClick={() => onRemove(idx)}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'var(--av-error, #f87171)',
                                        cursor: 'pointer',
                                        padding: 4,
                                        display: 'flex',
                                        alignItems: 'center',
                                    }}
                                    title="Delete custom field"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {!disabled && (
                <div
                    style={{
                        padding: 10,
                        borderRadius: 8,
                        background: 'var(--av-surface-alt, rgba(255,255,255,0.02))',
                        border: '1px dashed var(--av-border, rgba(255,255,255,0.12))',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                    }}
                >
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--av-text-muted)' }}>
                        Add Custom Field
                    </div>
                    <div>
                        <label className={labelClass}>Field Label / Name</label>
                        <input
                            className={inputClass}
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="e.g. Date of Birth, Pronouns, Security Clearance"
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Value to Fill</label>
                        <input
                            className={inputClass}
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="e.g. 20/08/11, He/Him, Top Secret"
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Matching Context (Optional)</label>
                        <input
                            className={inputClass}
                            value={context}
                            onChange={(e) => setContext(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="e.g. Use when asking for birthday or date of birth"
                        />
                    </div>
                    <button
                        type="button"
                        className={btnClass}
                        style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}
                        onClick={handleAdd}
                    >
                        <Plus size={14} /> Add Field
                    </button>
                </div>
            )}
        </div>
    );
}
