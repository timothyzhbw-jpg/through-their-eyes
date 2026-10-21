// Spawn ffmpeg and read the two measurements the report needs. Stderr is kept, not streamed,
// and a failure shows its last 40 lines. loudnorm's first pass and ebur128 print to stderr;
// the parsers below pull the JSON and the summary back out.

import { spawn } from "node:child_process";

/**
 * @param {string} ffmpeg
 * @param {string[]} args
 * @param {{ allowFail?: boolean }} [opts]
 * @returns {Promise<{ code: number, stderr: string }>}
 */
export function runFfmpeg(ffmpeg, args, { allowFail = false } = {}) {
  return runProcess(ffmpeg, args, { allowFail });
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, allowFail?: boolean }} [opts]
 * @returns {Promise<{ code: number, stderr: string }>}
 */
export function runProcess(cmd, args, { cwd, allowFail = false, inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    if (inherit) {
      const child = spawn(cmd, args, { cwd, stdio: "inherit" });
      child.on("error", (error) => reject(new Error(`cannot run ${cmd}: ${error.message}`)));
      child.on("close", (code) => {
        if (code === 0 || allowFail) resolve({ code: code ?? 1, stderr: "" });
        else reject(new Error(`${cmd} exited with ${code}`));
      });
      return;
    }
    const proc = spawn(cmd, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (chunk) => {
      err += chunk;
      if (err.length > 200000) err = err.slice(-100000);
    });
    proc.on("error", (error) => reject(new Error(`cannot run ${cmd}: ${error.message}`)));
    proc.on("close", (code) => {
      if (code === 0 || allowFail) resolve({ code: code ?? 1, stderr: err });
      else reject(new Error(`${cmd} exited with ${code}\n${lastLines(err, 40)}`));
    });
  });
}

/** Duration line from `ffmpeg -i`, in seconds. */
export function parseDuration(stderr) {
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** The JSON object loudnorm prints on its first pass. */
export function parseLoudnorm(stderr) {
  const match = stderr.match(/\{[^{}]*"input_i"[\s\S]*?\}/);
  if (!match) throw new Error("loudnorm did not print its JSON measurement");
  const json = JSON.parse(match[0]);
  for (const key of ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"]) {
    if (json[key] == null) throw new Error(`loudnorm JSON is missing ${key}`);
  }
  return json;
}

/** Integrated loudness and true peak from an ebur128 summary. */
export function parseEbur128(stderr) {
  const integrated = stderr.match(/Integrated loudness:[\s\S]*?\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/);
  const peak = stderr.match(/True peak:[\s\S]*?\bPeak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/);
  if (!integrated || !peak) throw new Error("ebur128 did not report loudness");
  return { integrated: Number(integrated[1]), truePeak: Number(peak[1]) };
}

/** @param {string} text @param {number} n */
function lastLines(text, n) {
  const lines = text.trim().split(/\r?\n/);
  return lines.slice(-n).join("\n");
}
