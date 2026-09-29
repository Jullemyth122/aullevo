import { CheckCircle2 } from 'lucide-react';

export function Footer() {
    return (
        <footer className="av-panel__footer">
            <span className="av-panel__footer-text">Aullevo Autofill Engine</span>
            <span className="av-panel__footer-text" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={10} color="var(--av-success)" />
                <span>Ready</span>
            </span>
        </footer>
    );
}
