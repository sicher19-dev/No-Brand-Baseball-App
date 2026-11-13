#!/usr/bin/env node
// Execution Lab: the league line. Grades every harvested league pitch with a
// pitcher's plan rules (the report's approach: the league graded with these
// same targets) and writes the aggregates the page anchors its score on.
//
//   node tools/execution-lab/league-from-harvest.mjs skenes 2026
//
// Reads  private/harvest/league-<season>-*.tsv.gz   (pid, name, x, y, type, hitter hand, balls, strikes)
//        private/plan_rules/<id>.json
// Writes www/lab/execution/data/league-<season>.json  (aggregates only: no names, no pitch rows)
//
// Location comes from the provider's normalized feed (plate_x = -x * 0.708,
// zn = (y + 1) / 2) with a typical hitter zone for heights, the same as a
// harvested season. The provider's FT is SI; CU grades as SL.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gradePlan, missVector, score, median, mean, stateOf } from '../../www/lab/execution/engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [id, season] = process.argv.slice(2);
if (!id || !season) { console.error('usage: league-from-harvest.mjs <id> <season>'); process.exit(2); }

const planRule = JSON.parse(readFileSync(join(ROOT, 'private', 'plan_rules', `${id}.json`), 'utf8'));
const dir = join(ROOT, 'private', 'harvest');
const files = readdirSync(dir).filter(f => f.startsWith(`league-${season}-`) && f.endsWith('.tsv.gz'));
if (!files.length) { console.error('no league harvest files in private/harvest'); process.exit(1); }

const ZONE = { bot: 1.55, top: 3.13 };
const cs = planRule.centered_score;
const byPitcher = {}, cells = {}, allMiss = [], allScoreParts = [];
let n = 0, noRule = 0;
const cellOf = k => cells[k] || (cells[k] = { n: 0, E: 0, N: 0, C: 0, miss: [] });

for (const f of files) {
  for (const line of gunzipSync(readFileSync(join(dir, f))).toString('utf8').trim().split('\n')) {
    const [pid, , x, y, pt0, hand, b, s] = line.split('\t');
    if (!pid || x === '' || y === '') continue;
    const pt = pt0 === 'FT' ? 'SI' : pt0 === 'KC' ? 'CU' : pt0;
    const zn = (+y + 1) / 2;
    const pitch = { x: -(+x) * 0.708, z: ZONE.bot + zn * (ZONE.top - ZONE.bot), zn, zone: ZONE, family: pt === 'CU' ? 'SL' : pt, pitch_type: pt, balls: +b, strikes: +s, stand: hand };
    const g = gradePlan(pitch, planRule);
    if (!g) { noRule++; continue; }
    n++;
    const d = Math.hypot(...missVector([pitch.x, pitch.z], g.target_good));
    allMiss.push(g.tdist);
    const P = byPitcher[pid] || (byPitcher[pid] = { miss: [], d: [], centered: [] });
    P.miss.push(g.tdist); P.d.push(d); P.centered.push(g.grade === 'centered');
    for (const k of [`${g.rule.family}|${stateOf(+b, +s)}`, 'all']) { const c = cellOf(k); c.n++; if (g.grade === 'executed') c.E++; if (g.grade === 'near') c.N++; if (g.grade === 'centered') c.C++; c.miss.push(g.tdist); }
  }
}

// The anchor: the miss distance that makes the league's average pitcher score
// exactly 50, so "50 = league average" holds on the page. (Scoring is a bell
// curve of the miss, so the league's mean miss itself would not land on 50.)
const scoreWith = (P, L) => mean(P.d.map((d, i) => P.centered[i] && cs != null ? cs : score(d, L)));
const leagueMeanAt = L => mean(Object.values(byPitcher).map(P => scoreWith(P, L)));
let lo = 0.25, hi = 24;
for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (leagueMeanAt(mid) < 50) lo = mid; else hi = mid; }
const anchor = (lo + hi) / 2;
const scoreOf = P => scoreWith(P, anchor);
const pitcherScores = Object.values(byPitcher).map(scoreOf).sort((a, b) => a - b);
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
const out = {
  schema: 'nb.league/1', season, rules_version: planRule.version, built: new Date().toISOString().slice(0, 10),
  pitchers: Object.keys(byPitcher).length, pitches: n,
  anchor: +anchor.toFixed(3), mean_miss: +mean(allMiss).toFixed(2), median_miss: +median(allMiss).toFixed(2),
  score: { mean: +mean(pitcherScores).toFixed(1), p10: +pct(pitcherScores, .1).toFixed(1), p25: +pct(pitcherScores, .25).toFixed(1), p50: +pct(pitcherScores, .5).toFixed(1), p75: +pct(pitcherScores, .75).toFixed(1), p90: +pct(pitcherScores, .9).toFixed(1), all: pitcherScores.map(v => +v.toFixed(1)) },
  cells: Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, { n: c.n, exec: +(c.E / c.n).toFixed(4), near: +(c.N / c.n).toFixed(4), cent: +(c.C / c.n).toFixed(4), miss: +mean(c.miss).toFixed(2), median_miss: +median(c.miss).toFixed(2) }])),
  note: 'Qualified right-handed starters, graded against this pitcher’s plan. Aggregates only.',
};
const outPath = join(ROOT, 'www', 'lab', 'execution', 'data', `league-${season}.json`);
writeFileSync(outPath, JSON.stringify(out));
console.log(`wrote ${outPath}: ${out.pitchers} pitchers, ${n} pitches (${noRule} without a rule), anchor ${out.anchor} in, league score mean ${out.score.mean} (p10 ${out.score.p10}, p90 ${out.score.p90})`);
