"""Tip Detection: build one self-contained page (dashboard + game views) that can be
published as a private link and opened on a phone, with no server behind it.

  .venv-tip/Scripts/python tools/tip/py/share.py skenes --out <file.html>

Reads  www/lab/tip/index.html, www/lab/tip/game.html, www/lab/tip/data/<id>.json,
       www/lab/tip/data/<id>/games/*.json, www/lab/tip/data/<id>/frames/*.jpg
Writes one HTML file: the two pages merged, data and frames inlined, game views
routed on the hash (#g-YYYY-MM-DD). Clips are left out (they are only on this
machine); a flagged pitch then shows its still frame.
The file has no document skeleton of its own because the publisher adds one.
"""
import argparse, base64, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ap = argparse.ArgumentParser()
ap.add_argument('pitcher'); ap.add_argument('--out', required=True)
ap.add_argument('--full', action='store_true', help='write a complete HTML document (for GitHub Pages) instead of a skeleton-less page')
ap.add_argument('--copy-assets', action='store_true', help='copy stills and clips next to the page (data/...) instead of inlining stills; clips then play')
a = ap.parse_args()
pid = a.pitcher
web = ROOT / 'www' / 'lab' / 'tip'
data = web / 'data'

index = (web / 'index.html').read_text(encoding='utf-8')
game = (web / 'game.html').read_text(encoding='utf-8')
page = json.loads((data / f'{pid}.json').read_text(encoding='utf-8'))
games = {p.stem: json.loads(p.read_text(encoding='utf-8')) for p in sorted((data / pid / 'games').glob('*.json'))}
# only the images the page and game views actually reference (stills of flagged pitches, side-by-side frames)
wanted = set()
for v in page.get('views', []):
    for f in v.get('frames', []):
        wanted.add(f['src'])
for gm in games.values():
    for f in gm.get('flagged', []):
        wanted.add(f.get('still')); wanted.add((f.get('compare') or {}).get('still'))
for gm in games.values():
    for f in gm.get('flagged', []):
        if a.copy_assets:
            wanted.add(f.get('clip')); wanted.add((f.get('compare') or {}).get('clip'))
assets = {}
copied = 0
for rel in sorted(x for x in wanted if x):
    p = data / rel
    if not p.exists():
        continue
    if a.copy_assets:
        import shutil
        dst = Path(a.out).parent / 'data' / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if not dst.exists() or dst.stat().st_size != p.stat().st_size:
            shutil.copyfile(p, dst)
        assets[rel] = 'data/' + rel; copied += 1
    elif p.suffix.lower() in ('.jpg', '.jpeg', '.png'):
        assets[rel] = 'data:image/jpeg;base64,' + base64.b64encode(p.read_bytes()).decode()


def part(src, tag):
    m = re.search(rf'<{tag}[^>]*>(.*?)</{tag}>', src, re.S)
    return m.group(1) if m else ''


def body(src):
    return re.search(r'<body>(.*)</body>', src, re.S).group(1)


# ---- dashboard ----
d_style = part(index, 'style')
d_body = body(index)
d_body = re.sub(r'<script src="[^"]*"></script>\s*', '', d_body)
d_script = part(d_body, 'script')
d_markup = d_body[: d_body.index('<script')]
d_script = d_script.replace("const D = await (await fetch(`data/${PID}.json`, { cache: 'no-store' })).json();",
                            "const D = window.__NB.page;")
d_script = d_script.replace("if (tr) location.href = `game.html?p=${PID}&g=${tr.dataset.g}`;",
                            "if (tr) location.hash = 'g-' + tr.dataset.g;")
d_script = d_script.replace('src="data/${f.src}"', 'src="${window.__NB.assets[f.src] || \'\'}"')
assert 'window.__NB.page' in d_script and "location.hash = 'g-'" in d_script

# ---- game view: prefix ids so the two pages can share one document ----
g_style = part(game, 'style')
g_body = body(game)
g_script = part(g_body, 'script')
g_markup = g_body[: g_body.index('<script')]
ids = sorted(set(re.findall(r'id="([^"]+)"', g_markup)))
for i in ids:
    g_markup = g_markup.replace(f'id="{i}"', f'id="g_{i}"')
    g_script = g_script.replace(f"$('{i}')", f"$('g_{i}')")
g_script = g_script.replace("const G = (qs.get('g') || '').replace(/[^0-9-]/g, '');", "")
g_script = g_script.replace("$('g_back').href = `index.html?p=${PID}`;", "$('g_back').href = '#';")
g_script = g_script.replace("""const [D, GM] = await Promise.all([
  fetch(`data/${PID}.json`, { cache: 'no-store' }).then(r => r.json()),
  fetch(`data/${PID}/games/${G}.json`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
]);""", "const D = window.__NB.page; const GM = window.__NB.games[G] || null;")
g_script = g_script.replace('<video src="data/${src}" muted loop playsinline preload="metadata" poster="${still ? \'data/\' + still : \'\'}"></video>',
                            '<video src="${window.__NB.assets[src] || \'\'}" muted loop playsinline preload="metadata" poster="${window.__NB.assets[still] || \'\'}"></video>')
g_script = g_script.replace("${src ? `<video", "${src && window.__NB.assets[src] ? `<video")
g_script = g_script.replace('<img src="data/${still}" alt="">', '<img src="${window.__NB.assets[still] || \'\'}" alt="">')
assert 'window.__NB.games[G]' in g_script
# the game script becomes a function the router calls; strip the opening helper lines it shares with the dashboard
g_script = re.sub(r"^\s*const \$ = id => document\.getElementById\(id\);\s*\n", "", g_script)
g_script = re.sub(r"^\s*const qs = new URLSearchParams\(location\.search\);\s*\n", "", g_script)
g_script = re.sub(r"^\s*const PID = .*\n", "", g_script)
g_func = f"""
const $ = id => document.getElementById(id);
const PID = {json.dumps(pid)};
window.showGame = function (G) {{
{g_script}
}};
function route() {{
  const m = /^#g-(\\d{{4}}-\\d{{2}}-\\d{{2}})$/.exec(location.hash);
  const g = m ? m[1] : null;
  document.getElementById('viewDash').hidden = !!g;
  document.getElementById('viewGame').hidden = !g;
  if (g) window.showGame(g);
  window.scrollTo(0, 0);
}}
addEventListener('hashchange', route);
route();
"""

title = f"{page['pitcher']['name'].split()[-1]} Tip Report"
out = f"""<title>{title}</title>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
:root{{color-scheme:dark}}
{d_style}
#viewGame{{
{g_style}
}}
body{{background:var(--bg);color:var(--ink)}}
.wrap{{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}}
#games,#g_summary{{overflow-x:auto;-webkit-overflow-scrolling:touch}}
#games table,#g_summary table{{min-width:540px}}
.scroll{{margin:0;padding:0}}
.share-note{{font-size:11px;color:var(--dim);text-align:center;padding:10px 0 0}}
</style>
<script>window.__NB = {{ page: {json.dumps(page)}, games: {json.dumps(games)}, assets: {json.dumps(assets)} }};</script>
<div id="viewDash">
{d_markup}
<div class="share-note">Shared copy from No Brand Baseball Analytics.</div>
</div>
<div id="viewGame" hidden>
{g_markup}
</div>
<script type="module">
{d_script}
</script>
<script type="module">
{g_func}
</script>
"""
if a.full:
    NL = chr(10)
    head = ('<!DOCTYPE html>' + NL + '<html lang="en">' + NL + '<head>' + NL + '<meta charset="utf-8">' + NL
            + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' + NL
            + '<style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>' + NL)
    out = head + out.replace(NL + '<link', NL + '</head>' + NL + '<body>' + NL + '<link', 1) + NL + '</body>' + NL + '</html>' + NL
Path(a.out).write_text(out, encoding='utf-8')
print(f'wrote {a.out}: {len(out)/1024:.0f} KB, {len(games)} games, {len(assets)} assets' + (f', {copied} copied' if a.copy_assets else ''))
