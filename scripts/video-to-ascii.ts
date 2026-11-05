/**
 * Convert a video into a looping character-field clip for the hero.
 *
 *   npm run field:convert -- <video> --name <id> [options]
 *
 * Writes public/field/<id>.wide.json (70×21) and public/field/<id>.narrow.json (46×18),
 * and prints a few frames as text for a quick look in the terminal.
 * Visitors download only these files, never the source video.
 *
 * Options
 *   --segments 10.1-13.6,14.2-17.1   time ranges in seconds, joined with character dissolves
 *                                    (default: the whole video)
 *   --fps 12                         playback rate of the clip
 *   --dissolve 0.6                   seconds of character dissolve between segments and at the loop
 *   --gain 1                         overall density (0.5 = sparser, 1.5 = denser)
 *   --edge 0.32                      edge strength where strokes start to appear (0–1)
 *   --focus 0.5                      horizontal focus 0–1 when cropping to the narrow grid
 *   --poster 1.5                     seconds into the clip for the still / no-JS frame
 *   --margin 0.03                    fraction trimmed from every edge before cropping
 *   --mask mask.mkv                  keep only the white area of a matching mask video (e.g. a person
 *                                    from scripts/person-mask.py); everything else stays empty
 *   --out public/field               output directory
 *
 * Requires ffmpeg and ffprobe on PATH. Run with: node --experimental-strip-types
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CELL_GLYPHS, encodeCell, hash2, type CellLevel, type FieldClip } from '../src/scripts/ascii/frames.ts';

/* ---------- args ---------- */

const argv = process.argv.slice(2);
const input = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const opt = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
if (!input) {
  console.error('usage: video-to-ascii <video> --name <id> [--segments a-b,c-d] [--fps 12] …');
  process.exit(1);
}
const name = opt('name', 'clip').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
const fps = Number(opt('fps', '12'));
const dissolveSec = Number(opt('dissolve', '0.6'));
const gain = Number(opt('gain', '1'));
const edgeStart = Number(opt('edge', '0.32'));
const focus = Math.min(1, Math.max(0, Number(opt('focus', '0.5'))));
const outDir = opt('out', 'public/field');
const maskPath = opt('mask', '');

/* ---------- probe ---------- */

const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', input], { encoding: 'utf8' });
if (probe.status !== 0) throw new Error(`ffprobe failed: ${probe.stderr}`);
const meta = JSON.parse(probe.stdout);
const srcW: number = meta.streams[0].width;
const srcH: number = meta.streams[0].height;
const duration = Number(meta.format.duration);

const segments = opt('segments', `0-${duration}`)
  .split(',')
  .map((s) => s.split('-').map(Number) as [number, number])
  .filter(([a, b]) => b > a);

/* ---------- grids (must match AsciiField.astro) ---------- */

const CELL_W = 0.78;
const CELL_H = 1.28;
const PX_W = 4; // analysis pixels per cell
const PX_H = 6;
const GRIDS = [
  { variant: 'wide', cols: 70, rows: 21 },
  { variant: 'narrow', cols: 46, rows: 18 },
];

const G = Object.fromEntries(CELL_GLYPHS.map((g, i) => [g, i])) as Record<string, number>;

function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Decode one segment to grayscale frames sized to the grid's analysis resolution. */
function readFrames(start: number, end: number, cols: number, rows: number, file = input!): Uint8Array[] {
  const W = cols * PX_W;
  const H = rows * PX_H;
  const aspect = (cols * CELL_W) / (rows * CELL_H);
  // Trim a small margin first: encodes often carry thin letterbox lines at the edges,
  // which would become a column of strokes down each side.
  const m = Number(opt('margin', '0.03'));
  const availW = Math.round(srcW * (1 - 2 * m));
  const availH = Math.round(srcH * (1 - 2 * m));
  let cw = availW;
  let ch = Math.round(availW / aspect);
  if (ch > availH) {
    ch = availH;
    cw = Math.round(availH * aspect);
  }
  const cx = Math.round(srcW * m + (availW - cw) * focus);
  const cy = Math.round(srcH * m + (availH - ch) / 2);
  const vf = `fps=${fps},crop=${cw}:${ch}:${cx}:${cy},scale=${W}:${H}:flags=area,format=gray`;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(start), '-t', String(end - start), '-i', file, '-an', '-vf', vf, '-f', 'rawvideo', '-'], {
    maxBuffer: 1 << 30,
  });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
  const buf: Buffer = r.stdout;
  const size = W * H;
  const out: Uint8Array[] = [];
  for (let o = 0; o + size <= buf.length; o += size) out.push(new Uint8Array(buf.buffer, buf.byteOffset + o, size));
  return out;
}

interface CellStats {
  M: Float32Array; // mask coverage 0..1 (1 everywhere without --mask)
  L: Float32Array; // mean luminance 0..1
  E: Float32Array; // gradient energy
  A: Float32Array; // stroke angle (deg, y-up, -90..90]
  C: Float32Array; // orientation coherence 0..1
}

/** Sobel → per-cell structure tensor: energy, dominant stroke direction, coherence. */
function analyse(img: Uint8Array, cols: number, rows: number, mask?: Uint8Array): CellStats {
  const W = cols * PX_W;
  const H = rows * PX_H;
  const n = cols * rows;
  const M = new Float32Array(n);
  const L = new Float32Array(n);
  const Jxx = new Float32Array(n);
  const Jyy = new Float32Array(n);
  const Jxy = new Float32Array(n);
  const at = (x: number, y: number) => Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x));
  const lum = (x: number, y: number) => img[at(x, y)] / 255;
  const cover = (x: number, y: number) => (mask ? mask[at(x, y)] / 255 : 1);
  // Gradients run on the masked image, so a masked subject gets a clean outline.
  const px = (x: number, y: number) => lum(x, y) * cover(x, y);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const gx = px(x + 1, y - 1) + 2 * px(x + 1, y) + px(x + 1, y + 1) - px(x - 1, y - 1) - 2 * px(x - 1, y) - px(x - 1, y + 1);
      const gy = px(x - 1, y + 1) + 2 * px(x, y + 1) + px(x + 1, y + 1) - px(x - 1, y - 1) - 2 * px(x, y - 1) - px(x + 1, y - 1);
      const i = Math.floor(y / PX_H) * cols + Math.floor(x / PX_W);
      L[i] += lum(x, y);
      M[i] += cover(x, y);
      Jxx[i] += gx * gx;
      Jyy[i] += gy * gy;
      Jxy[i] += gx * gy;
    }
  }
  const E = new Float32Array(n);
  const A = new Float32Array(n);
  const C = new Float32Array(n);
  const area = PX_W * PX_H;
  for (let i = 0; i < n; i++) {
    L[i] /= area;
    M[i] /= area;
    E[i] = Jxx[i] + Jyy[i];
    const phi = 0.5 * Math.atan2(2 * Jxy[i], Jxx[i] - Jyy[i]); // gradient direction (image coords)
    let a = (-(phi + Math.PI / 2) * 180) / Math.PI; // stroke direction, y-up
    while (a <= -90) a += 180;
    while (a > 90) a -= 180;
    A[i] = a;
    C[i] = E[i] > 1e-6 ? Math.sqrt((Jxx[i] - Jyy[i]) ** 2 + 4 * Jxy[i] ** 2) / E[i] : 0;
  }
  return { M, L, E, A, C };
}

function strokeFor(angle: number): number {
  const a = Math.abs(angle);
  if (a > 67.5) return G['|'];
  if (a < 22.5) return G['-'];
  return angle > 0 ? G['/'] : G['\\'];
}

/** Turn one segment into encoded frames for a grid. */
function convertSegment(start: number, end: number, cols: number, rows: number): string[] {
  const imgs = readFrames(start, end, cols, rows);
  const masks = maskPath ? readFrames(start, end, cols, rows, maskPath) : [];
  const stats = imgs.map((img, f) => analyse(img, cols, rows, masks[Math.min(f, masks.length - 1)]));
  // Normalise edge energy per segment (not per frame) so density doesn't flicker.
  // With a mask, only cells on the subject count.
  const all = stats.flatMap((s) => Array.from(s.E).filter((_, i) => s.M[i] > 0.15)).sort((a, b) => a - b);
  const p90 = all[Math.floor(all.length * 0.9)] || 1;
  const n = cols * rows;
  return stats.map((s, f) => {
    const prev = stats[Math.max(0, f - 1)];
    let out = '';
    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = (i / cols) | 0;
      if (s.M[i] < 0.12) {
        out += ' ';
        continue;
      }
      const e = Math.sqrt(s.E[i] / p90);
      const motion = Math.min(1, Math.abs(s.L[i] - prev.L[i]) * 6);
      const pEdge = smoothstep(edgeStart, edgeStart + 0.7, e) * 0.82;
      // Masked subjects get a light body fill so the figure reads as a shape, not just an outline.
      const pBright = maskPath ? 0.18 + smoothstep(0.35, 0.9, s.L[i]) * 0.3 : smoothstep(0.72, 0.95, s.L[i]) * 0.22;
      const p = Math.min(0.92, (pEdge + pBright + motion * 0.15) * gain);
      if (hash2(col, row, 1729) >= p) {
        out += ' ';
        continue;
      }
      const lum = s.L[i];
      // A masked subject is the only thing on screen, so its strokes sit one tier brighter.
      const lift = maskPath && pEdge >= 0.15 ? 1 : 0;
      const level = Math.min(3, (lum > 0.78 ? 3 : lum > 0.55 ? 2 : 1) + lift) as CellLevel;
      let glyph: number;
      if (pEdge < 0.15) glyph = maskPath ? (lum > 0.6 ? (hash2(col, row, 11) < 0.5 ? G['+'] : G['.']) : G[':']) : G['.']; // flat
      else if (s.C[i] < 0.35) glyph = lum > 0.7 ? G['*'] : hash2(col, row, 7) < 0.5 ? G[':'] : G['+'];
      else glyph = strokeFor(s.A[i]);
      out += encodeCell(glyph, glyph === G['.'] && !maskPath ? 0 : level);
    }
    return out;
  });
}

/** Character dissolve: each cell switches from a to b at its own moment. */
function dissolve(a: string[], b: string[], cols: number): string[] {
  const k = Math.min(a.length, b.length);
  const out: string[] = [];
  for (let j = 0; j < k; j++) {
    const t = (j + 1) / (k + 1);
    let s = '';
    for (let i = 0; i < a[j].length; i++) s += hash2(i % cols, (i / cols) | 0, 313) < t ? b[j][i] : a[j][i];
    out.push(s);
  }
  return out;
}

/* ---------- build ---------- */

mkdirSync(outDir, { recursive: true });
const D = Math.max(1, Math.round(dissolveSec * fps));
let preview = '';

for (const grid of GRIDS) {
  const segs = segments.map(([a, b]) => convertSegment(a, b, grid.cols, grid.rows)).filter((s) => s.length > 2 * D);
  if (!segs.length) throw new Error('no usable frames — check --segments');
  // Overlap neighbouring segments with a dissolve; then close the loop the same way.
  let frames = segs[0].slice();
  for (const next of segs.slice(1)) {
    const tail = frames.splice(frames.length - D, D);
    frames.push(...dissolve(tail, next.slice(0, D), grid.cols), ...next.slice(D));
  }
  const loopTail = frames.splice(frames.length - D, D);
  frames.splice(0, D, ...dissolve(loopTail, frames.slice(0, D), grid.cols));

  const poster = Math.min(frames.length - 1, Math.round(Number(opt('poster', String(segs[0].length / fps / 2))) * fps));
  const clip: FieldClip = { v: 1, cols: grid.cols, rows: grid.rows, fps, poster, frames };
  const file = join(outDir, `${name}.${grid.variant}.json`);
  writeFileSync(file, JSON.stringify(clip));
  const raw = JSON.stringify(clip).length;
  console.log(`${file}: ${frames.length} frames, ${(frames.length / fps).toFixed(1)}s loop, ${(raw / 1024).toFixed(0)} KB raw`);

  if (grid.variant === 'wide') {
    const { clipFrameText } = await import('../src/scripts/ascii/frames.ts');
    for (const idx of [poster, Math.floor(frames.length / 3), Math.floor((2 * frames.length) / 3)]) {
      preview += `--- frame ${idx} (${(idx / fps).toFixed(1)}s)\n${clipFrameText(clip, idx)}\n`;
    }
  }
}
console.log(preview);
