# 00. Executive Summary and Final Decision Summary

Status: Architecture locked 2026-09-30 ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md))
Last updated: 2026-09-30 (architecture locked by ADR-022; research conducted 2026-09-29; sources in [01-research-findings.md](01-research-findings.md) and `research/`)

## 1. What we are building

A self-hosted platform that measures how a brand, its domains, pages, keywords, prompts and competitors appear in Google search results and in AI-generated answers (Google AI Overview, Google AI Mode, ChatGPT, Gemini), and connects both through one model of topics, domains, pages, competitors and history. Traditional rank tracking is a first-class product, not an input to AI tracking. The platform owns inventories, taxonomy, normalized observations, history, extraction, statistics and analysis; it buys commodity collection from DataForSEO.

## 2. The ten decisions that shape everything

1. **Python backend and self-hosted Next.js**: one Python project (FastAPI API and a Taskiq worker) and a Next.js app, both on one DigitalOcean droplet behind Caddy on one origin. Pydantic models are the contract; the web app uses a TypeScript client generated from the OpenAPI document. [ADR-022](adr/ADR-022-python-backend-simplified-platform.md), [ADR-002](adr/ADR-002-single-droplet-compose.md)
2. **PostgreSQL 18 is the ledger**; observations are append-only and partitioned monthly; rollups store counts and sums; raw provider payloads go to Cloudflare R2. [ADR-003](adr/ADR-003-postgresql-ledger.md), [ADR-004](adr/ADR-004-raw-payloads-r2.md)
3. **Every paid call is a task row before it is a queue job**, so Redis loss never loses or duplicates spend. Taskiq on Redis carries the jobs in two queues, `collect` and `process`. [ADR-022](adr/ADR-022-python-backend-simplified-platform.md) (queue), [ADR-005](adr/ADR-005-queue-bullmq-postgres-ledger.md) (ledger)
4. **DataForSEO behind an adapter contract**, with fallbacks (Oxylabs or Bright Data for SEO, SearchAPI.io for AI) built only when a defined trigger fires. [ADR-006](adr/ADR-006-dataforseo-primary-adapters.md)
5. **Organic rank is canonical, with depth-aware nulls.** Since September 2025 DataForSEO bills per 10 results, so the default depth profile is top 20 daily plus top 100 weekly, a 68% saving over top 100 daily. [ADR-007](adr/ADR-007-organic-rank-canonical.md), [ADR-019](adr/ADR-019-depth-profiles.md)
6. **The AI Overview is stored once and used twice**: as a SERP feature next to the same check's organic rank, and as an AI answer with citations and mentions. It costs nothing extra beyond the rank check (plus a small async surcharge when present).
7. **Mention and citation are separate facts**; observation classes (consumer UI, official API, SERP AI, first-party, organic rank) are never pooled. [ADR-008](adr/ADR-008-observation-classes.md), [ADR-009](adr/ADR-009-mention-citation-separate.md)
8. **AI metrics are rates over repeated observations with honest intervals**: panel-level precision from many prompts, replicates for a priority subset, paired period comparisons, "detectable change" rule. [ADR-010](adr/ADR-010-replicate-measurement.md)
9. **Keywords and prompts are separate entities with typed many-to-many links**; cross-channel analysis uses matrices and component metrics, never an opaque combined score. [ADR-011](adr/ADR-011-keyword-prompt-links.md), [ADR-016](adr/ADR-016-no-composite-score.md)
10. **Deterministic extraction first**, with evidence spans and versioned derivations; LLMs only adjudicate ambiguous items within a budget. [ADR-015](adr/ADR-015-extraction-deterministic-first.md)

## 3. What research changed

| Assumption in the brief | Finding (verified 2026-09-29) | Design response |
|---|---|---|
| Top-100 rank tracking is cheap per keyword | DataForSEO bills per page of 10; top 100 = 10x top 10; an earlier 25% discount on extra pages is no longer shown | Depth profiles; depth-aware metrics |
| AI Overview comes with the SERP | Async AI Overviews return `null` unless `load_async_ai_overview` is set (paid when present, refunded when absent) | Always set; budget the surcharge; spike S-03 |
| ChatGPT/Gemini tracking via DataForSEO | ChatGPT scraper exposes cited sources, retrieved results, fan-out queries and brand entities; Gemini scraper has citations but no fan-out; login state undocumented | Fan-out features ChatGPT-only in V1; honest "signed-out sample" labeling |
| Official APIs as benchmarks | OpenAI, Anthropic, Perplexity, xAI usable; Gemini API grounding terms restrict caching and analysis; Perplexity Sonar is legacy since 2026-09-27 | Gemini grounding excluded; Perplexity via Agent API |
| First-party AI reporting | GSC Generative AI performance report (impressions only) and Bing AI Performance report exist but have **no API** | CSV import paths with provenance |
| GA4 AI traffic | GA4 now has an "AI Assistant" channel, but it excludes AI Overviews and AI Mode | Show Google's channel and our classifier side by side |
| Queue tooling | BullMQ 6 (July 2026) removed `repeat`/`debounce` and added an experimental Postgres backend | Superseded by ADR-022: Taskiq on Redis with the PostgreSQL task ledger; Redis stays |
| Backup tooling | WAL-G `wal-push` hangs against R2 (open issue) | pg_dump + age now; pgBackRest for PITR later |
| Commercial AI "rank" and visibility scores | Vendors use hidden weights and incompatible denominators | Component metrics with denominators only |

## 4. Cost at a glance (standard queue, desktop, USD per month)

| Scenario | Total |
|---|---|
| **V1 target:** 1,000 prompts/week (ChatGPT, Gemini, AI Mode; priority subset with replicates) + 1,000 keywords daily (`standard` depth) | **about $102 to $148** |
| 1,000 prompts/week + 5,000 keywords daily (`standard`) | about $337 to $429 |
| Same with top 100 every day | about $954 to $1,169 |
| 5,000 prompts/week (replicates) + 10,000 keywords (`standard`, 20% mobile), 8 GB droplet | about $965 to $1,101 |

Unit costs: about $0.057 per tracked keyword per month (`standard`), $0.0156 per prompt per month (3 engines, 1 replicate), $0.0012 per AI observation, $0.0006 per 10 SERP results. Fixed infrastructure is about $24 to $30. Full model in [27-cost-model.md](27-cost-model.md).

## 5. Can one droplet do it?

Yes for V1. Collection is I/O-bound and runs well under 5% of DataForSEO's rate limits; ingest writes under 50 rows per second at peak. The binding constraint is disk: at 5,000 keywords daily plus 1,000 prompts weekly, PostgreSQL grows about 15 GB per year against about 40 GB usable, so the droplet lasts about 2.5 years; at 10,000 keywords plus 5,000 prompts it needs a Volume or a separate database host within about 10 months. Exact triggers for resize, Volume, database droplet, second worker droplet and ClickHouse are in [28-data-growth-scaling.md](28-data-growth-scaling.md).

## 6. Final decision summary

### 6.1 Architecture decisions

| Decision | Selected | Alternatives | Reason | Revisit trigger |
|---|---|---|---|---|
| Language and repo | Python 3.13 backend (FastAPI, Pydantic v2, uv) in `backend/`; Next.js (TypeScript, pnpm) in `apps/web/` with a client generated from OpenAPI; no Turborepo ([ADR-022](adr/ADR-022-python-backend-simplified-platform.md)) | TypeScript monorepo ([ADR-001](adr/ADR-001-typescript-monorepo.md)); Go | Extraction, canonicalization and statistics are stronger in Python; one contract via OpenAPI | A Python-only or a Node-only capability becomes central to a phase |
| Hosting | One DO droplet (2 vCPU/4 GB/80 GB), Docker Compose, Ubuntu 26.04; containers `caddy`, `web`, `api`, `worker`, `postgres`, `redis`; Next.js self-hosted on the same origin | Vercel for the web app; managed services; Kubernetes | Constraint; simple ops; no cross-region hop for server rendering, no CORS | Resize to 8 GB on steady swap, cache hit ratio under 99% for a week, or database over 10 GB; doc 28 triggers |
| Database | PostgreSQL 18, monthly partitions, rollups, RLS | TimescaleDB; ClickHouse now | Integrity, joins, one datastore | ClickHouse triggers (doc 28 section 8) |
| Raw storage | R2, zstd, retention classes | JSONB in PG; no raw | Disk; re-parse ability | R2 price or reliability change |
| Queue | Taskiq on Redis 8, queues `collect` and `process` in one worker; PG task ledger; dispatcher | BullMQ ([ADR-005](adr/ADR-005-queue-bullmq-postgres-ledger.md)); arq; Procrastinate; Celery (fallback) | No lost or double spend; SQL-visible schedule; async-native collection | Taskiq fails its Phase 1 smoke test (fall back to Celery) |
| Auth | Own FastAPI module: argon2id, opaque sessions in `auth.sessions`, `__Host-session` cookie, invitations, roles, TOTP for owner and admin | Better Auth ([ADR-014](adr/ADR-014-better-auth.md), no Python API); fastapi-users; hosted auth | Standard, small needs; same-origin cookie, no CORS | Offering to outside companies (Google OIDC, API keys) |
| Primary provider | DataForSEO (SERP, AI Mode, LLM Scraper, Labs) | SerpApi; Oxylabs; Bright Data; own scraping | Cost and coverage | Fallback triggers (doc 05 section 5) |
| Readiness signal | Polling only: `tasks_ready` every 60 s (30 s while a collection window is open) plus the id sweeper | Pingback plus polling ([ADR-018](adr/ADR-018-pingback-polling.md)); postback | No public callback route; low cost at V1 volume | Collection window overruns twice in a month |
| Canonical rank | Organic `rank_group`; absolute secondary; depth-aware nulls | Absolute rank; imputed 100 | Stability; honesty | Provider cannot supply group rank |
| Depth | `standard` profile default (top 20 daily, top 100 weekly) | Top 100 daily | 68% cheaper, same daily precision where traffic is | Pricing change |
| AI Overview | One record: SERP feature + AI observation | Duplicated records | Consistency, zero extra cost | None |
| AI engines V1 | ChatGPT (scraper), Gemini (scraper), AI Mode, AI Overview | Perplexity/Claude consumer (not offered by DataForSEO) | Coverage via one vendor | SearchAPI.io fallback if Perplexity needed |
| AI sampling | All core prompts weekly x 1; priority subset x 3 (ChatGPT, Gemini) | Many replicates for all | Panel precision per dollar | S-05 results |
| Statistics | Prompt-weighted rates, Wilson/fixed-panel intervals, paired comparisons, BH, RBO | Point estimates only | Honest uncertainty | None |
| Extraction | Deterministic stages + budgeted LLM adjudication; versioned derivations | LLM-first | Reproducibility, cost | Gold-set targets unmet |
| Visibility | CTR-weighted ratio with versioned curve `ctr_v1`; no composite AI+SEO score | Opaque scores | Explainability | None |
| Tenancy | workspace_id + RLS; global URL/domain dictionaries; shared fetch cache in Phase 11 or later | Schema per tenant | Isolation with compact storage | Enterprise isolation needs |
| Backups | Nightly pg_dump + zstd + age + rclone to R2, 30-day retention; DigitalOcean weekly droplet backups; monthly scripted restore drill | GFS rotation with bucket lock and CI restore test; WAL-G | RPO 24 h at low operating cost; R2 WAL-G bug | RPO < 24 h (PITR), offering to outside companies |
| Observability | Sentry, Healthchecks, Better Stack uptime, JSON logs via `docker compose logs`, SQL ops checks, in-app Operations screen over the task ledger | Alloy to Grafana Cloud ([ADR-021](adr/ADR-021-observability-stack.md)); Netdata; self-hosted Prometheus | 4 GB RAM budget; the task ledger already records collection state | Free-tier limits |
| Gemini API grounding | Not used for bulk measurement | Use as benchmark | Terms restrict caching and analysis | Counsel approval or terms change |

### 6.2 Build vs buy

| We build | External APIs provide | Open source we use | Postponed |
|---|---|---|---|
| Keyword and prompt inventories, taxonomy, links | Google SERPs, features, AI Overviews (DataForSEO SERP) | PostgreSQL 18, Redis 8, Taskiq, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic | ClickHouse |
| Scheduling, task ledger, cost metering, budgets | Google AI Mode (DataForSEO) | Next.js, React, TanStack Query/Table, ECharts, shadcn/ui, Tailwind | Fallback provider adapters (until triggered) |
| Normalization, canonicalization, versioning | ChatGPT and Gemini consumer answers (DataForSEO LLM Scraper) | tldextract (PSL), rapidfuzz, url-normalize, scipy, statsmodels, remark/react-markdown, rehype-sanitize | Official API benchmarks (Phase 14) |
| Entity extraction, recommendation, structured rank, sentiment rules | Keyword metrics and discovery data (DataForSEO Labs, Keywords Data, AI Keyword Data) | Caddy, rclone, age | Claims analysis, experiments, diagnostics (Phase 15) |
| Metrics, statistics, rollups, matrices, diagnostics | First-party data (GSC, Bing, GA4, Cloudflare APIs) | pytest, Testcontainers, Hypothesis, import-linter, openapi-typescript, Vitest, Playwright | Hyperlocal and pixel-position tracking |
| Citation and source intelligence, publisher opportunities | LLM adjudication (cheap model, budgeted) | Ideas (not code) from MIT/Apache projects: Lettertrace, Limelit Open, OpenSEO, AEO Radar (see research/06) | Local ML classifiers |
| Dashboard, API, alerts, exports | Error tracking, uptime, heartbeats (Sentry, Better Stack, Healthchecks free tiers) | | |

No open-source AI visibility tracker is forked. Several have useful ideas (branded-prompt exclusion, sample sizes on every number, deterministic matchers, one-active-run guards); some have serious security problems (unauthenticated dashboards that spend API credit, plaintext keys). Licensing notes are in `research/06-open-source.md`.

### 6.3 MVP scope

Phases 0 to 9 plus 10a ([29-phase-roadmap.md](29-phase-roadmap.md)): multi-tenant platform with backups and monitoring; entities and taxonomy; keyword system with imports; daily rank collection with features, AI Overview and competitors; SEO analytics, landing pages, cannibalization, alerts; prompt system with versioned core panel; weekly ChatGPT, Gemini and AI Mode collection with raw evidence; deterministic extraction; AI metrics with intervals; keyword-prompt links, SEO/AI matrix, AIO citation by rank bucket, page intelligence. About 45.5 engineer-weeks; about 19.5 calendar weeks including Phase 0 with three engineers on two tracks (doc 29 section 1). Phase 0 is about 1 week and Phase 1 about 3.5 weeks after ADR-022; estimates for Phases 2 to 10a are re-checked at the end of Phase 1.

### 6.4 Post-MVP roadmap

Phase 10b (cluster matrix, longitudinal association, domain dominance, AI-first opportunities), 11 (discovery inboxes, auto-clustering, modeled AI demand), 12 (GSC, Bing, GA4, Cloudflare, report imports), 13 (source intelligence, publishers, categories), 14 (advanced statistics, benchmarks via official APIs), 15 (diagnostics, fan-out rank coverage, claims, content gaps, experiments, fallback providers when triggered).

### 6.5 Open questions requiring experiments

Q-01 to Q-15 in [30-risks-open-questions.md](30-risks-open-questions.md), with spikes S-01 to S-16 (S-07 and S-08 dropped and S-10 moved to Phase 1 by ADR-022). The ones that change budgets or claims: extra-page and async AIO billing (S-01), async AIO share (S-03), scraper login state and ads in answers (S-04), replicate independence (S-05), payload sizes (S-02, S-04), and DataForSEO written confirmation for multi-tenant resale (Q-03).

## 7. Document map

| Doc | Content |
|---|---|
| [01](01-research-findings.md) | Research findings, surprises, spike list |
| [02](02-product-requirements.md) | Product requirements with ids and phases |
| [03](03-system-architecture.md) | Architecture, process model, queues, flows |
| [04](04-data-model.md) | Canonical data model and DDL |
| [05](05-provider-integrations.md) | Provider strategy and adapter contract |
| [06](06-dataforseo-seo-integration.md), [07](07-dataforseo-ai-integration.md) | DataForSEO SEO and AI integration |
| [08](08-seo-keyword-system.md), [09](09-rank-tracking-methodology.md), [10](10-serp-feature-tracking.md) | Keyword system, rank methodology, SERP features |
| [11](11-ai-prompt-system.md), [12](12-normalized-observation-schemas.md), [13](13-ai-extraction-engine.md), [14](14-citation-intelligence.md) | Prompts, canonical schemas, extraction, citations |
| [15](15-seo-ai-correlation.md), [16](16-metrics-methodology.md), [17](17-statistical-methodology.md) | Cross-channel, metrics, statistics |
| [18](18-first-party-integrations.md) | First-party data |
| [19](19-api-specification.md), [20](20-frontend-specification.md) | API and frontend |
| [21](21-scheduler-workers.md), [22](22-infrastructure-devops.md), [23](23-backup-disaster-recovery.md), [24](24-security.md), [25](25-observability.md) | Scheduling, infrastructure, backups, security, observability |
| [26](26-testing-quality.md) | Testing and data quality |
| [27](27-cost-model.md), [28](28-data-growth-scaling.md) | Costs and growth |
| [29](29-phase-roadmap.md), [30](30-risks-open-questions.md), [31](31-implementation-checklist.md) | Roadmap, risks, checklist |
| [adr/](adr/README.md) | Decisions; ADR-022 locks the architecture (diagrams are inline Mermaid blocks in the numbered docs; the locked architecture page is [diagrams/architecture-locked.html](diagrams/architecture-locked.html)) |
| [review-log.md](review-log.md) | Consistency review of 2026-09-29: changes made and open issues |
