// What the agent says, in English and simple Tagalog (ported from Autonoma, plus Aullevo's own actions).
import type { AdvanceResult, FillOutcome, VoiceLanguage } from './types';

const pick = (language: VoiceLanguage, en: string, tl: string) => language === 'tl' ? tl : en;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
/** Shortens a long question to its first words, so the list stays easy to listen to. */
const short = (question: string) => {
    const words = question.replace(/\s*\([^)]*\)/g, '').replace(/[*?:.]+$/, '').trim().split(/\s+/);
    return words.length > 7 ? `${words.slice(0, 7).join(' ')}…` : words.join(' ');
};
function list(items: string[], language: VoiceLanguage) {
    const named = items.slice(0, 3).map(short);
    const more = items.length > 3 ? pick(language, ', and more', ', at iba pa') : '';
    if (named.length <= 1) return named.join('') + more;
    return `${named.slice(0, -1).join(', ')} ${pick(language, 'and', 'at')} ${named.at(-1)}${more}`;
}
const needYou = (left: string[], language: VoiceLanguage) => pick(language,
    `${left.length === 1 ? 'One question needs' : `${left.length} questions need`} you: ${list(left, language)}.`,
    `May ${left.length} na tanong na kailangan ng sagot mo: ${list(left, language)}.`);

const PAGE_NAMES: Record<string, [string, string]> = {
    autofill: ['the Autofill tab', 'ang Autofill tab'],
    profiles: ['your profiles', 'ang mga profile mo'],
    multilink: ['Multi-Link', 'ang Multi-Link'],
    settings: ['Settings', 'ang Settings'],
    voice_settings: ['voice settings', 'ang voice settings'],
    full_page: ['the full page', 'ang full page'],
    classic: ['the classic view', 'ang classic view'],
};

// A few ways to say the same thing, so the agent doesn't sound like a recording
const vary = (...lines: string[]) => lines[Math.floor(Math.random() * lines.length)];

export const say = {
    starting: (language: VoiceLanguage) => pick(language,
        vary('On it. Filling this page.', 'Right away. Filling in this page now.', 'Certainly. Let me fill this one in for you.'),
        vary('Sige, pinupunan ko na ang form.', 'Sige po, sasagutan ko na ito.')),
    startingAll: (language: VoiceLanguage) => pick(language,
        vary('On it. Filling every page of this form.', 'Right away. I\'ll work through every page.'),
        'Sige, pupunan ko ang lahat ng pahina ng form.'),
    sample: (language: VoiceLanguage) => pick(language,
        'Good evening. All systems are ready. Which form shall we fill today?',
        'Magandang gabi. Handa na ako. Anong form ang pupunan natin ngayon?'),
    startingTarget: (target: string, language: VoiceLanguage) => target === 'this field'
        ? pick(language, 'Filling this field.', 'Pupunan ko ang field na ito.')
        : pick(language, `Filling the ${target}.`, `Pupunan ko ang ${target}.`),
    startingLinks: (count: number, language: VoiceLanguage) => pick(language, `On it. Filling ${plural(count, 'form')} from your link queue.`, `Sige, pupunan ko ang ${count} na form sa link queue mo.`),

    // Listening
    listening: (language: VoiceLanguage) => pick(language, 'Listening…', 'Nakikinig…'),
    liveListening: (language: VoiceLanguage) => pick(language, 'Live · listening… say "end conversation" to stop', 'Live · nakikinig… sabihin ang "tama na" para tumigil'),
    liveOn: (language: VoiceLanguage) => pick(language, vary('Yes?', 'Go ahead.', "I'm listening."), vary('Ano iyon?', 'Sige, nakikinig ako.')),
    liveOff: (language: VoiceLanguage) => pick(language, vary('Standing by.', 'Okay. Talk soon.', 'Alright.'), vary('Sige.', 'Sige, hanggang sa muli.')),
    liveTimeout: (language: VoiceLanguage) => pick(language, "It's been quiet for a while, so I stopped listening.", 'Matagal nang tahimik, kaya tumigil na ako sa pakikinig.'),
    understanding: (language: VoiceLanguage) => pick(language, 'Understanding…', 'Iniintindi…'),
    heardNothing: (language: VoiceLanguage) => pick(language, "I didn't hear anything.", 'Wala akong narinig.'),
    notUnderstood: (language: VoiceLanguage) => pick(language, 'Sorry, I didn\'t catch that. Say "help" to hear what I can do.', 'Pasensya, hindi ko naintindihan. Sabihin ang "tulong" para malaman ang kaya ko.'),
    help: (language: VoiceLanguage) => pick(language,
        'You can say: fill this page, fill the email or any field, fill this one for the field you clicked, fill all pages, next, submit, stop, or what\'s left. ' +
        'Stop talking to cut me off, or end conversation when you\'re done. Highlight the fields, rescan, use, then a profile name, create a profile called Work, set my phone to, then the number, add this page to my links, or fill my links. ' +
        'Open settings, classic mode, turn AI on or off, dark mode, or speak Tagalog.',
        'Puwede mong sabihin: punan ang form, punan ang email o kahit anong field, punan mo ito para sa field na pinindot mo, punan lahat ng pahina, susunod, ipasa, itigil, o ano pa ang kulang. ' +
        'I-highlight ang mga field, rescan, gamitin, tapos ang pangalan ng profile, gumawa ng profile na Trabaho, set my phone to, tapos ang numero, o punan ang mga link ko. ' +
        'Buksan ang settings, classic mode, i-on o i-off ang AI, o mag-English.'),
    micBlocked: (language: VoiceLanguage) => pick(language, 'I need permission to use the microphone. I opened a tab where you can allow it.', 'Kailangan ko ng pahintulot sa mikropono. Nagbukas ako ng tab para payagan mo ito.'),
    micSystem: (language: VoiceLanguage) => pick(language, 'Chrome may use the microphone, but your computer is blocking it. I opened a page that shows how to turn it on.', 'Pinapayagan ng Chrome ang mikropono, pero hinaharangan ito ng computer mo. Nagbukas ako ng page kung paano ito i-on.'),
    micMissing: (language: VoiceLanguage) => pick(language, "I can't find a microphone. Plug one in, then tap the mic again.", 'Wala akong makitang mikropono. Magkabit ng isa, tapos pindutin ulit ang mic.'),
    micBusy: (language: VoiceLanguage) => pick(language, 'Another app is using the microphone. Close it, then tap the mic again.', 'May ibang app na gumagamit ng mikropono. Isara ito, tapos pindutin ulit ang mic.'),
    voiceError: (language: VoiceLanguage) => pick(language, 'Something went wrong while listening.', 'May problema habang nakikinig ako.'),

    // Form
    left: (left: string[], language: VoiceLanguage) => left.length
        ? needYou(left, language)
        : pick(language, 'Nothing is left from the last fill.', 'Wala nang kulang sa huling pinunan ko.'),
    answerHow: (language: VoiceLanguage) => pick(language, 'Tell me the question and your answer, like: answer the gym question with, I jog every day.', 'Sabihin ang tanong at ang sagot mo, halimbawa: sagutan ang tanong tungkol sa gym, ang sagot ay oo.'),
    stopped: (language: VoiceLanguage) => pick(language, 'Okay, stopped.', 'Sige, itinigil ko na.'),
    stopping: (language: VoiceLanguage) => pick(language, 'Stopping the fill.', 'Itinitigil ko na ang pagpuno.'),
    busy: (language: VoiceLanguage) => pick(language, "I'm still filling. Say stop to cancel.", 'Nagpupuno pa ako. Sabihin ang itigil para huminto.'),
    profileOff: (name: string, language: VoiceLanguage) => pick(language, `The ${name} profile is switched off. Say turn on this profile first.`, `Naka-off ang profile na ${name}. Sabihin muna ang i-on ang profile.`),
    profileLimit: (max: number, language: VoiceLanguage) => pick(language, `On the Free plan only ${max} profiles can be on. Turn one off first.`, `Sa Free plan, ${max} profile lang ang puwedeng naka-on. Mag-off muna ng isa.`),
    proOnly: (language: VoiceLanguage) => pick(language, 'Filling every page needs Aullevo Pro. I can fill this page instead: say fill this page.', 'Kailangan ng Aullevo Pro para punan ang lahat ng pahina. Sabihin ang punan ang form para sa pahinang ito.'),
    advance(result: AdvanceResult, language: VoiceLanguage): string {
        switch (result.action) {
            case 'next': return pick(language, 'Next page.', 'Lipat na sa susunod na pahina.');
            case 'submitted': return pick(language, 'Submitted.', 'Naipasa na.');
            case 'not-submitted': return pick(language, "I clicked Submit, but the form didn't go through. Please check it.", 'Pinindot ko ang Submit, pero hindi pumasok ang form. Pakitingnan mo.');
            case 'ready-to-submit': return pick(language, "This is the last page. Say submit when you're ready.", 'Huling pahina na ito. Sabihin ang ipasa kapag handa ka na.');
            case 'blocked': return pick(language, `I can't go on yet: "${short(result.blockedBy ?? 'a required question')}" needs your answer.`, `Hindi pa ako makakatuloy: kailangan ng sagot mo sa "${short(result.blockedBy ?? 'isang tanong')}".`);
            default: return pick(language, "I don't see a Next or Submit button here.", 'Wala akong makitang Next o Submit dito.');
        }
    },

    /** The summary after a fill: what was filled, then what needs you or what happened. */
    finished(outcome: FillOutcome, language: VoiceLanguage): string {
        if (outcome.stopped) return pick(language, 'Okay, stopped.', 'Sige, itinigil ko na.');
        if (!outcome.ok) {
            const error = outcome.error ?? '';
            if (/refresh|connect/i.test(error)) return pick(language, 'I can\'t reach this page. Please refresh it, then ask me again.', 'Hindi ko maabot ang page na ito. Pakirefresh, tapos subukan ulit.');
            if (/no form/i.test(error)) return pick(language, "I couldn't find a form on this page.", 'Wala akong makitang form sa pahinang ito.');
            return pick(language, `That didn't work: ${error || 'something went wrong'}`, `Hindi gumana: ${error || 'may nagkaproblema'}`);
        }

        if (outcome.target && outcome.dictated) {
            const named = outcome.target === 'this field' ? pick(language, 'the field you clicked', 'ang field na pinindot mo') : `"${outcome.target}"`;
            if (!outcome.matched) return outcome.target === 'this field'
                ? pick(language, 'Click the question first, then tell me your answer.', 'Pumindot muna ng tanong, tapos sabihin ang sagot mo.')
                : pick(language, `I couldn't find a question like ${named} on this page.`, `Wala akong makitang tanong na ${named} sa page na ito.`);
            if (outcome.filled > 0) return pick(language, `Done. I put your answer in ${list(outcome.filledLabels, language) || named}.`, `Tapos na. Inilagay ko ang sagot mo sa ${list(outcome.filledLabels, language) || named}.`);
            return pick(language, `I found the question, but "${short(outcome.dictated)}" doesn't match any of its choices.`, `Nakita ko ang tanong, pero walang choice na tugma sa "${short(outcome.dictated)}".`);
        }
        if (outcome.target) {
            const named = outcome.target === 'this field' ? pick(language, 'this field', 'ang field na ito') : `"${outcome.target}"`;
            if (!outcome.matched) return outcome.target === 'this field'
                ? pick(language, 'Click a field on the page first, then say "fill this one".', 'Pumindot muna ng field sa page, tapos sabihin ang "punan mo ito".')
                : pick(language, `I couldn't find a field called ${named} on this page.`, `Wala akong makitang field na ${named} sa page na ito.`);
            if (outcome.filled > 0 && outcome.filledLabels.length) return pick(language, `Filled ${list(outcome.filledLabels, language)}.`, `Napunan ko ang ${list(outcome.filledLabels, language)}.`);
            if (outcome.filled > 0) return pick(language, `Filled ${named}.`, `Napunan ko ang ${named}.`);
            return pick(language, `I found ${named}, but I don't have an answer saved for it.`, `Nakita ko ang ${named}, pero wala akong naka-save na sagot para dito.`);
        }

        const parts = [outcome.filled
            ? pick(language, `${vary('Done.', 'All done.', 'Finished.')} I filled ${plural(outcome.filled, 'field')}${outcome.usedAi ? ' with help from AI' : ''}${outcome.pages && outcome.pages > 1 ? ` on ${outcome.pages} pages` : ''}.`,
                `Tapos na. Napunan ko ang ${outcome.filled} na field${outcome.usedAi ? ' sa tulong ng AI' : ''}${outcome.pages && outcome.pages > 1 ? ` sa ${outcome.pages} na pahina` : ''}.`)
            : pick(language, "I couldn't fill anything here.", 'Wala akong napunan dito.')];

        if (outcome.pageStatus === 'submitted') parts.push(pick(language, 'And I submitted the form.', 'At naipasa ko na ang form.'));
        else if (outcome.blockedBy) parts.push(pick(language, `I stopped at "${short(outcome.blockedBy)}": it needs your answer.`, `Huminto ako sa "${short(outcome.blockedBy)}": kailangan ng sagot mo.`));
        else if (outcome.left.length) parts.push(needYou(outcome.left, language));
        if (outcome.notice && /ai/i.test(outcome.notice)) parts.push(pick(language, "AI wasn't available, so I used your saved answers only.", 'Hindi magamit ang AI, kaya mga naka-save mong sagot lang ang ginamit ko.'));
        return parts.join(' ');
    },

    // Page
    highlighted: (count: number, language: VoiceLanguage) => count
        ? pick(language, `Highlighted ${plural(count, 'field')}.`, `Na-highlight ko ang ${count} na field.`)
        : pick(language, "I don't see any fields on this page.", 'Wala akong makitang field sa page na ito.'),
    highlightsCleared: (language: VoiceLanguage) => pick(language, 'Highlights cleared.', 'Inalis ko na ang highlight.'),
    scanned: (count: number, language: VoiceLanguage) => count
        ? pick(language, `This page has ${plural(count, 'field')}.`, `May ${count} na field sa page na ito.`)
        : pick(language, "I don't see any fields on this page. If there's a form, refresh the page.", 'Wala akong makitang field. Kung may form, pakirefresh ang page.'),

    // Profiles
    profile: (name: string, language: VoiceLanguage) => pick(language, `Okay, using ${name}.`, `Sige, gagamitin ko ang ${name}.`),
    profiles: (current: string, names: string[], language: VoiceLanguage) => pick(language,
        `You're using ${current}. Your profiles are ${list(names, language)}.`,
        `Gamit mo ang ${current}. Ang mga profile mo ay ${list(names, language)}.`),
    profileCreated: (name: string, language: VoiceLanguage) => pick(language, `Created the ${name} profile and switched to it. Tell me your details, like: set my email to, then your email.`, `Ginawa ko ang profile na ${name} at ginamit ko na. Sabihin ang mga detalye mo, halimbawa: set my email to, tapos ang email mo.`),
    profileExists: (name: string, language: VoiceLanguage) => pick(language, `You already have a profile called ${name}, so I switched to it.`, `May profile ka nang ${name}, kaya ginamit ko na ito.`),
    profileNameNeeded: (language: VoiceLanguage) => pick(language, 'What should I call it? Say: create a profile called, then the name.', 'Ano ang ipapangalan ko? Sabihin: gumawa ng profile na, tapos ang pangalan.'),
    profileOn: (name: string, language: VoiceLanguage) => pick(language, `${name} is on.`, `Naka-on na ang ${name}.`),
    profileOffDone: (name: string, language: VoiceLanguage) => pick(language, `${name} is off. I won't fill with it until you turn it on.`, `Naka-off na ang ${name}. Hindi ko ito gagamitin hangga't hindi mo ini-on.`),
    fieldUpdated: (label: string, value: string, language: VoiceLanguage) => pick(language, `Saved. Your ${label} is now ${value}.`, `Na-save. Ang ${label} mo ay ${value} na.`),
    fieldAdded: (label: string, language: VoiceLanguage) => pick(language, `Added a new field, ${label}, to this profile.`, `Nagdagdag ako ng bagong field, ${label}, sa profile na ito.`),

    // Multi-Link
    linkAdded: (host: string, language: VoiceLanguage) => pick(language, `Added ${host} to your link queue.`, `Idinagdag ko ang ${host} sa link queue mo.`),
    linkExists: (language: VoiceLanguage) => pick(language, 'This page is already in your link queue.', 'Nasa link queue mo na ang page na ito.'),
    noPageToAdd: (language: VoiceLanguage) => pick(language, "I can't add this tab: it isn't a web page.", 'Hindi ko maidagdag ang tab na ito: hindi ito web page.'),
    noLinks: (language: VoiceLanguage) => pick(language, 'Your link queue has no links switched on. Say add this page to my links first.', 'Walang naka-on na link sa queue mo. Sabihin muna ang idagdag ang page na ito.'),

    // Panel
    opening: (page: string, language: VoiceLanguage) => {
        const [en, tl] = PAGE_NAMES[page] ?? [page, page];
        return pick(language, `Opening ${en}.`, `Binubuksan ko ${tl}.`);
    },
    aiOn: (language: VoiceLanguage) => pick(language, 'AI fill is on. I\'ll use AI for questions your saved answers don\'t cover.', 'Naka-on na ang AI. Gagamitin ko ito sa mga tanong na wala sa naka-save mong sagot.'),
    aiOff: (language: VoiceLanguage) => pick(language, "AI fill is off. I'll use your saved answers only.", 'Naka-off na ang AI. Mga naka-save mong sagot lang ang gagamitin ko.'),
    dark: (language: VoiceLanguage) => pick(language, 'Dark mode.', 'Dark mode na.'),
    light: (language: VoiceLanguage) => pick(language, 'Light mode.', 'Light mode na.'),
    unmuted: (language: VoiceLanguage) => pick(language, "I'm back. I'll talk again.", 'Nandito na ulit ako. Magsasalita na ulit ako.'),
    english: () => "Okay, I'll speak English.",
    tagalog: () => 'Sige, Tagalog na tayo.',
};
