import { Check, X } from 'lucide-react';
import type { UserData } from '../../../types';

interface ProfileConfigCardProps {
    currentProfile: UserData;
    selectedProfileType: string;
    onUpdateProfile: (patch: Partial<UserData>) => void;
}

export function ProfileConfigCard({
    currentProfile,
    selectedProfileType,
    onUpdateProfile
}: ProfileConfigCardProps) {
    return (
        <div className="av-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="av-label">Profile Configuration</label>
                <button
                    type="button"
                    className={`av-switch-pill ${currentProfile.enabled ? 'av-switch-pill--on' : 'av-switch-pill--off'}`}
                    onClick={() => onUpdateProfile({ enabled: !currentProfile.enabled })}
                    title={currentProfile.enabled ? `${selectedProfileType.toUpperCase()} profile is active` : `${selectedProfileType.toUpperCase()} profile is disabled`}
                >
                    {currentProfile.enabled ? <Check size={9} /> : <X size={9} />}
                    <span>{currentProfile.enabled ? 'PROFILE ON' : 'PROFILE OFF'}</span>
                </button>
            </div>

            <div className="av-field" style={{ marginTop: 4 }}>
                <input
                    className="av-input"
                    value={currentProfile.profileName}
                    onChange={(e) => onUpdateProfile({ profileName: e.target.value })}
                    placeholder="Profile Name"
                />
            </div>
        </div>
    );
}
