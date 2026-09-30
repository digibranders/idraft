# SEO + AI Search Intelligence Platform: Specification Package

Implementation-ready specification for a self-hosted platform that combines Google rank tracking with AI answer-engine visibility tracking (AI Overview, AI Mode, ChatGPT, Gemini), connected through one model of topics, domains, pages, competitors and history. No production code yet; this package is the input to Phase 0 and Phase 1.

Start here: [docs/00-executive-summary.md](docs/00-executive-summary.md) (decisions, costs, MVP scope, final decision summary).

Architecture locked on 2026-09-30: [docs/adr/ADR-022-python-backend-simplified-platform.md](docs/adr/ADR-022-python-backend-simplified-platform.md) (FastAPI backend, self-hosted Next.js, Taskiq on Redis, one droplet) with the diagrams in [docs/diagrams/architecture-locked.html](docs/diagrams/architecture-locked.html). Where a numbered doc and ADR-022 disagree, ADR-022 wins.

| Folder | Content |
|---|---|
| [docs/](docs/) | 32 numbered documents (00 to 31): research findings, requirements, architecture, data model with DDL, provider integrations, methodologies, API, frontend, infrastructure, backups, security, observability, testing, costs, growth, roadmap, risks, checklist |
| [docs/adr/](docs/adr/README.md) | 22 architecture decision records; ADR-022 is the architecture lock |
| [docs/diagrams/](docs/diagrams/README.md) | The locked architecture page (`architecture-locked.html`) and 18 Mermaid diagrams (architecture, ER, sequences, queue and task lifecycles, deployment, backup) |
| [docs/design-system/](docs/design-system/) | The UI design system (28 documents, tokens, ADRs) and its static preview in `apps/web/design-preview` |
| [docs/review-log.md](docs/review-log.md) | Cross-document consistency review: changes made and items deferred to Phase 0 or 1 |
| [research/](research/) | Primary-source research notes (accessed 2026-09-29), every claim labeled VERIFIED, INFERRED or UNVERIFIED, with URLs |
