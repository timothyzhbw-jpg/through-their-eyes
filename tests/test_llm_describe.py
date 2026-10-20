"""The public trace error of a model step (SPEC 5.3, 6): never the model's own text.

Microsoft Foundry raises a structured output that fails validation as a `ChatClientException`
whose message quotes the pydantic error, `input_value` (the model's text) included. `describe`
must reduce every ValidationError in the chain to field and error type.
"""

import re

import pytest
from agent_framework.exceptions import ChatClientException
from pydantic import ValidationError

from agents import telemetry
from agents.context import MomentContext
from agents.llm import describe
from agents.schemas import AnalystChoice
from agents.testing import FakeChatClient
from agents.workflow import breakdown
from tests.test_agents import _good_replies

ANGLE = "H8 scanned 3 times before receiving"  # a digit the no-numbers validator rejects
REDUCED = "ValidationError: angle: value_error"


def _invalid(**changes) -> ValidationError:
    data = {"lens": "scan", "headline": ["c"], "supporting": [], "angle": ANGLE, **changes}
    with pytest.raises(ValidationError) as caught:
        AnalystChoice.model_validate(data)
    return caught.value


def _foundry(inner: ValidationError) -> ChatClientException:
    """As agent_framework_openai's `_handle_request_error` raises it."""
    try:
        try:
            raise inner
        except ValidationError as ex:
            raise ChatClientException(
                f"<class 'FoundryChatClient'> service failed to complete the prompt: {ex}",
                inner_exception=ex,
            ) from ex
    except ChatClientException as e:
        return e


def _assert_no_model_text(error: str) -> None:
    assert "input_value" not in error and "scanned" not in error, error
    assert not re.search(r"\d", error), error


def test_the_foundry_wrapper_quotes_the_model_text():
    e = _foundry(_invalid())
    assert "input_value" in str(e) and "scanned" in str(e)  # what the trace used to carry


def test_a_wrapped_validation_error_keeps_the_outer_class_and_only_field_and_type():
    error = describe(_foundry(_invalid()))
    assert error == f"ChatClientException: {REDUCED}"
    _assert_no_model_text(error)
    assert telemetry.error_class(error) == "ChatClientException"


def _args_only(inner):  # an inner exception passed as an argument, no chaining
    return ChatClientException(f"failed: {inner}", inner_exception=inner)


def _cause_only(inner):
    e = RuntimeError(f"failed: {inner}")
    e.__cause__ = inner
    return e


def _context_only(inner):
    try:
        try:
            raise inner
        except ValidationError:
            raise RuntimeError(f"failed: {inner}")  # noqa: B904 - an implicit context on purpose
    except RuntimeError as e:
        return e


def _nested(inner):
    return ChatClientException("outer", inner_exception=_cause_only(inner))


def _group(inner):
    return ExceptionGroup("unhandled errors in a TaskGroup", [_foundry(inner)])


@pytest.mark.parametrize(
    ("wrap", "outer"),
    [
        (_args_only, "ChatClientException"),
        (_cause_only, "RuntimeError"),
        (_context_only, "RuntimeError"),
        (_nested, "ChatClientException"),
        (_group, "ExceptionGroup"),
    ],
)
def test_the_validation_error_is_found_anywhere_in_the_chain(wrap, outer):
    error = describe(wrap(_invalid()))
    assert error == f"{outer}: {REDUCED}"
    _assert_no_model_text(error)


def test_a_bare_validation_error_is_reduced_as_before():
    assert describe(_invalid()) == REDUCED


def test_a_model_written_extra_key_is_not_named():
    error = describe(_foundry(_invalid(angle="He saw the runner.", angle_2="scanned")))
    assert error == "ChatClientException: ValidationError: extra_forbidden"
    assert "angle_2" not in error
    _assert_no_model_text(error)


def test_a_message_that_quotes_a_validation_error_is_withheld():
    error = describe(RuntimeError(f"service failed: {_invalid()}"))  # the error itself is gone
    assert error.startswith("RuntimeError: ")
    _assert_no_model_text(error)
    assert telemetry.error_class(error) == "RuntimeError"


def test_other_errors_keep_their_message():
    assert describe(TimeoutError()) == "TimeoutError: "
    assert describe(ValueError("no structured output")) == "ValueError: no structured output"


# --- end to end: the trace that `/api/breakdowns` returns -----------------------------------------


@pytest.fixture(scope="module")
def ctx():
    return MomentContext.load("blind_side_run", seed=3)


@pytest.mark.parametrize(
    "reply",
    [
        pytest.param("foundry", id="foundry-wrapped"),
        pytest.param("json", id="parsed-by-agent-framework"),
    ],
)
def test_the_breakdown_trace_never_carries_the_model_text(ctx, reply):
    replies = _good_replies(ctx)
    bad = {**replies["analyst"], "angle": ANGLE}
    replies["analyst"] = _foundry(_invalid(**bad)) if reply == "foundry" else bad
    r = breakdown(ctx, client=FakeChatClient(replies), personas=("analyst",), languages=("en",))
    steps = {s.step: s for s in r.trace}
    assert steps["analyst"].source == "template"
    assert steps["analyst"].error.endswith(REDUCED)
    _assert_no_model_text(steps["analyst"].error)
    public = "".join(s.model_dump_json() for s in r.trace)
    assert "scanned" not in public and "input_value" not in public
