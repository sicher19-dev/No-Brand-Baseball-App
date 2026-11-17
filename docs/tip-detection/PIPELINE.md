# Tip Detection pipeline (stage 1)

Internal notes. Everything under `private/` is gitignored. Python lives in
`.venv-tip/` (uv, Python 3.12, PyTorch CUDA 12.8, onnxruntime-gpu CUDA 12 build,
rtmlib whole-body pose, LightGBM). ffmpeg must be on PATH.

```
tools/tip/
  harvest-angles.browser.js   console snippet: every angle per pitch -> clips-<season>-all-angles.tsv
  download-clips.mjs          team-server clips per view -> private/tip/<id>/clips/<letter>/<play_id>.mp4
  situations-from-feed.mjs    runners, outs, count, score, order per pitch -> situations-<season>.csv
  py/tipkit.py                paths, views, decoding, pitcher box selection, pose runner
  py/coarse.py                delivery time per clip from cheap grey motion -> coarse/<view>.csv
  py/pose_clips.py            whole-body keypoints of the pitcher, 30 fps, 4.5 s before to 1.2 s after -> pose/<view>/*.npz
  py/events.py                set, leg lift, hand break, release per clip -> events/<view>.csv
  py/features.py              pose features at time slices -> features/<view>.csv
  py/train.py                 per-slice models with all checks -> models/<view>/timeline.json, report.md
  py/report.py                dashboard + game pages + stills + cropped clips -> www/lab/tip/data/<id>.json,
                              data/<id>/games/<date>.json, data/<id>/frames/, data/<id>/clips/
  pose-loop.sh                coarse + pose over the given views until everything downloaded is processed;
                              takes a shard k/n so several loops share the GPU (decode is the bottleneck)

www/lab/tip/index.html?p=<id>            dashboard: verdicts, games list, timeline, tells, frames, fix cue
www/lab/tip/game.html?p=<id>&g=<date>    one game: readability by angle, flagged pitches with clips, quick fix
```

Views by team-server letter: `D` hitter view (open-side plate camera), `J` its
closed-side twin, `V` tight center field, `C` wide center field, `L` high-speed
center field. The hitter model uses D (J when D is missing); the center-field
model uses V.

Order, per pitcher and season:

```
node tools/tip/download-clips.mjs skenes --views hitter,cf --from 2026-03-26 --jobs 8
node tools/tip/situations-from-feed.mjs skenes --season 2026 --pitcher 694973
.venv-tip/Scripts/python tools/tip/py/coarse.py skenes --view D
.venv-tip/Scripts/python tools/tip/py/pose_clips.py skenes --view D
.venv-tip/Scripts/python tools/tip/py/events.py skenes --view D
.venv-tip/Scripts/python tools/tip/py/features.py skenes --view D
.venv-tip/Scripts/python tools/tip/py/train.py skenes --view D
.venv-tip/Scripts/python tools/tip/py/report.py skenes --views D,C
```

Views that feed the models: `D` (hitter view, open-side plate camera) and `C`
(wide center field). `C` is a steady camera that holds the whole body from the
set through release and only cuts away after the pitch. `V` (tight center
field) is a broadcast shot: it zooms to the chest while the pitcher is in the
set, so the legs are out of frame and no leg lift or release can be timed, and
it cuts to the batter or catcher within a second of the pitch. Its pose output
is kept under `pose/V/` for a later glove-crop stage but is not trained on.
The coarse pass blanks scene cuts and the first second so the motion peak lands
on the delivery, not on the cut after it; wide views also search a fixed 4-13.5 s
window because a runner or close-up later in the clip can out-move the small
pitcher.

Known issue (2026-11-14): on the center-field angle the wrist-speed peak comes
about 0.5 s after the true release (the arm travels toward the camera, so its 2D
speed peaks in the follow-through): lift_start sits at -0.9 s and hand break at
-0.1 s against -1.4 s and -0.6 s on the hitter view. Slice times on that angle
are therefore conservative (earlier than labeled). Fix later with a CF-specific
release rule (e.g. wrist crossing the shoulder line) before trusting CF timing.

Preview the page with `.venv-tip/Scripts/python -m http.server 8765 -d www` and open
`http://localhost:8765/lab/tip/index.html?p=skenes`.

Every step is resumable and skips clips it has already done. Pose costs about
5 s per clip on the RTX 4070 (detector every third frame, pose on the pitcher
crop only). A pitch where the pitcher leaves the frame (pickoff) is flagged
`small_pitcher`, `release_at_window_end`, `odd_track` (wrong person locked) or `scale_jump` (the camera zoomed or cut to a close-up inside the delivery window, so the box grows past 1.4x the standing height) by events.py and left out of training.

Labels: pitch type from the internal pitch file (`FT` and `SI` are both the
sinker; `CU` is dropped), situation from `situations-<season>.csv`.

Delivery: Skenes winds up with the bases empty and pitches from the stretch with
runners on (`pitcher.json` `"delivery": "both"`). Windup and stretch get their own
models (`models/<view>/windup/`, `models/<view>/stretch/`) and their own entries on
the page. The delivery of each pitch is read from the video: the shoulder width on
screen 1.5 to 0.8 s before the leg lift (a windup is still square to the plate
there, a stretch is side-on; AUC 0.97 against the base state on the first four
games). The base state is the fallback where the cue is missing.

Pitcher tracking in the plate cameras: the catcher, umpire and batter stand in
the foreground, often taller on screen than the pitcher, and the detector
sometimes misses him or merges him with the umpire mid-delivery. The picker takes
the fully visible person whose feet sit highest in the frame, and a pick that is
not the same person or size as the previous box is ignored for up to a second.
Checked on four parks (PNC, Citi Field, American Family Field) before the full run.

Timing notes from the first 150 hitter-view clips (30 fps): leg lift start to
release 1.17 s median, hand break to release about 0.6 s. With the bases empty
Skenes comes set and goes within half a second; with runners on he holds the set
for 3 s or more, which is before the pose window starts (`set_censored`).

Lessons that shaped events.py:

- The coarse motion peak can land 2 s or more after release when the catcher,
  umpire or batter move in the foreground after the pitch, so the release search
  is not tied to it.
- Pose glitches while the pitcher is occluded give wrist "speeds" three to five
  times a real throw. Release candidates are therefore gated on body confidence,
  wrist confidence and no box jump, and a candidate only counts when a leg lift
  of at least a tenth of body height precedes it. `release_unsure` marks clips
  where no candidate passed.
- Hands wiggle in the set (glove taps at 0.3-0.5 heights/s), so the set is
  defined by hands together and a quiet lead knee, not by stillness alone.
- A slice only carries what a hitter could have seen by then. Durations are
  features too (set length, lift to release, hand break to release), and a
  duration is given to a slice only once it has ended: the three spans that end
  at release exist only on the release slice, and the set length only from the
  start of the leg lift. Before this rule, a quick or slow finish was credited to
  the set two seconds earlier and read as a tell there.
- The center-field camera in some parks sits high and far, so the leg lift is
  foreshortened and the release reads late; those games come back almost fully
  `release_unsure low_lift` and drop out of the center-field model. In 2026 that
  is most of a Phillies season (home park plus several road parks), so for the
  Phillies the center-field rows are thin and the hitter view carries the verdict.

## Game pages

`train.py` writes `pitches.csv` per view and delivery: for every pitch and slice,
the held-out video read (predicted type and the probability of the true type)
next to the situation-only read. `report.py` turns that into a games list and
one JSON per game. A pitch is flagged when, at least 0.5 s before release, the
video named the type with p >= 0.6 and beat the situation read by 0.15 or more;
only views and deliveries with a weak or clear verdict flag pitches. The verdict
itself only looks at slices at least 0.5 s before release (`TIP_WINDOW` in
report.py): at and just before release the arm action shows the pitch, which is
not a tell, so those slices are drawn on the timeline for context only
(`--force-flags` overrides that for previews). A slice is weak when the video
beats guessing the usual pitch by 5 points, beats the count-and-runners read by
3, and the permutation p is under .05; clear at 10 points, 5 and p under .01.
The headline verdict is the strongest such slice in the window (clear beats
weak, then the bigger lift); the earliest such slice is kept beside it as
`earliest`, since how early a hitter can read it matters too. Each flagged pitch gets a 2.6 s
pitcher-only clip (ffmpeg crop from the tracked box, 480 px, no sound, no
scorebug) and a comparison clip of the most common other type in that game.
Clips and stills are gitignored; the JSON files hold only aggregates and play ids.
