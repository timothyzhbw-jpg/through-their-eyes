// The markdown report next to the finished film: the timeline, every spoken and shown line
// with the claim each number came from, the fallbacks, the warnings, and the measured
// loudness. Numbers in this file are the edit's own account of what aired.

/**
 * @param {{
 *   timeline: { beats: Array<{ id: string, start: number, dur: number, picture: string, out: string, tail: number }>, duration: number },
 *   spoken: Array<{ id: string, beat: string, at: number, text: string, dropped?: boolean, fallback?: boolean, narration?: boolean, used?: Array<{ slot: string, value: string, seen: string }>, missing?: string[] }>,
 *   shown: Array<{ id: string, where: string, text: string, dropped?: boolean, fallback?: boolean, used?: Array<{ slot: string, value: string, seen: string }>, missing?: string[] }>,
 *   warnings: string[],
 *   loudness?: { integrated: number, truePeak: number } | null,
 *   duration: number,
 * }} data
 */
export function renderReport(data) {
  const lines = ["# Trailer report", ""];
  lines.push(`Duration: ${data.duration.toFixed(3)} s`);
  if (data.loudness) {
    lines.push(`Integrated loudness: ${data.loudness.integrated.toFixed(1)} LUFS`);
    lines.push(`True peak: ${data.loudness.truePeak.toFixed(1)} dBFS`);
  } else lines.push("Integrated loudness: not measured");
  lines.push("", "## Timeline", "", "| id | start | length | picture | transition |", "|---|---|---|---|---|");
  for (const beat of data.timeline.beats) {
    const transition = beat.out === "cut" ? "cut" : `${beat.out} ${beat.tail.toFixed(3)}`;
    lines.push(
      `| ${beat.id} | ${beat.start.toFixed(3)} | ${beat.dur.toFixed(3)} | ${beat.picture} | ${transition} |`,
    );
  }
  lines.push("", "## Spoken", "");
  if (!data.spoken.length) lines.push("None.");
  for (const line of data.spoken) {
    const state = line.dropped ? "dropped" : line.fallback ? "fallback" : line.narration ? "narration line" : "filled";
    lines.push(`- **${line.id}** at ${line.at.toFixed(3)} on ${line.beat} (${state}): ${quote(line.text)}`);
    for (const used of line.used ?? []) {
      lines.push(`  - \`${used.slot}\` = ${quote(used.value)} from ${used.seen || "claims.json"}`);
    }
    for (const slot of line.missing ?? []) lines.push(`  - missing ${slot}`);
  }
  lines.push("", "## Shown", "");
  if (!data.shown.length) lines.push("None.");
  for (const title of data.shown) {
    const state = title.dropped ? "dropped" : title.fallback ? "fallback" : "filled";
    lines.push(`- **${title.id}** ${title.where} (${state}): ${quote(title.text)}`);
    for (const used of title.used ?? []) {
      lines.push(`  - \`${used.slot}\` = ${quote(used.value)} from ${used.seen || "claims.json"}`);
    }
    for (const slot of title.missing ?? []) lines.push(`  - missing ${slot}`);
  }
  const fallbacks = [
    ...data.spoken.filter((line) => line.fallback),
    ...data.shown.filter((title) => title.fallback),
  ];
  lines.push("", "## Fallbacks", "");
  if (!fallbacks.length) lines.push("None.");
  for (const item of fallbacks) lines.push(`- ${item.id}: ${quote(item.text)}`);
  lines.push("", "## Warnings", "");
  if (!data.warnings.length) lines.push("None.");
  for (const warning of data.warnings) lines.push(`- ${warning}`);
  lines.push("");
  return lines.join("\n");
}

/** @param {string | undefined} text */
function quote(text) {
  if (text == null || text === "") return "(empty)";
  return text.replace(/\s+/g, " ").trim();
}
