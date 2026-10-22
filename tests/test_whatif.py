"""'What if…?' questions answered by re-simulation (SPEC 3.7 force_action, SPEC 6)."""

import asyncio
import dataclasses
import json
from types import SimpleNamespace

import pytest

from agents.context import MomentContext
from agents.testing import FakeChatClient
from agents.whatif import (
    ROLE_NAMES,
    Receiver,
    _defaults,
    _labelled,
    _option_lines,
    _rule_map,
    answer_question,
    map_question,
    receivers,
)
from explain.render import check_payload
from sim.counterfactual import force_action_counterfactual, what_if_id
from sim.engine import Simulation
from sim.overrides import ForceAction

SCENARIO, SEED = "blind_side_run", 3


@pytest.fixture(scope="module")
def ctx():
    return MomentContext.load(SCENARIO, seed=SEED)


@pytest.fixture(scope="module")
def to_h4():
    return force_action_counterfactual(SCENARIO, SEED, "pass:H4")


# --- sim: force_action (SPEC 3.7 acceptance) -----------------------------------------------------


def test_forcing_the_action_actually_chosen_reproduces_the_factual_run():
    factual = Simulation.from_scenario(SCENARIO, SEED).run()
    d = factual.hero_decision()
    sim = Simulation.from_scenario(SCENARIO, SEED)
    sim.run_until(d.frame)
    forced = Simulation.resume(sim.snapshot(), [ForceAction(d.player, d.frame, d.chosen)]).run()
    assert forced.to_bytes() == factual.to_bytes()


def test_an_action_that_was_not_an_option_is_refused():
    with pytest.raises(ValueError, match="not an option"):
        force_action_counterfactual(SCENARIO, SEED, "pass:A5")


def test_forcing_another_option_re_simulates_that_choice(to_h4):
    assert to_h4.id == what_if_id("H8", to_h4.factual_decision.frame, "pass:H4")
    assert to_h4.factual_action == "pass:H9"
    assert to_h4.counterfactual_action == "pass:H4"
    passes = [e for e in to_h4.counterfactual.events if e.type == "pass" and e.player == "H8"]
    assert passes and passes[0].attrs["to"] == "H4" and passes[0].attrs["outcome"] is not None
    assert to_h4.delta_xt > 0  # the through ball he played was worth more


def test_what_if_is_deterministic(to_h4):
    again = force_action_counterfactual(SCENARIO, SEED, "pass:H4")
    assert again.counterfactual.to_bytes() == to_h4.counterfactual.to_bytes()


# --- mapping a question to one of his options --------------------------------------------------


@pytest.mark.parametrize(
    ("question", "action"),
    [
        ("What if he passed to H4?", "pass:H4"),
        ("what if he'd played it back to h4", "pass:H4"),
        ("如果他传给H4呢？", "pass:H4"),
        # By the fictional names the screen shows (sim/roster.py): short, full or surname alone.
        ("What if he passed to K. Annersley?", "pass:H4"),
        ("what if he'd played it to annersley", "pass:H4"),
        ("What if he had found Kofi Annersley?", "pass:H4"),
        ("如果他传给K. Annersley呢？", "pass:H4"),
        ("What if he had carried the ball forward?", "carry"),
        ("What if he scored a header?", None),
        ("What if he passed to A5?", None),
    ],
)
def test_questions_map_to_his_options_or_to_nothing(ctx, question, action):
    assert asyncio.run(map_question(ctx, question, client=None))[0] == action


# blind_side_run seed 3: H8 (CM) on the ball near the centre spot, attacking +x; his teammates.
ROLES = {"H1": "goalkeeper", "H2": "full-back", "H3": "full-back", "H4": "centre-back",
         "H5": "centre-back", "H6": "defensive midfielder", "H10": "central midfielder",
         "H7": "winger", "H11": "winger", "H9": "striker"}  # fmt: skip


@pytest.mark.parametrize(
    ("question", "action"),
    [
        # two centre-backs: the nearer one (H4, who played him the ball) unless a side is named
        ("What if he had played it back to the centre-back?", "pass:H4"),
        ("What if he had played it back to the center back?", "pass:H4"),
        ("What if he passed to the CB?", "pass:H4"),
        ("What if he had found the left centre-back?", "pass:H5"),
        ("What if he gave it to the keeper?", "pass:H1"),
        ("What if he passed back to the goalkeeper?", "pass:H1"),
        ("What if he found the left-back?", "pass:H3"),
        ("What if he found the right back?", "pass:H2"),
        ("What if he had passed to the full-back?", "pass:H2"),
        ("What if he played it to the defensive midfielder?", "pass:H6"),
        ("What if he had played in the striker?", "pass:H9"),
        ("What if he switched it to the left winger?", "pass:H11"),
        ("What if he passed to the winger?", "pass:H7"),
        ("What if he passed to the other central midfielder?", "pass:H10"),
        ("如果他回传给中后卫呢？", "pass:H4"),
        ("如果他传给门将呢？", "pass:H1"),
        ("如果他传给左边锋呢？", "pass:H11"),
        # the first thing the question names decides; "instead of" rules out what follows it
        ("What if he carried it past the centre-back?", "carry"),
        ("What if he took on the centre-back?", "carry"),  # an opponent, taken on with the ball
        ("What if he had passed to the striker instead of carrying it?", "pass:H9"),
        ("What if he had carried it instead of passing to the striker?", "carry"),
        ("What if instead of carrying it he had found the striker?", "pass:H9"),
        # nothing he could do: no shot from there, no attacking midfielder in his team
        ("What if he shot past the keeper?", None),
        ("What if he had passed to the attacking midfielder?", None),
        # plurals
        ("What if he had played it to one of the centre-backs?", "pass:H4"),
        ("What if he played it back to the center backs?", "pass:H4"),
        ("What if he had found one of his full-backs?", "pass:H2"),
        ("What if he passed to one of the wingers?", "pass:H7"),
        ("What if he looked for the strikers?", "pass:H9"),
        ("What if he passed back to the keepers?", "pass:H1"),
        # a side after the role word, or as "left-sided"
        ("What if he found the centre-back on the left?", "pass:H5"),
        ("What if he found the winger out on the right?", "pass:H7"),
        ("What if he had played it to the left-sided centre-back?", "pass:H5"),
        ("如果他传给左边的中后卫呢？", "pass:H5"),
        # depth: "back" means a receiver behind the ball, "forward" one ahead of it
        ("What if he passed back to a midfielder?", "pass:H6"),
        ("What if he passed forward to a midfielder?", "pass:H10"),
        ("如果他回传给中场呢？", "pass:H6"),
    ],
)
def test_role_words_map_to_a_receiver_with_that_role(ctx, question, action):
    assert asyncio.run(map_question(ctx, question, client=None)) == (action, "template")


@pytest.mark.parametrize(
    ("question", "action"),
    [
        # keywords are whole words: a dribbler is a person, not a carry
        ("What if the dribbler had passed to the striker?", "pass:H9"),
        # what the question rules out does not count
        ("What if he had not carried it but passed to the striker?", "pass:H9"),
        ("What if he didn't dribble and found the left-back?", "pass:H3"),
        ("What if, without dribbling, he found the striker?", "pass:H9"),
        ("What if he hadn't shot but passed to H4?", "pass:H4"),
        ("What if he had passed instead of shooting?", None),
        ("如果他不带球而是传给前锋呢？", "pass:H9"),
        # a "not" far before the cue is about something else
        ("What if he had not been closed down and carried it?", "carry"),
        # "instead of" / "rather than" rules out only the next cue in its own clause
        ("Rather than the obvious, what if he passed to the striker?", "pass:H9"),
        ("Instead of the through ball, what if he went to the keeper?", "pass:H1"),
    ],
)
def test_what_a_question_rules_out_does_not_count(ctx, question, action):
    assert asyncio.run(map_question(ctx, question, client=None)) == (action, "template")


def test_a_null_from_the_model_is_a_refusal_not_a_cue_for_the_rules(ctx):
    """A null stands even where the rules would find an option (here a pass to H4)."""
    fake = FakeChatClient({"whatif": {"action": None}})
    question = "What if he had played it back to the centre-back?"
    assert asyncio.run(map_question(ctx, question, client=fake)) == (None, "llm")
    a = asyncio.run(answer_question(ctx, question, language="en", client=fake))
    assert a.action is None and a.refusal and a.payload is None


def test_a_moment_without_his_decision_is_refused_without_a_model_call(ctx):
    run = dataclasses.replace(ctx.run, decisions=[])
    no_decision = dataclasses.replace(ctx, run=run)
    fake = FakeChatClient({"whatif": {"action": "pass:H4"}})
    question = "What if he had played it back to the centre-back?"
    assert asyncio.run(map_question(no_decision, question, client=fake)) == (None, "template")
    a = asyncio.run(answer_question(no_decision, question, language="en", client=fake))
    assert a.action is None and a.refusal and a.factual_action is None
    assert fake.calls["whatif"] == 0


# --- one side and depth rule for the prompt labels and the rule parser ---------------------------


def _passes_from(run, frame: int) -> SimpleNamespace:
    """The ball carrier at `frame` with a pass option to every teammate, like a decision."""
    carrier = run.ids[run.owner[frame]]
    mates = [p.id for p in run.players if p.team == run.players[run.owner[frame]].team]
    opts = [SimpleNamespace(action=f"pass:{m}", target_player=m) for m in mates if m != carrier]
    return SimpleNamespace(frame=frame, player=carrier, options=opts)


def _configurations() -> list[tuple[str, list[Receiver]]]:
    out = []
    for seed in range(100, 105):  # the hero's decision on held-out seeds
        run = Simulation.from_scenario(SCENARIO, seed).run()
        out.append((f"{SCENARIO}/{seed}", receivers(run, run.hero_decision())))
    for seed in range(100, 110):  # whoever has the ball in open play, both teams
        run = Simulation.from_scenario("possession_play", seed).run()
        for f in range(0, len(run.owner), 25):
            if run.owner[f] >= 0:
                d = _passes_from(run, f)
                out.append((f"possession_play/{seed}@{f}:{d.player}", receivers(run, d)))

    # where an absolute flank would mislead: both centre-backs in the middle, both full-backs
    # in one half, a midfield trio
    synthetic = [
        Receiver(f"pass:X{n}", f"X{n}", role, distance=10.0 + n, ahead=ahead, left=left)
        for n, (role, ahead, left) in enumerate([
            ("CB", -15.0, -1.0), ("CB", -14.0, 2.0), ("FB", -5.0, -25.0), ("FB", 2.0, -8.0),
            ("CM", 4.0, 3.0), ("CM", 1.0, -3.0), ("CM", 6.0, 0.5),
        ])
    ]  # fmt: skip
    out.append(("synthetic", _labelled(synthetic)))
    return out


CONFIGS = _configurations()


def _lines(recv: list[Receiver]) -> dict[str, str]:
    actions = [r.action for r in recv]
    return {line.split(": ", 1)[0][2:]: line for line in _option_lines(recv, actions)}


def _role_phrase(role: str, side: str) -> list[str]:
    name = ROLE_NAMES[role]
    if role == "FB":
        return [f"the {side}-back", f"the full-back on the {side}"]
    return [f"the {side} {name}", f"the {name} on the {side}"]


@pytest.mark.parametrize(("where", "recv"), CONFIGS, ids=[c[0] for c in CONFIGS])
def test_a_side_named_with_a_role_picks_the_receiver_the_prompt_labels_with_it(where, recv):
    lines, actions = _lines(recv), [r.action for r in recv]
    for role in {r.role for r in recv}:
        fits = [r for r in recv if r.role == role]
        for side in ("left", "right"):
            phrases = _role_phrase(role, side)
            label = phrases[0].removeprefix("the ")
            labelled = [r.action for r in fits if label in lines[r.action]]
            if len(fits) > 1:
                assert len(labelled) == 1, (where, role, side, [lines[r.action] for r in fits])
            for phrase in phrases:
                got = _rule_map(f"What if he had passed to {phrase}?", actions, recv)
                assert got == (labelled[0] if len(fits) > 1 else fits[0].action), (where, phrase)


@pytest.mark.parametrize(("where", "recv"), CONFIGS, ids=[c[0] for c in CONFIGS])
def test_a_role_word_with_no_side_means_whom_the_prompt_says(where, recv):
    defaults, actions = _defaults(recv) or "", [r.action for r in recv]

    def rule(question: str) -> str:
        return _rule_map(question, actions, recv).removeprefix("pass:")

    for role in {r.role for r in recv}:
        name = ROLE_NAMES[role]
        base = rule(f"What if he had passed to the {name}?")
        assert f"pass:{base}" == next(r.action for r in recv if r.role == role)  # the nearest
        alts = [f"{rule(f'What if he had played it {w} to the {name}?')} if sent {w}"
                for w in ("back", "forward")
                if rule(f"What if he had played it {w} to the {name}?") != base]  # fmt: skip
        said = f'"the {name}" means {base}' + (f" ({', '.join(alts)})" if alts else "")
        shared = sum(r.role == role for r in recv) > 1
        assert (f"{said};" in defaults or f"{said}." in defaults) == shared, (where, said, defaults)


@pytest.mark.parametrize(("where", "recv"), CONFIGS, ids=[c[0] for c in CONFIGS])
def test_back_and_forward_pick_the_first_receiver_the_prompt_puts_there(where, recv):
    lines, actions = _lines(recv), [r.action for r in recv]
    for role in {r.role for r in recv}:
        fits = [r.action for r in recv if r.role == role]  # nearest first, as in the prompt
        for word, label in (("back", "behind the ball"), ("forward", "ahead of the ball")):
            there = [a for a in fits if label in lines[a]]
            name = ROLE_NAMES[role]
            got = _rule_map(f"What if he had played it {word} to the {name}?", actions, recv)
            assert got == (there or fits)[0], (where, word, name)


def test_left_and_right_are_as_his_team_attacks():
    """The away team attacks -x, so its left-back (A3) stands at negative y."""
    run = Simulation.from_scenario("possession_play", 100).run()
    away = [f for f in range(len(run.owner)) if run.owner[f] >= 0
            and run.players[run.owner[f]].team == 1]  # fmt: skip
    f = next(f for f in away if run.ids[run.owner[f]] not in ("A2", "A3"))
    recv = receivers(run, _passes_from(run, f))
    assert run.pos[f, run.index("A3"), 1] < 0 < run.pos[f, run.index("A2"), 1]
    actions = [r.action for r in recv]
    assert _rule_map("What if he found the left-back?", actions, recv) == "pass:A3"
    assert "the left-back" in _lines(recv)["pass:A3"]


def test_the_model_is_told_each_receivers_role_and_where_he_stood(ctx):
    fake = FakeChatClient({"whatif": {"action": "pass:H4"}})
    asyncio.run(map_question(ctx, "What if he had played it back to the centre-back?", client=fake))
    prompt = fake.prompts["whatif"][0]
    lines = {line.split(":", 2)[1]: line for line in prompt.splitlines()
             if line.startswith("- pass:")}  # fmt: skip
    assert set(lines) == set(ROLES)  # every pass option, once
    for pid, role in ROLES.items():
        assert role in lines[pid]
    # a role two receivers share is labelled with each one's side, as the rule parser reads it
    assert "the right centre-back" in lines["H4"] and "behind the ball" in lines["H4"]
    assert "the left centre-back" in lines["H5"] and "behind the ball" in lines["H5"]
    assert "the right winger" in lines["H7"] and "the left winger" in lines["H11"]
    assert "the striker" in lines["H9"] and "ahead of the ball" in lines["H9"]
    # full-backs by the names viewers use; Foundry read a bare "left-back" as the left centre-back
    assert "the left-back" in lines["H3"] and "the right-back" in lines["H2"]
    # a role word with no side, said outright: Foundry did not reliably take "the nearest"
    assert ('Unless a side is named: "the full-back" means H2; "the centre-back" means H4; '
            '"the winger" means H7.') in prompt  # fmt: skip
    assert "- carry:" in prompt and "central midfielder" in prompt  # he is H8, the CM
    # nearest receiver first, so "the centre-back" means H4 to the model as to the rule parser
    order = [line.split(":", 2)[1] for line in prompt.splitlines() if line.startswith("- pass:")]
    assert order.index("H4") < order.index("H5")
    assert order.index("H7") < order.index("H11")


# --- the answer: verified counterfactual lines ---------------------------------------------------


@pytest.mark.parametrize("language", ["en", "zh"])
def test_a_what_if_answer_is_verified_counterfactual_narration(ctx, language):
    question = "What if he passed to H4?" if language == "en" else "如果他传给H4呢？"
    a = asyncio.run(answer_question(ctx, question, language=language))
    assert a.action == "pass:H4" and a.refusal is None
    assert a.counterfactual == what_if_id("H8", ctx.card.anchor_frame, "pass:H4")
    assert a.payload is not None and a.payload.lines
    assert check_payload(a.payload) == []
    assert {c.kind for c in a.payload.claims} == {"counterfactual"}
    assert all(c.verdict == "supported" for c in a.payload.claims)
    text = " ".join(line.text for line in a.payload.lines)
    assert "K. Annersley" in text and "H4" not in text  # by his fictional name (sim/roster.py)


def test_an_impossible_question_gets_a_refusal_not_narration(ctx):
    a = asyncio.run(answer_question(ctx, "What if he scored a header?", language="en"))
    assert a.action is None and a.payload is None and a.refusal


def test_the_model_can_only_choose_among_his_options(ctx):
    fake = FakeChatClient({"whatif": {"action": "pass:A5"}})
    action, source = asyncio.run(map_question(ctx, "What if he passed to H4?", client=fake))
    assert action == "pass:H4" and source == "template"  # invalid model answer: rule fallback
    fake = FakeChatClient({"whatif": {"action": "pass:H4"}})
    action, source = asyncio.run(map_question(ctx, "And the centre-back behind him?", client=fake))
    assert action == "pass:H4" and source == "llm"


def test_a_wrong_number_in_a_what_if_claim_is_refuted(ctx):
    a = asyncio.run(answer_question(ctx, "What if he passed to H4?", language="en"))
    from explain.verifier import Verifier

    value = next(c for c in a.claims if "dxt" in c.slots)
    bad = value.model_copy(deep=True)
    bad.slots["dxt"].value = round(bad.slots["dxt"].value + 0.05, 2)
    assert Verifier(ctx.evaluator).verify(bad).status == "refuted"


# --- MCP tools -----------------------------------------------------------------------------------


def test_mcp_server_offers_options_and_what_if(ctx):
    from mcp.shared.memory import create_connected_server_and_client_session

    from agents.mcp_server import build_server

    async def go():
        async with create_connected_server_and_client_session(build_server(ctx)._mcp_server) as s:
            tools = {t.name for t in (await s.list_tools()).tools}
            options = await s.call_tool("list_options", {})
            answer = await s.call_tool("what_if", {"action": "pass:H4"})
            refused = await s.call_tool("what_if", {"action": "pass:A5"})
            return tools, options, answer, refused

    tools, options, answer, refused = asyncio.run(go())
    assert {"list_options", "what_if"} <= tools
    assert "pass:H4" in [o["action"] for o in json.loads(options.content[0].text)]
    data = json.loads(answer.content[0].text)
    assert data["counterfactual_action"] == "pass:H4" and data["delta_xt"] > 0
    assert json.loads(refused.content[0].text)["error"]


def test_run_counterfactual_answers_an_unknown_scan_id_with_the_valid_ones(ctx):
    """Seen live on Foundry: the Analyst passed an id that is not a scan, and the tool raised."""
    from agents import tools

    for bad in ("cf1", "H8", "scan:H8"):
        data = json.loads(tools.run_counterfactual(ctx, bad))
        assert data["error"] and data["key_scan"] == ctx.cf.scan_id
        assert ctx.cf.scan_id in data["hero_scans"]
    good = json.loads(tools.run_counterfactual(ctx, ctx.cf.scan_id))
    assert good["dropped_scan"] == ctx.cf.scan_id
