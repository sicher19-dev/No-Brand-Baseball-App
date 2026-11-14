#!/usr/bin/env bash
# Tip Detection: keep running the coarse and pose passes over every downloaded clip
# until both views are fully processed. Resumable; safe to re-run.
#   bash tools/tip/pose-loop.sh skenes
set -u
P=${1:-skenes}
cd "$(dirname "$0")/../.."
export PATH="/c/Users/Brian Sicher/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin:$PATH"
PY=./.venv-tip/Scripts/python.exe
LOG=private/tip/$P/pose-run.log
for i in $(seq 1 80); do
  echo "=== round $i $(date)" >> "$LOG"
  for V in D V; do
    [ -d "private/tip/$P/clips/$V" ] || continue
    $PY tools/tip/py/coarse.py "$P" --view $V --jobs 4 >> "$LOG" 2>&1
    $PY tools/tip/py/pose_clips.py "$P" --view $V >> "$LOG" 2>&1
  done
  nd=$(ls private/tip/$P/clips/D 2>/dev/null | wc -l); pd=$(ls private/tip/$P/pose/D/*.npz 2>/dev/null | wc -l)
  nv=$(ls private/tip/$P/clips/V 2>/dev/null | wc -l); pv=$(ls private/tip/$P/pose/V/*.npz 2>/dev/null | wc -l)
  echo "round $i: D $pd/$nd  V $pv/$nv" >> "$LOG"
  if [ "$pd" -ge "$nd" ] && [ "$pv" -ge "$nv" ] && ! pgrep -f download-clips.mjs > /dev/null; then echo "all done" >> "$LOG"; break; fi
  sleep 240
done
tail -3 "$LOG"
