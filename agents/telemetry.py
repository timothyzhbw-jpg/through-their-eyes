"""Tracing for the agent crew (SPEC 8): one span per breakdown, one child span per workflow step.

    breakdown ─┬─ director
               ├─ analyst                                  (its MCP tool calls nest under it)
               ├─ telestrator
               ├─ narration   per persona × language × speaker, and per rewrite (round ≥ 1)
               ├─ verifier    per round
               └─ voice

Attributes are ids and counts only: moment, personas/persona, languages/language, speaker, model,
attempts, source (llm / template / code), error class, rewrites, dropped lines, ms. Never prompt or
narration text, which also bounds ingestion. Step spans name the breakdown span as their parent and
are current while they run, so Agent Framework's own agent, chat and tool spans nest under the step
that made the call.

Spans go to the global OpenTelemetry tracer provider: Application Insights once `configure_tracing`
has run with APPLICATIONINSIGHTS_CONNECTION_STRING set; nowhere otherwise. Agent Framework's spans
carry message content only if its ENABLE_SENSITIVE_DATA switch is on; keep it off.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from opentelemetry import trace
from opentelemetry.trace import Span, Status, StatusCode

tracer = trace.get_tracer("through_their_eyes.agents")
PREFIX = "tte."
SERVICE_NAME = "tte-api"
_configured = False


def model_name(client: Any | None) -> str:
    """The deployment a chat client calls (Foundry clients keep it in `model`), else its class."""
    if client is None:
        return "offline"
    model = getattr(client, "model", None)
    return model if isinstance(model, str) and model else type(client).__name__


def error_class(error: str | None) -> str | None:
    """'TimeoutError: …' → 'TimeoutError': the exception's class, never its message."""
    if not error:
        return None
    return error.split(":", 1)[0].strip() or None


def _attributes(values: dict[str, Any]) -> dict[str, Any]:
    return {
        PREFIX + key: tuple(value) if isinstance(value, list | tuple) else value
        for key, value in values.items()
        if value is not None
    }


@contextmanager
def span(name: str, parent: Span | None = None, **attributes: Any) -> Iterator[Span]:
    """A span, current while the block runs; `parent` (if given) replaces the ambient context."""
    context = trace.set_span_in_context(parent) if parent is not None else None
    attrs = _attributes(attributes)
    with tracer.start_as_current_span(name, context=context, attributes=attrs) as s:
        yield s


def annotate(s: Span, *, error: str | None = None, **attributes: Any) -> None:
    """Add ids and counts to a span. An error adds its class and marks the span failed."""
    s.set_attributes(_attributes(attributes))
    if cls := error_class(error):
        s.set_attribute(PREFIX + "error_class", cls)
        s.set_status(Status(StatusCode.ERROR, cls))


def configure_tracing(service_name: str = SERVICE_NAME) -> bool:
    """Send traces to Application Insights when APPLICATIONINSIGHTS_CONNECTION_STRING is set.

    Call it once, before the FastAPI app is created, so its requests are instrumented too.
    Returns whether tracing is on. Without the connection string, nothing is installed and spans
    stay no-ops.
    """
    global _configured
    if _configured:
        return True
    connection_string = os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING", "").strip()
    if not connection_string:
        return False
    from azure.monitor.opentelemetry import configure_azure_monitor
    from opentelemetry.sdk.resources import Resource

    configure_azure_monitor(
        connection_string=connection_string,
        resource=Resource.create({"service.name": service_name}),
    )
    _configured = True
    return True
