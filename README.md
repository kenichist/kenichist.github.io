# Kenichi Shawn Tanzil: portfolio frontend

Astro 7 (static), TypeScript, plain CSS, a small canvas module for the hero's character field, and an
ASCII neural-network entry loader (see DESIGN.md §7).
There is no backend, CMS, analytics, or client framework runtime.

- Content: see **[CONTENT_GUIDE.md](CONTENT_GUIDE.md)**
- Design system, tokens, and motion states: see **[DESIGN.md](DESIGN.md)**
- Product context: [PRODUCT.md](PRODUCT.md)
- Approved mockup: `design/reference.webp`

## Run

Requires Node ≥ 22.

```sh
npm install
npm run dev            # http://localhost:4321, demo content on
npm test               # unit tests (content filtering, motion state, field generator)
npm run build          # type check + static build → dist/
npm run preview        # serve dist/
npm run build:live     # build with demo content OFF (real content only)
```

## Routes

`/` · `/work/` · `/work/[slug]/` · `/notes/` · `/notes/[slug]/` · `404` · `/robots.txt` · `/sitemap.xml`

## Structure

```
src/
  content/       profile.ts, projects.ts, notes.ts (real), fixtures.ts (demo), site.ts (switches), types.ts
  lib/           content.ts (filtering, validation, sitemap), site-content.ts (resolved content)
  components/    Header, Footer, Hero, AsciiField, AsciiStrip, EntryList, Pager, BackLink
  layouts/       Base.astro
  pages/         index, work/, notes/, 404, robots.txt, sitemap.xml
  scripts/ascii/ field.ts (pure generator), motion-state.ts (pure reducer), controller.ts (canvas)
  scripts/       reveal.ts
  styles/        tokens.css, global.css
public/fonts/    iosevka-subset-400.woff2 + OFL.txt
tests/           vitest suites
scripts/         qa.mjs (rendered QA), profile.mjs (main-thread cost), record.mjs (motion video)
design/          reference mockup, screenshots/, motion/, qa-report.json, profile.json
```

## Rendered QA

```sh
npm run build && npx astro preview --port 4321 &
DEMO_CONTENT=0 npx astro build --outDir dist-live && python3 -m http.server 4322 -d dist-live &
BASE=http://127.0.0.1:4321 LIVE=http://127.0.0.1:4322 node scripts/qa.mjs
BASE=http://127.0.0.1:4321 node scripts/profile.mjs
```

The scripts use Playwright's Chromium (`require('playwright')`), which is not a project
dependency. Install it if your machine doesn't have it. `qa.mjs` also uses `axe-core`
(a dev dependency).

## Verification snapshot (5 Nov 2026)

Environment: a Linux cloud container running headless Chromium through Playwright. These numbers
are not from a physical phone, and frame rates depend on hardware.

| Check | Result |
| --- | --- |
| Unit tests | 32 / 32 pass |
| `astro check` | 0 errors, 0 warnings |
| Rendered QA (`scripts/qa.mjs`) | 66 / 66 pass: routes at 320, 390, 768, 1440, 1920, and 200% zoom; links; keyboard; motion lifecycle; persistence; reduced motion; no-JS; back/forward; demo flags; live empty build; axe; touch |
| axe-core 4 (WCAG 2.2 A/AA + best practice) | 0 violations, 8 routes × 2 widths |
| JS shipped (home) | **4.4 KB gzip** field module + 0.6 KB inline reveal script. Inner pages ship only the inline script |
| CSS | 2.8 KB gzip |
| Font | 9.9 KB WOFF2, one weight, preloaded |
| HTML (home) | 3.6 KB gzip |
| Field, desktop 1440 at DPR 2 | 20 fps; 0.8 ms median / 1.2 ms p95 per frame; ≈ 6% main thread at rest, 7% with the pointer moving |
| Field, mobile 390 at DPR 2, 4× CPU throttle | 20 fps; 1.8 / 2.8 ms; ≈ 11% main thread |
| Field, mobile 390, 6× CPU throttle | 20 fps; 2.8 / 5.0 ms; ≈ 17% main thread |
| Paused, settled, hidden tab, or offscreen | 0 frames scheduled, 0% |

Lighthouse was not run. No Lighthouse scores are claimed.
