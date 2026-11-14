# Tip Detection module: findings, data schema, stage 1 plan

Draft 2026-11-14. Internal document. Nothing here is player-facing.

## 1. What already exists in the repo

Repo `sicher19-dev/No-Brand-Baseball-App`, branch `execution-lab`. The only checkout on this
machine lives in a folder the app made for the 2026-11-13 session, which disappears if that
session is deleted. It needs a permanent home before this module starts.

Clip-pull code (all under `tools/execution-lab/`):

| File | What it does | Reuse for tips |
|---|---|---|
| `harvest-clips.browser.js` | Console snippet on the provider's pitch log. Reads the table's own data (`playGuid`, `videoAngles`), keeps two angles (`MLB Home` -> `h`, `MLB High Home` -> `hh`), accumulates in localStorage, downloads a gzip TSV. One month per page load (1,000 row cap). | Keep, but change `WANT` to keep every angle and store the team-server letter code. |
| `clips-from-tsv.mjs` | TSV -> `www/lab/execution/data/<id>-clips.json` {play_id: {h, hh}}. | Replace with a wider clip table (section 3). |
| `setup-times.mjs` | ffmpeg decodes each clip to 320x180 grey at 10 fps, finds the steady wide shot and the last calm stretch before the delivery burst: the set-up frame. Already run on all 5,880 Skenes clips (2025 + 2026, `h` angle). | Same idea gives t_set and t_release at 60 fps on the team feeds. |
| `build-game-data.mjs`, `pitches-from-harvest.mjs` | Pitch-level data for the page from `private/` CSVs and harvest TSVs. | Source of the game labels (section 3). |

Pitch-level labels already on disk for Skenes 2026: `private/skenes_execution_pitch_level_INTERNAL.csv`
(2,890 pitches, 32 games: game_date, game_pk, play_id, opp, home, inning, at_bat_number,
pitch_number, batter, stand, balls, strikes, pitch_type, family, plate location, release_speed)
plus harvest TSVs with outs, score, release side and height, and catch point.

## 2. Camera angles the provider actually returns

Checked on the live pitch log for Skenes, every 2026 game. 37 angle names exist. They come
from two hosts:

| Host | Angles | Format | Notes |
|---|---|---|---|
| Public clip CDN (`sporty-clips`) | `MLB Home`, `MLB High Home`, `MLB CF`, `MLB Mid Home`, `MLB Away`, `MLB 1B/3B Batter`, `MLB 1B/3B Pitcher`, `MLB Pitchcast` | 1280x720, 59.94 fps, about 6.8 s | Scorebug burned in on Home. Set-up at about 1.3 s, so little lead time. Already mapped for all 2,890 pitches. |
| Team video server (host kept in `private/tip/video-host.txt`, not in the repo) | 26 angles, letter codes A-Z (table below) | 1280x720, 60 fps, about 11.3 s. High-speed angles 1408x800, 29.97 fps playback, about 1,100 frames per pitch | URLs in the table have no extension and 404 as-is. **Append `.MP4` and they work.** No scorebug. Reachable from this laptop with no login (verify from other machines and off-network). |

Team-server letter codes (stable across all months checked):

```
A Program            B Pitcher Open Side   C CF Broadcast        D Hitter Perspective
E High Home          F Pitcher Front       G Overhead Home Plate H Hitter Open
I Pitcher Backside   J Hitter Persp Closed K Hitter Backside     L Highspeed CF
M Highspeed Pitcher Front  N Highspeed Pitcher Backside  O Highspeed Pitcher Open
P Mid1st-Pickoff     Q Highspeed Hitter Open  R Highspeed Hitter Backside
S Mid Home Broadcast T 1B Side Field View  U 3B Side Field View  V Tight CF Broadcast
W Tight CF IP        X Low Home Broadcast  Y BAM Pitchcast       Z BAM Program
```

What each candidate looks like (frames in `tip-detection/angles/`, contact sheet
`all-12-angles-contact-sheet.jpg`):

- **Hitter Perspective (D)**: plate-level camera on the batter's open side, looking out at the
  pitcher. Pitcher fills about a third of the frame height, glove and hands clearly visible.
  **This is the closest thing to what the batter sees.**
- **Hitter Perspective Closed (J)**: the twin camera on the batter's closed side. Often part-blocked
  by the umpire and catcher. The naming is relative to the batter: in September home games only
  one camera per pitch was kept, and right-handed hitters got "Perspective" while left-handed
  hitters got "Closed", so D is always the open-side camera for that hitter.
- **Hitter Open / Hitter Backside (H, K)**: point at the hitter. The pitcher is not in frame. Useless here.
- **Pitcher Front (F)**: low camera on the first-base side behind the umpire, pitcher head-on.
  Fallback hitter-ish view when D is missing.
- **CF Broadcast (C)**: clean standard center-field framing, pitcher centered, no scorebug.
  **Primary CF view.** Present for every 2026 regular-season pitch.
- **Tight CF Broadcast (V)**: tight on the pitcher's back from center field. Glove, hands and number
  fill the frame. Best source for stage 2 glove crops from the CF/runner-on-second side.
- **Highspeed CF (L)**: greyscale slow-motion from high center field, about 1,100 frames per pitch.
  Covers the release window (brief item D) without a facility high-speed camera.
- **Overhead Home Plate (G)**: looks straight down at the plate. Not a tipping angle.
- **MLB Home (h)**: already mapped; wide broadcast shot with scorebug. Fallback only.

Timing on the team feeds (Hitter Perspective, Aug 19 pitch 1): standing with sign at 2.5 s,
set at 5.0 s, ball in flight at 7.5 s. So each clip holds at least five seconds before release,
enough for "one second before top of leg lift".

### Coverage, 2026 regular season (32 games, 2,890 pitches)

Pitch type codes are the provider's. `FT` and `SI` both map to the sinker in our files, so
they are summed as SI below. `CU` is 12 pitches and is dropped.

| View | Games | Pitches | FF | ST | SL | CH | FS | SI (FT+SI) | Below 150 |
|---|---|---|---|---|---|---|---|---|---|
| CF Broadcast (C) | 32 | 2,890 | 1,180 | 375 | 332 | 359 | 292 | 340 | none |
| Tight CF Broadcast (V) | 32 | 2,889 | 1,179 | 375 | 332 | 359 | 292 | 340 | none |
| Hitter Perspective (D) | 28 | 2,265 | 894 | 299 | 279 | 275 | 222 | 284 | none |
| Hitter Perspective Closed (J) | 24 | 2,015 | 801 | 241 | 241 | 271 | 211 | 244 | none |
| Pitcher Front (F) | 26 | 2,314 | 958 | 315 | 231 | 316 | 242 | 240 | none |
| Highspeed CF (L) | 27 | 2,394 | ~1,000 | ~320 | ~280 | ~290 | ~260 | ~280 | none |
| MLB Home (h) | 32 | 2,890 | 1,180 | 375 | 332 | 359 | 292 | 340 | none |

Hitter Perspective is missing for four away games (AZ 05-06, COL 06-20, CLE 07-19, MIA 08-11)
and is partial at CIN 07-31 (43 of 100) and in the four September home games (about half of
each; the other half is on the Closed camera). Away-park versions of D come from the home
team's own camera system, so framing shifts park to park; the hitter-view model has to be
normalized per park (or trained on PNC only first: 17 home games, about 1,470 pitches on D).

### Labels available per pitch from the provider's table

Available: play id, game date, venue id, home/away, inning, outs, count, at-bat number,
pitch number in game and in at-bat, batter id and hand, catcher id, pitch type, result,
release speed, spin, release side and height, break, plate location, score at that moment.

Not available: **runners on base** and **windup vs stretch**. Proposal: runners and base
state come from the public league game feed keyed by play id (internal use only, never
named player-facing); windup vs stretch is read from the video at the set (feet and hands
position), and for Skenes I expect every pitch to be from the stretch, which makes the
windup/stretch split moot for him. Column `RelTime` (value about 1.47 s) may be the
set-to-release tempo; to confirm against video before using it.

`hasKinatraxData` is false on every 2026 row, so there is no in-game 3D pose to lean on.

## 3. Proposed data schema

Everything private sits under `private/tip/<pitcher_id>/` (gitignored). Only the finished
report JSON goes under `www/lab/tip/data/<pitcher_id>.json`.

**clips.tsv** (one row per pitch per view)
`play_id, season, game_date, view_code (C/V/D/J/F/L/h), host (team|cdn), url_rel, duration_s,
fps, width, height, file_path, download_status`

**pitches.csv** (one row per pitch; joined from the internal CSV, harvest TSVs and the game feed)
`play_id, game_pk, game_date, season, park, home, opp, inning, half, outs, balls, strikes,
at_bat_num, pitch_num_game, pitch_num_ab, batter_id, batter_hand, catcher_id, runners_code
(e.g. 000/100/120), score_diff, tto, pitch_type_provider, family (FF/SI/ST/SL/CH/FS),
delivery (windup|stretch|unknown), release_speed, rel_side, rel_height, rel_time, plate_x, plate_z`

**events/<view>.csv** (per clip per view, seconds from clip start, 60 fps)
`play_id, view_code, shot_start, shot_end, t_set, t_first_move, t_leg_lift_top, t_hand_break,
t_release, quality_flags (cut_in_window, zoom_change, occluded, pitcher_not_found), method`

**pose/<view>/<play_id>.npz** (per-frame, from t_set minus 1.5 s to t_release plus 0.25 s)
`frame_t, bbox[4], kp[133,3] (whole-body: body 17 + feet 6 + face 68 + hands 42, x y conf),
track_conf`. Pitcher pixels only (other people zeroed by a person-segmentation mask).

**features/<view>.parquet** (per pitch per time slice)
Slices: fixed times before release (-2.0, -1.5, -1.0, -0.75, -0.5, -0.25, 0 s) plus event-anchored
slices (set, set+0.5, leg lift top, hand break). Features, all normalized by shoulder width with
origin at the hip midpoint so camera zoom and park do not leak in: glove (lead wrist) height and
lateral position, throwing hand relative to glove (dx, dy, in-glove depth proxy from hand
keypoints), elbow and shoulder heights both sides, trunk tilt, head position and tilt, lead
knee height, stride foot position, set duration, set-to-leg-lift time, leg-lift-to-release time,
plus raw bbox scale and position as leakage checks.

**models/<view>/<delivery>/<slice>.json**
`model (logreg|lgbm), classes, n_per_class, folds (leave-one-game-out), accuracy, log_loss,
baseline_majority, baseline_situation_only, permutation_p (1,000 label shuffles within game),
confusion, top_features, trained_at`

**report JSON** (player-facing page input)
`pitcher, views[]: {label (hitter|cf), timeline [{t_before_release, acc, baseline, ci, n}],
tells [{plain_text, slice, feature, direction, who_can_see}], frames [{family, view, t, image}]},
situation_only_acc, sample_sizes, labels (game-confirmed|pen-only|game-only), fix_cue,
facility_sessions [{date, randomized, acc_by_time, delta_vs_game}]`

## 4. Stage 1 plan (pose features, one pitcher, 2026 games)

0. **Housekeeping (half a day).** Permanent repo folder. Python toolchain on this laptop (there is
   none today): `uv` with Python 3.12, PyTorch CUDA build for the RTX 4070 Laptop GPU (8 GB
   VRAM, driver 597), `onnxruntime-gpu`, `rtmlib` (RTMPose whole-body, gives hand keypoints),
   `ultralytics` (YOLO person detect + segment), scikit-learn, lightgbm, pandas, pyarrow.
   ffmpeg 9 with CUDA decode is already installed. Node 26 stays for the page and build scripts.
1. **Harvest all angles (half a day).** Extend the console snippet to keep every angle with
   its letter code, rerun month by month for 2026 (and 2025 later), write `clips.tsv`.
2. **Download (overnight, mostly bandwidth).** Views C, V, D (J where D is missing), L.
   Team clips are about 7 MB each; four views times 2,890 pitches is roughly 80 GB. Two
   options: keep full clips on an external drive, or two-pass: first decode low-res to find
   t_release, then save only set minus 2 s to release plus 0.5 s at full resolution (about
   a quarter of the size). I favor two-pass with full clips kept for D and C only.
3. **Find the pitcher and align (2 days).** Per view: shot boundaries (reuse the whole-picture
   motion signal from `setup-times.mjs`), person detection, pitcher = the track in the mound
   region (per park and view, from the first clips), t_set from the last calm stretch,
   t_release from throwing-wrist speed peak plus ball appearance, leg lift top from lead knee
   height maximum, hand break from wrist separation. Spot check 50 clips per view by eye;
   store quality flags, drop flagged clips from training.
4. **Masking.** Crop to the pitcher box, zero everything outside the pitcher's segmentation
   mask (this removes catcher, scorebug, crowd and on-deck hitter). In the CF views the catcher
   sits directly behind the pitcher, so the mask matters most there.
5. **Pose and features (1 day of compute).** RTMPose whole-body on the masked crops at 60 fps
   for the aligned window, write `pose/` and `features/`.
6. **Models (1 day).** Per view, per delivery, per slice: standardized logistic regression, then
   LightGBM. Leave-one-game-out (32 folds). Targets: six-way family, plus the pairs that matter
   (FF vs ST, FF vs off-speed). Report accuracy and log loss versus majority baseline, with the
   permutation test. Alongside: a situation-only model (count, outs, runners, batter hand,
   inning, score, times through, park) and a camera-only model (bbox scale and position).
   Flag any slice where the video model does not beat situation-only.
7. **Tip timeline (half a day).** Accuracy versus time before release per view, with the
   baseline line, sample sizes per class, and the top three features per slice in plain words.
   Draft page section under `www/lab/tip/`.

Stage 2 (pixel crops of glove and hand, small pretrained backbone, Grad-CAM) follows once the
stage 1 timeline shows where to look. An 8 GB GPU handles a ResNet-18 or EfficientNet-B0 at
224 px crops with batch 64 comfortably.

## 5. Questions before any code

1. Permanent folder for the app repo checkout (today it is session-scoped and will vanish).
2. Start with Skenes? All the labels and clip maps are already in hand for him.
3. Where should 40-80 GB of clips live (external drive, NAS, this laptop's SSD)?
4. OK to install the Python toolchain above on this laptop?
5. Runners and base state: OK to pull them from the public league game feed by play id?
6. Facility cameras: make, resolution, frame rate, mount positions, and where the pen video
   and Execution Lab pitch tags are stored (paths and formats).
7. Is the team video server reachable from the facility network and from other machines?
   It answered this laptop with no login, which also means we should keep those URLs out of
   anything shared.
8. Confirm Skenes throws every pitch from the stretch.
9. Which other 2027 arms have game video on the provider (the team-server angles only exist
   for Pirates games, other orgs' arms will have CDN angles only).
