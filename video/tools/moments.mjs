#!/usr/bin/env node
// The stitched match's hero moments as the live service has them now, and the corner shot's
// `at=` frame (SPEC 10). A sim fix can move the corner in match time; this keeps shot
// 16-corner opening a fixed lead before the marker's look (never before the corner is taken),
// instead of a hand-typed frame, and checks every other match-1 `at=` is inside the match.
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
// Never before the corner is taken: the lead would otherwise open in the previous possession.
const exp = await fetch(`${API}/api/matches/match-1/export`, { signal: AbortSignal.timeout(60000) });
if (!exp.ok) throw new Error(`export: ${exp.status} from ${API}`);
const { match } = await exp.json();
const restart = match.possessions[corner.possession];
const at = Math.max(Math.round((corner.anchor_t - LEAD_S) * FPS), restart.start + 2);
console.log(
  `\n16-corner: at=${at} (the marker's look at ${corner.anchor_t.toFixed(2)} s minus ${LEAD_S} s, ` +
    `not before possession ${corner.possession}'s ${restart.restart} at frame ${restart.start})`,
);
const frames = match.possessions.reduce((n, p) => Math.max(n, p.start + p.frames), 0);
for (const [id, frame] of [...readFileSync(SHOTS, "utf8").matchAll(/"id": "([^"]+)"[^]*?"url": "[^"]*match=match-1[^"]*[?&]at=(\d+)/g)].map((m) => [m[1], Number(m[2])])) {
  if (frame >= frames) throw new Error(`${id}: at=${frame} is past match-1's end (${frames} frames)`);
}
console.log(`match-1: ${frames} frames; every match-1 at= is inside it`);

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
