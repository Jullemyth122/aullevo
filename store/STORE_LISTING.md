# Chrome Web Store submission: Aullevo 0.6.5

Based on the listing approved for 0.6.0 (`aullevo-notes/store/CHROME_WEB_STORE.md`), updated for 0.6.4 (Voice mode with ElevenLabs + Gemini, 34 languages, AI-first voice commands) and 0.6.5 (Free plan: an allowance every day, then short ads on aullevo.com unlock more, and each ad adds to the last; the site moved to aullevo.com). Copy each block into the matching field of the Developer Dashboard. Reviewers compare this with the privacy policy, so keep both in step.

**Why the listing looked empty:** the old package had no store languages, and its listing was saved under **English (United States)**. 0.6.4 declares `default_locale: "en"` and 34 `_locales`, so the dashboard opened a new, empty **English** listing. The old text and screenshots are still attached to the old language. Fill the English one (and switch the old one off if the dashboard offers it).

---

## 0. Before you press "Submit for review"

- [ ] **Deploy aullevo-web first.** The privacy policy URL must already show the policy dated October 16 2026 (it describes Voice mode, ElevenLabs, the Gemini voice use, and the Free plan's daily uses and the 5-hour pass from 2 short ads). Reviewers open it.
- [ ] **Package tab:** upload `store/aullevo-v0.6.5.zip` (manifest at the zip root). Never the website zip (it has a `dist/` folder inside).
- [ ] **Remote code:** "No, I am not using remote code" (section 3).
- [ ] **Reviewer account** with Pro (`users/{uid}.isPro = true`, no `proExpiresAt`) for Auto-Pagination, document upload and **Voice mode**. Voice mode also needs an ElevenLabs API key: create one with Speech to Text + Text to Speech access and put it in the test instructions (section 5), or reviewers can't test it.
- [ ] Screenshots and tiles from `store/images/` uploaded under **English**.
- [ ] All three data certifications ticked.

---

## 1. Store listing tab (language: English)

### Description
```
Aullevo fills web forms for you: job applications, school and government forms, surveys, and sign-ups. Save your details once in an encrypted profile, open any form, and press Alt+Shift+L (or click Fill). Aullevo finds each question, matches it to your saved answers, and types them in.

WHAT IT DOES
• Fills text boxes, dropdowns, radio buttons, checkboxes, date fields, and file uploads, including forms inside frames and modern web apps.
• Ready-made profiles (Job, Academic, Government, Medical, Survey, Financial, Custom) plus your own custom fields with context hints.
• Highlights every field it detected and every field it filled, so you can check them at a glance.
• Multi-link batch fill: queue several form links and fill them one after another.
• Optional AI Smart Fill with your own free Google Gemini API key: picks the best multiple-choice answers, combines fields (for example First + Last Name into Full Name), follows format rules such as "Surname, Given Names", and drafts short answers to open questions.
• AI Memories: short notes (for example "Prefers remote roles") that AI Smart Fill can use for open-ended questions.
• Human-paced typing (Instant, Natural, or Slow) for sites that expect real keystrokes.
• Available in 34 languages, with a guided tour.

VOICE MODE
Talk to Aullevo instead of clicking. Say "fill this page", "fill the email", "fill the first question", or dictate your own answer: "answer the gym question with: I jog every morning". Live conversation keeps listening between commands; say "stop talking" to cut it off. Speech uses your own ElevenLabs API key; Google Gemini works out what you mean from what you said and the form's questions, never your saved values.

PRIVATE BY DESIGN
• Profiles, documents, and your API keys are encrypted on your device (AES-256-GCM), separately for each account. Aullevo has no server that stores your profile data.
• Mark any field SENSITIVE and its value is never sent to the AI, only its label.
• AI Smart Fill is off by default. When on, requests go directly from your browser to Google Gemini.
• Voice mode is off by default and only listens after you tap the microphone.
• Each account that signs in on the same browser gets its own separate encrypted vault.
• Aullevo never solves or bypasses CAPTCHAs.

FREE AND PRO
Aullevo is free to use: the keyword form engine, all profile types, the encrypted vault, custom fields, AI Memories, 3 active profiles, and Multi-link batch fill (5 links) are included. With a free Aullevo account you also get, every day: 6 AI fills, 3 voice sessions, 2 hours of Auto-Pagination, 2 hours of slower typing speeds, and 4 JSON imports. Any time you want more, watch 2 short ads on the Aullevo website: every feature is unlocked for 5 hours with no limits, including automatic document upload into forms, and 2 more ads add another 5 hours. The extension itself never shows ads.

Aullevo Pro (bought on the Aullevo website, 30 days per payment, no auto-renewal) adds unlimited AI fills, unlimited active profiles, automatic document upload into forms, slow and custom typing speeds, JSON import and export, Voice mode, and Auto-Pagination: Aullevo fills each page of a multi-step form, clicks Next, and presses Submit on the last page. It pauses and highlights the field whenever a required answer is missing or the form reports an error it can't fix. You can turn Auto-Pagination off to submit every form yourself.

HOW TO START
1. Open the side panel with Alt+Q. It opens straight to Autofill.
2. Fill in a profile once and mark private fields SENSITIVE.
3. Open a form and press Alt+Shift+L.

Privacy policy: https://aullevo.com/privacy
Help and documentation: https://aullevo.com/docs
```

### Category
**Productivity**. If a subcategory is offered, pick **Tools** (or **Workflow & Planning**).

### Graphic assets (all in `store/images/`)
| Field | File | Size |
|---|---|---|
| Store icon | `public/icons/icon128.png` (if the dashboard asks again) | 128×128 |
| Screenshot 1 | `1-fill-any-form.jpg` | 1280×800 |
| Screenshot 2 | `2-multi-page-forms.jpg` | 1280×800 |
| Screenshot 3 | `3-private-by-design.jpg` | 1280×800 |
| Screenshot 4 | `4-batch-fill.jpg` | 1280×800 |
| Screenshot 5 | `6-voice-mode-filling.jpg` (Voice mode filling a Google Form) | 1280×800 |
| Spare | `5-side-panel-autofill.jpg` (v0.6.4 side panel next to an empty Google Form) | 1280×800 |

The Store takes at most 5 screenshots: use 1–4 plus the Voice mode one; keep the spare for later.
| Small promo tile | `small-promo-tile-440x280.jpg` | 440×280 |
| Marquee promo tile | `marquee-promo-tile-1400x560.jpg` | 1400×560 |

Put the four screenshots in **Global screenshots** (they then show for every language) and, if the dashboard still requires it, also in **Localized screenshots** for English. A fifth screenshot of Voice mode (the orb next to a form, with "You said / Understood" visible) is a good addition; take it from the real extension at 1280×800. All files are JPEG (no alpha). Leave the promo videos empty unless you record one.

### Additional fields
- **Official URL:** None (needs Google Search Console ownership; optional).
- **Homepage URL:** `https://aullevo.com`
- **Support URL:** `https://aullevo.com/docs`
- **Mature content:** off.

---

## 2. Privacy tab: single purpose and permissions

### Single purpose description
```
Aullevo fills web forms with information the user saves in the extension. The user stores profiles (such as name, contact details, job or school details, and documents), opens any web form, and triggers a fill with a button, keyboard shortcut, or voice command. Aullevo detects the form's questions and enters the matching saved answers. Every feature supports this one purpose: profile management, optional AI help for questions that keywords can't match, voice commands to fill the whole form or particular questions, filling several form links in a row, and continuing through multi-page forms.
```

### storage justification
```
Stores the user's encrypted profile vault (profiles, custom fields, uploaded documents, and the user's own Gemini and ElevenLabs API keys, encrypted with AES-256-GCM using a random key per account that stays in local extension storage), plus settings, Voice mode preferences, the Multi-link queue, AI Memories, a JSON-import counter, and a copy of the account's Free-plan ad unlocks with the Aullevo sign-in token used to check them. chrome.storage.session holds the unlock key in memory only while the vault is unlocked, so the background worker can fill forms from keyboard shortcuts. Profile data, documents and API keys are never sent to an Aullevo server; for Free-plan ad unlocks only the account token and the name of the feature used are sent to aullevo.com.
```

### scripting justification
```
Used only with code packaged in the extension: (1) after install or update, re-inject the extension's own content script into tabs that were already open, so users don't have to reload every page; (2) when filling, run a small packaged function in the tab's frames to find which frames contain the form (and, for voice commands, which frame the user clicked last), so the right frame gets the fill and the Next/Submit steps. No remote or user-supplied code is executed.
```

### sidePanel justification
```
Aullevo's whole interface (profiles, fill button, Voice mode, settings, Multi-link queue) lives in Chrome's side panel so it never covers or restyles the page the user is filling. The panel opens per tab from the toolbar icon, the Alt+Q shortcut, or an optional button on the page.
```

### unlimitedStorage justification
```
Users can attach documents such as resume PDFs, cover letters, and ID scans to their profiles so Aullevo can upload them into forms. These are stored inside the encrypted vault in chrome.storage.local, and a few documents quickly exceed the default 10 MB storage quota.
```

### Host permission justification
```
Aullevo fills forms on whichever website the user chooses: job portals, school and government sites, Google Forms, Microsoft Forms, and plain HTML forms. The content script must run on all sites and in all frames because forms are often embedded in iframes and the extension cannot know in advance which site a user will apply on. It only reads form structure (fields, labels, options, buttons) and only fills when the user triggers it (Fill button, keyboard shortcut, voice command, or a Multi-link batch the user starts). activeTab is not enough: batch fill opens the user's queued links in new tabs, and Auto-Pagination must keep working after the form navigates to its next page. Host access is also used to call Google Gemini (AI Smart Fill and Voice mode, with the user's own key), ElevenLabs (Voice mode speech, with the user's own key) and Firebase (to check the user's plan). No browsing history is collected.
```

---

## 3. Privacy tab: remote code

Select **"No, I am not using remote code"**.

Why this is correct: the package contains all JavaScript, including the microphone audio worklet (`mic-worklet.js`). There is no `eval`, `new Function`, or remote `<script>`. The only network calls are data requests: Google Gemini (JSON), ElevenLabs (JSON and audio), Firestore REST (JSON), Aullevo's own rewards API on aullevo.com (JSON: Free-plan ad unlocks), and Google Fonts (CSS for the panel's typeface). Ads are never loaded in the extension; they play on the aullevo.com/rewards web page. The word `importScripts` in the bundle is only a feature check inside Google's `@google/genai` SDK and never loads anything.

---

## 4. Privacy tab: data usage

Declaring more than needed is safe; declaring less is a common rejection reason.

| Category | Tick? | Why |
|---|---|---|
| Personally identifiable information | ✅ | Profiles hold name, email, phone, address; account name/email/photo are read from Firebase |
| Health information | ✅ | The Medical profile can hold blood type, allergies, insurance |
| Financial and payment information | ✅ | The Financial profile can hold billing details and payment method (not card numbers) |
| Authentication information | ✅ | A short-lived Firebase sign-in token is passed to Firebase to verify the plan, and to Aullevo's server once to get the extension's own Aullevo token for Free-plan ad unlocks (stored locally, removed on Disconnect); no passphrase is used |
| Personal communications | ✅ | **New in 0.6.4:** Voice mode records the user's spoken commands and sends them to ElevenLabs for speech-to-text, and the transcribed sentence to Google Gemini |
| Location | ☐ | No location/IP/GPS collected (a typed address is covered by PII) |
| Web history | ☐ | Not collected |
| User activity | ✅ | Free plan only: which metered feature was used (one AI-filled page, one JSON import beyond the free ones, one voice session, the first Auto-Pagination or slower-typing fill of the day) is reported to Aullevo's server to count the daily free uses and check the 5-hour pass. No keystroke logging, click tracking, or analytics |
| Website content | ✅ | Form questions and answer options are sent to Google Gemini (AI Smart Fill, and Voice mode to know which question the user means) |

Then tick **all three** certifications:
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL
```
https://aullevo.com/privacy
```

---

## 5. Test instructions (Access → Test instructions)

```
No account needed for basic use. Pro features (including Voice mode) need the test account below.

BASIC
1. Click the toolbar icon (or Alt+Q) to open the side panel. It opens straight to Autofill (no passphrase).
2. Profiles tab: fill First Name, Last Name, Email, Phone.
3. Open this form: <PUBLIC TEST FORM URL>
4. Press Alt+Shift+L or click Fill Form. Filled fields get a blue outline and badge.
Optional AI: Settings > AI Smart Fill + a free key from aistudio.google.com/app/apikey.

PRO (Auto-Pagination, document upload, JSON, Voice mode)
1. Settings > Connect with Aullevo Web, sign in as <REVIEWER EMAIL> / <REVIEWER PASSWORD>.
2. Settings > turn on Auto-Pagination.
3. Open this multi-page form: <MULTI-PAGE TEST FORM URL>
4. Click Fill Form: it fills each page, clicks Next and submits on the last page, pausing on required fields it can't answer.

VOICE MODE (Pro account, or Free: 3 sessions a day)
1. Click the sound-wave button in the side panel header to switch to Voice mode.
2. Voice settings (bottom of the panel): paste this ElevenLabs API key and press Save: <ELEVENLABS TEST KEY>
   Settings > AI Smart Fill: add a Gemini key so voice commands are understood by AI.
3. Tap the microphone. The first time, a tab opens for Chrome's microphone permission: choose "Allow while visiting the site".
4. On the test form, say "fill the email" (only the email is filled), then "fill the first question", then "stop talking" while it replies.

No profile data is sent to an Aullevo server. Privacy: aullevo.com/privacy
```

---

## 6. Distribution tab

- **Visibility:** Public.
- **Regions:** All regions (or the ones you serve).
- **In-app purchases / payments question (if shown):** yes, the item offers an optional paid upgrade (Aullevo Pro) purchased on aullevo.com.

---

## 7. Releasing an update later

1. Bump `version` in `public/manifest.json`, `package.json` and `package-lock.json` (must be higher than the published one), plus the version mentions on aullevo-web.
2. `npm run build`.
3. Zip the **contents** of `dist/` (manifest at the root) and upload it on the Package tab.
4. If features changed what data is handled or sent, update `PRIVACY_POLICY.md`, aullevo-web's Privacy Policy page, and sections 2 and 4 above **before** submitting.
