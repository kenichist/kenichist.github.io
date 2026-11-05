// Records a short motion preview to design/motion/. Usage: BASE=http://127.0.0.1:4321 node scripts/record.mjs
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE ?? 'http://127.0.0.1:4321';
const dir = new URL('../design/motion/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
await page.goto(BASE + '/', { waitUntil: 'commit' });
await page.waitForFunction(() => !document.querySelector('[data-loader]'), null, { timeout: 15000 }); // entry loader
await page.waitForTimeout(2500); // entrance + resting drift
const box = await page.locator('.field-canvas').boundingBox();
const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
await page.mouse.move(...at(0.15, 0.6));
await page.mouse.move(...at(0.85, 0.45), { steps: 70 }); // disturb
await page.waitForTimeout(400);
await page.mouse.move(...at(0.4, 0.7), { steps: 50 });
await page.waitForTimeout(1200); // damped return
await page.mouse.click(...at(0.55, 0.55)); // settle
await page.waitForTimeout(2200);
await page.mouse.move(1300, 700);
await page.hover('[data-field-toggle]');
await page.waitForTimeout(400);
await page.click('[data-field-toggle]'); // resume
await page.waitForTimeout(2000);
await page.hover('a.row >> nth=0').catch(() => {});
await page.mouse.wheel(0, 700);
await page.waitForTimeout(1200);
await page.hover('a.row >> nth=1');
await page.waitForTimeout(800);
await ctx.close();
await browser.close();
const webm = readdirSync(dir).filter((f) => f.endsWith('.webm') && f !== 'field-motion.webm');
if (webm.length) renameSync(dir + webm[webm.length - 1], dir + 'field-motion.webm');
console.log('wrote', dir + 'field-motion.webm');
