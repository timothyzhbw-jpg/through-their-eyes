# The API service image (SPEC 8). Build from the repo root:
#
#     docker build -t tte-api .
#     docker run --rm -p 8000:8000 tte-api      # then GET http://localhost:8000/health
#
# Only the main dependencies from uv.lock go in: no dev group, no realfeed group (OpenCV). Only the
# service's packages are copied; .dockerignore keeps everything else out of the build context.
# One uvicorn worker: the rate limits are per process.

FROM python:3.11-slim AS build
# uv from PyPI rather than the ghcr.io image, so the build only needs PyPI.
RUN pip install --no-cache-dir uv==0.11.32
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-default-groups --no-dev

FROM python:3.11-slim
RUN useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY agents ./agents
COPY analytics ./analytics
COPY api ./api
COPY explain ./explain
COPY sim ./sim
# Bytecode is compiled at build time (the user cannot write here); out/ holds the file cache
# (TTE_CACHE_DIR defaults to out/cache), so it belongs to the service user.
RUN python -m compileall -q agents analytics api explain sim \
    && mkdir out && chown app:app out
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONPATH=/app \
    PYTHONUNBUFFERED=1
USER app
EXPOSE 8000
# --ws-max-size: uvicorn refuses a larger incoming WebSocket frame from its header (close 1009)
# before buffering it; the live stream's control messages are at most 256 characters.
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--ws-max-size", "4096"]
