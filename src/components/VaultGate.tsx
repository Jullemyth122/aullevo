import { Fragment, useState, useEffect, type ReactNode, type FormEvent } from 'react';
import { Lock, UserRound, ArrowRightLeft, KeyRound, Sparkles } from 'lucide-react';
import {
    getVaultStatus,
    createVault,
    unlockVault,
    resetVault,
    canClaimLocalVault,
    claimLocalVault,
    localVaultNeedsPassphrase,
    upgradeUnlockedVault,
    isVaultStorageKey,
    VAULT_SESSION_KEY,
    type VaultStatus
} from '../services/vault';
import { ACCOUNT_STORAGE_KEY, getStoredAccount } from '../services/tier';
import { LanguageMenu } from './language/LanguageMenu';
import { useT } from '../i18n';

interface VaultGateProps {
    children: ReactNode;
}

/**
 * Opens the connected account's (or the guest's) encrypted vault and renders the app. There is no passphrase:
 * a new vault is created on the spot, so the panel goes straight to Autofill. Each owner has its own vault
 * (services/owner.ts); switching accounts remounts the app. A screen shows only when:
 * - a newly signed-in account has no data yet and this browser has guest profiles: are they this account's?
 * - an old vault was made with a passphrase: entered one last time, then it never asks again
 */
export function VaultGate({ children }: VaultGateProps) {
    const { t, tRich } = useT();
    const [status, setStatus] = useState<VaultStatus | 'loading'>('loading');
    const [ownerLabel, setOwnerLabel] = useState<string | null>(null); // account email ('' = unnamed account), null = guest
    const [ownerKey, setOwnerKey] = useState<string>('local');         // remounts the app per account
    const [canClaim, setCanClaim] = useState<boolean>(false);
    const [claimNeedsPassphrase, setClaimNeedsPassphrase] = useState<boolean>(false);
    const [isDark, setIsDark] = useState<boolean>(true);
    const [passphrase, setPassphrase] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [isWorking, setIsWorking] = useState<boolean>(false);

    useEffect(() => {
        let alive = true;
        const refresh = async () => {
            await upgradeUnlockedVault();
            const [account, claimable] = await Promise.all([getStoredAccount(), canClaimLocalVault()]);
            let nextStatus = await getVaultStatus();
            // Nothing to ask: make this owner's vault now and open the app
            if (nextStatus === 'none' && !claimable) {
                await createVault().catch(err => console.error('[Aullevo] Could not create vault', err));
                nextStatus = await getVaultStatus();
            }
            if (!alive) return;
            setPassphrase('');
            setError(null);
            setStatus(nextStatus);
            setOwnerLabel(account ? (account.email || account.displayName || '') : null);
            setOwnerKey(account?.uid || 'local');
            setCanClaim(claimable);
            setClaimNeedsPassphrase(claimable && await localVaultNeedsPassphrase());
        };
        void refresh();
        chrome.storage?.local?.get(['aullevo_theme'], (res) => {
            if (res.aullevo_theme) setIsDark(res.aullevo_theme === 'dark');
        });

        // Re-check when a vault is created, moved or reset, or the account changes, from anywhere
        const handleChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
            const keys = Object.keys(changes);
            if ((area === 'session' && changes[VAULT_SESSION_KEY]) ||
                (area === 'local' && (changes[ACCOUNT_STORAGE_KEY] || keys.some(isVaultStorageKey)))) {
                void refresh();
            }
        };
        chrome.storage?.onChanged?.addListener(handleChange);
        return () => {
            alive = false;
            chrome.storage?.onChanged?.removeListener(handleChange);
        };
    }, []);

    useEffect(() => {
        document.documentElement.classList.toggle('av-dark', isDark);
        document.body.classList.toggle('av-dark', isDark);
    }, [isDark]);

    const hasAccount = ownerLabel !== null;
    const ownerName = ownerLabel || (hasAccount ? t('vault.account.fallbackName') : t('vault.account.guestName'));

    const startFresh = async () => {
        setIsWorking(true);
        try {
            await createVault();
            setStatus('unlocked');
        } catch (err) {
            console.error('[Aullevo] Could not create vault', err);
            setError(t('vault.errors.createFailed'));
        } finally {
            setIsWorking(false);
        }
    };

    const handleClaim = async (e: FormEvent) => {
        e.preventDefault();
        setIsWorking(true);
        setError(null);
        const ok = await claimLocalVault(passphrase);
        setIsWorking(false);
        if (ok) setStatus('unlocked');
        else setError(t('vault.errors.wrongClaimPassphrase'));
    };

    const handleUnlock = async (e: FormEvent) => {
        e.preventDefault();
        setIsWorking(true);
        setError(null);
        const ok = await unlockVault(passphrase);
        setIsWorking(false);
        if (ok) setStatus('unlocked');
        else setError(t('vault.errors.wrongPassphrase'));
    };

    const handleReset = async () => {
        if (!confirm(t('vault.reset.confirm', { account: ownerName }))) return;
        await resetVault();
        await startFresh();
    };

    // key: switching accounts remounts the app, so nothing from the previous account stays in memory
    if (status === 'unlocked') return <Fragment key={ownerKey}>{children}</Fragment>;

    const accountLine = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--av-text-muted)', marginBottom: 8 }}>
            <UserRound size={12} />
            <span>{hasAccount ? tRich('vault.account.signedInAs', { account: ownerName }) : t('vault.account.notSignedIn')}</span>
        </div>
    );
    const hint = { fontSize: 11, color: 'var(--av-text-muted)', lineHeight: 1.5, marginBottom: 10 } as const;

    return (
        <div className={`av-panel ${isDark ? 'av-dark' : ''}`}>
            <main className="av-panel__body">
                {/* Language can be changed here too */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <LanguageMenu />
                </div>

                {status === 'loading' && <div className="av-card">{t('vault.loading')}</div>}

                {/* A new account, and guest profiles on this browser: whose are they? */}
                {status === 'none' && canClaim && (
                    <form className="av-card" onSubmit={handleClaim}>
                        <div className="av-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <ArrowRightLeft size={13} />
                            <span>{t('vault.guest.title')}</span>
                        </div>
                        {accountLine}
                        <div style={hint}>
                            {t('vault.guest.description')}
                            {claimNeedsPassphrase && <><br />{t('vault.guest.passphraseNote')}</>}
                        </div>
                        {claimNeedsPassphrase && (
                            <input className="av-input" type="password" autoFocus placeholder={t('vault.guest.placeholder')}
                                value={passphrase} onChange={(e) => setPassphrase(e.target.value)} style={{ marginBottom: 8 }} />
                        )}
                        {error && <div style={{ fontSize: 11, color: 'var(--av-error)', marginBottom: 6 }}>{error}</div>}
                        <button type="submit" className="av-save-btn" disabled={isWorking || (claimNeedsPassphrase && !passphrase)}>
                            <KeyRound size={12} />
                            <span>{isWorking ? t('vault.guest.working') : t('vault.guest.use')}</span>
                        </button>
                        <button type="button" className="av-save-btn" onClick={startFresh} disabled={isWorking}
                            style={{ marginTop: 8, background: 'transparent', border: '1px solid var(--av-border)', color: 'var(--av-text)' }}>
                            <Sparkles size={12} />
                            <span>{t('vault.guest.fresh')}</span>
                        </button>
                        <div style={{ ...hint, marginTop: 8, marginBottom: 0 }}>{t('vault.guest.freshNote')}</div>
                    </form>
                )}

                {status === 'none' && !canClaim && error && <div className="av-card" style={{ color: 'var(--av-error)' }}>{error}</div>}

                {/* An old vault made with a passphrase: once more, then never again */}
                {status === 'locked' && (
                    <form className="av-card" onSubmit={handleUnlock}>
                        <div className="av-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Lock size={13} />
                            <span>{t('vault.upgrade.title')}</span>
                        </div>
                        {accountLine}
                        <div style={hint}>{t('vault.upgrade.description')}</div>
                        <input className="av-input" type="password" autoFocus placeholder={t('vault.upgrade.placeholder')}
                            value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                        {error && <div style={{ fontSize: 11, color: 'var(--av-error)', marginTop: 6 }}>{error}</div>}
                        <button type="submit" className="av-save-btn" disabled={isWorking || !passphrase} style={{ marginTop: 10 }}>
                            <KeyRound size={12} />
                            <span>{isWorking ? t('vault.upgrade.working') : t('vault.upgrade.submit')}</span>
                        </button>
                        <button type="button" onClick={handleReset}
                            style={{ marginTop: 10, background: 'none', border: 'none', color: 'var(--av-text-muted)', fontSize: 10, cursor: 'pointer', textDecoration: 'underline' }}>
                            {t('vault.upgrade.forgot')}
                        </button>
                    </form>
                )}
            </main>
        </div>
    );
}
