#!/usr/bin/env bash
# Regenerate committed generated artifacts on the canonical platform (SPEC 3.7): python:3.11-slim
# on linux/amd64, where CI and the live API run. The sim is byte-identical only within one platform
# (macOS and glibc differ in libm's last bits), so files made on a Mac fail CI's byte checks. The
# steps are scripts/regen_steps.sh; .github/workflows/regen.yml runs them on CI's own runner.
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
# Needs Docker. It runs linux/amd64, emulated on Apple silicon (slower): arm64 Linux differs from
# amd64 in the last bit of a few exports (numpy's SIMD paths). The repository is mounted read-only and
# copied inside the container; the results are copied back into this checkout at the end.
# WORKERS (default 4) caps the evals' process pools.
# numpy takes its AVX2 path, as in CI, even on a host with AVX-512 (tests/canonical.py).
set -euo pipefail

cd "$(dirname "$0")/.."
groups=("${@:-exports}")
if [[ " ${groups[*]} " == *" all "* ]]; then groups=(xt exports evals season dataset); fi
workers=${WORKERS:-4}
out=$(mktemp -d -t tte-regen.XXXXXX)

status=0
docker run --rm --platform linux/amd64 --cpus "$workers" -e WORKERS="$workers" \
  -e NPY_DISABLE_CPU_FEATURES="X86_V4 AVX512_ICL AVX512_SPR" \
  -v "$PWD":/src:ro -v "$out":/out python:3.11-slim bash -c '
set -uo pipefail
pip install -q uv 2>/dev/null
cp -r /src /w && cd /w
export UV_PROJECT_ENVIRONMENT=/tmp/venv
uv sync -q --locked
scripts/regen_steps.sh "$@"
failed=$?
mkdir -p /out/analytics /out/data /out/demo /out/web/public /out/web/src /out/eval
cp analytics/xt_grid.json /out/analytics/ && cp -r data/sample /out/data/ && cp demo/hero.html /out/demo/
cp -r web/public/data /out/web/public/ && cp -r eval/reports /out/eval/
cp -r web/src/stats web/src/pitchControl web/src/tactics /out/web/src/
cp -r out /out/out 2>/dev/null
exit $failed
' regen "${groups[@]}" || status=$?
cp "$out/analytics/xt_grid.json" analytics/ && cp "$out/demo/hero.html" demo/
for path in data/sample web/public/data eval/reports web/src/stats web/src/pitchControl web/src/tactics; do
  cp -R "$out/$path/." "$path/"
done
echo "copied the results into $PWD (git diff shows what changed); logs and copies in $out"
exit $status
