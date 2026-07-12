
export const LogoA = ({ size = 20 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
        <defs>
            <linearGradient id="av-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FFE066" />
                <stop offset="100%" stopColor="#f0bc30" />
            </linearGradient>
        </defs>
        <path d="M3 20L12 4L21 20" stroke="url(#av-logo-grad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M8 14H16" stroke="url(#av-logo-grad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="12" cy="9" r="1.5" fill="url(#av-logo-grad)" />
    </svg>
);
