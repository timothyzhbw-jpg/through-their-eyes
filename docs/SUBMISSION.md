# Through Their Eyes: submission page (draft)

## How this differs from FIFA AI Pro

FIFA AI Pro, the assistant Lenovo built with FIFA for the 2026 World Cup teams, answers what
happened from statistics (Lenovo reports more than 2,000 metrics), before and after a match but
not during live play, behind a "validated" label.[^fifa-ai-pro] Through Their Eyes answers what
the player saw and what he believed while the synthetic match streams live: every number in the
captions and narration is a verified claim that viewers can open and challenge with **Try a wrong
number**, and every "What if…?" is re-simulated in the simulator, not estimated.[^how-we-differ]
Lenovo's figures for its Referee View camera show that fans want first person, but it shows what
a camera captured; we show what the player perceived.

[^fifa-ai-pro]: [docs/REFERENCES.md](REFERENCES.md#related-products-judges-may-know-fifa-ai-pro-and-referee-view-world-cup-2026):
    the FIFA and Lenovo press releases; every FIFA and Lenovo figure is company-reported.
[^how-we-differ]: [api/live.py](../api/live.py): the 25 Hz stream and the moments it announces;
    [web/src/tamper/tamper.ts](../web/src/tamper/tamper.ts) and [api/tamper.py](../api/tamper.py):
    **Try a wrong number** (`POST /api/verify`); `force_action_counterfactual` in
    [sim/counterfactual.py](../sim/counterfactual.py), run for each what-if through
    [agents/whatif.py](../agents/whatif.py).
