import { Check, X, Trash2, Plus } from 'lucide-react';
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
    const isGeneral = (f: CM) => isGeneralCustomField(f, selectedProfileType);

    return (
        <div
            className={`av-card-${currentProfile.enabled ? 'active' : 'disabled'}`}
            aria-disabled={!currentProfile.enabled}
        >
            <div className="av-label">Custom Fields ({(currentProfile.customFields || []).length})</div>

            {(currentProfile.customFields || [])
                .filter(isGeneral)
                .map((field) => (
                    <div
                        key={field.id}
                        className={`av-cf-card-${field.enabled ? 'active' : 'disabled'}`}
                        aria-disabled={!field.enabled}
                    >
                        <div>
                            {/* Label with Context Sparkle Popover */}
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
                                className={`av-switch-pill ${field.enabled ? 'av-switch-pill--on' : 'av-switch-pill--off'}`}
                                onClick={() => onToggleCustomField(field.id)}
                                title={field.enabled ? 'Field enabled' : 'Field disabled'}
                            >
                                {field.enabled ? <Check size={9} /> : <X size={9} />}
                                <span>{field.enabled ? 'ON' : 'OFF'}</span>
                            </button>
                            <button
                                className="av-cf-card__remove"
                                onClick={() => onRemoveCustomField(field.id)}
                                title="Delete field"
                            >
                                <Trash2 size={13} />
                            </button>
                        </div>
                    </div>
                ))}

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
                    className="av-pill av-pill--active"
                    onClick={onAddCustomField}
                    title="Add custom field"
                    style={{ padding: '0 8px' }}
                >
                    <Plus size={14} />
                </button>
            </div>
        </div>
    );
}
