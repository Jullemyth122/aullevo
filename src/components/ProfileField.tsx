import { Check, X, Lock, Globe } from 'lucide-react';
import type { CM } from '../types';
import { ContextPopover } from './ContextPopover';

interface ProfileFieldProps {
    label: string;
    field?: CM;
    // Standard generic pattern
    fieldKey?: string;
    onUpdate?: (fieldKey: string, updates: Partial<CM>) => void;
    onToggle?: (fieldKey: string) => void;
    // Direct handler pattern (for special fields like jobSkills)
    onChange?: (updates: Partial<CM>) => void;
    type?: string;
    placeholder?: string;
    alignRight?: boolean;
}

export const ProfileField = ({
    label,
    fieldKey,
    field,
    onUpdate,
    onToggle,
    onChange,
    type = 'text',
    placeholder,
    alignRight = false
}: ProfileFieldProps) => {
    if (!field) return null;

    // Use direct onChange if provided, otherwise fallback to generic onUpdate(fieldKey)
    const handleUpdate = (updates: Partial<CM>) => {
        if (onChange) {
            onChange(updates);
        } else if (onUpdate && fieldKey) {
            onUpdate(fieldKey, updates);
        }
    };
    const handleToggle = () => {
        if (onToggle) {
            onToggle(fieldKey || '');
        }
    };

    return (
        <div className="av-field">
            <div className="av-field__header">
                {/* Groups the sparkle icon and label neatly on the left */}
                <div className="av-field__label-wrap">
                    <ContextPopover
                        label={label}
                        context={field.context}
                        onChange={(ctx) => handleUpdate({ context: ctx })}
                        alignRight={alignRight}
                        disabled={!field.enabled}
                    />
                    <label className="av-label">{label}</label>
                </div>

                {/* Right-side Controls: Privacy Toggle + ON/OFF Switch */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                        type="button"
                        className={`av-privacy-pill ${field.isSensitive ? 'av-privacy-pill--sensitive' : 'av-privacy-pill--safe'}`}
                        onClick={() => handleUpdate({ isSensitive: !field.isSensitive })}
                        title={field.isSensitive
                            ? "Sensitive: Value is hidden from AI (Zero-Knowledge)"
                            : "AI Safe: Value is shared with AI for smart choice selection"}
                    >
                        {field.isSensitive ? <Lock size={8.5} /> : <Globe size={8.5} />}
                        <span>{field.isSensitive ? 'SENSITIVE' : 'AI SAFE'}</span>
                    </button>
                    <button
                        type="button"
                        className={`av-switch-pill ${field.enabled ? 'av-switch-pill--on' : 'av-switch-pill--off'}`}
                        onClick={handleToggle}
                    >
                        {field.enabled ? <Check size={9} /> : <X size={9} />}
                        <span>{field.enabled ? 'ON' : 'OFF'}</span>
                    </button>
                </div>
            </div>

            {/* Input field */}
            <input
                type={type}
                className={`av-input ${!field.enabled ? 'av-input--disabled' : ''}`}
                value={field.value || ''}
                placeholder={placeholder || label}
                onChange={(e) => handleUpdate({ value: e.target.value })}
                disabled={!field.enabled}
            />
        </div>
    );
};
