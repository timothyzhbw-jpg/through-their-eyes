"""Guards for a public API (CLAUDE.md rule 6: no login until 2026-11-10).

- Request bodies are capped (413), whether or not they declare a length.
- Every HTTP response carries the security headers that cannot break a client: no MIME sniffing,
  no framing, no referrer, HTTPS only, and on anything but HTML (the /docs pages load scripts)
  a CSP that allows nothing. CORS is configured in api/main.py and is left as it is.
- A 500 says "internal error" and nothing else; the traceback goes to the log.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MAX_BODY_BYTES = 16 * 1024  # the largest valid body, a what-if question, is under 1 KiB
HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "strict-transport-security": "max-age=31536000",
}
CSP = "default-src 'none'; frame-ancestors 'none'"


class BodyLimit:
    """413 for a request body over `max_bytes`, declared or streamed."""

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        declared = dict(scope["headers"]).get(b"content-length", b"0")
        too_large = HTTPException(413, f"request bodies are limited to {self.max_bytes} bytes")
        received = 0

        async def limited() -> Message:
            nonlocal received
            if not declared.isdigit() or int(declared) > self.max_bytes:
                raise too_large  # read by the route, so FastAPI turns it into the response
            message = await receive()
            received += len(message.get("body", b""))
            if received > self.max_bytes:
                raise too_large
            return message

        await self.app(scope, limited, send)


class SecurityHeaders:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                have = {k.decode().lower() for k, _ in headers}
                content_type = dict(headers).get(b"content-type", b"").decode()
                extra = dict(HEADERS)
                if not content_type.startswith("text/html"):
                    extra["content-security-policy"] = CSP
                headers += [(k.encode(), v.encode()) for k, v in extra.items() if k not in have]
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, with_headers)


def _internal_error_response() -> JSONResponse:
    return JSONResponse(
        {"detail": "internal error"}, 500, headers={**HEADERS, "content-security-policy": CSP}
    )


class InternalErrors:
    """The 500 for an unhandled exception, sent inside CORS so the browser can read it.

    Starlette's own handler for `Exception` runs outside every middleware, CORS included. The
    exception is re-raised after the response, so the server still logs the traceback.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started = False

        async def tracked(message: Message) -> None:
            nonlocal started
            started = started or message["type"] == "http.response.start"
            await send(message)

        try:
            await self.app(scope, receive, tracked)
        except Exception:
            if not started:
                await _internal_error_response()(scope, receive, send)
            raise


async def internal_error(request: Request, exc: Exception) -> JSONResponse:
    """The fallback for an exception outside InternalErrors (in a middleware further out)."""
    return _internal_error_response()


def install(app: FastAPI) -> None:
    """Before CORS is added, so CORS stays outermost and a 413 or a 500 still reaches the
    browser."""
    app.add_middleware(InternalErrors)
    app.add_middleware(BodyLimit)
    app.add_middleware(SecurityHeaders)
    app.add_exception_handler(Exception, internal_error)
