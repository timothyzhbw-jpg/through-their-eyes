// A teaching file for tests (coach.ts): the scan hero's committed bundle with the teaching fields
// a `pro_scan` bundle carries, so it parses against the scan hero's export (the coach's own hero
// export is served by the API, not bundled). coach.test.ts checks the real teaching file as JSON.

import { optionChanges, type OptionRow } from "./steps";

interface Look {
  direction?: string;
  picture: { options: OptionRow[] } | null;
}

/** `stepsJson` (steps_seed3.json) with its look labelled "L", a drop-back after the look's freeze
 * and before his reception, and a half-turn at it. `happened` sets both beats; their rules say
 * the same. */
export function teachingFile(stepsJson: unknown, happened = true) {
  const json = JSON.parse(JSON.stringify(stepsJson));
  json.teaching = true;
  for (const name of ["factual", "counterfactual"] as const) {
    const run = json.runs[name];
    const looks = run.steps as Look[];
    for (const s of looks) s.direction = "L";
    const reception: number = run.reception;
    const drop = reception - 2; // after the look's freeze frame, before the ball arrives
    const last = looks.filter((s) => s.picture).at(-1)?.picture?.options ?? run.start.options;
    const now = run.start.options as OptionRow[];
    const [opened, closed] = optionChanges(last, now);
    run.beats = [
      {
        id: "drop_back",
        frame: drop,
        start: drop,
        end: reception,
        happened,
        lines: [],
        vel: run.final.vel,
        picture: { frame: drop, before: last, options: last, opened: [], closed: [] },
        rule: {
          frame: drop,
          nearest: "A5",
          nearest_m: happened ? 5.4 : 8.2,
          near: happened ? ["A5"] : [],
          radius_m: 7,
          moved_m: happened ? 2.9 : 0,
          after_m: happened ? 8.1 : null,
        },
      },
      {
        id: "half_turn",
        frame: reception,
        start: reception,
        end: reception,
        happened,
        lines: [],
        vel: run.final.vel,
        picture: { frame: reception, before: last, options: now, opened, closed },
        rule: {
          frame: reception - 10,
          nearest: "A5",
          nearest_m: happened ? 4.2 : 9.5,
          near: happened ? ["A5"] : [],
          radius_m: 6,
          side: happened ? 1 : 0,
        },
      },
    ];
  }
  return json;
}
