// runText.ts - What a finished fill says, shared by the side panel (its i18n t) and background.ts, which shows the
// same words on the page after a keyboard-shortcut or Multi-link fill (no panel to show them in).

import { AUTO_PAGINATE_MAX_PAGES, AUTO_PAGINATE_PRO_MESSAGE, type PaginationRunResult } from './pagination';

export type Translate = (key: string, vars?: Record<string, string | number>) => string;
export type RunTone = 'success' | 'info' | 'error';

// A security check ("I'm not a robot") the user has to complete; content.ts reports it as a blocker
export const VERIFICATION_BLOCKER = 'verification';

/** An auto-pagination run: how far it got, and why it stopped. */
export function describePaginationRun(r: PaginationRunResult, t: Translate): { text: string; type: RunTone } {
    const filledText = t('status.pagination.filled', { filled: r.totalFilled, count: r.pages });
    const filled = r.repaired
        ? `${filledText} ${t('status.pagination.corrected', { count: r.repaired })}`
        : filledText;
    const page = Math.max(r.pages, 1);
    const first = r.blockers?.[0];
    const moreCount = r.blockers && r.blockers.length > 1 ? r.blockers.length - 1 : 0;
    const fieldRef = (name: string) => moreCount
        ? t('status.pagination.fieldAndMore', { name, count: moreCount })
        : t('status.pagination.field', { name });

    // Empty fields that were left alone (no Next button) or that the site may be waiting for
    const leftEmpty = first ? ` ${t('status.pagination.stillEmpty', { field: fieldRef(first.name) })}` : '';
    const suspects = first ? ` ${t('status.pagination.check', { field: fieldRef(first.name) })}` : '';
    const button = r.buttonLabel || t('status.pagination.nextButton');

    switch (r.status) {
        case 'submitted':
            return { text: `${t('status.pagination.submitted')} ${filled}`, type: 'success' };
        case 'no-next':
            return { text: `${filled} ${t('status.pagination.noNext')}${leftEmpty}`, type: first ? 'info' : 'success' };
        case 'blocked': {
            if (first?.reason === VERIFICATION_BLOCKER) return { text: t('status.pagination.verification', { page }), type: 'error' };
            const field = fieldRef(first?.name || t('status.pagination.aField'));
            return { text: t('status.pagination.blocked', { page, field }), type: 'error' };
        }
        case 'next-disabled':
            return { text: t('status.pagination.nextDisabled', { page, button }), type: 'error' };
        case 'validation-error': {
            const reported = r.errorText
                ? t('status.pagination.validationError', { page, error: r.errorText })
                : t('status.pagination.validationErrorUnknown', { page });
            const tried = r.repaired ? ` ${t('status.pagination.correctionTried')}` : '';
            return { text: `${reported}${suspects}${tried}`, type: 'error' };
        }
        case 'stuck':
            // The site sent the answers and its server refused them, without saying so on the page
            if (r.serverStatus) return { text: t('status.pagination.serverError', { page, button, status: r.serverStatus }), type: 'error' };
            return { text: `${t('status.pagination.stuck', { page, button })}${suspects}`, type: 'error' };
        case 'max-pages':
            return { text: `${filled} ${t('status.pagination.maxPages', { max: AUTO_PAGINATE_MAX_PAGES })}`, type: 'info' };
        case 'no-form':
            return { text: t('status.pagination.noForm'), type: 'error' };
        default:
            // The background answers with the shared English constant when the plan is Free
            if (r.error === AUTO_PAGINATE_PRO_MESSAGE) return { text: t('rewards.status.paginateLocked'), type: 'error' };
            return { text: t('status.pagination.stopped', { error: r.error || t('status.pagination.unknownError') }), type: 'error' };
    }
}

/** A one-page fill (no auto-pagination). */
export function describeFill(
    res: { success?: boolean; matchedCount?: number; useAi?: boolean; aiNotice?: string; error?: string } | null | undefined,
    t: Translate
): { text: string; type: RunTone } {
    if (!res) return { text: t('status.fill.cannotConnect'), type: 'error' };
    if (!res.success) return { text: t('status.fill.error', { error: String(res.error || t('status.pagination.unknownError')) }), type: 'error' };
    const count = res.matchedCount ?? 0;
    if (res.aiNotice) {
        const filled = res.useAi ? t('status.fill.aiPartlySkipped', { count }) : t('status.fill.keywordMode', { count });
        return { text: `${filled} ${res.aiNotice}`, type: 'error' };
    }
    return { text: res.useAi ? t('status.fill.withAi', { count }) : t('status.fill.withoutAi', { count }), type: 'success' };
}
