import { describe, expect, it } from 'vitest';
import { CELL_GLYPHS, clipFrameText, decodeCode, encodeCell, glyphOf, isFieldClip, levelOf, type FieldClip } from '../src/scripts/ascii/frames';
import { FIELD_GLYPHS } from '../src/scripts/ascii/field';

describe('clip codec', () => {
  it('round-trips every glyph × level and keeps codes JSON-safe', () => {
    for (let g = 0; g < CELL_GLYPHS.length; g++) {
      for (const l of [0, 1, 2, 3] as const) {
        const ch = encodeCell(g, l);
        expect(ch).not.toMatch(/["\\\s]/);
        const p = decodeCode(ch.charCodeAt(0));
        expect(glyphOf(p)).toBe(CELL_GLYPHS[g]);
        expect(levelOf(p)).toBe(l);
      }
    }
    expect(decodeCode(32)).toBe(-1);
  });

  it('procedural glyphs are a subset of the codec glyphs (one atlas serves both)', () => {
    for (const g of FIELD_GLYPHS) expect(CELL_GLYPHS).toContain(g);
  });

  const clip: FieldClip = {
    v: 1,
    cols: 4,
    rows: 2,
    fps: 12,
    poster: 1,
    frames: [' '.repeat(8), encodeCell(3, 2) + '   ' + '   ' + encodeCell(4, 1)],
  };

  it('validates clip shape', () => {
    expect(isFieldClip(clip)).toBe(true);
    expect(isFieldClip({ ...clip, frames: ['short'] })).toBe(false);
    expect(isFieldClip({ ...clip, v: 2 })).toBe(false);
    expect(isFieldClip(null)).toBe(false);
  });

  it('renders a frame as text and resamples to another grid', () => {
    expect(clipFrameText(clip, 1)).toBe('|\n   /');
    expect(clipFrameText(clip, 1, 8, 4).split('\n')).toHaveLength(4);
    expect(clipFrameText(clip, -1)).toBe(clipFrameText(clip, 1)); // wraps
  });
});
