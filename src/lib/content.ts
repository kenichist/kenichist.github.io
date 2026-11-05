import type { ContactLink, Note, Profile, Project } from '../content/types';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Accept only absolute http(s) URLs (and mailto: when allowed). Rejects "#", "", javascript:, relative paths. */
export function isUsableUrl(href: string | undefined, opts: { allowMailto?: boolean } = {}): href is string {
  if (!href) return false;
  const value = href.trim();
  if (opts.allowMailto && /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(value)) return true;
  try {
    const u = new URL(value);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.');
  } catch {
    return false;
  }
}

const hasText = (s: string | undefined): s is string => typeof s === 'string' && s.trim().length > 0;

export function publishedProjects(list: readonly Project[]): Project[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    if (p.draft || !SLUG.test(p.slug) || !hasText(p.title) || seen.has(p.slug)) return false;
    seen.add(p.slug);
    return true;
  });
}

export function publishedNotes(list: readonly Note[]): Note[] {
  const seen = new Set<string>();
  return list
    .filter((n) => {
      if (n.draft || !SLUG.test(n.slug) || !hasText(n.title) || seen.has(n.slug)) return false;
      seen.add(n.slug);
      return true;
    })
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

export function usableContactLinks(links: readonly ContactLink[]): ContactLink[] {
  return links.filter((l) => hasText(l.label) && isUsableUrl(l.href, { allowMailto: true }));
}

/** Project sections in reading order; empty optional sections are dropped. */
export function projectSections(p: Project): { id: string; heading: string; text?: string; items?: string[] }[] {
  const sections: { id: string; heading: string; text?: string; items?: string[] }[] = [];
  if (hasText(p.problem)) sections.push({ id: 'problem', heading: 'Problem', text: p.problem });
  if (hasText(p.approach)) sections.push({ id: 'approach', heading: 'Approach', text: p.approach });
  const items = (p.contributions ?? []).filter(hasText);
  if (items.length) sections.push({ id: 'contributions', heading: 'Technical contributions', items });
  if (hasText(p.results)) sections.push({ id: 'results', heading: 'Results', text: p.results });
  if (hasText(p.limitations)) sections.push({ id: 'limitations', heading: 'Limitations', text: p.limitations });
  return sections;
}

export function projectLinks(p: Project): { label: string; href: string }[] {
  const out: { label: string; href: string }[] = [];
  if (isUsableUrl(p.githubUrl)) out.push({ label: 'source on github', href: p.githubUrl });
  if (isUsableUrl(p.demoUrl)) out.push({ label: 'live demo', href: p.demoUrl });
  return out;
}

export function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function neighbours<T>(list: readonly T[], index: number): { prev?: T; next?: T } {
  return { prev: index > 0 ? list[index - 1] : undefined, next: index < list.length - 1 ? list[index + 1] : undefined };
}

export interface SiteContent {
  demo: boolean;
  profile: Profile;
  projects: Project[];
  notes: Note[];
  contactLinks: ContactLink[];
}

/**
 * Resolve what the site shows.
 * Demo mode swaps projects/notes for fixtures and fills an empty intro.
 * Contact links are always the real, validated ones — never invented.
 */
export function resolveContent(input: {
  demo: boolean;
  profile: Profile;
  projects: readonly Project[];
  notes: readonly Note[];
  fixtures: { intro: string; projects: readonly Project[]; notes: readonly Note[] };
}): SiteContent {
  const { demo, profile } = input;
  return {
    demo,
    profile: { ...profile, intro: hasText(profile.intro) ? profile.intro : demo ? input.fixtures.intro : '' },
    projects: publishedProjects(demo ? input.fixtures.projects : input.projects),
    notes: publishedNotes(demo ? input.fixtures.notes : input.notes),
    contactLinks: usableContactLinks(profile.contactLinks),
  };
}

/** Absolute URLs for sitemap.xml. Empty in demo mode or without a configured origin. */
export function sitemapUrls(content: SiteContent, siteUrl: string): string[] {
  if (content.demo || !isUsableUrl(siteUrl)) return [];
  const origin = siteUrl.replace(/\/+$/, '');
  const paths = ['/', '/work/', '/notes/'];
  for (const p of content.projects) paths.push(`/work/${p.slug}/`);
  for (const n of content.notes) paths.push(`/notes/${n.slug}/`);
  return paths.map((p) => origin + p);
}

export function formatDate(iso: string | undefined): string | undefined {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
  const [y, m, d] = iso.split('-').map(Number);
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][m - 1];
  return month ? `${d} ${month} ${y}` : undefined;
}
