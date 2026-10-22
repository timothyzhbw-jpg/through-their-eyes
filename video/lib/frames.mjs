// Frame-stepped renderer (SPEC 10). The page seeks to each frame time, then that
// exact picture is piped into ffmpeg. Capture never follows the wall clock: draw(t)
// must already be showing time t when its promise resolves.
import { spawn } from "node:child_process";
import { once } from "node:events";

/** ffmpeg argv for one image2pipe encode. `alpha` selects ProRes 4444, otherwise H.264. */
export function ffmpegArgs({ fps, outFile, alpha = false, threads = 4 }) {
  const input = alpha
    ? ["-f", "image2pipe", "-c:v", "png"]
    : ["-f", "image2pipe", "-c:v", "mjpeg"];
  const output = alpha
    ? ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le"]
    : ["-c:v", "libx264", "-crf", "12", "-preset", "medium", "-pix_fmt", "yuv420p"];
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    ...input,
    "-framerate",
    String(fps),
    "-i",
    "-",
    "-an",
    ...output,
    "-threads",
    String(threads),
    "-y",
    outFile,
  ];
}

/**
 * Step `page` through `duration` seconds and pipe every frame to ffmpeg.
 * Frames are t = k / fps for k = 0 .. round(duration * fps) - 1.
 * Logs every 30 frames and the last frame. Returns `{ frames }`.
 * On an ffmpeg failure, rejects with the last 40 stderr lines.
 */
export async function recordFrames({
  page,
  fps,
  duration,
  draw,
  outFile,
  ffmpeg,
  alpha = false,
  quality = 92,
  log = () => {},
}) {
  const frames = Math.max(0, Math.round(Number(duration) * Number(fps)));
  const threads = Number.parseInt(process.env.TTE_FFMPEG_THREADS ?? "", 10) || 4;
  const proc = spawn(ffmpeg, ffmpegArgs({ fps, outFile, alpha, threads }), {
    stdio: ["pipe", "ignore", "pipe"],
  });
  const stderrLines = [];
  let stderrBuf = "";
  const pushStderr = (chunk) => {
    stderrBuf += chunk.toString();
    const parts = stderrBuf.split(/\r\n|\n|\r/);
    stderrBuf = parts.pop() ?? "";
    for (const line of parts) stderrLines.push(line);
  };
  proc.stderr.on("data", pushStderr);
  proc.stdin.on("error", () => {}); // a dead ffmpeg is reported from its exit, below

  let settled = false;
  const done = new Promise((resolve, reject) => {
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    proc.on("error", (err) => fail(new Error(`cannot run ffmpeg (${ffmpeg}): ${err.message}`)));
    proc.on("close", (code) => {
      if (stderrBuf) stderrLines.push(stderrBuf);
      if (code === 0) {
        if (!settled) {
          settled = true;
          resolve();
        }
        return;
      }
      const tail = stderrLines.slice(-40).join("\n");
      fail(new Error(tail ? `ffmpeg exited with ${code}: ${tail}` : `ffmpeg exited with ${code}`));
    });
  });
  // The loop may throw before `done` is awaited; swallow the late rejection here.
  done.catch(() => {});

  // A generous timeout and one retry: on a busy machine a frame can take a while to come back.
  const shot = alpha
    ? { type: "png", omitBackground: true, animations: "allow", timeout: 120000 }
    : { type: "jpeg", quality, animations: "allow", timeout: 120000 };
  const grab = async () => {
    try {
      return await page.screenshot(shot);
    } catch (err) {
      if (!/Timeout/.test(String(err))) throw err;
      return await page.screenshot(shot);
    }
  };

  try {
    for (let k = 0; k < frames; k++) {
      await draw(k / fps);
      const image = await grab();
      if (!proc.stdin.write(image)) await Promise.race([once(proc.stdin, "drain"), done]);
      if ((k + 1) % 30 === 0 || k + 1 === frames) log(`frame ${k + 1}/${frames}`);
    }
    proc.stdin.end();
    await done;
  } catch (err) {
    if (proc.exitCode === null && !proc.killed) proc.kill("SIGKILL");
    try {
      proc.stdin.destroy();
    } catch {
      // already closed
    }
    throw err;
  }
  return { frames };
}
