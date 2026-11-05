"""
Person mask for scripts/video-to-ascii.ts --mask.

    python3 scripts/person-mask.py <video> <out-mask.mkv> --model selfie_multiclass_256x256.tflite

Writes a lossless greyscale video (white = person) with the same size and frame
timing as the input, so the converter can crop and scale it identically.

Model: MediaPipe "selfie multiclass" (Apache-2.0), downloaded separately from
https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite
Python deps: numpy, pillow, scipy, ai-edge-litert. Needs ffmpeg/ffprobe on PATH.
"""
import argparse
import json
import subprocess

import numpy as np
from ai_edge_litert.interpreter import Interpreter
from PIL import Image
from scipy import ndimage

ap = argparse.ArgumentParser()
ap.add_argument('video')
ap.add_argument('out')
ap.add_argument('--model', required=True)
ap.add_argument('--smooth', type=float, default=0.5, help='temporal smoothing 0..1 (higher = steadier, laggier)')
ap.add_argument('--keep', type=float, default=0.15, help='drop blobs smaller than this fraction of the largest')
a = ap.parse_args()

meta = json.loads(subprocess.run(
    ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'json', a.video],
    check=True, capture_output=True, text=True).stdout)['streams'][0]
W, H, rate = meta['width'], meta['height'], meta['r_frame_rate']

it = Interpreter(a.model)
it.allocate_tensors()
inp, out = it.get_input_details()[0], it.get_output_details()[0]
N = int(inp['shape'][1])


def segment(rgb: np.ndarray) -> np.ndarray:
    """Person probability for one square tile."""
    x = np.asarray(Image.fromarray(rgb).resize((N, N), Image.BILINEAR), np.float32) / 127.5 - 1
    it.set_tensor(inp['index'], x[None])
    it.invoke()
    y = it.get_tensor(out['index'])[0]
    if abs(float(y.sum(-1).mean()) - 1) > 0.05:  # logits → softmax
        y = np.exp(y - y.max(-1, keepdims=True))
        y /= y.sum(-1, keepdims=True)
    p = 1 - y[..., 0]  # everything that isn't background
    s = rgb.shape[0]
    return np.asarray(Image.fromarray((p * 255).astype(np.uint8)).resize((s, s), Image.BILINEAR), np.float32) / 255


def person(rgb: np.ndarray) -> np.ndarray:
    """Overlapping square tiles across a wide frame; the max wins where they overlap."""
    h, w, _ = rgb.shape
    side = min(h, w)
    acc = np.zeros((h, w), np.float32)
    starts = sorted({0, (w - side) // 2, w - side}) if w >= h else sorted({0, (h - side) // 2, h - side})
    for s0 in starts:
        if w >= h:
            acc[:, s0:s0 + side] = np.maximum(acc[:, s0:s0 + side], segment(rgb[:, s0:s0 + side]))
        else:
            acc[s0:s0 + side, :] = np.maximum(acc[s0:s0 + side, :], segment(rgb[s0:s0 + side, :]))
    return acc


dec = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', a.video, '-an', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', f'{W}x{H}', '-r', rate, '-i', '-',
                        '-c:v', 'ffv1', a.out], stdin=subprocess.PIPE)
prev = None
frames = 0
while True:
    buf = dec.stdout.read(W * H * 3)
    if len(buf) < W * H * 3:
        break
    p = person(np.frombuffer(buf, np.uint8).reshape(H, W, 3))
    prev = p if prev is None else a.smooth * prev + (1 - a.smooth) * p
    m = prev > 0.5
    # keep the main figure(s); drop small false positives such as distant flags
    lab, n = ndimage.label(m)
    if n > 1:
        sizes = ndimage.sum(m, lab, range(1, n + 1))
        m = np.isin(lab, 1 + np.flatnonzero(sizes >= sizes.max() * a.keep))
    soft = ndimage.gaussian_filter(m.astype(np.float32), 1.2)
    enc.stdin.write((np.clip(soft, 0, 1) * 255).astype(np.uint8).tobytes())
    frames += 1
enc.stdin.close()
enc.wait()
dec.wait()
print(f'{a.out}: {frames} frames, {W}x{H}')
