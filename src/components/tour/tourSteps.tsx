import type { TourStep } from './GuidedTour';
import type { ActiveTab } from '../layout/NavTabs';
import { ShortcutStatus } from './ShortcutStatus';
import { t, tRich } from '../../i18n';
import { FREE_JSON_IMPORTS_PER_DAY } from '../../services/importQuota';

type SectionStep = Omit<TourStep, 'section' | 'tab'>;

// Built on each call so the text follows the current language
const autofillSteps = (): SectionStep[] => [
    {
        target: 'detection',
        title: t('tour.autofill.detection.title'),
        body: <p>{t('tour.autofill.detection.body')}</p>
    },
    {
        target: 'highlight',
        title: t('tour.autofill.highlight.title'),
        body: <p>{t('tour.autofill.highlight.body')}</p>
    },
    {
        target: 'rescan',
        title: t('tour.autofill.rescan.title'),
        body: <p>{t('tour.autofill.rescan.body')}</p>
    },
    {
        target: 'fill',
        title: t('tour.autofill.fill.title'),
        body: <p>{t('tour.autofill.fill.body')}</p>
    },
    {
        target: 'active-profile',
        title: t('tour.autofill.activeProfile.title'),
        body: <p>{tRich('tour.autofill.activeProfile.body')}</p>
    },
    {
        target: 'shortcuts',
        title: t('tour.autofill.shortcuts.title'),
        body: (
            <>
                <p>{t('tour.autofill.shortcuts.body')}</p>
                <ShortcutStatus />
            </>
        )
    }
];

const headerSteps = (): SectionStep[] => [
    {
        target: 'voice-mode',
        title: t('tour.header.voice.title'),
        body: (
            <>
                <p>{t('tour.header.voice.body')}</p>
                <p className="av-tour__note">{t('tour.header.voice.note')}</p>
            </>
        )
    },
    {
        target: 'language',
        title: t('tour.header.language.title'),
        body: <p>{t('tour.header.language.body')}</p>
    },
    {
        target: 'theme',
        title: t('tour.header.theme.title'),
        body: <p>{t('tour.header.theme.body')}</p>
    },
    {
        target: 'json',
        title: t('tour.header.json.title'),
        body: (
            <>
                <p>{t('tour.header.json.intro')}</p>
                <ol>
                    <li>{t('tour.header.json.step1')}</li>
                    <li>{t('tour.header.json.step2')}</li>
                    <li>{t('tour.header.json.step3')}</li>
                    <li>{tRich('tour.header.json.step4')}</li>
                </ol>
                <p className="av-tour__note">{t('tour.header.json.noteDaily', { limit: FREE_JSON_IMPORTS_PER_DAY })}</p>
            </>
        )
    },
    {
        target: 'full-page',
        title: t('tour.header.fullPage.title'),
        body: <p>{t('tour.header.fullPage.body')}</p>
    },
    {
        target: 'close',
        title: t('tour.header.close.title'),
        body: <p>{tRich('tour.header.close.body')}</p>
    }
];

// Field-level steps point at the first field on the tab (data-tour repeats on every field)
const profilesSteps = (): SectionStep[] => [
    {
        target: 'profile-switcher',
        title: t('tour.profiles.switcher.title'),
        body: (
            <>
                <p>{t('tour.profiles.switcher.body1')}</p>
                <p>{t('tour.profiles.switcher.body2')}</p>
                <p className="av-tour__note">{t('tour.profiles.switcher.note')}</p>
            </>
        )
    },
    {
        target: 'profile-config',
        title: t('tour.profiles.config.title'),
        body: <p>{tRich('tour.profiles.config.body')}</p>
    },
    {
        target: 'identity',
        title: t('tour.profiles.identity.title'),
        body: <p>{t('tour.profiles.identity.body')}</p>
    },
    {
        target: 'field-context',
        title: t('tour.profiles.fieldContext.title'),
        body: <p>{t('tour.profiles.fieldContext.body')}</p>
    },
    {
        target: 'field-privacy',
        title: t('tour.profiles.fieldPrivacy.title'),
        body: (
            <>
                <p>{tRich('tour.profiles.fieldPrivacy.safe')}</p>
                <p>{tRich('tour.profiles.fieldPrivacy.sensitive')}</p>
                <p>{t('tour.profiles.fieldPrivacy.toggle')}</p>
            </>
        )
    },
    {
        target: 'field-toggle',
        title: t('tour.profiles.fieldToggle.title'),
        body: <p>{t('tour.profiles.fieldToggle.body')}</p>
    },
    {
        target: 'documents',
        title: t('tour.profiles.documents.title'),
        body: (
            <>
                <p>{t('tour.profiles.documents.body')}</p>
                <p className="av-tour__note">{t('tour.profiles.documents.note')}</p>
            </>
        )
    },
    {
        target: 'attributes',
        title: t('tour.profiles.attributes.title'),
        body: <p>{t('tour.profiles.attributes.body')}</p>
    },
    {
        target: 'custom-fields',
        title: t('tour.profiles.customFields.title'),
        body: <p>{tRich('tour.profiles.customFields.body')}</p>
    },
    {
        target: 'save-profile',
        title: t('tour.profiles.save.title'),
        body: <p>{t('tour.profiles.save.body')}</p>
    }
];

const multilinkSteps = (): SectionStep[] => [
    {
        target: 'add-link',
        title: t('tour.multilink.addLink.title'),
        body: <p>{tRich('tour.multilink.addLink.body')}</p>
    },
    {
        target: 'saved-links',
        title: t('tour.multilink.savedLinks.title'),
        body: <p>{t('tour.multilink.savedLinks.body')}</p>
    },
    {
        target: 'batch-run',
        title: t('tour.multilink.batchRun.title'),
        body: (
            <>
                <p>{t('tour.multilink.batchRun.body1')}</p>
                <p>{t('tour.multilink.batchRun.body2Plan')}</p>
                <p className="av-tour__note">{t('tour.multilink.batchRun.note')}</p>
            </>
        )
    }
];

const settingsSteps = (): SectionStep[] => [
    {
        target: 'account',
        title: t('tour.settings.account.title'),
        body: <p>{t('tour.settings.account.body')}</p>
    },
    {
        target: 'ai-mode',
        title: t('tour.settings.aiMode.title'),
        body: (
            <>
                <p>{tRich('tour.settings.aiMode.standard')}</p>
                <p>{tRich('tour.settings.aiMode.smart')}</p>
            </>
        )
    },
    {
        target: 'ai-engine',
        title: t('tour.settings.aiEngine.title'),
        body: <p>{tRich('tour.settings.aiEngine.bodyGuide')}</p>
    },
    {
        target: 'memories',
        title: t('tour.settings.memories.title'),
        body: <p>{t('tour.settings.memories.body')}</p>
    },
    {
        target: 'auto-paginate',
        title: t('tour.settings.autoPaginate.titlePlan'),
        body: <p>{t('tour.settings.autoPaginate.body')}</p>
    },
    {
        target: 'floating-icon',
        title: t('tour.settings.floatingIcon.title'),
        body: <p>{t('tour.settings.floatingIcon.body')}</p>
    },
    {
        target: 'typing-speed',
        title: t('tour.settings.typingSpeed.title'),
        body: <p>{tRich('tour.settings.typingSpeed.body')}</p>
    },
    {
        target: 'replay-tour',
        title: t('tour.settings.replayTour.title'),
        body: <p>{tRich('tour.settings.replayTour.body')}</p>
    },
    {
        target: 'device-data',
        title: t('tour.settings.deviceData.title'),
        body: <p>{t('tour.settings.deviceData.body')}</p>
    },
    {
        target: 'device',
        title: t('tour.settings.device.title'),
        body: <p>{t('tour.settings.device.body')}</p>
    }
];

const inSection = (section: string, tab: ActiveTab | undefined, steps: SectionStep[]): TourStep[] =>
    steps.map(step => ({ ...step, section, tab }));

// The whole guide in order; the tour switches tabs as it goes. Header steps have no tab: they show on the current one.
const allSteps = (): TourStep[] => [
    ...inSection(t('tour.sections.autofill'), 'fill', autofillSteps()),
    ...inSection(t('tour.sections.header'), undefined, headerSteps()),
    ...inSection(t('tour.sections.profiles'), 'profiles', profilesSteps()),
    ...inSection(t('tour.sections.multilink'), 'multilink', multilinkSteps()),
    ...inSection(t('tour.sections.settings'), 'settings', settingsSteps())
];

// Drops steps whose element can't appear here, so the step counts stay right
export function getTourSteps({ isPage, useAiFill }: { isPage: boolean; useAiFill: boolean }): TourStep[] {
    return allSteps().filter(step => {
        // Side-panel-only buttons (Voice mode, full page, close) aren't in the full-page layout
        if (isPage && (step.tab === 'fill' || step.target === 'voice-mode' || step.target === 'full-page' || step.target === 'close')) return false;
        if (!useAiFill && step.target === 'ai-engine') return false;
        return true;
    });
}
