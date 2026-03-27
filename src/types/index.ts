export interface CustomField {
    label: string;    // e.g. "Pronouns"
    value: string;    // e.g. "He/Him"
    context: string;  // e.g. "Use when form asks about preferred pronouns"
}

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
    // Extended fields for job platforms
    headline?: string;
    dateOfBirth?: string;
    gender?: string;
    salaryExpectation?: string;
    noticePeriod?: string;
    workAuthorization?: string;
    yearsOfExperience?: string;
    customFields: CustomField[];
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
    context?: string; // Surrounding text/header
    section?: string; // Visual section name
    accept?: string;  // For file inputs: e.g. ".pdf,.doc,.docx"
    multiple?: boolean; // For file inputs: whether multiple files are allowed
    options?: { label: string; value: string }[]; // For select fields
}

export interface FieldMapping {
    fieldId: string;
    fieldType: keyof UserData | 'custom_question' | string;
    confidence: number;
    reasoning?: string;
    id?: string;
    name?: string;
    selectedValue?: string | string[]; // For select fields, radio_group, and checkbox_group
    headerContext?: string; // The specific context (e.g. "Additional Questions")
    originalQuestion?: string; // For custom Q&A
    
    // Dynamic / Repeater support
    groupType?: 'experience' | 'education' | 'project' | 'skill'; 
    groupIndex?: number; // 0-based index for repeater items
    action?: 'fill' | 'click_add'; // 'fill' is default. 'click_add' means this mapping targets an "Add" button.
    
    // Custom File Injection Support
    fileData?: string; // Data URL bridging (for Content script injection)
    fileName?: string; // Real file original name
    files?: { name: string; dataUrl: string }[]; // Array of files for multiple injection
}

export interface SavedFile {
    id: string;
    name: string;
    size: number;
    type: string;
    dataUrl: string;
    savedAt: string;
}

// Message types for Chrome extension
export interface ChromeMessage {
    action: 'analyzeForm' | 'fillForm' | 'clickNext' | 'domChanged' | 'urlChanged' | 'toggleSidebar' | 'triggerFillFromPopup' | 'triggerFillFromSidebar' | 'processFieldsAI';
    data?: {
        fieldMappings?: FieldMapping[];
        userData?: Partial<UserData>;
        resumeFileData?: string;
        resumeFileName?: string;
    };
    fields?: FormField[];
    tabUrl?: string; // Current URL for AI domain cache
    url?: string; // Used by urlChanged
}

export interface ChromeResponse {
    success: boolean;
    fields?: FormField[];
    filledCount?: number;
    total?: number;
    message?: string;
    nextButtonFound?: boolean;
    error?: string;
    mappings?: FieldMapping[];
    addButtons?: FieldMapping[];
    userData?: Partial<UserData>;
    resumeFileData?: string;
    resumeFileName?: string;
}

// Status for UI
export interface Status {
    message: string;
    type: 'info' | 'success' | 'error' | '';
}