/**
 * Loader finale: characters flood the screen outward from the output node, then
 * burn away from the same point like paper catching fire, revealing the page.
 *
 * `cellKeys` and `cellState` are pure (unit-tested); `runFinale` draws them.
 */
import { hash2 } from '../ascii/frames';

export type CellState = 'empty' | 'fresh' | 'char' | 'scorch' | 'ember' | 'gone';

/** Width of the glowing band at the burn front, and of the scorched band just ahead of it (key units). */
export const EMBER_W = 0.05;
export const SCORCH_W = 0.06;

function smooth2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Order in which each cell fills and burns, 0..1: distance from the origin,
 * roughened with noise so the front is ragged like a burning edge.
 */
export function cellKeys(cols: number, rows: number, ox: number, oy: number, cellW: number, cellH: number, seed = 5): Float32Array {
  const keys = new Float32Array(cols * rows);
  let maxD = 1;
  for (const [cx, cy] of [
    [0, 0],
    [cols * cellW, 0],
    [0, rows * cellH],
    [cols * cellW, rows * cellH],
  ]) {
    maxD = Math.max(maxD, Math.hypot(cx - ox, cy - oy));
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const d = Math.hypot((c + 0.5) * cellW - ox, (r + 0.5) * cellH - oy) / maxD;
      const n = smooth2(c / 7, r / 4, seed) * 0.75 + hash2(c, r, seed + 1) * 0.25;
      keys[r * cols + c] = Math.min(1, Math.max(0, d * 0.84 + n * 0.16));
    }
  }
  return keys;
}

/**
 * @param key  the cell's order 0..1
 * @param fill fill front 0..1 (null once burning has started)
 * @param burn burn front, from 0 up to 1 + EMBER_W (null before burning)
 */
export function cellState(key: number, fill: number, burn: number | null): CellState {
  if (burn === null) {
    if (key > fill) return 'empty';
    return fill - key < 0.035 ? 'fresh' : 'char';
  }
  if (key < burn - EMBER_W) return 'gone';
  if (key < burn) return 'ember';
  if (key < burn + SCORCH_W) return 'scorch';
  return 'char';
}

const FILL_GLYPHS = ['.', ':', "'", '|', '/', '\\', '-', '+', '*'];
const FILL_WEIGHTS = [5, 4, 3, 3, 3, 2, 2, 1, 1];
const EMBER_GLYPHS = ['*', '+', '·', "'"];
const ALL_GLYPHS = [...new Set([...FILL_GLYPHS, ...EMBER_GLYPHS])];

export interface FinaleOptions {
  /** viewport coordinates of the output node */
  originX: number;
  originY: number;
  fontFamily: string;
  fillMs?: number;
  burnMs?: number;
  /** called once when burning starts: the page underneath should become visible */
  onBurnStart: () => void;
  onDone: () => void;
}

export function runFinale(canvas: HTMLCanvasElement, o: FinaleOptions): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    o.onBurnStart();
    o.onDone();
    return () => {};
  }
  const fillMs = o.fillMs ?? 700;
  const burnMs = o.burnMs ?? 1100;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const fontPx = Math.min(15, Math.max(11, vw / 105));
  const cellW = fontPx * 0.78;
  const cellH = fontPx * 1.28;
  const cols = Math.ceil(vw / cellW);
  const rows = Math.ceil(vh / cellH);
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
  canvas.style.width = `${vw}px`;
  canvas.style.height = `${vh}px`;

  const cs = getComputedStyle(document.documentElement);
  const token = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
  const bg = token('--color-bg', '#16121e');
  const scorchBg = token('--color-bg-lift', '#1b1625');
  // char tiers: dim, mid, fresh (just ignited), scorched, ember
  const tierColors = [
    'rgba(143, 119, 156, 0.7)',
    'rgba(171, 160, 182, 0.8)',
    token('--color-text', '#ded9e4'),
    'rgba(143, 119, 156, 0.45)',
    '#efe4f0',
  ];

  // Glyph atlas: every glyph × tier, rendered once.
  const aw = Math.ceil(cellW * dpr);
  const ah = Math.ceil(cellH * dpr);
  const atlas = document.createElement('canvas');
  atlas.width = aw * ALL_GLYPHS.length;
  atlas.height = ah * tierColors.length;
  const a = atlas.getContext('2d')!;
  a.font = `${fontPx * dpr}px ${o.fontFamily}`;
  a.textAlign = 'center';
  a.textBaseline = 'middle';
  tierColors.forEach((color, tier) => {
    a.fillStyle = color;
    ALL_GLYPHS.forEach((g, gi) => a.fillText(g, gi * aw + aw / 2, tier * ah + ah / 2));
  });
  const gIndex = Object.fromEntries(ALL_GLYPHS.map((g, i) => [g, i])) as Record<string, number>;

  const n = cols * rows;
  const keys = cellKeys(cols, rows, o.originX, o.originY, cellW, cellH);
  const glyph = new Uint8Array(n);
  const tier = new Uint8Array(n);
  const total = FILL_WEIGHTS.reduce((s, w) => s + w, 0);
  for (let i = 0; i < n; i++) {
    let pick = hash2(i % cols, (i / cols) | 0, 41) * total;
    let g = 0;
    while (pick >= FILL_WEIGHTS[g]) pick -= FILL_WEIGHTS[g++];
    glyph[i] = gIndex[FILL_GLYPHS[g]];
    tier[i] = hash2(i % cols, (i / cols) | 0, 43) < 0.35 ? 1 : 0;
  }

  const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
  const start = performance.now();
  let burning = false;
  let raf = 0;
  let stopped = false;

  const frame = (now: number) => {
    if (stopped) return;
    const t = now - start;
    const fill = Math.min(1, ease(Math.min(1, t / fillMs)) * 1.02);
    const burnT = t - fillMs;
    const burn = burnT < 0 ? null : -SCORCH_W + ease(Math.min(1, burnT / burnMs)) * (1 + EMBER_W + SCORCH_W + 0.02);
    if (burn !== null && !burning) {
      burning = true;
      o.onBurnStart();
    }
    const flicker = Math.floor(now / 70);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let r = 0; r < rows; r++) {
      const y = Math.round(r * cellH * dpr);
      const yh = Math.round((r + 1) * cellH * dpr) - y;
      // background runs: opaque paper for intact and scorched cells, nothing where burned
      let runStart = -1;
      let runColor = '';
      for (let c = 0; c <= cols; c++) {
        const s = c < cols ? cellState(keys[r * cols + c], fill, burn) : 'gone';
        const color = s === 'char' || s === 'fresh' ? bg : s === 'scorch' ? scorchBg : '';
        if (color !== runColor) {
          if (runColor) {
            ctx.fillStyle = runColor;
            const x0 = Math.round(runStart * cellW * dpr);
            ctx.fillRect(x0, y, Math.round(c * cellW * dpr) - x0, yh);
          }
          runColor = color;
          runStart = c;
        }
      }
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const s = cellState(keys[i], fill, burn);
        if (s === 'empty' || s === 'gone') continue;
        let g = glyph[i];
        let tr = tier[i];
        if (s === 'fresh') tr = 2;
        else if (s === 'scorch') tr = 3;
        else if (s === 'ember') {
          tr = 4;
          g = gIndex[EMBER_GLYPHS[Math.floor(hash2(c, r, flicker) * EMBER_GLYPHS.length)]];
        }
        ctx.drawImage(atlas, g * aw, tr * ah, aw, ah, Math.round(c * cellW * dpr), y, aw, ah);
      }
    }
    if (burn !== null && burn >= 1 + EMBER_W) {
      stopped = true;
      o.onDone();
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}
