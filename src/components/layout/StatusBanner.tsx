import { CheckCircle2, AlertCircle, Zap } from 'lucide-react';

interface StatusBannerProps {
    message: { text: string; type: 'info' | 'success' | 'error' } | null;
}

export function StatusBanner({ message }: StatusBannerProps) {
    if (!message) return null;

    return (
        <div className={`av-status av-status--${message.type}`}>
            {message.type === 'success' && <CheckCircle2 size={13} />}
            {message.type === 'error' && <AlertCircle size={13} />}
            {message.type === 'info' && <Zap size={13} />}
            <span>{message.text}</span>
        </div>
    );
}
