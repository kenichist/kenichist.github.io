/**
 * ASCII page transitions between pages of this site.
 *
 * Leaving: characters flood the screen outward from where the link was clicked,
 * then settle into plain background, and the browser navigates.
 * Arriving: the next page starts covered in that same plain background (a CSS
 * overlay set before first paint by the inline head script), then burns open
 * from the same point.
 *
 * Only plain left-clicks / Enter on same-origin links to a different page.
 * New-tab clicks, external links, downloads, same-page #anchors, and reduced
 * motion all behave as ordinary links. Back/forward never shows a cover.
 */
import { WipeCanvas, burnFront, cellState, easeInOut, EMBER_W } from './loader/finale';
import { replayEntrance } from './entrance';

const KEY = 'ks-nav';
const COVER_MS = 300; // characters flood the screen
const SETTLE_MS = 90; // then settle into plain background
const REVEAL_MS = 560; // the next page burns open
const STUCK_MS = 6000; // a navigation that never arrives (offline): give the page back

interface Pending {
  x: number;
  y: number;
  ts: number;
  to: string;
}

let leaving = false;

export function enhanceTransitions(): void {
  arrive();
  document.addEventListener('click', onClick);
  // Coming back via the back button restores this page from cache: drop any cover.
  addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    leaving = false;
    document.querySelectorAll('.ks-wipe').forEach((el) => el.remove());
  });
}

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = 'ks-wipe';
  c.setAttribute('aria-hidden', 'true');
  document.body.appendChild(c);
  return c;
}

const font = () => getComputedStyle(document.body).fontFamily;

/* ---------------- leaving ---------------- */

export interface LinkClick {
  button: number;
  modified: boolean;
  defaultPrevented: boolean;
  href: string;
  target: string;
  download: boolean;
  /** the current page URL */
  here: string;
}

/** Should this click get an ASCII transition? Only plain clicks to another page of this site. */
export function wantsTransition(c: LinkClick): boolean {
  if (c.defaultPrevented || c.button !== 0 || c.modified) return false;
  if ((c.target && c.target !== '_self') || c.download) return false;
  let url: URL;
  let here: URL;
  try {
    here = new URL(c.here);
    url = new URL(c.href, here);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.origin !== here.origin) return false;
  return !(url.pathname === here.pathname && url.search === here.search); // same page: just an #anchor
}

function onClick(e: MouseEvent): void {
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a) return;
  const ok = wantsTransition({
    button: e.button,
    modified: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
    defaultPrevented: e.defaultPrevented,
    href: a.href,
    target: a.target,
    download: a.hasAttribute('download'),
    here: location.href,
  });
  if (!ok) return;
  const url = new URL(a.href, location.href);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (document.documentElement.classList.contains('is-loading')) return;
  e.preventDefault();
  if (leaving) return;
  leaving = true;

  // keyboard activation reports (0, 0): start from the link itself
  let x = e.clientX;
  let y = e.clientY;
  if (e.detail === 0) {
    const r = a.getBoundingClientRect();
    x = r.left + r.width / 2;
    y = r.top + r.height / 2;
  }
  const go = () => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ x, y, ts: Date.now(), to: url.pathname } satisfies Pending));
    } catch {
      /* arrival just won't animate */
    }
    location.assign(url.href);
  };

  const canvas = makeCanvas();
  canvas.classList.add('is-cover');
  const wipe = WipeCanvas.create(canvas, x, y, font());
  if (!wipe) return go();
  const failsafe = setTimeout(go, COVER_MS + SETTLE_MS + 400);
  const start = performance.now();
  const frame = (now: number) => {
    const t = now - start;
    if (t < COVER_MS) {
      const fill = Math.min(1, easeInOut(t / COVER_MS) * 1.04);
      wipe.paint((k) => cellState(k, fill, null), now);
    } else {
      // settle outward from the click: characters give way to plain paper
      const p = Math.min(1, (t - COVER_MS) / SETTLE_MS) * 1.1;
      wipe.paint((k) => (k < p ? 'paper' : 'char'), now);
      if (p >= 1.1) {
        clearTimeout(failsafe);
        go();
        // if the next page never arrives (offline, blocked), give this one back
        setTimeout(() => {
          leaving = false;
          canvas.remove();
        }, STUCK_MS);
        return;
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* ---------------- arriving ---------------- */

function arrive(): void {
  const html = document.documentElement;
  if (!html.classList.contains('is-arriving')) return;
  let p: Pending | null = null;
  try {
    p = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    sessionStorage.removeItem(KEY);
  } catch {
    p = null;
  }
  const done = () => {
    html.classList.remove('is-arriving');
    document.dispatchEvent(new CustomEvent('ks:revealed'));
  };
  const canvas = makeCanvas();
  const x = p?.x ?? innerWidth / 2;
  const y = p?.y ?? innerHeight / 2;
  const wipe = WipeCanvas.create(canvas, x, y, font());
  if (!wipe) {
    canvas.remove();
    return done();
  }
  const start = performance.now();
  let first = true;
  const frame = (now: number) => {
    const burn = burnFront((now - start) / REVEAL_MS);
    // intact cells are plain paper here: the page is revealed by the burning edge alone
    wipe.paint((k) => {
      const s = cellState(k, 1, burn);
      return s === 'char' ? 'paper' : s;
    }, now);
    if (first) {
      // the canvas now covers the page exactly as the CSS overlay did; hand over
      first = false;
      done();
      replayEntrance();
    }
    if (burn >= 1 + EMBER_W) {
      canvas.remove();
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
