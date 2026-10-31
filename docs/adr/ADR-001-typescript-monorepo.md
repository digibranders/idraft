# ADR-001: TypeScript monorepo for all application code

Status: Superseded by ADR-022 (2026-09-30)
Date: 2026-09-29

## Superseded
Replaced by [ADR-022](ADR-022-python-backend-simplified-platform.md): the backend is Python 3.13 with FastAPI, Pydantic v2 and uv, and the web app is Next.js self-hosted on the droplet instead of Vercel; the contract is the OpenAPI document, consumed through a generated TypeScript client. The product's own logic (extraction, canonicalization, statistics) is stronger in Python, and server rendering on Vercel would call the API across regions on every page.

## Context
The frontend must be Next.js on Vercel. The backend is I/O-bound collection, SQL analytics and job orchestration on a small droplet. The team needs shared request/response contracts and one toolchain.

## Decision
Use TypeScript for web, API, workers and scheduler in one pnpm + Turborepo monorepo. Node.js 24 LTS runtime. Fastify 5 with Zod type provider; OpenAPI generated from Zod. Pure packages (`domain`, `extraction`) hold business logic without I/O. Heavier NLP, if ever needed, is a separate Python sidecar behind a queue.

## Alternatives considered
Python (FastAPI + Celery/Dramatiq/arq): stronger data-science libraries, but contracts would be duplicated or code-generated and the queue options are weaker for our priority/rate-limit/flow needs. Go: fast and small, but slower product iteration and no shared types with the frontend.

## Consequences
Shared Zod contracts across API and UI; one CI pipeline; BullMQ available. Statistics (Wilson, bootstrap, RBO) must be implemented and tested ourselves (small). Memory per Node process (150 to 400 MB) must be budgeted on 4 GB.

## Revisit trigger
A required capability (for example a local NER or embedding model) cannot run acceptably in Node, or a Python-only library becomes central.

## Amendment (2026-10-31)
Host note only: "the droplet" above is now a shared Hostinger VPS with an 8 GB idraft share ([ADR-023](ADR-023-shared-hostinger-vps.md)). This ADR remains superseded by ADR-022.
