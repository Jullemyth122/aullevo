import { ChevronDown } from 'lucide-react';

interface SectionHeaderProps {
    label: string;
    sectionKey: string;
    isOpen: boolean;
    onToggle: (sectionKey: string) => void;
}

export const SectionHeader = ({ label, sectionKey, isOpen, onToggle }: SectionHeaderProps) => (
    <button className="av-section__toggle" onClick={() => onToggle(sectionKey)}>
        <span>{label}</span>
        <span className={`av-section__arrow ${isOpen ? 'av-section__arrow--open' : ''}`}>
            <ChevronDown size={12} />
        </span>
    </button>
);
