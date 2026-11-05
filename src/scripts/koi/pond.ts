/**
 * Koi pond scene for the hero field: a few koi wander, lily pads float above them,
 * the pointer leaves ripples, and a click drops food the koi swim to.
 * Deterministic for a seed; world units are CSS pixels of the field surface.
 */
import { hash2 } from '../ascii/frames';
import { centre, fishAt, glyphIndex as G, makeFish, pose, strokeGlyph, swim, type Cell, type Fish, type Pose } from './fish';

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

interface Plan {
  /** where this koi is heading */
  tx: number;
  ty: number;
  /** cruising speed for this leg */
  cruise: number;
  /** seconds until a new destination even if this one isn't reached */
  ttl: number;
  /** burst-and-glide clock */
  clock: number;
  /** startle: dart away until this time */
  dartUntil: number;
}

export class Pond {
  readonly fish: Fish[] = [];
  readonly pads: Pad[] = [];
  ripples: Ripple[] = [];
  food: Food[] = [];
  t = 0;
  private lastRipple = -1;
  private plans: Plan[] = [];
  private rng: number;
  private poses: Pose[] = [];

  constructor(
    public w: number,
    public h: number,
    readonly seed = 11,
  ) {
    this.rng = seed * 7919;
    // two grown koi and a young one
    const spots: [number, number, number, number][] = [
      [0.3, 0.36, 0.25, 0.25],
      [0.7, 0.66, 2.75, 0.23],
      [0.5, 0.84, -0.4, 0.14],
    ];
    spots.forEach(([fx, fy, a, size], i) => {
      const f = makeFish(fx * w, fy * h, a, Math.max(64, Math.min(190, w * size)), seed + i * 7);
      f.v = 30;
      this.fish.push(f);
      this.plans.push(this.newPlan(f, i));
    });
    const pr = Math.max(24, Math.min(54, w * 0.06));
    this.pads.push({ x: 0.84 * w, y: 0.26 * h, r: pr, notch: 2.3, flower: true });
    this.pads.push({ x: 0.12 * w, y: 0.74 * h, r: pr * 0.8, notch: -0.6, flower: false });
    this.pads.push({ x: 0.93 * w, y: 0.5 * h, r: pr * 0.55, notch: 0.9, flower: false });
  }

  /** Deterministic 0..1 random numbers. */
  private rand(): number {
    this.rng = (Math.imul(this.rng, 1103515245) + 12345) >>> 0;
    return this.rng / 4294967296;
  }

  /**
   * Pick the next destination: somewhere open, mostly ahead (koi rarely double back),
   * at a fresh cruising speed.
   */
  private newPlan(f: Fish, i: number): Plan {
    const m = f.len * 0.7;
    let best = { x: this.w / 2, y: this.h / 2 };
    let bestScore = -Infinity;
    for (let k = 0; k < 6; k++) {
      const x = m + this.rand() * Math.max(1, this.w - 2 * m);
      const y = m * 0.6 + this.rand() * Math.max(1, this.h - 1.2 * m);
      const dist = Math.hypot(x - f.x, y - f.y);
      const turn = Math.abs(Math.atan2(Math.sin(Math.atan2(y - f.y, x - f.x) - f.a), Math.cos(Math.atan2(y - f.y, x - f.x) - f.a)));
      // stay out of each other's way: avoid where the others are and where they're going
      let crowd = 0;
      this.fish.forEach((o, j) => {
        if (o === f) return;
        const c = centre(o);
        crowd += Math.max(0, 1 - Math.hypot(c.x - x, c.y - y) / (f.len * 1.8));
        const pl = this.plans[j];
        if (pl) crowd += Math.max(0, 1 - Math.hypot(pl.tx - x, pl.ty - y) / (f.len * 1.8));
      });
      const score = Math.min(dist, this.w * 0.5) / this.w - turn * 0.35 - crowd * 0.6 + this.rand() * 0.2;
      if (dist > f.len * 1.2 && score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    return { tx: best.x, ty: best.y, cruise: 26 + this.rand() * 22, ttl: 9 + this.rand() * 8, clock: this.rand() * 3 + i, dartUntil: -1 };
  }

  resize(w: number, h: number): void {
    const sx = w / this.w;
    const sy = h / this.h;
    for (const f of this.fish) {
      f.x *= sx;
      f.y *= sy;
      for (let i = 0; i < f.chain.length; i += 2) {
        f.chain[i] *= sx;
        f.chain[i + 1] *= sy;
      }
    }
    for (const p of this.plans) {
      p.tx *= sx;
      p.ty *= sy;
    }
    for (const p of this.pads) {
      p.x *= sx;
      p.y *= sy;
    }
    this.w = w;
    this.h = h;
  }

  /** Pointer moving over the water: ripples; a fast pass right overhead startles nearby koi. */
  stir(x: number, y: number, speed: number): void {
    if (this.t - this.lastRipple < 0.18) return;
    this.lastRipple = this.t;
    this.ripples.push({ x, y, age: 0, strength: Math.min(1, 0.35 + speed / 900) });
    if (this.ripples.length > 10) this.ripples.shift();
    if (speed < 450) return;
    this.fish.forEach((f, i) => {
      const c = centre(f);
      const d = Math.hypot(c.x - x, c.y - y);
      if (d > f.len * 0.9) return;
      // dart away: a destination on the far side, fast
      const away = Math.atan2(c.y - y, c.x - x);
      const p = this.plans[i];
      p.tx = Math.min(this.w - f.len * 0.6, Math.max(f.len * 0.6, f.x + Math.cos(away) * f.len * 2));
      p.ty = Math.min(this.h - f.len * 0.4, Math.max(f.len * 0.4, f.y + Math.sin(away) * f.len * 2));
      p.dartUntil = this.t + 0.9;
      p.ttl = 4;
    });
  }

  /** Click / tap: drop food and a strong ripple; the nearest koi swim over to eat it. */
  feed(x: number, y: number): void {
    this.food.push({ x, y, age: 0 });
    if (this.food.length > 4) this.food.shift();
    this.ripples.push({ x, y, age: 0, strength: 1 });
  }

  step(dt: number): void {
    if (dt <= 0) return;
    this.t += dt;
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter((r) => r.age < RIPPLE_LIFE);
    for (const f of this.food) f.age += dt;
    this.food = this.food.filter((f) => f.age < FOOD_LIFE);

    this.fish.forEach((f, i) => {
      const plan = this.plans[i];
      plan.ttl -= dt;
      plan.clock += dt;

      // food: a pellet pulls the nearest koi (and the runner-up), not the whole pond
      let food: Food | null = null;
      let foodD = Infinity;
      for (const p of this.food) {
        const d = Math.hypot(p.x - f.x, p.y - f.y);
        const rank = this.fish.filter((o) => Math.hypot(p.x - o.x, p.y - o.y) < d).length;
        if (rank < 2 && d < foodD) {
          foodD = d;
          food = p;
        }
      }

      let tx = plan.tx;
      let ty = plan.ty;
      let speed: number;
      if (food) {
        tx = food.x;
        ty = food.y;
        speed = Math.min(85, 38 + foodD * 0.35);
        if (foodD < f.len * 0.14) this.food = this.food.filter((p) => p !== food);
      } else if (this.t < plan.dartUntil) {
        speed = 120;
      } else {
        // burst and glide: a few tail strokes, then coast
        const cycle = 2.6 + (i % 2) * 0.7;
        const stroking = plan.clock % cycle < cycle * 0.42;
        speed = stroking ? plan.cruise : plan.cruise * 0.5;
        if (Math.hypot(tx - f.x, ty - f.y) < f.len * 0.6 || plan.ttl <= 0) this.plans[i] = this.newPlan(f, i);
      }

      let desired = Math.atan2(ty - f.y, tx - f.x);
      // look ahead: where will each neighbour be over the next two seconds? pass clear of it
      const vfx = Math.cos(f.a) * f.v;
      const vfy = Math.sin(f.a) * f.v;
      const cf = centre(f);
      this.fish.forEach((o, j) => {
        if (o === f) return;
        const c = centre(o);
        const rx = c.x - cf.x;
        const ry = c.y - cf.y;
        const vrx = Math.cos(o.a) * o.v - vfx;
        const vry = Math.sin(o.a) * o.v - vfy;
        const vv = vrx * vrx + vry * vry;
        const tStar = vv > 1e-3 ? Math.min(2, Math.max(0, -(rx * vrx + ry * vry) / vv)) : 0;
        const px = rx + vrx * tStar;
        const py = ry + vry * tStar;
        const dmin = Math.hypot(px, py);
        const near = Math.hypot(rx, ry);
        const clear = (f.len + o.len) * 0.85;
        const threat = Math.max(dmin < clear ? (1 - dmin / clear) * (1 - tStar / 2.4) : 0, near < clear ? 1 - near / clear : 0);
        if (threat <= 0) return;
        // steer away from the neighbour's predicted position; the later koi also yields speed
        desired = mixAngle(desired, Math.atan2(-(py || ry), -(px || rx)), Math.min(0.85, 0.75 * threat + 0.1));
        speed *= 1 - (j < i ? 0.6 : 0.3) * threat;
        if (Math.hypot(plan.tx - c.x, plan.ty - c.y) < f.len) plan.ttl = 0;
      });
      // the bank comes last and wins: the closer the nose (or where it's about to be) is to
      // the edge, the harder the koi bends back toward open water, and it never races at it
      const m = f.len * 0.3;
      const ax = f.x + Math.cos(f.a) * f.len * 0.7;
      const ay = f.y + Math.sin(f.a) * f.len * 0.7;
      const edge = (px: number, py: number) => Math.min(px, this.w - px, py * 1.6, (this.h - py) * 1.6);
      const room = Math.min(edge(f.x, f.y), edge(ax, ay));
      if (room < m) {
        const k = Math.min(1, (m - room) / m);
        desired = mixAngle(desired, Math.atan2(this.h / 2 - f.y, this.w / 2 - f.x), 0.35 + 0.6 * k);
        speed = Math.max(speed * (1 - 0.4 * k), 18);
      }
      swim(f, dt, desired, speed, food || this.t < plan.dartUntil ? 2.2 : 1.1 + (room < m ? 0.8 : 0));
    });
  }

  /** Visit every visible cell (koi under the pads; ripples and caustics on the water). */
  render(cols: number, rows: number, put: (col: number, row: number, cell: Cell) => void): void {
    const cw = this.w / cols;
    const ch = this.h / rows;
    this.poses = this.fish.map(pose);
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
    for (let i = 0; i < this.fish.length; i++) {
      const c = fishAt(this.fish[i], this.poses[i], x, y, cw, ch);
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
