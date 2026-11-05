import { replayEntrance } from '../entrance';
import { runFinale } from './finale';
import { layoutNetwork, networkFrame } from './network';

/**
 * Entry loading screen.
 *
 * Shown only when <html> carries `is-loading` (set by the inline head script on
 * entry from outside the site or on reload). While assets load, signals enter the
 * network and run through its layers. Once everything is ready (window `load`, the
 * font set, and on pages with the hero field its first frame), the output node is
 * focused, characters flood the screen from it, and then burn away from the same
 * point to reveal the page. A hard cap stops a stalled request from trapping the
 * visitor, and a CSS failsafe reveals the page if this script never runs.
 * Reduced motion: a still network, then a short fade.
 */

const MIN_MS = 1700; // long enough to see the network finish building
const MAX_WAIT_MS = 7000; // never hold the page longer than this
const FOCUS_MS = 420;
const FADE_MS = 300; // reduced-motion exit
const FRAME_MS = 1000 / 30;

export function runLoader(): void {
  const html = document.documentElement;
  const root = document.querySelector<HTMLElement>('[data-loader]');
  if (!root || !html.classList.contains('is-loading')) {
    root?.remove();
    return;
  }
  const layers = {
    edges: root.querySelector<HTMLElement>('[data-layer="edges"]'),
    nodes: root.querySelector<HTMLElement>('[data-layer="nodes"]'),
    pulses: root.querySelector<HTMLElement>('[data-layer="pulses"]'),
  };
  const canvas = root.querySelector<HTMLCanvasElement>('[data-finale]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const net = layoutNetwork();
  const started = performance.now();
  let minDone = reduced;
  let ready = false;
  let focusStart = -1;
  let raf = 0;
  let last = -Infinity;

  const paint = (t: number, focus = 0) => {
    const f = networkFrame(net, t, !reduced, focus);
    if (layers.edges) layers.edges.textContent = f.edges;
    if (layers.nodes) layers.nodes.textContent = f.nodes;
    if (layers.pulses) layers.pulses.textContent = f.pulses;
  };

  const tick = (now: number) => {
    raf = 0;
    const t = (now - started) / 1000;
    if (focusStart >= 0) {
      const p = Math.min(1, (now - focusStart) / FOCUS_MS);
      paint(t, Math.max(0.01, p));
      if (p >= 1) return finale();
    } else if (now - last >= FRAME_MS - 2) {
      paint(t);
      last = now;
    }
    if (!minDone && now - started >= MIN_MS) minDone = true;
    if (ready && minDone && focusStart < 0) {
      focusStart = now;
      root!.classList.add('is-focus');
    }
    raf = requestAnimationFrame(tick);
  };

  paint(0);
  if (reduced) paint(Infinity);
  else raf = requestAnimationFrame(tick);

  // A key press or tap skips the rest of the build, never the asset wait.
  const skip = () => (minDone = true);
  addEventListener('keydown', skip, { once: true });
  addEventListener('pointerdown', skip, { once: true });

  let revealed = false;
  /** Make the page visible and interactive underneath whatever is still on screen. */
  function revealPage() {
    if (revealed) return;
    revealed = true;
    removeEventListener('keydown', skip);
    removeEventListener('pointerdown', skip);
    html.classList.remove('is-loading');
    html.removeAttribute('aria-busy');
    replayEntrance(); // the page can be seen now
    document.dispatchEvent(new CustomEvent('ks:revealed'));
  }

  function finale() {
    cancelAnimationFrame(raf);
    const out = net.nodes[net.output];
    const rect = layers.pulses?.getBoundingClientRect();
    if (!canvas || !rect) return fadeOut();
    const originX = rect.left + ((out.x + 0.5) * rect.width) / net.cols;
    const originY = rect.top + ((out.y + 0.5) * rect.height) / net.rows;
    root!.classList.add('is-finale');
    runFinale(canvas, {
      originX,
      originY,
      fontFamily: getComputedStyle(root!).fontFamily,
      onBurnStart: () => {
        root!.classList.add('is-burning');
        revealPage();
      },
      onDone: () => root!.remove(),
    });
  }

  function fadeOut() {
    root!.classList.add('is-leaving');
    revealPage();
    setTimeout(() => root!.remove(), reduced ? 0 : FADE_MS + 50);
  }

  assetsReady(MAX_WAIT_MS).then(() => {
    ready = true;
    if (reduced) fadeOut();
  });
}

/** Resolves when the page, fonts, and (if present) the hero field are ready, or after `cap` ms. */
export function assetsReady(cap: number): Promise<void> {
  const load = new Promise<void>((r) => (document.readyState === 'complete' ? r() : addEventListener('load', () => r(), { once: true })));
  const fonts = (document.fonts?.ready ?? Promise.resolve()).then(() =>
    document.fonts?.load?.('16px "Iosevka Web"').catch(() => undefined),
  );
  const field = document.querySelector<HTMLElement>('[data-ascii-field]');
  const fieldReady = field
    ? new Promise<void>((r) => {
        if (field.dataset.ready) return r();
        document.addEventListener('ks:field-ready', () => r(), { once: true });
      })
    : Promise.resolve();
  const all = Promise.all([load, fonts, fieldReady]).then(() => undefined);
  return Promise.race([all, new Promise<void>((r) => setTimeout(r, cap))]);
}
