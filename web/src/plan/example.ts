// A hand-written plan for the hero moment of blind_side_run, seed 3 (anchor: H8's reception at
// 2.80 s; key scan 2.00-2.56 s; decision 3.00 s). It stands in for the Telestrator agent's output
// until agents/ exists. Exported data from another seed moves those times, so this plan may then
// fail validation and the player falls back to the template plan, which is the intended design.
//
// The script lines are placeholders for the Narrator's verified Script: connective phrases only,
// no numbers, no lexicon terms (SPEC 5.3).

import type { Script } from "./schema";

export const EXAMPLE_SCRIPT: Script = {
  L1: "What did he see?",
  L2: "A look over his shoulder, just before the ball arrives.",
  L3: "Dashed rings: where he believes each player is.",
  L4: "He has seen the run in behind, so he plays it.",
  L5: "Without that look, he plays it safe.",
};

export const EXAMPLE_PLAN = {
  moment: "m1",
  duration_s: 12.5,
  steps: [
    { t: 0.0, do: "camera", mode: "tactical" },
    { t: 0.0, do: "freeze" },
    { t: 0.4, do: "voice", line: "L1" },
    { t: 1.2, do: "rewind", to: -1.6 },
    { t: 1.4, do: "zone", layer: "vision", player: "H8" },
    { t: 1.8, do: "camera", mode: "pov" },
    { t: 2.0, do: "pov", player: "H8", from: -1.6, to: 0.2, speed: 0.5 },
    { t: 2.4, do: "scan_marker", scan: "scan:H8:0050" },
    { t: 3.4, do: "voice", line: "L2" },
    { t: 4.4, do: "ghost", kind: "belief" },
    { t: 4.6, do: "voice", line: "L3" },
    { t: 5.8, do: "camera", mode: "split" },
    { t: 6.0, do: "play", to: 2.8, speed: 1 },
    { t: 6.2, do: "voice", line: "L4" },
    { t: 8.8, do: "ghost", kind: "counterfactual", cf: "cf1" },
    { t: 9.0, do: "voice", line: "L5" },
  ],
};

/** The same plan broken three ways, to show the fallback (`?plan=invalid`). */
export const INVALID_PLAN = {
  ...EXAMPLE_PLAN,
  steps: [
    ...EXAMPLE_PLAN.steps.map((s) => (s.do === "pov" ? { ...s, to: 2.4 } : s)),
    { t: 9.5, do: "scan_marker", scan: "scan:H8:9999" },
    { t: 10.0, do: "spin", degrees: 360 },
  ],
};
