import type { CustomField } from "../../types";

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
 * Tokenizes a string by stripping structural matrix words (row, col, x, by) and non-alphanumeric characters.
 */
export function cleanTokens(str: string): string[] {
  return str
    .toLowerCase()
    .replace(
      /\b(row|rows|col|cols|column|columns|cell|cells|by|times|x)\b/gi,
      " ",
    )
    .replace(/[^a-z0-9]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * Evaluates candidate field text against user-defined custom fields algorithmically.
 * Priority:
 * 1. Exact normalized token match on label or context
 * 2. Multi-token / Coordinate set match (order-agnostic, requires all tokens to match)
 * 3. Exact phrase containment (label or context)
 * 4. Single-token match (leading token, word boundary, or isolated token)
 * 5. Matching context token overlap
 */
export function matchCustomField(
  text: string,
  customFields: CustomField[] = [],
): CustomField | null {
  if (!text || customFields.length === 0) return null;

  const textTokens = cleanTokens(text.toLowerCase().trim());
  if (textTokens.length === 0) return null;
  const textJoined = textTokens.join(" ");

  // Pass 1: Exact normalized match on label or context
  for (const cf of customFields) {
    const cfTokens = cleanTokens(cf.label || "");
    if (cfTokens.length > 0 && cfTokens.join(" ") === textJoined) {
      return cf;
    }
    if (cf.context) {
      const ctxTokens = cleanTokens(cf.context);
      if (ctxTokens.length > 0 && ctxTokens.join(" ") === textJoined) {
        return cf;
      }
    }
  }

  // Pass 2: Sort custom fields by token count descending (most specific first)
  const sortedCFs = [...customFields].sort(
    (a, b) =>
      cleanTokens(b.label || "").length - cleanTokens(a.label || "").length,
  );

  // Pass 3: Multi-token / 2D Coordinate set match (label or context >= 2 tokens)
  for (const cf of sortedCFs) {
    const cfTokens = cleanTokens(cf.label || "");
    if (cfTokens.length >= 2) {
      // Direction A: Every token in cf matches a distinct token in textTokens
      const usedIndices = new Set<number>();
      let allMatchedA = true;

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
          allMatchedA = false;
          break;
        }
      }

      if (allMatchedA) {
        if (usedIndices.size === textTokens.length) {
          return cf;
        }
        // If all unique tokens in text are covered by cf tokens (e.g. repeated coordinates like "From Mon Mon From")
        const uniqueTextTokens = new Set(textTokens);
        const cfTokenSet = new Set(cfTokens);
        const allUniqueInCF = Array.from(uniqueTextTokens).every((t) =>
          Array.from(cfTokenSet).some((cft) => tokenMatches(t, cft)),
        );
        if (allUniqueInCF) {
          return cf;
        }
        if (
          usedIndices.size === cfTokens.length &&
          cfTokens.length / textTokens.length >= 0.6
        ) {
          return cf;
        }
      }

      // Direction B: Every token in textTokens matches a token in cfTokens (e.g. user pasted long prompt in CF label)
      if (textTokens.length >= 2) {
        const textUsedIndices = new Set<number>();
        let allMatchedB = true;

        for (const tt of textTokens) {
          let foundIdx = -1;
          for (let i = 0; i < cfTokens.length; i++) {
            if (!textUsedIndices.has(i) && tokenMatches(cfTokens[i], tt)) {
              foundIdx = i;
              break;
            }
          }
          if (foundIdx >= 0) {
            textUsedIndices.add(foundIdx);
          } else {
            allMatchedB = false;
            break;
          }
        }

        if (allMatchedB && textUsedIndices.size === textTokens.length) {
          return cf;
        }
      }

      // Bidirectional exact word-boundary phrase containment
      const cfJoined = cfTokens.join(" ");
      const cfEscaped = cfJoined.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const cfRegex = new RegExp(`(?:^|\\b)${cfEscaped}(?:\\b|$)`, "i");

      if (cfRegex.test(textJoined)) {
        return cf;
      }
      if (textTokens.length >= 2) {
        const textEscaped = textJoined.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const textRegex = new RegExp(`(?:^|\\b)${textEscaped}(?:\\b|$)`, "i");
        if (textRegex.test(cfJoined)) {
          return cf;
        }
      }
    }

    // Also check context phrase containment if context has >= 2 tokens
    if (cf.context) {
      const ctxTokens = cleanTokens(cf.context);
      if (ctxTokens.length >= 2) {
        const ctxJoined = ctxTokens.join(" ");
        const ctxEscaped = ctxJoined.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const ctxRegex = new RegExp(`(?:^|\\b)${ctxEscaped}(?:\\b|$)`, "i");
        if (ctxRegex.test(textJoined)) {
          return cf;
        }
        if (textTokens.length >= 2) {
          const textEscaped = textJoined.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const textRegex = new RegExp(`(?:^|\\b)${textEscaped}(?:\\b|$)`, "i");
          if (textRegex.test(ctxJoined)) {
            return cf;
          }
        }
      }
    }
  }

  // Pass 4: Single-token custom field match (e.g. "Salutation", "Pronouns", "Email")
  // Form labels often have parenthetical or helper text like "Salutation (for official documents)"
  for (const cf of sortedCFs) {
    const cfTokens = cleanTokens(cf.label || "");
    if (cfTokens.length === 1) {
      const token = cfTokens[0];
      // A. Primary match: CF token is the leading / first token of the text
      // e.g. "Salutation (for official documents)" starts with "salutation"
      if (tokenMatches(textTokens[0], token)) {
        return cf;
      }

      // B. Short text match: token exists anywhere in a short label (<= 4 tokens)
      if (
        textTokens.length <= 4 &&
        textTokens.some((t) => tokenMatches(t, token))
      ) {
        return cf;
      }

      // C. Safe word boundary match in joined text
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "i").test(textJoined)) {
        return cf;
      }
    }

    // Also check if single-token context matches leading word
    if (cf.context) {
      const ctxTokens = cleanTokens(cf.context);
      if (ctxTokens.length === 1 && tokenMatches(textTokens[0], ctxTokens[0])) {
        return cf;
      }
    }
  }

  return null;
}
