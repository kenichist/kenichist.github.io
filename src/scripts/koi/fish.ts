/**
 * A koi drawn in characters, seen from above. Pure: state + steering + rasterisation.
 * Shared by the homepage pond (pond.ts) and the pointer follower (follower.ts).
 *
 * World units are CSS pixels. Glyphs stay upright; the body shape is sampled per
 * character cell in the fish's local frame, so it can face any direction.
 */
import { hash2 } from '../ascii/frames';

/** Glyphs a koi scene may emit (all in the font subset). */
export const KOI_GLYPHS = ['.', ':', "'", '|', '/', '\\', '-', '+', '*', 'o', '@', '~', '=', '(', ')', '<', '>', ','] as const;
export type KoiGlyph = (typeof KOI_GLYPHS)[number];
const G = Object.fromEntries(KOI_GLYPHS.map((g, i) => [g, i])) as Record<KoiGlyph, number>;

export interface Fish {
  x: number;
  y: number;
  /** heading, radians (0 = +x, y down) */
  a: number;
  /** speed, px/s */
  v: number;
  /** tail-beat phase */
  phase: number;
  /** body length, px */
  len: number;
  seed: number;
}

export function makeFish(x: number, y: number, a: number, len: number, seed: number): Fish {
  return { x, y, a, v: 0, phase: hash2(seed, 1, 3) * 6.28, len, seed };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Turn toward `desired` heading (limited turn rate), ease speed toward `speed`,
 * advance position, and beat the tail faster when swimming faster.
 */
export function swim(f: Fish, dt: number, desired: number, speed: number, turnRate = 2.2): void {
  const diff = wrap(desired - f.a);
  const maxTurn = turnRate * dt;
  f.a = wrap(f.a + Math.max(-maxTurn, Math.min(maxTurn, diff)));
  f.v += (speed - f.v) * Math.min(1, dt * 1.8);
  f.x += Math.cos(f.a) * f.v * dt;
  f.y += Math.sin(f.a) * f.v * dt;
  f.phase += dt * (2.2 + f.v / 22 + Math.abs(diff) * 2);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Lateral bend of the spine at u (−0.5 tail … +0.5 head), as a fraction of length. */
function bend(f: Fish, u: number): number {
  const fromHead = 0.5 - u; // 0 at the head, 1 at the tail
  return 0.07 * Math.sin(f.phase - fromHead * 4.2) * fromHead ** 1.6;
}

/** Half-width of the body at u, as a fraction of length (0 outside the body). */
function halfWidth(u: number): number {
  if (u > 0.5 || u < -0.34) return 0;
  // plump koi body: widest a little ahead of the middle, rounded head, tapering to the tail root
  const round = Math.sqrt(Math.max(0, 1 - ((u - 0.08) / 0.43) ** 2));
  return 0.17 * round * (0.32 + 0.68 * smoothstep(-0.34, 0.08, u));
}

export interface Cell {
  glyph: number;
  level: 0 | 1 | 2 | 3;
}

/**
 * Sample the fish at a world point. Returns null where there is no fish.
 * `cellW`/`cellH` are the character cell size, used to thicken thin parts so they
 * survive the coarse grid.
 */
export function fishAt(f: Fish, px: number, py: number, cellW: number, cellH: number): Cell | null {
  const dx = px - f.x;
  const dy = py - f.y;
  const ca = Math.cos(f.a);
  const sa = Math.sin(f.a);
  const L = f.len;
  const u = (dx * ca + dy * sa) / L;
  if (u > 0.56 || u < -0.62) return null;
  const vRaw = (-dx * sa + dy * ca) / L;
  const v = vRaw - bend(f, Math.max(-0.5, u));
  const slack = (0.5 * Math.hypot(cellW * sa, cellH * ca)) / L; // half a cell across the body
  const w = halfWidth(u);

  // body
  if (w > 0 && Math.abs(v) < w + slack * 0.55) {
    const edge = Math.abs(v) > w - slack * 0.6;
    // eyes: one bright mark each side of the head
    if (u > 0.3 && u < 0.4 && Math.abs(Math.abs(v) - w * 0.55) < slack * 0.7) return { glyph: G['@'], level: 3 };
    if (edge || u > 0.42) {
      // outline strokes follow the body direction (bent near the tail)
      const tangent = f.a + Math.atan(0.07 * 4.2 * Math.cos(f.phase - (0.5 - u) * 4.2) * (0.5 - u) ** 1.6);
      return { glyph: strokeGlyph(tangent), level: 2 };
    }
    // koi markings: soft patches from a per-fish noise field
    const spot = hash2(Math.floor((u + 1) * 7), Math.floor((v + 1) * 9), f.seed) * 0.6 + hash2(Math.floor((u + 1) * 3.5), 0, f.seed + 9) * 0.4;
    if (spot > 0.6) return { glyph: G['o'], level: 3 };
    return { glyph: G['='], level: 1 };
  }

  // pectoral fins: small lobes just behind the head, flapping slowly
  const finU = u - 0.2;
  if (Math.abs(finU) < 0.07 + slack * 0.3) {
    const side = Math.sign(v) || 1;
    const out = Math.abs(v) - halfWidth(0.2);
    const flap = 0.05 + 0.02 * Math.sin(f.phase * 0.5 + side);
    if (out > 0 && out < flap + slack * 0.6 && finU < 0.04) return { glyph: G[side > 0 ? ',' : "'"], level: 1 };
  }

  // tail fin: a forked fan behind the body that follows the bend
  if (u < -0.3 && u > -0.6) {
    const t = (-0.3 - u) / 0.3; // 0 at the root, 1 at the tip
    const tv = vRaw - bend(f, -0.5) * (1 + t * 0.8);
    const spread = 0.03 + 0.17 * t;
    const notch = t > 0.65 && Math.abs(tv) < 0.05 * (t - 0.65) / 0.35;
    if (Math.abs(tv) < spread + slack * 0.5 && !notch) {
      const tipEdge = t > 0.78 || Math.abs(tv) > spread - slack * 0.5;
      if (tipEdge) return { glyph: strokeGlyph(f.a + Math.sign(tv || 1) * 0.9 * t), level: 2 };
      return { glyph: G[':'], level: 1 };
    }
  }
  return null;
}

/** Character for a line running at angle `a` (screen coords, y down). */
export function strokeGlyph(a: number): number {
  let deg = (-a * 180) / Math.PI; // y-up degrees
  while (deg <= -90) deg += 180;
  while (deg > 90) deg -= 180;
  const m = Math.abs(deg);
  if (m > 67.5) return G['|'];
  if (m < 22.5) return G['-'];
  return deg > 0 ? G['/'] : G['\\'];
}

export const glyphIndex = G;
