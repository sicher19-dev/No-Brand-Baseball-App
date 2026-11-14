"""Tip Detection: coarse pass. Finds when the delivery happens in each clip so the
pose pass only decodes the seconds that matter.

  .venv-tip/Scripts/python tools/tip/py/coarse.py skenes --view D [--season 2026] [--limit N] [--jobs 6]

Reads  private/tip/<id>/clips/<view>/<play_id>.mp4
Writes private/tip/<id>/coarse/<view>.csv   (resumable; one row per clip)

Method: decode the clip to 320x180 grey at 20 fps, take the mean absolute change
between frames inside the view's delivery region, smooth it over a quarter
second, and call the biggest burst the delivery. t_peak lands within about
0.3 s of release. The whole-frame change is kept to flag cuts or pans.
"""
import sys, argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).parent))
import tipkit as tk

ap = argparse.ArgumentParser()
ap.add_argument('pitcher'); ap.add_argument('--view', required=True); ap.add_argument('--season', default='2026')
ap.add_argument('--limit', type=int, default=0); ap.add_argument('--jobs', type=int, default=6)
a = ap.parse_args()

FPS = 20
view = a.view.upper()
reg = tk.VIEWS[view]['region']
out_path = tk.pdir(a.pitcher) / 'coarse' / f'{view}.csv'
done = {r['play_id']: r for r in tk.read_csv(out_path)} if out_path.exists() else {}
fields = ['play_id', 'duration', 't_peak', 'burst', 'bg_motion', 'max_frame_change', 'n_frames']

rows = [r for r in tk.clips_table(a.pitcher, a.season) if tk.clip_path(a.pitcher, view, r['play_id']).exists() and r['play_id'] not in done]
if a.limit:
    rows = rows[: a.limit]
print(f'{len(rows)} clips to do, {len(done)} already done', flush=True)


def one(r):
    pid = r['play_id']
    try:
        g = tk.decode_gray(tk.clip_path(a.pitcher, view, pid), fps=FPS).astype(np.int16)
    except Exception as e:
        return dict(play_id=pid, duration=0, t_peak=-1, burst=0, bg_motion=0, max_frame_change=0, n_frames=0)
    n, h, w = g.shape
    if n < 3:
        return dict(play_id=pid, duration=n / FPS, t_peak=-1, burst=0, bg_motion=0, max_frame_change=0, n_frames=n)
    d = np.abs(np.diff(g, axis=0))                      # (n-1, h, w)
    x0, x1, y0, y1 = int(reg[0] * w), int(reg[1] * w), int(reg[2] * h), int(reg[3] * h)
    inside = d[:, y0:y1, x0:x1].mean(axis=(1, 2))
    whole = d.mean(axis=(1, 2))
    k = max(1, FPS // 4)
    sm = np.convolve(inside, np.ones(k) / k, mode='same')
    i = int(np.argmax(sm))
    bg = float(np.median(sm))
    return dict(play_id=pid, duration=round(n / FPS, 2), t_peak=round((i + 1) / FPS, 2), burst=round(float(sm[i]), 2),
                bg_motion=round(bg, 2), max_frame_change=round(float(whole.max()), 2), n_frames=n)


res = list(done.values())
with ThreadPoolExecutor(a.jobs) as ex:
    for i, row in enumerate(ex.map(one, rows), 1):
        res.append(row)
        if i % 50 == 0 or i == len(rows):
            tk.write_csv(out_path, res, fields)
            print(f'{i}/{len(rows)}', flush=True)
tk.write_csv(out_path, res, fields)
bad = sum(1 for r in res if float(r['t_peak']) < 0)
print(f'wrote {out_path}: {len(res)} clips, {bad} unreadable')
