"""Tip Detection: pitch labels from the public league feed, for a pitcher without an
internal pitch file.

  .venv-tip/Scripts/python tools/tip/py/labels_from_feed.py <id> [--season 2026]

Reads  private/tip/<id>/situations-<season>.csv  (from situations-from-feed.mjs)
       private/tip/<id>/feed/<game_pk>.json
Writes private/<id>_execution_pitch_level_INTERNAL.csv  with the columns train.py and
       report.py use (game_date, game_pk, play_id, opp, home, inning, stand, pitch_type, family).
Internal use only: the source is never named on anything a player sees.
"""
import argparse, csv, json
from collections import Counter
from pathlib import Path
import tipkit as tk

ap = argparse.ArgumentParser(); ap.add_argument('pitcher'); ap.add_argument('--season', default='2026')
a = ap.parse_args()
D = tk.pdir(a.pitcher)
info = json.loads((D / 'pitcher.json').read_text(encoding='utf-8'))
team = info.get('team')
rows = list(csv.DictReader(open(D / f'situations-{a.season}.csv', encoding='utf-8')))
teams = {}
for pk in sorted({r['game_pk'] for r in rows}):
    g = json.loads((D / 'feed' / f'{pk}.json').read_text(encoding='utf-8'))
    t = g['gameData']['teams']
    teams[pk] = (t['home'].get('abbreviation') or t['home']['teamCode'].upper(), t['away'].get('abbreviation') or t['away']['teamCode'].upper())
out = Path(tk.ROOT) / 'private' / f'{a.pitcher}_execution_pitch_level_INTERNAL.csv'
fields = ['game_date', 'game_pk', 'play_id', 'source', 'opp', 'home', 'inning', 'at_bat_number', 'pitch_number', 'batter', 'stand', 'balls', 'strikes', 'pitch_type', 'family', 'description']
n = Counter(); skipped = 0
with open(out, 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=fields); w.writeheader()
    for r in rows:
        home_ab, away_ab = teams[r['game_pk']]
        home = home_ab == team
        pt = r['feed_pitch_type'] or ''
        if not pt:
            skipped += 1; continue
        n[pt] += 1
        w.writerow(dict(game_date=r['game_date'], game_pk=r['game_pk'], play_id=r['play_id'], source='feed', opp=away_ab if home else home_ab,
                        home=home, inning=r['inning'], at_bat_number='', pitch_number=r['pitch_num_ab'], batter=r['batter_id'], stand=r['bat_side'],
                        balls=r['balls'], strikes=r['strikes'], pitch_type=pt, family=tk.FAMILY.get(pt, pt), description=r['feed_result']))
print(f'wrote {out}: {sum(n.values())} pitches, {skipped} without a type; types {dict(n.most_common())}')
print('groups', {g: sum(c for t, c in n.items() if tk.GROUP.get(t) == g) for g in ('FB', 'BR', 'OS')}, 'unmapped', [t for t in n if t not in tk.GROUP])
