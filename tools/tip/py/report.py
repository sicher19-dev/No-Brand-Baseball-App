"""Tip Detection: build the Tip Report page data for one pitcher.

  .venv-tip/Scripts/python tools/tip/py/report.py skenes [--season 2026] [--views D,V] [--per-game 10] [--no-clips]

Reads  private/tip/<id>/models/<view>/<delivery>/{timeline.json,clips.csv,pitches.csv}, features, events, pose, clips
Writes www/lab/tip/data/<id>.json                       dashboard (aggregates only: safe to publish)
       www/lab/tip/data/<id>/games/<date>.json          one game: flagged pitches, comparison pitches, fix
       www/lab/tip/data/<id>/frames/*.jpg               side-by-side stills            (gitignored)
       www/lab/tip/data/<id>/clips/*.mp4, *.jpg         cropped pitcher-only clips     (gitignored)

Verdict rule per view and delivery: a tell is "clear" when the best slice beats
the majority baseline by 10 points or more with permutation p < 0.01 and beats
the situation-only model by 5 points; "weak" at 5 points / p < 0.05 / 3 points;
otherwise "no tell found". Every finding is labelled game-only until a pen
confirms it.

A pitch is flagged on a game page when, at least half a second before release,
the held-out video model named its type with 60% confidence or more and beat
what the situation alone said by 15 points. Only views and deliveries with a
verdict of weak or clear flag pitches.
"""
import sys, argparse, json, subprocess, datetime as dt
from pathlib import Path
import numpy as np, pandas as pd
sys.path.insert(0, str(Path(__file__).parent))
import tipkit as tk

ap = argparse.ArgumentParser()
ap.add_argument('pitcher'); ap.add_argument('--season', default='2026'); ap.add_argument('--views', default='D,V')
ap.add_argument('--per-game', type=int, default=10); ap.add_argument('--no-clips', action='store_true')
ap.add_argument('--force-flags', action='store_true', help='preview only: flag pitches even where no tell was found')
a = ap.parse_args()
D = tk.pdir(a.pitcher)
info = tk.pitcher_info(a.pitcher)
out_dir = tk.ROOT / 'www' / 'lab' / 'tip' / 'data'
frames_dir = out_dir / a.pitcher / 'frames'; frames_dir.mkdir(parents=True, exist_ok=True)
clips_dir = out_dir / a.pitcher / 'clips'; clips_dir.mkdir(parents=True, exist_ok=True)
games_dir = out_dir / a.pitcher / 'games'; games_dir.mkdir(parents=True, exist_ok=True)
NAMES = dict(tk.NAMES)
NAMES.update(info.get('pitch_names', {}))   # e.g. Skenes calls his splitter a splinker
FAMILY = tk.FAMILY   # replaced by tk.GROUP below when the models were trained on groups
SLICE_TEXT = {'m2000': '2.0 s before release', 'm1500': '1.5 s before release', 'set': 'in the set', 'top_m1': 'a second before the top of the leg lift',
              'lift_start': 'as the leg starts up', 'm1000': '1.0 s before release', 'lift_top': 'at the top of the leg lift',
              'm0750': '0.75 s before release', 'break': 'at hand break', 'm0500': '0.5 s before release', 'm0250': '0.25 s before release', 'm0000': 'at release'}
WHO = {'hitter': 'the hitter', 'cf': 'the center-field camera and a runner on second'}
FIX = [('glove_y', 'Set the glove at the same height on every pitch.'),
       ('glove_x', 'Keep the glove in the same spot in the set, no drifting forward or back.'),
       ('hand_glove', 'Bury the throwing hand in the glove to the same depth on every pitch.'),
       ('thand', 'Keep the fingers behind the glove so the grip never shows.'),
       ('ghand', 'Hold the glove hand the same way on every pitch.'),
       ('hand_', 'Keep the throwing hand still and hidden in the set.'),
       ('glove_elbow', 'Same glove-side elbow on every pitch.'), ('throw_elbow', 'Same throwing elbow in the set on every pitch.'),
       ('glove_sh', 'Same shoulders in the set on every pitch.'), ('throw_sh', 'Same shoulders in the set on every pitch.'),
       ('shoulder', 'Same chest angle to the plate in the set.'), ('hip_w', 'Same hips to the plate in the set.'),
       ('head', 'Same head position and eye line in the set.'),
       ('trunk', 'Same posture in the set: no extra lean on one pitch.'),
       ('lead_knee', 'Same leg lift height and path on every pitch.'), ('back_knee', 'Same back leg on every pitch.'),
       ('lead_ankle', 'Same stride direction on every pitch.'), ('ankle_spread', 'Same foot spacing in the set.'), ('hip_height', 'Same knee bend in the set.'),
       ('_speed', 'Same tempo: nothing moves faster or slower before one pitch type.'),
       ('to_release', 'Same tempo from the set to release on every pitch.'), ('set_dur', 'Hold the set the same length on every pitch.')]
lab = pd.read_csv(tk.ROOT / 'private' / f'{a.pitcher}_execution_pitch_level_INTERNAL.csv', dtype={'play_id': str})
lab = lab[lab.game_date.astype(str).str.startswith(a.season)]
_any = next(iter(sorted(D.glob('models/*/*/timeline.json'))), None)
if _any and json.loads(_any.read_text()).get('class_mode') == 'groups':
    FAMILY = tk.GROUP
lab['family'] = lab.pitch_type.map(FAMILY)
lab['home_flag'] = lab.home.astype(str).str.lower() == 'true'
sit = pd.read_csv(D / f'situations-{a.season}.csv', dtype={'play_id': str}).set_index('play_id')


def fix_for(feature):
    for pre, text in FIX:
        if pre in feature:
            return text
    return 'Make the set look the same on every pitch.'


def phrase(feature, direction, plain):
    """Plain words for a tell: what the feature is and which way it goes."""
    hi = direction == 'higher'
    f = feature
    if f.endswith('_speed'):
        return f'{plain} tends to be {"faster" if hi else "slower"}'
    if f.endswith('to_release') or f == 'set_dur':
        return f'{plain} tends to be {"longer" if hi else "shorter"}'
    if f.endswith('_x') or f.endswith('_dx'):
        return f'{plain} tends to sit {"further right" if hi else "further left"} on screen'
    if f.endswith('_y') or f.endswith('_dy') or f.endswith('height'):
        return f'{plain} tends to be {"higher" if hi else "lower"}'
    if 'dist' in f or 'spread' in f or f.endswith('_w') or f.endswith('_len'):
        return f'{plain} tends to be {"greater" if hi else "smaller"}'
    if 'tilt' in f:
        return f'there tends to be {"more" if hi else "less"} {plain}'
    if 'vis' in f or 'conf' in f:
        return f'the {plain.replace(" visible", "").replace(" clarity", "")} tends to be {"more" if hi else "less"} visible'
    return f'{plain} tends to be {"more" if hi else "less"}'


TIP_WINDOW = 0.5   # seconds before release; later than this the arm itself shows the pitch, so it is not a tell


def verdict(tl):
    best = None
    early = [s for s in tl['slices'] if s['t_before_release'] >= TIP_WINDOW]
    for s in early:
        lift = s['acc_lr'] - s['baseline_majority']
        over_sit = s['acc_lr'] - s['acc_situation']
        p = s['perm_p'] if s['perm_p'] is not None else 1.0
        grade = 'clear' if (lift >= 0.10 and p < 0.01 and over_sit >= 0.05) else 'weak' if (lift >= 0.05 and p < 0.05 and over_sit >= 0.03) else 'none'
        if grade != 'none' and (best is None or s['t_before_release'] > best['t']):
            best = dict(grade=grade, slice=s['slice'], t=s['t_before_release'], acc=s['acc_lr'], baseline=s['baseline_majority'], situation=s['acc_situation'], p=p)
    if best is None:
        top = max(early, key=lambda s: s['acc_lr'] - s['baseline_majority']) if early else None
        return dict(grade='none', **({'slice': top['slice'], 't': top['t_before_release'], 'acc': top['acc_lr'], 'baseline': top['baseline_majority'], 'situation': top['acc_situation'], 'p': top['perm_p']} if top else {}))
    return best


def art(name):
    return 'an' if name[:1].lower() in 'aeiou' else 'a'


def tell_text(tl, slice_, fam):
    s = next((x for x in tl['slices'] if x['slice'] == slice_), None)
    if not s or fam not in s['tells_lr']:
        return None, None
    t = s['tells_lr'][fam][0]
    return f"Before {art(NAMES.get(fam, fam))} {NAMES.get(fam, fam)}, {phrase(t['feature'], t['direction'], t['plain'])} {SLICE_TEXT.get(slice_, '')}.", t['feature']


def tells(tl, v):
    out = []
    if v.get('grade', 'none') == 'none':
        return out
    for s in [x for x in tl['slices'] if x['slice'] == v.get('slice')]:
        for c, lst in s['tells_lr'].items():
            if c not in tl['classes']:
                continue
            t = lst[0]
            out.append(dict(slice=s['slice'], when=SLICE_TEXT.get(s['slice'], s['slice']), t=s['t_before_release'], family=c, family_name=NAMES.get(c, c),
                            text=f"Before {art(NAMES.get(c, c))} {NAMES.get(c, c)}, {phrase(t['feature'], t['direction'], t['plain'])} {SLICE_TEXT.get(s['slice'], '')}.",
                            feature=t['feature'], direction=t['direction'], weight=t['weight'], fix=fix_for(t['feature'])))
    return out


def pitcher_rect(view, pid, t0, t1):
    """Crop rectangle (x, y, w, h) covering the tracked pitcher between t0 and t1, padded, even-sized."""
    z = np.load(D / 'pose' / view / f'{pid}.npz')
    m = (z['t'] >= t0) & (z['t'] <= t1) & (z['box'][:, 0] >= 0)
    if not m.any():
        return None
    b = z['box'][m]
    x0, y0, x1, y1 = b[:, 0].min(), b[:, 1].min(), b[:, 2].max(), b[:, 3].max()
    w, h = x1 - x0, y1 - y0
    x0 -= 0.10 * w; x1 += 0.10 * w; y0 -= 0.06 * h; y1 += 0.04 * h
    x0, y0 = int(max(0, x0)), int(max(0, y0)); x1, y1 = int(min(tk.W, x1)), int(min(tk.H, y1))
    w, h = (x1 - x0) // 2 * 2, (y1 - y0) // 2 * 2
    return x0, y0, max(2, w), max(2, h)


def render_clip(view, pid, t_rel, name):
    """2.6 s pitcher-only clip, set through release, 480 px tall, no sound. Resumable."""
    out = clips_dir / f'{name}.mp4'
    if out.exists() and out.stat().st_size > 20000:
        return f'{a.pitcher}/clips/{name}.mp4'
    t0, t1 = max(0.0, t_rel - 2.2), t_rel + 0.4
    rect = pitcher_rect(view, pid, t0, t1)
    if rect is None:
        return None
    x, y, w, h = rect
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{t0:.3f}', '-i', str(tk.clip_path(a.pitcher, view, pid)), '-t', f'{t1 - t0:.3f}',
           '-vf', f'crop={w}:{h}:{x}:{y},scale=-2:480,fps=30', '-an', '-c:v', 'libx264', '-crf', '27', '-preset', 'veryfast',
           '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(out)]
    try:
        subprocess.run(cmd, check=True, timeout=120)
    except Exception as e:
        print('clip failed', pid, e); return None
    return f'{a.pitcher}/clips/{name}.mp4'


def render_still(view, pid, tsec, name, width=360):
    import cv2
    out = clips_dir / f'{name}.jpg'
    if out.exists():
        return f'{a.pitcher}/clips/{name}.jpg'
    rect = pitcher_rect(view, pid, tsec - 2.2, tsec + 0.4)
    frames, _ = tk.decode_window(tk.clip_path(a.pitcher, view, pid), tsec, tsec + 0.05, fps=30)
    if rect is None or not len(frames):
        return None
    x, y, w, h = rect
    crop = frames[0][y:y + h, x:x + w]
    cv2.imwrite(str(out), cv2.resize(crop, (width, int(width * crop.shape[0] / max(1, crop.shape[1])))), [cv2.IMWRITE_JPEG_QUALITY, 82])
    return f'{a.pitcher}/clips/{name}.jpg'


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


# ---------------- per view and delivery ----------------
views = []; entries = []
for view in [v.strip().upper() for v in a.views.split(',') if v.strip()]:
    found = sorted((D / 'models' / view).glob('*/timeline.json')) if (D / 'models' / view).exists() else []
    if not found:
        print(f'no model for view {view}: listed as processing')
        views.append(dict(key=view, letter=view, view_label=tk.VIEWS[view]['label'], label=tk.VIEWS[view]['label'], delivery='all', who=tk.VIEWS[view]['who'],
                          who_text=WHO[tk.VIEWS[view]['who']], clips=0, games=0, classes=[], class_names={},
                          n_per_class={}, not_enough_data={}, min_n=150, verdict={'grade': 'none'}, timeline=[], tells=[], frames=[], processing=True))
        continue
    ev = {r['play_id']: r for r in tk.read_csv(D / 'events' / f'{view}.csv')}
    for p in found:
        tl = json.loads(p.read_text())
        dlv = tl.get('delivery', 'all')
        v = verdict(tl)
        timeline = [dict(slice=s['slice'], when=SLICE_TEXT.get(s['slice'], s['slice']), t=s['t_before_release'], n=s['n'], acc=s['acc_lr'], acc_gbm=s['acc_gbm'],
                         baseline=s['baseline_majority'], situation=s['acc_situation'], camera=s['acc_camera'], video_plus_situation=s['acc_video_plus_situation'],
                         perm_p=s['perm_p'], recall=s['recall_lr'], pairs=s['pairs']) for s in tl['slices']]
        base = tk.VIEWS[view]['label']
        key = f"{tk.VIEWS[view]['name']}_{dlv}"
        entry = dict(key=key, letter=view, view_label=base, label=base if dlv == 'all' else f'{base}, {dlv}',
                     delivery=dlv, who=tk.VIEWS[view]['who'], who_text=WHO[tk.VIEWS[view]['who']],
                     clips=tl['n_clips'], games=tl['games'], classes=tl['classes'], class_names={c: NAMES.get(c, c) for c in list(tl['classes']) + list(tl['not_enough_data'])}, n_per_class=tl['n_per_class'], members=tl.get('members', {}),
                     not_enough_data={c: n for c, n in tl['not_enough_data'].items()}, min_n=tl['min_n'],
                     verdict=v, timeline=timeline, tells=tells(tl, v), frames=render_frames(view, dlv, tl['classes']) if tl['classes'] else [])
        views.append(entry)
        pc_path = p.parent / 'pitches.csv'
        entries.append(dict(view=view, dlv=dlv, tl=tl, v=v, entry=entry, ev=ev,
                            pitches=pd.read_csv(pc_path, dtype={'play_id': str}) if pc_path.exists() and pc_path.stat().st_size > 50 else None))
        print(f"{view} {dlv}: verdict {v.get('grade')} at {v.get('slice')} acc {v.get('acc')} vs {v.get('baseline')}; {len(entry['frames'])} frames")

# ---------------- games: readability per game, flagged pitches, clips ----------------
games = []
game_meta = lab.drop_duplicates('game_date').set_index('game_date')[['opp', 'home_flag']]
per_game_pitches = lab.groupby('game_date').size()
for gdate in sorted(lab.game_date.unique()):
    g = dict(date=str(gdate), opp=str(game_meta.loc[gdate, 'opp']), home=bool(game_meta.loc[gdate, 'home_flag']), pitches=int(per_game_pitches[gdate]),
             entries=[], flagged=[])
    for E in entries:
        pc, v, tl, entry = E['pitches'], E['v'], E['tl'], E['entry']
        if pc is None or not v.get('slice'):
            continue
        gp = pc[pc.game_date.astype(str) == str(gdate)]
        at = gp[gp.slice == v['slice']]
        if at.empty:
            continue
        st = dict(key=entry['key'], label=entry['label'], view_label=entry['view_label'], delivery=entry['delivery'], grade=v['grade'], slice=v['slice'],
                  when=SLICE_TEXT.get(v['slice'], v['slice']), n=int(len(at)), acc=round(float((at.pred == at.family).mean()), 3),
                  baseline=round(float((at.majority == at.family).mean()), 3), situation=round(float((at.pred_sit == at.family).mean()), 3))
        g['entries'].append(st)
        if v['grade'] == 'none' and not a.force_flags:
            continue
        early = gp[(gp.t_before_release >= 0.5) & (gp.pred == gp.family) & (gp.p_true >= 0.6) & (gp.p_true - gp.p_true_sit >= 0.15)]
        early = early.sort_values('t_before_release', ascending=False).drop_duplicates('play_id', keep='first')
        early = early.sort_values('p_true', ascending=False).head(a.per_game)
        st['flagged'] = int(len(early))
        # one comparison pitch per other family in this game: the typical one (median video confidence)
        compare = {}
        for fam, grp in gp[gp.slice == v['slice']].groupby('family'):
            grp = grp.sort_values('p_true')
            compare[fam] = grp.iloc[len(grp) // 2].play_id
        for r in early.itertuples():
            e = E['ev'].get(r.play_id)
            if not e or not e['t_release']:
                continue
            t_rel = float(e['t_release']); t_cue = t_rel - float(r.t_before_release)
            s_ = sit.loc[r.play_id] if r.play_id in sit.index else None
            text, feature = tell_text(tl, r.slice, r.family)
            item = dict(play_id=r.play_id, family=r.family, family_name=NAMES.get(r.family, r.family), key=entry['key'], label=entry['label'],
                        view_label=entry['view_label'], delivery=entry['delivery'], slice=r.slice, when=SLICE_TEXT.get(r.slice, r.slice), t=float(r.t_before_release),
                        conf=float(r.p_true), conf_sit=float(r.p_true_sit), tell=text, fix=fix_for(feature) if feature else None,
                        inning=int(s_['inning']) if s_ is not None else None, count=f"{int(s_['balls'])}-{int(s_['strikes'])}" if s_ is not None else None,
                        outs=int(s_['outs']) if s_ is not None else None, bat_side=str(s_['bat_side']) if s_ is not None else None,
                        clip=None, still=None, compare=None)
            if not a.no_clips:
                item['clip'] = render_clip(E['view'], r.play_id, t_rel, f"{E['view']}_{r.play_id}")
                item['still'] = render_still(E['view'], r.play_id, t_cue, f"{E['view']}_{r.play_id}_{r.slice}")
                others = [f for f in compare if f != r.family]
                if others:
                    # the most common other family in this game
                    fam2 = max(others, key=lambda f: int((gp[gp.slice == v['slice']].family == f).sum()))
                    pid2 = compare[fam2]; e2 = E['ev'].get(pid2)
                    if e2 and e2['t_release']:
                        t2 = float(e2['t_release'])
                        item['compare'] = dict(play_id=pid2, family=fam2, family_name=NAMES.get(fam2, fam2),
                                               clip=render_clip(E['view'], pid2, t2, f"{E['view']}_{pid2}"),
                                               still=render_still(E['view'], pid2, t2 - float(r.t_before_release), f"{E['view']}_{pid2}_{r.slice}"))
            g['flagged'].append(item)
    g['flagged'].sort(key=lambda x: -x['conf'])
    g['n_flagged'] = len(g['flagged'])
    tells_e = [st for st in g['entries'] if st['grade'] != 'none']
    g['best'] = max(g['entries'], key=lambda st: st['acc'] - st['baseline']) if g['entries'] else None
    g['processed'] = bool(g['entries'])
    games.append(g)
    if g['entries']:
        (games_dir / f'{gdate}.json').write_text(json.dumps(dict(pitcher=dict(id=a.pitcher, name=info.get('name', a.pitcher)), season=a.season, built=dt.date.today().isoformat(),
                                                                 label='game-only', **g), indent=0))
print(f"games: {sum(1 for g in games if g['processed'])} with model output, {sum(g['n_flagged'] for g in games)} flagged pitches")

# ---------------- dashboard ----------------
fixes = []
for e in views:
    if e['verdict'].get('grade') in ('weak', 'clear'):
        for t in e['tells']:
            if t['fix'] not in fixes:
                fixes.append(t['fix'])
counts = lab.family.value_counts()
data = dict(schema='nb.tip_page/2', pitcher=dict(id=a.pitcher, name=info.get('name', a.pitcher), hand=info.get('hand', 'R')), season=a.season,
            built=dt.date.today().isoformat(), label='game-only',
            delivery_note={'stretch_only': 'All pitches from the stretch.', 'windup_only': 'All pitches from the windup.'}.get(
                info.get('delivery', 'stretch_only'), 'Windup with the bases empty, stretch with runners on. The video decides which, and each is modeled on its own.'),
            deliveries=sorted({v['delivery'] for v in views}),
            season_mix={c: int(n) for c, n in counts.items() if c}, season_pitches=int(counts.sum()), type_names=NAMES,
            majority=dict(family=str(counts.idxmax()), share=round(float(counts.max() / counts.sum()), 3)),
            views=views, fix_cue='', fix_suggestions=fixes[:3], facility=[],
            games=[dict(date=g['date'], opp=g['opp'], home=g['home'], pitches=g['pitches'], processed=g['processed'], n_flagged=g['n_flagged'], best=g['best']) for g in games])
(out_dir / f'{a.pitcher}.json').write_text(json.dumps(data, indent=0))
print(f"wrote {out_dir / f'{a.pitcher}.json'}")
