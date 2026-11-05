/**
 * Procedural character field: an airy band of wind-bent stems.
 *
 * Pure and deterministic. The same function renders the static,
 * server-side fallback frame and every animated canvas frame, so the
 * first paint and the first animated frame share one seeded pattern.
 */

import { CELL_GLYPHS, hash2 } from './frames';

export { hash2 };

/** Characters the procedural field emits (a subset of CELL_GLYPHS). */
export const FIELD_GLYPHS = ['.', ':', "'", '|', '/', '+', '*'] as const satisfies readonly (typeof CELL_GLYPHS)[number][];
export type FieldGlyph = (typeof FIELD_GLYPHS)[number];

/** Brightness tiers, 0 = faintest airborne dust, 3 = seed heads. */
export type FieldLevel = 0 | 1 | 2 | 3;

export interface FieldCell {
  ch: FieldGlyph | ' ';
  level: FieldLevel;
}

export const DEFAULT_SEED = 1729;

const EMPTY: FieldCell = { ch: ' ', level: 0 };

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 1D value noise with smooth interpolation, roughly in [0, 1]. */
export function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash2(i, 0, seed) * (1 - u) + hash2(i + 1, 0, seed) * u;
}

/** Smooth hump centred at c with width w, 0..1. */
function bump(x: number, c: number, w: number): number {
  const d = (x - c) / w;
  return Math.exp(-d * d);
}

function fbm1(x: number, seed: number): number {
  return noise1(x, seed) * 0.62 + noise1(x * 2.13 + 7.1, seed + 1) * 0.28 + noise1(x * 4.7 + 3.3, seed + 2) * 0.1;
}

/**
 * Sample one cell.
 * @param nx,ny  normalised cell centre, 0..1 (left→right, top→bottom)
 * @param t      field time in seconds (already scaled by the drift speed)
 * @param col,row integer cell coordinates, used for the stable per-cell hash
 * @param dx,dy  local displacement from pointer disturbance (normalised units)
 * @param push   extra lean from pointer motion (positive bends right)
 */
export function sampleCell(
  nx: number,
  ny: number,
  t: number,
  col: number,
  row: number,
  seed: number,
  dx = 0,
  dy = 0,
  push = 0,
): FieldCell {
  const x = nx - dx;
  const y = ny - dy;

  // Wind: a slow gust travelling left → right, plus pointer push.
  const gust = 0.5 + 0.5 * Math.sin(x * 4.2 - t * 0.5 + 1.7);
  const lean = 0.42 + 0.42 * gust + push;

  // Uneven ground line near the bottom of the surface.
  const base = 0.93 - 0.06 * noise1(x * 3.1 + 11, seed);
  const above = base - y;
  if (above < 0) return EMPTY;

  // Shear: a stem leaning right originates further left at the ground.
  const xb = x - lean * 0.42 * above;

  // Stem height: a ribbon with two broad crests (left-centre and right), noise for
  // irregularity, and a slow sway so the crest line breathes.
  const crests = 0.72 * bump(xb, 0.3, 0.16) + 0.95 * bump(xb, 0.8, 0.16);
  const height =
    0.2 + 0.46 * crests + 0.14 * fbm1(xb * 2.6 + 3, seed) + 0.035 * Math.sin(xb * 8.5 + t * 0.35);
  const top = base - height;

  // Density: clumps and gaps along the ground, soft edges at both sides.
  const clump = smoothstep(0.12, 0.6, noise1(xb * 6.3 + 5, seed + 3));
  const edge = smoothstep(-0.06, 0.1, nx) * smoothstep(1.03, 0.92, nx);

  const h = hash2(col, row, seed);
  const h2 = hash2(col, row, seed + 97);

  if (y >= top) {
    const u = (y - top) / Math.max(height, 0.001); // 0 at tip → 1 at ground
    if (u < 0.12) {
      const p = 0.9 * edge * (0.6 + 0.4 * clump);
      if (h >= p) return EMPTY;
      return { ch: h2 < 0.58 ? '*' : h2 < 0.8 ? '+' : '.', level: 3 };
    }
    const p = (0.36 + 0.44 * u) * edge * (0.5 + 0.5 * clump);
    if (h >= p) return EMPTY;
    if (h2 > 0.93) return { ch: ':', level: 1 };
    const l = lean + (h2 - 0.5) * 0.3;
    return { ch: l < 0.5 ? '|' : '/', level: u > 0.55 ? 1 : 2 };
  }

  // Airborne dust above the tips: dense just above, thinning upward.
  const d = top - y;
  const drift = noise1(x * 9 + t * 0.08, seed + 5);
  const p = (0.34 * Math.exp(-d * 9) + 0.09 * smoothstep(0.45, 0.95, drift) * Math.exp(-d * 2)) * edge;
  if (h >= p) return EMPTY;
  return { ch: h2 < 0.82 ? '.' : h2 < 0.94 ? "'" : ':', level: 0 };
}

/** Render a full frame as plain text (used for the no-JS / pre-JS fallback). */
export function renderTextFrame(cols: number, rows: number, seed = DEFAULT_SEED, t = 0): string {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      line += sampleCell((c + 0.5) / cols, (r + 0.5) / rows, t, c, r, seed).ch;
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}
