// options.html#microphone: the side panel can't show Chrome's microphone prompt, so Voice mode opens this page.
// Permission is given to the extension, so the side panel can use the microphone afterwards. The page also says
// what to do when it isn't Chrome's permission at all (the computer blocks it, no mic, mic in use).
import { useEffect, useState } from 'react';
import { CheckCircle2, Mic, MicOff, RefreshCw, X } from 'lucide-react';
import { microphonePermission, requestMicrophone, type MicrophoneProblem } from './listen';
import styles from './MicrophoneSetup.module.scss';

type State = 'checking' | 'asking' | 'allowed' | MicrophoneProblem;

const isWindows = /Windows/i.test(navigator.userAgent);
const isMac = /Mac OS/i.test(navigator.userAgent);

export function MicrophoneSetup() {
    const [state, setState] = useState<State>('checking');

    // Shows "Allow…" while Chrome's prompt is up (no permission yet), then the result
    const check = (ask: boolean) => microphonePermission()
        .then((permission) => {
            setState(permission === 'granted' || !ask ? 'checking' : 'asking');
            return requestMicrophone();
        })
        .then(setState);

    useEffect(() => {
        document.title = 'Aullevo · Microphone';
        void check(true);
        // Coming back after changing a setting (Chrome's site settings, Windows privacy): check again
        const onVisible = () => { if (document.visibilityState === 'visible') void check(false); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('hashchange', onVisible);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('hashchange', onVisible);
        };
    }, []);

    const closeTab = () => {
        chrome.tabs.getCurrent((tab) => {
            if (tab?.id !== undefined) chrome.tabs.remove(tab.id);
            else window.close();
        });
    };
    const openChromeMicSettings = () => void chrome.tabs.create({ url: 'chrome://settings/content/microphone' });

    const ok = state === 'allowed';
    const waiting = state === 'checking' || state === 'asking';

    return (
        <main className={styles.page}>
            <section className={styles.card} aria-live="polite">
                <div className={styles.brand}>
                    <img src="/icons/icon48.png" alt="" width={28} height={28} />
                    <span>Aullevo · Voice mode</span>
                </div>

                <div className={styles.icon} data-state={ok ? 'ok' : waiting ? 'wait' : 'problem'}>
                    {ok ? <CheckCircle2 size={34} /> : waiting ? <Mic size={34} /> : <MicOff size={34} />}
                </div>

                {state === 'checking' && (
                    <>
                        <h1>Checking the microphone…</h1>
                        <p>One moment.</p>
                    </>
                )}

                {state === 'asking' && (
                    <>
                        <h1>Allow the microphone</h1>
                        <p>Chrome is asking at the top of this window. Choose:</p>
                        <div className={styles.choice}><strong>Allow while visiting the site</strong></div>
                        <p className={styles.small}>Not "Allow this time": that permission ends when this tab closes, and the side panel would ask again.</p>
                    </>
                )}

                {ok && (
                    <>
                        <h1>Microphone allowed</h1>
                        <p>You're all set. Close this tab and tap the mic in Aullevo's side panel. You won't be asked again.</p>
                        <div className={styles.actions}>
                            <button className={styles.primary} onClick={closeTab}><X size={15} /> Close this tab</button>
                        </div>
                    </>
                )}

                {state === 'permission' && (
                    <>
                        <h1>The microphone is blocked for Aullevo</h1>
                        <ol className={styles.steps}>
                            <li>Click the icon at the left of the address bar (or the microphone icon at its right).</li>
                            <li>Set <strong>Microphone</strong> to <strong>Allow</strong>.</li>
                            <li>Come back to this tab: it checks again by itself.</li>
                        </ol>
                        <div className={styles.actions}>
                            <button className={styles.primary} onClick={() => void check(true)}><RefreshCw size={15} /> Try again</button>
                            <button className={styles.secondary} onClick={openChromeMicSettings}>Chrome microphone settings</button>
                        </div>
                    </>
                )}

                {state === 'system' && (
                    <>
                        <h1>Your computer is blocking the microphone</h1>
                        <p>Chrome is allowed to use it, but {isWindows ? 'Windows' : isMac ? 'macOS' : 'your system'} is keeping it from Chrome.</p>
                        <ol className={styles.steps}>
                            {isWindows ? (
                                <>
                                    <li>Open <strong>Settings → Privacy &amp; security → Microphone</strong>.</li>
                                    <li>Turn on <strong>Microphone access</strong> and <strong>Let desktop apps access your microphone</strong>.</li>
                                </>
                            ) : isMac ? (
                                <li>Open <strong>System Settings → Privacy &amp; Security → Microphone</strong> and turn on <strong>Google Chrome</strong>.</li>
                            ) : (
                                <li>Allow Chrome to use the microphone in your system's privacy settings.</li>
                            )}
                            <li>Come back to this tab: it checks again by itself.</li>
                        </ol>
                        <div className={styles.actions}>
                            {isWindows && <a className={styles.secondary} href="ms-settings:privacy-microphone">Open Windows microphone settings</a>}
                            <button className={styles.primary} onClick={() => void check(true)}><RefreshCw size={15} /> Try again</button>
                        </div>
                    </>
                )}

                {state === 'missing' && (
                    <>
                        <h1>No microphone found</h1>
                        <p>Plug in a microphone or headset, then try again.</p>
                        <div className={styles.actions}>
                            <button className={styles.primary} onClick={() => void check(true)}><RefreshCw size={15} /> Try again</button>
                        </div>
                    </>
                )}

                {state === 'busy' && (
                    <>
                        <h1>The microphone is in use</h1>
                        <p>Another app (a call, a recorder) is holding the microphone. Close it, then try again.</p>
                        <div className={styles.actions}>
                            <button className={styles.primary} onClick={() => void check(true)}><RefreshCw size={15} /> Try again</button>
                        </div>
                    </>
                )}

                {state === 'other' && (
                    <>
                        <h1>The microphone didn't start</h1>
                        <p>Check that a microphone is connected and allowed, then try again.</p>
                        <div className={styles.actions}>
                            <button className={styles.primary} onClick={() => void check(true)}><RefreshCw size={15} /> Try again</button>
                            <button className={styles.secondary} onClick={openChromeMicSettings}>Chrome microphone settings</button>
                        </div>
                    </>
                )}
            </section>
        </main>
    );
}
