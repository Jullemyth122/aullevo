/**
 * Heuristic pattern rules, regex dictionaries, and keyword constants
 * for form field classification.
 */

export const DYNAMIC_ID_PATTERNS = [
  /^\d+$/, // pure digits
  /^u_[0-9]/i, // Facebook style u_0_a
  /^_r_/i, // Facebook style _r_
  /^react-aria/i, // React Aria
  /^ember/i, // Ember
  /^input-\d+$/i, // generic dynamic input-123
  /^[a-f0-9-]{20,}$/i, // Long UUID or hash
] as const;

// Standard field matching rules
export const STANDARD_RULES: Record<string, RegExp> = {
  firstName: /\b(first|given)\s*name\b/i,
  middleName: /\b(middle|second)\s*name\b|\bmiddle\s*initial\b|\bmiddle\b/i,
  lastName: /\b(last|family|surname)\s*name\b|\b(last|surname)\b/i,
  fullName:
    /\b(full|complete)\s*name\b|\byour\s*name\b(?!\s*(first|last|given|sur|middle))/i,
  email: /e?-?mail/i,
  phoneCountryCode: /country\s*code|dial\s*code/i,
  phone: /\b(phone|mobile|cell|phone\s*no|telephone)\b/i,
  address:
    /(?<!e-?mail\s*)(?<!email\s*)\b(street|location|residential\s*address|home\s*address|postal\s*address|current\s*address|address\s*line|physical\s*address)\b|(?<!e-?mail\s*)(?<!e-?mail_)(?<!email\s*)address(?!.*e-?mail)/i,
  city: /\bcity\b/i,
  state: /\b(state|province)\b/i,
  zipCode: /zip|postal/i,
  country: /\b(country(?!.*code)|nationality)\b/i,
  linkedin: /linkedin/i,
  portfolio: /portfolio|website|personal\s*site/i,
  github: /github/i,
  headline: /headline/i,
  dateOfBirth: /birth|dob|bday|生日|出生日期|date\s*of\s*birth/i,
  gender: /gender|sex|性别/i,
  salaryExpectation:
    /(expected|desired)\s*(salary|pay|compensation)|期望薪水/i,
  noticePeriod:
    /\b(notice\s*period|date\s*of\s*availability|start\s*date|earliest\s*start|available\s*date|available\s*from)\b|到岗/i,
  workAuthorization:
    /work\s*authorization|visa|sponsorship|eligible\s*to\s*work|签证|工作/i,
  yearsOfExperience:
    /\b(years\s*of\s*experience|total\s*experience|work\s*experience\s*years)\b|\b经验\b/i,
  resumeUpload: /resume|cv|upload|简历/i,
  emergencyContactName: /emergency\s*contact\s*name/i,
  emergencyContactRelationship: /emergency\s*contact\s*relationship/i,
  emergencyContactPhone: /emergency\s*contact\s*(phone|number|cell)/i,
  bloodType: /blood\s*(type|group)/i,
  allergies: /allergies|allergy/i,
  medicalConditions: /medical\s*(conditions|history|illness)/i,
  medications: /medications|medicine|drugs/i,
  insuranceProvider: /insurance\s*(provider|carrier|company)/i,
  policyNumber: /policy\s*(number|no|id)/i,
  occupation:
    /\b(occupation|job\s*title|profession|position\s*applied\s*for)\b|\bposition\b(?!\s*in\s*table)/i,
  industry: /industry|sector/i,
  educationLevel: /education\s*level|highest\s*degree|education/i,
  maritalStatus: /marital\s*status|relationship\s*status|married/i,
};

/**
 * Maps each standard field key to the human-readable label aliases a user
 * might store in their Custom Fields profile (e.g. "First Name", "Email").
 * Used by fieldResolver to fall back to custom fields when userData is empty.
 * Lives here alongside STANDARD_RULES so there is a single source of truth.
 */
export const STANDARD_TO_CUSTOM_LABEL: Record<string, string[]> = {
  firstName:         ["first name", "given name", "firstname"],
  lastName:          ["last name", "surname", "family name", "lastname"],
  middleName:        ["middle name", "middle initial", "middle"],
  fullName:          ["full name", "complete name"],
  email:             ["email", "e-mail", "email address"],
  phone:             ["phone", "mobile", "phone number", "cell", "telephone"],
  phoneCountryCode:  ["country code", "dial code", "phone country code"],
  address:           ["address", "street address", "street", "residential address"],
  city:              ["city"],
  state:             ["state", "province"],
  zipCode:           ["zip", "postal code", "zip code", "postal"],
  country:           ["country", "nationality"],
  linkedin:          ["linkedin", "linkedin url", "linkedin profile"],
  portfolio:         ["portfolio", "website", "personal site", "personal website"],
  github:            ["github", "github url", "github profile"],
  headline:          ["headline", "professional headline", "title"],
  summary:           ["summary", "about", "bio", "professional summary"],
  dateOfBirth:       ["date of birth", "dob", "birthday"],
  gender:            ["gender", "sex"],
  occupation:        ["occupation", "position applied for", "position", "job title"],
  salaryExpectation: ["salary", "expected salary", "salary expectation", "desired salary"],
  noticePeriod:      ["notice period", "date of availability", "availability date", "start date"],
  yearsOfExperience: ["years of experience", "experience years", "experience"],
  workAuthorization: ["work authorization", "visa", "sponsorship"],
};

// Education sub-field rules — matched when context indicates an education section
export const EDUCATION_RULES: Record<string, RegExp> = {
  school: /institution|school|university|college|alma\s*mater/i,
  degree: /degree|highest\s*degree|qualification/i,
  year: /grad(uation)?\s*year|year\s*of\s*(grad|completion)|class\s*of/i,
};

// Stop words for custom field token matching
// NOTE: "to" and "from" are intentionally omitted because they are critical
// positional qualifiers in availability custom fields like "Mon - To" / "Mon - From".
export const CUSTOM_FIELD_STOP_WORDS = new Set([
  "in",
  "of",
  "the",
  "a",
  "an",
  "do",
  "you",
  "how",
  "many",
  "have",
  "for",
  "and",
  "or",
  "is",
  "are",
  "what",
  "level",
  "your",
  "whether",
  "if",
]);

export const MEMORY_STOP_WORDS = new Set([
  "in",
  "of",
  "the",
  "a",
  "an",
  "to",
  "with",
  "do",
  "you",
  "how",
  "many",
  "have",
  "for",
  "and",
  "or",
  "is",
  "are",
  "what",
  "level",
  "your",
  "whether",
  "if",
]);

export const QUALIFIERS = [
  "from",
  "to",
  "start",
  "end",
  "begin",
  "until",
] as const;
