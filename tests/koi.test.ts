import { describe, expect, it } from 'vitest';
import { centre, fishAt, KOI_GLYPHS, makeFish, pose, strokeGlyph, swim } from '../src/scripts/koi/fish';
import { Pond, pondText } from '../src/scripts/koi/pond';

const CW = 7.4;
const CH = 12.2;

/** Render one fish to text on a grid around it. */
function draw(f: ReturnType<typeof makeFish>, cols = 40, rows = 16, ox = 0, oy = 0): string[] {
  const p = pose(f);
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const cell = fishAt(f, p, ox + (c + 0.5) * CW, oy + (r + 0.5) * CH, CW, CH);
      line += cell ? KOI_GLYPHS[cell.glyph] : ' ';
    }
    out.push(line);
  }
  return out;
}

describe('koi shape (top-down)', () => {
  it('is symmetric about its spine with an eye on each side', () => {
    // swimming straight up the page, centred on a column
    const f = makeFish(148, 20, -Math.PI / 2, 150, 1);
    const g = draw(f, 40, 16, 0, 0);
    const eyes = g.flatMap((l, r) => [...l].map((ch, c) => (ch === '@' ? c : -1)).filter((c) => c >= 0).map((c) => ({ r, c })));
    const cols = [...new Set(eyes.map((e) => e.c))];
    expect(cols.length).toBe(2); // two eyes, left and right
    expect(Math.abs((cols[0] + cols[1]) / 2 - 19.5)).toBeLessThan(1.5); // either side of the spine
    // pectoral fins stick out on both sides, wider than the body behind them
    const width = (l: string) => l.trim().length;
    const widest = Math.max(...g.map(width));
    expect(widest).toBeGreaterThan(width(g[g.length - 4]));
  });

  it('only draws around the body', () => {
    const f = makeFish(200, 100, 0, 120, 1);
    const p = pose(f);
    expect(fishAt(f, p, 140, 100, CW, CH)).not.toBeNull(); // mid body
    expect(fishAt(f, p, 140, 170, CW, CH)).toBeNull(); // well beside it
    expect(fishAt(f, p, 240, 100, CW, CH)).toBeNull(); // ahead of the nose
  });
});

describe('koi swimming', () => {
  it('cannot turn without forward speed, and turns gradually when moving', () => {
    const still = makeFish(0, 0, 0, 100, 1);
    swim(still, 0.1, Math.PI / 2, 0);
    expect(Math.abs(still.a)).toBeLessThan(0.04);
    const moving = makeFish(0, 0, 0, 100, 1);
    moving.v = 45;
    swim(moving, 0.1, Math.PI / 2, 45);
    expect(moving.a).toBeGreaterThan(0.05);
    expect(moving.a).toBeLessThan(0.3);
  });

  it('its body follows the path: after a turn the tail trails the old heading', () => {
    const f = makeFish(0, 0, 0, 100, 1);
    f.v = 50;
    for (let i = 0; i < 30; i++) swim(f, 0.05, Math.PI / 2, 50); // turn toward +y
    const tailX = f.chain[f.chain.length - 2];
    const tailY = f.chain[f.chain.length - 1];
    // the head has swung down; the tail is still behind and above it, not rotated rigidly
    expect(f.y).toBeGreaterThan(tailY);
    expect(Math.hypot(f.x - tailX, f.y - tailY)).toBeLessThan(100); // the body is curved, so nose-to-tail < length
  });

  it('glides when it wants to go slower (tail beats stop, speed decays)', () => {
    const f = makeFish(0, 0, 0, 100, 1);
    f.v = 60;
    for (let i = 0; i < 20; i++) swim(f, 0.05, 0, 10);
    expect(f.thrust).toBeLessThan(0.05);
    expect(f.v).toBeLessThan(60);
  });

  it('maps line angles to stroke glyphs', () => {
    const g = (a: number) => KOI_GLYPHS[strokeGlyph(a)];
    expect(g(0)).toBe('-');
    expect(g(Math.PI / 2)).toBe('|');
    expect(g(-Math.PI / 4)).toBe('/');
    expect(g(Math.PI / 4)).toBe('\\');
  });
});

describe('pond', () => {
  it('is deterministic', () => {
    const a = new Pond(714, 366);
    const b = new Pond(714, 366);
    for (let i = 0; i < 40; i++) {
      a.step(0.05);
      b.step(0.05);
    }
    expect(pondText(a, 96, 30, KOI_GLYPHS)).toBe(pondText(b, 96, 30, KOI_GLYPHS));
  });

  it('over five minutes: koi stay in the pond, keep moving, rarely overlap, never spin', () => {
    const p = new Pond(714, 366);
    let close = 0, pairs = 0, spins = 0;
    const headings = p.fish.map(() => [] as number[]);
    for (let i = 0; i < 6000; i++) {
      p.step(0.05);
      const cs = p.fish.map(centre);
      for (let a = 0; a < cs.length; a++)
        for (let b = a + 1; b < cs.length; b++) {
          pairs++;
          if (Math.hypot(cs[a].x - cs[b].x, cs[a].y - cs[b].y) < (p.fish[a].len + p.fish[b].len) * 0.25) close++;
        }
      p.fish.forEach((f, k) => {
        headings[k].push(f.a);
        expect(f.x).toBeGreaterThan(-f.len * 0.3);
        expect(f.x).toBeLessThan(714 + f.len * 0.3);
        expect(f.y).toBeGreaterThan(-f.len * 0.3);
        expect(f.y).toBeLessThan(366 + f.len * 0.3);
      });
    }
    for (const h of headings) {
      let sum = 0;
      const d = h.map((a, i) => (i ? Math.atan2(Math.sin(a - h[i - 1]), Math.cos(a - h[i - 1])) : 0));
      for (let i = 0; i < d.length; i++) {
        sum += d[i] - (i >= 80 ? d[i - 80] : 0);
        if (Math.abs(sum) > 2 * Math.PI) spins++;
      }
    }
    expect(spins).toBe(0); // never a full circle within 4 s
    expect(close / pairs).toBeLessThan(0.05); // bodies on top of each other < 5% of the time
    expect(p.fish.every((f) => f.v > 3)).toBe(true);
  });

  it('food draws the nearest koi, which eats it', () => {
    const p = new Pond(714, 366);
    p.step(0.05);
    p.feed(357, 183);
    for (let i = 0; i < 400 && p.food.length; i++) p.step(0.05);
    expect(p.food.length).toBe(0);
  });

  it('pointer stirring makes ripples that fade; a fast pass startles koi nearby', () => {
    const p = new Pond(714, 366);
    p.stir(200, 200, 300);
    expect(p.ripples.length).toBe(1);
    for (let i = 0; i < 60; i++) p.step(0.05);
    expect(p.ripples.length).toBe(0);
    const c = centre(p.fish[0]);
    p.stir(c.x, c.y, 900);
    const before = p.fish[0].v;
    for (let i = 0; i < 10; i++) p.step(0.05);
    expect(p.fish[0].v).toBeGreaterThan(before);
  });
});
