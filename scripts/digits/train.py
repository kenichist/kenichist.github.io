"""
Train the in-browser digit classifier (small CNN) and export it for the site.

    python3 scripts/digits/train.py --data mnist.npz --out .

Data: MNIST (Yann LeCun, Corinna Cortes, Chris Burges; CC BY-SA 3.0), e.g. from
https://storage.googleapis.com/tensorflow/tf-keras-datasets/mnist.npz
Deps: numpy, scipy, scikit-image, jax (CPU is fine; ~5 min).

Writes
  public/models/digits-cnn.bin           int8 weights (per-output-channel scales) + float32 biases
  src/data/digits-model.json             architecture, tensor offsets, measured accuracy
  tests/fixtures/digits-vectors.json     inputs + expected probabilities for the JS parity test

Robustness to mouse / finger drawings
  Browser drawings are constant-width strokes; MNIST pen strokes vary. Half of the
  training images are "re-stroked": skeletonised and redrawn at a random constant
  width, matching what the site renders. All images pass through the same
  normalisation the browser applies (crop → fit 20×20 → centre of mass at 14,14),
  plus random rotation, shear, aspect, and thickness changes.
"""
import argparse
import json
import os
import time

import jax
import jax.numpy as jnp
import numpy as np
from scipy import ndimage
from skimage.morphology import disk, skeletonize

ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True)
ap.add_argument('--out', default='.')
ap.add_argument('--epochs', type=int, default=12)
ap.add_argument('--seed', type=int, default=7)
a = ap.parse_args()
rng = np.random.default_rng(a.seed)

d = np.load(a.data)
xtr, ytr = d['x_train'].astype(np.float32) / 255, d['y_train'].astype(np.int32)
xte, yte = d['x_test'].astype(np.float32) / 255, d['y_test'].astype(np.int32)

# ---------------------------------------------------------------- preprocessing
def normalize(img: np.ndarray) -> np.ndarray:
    """MNIST-style: crop to ink, fit the longer side to 20px, centre of mass at (14, 14)."""
    ys, xs = np.nonzero(img > 0.08)
    if len(ys) == 0:
        return np.zeros((28, 28), np.float32)
    crop = img[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = crop.shape
    s = 20.0 / max(h, w)
    nh, nw = max(1, round(h * s)), max(1, round(w * s))
    crop = ndimage.zoom(crop, (nh / h, nw / w), order=1, prefilter=False)[:nh, :nw]
    out = np.zeros((28, 28), np.float32)
    y0, x0 = (28 - crop.shape[0]) // 2, (28 - crop.shape[1]) // 2
    out[y0:y0 + crop.shape[0], x0:x0 + crop.shape[1]] = crop
    cy, cx = ndimage.center_of_mass(out)
    out = ndimage.shift(out, (14 - cy, 14 - cx), order=1, mode='constant')
    return np.clip(out, 0, 1).astype(np.float32)


def restroke(img: np.ndarray, width: float) -> np.ndarray:
    """Skeletonise and redraw with a constant-width round pen, like the browser pad."""
    up = ndimage.zoom(img, 4, order=1)
    sk = skeletonize(up > 0.35)
    r = max(1, int(round(width * 4 / 2)))
    thick = ndimage.binary_dilation(sk, structure=disk(r)).astype(np.float32)
    thick = ndimage.gaussian_filter(thick, 1.6)
    small = thick.reshape(28, 4, 28, 4).mean(axis=(1, 3))
    return normalize(np.clip(small * 1.15, 0, 1))


def augment(img: np.ndarray) -> np.ndarray:
    """Random rotation / shear / aspect / thickness, then renormalise."""
    ang = np.deg2rad(rng.uniform(-14, 14))
    sh = rng.uniform(-0.25, 0.25)
    ax, ay = rng.uniform(0.8, 1.2), rng.uniform(0.8, 1.2)
    rot = np.array([[np.cos(ang), -np.sin(ang)], [np.sin(ang), np.cos(ang)]])
    m = rot @ np.array([[1, sh], [0, 1]]) @ np.diag([ay, ax])
    inv = np.linalg.inv(m)
    c = np.array([14, 14])
    out = ndimage.affine_transform(img, inv, offset=c - inv @ c, order=1, mode='constant')
    t = rng.random()
    if t < 0.2:
        out = ndimage.grey_dilation(out, size=(2, 2))
    elif t < 0.35:
        out = ndimage.grey_erosion(out, size=(2, 2)) * 1.3
    return normalize(np.clip(out, 0, 1))


t0 = time.time()
print('re-stroking MNIST (one-time)…', flush=True)
wtr = rng.uniform(1.6, 3.2, len(xtr))
xtr_rs = np.stack([restroke(x, w) for x, w in zip(xtr, wtr)])
wte = np.random.default_rng(99).uniform(1.6, 3.2, len(xte))
xte_rs = np.stack([restroke(x, w) for x, w in zip(xte, wte)])
xte_n = np.stack([normalize(x) for x in xte])
print(f'  done in {time.time() - t0:.0f}s', flush=True)

# ---------------------------------------------------------------- model
C1, C2, H = 12, 24, 48


def init(key):
    k = jax.random.split(key, 4)
    he = lambda kk, shape, fan: jax.random.normal(kk, shape) * np.sqrt(2 / fan)
    return {
        'c1w': he(k[0], (5, 5, 1, C1), 25), 'c1b': jnp.zeros(C1),
        'c2w': he(k[1], (3, 3, C1, C2), 9 * C1), 'c2b': jnp.zeros(C2),
        'd1w': he(k[2], (5 * 5 * C2, H), 5 * 5 * C2), 'd1b': jnp.zeros(H),
        'd2w': he(k[3], (H, 10), H) * 0.5, 'd2b': jnp.zeros(10),
    }


def conv(x, w, b):
    y = jax.lax.conv_general_dilated(x, w, (1, 1), 'VALID', dimension_numbers=('NHWC', 'HWIO', 'NHWC'))
    return y + b


def pool(x):
    return jax.lax.reduce_window(x, -jnp.inf, jax.lax.max, (1, 2, 2, 1), (1, 2, 2, 1), 'VALID')


def forward(p, x, train=False, key=None):
    x = x[..., None]
    x = pool(jax.nn.relu(conv(x, p['c1w'], p['c1b'])))  # 24 → 12
    x = pool(jax.nn.relu(conv(x, p['c2w'], p['c2b'])))  # 10 → 5
    x = x.reshape(x.shape[0], -1)
    x = jax.nn.relu(x @ p['d1w'] + p['d1b'])
    if train:
        x = x * jax.random.bernoulli(key, 0.75, x.shape) / 0.75
    return x @ p['d2w'] + p['d2b']


def loss(p, x, y, key):
    logits = forward(p, x, True, key)
    return -jnp.mean(jnp.sum(jax.nn.log_softmax(logits) * jax.nn.one_hot(y, 10) * 0.95 + 0.005 * jax.nn.log_softmax(logits), -1))


@jax.jit
def step(p, m, v, x, y, key, lr, t):
    g = jax.grad(loss)(p, x, y, key)
    m = jax.tree_util.tree_map(lambda a, b: 0.9 * a + 0.1 * b, m, g)
    v = jax.tree_util.tree_map(lambda a, b: 0.999 * a + 0.001 * b * b, v, g)
    mh = jax.tree_util.tree_map(lambda a: a / (1 - 0.9 ** t), m)
    vh = jax.tree_util.tree_map(lambda a: a / (1 - 0.999 ** t), v)
    p = jax.tree_util.tree_map(lambda a, b, c: a - lr * b / (jnp.sqrt(c) + 1e-8), p, mh, vh)
    return p, m, v


predict = jax.jit(lambda p, x: jax.nn.softmax(forward(p, x)))


def accuracy(p, x, y):
    probs = np.concatenate([np.asarray(predict(p, x[i:i + 1000])) for i in range(0, len(x), 1000)])
    return float((probs.argmax(1) == y).mean()), probs


key = jax.random.PRNGKey(a.seed)
params = init(key)
m = jax.tree_util.tree_map(jnp.zeros_like, params)
v = jax.tree_util.tree_map(jnp.zeros_like, params)
B = 128
t = 0
steps_per_epoch = len(xtr) // B
for epoch in range(a.epochs):
    order = rng.permutation(len(xtr))
    lr = 2e-3 * 0.5 * (1 + np.cos(np.pi * epoch / a.epochs))
    t_ep = time.time()
    for s in range(steps_per_epoch):
        idx = order[s * B:(s + 1) * B]
        use_rs = rng.random(B) < 0.5
        base = np.where(use_rs[:, None, None], xtr_rs[idx], xtr[idx])
        xb = np.stack([augment(im) if rng.random() < 0.7 else normalize(im) for im in base])
        t += 1
        key, sub = jax.random.split(key)
        params, m, v = step(params, m, v, jnp.asarray(xb), jnp.asarray(ytr[idx]), sub, lr, t)
    acc_n, _ = accuracy(params, xte_n, yte)
    acc_rs, _ = accuracy(params, xte_rs, yte)
    print(f'epoch {epoch + 1}/{a.epochs}  test {acc_n:.4f}  re-stroked {acc_rs:.4f}  ({time.time() - t_ep:.0f}s)', flush=True)

# ---------------------------------------------------------------- quantise + export
ORDER = ['c1w', 'c1b', 'c2w', 'c2b', 'd1w', 'd1b', 'd2w', 'd2b']


def quantise(w):
    """Symmetric int8 per output channel (last axis)."""
    w = np.asarray(w, np.float32)
    flat = w.reshape(-1, w.shape[-1])
    scale = np.maximum(np.abs(flat).max(0), 1e-8) / 127
    q = np.clip(np.round(flat / scale), -127, 127).astype(np.int8)
    return q.reshape(w.shape), scale.astype(np.float32)


qparams, tensors, blob, offset = {}, [], bytearray(), 0
for name in ORDER:
    arr = np.asarray(params[name], np.float32)
    if name.endswith('w'):
        q, scale = quantise(arr)
        qparams[name] = jnp.asarray(q.astype(np.float32) * scale)
        for part, data in ((name, q.tobytes()), (name + '.scale', scale.tobytes())):
            while offset % 4:
                blob.append(0)
                offset += 1
            tensors.append({'name': part, 'dtype': 'int8' if part == name else 'float32',
                            'shape': list(q.shape) if part == name else [len(scale)], 'offset': offset, 'bytes': len(data)})
            blob += data
            offset += len(data)
    else:
        qparams[name] = jnp.asarray(arr)
        while offset % 4:
            blob.append(0)
            offset += 1
        data = arr.tobytes()
        tensors.append({'name': name, 'dtype': 'float32', 'shape': list(arr.shape), 'offset': offset, 'bytes': len(data)})
        blob += data
        offset += len(data)

acc_f, _ = accuracy(params, xte_n, yte)
acc_q, probs_q = accuracy(qparams, xte_n, yte)
acc_rs_q, probs_rs_q = accuracy(qparams, xte_rs, yte)
conf = np.zeros((10, 10), int)
for tr, pr in zip(yte, probs_rs_q.argmax(1)):
    conf[tr, pr] += 1
n_params = int(sum(np.asarray(params[k]).size for k in ORDER))
meta = {
    'arch': {'conv1': [5, 5, 1, C1], 'conv2': [3, 3, C1, C2], 'dense1': [5 * 5 * C2, H], 'dense2': [H, 10],
             'input': [28, 28], 'layout': 'NHWC, HWIO'},
    'params': n_params,
    'bytes': len(blob),
    'tensors': tensors,
    'metrics': {
        'mnist_test_float': round(acc_f, 4),
        'mnist_test_int8': round(acc_q, 4),
        'restroked_test_int8': round(acc_rs_q, 4),
        'restroked_confusion': conf.tolist(),
        'note': 'restroked = MNIST test digits skeletonised and redrawn at a constant 1.6–3.2px width (synthetic stand-in for mouse drawings)',
    },
    'trained': time.strftime('%Y-%m-%d'),
}
print(json.dumps({k: meta['metrics'][k] for k in ('mnist_test_float', 'mnist_test_int8', 'restroked_test_int8')}), 'params', n_params, 'bytes', len(blob))

os.makedirs(os.path.join(a.out, 'public/models'), exist_ok=True)
os.makedirs(os.path.join(a.out, 'src/data'), exist_ok=True)
os.makedirs(os.path.join(a.out, 'tests/fixtures'), exist_ok=True)
open(os.path.join(a.out, 'public/models/digits-cnn.bin'), 'wb').write(bytes(blob))
json.dump(meta, open(os.path.join(a.out, 'src/data/digits-model.json'), 'w'), indent=1)

# parity vectors for the JS implementation
vec = []
for i in range(8):
    for x in (xte_n[i], xte_rs[i]):
        xr = np.round(x, 4).astype(np.float32)
        pr = np.asarray(predict(qparams, jnp.asarray(xr[None])))[0]
        vec.append({'label': int(yte[i]), 'input': [float(v) for v in xr.ravel()], 'probs': [round(float(v), 6) for v in pr]})
json.dump(vec, open(os.path.join(a.out, 'tests/fixtures/digits-vectors.json'), 'w'))
# a few real test digits for the idle demo (normalised, 0..255 ints)
import base64
demo = [{'label': int(yte[i]), 'b64': base64.b64encode((xte_n[i] * 255).round().astype(np.uint8).tobytes()).decode()} for i in range(100, 130)]
json.dump(demo, open(os.path.join(a.out, 'public/models/digits-samples.json'), 'w'), separators=(',', ':'))
print('exported')
