// pagination.ts - Auto-pagination (Pro) protocol shared by background.ts, the side panel and content.ts.
// content.ts may only `import type` from here (it is a classic script, see content.ts header).

export const AUTO_PAGINATE_STORAGE_KEY = 'aullevo_auto_paginate';

// Safety limit: a run never clicks Next more than this many times
export const AUTO_PAGINATE_MAX_PAGES = 12;

// Free: auto-pagination needs the 4-hour ad unlock (rewards.ts); the side panel shows its own translated text for this
export const AUTO_PAGINATE_PRO_MESSAGE = 'Auto-pagination: watch a 1-minute ad to use it for 4 hours, or upgrade to Pro.';

export type PaginationStepStatus =
    | 'advanced'          // clicked Next / Continue and the page changed
    | 'submitted'         // clicked Submit on the last page
    | 'no-next'           // no Next and no Submit button (single-page form)
    | 'blocked'           // a field marked required is empty
    | 'next-disabled'     // Next / Submit button exists but is disabled
    | 'validation-error'  // clicked Next and the form showed an error
    | 'stuck'             // clicked Next and nothing changed
    | 'max-pages'         // safety limit reached
    | 'stopped'           // the user said "stop" (voice agent)
    | 'error';

export interface PaginationBlocker {
    name: string;
    reason: string;
}

// content.ts → background.ts (one page)
export interface PaginationStepResult {
    success: boolean;
    matchedCount?: number;
    repaired?: number;      // answers corrected after the form rejected them
    useAi?: boolean;
    aiNotice?: string;
    error?: string;
    pagination: {
        status: PaginationStepStatus;
        blockers?: PaginationBlocker[];
        buttonLabel?: string;
        errorText?: string;
        serverStatus?: number;  // 'stuck': the page's own request after the click failed with this HTTP status
    };
}

// background.ts → side panel (whole run)
export interface PaginationRunResult {
    success: boolean;
    status: PaginationStepStatus | 'no-form';
    pages: number;
    totalFilled: number;
    repaired?: number;
    useAi?: boolean;
    aiNotice?: string;
    blockers?: PaginationBlocker[];
    buttonLabel?: string;
    errorText?: string;
    serverStatus?: number;
    error?: string;
}
