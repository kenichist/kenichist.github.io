/**
 * A single koi that follows the pointer whenever the homepage pond is out of view
 * (scrolled past) and on every other page. Decorative: pointer-events none,
 * hidden from assistive tech, drawn beneath the page text.
 *
 * Off for: touch-only devices (no hover pointer), reduced motion, and visitors who
 * paused the hero animation. Stops scheduling frames when the tab is hidden and
 * slows, then rests, when the pointer goes idle.
 */
import { centre, fishAt, KOI_GLYPHS, makeFish, pose, swim, type Fish } from './fish';

const FONT_PX = 12;
const CELL_W = FONT_PX * 0.78;
const CELL_H = FONT_PX * 1.28;
const LEN = 112; // px
const COLS = 17;
const ROWS = 11;
const FRAME_MS = 1000 / 30;
const IDLE_SLOW_MS = 5000;
const IDLE_REST_MS = 25000;
const STATE_KEY = 'ks-koi';
const PAUSE_KEY = 'ks-field-paused';

interface Saved {
  x: number;
  y: number;
  a: number;
  ts: number;
}

export function startFollower(): void {
  if (document.body.dataset.follower !== 'koi') return;
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (!fine.matches || reduced.matches) return;
  try {
    if (localStorage.getItem(PAUSE_KEY) === '1') return;
  } catch {
    /* storage blocked: follower allowed */
  }

  const begin = () => new Follower().init();
  if (document.documentElement.classList.contains('is-loading')) document.addEventListener('ks:revealed', begin, { once: true });
  else begin();
}

class Follower {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d');
  private atlas: HTMLCanvasElement | null = null;
  private fish: Fish | null = null;
  private target: { x: number; y: number } | null = null;
  private lastMove = 0;
  private active = false;
  private raf = 0;
  private timer = 0;
  private last = 0;
  private orbit = 1;
  private readonly dpr = Math.min(2, window.devicePixelRatio || 1);
  private readonly w = COLS * CELL_W;
  private readonly h = ROWS * CELL_H;

  async init(): Promise<void> {
    if (!this.ctx) return;
    try {
      await document.fonts?.ready;
    } catch {
      /* fallback face */
    }
    const c = this.canvas;
    c.className = 'koi-follower';
    c.setAttribute('aria-hidden', 'true');
    c.width = Math.round(this.w * this.dpr);
    c.height = Math.round(this.h * this.dpr);
    c.style.width = `${this.w}px`;
    c.style.height = `${this.h}px`;
    document.body.prepend(c);
    this.buildAtlas();

    addEventListener('pointermove', (e) => this.onMove(e), { passive: true });
    document.documentElement.addEventListener('pointerleave', () => (this.lastMove = performance.now() - IDLE_SLOW_MS));
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.schedule()));
    addEventListener('pagehide', () => this.save());

    // On the homepage, only follow while the pond is out of view.
    const pond = document.querySelector('[data-ascii-field][data-scene="koi"]');
    if (pond) {
      new IntersectionObserver((entries) => {
        const e = entries[entries.length - 1];
        if (e) this.setActive(!e.isIntersecting, 'from-pond');
      }).observe(pond);
    } else {
      this.setActive(true, 'restore');
    }
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    this.target = { x: e.clientX, y: e.clientY };
    this.lastMove = performance.now();
    if (this.active && !this.fish) this.spawn('edge');
    this.schedule();
  }

  private setActive(on: boolean, how: 'from-pond' | 'restore'): void {
    if (on === this.active) return;
    this.active = on;
    this.canvas.classList.toggle('is-on', on);
    if (on) {
      if (!this.fish) this.spawn(how);
      this.schedule();
    }
  }

  /** Place the koi: carried over from the previous page, out of the pond above, or in from the nearest edge. */
  private spawn(how: 'from-pond' | 'restore' | 'edge'): void {
    const vw = innerWidth;
    const vh = innerHeight;
    const t = this.target ?? { x: vw * 0.7, y: vh * 0.6 };
    let saved: Saved | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
    } catch {
      saved = null;
    }
    if (how === 'restore' && saved && Date.now() - saved.ts < 20000) {
      this.fish = makeFish(saved.x, saved.y, saved.a, LEN, 23);
    } else if (how === 'from-pond') {
      this.fish = makeFish(t.x, -LEN, Math.PI / 2, LEN, 23); // swims down out of the pond
    } else if (this.target) {
      const edges = [
        { x: -LEN, y: t.y, a: 0, d: t.x },
        { x: vw + LEN, y: t.y, a: Math.PI, d: vw - t.x },
        { x: t.x, y: vh + LEN, a: -Math.PI / 2, d: vh - t.y },
      ].sort((p, q) => p.d - q.d);
      const e = edges[0];
      this.fish = makeFish(e.x, e.y, e.a, LEN, 23);
    } else {
      return; // wait for the first pointer movement
    }
    this.fish.v = 140;
  }

  private save(): void {
    if (!this.fish || !this.active) return;
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify({ x: this.fish.x, y: this.fish.y, a: this.fish.a, ts: Date.now() } satisfies Saved));
    } catch {
      /* ignore */
    }
  }

  private schedule(): void {
    if (this.raf || this.timer || document.hidden || !this.fish) return;
    const idle = performance.now() - this.lastMove;
    if (this.active && idle > IDLE_REST_MS && this.fish.v < 4) return; // resting
    if (!this.active && this.offscreen()) return; // swam away
    const frame = idle > IDLE_SLOW_MS ? FRAME_MS * 2 : FRAME_MS;
    const wait = Math.max(0, frame - (performance.now() - this.last) - 4);
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.raf = requestAnimationFrame(this.tick);
    }, wait);
  }

  private stop(): void {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.raf = this.timer = 0;
    this.save();
  }

  private offscreen(): boolean {
    const f = this.fish!;
    return f.y < -LEN * 1.5 || f.y > innerHeight + LEN * 1.5 || f.x < -LEN * 1.5 || f.x > innerWidth + LEN * 1.5;
  }

  private tick = (): void => {
    this.raf = 0;
    const now = performance.now();
    const dt = Math.min(0.1, (now - (this.last || now - FRAME_MS)) / 1000);
    this.last = now;
    this.update(dt, now);
    this.draw();
    this.schedule();
  };

  private update(dt: number, now: number): void {
    const f = this.fish!;
    if (!this.active) {
      // pond back in view: swim up and away
      swim(f, dt, -Math.PI / 2, 180, 3);
      return;
    }
    const t = this.target;
    if (!t) {
      swim(f, dt, f.a + Math.sin(now / 1700) * 0.4, 20);
      return;
    }
    const dx = t.x - f.x;
    const dy = t.y - f.y;
    const d = Math.hypot(dx, dy);
    const toward = Math.atan2(dy, dx);
    const idle = now - this.lastMove;
    const ring = 70;
    if (d > ring * 1.4) {
      swim(f, dt, toward, Math.min(320, 40 + d * 1.3), 3.4);
    } else {
      // close: circle lazily around the pointer instead of sitting on it
      if (d < ring * 0.5) this.orbit = Math.sin(f.a - toward) > 0 ? 1 : -1;
      const tangent = toward - this.orbit * (Math.PI / 2 - (d - ring) / ring);
      const speed = idle > IDLE_REST_MS ? 0 : idle > IDLE_SLOW_MS ? 16 : 42;
      swim(f, dt, tangent, speed, 2.4);
    }
  }

  private buildAtlas(): void {
    const cw = Math.ceil(CELL_W * this.dpr);
    const ch = Math.ceil(CELL_H * this.dpr);
    const atlas = document.createElement('canvas');
    atlas.width = cw * KOI_GLYPHS.length;
    atlas.height = ch * 4;
    const a = atlas.getContext('2d')!;
    const cs = getComputedStyle(document.documentElement);
    a.font = `${FONT_PX * this.dpr}px ${getComputedStyle(document.body).fontFamily}`;
    a.textAlign = 'center';
    a.textBaseline = 'middle';
    for (let level = 0; level < 4; level++) {
      a.fillStyle = cs.getPropertyValue(`--field-${level}`).trim() || '#8f779c';
      KOI_GLYPHS.forEach((g, gi) => a.fillText(g, gi * cw + cw / 2, level * ch + ch / 2));
    }
    this.atlas = atlas;
  }

  private draw(): void {
    const f = this.fish!;
    const ctx = this.ctx!;
    const cw = Math.ceil(CELL_W * this.dpr);
    const ch = Math.ceil(CELL_H * this.dpr);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // the canvas is centred on the koi's body; sample the real (bending) koi in page coordinates
    const c = centre(f);
    const ox = c.x - this.w / 2;
    const oy = c.y - this.h / 2;
    const p = pose(f);
    for (let r = 0; r < ROWS; r++) {
      for (let col = 0; col < COLS; col++) {
        const cell = fishAt(f, p, ox + (col + 0.5) * CELL_W, oy + (r + 0.5) * CELL_H, CELL_W, CELL_H);
        if (!cell) continue;
        ctx.drawImage(this.atlas!, cell.glyph * cw, cell.level * ch, cw, ch, Math.round(col * CELL_W * this.dpr), Math.round(r * CELL_H * this.dpr), cw, ch);
      }
    }
    this.canvas.style.transform = `translate3d(${ox.toFixed(1)}px, ${oy.toFixed(1)}px, 0)`;
  }
}
