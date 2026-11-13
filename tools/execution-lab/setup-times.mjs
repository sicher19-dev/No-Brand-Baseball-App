#!/usr/bin/env node
// Execution Lab: find the set-up moment in every broadcast clip, so the
// glove-tagging flow can open each pitch paused on the frame where the
// catcher is set and the pitcher has not moved yet.
//
//   node tools/execution-lab/setup-times.mjs skenes [--date 2026-09-24] [--jobs 4] [--frames] [--debug <pitch id>]
//
// Reads  www/lab/execution/data/<id>.json, <id>-clips.json, <id>-cal.json
// Writes www/lab/execution/data/<id>-setup.json   { pitch id: seconds }
//        (resumable: pitches already in the file are skipped)
//        private/frames/<id>/<pitch id>.jpg with --frames (the chosen frame, to check by eye)
//
// Method. ffmpeg decodes the clip to small grey frames (10 a second); nothing
// is written to disk. Two motion signals per frame: the mean change inside
// the plate region (from the park's camera calibration, else the middle of
// the picture) and over the whole picture. A clip usually runs close-up,
// cut, the wide shot with the pitch, cut, replay; frames where the whole
// picture changes a lot are cuts, dissolves or pans, and the runs between
// them are shots. The wide shot is steady (little whole-picture motion),
// looks like the park's reference picture (a signature of the wide shot,
// taken from the park's first clips), and holds the biggest burst in the
// plate region (delivery, ball, swing, catch). From that burst's peak, walk
// back to the last calm stretch: the set-up. If the shot starts mid-delivery,
// the set-up is its first frame.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const id = args[0];
if (!id) { console.error('usage: setup-times.mjs <id> [--date YYYY-MM-DD] [--jobs N] [--frames] [--debug <pitch id>]'); process.exit(2); }
const opt = k => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : null; };
const DATE = opt('--date'), JOBS = +(opt('--jobs') || 4), FRAMES = args.includes('--frames'), DEBUG = opt('--debug');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

const dataDir = join(ROOT, 'www', 'lab', 'execution', 'data');
const D = JSON.parse(readFileSync(join(dataDir, `${id}.json`), 'utf8'));
const CLIPS = JSON.parse(readFileSync(join(dataDir, `${id}-clips.json`), 'utf8'));
const CAL = existsSync(join(dataDir, `${id}-cal.json`)) ? JSON.parse(readFileSync(join(dataDir, `${id}-cal.json`), 'utf8')) : {};
const outPath = join(dataDir, `${id}-setup.json`);
const OUT = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {};
const framesDir = join(ROOT, 'private', 'frames', id);
if (FRAMES) mkdirSync(framesDir, { recursive: true });

const W = 320, H = 180, FPS = 10, SW = 40, SH = 22;   // frame size; signature size
const parkOf = g => g.home ? D.pitcher.team : g.opp;
const clipUrl = pid => { const c = CLIPS[pid]; return c && (typeof c === 'string' ? c : c.h); };

// Plate region in frame fractions: a few feet either side of the plate, from
// the ground to a little above the zone.
function region(park) {
  const c = CAL[`${park}|h`];
  if (!c) return { u0: 0.42, u1: 0.58, v0: 0.3, v1: 0.72 };
  const u = x => c.u0 + c.ax * x, v = z => c.v0 - c.az * z;
  return { u0: Math.min(u(-3.5), u(3.5)), u1: Math.max(u(-3.5), u(3.5)), v0: v(5), v1: v(-0.3) };
}

function decode(url) {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, ['-v', 'error', '-i', url, '-vf', `fps=${FPS},scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let err = '';
    ff.stdout.on('data', b => chunks.push(b)); ff.stderr.on('data', b => err += b);
    ff.on('error', reject);
    ff.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(err.trim() || `ffmpeg exit ${code}`)));
  });
}

// A shot's signature: the frame shrunk to 40 x 22 and z-scored, so day and
// night at the same park compare on layout, not brightness.
function signature(buf, f) {
  const a = f * W * H, bx = W / SW, by = H / SH, s = new Float32Array(SW * SH);
  for (let j = 0; j < SH; j++) for (let i = 0; i < SW; i++) {
    let t = 0, k = 0;
    for (let y = Math.floor(j * by); y < Math.floor((j + 1) * by); y++) for (let x = Math.floor(i * bx); x < Math.floor((i + 1) * bx); x++) { t += buf[a + y * W + x]; k++; }
    s[j * SW + i] = t / k;
  }
  let mean = 0; for (const v of s) mean += v; mean /= s.length;
  let sd = 0; for (const v of s) sd += (v - mean) ** 2; sd = Math.sqrt(sd / s.length) || 1;
  for (let i = 0; i < s.length; i++) s[i] = (s[i] - mean) / sd;
  return s;
}
const sigDist = (a, b) => { let t = 0; for (let i = 0; i < a.length; i++) t += Math.abs(a[i] - b[i]); return t / a.length; };
const REF_MAX = 0.55;   // mean |z| difference; the wide shot at one park sits well under this, other shots well over

const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * p)] || 0; };
function analyse(buf, R) {
  const n = Math.floor(buf.length / (W * H)); if (n < FPS) return null;
  const x0 = Math.floor(R.u0 * W), x1 = Math.ceil(R.u1 * W), y0 = Math.floor(R.v0 * H), y1 = Math.ceil(R.v1 * H);
  const m = [0], g = [0];
  for (let f = 1; f < n; f++) {
    const a = f * W * H, b = (f - 1) * W * H;
    let s = 0, k = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += Math.abs(buf[a + y * W + x] - buf[b + y * W + x]); k++; }
    let sg = 0; for (let i = 0; i < W * H; i += 7) sg += Math.abs(buf[a + i] - buf[b + i]);
    m.push(s / k); g.push(sg / Math.ceil(W * H / 7));
  }
  const isCut = f => g[f] > 9;
  const shots = [];
  for (let f = 1; f < n;) {
    if (isCut(f)) { f++; continue; }
    let e = f; while (e < n && !isCut(e)) e++;
    if (e - f >= FPS) { const mm = m.slice(f, e), gg = g.slice(f, e); shots.push({ s: f, e, steady: pct(gg, 0.5), peakVal: Math.max(...mm), base: pct(mm, 0.2), sig: signature(buf, Math.min(e - 1, f + 2)) }); }
    f = e;
  }
  return { n, m, g, shots };
}

function pickShot(A, ref) {
  if (!A.shots.length) return null;
  let cands = A.shots.filter(S => S.steady < 6.5 && S.peakVal >= 10);
  if (ref) { const like = cands.filter(S => sigDist(S.sig, ref) < REF_MAX); if (like.length) cands = like; }
  return (cands.length ? cands : A.shots).reduce((a, b) => b.peakVal > a.peakVal ? b : a);
}

function setupTime(A, shot) {
  if (!shot) return { t: 1.0, why: 'flat' };
  const { m } = A;
  let peak = shot.s; for (let f = shot.s; f < shot.e; f++) if (m[f] > m[peak]) peak = f;
  // calm is calm in absolute terms too: a shot that never settles must not make its own motion look calm
  const base = Math.min(shot.base, 4), thr = Math.max(base * 2, base + 3);
  let calm = 0, f = peak;
  for (; f >= shot.s; f--) { calm = m[f] < thr ? calm + 1 : 0; if (calm >= 3) break; }
  if (f < shot.s) return { t: Math.max(0.2, Math.min(peak / FPS, shot.s / FPS + 0.1)), why: shot.s > 1 ? 'after cut' : 'no calm', peak: peak / FPS };
  return { t: Math.max(0.2, f / FPS), why: 'calm', peak: peak / FPS };
}

function grabFrame(url, t, file) {
  return new Promise(resolve => {
    const ff = spawn(FFMPEG, ['-v', 'error', '-y', '-ss', String(t), '-i', url, '-frames:v', '1', '-vf', 'scale=960:-1', file], { stdio: 'ignore' });
    ff.on('close', resolve); ff.on('error', resolve);
  });
}

// Park references: from each park's first dozen clips, the wide shot the
// motion heuristic picks; the reference is the one most like the others.
const REF = {};
async function buildRefs(jobsByPark) {
  for (const [park, jobs] of Object.entries(jobsByPark)) {
    const sigs = [];
    for (const j of jobs.slice(0, 12)) {
      try { const A = analyse(await decode(j.url), region(park)); const S = A && pickShot(A, null); if (S) sigs.push(S.sig); } catch (e) { /* skip */ }
    }
    if (sigs.length < 3) continue;
    const dist = sigs.map(a => sigs.reduce((t, b) => t + sigDist(a, b), 0) / (sigs.length - 1));
    const best = dist.indexOf(Math.min(...dist));
    REF[park] = sigs[best];
    console.log(`${park}: reference from ${sigs.length} clips, typical distance ${dist[best].toFixed(2)}`);
  }
}

if (DEBUG) {
  const g = D.games.find(G => G.pitches.some(p => p.pid === DEBUG)), park = parkOf(g);
  const A = analyse(await decode(clipUrl(DEBUG)), region(park));
  console.log(A.m.map((v, f) => `${(f / FPS).toFixed(1)}: r${v.toFixed(1)} w${A.g[f].toFixed(1)}`).join(' | '));
  console.log('shots', JSON.stringify(A.shots.map(S => ({ s: S.s / FPS, e: S.e / FPS, steady: +S.steady.toFixed(1), peak: +S.peakVal.toFixed(1) }))));
  console.log(JSON.stringify(setupTime(A, pickShot(A, null))));
  process.exit(0);
}

const todo = [], byPark = {};
for (const g of D.games) {
  if (DATE && g.date !== DATE) continue;
  for (const p of g.pitches) {
    const url = clipUrl(p.pid); if (!url) continue;
    const j = { pid: p.pid, url, park: parkOf(g), label: `${g.date} #${p.i}` };
    (byPark[j.park] = byPark[j.park] || []).push(j);
    if (OUT[p.pid] == null) todo.push(j);
  }
}
console.log(`${todo.length} clips to analyse (${Object.keys(OUT).length} already done), ${JOBS} at a time`);
await buildRefs(byPark);
let done = 0, fails = 0, t0 = Date.now();
const whys = {};
async function worker() {
  while (todo.length) {
    const j = todo.shift();
    try {
      const A = analyse(await decode(j.url), region(j.park));
      if (!A) throw new Error('too short');
      const r = setupTime(A, pickShot(A, REF[j.park]));
      OUT[j.pid] = +r.t.toFixed(1); whys[r.why] = (whys[r.why] || 0) + 1;
      if (FRAMES) await grabFrame(j.url, r.t, join(framesDir, `${j.pid}.jpg`));
    } catch (e) { fails++; console.warn(`${j.label}: ${e.message.split('\n')[0]}`); }
    done++;
    if (done % 50 === 0 || !todo.length) { writeFileSync(outPath, JSON.stringify(OUT)); console.log(`${done} done, ${fails} failed, ${((Date.now() - t0) / 1000 / done).toFixed(1)} s each`); }
  }
}
await Promise.all(Array.from({ length: JOBS }, worker));
writeFileSync(outPath, JSON.stringify(OUT));
console.log(`wrote ${outPath}: ${Object.keys(OUT).length} pitches; ${JSON.stringify(whys)}`);
