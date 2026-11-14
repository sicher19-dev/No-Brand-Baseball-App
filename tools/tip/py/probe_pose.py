"""Tip Detection: one-off probe. Runs whole-body pose on a few frames of a clip,
draws the result, and reports speed. Not part of the pipeline.

  .venv-tip/Scripts/python tools/tip/py/probe_pose.py <clip.mp4> <t_seconds> <out.jpg>
"""
import sys, time, subprocess
import numpy as np
import cv2

clip, t, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
W, H = 1280, 720

def frames_at(path, t0, n, fps=60):
    cmd = ['ffmpeg', '-v', 'error', '-ss', f'{t0:.3f}', '-i', path, '-frames:v', str(n),
           '-vf', f'fps={fps},scale={W}:{H}', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)

import torch  # loads CUDA DLLs that onnxruntime also needs
import onnxruntime as ort
print('onnxruntime providers:', ort.get_available_providers())
from rtmlib import Wholebody, draw_skeleton

frames = frames_at(clip, t, 30)
print('frames', frames.shape)
dev = 'cuda' if 'CUDAExecutionProvider' in ort.get_available_providers() else 'cpu'
model = Wholebody(mode='performance', backend='onnxruntime', device=dev)
kps, scores = model(frames[0])  # warm up
t0 = time.time()
for f in frames:
    kps, scores = model(f)
dt = (time.time() - t0) / len(frames)
print(f'device {dev}: {dt*1000:.1f} ms per frame, {len(kps)} people in last frame')
img = frames[0].copy()
kps, scores = model(img)
for i, (k, s) in enumerate(zip(kps, scores)):
    x0, y0 = k[:, 0].min(), k[:, 1].min(); x1, y1 = k[:, 0].max(), k[:, 1].max()
    print(f'person {i}: box ({x0:.0f},{y0:.0f})-({x1:.0f},{y1:.0f}) h={y1-y0:.0f} mean conf {s.mean():.2f}')
    cv2.rectangle(img, (int(x0), int(y0)), (int(x1), int(y1)), (0, 255, 255), 2)
    cv2.putText(img, str(i), (int(x0), int(y0) - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
img = draw_skeleton(img, kps, scores, kpt_thr=0.3)
cv2.imwrite(out, img)
print('wrote', out)
