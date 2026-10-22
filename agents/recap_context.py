"""The evidence the crew works from for an end-of-match recap (SPEC 6, recap).

The match's counterpart of `agents.context.MomentContext`: every claim the recap may air, already
verified before any model sees it, and the key-moment candidates the Director chooses from.

- Match claims (`final_score`, `passes_home`, ...) are checked on the stitched run, in match frames.
- Candidates are the match's moments in `explain.recap.rank_moments` order (goals, then hero
  moments, then the rest, each by counterfactual impact), at most `MAX_CANDIDATES`. Candidate
  `k<n>` (n = its rank among all ranked moments) owns the claims `k<n>.<id>`: a hero moment's
  MomentContext claims, re-verified under that id on the hero's own evaluator (the renamed claim
  has its own fingerprint and audit record), and the observed facts of
  `explain.recap.moment_claims` on the possession's run. A candidate with nothing verified to say
  is left out.
- After the Director picks the key moments, the crew works on `focused(moments)`: `claims` and
  `supported` then hold the match claims and the chosen moments' claims only, so a line that cites
  any other moment fails the Verifier.
- Claims on a possession's run use its local frames; `lift` moves a render payload's evidence and
  seek frames to the match clock by the possession's start (`offsets`).

It duck-types what the workflow reads from a MomentContext: `card.id`, `claims`, `verdicts`,
`supported`, `names` and `players`.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, field, replace
from typing import Any

from agents.context import MomentContext
from explain.audit import AuditSink, MemoryAuditSink
from explain.claims import Claim
from explain.functions import EVENT_ID, EvalContext
from explain.match import match_moments
from explain.recap import (
    impact,
    match_claims,
    moment_claims,
    namespaced,
    rank_moments,
    scored_moments,
    stitched_run,
)
from explain.render import RenderPayload
from explain.verifier import Verdict, Verifier
from sim.match import StitchedMatch, build_match, global_id

RECAP_VERSION = 1  # bump when the evidence changes shape: part of the recap's content hash
MAX_CANDIDATES = 8


@dataclass(frozen=True)
class RecapCard:
    """What the crew's spans and payloads name as their moment: the whole match."""

    id: str


@dataclass
class Candidate:
    """A moment the Director may pick, in match frames."""

    id: str  # the moment's id on the match clock
    rank: int  # in `rank_moments` order: goals, hero moments, then the rest, each by impact
    kind: str
    tags: list[str]
    actor: str
    receiver: str | None
    lens: str | None
    delta_xt: float | None  # the selected lens's delta (for the crew; never shown as a number)
    hero: bool
    possession: int
    start: int  # the possession's first match frame
    end: int  # the match frame after its last
    anchor_frame: int
    frame_start: int
    frame_end: int
    claims: list[str]  # its supported claims, namespaced, best told first

    @property
    def prefix(self) -> str:
        return f"k{self.rank}"

    def summary(self) -> dict[str, Any]:
        """What the Director and the MCP tools see of it."""
        return {
            "moment": self.id, "rank": self.rank, "kind": self.kind, "tags": self.tags,
            "actor": self.actor, "receiver": self.receiver, "lens": self.lens,
            "delta_xt": self.delta_xt, "hero": self.hero, "possession": self.possession,
            "claims": self.claims,
        }  # fmt: skip


@dataclass
class RecapContext:
    match_id: str
    seed: int
    dt: float
    frames: int
    score: tuple[int, int]  # (home, away), from the verified final_score claim's values
    possessions: list[dict[str, Any]]  # index, scenario, start, frames
    candidates: list[Candidate]  # in rank order
    all_claims: dict[str, Claim]
    verdicts: dict[str, Verdict]
    offsets: dict[str, int]  # claim id -> frames from its run's clock to the match clock
    stats: list[str]  # supported match claims, the score first
    players: list[str]
    audit: AuditSink = field(default_factory=MemoryAuditSink)
    focus: tuple[str, ...] | None = None  # the key moments picked; None: every candidate
    evidence_path: str | None = None  # `evidence()` as a file, for the MCP tool server

    @classmethod
    def build(
        cls,
        match_id: str,
        match: StitchedMatch,
        cards: Sequence[Mapping[str, Any]],
        heroes: Mapping[int, MomentContext],
        audit: AuditSink | None = None,
    ) -> RecapContext:
        """`cards`: the match's moments in match time (`explain.match.match_moments`); `heroes`:
        the hero moments' contexts by possession index."""
        sink = audit or MemoryAuditSink()
        claims: dict[str, Claim] = {}
        verdicts: dict[str, Verdict] = {}
        offsets: dict[str, int] = {}

        def add(claim: Claim, evaluator: EvalContext, offset: int) -> bool:
            verdicts[claim.id] = Verifier(evaluator, sink=sink).verify(claim)
            claims[claim.id], offsets[claim.id] = claim, offset
            return verdicts[claim.id].supported

        whole = EvalContext(stitched_run(match), resimulate=False)
        stats = [c.id for c in match_claims(whole) if add(c, whole, 0)]
        by_index = {p.index: p for p in match.possessions}
        scored = scored_moments(cards, whole.run)
        candidates: list[Candidate] = []
        for rank, card in enumerate(rank_moments(cards, scored), start=1):
            if len(candidates) == MAX_CANDIDATES:
                break
            p = by_index[card["possession"]]
            hero = heroes.get(p.index) if card.get("hero") else None
            evaluator = hero.evaluator if hero is not None else EvalContext(p.run, resimulate=False)
            told: dict[str, Claim] = {}
            if hero is not None:
                told |= {cid: c for cid, c in hero.claims.items() if hero.verdicts[cid].supported}
            for claim in moment_claims(evaluator, card, p.start):
                told.setdefault(claim.id, claim)
            prefix = f"k{rank}"
            own = [c.id for c in (namespaced(c, prefix) for c in told.values())
                   if add(c, evaluator, p.start)]  # fmt: skip
            if not own:  # nothing verified to say about it: not a candidate
                for cid in [cid for cid in claims if cid.startswith(f"{prefix}.")]:
                    del claims[cid], verdicts[cid], offsets[cid]
                continue
            selected = card.get("selected_lens")
            lens = next((x for x in card.get("lenses", ()) if x.get("lens") == selected), None)
            candidates.append(Candidate(
                id=card["id"], rank=rank, kind=card["kind"],
                tags=list(card.get("tags", ())) + (["goal"] if card["id"] in scored else []),
                actor=card["actor"], receiver=card.get("receiver"), lens=selected,
                delta_xt=lens.get("delta_xt") if lens else None, hero=hero is not None,
                possession=p.index, start=p.start, end=p.end, anchor_frame=card["anchor_frame"],
                frame_start=card["frame_start"], frame_end=card["frame_end"], claims=own,
            ))  # fmt: skip
        score = claims["final_score"].slots
        return cls(
            match_id=match_id,
            seed=match.seed,
            dt=match.dt,
            frames=match.frames,
            score=(int(score["home"].value), int(score["away"].value)),
            possessions=[
                {"index": p.index, "scenario": p.scenario, "start": p.start, "frames": p.frames}
                for p in match.possessions
            ],
            candidates=candidates,
            all_claims=claims,
            verdicts=verdicts,
            offsets=offsets,
            stats=stats,
            players=[p.id for p in match.players],
            audit=sink,
        )

    @classmethod
    def for_match(
        cls, seed: int, match_id: str | None = None, audit: AuditSink | None = None
    ) -> RecapContext:
        """Simulate and explain the stitched match `seed`, as the API loads it."""
        match = build_match(seed)
        sink = audit or MemoryAuditSink()
        heroes = {
            p.index: MomentContext.load(p.scenario, p.seed, audit=sink)
            for p in match.possessions if p.run.hero is not None
        }  # fmt: skip
        cards = match_moments(match, {k: list(c.cards.values()) for k, c in heroes.items()})
        return cls.build(match_id or f"match-{seed}", match, cards, heroes, sink)

    # --- what the crew reads ----------------------------------------------------------------------

    @property
    def card(self) -> RecapCard:
        return RecapCard(f"recap:{self.match_id}")

    @property
    def moments(self) -> list[Candidate]:
        """The key moments (every candidate before the Director picks), in match order."""
        chosen = [c for c in self.candidates if self.focus is None or c.id in self.focus]
        return sorted(chosen, key=lambda c: (c.anchor_frame, c.id))

    @property
    def claims(self) -> dict[str, Claim]:
        keep = set(self.stats) | {cid for m in self.moments for cid in m.claims}
        return {cid: c for cid, c in self.all_claims.items() if cid in keep}

    @property
    def supported(self) -> dict[str, Claim]:
        return {cid: c for cid, c in self.claims.items() if self.verdicts[cid].supported}

    @property
    def names(self) -> dict[str, str]:
        return {pid: pid for pid in self.players}

    @property
    def mcp_args(self) -> list[str]:
        """How the MCP tool server serves this recap (agents/mcp_server.py): from the evidence
        file when there is one, else by simulating the match again."""
        if self.evidence_path:
            return ["--recap", self.evidence_path]
        return ["--match", str(self.seed)]

    def focused(self, moments: Sequence[str]) -> RecapContext:
        known = {c.id for c in self.candidates}
        unknown = [m for m in moments if m not in known]
        if unknown:
            raise ValueError(f"not key-moment candidates: {', '.join(unknown)}")
        return replace(self, focus=tuple(moments))

    def candidate(self, moment: str) -> Candidate | None:
        return next((c for c in self.candidates if c.id == moment), None)

    def moment_of(self, claim_id: str) -> Candidate | None:
        """The candidate a claim tells, None for a match claim."""
        prefix, sep, _ = claim_id.partition(".")
        return next((c for c in self.candidates if sep and c.prefix == prefix), None)

    def lift(self, payload: RenderPayload) -> RenderPayload:
        """The payload with each claim's evidence and seek frame on the match clock."""

        def move(event_id: str, k: int) -> str:
            return global_id(event_id, k) if k and EVENT_ID.match(event_id) else event_id

        claims = []
        for c in payload.claims:
            k = self.offsets.get(c.id, 0)
            seek = None if c.seek_frame is None else c.seek_frame + k
            claims.append(c.model_copy(update={"evidence": [move(e, k) for e in c.evidence],
                                               "seek_frame": seek}))  # fmt: skip
        return payload.model_copy(update={"claims": claims})

    def content_hash(self) -> str:
        """Key for the recap cache: everything the recap is made from (SPEC 2)."""
        data = {
            "version": RECAP_VERSION,
            "match": self.match_id,
            "score": self.score,
            "possessions": self.possessions,
            "candidates": [asdict(c) for c in self.candidates],
            "claims": {cid: c.fingerprint() for cid, c in sorted(self.all_claims.items())},
            "verdicts": {cid: v.status for cid, v in sorted(self.verdicts.items())},
        }
        return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()

    def evidence(self, language: str = "en") -> dict[str, Any]:
        """The recap's verified evidence as plain JSON, for the MCP tools (agents/mcp_server.py)."""

        def claim(cid: str) -> dict[str, Any]:
            c = self.all_claims[cid]
            values = {k: s.value if s.value is not None else s.ref for k, s in c.slots.items()}
            return {"id": cid, "kind": c.kind, "verdict": self.verdicts[cid].status,
                    "template": c.template_for(language), "values": values,
                    "evidence": c.evidence}  # fmt: skip

        return {
            "match": self.match_id,
            "score": {"home": self.score[0], "away": self.score[1]},
            "duration_s": round(self.frames * self.dt, 2),
            "possessions": self.possessions,
            "stats": [claim(cid) for cid in self.stats],
            "moments": [
                {**m.summary(), "impact": round(impact_of(m), 4),
                 "claims": [claim(cid) for cid in m.claims]}
                for m in self.candidates
            ],
        }  # fmt: skip


def impact_of(candidate: Candidate) -> float:
    lenses = [{"lens": candidate.lens, "delta_xt": candidate.delta_xt}]
    return impact({"selected_lens": candidate.lens, "lenses": lenses})
