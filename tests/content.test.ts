import { describe, expect, it } from 'vitest';
import {
  isUsableUrl,
  neighbours,
  paragraphs,
  projectLinks,
  projectSections,
  publishedNotes,
  publishedProjects,
  resolveContent,
  sitemapUrls,
  usableContactLinks,
} from '../src/lib/content';
import { demoIntro, demoNotes, demoProjects } from '../src/content/fixtures';
import type { Profile, Project } from '../src/content/types';

const profile: Profile = { name: 'Kenichi Shawn Tanzil', role: 'AI / Machine Learning Engineer', intro: '', contactLinks: [] };
const fixtures = { intro: demoIntro, projects: demoProjects, notes: demoNotes };

describe('url validation', () => {
  it('accepts absolute http(s) and mailto when allowed', () => {
    expect(isUsableUrl('https://github.com/x')).toBe(true);
    expect(isUsableUrl('mailto:a@b.co', { allowMailto: true })).toBe(true);
  });
  it('rejects dead or unsafe hrefs', () => {
    for (const bad of ['', '#', '  ', '/relative', 'javascript:alert(1)', 'https://localhost', 'mailto:a@b.co', 'notaurl']) {
      expect(isUsableUrl(bad)).toBe(false);
    }
    expect(isUsableUrl(undefined)).toBe(false);
  });
});

describe('publishing filters', () => {
  it('drops drafts, bad slugs, empty titles and duplicates', () => {
    const list: Project[] = [
      { slug: 'ok', title: 'Ok' },
      { slug: 'draft', title: 'Draft', draft: true },
      { slug: 'Bad Slug', title: 'Bad' },
      { slug: 'empty-title', title: '  ' },
      { slug: 'ok', title: 'Duplicate' },
    ];
    expect(publishedProjects(list).map((p) => p.slug)).toEqual(['ok']);
  });

  it('sorts notes newest first and drops drafts', () => {
    const out = publishedNotes([
      { slug: 'a', title: 'A', body: 'x', date: '2025-01-01' },
      { slug: 'b', title: 'B', body: 'x', date: '2026-01-01' },
      { slug: 'c', title: 'C', body: 'x', date: '2027-01-01', draft: true },
    ]);
    expect(out.map((n) => n.slug)).toEqual(['b', 'a']);
  });

  it('keeps only usable contact links', () => {
    expect(
      usableContactLinks([
        { label: 'email', href: 'mailto:me@example.com' },
        { label: 'github', href: '#' },
        { label: '', href: 'https://example.com' },
        { label: 'site', href: 'https://example.com' },
      ]).map((l) => l.label),
    ).toEqual(['email', 'site']);
  });
});

describe('resolveContent', () => {
  it('demo mode uses fixtures, fills the intro, never invents contact links', () => {
    const c = resolveContent({ demo: true, profile, projects: [], notes: [], fixtures });
    expect(c.projects.length).toBe(4);
    expect(c.projects.some((p) => p.draft)).toBe(false);
    expect(c.notes.length).toBe(2);
    expect(c.profile.intro).toBe(demoIntro);
    expect(c.contactLinks).toEqual([]);
  });

  it('demo fixtures include a long title for wrap testing', () => {
    expect(demoProjects.some((p) => !p.draft && p.title.length > 60)).toBe(true);
  });

  it('live mode with no content produces empty collections and no intro', () => {
    const c = resolveContent({ demo: false, profile, projects: [], notes: [], fixtures });
    expect(c.projects).toEqual([]);
    expect(c.notes).toEqual([]);
    expect(c.profile.intro).toBe('');
  });

  it('live mode never shows fixtures and keeps real intro', () => {
    const c = resolveContent({
      demo: false,
      profile: { ...profile, intro: 'Real intro.' },
      projects: [{ slug: 'real', title: 'Real' }, { slug: 'wip', title: 'WIP', draft: true }],
      notes: [],
      fixtures,
    });
    expect(c.projects.map((p) => p.slug)).toEqual(['real']);
    expect(c.profile.intro).toBe('Real intro.');
  });
});

describe('sitemap', () => {
  it('is empty in demo mode or without an origin', () => {
    const demo = resolveContent({ demo: true, profile, projects: [], notes: [], fixtures });
    expect(sitemapUrls(demo, 'https://example.com')).toEqual([]);
    const live = resolveContent({ demo: false, profile, projects: [{ slug: 'a', title: 'A' }], notes: [], fixtures });
    expect(sitemapUrls(live, '')).toEqual([]);
  });

  it('lists only published routes', () => {
    const live = resolveContent({
      demo: false,
      profile,
      projects: [{ slug: 'a', title: 'A' }, { slug: 'b', title: 'B', draft: true }],
      notes: [{ slug: 'n', title: 'N', body: 'x' }],
      fixtures,
    });
    expect(sitemapUrls(live, 'https://example.com/')).toEqual([
      'https://example.com/',
      'https://example.com/work/',
      'https://example.com/notes/',
      'https://example.com/work/a/',
      'https://example.com/notes/n/',
    ]);
  });
});

describe('project detail helpers', () => {
  it('omits empty optional sections and never fabricates', () => {
    const s = projectSections({ slug: 'x', title: 'X', problem: 'P', approach: ' ', contributions: ['', 'C'], results: '' });
    expect(s.map((x) => x.id)).toEqual(['problem', 'contributions']);
    expect(s[1].items).toEqual(['C']);
  });

  it('only links valid external URLs', () => {
    expect(projectLinks({ slug: 'x', title: 'X', githubUrl: '#', demoUrl: '' })).toEqual([]);
    expect(projectLinks({ slug: 'x', title: 'X', githubUrl: 'https://github.com/a/b' })).toHaveLength(1);
  });

  it('splits paragraphs and finds neighbours', () => {
    expect(paragraphs('a\n\n  b \n\n\n')).toEqual(['a', 'b']);
    expect(neighbours([1, 2, 3], 0)).toEqual({ prev: undefined, next: 2 });
    expect(neighbours([1, 2, 3], 2)).toEqual({ prev: 2, next: undefined });
  });
});
