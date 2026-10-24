#!/usr/bin/env bash
# The regeneration steps of the committed generated artifacts (SPEC 3.7), run in the current
# environment. They are only canonical on linux/amd64: run them through `scripts/regen_linux.sh`
# (Docker) or the `regen` workflow (.github/workflows/regen.yml, on CI's own runner).
#
#   scripts/regen_steps.sh group ...     groups: exports xt evals season dataset
#
# WORKERS (default 4) caps the evals' process pools. Every step runs; the exit status is 1 if any
# failed, and each failure's last lines are printed.
set -uo pipefail

cd "$(dirname "$0")/.."
workers=${WORKERS:-4}
export APPLICATIONINSIGHTS_CONNECTION_STRING= OMP_NUM_THREADS=1
pin=$(mktemp -d -t tte-pin.XXXXXX)
echo "import os; os.cpu_count = lambda: $workers" > "$pin/sitecustomize.py"
export PYTHONPATH="$pin"
log=$(mktemp -t tte-step.XXXXXX)
failed=0
run() {
  echo "== $*"
  uv run "$@" > "$log" 2>&1 || { failed=1; tail -20 "$log"; }
}

for group in "$@"; do
  case "$group" in
    xt) run python -m eval.xt_fit ;;
    exports)
      run python -m sim.export --scenario blind_side_run --seed 3 --out web/public/data/hero_seed3.json \
        --payload-fixture web/public/data/fixture_payload_seed3.json \
        --what-if web/public/data/whatif_seed3.json
      run python -m sim.export --scenario press_escape --seed 0 --out "$pin/press.json" \
        --what-if web/public/data/whatif_press_escape_seed0.json
      run python -m sim.export --scenario far_post_finish --seed 11 --out "$pin/far.json" \
        --what-if web/public/data/whatif_far_post_finish_seed11.json
      run python -m sim.export --scenario blind_side_run --seed 3 \
        --without-look web/public/data/without_look_seed3.json
      run python -m sim.export --scenario far_post_finish --seed 11 \
        --without-look web/public/data/without_look_far_post_finish_seed11.json
      run python -m sim.export --scenario blind_side_run --seed 3 \
        --extra-looks web/public/data/extra_looks_seed3.json
      run python -m sim.export --scenario blind_side_run --seed 3 --looks web/public/data/look_seed3.json
      run python -m sim.export --scenario press_escape --seed 0 \
        --looks web/public/data/look_press_escape_seed0.json
      run python -m sim.export --scenario blind_side_run --seed 3 --steps web/public/data/steps_seed3.json
      run python -m sim.export --scenario press_escape --seed 0 \
        --steps web/public/data/steps_press_escape_seed0.json
      run python -m sim.export --scenario pro_scan --seed 116 \
        --steps web/public/data/steps_pro_scan_seed116.json
      run python -m demo.build --seed 3
      run python -m analytics.live_stats --scenario blind_side_run --seed 3 \
        --web-fixture web/src/stats/fixture_seed3.json
      run python -m eval.pitch_control_parity
      run python -m explain.tactics --fixture --web-fixture web/src/tactics/fixture.json
      ;;
    evals)
      for s in blind_side_run cutback_scan keeper_switch; do
        run python -m eval.hero_flip --scenario "$s" --seeds 100-139
      done
      for s in blind_side_run press_escape corner_blind_side cutback_scan far_post_finish keeper_switch; do
        run python -m eval.hero_lens --scenario "$s"
      done
      run python -m eval.hero_lens --scenario press_escape --seeds 100-139
      for m in hero_shot hero_save hero_marking realism match_stats pass_difficulty blind_side \
               scan_detector keypoint_ingest corruption scan_calibration; do
        run python -m "eval.$m"
      done
      run python -m eval.hero_shot --seeds 100-139
      run python -m eval.hero_gates
      run python -m eval.extra_looks
      run python -m eval.pro_scan --workers "$workers"
      for s in blind_side_run press_escape; do run python -m eval.look_grid --scenario "$s"; done
      run python -m eval.laws --workers "$workers"
      ;;
    season) run python -m eval.season --workers "$workers" ;;
    dataset)
      run python -m sim.dataset --matches 10 --out "$pin/dataset" --sample data/sample
      # The counts docs/DATASET.md quotes ("At a glance"), from the full build.
      mkdir -p out && uv run python - "$pin/dataset" > out/dataset_counts.txt <<'PY'
import collections, json, sys
import pyarrow.parquet as pq
d = sys.argv[1]
types = collections.Counter(pq.read_table(f"{d}/events.parquet").column("type").to_pylist())
meta = json.load(open(f"{d}/metadata.json"))
frames = [m["frames"] for m in meta["matches"]]
files = json.load(open(f"{d}/manifest.json"))["files"]
print("events", sum(types.values()), dict(types.most_common()))
print("frames", sum(frames), "minutes", round(sum(frames) / 25 / 60, 1))
print({name: f.get("rows") for name, f in files.items() if f.get("rows")})
PY
      ;;
    *) echo "unknown group: $group (exports xt evals season dataset)"; exit 2 ;;
  esac
done
exit $failed
