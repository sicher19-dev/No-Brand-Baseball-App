#!/usr/bin/env node
// Tip Detection: per-pitch situation labels (runners, outs, count, score,
// times through the order) from the public league game feed, keyed by play id.
//
//   node tools/tip/situations-from-feed.mjs skenes [--season 2026] [--pitcher 694973]
//
// Reads  the game_pk list from private/<id>_execution_pitch_level_INTERNAL.csv
//        (columns game_date, game_pk, play_id) or private/tip/<id>/games-<season>.txt
// Caches private/tip/<id>/feed/<game_pk>.json
// Writes private/tip/<id>/situations-<season>.csv  (one row per pitch by our pitcher)
//
// State before each pitch is rebuilt by walking the plays in order: runner
// movements carry the index of the pitch they happened on, so a steal on
// pitch 2 counts from pitch 3 on. Internal use only: the source is never
// named on anything a player sees.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const id = args[0];
if (!id || id.startsWith('--')) { console.error('usage: situations-from-feed.mjs <id> [--season 2026] [--pitcher <league id>]'); process.exit(2); }
const opt = k => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : null; };
const SEASON = opt('--season') || '2026';
const PITCHER = opt('--pitcher') ? +opt('--pitcher') : null;

const dir = join(ROOT, 'private', 'tip', id);
const feedDir = join(dir, 'feed');
mkdirSync(feedDir, { recursive: true });

// Game list: from the internal pitch file (game_date,game_pk,...) for the season.
const games = new Set();
const csvPath = join(ROOT, 'private', `${id}_execution_pitch_level_INTERNAL.csv`);
const listPath = join(dir, `games-${SEASON}.txt`);
if (existsSync(listPath)) {
  for (const l of readFileSync(listPath, 'utf8').split(/\r?\n/)) if (l.trim()) games.add(+l.trim());
} else if (existsSync(csvPath)) {
  const lines = readFileSync(csvPath, 'utf8').trim().split('\n');
  const h = lines[0].split(','), di = h.indexOf('game_date'), gi = h.indexOf('game_pk');
  for (const l of lines.slice(1)) { const f = l.split(','); if (f[di].startsWith(SEASON)) games.add(+f[gi]); }
} else { console.error(`no game list: ${listPath} or ${csvPath}`); process.exit(1); }

async function feed(pk) {
  const p = join(feedDir, `${pk}.json`);
  if (!existsSync(p)) {
    const res = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${pk}/feed/live`, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`feed ${pk}: http ${res.status}`);
    writeFileSync(p, await res.text());
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

const BASES = { '1B': 1, '2B': 2, '3B': 3 };
const out = [['play_id', 'game_pk', 'game_date', 'inning', 'half', 'outs', 'balls', 'strikes', 'on_1b', 'on_2b', 'on_3b', 'runners', 'score_for', 'score_against', 'batter_id', 'bat_side', 'tto', 'pitch_num_game', 'pitch_num_ab', 'feed_pitch_type', 'feed_result'].join(',')];
let nGames = 0, nPitches = 0;

for (const pk of [...games].sort()) {
  const g = await feed(pk);
  nGames++;
  const home = g.gameData.teams.home.id;
  const date = g.gameData.datetime.officialDate;
  const plays = g.liveData.plays.allPlays;
  // Who is our pitcher: the given id, else the pitcher with most pitches among plays.
  let pitcherId = PITCHER;
  if (!pitcherId) {
    const c = {}; for (const p of plays) c[p.matchup.pitcher.id] = (c[p.matchup.pitcher.id] || 0) + p.playEvents.filter(e => e.isPitch).length;
    pitcherId = +Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
  }
  let half = null, bases = [0, 0, 0], outs = 0, score = { home: 0, away: 0 }, pitchNum = 0;
  const seen = {}; // batter id -> plate appearances so far vs our pitcher
  for (const p of plays) {
    const key = `${p.about.inning}-${p.about.halfInning}`;
    if (key !== half) { half = key; bases = [0, 0, 0]; outs = 0; }
    const ours = p.matchup.pitcher.id === pitcherId;
    if (ours) seen[p.matchup.batter.id] = (seen[p.matchup.batter.id] || 0) + 1;
    const moves = (p.runners || []).map(r => ({ i: r.details?.playIndex ?? 0, start: r.movement?.start, end: r.movement?.end, out: !!r.movement?.isOut, runner: r.details?.runner?.id }));
    moves.sort((a, b) => a.i - b.i);
    let mi = 0; let balls = 0, strikes = 0, pitchInAb = 0;
    const applyUpTo = (idx) => {
      while (mi < moves.length && moves[mi].i < idx) {
        const m = moves[mi++];
        if (m.start && BASES[m.start]) bases[BASES[m.start] - 1] = 0;
        if (m.end && BASES[m.end]) bases[BASES[m.end] - 1] = m.runner || 1;
        if (m.out) outs++;
      }
    };
    for (const e of p.playEvents) {
      if (!e.isPitch) continue;
      applyUpTo(e.index);
      if (ours) {
        pitchNum++; pitchInAb++; nPitches++;
        const isHome = p.matchup.pitcher.id === pitcherId && g.liveData.boxscore.teams.home.pitchers?.includes(pitcherId);
        const sFor = isHome ? score.home : score.away, sAg = isHome ? score.away : score.home;
        const code = (bases[0] ? '1' : '0') + (bases[1] ? '2' : '0') + (bases[2] ? '3' : '0');
        out.push([e.playId, pk, date, p.about.inning, p.about.halfInning, outs, balls, strikes, bases[0] ? 1 : 0, bases[1] ? 1 : 0, bases[2] ? 1 : 0, code,
          sFor, sAg, p.matchup.batter.id, p.matchup.batSide.code, seen[p.matchup.batter.id], pitchNum, pitchInAb, e.details?.type?.code || '', e.details?.code || ''].join(','));
      }
      balls = e.count.balls; strikes = e.count.strikes;
    }
    applyUpTo(Infinity);
    // Outs and score after the play come from the feed, which also fixes any drift.
    outs = p.count.outs;
    if (p.result.homeScore != null) score = { home: p.result.homeScore, away: p.result.awayScore };
  }
}
const outPath = join(dir, `situations-${SEASON}.csv`);
writeFileSync(outPath, out.join('\n') + '\n');
console.log(`wrote ${outPath}: ${nPitches} pitches in ${nGames} games`);
