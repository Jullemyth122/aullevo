import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

// The guided tour opens the card it points at (GuidedTour.tsx): its text explains what's inside
export const TOUR_FOCUS_EVENT = 'aullevo:tour-focus';

// Which sections the user left open or closed, kept for the next time the panel opens (this browser only)
const STORAGE_KEY = 'aullevo_open_sections';

function readOpenSections(): Record<string, boolean> {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        return saved && typeof saved === 'object' ? saved : {};
    } catch {
        return {};
    }
}

function saveOpenSection(id: string, open: boolean): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readOpenSections(), [id]: open }));
    } catch { /* storage blocked: the section just opens as it did before */ }
}

interface CollapsibleCardProps {
    id: string;              // remembers this section's open / closed state
    title: ReactNode;
    badge?: ReactNode;       // shown in the header whether open or closed (e.g. FREE / PRO)
    summary?: ReactNode;     // shown in the header while closed (e.g. the current setting)
    defaultOpen?: boolean;
    tour?: string;           // data-tour target of the guided tour
    className?: string;
    style?: CSSProperties;
    children: ReactNode;
}

/** A Settings card that folds to its title row; the header is one button (keyboard and screen readers). */
export function CollapsibleCard({ id, title, badge, summary, defaultOpen = true, tour, className = 'av-card', style, children }: CollapsibleCardProps) {
    const [open, setOpen] = useState(() => readOpenSections()[id] ?? defaultOpen);
    const bodyId = useId();

    useEffect(() => {
        if (!tour) return;
        const onTourFocus = (event: Event) => {
            if ((event as CustomEvent<string>).detail === tour) setOpen(true);
        };
        window.addEventListener(TOUR_FOCUS_EVENT, onTourFocus);
        return () => window.removeEventListener(TOUR_FOCUS_EVENT, onTourFocus);
    }, [tour]);

    const toggle = () => {
        const next = !open;
        setOpen(next);
        saveOpenSection(id, next);
    };

    return (
        <div className={className} style={style} data-tour={tour}>
            <button type="button" className="av-collapse__head" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
                <span className="av-collapse__title">{title}</span>
                {!open && summary && <span className="av-collapse__summary">{summary}</span>}
                {badge}
                <ChevronDown size={14} className={`av-collapse__chevron ${open ? '' : 'av-collapse__chevron--closed'}`} aria-hidden="true" />
            </button>
            {open && <div id={bodyId} className="av-collapse__body">{children}</div>}
        </div>
    );
}
