// Static Configuration Data for Aullevo profiles
import {
    Briefcase,
    HeartPulse,
    Landmark,
    ClipboardList,
    GraduationCap,
    CreditCard,
    Sliders,
    type LucideIcon
} from 'lucide-react';
import type { ProfileType } from '../types';

export interface ProfileOption {
    type: ProfileType;
    label: string;
    icon: LucideIcon;
}

export const PROFILE_OPTIONS: ProfileOption[] = [
    { type: 'job', label: 'Job', icon: Briefcase },
    { type: 'medical', label: 'Medical', icon: HeartPulse },
    { type: 'government', label: 'Government', icon: Landmark },
    { type: 'survey', label: 'Survey', icon: ClipboardList },
    { type: 'academic', label: 'Academic', icon: GraduationCap },
    { type: 'financial', label: 'Financial', icon: CreditCard },
    { type: 'custom', label: 'Custom', icon: Sliders }
];
