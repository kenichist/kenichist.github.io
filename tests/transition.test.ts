import { describe, expect, it } from 'vitest';
import { wantsTransition, type LinkClick } from '../src/scripts/transition';

const base: LinkClick = { button: 0, modified: false, defaultPrevented: false, href: '/notes/', target: '', download: false, here: 'https://kenichist.github.io/' };
const want = (o: Partial<LinkClick>) => wantsTransition({ ...base, ...o });

describe('which link clicks get an ASCII transition', () => {
  it('plain clicks to another page of the site', () => {
    expect(want({})).toBe(true);
    expect(want({ href: '/#work', here: 'https://kenichist.github.io/notes/' })).toBe(true);
    expect(want({ href: 'https://kenichist.github.io/work/project-01/' })).toBe(true);
  });

  it('not for same-page anchors', () => {
    expect(want({ href: '#contact' })).toBe(false);
    expect(want({ href: '/#work', here: 'https://kenichist.github.io/' })).toBe(false);
  });

  it('not for new tabs, modified or non-primary clicks', () => {
    expect(want({ modified: true })).toBe(false);
    expect(want({ button: 1 })).toBe(false);
    expect(want({ target: '_blank' })).toBe(false);
    expect(want({ target: '_self' })).toBe(true);
    expect(want({ defaultPrevented: true })).toBe(false);
  });

  it('not for external links, downloads, or non-http schemes', () => {
    expect(want({ href: 'https://github.com/kenichist' })).toBe(false);
    expect(want({ download: true })).toBe(false);
    expect(want({ href: 'mailto:someone@example.com' })).toBe(false);
  });
});
