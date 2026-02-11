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

        If any field is not found, use an empty string "" or empty array [].

        Resume text:
        ${resumeText}

        Return ONLY the JSON object, no markdown, no explanation.
        `;

        try {
            const responseText = await this.generateContent(prompt, "gemini-2.5-flash");
            const jsonText = this.extractJSON(responseText);
            return JSON.parse(jsonText) as Partial<UserData>;
        } catch (error) {
            console.error('Gemini parsing error:', error);
            throw new Error('Failed to parse resume with Gemini');
        }
    }

    /**
     * Analyze a webpage's form fields using Gemini
     */
    async analyzeFormFields( formFields: FormField[]): Promise<FieldMapping[]> {
        const prompt = `
        You are an expert at mapping HTML form fields to personal information types for job applications.

        You will receive a JSON array of form fields. Each field contains:
        - id (unique identifier, may be native or fallback like "field_0")
        - name (attribute value, often present)
        - type (e.g., text, email, tel, textarea)
        - placeholder
        - label (text from associated <label> or nearby text)
        - ariaLabel
        - autocomplete (standard hints like "given-name", "email", etc.)
        - required

        Your task: For each field that clearly expects one of the allowed types below, create a mapping object.

        Allowed field types (use EXACTLY these strings):
        firstName, lastName, email, phone, address, city, state, zipCode, country, linkedin, portfolio, github, dateOfBirth, gender, summary, position, company, salary, startDate

        Special rules:
        - Textareas asking about experience, motivation, cover letter, "why you're a great fit", etc. → use "summary"
        - Use autocomplete attribute as primary hint if present (e.g., "given-name" → firstName, "family-name" → lastName, "email" → email, "tel" → phone)
        - Also consider label, placeholder, and name text content
        - Only include mappings where confidence ≥ 0.7

        Return ONLY a valid JSON array of objects with these exact keys:
        - "id": the EXACT id from the input structure (do not change or invent)
        - "name": the name attribute value if non-empty (optional, omit if empty)
        - "fieldType": one of the allowed types above
        - "confidence": number 0.0 to 1.0

        Example output format:
        [
        {
            "id": "field_0",
            "name": "firstName",
            "fieldType": "firstName",
            "confidence": 0.99
        },
        {
            "id": "summary_textarea",
            "fieldType": "summary",
            "confidence": 0.95
        }
        ]

        If no confident matches, return empty array [].

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