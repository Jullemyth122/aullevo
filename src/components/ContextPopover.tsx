import { Sparkles, X } from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface ContextPopoverProps {
    label: string;
    context?: string;
    onChange: (newContext: string) => void;
    alignRight?: boolean;
    disabled?: boolean;
}


export const ContextPopover = ({
    label,
    context = '',
    onChange,
    alignRight = false,
    disabled = false
}: ContextPopoverProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const popoverRef = useRef<HTMLDivElement>(null);
    // Close when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);
    return (
        <div className="av-context-wrap" ref={popoverRef}>
            {/* The Trigger Icon Button */}
            <button
                type="button"
                className={`av-context-btn ${context ? 'av-context-btn--has-value' : ''} ${isOpen ? 'av-context-btn--active' : ''} ${disabled ? 'disabled' : ''}`}
                onClick={() => setIsOpen((prev) => !prev)}
                title={`AI Context for ${label}`}
                disabled={disabled}
            >
                <Sparkles size={10} />
                {context && <span className="av-context-btn__dot" />}
            </button>
            {/* The Floating Popup */}
            {isOpen && (
                <div className={`av-context-popover ${alignRight ? 'av-context-popover--right' : ''}`}>
                    <div className="av-context-popover__header">
                        <div className="av-context-popover__title">
                            <Sparkles size={11} />
                            <span>AI Context: {label}</span>
                        </div>
                        <button
                            type="button"
                            className="av-context-popover__close"
                            onClick={() => setIsOpen(false)}
                        >
                            <X size={10} />
                        </button>
                    </div>
                    <textarea
                        className="av-context-popover__textarea"
                        rows={2}
                        placeholder="Context clue for AI (e.g. 'Legal first name on passport')"
                        value={context}
                        onChange={(e) => onChange(e.target.value)}
                        autoFocus
                    />
                    <span className="av-context-popover__hint">
                        AI uses this prompt to identify ambiguous website form fields.
                    </span>
                </div>
            )}
        </div>
    );
};