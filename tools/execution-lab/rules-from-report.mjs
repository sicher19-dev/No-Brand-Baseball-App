#!/usr/bin/env node
// Execution Lab: build a plan_rule file from the rules a built execution report embeds.
// Stop-gap until private/execution_template_v2.py is ported by hand; the output is
// marked as derived so nobody mistakes it for the source of truth.
//
//   node tools/execution-lab/rules-from-report.mjs private/skenes_execution.html private/plan_rules/skenes.json
//
// Everything this reads and writes lives under private/ (gitignored).
import { readFileSync, writeFileSync } from 'node:fs';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: rules-from-report.mjs <report.html> <plan_rule.json>'); process.exit(2); }

const html = readFileSync(src, 'utf8');
const m = html.match(/^const D = (\{.*\});\s*$/m);
if (!m) { console.error('no embedded D = {...} line in ' + src); process.exit(1); }
const D = JSON.parse(m[1]);

const rules = [];
for (const [key, boxes] of Object.entries(D.regions)) {
  const [family, state, hand] = key.split('|');
  rules.push({ family, state, hand, boxes });
}
const t = D.template;
const planRule = {
  schema: 'nb.plan_rule/1',
  version: D.version,
  built: D.built,
  provenance: 'derived from the embedded template of a built execution report; replace with the hand port of execution_template_v2.py',
  frame: {
    x: 'feet',   // from plate center, catcher view, tracking-feed plate_x sign
    z: 'zone',   // batter-normalized: 0 = bottom of the hitter's zone, 1 = top
    z_feet_per_unit: 1.58,   // fallback zone height when a pitch carries no hitter zone
  },
  zone: { x_half: 0.708, lo: t.zone_lo, hi: t.zone_hi },
  heart: { x_half: t.heart_x, lo: t.heart_lo, hi: t.heart_hi },
  near_in: t.near_in,
  family_of: { CU: 'SL' },
  params: Object.fromEntries(Object.entries(t).filter(([k]) => !Array.isArray(t[k]) && typeof t[k] !== 'object')),
  families: Object.fromEntries(Object.entries(t).filter(([, v]) => typeof v === 'object')),
  rules,
};
writeFileSync(out, JSON.stringify(planRule, null, 2) + '\n');
console.log(`wrote ${out}: ${rules.length} rules, version "${D.version}"`);
