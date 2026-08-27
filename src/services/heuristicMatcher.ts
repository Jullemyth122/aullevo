import type { FormField, CustomField, FieldMapping, UserData } from "../types";
import { STANDARD_RULES, EDUCATION_RULES } from "./heuristic/rules";
import { isDynamicId } from "./heuristic/idUtils";
import { matchCustomField } from "./heuristic/customFieldMatcher";
import { matchMemory, matchSavedLink } from "./heuristic/memoryMatcher";

// Re-export submodules for direct rule access
export * from "./heuristic";

/**
 * Builds a standardized FieldMapping object with common fields populated.
 */
function createMapping(
  field: FormField,
  fieldType: string,
  confidence: number,
  extra?: Partial<FieldMapping>,
): FieldMapping {
  return {
    fieldId: field.id,
    id: field.id,
    name: field.name || undefined,
    rowHeader: field.rowHeader || undefined,
    colHeader: field.colHeader || undefined,
    compoundLabel: field.compoundLabel || undefined,
    fieldType,
    confidence,
    ...extra,
  };
}

/**
 * Priority 1: Detects repeater "Add" buttons (experience, education, projects, skills).
 */
function detectAddButton(field: FormField): FieldMapping | null {
  if (field.type !== "button" && field.type !== "submit") {
    return null;
  }

  const labelLower = (field.label || "").toLowerCase();
  const contextLower = (field.context || "").toLowerCase();

  if (!labelLower.includes("add") && !labelLower.includes("plus")) {
    return null;
  }

  let groupType: "experience" | "education" | "project" | "skill" | undefined;
  if (
    labelLower.includes("experience") ||
    contextLower.includes("experience") ||
    labelLower.includes("job")
  ) {
    groupType = "experience";
  } else if (
    labelLower.includes("education") ||
    contextLower.includes("education") ||
    labelLower.includes("school")
  ) {
    groupType = "education";
  } else if (labelLower.includes("project")) {
    groupType = "project";
  } else if (labelLower.includes("skill")) {
    groupType = "skill";
  }

  if (groupType) {
    return {
      fieldId: field.id,
      id: field.id,
      fieldType: "",
      action: "click_add",
      groupType,
      confidence: 0.9,
    };
  }

  return null;
}

/**
 * Extracts repeater group type and index from section/context strings.
 */
function detectGroupSection(field: FormField): {
  groupType: "experience" | "education" | "project" | "skill" | undefined;
  groupIndex: number;
} {
  let groupType: "experience" | "education" | "project" | "skill" | undefined;
  let groupIndex = 0;

  const contextStr = (field.context || field.section || "").toLowerCase();
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

  return { groupType, groupIndex };
}

/**
 * Priority 2: Matches 2D matrix coordinate cells against custom fields.
 */
function detectMatrixMatch(
  field: FormField,
  customFields: CustomField[],
  groupType?: "experience" | "education" | "project" | "skill",
  groupIndex?: number,
): { mapping: FieldMapping | null; shouldSkip: boolean } {
  const isMatrixField = !!(
    field.compoundLabel ||
    (field.rowHeader && field.colHeader)
  );

  if (!isMatrixField || customFields.length === 0) {
    return { mapping: null, shouldSkip: false };
  }

  const matrixText = [
    field.compoundLabel,
    field.label,
    field.rowHeader && field.colHeader
      ? `${field.rowHeader} ${field.colHeader}`
      : "",
    field.colHeader && field.rowHeader
      ? `${field.colHeader} ${field.rowHeader}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const matchedCustom = matchCustomField(matrixText, customFields);
  if (matchedCustom) {
    return {
      mapping: createMapping(
        field,
        `custom_field:${matchedCustom.label}`,
        0.9,
        {
          groupType,
          groupIndex: groupType ? groupIndex : undefined,
        },
      ),
      shouldSkip: false,
    };
  }

  // If it is a matrix coordinate cell with compoundLabel and didn't match custom fields,
  // do not let standard rules hijack it.
  return { mapping: null, shouldSkip: !!field.compoundLabel };
}

/**
 * Priority 3: Matches direct standard field signals (label, aria-label, placeholder).
 */
function detectStandardMatch(
  field: FormField,
  directText: string,
  compositeText: string,
  groupType?: "experience" | "education" | "project" | "skill",
  groupIndex?: number,
): FieldMapping | null {
  let bestMatch: keyof typeof STANDARD_RULES | null = null;

  if (directText) {
    for (const [key, regex] of Object.entries(STANDARD_RULES)) {
      if (regex.test(directText)) {
        bestMatch = key as keyof typeof STANDARD_RULES;
        break;
      }
    }
  }

  // Fallback: evaluate compositeText if directText is empty
  if (!bestMatch && !directText) {
    for (const [key, regex] of Object.entries(STANDARD_RULES)) {
      if (regex.test(compositeText)) {
        if (bestMatch === "phone" && key === "phoneCountryCode") {
          bestMatch = key;
        } else if (bestMatch === "phoneCountryCode" && key === "phone") {
          // Keep phoneCountryCode match
        } else if (bestMatch === "email" && key === "address") {
          // Keep email match over address
        } else if (
          key === "address" &&
          (compositeText.includes("email") || compositeText.includes("e-mail"))
        ) {
          if (
            !compositeText.includes("street") &&
            !compositeText.includes("home address") &&
            !compositeText.includes("current address") &&
            !compositeText.includes("postal")
          ) {
            continue;
          }
          bestMatch = key;
        } else {
          bestMatch = key as keyof typeof STANDARD_RULES;
        }
      }
    }
  }

  if (bestMatch) {
    return createMapping(field, bestMatch, 0.9, {
      groupType,
      groupIndex: groupType ? groupIndex : undefined,
    });
  }

  return null;
}

/**
 * Priority 4: Matches repeating education sub-fields (degree, school, graduation year).
 */
function detectEducationSubMatch(
  field: FormField,
  compositeText: string,
  groupIndex: number,
): FieldMapping | null {
  for (const [key, regex] of Object.entries(EDUCATION_RULES)) {
    if (regex.test(compositeText)) {
      return {
        fieldId: field.id,
        id: field.id,
        fieldType: key,
        confidence: 0.9,
        groupType: "education",
        groupIndex,
      };
    }
  }
  return null;
}

/**
 * Priority 5: Matches custom fields against direct label text for non-standard fields.
 */
function detectCustomFieldMatch(
  field: FormField,
  directFieldText: string,
  customFields: CustomField[],
  confidence: number,
  groupType?: "experience" | "education" | "project" | "skill",
  groupIndex?: number,
): FieldMapping | null {
  if (customFields.length === 0 || !directFieldText) return null;

  const matchedCustom = matchCustomField(directFieldText, customFields);
  if (matchedCustom) {
    return createMapping(field, `custom_field:${matchedCustom.label}`, confidence, {
      groupType,
      groupIndex: groupType ? groupIndex : undefined,
    });
  }

  return null;
}

/**
 * Priority 6: Matches user memories and saved links.
 */
function detectMemoryOrLinkMatch(
  field: FormField,
  compositeText: string,
  userData: Partial<UserData>,
  groupType?: "experience" | "education" | "project" | "skill",
  groupIndex?: number,
): FieldMapping | null {
  const matchedMemory = matchMemory(compositeText, userData.memories);
  if (matchedMemory) {
    return createMapping(field, `memory:${matchedMemory.id}`, 0.85, {
      groupType,
      groupIndex: groupType ? groupIndex : undefined,
    });
  }

  const matchedLink = matchSavedLink(compositeText, userData.savedLinks);
  if (matchedLink) {
    return createMapping(field, `link:${matchedLink.id}`, 0.85, {
      groupType,
      groupIndex: groupType ? groupIndex : undefined,
    });
  }

  return null;
}

/**
 * Priority 7: Matches skill and proficiency select/checkbox groups.
 */
function detectSkillArrayMatch(
  field: FormField,
  compositeText: string,
  customFields: CustomField[],
): FieldMapping | null {
  const isSelectOrGroup =
    field.type === "checkbox_group" ||
    field.type === "radio_group" ||
    field.type === "select" ||
    field.type === "custom_select" ||
    field.type.includes("select");

  if (!isSelectOrGroup) return null;

  if (
    compositeText.includes("skill") ||
    compositeText.includes("tech") ||
    compositeText.includes("language") ||
    compositeText.includes("framework")
  ) {
    return createMapping(field, "skill", 0.8);
  }

  if (
    compositeText.includes("proficiency") ||
    compositeText.includes("level")
  ) {
    const profMatched = matchCustomField("proficiency level", customFields);
    if (profMatched) {
      return createMapping(field, `custom_field:${profMatched.label}`, 0.8);
    }
  }

  return null;
}

/**
 * Priority 8: Open-ended Custom Question / Chat fallback.
 */
function detectOpenEndedQuestion(
  field: FormField,
  compositeText: string,
): FieldMapping | null {
  const isTextType =
    field.type === "textarea" ||
    field.type === "contenteditable" ||
    field.type === "text";

  if (!isTextType) return null;

  const isDescriptive =
    field.type === "contenteditable" ||
    compositeText.includes("why") ||
    compositeText.includes("describe") ||
    compositeText.includes("explain") ||
    compositeText.includes("essay");

  if (isDescriptive) {
    const lastChatMsg =
      field.chatContext && field.chatContext.length > 0
        ? field.chatContext[field.chatContext.length - 1]
        : null;

    return {
      fieldId: field.id,
      id: field.id,
      fieldType: "custom_question",
      confidence: 0.7,
      originalQuestion:
        lastChatMsg ||
        field.label ||
        field.placeholder ||
        "Unknown question/chat",
      selectedValue: "[MANUAL_INPUT_NEEDED]",
    };
  }

  return null;
}

/**
 * Heuristically classifies and maps form fields to user data, custom fields, memories, and saved links.
 * Follows a strict priority hierarchy with early returns and isolated rule matchers.
 */
export function matchFieldsHeuristically(
  fields: FormField[],
  customFields: CustomField[] = [],
  userData: Partial<UserData> = {},
): FieldMapping[] {
  const mappings: FieldMapping[] = [];

  for (const field of fields) {
    // 1. Action Add Buttons
    const addBtn = detectAddButton(field);
    if (addBtn) {
      mappings.push(addBtn);
      continue;
    }

    // Prepare clean text signals
    const idToUse = field.id && !isDynamicId(field.id) ? field.id : "";
    const nameToUse = field.name && !isDynamicId(field.name) ? field.name : "";

    const compositeText = [
      field.label,
      field.ariaLabel,
      field.placeholder,
      nameToUse,
      field.context,
      idToUse,
      ...(field.chatContext || []),
    ]
      .join(" ")
      .toLowerCase();

    const directText = [field.label, field.ariaLabel, field.placeholder]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const { groupType, groupIndex } = detectGroupSection(field);

    // 2. 2D Matrix Coordinate Matching
    const matrixResult = detectMatrixMatch(field, customFields, groupType, groupIndex);
    if (matrixResult.mapping) {
      mappings.push(matrixResult.mapping);
      continue;
    }
    if (matrixResult.shouldSkip) {
      continue;
    }

    // 2.5 Direct User Custom Field Match
    const directCustomMatch = detectCustomFieldMatch(
      field,
      directText,
      customFields,
      0.95,
      groupType,
      groupIndex,
    );
    if (directCustomMatch) {
      mappings.push(directCustomMatch);
      continue;
    }

    // 3. Standard Field Matching (firstName, email, phone, address, etc.)
    const standardMatch = detectStandardMatch(
      field,
      directText,
      compositeText,
      groupType,
      groupIndex,
    );
    if (standardMatch) {
      mappings.push(standardMatch);
      continue;
    }

    // 4. Education Repeating Sub-Fields
    const eduMatch = detectEducationSubMatch(field, compositeText, groupIndex);
    if (eduMatch) {
      mappings.push(eduMatch);
      continue;
    }

    // 5. Custom Field Fallback (Non-standard labels)
    const directFieldText = [
      field.label,
      field.ariaLabel,
      field.placeholder,
      nameToUse,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const customFallback = detectCustomFieldMatch(
      field,
      directFieldText,
      customFields,
      0.85,
      groupType,
      groupIndex,
    );
    if (customFallback) {
      mappings.push(customFallback);
      continue;
    }

    // 6. Memory / Saved Link Matching
    const memoryOrLinkMatch = detectMemoryOrLinkMatch(
      field,
      compositeText,
      userData,
      groupType,
      groupIndex,
    );
    if (memoryOrLinkMatch) {
      mappings.push(memoryOrLinkMatch);
      continue;
    }

    // 7. Skill / Language Array Matching
    const skillMatch = detectSkillArrayMatch(field, compositeText, customFields);
    if (skillMatch) {
      mappings.push(skillMatch);
      continue;
    }

    // 8. Open-ended Custom Question / Chat Fallback
    const openQuestionMatch = detectOpenEndedQuestion(field, compositeText);
    if (openQuestionMatch) {
      mappings.push(openQuestionMatch);
      continue;
    }
  }

  return mappings;
}
