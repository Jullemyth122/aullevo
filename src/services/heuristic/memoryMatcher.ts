import type { Memory, SavedLink } from "../../types";

/**
 * Tokenizes strings into words for semantic memory matching.
 */
function getSignificantWords(str: string): string[] {
  return str
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/**
 * Evaluates candidate text against stored user memories using exact substring and semantic word ratio matching.
 */
export function matchMemory(
  text: string,
  memories: Memory[] = [],
): Memory | null {
  if (!text || !memories || memories.length === 0) return null;
  const lowerText = text.toLowerCase();

  let bestMem: Memory | null = null;
  let bestScore = 0;

  for (const mem of memories) {
    const titleLogic = mem.title.toLowerCase();

    // 1. Exact substring match
    if (lowerText.includes(titleLogic)) {
      const score = titleLogic.length / lowerText.length + 1.0;
      if (score > bestScore) {
        bestScore = score;
        bestMem = mem;
      }
      continue;
    }

    // 2. Semantic word match (order-independent)
    const titleWords = getSignificantWords(titleLogic);
    const textWords = getSignificantWords(lowerText);

    if (titleWords.length > 0) {
      let matchCount = 0;
      for (const cw of titleWords) {
        const wordMatched = textWords.some(
          (tw) =>
            tw === cw ||
            (tw.length >= 4 &&
              cw.length >= 4 &&
              (tw.includes(cw) || cw.includes(tw))),
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

/**
 * Evaluates candidate text against saved links using title matching.
 */
export function matchSavedLink(
  text: string,
  savedLinks: SavedLink[] = [],
): SavedLink | null {
  if (!text || !savedLinks || savedLinks.length === 0) return null;
  const lowerText = text.toLowerCase();

  for (const link of savedLinks) {
    const titleLogic = link.title.toLowerCase();
    if (lowerText.includes(titleLogic)) return link;
  }
  return null;
}
