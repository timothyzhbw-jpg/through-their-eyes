#!/usr/bin/env bash
# Upload the web build to the Storage static website's $web container (SPEC 8), batch by batch
# as web/scripts/stage.mjs stages it: text gzipped (Storage never compresses on the fly), hashed
# assets cached for a year, index.html last with no-cache. Used by `infra/deploy.sh web` and the
# deploy workflow. Uploads go through Entra ID roles (--auth-mode login), not account keys.
#
#   infra/upload_web.sh <storage account> [build dir, default web/dist] [staging dir]
set -euo pipefail

account=${1:?usage: infra/upload_web.sh <storage account> [build dir] [staging dir]}
root=$(cd "$(dirname "$0")/.." && pwd)
dist=${2:-$root/web/dist}
staged=${3:-$root/web/dist-upload}

node "$root/web/scripts/stage.mjs" "$dist" "$staged"
while IFS=$'\t' read -r batch encoding cache; do
  encode=()
  if [[ $encoding != - ]]; then encode=(--content-encoding "$encoding"); fi
  az storage blob upload-batch --account-name "$account" --auth-mode login -d '$web' \
    -s "$staged/$batch" --overwrite --content-cache-control "$cache" \
    ${encode[@]+"${encode[@]}"} -o none < /dev/null
done < "$staged/batches.tsv"
