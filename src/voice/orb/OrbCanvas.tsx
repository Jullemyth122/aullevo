import { useEffect, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { setConsoleFunction } from 'three';
import { HudScene } from './hud';
import type { OrbPointer, OrbState } from './parts';
import type { OrbTheme } from './themes';
import styles from './Orb.module.scss';

// React Three Fiber 9 (latest stable) still creates a THREE.Clock for its frame loop, and three.js r183+ warns about
// that deprecation every time the orb mounts. It's inside the library, so only that one message is dropped; every
// other three.js warning and error is still printed.
setConsoleFunction((type, message, ...params) => {
  if (type === 'warn' && message.startsWith('THREE.Clock:')) return;
  console[type](message, ...params);
});

// The "voice level" the rings react to is synthesised (the agent speaks through an audio element):
// lively while it talks, a slow breath while it listens.
function Level({ state, levelRef }: { state: OrbState; levelRef: RefObject<number> }) {
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    levelRef.current = state === 'speaking' ? 0.35 + 0.3 * Math.abs(Math.sin(t * 7) * Math.sin(t * 2.1))
      : state === 'listening' ? 0.08 + 0.06 * (0.5 + 0.5 * Math.sin(t * 1.8))
        : 0;
  });
  return null;
}

/**
 * Frame pacing: 30 frames a second while idle, 60 while the agent is working, listening or talking. All motion
 * advances by elapsed time, so it looks the same; idle simply redraws half as often (and not at all when hidden).
 */
function Pace({ fps }: { fps: number }) {
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => {
    let frame = 0, last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last >= 1000 / fps - 2) { last = now; invalidate(); }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [fps, invalidate]);
  return null;
}

/** The three.js scene; loaded on demand so the panel's controls appear first. */
export default function OrbCanvas({ state, theme, levelRef, pointerRef }: { state: OrbState; theme: OrbTheme; levelRef: RefObject<number>; pointerRef: RefObject<OrbPointer> }) {
  return <Canvas className={styles.scene} camera={{ position: [0, 0, 4.8], fov: 43 }} dpr={[1, 1.5]}
    gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }} fallback={<span className={styles.backup} />} frameloop="demand">
    <Pace fps={state === 'idle' ? 30 : 60} />
    <Level state={state} levelRef={levelRef} />
      <HudScene state={state} levelRef={levelRef} pointerRef={pointerRef} theme={theme} />
  </Canvas>;
}
