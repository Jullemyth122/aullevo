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
import { t } from '../i18n';

export interface ProfileOption {
    type: ProfileType;
    // Called at render time so the name follows the current UI language
    label: () => string;
    icon: LucideIcon;
}

export const PROFILE_OPTIONS: ProfileOption[] = [
    { type: 'job', label: () => t('profiles.types.job'), icon: Briefcase },
    { type: 'medical', label: () => t('profiles.types.medical'), icon: HeartPulse },
    { type: 'government', label: () => t('profiles.types.government'), icon: Landmark },
    { type: 'survey', label: () => t('profiles.types.survey'), icon: ClipboardList },
    { type: 'academic', label: () => t('profiles.types.academic'), icon: GraduationCap },
    { type: 'financial', label: () => t('profiles.types.financial'), icon: CreditCard },
    { type: 'custom', label: () => t('profiles.types.custom'), icon: Sliders }
];
