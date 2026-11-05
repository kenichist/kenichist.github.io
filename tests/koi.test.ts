import { describe, expect, it } from 'vitest';
import { fishAt, KOI_GLYPHS, makeFish, strokeGlyph, swim } from '../src/scripts/koi/fish';
import { Pond, pondText } from '../src/scripts/koi/pond';

describe('koi', () => {
  it('draws a fish only around its body, with valid glyphs', () => {
    const f = makeFish(100, 100, 0, 120, 1);
    expect(fishAt(f, 100, 100, 8, 12)).not.toBeNull(); // body centre
    expect(fishAt(f, 100, 160, 8, 12)).toBeNull(); // beside it
    expect(fishAt(f, 260, 100, 8, 12)).toBeNull(); // ahead of the head
    for (let x = 0; x < 200; x += 4) for (let y = 60; y < 140; y += 4) {
      const c = fishAt(f, x, y, 8, 12);
      if (c) expect(c.glyph).toBeLessThan(KOI_GLYPHS.length);
    }
  });

  it('turns toward a heading at a limited rate and moves forward', () => {
    const f = makeFish(0, 0, 0, 100, 1);
    swim(f, 0.1, Math.PI / 2, 100, 2);
    expect(f.a).toBeCloseTo(0.2, 5); // 2 rad/s × 0.1s
    expect(f.x).toBeGreaterThan(0);
  });

  it('maps line angles to stroke glyphs', () => {
    const g = (a: number) => KOI_GLYPHS[strokeGlyph(a)];
    expect(g(0)).toBe('-');
    expect(g(Math.PI / 2)).toBe('|');
    expect(g(-Math.PI / 4)).toBe('/'); // up-right on screen
    expect(g(Math.PI / 4)).toBe('\\');
  });
});

describe('pond', () => {
  it('is deterministic', () => {
    const a = new Pond(700, 360);
    const b = new Pond(700, 360);
    for (let i = 0; i < 30; i++) {
      a.step(0.05);
      b.step(0.05);
    }
    expect(pondText(a, 96, 30, KOI_GLYPHS)).toBe(pondText(b, 96, 30, KOI_GLYPHS));
  });

  it('keeps every koi inside the pond over a long swim', () => {
    const p = new Pond(700, 360);
    for (let i = 0; i < 3000; i++) p.step(0.05); // 150 s
    for (const f of p.fish) {
      expect(f.x).toBeGreaterThan(-f.len * 0.2);
      expect(f.x).toBeLessThan(700 + f.len * 0.2);
      expect(f.y).toBeGreaterThan(-f.len * 0.2);
      expect(f.y).toBeLessThan(360 + f.len * 0.2);
    }
  });

  it('food draws the nearest koi, which eats it', () => {
    const p = new Pond(700, 360);
    p.step(0.05);
    const target = { x: 350, y: 180 };
    const nearest = () => Math.min(...p.fish.map((f) => Math.hypot(f.x - target.x, f.y - target.y)));
    const before = nearest();
    p.feed(target.x, target.y);
    for (let i = 0; i < 200 && p.food.length; i++) p.step(0.05);
    expect(p.food.length).toBe(0);
    expect(nearest()).toBeLessThan(before);
  });

  it('pointer stirring makes ripples that fade', () => {
    const p = new Pond(700, 360);
    p.stir(200, 200, 500);
    expect(p.ripples.length).toBe(1);
    for (let i = 0; i < 60; i++) p.step(0.05);
    expect(p.ripples.length).toBe(0);
  });
});
