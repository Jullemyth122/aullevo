import type { ChangeEvent } from 'react';
import type { UserData } from '../../types';

export interface JobDetailsFieldsProps {
    userData: Partial<UserData>;
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    inputClass?: string;
    labelClass?: string;
    rowClass?: string;
    disabled?: boolean;
}

export function JobDetailsFields({
    userData,
    onChange,
    inputClass = 'av-input',
    labelClass = 'av-label',
    rowClass = 'av-row',
    disabled = false,
}: JobDetailsFieldsProps) {
    return (
        <>
            <div className={rowClass}>
                <div>
                    <label className={labelClass}>Years of Experience</label>
                    <input
                        className={inputClass}
                        name="yearsOfExperience"
                        value={userData.yearsOfExperience || ''}
                        onChange={onChange}
                        placeholder="e.g. 5"
                        disabled={disabled}
                    />
                </div>
                <div>
                    <label className={labelClass}>Salary Expectation</label>
                    <input
                        className={inputClass}
                        name="salaryExpectation"
                        value={userData.salaryExpectation || ''}
                        onChange={onChange}
                        placeholder="e.g. $120,000 / yr"
                        disabled={disabled}
                    />
                </div>
            </div>

            <div className={rowClass}>
                <div>
                    <label className={labelClass}>Notice Period</label>
                    <input
                        className={inputClass}
                        name="noticePeriod"
                        value={userData.noticePeriod || ''}
                        onChange={onChange}
                        placeholder="e.g. 2 weeks"
                        disabled={disabled}
                    />
                </div>
                <div>
                    <label className={labelClass}>Work Authorization</label>
                    <input
                        className={inputClass}
                        name="workAuthorization"
                        value={userData.workAuthorization || ''}
                        onChange={onChange}
                        placeholder="e.g. US Citizen / Green Card"
                        disabled={disabled}
                    />
                </div>
            </div>

            <div>
                <label className={labelClass}>LinkedIn URL</label>
                <input
                    className={inputClass}
                    name="linkedin"
                    value={userData.linkedin || ''}
                    onChange={onChange}
                    placeholder="https://linkedin.com/in/..."
                    disabled={disabled}
                />
            </div>

            <div className={rowClass}>
                <div>
                    <label className={labelClass}>Portfolio URL</label>
                    <input
                        className={inputClass}
                        name="portfolio"
                        value={userData.portfolio || ''}
                        onChange={onChange}
                        placeholder="https://myportfolio.com"
                        disabled={disabled}
                    />
                </div>
                <div>
                    <label className={labelClass}>GitHub URL</label>
                    <input
                        className={inputClass}
                        name="github"
                        value={userData.github || ''}
                        onChange={onChange}
                        placeholder="https://github.com/..."
                        disabled={disabled}
                    />
                </div>
            </div>

            <div>
                <label className={labelClass}>Professional Summary</label>
                <textarea
                    className={inputClass}
                    name="summary"
                    rows={3}
                    value={userData.summary || ''}
                    onChange={onChange}
                    placeholder="Brief overview of your background and strengths..."
                    disabled={disabled}
                />
            </div>
        </>
    );
}
