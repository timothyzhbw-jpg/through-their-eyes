"""A scripted chat client for tests and offline demos.

Routes each request by the `ROLE: <name>` line at the top of the agent's instructions and answers
with the reply configured for that role: a value (returned as JSON), a list of values (one per
call, the last one repeating), a function of the prompt that returns one of those, an exception
(raised), or `SLOW` (never answers in time).
`delays` adds a fixed latency in seconds to every call of a role, like a model's response time.

`ToolCallingFakeChatClient` also runs Agent Framework's tool loop, so a `Call` reply makes the
agent really call that tool (an MCP tool goes over stdio) before the role's next reply.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections import defaultdict
from typing import Any

from agent_framework import BaseChatClient, ChatResponse, Content, FunctionInvocationLayer, Message
from pydantic import BaseModel

_ROLE = re.compile(r"ROLE:\s*(\w+)")


class Call:
    """A scripted reply that asks for one tool call instead of answering."""

    def __init__(self, name: str, **arguments: Any) -> None:
        self.name, self.arguments = name, arguments


class FakeChatClient(BaseChatClient):
    SLOW = object()

    def __init__(self, replies: dict[str, Any], delays: dict[str, float] | None = None) -> None:
        super().__init__()
        self.replies = replies
        self.delays = delays or {}
        self.calls: dict[str, int] = defaultdict(int)
        self.prompts: dict[str, list[str]] = defaultdict(list)
        self.tools: dict[str, list[str]] = defaultdict(list)  # tool names each role was given
        # Tool results each role was sent back, by call id (the exception, if the tool raised).
        self.tool_results: dict[str, dict[str, str]] = defaultdict(dict)

    def _role(self, messages, options) -> str:
        texts = [str((options or {}).get("instructions") or "")]
        texts += [str(getattr(m, "text", "") or "") for m in messages]
        for text in texts:
            if m := _ROLE.search(text):
                return m.group(1)
        raise KeyError("no ROLE line in the request")

    def _inner_get_response(self, *, messages, stream, options, **kwargs):
        role = self._role(messages, options)
        k = self.calls[role]
        self.calls[role] += 1
        self.prompts[role].append(str(getattr(messages[-1], "text", "")))
        tools = (options or {}).get("tools") or []
        self.tools[role] = [getattr(tool, "name", str(tool)) for tool in tools]
        for content in (c for m in messages for c in m.contents):
            if content.type == "function_result":
                result = content.exception or content.result
                self.tool_results[role][content.call_id] = str(result)
        reply = self.replies[role]
        if isinstance(reply, list):
            reply = reply[min(k, len(reply) - 1)]
        if callable(reply) and not isinstance(reply, type):  # a reply that reads the prompt
            reply = reply(self.prompts[role][-1])

        async def answer() -> ChatResponse:
            await asyncio.sleep(self.delays.get(role, 0.0))
            if reply is FakeChatClient.SLOW:
                await asyncio.sleep(3600)
            if isinstance(reply, BaseException):
                raise reply
            if isinstance(reply, Call):
                call = Content.from_function_call(f"call-{role}-{k}", reply.name,
                                                  arguments=reply.arguments)  # fmt: skip
                return ChatResponse(messages=[Message(role="assistant", contents=[call])])
            text = (
                reply.model_dump_json(by_alias=True)
                if isinstance(reply, BaseModel)
                else json.dumps(reply)
            )
            return ChatResponse(messages=[Message(role="assistant", contents=[text])])

        return answer()


class ToolCallingFakeChatClient(FunctionInvocationLayer, FakeChatClient):
    """A FakeChatClient whose agents invoke the tools that `Call` replies ask for."""
