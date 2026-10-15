import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

import type {
    UserData,
    CM,
    JobUserData,
    MedicalUserData,
    GovernmentUserData,
    SurveyUserData,
    AcademicUserData,
    FinancialUserData
} from '../../../types';
import { ProfileField } from '../../ProfileField';
import { PROFILE_OPTIONS } from '../../../config/profileOptions';
import { useT } from '../../../i18n';

interface DomainAttributesCardProps {
    currentProfile: UserData;
    selectedProfileType: string;
    onUpdateField: (fieldKey: string, updates: Partial<CM>) => void;
    onToggleField: (fieldKey: string) => void;
    onUpdateJobSkills: (updates: Partial<CM>) => void;
    onUpdateMedicalAllergies: (updates: Partial<CM>) => void;
}

export function DomainAttributesCard({
    currentProfile,
    selectedProfileType,
    onUpdateField,
    onToggleField,
    onUpdateJobSkills,
    onUpdateMedicalAllergies
}: DomainAttributesCardProps) {
    const { t } = useT();
    const [isOpen, setIsOpen] = useState<boolean>(true);

    const jobData = currentProfile.profileType === 'job' ? (currentProfile as JobUserData) : null;
    const medData = currentProfile.profileType === 'medical' ? (currentProfile as MedicalUserData) : null;
    const govData = currentProfile.profileType === 'government' ? (currentProfile as GovernmentUserData) : null;
    const survData = currentProfile.profileType === 'survey' ? (currentProfile as SurveyUserData) : null;
    const acadData = currentProfile.profileType === 'academic' ? (currentProfile as AcademicUserData) : null;
    const finData = currentProfile.profileType === 'financial' ? (currentProfile as FinancialUserData) : null;

    const jobSkills = jobData?.skills?.[0] || { id: 'job_sk1', label: 'Skills', value: '', enabled: true, isSensitive: false, context: 'Skills' };
    const medAllergies = medData?.allergies?.[0] || { id: 'med_alg', label: 'Allergies', value: '', enabled: true, isSensitive: true, context: 'Allergies' };

    // Built-in types show their translated name; user-made profiles keep their code
    const typeName = PROFILE_OPTIONS.find((o) => o.type === selectedProfileType)?.label() ?? selectedProfileType.toUpperCase();

    return (
        <div
            className={`av-card-${currentProfile.enabled ? 'active' : 'disabled'}`}
            aria-disabled={!currentProfile.enabled}
        >
            {/* Clickable Header for Collapsing */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    userSelect: 'none',
                    paddingBottom: isOpen ? 8 : 0
                }}
                onClick={() => setIsOpen(!isOpen)}
                data-tour="attributes"
            >
                <div className="av-label" style={{ margin: 0, color: 'var(--av-violet)' }}>
                    {t('profiles.attributes.title', { type: typeName })}
                </div>
                <ChevronDown
                    size={14}
                    style={{
                        color: 'var(--av-text-muted)',
                        transition: 'transform 0.2s ease',
                        transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)'
                    }}
                />
            </div>

            {/* Collapsible Content */}
            {isOpen && (
                <>
                    {/* 1. Job Profile */}
                    {selectedProfileType === 'job' && jobData && (
                        <>
                            <ProfileField label={t('profiles.attributes.job.headline')} fieldKey="headline" field={jobData.headline} onUpdate={onUpdateField} onToggle={onToggleField} />
                            <div className="av-row">
                                <ProfileField label={t('profiles.attributes.job.linkedin')} fieldKey="linkedin" field={jobData.linkedin} onUpdate={onUpdateField} onToggle={onToggleField} />
                                <ProfileField label={t('profiles.attributes.job.github')} fieldKey="github" field={jobData.github} onUpdate={onUpdateField} onToggle={onToggleField} alignRight />
                            </div>
                            <ProfileField label={t('profiles.attributes.job.portfolio')} fieldKey="portfolio" field={jobData.portfolio} onUpdate={onUpdateField} onToggle={onToggleField} />
                            <ProfileField label={t('profiles.attributes.job.skills')} fieldKey="jobSkills" field={jobSkills} onChange={onUpdateJobSkills} onToggle={() => onUpdateJobSkills({ enabled: !jobSkills.enabled })} />
                            <ProfileField label={t('profiles.attributes.job.education')} fieldKey="education" field={jobData.education} onUpdate={onUpdateField} onToggle={onToggleField} />
                            <ProfileField label={t('profiles.attributes.job.certifications')} fieldKey="certifications" field={jobData.certifications} onUpdate={onUpdateField} onToggle={onToggleField} />
                            {/* Inside Academic Profile block */}
                        </>
                    )}

                    {/* 2. Medical Profile */}
                    {selectedProfileType === 'medical' && medData && (
                        <>
                            <div className="av-row">
                                <ProfileField label={t('profiles.attributes.medical.bloodType')} fieldKey="bloodType" field={medData.bloodType} onUpdate={onUpdateField} onToggle={onToggleField} />
                                <ProfileField label={t('profiles.attributes.medical.allergies')} field={medAllergies} onChange={onUpdateMedicalAllergies} onToggle={() => onUpdateMedicalAllergies({ enabled: !medAllergies.enabled })} alignRight />
                            </div>
                            <ProfileField label={t('profiles.attributes.medical.emergencyContact')} fieldKey="emergencyContactName" field={medData.emergencyContactName} onUpdate={onUpdateField} onToggle={onToggleField} />
                            <ProfileField label={t('profiles.attributes.medical.insuranceProvider')} fieldKey="insuranceProvider" field={medData.insuranceProvider} onUpdate={onUpdateField} onToggle={onToggleField} />
                        </>
                    )}

                    {/* 3. Government Profile */}
                    {selectedProfileType === 'government' && govData && (
                        <>
                            <div className="av-row">
                                <ProfileField label={t('profiles.attributes.government.nationalId')} fieldKey="nationalIdOrSSN" field={govData.nationalIdOrSSN} onUpdate={onUpdateField} onToggle={onToggleField} />
                                <ProfileField label={t('profiles.attributes.government.citizenship')} fieldKey="citizenship" field={govData.citizenship} onUpdate={onUpdateField} onToggle={onToggleField} alignRight />
                            </div>
                            <div className="av-row">
                                <ProfileField label={t('profiles.attributes.government.passport')} fieldKey="passportNumber" field={govData.passportNumber} onUpdate={onUpdateField} onToggle={onToggleField} />
                                <ProfileField label={t('profiles.attributes.government.driversLicense')} fieldKey="driversLicenseNumber" field={govData.driversLicenseNumber} onUpdate={onUpdateField} onToggle={onToggleField} alignRight />
                            </div>
                        </>
                    )}

                    {/* 4. Survey Profile */}
                    {selectedProfileType === 'survey' && survData && (
                        <>
                            <div className="av-row">
                                <ProfileField label={t('profiles.attributes.survey.ageRange')} fieldKey="ageRange" field={survData.ageRange} onUpdate={onUpdateField} onToggle={onToggleField} />
                                <ProfileField label={t('profiles.attributes.survey.income')} fieldKey="householdIncomeRange" field={survData.householdIncomeRange} onUpdate={onUpdateField} onToggle={onToggleField} alignRight />
                            </div>
                            <div className="av-row">
                                <ProfileField label={t('profiles.attributes.survey.education')} fieldKey="educationLevel" field={survData.educationLevel} onUpdate={onUpdateField} onToggle={onToggleField} />
                                <ProfileField label={t('profiles.attributes.survey.employment')} fieldKey="employmentStatus" field={survData.employmentStatus} onUpdate={onUpdateField} onToggle={onToggleField} alignRight />
                            </div>
                        </>
                    )}

                    {/* 5. Academic Profile */}
                    {selectedProfileType === 'academic' && acadData && (
                        <>
                            <ProfileField label={t('profiles.attributes.academic.institution')} fieldKey="institutionName" field={acadData.institutionName} onUpdate={onUpdateField} onToggle={onToggleField} />
                            <ProfileField label={t('profiles.attributes.academic.major')} fieldKey="majorOrFieldOfStudy" field={acadData.majorOrFieldOfStudy} onUpdate={onUpdateField} onToggle={onToggleField} />
                            <div className="av-row">
                                <ProfileField label={t('profiles.attributes.academic.gpa')} fieldKey="gpaOrGrade" field={acadData.gpaOrGrade} onUpdate={onUpdateField} onToggle={onToggleField} />
                                <ProfileField label={t('profiles.attributes.academic.gradYear')} fieldKey="graduationYearOrExpected" field={acadData.graduationYearOrExpected} onUpdate={onUpdateField} onToggle={onToggleField} alignRight />
                            </div>
                            <ProfileField label={t('profiles.attributes.academic.testScores')} fieldKey="standardizedTestScores" field={acadData.standardizedTestScores} onUpdate={onUpdateField} onToggle={onToggleField} />
                        </>
                    )}

                    {/* 6. Financial Profile */}
                    {selectedProfileType === 'financial' && finData && (
                        <>
                            <ProfileField label={t('profiles.attributes.financial.billingAddress')} fieldKey="billingAddress" field={finData.billingAddress} onUpdate={onUpdateField} onToggle={onToggleField} />
                            <div className="av-row">
                                <ProfileField label={t('profiles.attributes.financial.payment')} fieldKey="preferredPaymentMethod" field={finData.preferredPaymentMethod} onUpdate={onUpdateField} onToggle={onToggleField} />
                                <ProfileField label={t('profiles.attributes.financial.cardholder')} fieldKey="cardholderName" field={finData.cardholderName} onUpdate={onUpdateField} onToggle={onToggleField} alignRight />
                            </div>
                        </>
                    )}

                    {!['job', 'medical', 'government', 'survey', 'academic', 'financial'].includes(selectedProfileType) && (
                            <div style={{ fontSize: 11, color: 'var(--av-text-muted)' }}>
                                {t('profiles.attributes.customHint')}
                            </div>
                        )
                    }
                </>
            )}
        </div>
    );
}
