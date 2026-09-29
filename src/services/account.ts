// account.ts - Account sync with aullevo-web (sign-in happens on the website)
//
// Flow:
// 1. Extension opens aullevo-web /login?source=extension; the user signs in there (Firebase signInWithPopup).
// 2. The website posts { type: 'AULLEVO_WEB_AUTH', idToken } to its own window.
// 3. content.ts (only on aullevo-web) forwards the token to background.ts.
// 4. background.ts calls verifyAndSyncAccount(): reads users/{uid} from Firestore REST using the token.
//    Firestore rejects forged/expired tokens and only returns the token owner's own doc,
//    so isPro can't be faked by editing localStorage or by another website.
//
// No Firebase SDK in the extension: no remote scripts (MV3-safe), no OAuth client setup.

import { ACCOUNT_STORAGE_KEY, type AccountInfo } from './tier';

export const AULLEVO_WEB_URL = 'https://aullevo-web.vercel.app';
export const AULLEVO_WEB_LOGIN_URL = `${AULLEVO_WEB_URL}/login?source=extension`;

// Origins allowed to hand a sign-in token to the extension.
// Local aullevo-web dev servers are only trusted in `npm run build:dev` builds, never in release.
export const TRUSTED_WEB_ORIGINS = import.meta.env.MODE === 'development'
    ? [AULLEVO_WEB_URL, 'http://localhost:5173', 'http://127.0.0.1:5173']
    : [AULLEVO_WEB_URL];

const FIREBASE_PROJECT_ID: string = (import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'aullevo-data').trim();

// ---------------------------------------------------------------------------
// 1. Token helpers
// ---------------------------------------------------------------------------

interface FirebaseIdTokenClaims {
    user_id?: string;
    sub?: string;
    aud?: string;
    email?: string;
    name?: string;
    picture?: string;
}

// Only used to find the uid for the Firestore path. Authenticity is enforced by Firestore itself.
function decodeTokenClaims(idToken: string): FirebaseIdTokenClaims {
    const payload = idToken.split('.')[1];
    if (!payload) throw new Error('Malformed sign-in token.');
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as FirebaseIdTokenClaims;
}

// Firestore REST returns typed values, e.g. { booleanValue: true } / { stringValue: "..." } / { timestampValue: "..." }
type FirestoreValue = { booleanValue?: boolean; stringValue?: string; timestampValue?: string };

function readString(field: FirestoreValue | undefined): string {
    return field?.stringValue ?? field?.timestampValue ?? '';
}

// ---------------------------------------------------------------------------
// 2. Verify token with Firestore and cache the account
// ---------------------------------------------------------------------------

export async function verifyAndSyncAccount(idToken: string): Promise<AccountInfo> {
    const claims = decodeTokenClaims(idToken);
    const uid = claims.user_id || claims.sub;
    if (!uid) throw new Error('Sign-in token has no user id.');
    if (claims.aud !== FIREBASE_PROJECT_ID) throw new Error('Sign-in token is for a different Firebase project.');

    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(uid)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });

    let fields: Record<string, FirestoreValue> = {};
    if (res.ok) {
        fields = ((await res.json()) as { fields?: Record<string, FirestoreValue> }).fields ?? {};
    } else if (res.status !== 404) {
        // 401/403 = invalid or expired token (or rules denied): do not trust anything
        throw new Error(`Could not verify your account (HTTP ${res.status}). Sign in again on Aullevo Web.`);
    }

    const account: AccountInfo = {
        uid,
        email: readString(fields.email) || claims.email || '',
        displayName: readString(fields.displayName) || claims.name || '',
        photoURL: readString(fields.photoURL) || claims.picture || '',
        isPro: fields.isPro?.booleanValue === true,
        proExpiresAt: readString(fields.proExpiresAt) || null,
        syncedAt: Date.now()
    };
    await chrome.storage.local.set({ [ACCOUNT_STORAGE_KEY]: account });
    return account;
}

export async function clearAccount(): Promise<void> {
    await chrome.storage.local.remove(ACCOUNT_STORAGE_KEY);
}
