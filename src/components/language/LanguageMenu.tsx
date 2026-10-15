import { useEffect, useRef, useState } from 'react';
import { Globe, Check } from 'lucide-react';
import { useT, setLanguagePreference } from '../../i18n';
import { LANGUAGES, AUTO_LANGUAGE, DEFAULT_LANGUAGE, getLanguage, getBrowserLanguage } from '../../i18n/languages';

// Globe button in the header (and on the passphrase screen): every language is listed by its own name
// AND its English name, and English is always pinned at the top, so a wrong pick is easy to undo.
export function LanguageMenu() {
    const { t, language, preference } = useT();
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        const handleClick = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setIsOpen(false);
        };
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKey);
        };
    }, [isOpen]);

    const current = getLanguage(language);
    const browser = getLanguage(getBrowserLanguage());
    const q = query.trim().toLowerCase();
    const matches = LANGUAGES.filter(l => l.code !== DEFAULT_LANGUAGE && (!q ||
        l.native.toLowerCase().includes(q) || l.english.toLowerCase().includes(q) || l.code.toLowerCase().includes(q)));
    const showPinned = !q || 'english'.includes(q);

    const choose = (next: string) => {
        setIsOpen(false);
        setQuery('');
        setLanguagePreference(next);
    };

    return (
        <div className="av-lang" ref={rootRef}>
            <button
                type="button"
                className="av-panel__icon-btn av-lang__trigger"
                onClick={() => setIsOpen(!isOpen)}
                title={`${t('language.button', { name: current?.native ?? language })}${language !== DEFAULT_LANGUAGE ? ` · Language: ${current?.english}` : ''}`}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                data-tour="language"
            >
                <Globe size={15} />
                <span className="av-lang__code">{language.split('-')[0].toUpperCase()}</span>
            </button>

            {isOpen && (
                <div className="av-lang__menu" role="listbox">
                    <input
                        className="av-input av-lang__search"
                        autoFocus
                        placeholder={language === DEFAULT_LANGUAGE ? t('language.search') : `${t('language.search')} · Search`}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />

                    <div className="av-lang__list">
                        {/* Always first and always in English: the way back */}
                        {showPinned && (
                            <button
                                type="button"
                                role="option"
                                aria-selected={preference === DEFAULT_LANGUAGE}
                                className={`av-lang__item av-lang__item--pinned ${preference === DEFAULT_LANGUAGE ? 'av-lang__item--active' : ''}`}
                                onClick={() => choose(DEFAULT_LANGUAGE)}
                                lang="en"
                            >
                                <span className="av-lang__names">
                                    <span className="av-lang__native">English</span>
                                    {language !== DEFAULT_LANGUAGE && <span className="av-lang__english">Back to English</span>}
                                </span>
                                {preference === DEFAULT_LANGUAGE && <Check size={12} />}
                            </button>
                        )}

                        {!q && (
                            <button
                                type="button"
                                role="option"
                                aria-selected={preference === AUTO_LANGUAGE}
                                className={`av-lang__item ${preference === AUTO_LANGUAGE ? 'av-lang__item--active' : ''}`}
                                onClick={() => choose(AUTO_LANGUAGE)}
                            >
                                <span className="av-lang__names">
                                    <span className="av-lang__native">{t('language.auto', { name: browser?.native ?? 'English' })}</span>
                                    <span className="av-lang__english">{t('language.autoHint')}</span>
                                </span>
                                {preference === AUTO_LANGUAGE && <Check size={12} />}
                            </button>
                        )}

                        <div className="av-lang__divider" />

                        {matches.map(l => (
                            <button
                                key={l.code}
                                type="button"
                                role="option"
                                aria-selected={preference === l.code}
                                className={`av-lang__item ${preference === l.code ? 'av-lang__item--active' : ''}`}
                                onClick={() => choose(l.code)}
                            >
                                <span className="av-lang__names">
                                    <span className="av-lang__native" lang={l.code} dir={l.rtl ? 'rtl' : 'ltr'}>{l.native}</span>
                                    {l.english !== l.native && <span className="av-lang__english" lang="en">{l.english}</span>}
                                </span>
                                {preference === l.code && <Check size={12} />}
                            </button>
                        ))}

                        {matches.length === 0 && !showPinned && (
                            <div className="av-lang__empty">{t('language.noResults')}</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
