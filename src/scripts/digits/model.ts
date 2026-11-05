/**
 * In-browser digit classifier: a 32k-parameter CNN with int8 weights, in plain TS.
 * conv5×5(1→12) → ReLU → max-pool → conv3×3(12→24) → ReLU → max-pool → dense(600→48) → ReLU → dense(48→10) → softmax
 * Weights come from scripts/digits/train.py (public/models/digits-cnn.bin + src/data/digits-model.json).
 */

export interface TensorMeta {
  name: string;
  dtype: 'int8' | 'float32';
  shape: number[];
  offset: number;
  bytes: number;
}

export interface ModelMeta {
  arch: { conv1: number[]; conv2: number[]; dense1: number[]; dense2: number[] };
  tensors: TensorMeta[];
}

export interface DigitModel {
  /** 784 values in [0, 1], row-major 28×28 → 10 probabilities */
  predict(input: Float32Array): Float32Array;
}

function tensor(buf: ArrayBuffer, meta: ModelMeta, name: string): Float32Array {
  const t = meta.tensors.find((x) => x.name === name);
  if (!t) throw new Error(`missing tensor ${name}`);
  if (t.dtype === 'float32') return new Float32Array(buf.slice(t.offset, t.offset + t.bytes));
  const q = new Int8Array(buf, t.offset, t.bytes);
  const scale = tensor(buf, meta, `${name}.scale`);
  const out = new Float32Array(q.length);
  const oc = scale.length; // per output channel = last axis
  for (let i = 0; i < q.length; i++) out[i] = q[i] * scale[i % oc];
  return out;
}

/** NHWC input (H×W×C), HWIO kernel, VALID padding, + bias, ReLU. */
function convRelu(x: Float32Array, h: number, w: number, c: number, k: Float32Array, kh: number, kw: number, o: number, b: Float32Array): Float32Array {
  const oh = h - kh + 1;
  const ow = w - kw + 1;
  const out = new Float32Array(oh * ow * o);
  for (let y = 0; y < oh; y++) {
    for (let xx = 0; xx < ow; xx++) {
      const base = (y * ow + xx) * o;
      for (let oc = 0; oc < o; oc++) out[base + oc] = b[oc];
      for (let ky = 0; ky < kh; ky++) {
        for (let kx = 0; kx < kw; kx++) {
          const xi = ((y + ky) * w + (xx + kx)) * c;
          const ki = (ky * kw + kx) * c * o;
          for (let ic = 0; ic < c; ic++) {
            const v = x[xi + ic];
            if (v === 0) continue;
            const kr = ki + ic * o;
            for (let oc = 0; oc < o; oc++) out[base + oc] += v * k[kr + oc];
          }
        }
      }
      for (let oc = 0; oc < o; oc++) if (out[base + oc] < 0) out[base + oc] = 0;
    }
  }
  return out;
}

function maxPool2(x: Float32Array, h: number, w: number, c: number): Float32Array {
  const oh = h >> 1;
  const ow = w >> 1;
  const out = new Float32Array(oh * ow * c);
  for (let y = 0; y < oh; y++) {
    for (let xx = 0; xx < ow; xx++) {
      for (let ch = 0; ch < c; ch++) {
        const a = x[((2 * y) * w + 2 * xx) * c + ch];
        const b = x[((2 * y) * w + 2 * xx + 1) * c + ch];
        const d = x[((2 * y + 1) * w + 2 * xx) * c + ch];
        const e = x[((2 * y + 1) * w + 2 * xx + 1) * c + ch];
        out[(y * ow + xx) * c + ch] = Math.max(a, b, d, e);
      }
    }
  }
  return out;
}

function dense(x: Float32Array, w: Float32Array, b: Float32Array, out: number, relu: boolean): Float32Array {
  const y = Float32Array.from(b);
  const n = x.length;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (v === 0) continue;
    const r = i * out;
    for (let j = 0; j < out; j++) y[j] += v * w[r + j];
  }
  if (relu) for (let j = 0; j < out; j++) if (y[j] < 0) y[j] = 0;
  return y;
}

export function createModel(buf: ArrayBuffer, meta: ModelMeta): DigitModel {
  const [k1h, k1w, , c1] = meta.arch.conv1;
  const [k2h, k2w, , c2] = meta.arch.conv2;
  const [, h1] = meta.arch.dense1;
  const W = Object.fromEntries(['c1w', 'c1b', 'c2w', 'c2b', 'd1w', 'd1b', 'd2w', 'd2b'].map((n) => [n, tensor(buf, meta, n)]));
  return {
    predict(input) {
      let x = convRelu(input, 28, 28, 1, W.c1w, k1h, k1w, c1, W.c1b); // 24×24×12
      x = maxPool2(x, 24, 24, c1); // 12×12×12
      x = convRelu(x, 12, 12, c1, W.c2w, k2h, k2w, c2, W.c2b); // 10×10×24
      x = maxPool2(x, 10, 10, c2); // 5×5×24
      const hdn = dense(x, W.d1w, W.d1b, h1, true);
      const logits = dense(hdn, W.d2w, W.d2b, 10, false);
      const m = Math.max(...logits);
      let sum = 0;
      for (let i = 0; i < 10; i++) sum += logits[i] = Math.exp(logits[i] - m);
      for (let i = 0; i < 10; i++) logits[i] /= sum;
      return logits;
    },
  };
}
