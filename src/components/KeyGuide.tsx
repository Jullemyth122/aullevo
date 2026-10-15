import { useState, type ReactNode } from 'react';
import { ChevronDown, ExternalLink, HelpCircle } from 'lucide-react';

interface KeyGuideProps {
    toggleLabel: string;
    note?: ReactNode;
    steps: ReactNode[];
    link?: { url: string; label: string };
    /** Open at first (e.g. while no key is saved yet) */
    defaultOpen?: boolean;
}

/** "How do I get a key?": numbered steps and a button to the provider's page, for people new to API keys. */
export function KeyGuide({ toggleLabel, note, steps, link, defaultOpen = false }: KeyGuideProps) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div style={{ marginTop: 6, border: '1px solid var(--av-border)', borderRadius: 8, background: 'var(--av-surface-alt, rgba(15, 23, 42, 0.4))' }}>
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', background: 'transparent',
                    border: 'none', color: 'var(--av-text)', fontSize: 11, fontWeight: 600, cursor: 'pointer', textAlign: 'left'
                }}
            >
                <HelpCircle size={12} color="var(--av-accent, #6366f1)" />
                <span style={{ flex: 1 }}>{toggleLabel}</span>
                <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>
            {open && (
                <div style={{ padding: '0 10px 10px', fontSize: 10.5, lineHeight: 1.5, color: 'var(--av-text-muted)' }}>
                    {note && <div style={{ marginBottom: 6, color: 'var(--av-text)' }}>{note}</div>}
                    <ol style={{ margin: 0, paddingLeft: 16, display: 'grid', gap: 3 }}>
                        {steps.map((step, i) => <li key={i}>{step}</li>)}
                    </ol>
                    {link && (
                        <a
                            href={link.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                                marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6,
                                background: 'var(--av-accent, #6366f1)', color: '#fff', fontWeight: 700, fontSize: 10.5, textDecoration: 'none'
                            }}
                        >
                            <span>{link.label}</span>
                            <ExternalLink size={10} />
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}
