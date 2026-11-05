import { describe, expect, it } from 'vitest';
import {
  controlAction,
  deriveState,
  initialFlags,
  motionAllowed,
  readStoredPause,
  reduce,
  shouldRun,
  writeStoredPause,
  type MotionEvent,
  type MotionFlags,
} from '../src/scripts/ascii/motion-state';

const run = (f: MotionFlags, ...events: MotionEvent[]) => events.reduce(reduce, f);
const base = () => initialFlags({ reducedMotion: false, storedPaused: null });

describe('initial state', () => {
  it('starts active when nothing prevents motion', () => {
    const f = base();
    expect(deriveState(f)).toBe('active');
    expect(shouldRun(f)).toBe(true);
    expect(controlAction(f)).toBe('pause');
  });

  it('starts static under reduced motion, offering play', () => {
    const f = initialFlags({ reducedMotion: true, storedPaused: null });
    expect(deriveState(f)).toBe('reduced-motion');
    expect(shouldRun(f)).toBe(false);
    expect(controlAction(f)).toBe('play');
  });

  it('restores a persisted pause', () => {
    const f = initialFlags({ reducedMotion: false, storedPaused: true });
    expect(deriveState(f)).toBe('user-paused');
    expect(controlAction(f)).toBe('resume');
  });
});

describe('pause / resume / settle', () => {
  it('toggle pauses then resumes', () => {
    const paused = run(base(), { type: 'toggle' });
    expect(deriveState(paused)).toBe('user-paused');
    const resumed = run(paused, { type: 'toggle' });
    expect(deriveState(resumed)).toBe('active');
  });

  it('settle stills the field; the control resumes it', () => {
    const settled = run(base(), { type: 'settle' });
    expect(deriveState(settled)).toBe('settled');
    expect(shouldRun(settled)).toBe(false);
    expect(controlAction(settled)).toBe('resume');
    expect(deriveState(run(settled, { type: 'toggle' }))).toBe('active');
  });

  it('settle is ignored when motion is not allowed', () => {
    const f = initialFlags({ reducedMotion: true, storedPaused: null });
    expect(run(f, { type: 'settle' })).toBe(f);
  });

  it('play under reduced motion is an explicit opt-in that a new reduce preference revokes', () => {
    const opted = run(initialFlags({ reducedMotion: true, storedPaused: null }), { type: 'toggle' });
    expect(deriveState(opted)).toBe('active');
    const revoked = run(opted, { type: 'reduced-motion-changed', reduce: true });
    expect(deriveState(revoked)).toBe('reduced-motion');
    expect(shouldRun(revoked)).toBe(false);
  });
});

describe('visibility never overrides pause or reduced motion', () => {
  it('hidden tab suspends work and returns to active when visible', () => {
    const hidden = run(base(), { type: 'visibility-changed', hidden: true });
    expect(deriveState(hidden)).toBe('hidden-tab');
    expect(shouldRun(hidden)).toBe(false);
    expect(motionAllowed(hidden)).toBe(true);
    expect(shouldRun(run(hidden, { type: 'visibility-changed', hidden: false }))).toBe(true);
  });

  it('a paused field stays paused across hide/show and scroll in/out', () => {
    const f = run(
      base(),
      { type: 'toggle' },
      { type: 'visibility-changed', hidden: true },
      { type: 'intersection-changed', offscreen: true },
      { type: 'visibility-changed', hidden: false },
      { type: 'intersection-changed', offscreen: false },
    );
    expect(deriveState(f)).toBe('user-paused');
    expect(shouldRun(f)).toBe(false);
  });

  it('a settled field stays settled after becoming visible again', () => {
    const f = run(base(), { type: 'settle' }, { type: 'intersection-changed', offscreen: true }, { type: 'intersection-changed', offscreen: false });
    expect(deriveState(f)).toBe('settled');
  });

  it('reduced motion outranks every other state', () => {
    const f = run(initialFlags({ reducedMotion: true, storedPaused: true }), { type: 'visibility-changed', hidden: true });
    expect(deriveState(f)).toBe('reduced-motion');
  });

  it('offscreen suspends work without changing the control label', () => {
    const f = run(base(), { type: 'intersection-changed', offscreen: true });
    expect(deriveState(f)).toBe('offscreen');
    expect(shouldRun(f)).toBe(false);
    expect(controlAction(f)).toBe('pause');
  });

  it('no-op events return the same object (no redundant re-renders)', () => {
    const f = base();
    expect(reduce(f, { type: 'visibility-changed', hidden: false })).toBe(f);
    expect(reduce(f, { type: 'intersection-changed', offscreen: false })).toBe(f);
  });
});

describe('persistence tolerates failure', () => {
  it('round-trips through storage', () => {
    const map = new Map<string, string>();
    const storage = () => ({ getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }) as unknown as Storage;
    expect(readStoredPause(storage)).toBe(null);
    expect(writeStoredPause(storage, true)).toBe(true);
    expect(readStoredPause(storage)).toBe(true);
    writeStoredPause(storage, false);
    expect(readStoredPause(storage)).toBe(false);
  });

  it('returns safe defaults when storage throws or is missing', () => {
    const throwing = () => {
      throw new Error('SecurityError');
    };
    expect(readStoredPause(throwing)).toBe(null);
    expect(writeStoredPause(throwing, true)).toBe(false);
    expect(readStoredPause(() => undefined)).toBe(null);
  });
});
