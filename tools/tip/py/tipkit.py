"""Tip Detection: shared helpers for the Python side of the pipeline.

Paths, clip tables, ffmpeg decoding, pitcher box selection per camera view,
and the pose models. Everything private lives under private/tip/<id>/.
"""
from __future__ import annotations
import csv, json, os, subprocess, sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')
W, H = 1280, 720

# COCO whole-body keypoint indices (133 points).
KP = dict(nose=0, l_eye=1, r_eye=2, l_ear=3, r_ear=4, l_shoulder=5, r_shoulder=6, l_elbow=7, r_elbow=8,
          l_wrist=9, r_wrist=10, l_hip=11, r_hip=12, l_knee=13, r_knee=14, l_ankle=15, r_ankle=16)
L_HAND = slice(91, 112)
R_HAND = slice(112, 133)

# Camera views by team-server letter. `region` is the part of the frame where the
# pitcher's delivery happens (fractions of width and height), used by the coarse
# motion pass and as a prior when picking the pitcher among detected people.
VIEWS = {
    'D': dict(name='hitter', label='Hitter view', region=(0.30, 0.70, 0.05, 0.95), min_h=250, who='hitter'),
    'J': dict(name='hitter_closed', label='Hitter view (closed side)', region=(0.30, 0.70, 0.05, 0.95), min_h=250, who='hitter'),
    'V': dict(name='cf_tight', label='Center field', region=(0.20, 0.80, 0.05, 1.00), min_h=250, who='cf'),
    'C': dict(name='cf', label='Center field (wide)', region=(0.38, 0.62, 0.30, 0.85), min_h=80, who='cf'),
    'F': dict(name='pitcher_front', label='First-base side', region=(0.25, 0.75, 0.0, 0.8), min_h=150, who='hitter'),
}


def pdir(pid: str) -> Path:
    return ROOT / 'private' / 'tip' / pid


def pitcher_info(pid: str) -> dict:
    p = pdir(pid) / 'pitcher.json'
    return json.loads(p.read_text()) if p.exists() else dict(id=pid, hand='R')


def read_tsv(path: Path) -> list[dict]:
    with open(path, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f, delimiter='\t'))


def read_csv(path: Path) -> list[dict]:
    with open(path, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, rows: list[dict], fields: list[str]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(rows)


def clips_table(pid: str, season: str) -> list[dict]:
    return read_tsv(pdir(pid) / f'clips-{season}-all-angles.tsv')


def clip_path(pid: str, view: str, play_id: str) -> Path:
    return pdir(pid) / 'clips' / view / f'{play_id}.mp4'


def probe_duration(path: Path) -> float:
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
                         capture_output=True, text=True).stdout.strip()
    try:
        return float(out)
    except ValueError:
        return 0.0


def decode_gray(path: Path, fps: int = 20, w: int = 320, h: int = 180) -> np.ndarray:
    """Whole clip as small grey frames, shape (n, h, w)."""
    cmd = [FFMPEG, '-v', 'error', '-i', str(path), '-vf', f'fps={fps},scale={w}:{h}', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    n = len(raw) // (w * h)
    return np.frombuffer(raw[: n * w * h], np.uint8).reshape(n, h, w)


def decode_window(path: Path, t0: float, t1: float, fps: int = 30):
    """Full-resolution BGR frames between t0 and t1, shape (n, H, W, 3), and their times."""
    t0 = max(0.0, t0)
    n = max(1, int(round((t1 - t0) * fps)))
    cmd = [FFMPEG, '-v', 'error', '-ss', f'{t0:.3f}', '-i', str(path), '-frames:v', str(n),
           '-vf', f'fps={fps},scale={W}:{H}', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    k = len(raw) // (W * H * 3)
    frames = np.frombuffer(raw[: k * W * H * 3], np.uint8).reshape(k, H, W, 3)
    times = t0 + np.arange(k) / fps
    return frames, times


def box_iou(a, b) -> float:
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1]); ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)
    area = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return float(inter / max(area, 1.0))


def pick_pitcher(boxes: np.ndarray, view: str, prev: np.ndarray | None = None) -> int:
    """Index of the pitcher among detected boxes (x0, y0, x1, y1), or -1.

    Plate cameras (hitter views): the catcher, umpire and batter stand in the
    foreground, often taller on screen than the pitcher and cut off by the bottom
    edge; the pitcher is the fully visible person whose feet sit highest in the
    frame (farthest away). Centre-field cameras: the tallest person in the
    delivery region. Continuity with the previous box is kept only while that box
    still passes the same test, so a wrong lock cannot persist."""
    if len(boxes) == 0:
        return -1
    v = VIEWS[view]
    rx0, rx1, ry0, ry1 = v['region']
    hitter = v.get('who') == 'hitter'
    if hitter:
        rx0, rx1 = min(rx0, 0.12), max(rx1, 0.88)
    cx = (boxes[:, 0] + boxes[:, 2]) / 2 / W
    cy = (boxes[:, 1] + boxes[:, 3]) / 2 / H
    hgt = boxes[:, 3] - boxes[:, 1]
    inside = (cx > rx0) & (cx < rx1) & (cy > ry0) & (cy < ry1) & (hgt >= v['min_h'])
    not_cut = (boxes[:, 0] > 4) & (boxes[:, 2] < W - 4) & (boxes[:, 3] < H - 3)
    good = inside & not_cut

    def choose(cand):
        if hitter:
            return int(cand[np.argmin(boxes[cand, 3])])      # feet highest in frame
        return int(cand[np.argmax(hgt[cand])])

    if prev is not None:
        ix0 = np.maximum(boxes[:, 0], prev[0]); iy0 = np.maximum(boxes[:, 1], prev[1])
        ix1 = np.minimum(boxes[:, 2], prev[2]); iy1 = np.minimum(boxes[:, 3], prev[3])
        inter = np.clip(ix1 - ix0, 0, None) * np.clip(iy1 - iy0, 0, None)
        area = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1]) + (prev[2] - prev[0]) * (prev[3] - prev[1]) - inter
        iou = inter / np.maximum(area, 1)
        j = int(np.argmax(iou))
        if iou[j] > 0.3 and (good[j] or not good.any()):
            return j
    cand = np.where(good)[0]
    if len(cand) == 0:
        cand = np.where(inside)[0]
    if len(cand) == 0:
        return -1
    return choose(cand)


class PoseRunner:
    """Person detector every `det_every` frames, whole-body pose on the pitcher only."""

    def __init__(self, mode: str = 'balanced', det_every: int = 3, device: str | None = None):
        import torch  # noqa: F401  (loads the CUDA runtime that onnxruntime shares)
        import onnxruntime as ort
        try:
            ort.preload_dlls()
        except Exception:
            pass
        from rtmlib import Wholebody
        if device is None:
            device = 'cuda' if 'CUDAExecutionProvider' in ort.get_available_providers() else 'cpu'
        self.device = device
        self.wb = Wholebody(mode=mode, backend='onnxruntime', device=device)
        self.det_every = det_every

    def run(self, frames: np.ndarray, view: str):
        """Returns boxes (n,4), keypoints (n,133,3) with -1 rows where the pitcher was not found."""
        n = len(frames)
        boxes = np.full((n, 4), -1.0, np.float32)
        kps = np.full((n, 133, 3), -1.0, np.float32)
        prev = None; coast = 0
        for i in range(n):
            if i % self.det_every == 0 or prev is None:
                det = self.wb.det_model(frames[i])
                det = np.asarray(det, np.float32).reshape(-1, 4) if len(det) else np.zeros((0, 4), np.float32)
                j = pick_pitcher(det, view, prev)
                box = det[j] if j >= 0 else None
                if box is not None and prev is not None:
                    # Mid-delivery the detector sometimes misses the pitcher or merges him
                    # with the catcher or umpire. A pick that is not the same person
                    # (little overlap) or not the same size is ignored for up to a second;
                    # the previous box is kept and the pose crop still holds him.
                    hr = (box[3] - box[1]) / max(1.0, prev[3] - prev[1])
                    same = box_iou(box, prev) > 0.3 and 0.6 < hr < 1.45
                    if not same and coast < 10:
                        box = prev; coast += 1
                    else:
                        coast = 0
                if box is not None:
                    prev = box
            else:
                box = prev
            if box is None:
                continue
            # Pad the box so the arms and glove stay inside the pose crop.
            bw, bh = box[2] - box[0], box[3] - box[1]
            pad = np.array([-0.25 * bw, -0.08 * bh, 0.25 * bw, 0.05 * bh], np.float32)
            pb = np.clip(box + pad, [0, 0, 0, 0], [W, H, W, H])
            k, s = self.wb.pose_model(frames[i], bboxes=[pb])
            boxes[i] = pb
            kps[i, :, :2] = k[0]
            kps[i, :, 2] = s[0]
        return boxes, kps


def log(*a):
    print(*a, file=sys.stderr, flush=True)
