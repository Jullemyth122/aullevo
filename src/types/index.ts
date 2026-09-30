// CF => short term for ===> CustomField <===

export interface CM {
    id: string;
    label: string; // e.g. "Core Labels"
    value: string; // e.g. "Core Values"
    enabled: boolean; // for enabling the field
    context: string; // e.g. "This would help AI to find such similarities of labels based on context"
    group?: string;
    isSensitive: boolean; //  this is required
}

export interface ProfileFile {
    id: string;
    label: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    dataBase64: string;
    enabled: boolean;
}

export interface Memory {
    id: string;
    title: string;
    content: string;
    createdAt?: string;
    enabled: boolean;
}

export interface SavedLink {
    id: string;
    title: string;
    url: string;
    enabled: boolean;
    createdAt?: string;
}

// Supported Profile Types

export type ProfileType =
    | "job"
    | "medical"
    | "government"
    | "survey"
    | "academic"
    | "financial"
    | "custom";


// -----------
// Base User Profile (Common personal & contact fields across all profile types)
// BU => short term of ===> BaseUser <===

export interface BUData {
    id: string;
    profileName: string; // e.g. "Tech Job Profile", "Personal Medical", "DMV Renewal"
    enabled: boolean;
    createdAt?: string;
    updatedAt?: string;

    // Core Identity & Contact CustomFields
    firstName: CM;
    lastName: CM;
    email: CM;
    phone: CM;

    // Address
    address?: CM;

    // files
    files?: ProfileFile[];
    // Optional ad-hoc custom fields allowed in any profile
    customFields?: CM[];
}

// export interface CustomBUData {
//     id: string;
// }


// ---------------------------------------------------------------------------
// 1. Job / Employment Profile

export interface JobUserData extends BUData {
    profileType: "job";
    headline?: CM;
    linkedin?: CM;
    portfolio?: CM;
    github?: CM;
    education?: CM;
    certifications?: CM;
    skills: CM[];

}

// ---------------------------------------------------------------------------
// 2. Medical / Healthcare Profile

export interface MedicalUserData extends BUData {
    profileType: "medical";
    bloodType?: CM;
    allergies?: CM[];
    emergencyContactName?: CM;
    insuranceProvider?: CM;
}

// ---------------------------------------------------------------------------
// 3. Government / Civic / Official Profile
// ---------------------------------------------------------------------------

export interface GovernmentUserData extends BUData {
    profileType: "government";
    nationalIdOrSSN?: CM;
    passportNumber?: CM;
    driversLicenseNumber?: CM;
    citizenship?: CM;
}

// ---------------------------------------------------------------------------
// 4. Survey / Demographics / Market Research Profile
// ---------------------------------------------------------------------------

export interface SurveyUserData extends BUData {
    profileType: "survey";
    ageRange?: CM;
    householdIncomeRange?: CM;
    educationLevel?: CM;
    employmentStatus?: CM;
}

// ---------------------------------------------------------------------------
// 5. Academic / Student / Education Profile
// ---------------------------------------------------------------------------

export interface AcademicUserData extends BUData {
    profileType: "academic";
    institutionName?: CM;
    majorOrFieldOfStudy?: CM;
    gpaOrGrade?: CM;
    graduationYearOrExpected?: CM;
    standardizedTestScores?: CM;
}

// ---------------------------------------------------------------------------
// 6. Financial / E-Commerce / Billing Profile
// ---------------------------------------------------------------------------

export interface FinancialUserData extends BUData {
    profileType: "financial";
    billingAddress?: CM;
    preferredPaymentMethod?: CM;
    cardholderName?: CM;
}

// ---------------------------------------------------------------------------
// 7. Custom / General Purpose Profile

export interface CustomUserData extends BUData {
    profileType: "custom";
    customFields: CM[];
}


// 8. Add New Profiles 

export interface CustomProfileData {
    id: string;
    profileType: string;     // e.g. "Shopping Profile", "Freelance", "Social"
    profileName: string;
    enabled: boolean;        // ON / OFF
    files?: ProfileFile[];
    customFields: CM[];      // array of your custom fields (label, value, context)
}


// ---------------------------------------------------------------------------
// Discriminated Union of all Profiles

export type UserData =
    | JobUserData
    | MedicalUserData
    | GovernmentUserData
    | SurveyUserData
    | AcademicUserData
    | FinancialUserData
    | CustomUserData
    | CustomProfileData;

// ---------------------------------------------------------------------------
// Profile Store & Storage Interfaces

export interface UserProfileStore {
    activeProfileId: string;
    profiles: UserData[];
}

export interface StorageDefault {
    fields?: CM[];
    userProfiles?: UserProfileStore;
    activeProfile?: UserData;
    memories?: Memory[];
    savedLinks?: SavedLink[];
}

// ---------------------------------------------------------------------------
// Type Guard Utilities

// pf => profile
export const isJobProfile = (pf: UserData): pf is JobUserData =>
    pf.profileType === "job";

export const isMedicalProfile = (pf: UserData): pf is MedicalUserData =>
    pf.profileType === "medical";

export const isGovernmentProfile = (pf: UserData): pf is GovernmentUserData =>
    pf.profileType === "government";

export const isSurveyProfile = (pf: UserData): pf is SurveyUserData =>
    pf.profileType === "survey";

export const isAcademicProfile = (pf: UserData): pf is AcademicUserData =>
    pf.profileType === "academic";

export const isFinancialProfile = (pf: UserData): pf is FinancialUserData =>
    pf.profileType === "financial";

export const isCustomProfile = (pf: UserData): pf is CustomUserData =>
    pf.profileType === "custom";


export { createDefaultProfiles, getProfileCustomFields } from './defaults';