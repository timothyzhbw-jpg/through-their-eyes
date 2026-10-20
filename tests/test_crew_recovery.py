"""Acceptance checks for the crew's failure drill and checkpoint recovery (SPEC 6).

- An agent taken down fails like an outage: its model call raises, the step retries once and then
  runs on its template, and no model is called for it.
- Every run checkpoints at each superstep (Agent Framework workflow checkpoints, on disk here).
  A step that fell back after an error waits to be brought back; bringing it back resumes the
  workflow from the checkpoint and re-runs that step, plus only the steps that read its output.
- A breakdown interrupted mid-workflow resumes from the last completed step, in a new process.
"""

import asyncio

import pytest
from agent_framework import FileCheckpointStorage

from agents.context import MomentContext
from agents.testing import FakeChatClient
from agents.workflow import AGENTS, STEPS, NotWaiting, run_crew
from explain.render import check_payload
from tests.test_agents import _good_replies

ROLES = {"director": ["director"], "analyst": ["analyst"], "telestrator": ["telestrator"],
         "narration": ["pbp", "color"]}  # fmt: skip
ONE = {"personas": ("analyst",), "languages": ("en",)}


@pytest.fixture(scope="module")
def ctx():
    return MomentContext.load("blind_side_run", seed=3)


@pytest.fixture(scope="module")
def replies(ctx):
    return _good_replies(ctx)


def _run(coro):
    return asyncio.run(coro)


def _steps(result):
    return {s.step: s for s in result.trace}


def _storage(path):
    """A fresh storage object on the same directory: what a restarted process would open."""
    return FileCheckpointStorage(path)


@pytest.mark.parametrize("agent", AGENTS)
def test_an_agent_taken_down_fails_like_an_outage_and_runs_on_its_template(ctx, replies, agent):
    fake = FakeChatClient(replies)
    run = _run(run_crew(ctx, client=fake, down={agent}, **ONE))
    step = _steps(run.result)[agent]
    assert step.source == "template"
    assert step.attempts == 2 * len(ROLES[agent])  # each call, then its one retry
    assert step.error.startswith("AgentDown:")
    assert all(fake.calls[role] == 0 for role in ROLES[agent])  # no model call for that step
    others = [a for a in AGENTS if a != agent]
    assert all(_steps(run.result)[a].source == "llm" for a in others)
    assert [s.step for s in run.result.trace] == list(STEPS)
    (script,) = run.result.scripts
    assert script.payload.lines and check_payload(script.payload) == []
    assert run.pending == [agent]  # it waits to be brought back


def test_without_a_model_the_downed_agent_still_shows_the_outage(ctx):
    run = _run(run_crew(ctx, client=None, down={"telestrator"}, **ONE))
    steps = _steps(run.result)
    assert steps["telestrator"].error.startswith("AgentDown:")
    assert steps["director"].source == "template" and steps["director"].attempts == 0


def test_bringing_the_telestrator_back_reruns_only_that_step(ctx, replies, tmp_path):
    first = _run(run_crew(ctx, client=FakeChatClient(replies), down={"telestrator"},
                          checkpoints=_storage(tmp_path), **ONE))  # fmt: skip
    assert first.result.plan_source == "template" and first.pending == ["telestrator"]

    fake = FakeChatClient(replies)  # a new process: new client, new workflow, same checkpoints
    back = _run(run_crew(ctx, client=fake, checkpoints=_storage(tmp_path),
                         bring_back="telestrator", **ONE))  # fmt: skip
    assert dict(fake.calls) == {"telestrator": 1}  # nothing else ran on the model again
    assert back.result.plan_source == "agent" and back.pending == []
    before, after = _steps(first.result), _steps(back.result)
    assert after["telestrator"].source == "llm" and after["telestrator"].error is None
    assert any("checkpoint" in n for n in after["telestrator"].notes)
    for step in ("director", "analyst", "narration", "verifier"):
        assert after[step] == before[step]
    assert [s.step for s in back.result.trace] == list(STEPS)
    assert back.result.findings == first.result.findings
    (old,), (new,) = first.result.scripts, back.result.scripts
    assert new.payload == old.payload  # the same approved lines, voiced on the agent's plan
    assert len(new.voice) == len(new.payload.lines)


def test_bringing_the_analyst_back_reruns_the_steps_that_read_its_findings(ctx, replies, tmp_path):
    first = _run(run_crew(ctx, client=FakeChatClient(replies), down={"analyst"},
                          checkpoints=_storage(tmp_path), **ONE))  # fmt: skip
    assert first.result.findings.headline != replies["analyst"]["headline"]  # the template's
    fake = FakeChatClient(replies)
    back = _run(run_crew(ctx, client=fake, checkpoints=_storage(tmp_path),
                         bring_back="analyst", **ONE))  # fmt: skip
    assert dict(fake.calls) == {"analyst": 1, "telestrator": 1, "pbp": 1, "color": 1}
    assert back.result.findings.headline == replies["analyst"]["headline"]
    assert all(s.source in ("llm", "code") for s in back.result.trace)
    assert _steps(back.result)["director"] == _steps(first.result)["director"]


def test_an_agent_still_down_stays_down_when_another_comes_back(ctx, replies, tmp_path):
    down = {"analyst", "telestrator"}
    first = _run(run_crew(ctx, client=FakeChatClient(replies), down=down,
                          checkpoints=_storage(tmp_path), **ONE))  # fmt: skip
    assert first.pending == ["analyst", "telestrator"]
    fake = FakeChatClient(replies)
    analyst = _run(run_crew(ctx, client=fake, down={"telestrator"}, checkpoints=_storage(tmp_path),
                            bring_back="analyst", **ONE))  # fmt: skip
    assert fake.calls["telestrator"] == 0  # re-planned on the new findings, but still down
    assert analyst.result.plan_source == "template" and analyst.pending == ["telestrator"]
    tele = _run(run_crew(ctx, client=FakeChatClient(replies), checkpoints=_storage(tmp_path),
                         bring_back="telestrator", **ONE))  # fmt: skip
    assert tele.result.plan_source == "agent" and tele.pending == []
    assert tele.result.findings == analyst.result.findings


def test_only_a_step_that_waits_can_be_brought_back(ctx, replies, tmp_path):
    _run(run_crew(ctx, client=FakeChatClient(replies), down={"telestrator"},
                  checkpoints=_storage(tmp_path), **ONE))  # fmt: skip
    with pytest.raises(NotWaiting):
        _run(run_crew(ctx, client=FakeChatClient(replies), checkpoints=_storage(tmp_path),
                      bring_back="narration", **ONE))  # fmt: skip
    with pytest.raises(NotWaiting):
        _run(run_crew(ctx, client=FakeChatClient(replies), checkpoints=_storage(tmp_path / "none"),
                      bring_back="telestrator", **ONE))  # fmt: skip


def test_an_interrupted_breakdown_resumes_from_the_last_completed_step(ctx, replies, tmp_path):
    """The process dies while narration is running; a new one resumes after the Analyst."""
    slow = FakeChatClient({**replies, "pbp": FakeChatClient.SLOW})

    async def interrupted():
        task = asyncio.create_task(
            run_crew(ctx, client=slow, checkpoints=_storage(tmp_path), step_timeout_s=60, **ONE)
        )
        while slow.calls["pbp"] == 0:  # the Director and the Analyst are done
            await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    _run(interrupted())
    assert slow.calls["director"] == slow.calls["analyst"] == 1

    fake = FakeChatClient(replies)
    run = _run(run_crew(ctx, client=fake, checkpoints=_storage(tmp_path), **ONE))
    assert fake.calls["director"] == fake.calls["analyst"] == 0  # not run again
    assert fake.calls["pbp"] == fake.calls["color"] == fake.calls["telestrator"] == 1
    assert [s.step for s in run.result.trace] == list(STEPS)
    assert all(s.source in ("llm", "code") for s in run.result.trace)
    assert run.result.findings.headline == replies["analyst"]["headline"]


def test_a_finished_run_is_not_resumed(ctx, replies, tmp_path):
    _run(run_crew(ctx, client=FakeChatClient(replies), checkpoints=_storage(tmp_path), **ONE))
    fake = FakeChatClient(replies)
    _run(run_crew(ctx, client=fake, checkpoints=_storage(tmp_path), **ONE))
    assert fake.calls["director"] == 1  # nothing to resume: a new run
