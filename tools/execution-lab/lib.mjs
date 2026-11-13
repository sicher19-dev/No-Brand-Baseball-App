// Shared helpers for the Execution Lab tools and tests. Reads private inputs;
// never imported by the app.
import { readFileSync } from 'node:fs';

export function readCsv(path) {
  const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  const head = lines[0].split(',');
  return lines.slice(1).map(l => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])));
}

// The internal pitch file carries plate_z (feet) and zn (zone units) but not
// the hitter's zone. zn is linear in plate_z per hitter, so each hitter's zone
// bottom and height come back from a least-squares fit of plate_z on zn.
export function hitterZones(rows) {
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

// A pitch object the engine understands, from one row of the internal file.
export function pitchFromRow(r, zone) {
  return {
    x: +r.plate_x, z: +r.plate_z, zn: +r.zn, zone: zone || undefined,
    family: r.family, pitch_type: r.pitch_type, balls: +r.balls, strikes: +r.strikes, stand: r.stand,
  };
}

// The data block a built execution report embeds (const D = {...}).
export function reportData(html) {
  const m = html.match(/^const D = (\{.*\});\s*$/m);
  return m ? JSON.parse(m[1]) : null;
}
