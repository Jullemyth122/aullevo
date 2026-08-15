import type { CustomField, UserData } from '../../../types';

export type Tab = 'fill' | 'profile' | 'knowledge' | 'links' | 'settings';

export interface FillStatus {
    message: string;
    type: 'idle' | 'scanning' | 'filling' | 'success' | 'error' | 'info';
}

export function migrateCustomFields(raw: any): CustomField[] {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
        return Object.entries(raw).map(([key, value]) => ({
            label: key,
            value: String(value),
            context: '',
        }));
    }
    return [];
}

export const createEmptyUserData = (profileType: 'job' | 'medical' | 'survey' | 'custom' = 'job'): UserData => ({
    profileType,
    firstName: '', lastName: '', email: '', phone: '',
    address: '', city: '', state: '', zipCode: '', country: '',
    linkedin: '', portfolio: '', github: '',
    headline: '', summary: '', skills: [],
    yearsOfExperience: '', salaryExpectation: '',
    noticePeriod: '', workAuthorization: '',
    dateOfBirth: '', gender: '',
    emergencyContactName: '', emergencyContactRelationship: '', emergencyContactPhone: '',
    bloodType: '', allergies: '', medicalConditions: '', medications: '',
    insuranceProvider: '', policyNumber: '',
    occupation: '', industry: '', educationLevel: '', maritalStatus: '',
    customFields: [], experience: [], education: [],
    memories: [], savedLinks: [],
});

export const fileSizeStr = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
