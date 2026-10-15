import type { CSSProperties } from 'react';
import { ORB_THEMES } from './themes';
import { useOrbTheme } from './theme';
import styles from './ThemePicker.module.scss';

/** One row of colour dots (the orb's palette popover). */
export function ThemePicker() {
    const { theme, setTheme } = useOrbTheme();
    return (
        <div className={styles.picker} data-compact="true">
            <div className={styles.options} role="group" aria-label="Orb colour theme">
                {ORB_THEMES.map(option => (
                    <button key={option.id} type="button" className={styles.option}
                        style={{ '--swatch-primary': option.accent, '--swatch-secondary': option.base } as CSSProperties}
                        aria-label={`${option.name}: ${option.pair}`} title={`${option.name} · ${option.pair}`}
                        aria-pressed={theme.id === option.id} onClick={() => setTheme(option)}>
                        <span className={styles.swatch} aria-hidden="true" />
                        {theme.id === option.id && <span className={styles.compactName}>{option.name}</span>}
                    </button>
                ))}
            </div>
        </div>
    );
}
