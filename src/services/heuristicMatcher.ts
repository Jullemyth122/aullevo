import type { FormField, CustomField, FieldMapping, UserData } from "../types";
import { STANDARD_RULES, EDUCATION_RULES } from "./heuristic/rules";
import { isDynamicId } from "./heuristic/idUtils";
import { matchCustomField } from "./heuristic/customFieldMatcher";
import { matchMemory, matchSavedLink } from "./heuristic/memoryMatcher";

// Re-export all submodules so consumers can access rule sets and utilities directly if needed
export * from "./heuristic";

/**
 * Heuristically classifies and maps form fields to user data, custom fields, memories, and saved links.
 * Priority order:
 *  1. Add buttons (click_add)
 *  2. Standard field rules (firstName, lastName, email, phone, ...)
 *  3. Education sub-field rules
 *  4. Custom fields — for non-standard labels only
 *  5. Memory / Link matching
 *  6. Custom question fallback (textareas)
 */
export function matchFieldsHeuristically(
  fields: FormField[],
  customFields: CustomField[] = [],
  userData: Partial<UserData> = {},
): FieldMapping[] {
  const mappings: FieldMapping[] = [];

  for (const field of fields) {
    // ── Priority 1: Action Add Buttons ──
    if (field.type === "button" || field.type === "submit") {
      const labelLower = (field.label || "").toLowerCase();
      const contextLower = (field.context || "").toLowerCase();
      if (labelLower.includes("add") || labelLower.includes("plus")) {
        let groupType:
          | "experience"
          | "education"
          | "project"
          | "skill"
          | undefined;
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

    // compositeText: full context including id, name, context — for broad fallback matching
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

    // directText: ONLY direct field signals — label, aria-label, placeholder
    // This is the primary signal for standard rule matching
    const directText = [field.label, field.ariaLabel, field.placeholder]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    // Group type detection (experience / education repeating sections)
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

    // ── Priority 2: Custom Question Text Areas & Chat Inputs ──
    if (field.type === "textarea" || field.type === "contenteditable") {
      let matchedRule: string | null = null;
      for (const [key, regex] of Object.entries(STANDARD_RULES)) {
        if (regex.test(directText) || regex.test(compositeText)) {
          matchedRule = key;
          break;
        }
      }
      if (!matchedRule) {
        if (
          field.type === "contenteditable" ||
          compositeText.includes("why") ||
          compositeText.includes("describe") ||
          compositeText.includes("explain") ||
          compositeText.includes("essay")
        ) {
          const lastChatMsg =
            field.chatContext && field.chatContext.length > 0
              ? field.chatContext[field.chatContext.length - 1]
              : null;
          mappings.push({
            fieldId: field.id,
            id: field.id,
            fieldType: "custom_question",
            confidence: 0.8,
            originalQuestion:
              lastChatMsg ||
              field.label ||
              field.placeholder ||
              "Unknown question/chat",
            selectedValue: "[MANUAL_INPUT_NEEDED]",
          });
        }
        continue;
      }
    }

    // ── Priority 2.5: Matrix 2D Coordinate Matching ──
    // If the field has a genuine 2D matrix coordinate (e.g. "Mon — From"),
    // match custom fields first to prevent broad context rules from capturing it.
    const isMatrixField = !!(
      field.compoundLabel ||
      (field.rowHeader && field.colHeader)
    );
    if (isMatrixField && customFields.length > 0) {
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
        mappings.push({
          fieldId: field.id,
          id: field.id,
          name: field.name || undefined,
          rowHeader: field.rowHeader || undefined,
          colHeader: field.colHeader || undefined,
          compoundLabel: field.compoundLabel || undefined,
          fieldType: `custom_field:${matchedCustom.label}`,
          confidence: 0.9,
          groupType,
          groupIndex: groupType ? groupIndex : undefined,
        });
        continue;
      }
      // If it is a matrix coordinate cell and didn't match custom fields, do not let standard rules hijack it
      if (field.compoundLabel) {
        continue;
      }
    }

    // ── Priority 3: Standard field matching ──
    // Prefer directText (label/aria/placeholder) first to avoid context pollution.
    // This runs BEFORE broad custom field matching to ensure First Name, Last Name, Email,
    // Phone etc. are always correctly identified by their actual label.
    let bestMatch: keyof typeof STANDARD_RULES | null = null;

    if (directText) {
      for (const [key, regex] of Object.entries(STANDARD_RULES)) {
        if (regex.test(directText)) {
          bestMatch = key as keyof typeof STANDARD_RULES;
          break;
        }
      }
    }

    // Fallback: try compositeText if directText didn't match AND directText is empty
    if (!bestMatch && !directText) {
      for (const [key, regex] of Object.entries(STANDARD_RULES)) {
        if (regex.test(compositeText)) {
          if (bestMatch === "phone" && key === "phoneCountryCode") {
            bestMatch = key;
          } else if (bestMatch === "phoneCountryCode" && key === "phone") {
            // skip — country code match already found
          } else if (bestMatch === "email" && key === "address") {
            // keep email — do not let "Email Address" get matched to address
          } else if (
            key === "address" &&
            (compositeText.includes("email") ||
              compositeText.includes("e-mail"))
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
      mappings.push({
        fieldId: field.id,
        id: field.id,
        name: field.name || undefined,
        rowHeader: field.rowHeader || undefined,
        colHeader: field.colHeader || undefined,
        compoundLabel: field.compoundLabel || undefined,
        fieldType: bestMatch,
        confidence: 0.9,
        groupType,
        groupIndex: groupType ? groupIndex : undefined,
      });
      continue;
    }

    // ── Priority 4: Education sub-field matching ──
    {
      let eduFieldType: string | null = null;
      for (const [key, regex] of Object.entries(EDUCATION_RULES)) {
        if (regex.test(compositeText)) {
          eduFieldType = key;
          break;
        }
      }
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

    // ── Priority 5: Custom field matching — for non-standard / custom labels ──
    // Only runs for fields that did NOT match any standard rule above.
    const directFieldText = [
      field.label,
      field.ariaLabel,
      field.placeholder,
      nameToUse,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchedCustom =
      matchCustomField(directFieldText, customFields) ||
      matchCustomField(compositeText, customFields);

    if (matchedCustom) {
      mappings.push({
        fieldId: field.id,
        id: field.id,
        name: field.name || undefined,
        rowHeader: field.rowHeader || undefined,
        colHeader: field.colHeader || undefined,
        compoundLabel: field.compoundLabel || undefined,
        fieldType: `custom_field:${matchedCustom.label}`,
        confidence: 0.85,
        groupType,
        groupIndex: groupType ? groupIndex : undefined,
      });
      continue;
    }

    // ── Priority 6: Memory / Link matching ──
    const matchedMemory = matchMemory(compositeText, userData.memories);
    if (matchedMemory) {
      mappings.push({
        fieldId: field.id,
        id: field.id,
        name: field.name || undefined,
        rowHeader: field.rowHeader || undefined,
        colHeader: field.colHeader || undefined,
        compoundLabel: field.compoundLabel || undefined,
        fieldType: `memory:${matchedMemory.id}`,
        confidence: 0.85,
        groupType,
        groupIndex: groupType ? groupIndex : undefined,
      });
      continue;
    }

    const matchedLink = matchSavedLink(compositeText, userData.savedLinks);
    if (matchedLink) {
      mappings.push({
        fieldId: field.id,
        id: field.id,
        name: field.name || undefined,
        rowHeader: field.rowHeader || undefined,
        colHeader: field.colHeader || undefined,
        compoundLabel: field.compoundLabel || undefined,
        fieldType: `link:${matchedLink.id}`,
        confidence: 0.85,
        groupType,
        groupIndex: groupType ? groupIndex : undefined,
      });
      continue;
    }

    // ── Priority 7: Skill / Language arrays ──
    if (
      (field.type === "checkbox_group" ||
        field.type === "radio_group" ||
        field.type === "select" ||
        field.type === "custom_select" ||
        field.type.includes("select")) &&
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
          name: field.name || undefined,
          rowHeader: field.rowHeader || undefined,
          colHeader: field.colHeader || undefined,
          compoundLabel: field.compoundLabel || undefined,
          fieldType: "skill",
          confidence: 0.8,
        });
      } else if (
        compositeText.includes("proficiency") ||
        compositeText.includes("level")
      ) {
        const profMatched = matchCustomField("proficiency level", customFields);
        if (profMatched) {
          mappings.push({
            fieldId: field.id,
            id: field.id,
            name: field.name || undefined,
            rowHeader: field.rowHeader || undefined,
            colHeader: field.colHeader || undefined,
            compoundLabel: field.compoundLabel || undefined,
            fieldType: `custom_field:${profMatched.label}`,
            confidence: 0.8,
          });
        }
      }
    }
  }

  return mappings;
}
