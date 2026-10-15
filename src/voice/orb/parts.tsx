// Shared pieces of the orb scene: types, the per-scene uniforms (OrbDrive) and small scene components.
/* eslint-disable react-refresh/only-export-components -- scene helpers live next to the components that use them */
import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial, type Group, type Points } from 'three';
import { ORB_THEMES, type OrbTheme } from './themes';

export type OrbState = 'idle' | 'listening' | 'speaking' | 'thinking' | 'transcribing';
export type OrbTone = 'cyan' | 'azure' | 'emerald' | 'ember';
export interface OrbPointer { x: number; y: number; hover: number }

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v || 0));

/** One set of uniforms per scene, shared by reference with every material in it. */
export class OrbDrive {
  readonly reduced: boolean;
  state: OrbState | null = null;
  step = 0; // scaled frame delta for CPU-side motion
  private targets = [new Color(), new Color(), new Color()];
  readonly uniforms;
  constructor(reduced: boolean) {
    const { base, hot, accent } = ORB_THEMES[0];
    this.reduced = reduced;
    this.uniforms = {
      uTime: { value: 0 }, uEnergy: { value: 0 }, uBusy: { value: 0 }, uBurst: { value: reduced ? 0 : 1 }, uPx: { value: 100 },
      uBase: { value: new Color(base) }, uHot: { value: new Color(hot) }, uAccent: { value: new Color(accent) },
    };
  }
  get time() { return this.uniforms.uTime.value; }
  get energy() { return this.uniforms.uEnergy.value; }
  get busy() { return this.uniforms.uBusy.value; }
  update(state: OrbState, level: number, theme: OrbTheme, pixels: number, dt: number) {
    const u = this.uniforms, delta = Math.min(dt, 0.05) * (this.reduced ? 0.35 : 1);
    if (this.state !== state) {
      if (this.state && !this.reduced) u.uBurst.value = Math.max(u.uBurst.value, 0.32);
      this.state = state;
    }
    const busy = state === 'thinking' || state === 'transcribing';
    const live = state === 'listening' || state === 'speaking';
    const target = live ? Math.sqrt(clamp01(level)) : busy ? 0.15 : 0;
    const e = u.uEnergy;
    e.value += (target - e.value) * (1 - Math.exp(-delta * (target > e.value ? 12 : 4)));
    u.uBusy.value += ((busy ? 1 : 0) - u.uBusy.value) * (1 - Math.exp(-delta * 3));
    u.uBurst.value *= Math.exp(-delta * 1.7);
    u.uTime.value += delta * (0.7 + u.uBusy.value * 0.9 + e.value * 1.4);
    u.uPx.value = pixels;
    this.step = delta;
    const palette = [theme.base, theme.hot, theme.accent];
    const ease = 1 - Math.exp(-delta * 3);
    [u.uBase, u.uHot, u.uAccent].forEach((slot, i) => slot.value.lerp(this.targets[i].set(palette[i]), ease));
  }
}

export function useDrive(state: OrbState, levelRef: RefObject<number>, theme: OrbTheme) {
  const drive = useMemo(() => new OrbDrive(window.matchMedia('(prefers-reduced-motion: reduce)').matches), []);
  useFrame(({ viewport }, dt) => drive.update(state, levelRef.current, theme, viewport.factor * viewport.dpr, dt));
  return drive;
}

/** Pointer parallax, idle float and a slow sway. */
export function Rig({ u, pointerRef, sway = 0, children }: { u: OrbDrive; pointerRef: RefObject<OrbPointer>; sway?: number; children: ReactNode }) {
  const root = useRef<Group>(null);
  useFrame(() => {
    const t = u.time, ease = 1 - Math.exp(-u.step * 3);
    const pointer = pointerRef.current, g = root.current!;
    g.rotation.y += (pointer.x * 0.22 + Math.sin(t * 0.31) * sway - g.rotation.y) * ease;
    g.rotation.x += (pointer.y * 0.16 + Math.cos(t * 0.23) * sway * 0.7 - g.rotation.x) * ease;
    g.position.y = Math.sin(t * 0.6) * 0.022;
    g.scale.setScalar(1 + Math.sin(t * 1.1) * 0.008 + pointer.hover * 0.02);
  });
  return <group ref={root}>{children}</group>;
}

function createDust(count: number, inner: number, spread: number) {
  const position = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = i * 2.399963, y = 1 - 2 * (i + 0.5) / count, d = Math.sqrt(1 - y * y);
    const r = inner + (Math.sin(i * 13.7) + 1) * spread / 2;
    position.set([Math.cos(a) * d * r, y * r, Math.sin(a) * d * r], i * 3);
    seed[i] = (Math.sin(i * 17.3) + 1) / 2;
  }
  return { position, seed };
}

const dustVertex = `
  uniform float uTime, uEnergy, uPx;
  attribute float aSeed;
  varying float vAlpha;
  void main() {
    vec3 p = position * (1.0 + sin(uTime * 0.4 + aSeed * 30.0) * 0.02 + uEnergy * 0.03);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (0.012 + pow(aSeed, 8.0) * 0.025) * uPx * (4.8 / -mv.z);
    vAlpha = 0.25 + 0.3 * (0.5 + 0.5 * sin(aSeed * 40.0 + uTime));
  }
`;
const dustFragment = `
  uniform float uOpacity;
  uniform vec3 uHot;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    gl_FragColor = vec4(uHot, exp(-r * r * 4.0) * (1.0 - smoothstep(0.7, 1.0, r)) * vAlpha * uOpacity);
    #include <colorspace_fragment>
  }
`;

/** Faint particles orbiting the rings. */
export function Dust({ u, count = 220, inner = 1.3, spread = 0.26, opacity = 0.8 }: { u: OrbDrive; count?: number; inner?: number; spread?: number; opacity?: number }) {
  const geometry = useMemo(() => {
    const d = createDust(count, inner, spread), g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(d.position, 3));
    g.setAttribute('aSeed', new BufferAttribute(d.seed, 1));
    return g;
  }, [count, inner, spread]);
  const material = useMemo(() => new ShaderMaterial({
    vertexShader: dustVertex, fragmentShader: dustFragment, uniforms: { ...u.uniforms, uOpacity: { value: opacity } },
    transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
  }), [u, opacity]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  const ref = useRef<Points>(null);
  useFrame(() => { ref.current!.rotation.y -= u.step * 0.025; });
  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} />;
}
