"""Model calls with the failure policy of SPEC 6: a timeout per step, one retry, then give up.

`client_from_env` returns a Microsoft Foundry chat client when FOUNDRY_PROJECT_ENDPOINT and
FOUNDRY_MODEL are set (keyless: a managed identity in Azure, `az login` locally), else None: the
crew then runs on templates.
"""

from __future__ import annotations

import asyncio
import os
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from agent_framework import Agent
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


def tools_called(response: Any) -> list[str]:
    """The names of the tools a run called, in order (its function-call contents)."""
    return [
        c.name
        for m in getattr(response, "messages", None) or []
        for c in m.contents
        if getattr(c, "type", None) == "function_call" and c.name
    ]


def describe(e: Exception) -> str:
    """The error for the trace, which is public: a ValidationError is reduced to field and error
    type, so the model's own text (which may hold a number) never reaches a viewer through it."""
    if isinstance(e, ValidationError):
        parts = [".".join(map(str, err["loc"])) + ": " + err["type"] for err in e.errors()]
        return f"ValidationError: {'; '.join(parts)}"[:300]
    return f"{type(e).__name__}: {e}"[:300]


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
