import type { ChangeEvent } from 'react';
import type { UserData } from '../../types';

export interface MedicalFieldsProps {
    userData: Partial<UserData>;
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    inputClass?: string;
    labelClass?: string;
    rowClass?: string;
    disabled?: boolean;
}

export function MedicalFields({
    userData,
    onChange,
    inputClass = 'av-input',
    labelClass = 'av-label',
    rowClass = 'av-row',
    disabled = false,
}: MedicalFieldsProps) {
    return (
        <>
            <div className={rowClass}>
                <div>
                    <label className={labelClass}>Emergency Contact Name</label>
                    <input
                        className={inputClass}
                        name="emergencyContactName"
                        value={userData.emergencyContactName || ''}
                        onChange={onChange}
                        placeholder="Full Name"
                        disabled={disabled}
                    />
                </div>
                <div>
                    <label className={labelClass}>Relationship</label>
                    <input
                        className={inputClass}
                        name="emergencyContactRelationship"
                        value={userData.emergencyContactRelationship || ''}
                        onChange={onChange}
                        placeholder="e.g. Spouse, Parent"
                        disabled={disabled}
                    />
                </div>
            </div>

            <div className={rowClass}>
                <div>
                    <label className={labelClass}>Emergency Phone</label>
                    <input
                        className={inputClass}
                        name="emergencyContactPhone"
                        type="tel"
                        value={userData.emergencyContactPhone || ''}
                        onChange={onChange}
                        placeholder="+1 555 000 0000"
                        disabled={disabled}
                    />
                </div>
                <div>
                    <label className={labelClass}>Blood Type</label>
                    <input
                        className={inputClass}
                        name="bloodType"
                        value={userData.bloodType || ''}
                        onChange={onChange}
                        placeholder="e.g. O+, A-, B+"
                        disabled={disabled}
                    />
                </div>
            </div>

            <div>
                <label className={labelClass}>Allergies</label>
                <input
                    className={inputClass}
                    name="allergies"
                    value={userData.allergies || ''}
                    onChange={onChange}
                    placeholder="e.g. Penicillin, Peanuts (or None)"
                    disabled={disabled}
                />
            </div>

            <div>
                <label className={labelClass}>Medical Conditions</label>
                <input
                    className={inputClass}
                    name="medicalConditions"
                    value={userData.medicalConditions || ''}
                    onChange={onChange}
                    placeholder="e.g. Asthma, Hypertension (or None)"
                    disabled={disabled}
                />
            </div>

            <div>
                <label className={labelClass}>Current Medications</label>
                <input
                    className={inputClass}
                    name="medications"
                    value={userData.medications || ''}
                    onChange={onChange}
                    placeholder="e.g. Lisinopril 10mg daily"
                    disabled={disabled}
                />
            </div>

            <div className={rowClass}>
                <div>
                    <label className={labelClass}>Insurance Provider</label>
                    <input
                        className={inputClass}
                        name="insuranceProvider"
                        value={userData.insuranceProvider || ''}
                        onChange={onChange}
                        placeholder="e.g. Blue Cross, Kaiser"
                        disabled={disabled}
                    />
                </div>
                <div>
                    <label className={labelClass}>Policy Number</label>
                    <input
                        className={inputClass}
                        name="policyNumber"
                        value={userData.policyNumber || ''}
                        onChange={onChange}
                        placeholder="e.g. ABC-123456789"
                        disabled={disabled}
                    />
                </div>
            </div>
        </>
    );
}
