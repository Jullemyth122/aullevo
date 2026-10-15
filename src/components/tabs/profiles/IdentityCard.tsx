import { useState } from 'react'; // <--- Add useState
import { ChevronDown } from 'lucide-react'; // <--- Add ChevronDown
import type { UserData, CM } from '../../../types';
import { ProfileField } from '../../ProfileField';
import { useT } from '../../../i18n';

interface IdentityCardProps {
    currentProfile: UserData;
    onUpdateField: (fieldKey: string, updates: Partial<CM>) => void;
    onToggleField: (fieldKey: string) => void;
}

export function IdentityCard({
    currentProfile,
    onUpdateField,
    onToggleField
}: IdentityCardProps) {
    const { t } = useT();
    const [isOpen, setIsOpen] = useState(true); // <--- Add toggle state

    if (!('firstName' in currentProfile)) return null;
    const prof = currentProfile as any;

    return (
        <div className={`av-card-${currentProfile.enabled ? 'active' : 'disabled'}`} aria-disabled={!currentProfile.enabled}>
            <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none', paddingBottom: isOpen ? 8 : 0 }}
                onClick={() => setIsOpen(!isOpen)}
                data-tour="identity"
            >
                <div className="av-label" style={{ margin: 0 }}>{t('profiles.identity.title')}</div>
                <ChevronDown size={14} style={{ color: 'var(--av-text-muted)', transition: 'transform 0.2s ease', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
            </div>

            {isOpen && (
                <>
                    <div className="av-row">
                        <ProfileField label={t('profiles.identity.firstName')} fieldKey="firstName" field={prof.firstName} onUpdate={onUpdateField} onToggle={onToggleField} />
                        <ProfileField label={t('profiles.identity.lastName')} fieldKey="lastName" field={prof.lastName} onUpdate={onUpdateField} onToggle={onToggleField} alignRight />
                    </div>
                    <ProfileField label={t('profiles.identity.email')} fieldKey="email" field={prof.email} onUpdate={onUpdateField} onToggle={onToggleField} type="email" />
                    <ProfileField label={t('profiles.identity.phone')} fieldKey="phone" field={prof.phone} onUpdate={onUpdateField} onToggle={onToggleField} />
                    <ProfileField label={t('profiles.identity.address')} fieldKey="address" field={prof.address} onUpdate={onUpdateField} onToggle={onToggleField} />
                </>
            )}
        </div>
    );
}
