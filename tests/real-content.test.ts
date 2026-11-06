import { describe, expect, it } from 'vitest';
import { projects } from '../src/content/projects';
import { notes } from '../src/content/notes';
import { profile } from '../src/content/profile';
import { extraLinks, projectLinks, projectSections, publishedNotes, publishedProjects, resolveContent, sitemapUrls, usableContactLinks } from '../src/lib/content';

const all = (o: object) => JSON.stringify(o);

describe('real content', () => {
  it('every project is published, complete, and free of placeholder copy', () => {
    expect(publishedProjects(projects)).toHaveLength(projects.length);
    for (const p of projects) {
      const ids = projectSections(p).map((s) => s.id);
      expect(ids, p.slug).toEqual(expect.arrayContaining(['problem', 'approach', 'contributions']));
      expect(p.summary && p.summary.length > 20, p.slug).toBe(true);
      expect(all(p)).not.toMatch(/placeholder|lorem|TODO|Project title \d/i);
    }
  });

  it('only links to real, public https URLs (private repositories have no link)', () => {
    for (const p of projects) {
      const raw = [p.githubUrl, p.demoUrl, ...(p.links ?? []).map((l) => l.href)].filter(Boolean);
      expect(projectLinks(p)).toHaveLength(raw.length); // nothing was dropped as invalid
      for (const l of projectLinks(p)) expect(l.href).toMatch(/^https:\/\//);
    }
    const priv = ['skyblock-market-forecaster', 'topic-feed'];
    for (const slug of priv) expect(projects.find((p) => p.slug === slug)?.githubUrl).toBeUndefined();
  });

  it('research entries are published with a working source link', () => {
    expect(publishedNotes(notes)).toHaveLength(notes.length);
    for (const n of notes) {
      expect(extraLinks(n.links).length, n.slug).toBeGreaterThan(0);
      expect(all(n)).not.toMatch(/placeholder|lorem|TODO/i);
    }
  });

  it('contact links are usable; the live build lists every real page in the sitemap', () => {
    expect(usableContactLinks(profile.contactLinks)).toHaveLength(profile.contactLinks.length);
    const content = resolveContent({ demo: false, profile, projects, notes, fixtures: { intro: '', projects: [], notes: [] } });
    const urls = sitemapUrls(content, 'https://kenichist.github.io');
    expect(urls).toContain('https://kenichist.github.io/work/folia/');
    expect(urls).toContain('https://kenichist.github.io/notes/defomo/');
    expect(urls).toHaveLength(3 + projects.length + notes.length);
  });
});
