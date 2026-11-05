/**
 * Motion state for the hero character field.
 *
 * Pure reducer, no DOM. The controller feeds events in and reads back
 * whether frames should be scheduled and what the control should say.
 *
 * Priority (highest first) for the reported state:
 *   reduced-motion > user-paused > settled > hidden-tab > offscreen > active
 *
 * Visibility (hidden-tab, offscreen) only ever suspends work. It never
 * clears a pause, a settle, or the reduced-motion preference, so a field
 * that was still when the tab was hidden is still when it comes back.
 */

export type FieldState = 'reduced-motion' | 'user-paused' | 'settled' | 'hidden-tab' | 'offscreen' | 'active';

export interface MotionFlags {
  /** prefers-reduced-motion: reduce */
  reducedMotion: boolean;
  /** Explicit "play" while reduced motion is on; lasts for this page view only. */
  motionOptIn: boolean;
  /** Paused with the control; persisted when storage is available. */
  userPaused: boolean;
  /** Clicked / tapped still; not persisted. */
  settled: boolean;
  /** document.hidden */
  hidden: boolean;
  /** Field scrolled out of view. */
  offscreen: boolean;
}

export type MotionEvent =
  | { type: 'reduced-motion-changed'; reduce: boolean }
  | { type: 'toggle' }
  | { type: 'settle' }
  | { type: 'visibility-changed'; hidden: boolean }
  | { type: 'intersection-changed'; offscreen: boolean };

export function initialFlags(opts: {
  reducedMotion: boolean;
  storedPaused: boolean | null;
  hidden?: boolean;
}): MotionFlags {
  return {
    reducedMotion: opts.reducedMotion,
    motionOptIn: false,
    userPaused: opts.storedPaused === true,
    settled: false,
    hidden: opts.hidden ?? false,
    offscreen: false,
  };
}

/** Motion the visitor has allowed, ignoring whether the field can be seen. */
export function motionAllowed(f: MotionFlags): boolean {
  if (f.reducedMotion && !f.motionOptIn) return false;
  return !f.userPaused && !f.settled;
}

/** Whether animation frames should be scheduled right now. */
export function shouldRun(f: MotionFlags): boolean {
  return motionAllowed(f) && !f.hidden && !f.offscreen;
}

export function deriveState(f: MotionFlags): FieldState {
  if (f.reducedMotion && !f.motionOptIn) return 'reduced-motion';
  if (f.userPaused) return 'user-paused';
  if (f.settled) return 'settled';
  if (f.hidden) return 'hidden-tab';
  if (f.offscreen) return 'offscreen';
  return 'active';
}

/** The action the control will perform when pressed (its visible label). */
export type ControlAction = 'pause' | 'resume' | 'play';

export function controlAction(f: MotionFlags): ControlAction {
  if (motionAllowed(f)) return 'pause';
  if (f.reducedMotion && !f.motionOptIn) return 'play';
  return 'resume';
}

export function reduce(f: MotionFlags, e: MotionEvent): MotionFlags {
  switch (e.type) {
    case 'reduced-motion-changed':
      // Turning reduce on always wins and drops any earlier opt-in.
      return e.reduce ? { ...f, reducedMotion: true, motionOptIn: false } : { ...f, reducedMotion: false };
    case 'toggle':
      if (motionAllowed(f)) return { ...f, userPaused: true };
      return {
        ...f,
        userPaused: false,
        settled: false,
        motionOptIn: f.reducedMotion ? true : f.motionOptIn,
      };
    case 'settle':
      return motionAllowed(f) ? { ...f, settled: true } : f;
    case 'visibility-changed':
      return f.hidden === e.hidden ? f : { ...f, hidden: e.hidden };
    case 'intersection-changed':
      return f.offscreen === e.offscreen ? f : { ...f, offscreen: e.offscreen };
  }
}

/* ---------- persistence (failure-tolerant) ---------- */

export const PAUSE_STORAGE_KEY = 'ks-field-paused';

export function readStoredPause(storage: () => Storage | undefined): boolean | null {
  try {
    const v = storage()?.getItem(PAUSE_STORAGE_KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

export function writeStoredPause(storage: () => Storage | undefined, paused: boolean): boolean {
  try {
    storage()?.setItem(PAUSE_STORAGE_KEY, paused ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
