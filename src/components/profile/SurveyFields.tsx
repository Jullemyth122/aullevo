import type { ChangeEvent } from 'react';
import type { UserData } from '../../types';

export interface SurveyFieldsProps {
    userData: Partial<UserData>;
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    inputClass?: string;
    labelClass?: string;
    rowClass?: string;
    disabled?: boolean;
}

export function SurveyFields({
    userData,
    onChange,
    inputClass = 'av-input',
    labelClass = 'av-label',
    rowClass = 'av-row',
    disabled = false,
}: SurveyFieldsProps) {
    return (
        <>
            <div className={rowClass}>
                <div>
                    <label className={labelClass}>Occupation</label>
                    <input
                        className={inputClass}
                        name="occupation"
                        value={userData.occupation || ''}
                        onChange={onChange}
                        placeholder="e.g. Software Engineer, Teacher"
                        disabled={disabled}
                    />
                </div>
                <div>
                    <label className={labelClass}>Industry</label>
                    <input
                        className={inputClass}
                        name="industry"
                        value={userData.industry || ''}
                        onChange={onChange}
                        placeholder="e.g. Technology, Healthcare"
                        disabled={disabled}
                    />
                </div>
            </div>

            <div className={rowClass}>
                <div>
                    <label className={labelClass}>Education Level</label>
                    <input
                        className={inputClass}
                        name="educationLevel"
                        value={userData.educationLevel || ''}
                        onChange={onChange}
                        placeholder="e.g. Bachelor's Degree"
                        disabled={disabled}
                    />
                </div>
                <div>
                    <label className={labelClass}>Marital Status</label>
                    <input
                        className={inputClass}
                        name="maritalStatus"
                        value={userData.maritalStatus || ''}
                        onChange={onChange}
                        placeholder="e.g. Single, Married"
                        disabled={disabled}
                    />
                </div>
            </div>

            <div className={rowClass}>
                <div>
                    <label className={labelClass}>Date of Birth</label>
                    <input
                        className={inputClass}
                        name="dateOfBirth"
                        type="date"
                        value={userData.dateOfBirth || ''}
                        onChange={onChange}
                        disabled={disabled}
                    />
                </div>
                <div>
                    <label className={labelClass}>Gender</label>
                    <input
                        className={inputClass}
                        name="gender"
                        value={userData.gender || ''}
                        onChange={onChange}
                        placeholder="e.g. Female, Male, Non-binary"
                        disabled={disabled}
                    />
                </div>
            </div>
        </>
    );
}
