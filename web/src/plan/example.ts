// A hand-written plan for the hero moment of blind_side_run, seed 3. Anchor: H8's decision at
// 3.00 s; key scan 2.00-2.56 s (-1.00 to -0.44 s); the pass arrives at 5.60 s (+2.60 s).
// It stands in for the Telestrator agent's output. At the decision the plan holds on the
// tactical board, where the pass options layer turns on by itself (SPEC 7). Data from another seed
// moves those times, so this plan may then fail validation and the player falls back to the
// template plan, which is the intended design.
//
// Voice steps name lines L1-L7 of the moment's render payload (SPEC 5.3); for now that is the
// fixture written by sim.export.render_payload_fixture (public/data/fixture_payload_seed3.json).

export const EXAMPLE_PLAN = {
  moment: "m:decision_after_scan:H8:0075",
  duration_s: 19.5,
  steps: [
    { t: 0.0, do: "camera", mode: "tactical" },
    { t: 0.0, do: "freeze" },
    { t: 0.4, do: "voice", line: "L1" },
    { t: 1.2, do: "rewind", to: -1.8 },
    { t: 1.4, do: "zone", layer: "vision", player: "H8" },
    { t: 1.8, do: "camera", mode: "pov" },
    { t: 2.0, do: "pov", player: "H8", from: -1.8, to: 0.0, speed: 0.5 },
    { t: 2.4, do: "scan_marker", scan: "scan:H8:0050" },
    { t: 3.0, do: "voice", line: "L2" },
    { t: 4.4, do: "ghost", kind: "belief" },
    { t: 5.0, do: "voice", line: "L3" },
    { t: 6.0, do: "camera", mode: "tactical" },
    { t: 7.4, do: "voice", line: "L6" },
    { t: 10.0, do: "camera", mode: "split" },
    { t: 10.0, do: "play", to: 2.6, speed: 1 },
    { t: 10.2, do: "voice", line: "L4" },
    { t: 13.0, do: "ghost", kind: "counterfactual", cf: "cf1" },
    { t: 13.2, do: "voice", line: "L5" },
    { t: 15.6, do: "voice", line: "L7" },
  ],
};

/** The same plan broken three ways, to show the fallback (`?plan=invalid`). */
export const INVALID_PLAN = {
  ...EXAMPLE_PLAN,
  steps: [
    ...EXAMPLE_PLAN.steps.map((s) => (s.do === "pov" ? { ...s, to: 2.4 } : s)), // 4.2 s of POV
    { t: 16.0, do: "scan_marker", scan: "scan:H8:9999" }, // no such scan
    { t: 16.5, do: "voice", line: "L9" }, // not in the narration
  ],
};
