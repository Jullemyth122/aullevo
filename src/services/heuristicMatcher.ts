import type { FormField, CustomField, FieldMapping } from "../types";

export function matchFieldsHeuristically(
  fields: FormField[],
  customFields: CustomField[] = [],
): FieldMapping[] {
  const mappings: FieldMapping[] = [];

  // Simple robust keyword matchers for standard fields
  const STANDARD_RULES: Record<string, RegExp> = {
    firstName: /(first|given)\s*name/i,
    lastName: /(last|family|sur)\s*name/i,
    email: /e?-?mail/i,
    phoneCountryCode: /country\s*code|dial\s*code/i,
    phone: /\b(phone|mobile|cell)\b/i, // Will be overridden if countryCode matches first
    address: /address|street\s*1/i,
    city: /\bcity\b/i,
    state: /\b(state|province)\b/i,
    zipCode: /zip|postal/i,
    country: /\b(country(?!.*code)|nationality)\b/i, // Matches country, but not country code
    linkedin: /linkedin/i,
    portfolio: /portfolio|website|personal\s*site/i,
    github: /github/i,
    headline: /headline/i,
    dateOfBirth: /birth|dob|bday|生日|出生日期|date\s*of\s*birth/i,
    gender: /gender|sex|性别/i,
    salaryExpectation: /(expected|desired)\s*(salary|pay|compensation)|期望薪水/i,
    noticePeriod: /notice\s*period|availability|start|到岗/i,
    workAuthorization:
      /work\s*authorization|visa|sponsorship|eligible\s*to\s*work|签证|工作/i,
    yearsOfExperience: /years\s*of\s*experience|experience|经验/i,
    resumeUpload: /resume|cv|upload|简历/i,
  };

  // Education sub-field rules — matched when context indicates an education section
  const EDUCATION_RULES: Record<string, RegExp> = {
    school: /institution|school|university|college|alma\s*mater/i,
    degree: /degree|highest\s*degree|qualification/i,
    year: /grad(uation)?\s*year|year\s*of\s*(grad|completion)|class\s*of/i,
  };

  // Helper to evaluate text against all custom fields using a semantic word match
  function matchCustomField(text: string): CustomField | null {
    if (!text) return null;
    const lowerText = text.toLowerCase();

    for (const cf of customFields) {
      const labelLogic = cf.label.toLowerCase();
      const contextLogic = cf.context?.toLowerCase() || "";

      // 1. Exact substring match
      if (lowerText.includes(labelLogic)) return cf;
      if (contextLogic && lowerText.includes(contextLogic)) return cf;

      // 2. Semantic word match (order-independent)
      // Removes stop words to match "Years of Experience in React" against "How many years of work experience do you have with React.js"
      const stopWords = new Set([
        "in", "of", "the", "a", "an", "to", "with", "do", "you", "how", "many", 
        "have", "for", "and", "or", "is", "are", "what", "level", "your", "whether", "if"
      ]);

      const getSignificantWords = (str: string) => {
        return str
          .replace(/[^a-z0-9\s]/gi, " ")
          .split(/\s+/)
          .filter((w) => w.length > 1 && !stopWords.has(w));
      };

      // Handle bilingual custom field labels (e.g., "Employed / 在职")
      const BILINGUAL_SEPARATORS = /[/|·•]/;
      const labelParts = labelLogic.split(BILINGUAL_SEPARATORS).map(p => p.trim()).filter(Boolean);
      
      const textWords = getSignificantWords(lowerText);
      
      for (const part of labelParts) {
        // Exact substring match (if it's a reasonably long specific phrase, avoids "Yes" matching randomly)
        if (part.length > 4 && lowerText.includes(part)) return cf;
        
        const cfWords = getSignificantWords(part);
        if (cfWords.length > 0) {
          let matchedAll = true;
          for (const cw of cfWords) {
            const wordMatched = textWords.some(
              (tw) => 
                tw === cw || 
                // Only allow partial matches if both words are substantial (>= 4 chars)
                (tw.length >= 4 && cw.length >= 4 && (tw.includes(cw) || cw.includes(tw)))
            );
            if (!wordMatched) {
              matchedAll = false;
              break;
            }
          }
          if (matchedAll) return cf;
        }
      }
    }
    return null;
  }

  for (const field of fields) {
    // Priority 1: Action Add Buttons
    if (field.type === "button" || field.type === "submit") {
      const labelLower = (field.label || "").toLowerCase();
      const contextLower = (field.context || "").toLowerCase();
      if (labelLower.includes("add") || labelLower.includes("plus")) {
        let groupType: any = null;
        if (
          labelLower.includes("experience") ||
          contextLower.includes("experience") ||
          labelLower.includes("job")
        )
          groupType = "experience";
        else if (
          labelLower.includes("education") ||
          contextLower.includes("education") ||
          labelLower.includes("school")
        )
          groupType = "education";
        else if (labelLower.includes("project")) groupType = "project";
        else if (labelLower.includes("skill")) groupType = "skill";

        if (groupType) {
          mappings.push({
            fieldId: field.id,
            id: field.id,
            fieldType: "",
            action: "click_add",
            groupType,
            confidence: 0.9,
          });
        }
      }
      continue;
    }

    const compositeText = [
      field.label,
      field.placeholder,
      field.name,
      field.context,
      field.id,
    ]
      .join(" ")
      .toLowerCase();

    // Priority 2: Groups (Experience / Education repeating sections)
    let groupType: "experience" | "education" | "project" | "skill" | undefined;
    let groupIndex = 0;

    const contextStr = (field.context || field.section || "").toLowerCase();

    // Very basic repeater index extraction (e.g., "Experience 1", "Experience #2")
    const indexMatch = contextStr.match(
      /(?:experience|education|project)\s*(?:#|no\.?)?\s*(\d+)/i,
    );
    if (indexMatch) {
      groupIndex = Math.max(0, parseInt(indexMatch[1], 10) - 1);
    }

    if (
      contextStr.includes("experience") ||
      contextStr.includes("employment") ||
      contextStr.includes("work history")
    ) {
      groupType = "experience";
    } else if (
      contextStr.includes("education") ||
      contextStr.includes("school") ||
      contextStr.includes("university")
    ) {
      groupType = "education";
    }

    // Priority 3: Custom fields mapping (Needs to override Standard rules and Textareas)
    const matchedCustom = matchCustomField(compositeText);
    if (matchedCustom) {
      mappings.push({
        fieldId: field.id,
        id: field.id,
        fieldType: `custom_field:${matchedCustom.label}`,
        confidence: 0.85,
        groupType,
        groupIndex: groupType ? groupIndex : undefined,
      });
      continue;
    }

    // Priority 4: Custom Question Text Areas (fallback manual input)
    if (field.type === "textarea") {
      let matchedRule: string | null = null;
      for (const [key, regex] of Object.entries(STANDARD_RULES)) {
        if (regex.test(compositeText)) {
          matchedRule = key;
          break;
        }
      }
      if (!matchedRule) {
        // If it's asking a custom question
        if (
          compositeText.includes("why") ||
          compositeText.includes("describe") ||
          compositeText.includes("explain") ||
          compositeText.includes("essay")
        ) {
          mappings.push({
            fieldId: field.id,
            id: field.id,
            fieldType: "custom_question",
            confidence: 0.8,
            originalQuestion:
              field.label || field.placeholder || "Unknown question",
            selectedValue: "[MANUAL_INPUT_NEEDED]",
          });
        }
        continue; // Do not map a long textarea to a random field
      }
    }

    // Priority 4: Education sub-field matching (school, degree, year)
    // Match if the field is inside an education section OR the label itself indicates an education field
    {
      let eduFieldType: string | null = null;
      for (const [key, regex] of Object.entries(EDUCATION_RULES)) {
        if (regex.test(compositeText)) {
          eduFieldType = key;
          break;
        }
      }
      // If we matched an education sub-field, auto-assign education groupType
      if (eduFieldType) {
        if (!groupType) groupType = "education";
        mappings.push({
          fieldId: field.id,
          id: field.id,
          fieldType: eduFieldType,
          confidence: 0.9,
          groupType: "education",
          groupIndex: groupIndex,
        });
        continue;
      }
    }

    // Priority 5: Standard Field matching
    let bestMatch: keyof typeof STANDARD_RULES | null = null;
    for (const [key, regex] of Object.entries(STANDARD_RULES)) {
      if (regex.test(compositeText)) {
        // Handle overlap between "phone" and "phoneCountryCode"
        if (bestMatch === "phone" && key === "phoneCountryCode") {
          // keep bestMatch = phoneCountryCode
          bestMatch = key;
        } else if (bestMatch === "phoneCountryCode" && key === "phone") {
          // skip overriding
        } else {
          bestMatch = key;
        }
      }
    }

    if (bestMatch) {
      mappings.push({
        fieldId: field.id,
        id: field.id,
        fieldType: bestMatch,
        confidence: 0.9,
        groupType,
        groupIndex: groupType ? groupIndex : undefined,
      });
      continue;
    }

    // Priority 6: Specific array groups (Skills, Language) inside Checkbox/Radio/Select
    if (
      (field.type === "checkbox_group" || field.type === "radio_group" || 
       field.type === "select" || field.type === "custom_select" || field.type.includes("select")) &&
      !bestMatch
    ) {
      if (
        compositeText.includes("skill") ||
        compositeText.includes("tech") ||
        compositeText.includes("language") ||
        compositeText.includes("framework")
      ) {
        mappings.push({
          fieldId: field.id,
          id: field.id,
          fieldType: "skill",
          confidence: 0.8,
        });
      } else if (
        compositeText.includes("proficiency") ||
        compositeText.includes("level")
      ) {
        // Handle standard "Proficiency Level" mapping to a custom field context
        const profMatched = matchCustomField("proficiency level");
        if (profMatched) {
          mappings.push({
            fieldId: field.id,
            id: field.id,
            fieldType: `custom_field:${profMatched.label}`,
            confidence: 0.8,
          });
        }
      }
    }
  }

  return mappings;
}
