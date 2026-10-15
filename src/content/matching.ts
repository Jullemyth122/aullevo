// Keyword matching between profile labels and form questions. No DOM access, so it can be
// run and measured outside the browser (scripts/match-check.mjs).

/**
 * Normalizes question strings by stripping bullets, question numbers,
 * required markers, asterisks, and punctuation.
 */
export function cleanText(text: string | null | undefined): string {
    if (!text) return "";
    return String(text)
        // Strip leading numbers or bullets (e.g. "1.", "1)", "1 -", "Q1:", "- ", "* ")
        .replace(/^\s*(?:question\s*\d+[:\-.]?|\d+[\.\)\-:]|[a-zA-Z][\.\)\-:]|[-*•·⁃‣])\s*/i, "")
        // Strip required / optional markers and asterisks
        .replace(/\*+/g, " ")
        .replace(/\((?:required|optional|mandatory|required field|if applicable)\)/gi, " ")
        .replace(/\[(?:required|optional|mandatory)\]/gi, " ")
        // Replace punctuation and symbols with spaces
        .replace(/[:!?|/\\–—()[\]{}_,;'"‘“”`~]/g, " ")
        .replace(/\s+/g, " ")
        .toLowerCase()
        .trim();
}

/**
 * Common stem / prefix matching (e.g. "developer" vs "development", "engineer" vs "engineering")
 */
export function wordsMatchStem(w1: string, w2: string): number {
    if (w1 === w2) return 1.0;
    if (w1.length >= 3 && w2.length >= 3) {
        // A word that starts the other ("develop" / "developer") is its stem. One that sits inside it
        // only counts when long enough to mean the same thing ("phone" in "telephone"):
        // "name" inside "nickname" or "surname" is a different field.
        const [short, long] = w1.length <= w2.length ? [w1, w2] : [w2, w1];
        if (long.startsWith(short) || (short.length >= 5 && long.includes(short))) return 0.95;
        const minLen = Math.min(w1.length, w2.length);
        if (minLen >= 5) {
            const prefixLen = Math.max(4, minLen - 2);
            if (w1.slice(0, prefixLen) === w2.slice(0, prefixLen)) {
                return 0.92;
            }
        }
    }
    return 0;
}

/**
 * Dynamic conversational token overlap algorithm.
 * Measures how well a profile label matches a form question without hardcoded dictionaries.
 */
export function computeStringSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;

    const s1 = cleanText(str1);
    const s2 = cleanText(str2);
    if (!s1 || !s2) return 0;

    // 1. Exact string match
    if (s1 === s2) return 1.0;

    // 2. Full phrase containment: at least as strong as every word matching on its own (0.86 + 0.12),
    // so "First Name" in "Legal Full Name (First Name MI Last Name)" beats "First Friend Name".
    // Whole words only: "name" is not in "nickname".
    if (` ${s2} `.includes(` ${s1} `)) return 0.95 + (0.05 * (s1.length / s2.length));
    if (` ${s1} `.includes(` ${s2} `)) return 0.95 + (0.05 * (s2.length / s1.length));

    // 3. Dynamic Token Analysis
    const tokens1 = s1.split(/\s+/).filter(Boolean);
    const tokens2 = s2.split(/\s+/).filter(Boolean);

    const sub1 = tokens1.filter(t => t.length >= 3);
    const sub2 = tokens2.filter(t => t.length >= 3);

    if (sub1.length === 0 || sub2.length === 0) {
        const set2 = new Set(tokens2);
        let inter = 0;
        for (const t of tokens1) if (set2.has(t)) inter++;
        const union = tokens1.length + tokens2.length - inter;
        return union > 0 ? (inter / union) : 0;
    }

    // Check how many substantial tokens of label (str1) are in question (str2)
    let matchedIn2 = 0;
    const unmatchedIn1: string[] = [];
    for (const t of sub1) {
        let bestTScore = 0;
        for (const q of sub2) {
            const score = wordsMatchStem(t, q);
            if (score > bestTScore) bestTScore = score;
        }
        if (bestTScore >= 0.90) {
            matchedIn2 += bestTScore;
        } else {
            unmatchedIn1.push(t);
        }
    }

    // Check how many substantial tokens of question (str2) are in label (str1)
    let matchedIn1 = 0;
    const unmatchedIn2: string[] = [];
    for (const q of sub2) {
        let bestQScore = 0;
        for (const t of sub1) {
            const score = wordsMatchStem(q, t);
            if (score > bestQScore) bestQScore = score;
        }
        if (bestQScore >= 0.90) {
            matchedIn1 += bestQScore;
        } else {
            unmatchedIn2.push(q);
        }
    }

    const coverage1 = matchedIn2 / sub1.length;
    const coverage2 = matchedIn1 / sub2.length;

    const isQuestionLong = sub2.length >= 5;
    const isLabelLong = sub1.length >= 5;

    // Detect subject conflict (e.g. "React" vs "Vue")
    const hasSubjectConflict = !isQuestionLong && !isLabelLong && unmatchedIn1.length > 0 && unmatchedIn2.length > 0;

    const minCoverage = isQuestionLong ? 0.65 : 0.75;
    if (coverage1 >= minCoverage && !hasSubjectConflict) {
        return 0.86 + (0.12 * Math.min(coverage1, 1.0));
    }

    if (coverage2 >= 0.75 && matchedIn2 >= 1 && !hasSubjectConflict) {
        return 0.85 + (0.12 * Math.min(coverage2, 1.0));
    }

    if (hasSubjectConflict) {
        const jaccard = matchedIn2 / (sub1.length + sub2.length - matchedIn2);
        return Math.min(jaccard * 0.4, 0.35); // Disqualified (< 0.45)
    }

    const totalSub = sub1.length + sub2.length - matchedIn2;
    return totalSub > 0 ? (matchedIn2 / totalSub) : 0;
}

/**
 * Splits slash-separated labels into alias variations
 * (e.g. "Degree / Year Level" -> ["Degree", "Year Level", "Degree / Year Level"])
 */
export function getFieldLabelAliases(label: string): string[] {
    if (!label) return [];
    const str = String(label).trim();
    if (str.includes("/") || str.includes("|") || str.includes(";")) {
        const parts = str.split(/[/|;]+/).map(p => p.trim()).filter(Boolean);
        if (parts.length > 1) {
            return [...parts, str];
        }
    }
    return [str];
}

// Instructions that change how the answer must be written, not what it is
export const FORMAT_HINT_RE = /\b(format|e\.\s?g\.|for\s+example|ex\.|sample|surname|family\s+name|given\s+names?|middle\s+(?:name|initials?)|initials?|all\s+caps|upper\s*case|lower\s*case|capitali[sz]ed?|capital\s+letters|mm\s*\/\s*dd|dd\s*\/\s*mm|yyyy|separated?\s+by|comma|hyphen|do\s+not\s+(?:include|use|abbreviate|put)|don'?t\s+(?:include|use|abbreviate|put)|without|no\s+(?:middle|spaces?|dashes?|abbreviations?|special|suffix)|as\s+(?:it\s+)?appears?|exactly\s+as)\b/i;

// False when `question` is long (5+ words) and some word of the profile `label` is missing from it
export function coversLabelInLongQuestion(label: string, question: string): boolean {
    const words = (text: string) => cleanText(text).split(" ").filter(w => w.length >= 3);
    const questionWords = words(question);
    if (questionWords.length < 5) return true;
    return words(label).every(w => questionWords.some(q => wordsMatchStem(w, q) >= 0.90));
}

// Words that frame a question without saying what it asks ("What is your...", "Please enter your...").
// Not synonyms: they only keep the backward score from counting them as something left unanswered.
const FILLER_WORDS = new Set([
    "what", "which", "your", "yours", "you", "please", "kindly", "enter", "provide", "type", "write",
    "give", "input", "fill", "put", "state", "indicate", "specify", "tell", "let", "know", "the", "and",
    "for", "from", "with", "this", "that", "here", "below", "above", "field", "answer", "required",
    "optional", "can", "may", "will", "would", "should", "must", "have", "has", "our",
]);

/**
 * Backward score: the share of the question's words the matched profile label explains (0 to 1).
 * computeStringSimilarity says the label fits the question; this says whether the question asks
 * for more than the label. "First Name" explains all of "First Name" but only half of
 * "Full Name (Surname, First Name, MI)".
 */
export function questionCoverage(label: string, question: string): number {
    const words = (text: string) => cleanText(text).split(" ").filter(w => w.length >= 3);
    const labelWords = words(label);
    const questionWords = Array.from(new Set(words(question))).filter(w => !FILLER_WORDS.has(w));
    if (questionWords.length === 0) return 1;
    const explained = questionWords.filter(q => labelWords.some(l => wordsMatchStem(q, l) >= 0.90));
    return explained.length / questionWords.length;
}

/**
 * True when the question's own title carries writing instructions ("FULL NAME (SURNAME, FIRST NAME, MI)",
 * "Date of Birth (MM/DD/YYYY)"). The words the profile label matched are taken out first:
 * "Surname" asked as "Surname" needs no writing.
 */
export function titleNeedsWriting(label: string, titles: string[]): boolean {
    const labelWords = cleanText(label).split(" ").filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const matched = labelWords.length > 0 ? new RegExp(`\\b${labelWords.join("\\W+")}\\b`, "gi") : null;
    return FORMAT_HINT_RE.test(titles.map(t => matched ? t.replace(matched, " ") : t).join(" | "));
}

// With AI on, a text match fills at once only when it is this strong in both directions;
// otherwise the AI answers first and the match fills whatever the AI leaves empty
export const INSTANT_FILL_SCORE = 0.80;
export const QUESTION_EXPLAINED = 0.75;

/**
 * The text side of "may keyword fill answer this before the AI looks?". The content script adds
 * page checks on top (helper text, several profile values fitting one box, long questions).
 */
export function fillsWithoutAi(score: number, label: string, question: string): boolean {
    return score >= INSTANT_FILL_SCORE &&
        questionCoverage(label, question) >= QUESTION_EXPLAINED &&
        !titleNeedsWriting(label, [question]);
}
