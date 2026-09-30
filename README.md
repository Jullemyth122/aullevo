# Aullevo

AI form autofill for Chrome. Save profiles (identity, job, academic, custom fields, documents) and fill job applications, surveys, and other web forms with one click, a keyboard shortcut, or a batch of links.

## Features

- **Profiles:** reusable sets of fields, custom fields, and uploaded documents (resume, ID scans)
- **Autofill:** keyword matching fills standard inputs, dropdowns, radios, checkboxes, and file uploads, including Google Forms, Microsoft Forms, and Workday-style custom controls
- **AI Smart Fill (optional, off by default):** Google Gemini maps the questions left unmatched to your profile fields. Values of fields marked SENSITIVE are never sent.
- **AI Memories:** short notes (e.g. "Work style: remote only") that AI Smart Fill can use for open-ended questions. Stored unencrypted; enabled ones are sent to Gemini
- **Multi-link batch fill:** queue several application URLs and fill them in background tabs
- **Auto-pagination (Pro):** fills every page of a multi-step form, clicks Next / Continue, then presses Submit on the last page. It pauses before clicking when a field marked required (`required`, `*`, "required") is empty. Other empty fields are left to the site: if the page does not move on, the run pauses and highlights them. Answers the site pre-filled (including an already uploaded resume) count as filled. When the form rejects an answer (e.g. "must be a valid number"), Aullevo reads the error, corrects the value ("5 years" → `5`, by rule or with AI Smart Fill) and tries again, up to twice
- **Encrypted vault:** profiles, documents, and the Gemini API key are encrypted locally with a passphrase (AES-256-GCM, PBKDF2-SHA256)
- **Free / Pro plans:** Pro is purchased on [Aullevo Web](https://aullevo-web.vercel.app) and synced to the extension by signing in there

| | Free | Pro |
|---|---|---|
| Active profiles | 2 | Unlimited |
| AI fills per week | 10 | Unlimited |
| Document upload into forms | No | Yes |
| Typing speed | Instant, Natural | Any, including custom |
| Auto-pagination (multi-page forms) | No | Yes |

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Alt+Q` | Toggle the side panel |
| `Alt+Shift+L` | Fill the current page |
| `Alt+Shift+B` | Run the Multi-link batch fill |

## Development

Requirements: Node.js 20+ and Chrome 116+ (Side Panel API).

```bash
npm install
cp .env.example .env
npm run build:dev   # development build (also trusts a local aullevo-web on localhost:5173)
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the `dist` folder. After each rebuild, click the reload icon on the extension card.

### Release build

```bash
npm run build
```

The release build removes `console.log` / `info` / `debug` calls and trusts only `https://aullevo-web.vercel.app` for account sign-in. Zip the **contents** of `dist` (not the folder itself) for upload to the Chrome Web Store.

### Environment variables

| Variable | Purpose |
|---|---|
| `VITE_FIREBASE_PROJECT_ID` | Firebase project whose Firestore holds account and plan records. Not a secret. |
| `VITE_AULLEVO_AI_PROXY_URL` | Hosted AI proxy. Leave empty until it exists; users then need their own Gemini key. Setting it requires updating the privacy policy first. |

## Project structure

```
public/manifest.json       Manifest V3
src/background/            Service worker: side panel, shortcuts, AI requests, batch fill
src/content/content.ts     Form detection and filling (runs on every page)
src/services/vault.ts      Passphrase encryption
src/services/account.ts    Account sync with Aullevo Web (Firestore REST, no Firebase SDK)
src/services/aiService.ts  Gemini prompt and privacy filtering
src/services/tier.ts       Free / Pro limits
src/components/            Side panel and options page UI (React)
```

## Privacy

See [PRIVACY_POLICY.md](PRIVACY_POLICY.md). All profile data stays in the browser. Nothing is sent anywhere except the plan-status lookup (Firebase) and, when AI Smart Fill is on, form questions plus AI SAFE field values (Google Gemini).
