# syntax=docker/dockerfile:1.7
# The web image (20-frontend-specification.md section 9.1): dependencies, build, then a slim runtime with
# the standalone server, its static assets and `public`, run as a non-root user.
#
# Built from the repository root, since the lockfile and the pnpm workspace live there:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_RELEASE=<git sha> -t web .
# apps/web/Dockerfile.dockerignore keeps the context to the files the build reads.
#
# The base image is pinned by digest (22-infrastructure-devops.md section 8.6), like the API's; Renovate
# keeps the tag comment and the digest in step.
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

FROM ${NODE_IMAGE} AS deps
ENV PNPM_HOME=/pnpm COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo
# The manifests alone first, so a source change does not reinstall the dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @app/web...

FROM deps AS build
# NEXT_PUBLIC_* values are inlined by `next build`, so the image is built for its environment (20 section
# 9.2). A production image never mocks the API: the environment schema refuses it.
ARG NEXT_PUBLIC_APP_ENV=production
ARG NEXT_PUBLIC_RELEASE=dev
ENV NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV} \
    NEXT_PUBLIC_API_MOCKING=off \
    NEXT_PUBLIC_RELEASE=${NEXT_PUBLIC_RELEASE} \
    NEXT_TELEMETRY_DISABLED=1
COPY apps/web apps/web
# The mock worker is for development and tests; a production image does not serve it
RUN pnpm --filter @app/web build && rm apps/web/public/mockServiceWorker.js

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
# The standalone tree keeps the repository layout (outputFileTracingRoot is the repository root), so the
# server is apps/web/server.js; the static assets and `public` are not part of it and are copied beside it,
# as scripts/prepare-standalone.mjs does for `pnpm start`. The files stay root's, so the process cannot
# change its own code; only the cache Next.js writes at run time belongs to the process's user.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
RUN mkdir -p apps/web/.next/cache && chown 1000:1000 apps/web/.next/cache
# The node image's unprivileged user, by number, so a runtime that checks for a non-root user can see it
USER 1000:1000
EXPOSE 3000
# API_INTERNAL_ORIGIN is required at start (http://api:8000 in Compose); a missing or malformed server
# variable ends the process with its name (src/instrumentation.node.ts).
CMD ["node", "apps/web/server.js"]
