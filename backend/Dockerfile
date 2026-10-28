# syntax=docker/dockerfile:1.7
# Base images are pinned by digest (docs/22-infrastructure-devops.md section 8.6). Renovate keeps
# the tag comment and the digest in step.
ARG PYTHON_IMAGE=python:3.13-slim@sha256:7c61056e61ac89e852de05f3dc6fa51a6dd2181797bceed46aa725dd7cb2cd3b
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.11@sha256:77280f2f771df71f90786c314fe1bbc1e023feac652969bbf139c280babf2eb7

FROM ${UV_IMAGE} AS uv

FROM ${PYTHON_IMAGE} AS build
COPY --from=uv /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-editable

FROM ${PYTHON_IMAGE} AS runtime
ARG RELEASE_SHA=dev
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 RELEASE_SHA=${RELEASE_SHA}
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
USER 10001:10001

FROM runtime AS api
ENV PROCESS_ROLE=api
EXPOSE 8000
# Compose adds --forwarded-allow-ips with the addresses of caddy and web.
CMD ["uvicorn", "idraft.api.main:create_app", "--factory", "--host=0.0.0.0", "--port=8000", "--proxy-headers", "--no-access-log", "--no-server-header", "--timeout-graceful-shutdown=25"]

FROM runtime AS worker
ENV PROCESS_ROLE=worker
CMD ["python", "-m", "idraft.worker"]

FROM runtime AS migrator
ENV PROCESS_ROLE=migrator
CMD ["python", "-m", "idraft.db.migrate"]

