# Aullevo

AI form autofill for Chrome. Save profiles (identity, job, academic, custom fields, documents) and fill job applications, surveys, and other web forms with one click, a keyboard shortcut, or a batch of links.

## Features

- **Profiles:** reusable sets of fields, custom fields, and uploaded documents (resume, ID scans)
- **Autofill:** keyword matching fills standard inputs, dropdowns, radios, checkboxes, and file uploads, including Google Forms, Microsoft Forms, and Workday-style custom controls
- **AI Smart Fill (optional, off by default):** the AI provider you choose in Settings (Google Gemini, OpenAI/ChatGPT, Anthropic/Claude, or any OpenAI-compatible server such as OpenRouter, Groq or Ollama) maps the questions left unmatched to your profile fields and follows each question's helper text (e.g. "Format: Surname, Given Names"): it returns a pattern like `{lastName}, {firstName}` that is filled in locally. Checkbox questions can get several answers. Values of fields marked SENSITIVE are never sent.
- **AI Memories:** short notes (e.g. "Work style: remote only") that AI Smart Fill can use for open-ended questions. Stored unencrypted; enabled ones are sent to the chosen AI provider
- **Voice mode (Pro):** switch the side panel to the agent orb and talk to Aullevo. "Fill this page", "fill the email", "fill this one" (the field you clicked), "fill the first question", "stop talking", "end conversation", plus highlight, rescan, profiles ("create a profile called Work", "set my phone to …"), Multi-link, AI and theme commands, in English or Tagalog. Speech-to-text and the agent's voice use ElevenLabs (Scribe v2, v4 Turbo with Flash v2.5 fallback) with your own key, stored in the encrypted vault. The chosen AI provider understands each sentence together with the page's questions (never your saved values) and picks the exact questions; "stop", "stop talking", "end conversation" and "mute" run instantly without it, and built-in rules take over when no AI provider is set up. Safety checks run locally: a request that names questions never fills the whole form, a dictated answer goes into one question, and "submit" only happens when you say it. Live conversation keeps listening between commands
- **Multi-link batch fill:** queue several application URLs and fill them in background tabs
- **JSON quick setup:** copy a profile as JSON, have an AI chatbot fill it from your resume, and import the result
- **34 languages:** the whole extension (side panel, guided tour, page badges, store listing) follows the browser's language or the one picked from the globe button; English is always one click away
- **Auto-pagination (Pro, or Free 2 h a day + the 2-ad pass):** fills every page of a multi-step form, clicks Next / Continue, then presses Submit on the last page. It pauses before clicking when a field marked required (`required`, `*`, "required") is empty. Other empty fields are left to the site: if the page does not move on, the run pauses and highlights them. Answers the site pre-filled (including an already uploaded resume) count as filled. When the form rejects an answer (e.g. "must be a valid number"), Aullevo reads the error, corrects the value ("5 years" → `5`, by rule or with AI Smart Fill) and tries again, up to twice
- **Encrypted vault, no passphrase:** profiles, documents, and AI provider API keys (one per provider) are encrypted locally (AES-256-GCM) with a random key per account and one for guest use, kept on the device; the side panel opens straight to Autofill. Old passphrase vaults ask once more and are converted
- **One vault per account:** each account signed in on the same browser has its own encrypted profiles, documents, API key, memories, and link queue; switching accounts locks the previous one. Settings → Data on this device removes accounts you no longer use
- **Free / Pro plans:** Pro is purchased on [Aullevo Web](https://aullevo.com) and synced to the extension by signing in there

| | Free | Pro |
|---|---|---|
| Active profiles | 3 | Unlimited |
| AI Smart Fill | 6 fills a day (each AI-filled page = 1) | Unlimited |
| JSON imports | 4 a day | Unlimited |
| JSON download (export) | During a pass | Yes |
| Document upload into forms | During a pass | Yes |
| Typing speed | Instant, Natural; Slow/custom 2 h a day | Any, including custom |
| Auto-pagination (multi-page forms) | 2 h a day | Yes |
| Voice mode (talk to fill, dictate answers) | 3 sessions a day | Yes |
| Multi-link queue | 5 links | Unlimited |
| **The pass: 2 short ads** | **Everything above, unlimited, for 5 h** | No ads |

The daily free uses need a connected account and reset at midnight UTC (JSON imports: local midnight); the free hours start at the first use that day. The pass can be watched any time (the second ad within an hour of the first); 2 more ads add 5 more hours. When a pass ends nothing is deleted: profiles and links beyond the Free limits are paused, not removed. Ads are watched on Aullevo Web (aullevo.com/rewards), never inside the extension; the website's /api/rewards keeps the counts on the account (a safety net stops bots at 100 ads a day).

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

The release build removes `console.log` / `info` / `debug` calls and trusts only `https://aullevo.com` for account sign-in. Zip the **contents** of `dist` (not the folder itself) for upload to the Chrome Web Store.

### Environment variables

| Variable | Purpose |
|---|---|
| `VITE_FIREBASE_PROJECT_ID` | Firebase project whose Firestore holds account and plan records. Not a secret. |
| `VITE_AULLEVO_AI_PROXY_URL` | Hosted AI proxy. Leave empty until it exists; users then need their own AI provider key. Setting it requires updating the privacy policy first. |

## Project structure

```
public/manifest.json       Manifest V3
src/background/            Service worker: side panel, shortcuts, AI requests, batch fill
src/content/content.ts     Form detection and filling (runs on every page)
src/services/vault.ts      Encrypted vault (a key per account, kept on the device)
src/services/account.ts    Account sync with Aullevo Web (Firestore REST, no Firebase SDK)
src/services/aiService.ts  AI providers (Gemini, OpenAI, Claude, OpenAI-compatible), prompts and privacy filtering
src/services/tier.ts       Free / Pro limits
src/voice/                 Voice mode: agent orb, ElevenLabs speech, command rules
src/components/            Side panel and options page UI (React)
```

## Privacy

See [PRIVACY_POLICY.md](PRIVACY_POLICY.md). All profile data stays in the browser. Nothing is sent anywhere except the plan-status lookup (Firebase), when AI Smart Fill is on, form questions plus AI SAFE field values (the AI provider you choose: Google Gemini, OpenAI, Anthropic, or your own OpenAI-compatible server), and in Voice mode, your spoken commands and the agent's replies (ElevenLabs) plus what you said and the page's questions, to understand each command (the same AI provider).
