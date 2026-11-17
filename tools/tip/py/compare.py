"""Tip Detection: one page that puts several pitchers' tip reports side by side.

  .venv-tip/Scripts/python tools/tip/py/compare.py skenes wheeler sanchez --out <dir>/index.html
        [--link skenes=../ --link wheeler=../wheeler/ ...]

Reads  www/lab/tip/data/<id>.json for each pitcher (built by report.py).
Writes one complete HTML page (no clips, no stills): the four verdicts per pitcher,
the edge over guessing, and how often a pitch carried a cue, with links to each report.
"""
import argparse, json, html
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ap = argparse.ArgumentParser()
ap.add_argument('pitchers', nargs='+'); ap.add_argument('--out', required=True)
ap.add_argument('--link', action='append', default=[], help="id=url of that pitcher's full report")
ap.add_argument('--season', default='2026')
a = ap.parse_args()
links = dict(l.split('=', 1) for l in a.link)
data = ROOT / 'www' / 'lab' / 'tip' / 'data'
P = [json.loads((data / f'{p}.json').read_text(encoding='utf-8')) for p in a.pitchers]

ROWS = [('hitter_windup', 'Hitter view', 'windup'), ('hitter_stretch', 'Hitter view', 'stretch'),
        ('cf_windup', 'Center field', 'windup'), ('cf_stretch', 'Center field', 'stretch')]
GRADE = {'clear': ('CLEAR TELL', 'clear'), 'weak': ('WEAK TELL', 'weak'), 'none': ('NO TELL', 'none')}
WHEN = {'m2000': '2.0 s before release', 'm1500': '1.5 s before release', 'set': 'in the set', 'top_m1': 'a second before the top of the leg lift',
        'lift_start': 'as the leg starts up', 'm1000': '1.0 s before release', 'lift_top': 'at the top of the leg lift',
        'm0750': '0.75 s before release', 'break': 'at hand break', 'm0500': '0.5 s before release'}


def pct(x):
    return f'{round(100 * x)}%'


def view(pg, key):
    return next((v for v in pg['views'] if v['key'] == key), None)


def cell(pg, key):
    v = view(pg, key)
    if not v:
        return '<div class="cell na"><span class="badge na">NO VIDEO</span><div class="sub">this delivery was not seen enough</div></div>'
    if v.get('processing'):
        return '<div class="cell na"><span class="badge na">PROCESSING</span></div>'
    vd = v.get('verdict') or {}
    g = vd.get('grade', 'none')
    if v.get('not_enough_data') and len(v.get('classes') or []) < 2:
        short = ', '.join(f"{pg['type_names'].get(k, k)} {n}" for k, n in v['not_enough_data'].items())
        return (f'<div class="cell na"><span class="badge na">NOT ENOUGH DATA</span>'
                f'<div class="sub">{v["clips"]} pitches · {v["games"]} games · short on {html.escape(short)} (need 150 of each type)</div></div>')
    label, cls = GRADE.get(g, ('NO TELL', 'none'))
    edge = vd.get('acc', 0) - vd.get('baseline', 0)
    when = next((t['when'] for t in v.get('tells', []) if t['slice'] == vd.get('slice')), None)
    line = f"{pct(vd.get('acc', 0))} readable vs {pct(vd.get('baseline', 0))} by guessing"
    sub = f"{v['clips']} pitches · {v['games']} games" + (f" · {html.escape(when)}" if when and g != 'none' else '')
    if g != 'none' and vd.get('earliest') and vd['earliest'] != vd.get('slice'):
        sub += f" · first readable {WHEN.get(vd['earliest'], vd['earliest'])}"
    sign = '+' if edge >= 0 else ''
    return (f'<div class="cell {cls}"><span class="badge {cls}">{label}</span>'
            f'<div class="num">{sign}{round(100 * edge)} <small>pts</small></div>'
            f'<div class="line">{line}</div><div class="sub">{sub}</div></div>')


def summary(pg):
    views = [view(pg, k) for k, _, _ in ROWS if view(pg, k)]
    best = max(views, key=lambda v: (v.get('verdict') or {}).get('acc', 0) - (v.get('verdict') or {}).get('baseline', 0), default=None)
    games = [g for g in pg['games'] if g.get('processed')]
    flagged = sum(g.get('n_flagged', 0) for g in games); pitches = sum(g.get('pitches', 0) for g in games)
    grades = [(v.get('verdict') or {}).get('grade', 'none') for v in views]
    worst = 'clear' if 'clear' in grades else 'weak' if 'weak' in grades else 'none'
    label, cls = GRADE[worst]
    bv = (best.get('verdict') or {}) if best else {}
    return dict(badge=f'<span class="badge {cls}">{label}</span>', cue=(pct(flagged / pitches) if pitches else '—'),
                flagged=flagged, pitches=pitches, games=len(games),
                best=(f"{best['label']}: {pct(bv.get('acc', 0))} vs {pct(bv.get('baseline', 0))}" if best else '—'),
                mix=', '.join(f"{pg['type_names'].get(k, k)} {pct(n / pg['season_pitches'])}" for k, n in pg['season_mix'].items()))


def name(pg):
    return html.escape(pg['pitcher']['name'])


cols = ''.join(f'<th>{name(pg)}<div class="hand">{"RHP" if pg["pitcher"].get("hand") == "R" else "LHP"} · {pg["season_pitches"]} pitches</div></th>' for pg in P)
body = ''
for key, vl, dl in ROWS:
    body += f'<tr><th scope="row">{vl}<div class="hand">{dl}</div></th>' + ''.join(f'<td>{cell(pg, key)}</td>' for pg in P) + '</tr>'
S = [summary(pg) for pg in P]
cards = ''.join(
    f'<div class="card"><div class="who">{name(pg)}</div>{s["badge"]}'
    f'<div class="kv"><span>Pitches with a cue</span><b>{s["cue"]}</b></div>'
    f'<div class="kv"><span>Strongest read</span><b>{html.escape(s["best"])}</b></div>'
    f'<div class="kv"><span>Games</span><b>{s["games"]}</b></div>'
    f'<div class="kv"><span>Mix</span><b>{html.escape(s["mix"])}</b></div>'
    + (f'<a class="go" href="{html.escape(links[pg["pitcher"]["id"]])}">Full report &rarr;</a>' if pg['pitcher']['id'] in links else '')
    + '</div>' for pg, s in zip(P, S))
min_w = max(540, 200 * (len(P) + 1))
names = ' · '.join(name(pg) for pg in P)

out = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Tip Report Comparison</title>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
:root{{color-scheme:dark;--bg:#0b0b0c;--panel:#141416;--line:#232326;--ink:#f2f2f0;--dim:#8a8a90;--gold:#f5b800;--clear:#ff5a5a;--weak:#f5b800;--none:#4cd37b;--na:#55555c}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font-family:Archivo,system-ui,sans-serif}}
.wrap{{max-width:1100px;margin:0 auto;padding:22px max(16px,env(safe-area-inset-left,0px)) 60px max(16px,env(safe-area-inset-right,0px))}}
.brand{{display:flex;align-items:center;gap:12px}}.nb{{width:44px;height:44px;border-radius:10px;background:var(--gold);color:#111;font-weight:900;display:grid;place-items:center;font-size:17px}}
.eyebrow{{font-size:11px;letter-spacing:.14em;color:var(--gold);font-weight:800}}h1{{margin:2px 0 0;font-size:28px;letter-spacing:-.01em}}
.sub{{color:var(--dim);font-size:13px}}.card,.box{{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;margin-top:16px}}
h2{{font-size:12px;letter-spacing:.12em;margin:0 0 8px;color:var(--dim)}}p{{line-height:1.5;margin:6px 0;font-size:14px}}
.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}}.card{{margin:0}}.who{{font-weight:800;font-size:18px;margin-bottom:6px}}
.kv{{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:6px 0;border-top:1px solid var(--line)}}.kv span{{color:var(--dim)}}.kv b{{text-align:right;font-weight:600}}
.go{{display:inline-block;margin-top:10px;color:var(--gold);font-weight:700;text-decoration:none}}
.badge{{display:inline-block;font-size:11px;letter-spacing:.08em;font-weight:800;padding:3px 8px;border-radius:999px;border:1px solid}}
.badge.clear{{color:var(--clear);border-color:var(--clear)}}.badge.weak{{color:var(--weak);border-color:var(--weak)}}.badge.none{{color:var(--none);border-color:var(--none)}}.badge.na{{color:var(--na);border-color:var(--na)}}
.tablewrap{{overflow-x:auto;-webkit-overflow-scrolling:touch}}table{{border-collapse:collapse;width:100%;min-width:{min_w}px}}
th,td{{text-align:left;vertical-align:top;padding:10px 8px;border-top:1px solid var(--line)}}thead th{{border-top:0;font-size:14px}}th .hand{{font-weight:500;color:var(--dim);font-size:12px}}
.cell .num{{font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:700;margin-top:6px}}.cell .num small{{font-size:11px;color:var(--dim)}}.cell .line{{font-size:13px}}.cell .sub{{font-size:11px;margin-top:2px;color:var(--dim)}}
.cell.clear .num{{color:var(--clear)}}.cell.weak .num{{color:var(--weak)}}.cell.none .num{{color:var(--none)}}
.foot{{font-size:11px;color:var(--dim);text-align:center;padding-top:18px}}
</style>
</head>
<body>
<div class="wrap">
<div class="brand"><div class="nb">NB</div><div><div class="eyebrow">NO BRAND BASEBALL ANALYTICS</div><h1>Tip Report · Comparison</h1><div class="sub">{a.season} season · {names} · game only</div></div></div>
<div class="box"><h2>HOW TO READ THIS</h2>
<p>Same method for every pitcher: a computer tracked only the pitcher's body from two camera angles and tried to name the pitch type before release, on games it had never seen. <b>Pts</b> is the edge over always guessing his most common pitch. <b>Clear</b> means a hitter who knows what to look for could use it; <b>weak</b> is a small but real edge; <b>no tell</b> means his body gave nothing away.</p>
<p>Windup with the bases empty, stretch with runners on. A verdict needs at least 150 pitches of each type in that delivery, on tracked video; the center-field camera in some parks sits too high and far to follow the legs, and those games count only on the hitter view. "Pitches with a cue" is the share of pitches in processed games where the video read the type with confidence at a moment that carries a real edge; it only counts where a tell was found.</p></div>
<div class="box"><h2>AT A GLANCE</h2><div class="cards">{cards}</div></div>
<div class="box"><h2>DOES HE TIP? BY ANGLE AND DELIVERY</h2><div class="tablewrap"><table><thead><tr><th></th>{cols}</tr></thead><tbody>{body}</tbody></table></div></div>
<div class="foot">Every finding is game only: seen in games, not yet checked in a pen. Shared copy from No Brand Baseball Analytics.</div>
</div>
</body>
</html>
"""
Path(a.out).parent.mkdir(parents=True, exist_ok=True)
Path(a.out).write_text(out, encoding='utf-8')
print(f'wrote {a.out}: {len(P)} pitchers, {len(out) / 1024:.0f} KB')
