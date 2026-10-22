#!/usr/bin/env node
// The stitched match's hero moments as the live service has them now, and the corner shot's
// `at=` frame (SPEC 10). A sim fix can move the corner in match time; this keeps shot
// 16-corner opening a fixed lead before the marker's look, instead of a hand-typed frame.
//
//   node video/tools/moments.mjs            # print the hero moments and the corner's at=
//   node video/tools/moments.mjs --write    # also rewrite 16-corner's URL in shots.json
//
// TTE_API_URL overrides the service address.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, "..", "shots.json");
const API = process.env.TTE_API_URL ?? "https://tte-api.whiteground-bd319324.northcentralus.azurecontainerapps.io";
const FPS = 25; // the sim's frame rate, which `at=` counts in
const LEAD_S = 3.6; // the corner shot opens this long before the marker's look

const res = await fetch(`${API}/api/matches/match-1/moments`, { signal: AbortSignal.timeout(30000) });
if (!res.ok) throw new Error(`moments: ${res.status} from ${API}`);
const moments = await res.json();
const heroes = moments.filter((m) => m.hero);
for (const m of heroes) {
  console.log(`${m.anchor_t.toFixed(2).padStart(8)} s  ${m.kind.padEnd(24)} ${m.scenario.padEnd(18)} possession ${m.possession}  ${m.id}`);
}
const corner = heroes.find((m) => m.scenario === "corner_blind_side");
if (!corner) throw new Error("no corner_blind_side hero moment in match-1");
const at = Math.round((corner.anchor_t - LEAD_S) * FPS);
console.log(`\n16-corner: at=${at} (the marker's look at ${corner.anchor_t.toFixed(2)} s, minus ${LEAD_S} s)`);

if (process.argv.includes("--write")) {
  const text = readFileSync(SHOTS, "utf8");
  const start = text.indexOf('"id": "16-corner"');
  if (start < 0) throw new Error("16-corner is not in shots.json");
  const urlAt = text.indexOf('"url":', start);
  const end = text.indexOf("\n", urlAt);
  const line = text.slice(urlAt, end);
  const next = line.replace(/([?&]at=)\d+/, `$1${at}`);
  if (next === line && !/[?&]at=\d+/.test(line)) throw new Error("16-corner's URL has no at=");
  writeFileSync(SHOTS, text.slice(0, urlAt) + next + text.slice(end));
  console.log(next === line ? "shots.json already up to date" : `shots.json: ${next.trim()}`);
}
