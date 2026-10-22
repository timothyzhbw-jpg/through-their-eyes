// What the crew-vs-single eval found (eval/reports/crew_vs_single.md, SPEC 6), as the Crew trace
// cites it next to a breakdown's run: the same breakdowns from one agent doing all four jobs in one
// call and from the crew, on gpt-4.1-mini. The cost and the absence of a quality win are cited as
// plainly as the resilience. tests/test_crew_trace.py checks every figure here against the report.

export const CREW_VS_SINGLE = {
  report:
    "https://github.com/timothyzhbw-jpg/through-their-eyes/blob/main/eval/reports/crew_vs_single.md",
  setup:
    "gpt-4.1-mini on Microsoft Foundry · 6 hero moments × casual, analyst × en, zh · 3 drills per agent taken down",
  findings: [
    {
      id: "down",
      text: "With one agent down, the crew still aired a verified breakdown with 3 of 4 roles from the model (3 of 3 drills). One agent doing all four jobs in one call fell back entirely, 0 of 4.",
    },
    {
      id: "back",
      text: "Bringing the Telestrator back took 1 model request, about 2.1k tokens, against the single agent's whole call again, about 11.7k. Bringing the Analyst back re-runs every step that read its findings: 11 requests.",
    },
    {
      id: "steps",
      text: "Short steps: 0 of 66 crew agent runs exceeded the deployed 8 s step timeout; all 6 single-agent calls did.",
    },
    {
      id: "same",
      text: "Not a quality win: 0 wrong facts aired and groundedness 5.00 in both, which the verified lines and the Verifier ensure. The crew costs more: 12.0 vs 1.8 model requests, $0.0090 vs $0.0046 per breakdown.",
    },
  ],
} as const;
