/**
 * Koi pond scene for the hero field: a few koi wander, lily pads float above them,
 * the pointer leaves ripples, and a click drops food the koi swim to.
 * Deterministic for a seed; world units are CSS pixels of the field surface.
 */
import { hash2 } from '../ascii/frames';
import { fishAt, glyphIndex as G, makeFish, strokeGlyph, swim, type Cell, type Fish } from './fish';

interface Pad {
  x: number;
  y: number;
  r: number;
  notch: number;
  flower: boolean;
}
interface Ripple {
  x: number;
  y: number;
  age: number;
  strength: number;
}
interface Food {
  x: number;
  y: number;
  age: number;
}

const RIPPLE_LIFE = 2.2;
const FOOD_LIFE = 9;

export class Pond {
  readonly fish: Fish[] = [];
  readonly pads: Pad[] = [];
  ripples: Ripple[] = [];
  food: Food[] = [];
  t = 0;
  private lastRipple = -1;

  constructor(
    public w: number,
    public h: number,
    readonly seed = 11,
  ) {
    const len = Math.max(80, Math.min(170, w * 0.21));
    const spots: [number, number, number][] = [
      [0.28, 0.35, 0.2],
      [0.66, 0.62, 2.6],
      [0.48, 0.8, -0.5],
    ];
    spots.forEach(([fx, fy, a], i) => this.fish.push(makeFish(fx * w, fy * h, a, len * (1 - i * 0.08), seed + i * 7)));
    const pr = Math.max(24, Math.min(54, w * 0.06));
    this.pads.push({ x: 0.84 * w, y: 0.26 * h, r: pr, notch: 2.3, flower: true });
    this.pads.push({ x: 0.12 * w, y: 0.74 * h, r: pr * 0.8, notch: -0.6, flower: false });
    this.pads.push({ x: 0.93 * w, y: 0.5 * h, r: pr * 0.55, notch: 0.9, flower: false });
  }

  resize(w: number, h: number): void {
    const sx = w / this.w;
    const sy = h / this.h;
    for (const f of this.fish) {
      f.x *= sx;
      f.y *= sy;
    }
    for (const p of this.pads) {
      p.x *= sx;
      p.y *= sy;
    }
    this.w = w;
    this.h = h;
  }

  /** Pointer moving over the water: ripples every so often, faster motion = stronger. */
  stir(x: number, y: number, speed: number): void {
    if (this.t - this.lastRipple < 0.18) return;
    this.lastRipple = this.t;
    this.ripples.push({ x, y, age: 0, strength: Math.min(1, 0.35 + speed / 900) });
    if (this.ripples.length > 10) this.ripples.shift();
  }

  /** Click / tap: drop food and a strong ripple; koi turn toward it. */
  feed(x: number, y: number): void {
    this.food.push({ x, y, age: 0 });
    if (this.food.length > 4) this.food.shift();
    this.ripples.push({ x, y, age: 0, strength: 1 });
  }

  step(dt: number): void {
    if (dt <= 0) return;
    this.t += dt;
    const { w, h } = this;
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter((r) => r.age < RIPPLE_LIFE);
    for (const f of this.food) f.age += dt;
    this.food = this.food.filter((f) => f.age < FOOD_LIFE);

    this.fish.forEach((f, i) => {
      // wander: slow, smooth heading drift
      let desired = f.a + Math.sin(this.t * 0.31 + i * 2.1) * 0.6 + Math.sin(this.t * 0.13 + i) * 0.5;
      let speed = 34 + 10 * Math.sin(this.t * 0.4 + i * 1.7);
      // food: a pellet pulls the nearest koi (and the runner-up), not the whole pond
      let best: Food | null = null;
      let bestD = Infinity;
      for (const p of this.food) {
        const d = Math.hypot(p.x - f.x, p.y - f.y);
        const rank = this.fish.filter((o) => Math.hypot(p.x - o.x, p.y - o.y) < d).length;
        if (rank < 2 && d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best) {
        desired = Math.atan2(best.y - f.y, best.x - f.x);
        speed = Math.min(110, 50 + bestD * 0.5);
        if (bestD < f.len * 0.3) this.food = this.food.filter((p) => p !== best);
      }
      // keep inside the pond: steer back toward the middle near the edges
      const m = f.len * 0.55;
      const out = Math.max(m - f.x, f.x - (w - m), m - f.y, f.y - (h - m), 0);
      if (out > 0) {
        const home = Math.atan2(h / 2 - f.y, w / 2 - f.x);
        const k = Math.min(1, out / m);
        desired = mixAngle(desired, home, 0.4 + 0.6 * k);
      }
      // keep a little apart from each other
      for (const o of this.fish) {
        if (o === f) continue;
        const d = Math.hypot(o.x - f.x, o.y - f.y);
        const room = f.len * 1.05;
        if (d < room) desired = mixAngle(desired, Math.atan2(f.y - o.y, f.x - o.x), 0.45 * (1 - d / room));
      }
      swim(f, dt, desired, speed, best ? 2.6 : 1.6);
    });
  }

  /** Visit every visible cell (fish under pads; ripples and caustics on the water). */
  render(cols: number, rows: number, put: (col: number, row: number, cell: Cell) => void): void {
    const cw = this.w / cols;
    const ch = this.h / rows;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = (col + 0.5) * cw;
        const y = (row + 0.5) * ch;
        const cell = this.padAt(x, y, cw, ch) ?? this.fishCell(x, y, cw, ch) ?? this.foodAt(x, y, cw, ch) ?? this.waterAt(col, row, x, y, cw, ch);
        if (cell) put(col, row, cell);
      }
    }
  }

  private fishCell(x: number, y: number, cw: number, ch: number): Cell | null {
    for (const f of this.fish) {
      if (Math.abs(x - f.x) > f.len * 0.75 || Math.abs(y - f.y) > f.len * 0.75) continue;
      const c = fishAt(f, x, y, cw, ch);
      if (c) return c;
    }
    return null;
  }

  private padAt(x: number, y: number, cw: number, ch: number): Cell | null {
    for (const p of this.pads) {
      const dx = (x - p.x) / p.r;
      const dy = (y - p.y) / p.r;
      const d = Math.hypot(dx, dy);
      const edge = (0.5 * Math.hypot(cw, ch)) / p.r;
      if (d > 1 + edge * 0.3) continue;
      // the notch: a thin wedge cut toward the centre
      const ang = Math.atan2(dy, dx);
      const off = Math.abs(Math.atan2(Math.sin(ang - p.notch), Math.cos(ang - p.notch)));
      if (off < 0.28 && d > 0.15) return null;
      if (p.flower && d < 0.32) return { glyph: d < 0.16 ? G['@'] : G['*'], level: 3 };
      if (d > 1 - edge * 0.9) return { glyph: strokeGlyph(ang + Math.PI / 2), level: 2 };
      // veins radiating from the centre, otherwise a quiet fill
      const vein = Math.abs(Math.sin((ang - p.notch) * 4)) < 0.18;
      return { glyph: vein ? strokeGlyph(ang) : G[':'], level: vein ? 2 : 1 };
    }
    return null;
  }

  private foodAt(x: number, y: number, cw: number, ch: number): Cell | null {
    for (const p of this.food) {
      if (Math.abs(x - p.x) < cw * 0.6 && Math.abs(y - p.y) < ch * 0.6) return { glyph: G['o'], level: 3 };
    }
    return null;
  }

  private waterAt(col: number, row: number, x: number, y: number, cw: number, ch: number): Cell | null {
    // ripple rings
    for (const r of this.ripples) {
      const radius = 8 + r.age * 70;
      const d = Math.hypot(x - r.x, y - r.y);
      const ring = Math.abs(d - radius);
      const fade = (1 - r.age / RIPPLE_LIFE) * r.strength;
      if (ring < Math.max(cw, ch) * 0.5 && fade > 0.12 && hash2(col, row, Math.floor(r.age * 5)) < 0.55 + fade * 0.4) {
        const ang = Math.atan2(y - r.y, x - r.x);
        return { glyph: fade > 0.5 ? strokeGlyph(ang + Math.PI / 2) : G['.'], level: fade > 0.5 ? 2 : 1 };
      }
    }
    // faint drifting caustics so the water reads as water
    const shimmer = hash2(col, row, 77);
    if (shimmer < 0.035) {
      const flick = Math.sin(this.t * (0.6 + shimmer * 9) + shimmer * 40);
      if (flick > 0.45) return { glyph: shimmer < 0.008 ? G['~'] : G['.'], level: 0 };
    }
    return null;
  }
}

function mixAngle(a: number, b: number, k: number): number {
  return Math.atan2(Math.sin(a) * (1 - k) + Math.sin(b) * k, Math.cos(a) * (1 - k) + Math.cos(b) * k);
}

/** Text rendering of one moment (no-JS fallback, previews). */
export function pondText(pond: Pond, cols: number, rows: number, glyphs: readonly string[]): string {
  const grid = Array.from({ length: rows }, () => new Array<string>(cols).fill(' '));
  pond.render(cols, rows, (c, r, cell) => (grid[r][c] = glyphs[cell.glyph]));
  return grid.map((l) => l.join('').replace(/\s+$/, '')).join('\n');
}
