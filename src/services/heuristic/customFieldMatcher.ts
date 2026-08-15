import type { CustomField } from "../../types";
import { CUSTOM_FIELD_STOP_WORDS } from "./rules";

/**
 * Calculates Levenshtein edit distance between two strings purely algorithmically.
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Checks if two tokens match identically or with a 1-character typo tolerance.
 */
function tokenMatches(t1: string, t2: string): boolean {
  if (t1 === t2) return true;
  if (t1.length >= 3 && t2.length >= 3) {
    return editDistance(t1, t2) <= 1;
  }
  return false;
}

/**
 * Tokenizes a string by stripping non-alphanumeric characters and filtering common stop words.
 */
export function cleanTokens(str: string): string[] {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !CUSTOM_FIELD_STOP_WORDS.has(w));
}

/**
 * Evaluates candidate field text against user-defined custom fields algorithmically.
 * Priority:
 * 1. Exact normalized token match
 * 2. Multi-token / Coordinate set match (order-agnostic, requires all tokens to match)
 * 3. Exact phrase containment
 * 4. Single-token exact match
 */
export function matchCustomField(
  text: string,
  customFields: CustomField[] = [],
): CustomField | null {
  if (!text || customFields.length === 0) return null;

  const textTokens = cleanTokens(text.toLowerCase().trim());
  if (textTokens.length === 0) return null;
  const textJoined = textTokens.join(" ");

  // Pass 1: Exact normalized match
  for (const cf of customFields) {
    const cfTokens = cleanTokens(cf.label || "");
    if (cfTokens.length > 0 && cfTokens.join(" ") === textJoined) {
      return cf;
    }
  }

  // Pass 2: Sort custom fields by token count descending (most specific first)
  const sortedCFs = [...customFields].sort(
    (a, b) =>
      cleanTokens(b.label || "").length - cleanTokens(a.label || "").length,
  );

  // Pass 3: Multi-token / 2D Coordinate set match
  for (const cf of sortedCFs) {
    const cfTokens = cleanTokens(cf.label || "");
    if (cfTokens.length >= 2) {
      // Every token in cf must match a distinct token in textTokens
      const usedIndices = new Set<number>();
      let allMatched = true;

      for (const cft of cfTokens) {
        let foundIdx = -1;
        for (let i = 0; i < textTokens.length; i++) {
          if (!usedIndices.has(i) && tokenMatches(textTokens[i], cft)) {
            foundIdx = i;
            break;
          }
        }
        if (foundIdx >= 0) {
          usedIndices.add(foundIdx);
        } else {
          allMatched = false;
          break;
        }
      }

      if (
        allMatched &&
        (usedIndices.size === textTokens.length ||
          usedIndices.size === cfTokens.length)
      ) {
        return cf;
      }

      // Exact phrase containment
      const cfJoined = cfTokens.join(" ");
      if (textJoined.includes(cfJoined)) {
        return cf;
      }
    }
  }

  // Pass 4: Single-token custom field match (e.g. "Email", "Pronouns")
  for (const cf of sortedCFs) {
    const cfTokens = cleanTokens(cf.label || "");
    if (cfTokens.length === 1) {
      const token = cfTokens[0];
      // Only match if single token matches directly and text is not a multi-token coordinate
      if (
        textTokens.length <= 2 &&
        textTokens.some((tt) => tokenMatches(tt, token))
      ) {
        return cf;
      }
    }
  }

  return null;
}
