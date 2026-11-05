import { describe, expect, it } from 'vitest';
import { FIELD_GLYPHS, renderTextFrame } from '../src/scripts/ascii/field';

describe('field', () => {
  it('is deterministic for a seed', () => {
    expect(renderTextFrame(70, 21, 1729)).toBe(renderTextFrame(70, 21, 1729));
    expect(renderTextFrame(70, 21, 1729)).not.toBe(renderTextFrame(70, 21, 7));
  });

  it('emits only whitelisted glyphs within the grid', () => {
    const frame = renderTextFrame(46, 18);
    const lines = frame.split('\n');
    expect(lines).toHaveLength(18);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(46);
    const allowed = new Set([' ', ...FIELD_GLYPHS]);
    for (const ch of frame.replace(/\n/g, '')) expect(allowed.has(ch as never)).toBe(true);
  });

  it('is airy: well under half the cells are filled', () => {
    const frame = renderTextFrame(70, 21).replace(/\n/g, '');
    const filled = [...frame].filter((c) => c !== ' ').length;
    expect(filled / (70 * 21)).toBeGreaterThan(0.08);
    expect(filled / (70 * 21)).toBeLessThan(0.45);
  });
});
