import { GoogleGenAI } from "@google/genai";
import type { UserData, FormField, FieldMapping, CustomField } from "../types";

interface TokenCount {
    totalTokens: number;
}

interface GenerationConfig {
    temperature: number;
    topP: number;
    topK: number;
    maxOutputTokens: number;
    responseMimeType: string;
}

class GeminiService {
    private genAI: GoogleGenAI;
    private apiKey: string;
    private generationConfig: GenerationConfig;

    constructor() {
        this.apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
        this.genAI = new GoogleGenAI({ apiKey: this.apiKey || 'dummy_key' }); // Avoid crash on init if missing

        // Default generation config
        this.generationConfig = {
            temperature: 0.7,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
        };
    }

    setApiKey(key: string) {
        this.apiKey = key;
        this.genAI = new GoogleGenAI({ apiKey: this.apiKey });
        console.log("Gemini API Key updated");
    }

    /**
     * Helper to count tokens
     */
    async countTokens(contents: string, model: string = "gemini-2.5-flash"): Promise<TokenCount> {
        try {
            const result = await this.genAI.models.countTokens({
                model: model,
                contents: contents,
            });
            return result as TokenCount;
        } catch (error) {
            console.error("Token counting failed:", error);
            return { totalTokens: 0 };
        }
    }

    /**
     * Generic method to call Gemini
     */
    async generateContent(
        prompt: string,
        model: string = "gemini-2.5-flash",
        customConfig: Partial<GenerationConfig> = {}
    ): Promise<string> {
        const mergedConfig = { ...this.generationConfig, ...customConfig };
        const contents = prompt.trim();

        if (!contents) {
            throw new Error("No content provided to Gemini");
        }

        // Exponential backoff retry — up to 3 attempts
        const MAX_RETRIES = 3;
        let lastError: any;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const result = await this.genAI.models.generateContent({
                    model: model,
                    contents: contents,
                    config: mergedConfig,
                });

                if (!result?.candidates?.[0]?.content) {
                    throw new Error(`Empty/invalid response from Gemini`);
                }

                const responseText: string = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
                if (!responseText) throw new Error("No text in Gemini response");

                const usage = result.usageMetadata;
                console.log(`✅ Gemini OK (attempt ${attempt}) | tokens: ${usage?.totalTokenCount ?? '?'}`);

                return responseText;
            } catch (error: any) {
                lastError = error;
                const status = error.status || error.code || 0;

                // Non-retryable errors
                if (error.message?.includes("blocked") || error.message?.includes("HARM")) {
                    throw new Error("Content was blocked by safety filters.");
                }
                if (status === 400) {
                    throw new Error(`Bad request to Gemini: ${error.message}`);
                }

                // Retryable: 429 rate limit or 5xx server errors
                if (attempt < MAX_RETRIES && (status === 429 || status >= 500)) {
                    const delay = Math.pow(2, attempt) * 1000; // 2s, 4s
                    console.warn(`⏳ Gemini attempt ${attempt} failed (${status}), retrying in ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }

                // Raise friendly error after all retries
                if (status === 429) throw new Error("Rate limit exceeded. Please try again later.");
                if (status >= 500) throw new Error("Gemini server error. Please try again.");
                throw error;
            }
        }

        throw lastError;
    }

    /**
     * Parse resume text and extract structured data using Gemini
     */
    async parseResume(resumeText: string): Promise<Partial<UserData>> {
        const prompt = `
        You are a resume parser. Extract the following information from this resume and return ONLY a valid JSON object with these exact fields:

        {
        "firstName": "string",
        "lastName": "string", 
        "email": "string",
        "phone": "string",
        "address": "string",
        "city": "string",
        "state": "string",
        "zipCode": "string",
        "country": "string",
        "linkedin": "string",
        "portfolio": "string",
        "github": "string",
        "summary": "string",
        "skills": ["array", "of", "skills"],
        "experience": [
            {
            "company": "string",
            "position": "string",
            "duration": "string",
            "description": "string"
            }
        ],
        "education": [
            {
            "school": "string",
            "degree": "string",
            "year": "string"
            }
        ]
        }

        If any field is not found or is redacted/placeholder (e.g. "XXXX"), use an empty string "" or empty array [].
        Do not return "XXXX" as a value.

        Resume text:
        ${resumeText}

        Return ONLY the JSON object, no markdown, no explanation.
        `;

        try {
            const responseText = await this.generateContent(prompt, "gemini-2.5-flash");
            const jsonText = this.extractJSON(responseText);
            return JSON.parse(jsonText) as Partial<UserData>;
        } catch (error: any) {
            console.error('Gemini parsing error:', error);
            // Enhance error message to be visible to user
            const msg = error.message || String(error);
            if (msg.includes('SyntaxError')) {
                 throw new Error(`Failed to parse AI response. The resume might be too complex or malformed.`);
            }
            throw new Error(`Failed to parse resume: ${msg}`);
        }
    }

    /**
     * Analyze a webpage's form fields using Gemini
     */
    async analyzeFormFields(formFields: FormField[], customFields: CustomField[] = []): Promise<FieldMapping[]> {
        let customFieldsPrompt = '';
        if (customFields.length > 0) {
            const fieldList = customFields.map((cf, i) => 
                `  ${i + 1}. "custom_field:${cf.label}" — Context: ${cf.context || 'general use'}`
            ).join('\n');
            customFieldsPrompt = `\n        - **Custom Fields**: The user has defined these custom fields. Use "custom_field:LABEL" when a form field matches:\n${fieldList}`;
        }

        const prompt = `
        You are an expert at mapping HTML form fields to personal information types for job applications.
        You must be FLEXIBLE — form labels vary wildly between sites ("First Name" vs "Given Name" vs "fname" vs "Your Name").
        Use ALL available clues: label, placeholder, name, ariaLabel, context, and section.

        You will receive a JSON array of form fields. Each field contains:
        - id (unique identifier, or name for groups)
        - name, type, placeholder, label, ariaLabel
        - context (surrounding text/header, e.g. "Project 1", "Add Experience")
        - section (visual section name)
        - options (for select fields, radio_group, and checkbox_group)

        Your task is to create a mapping plan to fill this form. 
        
        **CRITICAL: DYNAMIC SECTIONS & GROUPS**
        - **Radio Groups**: Type "radio_group". "options" contains available choices. Pick ONE "value" for "selectedValue".
        - **Checkbox Groups**: Type "checkbox_group". "options" contains choices. Pick MULTIPLE "value"s for "selectedValue" (as an array of strings).
        - **Repeater Groups**: Identify if fields belong to a repeated group (e.g. Experience #1, Project #2).
        - **Add Buttons**: If you see an "Add" button (e.g. "Add Project", "+ Add Another"), map it with action="click_add".

        **Allowed field types:**
        firstName, lastName, email, phone, phoneCountryCode, address, city, state, zipCode, country, 
        linkedin, portfolio, github, headline, dateOfBirth, gender, summary,
        salaryExpectation, noticePeriod, workAuthorization, yearsOfExperience,
        position, company, salary, startDate, endDate, description, skill, resumeUpload${customFieldsPrompt}
        OR "custom_question" (for questions the AI should answer using the user's profile)

        **Allowed group types:**
        experience, education, project, skill

        **FUZZY MATCHING RULES:**
        1. "First Name" / "Given Name" / "fname" / "Your first name" → firstName
        2. "Last Name" / "Surname" / "Family name" / "lname" → lastName  
        3. "Phone" / "Mobile" / "Contact number" / "Cell" → phone
        4. "LinkedIn" / "LinkedIn URL" / "LinkedIn Profile" → linkedin
        5. "Headline" / "Professional headline" / "Title" (in profile context) → headline
        6. "Expected salary" / "Salary expectations" / "Desired compensation" → salaryExpectation
        7. "Notice period" / "How soon can you start" / "Availability" → noticePeriod
        8. "Work authorization" / "Are you authorized to work" / "Visa status" → workAuthorization
        9. "Years of experience" / "Total experience" → yearsOfExperience
        10. For custom fields: Match by comparing the field's label/context with each custom field's context description.

        **Special Rules:**
        1. **Select/Radio/Checkbox**: You MUST choose valid "value"s from "options".
           - For "radio_group", "selectedValue" must be a single string.
           - For "checkbox_group", "selectedValue" must be an array of strings e.g. ["Mon", "Tue"].
        2. **Repeater Groups**:
           - If a header says "Project 1" or "Experience 1", set groupType="project" and groupIndex=0.
           - If "Project 2", groupIndex=1.
        3. **Buttons**:
           - If a button's label contains "Add" or "Plus" and seems to add a new section, return:
             { "id": "btn_id", "action": "click_add", "groupType": "project", "confidence": 0.9 }
        4. **Custom Questions**: Set fieldType="custom_question" and "originalQuestion" to the question text.
        5. **Custom Fields**: If a form field matches a custom field's context, set fieldType="custom_field:LABEL".

        Return ONLY a valid JSON array of objects with these keys:
        - "id": EXACT id from input
        - "fieldType": one of the allowed types (or omit if action is click_add)
        - "confidence": 0.0 to 1.0
        - "selectedValue": string OR string[] (for checkboxes)
        - "originalQuestion": string (optional)
        - "groupType": string (optional)
        - "groupIndex": number (optional, default 0)
        - "action": "fill" (default) or "click_add"

        Form fields:
        ${JSON.stringify(formFields, null, 2)}
        `;

        try {
            const responseText = await this.generateContent(prompt, "gemini-2.5-flash");
            const jsonText = this.extractJSON(responseText);
            const mappings = JSON.parse(jsonText) as FieldMapping[];
            // Filter out low-confidence mappings (< 0.5) to avoid wrong fills
            return mappings.filter(m => (m.confidence ?? 1) >= 0.5);
        } catch (error) {
            console.error('Gemini form analysis error:', error);
            return [];
        }
    }

    /**
     * Smart question answering for custom form fields
     */
    async answerFormQuestion(question: string, userData: Partial<UserData>): Promise<string> {
        // Build a compact, non-PII context string — never serialize the full userData object
        const contextParts: string[] = [];

        if (userData.headline) contextParts.push(`Role: ${userData.headline}`);
        if (userData.yearsOfExperience) contextParts.push(`Years of experience: ${userData.yearsOfExperience}`);
        if (userData.skills?.length) contextParts.push(`Skills: ${userData.skills.slice(0, 10).join(', ')}`);
        if (userData.summary) contextParts.push(`Summary: ${userData.summary.substring(0, 200)}`);
        if (userData.salaryExpectation) contextParts.push(`Salary expectation: ${userData.salaryExpectation}`);
        if (userData.noticePeriod) contextParts.push(`Notice period: ${userData.noticePeriod}`);
        if (userData.workAuthorization) contextParts.push(`Work authorization: ${userData.workAuthorization}`);
        if (userData.experience?.length) {
            const latest = userData.experience[0];
            contextParts.push(`Latest role: ${latest.position} at ${latest.company} (${latest.duration})`);
        }
        if (userData.education?.length) {
            const latest = userData.education[0];
            contextParts.push(`Education: ${latest.degree} from ${latest.school} (${latest.year})`);
        }

        const contextString = contextParts.join('\n');

        const prompt = `
You are helping fill out a job application form. The user is asked:

"${question}"

User context (career summary only — no personal data):
${contextString || 'No context available.'}

Provide a SHORT, professional answer (1-3 sentences). If you cannot answer from the context, reply exactly: [MANUAL_INPUT_NEEDED]

Return ONLY the answer text, nothing else.
`;

        try {
            const responseText = await this.generateContent(
                prompt,
                "gemini-2.5-flash",
                { responseMimeType: "text/plain" }
            );
            return responseText.trim();
        } catch (error) {
            console.error('Gemini answer error:', error);
            return '[ERROR]';
        }
    }

    /**
     * Generate cover letter based on job description
     */
    async generateCoverLetter(jobDescription: string, userData: Partial<UserData>): Promise<string> {
        const prompt = `
Write a professional cover letter for this job posting:

${jobDescription}

Candidate information:
- Name: ${userData.firstName} ${userData.lastName}
- Email: ${userData.email}
- Skills: ${userData.skills?.join(', ') || 'Not provided'}
- Experience: ${userData.experience?.[0]?.position || 'Not provided'}

Write a compelling, personalized cover letter (200-300 words).
Return ONLY the cover letter text.
`;

        try {
            const responseText = await this.generateContent(
                prompt,
                "gemini-2.5-flash",
                { responseMimeType: "text/plain" }
            );
            return responseText;
        } catch (error) {
            console.error('Gemini cover letter error:', error);
            throw error;
        }
    }

    /**
     * Helper function to extract JSON from Gemini response
     */
    private extractJSON(text: string): string {
        let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        
        if (jsonMatch) {
            return jsonMatch[0];
        }

        return cleaned.trim();
    }
}

export const geminiService = new GeminiService();