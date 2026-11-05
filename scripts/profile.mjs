// Main-thread cost of the hero field. Usage: BASE=http://127.0.0.1:4321 node scripts/profile.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE ?? 'http://127.0.0.1:4321';

const configs = [
  { name: 'desktop 1440×900, DPR 2, no throttle', viewport: { width: 1440, height: 900 }, dsf: 2, cpu: 1 },
  { name: 'mobile 390×844, DPR 3 (capped 2), CPU 4× throttle', viewport: { width: 390, height: 844 }, dsf: 3, cpu: 4, mobile: true },
  { name: 'mobile 390×844, DPR 3 (capped 2), CPU 6× throttle', viewport: { width: 390, height: 844 }, dsf: 3, cpu: 6, mobile: true },
];

const browser = await chromium.launch();
const results = [];
for (const c of configs) {
  const ctx = await browser.newContext({ viewport: c.viewport, deviceScaleFactor: c.dsf, isMobile: !!c.mobile, hasTouch: !!c.mobile });
  await ctx.addInitScript(() => {
    // time each field frame: draw happens inside a rAF callback
    window.__frames = [];
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => orig((t) => { const s = performance.now(); cb(t); window.__frames.push(performance.now() - s); });
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (c.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: c.cpu });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.querySelector('[data-loader]'), null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));

  const measure = async (label, ms, during) => {
    await page.evaluate(() => (window.__frames = []));
    const a = await m();
    if (during) await during(); else await page.waitForTimeout(ms);
    const b = await m();
    const frames = await page.evaluate(() => window.__frames.slice());
    const secs = b.Timestamp - a.Timestamp;
    const sorted = frames.slice().sort((x, y) => x - y);
    const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);
    return {
      label,
      seconds: +secs.toFixed(2),
      framesPerSec: +(frames.length / secs).toFixed(1),
      frameMsMedian: +pct(0.5).toFixed(2),
      frameMsP95: +pct(0.95).toFixed(2),
      mainThreadBusyPct: +(((b.TaskDuration - a.TaskDuration) / secs) * 100).toFixed(1),
      scriptPct: +(((b.ScriptDuration - a.ScriptDuration) / secs) * 100).toFixed(1),
      layoutCount: b.LayoutCount - a.LayoutCount,
      styleRecalcs: b.RecalcStyleCount - a.RecalcStyleCount,
    };
  };

  const idle = await measure('idle drift', 6000);
  const box = await page.locator('.field-canvas').boundingBox();
  const pointer = c.mobile
    ? null
    : await measure('pointer sweeping', 0, async () => {
        for (let i = 0; i < 4; i++) {
          await page.mouse.move(box.x + 20, box.y + box.height / 2);
          await page.mouse.move(box.x + box.width - 20, box.y + box.height * 0.4, { steps: 60 });
        }
      });
  await page.click('[data-field-toggle]');
  await page.waitForTimeout(300);
  const paused = await measure('paused', 4000);
  results.push({ config: c.name, idle, pointer, paused, jsHeapMB: +((await m()).JSHeapUsedSize / 1048576).toFixed(2) });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify({ environment: `${process.platform} container, headless Chromium (Playwright), ${new Date().toISOString()}`, results }, null, 2));
