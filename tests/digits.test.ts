import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import meta from '../src/data/digits-model.json';
import vectors from './fixtures/digits-vectors.json';
import { createModel, type ModelMeta } from '../src/scripts/digits/model';
import { PEN, prepare, rasterize } from '../src/scripts/digits/preprocess';

const bin = readFileSync('public/models/digits-cnn.bin');
const model = createModel(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength), meta as unknown as ModelMeta);

describe('digit model (TS) matches the trained model (JAX)', () => {
  it('reproduces probabilities for the exported test vectors', () => {
    for (const v of vectors as { label: number; input: number[]; probs: number[] }[]) {
      const p = model.predict(Float32Array.from(v.input));
      for (let i = 0; i < 10; i++) expect(p[i]).toBeCloseTo(v.probs[i], 4);
    }
  });

  it('reports measured accuracy that is plausible and consistent', () => {
    expect(meta.metrics.mnist_test_int8).toBeGreaterThan(0.98);
    expect(meta.metrics.restroked_test_int8).toBeGreaterThan(0.96);
    expect(meta.bytes).toBe(bin.byteLength);
  });
});

describe('preprocess', () => {
  const mass = (img: Float32Array) => {
    let m = 0, mx = 0, my = 0;
    for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) { const v = img[y * 28 + x]; m += v; mx += v * (x + 0.5); my += v * (y + 0.5); }
    return { m, cx: mx / m, cy: my / m };
  };
  const bbox = (img: Float32Array) => {
    let x0 = 28, x1 = -1, y0 = 28, y1 = -1;
    for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) if (img[y * 28 + x] > 0.08) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };

  it('centres the ink by centre of mass at pixel 14 and fits it in ~20px', () => {
    // an off-centre, small "7" drawn in a 400px pad
    const seven = [[{ x: 250, y: 40 }, { x: 330, y: 40 }, { x: 280, y: 160 }]];
    const p = prepare(seven, 400)!;
    const c = mass(p.input);
    expect(c.cx).toBeCloseTo(14.5, 0);
    expect(c.cy).toBeCloseTo(14.5, 0);
    const b = bbox(p.input);
    expect(Math.max(b.w, b.h)).toBeGreaterThanOrEqual(19);
    expect(Math.max(b.w, b.h)).toBeLessThanOrEqual(22);
  });

  it('keeps a "1" narrow (scaled by its height, not stretched)', () => {
    const one = [[{ x: 200, y: 50 }, { x: 205, y: 350 }]];
    const b = bbox(prepare(one, 400)!.input);
    expect(b.h).toBeGreaterThanOrEqual(19);
    expect(b.w).toBeLessThanOrEqual(5);
  });

  it('reports tiny drawings so the UI can ask for a bigger one', () => {
    expect(prepare([[{ x: 10, y: 10 }, { x: 14, y: 12 }]], 400)!.extent).toBeLessThan(0.12);
    expect(prepare([], 400)).toBeNull();
  });

  it('rasterises round-capped strokes of the pen width', () => {
    const img = rasterize([[{ x: 5, y: 14 }, { x: 23, y: 14 }]], 28, PEN);
    expect(img[14 * 28 + 14]).toBe(1);
    expect(img[10 * 28 + 14]).toBe(0);
  });

  it('classifies cleanly drawn synthetic digits', () => {
    const one = [[{ x: 200, y: 40 }, { x: 196, y: 360 }]];
    const zero = [Array.from({ length: 40 }, (_, i) => ({ x: 200 + 110 * Math.cos((i / 39) * 2 * Math.PI), y: 200 + 160 * Math.sin((i / 39) * 2 * Math.PI) }))];
    const seven = [[{ x: 90, y: 60 }, { x: 310, y: 60 }, { x: 170, y: 360 }]];
    const guess = (s: { x: number; y: number }[][]) => { const p = model.predict(prepare(s, 400)!.input); return p.indexOf(Math.max(...p)); };
    expect(guess(one)).toBe(1);
    expect(guess(zero)).toBe(0);
    expect(guess(seven)).toBe(7);
  });
});
