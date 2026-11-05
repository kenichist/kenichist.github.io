import meta from '../../data/digits-model.json';
import { createModel, type DigitModel, type ModelMeta } from './model';
import { prepare, rasterize, type Point, type Stroke } from './preprocess';

/**
 * ASCII drawing pad + live classification.
 * The pad is a grid of square character cells; strokes render as directional
 * glyphs. Every stroke is prepared MNIST-style (preprocess.ts) and classified
 * by the in-browser CNN (model.ts).
 */

const GRID = 40; // display cells per side
const DISPLAY_PEN = 1.8; // in display cells
const NEW_DRAWING_AFTER_MS = 1600; // pause after which the next stroke starts a fresh drawing
const UNSURE_BELOW = 0.6;
const TOO_SMALL = 0.12; // ink extent relative to pad
const RAMP = ' .:-=+*#%@';
const EVAL_KEY = 'ks-digits-eval';

type EvalEntry = { drawn: number; guess: number; p: number };

export function enhanceDigitPads(): void {
  document.querySelectorAll<HTMLElement>('[data-digit-pad]').forEach((root) => {
    if (root.dataset.enhanced) return;
    root.dataset.enhanced = 'true';
    void new DigitPad(root).start();
  });
}

class DigitPad {
  private readonly root: HTMLElement;
  private readonly surface: HTMLElement;
  private readonly dim: HTMLElement;
  private readonly bright: HTMLElement;
  private readonly guessEl: HTMLElement;
  private readonly detailEl: HTMLElement;
  private readonly barsEl: HTMLElement;
  private readonly seesEl: HTMLElement;
  private readonly announce: HTMLElement;
  private readonly evalEl: HTMLElement | null;
  private model: DigitModel | null = null;
  private strokes: Stroke[] = [];
  private drawing = false;
  private lastEnd = 0;
  private dirty = false;
  private raf = 0;
  private lastGuess: { digit: number; p: number } | null = null;
  private fromSample = false;
  private samples: { label: number; b64: string }[] | null = null;
  private sampleIndex = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
    this.surface = q('[data-surface]');
    this.dim = q('[data-ink="dim"]');
    this.bright = q('[data-ink="bright"]');
    this.guessEl = q('[data-guess]');
    this.detailEl = q('[data-detail]');
    this.barsEl = q('[data-bars]');
    this.seesEl = q('[data-sees]');
    this.announce = q('[data-announce]');
    this.evalEl = root.querySelector('[data-eval]');
  }

  async start(): Promise<void> {
    q(this.root, '[data-grid]').textContent = gridBackground();
    this.renderBars(null);
    this.setStatus('loading the model…', '');
    try {
      const res = await fetch('/models/digits-cnn.bin');
      if (!res.ok) throw new Error(String(res.status));
      this.model = createModel(await res.arrayBuffer(), meta as unknown as ModelMeta);
    } catch {
      this.setStatus('the model failed to load', 'Reload the page to try again.');
      return;
    }
    this.root.dataset.ready = 'true';
    this.setStatus('—', 'Draw a single digit, 0 to 9.');
    this.bind();
    this.renderEval();
  }

  /* ---------- input ---------- */

  private bind(): void {
    const s = this.surface;
    s.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      s.setPointerCapture(e.pointerId);
      if (this.fromSample || (this.strokes.length && performance.now() - this.lastEnd > NEW_DRAWING_AFTER_MS && this.lastGuess)) this.clear(false);
      this.drawing = true;
      this.strokes.push([this.point(e)]);
      this.queue();
    });
    s.addEventListener('pointermove', (e) => {
      if (!this.drawing) return;
      const stroke = this.strokes[this.strokes.length - 1];
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) stroke.push(this.point(ev));
      this.queue();
    });
    const end = () => {
      if (!this.drawing) return;
      this.drawing = false;
      this.lastEnd = performance.now();
      this.queue(true);
    };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);
    q(this.root, '[data-clear]').addEventListener('click', () => this.clear(true));
    q(this.root, '[data-sample]').addEventListener('click', () => void this.showSample());
    this.evalEl?.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
      if (b.dataset.drawn) this.record(Number(b.dataset.drawn));
      if (b.hasAttribute('data-reset')) this.resetEval();
      if (b.hasAttribute('data-copy')) void this.copyEval(b);
    });
  }

  private point(e: PointerEvent): Point {
    const r = this.surface.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * GRID, y: ((e.clientY - r.top) / r.height) * GRID };
  }

  private queue(final = false): void {
    this.dirty = true;
    if (final) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.update(true);
      return;
    }
    if (!this.raf) this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.dirty) this.update(false);
    });
  }

  private clear(announce: boolean): void {
    this.strokes = [];
    this.lastGuess = null;
    this.fromSample = false;
    this.dim.textContent = '';
    this.bright.textContent = '';
    this.seesEl.textContent = '';
    this.renderBars(null);
    this.setStatus('—', 'Draw a single digit, 0 to 9.');
    this.showEvalPrompt(false);
    if (announce) this.say('Pad cleared.');
  }

  /* ---------- classify + render ---------- */

  private update(final: boolean): void {
    this.dirty = false;
    this.renderInk();
    const prepared = prepare(this.strokes, GRID);
    if (!prepared || !this.model) return;
    if (prepared.extent < TOO_SMALL) {
      this.renderBars(null);
      this.setStatus('—', 'Draw a little bigger.');
      if (final) this.say('Drawing is too small to read. Draw a little bigger.');
      return;
    }
    this.classify(prepared.input, final, false);
  }

  private classify(input: Float32Array, final: boolean, sample: boolean, label?: number): void {
    const probs = this.model!.predict(input);
    const order = [...probs.keys()].sort((a, b) => probs[b] - probs[a]);
    const [top, second] = order;
    this.lastGuess = { digit: top, p: probs[top] };
    this.renderBars(probs);
    this.renderSees(input);
    const pct = (p: number) => `${Math.round(p * 100)}%`;
    const sure = probs[top] >= UNSURE_BELOW;
    if (sure) this.setStatus(String(top), `${pct(probs[top])} confident`);
    else this.setStatus('?', `not sure: ${top} (${pct(probs[top])}) or ${second} (${pct(probs[second])})`);
    if (!final) return;
    const lead = sample ? `MNIST test digit labelled ${label}. ` : '';
    this.say(sure ? `${lead}Prediction: ${top}, ${pct(probs[top])} confident.` : `${lead}Not sure: ${top} or ${second}.`);
    this.showEvalPrompt(!sample);
  }

  private renderInk(): void {
    // coverage + stroke direction per display cell
    const cov = rasterize(this.strokes, GRID, DISPLAY_PEN);
    const dirs = directions(this.strokes, cov);
    let dim = '';
    let bright = '';
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const i = y * GRID + x;
        const v = cov[i];
        if (v > 0.7) {
          bright += dirs[i];
          dim += ' ';
        } else if (v > 0.12) {
          dim += v > 0.4 ? ':' : '.';
          bright += ' ';
        } else {
          dim += ' ';
          bright += ' ';
        }
      }
      dim += '\n';
      bright += '\n';
    }
    this.dim.textContent = dim;
    this.bright.textContent = bright;
  }

  private renderSees(input: Float32Array): void {
    let s = '';
    for (let y = 0; y < 28; y++) {
      for (let x = 0; x < 28; x++) s += RAMP[Math.min(RAMP.length - 1, Math.floor(input[y * 28 + x] * RAMP.length))];
      s += '\n';
    }
    this.seesEl.textContent = s;
  }

  private renderBars(probs: Float32Array | null): void {
    const W = 16;
    const top = probs ? probs.indexOf(Math.max(...probs)) : -1;
    this.barsEl.replaceChildren(
      ...Array.from({ length: 10 }, (_, d) => {
        const p = probs ? probs[d] : 0;
        const n = Math.round(p * W);
        const row = document.createElement('div');
        row.className = d === top ? 'bar is-top' : 'bar';
        row.textContent = `${d}  ${'|'.repeat(n)}${'·'.repeat(W - n)}  ${probs ? String(Math.round(p * 100)).padStart(3) + '%' : '    '}`;
        return row;
      }),
    );
  }

  private setStatus(guess: string, detail: string): void {
    this.guessEl.textContent = guess;
    this.detailEl.textContent = detail;
  }

  private say(text: string): void {
    this.announce.textContent = '';
    requestAnimationFrame(() => (this.announce.textContent = text));
  }

  /* ---------- samples ---------- */

  private async showSample(): Promise<void> {
    if (!this.model) return;
    if (!this.samples) {
      try {
        this.samples = await (await fetch('/models/digits-samples.json')).json();
      } catch {
        this.say('Samples failed to load.');
        return;
      }
    }
    const s = this.samples![this.sampleIndex++ % this.samples!.length];
    this.strokes = [];
    this.fromSample = true;
    const input = Float32Array.from(atob(s.b64), (c) => c.charCodeAt(0) / 255);
    // show the sample in the pad, upscaled, with a brightness ramp
    let dim = '';
    let bright = '';
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const v = input[Math.floor((y * 28) / GRID) * 28 + Math.floor((x * 28) / GRID)];
        const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(v * RAMP.length))];
        (v > 0.6 ? (bright += ch, dim += ' ') : (dim += ch, bright += ' '));
      }
      dim += '\n';
      bright += '\n';
    }
    this.dim.textContent = dim;
    this.bright.textContent = bright;
    this.classify(input, true, true, s.label);
    this.detailEl.textContent += ` · MNIST test digit, label ${s.label}`;
  }

  /* ---------- your-drawings accuracy ---------- */

  private showEvalPrompt(show: boolean): void {
    const prompt = this.evalEl?.querySelector<HTMLElement>('[data-eval-prompt]');
    if (prompt) prompt.hidden = !show;
  }

  private entries(): EvalEntry[] {
    try {
      return JSON.parse(localStorage.getItem(EVAL_KEY) || '[]');
    } catch {
      return [];
    }
  }

  private record(drawn: number): void {
    if (!this.lastGuess) return;
    const list = this.entries();
    list.push({ drawn, guess: this.lastGuess.digit, p: Math.round(this.lastGuess.p * 100) / 100 });
    try {
      localStorage.setItem(EVAL_KEY, JSON.stringify(list));
    } catch {
      /* tally just won't persist */
    }
    const ok = drawn === this.lastGuess.digit;
    this.clear(false);
    this.renderEval(list);
    this.say(ok ? 'Recorded: correct.' : `Recorded: you drew ${drawn}.`);
  }

  private renderEval(list = this.entries()): void {
    const tally = this.evalEl?.querySelector('[data-tally]');
    if (!tally) return;
    if (!list.length) {
      tally.textContent = 'No drawings recorded yet.';
      return;
    }
    const ok = list.filter((e) => e.drawn === e.guess).length;
    const misses = new Map<string, number>();
    for (const e of list) if (e.drawn !== e.guess) misses.set(`${e.drawn}→${e.guess}`, (misses.get(`${e.drawn}→${e.guess}`) ?? 0) + 1);
    const top = [...misses].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} ×${n}`).join(', ');
    tally.textContent = `Your drawings: ${ok} of ${list.length} read correctly (${Math.round((ok / list.length) * 100)}%).${top ? ` Misreads: ${top}.` : ''}`;
  }

  private resetEval(): void {
    try {
      localStorage.removeItem(EVAL_KEY);
    } catch {
      /* ignore */
    }
    this.renderEval([]);
    this.say('Tally reset.');
  }

  private async copyEval(btn: HTMLButtonElement): Promise<void> {
    const list = this.entries();
    const ok = list.filter((e) => e.drawn === e.guess).length;
    const text = JSON.stringify({ total: list.length, correct: ok, entries: list });
    try {
      await navigator.clipboard.writeText(text);
      btn.querySelector('[data-label]')!.textContent = 'copied';
      setTimeout(() => (btn.querySelector('[data-label]')!.textContent = 'copy results'), 1500);
    } catch {
      this.say('Copy failed. Select the tally text instead.');
    }
  }
}

function q(root: HTMLElement, sel: string): HTMLElement {
  return root.querySelector<HTMLElement>(sel)!;
}

/** Faint dotted grid with corner marks, so the drawable square is visible. */
function gridBackground(): string {
  let s = '';
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const corner = (x === 0 || x === GRID - 1) && (y === 0 || y === GRID - 1);
      s += corner ? '+' : x % 4 === 2 && y % 4 === 2 ? '·' : ' ';
    }
    s += '\n';
  }
  return s;
}

/** Stroke direction glyph per covered cell, from the nearest segment. */
function directions(strokes: Stroke[], cov: Float32Array): string[] {
  const out = new Array<string>(GRID * GRID).fill('*');
  const segs: [Point, Point][] = [];
  for (const s of strokes) for (let i = 1; i < s.length; i++) segs.push([s[i - 1], s[i]]);
  if (!segs.length) return out;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const i = y * GRID + x;
      if (cov[i] <= 0.7) continue;
      let best = Infinity;
      let ang = 0;
      for (const [a, b] of segs) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-6) continue;
        let t = ((x + 0.5 - a.x) * dx + (y + 0.5 - a.y) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x + 0.5 - (a.x + t * dx), y + 0.5 - (a.y + t * dy));
        if (d < best) {
          best = d;
          ang = (Math.atan2(-dy, dx) * 180) / Math.PI;
        }
      }
      let a = ang;
      while (a <= -90) a += 180;
      while (a > 90) a -= 180;
      out[i] = Math.abs(a) > 67.5 ? '|' : Math.abs(a) < 22.5 ? '-' : a > 0 ? '/' : '\\';
    }
  }
  return out;
}
