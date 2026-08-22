/**
 * @file fieldResolver.ts
 * @module background/modules
 *
 * ─── ROLE IN THE ARCHITECTURE
 * The VALUE RESOLUTION engine — the single source of truth for deciding
 * WHAT to put into each detected form field.
 *
 * Once the AI or heuristic matcher has identified WHICH user data key maps
 * to WHICH form field (e.g. "firstName" → input#fname), this file determines
 * the actual string/file value to inject (e.g. userData.firstName = "Alex").
 *
 * It handles every value category the extension supports:
 *   A. Custom questions   → answered by Gemini AI
 *   B. Custom fields      → matched from userData.customFields (memories, links)
 *   C. Array groups       → experience / education / skills by index
 *   D. Standard fields    → firstName, email, phone, etc. from UserData
 *   E. File vault         → PDF/DOCX uploads matched to file-type inputs
 *
 * WHO IMPORTS THIS FILE:
 *   • formStepProcessor.ts → processFieldsAI() and processFormStep()
 *     both call resolveFieldValues() after getting field mappings.
 *
 * DEPENDENCY DIRECTION:
 *   formStepProcessor.ts
 *     └── fieldResolver.ts   ← YOU ARE HERE
 *           ├── geminiService           (for custom_question AI answers)
 *           ├── fileMatch utils         (for file vault matching)
 *           ├── heuristic/rules         (STANDARD_TO_CUSTOM_LABEL alias map)
 *           └── heuristic/customFieldMatcher (token-based fuzzy label matching)
 */

import { geminiService } from "../../services/geminiService";
import { fileMatchesField, _tokenize } from "../../utils/fileMatch";
import type { UserData, CustomField, FormField, SavedFile } from "../../types";
import { STANDARD_TO_CUSTOM_LABEL } from "../../services/heuristic/rules";
import { matchCustomField } from "../../services/heuristic/customFieldMatcher";

// KNOWN STANDARD FIELD KEYS

/**
 * STANDARD_FIELD_KEYS
 * ───────────────────
 * The complete set of field type keys that map directly to properties
 * on a UserData object (e.g. "firstName" → userData.firstName).
 *
 * Used in resolveFieldValues() Section D to know when to look up a
 * value from userData directly vs. falling through to custom-field matching.
 *
 * If you add a new standard field to the UserData type, add its key here
 * so the resolver recognises it.
 */
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

// MAIN RESOLVER

/**
 * resolveFieldValues
 * ──────────────────
 * Mutates each mapping object inside `fieldMappings` by setting
 * `mapping.selectedValue` (and optionally `mapping.fileData` /
 * `mapping.files` for file inputs).
 *
 * This function is the SINGLE SOURCE OF TRUTH for value resolution.
 * Both processFieldsAI() and processFormStep() call this after they
 * get their mapping list from the AI or heuristic matcher.
 *
 * Processing order (each mapping goes through relevant section only):
 *
 *   A. custom_question  — AI generates the answer via Gemini
 *   B. custom_field:*   — look up in user's custom fields (3-pass fuzzy search)
 *      memory:*         — look up in user's saved memories
 *      link:*           — look up in user's saved links
 *   C. groupType        — pick value from experience/education/skills array by index
 *   D. STANDARD_FIELD_KEYS — read directly from UserData (phone, email, etc.)
 *      + fallback cascade to custom fields if userData has no value
 *   E. File inputs      — scan file library for best-matching PDF/DOCX
 *
 * @param fieldMappings  - Array of mapping objects (mutated in-place).
 *                         Each object has at minimum: { fieldId, fieldType }.
 * @param fields         - Original FormField[] from the page scan (read-only).
 * @param userData       - Active user profile data.
 * @param customFields   - Normalised custom fields from userData.customFields.
 * @param virtualLibrary - Combined file library (saved files + legacy resume).
 * @param useAI          - If false, skips Gemini calls for custom_question fields
 *                         (sets "[MANUAL_INPUT_NEEDED]" placeholder instead).
 */
export async function resolveFieldValues(
  fieldMappings: any[],
  fields: FormField[],
  userData: Partial<UserData>,
  customFields: CustomField[],
  virtualLibrary: SavedFile[],
  useAI = true,
): Promise<void> {
  // Pre-check: does the form have a separate country-code field?
  // If yes, the phone field should strip the +XX prefix so it doesn't double-up.
  const hasCountryCodeField = fieldMappings.some(
    (m) => m.fieldType === "phoneCountryCode",
  );

  for (const mapping of fieldMappings) {
    // "click_add" entries are button-click instructions, not fill targets.
    // They are handled separately in processFormStep(). Skip them here.
    if (mapping.action === "click_add") continue;

    // Enrich the mapping with metadata from the original field object
    // (row/column headers, compound labels) that the AI may have omitted.
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

    // A. CUSTOM QUESTIONS
    //    fieldType === "custom_question"
    //    These are open-ended questions (e.g. "Why do you want this role?")
    //    that don't match any standard field.  Gemini generates the answer.
    //    Chat inputs (contenteditable boxes) use generateChatReply() instead.
    if (mapping.fieldType === "custom_question" && mapping.originalQuestion) {
      const originalField = fields.find(
        (f) => f.id === mapping.fieldId || f.id === mapping.id,
      );
      // A chat-style input: could be a messaging box on the application form
      const isChat =
        originalField?.type === "contenteditable" ||
        (originalField?.chatContext && originalField.chatContext.length > 0);

      if (useAI || isChat) {
        try {
          if (isChat) {
            // Use conversation history context for chat-style replies
            mapping.selectedValue = await geminiService.generateChatReply(
              originalField?.chatContext || [],
              userData,
            );
          } else {
            // Standard open-ended question answer
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
        // Heuristic mode: can't answer open questions, signal the user
        mapping.selectedValue = "[MANUAL_INPUT_NEEDED]";
      }
      continue; // Done with this mapping
    }

    // B. CUSTOM FIELDS, MEMORIES, LINKS
    //    These are user-defined data entries that don't fit standard fields.
    //
    //    custom_field:<label>  — e.g. "custom_field:Present Address"
    //    memory:<id>           — e.g. "memory:abc123"
    //    link:<id>             — e.g. "link:xyz456"
    if (mapping.fieldType?.startsWith("custom_field:")) {
      // Extract the target label from the fieldType string
      const targetLabel = mapping.fieldType
        .slice("custom_field:".length)
        .toLowerCase()
        .trim();

      // Pass 1: Exact label match (highest precision — no fuzzy needed)
      const exactMatch = customFields.find(
        (cf: CustomField) => cf.label.toLowerCase().trim() === targetLabel,
      );
      if (exactMatch) {
        mapping.selectedValue = exactMatch.value;
        continue;
      }

      // Pass 2: Token-set match via matchCustomField (handles word reordering,
      //         e.g. "address present" == "present address")
      const matched = matchCustomField(targetLabel, customFields);
      if (matched) {
        mapping.selectedValue = matched.value;
        continue;
      }

      // Pass 3: Context-based fallback — if a custom field's "context" string
      //         contains all the tokens from the target label, use it.
      //         e.g. context="fill in the present address field" matches "present address"
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
      continue; // Done with this mapping (even if no match found)
    }

    // Memory lookup — find by ID, use memory content as the value
    if (mapping.fieldType?.startsWith("memory:")) {
      const memoryId = mapping.fieldType.slice("memory:".length);
      const match = (userData.memories || []).find((m) => m.id === memoryId);
      if (match) mapping.selectedValue = match.content;
      continue;
    }

    // Link lookup — find by ID, use the URL as the value
    if (mapping.fieldType?.startsWith("link:")) {
      const linkId = mapping.fieldType.slice("link:".length);
      const match = (userData.savedLinks || []).find((l) => l.id === linkId);
      if (match) mapping.selectedValue = match.url;
      continue;
    }

    // C. ARRAY GROUPS (experience, education, skills)
    //    When a form has repeating sections (e.g. Work Experience #1, #2...),
    //    the AI assigns a groupType + groupIndex to each field so the right
    //    item from the array is picked.
    //
    //    Example: groupType="experience", groupIndex=1, fieldType="company"
    //    → userData.experience[1].company
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
          // Object item (experience/education): pick the named property
          mapping.selectedValue = String((item as any)[mapping.fieldType]);
        } else if (mapping.groupType === "skill") {
          // Skill items are plain strings
          mapping.selectedValue = String(item);
        }
      }
      continue; // Done with this mapping
    }

    // D. STANDARD FIELDS
    //    fieldType is a key in STANDARD_FIELD_KEYS (e.g. "firstName", "email").
    //    Most form fields end up here.
    //
    //    Special handling:
    //      • phoneCountryCode — extract "+1" prefix from phone string
    //      • phone            — strip country code if a separate CC field exists
    //      • fullName         — compose from firstName + middleName + lastName
    //      • skill (singular) — return the whole skills array as comma-joined string
    //
    //    Fallback cascade (if userData has no value for this field):
    //      1. Direct label match against customFields
    //      2. Exact alias match  (STANDARD_TO_CUSTOM_LABEL["email"] → ["e-mail", ...])
    //      3. Fuzzy alias match  via matchCustomField
    if (
      !mapping.selectedValue &&
      mapping.fieldType &&
      (STANDARD_FIELD_KEYS.has(mapping.fieldType) ||
        mapping.fieldType === "skill")
    ) {
      let resolvedVal: string | string[] | undefined = undefined;

      if (mapping.fieldType === "phoneCountryCode") {
        // Extract just the +XX prefix from the phone number string
        const match = userData.phone?.match(/\+(\d+)/);
        if (match) resolvedVal = `+${match[1]}`;
        else if (userData.phone) resolvedVal = userData.phone;
      } else if (mapping.fieldType === "phone") {
        let val = userData.phone || "";
        // Strip country code if the form has a dedicated country-code field
        if (hasCountryCodeField) val = val.replace(/^\+\d+[- ]?/, "");
        if (val) resolvedVal = val;
      } else if (mapping.fieldType === "fullName") {
        // Prefer explicit fullName; fall back to composing from parts
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
        // A single "skills" field (not part of a repeating group)
        if (userData.skills && userData.skills.length > 0) {
          resolvedVal = userData.skills;
        }
      } else {
        // Generic standard field — just read the matching property from userData
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
        // Fallback 1: match against the raw label on the page (most specific)
        if (origField?.label) {
          const directMatch = matchCustomField(origField.label, customFields);
          if (directMatch) mapping.selectedValue = directMatch.value;
        }

        if (!mapping.selectedValue) {
          // Fallback 2: exact alias match
          // e.g. STANDARD_TO_CUSTOM_LABEL["email"] = ["e-mail", "email address", ...]
          const aliases = STANDARD_TO_CUSTOM_LABEL[mapping.fieldType] || [];
          if (aliases.length > 0) {
            const cfMatch = customFields.find((cf) => {
              const lbl = cf.label.toLowerCase().trim();
              return aliases.some((alias) => lbl === alias);
            });
            if (cfMatch) mapping.selectedValue = cfMatch.value;
          }

          // Fallback 3: fuzzy alias match
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
    // Note: no `continue` here — fall through naturally for standard fields
  }
  // E. FILE VAULT (runs AFTER the per-mapping loop)
  //    Scans ALL file-type inputs on the page and matches them against
  //    the user's saved file library (PDFs, CVs, cover letters, etc.).
  //
  //    For each file input:
  //      • If it already has fileData/files from the AI mapping → skip.
  //      • Otherwise, use fileMatchesField() to score each library file.
  //      • If the input accepts multiple files → attach all matches.
  //      • If single-file → attach the best match only
  if (virtualLibrary.length > 0) {
    const fileFields = fields.filter((f) => f.type === "file");

    for (const fileField of fileFields) {
      // Find the existing mapping for this file input (if any)
      let mapping = fieldMappings.find(
        (m) =>
          m.action !== "click_add" &&
          (m.id === fileField.id || m.fieldId === fileField.id),
      );

      // If no mapping exists yet, create a default one for resumeUpload
      if (!mapping) {
        mapping = {
          id: fileField.id,
          fieldId: fileField.id,
          fieldType: "resumeUpload",
          confidence: 0.8,
        };
        fieldMappings.push(mapping);
      }

      // Skip if a file was already resolved (e.g. by the AI or resume field)
      if (mapping.fileData || (mapping.files && mapping.files.length > 0))
        continue;

      // Use the fieldType tokens as extra keywords to improve matching
      // (e.g. "coverLetter" → ["cover", "letter"] boosts cover-letter files)
      const extraKws = mapping.fieldType ? _tokenize(mapping.fieldType) : [];

      const matchedFiles = virtualLibrary.filter((sf) =>
        fileMatchesField(fileField, sf, extraKws),
      );

      if (matchedFiles.length > 0) {
        if (fileField.multiple) {
          // Multi-file input: attach all matched files as an array
          mapping.files = matchedFiles.map((sf) => ({
            name: sf.name,
            dataUrl: sf.dataUrl,
          }));
          mapping.selectedValue = "FILE_UPLOAD";
          console.log(
            `Aullevo FileVault: ${matchedFiles.length} files matched to [${fileField.label || fileField.name || fileField.id}] (Multiple)`,
          );
        } else {
          // Single-file input: attach only the top-ranked match
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
