# Execution Lab: engine and plan rules (build step 1)

The Execution Lab grades where a pitch went against where it was meant to go.
This document covers the scoring module, the plan rule file it reads, and the
acceptance test that ties the two to the built execution report.

`index.html` in this folder is the prototype on generated sample data. The
build spec (`SPEC.md`) is not in the repo yet; this file records the decisions
taken while porting until it lands.

## Where things live

| Path | What | Public? |
|---|---|---|
| `www/lab/execution/engine.js` | Scoring engine: miss vector, distance, score, grades, aim offset, spread, noise band. ES module, no DOM, no dependencies. | yes (ships with the app) |
| `www/lab/execution/package.json` | Marks the folder as ES modules so Node can test it. | yes |
| `tests/execution-lab/engine.test.mjs` | Unit tests on synthetic rules. | yes |
| `tests/execution-lab/acceptance.test.mjs` | Pitch-for-pitch check against the built report. Skips when `private/` is absent. | yes (reads private data) |
| `tools/execution-lab/rules-from-report.mjs` | Builds a plan rule file from the rules a built report embeds. Stop-gap until the Python template is ported by hand. | yes |
| `private/plan_rules/<pitcher>.json` | Plan rules per pitcher. | **no**, gitignored |
| `private/*_pitch_level_INTERNAL.csv`, `private/*_execution.html` | Internal pitch data and built reports used by the acceptance test. | **no**, gitignored |
| `private/acceptance_report.md` | Written by the acceptance test on every run. | **no** |

Run everything with:

```
npm test
```

Node 18+ is enough; nothing is installed.

## Units and frames

- Pitch location: `x` and `z` in feet. `x` keeps the tracking feed's plate_x
  sign (catcher's view). `z` is height above the ground.
- Plan rule boxes: `[x0, x1, z0, z1]`. `x` in feet. `z` is in the rule's
  frame: `feet`, or `zone` (batter-normalized: 0 = bottom of the hitter's zone,
  1 = top). The v2 report rules use `zone`; the prototype's boxes are `feet`.
- Every distance the engine reports is in inches. Vertical offsets in zone
  units are turned into feet with that hitter's zone height, so a pitch in a
  `zone` frame needs `zone: {bot, top}` in feet (or a precomputed `zn` plus the
  zone, or the rule's fallback height when neither is known).

## Target layers

| Layer | Target | When missing |
|---|---|---|
| `glove` | where the catcher set up, feet | miss is `null`; the pitch is not scored on this layer |
| `inferred` | glove moved by the pitcher's own aim habit for that pitch | same |
| `plan` | nearest point of the nearest plan box for that pitch and count | always present when a rule resolves |

`scorePitch(pitch, { planRule, league })` fills `p.m` (miss vectors), `p.d`
(inches) and `p.s` (scores) for all three layers, and `p.grade` / `p.plan`
from the plan rule.

## Score

`score(d, L) = 100 * exp(-ln 2 * (d / L)^2)`: 100 on target, 50 when the miss
equals `L`, the league median miss for that layer. `L` is passed in per layer;
the prototype's `{glove: 10, inferred: 9, plan: 5}` are placeholders, not
league numbers.

## Grades (plan layer)

Checked in this order, inches measured in real feet:

1. `centered`: inside the heart box (strictly inside). Never executed.
2. `executed`: inside any plan box (edges count).
3. `near`: less than `near_in` inches (3, one ball) from the nearest box.
4. `off strike`: the ball touched the zone, which is the plate plus a ball
   radius (0.12 ft) either side, and the hitter's zone top and bottom plus a
   ball radius.
5. `off ball`: everything else.

`tdist` is the distance to the nearest plan box in inches, and `target` is
that nearest point in feet. A centered pitch that sits inside a plan box
reports the shortest way out of the middle instead, with the target on the
heart edge, so its miss vector and its distance agree. `miss_dir` is read
against the rule's primary (first) box: `up` / `down` when the vertical miss in
feet is at least the horizontal one, otherwise `in` / `away` for the hitter's
side; `middle` for centered pitches.

Grade codes `E N C S B` and the display labels (`within one ball`, `strike,
off target`, ...) are exported from the engine so pages never hard-code them.

## Plan rule file (`nb.plan_rule/1`)

```json
{
  "schema": "nb.plan_rule/1",
  "version": "v2.2: ...",
  "built": "2026-09-18",
  "provenance": "hand port of execution_template_v2.py | derived from a built report",
  "frame": { "x": "feet", "z": "zone", "z_feet_per_unit": 1.58 },
  "zone": { "x_half": 0.708, "lo": -0.12, "hi": 1 },
  "heart": { "x_half": 0.35, "lo": 0.3, "hi": 0.75 },
  "near_in": 3,
  "family_of": { "CU": "SL" },
  "params": { "edge_pre": 0.42, "edge_2k": 0.55, "...": "template knobs, kept for reference" },
  "families": { "FF": { "pre": [0.75, 1.15], "2K": [0.8, 1.4] }, "...": "per-family template, kept for reference" },
  "rules": [
    { "family": "FF", "state": "pre2K", "hand": "R", "boxes": [[-0.85, 0.85, 0.75, 1.15], [-0.85, -0.42, -0.12, 0.75], [0.42, 0.85, -0.12, 0.75]] }
  ]
}
```

- `rules` is what the engine grades with: one entry per family, count state
  (`pre2K` / `2K`) and hitter side (`R` / `L`, or omitted to serve both). The
  first box is the primary target; the others are alternate boxes that also
  count as executed.
- `params` and `families` carry the template knobs the boxes were built from,
  so the rule file reads like the template. The engine does not use them.
- `family_of` maps pitch types onto rule families.

The file for a pitcher stays in `private/`. It never ships in the client bundle
and never goes in a public repo. Grading a pitcher's live data against the
plan will happen server-side; that is a later build step.

## The page (`www/lab/execution/index.html`)

One page per pitcher, opened as `lab/execution/?p=<id>`. It reads
`data/<id>.json`, which `tools/execution-lab/build-game-data.mjs` writes from
the private pitch file and plan rules:

```
node tools/execution-lab/build-game-data.mjs skenes "Paul Skenes" RHP
```

What the data file carries per pitch: location, count, batter name, pitch
type, grade, miss vector and plan target, hitter zone, pitch id. What it does
not: the plan rules, velocity, or any other internal column. The score anchor
(`baseline`) is the pitcher's own season average miss until a league line is
available: a miss of that size scores 50, on target scores 100.

**Clips.** The page looks for `data/<id>-clips.json`, a map from pitch id to
`{ h: broadcast URL, hh: high-home URL }`. When a pitch has one, tapping the
pitch plays it inline with a caption and an angle switch; otherwise the slot
says no clip is loaded. No provider is named on the page.

Building the map (done for Skenes 2026 on 2026-11-13, all 2,890 pitches):

1. On the video provider's pitch log for the pitcher, paste
   `tools/execution-lab/harvest-clips.browser.js` into the console. The page
   returns at most 1,000 rows per query, so filter to one month at a time
   and run `nbClipsHarvest()` on each; the rows accumulate in the browser.
2. `nbClipsDownload('<id>')` saves `nb-clips-<id>.tsv.gz`; move it to
   `private/clips/<id>.tsv.gz`.
3. `node tools/execution-lab/clips-from-tsv.mjs <id>` writes the page map.

The map is gitignored (`www/lab/execution/data/*-clips.json`): the URLs are
the provider's hosted clips and stay off the public repo. Serving them to
pitchers goes through the app's backend in a later step.

**Target on the clip.** Over every clip the page draws a small inset: the
hitter's zone, the plan target ring, where the pitch went and the miss line.
When the park's camera is calibrated for that angle, it also draws the
target ring and the pitch location on the picture itself (dashed ring,
marked approximate). A calibration is four taps on a paused frame from
Calibrate camera: left and right edge of the plate, then the bottom and top
of the hitter's zone, whose heights in feet the data already carries. That
fixes an axis-aligned map from plate coordinates to picture fractions, one
per park and angle, keyed `<park>|<angle>` (park = the pitcher's team when
at home, else the opponent). Calibrations live in the browser and are seeded
from `data/<id>-cal.json`, which is committed (it holds no URLs). The home
broadcast camera for the pitcher's park was calibrated on 2026-11-13; away
parks need a coach to tap once each. This is a flat map, so it is good near
the plate and approximate off it; a true per-camera solve is a later step.

**Edit target.** The coach tool under a clip. It sets or corrects the glove
read for the selected pitch, where the catcher set up, in plate feet: tap on
the picture (when the park's camera is calibrated, the tap maps back through
the calibration) or tap in a large zone panel (always). Save stores the read;
Clear glove removes it. Reads live in the browser (`localStorage`) and are
seeded from `data/<id>-glove.json`; Copy all glove reads puts the JSON on the
clipboard so they can be moved until the app backend stores them.

**Layers.** Saving a read rescores the pitch at once: the glove layer is the
miss from the read, and the glove + habit layer is the miss from the read
moved by the pitcher's own aim habit for that pitch type, learned from his
reads (mean of pitch minus glove, needs 5 reads on the type). The layer
buttons enable as reads come in. Their 50 lines are placeholders until a
league or season anchor exists for them.

Open design question: a centered pitch inside a plan box scores by how far
it was from leaving the middle, which is usually a high score. Dead-middle
never counts as executed, but whether it should also be scored as a miss is
Brian's call.

## What the acceptance test found (2026-11-13)

Engine + rules derived from the built report, run on the internal pitch file:
2,888 of 2,890 grades match. The two left are pitches sitting exactly on an
edge at the file's three-decimal rounding (one on a box top, one on the heart's
side), so the file cannot say which side they were on. The test lists those
separately and fails only on real mismatches.

Not part of the acceptance, reported for information:

- Miss direction agrees on 2,813 of 2,890. Nearly every disagreement is a
  sweeper, so the template handles sweeper direction differently from the
  primary-box rule above. The Python template will settle it.
- Target distance agrees within 0.05 in on all 2,890 once each hitter's zone
  height is recovered from the file (the file has plate_z and zn but not the
  zone itself; the test fits it per hitter).

## House rules in the code

- Brand is No Brand Baseball Analytics.
- No data-source names or internal codenames anywhere that ships to a player.
- The internal pitch file carries velocity; the engine never reads it and no
  player page shows velocity, health or body data by default.
