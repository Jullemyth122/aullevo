import { useState, useEffect } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

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
import { isAttributeField } from '../../../utils/predicates';

interface DomainAttributesCardProps {
    currentProfile: UserData;
    selectedProfileType: string;
    onUpdateField: (fieldKey: string, updates: Partial<CM>) => void;
    onToggleField: (fieldKey: string) => void;
    onUpdateJobSkills: (updates: Partial<CM>) => void;
    onUpdateMedicalAllergies: (updates: Partial<CM>) => void;
    onUpdateCustomField: (id: string, updates: Partial<CM>) => void;
    onToggleCustomField: (id: string) => void;
}

const ITEMS_PER_PAGE = 10;

export function DomainAttributesCard({
    currentProfile,
    selectedProfileType,
    onUpdateField,
    onToggleField,
    onUpdateJobSkills,
    onUpdateMedicalAllergies,
    onUpdateCustomField,
    onToggleCustomField
}: DomainAttributesCardProps) {
    const [isOpen, setIsOpen] = useState<boolean>(true);
    const [attrPage, setAttrPage] = useState<number>(1);

    const jobData = currentProfile.profileType === 'job' ? (currentProfile as JobUserData) : null;
    const medData = currentProfile.profileType === 'medical' ? (currentProfile as MedicalUserData) : null;
    const govData = currentProfile.profileType === 'government' ? (currentProfile as GovernmentUserData) : null;
    const survData = currentProfile.profileType === 'survey' ? (currentProfile as SurveyUserData) : null;
    const acadData = currentProfile.profileType === 'academic' ? (currentProfile as AcademicUserData) : null;
    const finData = currentProfile.profileType === 'financial' ? (currentProfile as FinancialUserData) : null;

    const jobSkills = jobData?.skills?.[0] || { id: 'job_sk1', label: 'Skills', value: '', enabled: true, isSensitive: false, context: 'Skills' };
    const medAllergies = medData?.allergies?.[0] || { id: 'med_alg', label: 'Allergies', value: '', enabled: true, isSensitive: true, context: 'Allergies' };

    // 10-item pagination calculations for custom attributes
    const isCurrentAttribute = (f: CM) => isAttributeField(f, selectedProfileType);
    const customAttributes = (currentProfile.customFields || []).filter(isCurrentAttribute);

    const totalAttrPages = Math.max(1, Math.ceil(customAttributes.length / ITEMS_PER_PAGE));
    const safeAttrPage = Math.min(attrPage, totalAttrPages);
    const paginatedAttributes = customAttributes.slice((safeAttrPage - 1) * ITEMS_PER_PAGE, safeAttrPage * ITEMS_PER_PAGE);

    // Auto-clamp page if custom attributes are removed
    useEffect(() => {
        if (attrPage > totalAttrPages) {
            setAttrPage(totalAttrPages);
        }
    }, [attrPage, totalAttrPages]);

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
            >
                <div className="av-label" style={{ margin: 0, color: 'var(--av-violet)' }}>
                    {selectedProfileType.toUpperCase()} Attributes
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
                            <ProfileField label="Headline / Title" fieldKey="headline" field={jobData.headline} onUpdate={onUpdateField} onToggle={onToggleField} />
                            <div className="av-row">
                                <ProfileField label="LinkedIn" fieldKey="linkedin" field={jobData.linkedin} onUpdate={onUpdateField} onToggle={onToggleField} />
                                <ProfileField label="GitHub" fieldKey="github" field={jobData.github} onUpdate={onUpdateField} onToggle={onToggleField} alignRight />
                            </div>
                            <ProfileField label="Portfolio" fieldKey="portfolio" field={jobData.portfolio} onUpdate={onUpdateField} onToggle={onToggleField} />
                            <ProfileField label="Skills" fieldKey="jobSkills" field={jobSkills} onChange={onUpdateJobSkills} onToggle={() => onUpdateJobSkills({ enabled: !jobSkills.enabled })} />
                            <ProfileField label="Education / Degree" fieldKey="education" field={jobData.education} onUpdate={onUpdateField} onToggle={onToggleField} />
                            <ProfileField label="Certifications" fieldKey="certifications" field={jobData.certifications} onUpdate={onUpdateField} onToggle={onToggleField} />
                            {/* Inside Academic Profile block */}
                        </>
                    )}

                    {/* 2. Medical Profile */}
                    {selectedProfileType === 'medical' && medData && (
                        <>
                            <div className="av-row">
                                <ProfileField label="Blood Type" fieldKey="bloodType" field={medData.bloodType} onUpdate={onUpdateField} onToggle={onToggleField} />
                                <ProfileField label="Allergies" field={medAllergies} onChange={onUpdateMedicalAllergies} onToggle={() => onUpdateMedicalAllergies({ enabled: !medAllergies.enabled })} alignRight />
                            </div>
                            <ProfileField label="Emergency Contact" fieldKey="emergencyContactName" field={medData.emergencyContactName} onUpdate={onUpdateField} onToggle={onToggleField} />
                            <ProfileField label="Insurance Provider" fieldKey="insuranceProvider" field={medData.insuranceProvider} onUpdate={onUpdateField} onToggle={onToggleField} />
                        </>
                    )}

                    {/* 3. Government Profile */}
                    {selectedProfileType === 'government' && govData && (
                        <>
                            <div className="av-row">
                                <ProfileField label="National ID / SSN" fieldKey="nationalIdOrSSN" field={govData.nationalIdOrSSN} onUpdate={onUpdateField} onToggle={onToggleField} />
                                <ProfileField label="Citizenship" fieldKey="citizenship" field={govData.citizenship} onUpdate={onUpdateField} onToggle={onToggleField} alignRight />
                            </div>
                            <div className="av-row">
                                <ProfileField label="Passport #" fieldKey="passportNumber" field={govData.passportNumber} onUpdate={onUpdateField} onToggle={onToggleField} />
                                <ProfileField label="Driver's License" fieldKey="driversLicenseNumber" field={govData.driversLicenseNumber} onUpdate={onUpdateField} onToggle={onToggleField} alignRight />
                            </div>
                        </>
                    )}

                    {/* 4. Survey Profile */}
                    {selectedProfileType === 'survey' && survData && (
                        <>
                            <div className="av-row">
                                <ProfileField label="Age Range" fieldKey="ageRange" field={survData.ageRange} onUpdate={onUpdateField} onToggle={onToggleField} />
                                <ProfileField label="Income" fieldKey="householdIncomeRange" field={survData.householdIncomeRange} onUpdate={onUpdateField} onToggle={onToggleField} alignRight />
                            </div>
                            <div className="av-row">
                                <ProfileField label="Education" fieldKey="educationLevel" field={survData.educationLevel} onUpdate={onUpdateField} onToggle={onToggleField} />
                                <ProfileField label="Employment" fieldKey="employmentStatus" field={survData.employmentStatus} onUpdate={onUpdateField} onToggle={onToggleField} alignRight />
                            </div>
                        </>
                    )}

                    {/* 5. Academic Profile */}
                    {selectedProfileType === 'academic' && acadData && (
                        <>
                            <ProfileField label="Institution" fieldKey="institutionName" field={acadData.institutionName} onUpdate={onUpdateField} onToggle={onToggleField} />
                            <ProfileField label="Major / Field of Study" fieldKey="majorOrFieldOfStudy" field={acadData.majorOrFieldOfStudy} onUpdate={onUpdateField} onToggle={onToggleField} />
                            <div className="av-row">
                                <ProfileField label="GPA" fieldKey="gpaOrGrade" field={acadData.gpaOrGrade} onUpdate={onUpdateField} onToggle={onToggleField} />
                                <ProfileField label="Grad Year" fieldKey="graduationYearOrExpected" field={acadData.graduationYearOrExpected} onUpdate={onUpdateField} onToggle={onToggleField} alignRight />
                            </div>
                            <ProfileField label="Test Scores" fieldKey="standardizedTestScores" field={acadData.standardizedTestScores} onUpdate={onUpdateField} onToggle={onToggleField} />
                        </>
                    )}

                    {/* 6. Financial Profile */}
                    {selectedProfileType === 'financial' && finData && (
                        <>
                            <ProfileField label="Billing Address" fieldKey="billingAddress" field={finData.billingAddress} onUpdate={onUpdateField} onToggle={onToggleField} />
                            <div className="av-row">
                                <ProfileField label="Payment" fieldKey="preferredPaymentMethod" field={finData.preferredPaymentMethod} onUpdate={onUpdateField} onToggle={onToggleField} />
                                <ProfileField label="Cardholder" fieldKey="cardholderName" field={finData.cardholderName} onUpdate={onUpdateField} onToggle={onToggleField} alignRight />
                            </div>
                        </>
                    )}

                    {/* 7. Custom Profile Attributes (Paginated: 10 items max per page) */}
                    {paginatedAttributes.map(field => (
                        <ProfileField
                            key={field.id}
                            label={field.label}
                            field={field}
                            onChange={(updates) => onUpdateCustomField(field.id, updates)}
                            onToggle={() => onToggleCustomField(field.id)}
                        />
                    ))}

                    {/* Pagination Bar for Custom Attributes if > 10 */}
                    {totalAttrPages > 1 && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 4px', fontSize: 11, color: 'var(--av-text-muted)' }}>
                            <span>Page {safeAttrPage} of {totalAttrPages} ({customAttributes.length} items)</span>
                            <div style={{ display: 'flex', gap: 4 }}>
                                <button
                                    type="button"
                                    className="av-pill"
                                    style={{ padding: '2px 8px', opacity: safeAttrPage === 1 ? 0.4 : 1, cursor: safeAttrPage === 1 ? 'not-allowed' : 'pointer' }}
                                    disabled={safeAttrPage === 1}
                                    onClick={() => setAttrPage(prev => Math.max(1, prev - 1))}
                                >
                                    <ChevronLeft size={12} />
                                </button>
                                <button
                                    type="button"
                                    className="av-pill"
                                    style={{ padding: '2px 8px', opacity: safeAttrPage === totalAttrPages ? 0.4 : 1, cursor: safeAttrPage === totalAttrPages ? 'not-allowed' : 'pointer' }}
                                    disabled={safeAttrPage === totalAttrPages}
                                    onClick={() => setAttrPage(prev => Math.min(totalAttrPages, prev + 1))}
                                >
                                    <ChevronRight size={12} />
                                </button>
                            </div>
                        </div>
                    )}

                    {!['job', 'medical', 'government', 'survey', 'academic', 'financial'].includes(selectedProfileType) &&
                        customAttributes.length === 0 && (
                            <div style={{ fontSize: 11, color: 'var(--av-text-muted)' }}>
                                Add your own fields below or import via JSON.
                            </div>
                        )
                    }
                </>
            )}
        </div>
    );
}
