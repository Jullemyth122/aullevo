import { useEffect, useState } from 'react';
import { useT } from '../../i18n';

const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

// Chrome only assigns a suggested shortcut if no other extension (or Chrome itself) already uses it
export function ShortcutStatus() {
    const { t } = useT();
    const [unassigned, setUnassigned] = useState<chrome.commands.Command[] | null>(null);

    useEffect(() => {
        chrome.commands?.getAll?.().then((commands) => {
            setUnassigned(commands.filter(c => !c.shortcut));
        }).catch(() => setUnassigned(null));
    }, []);

    // Named at render time so the fallback names follow the current language
    const commandName = (c: chrome.commands.Command) =>
        c.description || (c.name === '_execute_action' ? t('tour.shortcuts.toggleSidePanel') : c.name || t('tour.shortcuts.fallbackName'));

    return (
        <>
            {unassigned && unassigned.length === 0 && (
                <p className="av-tour__note av-tour__note--ok">{t('tour.shortcuts.allActive')}</p>
            )}
            {unassigned && unassigned.length > 0 && (
                <p className="av-tour__note av-tour__note--warn">
                    {t('tour.shortcuts.notSet', { list: unassigned.map(commandName).join(', ') })}
                </p>
            )}
            <button
                type="button"
                className="av-tour__link"
                onClick={() => chrome.tabs?.create({ url: SHORTCUTS_URL })}
            >
                {t('tour.shortcuts.openSettings')}
            </button>
        </>
    );
}
