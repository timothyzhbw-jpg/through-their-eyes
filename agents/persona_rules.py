"""What each audience must and must not hear, and how its script opens (SPEC 6, "Persona rules" and
"Persona specs").

Narration agents pick claim ids. Per persona, these rules say:
- which ids it may cite at all: its palette (`palette`, e.g. the casual fan's story claims) minus
  what it must never hear (`forbidden`, e.g. xT for the casual fan). The rest is left out of the
  schema's enum, dropped by tidy and rejected by the Verifier;
- which groups of claims the script must cite (`required`). A group is required only when the
  moment has a supported claim in it, and a group bound to a lens only on that lens;
- how many numbers it may say and how many lines it may have;
- how it opens: with its own opener phrase (the casual fan's "Watch his head."), with a number
  (the analyst), or with where it happened (audio description); and for the coach, how it ends: the
  moment's teaching cue ("Teach it: check your shoulder before the ball arrives.").

The Verifier sends a script that breaks a rule back for a rewrite (at most twice); after that,
`repair` makes it comply with verified template lines, so every script that airs follows its
persona's rules, from the model or the template. Openers and cues are fixed phrases with no
number, no player and no lexicon term (explain/lexicon.py `CONNECTIVES`), so they need no claim.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Literal

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
COUNTERFACTUALS = frozenset(
    {"cf_pass", "cf_carry_lost", "cf_lost_runner", "cf_unmarked", "cf_shot", "cf_keeper_age",
     "cf_belief_error", "cf_value", "cf_pass_success", "cf_shot_value"}
)  # fmt: skip

# Every claim a hero moment can have (explain/builders.py). A palette is a subset; a claim added
# there must be placed in the palettes here (tests/test_persona_rules.py checks it is listed).
CLAIM_IDS = frozenset(
    {
        "belief_error", "blind_side", "cf_belief_error", "cf_carry_lost", "cf_keeper_age",
        "cf_lost_runner", "cf_pass", "cf_pass_success", "cf_shot", "cf_shot_value", "cf_unmarked",
        "cf_value", "gap_opened", "gap_to_marker", "gap_to_nearest_opponent", "heavy_pressure",
        "keeper_near_side", "keeper_seen_in_scan", "key_scan_duration", "marker_scan",
        "marker_unseen", "observed_share", "pass_speed", "pass_success", "pass_to_runner",
        "presser_distance", "pressure_at_pass", "receiver_pressure", "reception_zone",
        "runner_pressure", "runner_received", "scan_at_goal", "scan_before_reception",
        "scan_side", "scans_before_reception", "seen_in_scan", "shot_placement", "shot_saved",
        "shot_scored", "shot_speed", "shot_thought_vs_was", "shot_wide", "stayed_with_runner",
        "time_since_last_scan", "unmarked",
    }
)  # fmt: skip


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
    ("cf_pass", "cf_carry_lost", "cf_unmarked", "cf_lost_runner", "cf_shot"), "color",
)  # fmt: skip
VALUE = Group("what the look was worth in expected threat", ("cf_value", "cf_shot_value"), "color")
BELIEF = Group(
    "his belief error: what he thought against what was true",
    ("belief_error", "cf_belief_error", "shot_thought_vs_was"), "color",
)  # fmt: skip
SCAN_TIMING = Group(
    "when and how often he scanned",
    ("scans_before_reception", "time_since_last_scan", "marker_unseen", "marker_scan",
     "scan_at_goal"), "pbp", lens="scan",
)  # fmt: skip
CHANCES = Group(
    "the options' chances: what he gave his pass or shot against what it was",
    ("pass_success", "cf_pass_success", "shot_thought_vs_was", "cf_shot_value"), "color",
)  # fmt: skip
SPACE = Group(
    "the space and the press around him",
    ("observed_share", "gap_opened", "gap_to_marker", "pressure_at_pass", "receiver_pressure",
     "runner_pressure", "presser_distance", "keeper_near_side"), "color",
)  # fmt: skip
STORY = Group(
    "what he saw (or the press he felt)",
    ("seen_in_scan", "keeper_seen_in_scan", "heavy_pressure", "scan_before_reception",
     "marker_scan"), "pbp",
)  # fmt: skip
OWN_SCAN = Group(
    "his own look",
    ("scan_side", "scan_before_reception", "scan_at_goal", "marker_scan", "key_scan_duration"),
    "pbp", lens="scan",
)  # fmt: skip
DECISION = Group(
    "his decision",
    ("pass_to_runner", "shot_placement", "stayed_with_runner", "shot_scored", "runner_received"),
    "pbp",
)  # fmt: skip
COACHING = Group(
    "the coaching point: when he looked, against the ball (or how close the press was)",
    ("time_since_last_scan", "marker_scan", "scan_at_goal", "marker_unseen", "presser_distance",
     "heavy_pressure"), "pbp",
)  # fmt: skip
# Where it happened, for listeners: the first claim line of audio description.
SPATIAL = ("reception_zone", "scan_side", "blind_side")

# What each audience may cite at all. None: every claim.
CASUAL_PALETTE = frozenset(
    {"scan_before_reception", "seen_in_scan", "keeper_seen_in_scan", "blind_side", "unmarked",
     "runner_received", "pass_to_runner", "shot_placement", "shot_scored", "shot_saved",
     "shot_wide", "heavy_pressure", "stayed_with_runner", "cf_pass", "cf_carry_lost",
     "cf_unmarked", "cf_shot", "cf_lost_runner"}
)  # fmt: skip
COACH_PALETTE = frozenset(
    {"time_since_last_scan", "scan_side", "scan_before_reception", "scan_at_goal", "marker_scan",
     "marker_unseen", "blind_side", "seen_in_scan", "keeper_seen_in_scan", "keeper_near_side",
     "presser_distance", "heavy_pressure", "unmarked", "gap_to_marker", "stayed_with_runner",
     "pass_to_runner", "shot_placement", "cf_pass", "cf_carry_lost", "cf_lost_runner",
     "cf_unmarked", "cf_shot", "cf_keeper_age"}
)  # fmt: skip
PLAYER_FAN_PALETTE = frozenset(
    {"scan_side", "scan_before_reception", "scan_at_goal", "marker_scan", "key_scan_duration",
     "pass_to_runner", "pass_speed", "shot_placement", "shot_speed", "shot_scored", "shot_saved",
     "shot_wide", "heavy_pressure", "presser_distance", "stayed_with_runner", "reception_zone"}
)  # fmt: skip
DESCRIBED_PALETTE = frozenset(
    {"reception_zone", "blind_side", "scan_side", "scan_before_reception", "scan_at_goal",
     "marker_scan", "seen_in_scan", "keeper_seen_in_scan", "keeper_near_side", "pass_to_runner",
     "runner_received", "shot_placement", "shot_scored", "shot_saved", "shot_wide",
     "heavy_pressure", "presser_distance", "stayed_with_runner", "unmarked", "gap_to_marker",
     "cf_pass", "cf_carry_lost", "cf_lost_runner", "cf_unmarked", "cf_shot"}
)  # fmt: skip

Story = Literal["look", "shot", "marker", "pressure"]

# Openers: the phrase a persona's first line starts with, per language and kind of moment. Fixed
# words with no number or player, listed in explain/lexicon.py `CONNECTIVES`.
OPENERS: dict[str, dict[Language, dict[Story, str]]] = {
    "casual": {
        "en": {"look": "Watch his head.", "shot": "Watch his head.", "marker": "Watch his head.",
               "pressure": "Watch this."},
        "zh": {"look": "注意看他回头。", "shot": "注意看他这一抬头。",
               "marker": "注意看他回头。", "pressure": "注意看。"},
    },
    "coach": {
        "en": dict.fromkeys(("look", "shot", "marker", "pressure"), "Coaching point."),
        "zh": dict.fromkeys(("look", "shot", "marker", "pressure"), "教学要点。"),
    },
    "player_fan": {
        "en": dict.fromkeys(("look", "shot", "marker", "pressure"), "Lovely from him."),
        "zh": dict.fromkeys(("look", "shot", "marker", "pressure"), "这一下漂亮！"),
    },
}  # fmt: skip
# The coach's last line: what to teach from this kind of moment. Only when the claim that shows he
# did it is supported (`CUE_BACKED_BY`).
CUES: dict[Language, dict[Story, str]] = {
    "en": {
        "look": "Teach it: check your shoulder before the ball arrives.",
        "shot": "Teach it: look at the goal before the ball arrives.",
        "marker": "Teach it: find your man before the ball is played.",
        "pressure": "Teach it: move the ball before the press arrives.",
    },
    "zh": {
        "look": "要教的就是这一点：球到之前，先回头看。",
        "shot": "要教的就是这一点：球到之前，先抬头看球门。",
        "marker": "要教的就是这一点：球传出之前，先找到你盯的人。",
        "pressure": "要教的就是这一点：对手逼上来之前，先把球传出去。",
    },
}
CUE_BACKED_BY: dict[Story, str] = {
    "look": "scan_before_reception", "shot": "scan_at_goal", "marker": "marker_scan",
    "pressure": "heavy_pressure",
}  # fmt: skip
# Other connectives a persona's voices may use (besides its opener), per language.
EXTRA_CONNECTIVES: dict[str, dict[Language, tuple[str, ...]]] = {
    "casual": {"en": ("Look again.",), "zh": ("再看看。",)},
    "analyst": {"en": ("Now the numbers.", "Here's why."), "zh": ("看数据。", "关键在这里。")},
    "coach": {"en": ("Look again.",), "zh": ("再看看。",)},
    "player_fan": {"en": ("What a player.",), "zh": ("真是好球员。",)},
    "audio_description": {"en": (), "zh": ()},
}


@dataclass(frozen=True)
class Rule:
    required: tuple[Group, ...] = ()
    forbidden: frozenset[str] = frozenset()  # never, in a breakdown or a recap
    palette: frozenset[str] | None = None  # a breakdown cites only these; None: every claim
    max_numbers: int | None = None  # numeric slots across the whole script
    max_lines: int | None = None
    spatial_first: bool = False
    numeric_first: bool = False  # the first line cites a claim that says a number
    opener: bool = False  # the first line starts with the persona's opener (`OPENERS`)
    cue: bool = False  # the last line is the moment's teaching cue (`CUES`)


RULES: dict[str, Rule] = {
    "casual": Rule(required=(STORY, COUNTERFACTUAL), forbidden=XT | PROBABILITIES,
                   palette=CASUAL_PALETTE, max_numbers=1, max_lines=3, opener=True),
    "analyst": Rule(required=(VALUE, BELIEF, SCAN_TIMING, CHANCES, SPACE), max_lines=7,
                    numeric_first=True),
    "player_fan": Rule(required=(OWN_SCAN, DECISION), palette=PLAYER_FAN_PALETTE,
                       max_numbers=3, max_lines=4, opener=True),
    "coach": Rule(required=(COACHING, COUNTERFACTUAL), palette=COACH_PALETTE, max_numbers=3,
                  max_lines=5, opener=True, cue=True),
    "audio_description": Rule(
        forbidden=ANALYST_NUMBERS | XT | PROBABILITIES, palette=DESCRIBED_PALETTE, max_numbers=2,
        max_lines=6, spatial_first=True,
    ),
}  # fmt: skip


@dataclass(frozen=True)
class Spec:
    """What a persona's script looks like (SPEC 6, "Persona specs"): the eval's yardstick
    (eval/persona_distinctness.py), beyond the rules above."""

    lines: tuple[int, int]  # spoken lines, inclusive
    length: dict[str, int] = field(default_factory=dict)  # at most: words (en), characters (zh)
    min_numbers: int = 0
    max_jargon_lines: int | None = None


SPECS: dict[str, Spec] = {
    "casual": Spec((2, 3), {"en": 45, "zh": 80}, max_jargon_lines=0),
    "analyst": Spec((5, 7), {"en": 120, "zh": 190}, min_numbers=4),
    "player_fan": Spec((3, 4), {"en": 60, "zh": 100}, max_jargon_lines=0),
    "coach": Spec((3, 5), {"en": 85, "zh": 140}, max_jargon_lines=1),
    "audio_description": Spec((4, 6), {"en": 100, "zh": 160}, max_jargon_lines=0),
}


def fingerprint() -> str:
    """The rules as stable text (sets sorted): part of the prompt version, so of the cache key."""
    rules = "; ".join(
        f"{persona}: {[(g.ids, g.speaker, g.lens) for g in rule.required]} "
        f"{sorted(rule.forbidden)} {sorted(rule.palette) if rule.palette is not None else None} "
        f"{rule.max_numbers} {rule.max_lines} {rule.spatial_first} {rule.numeric_first} "
        f"{rule.opener} {rule.cue}"
        for persona, rule in sorted(RULES.items())
    )
    return f"{rules}; {OPENERS}; {CUES}; {CUE_BACKED_BY}; {EXTRA_CONNECTIVES}"


def forbidden(persona: str | None) -> frozenset[str]:
    """What the persona never hears, in a breakdown or a recap."""
    rule = RULES.get(persona or "")
    return rule.forbidden if rule else frozenset()


def excluded(persona: str | None) -> frozenset[str]:
    """What a persona's breakdown may not cite: the forbidden ids and every claim off its
    palette."""
    rule = RULES.get(persona or "")
    if rule is None:
        return frozenset()
    if rule.palette is None:
        return rule.forbidden
    return rule.forbidden | (CLAIM_IDS - rule.palette)


def withheld(persona: str | None, claims: Sequence[str]) -> list[str]:
    """The claims of a line that `persona` must never hear. A recap claim `k2.cf_value` is
    withheld like `cf_value` (agents/recap_context.py)."""
    off = forbidden(persona)
    return [c for c in claims if c.rpartition(".")[2] in off] if off else []


def off_palette(persona: str | None, claims: Sequence[str]) -> list[str]:
    """The claims of a breakdown line that `persona` may not cite."""
    off = excluded(persona)
    return [c for c in claims if c in off] if off else []


def numbers(claim: Claim, language: Language) -> int:
    """How many numbers the claim's sentence says: its numeric slots."""
    count = 0
    for m in PLACEHOLDER.finditer(claim.template_for(language)):
        slot = claim.slots.get(m["name"])
        if slot is not None and slot.value is not None and not isinstance(slot.value, bool | str):
            count += 1
    return count


def story(supported: Mapping[str, Claim], lens: str | None) -> Story:
    """Which kind of moment this is, for openers and cues: a marker's look, a look before a shot,
    a pass out of a press, or a look before a pass."""
    if "marker_scan" in supported or "stayed_with_runner" in supported:
        return "marker"
    if lens == "pressure":
        return "pressure"
    if "scan_at_goal" in supported or "shot_placement" in supported:
        return "shot"
    return "look"


def opener(persona: str, language: Language, supported: Mapping[str, Claim],
           lens: str | None) -> str | None:  # fmt: skip
    """The persona's opener for this moment, or None."""
    rule = RULES.get(persona)
    if rule is None or not rule.opener:
        return None
    return OPENERS[persona][language][story(supported, lens)]


def cue(persona: str, language: Language, supported: Mapping[str, Claim],
        lens: str | None) -> str | None:  # fmt: skip
    """The coach's teaching cue for this moment, or None when nothing backs it."""
    rule = RULES.get(persona)
    if rule is None or not rule.cue:
        return None
    kind = story(supported, lens)
    return CUES[language][kind] if CUE_BACKED_BY[kind] in supported else None


def connectives(persona: str | None, language: Language, supported: Mapping[str, Claim],
                lens: str | None) -> tuple[str, ...]:  # fmt: skip
    """The connectives a persona's voices may use on this moment: its opener, its extra ones and
    the coach's cue. None (no persona, e.g. an eval): the general ones."""
    from agents.schemas import CONNECTIVES

    if persona is None or persona not in RULES:
        return CONNECTIVES[language]
    out = [opener(persona, language, supported, lens), *EXTRA_CONNECTIVES[persona][language],
           cue(persona, language, supported, lens)]  # fmt: skip
    return tuple(dict.fromkeys(c for c in out if c))


def all_connectives(language: Language) -> tuple[str, ...]:
    """Every connective any persona may use, and the general ones: what tidy recognises."""
    from agents.schemas import CONNECTIVES

    out = list(CONNECTIVES[language])
    for by in OPENERS.values():
        out += by[language].values()
    out += CUES[language].values()
    for by in EXTRA_CONNECTIVES.values():
        out += by[language]
    return tuple(dict.fromkeys(out))


def _count(lines: Sequence[ScriptLine], claims: Mapping[str, Claim], language: Language) -> int:
    return sum(numbers(claims[c], language) for line in lines for c in line.claims if c in claims)


def _spatial(supported: Mapping[str, Claim]) -> list[str]:
    return [c for c in SPATIAL if c in supported]


def _starts_spatially(lines: Sequence[ScriptLine]) -> bool:
    first = next((line for line in lines if line.claims), None)
    return first is not None and bool(set(first.claims) & set(SPATIAL))


def _starts_with_number(lines: Sequence[ScriptLine], supported: Mapping[str, Claim],
                        language: Language) -> bool:  # fmt: skip
    return bool(lines) and bool(lines[0].claims) and _count(lines[:1], supported, language) > 0


def _opens(lines: Sequence[ScriptLine], phrase: str) -> bool:
    return bool(lines) and lines[0].text.startswith(phrase)


def _ends(lines: Sequence[ScriptLine], phrase: str) -> bool:
    return bool(lines) and not lines[-1].claims and lines[-1].text == phrase


def missing(
    persona: str, lines: Sequence[ScriptLine], supported: Mapping[str, Claim], lens: str | None
) -> list[tuple[Group, list[str]]]:
    """The required groups the script does not cite yet, with their supported ids (on the
    persona's palette)."""
    rule = RULES.get(persona)
    if rule is None:
        return []
    off = excluded(persona)
    cited = {c for line in lines for c in line.claims}
    out = []
    for group in rule.required:
        options = [c for c in group.options(supported, lens) if c not in off]
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
    if bad := sorted(cited & excluded(persona)):
        out.append(f"not for {persona}: {', '.join(bad)}")
    for group, options in missing(persona, lines, supported, lens):
        out.append(f"missing {group.name}: cite one of {', '.join(options)}")
    if rule.max_numbers is not None:
        n = _count(lines, supported, language)
        if n > rule.max_numbers:
            out.append(f"{n} numbers, at most {rule.max_numbers} for {persona}")
    if rule.max_lines is not None and len(lines) > rule.max_lines:
        out.append(f"{len(lines)} lines, at most {rule.max_lines} for {persona}")
    if rule.spatial_first and (spatial := _spatial(supported)) and not _starts_spatially(lines):
        out.append(f"start with where it happened: cite one of {', '.join(spatial)} first")
    if rule.numeric_first and not _starts_with_number(lines, supported, language):
        out.append("start with a number: the first line cites a claim that says one")
    if (phrase := opener(persona, language, supported, lens)) and not _opens(lines, phrase):
        out.append(f'start with the opener "{phrase}"')
    if (phrase := cue(persona, language, supported, lens)) and not _ends(lines, phrase):
        out.append(f'end with the cue "{phrase}"')
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


def _join(phrase: str, text: str, language: Language) -> str:
    return f"{phrase}{'' if language == 'zh' else ' '}{text}"


def _strip_opening(text: str, language: Language) -> str:
    """A claim line's text without a connective it opens with."""
    for c in sorted(all_connectives(language), key=len, reverse=True):
        if text.startswith(c) and len(text) > len(c):
            return text[len(c) :].lstrip()
    return text


def repair(
    persona: str,
    lines: Sequence[ScriptLine],
    supported: Mapping[str, Claim],
    lens: str | None,
    language: Language,
) -> tuple[list[ScriptLine], list[tuple[ScriptLine, str]], list[str]]:
    """Make the script follow its persona's rules with verified template lines.

    Drops lines with a claim off the persona's palette; adds the first supported claim of each
    missing group, in story order; for audio description, brings a spatial line to the front, and
    for the analyst a numeric one; drops lines with numbers, last first, while over the budget
    (never one that covers a required group); then fits the line budget (a lone connective first,
    then the last line that covers no group); and finally opens with the persona's opener and
    ends with the coach's cue. Returns the lines, the dropped lines with their reason, and notes.
    """
    rule = RULES.get(persona)
    if rule is None:
        return list(lines), [], []
    out: list[ScriptLine] = []
    dropped: list[tuple[ScriptLine, str]] = []
    notes: list[str] = []
    off = excluded(persona)
    phrase = opener(persona, language, supported, lens)
    ending = cue(persona, language, supported, lens)
    said = next((ln for ln in lines if ending and not ln.claims and ln.text == ending), None)
    for line in lines:
        if bad := [c for c in line.claims if c in off]:
            dropped.append((line, f"{', '.join(bad)}: not for {persona}"))
        elif ending and not line.claims and line.text == ending:
            continue  # put back at the end below
        else:
            out.append(line)

    def new(cid: str, speaker: Speaker) -> ScriptLine:
        return ScriptLine(id=_new_id(out + [d for d, _ in dropped]), speaker=speaker,
                          text=supported[cid].template_for(language), claims=[cid])  # fmt: skip

    for group, options in missing(persona, out, supported, lens):
        line = new(options[0], group.speaker)
        rank = _rank(line.claims)
        at = next((i for i, other in enumerate(out) if _rank(other.claims) > rank), len(out))
        out.insert(at, line)
        notes.append(f"{line.id} added: {options[0]} ({group.name.split(':')[0]})")
    if rule.spatial_first and (spatial := _spatial(supported)) and not _starts_spatially(out):
        first = next((i for i, line in enumerate(out) if line.claims), len(out))
        later = next((i for i, line in enumerate(out) if set(line.claims) & set(SPATIAL)), None)
        if later is not None:
            out.insert(first, out.pop(later))
            notes.append(f"{out[first].id} moved first: where it happened")
        else:
            line = new(spatial[0], "pbp")
            out.insert(first, line)
            notes.append(f"{line.id} added first: {spatial[0]} (where it happened)")

    def required_at(i: int) -> bool:
        return bool(missing(persona, out[:i] + out[i + 1 :], supported, lens)) or (
            rule.spatial_first and i == 0 and bool(set(out[0].claims) & set(SPATIAL))
        )

    if rule.max_numbers is not None:
        while _count(out, supported, language) > rule.max_numbers:
            spare = [i for i, line in enumerate(out)
                     if _count([line], supported, language) and not required_at(i)]  # fmt: skip
            if not spare:
                notes.append(f"over {rule.max_numbers} numbers: every numeric line is required")
                break
            dropped.append((out.pop(spare[-1]), f"too many numbers for {persona}"))
    if rule.numeric_first and not _starts_with_number(out, supported, language):
        while out and not out[0].claims:
            dropped.append((out.pop(0), f"{persona} opens with a number"))
        at = next((i for i, line in enumerate(out) if _count([line], supported, language)), None)
        if at is not None and at > 0:
            line = out.pop(at)
            out.insert(0, line.model_copy(update={"text": _strip_opening(line.text, language)}))
            notes.append(f"{line.id} moved first: a number")
    budget = None if rule.max_lines is None else rule.max_lines - (1 if ending else 0)
    while budget is not None and len(out) > budget:
        lone = [i for i, line in enumerate(out) if not line.claims]
        if lone:
            i = lone[-1]
        else:
            spare = [i for i in range(len(out)) if not required_at(i)]
            if not spare:
                notes.append(f"over {rule.max_lines} lines: every line is required")
                break
            i = spare[-1]
        dropped.append((out.pop(i), f"too many lines for {persona}"))
    if phrase and not _opens(out, phrase):
        while out and not out[0].claims:  # a lone connective gives way to the opener
            dropped.append((out.pop(0), f"{persona} opens with its opener"))
        if out:
            first = out[0]
            text = _join(phrase, _strip_opening(first.text, language), language)
            out[0] = first.model_copy(update={"text": text})
            notes.append(f"{first.id} opens with the opener")
    if ending and said is not None:
        out.append(said)
    elif ending:
        out.append(ScriptLine(id=_new_id(out + [d for d, _ in dropped]), speaker="color",
                              text=ending, claims=[]))  # fmt: skip
        notes.append(f"{out[-1].id} added last: the cue")
    return out, dropped, notes
