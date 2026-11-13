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
Calibrate camera: the first-base and third-base edges of the plate, then the
bottom and top of the hitter's zone, whose heights in feet the data already
carries. Naming the plate edges by base rather than left and right is what
makes the map come out right for any camera: a center-field broadcast
camera sees first base on the left, a camera behind the plate sees it on the
right, and the sign of the horizontal scale records which. That fixes an
axis-aligned map from plate coordinates to picture fractions, one per park
and angle, keyed `<park>|<angle>` (park = the pitcher's team when at home,
else the opponent). The pitch dot on the picture is where the ball crossed
the front of the plate; the catcher receives it a couple of feet later and
lower, so it does not sit in the mitt. Calibrations live in the browser and are seeded
from `data/<id>-cal.json`, which is committed (it holds no URLs). All 13
parks in the 2026 schedule have a broadcast-camera calibration (home plus
NYM, CIN, MIL, AZ, TOR, HOU, COL, PHI, CLE, MIA, SD, CHC), tapped on
2026-11-13 from magnified paused frames, so expect a few inches of slop;
Recalibrate camera on any clip from that park replaces one. This is a flat
map, so it is good near the plate and approximate off it; a true per-camera
solve is a later step.

**Edit target.** The coach tool under a clip. It sets or corrects the glove
read for the selected pitch, where the catcher set up, in plate feet: tap on
the picture (when the park's camera is calibrated, the tap maps back through
the calibration) or tap in a large zone panel (always). Save stores the read;
Clear glove removes it.

**Team store.** The page uses the app's backend (same Supabase project,
`www/config.js`, same origin as the app so the app's sign-in carries over):

- `execution_glove_reads` (pitcher id, play id, x, z): coaches write, a
  pitcher reads his own.
- `execution_cameras` (park, angle, u0, ax, v0, az, taps, zone, note):
  coaches write, anyone signed in reads.

Both are in `supabase/schema.sql` (re-run the whole file in the SQL editor;
it is safe to re-run). On load the page merges the seed file, then the
browser copy, then the team store, which wins. A coach's Save writes the
browser copy and the team store; the status line under the player says
which one took it. Without a session the tools are hidden; without a backend
configured (local preview) they show and everything stays in the browser.
Copy all glove reads still puts the JSON on the clipboard.

**Layers.** Saving a read rescores the pitch at once: the glove layer is the
miss from the read, and the glove + habit layer is the miss from the read
moved by the pitcher's own aim habit for that pitch type, learned from his
reads (mean of pitch minus glove, needs 5 reads on the type). The layer
buttons enable as reads come in. Their 50 lines are placeholders until a
league or season anchor exists for them.

**Dead-middle and the score.** The plan-layer miss runs to the nearest
executed ground: the plan boxes with the heart cut out (`dgood` and
`target_good` from the engine). A pitch dead in the middle is scored as the
miss it is, never as on target, while the report's `tdist` and the grades
are unchanged. On Paul's 2026 this moved 48 pitches and the season score
from 65.3 to 65.1, because most centered pitches already sat 2 to 3 inches
from a plan box.

Policy (Brian, 2026-11-13): on the plan layer a centered pitch scores 0,
whatever its distance. The plan rule carries it as `centered_score: 0`
(leave it out for pure distance), the engine applies it in `scorePitch`,
and the page applies it from `policy.centered_score` in the data file. The
glove and glove + habit layers stay pure distance: a catcher set up middle
and a pitch that got there is executed against the glove, and only the plan
says it was the wrong spot. With this, Paul's 2026 season scores 59.4.

## More seasons (`pitches-from-harvest.mjs`)

Seasons the internal file does not cover come from the video provider's
pitch log, the same table the clips come from. `harvest-clips.browser.js`
style: one month per query, rows accumulate in the browser, one compressed
download; then

```
node tools/execution-lab/pitches-from-harvest.mjs skenes 2025
node tools/execution-lab/build-game-data.mjs skenes "Paul Skenes" RHP PIT
node tools/execution-lab/clips-from-tsv.mjs skenes
```

The harvest carries the provider's normalized location. Checked against 400
pitches of the internal 2026 file: `plate_x = -x * 0.708` and
`zn = (y + 1) / 2`, both exact to a thousandth. What it does not carry is
the hitter's zone in feet, so heights use a typical zone (bottom 1.55 ft,
height 1.58 ft) and distances in inches carry a few percent of slop; grades
do not depend on it. The provider's pitch types differ in naming only: its
two-seam is the file's sinker, and it does not split sweeper from slider in
2025. The build grades every season against today's plan and anchors every
season's score on the latest season's mean miss, so seasons compare on one
line. The page carries a season switch and a seasons-side-by-side table;
approximate seasons are marked.

Paul 2025: 2,997 pitches over 32 starts, season command 60.1 against 59.4
in 2026.

## The league line (`league-from-harvest.mjs`)

The score's 50 is the league, not the pitcher, once a league file exists for
the latest season. The league is every qualified right-handed starter in the
provider's pitching leaderboard for that season (the pitcher himself left
out), every regular-season pitch, harvested from the pitch log the same way
as a season (one month-chunk per query, compact rows, no clips, no names in
the data file: `private/harvest/league-<season>-*.tsv.gz`). Each pitch is
graded against this pitcher's plan, the report's approach: the league
graded with these same targets.

```
node tools/execution-lab/league-from-harvest.mjs skenes 2026
node tools/execution-lab/build-game-data.mjs skenes "Paul Skenes" RHP PIT
```

The league file (`www/lab/execution/data/league-<season>.json`) carries
aggregates only: the anchor, the spread of per-pitcher season scores (mean
and percentiles), and per family-and-count cells (executed, within one ball
and centered rates, mean miss). The anchor is solved, not measured: it is
the miss distance `L` at which the league's average pitcher scores exactly
50, so "50 = league average" holds on the page. (The league's mean miss
itself would not land on 50, because the score is a bell curve of the miss
and most pitches miss by less than the mean.) The build then anchors every
season on it and the page says "vs league" on the season tile, with the
league's range in the layer note. Without a league file the build falls
back to the pitcher's own mean miss.

Pitch types with no rule in this pitcher's plan (cutters, for one) are left
out of the league; the provider's FT grades as SI and KC as CU (which grades
as SL). 2026: 31 starters, 87,637 pitches harvested, 78,530 graded, anchor
2.12 in; the league runs 43 to 56 per pitcher (p10 45.6, p90 53.7).

Getting the harvest out of the browser: Chrome stopped saving page-triggered
downloads partway through, even from a real click. What works instead is a
tiny local receiver (`node` HTTP server on 127.0.0.1) with a hand-off page;
the provider tab opens that page from a trusted click (`window.open`),
posts the gzip bytes to it with `postMessage`, and the page saves them
same-origin. Keep the browser-side store until the file is verified on disk.

## The catch point (`cp` on each pitch)

The plate location is where the ball crossed the front of the plate. The
catcher takes it about three feet further on, lower and a little further
across, and that is where the glove is in the picture, so the clip overlay
puts its filled dot at the catch point and a small ring at the plate crossing
(the grades still use the plate crossing). Chart views stay at the plate.

The build computes it from the provider's per-pitch release side, release
height and break length (`private/harvest/<id>-rel.tsv.gz`, harvested from
the pitch log by pitch id: 5,887 of 5,887 joined for 2025 and 2026). The
ball's direction at the plate is the release-to-plate chord plus the bend:
for a constant-acceleration flight the slope at the end leaves the chord by
(total deflection) / (flight distance), and the provider's break length is a
quarter of the total deflection (a parabola's mid-point distance from its
chord). Constants in `build-game-data.mjs`: extension 6.5 ft, flight
distance 60.5 − 6.5 − 1.417 ft, catch depth 3.0 ft from the front of the
plate (`policy.catch_depth_ft` in the data file). The bend is applied
straight down; the sideways share is small, and the provider's break angle
is not a direction (it is positive for every pitch of a given hand). Checked
sign conventions: release side is in the plate-location frame (left-handers
positive, right-handers negative). Result on this pitcher: the catch point
sits about 1.6 in toward first base and 3 to 4.5 in lower than the plate
crossing, fastballs least, off-speed most. Only the catch point ships; the
release point and velocity stay in `private/`.

## Glove reads at scale: Tag gloves and `setup-times.mjs`

Automatic glove detection was tried and set aside: the broadcast camera is
the only angle that shows the catcher (the provider's "high home" clip is a
wide stadium shot), and on it the mitt is a dozen pixels, half behind the
pitcher. What makes reads cheap instead is removing everything but the tap:

- `tools/execution-lab/setup-times.mjs <id> [--date] [--jobs] [--frames]`
  finds the set-up moment in every clip with ffmpeg and writes
  `data/<id>-setup.json` (pitch id to seconds; about 0.8 s a clip, resumable,
  `--frames` saves the chosen frame to `private/frames/<id>/` to check by
  eye). Two motion signals per frame (plate region from the park calibration,
  whole picture); whole-picture jumps are cuts, dissolves or pans, and the
  runs between them are shots. The wide shot is steady, looks like the park's
  reference signature (a z-scored 40 x 22 thumbnail taken from the park's
  first clips), and holds the biggest burst in the plate region; from that
  burst's peak the detector walks back to the last calm stretch, or to the
  shot's first frame when it opens mid-delivery. Checked by eye on a full
  start: every frame showed the catcher set.
- **Tag gloves** (coach tool on the clip card) walks every pitch in view that
  has a clip and no read: the clip opens paused on its set-up frame, zoomed
  2.4x on the plate, with the plan target offered as the glove; tap the mitt
  if it sits elsewhere (arrow keys nudge an inch), Enter saves and the next
  pitch opens, S skips, Esc stops. Saves go through the same path as Edit
  target (team store when a coach is signed in). A start takes a few minutes.

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
