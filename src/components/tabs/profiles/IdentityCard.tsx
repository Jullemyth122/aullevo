import { useState } from 'react'; // <--- Add useState
import { ChevronDown } from 'lucide-react'; // <--- Add ChevronDown
import type { UserData, CM } from '../../../types';
import { ProfileField } from '../../ProfileField';
import { isIdentityField } from '../../../utils/predicates';

interface IdentityCardProps {
    currentProfile: UserData;
    onUpdateField: (fieldKey: string, updates: Partial<CM>) => void;
    onToggleField: (fieldKey: string) => void;
    onUpdateCustomField: (id: string, updates: Partial<CM>) => void;
    onToggleCustomField: (id: string) => void;
}

export function IdentityCard({
    currentProfile,
    onUpdateField,
    onToggleField,
    onUpdateCustomField,
    onToggleCustomField
}: IdentityCardProps) {
    const [isOpen, setIsOpen] = useState(true); // <--- Add toggle state

    if (!('firstName' in currentProfile)) return null;
    const prof = currentProfile as any;

    return (
        <div className={`av-card-${currentProfile.enabled ? 'active' : 'disabled'}`} aria-disabled={!currentProfile.enabled}>
            <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none', paddingBottom: isOpen ? 8 : 0 }}
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="av-label" style={{ margin: 0 }}>Identity & Contact</div>
                <ChevronDown size={14} style={{ color: 'var(--av-text-muted)', transition: 'transform 0.2s ease', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
            </div>

            {isOpen && (
                <>
                    <div className="av-row">
                        <ProfileField label="First Name" fieldKey="firstName" field={prof.firstName} onUpdate={onUpdateField} onToggle={onToggleField} />
                        <ProfileField label="Last Name" fieldKey="lastName" field={prof.lastName} onUpdate={onUpdateField} onToggle={onToggleField} alignRight />
                    </div>
                    <ProfileField label="Email Address" fieldKey="email" field={prof.email} onUpdate={onUpdateField} onToggle={onToggleField} type="email" />
                    <ProfileField label="Phone Number" fieldKey="phone" field={prof.phone} onUpdate={onUpdateField} onToggle={onToggleField} />
                    <ProfileField label="Residential Address" fieldKey="address" field={prof.address} onUpdate={onUpdateField} onToggle={onToggleField} />

                    {(currentProfile.customFields || [])
                        .filter(isIdentityField)
                        .map(field => (
                            <ProfileField
                                key={field.id}
                                label={field.label}
                                field={field}
                                onChange={(updates) => onUpdateCustomField(field.id, updates)}
                                onToggle={() => onToggleCustomField(field.id)}
                            />
                        ))
                    }
                </>
            )}
        </div>
    );
}
