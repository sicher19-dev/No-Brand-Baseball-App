"""Tip Detection: pose pass. Whole-body keypoints of the pitcher, 30 fps, from a few
seconds before the delivery to just after release, for one camera view.

  .venv-tip/Scripts/python tools/tip/py/pose_clips.py skenes --view D [--season 2026]
        [--limit N] [--before 4.5] [--after 1.2] [--fps 30] [--mode balanced] [--debug N] [--shard k/n]

Reads  private/tip/<id>/coarse/<view>.csv  and the clips
Writes private/tip/<id>/pose/<view>/<play_id>.npz   (t, box, kp)   resumable
       private/tip/<id>/pose/<view>/_debug/<play_id>.jpg  for the first --debug clips
"""
import sys, argparse, time
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).parent))
import tipkit as tk

ap = argparse.ArgumentParser()
ap.add_argument('pitcher'); ap.add_argument('--view', required=True); ap.add_argument('--season', default='2026')
ap.add_argument('--limit', type=int, default=0); ap.add_argument('--before', type=float, default=4.5)
ap.add_argument('--after', type=float, default=1.2); ap.add_argument('--fps', type=int, default=30)
ap.add_argument('--mode', default='balanced'); ap.add_argument('--det-every', type=int, default=3)
ap.add_argument('--debug', type=int, default=0)
ap.add_argument('--shard', default='0/1', help='k/n: process every n-th clip starting at k, so several processes share one view')
a = ap.parse_args()

view = a.view.upper()
coarse = {r['play_id']: r for r in tk.read_csv(tk.pdir(a.pitcher) / 'coarse' / f'{view}.csv')}
out_dir = tk.pdir(a.pitcher) / 'pose' / view
out_dir.mkdir(parents=True, exist_ok=True)
todo = [pid for pid, r in coarse.items() if float(r['t_peak']) > 0 and not (out_dir / f'{pid}.npz').exists()
        and tk.clip_path(a.pitcher, view, pid).exists()]
k, n = (int(x) for x in a.shard.split('/'))
todo = [pid for pid in todo if sum(map(ord, pid)) % n == k]   # stable split, so shards never overlap between rounds
if a.limit:
    todo = todo[: a.limit]
print(f'{len(todo)} clips to do', flush=True)
if not todo:
    sys.exit(0)

runner = tk.PoseRunner(mode=a.mode, det_every=a.det_every)
print('device', runner.device, flush=True)
if a.debug:
    import cv2
    from rtmlib import draw_skeleton
    (out_dir / '_debug').mkdir(exist_ok=True)

t_start = time.time(); n_found = 0; n_frames = 0
for i, pid in enumerate(todo, 1):
    tp = float(coarse[pid]['t_peak'])
    frames, times = tk.decode_window(tk.clip_path(a.pitcher, view, pid), tp - a.before, tp + a.after, fps=a.fps)
    boxes, kps = runner.run(frames, view)
    found = boxes[:, 0] >= 0
    n_found += int(found.sum()); n_frames += len(frames)
    np.savez_compressed(out_dir / f'{pid}.npz', t=times.astype(np.float32), box=boxes, kp=kps, t_peak=np.float32(tp))
    if a.debug and i <= a.debug:
        # Three frames: start of window, one second before the peak, the peak.
        picks = [0, max(0, int((a.before - 1.0) * a.fps)), min(len(frames) - 1, int(a.before * a.fps))]
        tiles = []
        for j in picks:
            img = frames[j].copy()
            if found[j]:
                b = boxes[j].astype(int)
                cv2.rectangle(img, (b[0], b[1]), (b[2], b[3]), (0, 255, 255), 2)
                img = draw_skeleton(img, kps[j:j + 1, :, :2], kps[j:j + 1, :, 2], kpt_thr=0.3)
            cv2.putText(img, f't={times[j]:.2f}', (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
            tiles.append(cv2.resize(img, (640, 360)))
        cv2.imwrite(str(out_dir / '_debug' / f'{pid}.jpg'), np.hstack(tiles))
    if i % 10 == 0 or i == len(todo):
        el = time.time() - t_start
        print(f'{i}/{len(todo)}  {el / i:.1f} s/clip  pitcher found in {100 * n_found / max(1, n_frames):.0f}% of frames', flush=True)
