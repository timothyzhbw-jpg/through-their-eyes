"""The evidence the crew works from: one hero moment, its runs, cards and verified claims.

Built once per breakdown and shared by every agent and by the MCP tools. Claims are verified here,
before any model sees them, so agents can only pick among facts that already hold.

The counterfactual is the scenario's own intervention (`sim.counterfactual.hero_counterfactual`):
the run without the key scan for a scan hero, the run with the hero forced to keep the ball for a
pressure hero. Either way web/ and plans call it `cf1`.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from explain.audit import AuditSink, MemoryAuditSink
from explain.builders import hero_claims
from explain.cards import MomentCard
from explain.claims import Claim
from explain.functions import EvalContext
from explain.lenses import explain_moments
from explain.moments import hero_card
from explain.verifier import Verdict, Verifier
from sim.counterfactual import CounterfactualResult, WhatIfResult, hero_counterfactual
from sim.model import Event
from sim.roster import short_name
from sim.run import MatchRun

COUNTERFACTUAL_ID = "cf1"  # the id web/ and plans use for the hero's counterfactual run


@dataclass
class MomentContext:
    scenario: str
    seed: int
    run: MatchRun
    cf: CounterfactualResult | WhatIfResult
    cards: dict[str, MomentCard]
    card: MomentCard  # the hero's moment: his decision, or a marker's look (`marker_scan`)
    claims: dict[str, Claim]
    verdicts: dict[str, Verdict]
    evaluator: EvalContext
    audit: AuditSink = field(default_factory=MemoryAuditSink)

    @classmethod
    def load(cls, scenario: str, seed: int, audit: AuditSink | None = None) -> MomentContext:
        cf = hero_counterfactual(scenario, seed)
        run = cf.factual
        cards = {c.id: c for c in explain_moments(run)}
        card = hero_card(run, cards)
        if card is None:
            raise ValueError(f"no hero moment detected in {scenario} seed {seed}")
        evaluator = EvalContext(run, counterfactuals={cf.scan_id: cf}, cards=cards)
        sink = audit or MemoryAuditSink()
        verifier = Verifier(evaluator, sink=sink)
        claims = {c.id: c for c in hero_claims(evaluator, cf).values()}
        verdicts = {cid: verifier.verify(c) for cid, c in claims.items()}
        return cls(scenario, seed, run, cf, cards, card, claims, verdicts, evaluator, sink)

    # --- ids and clocks a plan may refer to -------------------------------------------------------

    @property
    def hero(self) -> str:
        return self.card.actor

    @property
    def players(self) -> list[str]:
        return self.run.ids

    @property
    def names(self) -> dict[str, str]:
        """Players as they appear on screen and in the voice: their fictional short names
        (sim/roster.py). A name, or an id, outside a slot is a render violation."""
        return {pid: short_name(pid) for pid in self.players}

    @property
    def scans(self) -> list[str]:
        return [e.id for e in self.run.events if e.type == "scan"]

    @property
    def key_scan(self) -> Event | None:
        """The scan the counterfactual drops; None when the intervention is not a dropped scan."""
        if not isinstance(self.cf, CounterfactualResult):
            return None
        return self.run.event(self.cf.scan_id)

    @property
    def intervention(self) -> str:
        """What the counterfactual run changed: "drop_scan" or "force:<action>"."""
        return "drop_scan" if self.key_scan is not None else f"force:{self.cf.action}"

    @property
    def counterfactual_id(self) -> str:
        return COUNTERFACTUAL_ID

    @property
    def frames(self) -> int:
        return len(self.run.owner)

    def rel(self, frame: int) -> float:
        """Seconds of match time relative to the card's anchor frame (the decision, or where the
        pass to a marker's man resolved)."""
        return (frame - self.card.anchor_frame) * self.run.dt

    @property
    def supported(self) -> dict[str, Claim]:
        return {
            cid: c for cid, c in self.claims.items() if self.verdicts[cid].status == "supported"
        }
