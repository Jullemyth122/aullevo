import { useState, useEffect, useCallback } from 'react';
import { ACCOUNT_STORAGE_KEY, getStoredAccount, isProActive, type AccountInfo } from '../services/tier';
import { AULLEVO_WEB_LOGIN_URL, clearAccount } from '../services/account';

export function useAccount() {
    const [account, setAccount] = useState<AccountInfo | null>(null);
    const [isConnecting, setIsConnecting] = useState<boolean>(false);

    useEffect(() => {
        let isMounted = true;
        getStoredAccount().then((acc) => {
            if (isMounted) setAccount(acc);
        });

        // background.ts writes the account after verifying the website's token
        const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
            if (area === 'local' && changes[ACCOUNT_STORAGE_KEY]) {
                setAccount((changes[ACCOUNT_STORAGE_KEY].newValue as AccountInfo | undefined) ?? null);
                setIsConnecting(false);
            }
        };
        chrome.storage?.onChanged?.addListener(handleStorageChange);

        return () => {
            isMounted = false;
            chrome.storage?.onChanged?.removeListener(handleStorageChange);
        };
    }, []);

    // Sign-in happens on aullevo-web; the extension picks it up automatically
    const connect = useCallback(() => {
        setIsConnecting(true);
        chrome.tabs.create({ url: AULLEVO_WEB_LOGIN_URL });
    }, []);

    const disconnect = useCallback(async () => {
        await clearAccount();
        setAccount(null);
    }, []);

    return {
        account,
        isPro: isProActive(account),
        isConnecting,
        connect,
        disconnect
    };
}
