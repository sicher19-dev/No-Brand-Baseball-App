// Execution Lab acceptance test: grade the internal pitch-level file with the
// engine and the plan rules, and compare pitch for pitch with the grades the
// built report carries. Skips when private/ is not present (CI, other machines).
//
// Writes private/acceptance_report.md with every mismatch. Rules are never
// adjusted here to force a match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gradePlan, stateOf, familyOf } from '../../www/lab/execution/engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSV = join(ROOT, 'private', 'skenes_execution_pitch_level_INTERNAL.csv');
const RULES = join(ROOT, 'private', 'plan_rules', 'skenes.json');
const REPORT = join(ROOT, 'private', 'acceptance_report.md');
const have = existsSync(CSV) && existsSync(RULES);

function readCsv(path) {
  const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  const head = lines[0].split(',');
  return lines.slice(1).map(l => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])));
}

// The file carries plate_z (feet) and zn (zone units) but not the hitter's
// zone. zn is linear in plate_z per hitter, so each hitter's zone bottom and
// height come back from a least-squares fit of plate_z on zn.
function hitterZones(rows) {
  const by = {};
  for (const r of rows) (by[r.batter] = by[r.batter] || []).push([+r.zn, +r.plate_z]);
  const zones = {};
  for (const [b, pts] of Object.entries(by)) {
    const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
    const sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
    const h = sxx > 1e-6 ? pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / sxx : null;
    zones[b] = h ? { bot: my - h * mx, top: my - h * mx + h, fit: n } : null;
  }
  return zones;
}

// The file rounds x and zn to three decimals. A pitch within half a unit of
// that rounding of any box or heart edge cannot be placed on one side or the
// other from this file, so a disagreement there says nothing about the rules.
const ROUND = 0.0005 + 1e-9;
function onAnEdge(pitch, g, planRule) {
  const edges = [];
  for (const b of g.rule.boxes) edges.push([pitch.x, b[0]], [pitch.x, b[1]], [pitch.zn, b[2]], [pitch.zn, b[3]]);
  const h = planRule.heart;
  if (h) edges.push([Math.abs(pitch.x), h.x_half], [pitch.zn, h.lo], [pitch.zn, h.hi]);
  return edges.some(([v, e]) => Math.abs(v - e) <= ROUND);
}

test('grades match the built report pitch for pitch', { skip: !have && 'private/ inputs not present' }, () => {
  const rows = readCsv(CSV);
  const planRule = JSON.parse(readFileSync(RULES, 'utf8'));
  const zones = hitterZones(rows);
  const counts = {}, mism = [], edgeMism = [], dirMism = [], tdOff = [];
  let noRule = 0, noZone = 0;

  for (const r of rows) {
    const zone = zones[r.batter];
    if (!zone) noZone++;
    const pitch = {
      x: +r.plate_x, z: +r.plate_z, zn: +r.zn, zone: zone || undefined,
      family: r.family, pitch_type: r.pitch_type, balls: +r.balls, strikes: +r.strikes, stand: r.stand,
    };
    assert.equal(stateOf(pitch.balls, pitch.strikes), r.state, `state column disagrees with the count on ${r.play_id}`);
    assert.equal(familyOf(r.pitch_type, planRule), r.family, `family column disagrees with the family map on ${r.play_id}`);
    const g = gradePlan(pitch, planRule);
    if (!g) { noRule++; continue; }
    const k = r.grade + ' -> ' + g.grade;
    counts[k] = (counts[k] || 0) + 1;
    if (g.grade !== r.grade) (onAnEdge(pitch, g, planRule) ? edgeMism : mism).push({ r, g });
    if (g.miss_dir !== r.miss_dir) dirMism.push({ r, g });
    if (Math.abs(g.tdist - +r.tdist) > 0.05) tdOff.push({ r, g });
  }

  const total = rows.length - noRule;
  const row = ({ r, g }) => `| ${r.game_date} | ${r.inning} | ${r.at_bat_number} | ${r.pitch_number} | ${r.pitch_type} | ${r.state} | ${r.stand} | ${r.plate_x} | ${r.zn} | ${r.grade} | ${g.grade} | ${r.tdist} | ${g.tdist.toFixed(3)} |`;
  const head = ['| date | inn | ab | # | pitch | state | stand | x | zn | report | engine | report tdist | engine tdist |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  const lines = [
    '# Execution Lab acceptance: engine vs built report',
    '',
    `Pitches: ${rows.length}. Graded: ${total}. No rule: ${noRule}. No fitted zone: ${noZone}.`,
    `Grade mismatches: ${mism.length}. On-an-edge disagreements (undecidable at the file's rounding): ${edgeMism.length}.`,
    `Miss-direction mismatches: ${dirMism.length}. Target distance off by more than 0.05 in: ${tdOff.length}.`,
    '',
    '## Grade transitions (report -> engine)',
    ...Object.entries(counts).sort().map(([k, v]) => `- ${k}: ${v}`),
    '',
    '## Grade mismatches',
    ...head, ...mism.map(row),
    '',
    '## On-an-edge disagreements',
    'The pitch sits within 0.0005 (x in feet, or zn) of a box or heart edge. The file is rounded to three decimals, so the report graded it from a more precise location than this file holds.',
    ...head, ...edgeMism.map(row),
    '',
    '## Miss-direction mismatches (informational)',
    '| date | inn | ab | # | pitch | state | stand | x | zn | grade | report | engine |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...dirMism.map(({ r, g }) => `| ${r.game_date} | ${r.inning} | ${r.at_bat_number} | ${r.pitch_number} | ${r.pitch_type} | ${r.state} | ${r.stand} | ${r.plate_x} | ${r.zn} | ${r.grade} | ${r.miss_dir} | ${g.miss_dir} |`),
    '',
    '## Target distance off by more than 0.05 in (informational)',
    '| date | inn | ab | # | pitch | state | stand | x | zn | grade | report | engine |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...tdOff.map(({ r, g }) => `| ${r.game_date} | ${r.inning} | ${r.at_bat_number} | ${r.pitch_number} | ${r.pitch_type} | ${r.state} | ${r.stand} | ${r.plate_x} | ${r.zn} | ${r.grade} | ${r.tdist} | ${g.tdist.toFixed(3)} |`),
    '',
  ];
  writeFileSync(REPORT, lines.join('\n'));
  console.log(lines.slice(2, 5).join('\n') + `\nFull report: ${REPORT}`);

  assert.equal(noRule, 0, 'every pitch should resolve to a rule');
  assert.equal(mism.length, 0, `${mism.length} grade mismatches, see ${REPORT}`);
  assert.ok(edgeMism.length <= 2, `${edgeMism.length} on-an-edge disagreements is more than rounding explains, see ${REPORT}`);
});
