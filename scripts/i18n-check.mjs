// i18n-check: every key used in code exists in English, and every language file has every English key
// with the same {placeholders} and <b> tags. Run: npm run i18n:check
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const EN_DIR = join(ROOT, 'src/i18n/en');
const LOCALES_DIR = join(ROOT, 'public/locales');
const PLURAL_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

const flatten = (obj, prefix = '', out = {}) => {
    for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'string') out[path] = v;
        else if (v && typeof v === 'object') flatten(v, path, out);
    }
    return out;
};

const en = {};
for (const file of readdirSync(EN_DIR).filter(f => f.endsWith('.json'))) {
    flatten(JSON.parse(readFileSync(join(EN_DIR, file), 'utf8')), basename(file, '.json'), en);
}

// "a.b.one" -> base "a.b" when the last part is a plural category
const pluralBase = (key) => {
    const i = key.lastIndexOf('.');
    return i > 0 && PLURAL_CATEGORIES.has(key.slice(i + 1)) ? key.slice(0, i) : null;
};
const enPluralBases = new Set(Object.keys(en).map(pluralBase).filter(Boolean));
const existsInEn = (key) => key in en || enPluralBases.has(key);

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
const boldCount = (s) => (s.match(/<b>/g) || []).length;

let errors = 0;
const error = (msg) => { errors++; console.error(`  ✗ ${msg}`); };

// 1. Keys used in code
const walk = (dir) => readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|mjs)$/.test(f) ? [p] : [];
});
console.log('Keys used in code:');
let used = 0;
for (const file of walk(join(ROOT, 'src'))) {
    // Comment lines hold examples, not real uses
    const src = readFileSync(file, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const m of src.matchAll(/\b(t|tRich|tEnglish|ct)\(\s*['"]([\w.-]+)['"]/g)) {
        used++;
        const key = m[1] === 'ct' ? `content.${m[2]}` : m[2]; // content.ts keys are relative to en/content.json
        if (!existsInEn(key)) error(`${file.slice(ROOT.length)}: "${key}" is not in src/i18n/en`);
    }
}
console.log(`  ${used} uses checked`);

// 2. Language files
const locales = readdirSync(LOCALES_DIR).filter(f => f.endsWith('.json'));
console.log(`\nLanguage files (${locales.length}), ${Object.keys(en).length} English texts:`);
for (const file of locales) {
    const before = errors;
    let loc;
    try {
        loc = flatten(JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8')));
    } catch (e) {
        error(`${file}: invalid JSON (${e.message})`);
        continue;
    }

    for (const [key, text] of Object.entries(en)) {
        const base = pluralBase(key);
        if (base) {
            // Plural group: the language needs its own "other"; its categories can differ from English
            if (key.endsWith('.other') && !(`${base}.other` in loc)) error(`${file}: missing ${base}.other`);
            continue;
        }
        if (!(key in loc)) { error(`${file}: missing ${key}`); continue; }
        if (placeholders(loc[key]) !== placeholders(text)) error(`${file}: ${key} placeholders ${placeholders(loc[key]) || '(none)'} ≠ ${placeholders(text) || '(none)'}`);
        if (boldCount(loc[key]) !== boldCount(text)) error(`${file}: ${key} has ${boldCount(loc[key])} <b> tags, English has ${boldCount(text)}`);
    }
    for (const base of enPluralBases) {
        const enVars = placeholders(en[`${base}.other`] ?? '');
        for (const key of Object.keys(loc).filter(k => pluralBase(k) === base)) {
            // "one"-type forms may drop {count} ("one field"), the rest must match
            const vars = placeholders(loc[key]);
            const expected = key.endsWith('.other') ? enVars : null;
            if (expected !== null && vars !== expected) error(`${file}: ${key} placeholders ${vars || '(none)'} ≠ ${expected || '(none)'}`);
        }
    }
    for (const key of Object.keys(loc)) {
        const base = pluralBase(key);
        if (!(key in en) && !(base && enPluralBases.has(base))) error(`${file}: unknown key ${key}`);
    }
    console.log(`  ${errors === before ? '✓' : '✗'} ${file}`);
}

console.log(errors ? `\n${errors} problem(s)` : '\nAll good');
process.exit(errors ? 1 : 0);
