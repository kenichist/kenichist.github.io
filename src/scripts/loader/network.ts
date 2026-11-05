/**
 * ASCII neural network for the loading screen. Pure: layout + frame(t) → text layers.
 *
 * Timeline
 *   1. Input: signals stream in from the left edge to the input nodes.
 *   2. Build: connections grow layer by layer; nodes appear as signals reach them.
 *   3. Forward passes repeat while assets load: in → hidden → hidden → output.
 *   4. (On ready, the loader focuses the output node; see loader.ts.)
 */

export interface NetNode {
  x: number;
  y: number;
  layer: number;
  /** seconds at which the node appears */
  at: number;
}

export interface NetPath {
  /** cells in order of travel */
  cells: { x: number; y: number }[];
  /** stage of the forward pass this path belongs to: 0 = input lead-in, 1.. = between layers */
  stage: number;
  /** seconds at which the path starts drawing */
  at: number;
}

export interface NetLayout {
  cols: number;
  rows: number;
  nodes: NetNode[];
  paths: NetPath[];
  /** number of pass stages (lead-in + connections between layers) */
  stages: number;
  /** index of the output node the finale starts from */
  output: number;
  /** seconds until the network is fully built */
  buildEnd: number;
}

export interface NetFrame {
  /** dim: connections */
  edges: string;
  /** mid: nodes */
  nodes: string;
  /** bright: signals, active nodes, the focused output */
  pulses: string;
}

const LEAD_IN = 0.32; // seconds for input signals to reach the input layer
const LAYER_GAP = 0.4; // seconds between layers starting to connect
const GROW = 0.3; // seconds for one connection to draw
const STAGGER = 0.012;
export const PASS = 1.2; // seconds per forward pass once built

export function layoutNetwork(cols = 41, rows = 13, sizes: number[] = [3, 4, 4, 1]): NetLayout {
  const nodes: NetNode[] = [];
  const byLayer: number[][] = [];
  const L = sizes.length;
  const mid = (rows - 1) / 2;
  const left = 6; // room for the input lead-in
  sizes.forEach((k, layer) => {
    const x = Math.round(left + (layer * (cols - left - 3)) / (L - 1));
    const spacing = Math.min(3, Math.floor((rows - 1) / Math.max(1, k - 1 + 0.5)));
    byLayer.push([]);
    for (let i = 0; i < k; i++) {
      const y = Math.round(mid + (i - (k - 1) / 2) * spacing);
      const at = layer === 0 ? LEAD_IN + i * 0.03 : LEAD_IN + (layer - 1) * LAYER_GAP + GROW + 0.04 + i * 0.03;
      byLayer[layer].push(nodes.length);
      nodes.push({ x, y, layer, at });
    }
  });

  const paths: NetPath[] = [];
  // Input lead-ins: from the left edge to each input node.
  byLayer[0].forEach((idx, i) => {
    const n = nodes[idx];
    const cells = [];
    for (let x = 0; x <= n.x - 2; x++) cells.push({ x, y: n.y });
    paths.push({ cells, stage: 0, at: i * 0.03 });
  });
  // Connections between layers.
  for (let layer = 0; layer < L - 1; layer++) {
    let k = 0;
    for (const a of byLayer[layer]) {
      for (const b of byLayer[layer + 1]) {
        paths.push({ cells: line(nodes[a], nodes[b]), stage: layer + 1, at: LEAD_IN + layer * LAYER_GAP + k * STAGGER });
        k++;
      }
    }
  }
  const buildEnd =
    Math.max(...nodes.map((n) => n.at), ...paths.map((p) => p.at + (p.stage === 0 ? LEAD_IN : GROW))) + 0.1;
  return { cols, rows, nodes, paths, stages: L, output: byLayer[L - 1][0], buildEnd };
}

/** One dotted cell per column between two nodes, so crossings merge quietly. */
function line(a: NetNode, b: NetNode): NetPath['cells'] {
  const x0 = a.x + 2;
  const x1 = b.x - 2;
  const n = Math.max(1, x1 - x0 + 1);
  const cells = [];
  for (let j = 0; j < n; j++) cells.push({ x: x0 + j, y: Math.round(a.y + ((b.y - a.y) * (j + 1)) / (n + 1)) });
  return cells;
}

const ease = (p: number) => 1 - (1 - p) ** 2;

/**
 * Render one moment.
 * @param t       seconds since start
 * @param animate false → the finished, still network (reduced motion)
 * @param focus   0..1 — dims everything but the output node, which brightens
 */
export function networkFrame(net: NetLayout, t: number, animate = true, focus = 0): NetFrame {
  const { cols, rows } = net;
  const size = cols * rows;
  const E = new Array<string>(size).fill(' ');
  const N = new Array<string>(size).fill(' ');
  const P = new Array<string>(size).fill(' ');
  const time = animate ? t : net.buildEnd;
  const at = (x: number, y: number) => y * cols + x;

  // Paths draw progressively, with a bright travelling tip while growing.
  for (const p of net.paths) {
    const dur = p.stage === 0 ? LEAD_IN : GROW;
    const prog = Math.min(1, Math.max(0, (time - p.at) / dur));
    const shown = Math.floor(ease(prog) * p.cells.length);
    for (let j = 0; j < shown; j++) E[at(p.cells[j].x, p.cells[j].y)] = '·';
    if (animate && prog > 0 && prog < 1 && shown < p.cells.length) {
      const c = p.cells[shown];
      P[at(c.x, c.y)] = '*';
    }
  }

  // Forward passes after the build: one stage at a time, left to right.
  const active = new Set<number>();
  if (animate && time >= net.buildEnd && focus === 0) {
    const per = PASS / net.stages;
    const phase = (time - net.buildEnd) % PASS;
    const stage = Math.floor(phase / per);
    const local = (phase - stage * per) / per;
    for (const p of net.paths) {
      if (p.stage !== stage) continue;
      const c = p.cells[Math.min(p.cells.length - 1, Math.floor(local * p.cells.length))];
      P[at(c.x, c.y)] = '*';
    }
    net.nodes.forEach((n, idx) => {
      // a node glows as the signal leaves it, and as it arrives at the next layer
      if ((n.layer === stage - 1 && local < 0.25) || (n.layer === stage && local > 0.85)) active.add(idx);
    });
  }

  net.nodes.forEach((n, idx) => {
    if (time < n.at) return;
    const i = at(n.x, n.y);
    E[i] = ' ';
    const fresh = animate && time - n.at < 0.08;
    if (idx === net.output && focus > 0) P[i] = focus > 0.5 ? '@' : 'O';
    else if (active.has(idx) || fresh) P[i] = fresh ? 'o' : 'O';
    else N[i] = 'o';
  });

  const join = (cells: string[]) => {
    const lines: string[] = [];
    for (let r = 0; r < rows; r++) lines.push(cells.slice(r * cols, (r + 1) * cols).join(''));
    return lines.join('\n');
  };
  return { edges: join(E), nodes: join(N), pulses: join(P) };
}
