"""Model calls with the failure policy of SPEC 6: a timeout per step, one retry, then give up.

`client_from_env` returns a Microsoft Foundry chat client when FOUNDRY_PROJECT_ENDPOINT and
FOUNDRY_MODEL are set (keyless: a managed identity in Azure, `az login` locally), else None: the
crew then runs on templates. `Outage` stands in for the model of an agent the Producer took down.
"""

from __future__ import annotations

import asyncio
import os
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from agent_framework import Agent, BaseChatClient
from pydantic import BaseModel, ValidationError

DEFAULT_TIMEOUT_S = 8.0
RETRIES = 1


@dataclass
class Attempt:
    value: Any | None
    attempts: int
    error: str | None
    ms: float
    tools_called: list[str] = field(default_factory=list)  # tool names, in call order


async def ask(
    client: Any,
    *,
    name: str,
    instructions: str,
    prompt: str,
    schema: type[BaseModel],
    timeout_s: float = DEFAULT_TIMEOUT_S,
    retries: int = RETRIES,
    tools: list[Any] | None = None,
) -> Attempt:
    """One structured answer from an agent, or None with the last error after the retries."""
    start = time.perf_counter()
    error: str | None = None
    attempts = 0
    for _ in range(1 + retries):
        attempts += 1
        try:
            agent = Agent(client, instructions=instructions, name=name, tools=tools)
            response = await asyncio.wait_for(
                agent.run(prompt, options={"response_format": schema}), timeout_s
            )
            value = response.value
            if value is None:
                raise ValueError("no structured output")
            return Attempt(value, attempts, None, (time.perf_counter() - start) * 1000,
                           tools_called(response))  # fmt: skip
        except Exception as e:  # any failure counts against the step; the caller falls back
            error = describe(e)
    return Attempt(None, attempts, error, (time.perf_counter() - start) * 1000)


class AgentDown(ConnectionError):
    """A model call to an agent that is down (the failure drill, SPEC 6)."""


class Outage(BaseChatClient):
    """The chat client of an agent the Producer took down: every call raises `AgentDown`, as an
    outage would, and no model is called. The step then takes the usual path: the retry, then its
    template."""

    def __init__(self, step: str) -> None:
        super().__init__()
        self.step = step

    def _inner_get_response(self, *, messages, stream, options, **kwargs):
        async def down():
            raise AgentDown(f"the {self.step} is down")

        return down()


def tools_called(response: Any) -> list[str]:
    """The names of the tools a run called, in order (its function-call contents)."""
    return [
        c.name
        for m in getattr(response, "messages", None) or []
        for c in m.contents
        if getattr(c, "type", None) == "function_call" and c.name
    ]


def describe(e: BaseException) -> str:
    """The error for the trace, which is public, so the model's own text (which may hold a number)
    never reaches a viewer through it (SPEC 5.3, 6).

    A ValidationError anywhere in the chain is reduced to field and error type, under the outer
    class: Foundry raises a failed structured output as `ChatClientException: ValidationError:
    angle: value_error`, and its own message, which quotes the model's text, is dropped. Any
    other message that quotes a pydantic error (its `input_value`) is withheld.
    """
    inner = _validation_error(e)
    if inner is not None:
        parts = [_field(err) + err["type"] for err in inner.errors()]
        reduced = f"ValidationError: {'; '.join(parts)}"
        return (reduced if inner is e else f"{type(e).__name__}: {reduced}")[:300]
    message = str(e)
    if "input_value" in message:
        message = "message withheld: it quotes a validation error"
    return f"{type(e).__name__}: {message}"[:300]


def _validation_error(e: BaseException) -> ValidationError | None:
    """The first ValidationError in the chain: `e` itself, a cause or context, an exception among
    the args (Agent Framework passes the inner exception there) or in an exception group."""
    queue, seen = [e], set()
    while queue:
        x = queue.pop(0)
        if id(x) in seen:
            continue
        seen.add(id(x))
        if isinstance(x, ValidationError):
            return x
        linked = (x.__cause__, x.__context__, *x.args, *getattr(x, "exceptions", ()))
        queue += [y for y in linked if isinstance(y, BaseException)]
    return None


def _field(err: Any) -> str:
    """'angle: '; a key the model added (extra_forbidden) is its own text, so it is not named."""
    loc = err["loc"][:-1] if err["type"] == "extra_forbidden" else err["loc"]
    return ".".join(map(str, loc)) + ": " if loc else ""


def client_from_env() -> tuple[Any | None, Callable[[], Awaitable[None]]]:
    """(client, close) for Microsoft Foundry, or (None, no-op) when it is not configured."""

    async def nothing() -> None:
        return None

    endpoint = os.environ.get("FOUNDRY_PROJECT_ENDPOINT", "").strip()
    model = os.environ.get("FOUNDRY_MODEL", "").strip()
    if not endpoint or not model:
        return None, nothing
    from agent_framework.foundry import FoundryChatClient

    credential = credential_from_env()
    client = FoundryChatClient(project_endpoint=endpoint, model=model, credential=credential)
    return client, credential.close


def credential_from_env() -> Any:
    """Keyless: the app's user-assigned identity in Azure Container Apps (which sets
    IDENTITY_ENDPOINT; AZURE_CLIENT_ID names the identity), else the developer's `az login`."""
    client_id = os.environ.get("AZURE_CLIENT_ID", "").strip()
    if os.environ.get("IDENTITY_ENDPOINT") and client_id:
        from azure.identity.aio import ManagedIdentityCredential

        return ManagedIdentityCredential(client_id=client_id)
    from azure.identity.aio import AzureCliCredential

    return AzureCliCredential(tenant_id=os.environ.get("AZURE_TENANT_ID") or None)


def sync_credential_from_env() -> Any:
    """The same choice as `credential_from_env`, for synchronous SDKs (Cosmos DB)."""
    client_id = os.environ.get("AZURE_CLIENT_ID", "").strip()
    if os.environ.get("IDENTITY_ENDPOINT") and client_id:
        from azure.identity import ManagedIdentityCredential

        return ManagedIdentityCredential(client_id=client_id)
    from azure.identity import AzureCliCredential

    return AzureCliCredential(tenant_id=os.environ.get("AZURE_TENANT_ID") or None)
