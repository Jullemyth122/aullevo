/* 
   SYNC WEB AUTH — sync auth state if on Aullevo Web App
*/

export function initWebAuthSync() {
    if (
        !window.location.hostname.includes("aullevo-web") &&
        !window.location.hostname.includes("vercel.app") &&
        window.location.hostname !== "localhost"
    ) {
        return;
    }

    const syncWebAuth = () => {
        let isProFromStorage: boolean | undefined = undefined;
        try {
            const lsIsPro =
                localStorage.getItem("aullevo_is_pro") ||
                localStorage.getItem("isPro");
            if (lsIsPro !== null) {
                isProFromStorage = lsIsPro === "true";
            }
        } catch {}

        // 1. Check LocalStorage
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith("firebase:authUser:")) {
                    const raw = localStorage.getItem(key);
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (parsed && parsed.uid) {
                            if (
                                typeof chrome !== "undefined" &&
                                chrome.runtime?.sendMessage
                            ) {
                                chrome.runtime.sendMessage({
                                    action: "SYNC_WEB_USER",
                                    uid: parsed.uid,
                                    email: parsed.email,
                                    displayName: parsed.displayName,
                                    photoURL: parsed.photoURL,
                                    isPro: isProFromStorage,
                                });
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.warn("Aullevo: Failed to sync web auth from localStorage:", e);
        }

        // 2. Check IndexedDB (Firebase Auth JS SDK default)
        try {
            const req = indexedDB.open("firebaseLocalStorageDb");
            req.onsuccess = (e: any) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains("firebaseLocalStorage")) return;
                const tx = db.transaction("firebaseLocalStorage", "readonly");
                const store = tx.objectStore("firebaseLocalStorage");
                const getAllReq = store.getAll();
                getAllReq.onsuccess = () => {
                    const items = getAllReq.result || [];
                    for (const item of items) {
                        if (
                            item &&
                            item.value &&
                            (item.value.uid || item.value.email)
                        ) {
                            const val = item.value;
                            if (
                                typeof chrome !== "undefined" &&
                                chrome.runtime?.sendMessage
                            ) {
                                chrome.runtime.sendMessage({
                                    action: "SYNC_WEB_USER",
                                    uid: val.uid,
                                    email: val.email,
                                    displayName: val.displayName,
                                    photoURL: val.photoURL,
                                    isPro: isProFromStorage,
                                });
                            }
                        }
                    }
                };
            };
        } catch (e) {
            console.warn("Aullevo: Failed to sync web auth from IndexedDB:", e);
        }
    };

    syncWebAuth();
    window.addEventListener("focus", syncWebAuth);
    window.addEventListener("message", (event) => {
        if (
            event.data &&
            event.data.type === "AULLEVO_WEB_AUTH" &&
            event.data.user
        ) {
            const { uid, email, displayName, photoURL, isPro } = event.data.user;
            if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
                chrome.runtime.sendMessage({
                    action: "SYNC_WEB_USER",
                    uid,
                    email,
                    displayName,
                    photoURL,
                    isPro: !!isPro,
                });
            }
        }
    });
    setInterval(syncWebAuth, 3000);
}
