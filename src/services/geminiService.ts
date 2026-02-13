import { GoogleGenAI } from "@google/genai";
import type { UserData, FormField, FieldMapping } from "../types";

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

        try {
            const inputTokens = await this.countTokens(contents, model);
            console.log(`📊 Input tokens: ${inputTokens.totalTokens || 0}`);

            const result = await this.genAI.models.generateContent({
                model: model,
                contents: contents,
                config: mergedConfig,
            });

            console.log("🤖 Gemini raw result:", JSON.stringify(result, null, 2));

            if (!result?.candidates?.[0]?.content) {
                throw new Error(`Empty/invalid response from Gemini: ${JSON.stringify(result)}`);
            }

            // console.log(result)
            const responseText: string = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

            if (!responseText) {
                throw new Error("No text in Gemini response");
            }

            const usage = result.usageMetadata || {
                promptTokenCount: inputTokens.totalTokens || 0,
                candidatesTokenCount: 0,
                totalTokenCount: inputTokens.totalTokens || 0,
            };

            console.log(`📤 Output tokens: ${usage.candidatesTokenCount} | Total: ${usage.totalTokenCount}`);
            console.log("✅ Gemini response received");

            return responseText;
        } catch (error: any) {
            console.error("❌ Gemini request failed:", error);

            const status = error.status || error.code || 0;
            if (status === 429) {
                throw new Error("Rate limit exceeded. Please try again later.");
            } else if (status >= 500) {
                throw new Error("Gemini server error. Please try again.");
            } else if (error.message?.includes("blocked") || error.message?.includes("HARM")) {
                throw new Error("Content was blocked by safety filters.");
            }

            throw error;
        }
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
    async analyzeFormFields( formFields: FormField[]): Promise<FieldMapping[]> {
        const prompt = `
        You are an expert at mapping HTML form fields to personal information types for job applications.

        You will receive a JSON array of form fields. Each field contains:
        - id (unique identifier)
        - name, type, placeholder, label, ariaLabel
        - context (surrounding text/header, e.g. "Project 1", "Add Experience")
        - section (visual section name)
        - options (for select fields)

        Your task is to create a mapping plan to fill this form. 
        
        **CRITICAL NEW INSTRUCTION: DYNAMIC SECTIONS**
        - Identify if fields belong to a repeated group (e.g. Experience #1, Project #2).
        - If you see an "Add" button (e.g. "Add Project", "+ Add Another"), map it with action="click_add".
        - Map fields to their specific index.

        **Allowed field types:**
        firstName, lastName, email, phone, address, city, state, zipCode, country, linkedin, portfolio, github, dateOfBirth, gender, summary,
        position, company, salary, startDate, endDate, description, skill
        OR "custom_question"

        **Allowed group types:**
        experience, education, project, skill

        **Special Rules:**
        1. **Select Fields**: You MUST chose the best matching "value" from "options" and set it as "selectedValue".
        2. **Repeater Groups**:
           - If a header says "Project 1" or "Experience 1", set groupType="project" and groupIndex=0.
           - If "Project 2", groupIndex=1.
        3. **Buttons**:
           - If a button's label contains "Add" or "Plus" and seems to add a new section for Experience/Education/Projects, return:
             { "id": "btn_id", "action": "click_add", "groupType": "project", "confidence": 0.9 }
        4. **Custom Questions**: Set fieldType="custom_question" and "originalQuestion" to the question text.

        Return ONLY a valid JSON array of objects with these keys:
        - "id": EXACT id from input
        - "fieldType": one of the allowed types (or omit if action is click_add)
        - "confidence": 0.0 to 1.0
        - "selectedValue": string (optional)
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
            return JSON.parse(jsonText) as FieldMapping[];
        } catch (error) {
            console.error('Gemini form analysis error:', error);
            return [];
        }
    }

    /**
     * Smart question answering for custom form fields
     */
    async answerFormQuestion(question: string, userData: Partial<UserData>): Promise<string> {
        const prompt = `
You are helping fill out a job application form. The user is asked this question:

"${question}"

Here is the user's information:
${JSON.stringify(userData, null, 2)}

Based on this information, provide a SHORT, professional answer to the question.
If the answer requires information not in the user data, respond with "[MANUAL_INPUT_NEEDED]"

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