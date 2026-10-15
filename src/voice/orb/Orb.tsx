// The agent's face: the HUD orb (ported from Autonoma), a presence tag and one line of status.
import { Suspense, lazy, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Palette, Volume2, VolumeX } from 'lucide-react';
import type { OrbPointer, OrbState, OrbTone } from './parts';
import { useOrbTheme } from './theme';
import { ThemePicker } from './ThemePicker';
import { ErrorBoundary } from './ErrorBoundary';
import styles from './Orb.module.scss';

// three.js loads on demand, so the panel's controls appear first
const OrbCanvas = lazy(() => import('./OrbCanvas'));

const LABELS: Record<OrbState, string> = {
    idle: 'Ready',
    transcribing: 'Processing',
    thinking: 'Working',
    speaking: 'Speaking',
    listening: 'Listening',
};

interface OrbProps {
    state: OrbState;
    tone?: OrbTone;
    caption: string;
    disabled?: boolean;
    muted: boolean;
    onToggleMute: () => void;
    onActivate: () => void;
    extra?: ReactNode; // bottom-left buttons (the microphone)
}

/** Clicking the orb runs `onActivate` (autofill, or stop the agent talking). */
export function Orb({ state, tone = 'cyan', caption, disabled, muted, onToggleMute, onActivate, extra }: OrbProps) {
    const levelRef = useRef(0);
    const pointerRef = useRef<OrbPointer>({ x: 0, y: 0, hover: 0 });
    const [paletteOpen, setPaletteOpen] = useState(false);
    const { theme } = useOrbTheme();

    function track(event: PointerEvent<HTMLButtonElement>) {
        const box = event.currentTarget.getBoundingClientRect();
        pointerRef.current = { x: ((event.clientX - box.left) / box.width) * 2 - 1, y: ((event.clientY - box.top) / box.height) * 2 - 1, hover: 1 };
    }

    return (
        <section className={styles.stage} data-tone={tone} aria-label="Aullevo voice agent">
            <div className={styles.top}>
                <span className={styles.eyebrow}>AULLEVO / AGENT</span>
                <span className={styles.topRight}>
                    <span className={styles.presence} data-state={state}><i />{LABELS[state]}</span>
                    <button className={styles.paletteButton} title={`Orb theme: ${theme.name}`} aria-label="Change orb theme" aria-expanded={paletteOpen} onClick={() => setPaletteOpen(open => !open)}>
                        <Palette size={13} />
                    </button>
                </span>
            </div>
            {paletteOpen && <div className={styles.palette}><ThemePicker /></div>}
            <button className={styles.orb} disabled={disabled} title={disabled ? caption : 'Autofill this page'} aria-label="Autofill this page"
                onClick={onActivate} onPointerMove={track} onPointerLeave={() => { pointerRef.current = { x: 0, y: 0, hover: 0 }; }}>
                {/* If the GPU drops the 3D view, show the flat orb and try again in 10 s instead of blanking the panel */}
                <ErrorBoundary fallback={() => <span className={styles.backup} />} retryAfterMs={10000}>
                    <Suspense fallback={<span className={styles.backup} />}>
                        <OrbCanvas state={state} theme={theme} levelRef={levelRef} pointerRef={pointerRef} />
                    </Suspense>
                </ErrorBoundary>
            </button>
            <div className={styles.status}>
                <p className={styles.caption} aria-live="polite">{caption}</p>
                {extra && <div className={styles.extra}>{extra}</div>}
                <button className={styles.sound} title={muted ? 'Sound off' : 'Sound on'} aria-label={muted ? 'Turn the agent voice on' : 'Mute the agent voice'} aria-pressed={!muted} onClick={onToggleMute}>
                    {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
            </div>
        </section>
    );
}
