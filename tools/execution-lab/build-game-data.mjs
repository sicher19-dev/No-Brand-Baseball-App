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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gradePlan, missVector, median, score } from '../../www/lab/execution/engine.js';
import { readCsv, hitterZones, pitchFromRow, reportData } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [id, name, hand] = process.argv.slice(2);
if (!id || !name) { console.error('usage: build-game-data.mjs <id> "<Name>" [RHP|LHP]'); process.exit(2); }

const rows = readCsv(join(ROOT, 'private', `${id}_execution_pitch_level_INTERNAL.csv`));
const planRule = JSON.parse(readFileSync(join(ROOT, 'private', 'plan_rules', `${id}.json`), 'utf8'));
const reportPath = join(ROOT, 'private', `${id}_execution.html`);
const D = existsSync(reportPath) ? reportData(readFileSync(reportPath, 'utf8')) : null;
const zones = hitterZones(rows);

// Batter names from the built report, keyed by game date + at-bat + pitch.
const names = {};
if (D) for (const S of D.starts) for (const p of S.pitches) names[`${S.meta.date}|${p[1]}|${p[2]}`] = p[3];

const famName = (D && D.fam_name) || { FF: 'Four-seam', SI: 'Sinker', FS: 'Splitter', CH: 'Changeup', ST: 'Sweeper', SL: 'Slider', CU: 'Curveball' };

const games = {};
for (const r of rows) {
  const g = games[r.game_date] || (games[r.game_date] = { date: r.game_date, opp: r.opp, home: r.home === 'True', pitches: [] });
  const pitch = pitchFromRow(r, zones[r.batter]);
  const res = gradePlan(pitch, planRule);
  if (!res) { console.warn('no rule for', r.game_date, r.pitch_type, r.state, r.stand); continue; }
  const m = missVector([pitch.x, pitch.z], res.target);
  g.pitches.push({
    inn: +r.inning, ab: +r.at_bat_number, pn: +r.pitch_number,
    bat: names[`${r.game_date}|${r.at_bat_number}|${r.pitch_number}`] || '',
    st: r.stand, b: +r.balls, s: +r.strikes, pt: r.pitch_type, fam: r.family,
    x: pitch.x, z: +pitch.z.toFixed(3), zn: pitch.zn,
    g: res.grade, td: +res.tdist.toFixed(2), dir: res.miss_dir, desc: r.description,
    tgt: [+res.target[0].toFixed(3), +res.target[1].toFixed(3)],
    m: [+m[0].toFixed(2), +m[1].toFixed(2)],
    zone: zones[r.batter] ? [+zones[r.batter].bot.toFixed(3), +zones[r.batter].top.toFixed(3)] : null,
    pid: r.play_id,
  });
}
const list = Object.values(games).sort((a, b) => a.date.localeCompare(b.date));
list.forEach(g => { g.pitches.sort((a, b) => a.inn - b.inn || a.ab - b.ab || a.pn - b.pn); g.pitches.forEach((p, i) => p.i = i + 1); g.n = g.pitches.length; });

// Score anchor for the plan layer, until a league line is available: the
// pitcher's own season average miss. A pitch that misses by that much scores
// 50; executed pitches score 100.
const all = list.flatMap(g => g.pitches);
const tds = all.map(p => p.td);
const meanMiss = tds.reduce((s, d) => s + d, 0) / tds.length;
const seasonScore = tds.reduce((s, d) => s + score(d, meanMiss), 0) / tds.length;
const baseline = { plan: +meanMiss.toFixed(2), kind: 'season-mean', median_miss: +median(tds).toFixed(2), season_score: +seasonScore.toFixed(1) };

const out = {
  schema: 'nb.execution_page/1',
  pitcher: { id, name, hand: hand || '' },
  season: list[0].date.slice(0, 4),
  built: new Date().toISOString().slice(0, 10),
  rules_version: planRule.version,
  baseline,
  fam_name: famName,
  games: list,
};
const outPath = join(ROOT, 'www', 'lab', 'execution', 'data', `${id}.json`);
writeFileSync(outPath, JSON.stringify(out));
console.log(`wrote ${outPath}: ${list.length} games, ${all.length} pitches, baseline plan miss ${baseline.plan} in, ${Object.keys(names).length ? 'batter names joined' : 'no batter names'}`);
