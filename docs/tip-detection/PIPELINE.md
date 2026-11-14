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
  py/report.py                page data + side-by-side frames -> www/lab/tip/data/<id>.json, data/<id>/frames/

www/lab/tip/index.html?p=<id>   the player-facing Tip Report page (reads data/<id>.json)
```

Views by team-server letter: `D` hitter view (open-side plate camera), `J` its
closed-side twin, `V` tight center field, `C` wide center field, `L` high-speed
center field. The hitter model uses D (J when D is missing); the center-field
model uses V.

Order, per pitcher and season:

```
node tools/tip/download-clips.mjs skenes --views hitter,tightcf --from 2026-03-26 --jobs 8
node tools/tip/situations-from-feed.mjs skenes --season 2026 --pitcher 694973
.venv-tip/Scripts/python tools/tip/py/coarse.py skenes --view D
.venv-tip/Scripts/python tools/tip/py/pose_clips.py skenes --view D
.venv-tip/Scripts/python tools/tip/py/events.py skenes --view D
.venv-tip/Scripts/python tools/tip/py/features.py skenes --view D
.venv-tip/Scripts/python tools/tip/py/train.py skenes --view D
.venv-tip/Scripts/python tools/tip/py/report.py skenes --views D,V
```

Preview the page with `.venv-tip/Scripts/python -m http.server 8765 -d www` and open
`http://localhost:8765/lab/tip/index.html?p=skenes`.

Every step is resumable and skips clips it has already done. Pose costs about
5 s per clip on the RTX 4070 (detector every third frame, pose on the pitcher
crop only). A pitch where the pitcher leaves the frame (pickoff) is flagged
`small_pitcher` or `release_at_window_end` by events.py and left out of training.

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
