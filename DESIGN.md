# Design system: aubergine / mono / character field

The source of truth for values is `src/styles/tokens.css`. This file explains them.
The approved mockup is kept at `design/reference.webp`. It shows composition and mood; it is not an asset.

## 1. Colour

All text pairs were measured with the WCAG 2.x formula against `--color-bg` (#16121E). axe-core also
passes on every route at 390px and 1440px (see `design/qa-report.json`).

| Token | Value | Use | Contrast on bg |
| --- | --- | --- | --- |
| `--color-bg` | `#16121E` | main aubergine | n/a |
| `--color-bg-deep` | `#100D16` | bottom of the page gradient (tonal depth) | n/a |
| `--color-bg-glow` | `rgb(36 28 48 / .55)` | faint lift behind the hero, radial | n/a |
| `--color-text` | `#DED9E4` | primary text, names, titles | **13.3 : 1** |
| `--color-text-2` | `#ABA0B6` | supporting text, meta, hints | **7.4 : 1** |
| `--color-accent` | `#8F779C` | decorative ASCII and list slashes, never small text | 4.6 : 1 (4.45 on `#1B1625`) |
| `--color-accent-text` | `#A58FB2` | mauve labels, `[ actions ]`, the motion control | **6.3 : 1** |
| `--color-rule` | `#352B40` | nonessential separators | 1.4 : 1 (decorative) |
| `--color-focus` | `#C9B8D6` | 1px focus outline | 9.9 : 1 |
| `--color-selection` | `#3A2E47` | `::selection` background | n/a |

Change from the brief: I added `--color-accent-text`. The brief's `accent-muted` passes AA on the
main background, but only barely, and it fails on lifted surfaces. So small mauve text uses a
slightly lighter mauve in the same hue family. `accent-muted` is still used for the artwork and
the rules.

The palette has no neon, no glow, no cyan, green, or yellow, and no purple-to-blue gradient. The
only gradients are a vertical bg → bg-deep and a faint radial lift, both in the same hue.

The browser's own surfaces are themed from the palette too: `::selection`, `scrollbar-color`,
`color-scheme: dark`, `theme-color`, and the focus ring.

### ASCII brightness tiers

| Token | Value | Glyphs |
| --- | --- | --- |
| `--field-0` | accent @ 70% | airborne `. ' :` |
| `--field-1` | text-2 @ 80% | lower stems `| / :` |
| `--field-2` | `rgb(196 186 206 / .92)` | upper stems |
| `--field-3` | `rgb(214 205 222 / .95)` | seed heads `* + .` |

## 2. Typography

**One family, Iosevka (upstream build), weight 400 only.** Self-hosted as
`public/fonts/iosevka-subset-400.woff2` (**9.9 KB**). The OFL license is kept beside it as `OFL.txt`.

- Subset with `pyftsubset` from `@fontsource/iosevka` 5.3.0. It covers U+0020–007E, U+00A0–00FF,
  U+2010–2027, U+2030–203A, the arrows ← ↑ → ↓ ↗, ™ and €. That covers every glyph the artwork
  and UI use (`. : ' | / + * [ ] · ← → ↓ ↗`).
- Only `kern`, `ccmp`, `locl`, `mark`, and `mkmk` are kept. **No `calt` and no ligatures**, so
  `->`, `//`, and `::` never fuse and grid cells stay aligned. CSS also sets
  `font-variant-ligatures: none`.
- **Why not "Iosevka Nerd Font Mono":** there is no maintained Nerd Font web build, and the site
  uses no icon glyphs. Patching in the Nerd symbol set would add hundreds of KB for nothing. The
  Iosevka OFL declares no Reserved Font Name, so subsetting it is permitted.
- Fallback stack: `ui-monospace, SF Mono, Cascadia Mono, Menlo, Consolas, Liberation Mono, monospace`.
- Iosevka is narrower than the face in the mockup render (0.5em advance). Tracking makes up the
  difference: display 0.045em, nav 0.08em, labels 0.16em, and rows 0.05em.

| Step | Size (390 → 1440) | Use |
| --- | --- | --- |
| `--step--1` | 13 → 15px | meta, hint, demo note |
| label | 14 → 17px, uppercase, 0.16em | section labels, role line |
| `--step-0` | 16 → 18px | body |
| `--step-1` | 17 → 21px | nav, intro, note rows, footer links |
| `--step-2` | 20 → 32px | project rows |
| `--step-3` | 28 → 44px | page titles |
| `--step-4` | 34 → 64px | hero name (regular weight, 1.08 leading) |

Body leading is 1.65. The reading measure is 66ch. Headings use `text-wrap: balance`. The hero
name always breaks before the last word ("Kenichi Shawn / Tanzil"), matching the mockup.

## 3. Space and layout

- Gutter `clamp(20px, 5vw, 96px)`: 20px at 390, 72px at 1440. The content max-width is 1280px.
- Section gap `clamp(96px, …, 160px)`.
- Hero: a two-column grid (`1fr / 1.25fr`) from 960px up. The field bleeds half a gutter past
  the right edge, as in the comp. Below 960px it is a single column, with the field after the
  intro.
- Rows: a title and an arrow on one baseline, separated by 1px `--color-rule`. The arrow reserves
  3px of travel so hover never shifts layout.
- Breakpoints are content-driven: 60rem (hero stacks), 40rem (field switches to its compact grid
  and the footer stacks), 34rem (the pager stacks), and 22.5rem (nav gap tightens at 320px).

## 4. Components

| Component | File | Notes |
| --- | --- | --- |
| Header | `components/Header.astro` | `kenichi /` + work · notes · contact; `aria-current` shows faint brackets; carries the one demo marker |
| Hero | `components/Hero.astro` | role, name, optional intro, `[ explore work ↓ ]` (only when work exists) |
| AsciiField | `components/AsciiField.astro` | text fallback + canvas + hint + native toggle |
| EntryList | `components/EntryList.astro` | `large` (work) / `small` (notes) rows |
| AsciiStrip | `components/AsciiStrip.astro` | static band of the field for inner pages; no JS |
| BackLink, Pager | `components/*.astro` | back link and prev/next |
| Footer | `components/Footer.astro` | `#contact`; real links only, otherwise an empty-state sentence |

Bracket convention: `[ text ]`. On nav links the brackets fade in on hover or focus. They are
absolutely positioned and hidden from assistive tech with `content: '[' / ''`. Actions such as
`[ explore work ↓ ]` and `[ pause ]` always show their brackets, and the brackets are
`aria-hidden`.

## 5. Motion

| Moment | Spec | Reduced motion |
| --- | --- | --- |
| Entrance | CSS `enter`: 520ms, expo-out, 6px rise, 70ms stagger. Starts at first paint and never waits for JS | none |
| Section reveal | once per section, 600ms, 8px; elements already in view are marked revealed before hiding starts | none |
| Links and rows | brackets fade and arrows move 3px over 150ms; title underline on hover | colour change only |
| Page change | cross-document View Transition, 220ms fade (progressive; plain links elsewhere) | off |
| Field reveal | 320ms dissolve-in on first draw, field area only | off |
| Field drift | 20fps, slow travelling gust | static |

### Field state machine (`src/scripts/ascii/motion-state.ts`)

Flags: `reducedMotion`, `motionOptIn`, `userPaused`, `settled`, `hidden`, `offscreen`.

Reported state, highest priority first:

```
reduced-motion  >  user-paused  >  settled  >  hidden-tab  >  offscreen  >  active
```

| Event | Effect |
| --- | --- |
| `toggle` while moving | `userPaused = true`, persisted to `localStorage['ks-field-paused']` |
| `toggle` while still | clears `userPaused` and `settled`; under reduced motion it sets `motionOptIn` for this page view only |
| `settle` (click or tap on the field) | `settled = true` (not persisted); ripple, then drift eases to 0 in about 1s, then frames stop |
| `visibility-changed` / `intersection-changed` | only toggle `hidden` / `offscreen`; **never** clear a pause, a settle, or reduced motion |
| `reduced-motion-changed → reduce` | `reducedMotion = true` and drops any opt-in |

Frames are scheduled only when `shouldRun()` is true (motion allowed, tab visible, field on
screen), or briefly while easing into a settle. Timing uses one `setTimeout`, aligned with
`requestAnimationFrame`, with at most one pending frame and no 60Hz polling. Resize goes through
one `ResizeObserver` and is debounced 120ms. All listeners use one `AbortController`. The font is
awaited (with a 1.5s cap) before the glyph atlas is built.

Control labels describe the action: **pause**, **resume**, or **play** (reduced motion). The
accessible name is "pause the background animation" and so on. The hint text is `aria-hidden`.

### Field geometry

The grid is fixed per breakpoint, and the font scales with the container:
70 × 21 cells wide and 46 × 18 cells below 640px. Each cell is 0.78em × 1.28em.
`aspect-ratio` reserves the exact box, so there is no layout shift. The server renders the same
seeded frame as `<pre>` text, so no-JS visitors get the artwork, and the canvas cross-fades in
over it without moving. Device-pixel ratio is capped at 2, and glyphs are blitted from a
pre-rendered atlas (7 glyphs × 4 tiers).

## 6. Responsive summary

| Width | Behaviour |
| --- | --- |
| 320 | nav wraps under the brand; 34px name; compact field; no horizontal scroll |
| 390 | nav fits on one line; single column; field below intro (≈ 225px tall) |
| 768 | single column; full-width field at the wide grid |
| 1440 | two-column hero, 72px gutters, 1280px content |
| 1920 | content capped at 1280px and centred, so the composition holds |
| 200% zoom | equivalent to 720px; single column, no overflow |

## 7. Entry loader

`src/components/Loader.astro`, `src/scripts/loader/{network,finale,loader}.ts`

**When it shows:** on arrival from outside the site (no or cross-origin referrer) and on reload.
It never shows on internal navigation. An inline head script decides before first paint
by setting `html.is-loading` and `aria-busy`.

**What it waits for:** the window `load` event (CSS, scripts, preloaded font), `document.fonts`,
and, on pages with the hero field, the field's first drawn frame (`ks:field-ready`, which
includes any clip data). There is a hard cap of 7s.

| Phase | Duration | What happens |
| --- | --- | --- |
| Input | ~0.3s | signals stream in from the left edge to the 3 input nodes |
| Build | ~1.2s | connections grow layer by layer (3 → 4 → 4 → 1); nodes appear as signals reach them |
| Forward pass | loops while waiting | `*` pulses run in → hidden → hidden → output, and nodes glow as signals pass |
| Focus | 420ms | the network recedes to 16% opacity; the output node brightens (`o → O → @`) |
| Fill | 700ms | characters flood the viewport outward from the output node, each cell flashing bright as it ignites |
| Burn | 1.1s | from the same point the characters burn away like paper: a scorched band ahead, a flickering ember edge, then the page shows through |

The minimum before the finale is 1.7s, so the build always completes. A key press or tap shortens that
minimum but never the wait for assets. The page becomes visible and interactive when the burn
starts: the entrance animation replays and the hero field dissolves in. The loader removes itself
when the burn finishes. Fast loads take about 4.0s in total.

Burn order is the distance from the output node mixed with value noise (84/16), so the edge is
ragged rather than circular. Cells are drawn on one canvas with cached glyphs, DPR is capped at 2,
and runs of background are filled per row.

**Accessibility and safety:**
- The loader has `role="status"` with a hidden "Loading" label, and the page sits under `aria-busy`.
- While loading, the page is `visibility: hidden`, so nothing behind the overlay can take focus.
- With reduced motion, the network appears already built, then fades out after a 0.3s delay.
- Without JavaScript there is no loader, because the class is never set.
- If the loader script fails, CSS failsafes reveal the page after 8s.

## 8. Deliberate deviations from tooling heuristics

- **The uppercase role line sits above the name** (`AI / MACHINE LEARNING ENGINEER`). Impeccable's
  craft floor bans eyebrow labels, but the approved mockup has one, and Impeccable's own rule is
  that the brief wins.
- **All-monospace text and a purple palette** are required by the brief. They are not a "technical
  costume".
- Section labels are not numbered, and no metrics, counters, cards, or terminal styling were added.
- **The entry loader** was requested later and overrides the original "no forced splash screens" rule.
  It keeps that rule's intent: it never shows on internal navigation, it doesn't block forever,
  it doesn't trap no-JS visitors, and it respects reduced motion.
