// i18n-manifest: builds public/_locales/<chrome code>/messages.json (store listing name/description,
// toolbar tooltip, shortcut names) from src/i18n/en/manifest.json and the "manifest" part of each
// public/locales/<code>.json. Run after changing translations: npm run i18n:manifest
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const LOCALES_DIR = join(ROOT, 'public/locales');
const OUT_DIR = join(ROOT, 'public/_locales');

// Our language code -> Chrome _locales folder (see src/i18n/languages.ts)
const CHROME_CODES = { 'pt-BR': 'pt_BR', 'pt-PT': 'pt_PT', 'zh-CN': 'zh_CN', 'zh-TW': 'zh_TW' };

// Chrome Web Store limits
const LIMITS = { appName: 75, appDescription: 132 };

const toMessages = (strings) => Object.fromEntries(
    Object.entries(strings).map(([key, message]) => [key, { message }])
);

const write = (code, strings) => {
    for (const [key, max] of Object.entries(LIMITS)) {
        if ((strings[key] ?? '').length > max) {
            console.warn(`  ! ${code}: ${key} is ${strings[key].length} characters (store limit ${max})`);
        }
    }
    const dir = join(OUT_DIR, CHROME_CODES[code] ?? code);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'messages.json'), JSON.stringify(toMessages(strings), null, 2) + '\n');
};

const en = JSON.parse(readFileSync(join(ROOT, 'src/i18n/en/manifest.json'), 'utf8'));
write('en', en);
let count = 1;

for (const file of readdirSync(LOCALES_DIR).filter(f => f.endsWith('.json'))) {
    const code = basename(file, '.json');
    const manifest = JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8')).manifest;
    if (!manifest) {
        console.warn(`  ! ${code}: no "manifest" section, store listing stays English`);
        continue;
    }
    write(code, { ...en, ...manifest }); // missing keys fall back to English
    count++;
}
console.log(`Wrote ${count} _locales folders`);
