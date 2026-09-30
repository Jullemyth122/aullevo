import type {
    ProfileType,
    UserData,
    JobUserData,
    MedicalUserData,
    GovernmentUserData,
    SurveyUserData,
    AcademicUserData,
    FinancialUserData,
    CustomUserData,
    CM
} from './index';


// Helper to construct default CM fields cleanly:
const cm = (id: string, label: string, context: string, isSensitive: boolean = false): CM => ({
    id,
    label,
    value: '',
    enabled: true,
    isSensitive,
    context
});


export const createDefaultProfiles = (): Record<ProfileType, UserData> => ({
    job: {
        id: 'prof_job',
        profileType: 'job',
        profileName: 'My Job Profile',
        enabled: true,
        firstName: cm('job_fn', 'First Name', "User's first name", false),
        lastName: cm('job_ln', 'Last Name', "User's last name", false),
        email: cm('job_em', 'Email Address', 'Work / personal email', true),
        phone: cm('job_ph', 'Phone Number', 'Contact phone', true),
        address: cm('job_addr', 'Residential Address', 'Home address', true),
        headline: cm('job_hl', 'Headline / Title', 'Professional title', false),
        linkedin: cm('job_li', 'LinkedIn', 'LinkedIn profile', false),
        github: cm('job_gh', 'GitHub', 'GitHub profile', false),
        portfolio: cm('job_pf', 'Portfolio', 'Portfolio website', false),
        skills: [cm('job_sk1', 'Skills', 'Core technical skills', false)],
        education: cm('job_edu', 'Highest Education / Degree', 'Highest degree and university', false),
        certifications: cm('job_cert', 'Certifications', 'Professional certifications and licenses', false),
        customFields: []
    } as JobUserData,

    medical: {
        id: 'prof_med',
        profileType: 'medical',
        profileName: 'My Medical Profile',
        enabled: false,
        firstName: cm('med_fn', 'First Name', "Patient's first name", false),
        lastName: cm('med_ln', 'Last Name', "Patient's last name", false),
        email: cm('med_em', 'Email Address', 'Patient email', true),
        phone: cm('med_ph', 'Phone Number', 'Patient phone', true),
        address: cm('med_addr', 'Residential Address', 'Patient address', true),
        bloodType: cm('med_bt', 'Blood Type', 'Blood group', true),
        allergies: [cm('med_alg', 'Allergies', 'Known allergies', true)],
        emergencyContactName: cm('med_ec', 'Emergency Contact', 'Emergency contact', true),
        insuranceProvider: cm('med_ins', 'Insurance Provider', 'Health insurance', true),
        customFields: []
    } as MedicalUserData,

    government: {
        id: 'prof_gov',
        profileType: 'government',
        profileName: 'My Government Profile',
        enabled: false,
        firstName: cm('gov_fn', 'First Name', 'Citizen first name', false),
        lastName: cm('gov_ln', 'Last Name', 'Citizen last name', false),
        email: cm('gov_em', 'Email Address', 'Official contact email', true),
        phone: cm('gov_ph', 'Phone Number', 'Official contact phone', true),
        address: cm('gov_addr', 'Residential Address', 'Permanent residency', true),
        nationalIdOrSSN: cm('gov_ssn', 'National ID / SSN', 'SSN or government ID', true),
        citizenship: cm('gov_cit', 'Citizenship', 'Country of citizenship', false),
        passportNumber: cm('gov_pass', 'Passport #', 'Passport number', true),
        driversLicenseNumber: cm('gov_dl', "Driver's License", "Driver's license number", true),
        customFields: []
    } as GovernmentUserData,

    survey: {
        id: 'prof_surv',
        profileType: 'survey',
        profileName: 'My Survey Profile',
        enabled: false,
        firstName: cm('surv_fn', 'First Name', 'Respondent first name', false),
        lastName: cm('surv_ln', 'Last Name', 'Respondent last name', false),
        email: cm('surv_em', 'Email Address', 'Respondent email', true),
        phone: cm('surv_ph', 'Phone Number', 'Respondent phone', true),
        address: cm('surv_addr', 'Residential Address', 'Respondent location', true),
        ageRange: cm('surv_age', 'Age Range', 'Age bracket', false),
        householdIncomeRange: cm('surv_inc', 'Household Income', 'Income bracket', false),
        educationLevel: cm('surv_edu', 'Education Level', 'Highest degree obtained', false),
        employmentStatus: cm('surv_emp', 'Employment Status', 'Current employment status', false),
        customFields: []
    } as SurveyUserData,

    academic: {
        id: 'prof_acad',
        profileType: 'academic',
        profileName: 'My Academic Profile',
        enabled: false,
        firstName: cm('acad_fn', 'First Name', 'Student first name', false),
        lastName: cm('acad_ln', 'Last Name', 'Student last name', false),
        email: cm('acad_em', 'Email Address', 'Academic / university email', true),
        phone: cm('acad_ph', 'Phone Number', 'Student phone', true),
        address: cm('acad_addr', 'Residential Address', 'Campus or home address', true),
        institutionName: cm('acad_inst', 'Institution Name', 'University or college name', false),
        majorOrFieldOfStudy: cm('acad_maj', 'Major / Field of Study', 'Major field', false),
        gpaOrGrade: cm('acad_gpa', 'GPA', 'Grade point average', false),
        graduationYearOrExpected: cm('acad_grad', 'Graduation Year', 'Graduation year', false),
        standardizedTestScores: cm('acad_score', 'Standardized Test Scores', 'SAT, GRE, TOEFL, or IELTS scores', false),
        customFields: []
    } as AcademicUserData,

    financial: {
        id: 'prof_fin',
        profileType: 'financial',
        profileName: 'My Financial Profile',
        enabled: false,
        firstName: cm('fin_fn', 'First Name', 'Billing first name', false),
        lastName: cm('fin_ln', 'Last Name', 'Billing last name', false),
        email: cm('fin_em', 'Email Address', 'Receipt email', true),
        phone: cm('fin_ph', 'Phone Number', 'Billing phone', true),
        address: cm('fin_addr', 'Residential Address', 'Billing address', true),
        billingAddress: cm('fin_baddr', 'Billing Address', 'Billing street address', true),
        preferredPaymentMethod: cm('fin_pay', 'Preferred Payment', 'Payment method', true),
        cardholderName: cm('fin_chn', 'Cardholder Name', 'Name on card', true),
        customFields: []
    } as FinancialUserData,

    custom: {
        id: 'prof_cust',
        profileType: 'custom',
        profileName: 'My Custom Profile',
        enabled: false,
        firstName: cm('cust_fn', 'First Name', 'First name', false),
        lastName: cm('cust_ln', 'Last Name', 'Last name', false),
        email: cm('cust_em', 'Email Address', 'Email', true),
        phone: cm('cust_ph', 'Phone Number', 'Phone', true),
        address: cm('cust_addr', 'Residential Address', 'Address', true),
        customFields: []
    } as CustomUserData
});



export function getProfileCustomFields(profile: UserData): CM[] {
    const fields: CM[] = [];
    const attrGroupName = `${profile.profileType.charAt(0).toUpperCase() + profile.profileType.slice(1)} Attributes`;

    // 1. Identity & Contact
    if ('firstName' in profile && profile.firstName) fields.push({ ...profile.firstName, group: 'Identity & Contact' });
    if ('lastName' in profile && profile.lastName) fields.push({ ...profile.lastName, group: 'Identity & Contact' });
    if ('email' in profile && profile.email) fields.push({ ...profile.email, group: 'Identity & Contact' });
    if ('phone' in profile && profile.phone) fields.push({ ...profile.phone, group: 'Identity & Contact' });
    if ('address' in profile && profile.address) fields.push({ ...profile.address, group: 'Identity & Contact' });

    // 2. Domain Attributes
    switch (profile.profileType) {
        case 'job': {
            const p = profile as JobUserData;
            if (p.headline) fields.push({ ...p.headline, group: attrGroupName });
            if (p.linkedin) fields.push({ ...p.linkedin, group: attrGroupName });
            if (p.github) fields.push({ ...p.github, group: attrGroupName });
            if (p.portfolio) fields.push({ ...p.portfolio, group: attrGroupName });
            if (p.certifications) fields.push({ ...p.certifications, group: attrGroupName });
            if (p.education) fields.push({ ...p.education, group: attrGroupName });
            if (p.skills) fields.push(...p.skills.map(s => ({ ...s, group: attrGroupName })));
            break;
        }
        case 'medical': {
            const p = profile as MedicalUserData;
            if (p.bloodType) fields.push({ ...p.bloodType, group: attrGroupName });
            if (p.emergencyContactName) fields.push({ ...p.emergencyContactName, group: attrGroupName });
            if (p.insuranceProvider) fields.push({ ...p.insuranceProvider, group: attrGroupName });
            if (p.allergies) fields.push(...p.allergies.map(s => ({ ...s, group: attrGroupName })));
            break;
        }
        case 'government': {
            const p = profile as GovernmentUserData;
            if (p.nationalIdOrSSN) fields.push({ ...p.nationalIdOrSSN, group: attrGroupName });
            if (p.citizenship) fields.push({ ...p.citizenship, group: attrGroupName });
            if (p.passportNumber) fields.push({ ...p.passportNumber, group: attrGroupName });
            if (p.driversLicenseNumber) fields.push({ ...p.driversLicenseNumber, group: attrGroupName });
            break;
        }
        case 'survey': {
            const p = profile as SurveyUserData;
            if (p.ageRange) fields.push({ ...p.ageRange, group: attrGroupName });
            if (p.householdIncomeRange) fields.push({ ...p.householdIncomeRange, group: attrGroupName });
            if (p.educationLevel) fields.push({ ...p.educationLevel, group: attrGroupName });
            if (p.employmentStatus) fields.push({ ...p.employmentStatus, group: attrGroupName });
            break;
        }
        case 'academic': {
            const p = profile as AcademicUserData;
            if (p.institutionName) fields.push({ ...p.institutionName, group: attrGroupName });
            if (p.majorOrFieldOfStudy) fields.push({ ...p.majorOrFieldOfStudy, group: attrGroupName });
            if (p.gpaOrGrade) fields.push({ ...p.gpaOrGrade, group: attrGroupName });
            if (p.graduationYearOrExpected) fields.push({ ...p.graduationYearOrExpected, group: attrGroupName });
            if (p.standardizedTestScores) fields.push({ ...p.standardizedTestScores, group: attrGroupName });

            break;
        }
        case 'financial': {
            const p = profile as FinancialUserData;
            if (p.billingAddress) fields.push({ ...p.billingAddress, group: attrGroupName });
            if (p.preferredPaymentMethod) fields.push({ ...p.preferredPaymentMethod, group: attrGroupName });
            if (p.cardholderName) fields.push({ ...p.cardholderName, group: attrGroupName });
            break;
        }
        case 'custom':
            break;
    }

    // 3. Custom Fields
    if (profile.customFields) {
        fields.push(...profile.customFields.map(f => ({ ...f, group: f.group || 'Custom Fields' })));
    }

    return fields;
}


