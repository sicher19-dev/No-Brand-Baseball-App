#!/usr/bin/env node
// Execution Lab: turn a harvested pitch list (from the video provider's
// pitch log, see harvest-pitches.browser.js) into the internal pitch-file
// layout the page build reads, plus its clip map.
//
//   node tools/execution-lab/pitches-from-harvest.mjs skenes 2025
//
// Reads  private/harvest/<id>-<season>.tsv.gz
// Writes private/<id>_<season>_pitch_level_HARVEST.csv
//        private/clips/<id>-<season>.tsv.gz  (same shape as the 2026 clip list)
//
// The harvest carries the provider's normalized location: x in plate
// half-widths with the sign flipped relative to the internal file, and y from
// -1 at the bottom of the hitter's zone to +1 at the top. Checked against 400
// pitches of the internal 2026 file: plate_x = -x * 0.708 and
// zn = (y + 1) / 2, both exact to a thousandth. Feet of height need the
// hitter's zone, which the harvest does not carry, so plate_z uses a typical
// zone (bottom 1.55 ft, height 1.58 ft) and is approximate.
// Pitch types: the provider's FT (two-seam) is the file's SI; it does not
// split sweeper from slider in 2025, so those are SL.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [id, season] = process.argv.slice(2);
if (!id || !season) { console.error('usage: pitches-from-harvest.mjs <id> <season>'); process.exit(2); }

const PLATE_HALF = 0.708, ZONE_BOT = 1.55, ZONE_H = 1.58;
const src = join(ROOT, 'private', 'harvest', `${id}-${season}.tsv.gz`);
const tsv = gunzipSync(readFileSync(src)).toString('utf8');

const rows = [], clips = [];
for (const line of tsv.trim().split('\n')) {
  const f = line.split('\t');
  const [pid, gameDate, home, opp, inn, outs, ab, pn, batter, hand, count, pt, x, y, result, venue, h, hh] = f;
  if (!gameDate || !gameDate.startsWith(season)) continue;
  const [balls, strikes] = count.split('-').map(Number);
  const inning = +(inn.replace(/\D/g, '') || 0);
  const plate_x = -(+x) * PLATE_HALF, zn = (+y + 1) / 2, plate_z = ZONE_BOT + zn * ZONE_H;
  const type = pt === 'FT' ? 'SI' : pt;
  rows.push({
    game_date: gameDate.slice(0, 10), game_pk: '', play_id: pid, source: 'harvest', opp, home: home === '1' ? 'True' : 'False',
    inning, at_bat_number: +ab, pitch_number: +pn, batter, stand: hand, balls, strikes, pitch_type: type,
    family: type === 'CU' ? 'SL' : type, state: strikes >= 2 ? '2K' : 'pre2K',
    plate_x: +plate_x.toFixed(3), plate_z: +plate_z.toFixed(3), zn: +zn.toFixed(3),
    executed: '', grade: '', tdist: '', miss_dir: '', description: (result || '').toLowerCase().replace(/[^a-z]+/g, '_'), release_speed: '',
  });
  clips.push(`${pid}\t${h}\t${hh}`);
}
rows.sort((a, b) => a.game_date.localeCompare(b.game_date) || a.inning - b.inning || a.at_bat_number - b.at_bat_number || a.pitch_number - b.pitch_number);

const cols = ['game_date','game_pk','play_id','source','opp','home','inning','at_bat_number','pitch_number','batter','stand','balls','strikes','pitch_type','family','state','plate_x','plate_z','zn','executed','grade','tdist','miss_dir','description','release_speed'];
const csv = [cols.join(','), ...rows.map(r => cols.map(c => r[c]).join(','))].join('\n') + '\n';
const out = join(ROOT, 'private', `${id}_${season}_pitch_level_HARVEST.csv`);
writeFileSync(out, csv);
mkdirSync(join(ROOT, 'private', 'clips'), { recursive: true });
writeFileSync(join(ROOT, 'private', 'clips', `${id}-${season}.tsv.gz`), gzipSync(clips.join('\n')));
const games = new Set(rows.map(r => r.game_date));
console.log(`wrote ${out}: ${rows.length} pitches, ${games.size} games, ${clips.length} clip entries`);
