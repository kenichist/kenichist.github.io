/**
 * Strokes → 28×28 model input, the MNIST way:
 * fit the ink into a 20×20 box (keeping aspect), then shift so the centre of mass sits at (14, 14).
 * Strokes are rendered as constant-width round-capped lines with analytic anti-aliasing,
 * matching the "re-stroked" training data (scripts/digits/train.py). Pure, no DOM.
 */

export type Point = { x: number; y: number };
export type Stroke = Point[];

/** Pen diameter in 28×28 model pixels. */
export const PEN = 2.4;

function distToSegment(px: number, py: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** Render strokes (already in target pixel space) into a size×size coverage image. */
export function rasterize(strokes: Stroke[], size: number, pen: number): Float32Array {
  const img = new Float32Array(size * size);
  const r = pen / 2;
  for (const s of strokes) {
    const segs = s.length === 1 ? [[s[0], s[0]]] : s.slice(1).map((p, i) => [s[i], p]);
    for (const [a, b] of segs) {
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - r - 1));
      const x1 = Math.min(size - 1, Math.ceil(Math.max(a.x, b.x) + r + 1));
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - r - 1));
      const y1 = Math.min(size - 1, Math.ceil(Math.max(a.y, b.y) + r + 1));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const cov = r + 0.5 - distToSegment(x + 0.5, y + 0.5, a, b);
          if (cov > 0) {
            const i = y * size + x;
            img[i] = Math.max(img[i], Math.min(1, cov));
          }
        }
      }
    }
  }
  return img;
}

export interface Prepared {
  input: Float32Array;
  /** ink extent relative to the pad's shorter side; very small drawings classify poorly */
  extent: number;
}

/** @param padSize the drawing surface size in the strokes' coordinate units */
export function prepare(strokes: Stroke[], padSize: number): Prepared | null {
  const pts = strokes.flat();
  if (pts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const extent = Math.max(w, h) / padSize;
  // the ink box (centre-lines plus pen) fills 20px on its longer side
  const s = (20 - PEN) / Math.max(w, h, padSize * 0.02);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const place = (dx: number, dy: number) =>
    strokes.map((st) => st.map((p) => ({ x: (p.x - cx) * s + 14 + dx, y: (p.y - cy) * s + 14 + dy })));
  let img = rasterize(place(0, 0), 28, PEN);
  // centre of mass → pixel (14, 14), i.e. continuous 14.5 with pixel centres at i + 0.5 (as scipy does in training)
  let m = 0;
  let mx = 0;
  let my = 0;
  for (let y = 0; y < 28; y++) {
    for (let x = 0; x < 28; x++) {
      const v = img[y * 28 + x];
      m += v;
      mx += v * (x + 0.5);
      my += v * (y + 0.5);
    }
  }
  if (m > 0) img = rasterize(place(14.5 - mx / m, 14.5 - my / m), 28, PEN);
  return { input: img, extent };
}
