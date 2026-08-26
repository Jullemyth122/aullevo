import type { ChangeEvent } from 'react';
import type { UserData } from '../../types';

export interface ProfileFieldsProps {
    userData: Partial<UserData>;
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    inputClass?: string;
    labelClass?: string;
    rowClass?: string;
    showHeadline?: boolean;
    disabled?: boolean;
}

export function PersonalInfoFields({
    userData,
    onChange,
    inputClass = 'av-input',
    labelClass = 'av-label',
    rowClass = 'av-row',
    showHeadline = true,
    disabled = false,
}: ProfileFieldsProps) {
    return (
        <>
            <div className={rowClass}>
                <div>
                    <label className={labelClass}>First Name</label>
                    <input
                        className={inputClass}
                        name="firstName"
                        value={userData.firstName || ''}
                        onChange={onChange}
                        placeholder="Jane"
                        disabled={disabled}
                    />
                </div>
                <div>
                    <label className={labelClass}>Last Name</label>
                    <input
                        className={inputClass}
                        name="lastName"
                        value={userData.lastName || ''}
                        onChange={onChange}
                        placeholder="Doe"
                        disabled={disabled}
                    />
                </div>
            </div>

            <div>
                <label className={labelClass}>Email</label>
                <input
                    className={inputClass}
                    name="email"
                    type="email"
                    value={userData.email || ''}
                    onChange={onChange}
                    placeholder="jane@example.com"
                    disabled={disabled}
                />
            </div>

            <div>
                <label className={labelClass}>Phone</label>
                <input
                    className={inputClass}
                    name="phone"
                    type="tel"
                    value={userData.phone || ''}
                    onChange={onChange}
                    placeholder="+1 555 000 0000"
                    disabled={disabled}
                />
            </div>

            {showHeadline && (
                <div>
                    <label className={labelClass}>Headline / Professional Title</label>
                    <input
                        className={inputClass}
                        name="headline"
                        value={userData.headline || ''}
                        onChange={onChange}
                        placeholder="e.g. Senior Software Engineer"
                        disabled={disabled}
                    />
                </div>
            )}

            <div>
                <label className={labelClass}>Address</label>
                <input
                    className={inputClass}
                    name="address"
                    value={userData.address || ''}
                    onChange={onChange}
                    placeholder="Street address"
                    disabled={disabled}
                />
            </div>

            <div className={rowClass}>
                <div>
                    <label className={labelClass}>City</label>
                    <input
                        className={inputClass}
                        name="city"
                        value={userData.city || ''}
                        onChange={onChange}
                        placeholder="City"
                        disabled={disabled}
                    />
                </div>
                <div>
                    <label className={labelClass}>State / Province</label>
                    <input
                        className={inputClass}
                        name="state"
                        value={userData.state || ''}
                        onChange={onChange}
                        placeholder="State"
                        disabled={disabled}
                    />
                </div>
            </div>

            <div className={rowClass}>
                <div>
                    <label className={labelClass}>ZIP / Postal Code</label>
                    <input
                        className={inputClass}
                        name="zipCode"
                        value={userData.zipCode || ''}
                        onChange={onChange}
                        placeholder="ZIP"
                        disabled={disabled}
                    />
                </div>
                <div>
                    <label className={labelClass}>Country</label>
                    <input
                        className={inputClass}
                        name="country"
                        value={userData.country || ''}
                        onChange={onChange}
                        placeholder="Country"
                        disabled={disabled}
                    />
                </div>
            </div>
        </>
    );
}
