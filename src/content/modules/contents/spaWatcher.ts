/* 
   SPA WATCHER — detect route changes and form mutations
*/

export function safeSendMessage(msg: any) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
        try {
            chrome.runtime.sendMessage(msg).catch(() => { });
        } catch (e) {
            // context invalidated, ignore
        }
    }
}

export function initSPAWatcher() {
    let lastUrl = location.href;
    let mutationTimer: ReturnType<typeof setTimeout> | null = null;

    const domObserver = new MutationObserver(() => {
        if (mutationTimer) clearTimeout(mutationTimer);
        mutationTimer = setTimeout(() => {
            safeSendMessage({ action: 'domChanged' });
        }, 1000);
    });

    domObserver.observe(document.body, { childList: true, subtree: true });

    const urlCheckInterval = setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            safeSendMessage({ action: 'urlChanged', url: location.href });
        }
    }, 600);

    const _push = history.pushState.bind(history);
    const _replace = history.replaceState.bind(history);
    history.pushState = (...args) => {
        _push(...args);
        safeSendMessage({ action: 'urlChanged', url: location.href });
    };
    history.replaceState = (...args) => {
        _replace(...args);
        safeSendMessage({ action: 'urlChanged', url: location.href });
    };
    window.addEventListener('popstate', () => {
        safeSendMessage({ action: 'urlChanged', url: location.href });
    });

    window.addEventListener('beforeunload', () => {
        domObserver.disconnect();
        clearInterval(urlCheckInterval);
    });
}
