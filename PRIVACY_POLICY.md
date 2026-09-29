# Aullevo Privacy Policy

**Effective date:** September 29 2026
**Contact:** mythicalxenon12@gmail.com

Aullevo is a Chrome extension that fills web forms using information you save in it. This policy explains what data Aullevo handles, where it is stored, and when it leaves your device.

## 1. Data you save in Aullevo

You choose what to enter. Depending on the profiles you use, this may include:

- Identity and contact details (name, email, phone, address)
- Job, academic, medical, government, survey, or financial details you type into profile fields
- Custom fields you create
- Documents you upload (for example, a resume or ID scan)
- Links you add to the Multi-link queue
- Your own Google Gemini API key, if you add one
- Settings (theme, typing speed, AI mode, floating button preference) and a weekly AI usage counter

**All of this is stored only in your browser's local extension storage (`chrome.storage.local`) on your device.** Aullevo does not operate a server that receives, stores, or syncs this data.

Your profiles, custom fields, documents, and Gemini API key are **encrypted with a passphrase you choose** (AES-256-GCM, with a key derived from your passphrase using PBKDF2-SHA256). Your passphrase is never stored. While Aullevo is unlocked, the encryption key is held in the browser's in-memory session storage and is cleared when you close the browser or press "Lock now". If you forget your passphrase, your data cannot be recovered. Settings, the Multi-link queue, and the usage counter are stored unencrypted because they are not personal profile data.

## 2. Optional account connection

Connecting an account is optional. It is only needed to unlock a Pro plan purchased on Aullevo Web (aullevo-web.vercel.app). You sign in on the Aullevo Web website, not inside the extension. When you do:

- Aullevo Web passes the extension a short-lived sign-in token (a Firebase ID token issued by Google)
- The extension uses that token to read your own account record (name, email, profile photo, plan status, and plan expiry) from our Firebase database, operated by Google
- The extension keeps a copy of that account record in local extension storage so it knows your plan, and re-checks it when you visit Aullevo Web

Aullevo **does not upload your profiles, fields, documents, or API key** to Firebase or any other Aullevo server. Only your plan status is synced. Firebase is governed by Google's privacy policy: <https://firebase.google.com/support/privacy>. Clicking "Disconnect" removes the local copy of your account information.

## 3. Data Aullevo reads from web pages

To detect and fill forms, Aullevo reads the structure of web pages you visit: form fields, their labels, and their answer options. This happens locally in your browser. Aullevo does not collect your browsing history and does not send page content anywhere, except for the form questions described in Section 4 when AI Smart Fill is on.

## 4. Data shared with Google Gemini (only when AI Smart Fill is on)

AI Smart Fill is **off by default**. When you turn it on and fill a form, Aullevo sends the following to Google's Gemini API to decide how to answer fields it could not match on its own:

- The text of the form's questions and their answer options
- The labels and context notes of your enabled profile fields
- The **values** of enabled fields marked **AI SAFE**

Aullevo **never** sends:

- The values of fields marked **SENSITIVE** (only their labels and context notes are sent)
- Your uploaded documents

Requests are sent directly from your browser to Google using the API key you provide. Google processes this data under its own terms and privacy policy: <https://ai.google.dev/gemini-api/terms> and <https://policies.google.com/privacy>. Depending on your Google account and API tier, Google's terms may allow it to use submitted data to improve its services. Mark any field you do not want shared as SENSITIVE, or leave AI Smart Fill off.

If Aullevo later offers a hosted AI option that does not require your own key, those requests would pass through an Aullevo server. We will update this policy before that feature is released.

## 5. Data entered into websites

When you fill a form, Aullevo types your saved values and attaches your chosen documents into that website's form. Once you submit the form, that website handles the data under its own privacy policy. Aullevo only fills forms when you trigger it (Fill button, keyboard shortcut, or a Multi-link batch you start).

## 6. What Aullevo does not do

- No analytics, tracking, or advertising
- No selling or renting of user data
- No transfer of user data to third parties, except Google Firebase for optional account connection and plan status (Section 2) and Google Gemini when you turn AI Smart Fill on (Section 4)
- No use of your data to determine creditworthiness or for lending purposes

## 7. Chrome Web Store Limited Use

Aullevo's use of information received from Chrome APIs complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements. Data is used only to provide Aullevo's form-filling features.

## 8. Keeping or deleting your data

- Delete any field, document, link, or profile from the side panel at any time.
- Uninstalling Aullevo removes all data it stored in your browser.
- Your profiles have no server copy. To delete your account record (name, email, plan status) from our Firebase database, contact us at the address below.

## 9. Children

Aullevo is not directed at children under 13 and does not knowingly collect their information.

## 10. Changes to this policy

If this policy changes, we will update the effective date above and publish the new version at this same address. Material changes, such as adding a hosted AI service or cloud sync, will be announced in the extension's release notes.

## 11. Contact

Questions about this policy: [Insert your support email]
