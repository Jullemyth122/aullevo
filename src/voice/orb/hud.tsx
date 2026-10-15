import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, DoubleSide, PlaneGeometry, ShaderMaterial, type Group, type Mesh } from 'three';
import { Dust, Rig, clamp01, useDrive, type OrbDrive, type OrbPointer, type OrbState } from './parts';
import type { OrbTheme } from './themes';
import { ORB_CUES, ORB_IGNITION_TIME, playOrbAssembly, whenOrbSoundUnlocked } from './sfx';

// HUD: flat, layered rings in the style of a heads-up display. Neighbouring
// rings counter-rotate and "click" forward on springs, re-locking in a cascade
// on every state change; on mount the stack assembles itself from an exploded,
// tilted view, in step with the start-up sound.

const TAU = Math.PI * 2;
const BARS = 48;
const ease = (v: number) => 1 - (1 - clamp01(v)) ** 3;

// Jolts timed to hits in the start-up sound file: [seconds, strength].
const KICKS: [number, number][] = [
  ...ORB_CUES.locks.map((t): [number, number] => [t, 0.16]),
  ...ORB_CUES.grind.map((t): [number, number] => [t, 0.1]),
  [ORB_IGNITION_TIME, 0.65],
  ...ORB_CUES.pulses.map((t): [number, number] => [t, 0.5]),
];

// States that let the start-up sequence play on: getting the model ready is background work, a fill is not.
const calm = (state: OrbState) => state === 'idle' || state === 'transcribing';

// Mean seconds between ring clicks in each state.
const CADENCE: Record<OrbState, number> = { idle: 4.5, listening: 1.6, speaking: 0.9, thinking: 0.38, transcribing: 0.55 };

// Shared HUD clock: start-up progress, state-change cascades, radar sweep,
// ripple phase and a spectrum synthesised from the single level signal.
class HudDrive {
  readonly reduced: boolean;
  clock: number;
  state: OrbState | null = null;
  soundAttempted = false;
  replay = false;
  sound: (() => void) | null = null;
  unsubscribe: (() => void) | null = null;
  shift = 0; // bumps on every state change; layers re-lock when they see it
  engage = 1; // ring steps per re-lock; doubled when work starts or ends
  flow = 1; // eases to -1 while listening, flipping the arrow arcs
  readonly bars = new Float32Array(BARS);
  readonly uniforms = { uSweep: { value: 0 }, uRipple: { value: 0 }, uListen: { value: 0 }, uSpeak: { value: 0 }, uBars: { value: this.bars } };
  constructor(reduced: boolean) {
    this.reduced = reduced;
    this.clock = reduced ? 10 : 0;
  }
  get boot() { return clamp01(this.clock / ORB_IGNITION_TIME); }
  update(u: OrbDrive, state: OrbState, level: number) {
    const dt = u.step, h = this.uniforms;
    // Sound starts with the first frame, so it stays in step with the visuals.
    // If Chrome blocked it, the start-up replays with sound on the first click
    // or key press, unless that gesture already started work.
    if (!this.soundAttempted) {
      this.soundAttempted = true;
      if (!this.reduced && calm(state)) {
        this.sound = playOrbAssembly(() => {
          if (this.state && calm(this.state)) this.unsubscribe = whenOrbSoundUnlocked(() => { this.replay = true; });
        });
      }
      if (!calm(state)) this.clock = Math.max(this.clock, ORB_IGNITION_TIME + 0.2);
    }
    if (this.replay) {
      this.replay = false;
      if (calm(state)) { this.clock = 0; this.sound = playOrbAssembly(); }
    }
    const before = this.clock;
    this.clock += dt;
    if (!this.reduced) {
      for (const [at, strength] of KICKS) {
        if (before < at && this.clock >= at) u.uniforms.uBurst.value = Math.max(u.uniforms.uBurst.value, strength);
      }
    }
    if (state !== this.state) {
      if (this.state) {
        this.shift++;
        this.engage = this.state === 'idle' || state === 'idle' ? 2 : 1;
        // A fill always takes priority, even in the first boot frame.
        if (!calm(state)) {
          this.sound?.(); this.unsubscribe?.(); this.unsubscribe = null; this.replay = false;
          this.clock = Math.max(this.clock, ORB_IGNITION_TIME + 0.2);
        }
      }
      this.state = state;
    }
    const listening = state === 'listening', speaking = state === 'speaking';
    const k = 1 - Math.exp(-dt * 4);
    h.uListen.value += ((listening ? 1 : 0) - h.uListen.value) * k;
    h.uSpeak.value += ((speaking ? 1 : 0) - h.uSpeak.value) * k;
    this.flow += ((listening ? -1 : 1) - this.flow) * k;
    const e = u.energy, busy = u.busy, t = this.clock;
    h.uSweep.value = (h.uSweep.value + dt * (0.06 + busy * 0.5 + e * 0.12)) % 1;
    // Ripples run outward while speaking and inward while listening.
    h.uRipple.value += dt * (0.22 + h.uSpeak.value * (0.6 + e * 1.4) - h.uListen.value * (0.9 + e * 1.2));
    const voice = listening || speaking ? Math.sqrt(clamp01(level)) : 0;
    const scan = 1 - Math.abs(((t * 0.5) % 1) * 2 - 1);
    for (let i = 0; i < BARS; i++) {
      const x = i / (BARS - 1);
      const n = 0.5 + 0.5 * Math.sin(t * 7.3 + i * 1.91) * Math.sin(t * 3.7 - i * 0.83 + Math.sin(i * 12.7) * 3);
      const target = Math.max(
        voice * (0.2 + 0.8 * n * n) * (0.55 + 0.45 * Math.sin(Math.PI * x)),
        busy * 0.62 * (0.5 + 0.5 * Math.cos((x - scan) * TAU)) ** 16,
        0.05 + 0.04 * Math.sin(t * 1.4 + i * 0.45),
      );
      this.bars[i] += (target - this.bars[i]) * (1 - Math.exp(-dt * (target > this.bars[i] ? 24 : 5)));
    }
  }
}

function useHud(u: OrbDrive, state: OrbState, levelRef: RefObject<number>) {
  const hud = useMemo(() => new HudDrive(u.reduced), [u]);
  useEffect(() => () => { hud.sound?.(); hud.unsubscribe?.(); }, [hud]);
  useFrame(() => hud.update(u, state, levelRef.current));
  return hud;
}

const OUTPUT = '#include <colorspace_fragment>';

const VERTEX = `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PRELUDE = `
  uniform float uTime, uEnergy, uBusy, uBurst, uSweep, uRipple, uListen, uSpeak;
  uniform float uReveal, uTurn, uOpacity, uFine, uAccentMix;
  uniform vec3 uBase, uHot, uAccent;
  varying vec2 vPos;
  #define TAU 6.28318530718
  // Assign each ring one of the two colors; keep highlights from washing them out.
  vec3 hudColor(float heat) { return mix(mix(uBase, uAccent, uAccentMix), uHot, clamp(heat, 0.0, 1.0) * 0.42) * 1.35; }
  float hash(float n) { return fract(sin(n * 12.9898 + 78.233) * 43758.5453); }
  // Angle as a fraction of a turn, clockwise from 12 o'clock.
  float turn01(vec2 p) { return fract(atan(p.x, p.y) / TAU); }
  float ringLine(float r, float at, float w, float px) { return 1.0 - smoothstep(w * 0.5, w * 0.5 + px, abs(r - at)); }
  // Start-up: each layer is drawn in clockwise behind a bright write head,
  // flickering like a display warming up.
  float drawn(float a) { return 1.0 - smoothstep(uReveal - 0.015, uReveal, a * 0.985); }
  float writeHead(float a) { float d = uReveal - a; return step(0.0, d) * exp(-d * 16.0) * (1.0 - smoothstep(0.8, 1.0, uReveal)); }
  float power() { return mix(0.3 + 0.7 * step(0.35, hash(floor(uTime * 37.0))), 1.0, smoothstep(0.55, 0.95, uReveal)); }
  // Radar highlight just behind the sweep line, in world angle.
  float swept(float a) { return exp(-fract(uSweep - fract(a - uTurn)) * 9.0); }
  // Fine detail fades out when the orb is drawn small.
  float detail(float px) { return mix(1.0, 1.0 - smoothstep(0.012, 0.03, px), uFine); }
`;

// Solid, dashed, ticked or block-segmented ring, optionally a partial arc.
const RING = `
  uniform float uInner, uOuter, uArc, uSegments, uDuty, uDrop, uSeed, uFlicker, uOutline, uMajor, uMinor, uPips;
  void main() {
    float r = length(vPos), px = length(fwidth(vPos)), a = turn01(vPos);
    float aa = px / (TAU * max(r, 1e-3));
    float inArc = uArc >= 1.0 ? 1.0 : 1.0 - smoothstep(uArc - aa, uArc, a);
    float k = a / uArc * uSegments, id = floor(k), f = fract(k);
    float fa = aa * uSegments / uArc;
    float seg = uDuty >= 1.0 ? 1.0 : smoothstep(0.0, fa, f) * (1.0 - smoothstep(uDuty - fa, uDuty, f));
    seg *= step(uDrop, hash(id + uSeed));
    // Tick rings: every uMajor-th tick runs the full height, the rest stop short.
    float top = uMajor > 0.0 ? mix(uInner + (uOuter - uInner) * uMinor, uOuter, step(mod(id, uMajor), 0.5)) : uOuter;
    float d = max(uInner - r, r - top);
    float body = 1.0 - smoothstep(-px * 0.5, px * 0.8, d);
    float glow = exp(-max(d, 0.0) / 0.018) * 0.3;
    // Wide blocks get a lit outline over a faint fill.
    float side = uDuty >= 1.0 ? 1e3 : min(f, uDuty - f) / uSegments * uArc * TAU * r;
    float outline = 1.0 - smoothstep(px * 0.6, px * 1.8, min(-d, side));
    body *= mix(1.0, max(outline, 0.18 + uEnergy * 0.2), uOutline);
    // Triangle pips on the inner side, pointing at the ring.
    float n = max(uPips, 1.0), t = uInner - r, s = (fract(a * n + 0.5) - 0.5) / n * TAU * r;
    float pip = step(0.5, uPips) * (1.0 - smoothstep(-px, px, abs(s) - (t - 0.012) * 0.55)) * step(0.012, t) * (1.0 - smoothstep(0.05 - px, 0.05, t));
    float level = hash(id * 1.37 + uSeed + floor(uTime * 9.0) * 0.13);
    float lit = uFlicker * smoothstep(0.0, 0.2, uEnergy * 1.3 + uBusy * 0.35 - level);
    float heat = clamp(lit + uEnergy * 0.25 + swept(a) * uBusy * 0.7, 0.0, 1.0);
    float shape = (body + glow) * seg * inArc + pip;
    float scribe = writeHead(a) * (1.0 - smoothstep(-px, px * 2.0, max(uInner - r, r - uOuter))) * inArc;
    float alpha = (shape * (0.5 + heat * 0.9) * drawn(a) * power() + scribe) * detail(px) * uOpacity;
    gl_FragColor = vec4(hudColor(heat + scribe), alpha);
    ${OUTPUT}
  }
`;

// Arcs of halftone dots that swell toward the middle of each arc and with the voice.
const HALFTONE = `
  uniform float uInner, uOuter, uRows, uArcs, uGap;
  void main() {
    float r = length(vPos), px = length(fwidth(vPos)), a = turn01(vPos);
    float h = (uOuter - uInner) / uRows, y = (r - uInner) / h, row = floor(y);
    float inBand = step(0.0, y) * step(y, uRows);
    float cols = floor(TAU * (uInner + (row + 0.5) * h) / h);
    vec2 q = vec2(fract(a * cols), fract(y)) - 0.5;
    float g = uGap * 0.5, x = fract(a * uArcs);
    float inArc = step(g, x) * step(x, 1.0 - g);
    float profile = sin(3.14159265 * clamp((x - g) / (1.0 - 2.0 * g), 0.0, 1.0));
    float wave = 0.5 + 0.5 * sin(a * TAU * 6.0 - uTime * 5.0 + row * 1.7);
    float size = 0.1 + 0.2 * profile + uEnergy * 0.16 * wave + uBusy * 0.15 * swept(a);
    float soft = px / h;
    float dots = mix(0.3, 1.0 - smoothstep(size - soft, size + soft, length(q)), 1.0 - smoothstep(0.012, 0.03, px));
    float rims = ringLine(r, uInner - 0.008, 0.004, px) + ringLine(r, uOuter + 0.008, 0.004, px);
    float heat = clamp(profile * 0.4 + uEnergy * wave * 0.6 + swept(a) * uBusy * 0.6, 0.0, 1.0);
    float alpha = ((dots * inBand * (0.3 + heat * 0.7) + rims * 0.7) * drawn(a) * power() + writeHead(a) * inBand) * inArc * uOpacity;
    gl_FragColor = vec4(hudColor(heat), alpha);
    ${OUTPUT}
  }
`;

// Radial equaliser: LED-style bars whose heights come from uBars.
const SPECTRUM = `
  uniform float uBars[${BARS}];
  uniform float uInner, uLength, uFrom, uSpan;
  void main() {
    float r = length(vPos), px = length(fwidth(vPos)), a = turn01(vPos);
    float x = fract(a - uFrom) / uSpan, inSpan = step(x, 1.0);
    float k = clamp(x, 0.0, 1.0) * ${BARS}.0;
    float f = fract(k), level = uBars[int(min(floor(k), ${BARS - 1}.0))];
    float fa = px / (TAU * r) * ${BARS}.0 / uSpan;
    float bar = smoothstep(0.2 - fa, 0.2, f) * (1.0 - smoothstep(0.78, 0.78 + fa, f)) * inSpan;
    float y = r - uInner, len = uLength * (0.06 + 0.94 * level);
    float led = mix(1.0, 1.0 - smoothstep(0.62, 0.72, fract(y / 0.024)), 1.0 - smoothstep(0.012, 0.03, px));
    float lit = step(0.0, y) * (1.0 - smoothstep(len - px, len, y));
    float track = step(0.0, y) * step(y, uLength) * 0.03;
    float baseline = ringLine(r, uInner - 0.014, 0.004, px) * inSpan;
    float ends = smoothstep(0.0, 0.05, x) * (1.0 - smoothstep(0.95, 1.0, x));
    float heat = clamp(y / uLength + level * 0.4, 0.0, 1.0);
    float scribe = writeHead(x) * bar * step(0.0, y) * step(y, uLength);
    float alpha = ((bar * (lit * led * (0.7 + level * 1.1) + track) + baseline * 0.6) * ends * drawn(x) * power() + scribe) * uOpacity;
    gl_FragColor = vec4(hudColor(heat), alpha);
    ${OUTPUT}
  }
`;

// Arc segments with arrowheads on their clockwise end.
const ARROWS = `
  uniform float uRadius, uWidth, uLength, uCount, uHead;
  void main() {
    float r = length(vPos), px = length(fwidth(vPos)), a = turn01(vPos);
    float x = fract(a * uCount) / uCount;
    float L = uLength * TAU * r, s = (uLength - x) * TAU * r, t = abs(r - uRadius);
    float along = step(0.0, s) * step(s, L);
    float shaft = (1.0 - smoothstep(uWidth * 0.5, uWidth * 0.5 + px, t)) * step(uHead * 0.7, s) * smoothstep(L, L * 0.4, s);
    float tip = step(s, uHead) * (1.0 - smoothstep(-px, px, t - s * 0.6));
    float glow = exp(-t / 0.025) * 0.25 * smoothstep(L, 0.0, s);
    float heat = clamp(0.3 + uEnergy * 0.7 + uBusy * 0.5, 0.0, 1.0);
    float alpha = (shaft + tip + glow) * along * (0.55 + heat * 0.6) * drawn(a) * power() * uOpacity;
    gl_FragColor = vec4(hudColor(heat), alpha);
    ${OUTPUT}
  }
`;

// Band of tiny data glyphs; alternate rows slide past each other.
const GLYPHS = `
  uniform float uInner, uOuter, uRows, uCell, uSeed;
  void main() {
    float r = length(vPos), px = length(fwidth(vPos)), a = turn01(vPos);
    float h = (uOuter - uInner) / uRows, y = (r - uInner) / h, row = floor(y);
    float inBand = step(0.0, y) * step(y, uRows);
    float cols = floor(TAU * (uInner + (row + 0.5) * h) / uCell);
    float dir = mod(row, 2.0) * 2.0 - 1.0;
    float c = fract(a + dir * uTime * (0.004 + uBusy * 0.03 + uEnergy * 0.012)) * cols, id = floor(c);
    vec2 q = vec2(fract(c), fract(y)) - 0.5, b = abs(q);
    float lw = px / h, n = hash(id * 7.13 + row * 131.7 + uSeed), box = max(b.x, b.y);
    float g = n < 0.4 ? 1.0 - smoothstep(-lw, lw, abs(box - 0.3) - lw * 0.6)
      : n < 0.6 ? 1.0 - smoothstep(-lw, lw, box - 0.2)
      : n < 0.82 ? 1.0 - smoothstep(-lw, lw, max(b.x - 0.4, b.y - lw * 0.7))
      : 1.0 - smoothstep(-lw, lw, max(b.x - lw * 0.7, b.y - 0.32));
    float cluster = 0.5 + 0.5 * sin(a * TAU * 3.0 + uSeed + row);
    g *= step(0.35 + cluster * 0.3, hash(id * 3.7 + row * 71.3 + uSeed * 5.0));
    float on = step(hash(id * 3.1 + row * 17.0 + floor(uTime * (1.5 + uBusy * 8.0) + n * 7.0)), 0.72 + uEnergy * 0.25);
    float heat = clamp(swept(a) * (0.25 + uBusy) + uEnergy * 0.35, 0.0, 1.0);
    float alpha = g * inBand * on * (0.3 + heat * 0.9) * drawn(a) * power() * detail(px) * uOpacity;
    gl_FragColor = vec4(hudColor(heat), alpha);
    ${OUTPUT}
  }
`;

// Iris: a bright rim around a dark pupil, concentric rings and voice ripples.
const CORE = `
  uniform float uHole;
  void main() {
    float r = length(vPos), px = length(fwidth(vPos)), a = turn01(vPos);
    float e = uEnergy, hole = uHole * (1.0 + e * 0.1);
    // While thinking, the rim splits into three chasing arcs.
    float chase = mix(1.0, smoothstep(0.25, 0.4, fract(a * 3.0 + uTime * 0.7)), uBusy);
    float rim = (ringLine(r, hole, 0.012 + e * 0.01, px) + exp(-abs(r - hole) / 0.03) * (0.3 + e * 0.8)) * chase;
    float pupil = exp(-r * r / 0.0002) * (0.8 + e) + exp(-r * r / 0.005) * 0.1;
    float rings = 0.0, ripples = 0.0;
    for (int i = 1; i <= 4; i++) rings += ringLine(r, hole + 0.045 * float(i), 0.004, px) * (0.55 - float(i) * 0.1);
    for (int i = 0; i < 3; i++) {
      float p = fract(uRipple + float(i) / 3.0);
      ripples += ringLine(r, mix(hole, 0.46, p), 0.006, px) * sin(p * 3.14159265);
    }
    float ignite = sin(clamp(uReveal, 0.0, 1.0) * 3.14159265) * exp(-r * r * 18.0);
    float total = rim * 1.1 + pupil + rings * (0.35 + e * 0.6) + ripples * (0.12 + e * 1.1 + uBusy * 0.15) + ignite;
    float alpha = total * (1.0 - smoothstep(0.44, 0.5, r)) * smoothstep(0.0, 0.25, uReveal) * power() * uOpacity;
    gl_FragColor = vec4(hudColor(rim * 0.6 + pupil + e * 0.4), alpha);
    ${OUTPUT}
  }
`;

// Radar sweep: faint at rest, strong while Jarvis is thinking.
const SWEEP = `
  uniform float uInner, uOuter;
  void main() {
    float r = length(vPos), a = turn01(vPos);
    float behind = fract(uSweep - a);
    float trail = exp(-behind * 7.0) * 0.14 + exp(-behind * 160.0) * 0.45;
    float band = smoothstep(uInner, uInner + 0.06, r) * (1.0 - smoothstep(uOuter - 0.12, uOuter, r));
    float alpha = trail * band * (0.1 + uBusy * 0.9) * smoothstep(0.5, 1.0, uReveal) * uOpacity;
    gl_FragColor = vec4(hudColor(0.5), alpha);
    ${OUTPUT}
  }
`;

// Fixed reticle: broken outer ring, cardinal ticks, plus/X marks, crosshair and lens flare.
const RETICLE = `
  uniform float uRadius;
  float mark(vec2 q, float size, float w) { vec2 b = abs(q); return min(max(b.x - size, b.y - w), max(b.y - size, b.x - w)); }
  void main() {
    vec2 p = vPos, b = abs(p);
    float r = length(p), px = length(fwidth(p)), a = turn01(p);
    float lw = 0.0035, near = min(b.x, b.y), far = max(b.x, b.y);
    float ring = ringLine(r, uRadius, 0.006, px) * smoothstep(0.03, 0.045, abs(fract(a * 4.0) - 0.5));
    // Cardinal ticks cross the ring; the one at 12 o'clock runs longer.
    float up = step(0.0, p.y) * step(b.x, b.y);
    float ticks = (1.0 - smoothstep(lw, lw + px, near)) * step(uRadius - 0.09 - up * 0.05, far) * step(far, uRadius + 0.1 + up * 0.1);
    vec2 axis = b.x > b.y ? vec2(sign(p.x), 0.0) : vec2(0.0, sign(p.y));
    float plus = 1.0 - smoothstep(-px, px, mark(p - axis * (uRadius + 0.22), 0.035, lw));
    vec2 d = vec2(p.x + p.y, p.y - p.x) * 0.70710678, db = abs(d);
    vec2 diag = db.x > db.y ? vec2(sign(d.x), 0.0) : vec2(0.0, sign(d.y));
    float xmark = 1.0 - smoothstep(-px, px, mark(d - diag * uRadius, 0.028, lw));
    float hair = (1.0 - smoothstep(0.0012, 0.0012 + px, near)) * smoothstep(0.24, 0.4, far) * (1.0 - smoothstep(uRadius - 0.12, uRadius - 0.04, far));
    float flare = exp(-b.y / 0.008) * exp(-b.x * 1.5) * (0.05 + (uSpeak * 0.8 + uListen * 0.3) * uEnergy + uBurst * 0.4);
    float heat = clamp(uEnergy * 0.6 + uBusy * 0.3, 0.0, 1.0);
    float shapes = (ring * 0.75 + ticks + plus * 0.8 + xmark * 0.6) * (0.6 + heat * 0.6) + hair * (0.08 + heat * 0.2);
    float alpha = (shapes * drawn(a) * power() + flare * smoothstep(0.3, 1.0, uReveal)) * uOpacity;
    gl_FragColor = vec4(hudColor(heat + flare), alpha);
    ${OUTPUT}
  }
`;

type Uniforms = Record<string, number>;
const ring = (o: Uniforms): Uniforms => ({ uArc: 1, uSegments: 1, uDuty: 1, uDrop: 0, uSeed: 0, uFlicker: 0, uOutline: 0, uMajor: 0, uMinor: 1, uPips: 0, ...o });

interface LayerSpec { frag: string; size: number; order: number; own: Uniforms; accent?: boolean; step?: number; drift?: number; phase?: number; pulse?: number; swing?: boolean; flow?: boolean }

// order: start-up sequence and depth (inside out). step: click size in radians.
// swing: clicks back and forth instead of round. flow: arrows flip while listening.
const LAYERS: LayerSpec[] = [
  { frag: CORE, size: 0.5, order: 0, pulse: 0.08, own: { uHole: 0.2 } },
  { frag: HALFTONE, size: 0.62, order: 1, accent: true, step: TAU / 8, drift: 0.03, own: { uInner: 0.46, uOuter: 0.575, uRows: 3, uArcs: 4, uGap: 0.07 } },
  { frag: RING, size: 0.66, order: 2, step: TAU / 30, drift: -0.05, own: ring({ uInner: 0.6, uOuter: 0.63, uSegments: 120, uDuty: 0.4, uMajor: 10, uMinor: 0.45, uFine: 1 }) },
  { frag: SPECTRUM, size: 0.98, order: 3, accent: true, own: { uInner: 0.68, uLength: 0.26, uFrom: 0.53, uSpan: 0.44 } },
  { frag: SWEEP, size: 1.46, order: 3, own: { uInner: 0.44, uOuter: 1.46 } },
  { frag: RING, size: 0.92, order: 4, accent: true, step: TAU * 0.34 / 9, swing: true, phase: -0.07 * TAU, pulse: 0.03,
    own: ring({ uInner: 0.74, uOuter: 0.88, uArc: 0.34, uSegments: 9, uDuty: 0.84, uOutline: 1, uFlicker: 1, uSeed: 2 }) },
  { frag: ARROWS, size: 1.06, order: 5, drift: -0.35, flow: true, own: { uRadius: 0.985, uWidth: 0.012, uLength: 0.2, uCount: 2, uHead: 0.065 } },
  { frag: RING, size: 1.1, order: 6, accent: true, step: TAU / 12, own: ring({ uInner: 1.035, uOuter: 1.046, uSegments: 3, uDuty: 0.9, uPips: 3 }) },
  { frag: RING, size: 1.22, order: 7, accent: true, step: TAU * 0.8 / 16, pulse: 0.02,
    own: ring({ uInner: 1.09, uOuter: 1.19, uArc: 0.8, uSegments: 16, uDuty: 0.88, uDrop: 0.15, uOutline: 0.6, uFlicker: 1, uSeed: 5 }) },
  { frag: RING, size: 1.29, order: 8, step: TAU / 24, drift: 0.02,
    own: ring({ uInner: 1.225, uOuter: 1.26, uArc: 0.62, uSegments: 150, uDuty: 0.32, uMajor: 5, uMinor: 0.45, uSeed: 9, uFine: 1 }) },
  { frag: GLYPHS, size: 1.46, order: 9, own: { uInner: 1.3, uOuter: 1.43, uRows: 3, uCell: 0.043, uSeed: 3, uFine: 1 } },
  { frag: RING, size: 1.6, order: 10, accent: true, step: TAU / 16, own: ring({ uInner: 1.55, uOuter: 1.57, uSegments: 2, uDuty: 0.13, uOutline: 1, uSeed: 1 }) },
  { frag: RETICLE, size: 1.82, order: 11, own: { uRadius: 1.5 } },
];

const asUniforms = (values: Uniforms) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }]));

interface Motion { angle: number; vel: number; target: number; drift: number; dir: number; timer: number; seen: number; due: number }

function Layer({ u, hud, layer }: { u: OrbDrive; hud: HudDrive; layer: LayerSpec }) {
  const { frag, size, order, own, accent = false, step = 0, drift = 0, phase = 0, pulse = 0, swing = false, flow = false } = layer;
  const mesh = useRef<Mesh>(null);
  const motion = useRef<Motion | null>(null);
  const geometry = useMemo(() => new PlaneGeometry(size * 2, size * 2), [size]);
  const material = useMemo(() => new ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: PRELUDE + frag,
    uniforms: { ...u.uniforms, ...hud.uniforms, ...asUniforms({ uFine: 0, uOpacity: 1, uAccentMix: accent ? 1 : 0, ...own }), uReveal: { value: 0 }, uTurn: { value: 0 } },
    transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, side: DoubleSide,
  }), [u, hud, frag, own, accent]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  // three.js materials are updated in place every frame: that's how react-three-fiber animates
  // eslint-disable-next-line react-hooks/immutability
  useFrame(() => {
    const m = motion.current ??= { angle: 0, vel: 0, target: 0, drift: 0, dir: order % 2 ? 1 : -1, timer: 1 + Math.random() * 3, seen: hud.shift, due: -1 };
    const dt = u.step;
    // Each ring finishes sliding in exactly on its clank in the start-up sound.
    const reveal = order === 0
      ? 0.04 + 0.96 * clamp01((hud.clock - ORB_IGNITION_TIME + 0.02) / 0.15)
      : clamp01((hud.clock - ORB_CUES.locks[order - 1] + 0.16) / 0.16);
    const settle = ease(reveal);
    if (step && !hud.reduced) {
      const click = (count: number) => { m.target += m.dir * step * count; if (swing) m.dir = -m.dir; };
      // State change: re-lock in a cascade from the core outward.
      if (m.seen !== hud.shift) { m.seen = hud.shift; m.due = hud.clock + order * 0.055; }
      if (m.due >= 0 && hud.clock >= m.due) { click(swing ? 1 : hud.engage); m.due = -1; }
      m.timer -= dt;
      if (m.timer <= 0 && reveal >= 1 && hud.clock >= ORB_IGNITION_TIME + 0.2) { click(1); m.timer = CADENCE[hud.state ?? 'idle'] * (0.55 + Math.random() * 0.9); }
      // Under-damped spring: each click overshoots slightly, then locks.
      m.vel += (240 * (m.target - m.angle) - 17 * m.vel) * dt;
      m.angle += m.vel * dt;
    }
    m.drift += drift * dt * (1 + u.busy * 2.5 + u.energy * 1.5) * (flow ? hud.flow : 1);
    // Rings spin into place from alternating directions during start-up.
    const twist = (hud.clock - ORB_CUES.twist[0]) / (ORB_CUES.twist[1] - ORB_CUES.twist[0]);
    const alignment = order >= 7 ? (1 - ease(twist)) * (order % 2 ? 0.4 : -0.4) : 0;
    const turn = phase + m.drift + m.angle + alignment + (1 - settle) * (order % 2 ? 2.4 : -2.4);
    const g = mesh.current!, s = 1 + u.energy * pulse;
    g.rotation.z = turn;
    g.scale.set(s * (flow ? hud.flow : 1), s, 1);
    g.position.z = (5.5 - order) * 0.022 * (1 + u.energy * 1.4 + u.uniforms.uBurst.value * 2.5 + (1 - settle) * 7);
    // eslint-disable-next-line react-hooks/immutability -- uniforms change in place every frame
    material.uniforms.uTurn.value = turn / TAU;
    material.uniforms.uReveal.value = reveal;
  });
  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} />;
}

// Start-up: the stack is seen tilted and exploded, then swings face-on and closes up.
function Assembly({ u, hud, children }: { u: OrbDrive; hud: HudDrive; children: ReactNode }) {
  const root = useRef<Group>(null);
  useFrame(() => {
    const b = ease(hud.boot), g = root.current!, k = 1 - Math.exp(-u.step * 6);
    const h = hud.uniforms;
    g.rotation.x += (-0.9 * (1 - b) - u.uniforms.uBurst.value * 0.25 - g.rotation.x) * k;
    g.rotation.z += (0.6 * (1 - b) - g.rotation.z) * k;
    const scale = (0.78 + 0.22 * b) * (1 - h.uListen.value * 0.03 + h.uSpeak.value * u.energy * 0.04);
    g.scale.setScalar(g.scale.x + (scale - g.scale.x) * k);
  });
  return <group ref={root} rotation={[-0.9, 0, 0.6]} scale={0.78}>{children}</group>;
}

export function HudScene({ state, levelRef, pointerRef, theme }: { state: OrbState; levelRef: RefObject<number>; pointerRef: RefObject<OrbPointer>; theme: OrbTheme }) {
  const u = useDrive(state, levelRef, theme);
  const hud = useHud(u, state, levelRef);
  return <Rig u={u} pointerRef={pointerRef} sway={0.12}>
    <Assembly u={u} hud={hud}>
      {LAYERS.map((layer, i) => <Layer key={i} u={u} hud={hud} layer={layer} />)}
    </Assembly>
    <Dust u={u} count={140} inner={1.62} spread={0.3} opacity={0.5} />
  </Rig>;
}
