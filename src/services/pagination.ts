// pagination.ts - Auto-pagination (Pro) protocol shared by background.ts, the side panel and content.ts.
// content.ts may only `import type` from here (it is a classic script, see content.ts header).

export const AUTO_PAGINATE_STORAGE_KEY = 'aullevo_auto_paginate';

// Safety limit: a run never clicks Next more than this many times
export const AUTO_PAGINATE_MAX_PAGES = 12;

export const AUTO_PAGINATE_PRO_MESSAGE = 'Auto-pagination is a Pro feature. Upgrade to Pro to fill multi-page forms.';

export type PaginationStepStatus =
    | 'advanced'          // clicked Next / Continue and the page changed
    | 'submitted'         // clicked Submit on the last page
    | 'no-next'           // no Next and no Submit button (single-page form)
    | 'blocked'           // a field marked required is empty
    | 'next-disabled'     // Next / Submit button exists but is disabled
    | 'validation-error'  // clicked Next and the form showed an error
    | 'stuck'             // clicked Next and nothing changed
    | 'max-pages'         // safety limit reached
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
    error?: string;
}

export function describePaginationResult(r: PaginationRunResult): { text: string; type: 'success' | 'info' | 'error' } {
    const fixedNote = r.repaired ? ` Corrected ${r.repaired} answer${r.repaired === 1 ? '' : 's'} the form rejected.` : '';
    const filled = `Filled ${r.totalFilled} inputs across ${r.pages} page${r.pages === 1 ? '' : 's'}.${fixedNote}`;
    const page = `Paused on page ${Math.max(r.pages, 1)}`;
    const first = r.blockers?.[0];
    const more = r.blockers && r.blockers.length > 1 ? ` (+${r.blockers.length - 1} more)` : '';

    // Empty fields that were left alone (no Next button) or that the site may be waiting for
    const leftEmpty = first ? ` "${first.name}" is still empty${more}.` : '';
    const suspects = first ? ` Check "${first.name}"${more}.` : '';

    switch (r.status) {
        case 'submitted':
            return { text: `Submitted! ${filled}`, type: 'success' };
        case 'no-next':
            return { text: `${filled} No Next / Continue button found.${leftEmpty}`, type: first ? 'info' : 'success' };
        case 'blocked':
            return { text: `${page}: "${first?.name || 'a field'}" is required and empty${more}. Fill it, then run again.`, type: 'error' };
        case 'next-disabled':
            return { text: `${page}: the "${r.buttonLabel || 'Next'}" button is disabled. Check the page, then run again.`, type: 'error' };
        case 'validation-error':
            return { text: `${page}: the form reported "${r.errorText || 'an error'}".${suspects}${r.repaired ? ' (automatic correction was tried)' : ''}`, type: 'error' };
        case 'stuck':
            return { text: `${page}: clicked "${r.buttonLabel || 'Next'}" but the form didn't move on.${suspects}`, type: 'error' };
        case 'max-pages':
            return { text: `${filled} Stopped at the ${AUTO_PAGINATE_MAX_PAGES}-page safety limit.`, type: 'info' };
        case 'no-form':
            return { text: r.error || 'No form found on this page.', type: 'error' };
        default:
            return { text: `Auto-pagination stopped: ${r.error || 'unknown error'}`, type: 'error' };
    }
}
