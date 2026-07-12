import type { FormField, CustomField, FieldMapping, UserData, Memory, SavedLink } from "../types";

function isDynamicId(id: string): boolean {
  if (!id) return true;
  const dynamicPatterns = [
    /^\d+$/,                           // pure digits
    /^u_[0-9]/i,                       // Facebook style u_0_a
    /^_r_/i,                           // Facebook style _r_
    /^react-aria/i,                    // React Aria
    /^ember/i,                         // Ember
    /^input-\d+$/i,                    // generic dynamic input-123
    /^[a-f0-9-]{20,}$/i                // Long UUID or hash
  ];
  return dynamicPatterns.some((pat) => pat.test(id));
}

export function matchFieldsHeuristically(
  fields: FormField[],
  customFields: CustomField[] = [],
  userData: Partial<UserData> = {},
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
    emergencyContactName: /emergency\s*contact\s*name/i,
    emergencyContactRelationship: /emergency\s*contact\s*relationship/i,
    emergencyContactPhone: /emergency\s*contact\s*(phone|number|cell)/i,
    bloodType: /blood\s*(type|group)/i,
    allergies: /allergies|allergy/i,
    medicalConditions: /medical\s*(conditions|history|illness)/i,
    medications: /medications|medicine|drugs/i,
    insuranceProvider: /insurance\s*(provider|carrier|company)/i,
    policyNumber: /policy\s*(number|no|id)/i,
    occupation: /occupation|job\s*title|profession/i,
    industry: /industry|sector/i,
    educationLevel: /education\s*level|highest\s*degree|education/i,
    maritalStatus: /marital\s*status|relationship\s*status|married/i,
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

      // 1. Exact substring match (either direction)
      if (lowerText.length > 3 && labelLogic.length > 3 && (lowerText.includes(labelLogic) || labelLogic.includes(lowerText))) return cf;
      if (contextLogic && lowerText.length > 3 && contextLogic.length > 3 && (lowerText.includes(contextLogic) || contextLogic.includes(lowerText))) return cf;

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
        if (part.length > 3 && (lowerText.includes(part) || part.includes(lowerText))) return cf;

        const cfWords = getSignificantWords(part);
        if (cfWords.length > 0 && textWords.length > 0) {
          // Check if all cfWords are in textWords
          let matchedAllCF = true;
          for (const cw of cfWords) {
            const wordMatched = textWords.some(
              (tw) =>
                tw === cw ||
                // Only allow partial matches if both words are substantial (>= 4 chars)
                (tw.length >= 4 && cw.length >= 4 && (tw.includes(cw) || cw.includes(tw)))
            );
            if (!wordMatched) {
              matchedAllCF = false;
              break;
            }
          }

          // Check if all textWords are in cfWords
          let matchedAllText = true;
          for (const tw of textWords) {
            const wordMatched = cfWords.some(
              (cw) =>
                tw === cw ||
                (tw.length >= 4 && cw.length >= 4 && (tw.includes(cw) || cw.includes(tw)))
            );
            if (!wordMatched) {
              matchedAllText = false;
              break;
            }
          }

          if (matchedAllCF || matchedAllText) return cf;
        }
      }
    }
    return null;
  }

  // Helper to evaluate text against all memories using a semantic word match
  function matchMemory(text: string): Memory | null {
    if (!text || !userData.memories || userData.memories.length === 0) return null;
    const lowerText = text.toLowerCase();

    let bestMem: Memory | null = null;
    let bestScore = 0;

    for (const mem of userData.memories) {
      const titleLogic = mem.title.toLowerCase();

      // 1. Exact substring match
      if (lowerText.includes(titleLogic)) {
        const score = (titleLogic.length / lowerText.length) + 1.0;
        if (score > bestScore) {
          bestScore = score;
          bestMem = mem;
        }
        continue;
      }

      // 2. Semantic word match (order-independent)
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

      const titleWords = getSignificantWords(titleLogic);
      const textWords = getSignificantWords(lowerText);

      if (titleWords.length > 0) {
        let matchCount = 0;
        for (const cw of titleWords) {
          const wordMatched = textWords.some(
            (tw) =>
              tw === cw ||
              (tw.length >= 4 && cw.length >= 4 && (tw.includes(cw) || cw.includes(tw)))
          );
          if (wordMatched) matchCount++;
        }

        const matchRatio = matchCount / titleWords.length;
        // Require at least 50% of the significant words in the memory title to match the form field label
        if (matchRatio >= 0.5) {
          if (matchRatio > bestScore) {
            bestScore = matchRatio;
            bestMem = mem;
          }
        }
      }
    }
    return bestMem;
  }

  // Helper to evaluate text against saved links
  function matchSavedLink(text: string): SavedLink | null {
    if (!text || !userData.savedLinks || userData.savedLinks.length === 0) return null;
    const lowerText = text.toLowerCase();

    // Check specific fields like 'portfolio' or 'github' vs the standard links, but here we match the title
    for (const link of userData.savedLinks) {
      const titleLogic = link.title.toLowerCase();
      // Simple substring match for links
      if (lowerText.includes(titleLogic)) return link;
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

    // Ignore dynamic/auto-generated IDs to prevent them from causing bad matches
    const idToUse = field.id && !isDynamicId(field.id) ? field.id : "";
    const nameToUse = field.name && !isDynamicId(field.name) ? field.name : "";

    const compositeText = [
      field.label,
      field.ariaLabel,
      field.placeholder,
      nameToUse,
      field.context,
      idToUse,
      ...(field.chatContext || [])
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

    // Priority 3: Custom fields, Memories, and Links mapping (Needs to override Standard rules and Textareas)
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

    const matchedMemory = matchMemory(compositeText);
    if (matchedMemory) {
      mappings.push({
        fieldId: field.id,
        id: field.id,
        fieldType: `memory:${matchedMemory.id}`,
        confidence: 0.85,
        groupType,
        groupIndex: groupType ? groupIndex : undefined,
      });
      continue;
    }

    const matchedLink = matchSavedLink(compositeText);
    if (matchedLink) {
      mappings.push({
        fieldId: field.id,
        id: field.id,
        fieldType: `link:${matchedLink.id}`,
        confidence: 0.85,
        groupType,
        groupIndex: groupType ? groupIndex : undefined,
      });
      continue;
    }

    // Priority 4: Custom Question Text Areas & Chat Inputs (fallback manual input)
    if (field.type === "textarea" || field.type === "contenteditable") {
      let matchedRule: string | null = null;
      for (const [key, regex] of Object.entries(STANDARD_RULES)) {
        if (regex.test(compositeText)) {
          matchedRule = key;
          break;
        }
      }
      if (!matchedRule) {
        // If it's asking a custom question or is a chat input
        if (
          field.type === "contenteditable" ||
          compositeText.includes("why") ||
          compositeText.includes("describe") ||
          compositeText.includes("explain") ||
          compositeText.includes("essay")
        ) {
          const lastChatMsg = field.chatContext && field.chatContext.length > 0 
            ? field.chatContext[field.chatContext.length - 1] 
            : null;
          mappings.push({
            fieldId: field.id,
            id: field.id,
            fieldType: "custom_question",
            confidence: 0.8,
            originalQuestion:
              lastChatMsg || field.label || field.placeholder || "Unknown question/chat",
            selectedValue: "[MANUAL_INPUT_NEEDED]",
          });
        }
        continue; // Do not map a long textarea/chat to a random field
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
