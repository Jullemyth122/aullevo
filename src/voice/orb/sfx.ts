// Orb start-up sound: a pre-mixed sound file bundled with the extension, played
// through Web Audio. Nothing is generated or fetched from the network.

const STARTUP_URL = 'sounds/orb-startup.mp3';
const MUTE_KEY = 'aullevo.orb.muted';

/** Second at which the core lights up in the start-up sound. */
export const ORB_IGNITION_TIME = 3.09;
/** Hit times in the start-up sound (seconds), measured from its waveform. Replace these if the file changes. */
export const ORB_CUES = {
  // Ten separate clanks, then the first hit of the burst: rings 1-11 lock.
  locks: [0.29, 0.54, 0.7, 0.92, 1.09, 1.265, 1.42, 1.55, 1.66, 1.815, 2.22],
  // The rest of the burst: the orb jolts on each hit while the outer rings twist into alignment.
  grind: [2.325, 2.41, 2.485, 2.555, 2.625, 2.725, 2.82, 2.915, 2.98],
  twist: [2.3, 3.0] as const,
  // The lone hit near the end: one last pulse.
  pulses: [4.4],
};

let ctx: AudioContext | null = null;
let level: GainNode | null = null;
let muted = readMuted();
const active = new Set<() => void>();

function readMuted() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

export const isOrbSoundMuted = () => muted;

export function setOrbSoundMuted(value: boolean) {
  muted = value;
  try { localStorage.setItem(MUTE_KEY, value ? '1' : '0'); } catch { /* sound stays on next time */ }
  if (ctx && level) {
    level.gain.cancelScheduledValues(ctx.currentTime);
    level.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.015);
  }
  if (muted) for (const stop of active) stop();
}

function context() {
  if (!ctx) {
    ctx = new AudioContext();
    level = ctx.createGain();
    level.gain.value = muted ? 0 : 1;
    level.connect(ctx.destination);
  }
  return ctx;
}

async function open() {
  if (muted) return null;
  try {
    const ac = context();
    if (ac.state !== 'running') await Promise.race([ac.resume(), new Promise(resolve => setTimeout(resolve, 200))]);
    return ac.state === 'running' && !muted ? ac : null;
  } catch {
    return null;
  }
}

// Chrome blocks sound until the panel gets a click or key press. Audio can only
// be unlocked inside that gesture, so listen for the first one and tell anyone
// waiting once sound is allowed.
const waiters = new Set<() => void>();
const GESTURES = ['pointerdown', 'keydown', 'click'] as const;
function unlock() {
  const ac = context();
  ac.resume().then(() => {
    if (ac.state !== 'running') return;
    GESTURES.forEach(type => window.removeEventListener(type, unlock, true));
    const pending = [...waiters];
    waiters.clear();
    pending.forEach(fn => fn());
  }).catch(() => {});
}

export function whenOrbSoundUnlocked(fn: () => void) {
  if (!waiters.size) GESTURES.forEach(type => window.addEventListener(type, unlock, true));
  waiters.add(fn);
  return () => {
    waiters.delete(fn);
    if (!waiters.size) GESTURES.forEach(type => window.removeEventListener(type, unlock, true));
  };
}

// Fetched once as soon as this module loads, decoded once.
const download = fetch(STARTUP_URL).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
let decoded: Promise<AudioBuffer | null> | null = null;
const decode = (ac: AudioContext) => decoded ??= download.then(data => (data ? ac.decodeAudioData(data.slice(0)) : null)).catch(() => null);

/**
 * Plays the start-up sound. If loading took a moment, it starts that far in, so it
 * stays in step with an animation that has already begun. Returns a stop function
 * that works even before the audio has started; `onBlocked` runs when Chrome refused sound.
 */
export function playOrbAssembly(onBlocked?: () => void) {
  const requested = performance.now();
  let cancelled = false, stop: (() => void) | null = null;
  void open().then(async ac => {
    if (cancelled) return;
    if (!ac) { if (!muted) onBlocked?.(); return; }
    const buffer = await decode(ac);
    if (cancelled || !buffer || !level) return;
    const offset = (performance.now() - requested) / 1000;
    if (offset >= buffer.duration) return;
    const out = ac.createGain(), src = ac.createBufferSource();
    src.buffer = buffer;
    src.connect(out).connect(level);
    src.start(ac.currentTime + 0.01, offset);
    stop = () => {
      const t = ac.currentTime;
      out.gain.setTargetAtTime(0, t, 0.04);
      try { src.stop(t + 0.15); } catch { /* already stopped */ }
      active.delete(stop!);
    };
    src.onended = () => { src.disconnect(); out.disconnect(); if (stop) active.delete(stop); };
    active.add(stop);
  });
  return () => { cancelled = true; stop?.(); };
}
