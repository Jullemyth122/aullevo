import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ActiveTab } from '../layout/NavTabs';
import { useT } from '../../i18n';
import { TOUR_FOCUS_EVENT } from '../CollapsibleCard';

export interface TourStep {
    target: string;   // matches a data-tour="..." attribute
    title: string;
    body: ReactNode;
    section: string;  // shown above the title, e.g. "Profiles · 3 of 10"
    tab?: ActiveTab;  // tab the element lives on; none = header, shown on any tab
}

interface GuidedTourProps {
    steps: TourStep[];
    activeTab: ActiveTab;
    onSelectTab: (tab: ActiveTab) => void;
    onFinish: () => void;   // called on Done and on Skip
    onDismiss?: () => void; // shows "Don't show again" (for tours that repeat)
}

const PAD = 6;           // space between the element and the spotlight edge
const GAP = 14;          // space between the spotlight and the card
const EDGE = 12;         // min distance from the card to the viewport edge
const MAX_CARD_W = 300;
const MIN_ROOM = 170;    // less room than this beside a tall element: card sits at the bottom of the screen

interface Box { x: number; y: number; w: number; h: number; vw: number; vh: number; }

const findTarget = (target: string | undefined) =>
    target ? document.querySelector<HTMLElement>(`[data-tour="${target}"]`) : null;

// Full-viewport rectangle with a rounded hole; evenodd leaves the hole unblurred
function spotlightPath({ x, y, w, h, vw, vh }: Box): string {
    const r = Math.min(10, w / 2, h / 2);
    return `path(evenodd, "M0 0H${vw}V${vh}H0Z ` +
        `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}` +
        `V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` +
        `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
        `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z")`;
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/**
 * Step-by-step spotlight: blurs the panel, cuts a hole around one element,
 * and points a card at it. Switches to each step's tab first; steps whose element isn't on screen are skipped.
 */
export function GuidedTour({ steps, activeTab, onSelectTab, onFinish, onDismiss }: GuidedTourProps) {
    const { t } = useT();
    const [index, setIndex] = useState(0);
    const [box, setBox] = useState<Box | null>(null);
    const directionRef = useRef<1 | -1>(1);
    const nextBtnRef = useRef<HTMLButtonElement>(null);
    const onFinishRef = useRef(onFinish);
    const onSelectTabRef = useRef(onSelectTab);
    useLayoutEffect(() => {
        onFinishRef.current = onFinish;
        onSelectTabRef.current = onSelectTab;
    });

    const step = steps[index];
    const isLast = index === steps.length - 1;
    const target = step?.target;
    const stepTab = step?.tab;

    const go = (delta: 1 | -1) => {
        directionRef.current = delta;
        if (index + delta >= steps.length) onFinish();
        else setIndex(clamp(index + delta, 0, steps.length - 1));
    };

    useLayoutEffect(() => {
        if (stepTab && stepTab !== activeTab) {
            onSelectTabRef.current(stepTab); // runs again once the tab has rendered
            return;
        }
        const el = findTarget(target);
        if (!el) {
            // Element not rendered (e.g. full-page button in page layout): keep moving the same way
            const next = index + directionRef.current;
            if (next < 0 || next >= steps.length) onFinishRef.current();
            else setIndex(next);
            return;
        }

        // A folded Settings card opens, so the text about what's inside it matches the screen
        window.dispatchEvent(new CustomEvent(TOUR_FOCUS_EVENT, { detail: target }));

        // Re-measured every frame (cheap) so the spotlight follows scrolling, resizing,
        // and layout shifts like the status banner appearing; state only changes on movement
        let frame = 0;
        const measure = () => {
            const r = el.getBoundingClientRect();
            const next: Box = {
                x: r.left - PAD,
                y: r.top - PAD,
                w: r.width + PAD * 2,
                h: r.height + PAD * 2,
                vw: window.innerWidth,
                vh: window.innerHeight
            };
            setBox(prev => prev && (Object.keys(next) as (keyof Box)[]).every(k => prev[k] === next[k]) ? prev : next);
            frame = requestAnimationFrame(measure);
        };
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        measure();
        return () => cancelAnimationFrame(frame);
    }, [index, target, stepTab, activeTab, steps.length]);

    useEffect(() => {
        nextBtnRef.current?.focus();
    }, [index]);

    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onFinish();
            else if (e.key === 'ArrowRight') go(1);
            else if (e.key === 'ArrowLeft' && index > 0) go(-1);
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    });

    if (!step || !box) return null;

    const sectionSteps = steps.filter(s => s.section === step.section);
    const sectionIndex = sectionSteps.indexOf(step);

    // Card goes on whichever side of the spotlight has more room
    const spaceBelow = box.vh - (box.y + box.h);
    const placeBelow = spaceBelow >= box.y;
    const room = (placeBelow ? spaceBelow : box.y) - GAP - EDGE;
    const placement = room < MIN_ROOM ? 'pinned' : placeBelow ? 'below' : 'above';
    const cardW = Math.min(MAX_CARD_W, box.vw - EDGE * 2);
    const centerX = box.x + box.w / 2;
    const cardLeft = clamp(centerX - cardW / 2, EDGE, box.vw - cardW - EDGE);
    const arrowLeft = clamp(centerX - cardLeft, 18, cardW - 18);
    const position =
        placement === 'below' ? { top: box.y + box.h + GAP } :
        placement === 'above' ? { bottom: box.vh - box.y + GAP } :
        { bottom: EDGE };

    return (
        <div className="av-tour" role="dialog" aria-modal="true" aria-labelledby="av-tour-title">
            <div className="av-tour__scrim" style={{ clipPath: spotlightPath(box) }} />
            <div
                className="av-tour__ring"
                style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            />

            <div
                key={index}
                className={`av-tour__card av-tour__card--${placement}`}
                style={{ left: cardLeft, width: cardW, ...position }}
            >
                {placement !== 'pinned' && <span className="av-tour__arrow" style={{ left: arrowLeft }} />}
                <div
                    className="av-tour__content"
                    style={{ maxHeight: placement === 'pinned' ? box.vh * 0.45 : room }}
                >
                    <div className="av-tour__progress" aria-hidden="true">
                        <div className="av-tour__progress-fill" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
                    </div>
                    <div className="av-tour__step">
                        {t('tour.card.progress', { section: step.section, current: sectionIndex + 1, total: sectionSteps.length })}
                    </div>
                    <div className="av-tour__title" id="av-tour-title">{step.title}</div>
                    <div className="av-tour__body">{step.body}</div>
                </div>
                <div className="av-tour__footer">
                    <div className="av-tour__skips">
                        <button type="button" className="av-tour__skip" onClick={onFinish}>
                            {t('tour.card.skip')}
                        </button>
                        {onDismiss && (
                            <button type="button" className="av-tour__skip" onClick={onDismiss}>
                                {t('tour.card.dontShowAgain')}
                            </button>
                        )}
                    </div>
                    <div className="av-tour__nav">
                        {index > 0 && (
                            <button type="button" className="av-tour__btn" onClick={() => go(-1)}>
                                {t('tour.card.back')}
                            </button>
                        )}
                        <button
                            type="button"
                            ref={nextBtnRef}
                            className="av-tour__btn av-tour__btn--primary"
                            onClick={() => go(1)}
                        >
                            {isLast ? t('tour.card.done') : t('tour.card.next')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
