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
    this.apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || "";
    this.genAI = new GoogleGenAI({ apiKey: this.apiKey || "dummy_key" }); // Avoid crash on init if missing

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
  async countTokens(
    contents: string,
    model: string = "gemini-3-flash-preview",
  ): Promise<TokenCount> {
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

  private formatGeminiError(error: any): Error {
    const rawMessage =
      error?.message || (typeof error === "string" ? error : "");

    // Check for leaked API key or PERMISSION_DENIED
    if (
      rawMessage.includes("leaked") ||
      rawMessage.includes("PERMISSION_DENIED") ||
      error?.status === 403 ||
      error?.code === 403
    ) {
      return new Error(
        "Your Gemini API key was reported as leaked by Google. Please create a new key at Google AI Studio (aistudio.google.com) and update your extension settings.",
      );
    }

    // Check for invalid API key
    if (
      rawMessage.includes("API key not valid") ||
      rawMessage.includes("API_KEY_INVALID")
    ) {
      return new Error(
        "Invalid Gemini API Key. Please verify your API key in extension settings and ensure it is copied accurately from Google AI Studio (aistudio.google.com).",
      );
    }

    // Try parsing embedded JSON error structure inside error.message
    if (rawMessage.includes('{"error":')) {
      try {
        const jsonStart = rawMessage.indexOf("{");
        const jsonStr = rawMessage.substring(jsonStart);
        const parsed = JSON.parse(jsonStr);
        if (parsed?.error?.message) {
          const msg = parsed.error.message;
          if (msg.includes("leaked")) {
            return new Error(
              "Your Gemini API key was reported as leaked by Google. Please create a new key at Google AI Studio (aistudio.google.com) and update your extension settings.",
            );
          }
          if (
            msg.includes("API key not valid") ||
            msg.includes("API_KEY_INVALID")
          ) {
            return new Error(
              "Invalid Gemini API Key. Please verify your API key in extension settings and ensure it is copied accurately from Google AI Studio (aistudio.google.com).",
            );
          }
          return new Error(`Gemini API Error: ${msg}`);
        }
      } catch (_) {
        // Fallthrough if parsing fails
      }
    }

    return new Error(rawMessage || "Gemini API request failed.");
  }

  /**
   * Generic method to call Gemini
   */
  async generateContent(
    prompt: string,
    model: string = "gemini-3-flash-preview",
    customConfig: Partial<GenerationConfig> = {},
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
        const generatePromise = this.genAI.models.generateContent({
          model: model,
          contents: contents,
          config: mergedConfig,
        });

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error("Gemini API request timed out after 25 seconds."),
              ),
            25000,
          ),
        );

        const result: any = await Promise.race([
          generatePromise,
          timeoutPromise,
        ]);

        if (!result?.candidates?.[0]?.content) {
          throw new Error(`Empty/invalid response from Gemini`);
        }

        const responseText: string =
          result.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (!responseText) throw new Error("No text in Gemini response");

        const usage = result.usageMetadata;
        console.log(
          `✅ Gemini OK (${model}, attempt ${attempt}) | tokens: ${usage?.totalTokenCount ?? "?"}`,
        );

        return responseText;
      } catch (error: any) {
        lastError = error;
        const status = error.status || error.code || 0;
        const rawMessage = error.message || "";

        // Non-retryable errors: leaked key / 403 / permission denied / content blocked
        if (
          rawMessage.includes("leaked") ||
          rawMessage.includes("PERMISSION_DENIED") ||
          status === 403
        ) {
          throw this.formatGeminiError(error);
        }
        if (rawMessage.includes("blocked") || rawMessage.includes("HARM")) {
          throw new Error("Content was blocked by safety filters.");
        }
        if (status === 400) {
          throw new Error(`Bad request to Gemini: ${error.message}`);
        }

        // Retryable: 429 rate limit, 5xx server errors, or timeout
        if (
          attempt < MAX_RETRIES &&
          (status === 429 || status >= 500 || rawMessage.includes("timed out"))
        ) {
          const delay = Math.pow(2, attempt) * 1000; // 2s, 4s
          console.warn(
            `⏳ Gemini attempt ${attempt} failed (${rawMessage || status}), retrying in ${delay}ms...`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        // Raise friendly error after all retries
        if (status === 429)
          throw new Error("Rate limit exceeded. Please try again later.");
        if (status >= 500)
          throw new Error("Gemini server error. Please try again.");
        throw this.formatGeminiError(error);
      }
    }

    throw this.formatGeminiError(lastError);
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
      const responseText = await this.generateContent(
        prompt,
        "gemini-3-flash-preview",
      );
      const jsonText = this.extractJSON(responseText);
      return JSON.parse(jsonText) as Partial<UserData>;
    } catch (error: any) {
      console.error("Gemini parsing error:", error);
      // Enhance error message to be visible to user
      const msg = error.message || String(error);
      if (msg.includes("SyntaxError")) {
        throw new Error(
          `Failed to parse AI response. The resume might be too complex or malformed.`,
        );
      }
      throw new Error(`Failed to parse resume: ${msg}`);
    }
  }

  /**
   * Analyze a webpage's form fields using Gemini
   */
  async analyzeFormFields(
    formFields: FormField[],
    customFields: CustomField[] = [],
  ): Promise<FieldMapping[]> {
    let customFieldsPrompt = "";
    if (customFields.length > 0) {
      const fieldList = customFields
        .map(
          (cf, i) =>
            `  ${i + 1}. "custom_field:${cf.label}" — Context: ${cf.context || "general use"}`,
        )
        .join("\n");
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
        - **Radio Groups**: Type "radio_group". Map it to the correct "fieldType" (e.g. gender, custom_field).
        - **Checkbox Groups**: Type "checkbox_group". Map it to the correct "fieldType" (e.g. resumeUpload, custom_field).
        - **2D Matrix Rows**: If a checkbox/radio group label or matrix header represents a specific row (e.g. "Interview Availability — Mon" or "Mon"), match it to the corresponding custom field (e.g. custom_field:Mon).
        - **Toggle/Switch**: Type "toggle". Map it to the correct "fieldType".
        - **Range Slider**: Type "range". Map it to the correct "fieldType".
        - **Repeater Groups**: Identify if fields belong to a repeated group (e.g. Experience #1, Project #2).
        - **Add Buttons**: If you see an "Add" button (e.g. "Add Project", "+ Add Another"), map it with action="click_add".

        **Allowed field types:**
        firstName, lastName, email, phone, phoneCountryCode, address, city, state, zipCode, country, 
        linkedin, portfolio, github, headline, dateOfBirth, gender, summary,
        salaryExpectation, noticePeriod, workAuthorization, yearsOfExperience,
        emergencyContactName, emergencyContactRelationship, emergencyContactPhone, bloodType, allergies,
        medicalConditions, medications, insuranceProvider, policyNumber, occupation, industry,
        educationLevel, maritalStatus, position, company, salary, startDate, endDate, description,
        skill, resumeUpload, toggle, range${customFieldsPrompt}
        OR "custom_question" (for questions the AI should answer using the user's profile, OR for chat automation)

        **Allowed group types:**
        experience, education, project, skill

        **FUZZY MATCHING RULES:**
        1. "First Name" / "Given Name" / "fname" / "Your first name" → firstName
        2. "Last Name" / "Surname" / "Family name" / "lname" → lastName  
        3. "Email" / "Email Address" / "E-mail" → email (CRITICAL: DO NOT map "Email Address" to "address"!)
        4. "Address" / "Street Address" / "Location" / "Current Address" → address (Physical street address only)
        5. "Phone" / "Mobile" / "Contact number" / "Cell" → phone
        6. "LinkedIn" / "LinkedIn URL" / "LinkedIn Profile" → linkedin
        7. "Headline" / "Professional headline" / "Title" (in profile context) → headline
        8. "Expected salary" / "Salary expectations" / "Desired compensation" → salaryExpectation
        9. "Notice period" / "How soon can you start" / "Availability" → noticePeriod
        10. "Work authorization" / "Are you authorized to work" / "Visa status" → workAuthorization
        11. "Years of experience" / "Total experience" → yearsOfExperience
        12. For custom fields: Match by comparing the field's label/context with each custom field's context description.

        **Special Rules:**
        1. **Select/Radio/Checkbox/Toggle/Range**: DO NOT pick a "selectedValue". Only return the "fieldType" and any necessary grouping metadata. The extension will automatically map your selected "fieldType" to the user's saved profile data.
        2. **Repeater Groups**:
           - If a header says "Project 1" or "Experience 1", set groupType="project" and groupIndex=0.
           - If "Project 2", groupIndex=1.
        3. **Buttons**:
           - If a button's label contains "Add" or "Plus" and seems to add a new section, return:
             { "id": "btn_id", "action": "click_add", "groupType": "project", "confidence": 0.9 }
        4. **Custom Questions & Chat**: 
           - If it's a question, set fieldType="custom_question" and "originalQuestion" to the question text.
           - If it's a chat box (type="contenteditable"), set fieldType="custom_question" and "originalQuestion" to the last message from the 'chatContext' array.
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
        ${JSON.stringify(
          formFields.map((f) => {
            const compact: Record<string, any> = { id: f.id };
            if (f.name) compact.name = f.name;
            if (f.type) compact.type = f.type;
            if (f.placeholder) compact.placeholder = f.placeholder;
            if (f.label) compact.label = f.label;
            if (f.ariaLabel) compact.ariaLabel = f.ariaLabel;
            if (f.context) compact.context = f.context;
            if (f.section) compact.section = f.section;
            if (f.options?.length) compact.options = f.options;
            if (f.rowHeader) compact.rowHeader = f.rowHeader;
            if (f.colHeader) compact.colHeader = f.colHeader;
            if (f.compoundLabel) compact.compoundLabel = f.compoundLabel;
            return compact;
          }),
          null,
          2,
        )}
        `;

    try {
      const responseText = await this.generateContent(
        prompt,
        "gemini-3-flash-preview",
      );
      const jsonText = this.extractJSON(responseText);
      const mappings = JSON.parse(jsonText) as FieldMapping[];
      // Filter out low-confidence mappings (< 0.5) to avoid wrong fills
      return mappings.filter((m) => (m.confidence ?? 1) >= 0.5);
    } catch (error: any) {
      console.warn("Gemini form analysis notice:", error.message || error);
      // If we caught an error, bubble it up so the UI reflects that the AI actually crashed/failed
      // instead of silently pretending 0 fields were matched!
      throw new Error(
        `AI processing failed: ${error.message || "The form could not be parsed"}`,
      );
    }
  }

  /**
   * Smart question answering for custom form fields
   */
  async answerFormQuestion(
    question: string,
    userData: Partial<UserData>,
  ): Promise<string> {
    // Build a compact, non-PII context string — never serialize the full userData object
    const contextParts: string[] = [];

    if (userData.headline) contextParts.push(`Role: ${userData.headline}`);
    if (userData.yearsOfExperience)
      contextParts.push(`Years of experience: ${userData.yearsOfExperience}`);
    if (userData.skills?.length)
      contextParts.push(`Skills: ${userData.skills.slice(0, 10).join(", ")}`);
    if (userData.summary)
      contextParts.push(`Summary: ${userData.summary.substring(0, 200)}`);
    if (userData.salaryExpectation)
      contextParts.push(`Salary expectation: ${userData.salaryExpectation}`);
    if (userData.noticePeriod)
      contextParts.push(`Notice period: ${userData.noticePeriod}`);
    if (userData.workAuthorization)
      contextParts.push(`Work authorization: ${userData.workAuthorization}`);
    if (userData.experience?.length) {
      const latest = userData.experience[0];
      contextParts.push(
        `Latest role: ${latest.position} at ${latest.company} (${latest.duration})`,
      );
    }
    if (userData.education?.length) {
      const latest = userData.education[0];
      contextParts.push(
        `Education: ${latest.degree} from ${latest.school} (${latest.year})`,
      );
    }

    // Inject Memories (RAG Knowledge Base)
    if (userData.memories && userData.memories.length > 0) {
      contextParts.push("\n--- SAVED MEMORIES (KNOWLEDGE BASE) ---");
      userData.memories.forEach((mem) => {
        contextParts.push(`[${mem.title}]: ${mem.content}`);
      });
      contextParts.push("---------------------------------------");
    }

    const contextString = contextParts.join("\n");

    const prompt = `
You are helping fill out a job application form. The user is asked:

"${question}"

User context (career summary and saved memories):
${contextString || "No context available."}

Provide a SHORT, professional, and friendly answer (1-3 sentences). 
If the question is answered by the SAVED MEMORIES, prioritize that information!
If you cannot answer from the context, reply exactly: [MANUAL_INPUT_NEEDED]

Return ONLY the answer text, nothing else.
`;

    try {
      const responseText = await this.generateContent(
        prompt,
        "gemini-3-flash-preview",
        { responseMimeType: "text/plain" },
      );
      return responseText.trim();
    } catch (error) {
      console.error("Gemini answer error:", error);
      return "[ERROR]";
    }
  }

  async generateChatReply(
    chatHistory: string[],
    userData: Partial<UserData>, // Matches what background.ts is sending
  ): Promise<string> {
    if (!chatHistory || chatHistory.length === 0) {
      return "[Error: No chat messages found to reply to. Please click inside the chat box first.]";
    }

    // Safely map the memories array into a readable string format
    const memoriesBlock =
      userData.memories && userData.memories.length > 0
        ? userData.memories.map((m) => `- ${m.title}: ${m.content}`).join("\n")
        : "No specific memories stored.";

    const summaryBlock = userData.summary || "Not provided.";
    const skillsBlock = userData.skills?.join(", ") || "Not provided.";

    const prompt = `
You are an intelligent extension acting on behalf of the user to write conversational replies. 

--- USER PROFILE CONTEXT ---
Summary: ${summaryBlock}
Core Skills: ${skillsBlock}

--- USER MEMORIES & KNOWLEDGE BASE ---
${memoriesBlock}

--- RECENT CHAT THREAD (Chronological, bottom is newest message) ---
${chatHistory.map((line) => `> ${line}`).join("\n")}

--- TASK ---
Draft a natural, context-aware reply to the latest message on behalf of the user.
1. Prioritize Memories: If the knowledge base contains an answer, you MUST use it.
2. Tone Matching: Reply in the EXACT SAME language and casual/professional tone as the thread.
3. Return ONLY the text of the reply. Do not use quotes.
    `;

    try {
      const responseText = await this.generateContent(
        prompt,
        "gemini-3-flash-preview",
        {
          responseMimeType: "text/plain",
          temperature: 0.7, // Keeps the model creative but grounded
        },
      );
      return responseText.trim();
    } catch (error) {
      console.error("Gemini conversational engine execution error:", error);
      return "[Error generating automated response]";
    }
  }

  /**
   * Generate cover letter based on job description
   */
  async generateCoverLetter(
    jobDescription: string,
    userData: Partial<UserData>,
  ): Promise<string> {
    const prompt = `
Write a professional cover letter for this job posting:

${jobDescription}

Candidate information:
- Name: ${userData.firstName} ${userData.lastName}
- Email: ${userData.email}
- Skills: ${userData.skills?.join(", ") || "Not provided"}
- Experience: ${userData.experience?.[0]?.position || "Not provided"}

Write a compelling, personalized cover letter (200-300 words).
Return ONLY the cover letter text.
`;

    try {
      const responseText = await this.generateContent(
        prompt,
        "gemini-3-flash-preview",
        { responseMimeType: "text/plain" },
      );
      return responseText;
    } catch (error) {
      console.error("Gemini cover letter error:", error);
      throw error;
    }
  }

  /**
   * Helper function to extract JSON from Gemini response
   */
  private extractJSON(text: string): string {
    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "");
    }
    const firstBracket = cleaned.search(/[\{\[]/);
    const lastBracket = Math.max(
      cleaned.lastIndexOf("}"),
      cleaned.lastIndexOf("]"),
    );
    if (
      firstBracket !== -1 &&
      lastBracket !== -1 &&
      lastBracket > firstBracket
    ) {
      return cleaned.substring(firstBracket, lastBracket + 1);
    }
    return cleaned;
  }
}

export const geminiService = new GeminiService();
