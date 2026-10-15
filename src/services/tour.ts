// tour.ts - Guided-tour progress on this device: whether the walkthrough was seen, and "Don't show again".
// A seen tour still repeats each time the panel opens while no profile has data yet (see App).

import type { UserData } from '../types';
import { getProfileCustomFields } from '../types';

export const TOUR_STORAGE_KEY = 'aullevo_tour_seen';
export const TOUR_DISMISSED_STORAGE_KEY = 'aullevo_tour_dismissed';

export interface TourState {
    seen: boolean;
    dismissed: boolean; // user chose "Don't show again"
}

export function getTourState(): Promise<TourState> {
    return new Promise((resolve) => {
        if (!chrome.storage?.local) return resolve({ seen: false, dismissed: false });
        chrome.storage.local.get([TOUR_STORAGE_KEY, TOUR_DISMISSED_STORAGE_KEY], (res) => {
            resolve({
                seen: res[TOUR_STORAGE_KEY] === true,
                dismissed: res[TOUR_DISMISSED_STORAGE_KEY] === true
            });
        });
    });
}

export function markTourSeen(): void {
    chrome.storage?.local?.set({ [TOUR_STORAGE_KEY]: true });
}

export function dismissTours(): void {
    chrome.storage?.local?.set({ [TOUR_DISMISSED_STORAGE_KEY]: true });
}

export async function resetTours(): Promise<void> {
    await chrome.storage?.local?.remove([TOUR_STORAGE_KEY, TOUR_DISMISSED_STORAGE_KEY]);
}

// True once any profile has a filled-in field or an uploaded document
export function hasProfileData(profiles: Record<string, UserData>): boolean {
    return Object.values(profiles).some(p =>
        (p.files?.length ?? 0) > 0 ||
        getProfileCustomFields(p).some(f => String(f.value ?? '').trim() !== '')
    );
}
