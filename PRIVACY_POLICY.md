# Aullevo Privacy Policy

**Effective date:** October 16 2026
**Contact:** mythicalxenon12@gmail.com

Aullevo is a Chrome extension that fills web forms using information you save in it. This policy explains what data Aullevo handles, where it is stored, and when it leaves your device.

## 1. Data you save in Aullevo

You choose what to enter. Depending on the profiles you use, this may include:

- Identity and contact details (name, email, phone, address)
- Job, academic, medical, government, survey, or financial details you type into profile fields
- Custom fields you create
- Documents you upload (for example, a resume or ID scan)
- Links you add to the Multi-link queue
- AI Memories you add (short notes such as "Work style: remote only" that AI Smart Fill can use)
- Your own API keys for the AI providers you use with AI Smart Fill (Google Gemini, OpenAI, Anthropic, or an OpenAI-compatible server), and that server's address, if you add them
- Your own ElevenLabs API key, if you use Voice mode
- Settings (theme, typing speed, AI mode, Auto-Pagination, floating button preference, Voice mode preferences such as language and chosen voice), a JSON-import counter, and a copy of your account's Free-plan pass and ad unlocks

**All of this is stored only in your browser's local extension storage (`chrome.storage.local`) on your device.** Aullevo does not operate a server that receives, stores, or syncs this data.

Your profiles, custom fields, documents, AI provider API keys, and ElevenLabs API key are **encrypted (AES-256-GCM)** with a random key that Aullevo creates for each account that signs in, and one for guest use (no account). The key is kept in the extension's local storage on this device, which websites and other extensions cannot read, so there is no passphrase and Aullevo opens straight away. Because the key stays on the device, anyone who can use your browser profile can open Aullevo and see your saved data: on a shared computer, use your own browser profile or operating-system account. Versions before 0.6.5 used a passphrase; such a vault asks for it once more and is then converted. Settings (including your chosen AI provider, model, and server address), the Multi-link queue, the import counter, the copy of your ad unlocks, and AI Memories are stored unencrypted.

**Several accounts on one browser:** each account you connect gets its own separate, separately encrypted copy of profiles, documents, API keys, AI Memories, and Multi-link queue. Switching accounts switches to that account's own data; one account never sees another's. Display settings (theme, typing speed, AI mode, Auto-Pagination, floating button) belong to the browser, not to an account; Free-plan ad unlocks belong to your account. Profiles saved as a guest (before connecting an account) stay with the guest unless, when an account first signs in, you choose to move them into that account. Don't put passwords, ID numbers, or other secrets in an AI Memory.

## 2. Optional account connection

Connecting an account is optional. It is needed to unlock a Pro plan purchased on Aullevo Web (aullevo.com), and to use the Free plan's daily uses and 5-hour pass. You sign in on the Aullevo Web website, not inside the extension. When you do:

- Aullevo Web passes the extension a short-lived sign-in token (a Firebase ID token issued by Google)
- The extension uses that token to read your own account record (name, email, profile photo, plan status, and plan expiry) from our Firebase database, operated by Google
- The extension keeps a copy of that account record in local extension storage so it knows your plan, and re-checks it when you visit Aullevo Web

Aullevo **does not upload your profiles, fields, documents, or API keys** to Firebase or any other Aullevo server. Only your plan status, daily free uses and pass are synced.

**Free-plan daily uses and ad unlocks:** with a connected account, the Free plan includes an allowance every day (6 AI fills, 3 voice sessions, 2 hours of Auto-Pagination, 2 hours of slower typing speeds; 4 JSON imports are counted on your device only). At any time you may choose to watch 2 short ads on the Aullevo Web website to unlock every feature for 5 hours (a pass, with no limits, including document uploads and JSON export; 2 more ads add 5 more hours). Ads are never shown inside the extension. To make this work across your devices, the extension talks to Aullevo's own server (aullevo.com):

- When you connect your account, it receives a long-lived Aullevo sign-in token for this purpose (stored in local extension storage, removed when you click "Disconnect")
- It asks the server how many free uses your account has left today, and which features are unlocked and until when
- Each time you use a metered feature (one AI-filled page, one JSON import from an ad, one voice session, or the first Auto-Pagination or slower-typing fill of the day), it tells the server which feature was used

Only your account's sign-in token and the name of the feature are sent. **No profile data, documents, form questions, form answers, API keys, or browsing activity** are sent. The server stores, on your account, how many of today's free uses you have used, which features are unlocked, until when, how many uses are left, and how many ads you watched today. Firebase is governed by Google's privacy policy: <https://firebase.google.com/support/privacy>. Clicking "Disconnect" removes the local copy of your account information.

## 3. Data Aullevo reads from web pages

To detect and fill forms, Aullevo reads the structure of web pages you visit: form fields, their labels, their answer options, and the helper text shown with them (descriptions, examples, placeholder text, and error messages). When Auto-Pagination is on, it also reads the form's buttons (such as Next, Continue, and Submit) and any error messages the form shows, so it can move between pages and correct rejected answers. This happens locally in your browser. Aullevo does not collect your browsing history and does not send page content anywhere, except for the form questions described in Section 4 when AI Smart Fill is on.

## 4. Data shared with your AI provider (only when AI Smart Fill is on)

AI Smart Fill is **off by default**. When you turn it on, you choose which AI provider runs it in Settings: **Google Gemini**, **OpenAI** (ChatGPT models), **Anthropic** (Claude models), or a **custom server** that uses the OpenAI-compatible API (for example OpenRouter, Groq, or a model running on your own computer). Only the provider you have selected receives data. When you fill a form, Aullevo sends the following to that provider to decide how to answer fields it could not match on its own:

- The text of the form's questions and their answer options, plus a short description of the format an input expects (for example "whole number only")
- The helper text the form shows with each question (its description, example, placeholder text, and any error message currently shown), so answers follow the form's instructions (for example "Format: Surname, Given Names")
- For checkbox questions, which options Aullevo already ticked from AI SAFE fields
- The labels and context notes of your enabled profile fields
- The **values** of enabled fields marked **AI SAFE**
- The title and content of your **enabled AI Memories**
- When Auto-Pagination asks the AI to correct an answer a form rejected: the form's error message, and the rejected answer **only if** the AI wrote it or it came from an AI SAFE field

Aullevo **never** sends:

- The values of fields marked **SENSITIVE** (only their labels and context notes are sent), including which checkbox options were ticked from them
- Values a website filled in by itself, including checkboxes the website ticked
- Your uploaded documents

When a form wants your details in a specific format (for example "LAST NAME, First Name"), the AI returns only a pattern such as `{lastName|upper}, {firstName}`; Aullevo fills in your values on your device.

Requests are sent directly from your browser to the selected provider using the API key you provide. Each provider processes this data under its own terms and privacy policy:

- Google Gemini: <https://ai.google.dev/gemini-api/terms> and <https://policies.google.com/privacy>. Depending on your Google account and API tier, Google's terms may allow it to use submitted data to improve its services.
- OpenAI: <https://openai.com/policies/business-terms> and <https://openai.com/policies/privacy-policy>
- Anthropic: <https://www.anthropic.com/legal/commercial-terms> and <https://www.anthropic.com/legal/privacy>
- A custom server: whoever operates that server (you, if it runs on your own computer) receives the data under their own terms.

Mark any field you do not want shared as SENSITIVE, or leave AI Smart Fill off.

**Voice mode and your AI provider:** if your selected AI provider is set up (its API key, or a custom server's address), Voice mode uses it to understand each spoken command and which question on the page you mean ("fill my birthday", "the first question", "answer the gym question with…"). Only "stop", "stop talking", "end conversation" and "mute" are handled without it. For each command it sends **what you said**, the names of your profiles, and the form's question texts with their answer options and state (answered or empty, on screen, last clicked). Without one, built-in rules decide instead. It does not send your saved field values. If you say a value aloud (for example "set my phone to 0917…"), that sentence is part of what you said.

If Aullevo later offers a hosted AI option that does not require your own key, those requests would pass through an Aullevo server. We will update this policy before that feature is released.

## 4a. Voice mode and ElevenLabs (only when you use Voice mode)

Voice mode is **optional and off by default**. It lets you talk to Aullevo (for example "fill the email" or "fill the first question") and hear its replies. It uses ElevenLabs with the API key you provide:

- **Microphone:** Aullevo uses your microphone only after you tap the microphone button, and only while it is listening (one command, or until you end a live conversation). Chrome asks your permission first. Aullevo does not keep recordings.
- **Sent to ElevenLabs for speech-to-text:** the short audio recording of each spoken command. ElevenLabs returns the text.
- **Sent to ElevenLabs for the agent's voice:** the text of the agent's replies (for example "Filled Email address."), which can include the names of form questions.
- **Never sent to ElevenLabs:** your saved profile values, documents, or other data, unless you say them aloud.

Requests go directly from your browser to ElevenLabs. ElevenLabs processes this data under its own terms and privacy policy: <https://elevenlabs.io/terms-of-use> and <https://elevenlabs.io/privacy-policy>. To stop using it, switch back to the classic view or remove your ElevenLabs key in Voice settings.

## 5. Data entered into websites

When you fill a form, Aullevo types your saved values and attaches your chosen documents into that website's form. Once the form is submitted, that website handles the data under its own privacy policy. Aullevo only fills forms when you trigger it (Fill button, keyboard shortcut, a voice command, or a Multi-link batch you start). In Voice mode, saying "next" or "submit" clicks that button on the form for you.

**Auto-Pagination (Pro, or Free: 2 hours a day, or during the 5-hour pass from 2 short ads; off by default):** when you turn it on, Aullevo also clicks the form's Next / Continue buttons and **presses Submit on the last page for you**, which sends your answers to that website. It pauses instead of submitting when a field the form marks as required is still empty, or when the form shows an error it cannot fix. Turn Auto-Pagination off if you want to review and submit every form yourself.

## 6. What Aullevo does not do

- No analytics or tracking, and no ads inside the extension (Free users may choose to watch 2 short ads on the Aullevo Web website to unlock everything for 5 hours; see Section 2)
- No selling or renting of user data
- No transfer of user data to third parties, except Google Firebase for optional account connection and plan status (Section 2), Aullevo's own server for the Free plan's daily uses and pass (account token and feature use only; Section 2), the AI provider you select when you turn AI Smart Fill on or use Voice mode with it set up (Google Gemini, OpenAI, Anthropic, or a custom server you choose; Section 4), and ElevenLabs when you use Voice mode (Section 4a)
- No use of your data to determine creditworthiness or for lending purposes

## 7. Chrome Web Store Limited Use

Aullevo's use of information received from Chrome APIs complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements. Data is used only to provide Aullevo's form-filling features.

## 8. Keeping or deleting your data

- Delete any field, document, link, or profile from the side panel at any time.
- Settings → **Data on this device** lists every account that has Aullevo data in this browser and lets you permanently delete the data of accounts you no longer use.
- Uninstalling Aullevo removes all data it stored in your browser.
- Your profiles have no server copy. To delete your account record (name, email, plan status) from our Firebase database, contact us at the address below.

## 9. Children

Aullevo is not directed at children under 13 and does not knowingly collect their information.

## 10. Changes to this policy

If this policy changes, we will update the effective date above and publish the new version at this same address. Material changes, such as adding a hosted AI service or cloud sync, will be announced in the extension's release notes.

## 11. Contact

Questions about this policy: mythicalxenon12@gmail.com
