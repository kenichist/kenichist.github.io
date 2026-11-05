import { describe, expect, it } from 'vitest';
import { layoutNetwork, networkFrame, PASS } from '../src/scripts/loader/network';
import { cellKeys, cellState, EMBER_W } from '../src/scripts/loader/finale';

const count = (s: string, ch: string) => [...s].filter((c) => c === ch).length;

describe('loader network', () => {
  const net = layoutNetwork();

  it('lays out 3-4-4-1 nodes left to right with input lead-ins and one output', () => {
    expect(net.nodes.length).toBe(12);
    expect(net.paths.filter((p) => p.stage === 0)).toHaveLength(3);
    expect(net.paths.filter((p) => p.stage > 0)).toHaveLength(3 * 4 + 4 * 4 + 4 * 1);
    expect(net.nodes[net.output].layer).toBe(3);
    for (const n of net.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThan(net.cols);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThan(net.rows);
    }
    // lead-ins start at the left edge
    for (const p of net.paths.filter((q) => q.stage === 0)) expect(p.cells[0].x).toBe(0);
  });

  it('input arrives first, then layers appear in order, all by buildEnd', () => {
    const start = networkFrame(net, 0.15);
    expect(count(start.nodes + start.pulses, 'o')).toBe(0); // signals still travelling in
    expect(count(start.pulses, '*')).toBeGreaterThan(0);
    const order = [0, 1, 2, 3].map((l) => Math.min(...net.nodes.filter((n) => n.layer === l).map((n) => n.at)));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const built = networkFrame(net, net.buildEnd - 0.01);
    expect(count(built.nodes + built.pulses, 'o') + count(built.pulses, 'O')).toBe(12);
  });

  it('frames are exactly cols × rows and deterministic', () => {
    const f = networkFrame(net, 1.1);
    for (const layer of [f.edges, f.nodes, f.pulses]) {
      const lines = layer.split('\n');
      expect(lines).toHaveLength(net.rows);
      for (const l of lines) expect(l.length).toBe(net.cols);
    }
    expect(networkFrame(net, 1.1)).toEqual(f);
  });

  it('runs forward passes after building; focus lights only the output', () => {
    const pass = networkFrame(net, net.buildEnd + PASS * 0.4);
    expect(count(pass.pulses, '*')).toBeGreaterThan(0);
    const focus = networkFrame(net, net.buildEnd + 2, true, 1);
    expect(count(focus.pulses, '@')).toBe(1);
    expect(count(focus.pulses, '*')).toBe(0);
    const out = net.nodes[net.output];
    expect(focus.pulses.split('\n')[out.y][out.x]).toBe('@');
    const still = networkFrame(net, 0, false);
    expect(count(still.pulses, '*')).toBe(0);
    expect(count(still.nodes, 'o')).toBe(12);
  });
});

describe('loader finale', () => {
  const cols = 60;
  const rows = 30;
  const keys = cellKeys(cols, rows, 450, 200, 10, 16);

  it('orders cells outward from the origin (near fills/burns before far)', () => {
    const at = (c: number, r: number) => keys[r * cols + c];
    expect(at(45, 12)).toBeLessThan(at(5, 2));
    expect(at(45, 12)).toBeLessThan(at(0, 29));
    for (const k of keys) {
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThanOrEqual(1);
    }
  });

  it('fill covers everything by the end; burn clears everything by the end', () => {
    expect([...keys].every((k) => cellState(k, 1.02, null) !== 'empty')).toBe(true);
    expect([...keys].every((k) => cellState(k, 1, 1 + EMBER_W + 0.001) === 'gone')).toBe(true);
  });

  it('burn front: gone → ember → scorch → intact, in that order', () => {
    const b = 0.5;
    expect(cellState(0.3, 1, b)).toBe('gone');
    expect(cellState(b - EMBER_W / 2, 1, b)).toBe('ember');
    expect(cellState(b + 0.01, 1, b)).toBe('scorch');
    expect(cellState(0.9, 1, b)).toBe('char');
  });
});
