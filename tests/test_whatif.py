"""'What if…?' questions answered by re-simulation (SPEC 3.7 force_action, SPEC 6)."""

import asyncio
import json

import pytest

from agents.context import MomentContext
from agents.testing import FakeChatClient
from agents.whatif import answer_question, map_question
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
        ("What if he had passed to the striker instead of carrying it?", "pass:H9"),
        ("What if he had carried it instead of passing to the striker?", "carry"),
        ("What if instead of carrying it he had found the striker?", "pass:H9"),
        # nothing he could do: no shot from there, no attacking midfielder in his team
        ("What if he shot past the keeper?", None),
        ("What if he had passed to the attacking midfielder?", None),
    ],
)
def test_role_words_map_to_a_receiver_with_that_role(ctx, question, action):
    assert asyncio.run(map_question(ctx, question, client=None)) == (action, "template")


def test_the_model_is_told_each_receivers_role_and_where_he_stood(ctx):
    fake = FakeChatClient({"whatif": {"action": "pass:H4"}})
    asyncio.run(map_question(ctx, "What if he had played it back to the centre-back?", client=fake))
    prompt = fake.prompts["whatif"][0]
    lines = {line.split(":", 2)[1]: line for line in prompt.splitlines()
             if line.startswith("- pass:")}  # fmt: skip
    assert set(lines) == set(ROLES)  # every pass option, once
    for pid, role in ROLES.items():
        assert f"the {role}" in lines[pid]
    assert "behind the ball" in lines["H4"] and "on the right" in lines["H4"]
    assert "behind the ball" in lines["H5"] and "on the left" in lines["H5"]
    assert "ahead of the ball" in lines["H9"]
    # full-backs by the names viewers use; Foundry read a bare "left-back" as the left centre-back
    assert "left-back" in lines["H3"] and "right-back" in lines["H2"]
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
    assert "H4" in text


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
