#!/usr/bin/env node
// Tip Detection: download per-pitch clips from the team video server.
//
//   node tools/tip/download-clips.mjs skenes --views cf,hitter [--season 2026]
//        [--jobs 4] [--limit 20] [--date 2026-09-24] [--from 2026-03-26] [--dry]
//
// Reads  private/tip/<id>/clips-<season>-all-angles.tsv  (from harvest-angles.browser.js)
// Writes private/tip/<id>/clips/<letter>/<play_id>.mp4
//        private/tip/<id>/download-log.tsv   (one line per attempt)
//
// Views: a letter (C, D, J, V, L, ...) or an alias:
//   cf      C  center-field broadcast framing (clean, every pitch)
//   tightcf V  tight on the pitcher from center field
//   hitter  D  open-side plate camera; falls back to J (closed side) when D is missing
//   hs      L  high-speed center field
//
// Resumable: a file that already exists with a plausible size is skipped.
// Nothing here is part of the app. Keep provider hosts out of anything a player sees.
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, appendFileSync, renameSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// The team video server is not named in the repository: put its origin (with a
// trailing slash) in private/tip/video-host.txt or NB_TEAM_VIDEO_HOST.
const HOST_FILE = join(ROOT, 'private', 'tip', 'video-host.txt');
const HOST = (process.env.NB_TEAM_VIDEO_HOST || (existsSync(HOST_FILE) ? readFileSync(HOST_FILE, 'utf8') : '')).trim();
if (!HOST) { console.error('missing team video host: write it to private/tip/video-host.txt'); process.exit(1); }
const ALIAS = { cf: ['C'], tightcf: ['V'], hitter: ['D', 'J'], hs: ['L'] };
const MIN_BYTES = 200 * 1024;

const args = process.argv.slice(2);
const id = args[0];
if (!id || id.startsWith('--')) { console.error('usage: download-clips.mjs <id> --views cf,hitter [--season 2026] [--jobs 4] [--limit N] [--date D] [--from D] [--dry]'); process.exit(2); }
const opt = k => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : null; };
const SEASON = opt('--season') || '2026', JOBS = +(opt('--jobs') || 4), LIMIT = +(opt('--limit') || 0);
const DATE = opt('--date'), FROM = opt('--from'), DRY = args.includes('--dry');
const views = (opt('--views') || 'cf,hitter').split(',').map(s => s.trim()).filter(Boolean)
  .map(v => ALIAS[v.toLowerCase()] || [v.toUpperCase()]);

const dir = join(ROOT, 'private', 'tip', id);
const tsvPath = join(dir, `clips-${SEASON}-all-angles.tsv`);
if (!existsSync(tsvPath)) { console.error(`missing ${tsvPath}`); process.exit(1); }
const lines = readFileSync(tsvPath, 'utf8').trim().split('\n');
const head = lines.shift().split('\t'); const ci = n => head.indexOf(n);
const rows = lines.map(l => l.split('\t')).map(f => ({
  pid: f[ci('play_id')], date: f[ci('game_date')], dir: f[ci('team_dir')], num: f[ci('team_num')], letters: f[ci('team_views')] || '',
})).filter(r => r.dir && r.num).filter(r => !DATE || r.date === DATE).filter(r => !FROM || r.date >= FROM);

// Build the job list: for each pitch and each requested view, the first available letter.
const jobs = [];
const missing = {};
for (const r of rows) {
  for (const choices of views) {
    const L = choices.find(l => r.letters.includes(l));
    if (!L) { missing[choices.join('/')] = (missing[choices.join('/')] || 0) + 1; continue; }
    const out = join(dir, 'clips', L, `${r.pid}.mp4`);
    if (existsSync(out) && statSync(out).size >= MIN_BYTES) continue;
    jobs.push({ r, L, url: `${HOST}${r.dir}${r.num}${L}.MP4`, out });
  }
}
const todo = LIMIT ? jobs.slice(0, LIMIT) : jobs;
console.log(`${rows.length} pitches, ${todo.length} clips to fetch` + (Object.keys(missing).length ? `, no clip for ${JSON.stringify(missing)}` : ''));
if (DRY) { for (const j of todo.slice(0, 5)) console.log(j.L, j.r.date, j.r.pid); process.exit(0); }

const logPath = join(dir, 'download-log.tsv');
if (!existsSync(logPath)) appendFileSync(logPath, 'time\tplay_id\tview\tstatus\tbytes\tms\n');
const log = (j, status, bytes, ms) => appendFileSync(logPath, `${new Date().toISOString()}\t${j.r.pid}\t${j.L}\t${status}\t${bytes}\t${ms}\n`);

async function fetchOne(j, attempt = 1) {
  const t0 = Date.now();
  mkdirSync(dirname(j.out), { recursive: true });
  const tmp = j.out + '.part';
  try {
    const res = await fetch(j.url, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`http ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    const bytes = statSync(tmp).size;
    if (bytes < MIN_BYTES) throw new Error(`too small (${bytes} bytes)`);
    renameSync(tmp, j.out);
    log(j, 'ok', bytes, Date.now() - t0);
    return true;
  } catch (e) {
    if (existsSync(tmp)) unlinkSync(tmp);
    if (attempt < 3) { await new Promise(r => setTimeout(r, 2000 * attempt)); return fetchOne(j, attempt + 1); }
    log(j, `fail: ${e.message}`, 0, Date.now() - t0);
    return false;
  }
}

let i = 0, ok = 0, fail = 0, bytes = 0;
const started = Date.now();
async function worker() {
  while (i < todo.length) {
    const j = todo[i++];
    const good = await fetchOne(j);
    if (good) { ok++; bytes += statSync(j.out).size; } else fail++;
    const done = ok + fail;
    if (done % 25 === 0 || done === todo.length) {
      const s = (Date.now() - started) / 1000;
      console.log(`${done}/${todo.length} done, ${fail} failed, ${(bytes / 1e9).toFixed(1)} GB, ${(bytes / 1e6 / s).toFixed(1)} MB/s`);
    }
  }
}
await Promise.all(Array.from({ length: JOBS }, worker));
console.log(`finished: ${ok} ok, ${fail} failed, ${(bytes / 1e9).toFixed(1)} GB; log at ${logPath}`);
