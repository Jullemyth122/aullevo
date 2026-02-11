// User data structure
export interface UserData {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    linkedin: string;
    portfolio: string;
    github: string;
    summary: string;
    skills: string[];
    experience: Experience[];
    education: Education[];
}

export interface Experience {
    company: string;
    position: string;
    duration: string;
    description: string;
}

export interface Education {
    school: string;
    degree: string;
    year: string;
}

// Form field types
export interface FormField {
    id: string;
    name: string;
    type: string;
    placeholder: string;
    label: string;
    ariaLabel: string;
    autocomplete: string;
    required: boolean;
}

export interface FieldMapping {
    fieldId: string;
    fieldType: keyof UserData;
    confidence: number;
    reasoning?: string;
    id?: string;
    name?: string;
}

// Message types for Chrome extension
export interface ChromeMessage {
    action: 'analyzeForm' | 'fillForm';
    data?: {
        fieldMappings?: FieldMapping[];
        userData?: UserData;
    };
}

export interface ChromeResponse {
    success: boolean;
    fields?: FormField[];
    filledCount?: number;
    total?: number;
}

// Status for UI
export interface Status {
    message: string;
    type: 'info' | 'success' | 'error' | '';
}