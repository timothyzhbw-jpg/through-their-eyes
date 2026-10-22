#!/usr/bin/env bash
# Upload the web build to the Storage static website's $web container (SPEC 8), checked:
#   1. stage it (web/scripts/stage.mjs): text gzipped, every known Content-Type named, 5 min cache;
#   2. upload everything but index.html, then read each file back from the site with its headers
#      and bytes (web/scripts/check-site.mjs); any mismatch stops here, and visitors keep the
#      previous index.html, whose files are all still in the container;
#   3. upload index.html, read it back and load the page in headless Chrome; on failure the
#      previous index.html goes back up.
# #115 (2026-10-21) skipped 2 and 3: its gzipped files went up as application/octet-stream and the
# live page stayed on "Loading the match…". Used by `infra/deploy.sh web` and the deploy workflow.
# Uploads go through Entra ID roles (--auth-mode login), not account keys.
#
#   infra/upload_web.sh <storage account> <site url> [build dir, default web/dist] [staging dir]
#   TTE_UPLOAD_NO_BROWSER=1 skips the Chrome load (tests)
set -euo pipefail

account=${1:?usage: infra/upload_web.sh <storage account> <site url> [build dir] [staging dir]}
site=${2:?usage: infra/upload_web.sh <storage account> <site url> [build dir] [staging dir]}
site=${site%/}
root=$(cd "$(dirname "$0")/.." && pwd)
dist=${3:-$root/web/dist}
staged=${4:-$root/web/dist-upload}
check=(node "$root/web/scripts/check-site.mjs" --site "$site" --staged "$staged" --dist "$dist")

upload() { # <dir> <encoding or -> <cache> <type or ->
  local extra=()
  if [[ $2 != - ]]; then extra+=(--content-encoding "$2"); fi
  if [[ $4 != - ]]; then extra+=(--content-type "$4"); fi
  az storage blob upload-batch --account-name "$account" --auth-mode login -d '$web' \
    -s "$1" --overwrite --content-cache-control "$3" ${extra[@]+"${extra[@]}"} -o none < /dev/null
}

node "$root/web/scripts/stage.mjs" "$dist" "$staged"
previous="$staged/previous"
mkdir -p "$previous"
curl -fsS "$site/index.html" -o "$previous/index.html" || rm -f "$previous/index.html"

while IFS=$'\t' read -r dir encoding cache type; do
  if [[ $dir != index ]]; then upload "$staged/$dir" "$encoding" "$cache" "$type"; fi
done < "$staged/batches.tsv"
if ! "${check[@]}" --files; then
  echo "upload_web: files read back wrong; index.html not replaced, the site is unchanged" >&2
  exit 1
fi

IFS=$'\t' read -r _ encoding cache type < <(awk -F'\t' '$1 == "index"' "$staged/batches.tsv")
upload "$staged/index" "$encoding" "$cache" "$type"
browser=(--browser)
if [[ ${TTE_UPLOAD_NO_BROWSER:-} == 1 ]]; then browser=(); fi
if ! "${check[@]}" --index ${browser[@]+"${browser[@]}"}; then
  if [[ -f $previous/index.html ]]; then
    upload "$previous" - "$cache" "$type"
    echo "upload_web: the new index.html failed its check; the previous one is back" >&2
  else
    echo "upload_web: the new index.html failed its check and there was no previous one" >&2
  fi
  exit 1
fi
echo "upload_web: $site is live and checked"
