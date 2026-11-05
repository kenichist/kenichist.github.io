import { DEFAULT_SEED, hash2, sampleCell, type FieldLevel } from './field';
import { CELL_GLYPHS, decodeCode, isFieldClip, type FieldClip } from './frames';
import { KOI_GLYPHS } from '../koi/fish';
import { Pond } from '../koi/pond';
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
} from './motion-state';

/* Tuned by profiling: 20fps is calm enough for a drift and cheap on mobile. */
const FIELD_FRAME_MS = 1000 / 20;
const KOI_FRAME_MS = 1000 / 30; // swimming reads better a little smoother
const KOI_FRAME_MS_SMALL = 1000 / 24; // phones / touch: a little cheaper
const MAX_DPR = 2;
const MAX_CELLS = 140 * 48;
/** Cell geometry as multiples of the glyph font size; must match the CSS fallback. */
export const CELL_W_EM = 0.78;
export const CELL_H_EM = 1.28;
const DECAY = 0.84; // per frame — damped return of pointer displacement
const TIME_EASE = 0.2; // per frame — easing of drift speed toward its target
const REVEAL_MS = 320;
const POINTER_RADIUS = 0.085; // in normalised width units
const MAX_DISP = 0.05;
const MAX_PUSH = 0.7;

interface Grid {
  cols: number;
  rows: number;
  /** exact device-pixel cell pitch (fractional) */
  pitchX: number;
  pitchY: number;
  /** integer atlas cell size (ceil of the pitch) */
  cw: number;
  ch: number;
  fontPx: number;
  dpr: number;
}

const storage = () => (typeof window !== 'undefined' ? window.localStorage : undefined);

const ACTION_TEXT = { pause: 'pause', resume: 'resume', play: 'play' } as const;
const ACTION_SR = {
  pause: ' the background animation',
  resume: ' the background animation',
  play: ' the background animation',
} as const;

export class AsciiField {
  private readonly root: HTMLElement;
  private readonly surface: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly button: HTMLButtonElement | null;
  private readonly hint: HTMLElement | null;
  private readonly seed: number;

  private flags: MotionFlags;
  private grid: Grid | null = null;
  private dispX = new Float32Array(0);
  private dispY = new Float32Array(0);
  private push = new Float32Array(0);
  private atlas: HTMLCanvasElement | null = null;
  private colors: string[] = [];
  /** Koi pond scene (data-scene="koi"); null → field or clip. */
  private pond: Pond | null = null;
  private frameMs = FIELD_FRAME_MS;
  /** Video-derived clip for the current grid; null → procedural field. */
  private clip: FieldClip | null = null;
  private clipVariant: 'wide' | 'narrow' | null = null;
  private readonly clipCache = new Map<string, Promise<FieldClip | null>>();

  private t = 0;
  private timeScale = 1;
  private raf = 0;
  private timer = 0;
  private lastFrame = 0;
  private revealStart = -1;
  private resizeTimer = 0;
  private pointer = { x: 0, y: 0, vx: 0, vy: 0, dirty: false, inside: false };
  private impulse: { x: number; y: number; strength: number } | null = null;

  private readonly abort = new AbortController();
  private ro: ResizeObserver | null = null;
  private io: IntersectionObserver | null = null;
  private finePointer: MediaQueryList;

  constructor(root: HTMLElement) {
    this.root = root;
    const surface = root.querySelector<HTMLElement>('[data-field-surface]');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!surface || !ctx) throw new Error('canvas unavailable');
    this.surface = surface;
    this.canvas = canvas;
    this.ctx = ctx;
    canvas.className = 'field-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    this.button = root.querySelector('[data-field-toggle]');
    this.hint = root.querySelector('[data-field-hint]');
    this.seed = Number(root.dataset.seed) || DEFAULT_SEED;

    const rm = matchMedia('(prefers-reduced-motion: reduce)');
    this.finePointer = matchMedia('(hover: hover) and (pointer: fine)');
    this.flags = initialFlags({
      reducedMotion: rm.matches,
      storedPaused: readStoredPause(storage),
      hidden: document.hidden,
    });

    const signal = this.abort.signal;
    rm.addEventListener('change', (e) => this.dispatch({ type: 'reduced-motion-changed', reduce: e.matches }), { signal });
    this.finePointer.addEventListener('change', () => this.syncUI(), { signal });
    document.addEventListener('visibilitychange', () => this.dispatch({ type: 'visibility-changed', hidden: document.hidden }), { signal });
    this.button?.addEventListener('click', () => this.onToggle(), { signal });
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal, passive: true });
    canvas.addEventListener('pointerleave', () => (this.pointer.inside = false), { signal, passive: true });
    canvas.addEventListener('click', (e) => this.onSettle(e), { signal });
  }

  async start(): Promise<void> {
    // Measure with the real font; fall back to whatever is available after a short wait.
    const family = getComputedStyle(this.surface).fontFamily;
    try {
      await Promise.race([
        document.fonts?.load(`12px ${family}`, '/|*'),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    } catch {
      /* draw with the fallback face */
    }
    if (this.abort.signal.aborted) return signalReady(this.root);

    this.surface.appendChild(this.canvas);
    this.readColors();
    this.layout();
    if (!this.grid) return signalReady(this.root);
    await this.syncClip();
    if (this.abort.signal.aborted) return signalReady(this.root);

    this.ro = new ResizeObserver(() => this.queueResize());
    this.ro.observe(this.surface);
    this.io = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) this.dispatch({ type: 'intersection-changed', offscreen: !entry.isIntersecting });
      },
      { rootMargin: '64px' },
    );
    this.io.observe(this.surface);

    const dissolveIn = () => {
      if (motionAllowed(this.flags) && !this.flags.hidden) this.revealStart = performance.now();
      this.schedule();
    };
    // Behind the entry loader, hold the dissolve-in until the page is revealed.
    const cl = document.documentElement.classList;
    if (cl.contains('is-loading') || cl.contains('is-arriving')) {
      document.addEventListener('ks:revealed', dissolveIn, { once: true, signal: this.abort.signal });
    } else {
      dissolveIn();
    }
    this.timeScale = motionAllowed(this.flags) ? 1 : 0;
    this.draw(performance.now());
    this.root.classList.add('is-live');
    if (this.button) this.button.hidden = false;
    this.syncUI();
    this.schedule();
    signalReady(this.root);
  }

  destroy(): void {
    this.abort.abort();
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.raf = this.timer = 0;
    clearTimeout(this.resizeTimer);
    this.ro?.disconnect();
    this.io?.disconnect();
    this.canvas.remove();
    this.root.classList.remove('is-live');
  }

  /* ---------------- state ---------------- */

  private dispatch(e: MotionEvent): void {
    const next = reduce(this.flags, e);
    if (next === this.flags) return;
    this.flags = next;
    this.syncUI();
    this.schedule();
  }

  private onToggle(): void {
    const wasMoving = motionAllowed(this.flags);
    this.dispatch({ type: 'toggle' });
    writeStoredPause(storage, wasMoving); // failure is harmless; the control still works
    if (wasMoving) {
      // A pause holds the current frame exactly.
      this.timeScale = 0;
      this.impulse = null;
    }
  }

  private onSettle(e: MouseEvent): void {
    if (!motionAllowed(this.flags)) return;
    const p = this.toNormalised(e.clientX, e.clientY);
    if (this.pond) {
      // In the pond a click (or tap) feeds the koi instead of settling the water.
      if (p) this.pond.feed(p.x * this.pond.w, p.y * this.pond.h);
      this.root.dataset.fed = String(Number(this.root.dataset.fed || 0) + 1);
      this.schedule();
      return;
    }
    if (p) this.impulse = { x: p.x, y: p.y, strength: 1 };
    this.dispatch({ type: 'settle' });
  }

  private onPointerMove(e: PointerEvent): void {
    if (e.pointerType === 'touch' || !shouldRun(this.flags)) return;
    const p = this.toNormalised(e.clientX, e.clientY);
    if (!p) return;
    if (this.pointer.inside) {
      this.pointer.vx += p.x - this.pointer.x;
      this.pointer.vy += p.y - this.pointer.y;
    }
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    this.pointer.inside = true;
    this.pointer.dirty = true;
  }

  private syncUI(): void {
    const state = deriveState(this.flags);
    this.root.dataset.state = state;
    const action = controlAction(this.flags);
    if (this.button) {
      const label = this.button.querySelector('[data-label]');
      const sr = this.button.querySelector('[data-sr]');
      if (label) label.textContent = ACTION_TEXT[action];
      if (sr) sr.textContent = ACTION_SR[action];
    }
    if (this.hint) {
      const fine = this.finePointer.matches;
      this.hint.textContent =
        state === 'reduced-motion'
          ? 'still · reduced motion'
          : state === 'user-paused'
            ? 'paused'
            : state === 'settled'
              ? 'settled'
              : this.pond
                ? fine
                  ? 'move to make ripples · click to feed'
                  : 'tap to feed the koi'
                : fine
                  ? 'move to disturb · click to settle'
                  : 'tap to settle';
    }
  }

  /* ---------------- scheduling ---------------- */

  private visible(): boolean {
    return !this.flags.hidden && !this.flags.offscreen;
  }

  /** Frames are needed while drifting, or briefly while easing into stillness. */
  private needsFrames(): boolean {
    if (!this.grid || !this.visible()) return false;
    if (shouldRun(this.flags)) return true;
    if (this.flags.userPaused || (this.flags.reducedMotion && !this.flags.motionOptIn)) return false;
    if (this.pond) return false;
    // settled: finish easing out, then stop
    return this.timeScale > 0.004 || this.hasDisplacement() || this.impulse !== null;
  }

  /**
   * One pending frame at most. Sleep on a timer until the next 20fps slot,
   * then align to the display with rAF — no 60Hz wake-ups between frames.
   */
  private schedule(): void {
    if (this.raf || this.timer || !this.needsFrames()) return;
    const wait = Math.max(0, this.frameMs - (performance.now() - this.lastFrame) - 4);
    if (wait > 0) {
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        if (!this.raf && this.needsFrames()) this.raf = requestAnimationFrame(this.tick);
      }, wait);
    } else {
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  private tick = (): void => {
    this.raf = 0;
    if (!this.needsFrames()) return;
    // One clock (performance.now) for both gating and timing: rAF timestamps can
    // lag far behind it under CPU throttling, which would let frames bunch up.
    const now = performance.now();
    if (now - this.lastFrame < this.frameMs - 6) {
      this.schedule();
      return;
    }
    // Clamp long gaps (tab switches, offscreen) so time never jumps.
    this.step(Math.min(now - this.lastFrame, this.frameMs * 3) / 1000);
    this.draw(now);
    this.lastFrame = now;
    this.schedule();
  };

  private step(dt: number): void {
    const target = motionAllowed(this.flags) ? 1 : 0;
    this.timeScale += (target - this.timeScale) * TIME_EASE;
    if (target === 0 && this.timeScale < 0.004) this.timeScale = 0;
    this.t += dt * this.timeScale;

    const g = this.grid!;
    if (this.pond) {
      const pond = this.pond;
      if (this.pointer.dirty && this.pointer.inside) {
        const speed = Math.hypot(this.pointer.vx * pond.w, this.pointer.vy * pond.h) / Math.max(dt, 0.016);
        pond.stir(this.pointer.x * pond.w, this.pointer.y * pond.h, speed);
        this.pointer.vx = this.pointer.vy = 0;
        this.pointer.dirty = false;
      }
      pond.step(dt * this.timeScale);
      return;
    }
    if (this.pointer.dirty && this.pointer.inside) {
      const speed = Math.hypot(this.pointer.vx, this.pointer.vy);
      this.applyImpulse(this.pointer.x, this.pointer.y, Math.min(1, 0.25 + speed * 18), this.pointer.vx);
      this.pointer.vx = this.pointer.vy = 0;
      this.pointer.dirty = false;
    }
    if (this.impulse) {
      this.applyImpulse(this.impulse.x, this.impulse.y, 2.4 * this.impulse.strength, 0, 1.8);
      this.impulse = null;
    }
    const n = g.cols * g.rows;
    for (let i = 0; i < n; i++) {
      this.dispX[i] *= DECAY;
      this.dispY[i] *= DECAY;
      this.push[i] *= DECAY;
    }
  }

  private applyImpulse(px: number, py: number, strength: number, vx: number, radiusScale = 1): void {
    const g = this.grid!;
    const aspect = (g.rows * g.pitchY) / (g.cols * g.pitchX); // height / width
    const r = POINTER_RADIUS * radiusScale;
    const c0 = Math.max(0, Math.floor((px - r) * g.cols));
    const c1 = Math.min(g.cols - 1, Math.ceil((px + r) * g.cols));
    const r0 = Math.max(0, Math.floor((py - r / aspect) * g.rows));
    const r1 = Math.min(g.rows - 1, Math.ceil((py + r / aspect) * g.rows));
    for (let row = r0; row <= r1; row++) {
      const ny = (row + 0.5) / g.rows;
      const dy = (ny - py) * aspect;
      for (let col = c0; col <= c1; col++) {
        const nx = (col + 0.5) / g.cols;
        const dx = nx - px;
        const d = Math.hypot(dx, dy);
        if (d >= r || d === 0) continue;
        const f = (1 - d / r) ** 2 * strength;
        const i = row * g.cols + col;
        this.dispX[i] = clamp(this.dispX[i] + (dx / d) * f * 0.012, MAX_DISP);
        this.dispY[i] = clamp(this.dispY[i] + ((dy / d) * f * 0.012) / aspect, MAX_DISP);
        this.push[i] = clamp(this.push[i] + vx * f * 6, MAX_PUSH);
      }
    }
  }

  private hasDisplacement(): boolean {
    for (let i = 0; i < this.dispX.length; i++) {
      if (Math.abs(this.dispX[i]) > 0.0004 || Math.abs(this.dispY[i]) > 0.0004 || Math.abs(this.push[i]) > 0.01) return true;
    }
    return false;
  }

  /* ---------------- layout + drawing ---------------- */

  private queueResize(): void {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      if (this.layout()) void this.syncClip().then(() => this.draw(performance.now()));
    }, 120);
  }

  /** Returns true when the grid changed. */
  private layout(): boolean {
    const box = this.surface.getBoundingClientRect();
    const cs = getComputedStyle(this.surface);
    const cols = Math.max(8, Number(cs.getPropertyValue('--field-cols')) || 70);
    const cssCellW = box.width / cols;
    const fontPx = cssCellW / CELL_W_EM;
    const rows = Math.max(4, Number(cs.getPropertyValue('--field-rows')) || Math.round(box.height / (fontPx * CELL_H_EM)));
    if (!box.width || !box.height || cols * rows > MAX_CELLS) return false;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const pitchX = cssCellW * dpr;
    const pitchY = fontPx * CELL_H_EM * dpr;
    const cw = Math.max(1, Math.ceil(pitchX));
    const ch = Math.max(1, Math.ceil(pitchY));

    const prev = this.grid;
    if (prev && prev.cols === cols && prev.rows === rows && Math.abs(prev.pitchX - pitchX) < 0.01 && Math.abs(prev.pitchY - pitchY) < 0.01) {
      return false;
    }
    this.grid = { cols, rows, pitchX, pitchY, cw, ch, fontPx, dpr };

    // Canvas matches the surface box exactly; cells sit on rounded positions.
    this.canvas.width = Math.round(cols * pitchX);
    this.canvas.height = Math.round(rows * pitchY);
    this.canvas.style.width = `${box.width}px`;
    this.canvas.style.height = `${(rows * pitchY) / dpr}px`;

    if (!prev || prev.cols !== cols || prev.rows !== rows) {
      const n = cols * rows;
      this.dispX = new Float32Array(n);
      this.dispY = new Float32Array(n);
      this.push = new Float32Array(n);
    }
    if (this.root.dataset.scene === 'koi') {
      const h = (rows * pitchY) / dpr;
      if (this.pond) this.pond.resize(box.width, h);
      else {
        this.pond = new Pond(box.width, h);
        this.frameMs = cols < 60 || !this.finePointer.matches ? KOI_FRAME_MS_SMALL : KOI_FRAME_MS;
      }
    }
    this.buildAtlas();
    return true;
  }

  /**
   * Load the clip matching the current grid (wide / narrow) when the page uses one.
   * Any failure leaves the procedural field in place.
   */
  private async syncClip(): Promise<void> {
    const g = this.grid;
    if (!g) return;
    const variant = g.cols >= 60 ? 'wide' : 'narrow';
    const url = variant === 'wide' ? this.root.dataset.clipWide : this.root.dataset.clipNarrow;
    if (!url || variant === this.clipVariant) return;
    let pending = this.clipCache.get(url);
    if (!pending) {
      pending = fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => (isFieldClip(j) ? j : null))
        .catch(() => null);
      this.clipCache.set(url, pending);
    }
    const clip = await pending;
    if (!clip) return;
    const first = !this.clip;
    this.clip = clip;
    this.clipVariant = variant;
    // Start on the poster frame so the canvas matches the server-rendered fallback.
    if (first) this.t = clip.poster / clip.fps;
  }

  private readColors(): void {
    const cs = getComputedStyle(this.root);
    this.colors = [0, 1, 2, 3].map((l) => cs.getPropertyValue(`--field-${l}`).trim() || '#8F779C');
  }

  /** Pre-render every glyph × level once per grid size; frames only blit. */
  private buildAtlas(): void {
    const g = this.grid!;
    const atlas = document.createElement('canvas');
    atlas.width = g.cw * ATLAS_GLYPHS.length;
    atlas.height = g.ch * 4;
    const a = atlas.getContext('2d');
    if (!a) return;
    const family = getComputedStyle(this.surface).fontFamily;
    a.font = `${g.fontPx * g.dpr}px ${family}`;
    a.textAlign = 'center';
    a.textBaseline = 'middle';
    for (let level = 0; level < 4; level++) {
      a.fillStyle = this.colors[level];
      ATLAS_GLYPHS.forEach((glyph, gi) => {
        a.fillText(glyph, gi * g.cw + g.cw / 2, level * g.ch + g.ch / 2);
      });
    }
    this.atlas = atlas;
  }

  private draw(now: number): void {
    const g = this.grid;
    if (!g || !this.atlas) return;
    // frame counter for tests and profiling (a plain property; no DOM writes)
    (this.root as HTMLElement & { __fieldFrames?: number }).__fieldFrames = ((this.root as HTMLElement & { __fieldFrames?: number }).__fieldFrames ?? 0) + 1;
    const { cols, rows, cw, ch, pitchX, pitchY } = g;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    let reveal = 1;
    if (this.revealStart >= 0) {
      reveal = Math.min(1, (now - this.revealStart) / REVEAL_MS);
      if (reveal >= 1) this.revealStart = -1;
    }

    if (this.pond) {
      const atlas = this.atlas;
      this.pond.render(cols, rows, (col, row, cell) => {
        if (reveal < 1 && hash2(col, row, this.seed + 313) > reveal) return;
        ctx.drawImage(atlas, KOI_TO_ATLAS[cell.glyph] * cw, cell.level * ch, cw, ch, Math.round(col * pitchX), Math.round(row * pitchY), cw, ch);
      });
      return;
    }
    if (this.clip) {
      this.drawClip(this.clip, reveal);
      return;
    }

    for (let row = 0; row < rows; row++) {
      const ny = (row + 0.5) / rows;
      const y = Math.round(row * pitchY);
      for (let col = 0; col < cols; col++) {
        if (reveal < 1 && hash2(col, row, this.seed + 313) > reveal) continue;
        const i = row * cols + col;
        const cell = sampleCell((col + 0.5) / cols, ny, this.t, col, row, this.seed, this.dispX[i], this.dispY[i], this.push[i]);
        if (cell.ch === ' ') continue;
        const gi = GLYPH_INDEX[cell.ch];
        ctx.drawImage(this.atlas, gi * cw, (cell.level as FieldLevel) * ch, cw, ch, Math.round(col * pitchX), y, cw, ch);
      }
    }
  }

  /**
   * Blit one clip frame. Playback follows field time, so pause, settle (eases to a
   * stop), and reduced motion (stays on the poster) behave exactly as they do for
   * the procedural field. Pointer displacement shifts where each cell samples from,
   * and sideways push bends upright strokes.
   */
  private drawClip(clip: FieldClip, reveal: number): void {
    const g = this.grid!;
    const { cols, rows, cw, ch, pitchX, pitchY } = g;
    const n = clip.frames.length;
    const frame = clip.frames[(((Math.floor(this.t * clip.fps) % n) + n) % n)];
    const sx = clip.cols / cols;
    const sy = clip.rows / rows;
    for (let row = 0; row < rows; row++) {
      const y = Math.round(row * pitchY);
      for (let col = 0; col < cols; col++) {
        if (reveal < 1 && hash2(col, row, this.seed + 313) > reveal) continue;
        const i = row * cols + col;
        const srcCol = Math.round(col - this.dispX[i] * cols);
        const srcRow = Math.round(row - this.dispY[i] * rows);
        if (srcCol < 0 || srcRow < 0 || srcCol >= cols || srcRow >= rows) continue;
        const packed = decodeCode(frame.charCodeAt(Math.floor(srcRow * sy) * clip.cols + Math.floor(srcCol * sx)));
        if (packed < 0) continue;
        let gi = packed >> 2;
        if (gi === BAR && Math.abs(this.push[i]) > 0.25) gi = this.push[i] > 0 ? SLASH : BACKSLASH;
        this.ctx.drawImage(this.atlas!, gi * cw, (packed & 3) * ch, cw, ch, Math.round(col * pitchX), y, cw, ch);
      }
    }
  }

  private toNormalised(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height };
  }
}

/** One atlas covers every scene: clip codec glyphs first (indices are part of the clip format), then koi extras. */
const ATLAS_GLYPHS: string[] = [...CELL_GLYPHS, ...KOI_GLYPHS.filter((g) => !(CELL_GLYPHS as readonly string[]).includes(g))];
const GLYPH_INDEX = Object.fromEntries(ATLAS_GLYPHS.map((g, i) => [g, i])) as Record<string, number>;
const KOI_TO_ATLAS = KOI_GLYPHS.map((g) => GLYPH_INDEX[g]);
const BAR = GLYPH_INDEX['|'];
const SLASH = GLYPH_INDEX['/'];
const BACKSLASH = GLYPH_INDEX['\\'];

/** Tell the entry loader this field has drawn (or given up and kept its text fallback). */
function signalReady(root: HTMLElement): void {
  if (root.dataset.ready) return;
  root.dataset.ready = 'true';
  document.dispatchEvent(new CustomEvent('ks:field-ready'));
}

function clamp(v: number, m: number): number {
  return v > m ? m : v < -m ? -m : v;
}

/** Enhance every field on the page. Safe to call once per page load. */
export function enhanceFields(): void {
  document.querySelectorAll<HTMLElement>('[data-ascii-field]').forEach((root) => {
    if (root.dataset.enhanced) return;
    root.dataset.enhanced = 'true';
    try {
      const probe = document.createElement('canvas');
      if (!probe.getContext('2d')) return signalReady(root); // static text fallback stays
      new AsciiField(root).start().catch(() => signalReady(root));
    } catch {
      signalReady(root); // static text fallback stays
    }
  });
}
