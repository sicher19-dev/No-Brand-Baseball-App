"""Tip Detection: per-view, per-delivery models at every time slice, with the checks
the brief requires, and the tip timeline.

  .venv-tip/Scripts/python tools/tip/py/train.py skenes --view D [--season 2026]
        [--perms 100] [--min-n 150] [--delivery auto|all|stretch|windup]

Reads  private/tip/<id>/features/<view>.csv, events/<view>.csv
       private/<id>_execution_pitch_level_INTERNAL.csv   (pitch type, game, park, batter side)
       private/tip/<id>/situations-<season>.csv            (count, outs, runners, score, order)
Writes private/tip/<id>/models/<view>/<delivery>/timeline.json, report.md, clips.csv,
       pitches.csv (per-pitch held-out reads at every slice)

Rules applied here:
  * whole games are held out (leave-one-game-out); never random pitches
  * windup and stretch are modeled separately ("auto": one model per delivery that
    has enough data). The delivery is read from the video (shoulder width on screen
    1.5-0.8 s before the lift: a windup is square to the plate, a stretch side-on),
    with the base state as the fallback; pitcher.json "delivery" says whether the
    pitcher uses both ("both" / "windup_when_empty"), "stretch_only" or "windup_only"
  * majority-class baseline next to every number
  * a situation-only model (count, outs, runners, batter side, inning, score,
    times through the order, park) and a camera-only model (box size and
    position) reported beside the video model
  * permutation test: labels shuffled within each game, same cross-validation
  * pitch types with fewer than --min-n clips in this view and delivery are
    dropped and reported as "not enough data"
"""
import sys, argparse, json, warnings, shutil
from pathlib import Path
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline
from sklearn.model_selection import LeaveOneGroupOut, GroupKFold
from sklearn.metrics import accuracy_score, log_loss, roc_auc_score, confusion_matrix
import lightgbm as lgb
sys.path.insert(0, str(Path(__file__).parent))
import tipkit as tk

warnings.filterwarnings('ignore')
ap = argparse.ArgumentParser()
ap.add_argument('pitcher'); ap.add_argument('--view', required=True); ap.add_argument('--season', default='2026')
ap.add_argument('--perms', type=int, default=100); ap.add_argument('--min-n', type=int, default=150)
ap.add_argument('--delivery', default='auto')
a = ap.parse_args()
view = a.view.upper()
D = tk.pdir(a.pitcher)
info = tk.pitcher_info(a.pitcher)
FAMILY = {'FF': 'FF', 'SI': 'SI', 'FT': 'SI', 'ST': 'ST', 'SL': 'SL', 'CH': 'CH', 'FS': 'FS', 'CU': None, 'KC': None, 'FC': 'FC'}
NAMES = {'FF': 'four-seam', 'SI': 'sinker', 'ST': 'sweeper', 'SL': 'slider', 'CH': 'changeup', 'FS': 'splitter', 'FC': 'cutter'}
PLAIN = {
    'glove_y': 'glove height', 'glove_x': 'glove forward/back', 'hand_y': 'throwing hand height', 'hand_x': 'throwing hand forward/back',
    'hand_glove_dx': 'hand ahead of or behind the glove', 'hand_glove_dy': 'hand above or below the glove', 'hand_glove_dist': 'hand-to-glove distance',
    'glove_elbow_y': 'glove-side elbow height', 'throw_elbow_y': 'throwing elbow height', 'glove_elbow_x': 'glove-side elbow forward/back',
    'throw_elbow_x': 'throwing elbow forward/back', 'glove_sh_y': 'glove-side shoulder height', 'throw_sh_y': 'throwing shoulder height',
    'shoulder_tilt': 'shoulder tilt', 'shoulder_w': 'how open the shoulders are to the camera', 'hip_w': 'how open the hips are to the camera',
    'trunk_tilt': 'trunk lean', 'trunk_len': 'trunk length on screen (bend)', 'head_x': 'head forward/back', 'head_y': 'head height',
    'head_tilt': 'head tilt', 'lead_knee_y': 'lead knee height', 'lead_knee_x': 'lead knee forward/back', 'back_knee_y': 'back knee height',
    'lead_ankle_x': 'lead foot forward/back', 'ankle_spread': 'feet apart', 'hip_height': 'hip height over the feet',
    'thand_vis': 'throwing hand visible', 'ghand_vis': 'glove hand visible', 'thand_conf': 'throwing hand clarity',
    'thand_dx': 'fingers forward/back of the glove', 'thand_dy': 'fingers above/below the glove', 'thand_spread': 'finger spread',
    'ghand_dx': 'glove hand forward/back', 'ghand_dy': 'glove hand up/down', 'ghand_spread': 'glove hand spread',
    'glove_speed': 'glove moving', 'hand_speed': 'throwing hand moving', 'knee_speed': 'lead knee moving',
    'lift_to_release': 'leg lift to release time', 'top_to_release': 'top of lift to release time', 'break_to_release': 'hand break to release time',
    'set_dur': 'time in the set',
}

# ---- data
feat = pd.read_csv(D / 'features' / f'{view}.csv')
ev = pd.read_csv(D / 'events' / f'{view}.csv', dtype={'play_id': str})
lab = pd.read_csv(tk.ROOT / 'private' / f'{a.pitcher}_execution_pitch_level_INTERNAL.csv', dtype={'play_id': str})
lab = lab[lab.game_date.astype(str).str.startswith(a.season)]
lab['family'] = lab.pitch_type.map(FAMILY)
lab['park'] = np.where(lab.home.astype(str).str.lower() == 'true', info.get('team', 'HOME'), lab.opp)
sit = pd.read_csv(D / f'situations-{a.season}.csv', dtype={'play_id': str})
sit['score_diff'] = sit.score_for - sit.score_against
sit['on_base'] = sit.on_1b + sit.on_2b + sit.on_3b
meta = lab[['play_id', 'game_date', 'park', 'stand', 'family']].merge(
    sit[['play_id', 'outs', 'balls', 'strikes', 'on_1b', 'on_2b', 'on_3b', 'on_base', 'inning', 'score_diff', 'tto', 'bat_side']], on='play_id', how='inner')
if 'pre_sw' in ev.columns:
    meta = meta.merge(ev[['play_id', 'pre_sw', 'pre_hw']], on='play_id', how='left')
else:
    meta = meta.assign(pre_sw=np.nan, pre_hw=np.nan)
df = feat.merge(meta, on='play_id', how='inner')
df = df[df.family.notna()]

# ---- delivery: windup or stretch, per pitch
mode = info.get('delivery', 'stretch_only')
by_bases = np.where(df.on_base > 0, 'stretch', 'windup')
rule = {'stretch_only': 'every pitch from the stretch', 'windup_only': 'every pitch from the windup'}.get(mode)
agreement = None
if mode == 'stretch_only':
    df['delivery'] = 'stretch'
elif mode == 'windup_only':
    df['delivery'] = 'windup'
else:
    one = df.drop_duplicates('play_id')
    e = one[one.on_base == 0].pre_sw.dropna(); r = one[one.on_base > 0].pre_sw.dropna()
    if len(e) >= 20 and len(r) >= 20 and e.median() - r.median() >= 0.03:
        thr = float((e.median() + r.median()) / 2)
        vid = np.where(df.pre_sw.isna(), by_bases, np.where(df.pre_sw > thr, 'windup', 'stretch'))
        df['delivery'] = vid
        agreement = round(float((vid == by_bases).mean()), 3)
        rule = f'video: shoulder width on screen 1.5-0.8 s before the lift, windup above {thr:.3f} body heights; base state where the cue is missing'
    else:
        df['delivery'] = by_bases
        rule = 'base state (windup with the bases empty); the video cue was not separable yet'
print(f'delivery rule: {rule}' + (f'; agrees with base state on {agreement:.0%} of pitches' if agreement is not None else ''))

SIT_COLS = ['outs', 'balls', 'strikes', 'on_1b', 'on_2b', 'on_3b', 'inning', 'score_diff', 'tto', 'bat_side_L', 'park_code']
df['bat_side_L'] = (df.bat_side == 'L').astype(int)
df['park_code'] = df.park.astype('category').cat.codes
CAM_COLS = [c for c in df.columns if c.startswith('cam_')]
SKIP = {'play_id', 'slice', 't_before_release', 'game_date', 'park', 'stand', 'family', 'bat_side', 'delivery', 'on_base', 'park_code', 'bat_side_L',
        'pre_sw', 'pre_hw'} | set(SIT_COLS) | set(CAM_COLS)
VID_COLS = [c for c in df.columns if c not in SKIP]


def lr():
    return make_pipeline(SimpleImputer(strategy='median'), StandardScaler(), LogisticRegression(C=0.3, max_iter=3000))


def gbm():
    return make_pipeline(SimpleImputer(strategy='median'),
                         lgb.LGBMClassifier(n_estimators=300, learning_rate=0.03, num_leaves=15, min_child_samples=25,
                                            subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, verbose=-1))


def oof(model_fn, X, y, groups, cv):
    """Out-of-fold class probabilities and the majority-class prediction per fold."""
    labels = sorted(set(y))
    P = np.zeros((len(y), len(labels))); maj = np.empty(len(y), dtype=object)
    for tr, te in cv.split(X, y, groups):
        m = model_fn().fit(X[tr], y[tr])
        pr = m.predict_proba(X[te])
        cols = list(m.classes_)
        for k, c in enumerate(labels):
            if c in cols:
                P[te, k] = pr[:, cols.index(c)]
        maj[te] = pd.Series(y[tr]).mode()[0]
    return P, labels, maj


def summarize(P, labels, y):
    pred = np.array(labels)[P.argmax(1)]
    acc = accuracy_score(y, pred)
    ll = log_loss(y, np.clip(P, 1e-6, 1), labels=labels)
    cm = confusion_matrix(y, pred, labels=labels)
    recall = {c: round(float(cm[i, i] / max(1, cm[i].sum())), 3) for i, c in enumerate(labels)}
    return acc, ll, cm, recall


def perm_test(X, y, groups, n_perm):
    """Shuffle labels within each game; same grouped CV; share of permutations at or above the observed accuracy."""
    if n_perm <= 0:
        return None, None
    cv = GroupKFold(n_splits=min(5, len(set(groups))))
    rng = np.random.default_rng(7)
    P, labels, _ = oof(lr, X, y, groups, cv)
    obs = accuracy_score(y, np.array(labels)[P.argmax(1)])
    hits = 0; null = []
    for _ in range(n_perm):
        yp = y.copy()
        for g in set(groups):
            idx = np.where(groups == g)[0]
            yp[idx] = rng.permutation(yp[idx])
        Pp, lp, _ = oof(lr, X, yp, groups, cv)
        acc_p = accuracy_score(yp, np.array(lp)[Pp.argmax(1)])
        null.append(acc_p); hits += acc_p >= obs
    return round((1 + hits) / (1 + n_perm), 4), round(float(np.mean(null)), 4)


ORDER = ['m2000', 'm1500', 'set', 'top_m1', 'lift_start', 'm1000', 'lift_top', 'm0750', 'break', 'm0500', 'm0250', 'm0000']


def run(df, delivery):
    clips = df.drop_duplicates('play_id')
    counts = clips.family.value_counts()
    classes = sorted([c for c in counts.index if counts[c] >= a.min_n])
    dropped = {c: int(counts[c]) for c in counts.index if counts[c] < a.min_n}
    print(f'[{delivery}] {len(clips)} clips, {clips.game_date.nunique()} games; classes {classes}; not enough data: {dropped}', flush=True)
    df = df[df.family.isin(classes)]
    results = []; pitch_rows = []
    logo = LeaveOneGroupOut()
    slices = [s for s in ORDER if s in set(df.slice)] + [s for s in sorted(set(df.slice)) if s not in ORDER]
    for s in slices:
        d = df[df.slice == s].reset_index(drop=True)
        if len(d) < 60 or d.game_date.nunique() < 4 or len(classes) < 2:
            continue
        y = d.family.values.astype(object); groups = d.game_date.values
        Xv = d[VID_COLS].values.astype(float); Xs = d[SIT_COLS].values.astype(float); Xc = d[CAM_COLS].values.astype(float)
        Xvs = np.hstack([Xv, Xs])
        r = dict(slice=s, t_before_release=round(float(d.t_before_release.median()), 2), n=int(len(d)), games=int(d.game_date.nunique()),
                 n_per_class={c: int((y == c).sum()) for c in classes})
        P, labels, maj = oof(lr, Xv, y, groups, logo)
        acc, ll, cm, rec = summarize(P, labels, y)
        r.update(acc_lr=round(acc, 4), logloss_lr=round(ll, 4), recall_lr=rec, confusion_lr=cm.tolist(), classes=labels,
                 baseline_majority=round(float(accuracy_score(y, maj)), 4))
        Pg, _, _ = oof(gbm, Xv, y, groups, logo)
        accg, llg, cmg, recg = summarize(Pg, labels, y)
        r.update(acc_gbm=round(accg, 4), logloss_gbm=round(llg, 4), recall_gbm=recg)
        Ps, _, _ = oof(gbm, Xs, y, groups, logo); r['acc_situation'] = round(summarize(Ps, labels, y)[0], 4)
        # Per-pitch held-out reads: what the video said about this pitch before release,
        # and what the situation alone said. Feeds the per-game pages.
        li = {c: k for k, c in enumerate(labels)}
        for i in range(len(y)):
            k = li[y[i]]
            pitch_rows.append(dict(play_id=d.play_id.iloc[i], game_date=groups[i], family=y[i], slice=s, t_before_release=r['t_before_release'],
                                   pred=labels[int(P[i].argmax())], p_true=round(float(P[i, k]), 4),
                                   pred_sit=labels[int(Ps[i].argmax())], p_true_sit=round(float(Ps[i, k]), 4), majority=maj[i]))
        Pc, _, _ = oof(gbm, Xc, y, groups, logo); r['acc_camera'] = round(summarize(Pc, labels, y)[0], 4)
        Pvs, _, _ = oof(gbm, Xvs, y, groups, logo); r['acc_video_plus_situation'] = round(summarize(Pvs, labels, y)[0], 4)
        pairs = {}
        for name, pos, neg in [('FF_vs_ST', ['FF'], ['ST']), ('FF_vs_offspeed', ['FF'], ['CH', 'FS']), ('fast_vs_breaking', ['FF', 'SI'], ['ST', 'SL']),
                               ('FF_vs_rest', ['FF'], [c for c in classes if c != 'FF'])]:
            m = np.isin(y, pos + neg)
            if m.sum() < 60 or not any(np.isin(y[m], pos)) or not any(np.isin(y[m], neg)):
                continue
            yb = np.isin(y[m], pos).astype(int)
            Pb, lb, mb = oof(lr, Xv[m], yb, groups[m], logo)
            pb = Pb[:, lb.index(1)] if 1 in lb else np.zeros(m.sum())
            pairs[name] = dict(n=int(m.sum()), acc=round(float(accuracy_score(yb.astype(int), (pb > 0.5).astype(int))), 4),
                               auc=round(float(roc_auc_score(yb.astype(int), pb)), 4), baseline=round(float(accuracy_score(yb.astype(int), mb.astype(int))), 4))
        r['pairs'] = pairs
        r['perm_p'], r['perm_null_acc'] = perm_test(Xv, y, groups, a.perms)
        full = lr().fit(Xv, y)
        coef = full[-1].coef_
        tells = {}
        for k, c in enumerate(full[-1].classes_):
            row = coef[k] if coef.shape[0] > 1 else coef[0] * (1 if k == 1 else -1)
            top = np.argsort(-np.abs(row))[:3]
            tells[c] = [dict(feature=VID_COLS[j], plain=PLAIN.get(VID_COLS[j], VID_COLS[j]), direction='higher' if row[j] > 0 else 'lower', weight=round(float(row[j]), 3)) for j in top]
        g = gbm().fit(Xv, y)
        gain = g[-1].booster_.feature_importance('gain')
        r['top_features_gbm'] = [dict(feature=VID_COLS[j], plain=PLAIN.get(VID_COLS[j], VID_COLS[j]), gain=round(float(gain[j]), 1)) for j in np.argsort(-gain)[:6]]
        r['tells_lr'] = tells
        results.append(r)
        print(f"[{delivery}] {s:>10} t-{r['t_before_release']:.2f}s n={r['n']}  LR {r['acc_lr']:.3f}  GBM {r['acc_gbm']:.3f}  majority {r['baseline_majority']:.3f}  "
              f"situation {r['acc_situation']:.3f}  camera {r['acc_camera']:.3f}  video+sit {r['acc_video_plus_situation']:.3f}  perm p {r['perm_p']}", flush=True)

    out_dir = D / 'models' / view / delivery
    out_dir.mkdir(parents=True, exist_ok=True)
    summary = dict(pitcher=a.pitcher, view=view, view_label=tk.VIEWS[view]['label'], who_can_see=tk.VIEWS[view]['who'], season=a.season,
                   delivery=delivery, delivery_rule=rule, delivery_agreement_with_bases=agreement,
                   n_clips=int(len(clips)), games=int(clips.game_date.nunique()), classes=classes,
                   class_names={c: NAMES.get(c, c) for c in classes}, n_per_class={c: int(counts[c]) for c in classes},
                   not_enough_data=dropped, min_n=a.min_n, perms=a.perms, slices=results, label='game-only')
    (out_dir / 'timeline.json').write_text(json.dumps(summary, indent=1))
    clips[['play_id', 'game_date', 'family']].to_csv(out_dir / 'clips.csv', index=False)
    pd.DataFrame(pitch_rows).to_csv(out_dir / 'pitches.csv', index=False)
    lines = [f'# Tip timeline, {tk.VIEWS[view]["label"]}, {delivery} ({a.pitcher}, {a.season})', '', f'Delivery rule: {rule}.', '',
             f'{len(clips)} clips in {clips.game_date.nunique()} games. Classes: ' + ', '.join(f'{NAMES.get(c, c)} {counts[c]}' for c in classes) +
             (f'. Not enough data: ' + ', '.join(f'{NAMES.get(c, c)} {n}' for c, n in dropped.items()) if dropped else ''), '',
             '| slice | s before release | n | logistic | boosted | majority | situation only | camera only | video + situation | perm p |', '|---|---|---|---|---|---|---|---|---|---|']
    for r in results:
        lines.append(f"| {r['slice']} | {r['t_before_release']:.2f} | {r['n']} | {r['acc_lr']:.3f} | {r['acc_gbm']:.3f} | {r['baseline_majority']:.3f} | {r['acc_situation']:.3f} | {r['acc_camera']:.3f} | {r['acc_video_plus_situation']:.3f} | {r['perm_p']} |")
    lines += ['', '## Pairwise (logistic, accuracy / AUC / majority)', '']
    for r in results:
        if r['pairs']:
            lines.append(f"- {r['slice']}: " + '; '.join(f"{k} {v['acc']:.3f} / {v['auc']:.3f} / {v['baseline']:.3f} (n={v['n']})" for k, v in r['pairs'].items()))
    lines += ['', '## Top tells (logistic, per class)', '']
    for r in results:
        lines.append(f"- **{r['slice']}** ({r['t_before_release']:.2f} s before release)")
        for c, tl in r['tells_lr'].items():
            lines.append(f"  - {NAMES.get(c, c)}: " + ', '.join(f"{t['plain']} {t['direction']} ({t['weight']:+.2f})" for t in tl))
    (out_dir / 'report.md').write_text('\n'.join(lines) + '\n')
    print(f'wrote {out_dir / "timeline.json"}, report.md, clips.csv', flush=True)


if a.delivery == 'all':
    run(df, 'all')
elif a.delivery in ('stretch', 'windup'):
    run(df[df.delivery == a.delivery], a.delivery)
else:
    for dlv in ('windup', 'stretch'):
        sub = df[df.delivery == dlv]
        nclips = sub.play_id.nunique(); ngames = sub.game_date.nunique()
        if nclips < 60 or ngames < 4:
            print(f'[{dlv}] only {nclips} clips in {ngames} games, skipped')
            shutil.rmtree(D / 'models' / view / dlv, ignore_errors=True)
            continue
        run(sub, dlv)
