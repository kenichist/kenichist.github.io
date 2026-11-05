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

/** What a wipe cell shows: 'paper' is an opaque cell with no character. */
export type WipeState = CellState | 'paper';

/**
 * A viewport-sized character canvas whose cells fill and burn outward from an origin.
 * Shared by the entry loader finale and the page transitions.
 */
export class WipeCanvas {
  readonly cols: number;
  readonly rows: number;
  readonly keys: Float32Array;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cellW: number;
  private readonly cellH: number;
  private readonly dpr: number;
  private readonly aw: number;
  private readonly ah: number;
  private readonly atlas: HTMLCanvasElement;
  private readonly gIndex: Record<string, number>;
  private readonly glyph: Uint8Array;
  private readonly tier: Uint8Array;
  private readonly bg: string;
  private readonly scorchBg: string;

  static create(canvas: HTMLCanvasElement, originX: number, originY: number, fontFamily: string): WipeCanvas | null {
    const ctx = canvas.getContext('2d');
    return ctx ? new WipeCanvas(canvas, ctx, originX, originY, fontFamily) : null;
  }

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    originX: number,
    originY: number,
    fontFamily: string,
  ) {
    this.ctx = ctx;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const fontPx = Math.min(15, Math.max(11, vw / 105));
    this.cellW = fontPx * 0.78;
    this.cellH = fontPx * 1.28;
    this.cols = Math.ceil(vw / this.cellW);
    this.rows = Math.ceil(vh / this.cellH);
    canvas.width = Math.round(vw * this.dpr);
    canvas.height = Math.round(vh * this.dpr);
    canvas.style.width = `${vw}px`;
    canvas.style.height = `${vh}px`;

    const cs = getComputedStyle(document.documentElement);
    const token = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
    this.bg = token('--color-bg', '#16121e');
    this.scorchBg = token('--color-bg-lift', '#1b1625');
    // char tiers: dim, mid, fresh (just ignited), scorched, ember
    const tierColors = ['rgba(143, 119, 156, 0.7)', 'rgba(171, 160, 182, 0.8)', token('--color-text', '#ded9e4'), 'rgba(143, 119, 156, 0.45)', '#efe4f0'];

    // glyph atlas: every glyph × tier, rendered once
    this.aw = Math.ceil(this.cellW * this.dpr);
    this.ah = Math.ceil(this.cellH * this.dpr);
    this.atlas = document.createElement('canvas');
    this.atlas.width = this.aw * ALL_GLYPHS.length;
    this.atlas.height = this.ah * tierColors.length;
    const a = this.atlas.getContext('2d')!;
    a.font = `${fontPx * this.dpr}px ${fontFamily}`;
    a.textAlign = 'center';
    a.textBaseline = 'middle';
    tierColors.forEach((color, t) => {
      a.fillStyle = color;
      ALL_GLYPHS.forEach((g, gi) => a.fillText(g, gi * this.aw + this.aw / 2, t * this.ah + this.ah / 2));
    });
    this.gIndex = Object.fromEntries(ALL_GLYPHS.map((g, i) => [g, i]));

    const n = this.cols * this.rows;
    this.keys = cellKeys(this.cols, this.rows, originX, originY, this.cellW, this.cellH);
    this.glyph = new Uint8Array(n);
    this.tier = new Uint8Array(n);
    const total = FILL_WEIGHTS.reduce((sum, w) => sum + w, 0);
    for (let i = 0; i < n; i++) {
      let pick = hash2(i % this.cols, (i / this.cols) | 0, 41) * total;
      let g = 0;
      while (pick >= FILL_WEIGHTS[g]) pick -= FILL_WEIGHTS[g++];
      this.glyph[i] = this.gIndex[FILL_GLYPHS[g]];
      this.tier[i] = hash2(i % this.cols, (i / this.cols) | 0, 43) < 0.35 ? 1 : 0;
    }
  }

  /** Draw one frame; `stateOf` maps a cell's order key (0..1) to what it shows. */
  paint(stateOf: (key: number) => WipeState, now: number): void {
    const { ctx, cols, rows, cellW, cellH, dpr, aw, ah, keys } = this;
    const flicker = Math.floor(now / 70);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const states: WipeState[] = new Array(cols);
    for (let r = 0; r < rows; r++) {
      const y = Math.round(r * cellH * dpr);
      const yh = Math.round((r + 1) * cellH * dpr) - y;
      for (let c = 0; c < cols; c++) states[c] = stateOf(keys[r * cols + c]);
      // background runs: opaque for paper, intact and scorched cells; nothing where burned
      let runStart = -1;
      let runColor = '';
      for (let c = 0; c <= cols; c++) {
        const s = c < cols ? states[c] : 'gone';
        const color = s === 'char' || s === 'fresh' || s === 'paper' ? this.bg : s === 'scorch' ? this.scorchBg : '';
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
        const s = states[c];
        if (s === 'empty' || s === 'gone' || s === 'paper') continue;
        const i = r * cols + c;
        let g = this.glyph[i];
        let t = this.tier[i];
        if (s === 'fresh') t = 2;
        else if (s === 'scorch') t = 3;
        else if (s === 'ember') {
          t = 4;
          g = this.gIndex[EMBER_GLYPHS[Math.floor(hash2(c, r, flicker) * EMBER_GLYPHS.length)]];
        }
        ctx.drawImage(this.atlas, g * aw, t * ah, aw, ah, Math.round(c * cellW * dpr), y, aw, ah);
      }
    }
  }
}

export const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

/** The burn front over time: from just behind the origin to past the farthest corner. */
export const burnFront = (p: number) => -SCORCH_W + easeInOut(Math.min(1, p)) * (1 + EMBER_W + SCORCH_W + 0.02);

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

/** Loader finale: flood the screen from the origin, then burn it away from the same point. */
export function runFinale(canvas: HTMLCanvasElement, o: FinaleOptions): () => void {
  const wipe = WipeCanvas.create(canvas, o.originX, o.originY, o.fontFamily);
  if (!wipe) {
    o.onBurnStart();
    o.onDone();
    return () => {};
  }
  const fillMs = o.fillMs ?? 700;
  const burnMs = o.burnMs ?? 1100;
  const start = performance.now();
  let burning = false;
  let raf = 0;
  let stopped = false;
  const frame = (now: number) => {
    if (stopped) return;
    const t = now - start;
    const fill = Math.min(1, easeInOut(Math.min(1, t / fillMs)) * 1.02);
    const burn = t < fillMs ? null : burnFront((t - fillMs) / burnMs);
    if (burn !== null && !burning) {
      burning = true;
      o.onBurnStart();
    }
    wipe.paint((key) => cellState(key, fill, burn), now);
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
