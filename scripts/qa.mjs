// Rendered-site QA. Usage:
//   npm run build && npx astro preview --port 4321 &
//   DEMO_CONTENT=0 npx astro build --outDir dist-live && python3 -m http.server 4322 -d dist-live &
//   BASE=http://127.0.0.1:4321 LIVE=http://127.0.0.1:4322 node scripts/qa.mjs
// Writes screenshots to design/screenshots/ and a JSON report to design/qa-report.json.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE ?? 'http://127.0.0.1:4321';
const LIVE = process.env.LIVE ?? '';
const OUT = new URL('../design/screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const report = { base: BASE, checks: [], screenshots: [] };
const pass = (name, ok, detail = '') => {
  report.checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const ROUTES = ['/', '/work/', '/work/project-01/', '/work/project-02/', '/work/project-03/', '/notes/', '/notes/research-note-01/', '/does-not-exist/'];

/** Counts rAF callbacks so tests can tell whether the field is scheduling work. */
const RAF_COUNTER = () => {
  window.__raf = 0;
  const orig = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => orig((t) => { window.__raf++; cb(t); });
};

const browser = await chromium.launch();

async function newPage(opts = {}, init = []) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...opts });
  for (const fn of init) await ctx.addInitScript(fn);
  const page = await ctx.newPage();
  // Every fresh context arrives "from outside", so the entry loader runs; wait it out.
  const settle = () =>
    page
      .waitForFunction(
        () => !document.documentElement.classList.contains('is-loading') && !document.querySelector('.loader.is-leaving, .loader.is-finale'),
        null,
        { timeout: 15000 },
      )
      .catch(() => {});
  for (const m of ['goto', 'reload', 'goBack']) {
    const orig = page[m].bind(page);
    page[m] = async (...args) => {
      const r = await orig(...args);
      await settle();
      return r;
    };
  }
  page.__errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.__errors.push(m.text()); });
  page.on('pageerror', (e) => page.__errors.push('pageerror: ' + e.message));
  return { ctx, page };
}

const fieldState = (page) => page.evaluate(() => document.querySelector('[data-ascii-field]')?.dataset.state);
/** Visible label only (the screen-reader suffix is checked separately). */
const buttonText = (page) => page.evaluate(() => document.querySelector('[data-field-toggle] [data-label]')?.textContent.trim());
const buttonName = (page) => page.evaluate(() => document.querySelector('[data-field-toggle]')?.textContent.replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim());
async function rafRate(page, ms = 1000) {
  const a = await page.evaluate(() => window.__raf);
  await page.waitForTimeout(ms);
  const b = await page.evaluate(() => window.__raf);
  return ((b - a) * 1000) / ms;
}
async function scrollThrough(page) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= h; y += 300) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(60); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
}

/* ---------- 1. screenshots + overflow at each viewport ---------- */
const VIEWPORTS = [
  { name: '320', width: 320, height: 720, dsf: 2 },
  { name: '390', width: 390, height: 844, dsf: 2 },
  { name: '768', width: 768, height: 1024, dsf: 2 },
  { name: '1440', width: 1440, height: 900, dsf: 2 },
  { name: '1920', width: 1920, height: 1080, dsf: 1 },
  // 200% browser zoom on a 1440px window = 720 CSS px at DPR 2
  { name: '1440-zoom200', width: 720, height: 450, dsf: 2 },
];
for (const vp of VIEWPORTS) {
  const { ctx, page } = await newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dsf });
  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) pass(`no horizontal scroll ${vp.name} ${route}`, false, `${overflow}px`);
  }
  pass(`no horizontal scroll at ${vp.name} across ${ROUTES.length} routes`, true);
  for (const route of ['/', '/work/project-03/', '/notes/']) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const slug = route === '/' ? 'home' : route.replaceAll('/', '-').replace(/^-|-$/g, '');
    const file = `${slug}-${vp.name}.png`;
    if (route === '/' || vp.name === '390' || vp.name === '1440') {
      await page.screenshot({ path: OUT + file });
      report.screenshots.push(file);
      if (route === '/' && (vp.name === '390' || vp.name === '1440')) {
        await scrollThrough(page);
        await page.screenshot({ path: OUT + `${slug}-${vp.name}-full.png`, fullPage: true });
        report.screenshots.push(`${slug}-${vp.name}-full.png`);
      }
    }
  }
  await ctx.close();
}

/* ---------- 2. console errors + broken internal links ---------- */
{
  const { ctx, page } = await newPage();
  const seen = new Set();
  const queue = ['/'];
  const broken = [];
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    const res = await page.goto(BASE + path, { waitUntil: 'networkidle' });
    if (!res || res.status() >= 400) { broken.push(`${path} → ${res?.status()}`); continue; }
    const links = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
    for (const href of links) {
      if (href === '#' || href === '') broken.push(`${path}: dead href "${href}"`);
      if (href.startsWith('#')) {
        const id = href.slice(1);
        const exists = await page.evaluate((i) => !!document.getElementById(i), id);
        if (!exists) broken.push(`${path}: missing anchor ${href}`);
        continue;
      }
      const u = new URL(href, BASE + path);
      if (u.origin !== new URL(BASE).origin) continue;
      if (u.hash && u.pathname) {
        // check the anchor on its page later
      }
      queue.push(u.pathname);
    }
  }
  pass('all internal links resolve (crawl)', broken.length === 0, `${seen.size} pages; ${broken.join('; ')}`);
  pass('no console errors on crawled pages', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();
}

/* ---------- 3. keyboard traversal ---------- */
{
  const { ctx, page } = await newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const order = [];
  let missingRing = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { text: '(left page)', outline: 'n/a', outlineWidth: 'n/a' };
      const cs = getComputedStyle(el);
      return { text: (el.innerText || el.getAttribute('aria-label') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 40), outline: cs.outlineStyle, outlineWidth: cs.outlineWidth };
    });
    if (info.outline === 'n/a') break;
    order.push(info.text);
    if (info.outline === 'none' || info.outlineWidth === '0px') missingRing.push(info.text);
  }
  pass('first Tab reaches skip link', order[0] === 'skip to content', order[0]);
  pass('pause control is keyboard reachable', order.some((t) => /pause/.test(t)), order.join(' → '));
  pass('every focused element shows a visible focus ring', missingRing.length === 0, missingRing.join(', '));
  // skip link moves focus to main
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  const focused = await page.evaluate(() => document.activeElement?.id);
  pass('skip link moves focus to <main>', focused === 'main', focused);
  // keyboard pause via Space
  await page.focus('[data-field-toggle]');
  await page.keyboard.press('Space');
  pass('Space on control pauses', (await fieldState(page)) === 'user-paused');
  await page.keyboard.press('Enter');
  pass('Enter on control resumes', (await fieldState(page)) === 'active');
  await ctx.close();
}

/* ---------- 4. motion lifecycle ---------- */
{
  // active → settled via click; frames stop after easing
  const { ctx, page } = await newPage({}, [RAF_COUNTER]);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const activeRate = await rafRate(page);
  pass('active field runs at a capped rate (~20/s)', activeRate > 12 && activeRate < 26, `${activeRate.toFixed(1)} frames/s`);
  report.activeFrameRate = activeRate;
  pass('control label describes action while moving', (await buttonText(page)) === 'pause', await buttonText(page));
  pass('control accessible name is descriptive', (await buttonName(page)) === 'pause the background animation', await buttonName(page));

  const box = await page.locator('.field-canvas').boundingBox();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
  pass('click settles the field', (await fieldState(page)) === 'settled');
  pass('control offers resume after settle', /resume/.test(await buttonText(page)), await buttonText(page));
  await page.waitForTimeout(1600);
  const settledRate = await rafRate(page);
  pass('settled field schedules no frames', settledRate === 0, `${settledRate}/s`);
  await page.click('[data-field-toggle]');
  pass('resume returns to active', (await fieldState(page)) === 'active');
  await page.waitForTimeout(300);
  pass('resumed field schedules frames again', (await rafRate(page, 600)) > 10);

  // hidden tab — simulate visibility change
  const setHidden = (h) => page.evaluate((hidden) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, h);
  await setHidden(true);
  await page.waitForTimeout(200);
  pass('hidden tab → state hidden-tab', (await fieldState(page)) === 'hidden-tab');
  pass('hidden tab schedules no frames', (await rafRate(page)) === 0);
  await setHidden(false);
  pass('visible again → active', (await fieldState(page)) === 'active');
  // paused + hidden + visible stays paused
  await page.click('[data-field-toggle]');
  await setHidden(true);
  await setHidden(false);
  pass('visibility does not override pause', (await fieldState(page)) === 'user-paused');
  pass('paused field schedules no frames', (await rafRate(page)) === 0);
  await page.click('[data-field-toggle]');

  // offscreen
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);
  pass('scrolled away → offscreen', (await fieldState(page)) === 'offscreen');
  pass('offscreen schedules no frames', (await rafRate(page)) === 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  pass('scrolled back → active', (await fieldState(page)) === 'active');

  // resize: grid follows, still one loop
  for (const w of [1200, 900, 600, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(400);
  const afterResize = await rafRate(page);
  const geom = await page.evaluate(() => {
    const s = document.querySelector('[data-field-surface]').getBoundingClientRect();
    const c = document.querySelector('.field-canvas').getBoundingClientRect();
    return { surface: Math.round(s.width), canvas: Math.round(c.width) };
  });
  pass('after resizes the canvas matches its box', geom.surface === geom.canvas, JSON.stringify(geom));
  pass('after resizes there is still one loop (rate unchanged)', afterResize > 12 && afterResize < 26, `${afterResize.toFixed(1)}/s`);
  pass('no console errors during motion lifecycle', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();
}

/* ---------- 5. pause persistence + storage failure ---------- */
{
  const { ctx, page } = await newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.click('[data-field-toggle]');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  pass('pause persists across reload', (await fieldState(page)) === 'user-paused', await buttonText(page));
  await page.click('[data-field-toggle]');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  pass('resume persists across reload', (await fieldState(page)) === 'active');
  await ctx.close();

  const broken = await newPage({}, [() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
  }]);
  await broken.page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await broken.page.waitForTimeout(300);
  await broken.page.click('[data-field-toggle]');
  const s1 = await fieldState(broken.page);
  await broken.page.click('[data-field-toggle]');
  const s2 = await fieldState(broken.page);
  pass('control works when storage throws', s1 === 'user-paused' && s2 === 'active' && broken.page.__errors.length === 0, `${s1} → ${s2} ${broken.page.__errors.join('|')}`);
  await broken.ctx.close();
}

/* ---------- 6. reduced motion ---------- */
{
  const { ctx, page } = await newPage({ reducedMotion: 'reduce' }, [RAF_COUNTER]);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  pass('reduced motion starts static', (await fieldState(page)) === 'reduced-motion');
  pass('reduced motion schedules no frames', (await rafRate(page)) === 0);
  pass('reduced motion control offers play', /play/.test(await buttonText(page)), await buttonText(page));
  const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.name')).animationName);
  pass('reduced motion disables entrance animation', anim === 'none', anim);
  const hidden = await page.evaluate(() => document.documentElement.classList.contains('reveal-ready'));
  pass('reduced motion disables scroll reveals', !hidden);
  const box = await page.locator('.field-canvas').boundingBox();
  await page.mouse.click(box.x + 50, box.y + 50);
  pass('click does nothing under reduced motion', (await fieldState(page)) === 'reduced-motion');
  await page.click('[data-field-toggle]');
  pass('explicit play overrides for this view', (await fieldState(page)) === 'active');
  // navigation still works
  await page.click('a[href="/notes/"]');
  await page.waitForLoadState('networkidle');
  pass('navigation works under reduced motion', page.url().endsWith('/notes/'));
  await ctx.close();
}

/* ---------- 7. no-JS fallback ---------- */
{
  const { ctx, page } = await newPage({ javaScriptEnabled: false });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const r = await page.evaluate(() => ({
    pre: getComputedStyle(document.querySelector('.field-text-wide')).display !== 'none' && document.querySelector('.field-text-wide').textContent.trim().length > 100,
    button: document.querySelector('[data-field-toggle]').hidden,
    workVisible: getComputedStyle(document.querySelector('#work')).opacity === '1',
  }));
  pass('no-JS shows static text artwork', r.pre);
  pass('no-JS hides the (non-functional) control', r.button);
  pass('no-JS content is visible', r.workVisible);
  const noLoader = await page.evaluate(() => getComputedStyle(document.querySelector('[data-loader]')).display === 'none' && !document.documentElement.classList.contains('is-loading'));
  pass('no-JS never shows the loader', noLoader);
  await page.screenshot({ path: OUT + 'home-1440-nojs.png' });
  await ctx.close();
}

/* ---------- 8. repeated navigation, back/forward, scroll restoration ---------- */
{
  const { ctx, page } = await newPage({}, [RAF_COUNTER]);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  for (let i = 0; i < 4; i++) {
    await page.click('a.row >> nth=0');
    await page.waitForLoadState('networkidle');
    await page.goBack({ waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(500);
  const rate = await rafRate(page);
  pass('after repeated back/forward the field runs one loop', rate > 12 && rate < 26, `${rate.toFixed(1)}/s`);
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(200);
  await page.click('a.row >> nth=1');
  await page.waitForLoadState('networkidle');
  await page.goBack({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const y = await page.evaluate(() => window.scrollY);
  pass('back restores scroll position', Math.abs(y - 900) < 60, `scrollY=${y}`);
  pass('no errors during navigation', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();
}

/* ---------- 9. demo flags ---------- */
{
  const { ctx, page } = await newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const r = await page.evaluate(() => ({
    robots: document.querySelector('meta[name=robots]')?.content,
    notes: document.querySelectorAll('.demo-note').length,
    deadLinks: [...document.querySelectorAll('a')].filter((a) => a.getAttribute('href') === '#').length,
  }));
  pass('demo pages are noindex', r.robots === 'noindex, nofollow', r.robots);
  pass('demo preview is marked exactly once', r.notes === 1);
  pass('no dead href="#" links', r.deadLinks === 0);
  const robots = await (await page.goto(BASE + '/robots.txt')).text();
  pass('demo robots.txt disallows crawling', /Disallow: \//.test(robots));
  const sitemap = await (await page.goto(BASE + '/sitemap.xml')).text();
  pass('demo sitemap lists nothing', !/<loc>/.test(sitemap));
  const draft = await page.goto(BASE + '/work/project-draft/');
  pass('draft fixture has no route', draft.status() === 404, String(draft.status()));
  await ctx.close();
}

/* ---------- 10. live (non-demo) build with empty content ---------- */
if (LIVE) {
  const { ctx, page } = await newPage();
  await page.goto(LIVE + '/', { waitUntil: 'networkidle' });
  const r = await page.evaluate(() => ({
    robots: document.querySelector('meta[name=robots]')?.content ?? null,
    demo: document.querySelectorAll('.demo-note').length,
    rows: document.querySelectorAll('.row').length,
    empties: [...document.querySelectorAll('.empty, .contact-empty')].map((e) => e.textContent.trim()),
    intro: !!document.querySelector('.intro'),
    cta: !!document.querySelector('.cta'),
  }));
  pass('live: indexable, no demo marker', r.robots === null && r.demo === 0);
  pass('live: no fixture rows', r.rows === 0);
  pass('live: intentional empty states', r.empties.length === 3, r.empties.join(' | '));
  pass('live: no placeholder intro or dead CTA', !r.intro && !r.cta);
  await scrollThrough(page);
  await page.screenshot({ path: OUT + 'home-1440-live-empty.png', fullPage: true });
  const fixture = await page.goto(LIVE + '/work/project-01/');
  pass('live: fixture routes are not generated', fixture.status() === 404, String(fixture.status()));
  await ctx.close();
}

/* ---------- 11. axe-core (WCAG 2.x A/AA) + touch targets ---------- */
{
  const axeSource = require('fs').readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const { ctx, page } = await newPage({ viewport: vp });
    const all = [];
    for (const route of ROUTES) {
      await page.goto(BASE + route, { waitUntil: 'networkidle' });
      await scrollThrough(page); // reveal everything so contrast is measured on final colours
      await page.addScriptTag({ content: axeSource });
      const res = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }));
      for (const v of res.violations) all.push(`${route} ${v.id} (${v.nodes.length}): ${v.nodes[0]?.target}`);
    }
    pass(`axe: no WCAG A/AA or best-practice violations at ${vp.width}px`, all.length === 0, all.join(' | '));
    ctx.close();
  }
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const small = [];
  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    const found = await page.$$eval('a, button', (els) =>
      els
        .filter((e) => !e.classList.contains('skip-link') && !e.hidden && e.getClientRects().length)
        .map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.replace(/\s+/g, ' ').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
        .filter((r) => r.h < 44 || r.w < 24),
    );
    for (const f of found) small.push(`${route} "${f.t}" ${f.w}×${f.h}`);
  }
  pass('touch targets ≥44px tall (≥24px wide) at 390px', small.length === 0, small.join(' | '));
  // a tap on the field gives visible feedback and does not block scrolling
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const box = await page.locator('.field-canvas').boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  pass('tap settles the field on touch', (await fieldState(page)) === 'settled');
  const ta = await page.evaluate(() => getComputedStyle(document.querySelector('.field-canvas')).touchAction);
  pass('field does not capture touch scrolling', ta === 'auto' || ta.includes('pan-y'), ta);
  await ctx.close();
}

/* ---------- 12. entry loader ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const t0 = Date.now();
  await page.goto(BASE + '/', { waitUntil: 'commit' });
  await page.waitForTimeout(400);
  const during = await page.evaluate(() => ({
    loading: document.documentElement.classList.contains('is-loading'),
    busy: document.documentElement.getAttribute('aria-busy'),
    role: document.querySelector('[data-loader]')?.getAttribute('role'),
    mainHidden: getComputedStyle(document.querySelector('main')).visibility === 'hidden',
    art: [...document.querySelectorAll('[data-layer]')].some((el) => el.textContent.trim().length > 0),
  }));
  pass('loader shows on entry, hides the page, and is announced as status', during.loading && during.busy === 'true' && during.role === 'status' && during.mainHidden && during.art, JSON.stringify(during));
  // record which finale phases appear
  const seen = { focus: false, finale: false, burning: false };
  while (await page.evaluate(() => !!document.querySelector('[data-loader]'))) {
    const c = await page.evaluate(() => document.querySelector('[data-loader]')?.className ?? '');
    if (c.includes('is-focus')) seen.focus = true;
    if (c.includes('is-finale')) seen.finale = true;
    if (c.includes('is-burning')) seen.burning = true;
    await page.waitForTimeout(40);
    if (Date.now() - t0 > 15000) break;
  }
  const revealMs = Date.now() - t0;
  const after = await page.evaluate(() => ({
    fontLoaded: document.fonts.check('16px "Iosevka Web"'),
    complete: document.readyState === 'complete',
    field: document.querySelector('[data-ascii-field]')?.dataset.ready === 'true',
  }));
  pass('page is revealed only after load, font, and hero field are ready', after.fontLoaded && after.complete && after.field, `${revealMs} ms; ${JSON.stringify(after)}`);
  pass('finale ran: focus → fill → burn, then the loader removed itself', seen.focus && seen.finale && seen.burning, JSON.stringify(seen));
  report.loaderRevealMs = revealMs;
  await page.click('a[href="/notes/"]');
  await page.waitForLoadState('domcontentloaded');
  pass('internal navigation skips the loader', !(await page.evaluate(() => document.documentElement.classList.contains('is-loading'))));
  await page.reload({ waitUntil: 'commit' });
  await page.waitForTimeout(100);
  pass('reload shows the loader again', await page.evaluate(() => document.documentElement.classList.contains('is-loading')));
  pass('no errors from the loader', errors.length === 0, errors.join(' | '));
  await ctx.close();

  const slow = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await slow.route('**/_astro/AsciiField*.js', async (r) => {
    await new Promise((res) => setTimeout(res, 3500));
    r.continue();
  });
  const sp = await slow.newPage();
  const s0 = Date.now();
  await sp.goto(BASE + '/', { waitUntil: 'commit' });
  await sp.waitForTimeout(2800);
  const held = await sp.evaluate(() => document.documentElement.classList.contains('is-loading'));
  await sp.waitForFunction(() => !document.querySelector('[data-loader]'), null, { timeout: 15000 });
  pass('loader holds while an asset is still loading (field script delayed 3.5s)', held, `revealed at ${Date.now() - s0} ms`);
  await slow.close();

  const rm = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const rp = await rm.newPage();
  const r0 = Date.now();
  await rp.goto(BASE + '/', { waitUntil: 'commit' });
  await rp.waitForFunction(() => !document.querySelector('[data-loader]'), null, { timeout: 15000 });
  pass('reduced motion: still network, no minimum display time', Date.now() - r0 < 1500, `${Date.now() - r0} ms`);
  await rm.close();

  const fs = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await fs.route('**/_astro/Loader*.js', (r) => r.abort());
  const fp = await fs.newPage();
  const f0 = Date.now();
  await fp.goto(BASE + '/', { waitUntil: 'commit' });
  await fp.waitForFunction(() => getComputedStyle(document.querySelector('main')).visibility === 'visible', null, { timeout: 15000 });
  pass('CSS failsafe reveals the page if the loader script never runs', Date.now() - f0 < 10000, `${Date.now() - f0} ms`);
  await fs.close();
}

await browser.close();
const failed = report.checks.filter((c) => !c.ok);
report.summary = { total: report.checks.length, failed: failed.length };
writeFileSync(new URL('../design/qa-report.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(`\n${report.checks.length - failed.length}/${report.checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
