"""Tip Detection: pose features at time slices before release, one camera view.

  .venv-tip/Scripts/python tools/tip/py/features.py skenes --view D

Reads  private/tip/<id>/events/<view>.csv, pose/<view>/<play_id>.npz
Writes private/tip/<id>/features/<view>.csv   (one row per clip per slice)

Slices: fixed times before release (2.0 ... 0 s) and delivery anchors (middle
of the set, start of leg lift, top of leg lift, hand break). Positions are in
body heights with the hip midpoint as origin, so camera distance and small
framing differences fall out. Box size and position are kept as separate
columns only to test that the model is not reading the camera.
"""
import sys, argparse
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).parent))
import tipkit as tk

ap = argparse.ArgumentParser()
ap.add_argument('pitcher'); ap.add_argument('--view', required=True)
a = ap.parse_args()
view = a.view.upper()
info = tk.pitcher_info(a.pitcher)
RH = info.get('hand', 'R') == 'R'
K = tk.KP
THROW, GLOVE = (K['r_wrist'], K['l_wrist']) if RH else (K['l_wrist'], K['r_wrist'])
T_ELBOW, G_ELBOW = (K['r_elbow'], K['l_elbow']) if RH else (K['l_elbow'], K['r_elbow'])
T_SH, G_SH = (K['r_shoulder'], K['l_shoulder']) if RH else (K['l_shoulder'], K['r_shoulder'])
LEAD_KNEE, BACK_KNEE = (K['l_knee'], K['r_knee']) if RH else (K['r_knee'], K['l_knee'])
LEAD_ANKLE, BACK_ANKLE = (K['l_ankle'], K['r_ankle']) if RH else (K['r_ankle'], K['l_ankle'])
T_HAND, G_HAND = (tk.R_HAND, tk.L_HAND) if RH else (tk.L_HAND, tk.R_HAND)
FIXED = [2.0, 1.5, 1.0, 0.75, 0.5, 0.25, 0.0]
CONF = 0.3


def fill(x, ok):
    x = x.copy(); idx = np.arange(len(x))
    if ok.sum() < 2:
        return x
    for c in range(x.shape[-1]):
        x[~ok, c] = np.interp(idx[~ok], idx[ok], x[ok, c])
    return x


def smooth(x, k=5):
    if len(x) < k:
        return x
    pad = np.pad(x, ((k // 2, k // 2), (0, 0)), mode='edge')
    return np.stack([np.convolve(pad[:, c], np.ones(k) / k, mode='valid') for c in range(x.shape[1])], axis=1)


def clip_features(npz, ev):
    t = npz['t'].astype(float); kp = npz['kp']; box = npz['box']
    n = len(t); found = box[:, 0] >= 0
    h = float(ev['box_h']); t_rel = float(ev['t_release'])
    conf = kp[:, :, 2]; ok = found[:, None] & (conf > CONF)
    P = np.stack([smooth(fill(kp[:, i, :2].astype(float), ok[:, i])) for i in range(17)], axis=1) / h  # (n,17,2)
    hand_t = kp[:, T_HAND, :]; hand_g = kp[:, G_HAND, :]
    hip = (P[:, K['l_hip']] + P[:, K['r_hip']]) / 2
    shm = (P[:, K['l_shoulder']] + P[:, K['r_shoulder']]) / 2
    R = P - hip[:, None, :]          # relative to hip midpoint; y grows downward in images
    slices = {f'm{int(s * 1000):04d}': t_rel - s for s in FIXED}
    if ev['t_lift_start']:
        s1 = float(ev['t_lift_start'])
        slices['set'] = s1 - 0.5            # in the set, half a second before the leg starts up
        slices['lift_start'] = s1
    if ev['t_lift_top']:
        slices['top_m1'] = float(ev['t_lift_top']) - 1.0   # one second before the top of the leg lift
        slices['lift_top'] = float(ev['t_lift_top'])
    if ev['t_break']:
        slices['break'] = float(ev['t_break'])
    rows = []
    for name, tau in slices.items():
        if tau < t[0] - 0.02 or tau > t[-1] + 0.02:
            continue
        i = int(np.argmin(np.abs(t - tau)))
        if not found[i]:
            continue
        f = dict(play_id=ev['play_id'], slice=name, t_before_release=round(t_rel - tau, 3))
        g = R[i, GLOVE]; w = R[i, THROW]
        f.update(glove_x=g[0], glove_y=-g[1], hand_x=w[0], hand_y=-w[1],
                 hand_glove_dx=w[0] - g[0], hand_glove_dy=-(w[1] - g[1]), hand_glove_dist=float(np.linalg.norm(w - g)),
                 glove_elbow_y=-R[i, G_ELBOW, 1], throw_elbow_y=-R[i, T_ELBOW, 1],
                 glove_elbow_x=R[i, G_ELBOW, 0], throw_elbow_x=R[i, T_ELBOW, 0],
                 glove_sh_y=-R[i, G_SH, 1], throw_sh_y=-R[i, T_SH, 1],
                 shoulder_tilt=-(R[i, T_SH, 1] - R[i, G_SH, 1]), shoulder_w=float(np.linalg.norm(P[i, T_SH] - P[i, G_SH])),
                 hip_w=float(np.linalg.norm(P[i, K['l_hip']] - P[i, K['r_hip']])),
                 trunk_tilt=float(np.degrees(np.arctan2(shm[i, 0] - hip[i, 0], -(shm[i, 1] - hip[i, 1])))),
                 trunk_len=float(np.linalg.norm(shm[i] - hip[i])),
                 head_x=R[i, K['nose'], 0] - (shm[i, 0] - hip[i, 0]), head_y=-(R[i, K['nose'], 1] - (shm[i, 1] - hip[i, 1])),
                 head_tilt=float(np.degrees(np.arctan2(P[i, K['r_eye'], 1] - P[i, K['l_eye'], 1], P[i, K['r_eye'], 0] - P[i, K['l_eye'], 0]))),
                 lead_knee_y=-R[i, LEAD_KNEE, 1], lead_knee_x=R[i, LEAD_KNEE, 0], back_knee_y=-R[i, BACK_KNEE, 1],
                 lead_ankle_x=R[i, LEAD_ANKLE, 0], ankle_spread=float(np.linalg.norm(P[i, LEAD_ANKLE] - P[i, BACK_ANKLE])),
                 hip_height=-(hip[i, 1] - (P[i, LEAD_ANKLE, 1] + P[i, BACK_ANKLE, 1]) / 2))
        # Throwing hand detail: where the fingers sit relative to the glove wrist, how
        # spread they are, and how visible they are (a hand buried in the glove is not).
        ht = hand_t[i]; hg = hand_g[i]
        vis_t = ht[:, 2] > CONF; vis_g = hg[:, 2] > CONF
        f.update(thand_vis=float(vis_t.mean()), ghand_vis=float(vis_g.mean()), thand_conf=float(ht[:, 2].mean()))
        if vis_t.sum() >= 5:
            pts = ht[vis_t, :2] / h
            f.update(thand_dx=float(pts[:, 0].mean() - P[i, GLOVE, 0]), thand_dy=-float(pts[:, 1].mean() - P[i, GLOVE, 1]),
                     thand_spread=float(pts.std(axis=0).mean()))
        if vis_g.sum() >= 5:
            pts = hg[vis_g, :2] / h
            f.update(ghand_dx=float(pts[:, 0].mean() - P[i, GLOVE, 0]), ghand_dy=-float(pts[:, 1].mean() - P[i, GLOVE, 1]),
                     ghand_spread=float(pts.std(axis=0).mean()))
        # Motion over the previous 0.2 s (heights per second).
        j = max(0, i - 6)
        if found[j]:
            dtj = max(t[i] - t[j], 1e-3)
            f.update(glove_speed=float(np.linalg.norm(P[i, GLOVE] - P[j, GLOVE]) / dtj),
                     hand_speed=float(np.linalg.norm(P[i, THROW] - P[j, THROW]) / dtj),
                     knee_speed=float(np.linalg.norm(P[i, LEAD_KNEE] - P[j, LEAD_KNEE]) / dtj))
        # Timing of the delivery.
        if ev['t_lift_start']:
            f['lift_to_release'] = round(t_rel - float(ev['t_lift_start']), 3)
        if ev['t_lift_top']:
            f['top_to_release'] = round(t_rel - float(ev['t_lift_top']), 3)
        if ev['t_break']:
            f['break_to_release'] = round(t_rel - float(ev['t_break']), 3)
        if ev['set_dur'] and not int(ev['set_censored'] or 0):
            f['set_dur'] = float(ev['set_dur'])
        # Camera checks (not pose): kept apart so the model can be run with and without them.
        b = box[i]
        f.update(cam_box_h=float(b[3] - b[1]), cam_box_cx=float((b[0] + b[2]) / 2 / tk.W), cam_box_cy=float((b[1] + b[3]) / 2 / tk.H))
        rows.append({k: (round(v, 4) if isinstance(v, float) else v) for k, v in f.items()})
    return rows


events = tk.read_csv(tk.pdir(a.pitcher) / 'events' / f'{view}.csv')
pose_dir = tk.pdir(a.pitcher) / 'pose' / view
rows = []; skipped = 0
for i, ev in enumerate(events, 1):
    if not ev['t_release'] or 'not_found' in ev['flag'] or 'no_prerelease' in ev['flag'] or 'release_at_window_end' in ev['flag'] or 'release_unsure' in ev['flag'] or 'small_pitcher' in ev['flag'] or 'odd_track' in ev['flag'] or 'scale_jump' in ev['flag']:
        skipped += 1; continue
    rows.extend(clip_features(np.load(pose_dir / f"{ev['play_id']}.npz"), ev))
    if i % 200 == 0:
        print(f'{i}/{len(events)}', flush=True)
fields = []
for r in rows:
    for k in r:
        if k not in fields:
            fields.append(k)
out = tk.pdir(a.pitcher) / 'features' / f'{view}.csv'
tk.write_csv(out, rows, fields)
print(f'wrote {out}: {len(rows)} rows from {len(events) - skipped} clips ({skipped} skipped), {len(fields) - 3} features')
