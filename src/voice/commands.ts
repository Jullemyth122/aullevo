// Spoken commands in English and simple Tagalog, matched by plain rules (ported from Autonoma, plus Aullevo's own
// actions). Sentences the rules don't recognise go to Gemini (PARSE_VOICE_COMMAND) to work out the intent.
import type { VoiceCommand, VoiceIntent, VoicePage } from './types';

/** A profile the user can name: its key (profileType, e.g. "job") and its display name. */
export interface ProfileRef { key: string; name: string }

const clean = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Checked in order: the first rule that matches wins. Panel and page actions come before the fill rules,
// so "stop highlighting" clears highlights instead of stopping a fill.
const RULES: [VoiceIntent, RegExp][] = [
    ['end_live', /\b(stop (?:listening|listen|listing|lis\w*)|(?:end|close|finish|exit) (?:the |this |our )?(?:talking|talk|conversation|convo|chat|session|call|voice chat)|stop (?:the |this |our )?(?:conversation|convo|chat|session|call|voice chat)|that'?s all|that is all|i'?m done|we'?re done|good ?bye|bye bye|see you|tama na|tapos na|wala na|salamat)\b/],
    // Cut the agent off mid-sentence; it keeps listening
    ['hush', /\b(?:stop|quit|no more|enough) (?:talking|speaking|the talking)\b|\b(?:be quiet|quiet please|shut up|shh+|shush|hush|that'?s enough|okay enough|tumahimik|huwag kang magsalita|tahimik)\b|^(?:quiet|enough)$/],
    ['tagalog', /^(?:(?:please )?(?:speak|talk|reply|answer|switch|change|use|mag|magsalita)(?: in| to| ng| sa)? )?(?:tagalog|filipino|pilipino)(?: (?:please|po|mode|language|na))?$/],
    ['english', /^(?:(?:please )?(?:speak|talk|reply|answer|switch|change|use|mag|magsalita)(?: in| to| ng| sa)? )?(?:english|ingles|inggles)(?: (?:please|po|mode|language|na))?$/],
    ['clear_highlight', /\b(clear|remove|hide|turn off|stop|alisin|tanggalin)\b.*\bhighlight|\bun ?highlight\b/],
    ['highlight', /\bhighlight\b|\b(show|mark|ipakita)\b.*\b(fields?|inputs?|boxes|blanks)\b/],
    ['rescan', /\b(re ?scan|scan|recount)\b|\bhow many (fields|questions|inputs|boxes)\b|\bcount the (fields|questions)\b/],
    ['unmute', /\bun ?mute\b|\b(talk|speak) (to me )?again\b|\bturn (on )?(your|the) (voice|sound)( on)?\b/],
    ['mute', /\bmute\b/],
    ['ai_off', /\b(turn|switch) off (the )?ai\b|\b(disable|stop using|don'?t use|no) (the )?ai\b|\bai (fill )?off\b|\bwithout ai\b/],
    ['ai_on', /\b(turn|switch) on (the )?ai\b|\b(enable|use) (the )?ai\b|\bai (fill )?on\b|\bwith ai\b/],
    ['dark', /\bdark (mode|theme)\b|\b(theme|mode) (to )?dark\b|\bgo dark\b/],
    ['light', /\blight (mode|theme)\b|\b(theme|mode) (to )?light\b/],
    ['left', /\b(what'?s|what is|what are|what'?re) (left|missing|remaining)\b|what do you need|anything (left|missing)|\bano pa\b|\b(anong|ano ang) kulang\b|\bkulang\b|ano pa ang kailangan/],
    ['help', /\bhelp\b|what can you do|\bcommands?\b|\btulong\b|\b(ano|anong) (ang )?kaya mo\b/],
    ['profiles', /\b(what|which|list|show me|tell me)\b.*\bprofiles?\b|\bcurrent profile\b|\b(anong|ano ang|ilan ang) profile\b/],
    ['enable_profile', /\b(turn on|enable|activate|switch on|i ?on)\b.*\bprofile\b/],
    ['disable_profile', /\b(turn off|disable|deactivate|switch off|i ?off)\b.*\bprofile\b/],
    ['add_link', /\b(add|save|queue|put|idagdag|isave)\b.*\b(this|current|ang) (page|link|tab|site|url|form)\b|\b(add|save|put)\b.*\bto (my |the )?(links|link queue|queue|multi ?link)\b/],
    ['fill_links', /\b(fill|run|start|process|punan)\b.*\b(links|link queue|queue|batch|multi ?link)\b/],
    ['stop', /\b(stop|cancel|abort|halt|tigil|itigil|hinto|ihinto|teka)\b/],
    ['submit', /\b(submit|send (it|the form)|ipasa|isumite|i ?submit|ipadala)\b/],
    ['fill_all', /\b(fill|punan|punuin|sagutan|answer|complete)\b.*\b(all|every|whole|entire|lahat|buong)\b.*\b(pages?|steps?|pahina)\b/],
    ['fill', /\b(fill|autofill|auto fill|punan|punuin|pakipunan|sagutan|pakisagutan|answer|complete)\b|\bi ?fill\b/],
    ['next', /\b(next|continue|go on|susunod|sunod|kasunod|tuloy|ituloy)\b/],
];

// Where "open ..." / "go to ..." leads. Classic mode first: "exit voice mode", "switch to classic view".
const OPEN_VERB = /\b(open|go to|show|switch to|take me to|bring me to|back to|buksan|punta sa|pumunta sa|ipakita)\b/;
const PAGES: [VoicePage, RegExp][] = [
    ['classic', /\b(classic|normal|standard|old|regular|text) (mode|view|panel|layout|tabs?)\b|\b(exit|leave|close|turn off|stop|switch off)( the)? voice( mode| view)?\b/],
    ['voice_settings', /\bvoice (settings?|options)\b|\belevenlabs\b/],
    ['full_page', /\b(full ?page|full ?screen|options page|big (page|screen)|bigger (page|view))\b/],
    ['settings', /\b(settings?|options|preferences)\b/],
    ['multilink', /\b(multi ?link|links? (tab|page|list)|link queue)\b/],
    ['profiles', /\bprofiles? (tab|page|editor|settings)\b|\b(edit|manage)( my)? profiles?\b/],
    ['autofill', /\bautofill (tab|page)\b/],
];
function matchPage(said: string): VoicePage | null {
    const page = PAGES.find(([, pattern]) => pattern.test(said));
    if (!page) return null;
    // "classic mode" and "edit my profile" are commands by themselves; the rest need "open", "go to"...
    return page[0] === 'classic' || page[0] === 'profiles' || OPEN_VERB.test(said) ? page[0] : null;
}

// "fill the email", "punan mo ang pangalan", "fill this": a fill verb followed by what to fill.
const FILL_WHAT = /^(?:(?:please|paki|pakisuyo|can you|could you) )?(?:fill|autofill|answer|complete|punan|punuin|pakipunan|sagutan|pakisagutan)(?: (?:in|out|up|mo|na|nga|po|naman))*(?: (?:the|my|ang|yung|iyong|aking|ko|sa))*\s+(.+)$/;
const WHOLE_FORM = /^(?:(?:this|the|ang|yung) )?(?:form|page|forms?|pages?|everything|all|lahat|it|whole form|entire form|buong form|whole page|entire page)(?: (?:na ito|ito|please|po|for me|now))?$/;
const THIS_FIELD = /^(?:this|that|this one|that one|this field|that field|this box|that box|this question|that question|this thing|that thing|here|ito|iyan|yan|yun|dito|ito na|itong field|field na ito)(?: (?:please|po|for me|now))?$/;
// A question pointed at by where it is: "fifth question", "the last one", "question 3", "ikalimang tanong"
const POSITION = /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|final|\d{1,2}(?:st|nd|rd|th)?|una|unang|ikalawa(?:ng)?|pangalawa(?:ng)?|ikatlo(?:ng)?|pangatlo(?:ng)?|ikaapat(?: na)?|ikalima(?:ng)?)\s+(?:question|one|item|tanong|field|blank)\b|\b(?:question|number|no|tanong|item)\s+(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/;

// What was named is kept as said ("kaarawan", "birthday"): the page finds the question, by its words or with AI.
// A position keeps its "question" / "one" ("question one" must not lose the number).
function targetWords(target: string): string {
    const filler = POSITION.test(target)
        ? /\b(please|po|naman|for me|now|na|ko|mo|ninyo|natin|namin)\b/g
        : /\b(please|po|naman|for me|now|na|ko|mo|ninyo|natin|namin|one|field|box|question)\b/g;
    return target.replace(filler, ' ').replace(/\s+/g, ' ').trim();
}
const FILL_VERB = /\b(?:fill|autofill|answer|complete|punan|punuin|pakipunan|sagutan|pakisagutan)\b/g;
// Verbs that fill the whole page when nothing follows them ("fill", "autofill", "punan mo"). "Answer" and
// "complete" need an object: "the form is complete" is not a request.
const OBJECT_AFTER = /^(?:answer|complete)\s+(?:the|this|that|these|my|our|question|questions|number|all|everything|it|ang|yung|lahat)\b/;
const BARE_FILL = /^(?:fill|autofill|punan|punuin|pakipunan|sagutan|pakisagutan)(?: (?:in|out|up|mo|na|nga|po|naman|please|now|for me|it|everything))*$/;

/**
 * What a fill request asks for: `{ intent: 'fill' }` for the whole page, a targeted fill, or null when the sentence
 * isn't a fill request. The verb can come anywhere ("if I have a middle name, can you please fill the first name"):
 * the last verb with something after it decides, so lead-in words and stutters never turn into "fill everything".
 * The whole page only when nothing else is named, or "this page", "the form", "everything".
 */
function fillWhat(said: string): VoiceCommand | null {
    const verbs = [...said.matchAll(FILL_VERB)].reverse();
    for (const verb of verbs) {
        const tail = said.slice(verb.index);
        if (BARE_FILL.test(tail)) return { intent: 'fill' };
        // "answer" / "complete" only with an object: "answer the email", not "I want to answer later"
        if (/^(?:answer|complete)\b/.test(tail) && !OBJECT_AFTER.test(tail)) continue;
        const match = tail.match(FILL_WHAT);
        if (!match) continue;
        const what = match[1]
            .replace(/\b(?:please|po|naman|for me|for us|right now|now)\b/g, ' ')
            // "the first question on this page": where it is, not what to fill
            .replace(/\b(?:on|in|of|from|sa)\s+(?:this|the|ang|yung)\s+(?:page|form|site|website)\b/g, ' ')
            .replace(/\s+(?:up|out|in)$/, '')
            .replace(/\s+/g, ' ').trim();
        if (!what || WHOLE_FORM.test(what)) return { intent: 'fill' };
        if (THIS_FIELD.test(what)) return { intent: 'fill_focused' };
        // "this name this email and the phone" names several questions: split on the little words between them
        const targets = what.split(/\s*\b(?:and|at|also|plus|saka|pati|this|that|the|yung|ang|my|then)\b\s*/)
            .map(piece => targetWords(piece)).filter(Boolean);
        if (!targets.length) return { intent: 'fill_focused' };
        return { intent: 'fill_field', targets };
    }
    return null;
}

const PROFILE = /\b(?:use|switch to|change to|go to|gamitin(?: mo)?(?: ang)?|lumipat sa|lipat sa)\s+(?:my\s+|the\s+)?(.+?)(?:\s+profile)?$/;

/** The profile whose name (or type) best matches what was said, if most of its words were heard. */
export function findProfile(spoken: string, profiles: ProfileRef[]): ProfileRef | undefined {
    const heard = new Set(clean(spoken).split(' '));
    const score = (text: string) => {
        const words = clean(text).split(' ').filter(word => word.length > 1);
        return words.length ? words.filter(word => heard.has(word) || heard.has(word.replace(/s$/, ''))).length / words.length : 0;
    };
    const scored = profiles.map(profile => ({ profile, score: Math.max(score(profile.name), score(profile.key)) }))
        .sort((a, b) => b.score - a.score);
    return scored[0]?.score >= 0.5 ? scored[0].profile : undefined;
}

// "create a new profile called Work", "make a school profile", "gumawa ng profile na Trabaho"
const CREATE_PROFILE = /^(?:please |can you |could you )?(?:create|make|add|start|set up|gumawa ng|gumawa|magdagdag ng)\s+(?:a |an |new |bagong |another |ng )*(.*?)\s*profile\b(?:\s+(?:called|named|for|na|na tinatawag na|with the name))?\s*(.*)$/i;

/** "create a profile called Work" → "Work" (the name keeps its capitals). */
function matchCreateProfile(raw: string): VoiceCommand | null {
    const match = raw.trim().replace(/[.!?]+$/, '').match(CREATE_PROFILE);
    if (!match) return null;
    const name = (match[2] || match[1]).replace(/^(?:called|named|na)\s+/i, '').replace(/["“”]/g, '').trim();
    return { intent: 'create_profile', name: name ? name.charAt(0).toUpperCase() + name.slice(1) : '' };
}

// "set my phone to 0917 123 4567", "change my email to ...", "add a field called Nickname with value Xen",
// "my nickname is Xen". Read from the raw text: values keep their capitals, @, dots and commas.
const SET_FIELD = [
    /^(?:please |can you |could you )?(?:add|create|save|make)\s+(?:a |an |new |custom )*field\s+(?:called |named )?(.+?)\s+(?:with (?:the )?value|with|value|equals|equal to|as|=)\s+(.+)$/i,
    /^(?:please |can you |could you )?(?:set|change|update|save|make)\s+(?:my |the )?(.+?)\s+(?:to|as|into|=)\s+(.+)$/i,
    /^(?:remember (?:that )?)?my\s+(.+?)\s+is\s+(.+)$/i,
];
function matchSetField(raw: string): VoiceCommand | null {
    const text = raw.trim().replace(/[.!?]+$/, '');
    for (const pattern of SET_FIELD) {
        const match = text.match(pattern);
        if (!match) continue;
        const label = match[1].replace(/^(?:my|the)\s+/i, '').replace(/\s+field$/i, '').trim();
        const value = match[2].replace(/^["“]|["”]$/g, '').trim();
        // "set the theme to dark", "change to English" and the like were matched by the rules before this
        if (label && value && label.split(/\s+/).length <= 6) return { intent: 'set_field', label, value };
    }
    return null;
}

// Speech-to-text often hears "fill" as "feel" or "phil", especially in short commands.
// The same for Tagalog "punan", which comes out as "panan", "punnan", "panun"...
const ORDINALS: Record<string, string> = { '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth', '5th': 'fifth' };
const forgive = (said: string) => said
    .replace(/\b(1st|2nd|3rd|4th|5th)\b/g, ordinal => ORDINALS[ordinal])
    .replace(/^((?:please |can you |could you )?)(feel|phil|fil|feels|fills|filled|field)\b(?! (called|named|with))/, '$1fill')
    .replace(/\b(feel|phil|fil|feels|fills|filled)\b(?= (this|the|form|in|out|all|it|my|every|pages?)\b)/g, 'fill')
    .replace(/\bp[aou]n{1,2}[aou]n\b/g, 'punan');

// Hesitations speech-to-text writes out: "Fill, uh, the birthday"
const DISFLUENCY = /\b(?:uh+|um+|uhm+|erm+|hmm+|mm+|ah+|eh+)\b[,.]?\s*/gi;
export const withoutFillers = (text: string) => text.replace(DISFLUENCY, '').replace(/\s+([,.?!])/g, '$1').replace(/^[\s,.]+/, '').trim();

/** The user's dictated words, tidied: no leading "said", quotes or stray punctuation; a short answer loses its final period. */
/** The words inside quotes, when the user quoted something ("say it like, "I do gym"" → I do gym). The longest quote wins. */
function quoted(text: string): string | null {
    const spans = [...text.matchAll(/["“”]([^"“”]+)["“”]/g)].map(m => m[1].trim()).filter(Boolean);
    if (spans.length) return spans.sort((a, b) => b.length - a.length)[0];
    // An opening quote speech-to-text never closed: everything after it
    const open = text.match(/["“]([^"“”]{2,})$/);
    return open ? open[1].trim() : null;
}

/**
 * The user's dictated words, tidied: the quoted part when they quoted it, otherwise without lead-ins such as
 * "it like", "something like", "that"; no stray quotes or punctuation; a short answer loses its final period.
 */
function cleanValue(value: string): string {
    const plain = withoutFillers(value);
    let out = quoted(plain) ?? plain
        .replace(/^(?:it|this|that|something|things?)\s+(?=like|as|is|was|says?)/i, '')
        .replace(/^(?:like|as|is|was|that|says?)\b[\s,:]*/i, '');
    out = out.replace(/^["“'‘]+|["”'’]+$/g, '').replace(/^[\s,:;-]+/, '').trim();
    if (out.split(/\s+/).length < 4) out = out.replace(/[.!]+$/, '');
    return out ? out.charAt(0).toUpperCase() + out.slice(1) : '';
}

// "Answer the gym question with: I do gym", "fill the nickname saying Xen", "for the gym question, say I jog",
// "type I jog every day in the gym question": the user's own words go into one question.
const ANSWER_WITH = /^(?:please\s+|can you\s+|could you\s+)?(?:answer|fill(?:\s+in|\s+out)?|reply(?:\s+to)?|respond(?:\s+to)?|sagutan|sagutin)\s+(.+?)[\s,:.?!]+(?:with|saying|said|say|and say|and put|answer is|my answer is|the answer is|ang sagot ay|ang sagot|sagot)\b[\s,:]*(.+)$/i;
const FOR_SAY = /^(?:for|sa)\s+(.+?)[\s,:.?!]+(?:say|answer|put|write|type|sagot|isulat|ilagay)\b[\s,:]*(.+)$/i;
const TYPE_IN = /^(?:please\s+)?(?:type|write|put|enter|input|isulat|ilagay)\s+(.+?)\s+(?:in|into|on|for|as|sa)\s+(.+)$/i;
// Words that say "here comes my own answer", when the rules above can't split it (the AI does)
const DICTATING = /\b(?:said|saying|my answer|the answer is|ang sagot|type|write|isulat|ilagay)\b/i;

function answerTarget(target: string): VoiceCommand | null {
    // A quoted question ("fill the, "I like gym rats, do you gym?"") is the question's own words
    const words = (quoted(target) ?? target)
        .replace(/^(?:the|this|that|ang|yung)[\s,]+/i, '').replace(/^question\s*[:,]?\s*/i, '').replace(/[\s,:.]+$/, '').trim();
    if (!words) return null;
    if (THIS_FIELD.test(clean(words)) || /^(?:this|that|here|ito)$/i.test(words)) return { intent: 'answer' };
    return { intent: 'answer', targets: [words] };
}

/** "Answer X with Y" and friends: the question and the user's own answer, or null when it isn't dictation. */
function matchAnswer(raw: string): VoiceCommand | null {
    const text = withoutFillers(raw);
    let target = '', value = '';
    const withMatch = text.match(ANSWER_WITH) || text.match(FOR_SAY);
    if (withMatch) { target = withMatch[1]; value = withMatch[2]; }
    else {
        const typed = text.match(TYPE_IN);
        if (typed) { value = typed[1]; target = typed[2]; }
    }
    value = cleanValue(value);
    // "fill the email with my work email" names a saved value, not dictated words
    if (value && !/^(?:my|the)\s+\S+(?:\s+\S+)?$/i.test(value)) {
        const command = answerTarget(target);
        if (command) return { ...command, value, ...(command.targets ? {} : { focused: true }) };
    }
    // Sounds like dictation but the parts aren't clear: the AI splits question and answer
    if (DICTATING.test(text) && /\b(?:answer|reply|respond|sagutan|sagutin|type|write|put|isulat|ilagay)\b/i.test(text)) return { intent: 'answer' };
    return null;
}

export function matchCommand(text: string, profiles: ProfileRef[]): VoiceCommand | null {
    const said = forgive(clean(text));
    if (!said) return null;

    const page = matchPage(said);
    if (page) return { intent: 'open', page };

    const create = matchCreateProfile(text);
    if (create) return create;

    const answer = matchAnswer(text);
    if (answer) return answer;

    const asked = said.match(PROFILE);
    if (asked) {
        const profile = findProfile(asked[1], profiles);
        if (profile) return { intent: 'profile', profileKey: profile.key };
    }
    for (const [intent, pattern] of RULES) {
        if (intent === 'stop' || intent === 'fill' || intent === 'next' || intent === 'submit') {
            // "set my status to complete", "my next of kin is ..." are profile edits, not form actions
            const edit = matchSetField(text);
            if (edit) return edit;
        }
        // A fill request: the whole page only when nothing else was named (see fillWhat)
        if (intent === 'fill') {
            const fill = fillWhat(said);
            if (fill) return fill;
            continue;
        }
        if (pattern.test(said)) return { intent };
    }
    const edit = matchSetField(text);
    if (edit) return edit;
    // Only a question named, no verb ("fifth question", "uh, the last one"): fill that question
    const position = said.match(POSITION);
    if (position) return { intent: 'fill_field', targets: [position[0]] };
    return null;
}

/**
 * Everything said in one breath, in order: "fill the name, then the email" or "fill this name, this email".
 * A part without its own verb continues the fill before it; neighbouring field fills merge into one fill.
 * Profile edits and new profiles are one command each (a value may contain commas: an address).
 */
export function matchCommands(spoken: string, profiles: ProfileRef[]): VoiceCommand[] {
    const text = withoutFillers(spoken);
    // Profile edits, new profiles and dictated answers are one command each (their value may contain commas)
    const whole = matchCommand(text, profiles);
    if (whole && (whole.intent === 'set_field' || whole.intent === 'create_profile' || whole.intent === 'answer')) return [whole];

    const clauses = text.split(/\s*(?:[,;]|\band then\b|\bthen\b|\band also\b|\bpagkatapos\b|\btapos\b(?! na))\s*/i).filter(part => part.trim());
    const commands: VoiceCommand[] = [];
    for (let i = 0; i < clauses.length; i++) {
        const clause = clauses[i];
        let command = matchCommand(clause, profiles);
        // "Fill, the birthday": a pause after "fill" (written as a comma) still names what to fill, not the whole page
        if (command?.intent === 'fill' && i + 1 < clauses.length && !matchCommand(clauses[i + 1], profiles)) {
            const named = matchCommand(`fill ${clauses[i + 1]}`, profiles);
            if (named && named.intent !== 'fill') { command = named; i++; }
        }
        const previous = commands.at(-1);
        if ((!command || command.intent === 'none') && previous && (previous.intent === 'fill_field' || previous.intent === 'fill_focused')) {
            command = matchCommand(`fill ${clause}`, profiles);
            // "fill this, the first question": the second part says what "this" was
            if (command?.intent === 'fill_field' && previous.intent === 'fill_focused') {
                commands[commands.length - 1] = command;
                continue;
            }
        }
        if (!command) continue;
        if (command.intent === 'fill_field' && previous?.intent === 'fill_field') {
            previous.targets = [...(previous.targets ?? []), ...(command.targets ?? [])];
            continue;
        }
        commands.push(command);
    }
    return commands;
}
