import { CheckCircle2 } from 'lucide-react';
import { useT } from '../../i18n';

export function Footer() {
    const { t } = useT();
    return (
        <footer className="av-panel__footer">
            <span className="av-panel__footer-text">{t('header.footer.engine')}</span>
            <span className="av-panel__footer-text" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={10} color="var(--av-success)" />
                <span>{t('header.footer.ready')}</span>
            </span>
        </footer>
    );
}
