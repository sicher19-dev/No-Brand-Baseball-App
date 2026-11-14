"""Tip Detection: delivery events from the pose tracks of one camera view.

  .venv-tip/Scripts/python tools/tip/py/events.py skenes --view D [--debug <play_id>]

Reads  private/tip/<id>/pose/<view>/<play_id>.npz
Writes private/tip/<id>/events/<view>.csv

Times are seconds from the start of the clip. Distances and speeds are in body
heights (median pitcher box height before the delivery) so camera distance does not matter.

  t_release    peak speed of the throwing wrist on a trustworthy track, preceded by a leg lift
               ('release_unsure' when no peak passes and the coarse peak had to decide)
  t_lift_top   lead knee at its highest before release
  t_lift_start lead knee starts rising (end of the set)
  t_set_start  start of the still stretch that ends at t_lift_start (hands and
               knees quiet); 'censored' when the window began mid-set
  t_break      hands separate (glove to throwing wrist beyond the set distance)
  pre_sw/hw    shoulder and hip width on screen just before the lift (windup reads wide,
               stretch narrow from the plate and centre-field cameras)
"""
import sys, argparse
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).parent))
import tipkit as tk

ap = argparse.ArgumentParser()
ap.add_argument('pitcher'); ap.add_argument('--view', required=True); ap.add_argument('--debug', default=None)
a = ap.parse_args()
view = a.view.upper()
info = tk.pitcher_info(a.pitcher)
RH = info.get('hand', 'R') == 'R'
THROW = tk.KP['r_wrist'] if RH else tk.KP['l_wrist']
GLOVE = tk.KP['l_wrist'] if RH else tk.KP['r_wrist']
LEAD_KNEE = tk.KP['l_knee'] if RH else tk.KP['r_knee']
CONF = 0.3


def fill(x, ok):
    """Linear interpolation over frames where the point is missing."""
    x = x.copy()
    idx = np.arange(len(x))
    if ok.sum() < 2:
        return x
    for c in range(x.shape[1]):
        x[~ok, c] = np.interp(idx[~ok], idx[ok], x[ok, c])
    return x


def smooth(x, k=3):
    if len(x) < k:
        return x
    pad = np.pad(x, ((k // 2, k // 2), (0, 0)) if x.ndim == 2 else (k // 2, k // 2), mode='edge')
    ker = np.ones(k) / k
    if x.ndim == 1:
        return np.convolve(pad, ker, mode='valid')
    return np.stack([np.convolve(pad[:, c], ker, mode='valid') for c in range(x.shape[1])], axis=1)


def speed(p, dt):
    v = np.zeros(len(p))
    v[1:] = np.linalg.norm(np.diff(p, axis=0), axis=1) / dt
    return v


def dspeed(p, dt, k=6):
    """Speed from displacement over k frames: jitter averages out, real motion does not."""
    v = np.zeros(len(p))
    if len(p) > k:
        v[k:] = np.linalg.norm(p[k:] - p[:-k], axis=1) / (k * dt)
        v[:k] = v[k]
    return v


def analyse(npz):
    t = npz['t'].astype(float); kp = npz['kp']; box = npz['box']; tp = float(npz['t_peak'])
    n = len(t); dt = float(np.median(np.diff(t))) if n > 1 else 1 / 30
    found = box[:, 0] >= 0
    out = dict(n=n, found=round(float(found.mean()), 3))
    if found.sum() < 10:
        out['flag'] = 'pitcher_not_found'; return out
    conf = kp[:, :, 2]
    ok = found[:, None] & (conf > CONF)
    sh = (kp[:, tk.KP['l_shoulder'], :2] + kp[:, tk.KP['r_shoulder'], :2]) / 2
    swv = np.linalg.norm(kp[:, tk.KP['l_shoulder'], :2] - kp[:, tk.KP['r_shoulder'], :2], axis=1)
    good_sw = ok[:, tk.KP['l_shoulder']] & ok[:, tk.KP['r_shoulder']]
    sw = float(np.median(swv[good_sw])) if good_sw.sum() else float(np.median((box[found, 3] - box[found, 1]) / 6))
    out['sw_px'] = round(sw, 1)
    # Scale = standing height in pixels (median box height before the coarse peak).
    # Shoulder width changes as the torso turns, height does not.
    early = found & (t < tp - 0.8)
    hpx = float(np.median((box[early, 3] - box[early, 1]) if early.sum() >= 5 else (box[found, 3] - box[found, 1])))
    out['box_h'] = round(hpx, 1)

    def track(i):
        return smooth(fill(kp[:, i, :2].astype(float), ok[:, i]), 5) / hpx

    thr = track(THROW); glv = track(GLOVE); knee = track(LEAD_KNEE); okn = track(tk.KP['r_knee' if RH else 'l_knee'])
    v_thr = speed(thr, dt); v_glv = speed(glv, dt); v_knee = speed(knee, dt)

    # Release: fastest throwing wrist, but only on frames where the track is trustworthy
    # (body confidence, wrist confidence, no box jump) and only at a peak that a leg lift
    # precedes. The coarse peak can land a couple of seconds late when the catcher or
    # batter moves in the foreground after the pitch, and pose glitches while the
    # pitcher is occluded produce wrist "speeds" far above a real throw.
    body_conf = conf[:, :17].mean(axis=1)
    cxy = np.stack([(box[:, 0] + box[:, 2]) / 2, (box[:, 1] + box[:, 3]) / 2], 1) / hpx
    jump = np.zeros(n); jump[1:] = np.linalg.norm(np.diff(cxy, axis=0), axis=1)
    bad = ~(found & (body_conf >= 0.55) & (conf[:, THROW] >= 0.5) & (jump < 0.15))
    for s_ in (1, 2):
        bad[s_:] |= bad[:-s_].copy(); bad[:-s_] |= bad[s_:].copy()
    vg = np.where(bad, 0.0, v_thr)
    if vg.max() <= 0:
        vg = v_thr.copy()
    cands = []
    tmp = vg.copy()
    for _ in range(5):
        c = int(np.argmax(tmp))
        if tmp[c] < 0.5 * vg.max() or tmp[c] <= 0:
            break
        cands.append(c)
        tmp[(t >= t[c] - 0.5) & (t <= t[c] + 0.5)] = 0

    def lift_before(c):
        pre_ = (t >= t[c] - 1.8) & (t < t[c] - 0.25)
        if pre_.sum() < 3:
            return -1.0
        i_ = int(np.argmin(np.where(pre_, knee[:, 1], np.inf)))
        return float(okn[i_, 1] - knee[i_, 1])

    ir = None
    for c in sorted(cands):
        if lift_before(c) >= 0.10:
            ir = c; break
    if ir is None:
        win = (t >= tp - 1.2) & (t <= tp + 0.7)
        near = [c for c in cands if win[c]]
        ir = near[0] if near else (cands[0] if cands else int(np.argmax(vg)))
        out['flag'] = 'release_unsure'
    t_rel = t[ir]
    out.update(t_release=round(float(t_rel), 3), v_release=round(float(v_thr[ir]), 2))
    if ir >= n - 2:
        out['flag'] = (out.get('flag', '') + ' release_at_window_end').strip()

    # Leg lift top: lead knee highest (smallest y) in the 1.8 s before release.
    pre = (t >= t_rel - 1.8) & (t < t_rel - 0.25)
    if pre.sum() < 3:
        out['flag'] = (out.get('flag', '') + ' no_prerelease').strip(); return out
    il = int(np.argmin(np.where(pre, knee[:, 1], np.inf)))
    out['t_lift_top'] = round(float(t[il]), 3)
    out['lift_height'] = round(float(okn[il, 1] - knee[il, 1]), 2)  # lead knee above the other knee, in body heights

    # Leg lift start: walk back from the top while the knee keeps rising
    # (vertical speed in heights per second; negative = rising), then to stillness.
    vy = np.zeros(n); vy[1:] = np.diff(knee[:, 1]) / dt
    vy = smooth(vy, 5)
    j = il
    while j > 0 and vy[j - 1] < -0.05:
        j -= 1
    while j > 0 and abs(vy[j - 1]) > 0.03:
        j -= 1
    t_lift = t[j]
    out['t_lift_start'] = round(float(t_lift), 3)

    # Set: the stretch before the lift with the hands together and the feet still.
    # Hands may wiggle in the set (a glove tap is 0.3-0.5 heights/s), so the hand
    # speed limit is loose; the hands-together test (distance close to the pre-lift
    # distance) and the quiet lead knee do the work. Keypoint jitter is about 0.1.
    d_all = np.linalg.norm(thr - glv, axis=1)
    d_ref = float(np.median(d_all[max(0, j - 6):j + 1]))
    quiet = (dspeed(thr, dt) < 0.6) & (dspeed(glv, dt) < 0.6) & (dspeed(knee, dt) < 0.15) & (np.abs(d_all - d_ref) < 0.06)
    k = j
    slack = 0
    while k > 0:
        if quiet[k - 1]:
            k -= 1; slack = 0
        elif slack < 4:          # allow a four-frame blip
            k -= 1; slack += 1
        else:
            k += slack; break
    out['t_set_start'] = round(float(t[k]), 3)
    out['set_censored'] = int(k == 0)
    out['set_dur'] = round(float(t_lift - t[k]), 3)

    # Delivery cue: how square the shoulders and hips are to the camera just before
    # the lift. From the plate and centre-field cameras a windup (facing home) reads
    # wide, a stretch (facing the base line) reads narrow. Train.py splits on it.
    shw = smooth(fill(swv[:, None].astype(float), good_sw), 5)[:, 0] / hpx
    hpw = smooth(fill(np.linalg.norm(kp[:, tk.KP['l_hip'], :2] - kp[:, tk.KP['r_hip'], :2], axis=1)[:, None].astype(float),
                      ok[:, tk.KP['l_hip']] & ok[:, tk.KP['r_hip']]), 5)[:, 0] / hpx
    # 1.5 to 0.8 s before the lift: a windup is still square to the plate there, a
    # stretch is already side-on. Closer to the lift the windup has turned too.
    prew = (t >= t_lift - 1.5) & (t <= t_lift - 0.8)
    if prew.sum() >= 3:
        out.update(pre_sw=round(float(np.median(shw[prew])), 4), pre_hw=round(float(np.median(hpw[prew])), 4))

    # Hand break: glove-to-hand distance grows past the set distance.
    d = np.linalg.norm(thr - glv, axis=1)
    set_d = float(np.median(d[k:j + 1])) if j > k else float(d[j])
    thresh = set_d + 0.08
    ib = next((i for i in range(j, ir - 1) if d[i] > thresh and d[i + 1] > thresh), ir)
    out.update(t_break=round(float(t[ib]), 3), set_hand_dist=round(set_d, 2))

    # Quality.
    out['conf_mean'] = round(float(conf[found][:, :17].mean()), 3)
    flags = out.get('flag', '')
    if out['found'] < 0.9: flags += ' partial_track'
    if t_rel - t_lift < 0.4 or t_rel - t_lift > 2.5: flags += ' odd_tempo'
    if out['lift_height'] < 0.12: flags += ' low_lift'
    if out['box_h'] < 400: flags += ' small_pitcher'
    out['flag'] = flags.strip()
    return out


pose_dir = tk.pdir(a.pitcher) / 'pose' / view
rows = []
files = sorted(pose_dir.glob('*.npz'))
if a.debug:
    files = [pose_dir / f'{a.debug}.npz']
for i, f in enumerate(files, 1):
    r = analyse(np.load(f))
    r = dict(play_id=f.stem, **r)
    rows.append(r)
    if a.debug:
        print(r)
    elif i % 200 == 0:
        print(f'{i}/{len(files)}', flush=True)
if not a.debug:
    fields = ['play_id', 'n', 'found', 'sw_px', 'box_h', 't_release', 'v_release', 't_lift_top', 'lift_height', 't_lift_start',
              't_set_start', 'set_censored', 'set_dur', 't_break', 'set_hand_dist', 'pre_sw', 'pre_hw', 'conf_mean', 'flag']
    for r in rows:
        for k in fields:
            r.setdefault(k, '')
    out = tk.pdir(a.pitcher) / 'events' / f'{view}.csv'
    tk.write_csv(out, rows, fields)
    flagged = sum(1 for r in rows if r['flag'])
    print(f'wrote {out}: {len(rows)} clips, {flagged} flagged')
