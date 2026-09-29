import { useState, useEffect, type ReactNode, type FormEvent } from 'react';
import { Lock, ShieldCheck, KeyRound } from 'lucide-react';
import {
    getVaultStatus,
    createVault,
    unlockVault,
    resetVault,
    readLegacyPlaintext,
    VAULT_SESSION_KEY,
    VAULT_STORAGE_KEY,
    MIN_PASSPHRASE_LENGTH,
    type VaultStatus
} from '../services/vault';

interface VaultGateProps {
    children: ReactNode;
}

/**
 * Renders the app only while the encrypted vault is unlocked.
 * - No vault yet → create passphrase (migrates any existing plaintext profiles)
 * - Locked → unlock with passphrase (or reset if forgotten)
 */
export function VaultGate({ children }: VaultGateProps) {
    const [status, setStatus] = useState<VaultStatus | 'loading'>('loading');
    const [isDark, setIsDark] = useState<boolean>(true);
    const [hasLegacyData, setHasLegacyData] = useState<boolean>(false);
    const [passphrase, setPassphrase] = useState<string>('');
    const [confirmPassphrase, setConfirmPassphrase] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [isWorking, setIsWorking] = useState<boolean>(false);

    useEffect(() => {
        getVaultStatus().then(setStatus);
        readLegacyPlaintext().then(d => setHasLegacyData(Boolean(d.userProfiles?.profiles?.length)));
        chrome.storage?.local?.get(['aullevo_theme'], (res) => {
            if (res.aullevo_theme) setIsDark(res.aullevo_theme === 'dark');
        });

        // Re-check when the vault is locked/unlocked/reset from anywhere (e.g. "Lock now" in Settings)
        const handleChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
            if ((area === 'session' && changes[VAULT_SESSION_KEY]) || (area === 'local' && changes[VAULT_STORAGE_KEY])) {
                getVaultStatus().then(setStatus);
            }
        };
        chrome.storage?.onChanged?.addListener(handleChange);
        return () => chrome.storage?.onChanged?.removeListener(handleChange);
    }, []);

    useEffect(() => {
        document.documentElement.classList.toggle('av-dark', isDark);
        document.body.classList.toggle('av-dark', isDark);
    }, [isDark]);

    const handleCreate = async (e: FormEvent) => {
        e.preventDefault();
        if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
            setError(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`);
            return;
        }
        if (passphrase !== confirmPassphrase) {
            setError('Passphrases do not match.');
            return;
        }
        setIsWorking(true);
        setError(null);
        try {
            await createVault(passphrase);
            setPassphrase('');
            setConfirmPassphrase('');
            setStatus('unlocked');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not create vault.');
        } finally {
            setIsWorking(false);
        }
    };

    const handleUnlock = async (e: FormEvent) => {
        e.preventDefault();
        setIsWorking(true);
        setError(null);
        const ok = await unlockVault(passphrase);
        setIsWorking(false);
        if (ok) {
            setPassphrase('');
            setStatus('unlocked');
        } else {
            setError('Wrong passphrase.');
        }
    };

    const handleReset = async () => {
        const confirmed = confirm(
            'Reset Aullevo?\n\nThis permanently deletes all profiles, documents, and your saved API key. ' +
            'There is no way to recover them without the passphrase.'
        );
        if (!confirmed) return;
        await resetVault();
        setPassphrase('');
        setError(null);
        setStatus('none');
    };

    if (status === 'unlocked') return <>{children}</>;

    return (
        <div className={`av-panel ${isDark ? 'av-dark' : ''}`}>
            <main className="av-panel__body">
                {status === 'loading' && <div className="av-card">Loading…</div>}

                {status === 'none' && (
                    <form className="av-card" onSubmit={handleCreate}>
                        <div className="av-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <ShieldCheck size={13} />
                            <span>Create Your Vault Passphrase</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--av-text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
                            Your profiles, documents, and API key are encrypted with this passphrase (AES-256).
                            You'll enter it once each time you start your browser.
                            {hasLegacyData && <> Your existing profiles will be moved into the encrypted vault.</>}
                            <br /><strong>If you forget it, your data cannot be recovered.</strong> Export a JSON backup to be safe.
                        </div>
                        <input
                            className="av-input"
                            type="password"
                            autoFocus
                            placeholder={`Passphrase (min ${MIN_PASSPHRASE_LENGTH} characters)`}
                            value={passphrase}
                            onChange={(e) => setPassphrase(e.target.value)}
                            style={{ marginBottom: 6 }}
                        />
                        <input
                            className="av-input"
                            type="password"
                            placeholder="Confirm passphrase"
                            value={confirmPassphrase}
                            onChange={(e) => setConfirmPassphrase(e.target.value)}
                        />
                        {error && <div style={{ fontSize: 11, color: 'var(--av-error)', marginTop: 6 }}>{error}</div>}
                        <button type="submit" className="av-save-btn" disabled={isWorking} style={{ marginTop: 10 }}>
                            <KeyRound size={12} />
                            <span>{isWorking ? 'Encrypting…' : 'Create Encrypted Vault'}</span>
                        </button>
                    </form>
                )}

                {status === 'locked' && (
                    <form className="av-card" onSubmit={handleUnlock}>
                        <div className="av-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Lock size={13} />
                            <span>Aullevo is Locked</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--av-text-muted)', marginBottom: 10 }}>
                            Enter your passphrase to unlock your profiles for this browser session.
                        </div>
                        <input
                            className="av-input"
                            type="password"
                            autoFocus
                            placeholder="Passphrase"
                            value={passphrase}
                            onChange={(e) => setPassphrase(e.target.value)}
                        />
                        {error && <div style={{ fontSize: 11, color: 'var(--av-error)', marginTop: 6 }}>{error}</div>}
                        <button type="submit" className="av-save-btn" disabled={isWorking || !passphrase} style={{ marginTop: 10 }}>
                            <KeyRound size={12} />
                            <span>{isWorking ? 'Unlocking…' : 'Unlock'}</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleReset}
                            style={{ marginTop: 10, background: 'none', border: 'none', color: 'var(--av-text-muted)', fontSize: 10, cursor: 'pointer', textDecoration: 'underline' }}
                        >
                            Forgot passphrase? Reset Aullevo
                        </button>
                    </form>
                )}
            </main>
        </div>
    );
}
