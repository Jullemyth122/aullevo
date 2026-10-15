import { useEffect } from 'react';
import { Undo2 } from 'lucide-react';
import { useT, tEnglish, undoLanguageChange, dismissLanguageChange } from '../../i18n';
import { DEFAULT_LANGUAGE, getLanguage, resolveLanguage } from '../../i18n/languages';

const AUTO_HIDE_MS = 20000;

// Shown right after the language changes, in the new language AND in English,
// with one click back to the previous language in case it was picked by mistake.
export function LanguageChangedBar() {
    const { t, language, lastChange } = useT();

    useEffect(() => {
        if (!lastChange) return;
        const timer = window.setTimeout(dismissLanguageChange, AUTO_HIDE_MS);
        return () => clearTimeout(timer);
    }, [lastChange]);

    if (!lastChange) return null;

    const to = getLanguage(language);
    const from = getLanguage(resolveLanguage(lastChange.from));
    const isEnglish = language === DEFAULT_LANGUAGE;

    return (
        <div className="av-lang-bar" role="status">
            <div className="av-lang-bar__text">
                <div>{t('language.changed', { name: to?.native ?? language })}</div>
                {!isEnglish && (
                    <div className="av-lang-bar__english" lang="en" dir="ltr">
                        {tEnglish('language.changed', { name: to?.english ?? language })}
                    </div>
                )}
            </div>
            <div className="av-lang-bar__actions">
                <button type="button" className="av-lang-bar__undo" onClick={undoLanguageChange}>
                    <Undo2 size={12} />
                    <span>
                        {t('language.switchBack', { name: from?.native ?? 'English' })}
                        {!isEnglish && <span className="av-lang-bar__english" lang="en"> · {tEnglish('language.switchBack', { name: from?.english ?? 'English' })}</span>}
                    </span>
                </button>
                <button type="button" className="av-lang-bar__keep" onClick={dismissLanguageChange}>
                    {t('language.keep')}
                </button>
            </div>
        </div>
    );
}
