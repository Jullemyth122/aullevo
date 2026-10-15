// Measures keyword matching (src/content/matching.ts) on the questions in match-cases.json.
// Each case expects a profile field to fill at once, or "ai" when the AI should answer first.
// Run: npm run match:check
//
// Models the text-only routing of fillForm with AI on: page checks (helper text below the title,
// questions about another person, input types) need a real page and are not covered here.
import { readFileSync } from "node:fs";
import {
    computeStringSimilarity, getFieldLabelAliases, coversLabelInLongQuestion, cleanText,
    fillsWithoutAi, INSTANT_FILL_SCORE,
} from "../src/content/matching.ts";

const { profile, cases } = JSON.parse(readFileSync(new URL("./match-cases.json", import.meta.url), "utf8"));

const words = (text) => cleanText(text).split(" ").filter(w => w.length >= 3);

// Best alias and score of each profile field for this question (as Step 2 of fillForm scores them)
function candidates(question) {
    const found = [];
    for (const field of profile) {
        let score = 0, alias = field;
        for (const a of getFieldLabelAliases(field)) {
            const s = computeStringSimilarity(a, question);
            if (s > score) { score = s; alias = a; }
        }
        if (score > 0 && !coversLabelInLongQuestion(alias, question)) score = 0;
        if (score >= 0.45) found.push({ field, alias, score });
    }
    return found.sort((a, b) => b.score - a.score);
}

// Rules that existed before the backward score: several fields fit, long question loosely matched
function sharedOrLoose(found, question) {
    const best = found[0];
    const strong = found.filter(c => c.score >= INSTANT_FILL_SCORE).length;
    if (best.score < 1 && strong > 1) return true;
    if (words(question).length < 5) return false;
    const alias = cleanText(best.alias);
    return !(words(alias).length >= 2 && ` ${cleanText(question)} `.includes(` ${alias} `));
}

function route(question, withBackwardScore) {
    const found = candidates(question);
    const best = found[0];
    if (!best || sharedOrLoose(found, question)) return { pick: "ai", best };
    const instant = withBackwardScore
        ? fillsWithoutAi(best.score, best.alias, question)
        : best.score >= INSTANT_FILL_SCORE;
    return { pick: instant ? best.field : "ai", best };
}

function grade(withBackwardScore) {
    const results = cases.map(c => ({ ...c, ...route(c.question, withBackwardScore) }));
    return {
        results,
        pass: results.filter(r => r.pick === r.expect),
        wrongFill: results.filter(r => r.pick !== "ai" && r.pick !== r.expect),
        extraAi: results.filter(r => r.pick === "ai" && r.expect !== "ai"),
    };
}

const pct = (n) => `${Math.round((n / cases.length) * 100)}%`;
const before = grade(false);
const after = grade(true);

console.log(`\n${cases.length} questions, profile: ${profile.join(", ")}\n`);
console.log("                         before   after");
console.log(`pass rate                ${pct(before.pass.length).padEnd(8)} ${pct(after.pass.length)}`);
console.log(`wrong instant fills      ${String(before.wrongFill.length).padEnd(8)} ${after.wrongFill.length}   (the AI never sees these)`);
console.log(`unneeded AI hand-offs    ${String(before.extraAi.length).padEnd(8)} ${after.extraAi.length}   (slower; keyword fill still fills them if the AI leaves them empty)`);

const show = (title, list) => {
    if (list.length === 0) return;
    console.log(`\n${title}`);
    for (const r of list) {
        const b = r.best ? `${r.best.field} ${r.best.score.toFixed(2)}` : "no match";
        console.log(`  "${r.question}"  expected ${r.expect}, got ${r.pick}  [${b}]${r.why ? `  (${r.why})` : ""}`);
    }
};
show("Wrong instant fills (before):", before.wrongFill);
show("Wrong instant fills (after):", after.wrongFill);
show("Unneeded AI hand-offs (after):", after.extraAi);
console.log();
