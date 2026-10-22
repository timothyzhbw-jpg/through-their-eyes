"""What each audience must and must not hear (SPEC 6, "Persona rules").

Narration agents pick claim ids. Per persona, these rules say which ids are off limits (left out of
the schema's enum, dropped by tidy, rejected by the Verifier), which groups of claims the script
must cite, how many numbers it may say, and, for audio description, that it starts with where it
happened. A group is required only when the moment has a supported claim in it, and a group bound
to a lens only on that lens. The Verifier sends a script that breaks a rule back for a rewrite (at
most twice); after that, `repair` makes it comply with verified template lines, so every script
that airs follows its persona's rules, from the model or the template.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from agents.schemas import Language, ScriptLine, Speaker
from explain.claims import PLACEHOLDER, Claim

# The look's value: expected threat, or the scoring chance it bought. Model outputs a casual fan
# cannot picture.
XT = frozenset({"cf_value", "cf_shot_value"})
PROBABILITIES = frozenset({"pass_success", "cf_pass_success", "shot_thought_vs_was"})
# Claims whose numbers are model outputs, xT, probabilities or shares, that a listener cannot
# picture. They never air for audio description.
ANALYST_NUMBERS = frozenset(
    {
        "cf_value",
        "pass_success",
        "cf_pass_success",
        "observed_share",
        "pressure_at_pass",
        "receiver_pressure",
        "runner_pressure",
        "shot_thought_vs_was",
        "cf_shot_value",
    }
)


@dataclass(frozen=True)
class Group:
    """Claims of which a script must cite at least one."""

    name: str  # what the group is, for the model and in problems
    ids: tuple[str, ...]  # best first: `repair` adds the first supported one
    speaker: Speaker  # who says it when `repair` adds it
    lens: str | None = None  # required only on this lens

    def options(self, supported: Mapping[str, Claim], lens: str | None) -> list[str]:
        if self.lens is not None and lens != self.lens:
            return []
        return [c for c in self.ids if c in supported]


COUNTERFACTUAL = Group(
    "the counterfactual: what happens without the look (or the escape)",
    ("cf_pass", "cf_carry_lost", "cf_lost_runner", "cf_unmarked", "cf_shot"), "color",
)  # fmt: skip
VALUE = Group("what the look was worth in expected threat", ("cf_value", "cf_shot_value"), "color")
BELIEF = Group(
    "his belief error: what he thought against what was true",
    ("belief_error", "cf_belief_error", "shot_thought_vs_was"), "color",
)  # fmt: skip
SCAN_TIMING = Group(
    "when and how often he scanned",
    ("scans_before_reception", "time_since_last_scan", "marker_scan", "scan_at_goal",
     "marker_unseen"), "pbp", lens="scan",
)  # fmt: skip
OWN_SCAN = Group(
    "his own look",
    ("scan_before_reception", "scan_at_goal", "marker_scan", "scans_before_reception", "scan_side",
     "time_since_last_scan"), "pbp", lens="scan",
)  # fmt: skip
DECISION = Group(
    "his decision", ("pass_to_runner", "runner_received", "shot_placement", "stayed_with_runner"),
    "pbp",
)  # fmt: skip
COACHING = Group(
    "a coaching point: what a player can copy",
    ("time_since_last_scan", "scans_before_reception", "marker_scan", "scan_at_goal",
     "presser_distance", "pressure_at_pass", "keeper_near_side"), "pbp",
)  # fmt: skip
# Where it happened, for listeners: the first claim line of audio description.
SPATIAL = ("reception_zone", "scan_side", "blind_side")


@dataclass(frozen=True)
class Rule:
    required: tuple[Group, ...] = ()
    forbidden: frozenset[str] = frozenset()
    max_numbers: int | None = None  # numeric slots across the whole script
    spatial_first: bool = False


RULES: dict[str, Rule] = {
    "casual": Rule(required=(COUNTERFACTUAL,), forbidden=XT | PROBABILITIES, max_numbers=2),
    "analyst": Rule(required=(VALUE, BELIEF, SCAN_TIMING)),
    "player_fan": Rule(required=(OWN_SCAN, DECISION)),
    "coach": Rule(required=(COUNTERFACTUAL, COACHING)),
    "audio_description": Rule(
        forbidden=ANALYST_NUMBERS | XT | PROBABILITIES, max_numbers=2, spatial_first=True
    ),
}


def fingerprint() -> str:
    """The rules as stable text (sets sorted): part of the prompt version, so of the cache key."""
    return "; ".join(
        f"{persona}: {[(g.ids, g.speaker, g.lens) for g in rule.required]} "
        f"{sorted(rule.forbidden)} {rule.max_numbers} {rule.spatial_first}"
        for persona, rule in sorted(RULES.items())
    )


def forbidden(persona: str | None) -> frozenset[str]:
    rule = RULES.get(persona or "")
    return rule.forbidden if rule else frozenset()


def withheld(persona: str | None, claims: Sequence[str]) -> list[str]:
    """The claims of a line that `persona` must not hear. A recap claim `k2.cf_value` is
    withheld like `cf_value` (agents/recap_context.py)."""
    off = forbidden(persona)
    return [c for c in claims if c.rpartition(".")[2] in off] if off else []


def numbers(claim: Claim, language: Language) -> int:
    """How many numbers the claim's sentence says: its numeric slots."""
    count = 0
    for m in PLACEHOLDER.finditer(claim.template_for(language)):
        slot = claim.slots.get(m["name"])
        if slot is not None and slot.value is not None and not isinstance(slot.value, bool | str):
            count += 1
    return count


def _count(lines: Sequence[ScriptLine], claims: Mapping[str, Claim], language: Language) -> int:
    return sum(numbers(claims[c], language) for line in lines for c in line.claims if c in claims)


def _spatial(supported: Mapping[str, Claim]) -> list[str]:
    return [c for c in SPATIAL if c in supported]


def _starts_spatially(lines: Sequence[ScriptLine]) -> bool:
    first = next((line for line in lines if line.claims), None)
    return first is not None and bool(set(first.claims) & set(SPATIAL))


def missing(
    persona: str, lines: Sequence[ScriptLine], supported: Mapping[str, Claim], lens: str | None
) -> list[tuple[Group, list[str]]]:
    """The required groups the script does not cite yet, with their supported ids."""
    rule = RULES.get(persona)
    if rule is None:
        return []
    cited = {c for line in lines for c in line.claims}
    out = []
    for group in rule.required:
        options = group.options(supported, lens)
        if options and not cited & set(options):
            out.append((group, options))
    return out


def problems(
    persona: str,
    lines: Sequence[ScriptLine],
    supported: Mapping[str, Claim],
    lens: str | None,
    language: Language,
) -> list[str]:
    """Why the script breaks its persona's rules; empty when it follows them."""
    rule = RULES.get(persona)
    if rule is None:
        return []
    out = []
    cited = {c for line in lines for c in line.claims}
    if bad := sorted(cited & rule.forbidden):
        out.append(f"not for {persona}: {', '.join(bad)}")
    for group, options in missing(persona, lines, supported, lens):
        out.append(f"missing {group.name}: cite one of {', '.join(options)}")
    if rule.max_numbers is not None:
        n = _count(lines, supported, language)
        if n > rule.max_numbers:
            out.append(f"{n} numbers, at most {rule.max_numbers} for {persona}")
    if rule.spatial_first and (spatial := _spatial(supported)) and not _starts_spatially(lines):
        out.append(f"start with where it happened: cite one of {', '.join(spatial)} first")
    return out


def _rank(claims: Sequence[str]) -> int:
    """Story order: the look, then belief and the decision, then the counterfactual, then its
    value. Connectives come first."""
    ids = set(claims)
    if not ids:
        return -1
    if ids & set(VALUE.ids):
        return 3
    if ids & set(COUNTERFACTUAL.ids):
        return 2
    if ids & set(DECISION.ids + BELIEF.ids):
        return 1
    return 0


def _new_id(lines: Sequence[ScriptLine]) -> str:
    taken = {line.id for line in lines}
    n = len(lines) + 1
    while f"L{n}" in taken:
        n += 1
    return f"L{n}"


def repair(
    persona: str,
    lines: Sequence[ScriptLine],
    supported: Mapping[str, Claim],
    lens: str | None,
    language: Language,
) -> tuple[list[ScriptLine], list[tuple[ScriptLine, str]], list[str]]:
    """Make the script follow its persona's rules with verified template lines.

    Drops lines with a forbidden claim; adds the first supported claim of each missing group, in
    story order; for audio description, brings a spatial line to the front; then drops lines with
    numbers, last first, while over the budget (never one that covers a required group). Returns
    the lines, the dropped lines with their reason, and notes.
    """
    rule = RULES.get(persona)
    if rule is None:
        return list(lines), [], []
    out: list[ScriptLine] = []
    dropped: list[tuple[ScriptLine, str]] = []
    notes: list[str] = []
    for line in lines:
        if bad := [c for c in line.claims if c in rule.forbidden]:
            dropped.append((line, f"{', '.join(bad)}: not for {persona}"))
        else:
            out.append(line)
    for group, options in missing(persona, out, supported, lens):
        cid = options[0]
        line = ScriptLine(id=_new_id(out + [d for d, _ in dropped]), speaker=group.speaker,
                          text=supported[cid].template_for(language), claims=[cid])  # fmt: skip
        rank = _rank(line.claims)
        at = next((i for i, other in enumerate(out) if _rank(other.claims) > rank), len(out))
        out.insert(at, line)
        notes.append(f"{line.id} added: {cid} ({group.name.split(':')[0]})")
    if rule.spatial_first and (spatial := _spatial(supported)) and not _starts_spatially(out):
        first = next((i for i, line in enumerate(out) if line.claims), len(out))
        later = next((i for i, line in enumerate(out) if set(line.claims) & set(SPATIAL)), None)
        if later is not None:
            out.insert(first, out.pop(later))
            notes.append(f"{out[first].id} moved first: where it happened")
        else:
            cid = spatial[0]
            line = ScriptLine(id=_new_id(out + [d for d, _ in dropped]), speaker="pbp",
                              text=supported[cid].template_for(language), claims=[cid])  # fmt: skip
            out.insert(first, line)
            notes.append(f"{line.id} added first: {cid} (where it happened)")
    if rule.max_numbers is not None:
        while _count(out, supported, language) > rule.max_numbers:
            spare = [
                i for i, line in enumerate(out)
                if _count([line], supported, language)
                and not missing(persona, out[:i] + out[i + 1 :], supported, lens)
                and not (rule.spatial_first and i == 0 and set(line.claims) & set(SPATIAL))
            ]  # fmt: skip
            if not spare:
                notes.append(f"over {rule.max_numbers} numbers: every numeric line is required")
                break
            line = out.pop(spare[-1])
            dropped.append((line, f"too many numbers for {persona}"))
    return out, dropped, notes
