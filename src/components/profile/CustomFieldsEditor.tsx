import { useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import type { CustomField } from '../../types';

export interface CustomFieldsEditorProps {
    customFields: CustomField[];
    onAdd: (field: CustomField) => void;
    onRemove: (index: number) => void;
    inputClass?: string;
    labelClass?: string;
    btnClass?: string;
    cardClass?: string;
    disabled?: boolean;
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
}: CustomFieldsEditorProps) {
    const [label, setLabel] = useState('');
    const [value, setValue] = useState('');
    const [context, setContext] = useState('');

    const handleAdd = () => {
        if (!label.trim()) return;
        onAdd({
            label: label.trim(),
            value: value.trim(),
            context: context.trim(),
        });
        setLabel('');
        setValue('');
        setContext('');
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
                            placeholder="e.g. Pronouns, Security Clearance, Target Level"
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Value to Fill</label>
                        <input
                            className={inputClass}
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            placeholder="e.g. They/Them, Secret, Staff"
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Matching Context (Optional)</label>
                        <input
                            className={inputClass}
                            value={context}
                            onChange={(e) => setContext(e.target.value)}
                            placeholder="e.g. Use when asking for preferred pronouns"
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
