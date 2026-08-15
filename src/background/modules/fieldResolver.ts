import { geminiService } from "../../services/geminiService";
import { fileMatchesField, _tokenize } from "../../utils/fileMatch";
import type { UserData, CustomField, FormField, SavedFile } from "../../types";
import { STANDARD_TO_CUSTOM_LABEL } from "../../services/heuristic/rules";
import { matchCustomField } from "../../services/heuristic/customFieldMatcher";

export const STANDARD_FIELD_KEYS = new Set([
  "firstName",
  "middleName",
  "lastName",
  "fullName",
  "email",
  "phone",
  "phoneCountryCode",
  "address",
  "city",
  "state",
  "zipCode",
  "country",
  "linkedin",
  "portfolio",
  "github",
  "summary",
  "headline",
  "dateOfBirth",
  "gender",
  "salaryExpectation",
  "noticePeriod",
  "workAuthorization",
  "yearsOfExperience",
  "resumeUpload",
  "emergencyContactName",
  "emergencyContactRelationship",
  "emergencyContactPhone",
  "bloodType",
  "allergies",
  "medicalConditions",
  "medications",
  "insuranceProvider",
  "policyNumber",
  "occupation",
  "industry",
  "educationLevel",
  "maritalStatus",
]);

/**
 * Resolve ALL field values — standard, custom, array, questions, and files.
 * This is the single source of truth for value resolution, used by both
 * processFieldsAI() and processFormStep().
 */
export async function resolveFieldValues(
  fieldMappings: any[],
  fields: FormField[],
  userData: Partial<UserData>,
  customFields: CustomField[],
  virtualLibrary: SavedFile[],
  useAI = true,
): Promise<void> {
  const hasCountryCodeField = fieldMappings.some(
    (m) => m.fieldType === "phoneCountryCode",
  );

  for (const mapping of fieldMappings) {
    if (mapping.action === "click_add") continue;

    const origField = fields.find(
      (f) => f.id === mapping.fieldId || f.id === mapping.id,
    );
    if (origField) {
      if (origField.rowHeader && !mapping.rowHeader) {
        mapping.rowHeader = origField.rowHeader;
      }
      if (origField.name && !mapping.name) {
        mapping.name = origField.name;
      }
      if (origField.colHeader && !mapping.colHeader) {
        mapping.colHeader = origField.colHeader;
      }
      if (origField.compoundLabel && !mapping.compoundLabel) {
        mapping.compoundLabel = origField.compoundLabel;
      }
    }

    // A. Custom questions — ask AI only if in AI mode (OR if it is a chat input)
    if (mapping.fieldType === "custom_question" && mapping.originalQuestion) {
      const originalField = fields.find(
        (f) => f.id === mapping.fieldId || f.id === mapping.id,
      );
      const isChat =
        originalField?.type === "contenteditable" ||
        (originalField?.chatContext && originalField.chatContext.length > 0);

      if (useAI || isChat) {
        try {
          if (isChat) {
            mapping.selectedValue = await geminiService.generateChatReply(
              originalField?.chatContext || [],
              userData,
            );
          } else {
            mapping.selectedValue = await geminiService.answerFormQuestion(
              mapping.originalQuestion,
              userData,
            );
          }
        } catch (e: any) {
          console.warn("Aullevo: Failed to answer question:", e.message);
          mapping.selectedValue = "[MANUAL_INPUT_NEEDED]";
        }
      } else {
        mapping.selectedValue = "[MANUAL_INPUT_NEEDED]";
      }
      continue;
    }

    // B. Custom fields, Memories, and Links
    if (mapping.fieldType?.startsWith("custom_field:")) {
      const targetLabel = mapping.fieldType
        .slice("custom_field:".length)
        .toLowerCase()
        .trim();

      // 1. Exact match pass (highest precision)
      const exactMatch = customFields.find(
        (cf: CustomField) => cf.label.toLowerCase().trim() === targetLabel,
      );
      if (exactMatch) {
        mapping.selectedValue = exactMatch.value;
        continue;
      }

      // 2. Token-set match with normalization (order-agnostic)
      const matched = matchCustomField(targetLabel, customFields);
      if (matched) {
        mapping.selectedValue = matched.value;
        continue;
      }

      // 3. Fallback: Context-based match if field context specifically matches
      const tokenize = (s: string) =>
        s
          .replace(/[^a-z0-9]/gi, " ")
          .toLowerCase()
          .split(/\s+/)
          .filter(
            (w) =>
              w.length > 0 &&
              !["and", "or", "the", "a", "in", "of", "-"].includes(w),
          );

      const targetTokens = new Set(tokenize(targetLabel));
      const contextMatch = customFields.find((cf: CustomField) => {
        if (!cf.context) return false;
        const ctxTokens = new Set(tokenize(cf.context));
        return (
          targetTokens.size > 0 &&
          Array.from(targetTokens).every((t) => ctxTokens.has(t))
        );
      });

      if (contextMatch) {
        mapping.selectedValue = contextMatch.value;
      }
      continue;
    }

    if (mapping.fieldType?.startsWith("memory:")) {
      const memoryId = mapping.fieldType.slice("memory:".length);
      const match = (userData.memories || []).find((m) => m.id === memoryId);
      if (match) mapping.selectedValue = match.content;
      continue;
    }

    if (mapping.fieldType?.startsWith("link:")) {
      const linkId = mapping.fieldType.slice("link:".length);
      const match = (userData.savedLinks || []).find((l) => l.id === linkId);
      if (match) mapping.selectedValue = match.url;
      continue;
    }

    // C. Array mapping (experience, education, skills in groups)
    if (mapping.groupType && typeof mapping.groupIndex === "number") {
      let arraySource: any[] = [];
      if (mapping.groupType === "experience")
        arraySource = userData.experience || [];
      if (mapping.groupType === "education")
        arraySource = userData.education || [];
      if (mapping.groupType === "skill") arraySource = userData.skills || [];

      const item = arraySource[mapping.groupIndex];
      if (item) {
        if (
          typeof item === "object" &&
          item !== null &&
          mapping.fieldType &&
          mapping.fieldType in item
        ) {
          mapping.selectedValue = String((item as any)[mapping.fieldType]);
        } else if (mapping.groupType === "skill") {
          mapping.selectedValue = String(item);
        }
      }
      continue;
    }

    // D. Standard fields (firstName, email, phone, etc.)
    if (
      !mapping.selectedValue &&
      mapping.fieldType &&
      (STANDARD_FIELD_KEYS.has(mapping.fieldType) ||
        mapping.fieldType === "skill")
    ) {
      let resolvedVal: string | string[] | undefined = undefined;

      if (mapping.fieldType === "phoneCountryCode") {
        const match = userData.phone?.match(/\+(\d+)/);
        if (match) resolvedVal = `+${match[1]}`;
        else if (userData.phone) resolvedVal = userData.phone;
      } else if (mapping.fieldType === "phone") {
        let val = userData.phone || "";
        if (hasCountryCodeField) val = val.replace(/^\+\d+[- ]?/, "");
        if (val) resolvedVal = val;
      } else if (mapping.fieldType === "fullName") {
        const full =
          userData.fullName ||
          [userData.firstName, userData.middleName, userData.lastName]
            .filter(Boolean)
            .join(" ");
        if (full) resolvedVal = full;
      } else if (
        mapping.fieldType === "skill" &&
        mapping.groupType !== "skill"
      ) {
        if (userData.skills && userData.skills.length > 0) {
          resolvedVal = userData.skills;
        }
      } else {
        const val = (userData as any)[mapping.fieldType];
        if (val !== undefined && val !== null && val !== "") {
          resolvedVal = Array.isArray(val) ? val.join(", ") : String(val);
        }
      }

      if (resolvedVal !== undefined && resolvedVal !== "") {
        mapping.selectedValue = resolvedVal;
      }

      // ✨ FALLBACK TO CUSTOM FIELDS:
      // If userData did not supply a value (e.g. Profile Type: Custom / General),
      // look in customFields:
      // 1. Direct algorithmic match on the field's actual label (e.g. "Present Address")
      // 2. Exact match against standard aliases
      // 3. Algorithmic match against aliases
      if (!mapping.selectedValue && customFields.length > 0) {
        if (origField?.label) {
          const directMatch = matchCustomField(origField.label, customFields);
          if (directMatch) mapping.selectedValue = directMatch.value;
        }

        if (!mapping.selectedValue) {
          const aliases = STANDARD_TO_CUSTOM_LABEL[mapping.fieldType] || [];
          if (aliases.length > 0) {
            const cfMatch = customFields.find((cf) => {
              const lbl = cf.label.toLowerCase().trim();
              return aliases.some((alias) => lbl === alias);
            });
            if (cfMatch) mapping.selectedValue = cfMatch.value;
          }

          if (!mapping.selectedValue && aliases.length > 0) {
            for (const alias of aliases) {
              const cfMatch = matchCustomField(alias, customFields);
              if (cfMatch) {
                mapping.selectedValue = cfMatch.value;
                break;
              }
            }
          }
        }
      }
    }
  }

  // E. File vault matching — match library files to ALL file-type fields
  if (virtualLibrary.length > 0) {
    const fileFields = fields.filter((f) => f.type === "file");

    for (const fileField of fileFields) {
      let mapping = fieldMappings.find(
        (m) =>
          m.action !== "click_add" &&
          (m.id === fileField.id || m.fieldId === fileField.id),
      );

      if (!mapping) {
        mapping = {
          id: fileField.id,
          fieldId: fileField.id,
          fieldType: "resumeUpload",
          confidence: 0.8,
        };
        fieldMappings.push(mapping);
      }

      if (mapping.fileData || (mapping.files && mapping.files.length > 0))
        continue;

      const extraKws = mapping.fieldType ? _tokenize(mapping.fieldType) : [];

      const matchedFiles = virtualLibrary.filter((sf) =>
        fileMatchesField(fileField, sf, extraKws),
      );

      if (matchedFiles.length > 0) {
        if (fileField.multiple) {
          mapping.files = matchedFiles.map((sf) => ({
            name: sf.name,
            dataUrl: sf.dataUrl,
          }));
          mapping.selectedValue = "FILE_UPLOAD";
          console.log(
            `Aullevo FileVault: ${matchedFiles.length} files matched to [${fileField.label || fileField.name || fileField.id}] (Multiple)`,
          );
        } else {
          const bestMatch = matchedFiles[0];
          mapping.fileData = bestMatch.dataUrl;
          mapping.fileName = bestMatch.name;
          mapping.selectedValue = "FILE_UPLOAD";
          console.log(
            `Aullevo FileVault: "${bestMatch.name}" matched to [${fileField.label || fileField.name || fileField.id}] (Single)`,
          );
        }
      }
    }
  }
}
