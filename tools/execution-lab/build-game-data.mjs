#!/usr/bin/env node
// Execution Lab: grade a pitcher's internal pitch file with the private plan
// rules and write the page data the app ships.
//
//   node tools/execution-lab/build-game-data.mjs skenes "Paul Skenes" RHP
//
// Reads  private/<id>_execution_pitch_level_INTERNAL.csv
//        private/plan_rules/<id>.json
//        private/<id>_execution.html        (optional: batter names, family names)
// Writes www/lab/execution/data/<id>.json
//
// What ships: per-pitch location, count, batter name, grade, miss vector and
// plan target. What stays behind: the rules themselves, velocity, and every
// other internal column.
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gradePlan, missVector, median, score } from '../../www/lab/execution/engine.js';
import { readCsv, hitterZones, pitchFromRow, reportData } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [id, name, hand, team] = process.argv.slice(2);
if (!id || !name) { console.error('usage: build-game-data.mjs <id> "<Name>" [RHP|LHP] [TEAM]'); process.exit(2); }

// Pitch files: the internal file (report-graded) plus any harvested seasons
// (private/<id>_<season>_pitch_level_HARVEST.csv from pitches-from-harvest.mjs).
const rows = readCsv(join(ROOT, 'private', `${id}_execution_pitch_level_INTERNAL.csv`));
for (const f of readdirSync(join(ROOT, 'private'))) {
  const m = f.match(new RegExp(`^${id}_(\\d{4})_pitch_level_HARVEST\\.csv$`));
  if (m) rows.push(...readCsv(join(ROOT, 'private', f)));
}
const planRule = JSON.parse(readFileSync(join(ROOT, 'private', 'plan_rules', `${id}.json`), 'utf8'));
const reportPath = join(ROOT, 'private', `${id}_execution.html`);
const D = existsSync(reportPath) ? reportData(readFileSync(reportPath, 'utf8')) : null;
// Hitter zones fit from the internal file only; harvested rows carry a typical zone already.
const zones = hitterZones(rows.filter(r => r.source !== 'harvest'));

// Batter names from the built report, keyed by game date + at-bat + pitch.
const names = {};
if (D) for (const S of D.starts) for (const p of S.pitches) names[`${S.meta.date}|${p[1]}|${p[2]}`] = p[3];

const famName = (D && D.fam_name) || { FF: 'Four-seam', SI: 'Sinker', FS: 'Splitter', CH: 'Changeup', ST: 'Sweeper', SL: 'Slider', CU: 'Curveball' };

const games = {};
for (const r of rows) {
  const g = games[r.game_date] || (games[r.game_date] = { date: r.game_date, opp: r.opp, home: r.home === 'True', pitches: [] });
  const harvested = r.source === 'harvest';
  const pitch = pitchFromRow(r, harvested ? { bot: 1.55, top: 3.13 } : zones[r.batter]);
  const res = gradePlan(pitch, planRule);
  if (!res) { console.warn('no rule for', r.game_date, r.pitch_type, r.state, r.stand); continue; }
  g.season = r.game_date.slice(0, 4); g.approx = harvested || undefined;
  // The plan-layer miss runs to the nearest executed ground (heart cut out), so dead-middle scores as a miss.
  const m = missVector([pitch.x, pitch.z], res.target_good);
  g.pitches.push({
    inn: +r.inning, ab: +r.at_bat_number, pn: +r.pitch_number,
    bat: names[`${r.game_date}|${r.at_bat_number}|${r.pitch_number}`] || (harvested ? r.batter : ''),
    st: r.stand, b: +r.balls, s: +r.strikes, pt: r.pitch_type, fam: r.family,
    x: pitch.x, z: +pitch.z.toFixed(3), zn: pitch.zn,
    g: res.grade, td: +res.tdist.toFixed(2), dir: res.miss_dir, desc: r.description,
    tgt: [+res.target_good[0].toFixed(3), +res.target_good[1].toFixed(3)],
    m: [+m[0].toFixed(2), +m[1].toFixed(2)],
    zone: pitch.zone ? [+pitch.zone.bot.toFixed(3), +pitch.zone.top.toFixed(3)] : null,
    pid: r.play_id,
  });
}
const everyGame = Object.values(games).sort((a, b) => a.date.localeCompare(b.date));
everyGame.forEach(g => { g.pitches.sort((a, b) => a.inn - b.inn || a.ab - b.ab || a.pn - b.pn); g.pitches.forEach((p, i) => p.i = i + 1); g.n = g.pitches.length; });
const seasons = [...new Set(everyGame.map(g => g.season))].sort();
const latest = seasons[seasons.length - 1];
const list = everyGame.filter(g => g.season === latest);

// Score anchor for the plan layer, until a league line is available: the
// pitcher's average miss in his latest season. A pitch that misses by that
// much scores 50; executed pitches score 100. One anchor for every season,
// so seasons compare on the same line.
const all = list.flatMap(g => g.pitches);
const tds = all.map(p => p.td);
const meanMiss = tds.reduce((s, d) => s + d, 0) / tds.length;
const cs = planRule.centered_score;
// A league line, when league-from-harvest.mjs has built one for the latest
// season, replaces the pitcher's own mean miss as the anchor: 50 = the league.
const leaguePath = join(ROOT, 'www', 'lab', 'execution', 'data', `league-${latest}.json`);
const league = existsSync(leaguePath) ? JSON.parse(readFileSync(leaguePath, 'utf8')) : null;
const anchor = league ? league.anchor : meanMiss;
const seasonScoreOf = P => P.reduce((s, p) => s + (p.g === 'centered' && cs != null ? cs : score(Math.hypot(p.m[0], p.m[1]), anchor)), 0) / P.length;
const baseline = league
  ? { plan: +anchor.toFixed(3), kind: 'league', anchor_season: latest, league_pitchers: league.pitchers, league_pitches: league.pitches, league_score: league.score, median_miss: +median(tds).toFixed(2), own_mean_miss: +meanMiss.toFixed(2), season_score: +seasonScoreOf(all).toFixed(1) }
  : { plan: +meanMiss.toFixed(2), kind: 'season-mean', anchor_season: latest, median_miss: +median(tds).toFixed(2), season_score: +seasonScoreOf(all).toFixed(1) };

const out = {
  schema: 'nb.execution_page/2',
  pitcher: { id, name, hand: hand || '', team: team || '' },   // team = home park key for camera calibrations
  season: latest,
  seasons: Object.fromEntries(seasons.map(s => { const G = everyGame.filter(g => g.season === s); const P = G.flatMap(g => g.pitches); return [s, { games: G.length, pitches: P.length, score: +seasonScoreOf(P).toFixed(1), approx: G.some(g => g.approx) || undefined }]; })),
  built: new Date().toISOString().slice(0, 10),
  rules_version: planRule.version,
  baseline,
  policy: { centered_score: planRule.centered_score == null ? null : planRule.centered_score },
  fam_name: famName,
  games: everyGame,
};
const outPath = join(ROOT, 'www', 'lab', 'execution', 'data', `${id}.json`);
writeFileSync(outPath, JSON.stringify(out));
console.log(`wrote ${outPath}: ${everyGame.length} games over ${seasons.join(', ')}; anchor ${latest} mean miss ${baseline.plan} in; ${JSON.stringify(out.seasons)}`);
