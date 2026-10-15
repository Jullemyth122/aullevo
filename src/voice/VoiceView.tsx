// Voice mode of the side panel: the agent orb (ported from Autonoma) in place of the tabs. Everything it does runs
// through the same Aullevo functions as the classic view (same profiles, same fill, same settings), so switching
// between the two keeps your profile and your work.
//
// Listen → understand → act: speech becomes text (ElevenLabs Scribe), plain rules turn the text into commands
// (commands.ts), Gemini works out anything the rules don't recognise, and the agent answers in its ElevenLabs voice.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronsRight, Crown, Eye, EyeOff, Lock, Mic, Play, RefreshCw, ScanSearch, Settings2, Sparkles, Square, UserRound } from 'lucide-react';
import type { SavedLink, UserData } from '../types';
import { countActiveProfiles, pausedProfileKeys, VOICE_PRO_MESSAGE } from '../services/tier';
import { AULLEVO_WEB_URL } from '../services/account';
import { readVault, writeVault } from '../services/vault';
import { Orb } from './orb/Orb';
import type { OrbState } from './orb/parts';
import { isOrbSoundMuted, setOrbSoundMuted } from './orb/sfx';
import { themeVars, useOrbTheme } from './orb/theme';
import { say } from './phrases';
import { configureVoice, getVoiceError, getVoiceFallbackNote, isSpeaking, lastSpokeAt, lastSpokenLine, onSpeechEnd, speak, stopSpeaking, useSpeech, waitUntilQuiet } from './speak';
import { findProfile, matchCommands, withoutFillers, type ProfileRef } from './commands';
import { openEar, VoiceKeyMissingError, type Ear } from './hearing';
import { MicrophoneBlockedError } from './listen';
import { ElevenLabsError, listVoices, PRESET_VOICES, TTS_MODELS, type ElevenVoice, type TtsModel } from './elevenlabs';
import { DEFAULT_VOICE_SETTINGS, loadVoiceSettings, saveVoiceSettings } from './settings';
import type { AdvanceResult, FillOutcome, FillTarget, PageQuestions, VoiceCommand, VoiceLanguage, VoicePage, VoiceSettings } from './types';
import { usePlanRewards } from '../hooks/useRewards';
import { freeLeft, usesLeft, voiceSessionActive } from '../services/rewards';
import { PlanUnlock } from '../components/UnlockCard';
import styles from './VoiceView.module.scss';
import { KeyGuide } from '../components/KeyGuide';

// The microphone setup tab: focused again instead of opening a new one each time
let setupTabId: number | null = null;
async function openMicrophoneSetup() {
    if (setupTabId !== null) {
        try {
            const tab = await chrome.tabs.update(setupTabId, { active: true, url: chrome.runtime.getURL('options.html#microphone') });
            if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
            return;
        } catch { /* it was closed */ }
    }
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('options.html#microphone') });
    setupTabId = tab.id ?? null;
}

/** What the voice agent can do in Aullevo. App.tsx wires each one to the same function the classic view uses. */
export interface VoiceActions {
    fill(options: { target?: FillTarget; paginate?: boolean }): Promise<FillOutcome>;
    cancelFill(): Promise<boolean>;
    advance(submit: boolean): Promise<AdvanceResult>;
    setHighlight(on: boolean): Promise<{ active: boolean; count: number } | null>;
    rescan(): Promise<number>;
    selectProfile(key: string): void;
    createProfile(name: string): { key: string; created: boolean; enabled: boolean } | null;
    setField(label: string, value: string): { status: 'updated' | 'added'; label: string };
    setProfileEnabled(on: boolean): void;
    setAiFill(on: boolean): void;
    setDark(on: boolean): void;
    addLink(url: string): void;
    startBatchFill(): number; // links started
    open(page: Exclude<VoicePage, 'voice_settings'>): void;
    activeTabUrl(): Promise<string | undefined>;
    pageQuestions(): Promise<PageQuestions>; // the form's questions in the current tab, for the AI
}

interface VoiceViewProps {
    profiles: Record<string, UserData>;
    selectedProfileType: string;
    currentProfile: UserData;
    isPro: boolean;
    isFilling: boolean;
    detectedFields: string;
    isHighlighting: boolean;
    useAiFill: boolean;
    isDark: boolean;
    savedLinks: SavedLink[];
    actions: VoiceActions;
}

type VoicePhase = 'idle' | 'listening' | 'understanding';

/** What the agent took a sentence to mean, shown under "You said" so a misunderstanding is easy to spot. */
function describeCommands(commands: VoiceCommand[]): string {
    const quote = (text: string) => `"${text.length > 40 ? `${text.slice(0, 40)}…` : text}"`;
    return commands.map((c) => {
        switch (c.intent) {
            case 'fill': return 'fill this page';
            case 'fill_all': return 'fill every page';
            case 'fill_focused': return 'fill the field you clicked';
            case 'fill_field': return `fill only ${(c.questionTexts ?? c.targets ?? []).map(quote).join(', ')}`;
            case 'answer': {
                const where = c.questionTexts ?? c.targets;
                return c.value ? `type ${quote(c.value)} into ${where?.length ? where.map(quote).join(', ') : 'the field you clicked'}` : 'answer a question (unclear)';
            }
            case 'profile': return `switch to ${c.profileKey}`;
            case 'create_profile': return `create profile ${quote(c.name ?? '')}`;
            case 'set_field': return `save ${c.label} = ${quote(c.value ?? '')}`;
            case 'open': return `open ${c.page}`;
            default: return c.intent.replace(/_/g, ' ');
        }
    }).join(', then ');
}

// Said on their own, these run at once, without waiting for the AI: they have to work in a split second
const INSTANT = new Set<VoiceCommand['intent']>(['hush', 'stop', 'end_live', 'mute', 'unmute']);
// Words that ask for the whole form / every page / submitting: the AI's answer must match what was said
const WHOLE_WORDS = /\b(all|every(thing)?|whole|entire|form|page|lahat|buong)\b/i;
const PAGES_WORDS = /\b(pages?|steps?|pahina)\b/i;
const SUBMIT_WORDS = /\b(submit|send|ipasa|isumite|ipadala)\b/i;

/**
 * The AI's commands, checked against what was said before anything runs:
 * a request that names questions never becomes "fill everything", a dictated answer goes into one question,
 * and "submit" / "every page" only when the user said so.
 */
/** One command as the AI returns it (background UNDERSTAND_VOICE): questions are positions in the page's list. */
interface AiCommand {
    intent: VoiceCommand['intent'];
    questions?: number[];
    value?: string;
    profile?: string;
    name?: string;
    label?: string;
    page?: VoicePage;
}

function checkAiCommands(commands: AiCommand[], list: PageQuestions, text: string, refs: ProfileRef[]): VoiceCommand[] {
    const out: VoiceCommand[] = [];
    for (const c of commands) {
        const nums = Array.isArray(c.questions) ? c.questions.filter(i => list.questions[i]) : [];
        const texts = nums.map(i => list.questions[i].text);
        const picked = nums.length ? { questionIndices: nums, questionTexts: texts, frameId: list.frameId } : {};
        switch (c.intent) {
            case 'fill_field': {
                if (!nums.length) continue;
                // Every question of a real form for a "targeted" request: only if they really asked for everything
                if (nums.length === list.questions.length && list.questions.length > 3) {
                    if (WHOLE_WORDS.test(text)) out.push({ intent: 'fill' });
                    continue;
                }
                out.push({ intent: 'fill_field', said: text, ...picked });
                continue;
            }
            case 'answer': {
                if (!c.value) { out.push({ intent: 'answer', said: text }); continue; }
                const one = nums.length ? { questionIndices: [nums[0]], questionTexts: [texts[0]], frameId: list.frameId } : { focused: true };
                out.push({ intent: 'answer', said: text, value: c.value, ...one });
                continue;
            }
            case 'submit': if (SUBMIT_WORDS.test(text)) out.push({ intent: 'submit' }); continue;
            case 'fill_all': out.push({ intent: PAGES_WORDS.test(text) ? 'fill_all' : 'fill' }); continue;
            case 'profile': {
                const profile = c.profile ? refs.find(r => r.name === c.profile) ?? findProfile(c.profile, refs) : undefined;
                if (profile) out.push({ intent: 'profile', profileKey: profile.key });
                continue;
            }
            default:
                out.push({ intent: c.intent, name: c.name, label: c.label, value: c.value, page: c.page });
        }
    }
    return out;
}

// While the agent talks, only these are heard: anything else is most likely its own voice coming back through the mic
const INTERRUPTS = new Set<VoiceCommand['intent']>(['hush', 'stop', 'end_live', 'mute']);
const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);
/** True when most of what was heard is the agent's own line. */
function soundsLikeAgent(heard: string, line: string): boolean {
    const said = words(heard);
    const spoken = new Set(words(line));
    return said.length > 0 && said.filter(w => spoken.has(w)).length / said.length >= 0.6;
}

// Silence and noise that speech-to-text turns into words
const PHANTOM = /^\W*$|^\W*(thank you|thanks for watching|you|bye|okay|uh+|um+|hmm+)\W*$|^\s*[([].*[)\]]\s*$/i;

export function VoiceView({ profiles, selectedProfileType, currentProfile, isPro, isFilling, detectedFields, isHighlighting, useAiFill, isDark, savedLinks, actions }: VoiceViewProps) {
    const { theme } = useOrbTheme();
    const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
    const [apiKey, setApiKey] = useState('');
    const [keyDraft, setKeyDraft] = useState('');
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [muted, setMuted] = useState(isOrbSoundMuted);
    const [allPages, setAllPages] = useState(false);
    const [phase, setPhase] = useState<VoicePhase>('idle');
    const [heard, setHeard] = useState('');
    const [understood, setUnderstood] = useState('');
    const [error, setError] = useState('');
    const [lastOutcome, setLastOutcome] = useState<FillOutcome | null>(null);
    const [finishNote, setFinishNote] = useState<{ state: OrbState; caption: string } | null>(null);
    const [liveOn, setLiveOn] = useState(false);
    const [liveNote, setLiveNote] = useState('');
    const speech = useSpeech();

    useEffect(() => {
        Promise.all([loadVoiceSettings(), readVault()]).then(([saved, vault]) => {
            setSettings(saved);
            setApiKey(vault?.elevenLabsApiKey || '');
            setKeyDraft(vault?.elevenLabsApiKey || '');
        });
    }, []);
    // Voice mode: Pro, or Free with voice sessions of 10 minutes: 3 free a day, then 6 per short ad. Locked Free:
    // nothing reaches ElevenLabs (no key is handed to the voice), and listening is refused.
    const plan = usePlanRewards();
    const voiceReady = isPro || voiceSessionActive(plan.cache) || usesLeft(plan.cache, 'voice') + freeLeft(plan.cache, 'voice') > 0;
    const locked = !voiceReady;
    useEffect(() => { configureVoice(locked ? '' : apiKey, settings.voiceId, settings.voiceModel); }, [locked, apiKey, settings.voiceId, settings.voiceModel]);
    const updateSettings = (patch: Partial<VoiceSettings>) => setSettings(prev => {
        const next = { ...prev, ...patch };
        saveVoiceSettings(next);
        return next;
    });

    // The listening loop outlives a render: it reads the latest state through this ref
    const snapshot = { profiles, selectedProfileType, currentProfile, isPro, isFilling, isHighlighting, useAiFill, isDark, savedLinks, settings, apiKey, lastOutcome, plan };
    const latest = useRef(snapshot);
    useLayoutEffect(() => { latest.current = snapshot; });
    const lang = (): VoiceLanguage => latest.current.settings.language;

    /** Free plan: a voice session (10 minutes) must be running; starting one uses an ad's session, else today's free one. */
    async function ensureVoiceSession(): Promise<boolean> {
        const { isPro: pro, plan: p } = latest.current;
        if (pro || voiceSessionActive(p.cache)) return true;
        if (usesLeft(p.cache, 'voice') + freeLeft(p.cache, 'voice') <= 0) {
            setError(VOICE_PRO_MESSAGE);
            return false;
        }
        const used = await p.consume('voice');
        if (!used.ok) {
            setError(`Could not start a voice session: ${used.error ?? 'unknown error'}`);
            return false;
        }
        return true;
    }

    // Replies to something you said are always spoken (unless muted); fill news only with "Talk back" on
    const reply = (text: string) => void speak(text);
    const talk = (text: string) => { if (latest.current.settings.talkBack) void speak(text); };

    // The orb's finish state fades after a while
    useEffect(() => {
        if (!finishNote) return;
        const timer = setTimeout(() => setFinishNote(null), finishNote.state === 'speaking' ? 4000 : 15000);
        return () => clearTimeout(timer);
    }, [finishNote]);

    // -------------------------------------------------------------------
    // Filling
    // -------------------------------------------------------------------
    const fillRun = useRef<Promise<void> | null>(null);
    const filling = () => Boolean(fillRun.current) || latest.current.isFilling;

    /** Starts a fill and says how it went when it ends. `spoken`: asked by voice, so the answer is always spoken. */
    function startFill(options: { target?: FillTarget; paginate?: boolean }, spoken: boolean): Promise<void> {
        const { currentProfile: profile, profiles: all, isPro: pro, selectedProfileType: profileKey } = latest.current;
        const say_ = spoken ? reply : talk;
        if (filling()) { say_(say.busy(lang())); return Promise.resolve(); }
        if (!profile.enabled) { say_(say.profileOff(profile.profileName || profile.profileType, lang())); return Promise.resolve(); }
        if (pausedProfileKeys(all, latest.current.plan.access.profileLimit).includes(profileKey)) { say_(say.profileLimit(latest.current.plan.access.profileLimit, lang())); return Promise.resolve(); }
        if (options.paginate && !(pro || latest.current.plan.access.paginate)) { say_(say.proOnly(lang())); return Promise.resolve(); }
        // Targeted fills are quick: their result is the only line. A whole page gets "On it" first.
        if (!options.target) say_(options.paginate ? say.startingAll(lang()) : say.starting(lang()));
        setError('');
        setFinishNote(null);
        const run = actions.fill(options).then((filledOutcome) => {
            const outcome = options.target?.value ? { ...filledOutcome, dictated: options.target.value } : filledOutcome;
            setLastOutcome(outcome);
            const left = outcome.left.length;
            setFinishNote(!outcome.ok ? { state: 'idle', caption: outcome.error || 'That did not work.' }
                : left ? { state: 'listening', caption: `${left} question${left === 1 ? '' : 's'} left for you` }
                    : { state: 'speaking', caption: `${outcome.filled} field${outcome.filled === 1 ? '' : 's'} filled` });
            say_(say.finished(outcome, lang()));
        }).finally(() => { fillRun.current = null; });
        fillRun.current = run;
        return run;
    }

    // -------------------------------------------------------------------
    // Commands
    // -------------------------------------------------------------------
    const profileRefs = (): ProfileRef[] => Object.values(latest.current.profiles)
        .map(p => ({ key: p.profileType, name: p.profileName || p.profileType }));

    // The page's questions, read as soon as the user stops talking (while the speech is being transcribed)
    const pageQuestionsRef = useRef<Promise<PageQuestions> | null>(null);
    const readPageQuestions = () => {
        pageQuestionsRef.current = actions.pageQuestions().catch(() => ({ frameId: 0, questions: [] }));
    };

    /**
     * Text → commands, AI first: Gemini reads what was said together with the page's questions and decides the
     * actions and the exact questions. "Stop", "stop talking", "end conversation" and "mute" on their own run at
     * once. Without a Gemini key, or when it can't be reached, the built-in rules decide.
     */
    async function understand(text: string): Promise<VoiceCommand[]> {
        if (!text.trim()) return [];
        const refs = profileRefs();
        const byRules = matchCommands(text, refs).map(c => c.intent === 'fill_field' || c.intent === 'answer' ? { ...c, said: text } : c);
        const words = withoutFillers(text).split(/\s+/).filter(Boolean).length;
        if (byRules.length === 1 && INSTANT.has(byRules[0].intent) && words <= 6) return byRules;

        const list = await (pageQuestionsRef.current ?? actions.pageQuestions().catch(() => ({ frameId: 0, questions: [] })));
        pageQuestionsRef.current = null;
        try {
            const state = latest.current;
            const ai = await chrome.runtime.sendMessage({
                action: 'UNDERSTAND_VOICE',
                text,
                profiles: refs.map(r => r.name),
                currentProfile: state.currentProfile.profileName || state.currentProfile.profileType,
                questions: list.questions
            });
            if (ai && !ai.error && Array.isArray(ai.commands)) return checkAiCommands(ai.commands, list, text, refs);
            if (ai?.error) console.info('[Aullevo:Voice] AI unavailable, using the built-in rules:', ai.error);
        } catch (err) {
            console.info('[Aullevo:Voice] AI unavailable, using the built-in rules:', err);
        }
        return byRules;
    }

    // In a live conversation the loop is set; "stop" with nothing filling ends it
    const live = useRef(false);
    const ear = useRef<Ear | null>(null);
    const endLive = () => {
        live.current = false;
        ear.current?.stop();
    };

    /** Runs commands in order. A fill followed by more ("fill the email, then next") finishes before the next one. */
    async function runAll(commands: VoiceCommand[]) {
        for (const [i, command] of commands.entries()) {
            if (command.intent === 'end_live' || (command.intent === 'stop' && live.current && !filling() && !isSpeaking())) {
                endLive();
                return;
            }
            await performRef.current(command);
            if (i < commands.length - 1) {
                if (fillRun.current) await fillRun.current;
                await waitUntilQuiet();
            }
        }
    }

    async function perform(command: VoiceCommand): Promise<void> {
        const language = lang();
        const state = latest.current;
        const profileName = state.currentProfile.profileName || state.currentProfile.profileType;
        switch (command.intent) {
            case 'fill': return void startFill({}, true);
            case 'fill_all': return void startFill({ paginate: true }, true);
            case 'fill_field': return void startFill({
                target: command.questionIndices?.length
                    ? { indices: command.questionIndices, questionTexts: command.questionTexts, texts: command.questionTexts, frameId: command.frameId, said: command.said }
                    : { texts: command.targets?.length ? command.targets : [], said: command.said }
            }, true);
            case 'fill_focused': return void startFill({ target: { focused: true } }, true);
            case 'answer': {
                if (!command.value) return reply(say.answerHow(language));
                const target = command.questionIndices?.length
                    ? { indices: command.questionIndices, questionTexts: command.questionTexts, texts: command.questionTexts, frameId: command.frameId }
                    : command.targets?.length ? { texts: command.targets } : { focused: true };
                return void startFill({ target: { ...target, said: command.said, value: command.value } }, true);
            }
            case 'stop': {
                const wasTalking = isSpeaking();
                stopSpeaking();
                if (filling()) {
                    await actions.cancelFill();
                    return reply(say.stopping(language)); // the fill's own summary then says "stopped"
                }
                if (wasTalking) return; // "stop" while it talks just cuts it off
                return reply(say.stopped(language));
            }
            case 'hush': return void stopSpeaking();
            case 'next': case 'submit': {
                if (filling()) return reply(say.busy(language));
                const result = await actions.advance(command.intent === 'submit');
                return reply(say.advance(result, language));
            }
            case 'left': return reply(say.left(state.lastOutcome?.left ?? [], language));

            case 'highlight': case 'clear_highlight': {
                const result = await actions.setHighlight(command.intent === 'highlight');
                if (command.intent === 'clear_highlight') return reply(say.highlightsCleared(language));
                return reply(say.highlighted(result?.count ?? 0, language));
            }
            case 'rescan': return reply(say.scanned(await actions.rescan(), language));

            case 'profile': {
                const target = command.profileKey ? state.profiles[command.profileKey] : undefined;
                if (!target) return reply(say.notUnderstood(language));
                if (filling()) return reply(say.busy(language));
                actions.selectProfile(target.profileType);
                return reply(say.profile(target.profileName || target.profileType, language));
            }
            case 'profiles': return reply(say.profiles(profileName, profileRefs().map(r => r.name), language));
            case 'create_profile': {
                if (!command.name?.trim()) return reply(say.profileNameNeeded(language));
                const result = actions.createProfile(command.name);
                if (!result) return reply(say.profileNameNeeded(language));
                if (!result.created) return reply(say.profileExists(command.name, language));
                const note = result.enabled ? '' : ` ${say.profileLimit(state.plan.access.profileLimit, language)}`;
                return reply(say.profileCreated(command.name, language) + note);
            }
            case 'set_field': {
                if (!command.label || !command.value) return reply(say.notUnderstood(language));
                const result = actions.setField(command.label, command.value);
                return reply(result.status === 'updated'
                    ? say.fieldUpdated(result.label, command.value, language)
                    : `${say.fieldAdded(result.label, language)} ${say.fieldUpdated(result.label, command.value, language)}`);
            }
            case 'enable_profile': {
                if (!state.currentProfile.enabled && countActiveProfiles(state.profiles, state.selectedProfileType) >= state.plan.access.profileLimit) {
                    return reply(say.profileLimit(state.plan.access.profileLimit, language));
                }
                actions.setProfileEnabled(true);
                return reply(say.profileOn(profileName, language));
            }
            case 'disable_profile': {
                actions.setProfileEnabled(false);
                return reply(say.profileOffDone(profileName, language));
            }

            case 'add_link': {
                const url = await actions.activeTabUrl();
                if (!url || !/^https?:\/\//i.test(url)) return reply(say.noPageToAdd(language));
                if (state.savedLinks.some(link => link.url === url)) return reply(say.linkExists(language));
                actions.addLink(url);
                return reply(say.linkAdded(new URL(url).hostname.replace(/^www\./, ''), language));
            }
            case 'fill_links': {
                if (filling()) return reply(say.busy(language));
                const count = actions.startBatchFill();
                return reply(count ? say.startingLinks(count, language) : say.noLinks(language));
            }

            case 'open': {
                const page = command.page ?? 'settings';
                if (page === 'voice_settings') {
                    setSettingsOpen(true);
                    return reply(say.opening(page, language));
                }
                reply(say.opening(page, language));
                return actions.open(page);
            }
            case 'ai_on': case 'ai_off': {
                actions.setAiFill(command.intent === 'ai_on');
                return reply(command.intent === 'ai_on' ? say.aiOn(language) : say.aiOff(language));
            }
            case 'dark': case 'light': {
                actions.setDark(command.intent === 'dark');
                return reply(command.intent === 'dark' ? say.dark(language) : say.light(language));
            }
            case 'mute': {
                stopSpeaking();
                setOrbSoundMuted(true);
                return setMuted(true);
            }
            case 'unmute': {
                setOrbSoundMuted(false);
                setMuted(false);
                return reply(say.unmuted(language));
            }
            case 'english': case 'tagalog': {
                const next: VoiceLanguage = command.intent === 'tagalog' ? 'tl' : 'en';
                updateSettings({ language: next });
                return void speak(next === 'tl' ? say.tagalog() : say.english());
            }
            case 'help': return reply(say.help(language));
            default: return reply(say.notUnderstood(language));
        }
    }
    const performRef = useRef(perform);
    useLayoutEffect(() => { performRef.current = perform; });

    // -------------------------------------------------------------------
    // Listening
    // -------------------------------------------------------------------
    function handleEarError(caught: unknown) {
        if (caught instanceof VoiceKeyMissingError) {
            setSettingsOpen(true);
            setError(caught.message);
            return reply(caught.message);
        }
        if (caught instanceof MicrophoneBlockedError) {
            // Only a missing permission (or the computer blocking Chrome) needs the setup page; one page, reused
            if (caught.reason === 'permission' || caught.reason === 'system') {
                reply(caught.reason === 'system' ? say.micSystem(lang()) : say.micBlocked(lang()));
                void openMicrophoneSetup();
                return;
            }
            const text = caught.reason === 'missing' ? say.micMissing(lang()) : caught.reason === 'busy' ? say.micBusy(lang()) : say.voiceError(lang());
            setError(text);
            return reply(text);
        }
        setError(caught instanceof Error ? caught.message : String(caught));
        reply(say.voiceError(lang()));
    }

    /** Push-to-talk: one command, then the microphone closes. Tapping again ends it early. */
    async function listenOnce() {
        if (ear.current) return ear.current.stop();
        if (!(await ensureVoiceSession())) return;
        stopSpeaking();
        setError('');
        setHeard('');
        setLiveNote('');
        let opened: Ear;
        try {
            opened = await openEar(latest.current.apiKey);
        } catch (caught) {
            return handleEarError(caught);
        }
        ear.current = opened;
        setPhase('listening');
        let text: string | null;
        try {
            text = await opened.next({ onCaptured: () => { setPhase('understanding'); readPageQuestions(); } });
        } catch (caught) {
            setPhase('idle');
            return handleEarError(caught);
        } finally {
            opened.close();
            ear.current = null;
        }
        if (!text || PHANTOM.test(text)) {
            setPhase('idle');
            return reply(say.heardNothing(lang()));
        }
        setHeard(text);
        setPhase('understanding');
        const commands = await understand(text);
        setUnderstood(describeCommands(commands));
        setPhase('idle');
        await runAll(commands.length ? commands : [{ intent: 'none' }]);
    }

    /**
     * Live conversation: listen → understand → act → listen again, until "end conversation", a tap on the mic, or
     * 2 quiet minutes. It keeps listening while the agent talks, so "stop talking" cuts it off.
     */
    async function liveSession() {
        if (live.current) return endLive();
        if (!(await ensureVoiceSession())) return;
        live.current = true;
        setLiveOn(true);
        stopSpeaking();
        setError('');
        setHeard('');
        setLiveNote('');
        void speak(say.liveOn(lang()));
        await waitUntilQuiet();
        let quietRounds = 0;
        let ended: 'off' | 'timeout' | 'error' = 'off';
        let opened: Ear | null = null;
        try {
            // One microphone for the whole session; it keeps listening while a fill runs, so "stop" works
            opened = await openEar(latest.current.apiKey);
            ear.current = opened;
            while (live.current) {
                setPhase('listening');
                const takeStarted = Date.now();
                const talkingAtStart = isSpeaking();
                // When the agent finishes talking during this recording, the recording ends there, so the user's
                // turn always starts fresh. Without this, a command said after the agent's reply landed in the same
                // recording as the reply and was only checked for "stop talking". Speech heard while it talked is
                // kept (it may be "stop talking"); silence is thrown away.
                let cutAtSpeechEnd = false;
                const unsubscribe = onSpeechEnd(() => {
                    cutAtSpeechEnd = true;
                    if (opened!.hearing()) opened!.stop(); else opened!.cancel();
                });
                let text: string | null;
                try {
                    text = await opened.next({ waitMs: 12000, maxMs: 12000, pauseMs: 900, onCaptured: () => { setPhase('understanding'); readPageQuestions(); } });
                } finally {
                    unsubscribe();
                }
                if (!live.current) break;
                if (!text) {
                    // Quiet while the agent talks doesn't count toward ending the session
                    if (!talkingAtStart && !cutAtSpeechEnd && ++quietRounds >= 10) { ended = 'timeout'; break; } // ends quietly, never speaks up on its own
                    continue;
                }
                quietRounds = 0;
                if (PHANTOM.test(text)) continue;
                // The agent talked during this recording: only "stop talking", "stop", "end conversation" or "mute" count
                if (talkingAtStart || cutAtSpeechEnd || isSpeaking() || lastSpokeAt() > takeStarted) {
                    if (soundsLikeAgent(text, lastSpokenLine())) continue;
                    const interrupt = matchCommands(text, profileRefs()).find(c => INTERRUPTS.has(c.intent));
                    if (interrupt) {
                        setHeard(text);
                        await runAll([interrupt]);
                    }
                    continue;
                }
                setHeard(text);
                setPhase('understanding');
                const commands = await understand(text);
                setUnderstood(describeCommands(commands));
                setPhase('idle');
                // Background talk that isn't a command is ignored silently (it still shows under "You said")
                if (!commands.length) continue;
                await runAll(commands);
            }
        } catch (caught) {
            ended = 'error';
            handleEarError(caught);
        } finally {
            opened?.close();
            ear.current = null;
            live.current = false;
            setLiveOn(false);
            setPhase('idle');
        }
        if (ended === 'timeout') setLiveNote(say.liveTimeout(lang()));
        else if (ended === 'off') void speak(say.liveOff(lang()));
    }

    // Pro ended (or the account changed) while Voice mode was open: stop listening and talking at once
    useEffect(() => {
        if (!locked) return;
        live.current = false;
        ear.current?.close();
        stopSpeaking();
    }, [locked]);

    // Closing the voice view ends listening (a reply that is playing finishes)
    useEffect(() => () => {
        live.current = false;
        ear.current?.close();
    }, []);

    // Esc stops the agent talking
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') stopSpeaking(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // Interrupt: a tap on the orb or the mic while the agent talks only stops the talking
    const hush = () => {
        if (!speech.speaking) return false;
        stopSpeaking();
        return true;
    };

    // -------------------------------------------------------------------
    // Voice settings: ElevenLabs key and voice
    // -------------------------------------------------------------------
    const [showKey, setShowKey] = useState(false);
    const [voices, setVoices] = useState<ElevenVoice[]>([]);
    const [keyStatus, setKeyStatus] = useState<{ text: string; ok: boolean } | null>(null);
    const [checking, setChecking] = useState(false);
    const [voiceIdDraft, setVoiceIdDraft] = useState('');
    const applyVoiceId = () => {
        const id = voiceIdDraft.trim();
        if (!id) return;
        updateSettings({ voiceId: id });
        setVoiceIdDraft('');
    };
    useEffect(() => {
        if (!apiKey) return;
        listVoices(apiKey).then(setVoices).catch((err) => {
            // A key without "Voices: Read" works with the default voice: nothing to warn about
            if (!(err instanceof ElevenLabsError && err.code === 'missing_permissions')) setKeyStatus({ text: err.message, ok: false });
        });
    }, [apiKey]);

    async function saveKey() {
        const key = keyDraft.trim();
        setKeyStatus(null);
        if (!key) {
            await writeVault({ elevenLabsApiKey: '' }).catch(() => { });
            setApiKey('');
            setKeyStatus({ text: 'Key removed. Voice needs an ElevenLabs key; the orb and buttons still work.', ok: true });
            return;
        }
        setChecking(true);
        try {
            const list = await listVoices(key);
            await writeVault({ elevenLabsApiKey: key });
            setApiKey(key);
            setVoices(list);
            setKeyStatus({ text: `Connected · ${list.length} voice${list.length === 1 ? '' : 's'} on your account`, ok: true });
        } catch (err) {
            // A key made without "Voices: Read" still does speech-to-text and speech: keep it (the preset voices work)
            if (err instanceof ElevenLabsError && err.code === 'missing_permissions') {
                await writeVault({ elevenLabsApiKey: key });
                setApiKey(key);
                setVoices([]);
                setKeyStatus({ text: 'Saved. Pick a voice below. (To also see your own voices, allow Voices → Read on the key.)', ok: true });
            } else {
                setKeyStatus({ text: err instanceof Error ? err.message : String(err), ok: false });
            }
        } finally {
            setChecking(false);
        }
    }

    // -------------------------------------------------------------------
    // Render
    // -------------------------------------------------------------------
    const language = settings.language;
    // While a live conversation listens, the agent's own line and a running fill still show
    const orbState: OrbState = phase === 'understanding' ? 'transcribing'
        : speech.speaking ? 'speaking'
            : isFilling ? 'thinking'
                : phase === 'listening' ? 'listening'
                    : finishNote?.state ?? 'idle';
    const caption = phase === 'understanding' ? say.understanding(language)
        : speech.speaking ? speech.text
            : isFilling ? (liveOn ? 'Filling… say "stop" to cancel' : 'Filling…')
                : phase === 'listening' ? (liveOn ? say.liveListening(language) : say.listening(language))
                    : finishNote?.caption ?? (currentProfile.enabled ? 'Tap the mic and speak, or click the orb to autofill' : `${currentProfile.profileName || currentProfile.profileType} is switched off`);

    const micActive = phase === 'listening' || liveOn;
    const micLabel = liveOn ? 'End live conversation' : phase === 'listening' ? 'Stop listening' : settings.live ? 'Start live conversation' : 'Speak a command';
    const micButton = locked ? (
        <button title={VOICE_PRO_MESSAGE} aria-label={VOICE_PRO_MESSAGE} disabled>
            <Lock size={13} />
        </button>
    ) : (
        <button title={micLabel} aria-label={micLabel} aria-pressed={micActive} data-live={liveOn || undefined}
            disabled={phase === 'understanding' && !liveOn}
            onClick={() => { if (!hush()) void (settings.live || liveOn ? liveSession() : listenOnce()); }}>
            <Mic size={14} />
        </button>
    );

    // Free: the orb can be seen, not used
    if (locked) {
        return (
            <div className={styles.view} style={themeVars(theme) as CSSProperties}>
                <Orb state="idle" caption="Watch a short ad or upgrade to use Voice mode" disabled muted={muted} extra={micButton}
                    onToggleMute={() => { setOrbSoundMuted(!muted); setMuted(!muted); }}
                    onActivate={() => undefined} />
                <section className={`${styles.card} ${styles.proLock}`} aria-label="Voice mode is a Pro feature">
                    <div className={styles.proBadge}><Crown size={12} /> Pro feature</div>
                    <h3>Talk to Aullevo with Voice mode</h3>
                    <ul>
                        <li>Fill a page, one question, or "the first question" just by saying it</li>
                        <li>Dictate your own answers: "answer the gym question with…"</li>
                        <li>Hands-free live conversation, in English or Tagalog</li>
                        <li>A natural ElevenLabs voice that tells you what it did</li>
                    </ul>
                    <PlanUnlock feature="voice" reason="Watch a 1-minute ad for 2 voice sessions (10 minutes each) in the next 2 hours." />
                    <a className={styles.cta} href={AULLEVO_WEB_URL} target="_blank" rel="noreferrer"><Crown size={14} /> Upgrade to Pro for unlimited voice</a>
                    <button className={styles.secondaryAction} onClick={() => actions.open('classic')}>Back to the classic view</button>
                    <p className={styles.hint}>Already Pro? Sign in on Aullevo Web and the extension unlocks Voice mode.</p>
                </section>
            </div>
        );
    }

    const engine = apiKey ? 'ElevenLabs · Scribe + voice' : 'Add your ElevenLabs key';
    const voiceError = getVoiceError();
    const fallbackNote = getVoiceFallbackNote();
    // Presets (any key can use them), then the account's own voices, then a pasted ID
    const voiceChoices: ElevenVoice[] = [
        ...PRESET_VOICES,
        ...voices.filter(v => !PRESET_VOICES.some(p => p.id === v.id)),
    ];
    if (!voiceChoices.some(v => v.id === settings.voiceId)) voiceChoices.push({ id: settings.voiceId, name: `Custom · ${settings.voiceId}` });
    const sortedProfiles = Object.values(profiles);
    const chip = (pressed: boolean, label: ReactNode, title: string, onClick: () => void, disabled = false) => (
        <button type="button" className={styles.chip} aria-pressed={pressed} title={title} disabled={disabled} onClick={onClick}>{label}</button>
    );

    return (
        <div className={styles.view} style={themeVars(theme) as CSSProperties}>
            <Orb state={orbState} caption={caption} disabled={isFilling} muted={muted} extra={micButton}
                onToggleMute={() => { if (!muted) stopSpeaking(); setOrbSoundMuted(!muted); setMuted(!muted); }}
                onActivate={() => { if (!hush()) void startFill(allPages ? { paginate: true } : {}, false); }} />

            {!isPro && <PlanUnlock feature="voice" />}

            <section className={styles.card} aria-label="Autofill">
                <div className={styles.head}>
                    <span className={styles.kicker}>Autofill</span>
                    <label className={styles.profile} title="Active profile">
                        <UserRound size={12} aria-hidden="true" />
                        <select aria-label="Active profile" value={selectedProfileType} disabled={isFilling} onChange={e => actions.selectProfile(e.target.value)}>
                            {sortedProfiles.map(p => (
                                <option key={p.profileType} value={p.profileType}>{p.profileName || p.profileType}{p.enabled ? '' : ' (off)'}</option>
                            ))}
                        </select>
                    </label>
                </div>
                {isFilling ? (
                    <button className={`${styles.cta} ${styles.stop}`} onClick={() => void performRef.current({ intent: 'stop' })}>
                        <Square size={13} /> Stop filling
                    </button>
                ) : (
                    <button className={styles.cta} disabled={!currentProfile.enabled} onClick={() => void startFill(allPages ? { paginate: true } : {}, false)}>
                        <Play size={14} /> {allPages ? 'Autofill every page' : 'Autofill this page'}
                    </button>
                )}
                <div className={styles.chips} role="group" aria-label="Page and fill options">
                    {chip(isHighlighting, <><ScanSearch size={12} /> Highlight</>, 'Show the fields Aullevo found on this page', () => void actions.setHighlight(!isHighlighting))}
                    {chip(false, <><RefreshCw size={12} /> {detectedFields} fields</>, 'Scan the page again', () => void actions.rescan())}
                    {chip(allPages, <><ChevronsRight size={12} /> Pages</>, (isPro || plan.access.paginate) ? 'Continue through Next pages, then submit' : 'Filling every page needs Pro or a short ad (Settings)', () => setAllPages(!allPages), !(isPro || plan.access.paginate) || isFilling)}
                    {chip(useAiFill, <><Sparkles size={12} /> AI</>, 'Use AI for questions your saved answers do not cover', () => actions.setAiFill(!useAiFill), isFilling)}
                </div>
                {error && <p className={styles.error} role="alert">{error}</p>}
            </section>

            {(heard || lastOutcome || liveNote) && (
                <section className={styles.card} aria-label="Conversation">
                    {heard && <p className={styles.said}>You said <q>{heard}</q></p>}
                    {heard && <p className={styles.hint}>{understood ? `Understood: ${understood}` : 'Not a command: ignored'}</p>}
                    {liveNote && <p className={styles.hint}>{liveNote}</p>}
                    {lastOutcome && lastOutcome.ok && !lastOutcome.target && (
                        <div className={styles.result}>
                            <strong>{lastOutcome.filled}</strong> field{lastOutcome.filled === 1 ? '' : 's'} filled{lastOutcome.usedAi ? ' · with AI' : ''}
                            {lastOutcome.left.length > 0 && (
                                <ul className={styles.left} aria-label="Left for you">
                                    {lastOutcome.left.slice(0, 5).map(q => <li key={q}>{q}</li>)}
                                    {lastOutcome.left.length > 5 && <li>+{lastOutcome.left.length - 5} more</li>}
                                </ul>
                            )}
                        </div>
                    )}
                </section>
            )}

            <section className={styles.card} aria-label="Voice settings">
                <button className={styles.settingsToggle} aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>
                    <Settings2 size={13} />
                    <span>Voice settings</span>
                    <em>{engine}</em>
                </button>
                {settingsOpen && (
                    <div className={styles.settings}>
                        <label className={styles.fieldLabel} htmlFor="av-elevenlabs-key">ElevenLabs API key</label>
                        <div className={styles.keyRow}>
                            <input id="av-elevenlabs-key" type={showKey ? 'text' : 'password'} value={keyDraft} placeholder="sk_…" autoComplete="off" spellCheck={false}
                                onChange={e => setKeyDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void saveKey(); }} />
                            <button className={styles.iconButton} title={showKey ? 'Hide key' : 'Show key'} aria-label={showKey ? 'Hide key' : 'Show key'} onClick={() => setShowKey(!showKey)}>
                                {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                            </button>
                            <button className={styles.save} disabled={checking || keyDraft.trim() === apiKey} onClick={() => void saveKey()}>{checking ? 'Checking…' : 'Save'}</button>
                        </div>
                        {keyStatus && <p className={keyStatus.ok ? styles.ok : styles.error}>{keyStatus.text}</p>}
                        <p className={styles.hint}>Saved encrypted, only in this browser. ElevenLabs hears what you say (Scribe) and gives the agent its voice. The key needs Speech to Text and Text to Speech access.</p>
                        {/* New to API keys: the steps, and a button to the ElevenLabs keys page */}
                        <KeyGuide
                            toggleLabel="How do I get an ElevenLabs key?"
                            defaultOpen={!apiKey}
                            note="ElevenLabs has a free plan with monthly credits, enough to try Voice mode."
                            steps={[
                                <>Click <b>Open ElevenLabs</b> below and sign up or sign in (free).</>,
                                <>On the <b>API keys</b> page, click <b>Create API key</b>.</>,
                                <>Under permissions, allow <b>Speech to Text</b> and <b>Text to Speech</b> (Voices: read too, to pick a voice).</>,
                                <>Copy the key (it starts with <b>sk_</b>), paste it in the box above and press <b>Save</b>.</>
                            ]}
                            link={{ url: 'https://elevenlabs.io/app/settings/api-keys', label: 'Open ElevenLabs' }}
                        />

                        <label className={styles.row}>
                            <span>Voice model</span>
                            <select value={settings.voiceModel} onChange={e => updateSettings({ voiceModel: e.target.value as TtsModel })}>
                                {TTS_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                        </label>
                        <label className={styles.row}>
                            <span>Voice</span>
                            <select value={settings.voiceId} onChange={e => updateSettings({ voiceId: e.target.value })}>
                                {voiceChoices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                            </select>
                        </label>
                        <div className={styles.keyRow}>
                            <input aria-label="ElevenLabs voice ID" value={voiceIdDraft} placeholder="Or paste a voice ID from the Voice Library" spellCheck={false}
                                onChange={e => setVoiceIdDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') applyVoiceId(); }} />
                            <button className={styles.save} disabled={!voiceIdDraft.trim() || voiceIdDraft.trim() === settings.voiceId} onClick={applyVoiceId}>Use</button>
                            <button className={styles.save} disabled={!apiKey} title="Hear the agent's voice" onClick={() => void speak(say.sample(language))}>Test</button>
                        </div>
                        {voiceError && apiKey && <p className={styles.error}>{voiceError}</p>}
                        {!voiceError && apiKey && fallbackNote && <p className={styles.hint}>{fallbackNote}</p>}

                        <div className={styles.row}>
                            <span>Language</span>
                            <div className={styles.segmented} role="radiogroup" aria-label="Voice language">
                                {(['en', 'tl'] as const).map(code => (
                                    <button key={code} type="button" role="radio" aria-checked={language === code} onClick={() => {
                                        if (code === language) return;
                                        updateSettings({ language: code });
                                        void speak(code === 'tl' ? say.tagalog() : say.english());
                                    }}>{code === 'en' ? 'English' : 'Tagalog'}</button>
                                ))}
                            </div>
                        </div>
                        <label className={styles.row} title="Say what happened after each fill">
                            <span>Talk back</span>
                            <input type="checkbox" role="switch" className={styles.switch} checked={settings.talkBack} onChange={e => updateSettings({ talkBack: e.target.checked })} />
                        </label>
                        <label className={styles.row} title='Keep listening: one command after another until you say "end conversation"'>
                            <span>Live conversation <em>keeps listening</em></span>
                            <input type="checkbox" role="switch" className={styles.switch} checked={settings.live} disabled={liveOn} onChange={e => updateSettings({ live: e.target.checked })} />
                        </label>
                        <div className={styles.row}>
                            <span>Microphone</span>
                            <button className={styles.link} onClick={() => void openMicrophoneSetup()}>Check access</button>
                        </div>
                        <p className={styles.hint}>Commands the agent doesn't recognise are worked out by your AI model when AI is set up (your API key in Settings). Only what you said and your profile names are sent, never your saved values.</p>
                    </div>
                )}
            </section>

            <p className={styles.footerHint}>
                {speech.speaking ? 'Tap the orb or the mic, or press Esc, to stop it talking'
                    : liveOn ? 'Live: say a command · "stop talking" cuts me off · "end conversation" to finish'
                        : 'Tap the mic and say "help" to hear what the agent can do'}
            </p>
        </div>
    );
}
