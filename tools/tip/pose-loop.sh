#!/usr/bin/env bash
# Tip Detection: keep running the coarse and pose passes over every downloaded clip
# until both views are fully processed. Resumable; safe to re-run.
#   bash tools/tip/pose-loop.sh skenes [views, e.g. "D" or "V"] [shard k/n]
# Several loops share the GPU: e.g. "D 0/2", "D 1/2", "V 0/2", "V 1/2" (decode is the bottleneck, not the GPU).
set -u
P=${1:-skenes}
VIEWS=${2:-D V}
SHARD=${3:-0/1}   # k/n: this loop poses every n-th clip starting at k; only shard 0 runs the coarse pass
cd "$(dirname "$0")/../.."
export PATH="/c/Users/Brian Sicher/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin:$PATH"
PY=./.venv-tip/Scripts/python.exe
LOG=private/tip/$P/pose-run.log
for i in $(seq 1 80); do
  echo "=== round $i $(date)" >> "$LOG"
  for V in $VIEWS; do
    [ -d "private/tip/$P/clips/$V" ] || continue
    case "$SHARD" in 0/*) $PY tools/tip/py/coarse.py "$P" --view $V --jobs 4 >> "$LOG" 2>&1 ;; esac
    $PY tools/tip/py/pose_clips.py "$P" --view $V --shard "$SHARD" >> "$LOG.$V.${SHARD%/*}" 2>&1
  done
  done_all=1; line="round $i:"
  for V in $VIEWS; do
    n=$(ls private/tip/$P/clips/$V 2>/dev/null | wc -l); p=$(ls private/tip/$P/pose/$V/*.npz 2>/dev/null | wc -l)
    line="$line $V $p/$n"; [ "$p" -ge "$n" ] || done_all=0
  done
  echo "$line" >> "$LOG"
  if [ "$done_all" = 1 ] && ! pgrep -f download-clips.mjs > /dev/null; then echo "all done $VIEWS" >> "$LOG"; break; fi
  sleep 240
done
tail -3 "$LOG"
