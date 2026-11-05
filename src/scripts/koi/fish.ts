/**
 * A koi seen from directly above, drawn in characters. Pure: state, swimming, rasterisation.
 * Shared by the homepage pond (pond.ts) and the pointer follower (follower.ts).
 *
 * The body is a chain of points that follows the head's path ("follow the leader"),
 * so a koi bends through its turns instead of rotating like a rigid sprite. A
 * travelling wave, strongest at the tail, rides on the chain while it swims.
 * Glyphs stay upright; each character cell is sampled against the nearest chain
 * segment to find how far along the body (s) and how far off its centre line (d) it is.
 */
import { hash2 } from '../ascii/frames';

/** Glyphs a koi scene may emit (all in the font subset). */
export const KOI_GLYPHS = ['.', ':', "'", '|', '/', '\\', '-', '+', '*', 'o', '@', '~', '=', '(', ')', '<', '>', ','] as const;
export type KoiGlyph = (typeof KOI_GLYPHS)[number];
const G = Object.fromEntries(KOI_GLYPHS.map((g, i) => [g, i])) as Record<KoiGlyph, number>;

/** Chain segments from nose to tail tip. */
const SEGS = 16;

export interface Fish {
  /** head (nose) position, px */
  x: number;
  y: number;
  /** heading, radians (0 = +x, y down) */
  a: number;
  /** speed, px/s */
  v: number;
  /** tail-beat phase */
  phase: number;
  /** 0 gliding … 1 swimming hard */
  thrust: number;
  /** nose-to-tail length, px */
  len: number;
  seed: number;
  /** chain points, nose first: x0, y0, x1, y1, … (SEGS + 1 points) */
  chain: Float32Array;
}

export function makeFish(x: number, y: number, a: number, len: number, seed: number): Fish {
  const chain = new Float32Array((SEGS + 1) * 2);
  const seg = len / SEGS;
  for (let i = 0; i <= SEGS; i++) {
    chain[i * 2] = x - Math.cos(a) * seg * i;
    chain[i * 2 + 1] = y - Math.sin(a) * seg * i;
  }
  return { x, y, a, v: 0, phase: hash2(seed, 1, 3) * 6.28, thrust: 0, len, seed, chain };
}

/** Body centre (midpoint of the chain), for culling and spacing. */
export function centre(f: Fish): { x: number; y: number } {
  const m = SEGS >> 1;
  return { x: f.chain[m * 2], y: f.chain[m * 2 + 1] };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Swim toward `desired` heading at about `speed`.
 * Below the target speed the koi beats its tail (thrust); above it, it glides and
 * water drag slows it. Turning needs forward speed, as for a real fish.
 */
export function swim(f: Fish, dt: number, desired: number, speed: number, turnRate = 1.4): void {
  const diff = wrap(desired - f.a);
  const grip = Math.min(1.3, 0.2 + f.v / 45);
  const maxTurn = turnRate * grip * dt;
  f.a = wrap(f.a + Math.max(-maxTurn, Math.min(maxTurn, diff)));

  const want = Math.max(0, speed);
  const push = want > f.v ? Math.min(1, (want - f.v) / 25 + 0.25) : 0;
  const turning = Math.min(1, Math.abs(diff) / 1.2) * 0.4; // turning takes a few strokes
  f.thrust += (Math.max(push, turning) - f.thrust) * Math.min(1, dt * 4);
  f.v += f.thrust * Math.max(60, want * 1.4) * dt; // tail strokes: harder when it wants to go faster
  f.v *= Math.exp(-dt * (0.45 + f.v / 300)); // drag
  f.x += Math.cos(f.a) * f.v * dt;
  f.y += Math.sin(f.a) * f.v * dt;
  f.phase += dt * (1.2 + 7 * f.thrust + f.v / 40);

  // body follows the head's path
  const c = f.chain;
  const seg = f.len / SEGS;
  c[0] = f.x;
  c[1] = f.y;
  for (let i = 1; i <= SEGS; i++) {
    const dx = c[i * 2] - c[i * 2 - 2];
    const dy = c[i * 2 + 1] - c[i * 2 - 1];
    const d = Math.hypot(dx, dy) || 1;
    c[i * 2] = c[i * 2 - 2] + (dx / d) * seg;
    c[i * 2 + 1] = c[i * 2 - 1] + (dy / d) * seg;
  }
}

/* ---------------- shape ---------------- */

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Body half-width at s (0 nose … 1 tail tip), as a fraction of length. */
function bodyHalf(s: number): number {
  if (s < 0.13) return 0.12 * Math.sqrt(Math.max(0, 1 - ((0.13 - s) / 0.13) ** 2)); // rounded nose
  if (s < 0.32) return 0.12 + 0.012 * smoothstep(0.13, 0.28, s);
  if (s < 0.8) return 0.132 - 0.082 * smoothstep(0.32, 0.8, s); // full body, short taper
  if (s < 0.84) return 0.05; // tail root
  return 0;
}

export interface Cell {
  glyph: number;
  level: 0 | 1 | 2 | 3;
}

/** Wave-displaced chain with per-segment tangents, computed once per frame per fish. */
export interface Pose {
  px: Float32Array;
  py: Float32Array;
  tx: Float32Array;
  ty: Float32Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function pose(f: Fish): Pose {
  const n = SEGS + 1;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const tx = new Float32Array(SEGS);
  const ty = new Float32Array(SEGS);
  const amp = f.len * (0.02 + 0.045 * f.thrust);
  for (let i = 0; i < n; i++) {
    const j = Math.min(i, SEGS - 1);
    const dx = f.chain[j * 2] - f.chain[j * 2 + 2];
    const dy = f.chain[j * 2 + 1] - f.chain[j * 2 + 3];
    const d = Math.hypot(dx, dy) || 1;
    const s = i / SEGS;
    const off = amp * s ** 1.6 * Math.sin(f.phase - s * 5);
    // normal = tangent rotated 90°
    px[i] = f.chain[i * 2] + (-dy / d) * off;
    py[i] = f.chain[i * 2 + 1] + (dx / d) * off;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < SEGS; i++) {
    const dx = px[i] - px[i + 1];
    const dy = py[i] - py[i + 1];
    const d = Math.hypot(dx, dy) || 1;
    tx[i] = dx / d; // points toward the nose
    ty[i] = dy / d;
  }
  const pad = f.len * 0.26;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, px[i] - pad);
    maxX = Math.max(maxX, px[i] + pad);
    minY = Math.min(minY, py[i] - pad);
    maxY = Math.max(maxY, py[i] + pad);
  }
  return { px, py, tx, ty, minX, minY, maxX, maxY };
}

const NONE = 0, BODY = 1, EYE = 2, FIN = 3, TAIL = 4;

/** Which part of the koi a point at (s along the body, dn across it, both in body lengths) belongs to. */
function partAt(s: number, dn: number, phase: number): number {
  if (s < 0 || s > 1) return NONE;
  const ad = Math.abs(dn);
  const wb = bodyHalf(s);
  if (s > 0.05 && s < 0.1 && Math.abs(ad - 0.07) < 0.022) return EYE;
  if (ad < wb) return BODY;
  // pectoral fins: a pair of fans just behind the head, paddling gently
  if (s > 0.16 && s < 0.38) {
    const span = Math.sin((Math.PI * (s - 0.16)) / 0.22) * (0.13 + 0.02 * Math.sin(phase * 0.5 + Math.sign(dn)));
    if (ad - wb < span) return FIN;
  }
  // pelvic fins: small, further back
  if (s > 0.56 && s < 0.64 && ad - wb < 0.035) return FIN;
  // tail: a forked fan
  if (s >= 0.8) {
    const t = (s - 0.8) / 0.2;
    if (ad < 0.05 + 0.07 * t && !(t > 0.6 && ad < 0.055 * ((t - 0.6) / 0.4))) return TAIL;
  }
  return NONE;
}

/**
 * Sample the koi over one character cell centred at (x, y) (null where there is none).
 * Nine points per cell give a coverage estimate, so parts thinner than a cell still
 * draw as connected shapes; outline glyphs follow the coverage edge's direction.
 */
export function fishAt(f: Fish, p: Pose, x: number, y: number, cellW: number, cellH: number): Cell | null {
  if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) return null;
  // nearest chain segment → position along the body (s) and signed offset (d)
  let best = Infinity, s = 0, d = 0, seg = 0;
  for (let i = 0; i < SEGS; i++) {
    const ax = p.px[i], ay = p.py[i];
    const vx = p.px[i + 1] - ax, vy = p.py[i + 1] - ay;
    const l2 = vx * vx + vy * vy || 1;
    let t = ((x - ax) * vx + (y - ay) * vy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + vx * t, qy = ay + vy * t;
    const dist = Math.hypot(x - qx, y - qy);
    if (dist < best) {
      best = dist;
      seg = i;
      s = (i + t) / SEGS;
      d = (x - qx) * -p.ty[i] + (y - qy) * p.tx[i];
    }
  }
  const L = f.len;
  if (best > L * 0.32) return null;
  const tx = p.tx[seg], ty = p.ty[seg];
  // nose cap: points ahead of the first chain point
  if (seg === 0) {
    const ahead = (x - p.px[0]) * tx + (y - p.py[0]) * ty;
    if (ahead > 0) s = -ahead / L;
  }

  const counts = [0, 0, 0, 0, 0];
  let gx = 0, gy = 0; // body-coverage gradient (points into the body)
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const ox = (i * cellW) / 3;
      const oy = (j * cellH) / 3;
      const s2 = s - (ox * tx + oy * ty) / L;
      const d2 = (d + (ox * -ty + oy * tx)) / L;
      const part = partAt(s2, d2, f.phase);
      counts[part]++;
      if (part === BODY || part === EYE) {
        gx += ox;
        gy += oy;
      }
    }
  }
  const body = counts[BODY] + counts[EYE];
  const along = Math.atan2(ty, tx); // body direction here (toward the nose)
  const edgeGlyph = () => strokeGlyph(Math.atan2(gy, gx) + Math.PI / 2);

  if (counts[EYE] >= 2) return { glyph: G['@'], level: 3 };
  if (body >= 7) {
    // koi markings: soft patches from a per-fish noise field
    const spot = hash2(Math.floor(s * 9), Math.floor((d / L + 1) * 7), f.seed) * 0.55 + hash2(Math.floor(s * 4), 0, f.seed + 9) * 0.45;
    return spot > 0.5 ? { glyph: G['o'], level: 3 } : { glyph: G[':'], level: 2 };
  }
  if (body >= 2) return { glyph: gx || gy ? edgeGlyph() : strokeGlyph(along), level: 2 };
  if (counts[FIN] >= 2) {
    // translucent fins: soft dots, with a faint ray at the trailing edge
    if (counts[FIN] >= 5) return { glyph: G['.'], level: 1 };
    const side = Math.sign(d) || 1;
    return { glyph: strokeGlyph(along + Math.PI - side * 1.05), level: 0 };
  }
  if (counts[TAIL] >= 2) {
    if (counts[TAIL] >= 7) return { glyph: G[':'], level: 1 };
    return { glyph: strokeGlyph(along + Math.PI + (Math.sign(d) || 1) * 0.5), level: 2 };
  }
  return null;
}

/** Character for a line running at angle `a` (screen coords, y down). */
export function strokeGlyph(a: number): number {
  let deg = (-a * 180) / Math.PI; // y-up degrees
  while (deg <= -90) deg += 180;
  while (deg > 90) deg -= 180;
  const m = Math.abs(deg);
  if (m > 67.5) return G['|'];
  if (m < 22.5) return G['-'];
  return deg > 0 ? G['/'] : G['\\'];
}

export const glyphIndex = G;
