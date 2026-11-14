"""Tip Detection: build the Tip Report page data for one pitcher.

  .venv-tip/Scripts/python tools/tip/py/report.py skenes [--season 2026] [--views D,V]

Reads  private/tip/<id>/models/<view>/timeline.json, features/<view>.csv, events/<view>.csv, clips
Writes www/lab/tip/data/<id>.json                      (aggregates only: safe to publish)
       www/lab/tip/data/<id>/frames/<view>_<family>_<slice>.jpg   (video frames: gitignored)

Verdict rule per view: a tell is "clear" when the best slice beats the majority
baseline by 10 points or more with permutation p < 0.01 and beats the
situation-only model by 5 points; "weak" at 5 points / p < 0.05 / 3 points;
otherwise "no tell found". Every finding is labelled game-only until a pen
confirms it.
"""
import sys, argparse, json, datetime as dt
from pathlib import Path
import numpy as np, pandas as pd
sys.path.insert(0, str(Path(__file__).parent))
import tipkit as tk

ap = argparse.ArgumentParser()
ap.add_argument('pitcher'); ap.add_argument('--season', default='2026'); ap.add_argument('--views', default='D,V')
a = ap.parse_args()
D = tk.pdir(a.pitcher)
info = tk.pitcher_info(a.pitcher)
out_dir = tk.ROOT / 'www' / 'lab' / 'tip' / 'data'
frames_dir = out_dir / a.pitcher / 'frames'
frames_dir.mkdir(parents=True, exist_ok=True)
FAMILY = {'FF': 'FF', 'SI': 'SI', 'FT': 'SI', 'ST': 'ST', 'SL': 'SL', 'CH': 'CH', 'FS': 'FS', 'FC': 'FC'}
NAMES = {'FF': 'four-seam', 'SI': 'sinker', 'ST': 'sweeper', 'SL': 'slider', 'CH': 'changeup', 'FS': 'splitter', 'FC': 'cutter'}
SLICE_TEXT = {'m2000': '2.0 s before release', 'm1500': '1.5 s before release', 'set': 'in the set', 'top_m1': 'a second before the top of the leg lift',
              'lift_start': 'as the leg starts up', 'm1000': '1.0 s before release', 'lift_top': 'at the top of the leg lift',
              'm0750': '0.75 s before release', 'break': 'at hand break', 'm0500': '0.5 s before release', 'm0250': '0.25 s before release', 'm0000': 'at release'}
WHO = {'hitter': 'the hitter', 'cf': 'the center-field camera and a runner on second'}
lab = pd.read_csv(tk.ROOT / 'private' / f'{a.pitcher}_execution_pitch_level_INTERNAL.csv', dtype={'play_id': str})
lab = lab[lab.game_date.astype(str).str.startswith(a.season)]
lab['family'] = lab.pitch_type.map(FAMILY)


def verdict(tl):
    best = None
    for s in tl['slices']:
        lift = s['acc_lr'] - s['baseline_majority']
        over_sit = s['acc_lr'] - s['acc_situation']
        p = s['perm_p'] if s['perm_p'] is not None else 1.0
        grade = 'clear' if (lift >= 0.10 and p < 0.01 and over_sit >= 0.05) else 'weak' if (lift >= 0.05 and p < 0.05 and over_sit >= 0.03) else 'none'
        if grade != 'none' and (best is None or s['t_before_release'] > best['t']):
            best = dict(grade=grade, slice=s['slice'], t=s['t_before_release'], acc=s['acc_lr'], baseline=s['baseline_majority'], situation=s['acc_situation'], p=p)
    if best is None:
        top = max(tl['slices'], key=lambda s: s['acc_lr'] - s['baseline_majority']) if tl['slices'] else None
        return dict(grade='none', **({'slice': top['slice'], 't': top['t_before_release'], 'acc': top['acc_lr'], 'baseline': top['baseline_majority'], 'situation': top['acc_situation'], 'p': top['perm_p']} if top else {}))
    return best


def tells(tl, v):
    """Plain-language tells from the earliest slice that qualifies and the strongest one."""
    out = []
    picks = [s for s in tl['slices'] if s['slice'] == v.get('slice')]
    for s in picks:
        for c, lst in s['tells_lr'].items():
            if c not in tl['classes']:
                continue
            t = lst[0]
            out.append(dict(slice=s['slice'], when=SLICE_TEXT.get(s['slice'], s['slice']), t=s['t_before_release'], family=c, family_name=NAMES.get(c, c),
                            text=f"Before a {NAMES.get(c, c)}, {t['plain']} tends to be {t['direction']} {SLICE_TEXT.get(s['slice'], '')}.",
                            feature=t['feature'], direction=t['direction'], weight=t['weight']))
    return out


def render_frames(view, delivery, families, slices=('set', 'lift_top')):
    """One representative frame per family per slice: the clip whose glove height is the
    family median at that slice. Cropped to the pitcher, no scorebug, nobody else."""
    import cv2
    feat = pd.read_csv(D / 'features' / f'{view}.csv').merge(lab[['play_id', 'family']], on='play_id')
    keep = set(pd.read_csv(D / 'models' / view / delivery / 'clips.csv', dtype={'play_id': str}).play_id)
    feat = feat[feat.play_id.isin(keep)]
    ev = {r['play_id']: r for r in tk.read_csv(D / 'events' / f'{view}.csv')}
    made = []
    for s in slices:
        for fam in families:
            d = feat[(feat.slice == s) & (feat.family == fam)]
            if d.empty:
                continue
            d = d.assign(dist=(d.glove_y - d.glove_y.median()).abs() + (d.hand_glove_dist - d.hand_glove_dist.median()).abs())
            row = d.sort_values('dist').iloc[0]
            e = ev[row.play_id]
            tsec = float(e['t_release']) - float(row.t_before_release)
            z = np.load(D / 'pose' / view / f'{row.play_id}.npz')
            i = int(np.argmin(np.abs(z['t'] - tsec))); b = z['box'][i]
            frames, _ = tk.decode_window(tk.clip_path(a.pitcher, view, row.play_id), tsec, tsec + 0.05, fps=30)
            if not len(frames) or b[0] < 0:
                continue
            img = frames[0]
            cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
            h = (b[3] - b[1]) * 1.15; w = h * 0.75
            x0, y0 = int(max(0, cx - w / 2)), int(max(0, cy - h / 2)); x1, y1 = int(min(tk.W, cx + w / 2)), int(min(tk.H, cy + h / 2))
            crop = img[y0:y1, x0:x1]
            name = f'{view}_{delivery}_{fam}_{s}.jpg'
            cv2.imwrite(str(frames_dir / name), cv2.resize(crop, (360, int(360 * crop.shape[0] / max(1, crop.shape[1])))), [cv2.IMWRITE_JPEG_QUALITY, 82])
            made.append(dict(view=view, family=fam, family_name=NAMES.get(fam, fam), slice=s, when=SLICE_TEXT.get(s, s), src=f'{a.pitcher}/frames/{name}', n=int(len(d))))
    return made


views = []
for view in [v.strip().upper() for v in a.views.split(',') if v.strip()]:
    found = sorted((D / 'models' / view).glob('*/timeline.json')) if (D / 'models' / view).exists() else []
    if not found:
        print(f'no model for view {view}, skipping'); continue
    for p in found:
        tl = json.loads(p.read_text())
        dlv = tl.get('delivery', 'all')
        v = verdict(tl)
        timeline = [dict(slice=s['slice'], when=SLICE_TEXT.get(s['slice'], s['slice']), t=s['t_before_release'], n=s['n'], acc=s['acc_lr'], acc_gbm=s['acc_gbm'],
                         baseline=s['baseline_majority'], situation=s['acc_situation'], camera=s['acc_camera'], video_plus_situation=s['acc_video_plus_situation'],
                         perm_p=s['perm_p'], recall=s['recall_lr'], pairs=s['pairs']) for s in tl['slices']]
        base = tk.VIEWS[view]['label']
        views.append(dict(key=f"{tk.VIEWS[view]['name']}_{dlv}", letter=view, view_label=base, label=base if dlv == 'all' else f'{base}, {dlv}',
                          delivery=dlv, who=tk.VIEWS[view]['who'], who_text=WHO[tk.VIEWS[view]['who']],
                          clips=tl['n_clips'], games=tl['games'], classes=tl['classes'], class_names=tl['class_names'], n_per_class=tl['n_per_class'],
                          not_enough_data={c: n for c, n in tl['not_enough_data'].items()}, min_n=tl['min_n'],
                          verdict=v, timeline=timeline, tells=tells(tl, v), frames=render_frames(view, dlv, tl['classes']) if tl['classes'] else []))
        print(f"{view} {dlv}: verdict {v.get('grade')} at {v.get('slice')} acc {v.get('acc')} vs {v.get('baseline')}; {len(views[-1]['frames'])} frames")

counts = lab.family.value_counts()
data = dict(schema='nb.tip_page/1', pitcher=dict(id=a.pitcher, name=info.get('name', a.pitcher), hand=info.get('hand', 'R')), season=a.season,
            built=dt.date.today().isoformat(), label='game-only',
            delivery_note={'stretch_only': 'All pitches from the stretch.', 'windup_only': 'All pitches from the windup.'}.get(
                info.get('delivery', 'stretch_only'), 'Windup with the bases empty, stretch with runners on. The video decides which, and each is modeled on its own.'),
            deliveries=sorted({v['delivery'] for v in views}),
            season_mix={c: int(n) for c, n in counts.items() if c}, season_pitches=int(counts.sum()),
            majority=dict(family=str(counts.idxmax()), share=round(float(counts.max() / counts.sum()), 3)),
            views=views, fix_cue='', facility=[])
(out_dir / f'{a.pitcher}.json').write_text(json.dumps(data, indent=0))
print(f"wrote {out_dir / f'{a.pitcher}.json'}")
