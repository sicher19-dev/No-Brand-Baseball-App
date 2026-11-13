// Unit tests for the Execution Lab engine. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IN, GRADES, LAYERS, mean, median, stateOf, familyOf, boxOffset, inBox, nearestPoint, nearestBox,
  resolveRule, touchesZone, missDirection, gradePlan, missVector, distance, score, scorePitch,
  aimOffset, spread, noiseBand, stats, gradeCounts, dirWord,
} from '../../www/lab/execution/engine.js';

const close = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) < eps, msg || `${a} != ${b}`);

// A tiny zone-unit rule set in the shape of a plan_rule file.
const ZONE_RULE = {
  schema: 'nb.plan_rule/1',
  frame: { z: 'zone', z_feet_per_unit: 1.5 },
  heart: { x_half: 0.35, lo: 0.3, hi: 0.75 },
  near_in: 3,
  family_of: { CU: 'SL' },
  rules: [
    { family: 'FF', state: 'pre2K', hand: 'R', boxes: [[-0.85, 0.85, 0.75, 1.15], [-0.85, -0.42, -0.12, 0.75]] },
    { family: 'FF', state: 'pre2K', hand: 'L', boxes: [[-0.85, 0.85, 0.75, 1.15]] },
    { family: 'FF', state: '2K', hand: 'R', boxes: [[-0.95, 0.95, 0.8, 1.4]] },
    { family: 'SL', state: 'pre2K', hand: 'R', boxes: [[-0.3, 0.9, -0.12, 0.55]] },
    { family: 'ST', state: 'pre2K', hand: 'R', boxes: [[-0.85, 0.85, -0.12, 0.7]] },   // box that swallows the heart
  ],
};
const Z = { bot: 1.5, top: 3.0 };   // zone height 1.5 ft so 0.1 zone units = 1.8 in
const ff = (x, zn, extra = {}) => ({ x, z: Z.bot + zn * (Z.top - Z.bot), zone: Z, family: 'FF', balls: 0, strikes: 0, stand: 'R', ...extra });

// Feet-frame rule, the prototype's four-seam box and dead-middle box.
const FEET_RULE = {
  frame: { z: 'feet' },
  heart: { x_half: 0.33, lo: 2.2, hi: 2.8 },
  near_in: 3,
  zone_feet: { lo: 1.6, hi: 3.4 },
  rules: [{ family: 'FF', state: 'pre2K', boxes: [[-0.83, 0.83, 2.95, 3.7]] }],
};

test('math helpers', () => {
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.ok(Number.isNaN(median([])));
});

test('count state and family mapping', () => {
  assert.equal(stateOf(0, 0), 'pre2K');
  assert.equal(stateOf(3, 1), 'pre2K');
  assert.equal(stateOf(0, 2), '2K');
  assert.equal(familyOf('CU', ZONE_RULE), 'SL');
  assert.equal(familyOf('FF', ZONE_RULE), 'FF');
  assert.equal(familyOf('FF', null), 'FF');
});

test('box geometry', () => {
  const box = [-1, 1, 0, 2];
  assert.ok(inBox([0, 1], box));
  assert.ok(inBox([1, 2], box), 'edges count as inside');
  assert.ok(!inBox([1.01, 1], box));
  assert.deepEqual(boxOffset([0, 1], box), { dx: 0, dz: 0, sx: 0, sz: 0 });
  assert.deepEqual(boxOffset([1.5, -1], box), { dx: 0.5, dz: 1, sx: 1, sz: -1 });
  assert.deepEqual(boxOffset([-2, 3], box), { dx: 1, dz: 1, sx: -1, sz: 1 });
  assert.deepEqual(nearestPoint([1.5, -1], box), [1, 0]);
  assert.deepEqual(nearestPoint([0, 1], box), [0, 1]);
});

test('nearest box picks the closest and scales z into feet', () => {
  const boxes = [[-1, 1, 2, 3], [-1, 1, 0, 0.5]];
  const r = nearestBox([0, 0.8], boxes, 2);        // 0.3 units * 2 ft/unit = 0.6 ft above box 1
  assert.equal(r.i, 1);
  close(r.d, 0.6 * IN);
  const r2 = nearestBox([0, 1.9], boxes, 2);       // 0.1 units from box 0 = 0.2 ft
  assert.equal(r2.i, 0);
  close(r2.d, 0.2 * IN);
  const inside = nearestBox([0, 2.5], boxes, 2);
  assert.equal(inside.d, 0);
});

test('rule resolution by family, state and hand', () => {
  assert.equal(resolveRule(ZONE_RULE, { family: 'FF', state: 'pre2K', hand: 'R' }).boxes.length, 2);
  assert.equal(resolveRule(ZONE_RULE, { family: 'FF', state: 'pre2K', hand: 'L' }).boxes.length, 1);
  assert.equal(resolveRule(ZONE_RULE, { family: 'CU', state: 'pre2K', hand: 'R' }).family, 'SL');
  assert.equal(resolveRule(ZONE_RULE, { family: 'CH', state: 'pre2K', hand: 'R' }), null);
  assert.equal(resolveRule(ZONE_RULE, { family: 'FF', state: '2K', hand: 'L' }), null, 'no hand fallback across hands');
  assert.equal(resolveRule(FEET_RULE, { family: 'FF', state: 'pre2K', hand: 'L' }).boxes.length, 1, 'hand-less rule serves both sides');
});

test('zone touch uses the plate plus a ball radius', () => {
  assert.ok(touchesZone({ x: 0, z: 2.0, zone: Z }, ZONE_RULE));
  assert.ok(touchesZone({ x: 0.82, z: 2.0, zone: Z }, ZONE_RULE));
  assert.ok(!touchesZone({ x: 0.84, z: 2.0, zone: Z }, ZONE_RULE));
  assert.ok(touchesZone({ x: 0, z: Z.bot - 0.11, zone: Z }, ZONE_RULE), 'ball touching the bottom edge');
  assert.ok(!touchesZone({ x: 0, z: Z.bot - 0.13, zone: Z }, ZONE_RULE));
  assert.ok(touchesZone({ x: 0, zn: 1.07 }, ZONE_RULE), 'zn form pads by a ball radius over the rule zone height');
  assert.ok(!touchesZone({ x: 0, zn: 1.09 }, ZONE_RULE));
  assert.ok(touchesZone({ x: 0, z: 3.5 }, FEET_RULE), 'feet frame falls back to the rule zone');
  assert.ok(!touchesZone({ x: 0, z: 3.53 }, FEET_RULE));
});

test('miss direction against the primary box', () => {
  assert.equal(missDirection({ dx: 0, dz: 0, sx: 0, sz: 0 }, 1, 'R'), 'middle');
  assert.equal(missDirection({ dx: 0.1, dz: 0.2, sx: 1, sz: 1 }, 1, 'R'), 'up');
  assert.equal(missDirection({ dx: 0.1, dz: 0.2, sx: 1, sz: -1 }, 1, 'R'), 'down');
  assert.equal(missDirection({ dx: 0.3, dz: 0.1, sx: -1, sz: 0 }, 1, 'R'), 'in', 'negative x is the right-handed hitter side');
  assert.equal(missDirection({ dx: 0.3, dz: 0.1, sx: -1, sz: 0 }, 1, 'L'), 'away');
  assert.equal(missDirection({ dx: 0.3, dz: 0.1, sx: 1, sz: 0 }, 1, 'L'), 'in');
  assert.equal(missDirection({ dx: 0.3, dz: 0.1, sx: 1, sz: 0 }, 1, 'R'), 'away');
  assert.equal(missDirection({ dx: 0.3, dz: 0.2, sx: 1, sz: 1 }, 2, 'R'), 'up', 'z scale turns zone units into feet before comparing');
  assert.equal(missDirection({ dx: 0.3, dz: 0.3, sx: 1, sz: 1 }, 1, 'R'), 'up', 'ties go vertical');
});

test('plan grade: executed, near, off strike, off ball, centered', () => {
  let g = gradePlan(ff(0, 0.9), ZONE_RULE);
  assert.equal(g.grade, 'executed'); assert.equal(g.code, 'E'); assert.equal(g.tdist, 0); assert.equal(g.miss_dir, '');
  assert.deepEqual(g.target, [0, Z.bot + 0.9 * 1.5]);

  g = gradePlan(ff(0, 1.15), ZONE_RULE);
  assert.equal(g.grade, 'executed', 'on the edge counts');

  g = gradePlan(ff(0, 1.25), ZONE_RULE);          // 0.1 units = 1.8 in above the top band
  assert.equal(g.grade, 'near'); close(g.tdist, 1.8); assert.equal(g.miss_dir, 'up');
  close(g.target[1], Z.bot + 1.15 * 1.5, 1e-9, 'target is the nearest point of the band');

  g = gradePlan(ff(0, 1.4), ZONE_RULE);           // 0.25 units = 4.5 in above, ball top edge within radius? 0.4 units*1.5 = 0.6 ft above zone
  assert.equal(g.grade, 'off ball'); assert.equal(g.miss_dir, 'up');

  g = gradePlan(ff(-0.1, 0.2), ZONE_RULE);         // in the zone, outside both boxes: 0.32 ft from the column, 0.55 units*1.5=0.825 ft from the band
  assert.equal(g.grade, 'off strike'); close(g.tdist, 0.32 * IN);
  assert.equal(g.boxIndex, 1, 'nearest box is the column');
  assert.equal(g.miss_dir, 'down', 'direction reads against the primary band');

  g = gradePlan(ff(0, 0.5), ZONE_RULE);
  assert.equal(g.grade, 'centered'); assert.equal(g.miss_dir, 'middle');
  close(g.tdist, 0.25 * 1.5 * IN, 1e-9, 'centered outside every box: distance to the nearest box (the band above)');
  g = gradePlan(ff(0.1, 0.5, { family: 'ST' }), ZONE_RULE);
  assert.equal(g.grade, 'centered', 'inside the sweeper box but in the heart');
  close(g.tdist, 0.25 * IN, 1e-9, 'centered inside a box: shortest way out of the heart, here sideways');
  close(gradePlan(ff(0, 0.35, { family: 'ST' }), ZONE_RULE).tdist, 0.05 * 1.5 * IN, 1e-9, 'or down through the heart floor');
  assert.equal(gradePlan(ff(0, 0.2, { family: 'ST' }), ZONE_RULE).grade, 'executed', 'below the heart, inside the box');

  g = gradePlan(ff(-0.6, 0.5), ZONE_RULE);
  assert.equal(g.grade, 'executed', 'edge column, not the heart');

  g = gradePlan(ff(-0.6, 0.5, { stand: 'L' }), ZONE_RULE);
  assert.notEqual(g.grade, 'executed', 'left-handed rule has no edge column');
  assert.equal(g.miss_dir, 'down');

  g = gradePlan(ff(-1.2, 0.5), ZONE_RULE);        // 0.35 ft outside the column, in the zone band -> off ball (x beyond 0.83)
  assert.equal(g.grade, 'off ball'); assert.equal(g.miss_dir, 'down', 'primary band is above, vertical miss 0.375 ft beats horizontal 0.35');
});

test('plan grade: state, family mapping, zn input, missing rule', () => {
  assert.equal(gradePlan(ff(0, 1.3, { strikes: 2 }), ZONE_RULE).grade, 'executed', 'two-strike band is higher');
  assert.equal(gradePlan(ff(0, 1.3), ZONE_RULE).grade, 'near');
  assert.equal(gradePlan(ff(0.5, 0.3, { family: 'CU' }), ZONE_RULE).rule.family, 'SL');
  assert.equal(gradePlan(ff(0.5, 0.3, { family: 'CH' }), ZONE_RULE), null);
  const viaZn = gradePlan({ x: 0, zn: 1.25, zone: Z, family: 'FF', state: 'pre2K', stand: 'R' }, ZONE_RULE);
  assert.equal(viaZn.grade, 'near'); close(viaZn.tdist, 1.8);
  const noZone = gradePlan({ x: 0, zn: 1.25, family: 'FF', state: 'pre2K', stand: 'R' }, ZONE_RULE);
  close(noZone.tdist, 0.1 * 1.5 * IN, 1e-9, 'falls back to the rule zone height');
});

test('plan grade in a feet frame (prototype box)', () => {
  const p = (x, z) => ({ x, z, family: 'FF', balls: 1, strikes: 1, stand: 'L' });
  assert.equal(gradePlan(p(0, 3.2), FEET_RULE).grade, 'executed');
  let g = gradePlan(p(0, 2.8), FEET_RULE);          // 0.15 ft = 1.8 in under the box
  assert.equal(g.grade, 'near'); close(g.tdist, 1.8); assert.deepEqual(g.target, [0, 2.95]);
  assert.equal(gradePlan(p(0, 2.5), FEET_RULE).grade, 'centered');
  assert.equal(gradePlan(p(0.6, 2.0), FEET_RULE).grade, 'off strike');
  assert.equal(gradePlan(p(0.6, 1.2), FEET_RULE).grade, 'off ball');
});

test('miss vector, distance and score', () => {
  assert.deepEqual(missVector([1, 2], [0.5, 2.25]), [6, -3]);
  assert.equal(missVector([1, 2], null), null);
  assert.equal(distance([3, 4]), 5);
  assert.equal(distance(null), null);
  assert.equal(score(0, 10), 100);
  close(score(10, 10), 50);
  close(score(5, 5), 50);
  assert.ok(score(20, 10) < score(10, 10));
  assert.equal(score(null, 10), null);
});

test('scorePitch fills every layer and keeps the plan graded without a glove', () => {
  const league = { glove: 10, inferred: 9, plan: 5 };
  const p = scorePitch({ ...ff(0, 1.25), glove: [0.25, 3.0], inferred: null }, { planRule: ZONE_RULE, league });
  assert.deepEqual(Object.keys(p.m), LAYERS);
  assert.equal(p.grade, 'near');
  close(p.d.plan, 1.8);
  close(p.d.glove, Math.hypot(0.25 * IN, (Z.bot + 1.25 * 1.5 - 3.0) * IN));
  assert.equal(p.m.inferred, null); assert.equal(p.s.inferred, null);
  close(p.s.plan, score(1.8, 5));
  const noRule = scorePitch({ ...ff(0, 1.25), glove: [0, 3] }, { league });
  assert.equal(noRule.grade, undefined); assert.equal(noRule.m.plan, null); assert.ok(noRule.d.glove > 0);
});

test('aggregates: aim offset, spread, noise band, stats, counts', () => {
  const league = { glove: 10, inferred: 9, plan: 5 };
  const P = [
    { x: 0.1, z: 3.0, glove: [0, 3] },
    { x: 0.1, z: 3.0, glove: [0, 3] },
    { x: 0.1, z: 3.5, glove: [0, 3] },
    { x: 0.1, z: 2.5, glove: [0, 3] },
    { x: 0, z: 3, glove: null },
  ].map(p => scorePitch(p, { league }));
  const bias = aimOffset(P, 'glove');
  close(bias[0], 1.2); close(bias[1], 0);
  close(spread(P, 'glove'), 3, 1e-9, 'residuals are 0,0,6,6 inches: median 3');
  const s = stats(P, 'glove');
  assert.equal(s.n, 4); assert.equal(s.total, 5);
  close(s.med, (1.2 + Math.hypot(1.2, 6)) / 2);
  assert.ok(s.band > 0);
  close(s.band, noiseBand(P.filter(p => p.m.glove).map(p => p.s.glove)));
  assert.equal(s.exec, null, 'no plan grades in this set');
  assert.equal(stats(P, 'plan'), null);
  assert.equal(noiseBand([]), null);
  assert.equal(noiseBand([50, 50, 50]), 0);

  const G = [{ grade: 'executed' }, { grade: 'executed' }, { grade: 'centered' }, { grade: 'off ball' }, {}];
  assert.deepEqual(gradeCounts(G), { executed: 2, near: 0, centered: 1, 'off strike': 0, 'off ball': 1 });
  assert.deepEqual(GRADES, ['executed', 'near', 'centered', 'off strike', 'off ball']);
});

test('dirWord', () => {
  assert.equal(dirWord([0, 0.5]), 'on target');
  assert.equal(dirWord([0, 5]), 'up');
  assert.equal(dirWord([-5, 0]), 'arm side');
  assert.equal(dirWord([4, -4]), 'down / glove side');
});
