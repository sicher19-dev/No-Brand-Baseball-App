#!/usr/bin/env node
// Execution Lab: turn a harvested clip list into the page's clip map.
//
//   node tools/execution-lab/clips-from-tsv.mjs skenes
//
// Reads  private/clips/<id>.tsv.gz   (from harvest-clips.browser.js)
// Writes www/lab/execution/data/<id>-clips.json   (gitignored: local only)
// and reports any pitch in data/<id>.json that has no clip.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const id = process.argv[2];
if (!id) { console.error('usage: clips-from-tsv.mjs <id>'); process.exit(2); }

const P = 'https://sporty-clips.mlb.com/';
const tsv = gunzipSync(readFileSync(join(ROOT, 'private', 'clips', `${id}.tsv.gz`))).toString('utf8');
const out = {};
for (const line of tsv.trim().split('\n')) {
  const [g, h, hh] = line.split('\t');
  out[g] = {};
  if (h) out[g].h = P + h + '.mp4';
  if (hh) out[g].hh = P + hh + '.mp4';
}
const outPath = join(ROOT, 'www', 'lab', 'execution', 'data', `${id}-clips.json`);
writeFileSync(outPath, JSON.stringify(out));

const dataPath = join(ROOT, 'www', 'lab', 'execution', 'data', `${id}.json`);
let missing = null;
if (existsSync(dataPath)) {
  const d = JSON.parse(readFileSync(dataPath, 'utf8'));
  const pids = d.games.flatMap(g => g.pitches.map(p => p.pid));
  missing = pids.filter(p => !out[p]).length + ' of ' + pids.length;
}
console.log(`wrote ${outPath}: ${Object.keys(out).length} pitches${missing ? `, pitches without a clip: ${missing}` : ''}`);
