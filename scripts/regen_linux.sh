#!/usr/bin/env bash
# Regenerate committed generated artifacts on the canonical platform (SPEC 3.7): python:3.11-slim,
# where CI and the live API run. The sim is byte-identical only within one OS (macOS and glibc
# differ in libm's last bits), so files made on a Mac fail CI's byte checks.
#
#   scripts/regen_linux.sh [group ...]     groups: exports xt evals season dataset all
#                                          (default: exports)
#
# exports  web/public/data, demo/hero.html, the web fixtures (live stats, pitch control, tactics)
# xt       analytics/xt_grid.json and eval/reports/xt_fit.* (about 25 min on 4 cores); then run
#          `exports` and `evals`: they read the grid
# evals    every eval report but the season
# season   eval/reports/season.md (about an hour on 4 cores)
# dataset  data/sample (the full dataset is built in the container and discarded)
#
# Needs Docker (native arm64 on a Mac equals amd64 Linux). The repository is mounted read-only and
# copied inside the container; the results are copied back into this checkout at the end.
# WORKERS (default 4) caps the evals' process pools.
set -euo pipefail

cd "$(dirname "$0")/.."
groups=("${@:-exports}")
if [[ " ${groups[*]} " == *" all "* ]]; then groups=(xt exports evals season dataset); fi
workers=${WORKERS:-4}
out=$(mktemp -d -t tte-regen.XXXXXX)

status=0
docker run --rm --cpus "$workers" -e GROUPS_TO_RUN="${groups[*]}" -e WORKERS="$workers" \
  -v "$PWD":/src:ro -v "$out":/out python:3.11-slim bash -c '
set -uo pipefail
pip install -q uv 2>/dev/null
cp -r /src /w && cd /w
export UV_PROJECT_ENVIRONMENT=/tmp/venv APPLICATIONINSIGHTS_CONNECTION_STRING= OMP_NUM_THREADS=1
uv sync -q --locked
mkdir -p /tmp/pin && echo "import os; os.cpu_count = lambda: $WORKERS" > /tmp/pin/sitecustomize.py
export PYTHONPATH=/tmp/pin
failed=0
run() { echo "== $*"; uv run "$@" > /tmp/log.txt 2>&1 || { failed=1; tail -20 /tmp/log.txt; }; }
has() { [[ " $GROUPS_TO_RUN " == *" $1 "* ]]; }
if has xt; then run python -m eval.xt_fit; fi
if has exports; then
  run python -m sim.export --scenario blind_side_run --seed 3 --out web/public/data/hero_seed3.json \
    --payload-fixture web/public/data/fixture_payload_seed3.json --what-if web/public/data/whatif_seed3.json
  run python -m sim.export --scenario press_escape --seed 0 --out /tmp/press.json \
    --what-if web/public/data/whatif_press_escape_seed0.json
  run python -m sim.export --scenario far_post_finish --seed 11 --out /tmp/far.json \
    --what-if web/public/data/whatif_far_post_finish_seed11.json
  run python -m sim.export --scenario blind_side_run --seed 3 --without-look web/public/data/without_look_seed3.json
  run python -m sim.export --scenario far_post_finish --seed 11 \
    --without-look web/public/data/without_look_far_post_finish_seed11.json
  run python -m sim.export --scenario blind_side_run --seed 3 --looks web/public/data/look_seed3.json
  run python -m sim.export --scenario press_escape --seed 0 --looks web/public/data/look_press_escape_seed0.json
  run python -m sim.export --scenario blind_side_run --seed 3 --steps web/public/data/steps_seed3.json
  run python -m sim.export --scenario press_escape --seed 0 --steps web/public/data/steps_press_escape_seed0.json
  run python -m demo.build --seed 3
  run python -m analytics.live_stats --scenario blind_side_run --seed 3 --web-fixture web/src/stats/fixture_seed3.json
  run python -m eval.pitch_control_parity
  run python -m explain.tactics --fixture --web-fixture web/src/tactics/fixture.json
fi
if has evals; then
  for s in blind_side_run cutback_scan keeper_switch; do run python -m eval.hero_flip --scenario "$s" --seeds 100-139; done
  for s in blind_side_run press_escape corner_blind_side cutback_scan far_post_finish keeper_switch; do
    run python -m eval.hero_lens --scenario "$s"
  done
  run python -m eval.hero_lens --scenario press_escape --seeds 100-139
  for m in hero_shot hero_save hero_marking realism match_stats pass_difficulty blind_side \
           scan_detector keypoint_ingest corruption scan_calibration; do run python -m "eval.$m"; done
  run python -m eval.hero_shot --seeds 100-139
  for s in blind_side_run press_escape; do run python -m eval.look_grid --scenario "$s"; done
  run python -m eval.laws --workers "$WORKERS"
fi
if has season; then run python -m eval.season --workers "$WORKERS"; fi
if has dataset; then run python -m sim.dataset --matches 10 --out /tmp/dataset --sample data/sample; fi
mkdir -p /out/analytics /out/data /out/demo /out/web/public /out/web/src /out/eval
cp analytics/xt_grid.json /out/analytics/ && cp -r data/sample /out/data/ && cp demo/hero.html /out/demo/
cp -r web/public/data /out/web/public/ && cp -r eval/reports /out/eval/
cp -r web/src/stats web/src/pitchControl web/src/tactics /out/web/src/
exit $failed
' || status=$?
cp "$out/analytics/xt_grid.json" analytics/ && cp "$out/demo/hero.html" demo/
for path in data/sample web/public/data eval/reports web/src/stats web/src/pitchControl web/src/tactics; do
  cp -R "$out/$path/." "$path/"
done
echo "copied the results into $PWD (git diff shows what changed); logs and copies in $out"
exit $status
