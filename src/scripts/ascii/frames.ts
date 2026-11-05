/**
 * Shared cell codec for the hero field. No imports, so both the browser bundle and
 * the Node converter (scripts/video-to-ascii.ts, run with type stripping) can load it.
 */

/** Every glyph the field may draw. Must exist in the font subset. Order is part of the clip format. */
export const CELL_GLYPHS = ['.', ':', "'", '|', '/', '+', '*', '-', '\\'] as const;
export type CellGlyph = (typeof CELL_GLYPHS)[number];
export type CellLevel = 0 | 1 | 2 | 3;

/** A pre-converted video loop on a fixed character grid. */
export interface FieldClip {
  v: 1;
  cols: number;
  rows: number;
  fps: number;
  /** Frame shown first, as the no-JS fallback, and under reduced motion. */
  poster: number;
  /** One string per frame, cols × rows chars, row-major. ' ' = empty cell. */
  frames: string[];
}

const BASE = 48; // '0'; codes 48..83 stay clear of JSON-escaped characters

export function encodeCell(glyph: number, level: CellLevel): string {
  return String.fromCharCode(BASE + glyph * 4 + level);
}

/** Returns glyph index × 4 + level, or -1 for an empty cell. */
export function decodeCode(code: number): number {
  return code === 32 ? -1 : code - BASE;
}

export const glyphOf = (packed: number): CellGlyph => CELL_GLYPHS[packed >> 2];
export const levelOf = (packed: number): CellLevel => (packed & 3) as CellLevel;

/** Integer hash → [0, 1). Stable across engines (uses Math.imul). */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function isFieldClip(x: unknown): x is FieldClip {
  const c = x as FieldClip;
  return (
    !!c &&
    c.v === 1 &&
    Number.isInteger(c.cols) &&
    Number.isInteger(c.rows) &&
    c.fps > 0 &&
    Array.isArray(c.frames) &&
    c.frames.length > 0 &&
    c.frames.every((f) => typeof f === 'string' && f.length === c.cols * c.rows)
  );
}

/** Plain-text rendering of one clip frame (no-JS fallback), resampled to the given grid. */
export function clipFrameText(clip: FieldClip, index: number, cols = clip.cols, rows = clip.rows): string {
  const frame = clip.frames[((index % clip.frames.length) + clip.frames.length) % clip.frames.length];
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const sr = Math.min(clip.rows - 1, Math.floor((r * clip.rows) / rows));
    let line = '';
    for (let c = 0; c < cols; c++) {
      const sc = Math.min(clip.cols - 1, Math.floor((c * clip.cols) / cols));
      const p = decodeCode(frame.charCodeAt(sr * clip.cols + sc));
      line += p < 0 ? ' ' : glyphOf(p);
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}
