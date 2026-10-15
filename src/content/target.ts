// Voice commands that name a question ("fill the email", "fill the first name and phone"): which questions on
// the page they point at by their words. No word lists: when the words don't find the question ("birthday" for
// "Date of birth", Tagalog), content.ts asks the AI instead. Only content.ts uses this (classic script: no shared chunk).

function normalize(value: string): string {
    return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
        .replace(/e[\s-]?mail/g, "email").replace(/[^a-z0-9]+/g, " ").trim();
}

// Filler words never point at a question: "the email" means "email"
const NOISE = new Set(["please", "enter", "your", "the", "a", "an", "of", "what", "is", "required", "which", "who", "where", "when", "why", "how",
    "do", "does", "did", "are", "am", "was", "were", "be", "you", "yours", "i", "me", "my", "we", "our", "this", "these", "that", "those",
    "in", "on", "at", "to", "for", "with", "from", "by", "or", "and", "any", "it", "its", "about", "regarding", "asking", "asks"]);
const words = (value: string) => normalize(value).split(" ").filter(word => word && !NOISE.has(word));

// Pointing at a question by where it is: "the first question", "question 3", "number 2", "the last one"
const ORDINALS: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
    una: 1, unang: 1, ikalawa: 2, ikalawang: 2, pangalawa: 2, pangalawang: 2, ikatlo: 3, ikatlong: 3, pangatlo: 3, pangatlong: 3,
    ikaapat: 4, ikalima: 5, ikalimang: 5,
};
// Counting words only count right after "question" / "number": "question five", "number one"
const CARDINALS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const COUNTED = new Set(["question", "number", "no", "tanong", "item"]);
const LAST = new Set(["last", "final", "huli", "huling"]);
// Words that only say "a question" around the position: "the first QUESTION", "number 3", "the last ONE"
const POSITION_FILLER = new Set(["question", "questions", "one", "item", "box", "field", "blank", "number", "no", "tanong", "ng", "na", "sa", "ang"]);

/**
 * Where in the form a spoken target points: 1 for "first" / "question 1", -1 for "last", null when it names a
 * question by its words. "First name" is a name, not a position: only filler may surround the position.
 */
export function questionPosition(target: string): number | null {
    const said = words(target);
    let position: number | null = null;
    const rest = said.filter((word, i) => {
        if (position !== null) return true;
        const digits = word.match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
        if (digits) { position = Number(digits[1]); return false; }
        if (ORDINALS[word]) { position = ORDINALS[word]; return false; }
        if (CARDINALS[word] && i > 0 && COUNTED.has(said[i - 1])) { position = CARDINALS[word]; return false; }
        if (LAST.has(word)) { position = -1; return false; }
        return true;
    });
    return position !== null && position !== 0 && rest.every(word => POSITION_FILLER.has(word)) ? position : null;
}

/**
 * Which questions a spoken target such as "email" or "first name" points at by its words. `sure` only when exactly
 * one question holds every word (shortest labels win, so "first name" skips a long certificate-name question):
 * anything less certain ("address" with an Email address and a Home address, a partial match) goes to the AI,
 * and `indices` are the best guesses for when the AI can't be asked.
 */
export function matchTargets(target: string, questions: string[]): { indices: number[]; sure: boolean } {
    const wanted = words(target);
    if (!wanted.length) return { indices: [], sure: false };
    const scored = questions.map((question, index) => {
        const have = new Set(words(question));
        const hits = wanted.filter(word => have.has(word)).length;
        return { index, score: have.size ? hits / wanted.length : 0, length: have.size };
    });
    const full = scored.filter(item => item.score === 1);
    if (full.length) {
        const shortest = Math.min(...full.map(item => item.length));
        const indices = full.filter(item => item.length <= shortest + 2).map(item => item.index);
        return { indices, sure: indices.length === 1 };
    }
    const best = [...scored].sort((a, b) => b.score - a.score || a.length - b.length)[0];
    return { indices: best && best.score > 0.5 ? [best.index] : [], sure: false };
}
