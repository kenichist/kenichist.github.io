/**
 * Site-wide switches.
 *
 * demoContent: true  → projects and notes come from ./fixtures.ts, every page is
 *                      noindex, robots.txt disallows crawling, and a single
 *                      "demo preview" line appears at the top of each page.
 * demoContent: false → only real, non-draft entries from ./projects.ts and
 *                      ./notes.ts are built.
 *
 * The DEMO_CONTENT environment variable overrides this for one build:
 *   DEMO_CONTENT=0 npm run build    (or: npm run build:live)
 *   DEMO_CONTENT=1 npm run build    (or: npm run build:demo)
 */
const DEMO_DEFAULT = true;

/** Public origin, e.g. "https://example.com". Leave empty until a domain exists; no sitemap URLs are emitted without it. */
const SITE_URL = '';

/**
 * Hero artwork source. '' → the procedural field. A name → the pre-converted video clip at
 * public/field/<name>.wide.json + .narrow.json (made with `npm run field:convert`).
 * The FIELD_CLIP environment variable overrides this for one build.
 */
const FIELD_CLIP = '';

function envFlag(name: string): boolean | undefined {
  const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
  if (v === undefined || v === '') return undefined;
  return v === '1' || v.toLowerCase() === 'true';
}

function envString(name: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name] || undefined;
}

export const site = {
  demoContent: envFlag('DEMO_CONTENT') ?? DEMO_DEFAULT,
  siteUrl: envString('SITE_URL') ?? SITE_URL,
  fieldClip: (envString('FIELD_CLIP') ?? FIELD_CLIP).replace(/[^a-z0-9-]/gi, ''),
  /** Used in <title> after the page name. */
  titleSuffix: 'Kenichi Shawn Tanzil',
  description: 'Kenichi Shawn Tanzil — AI / machine learning engineer.',
};
