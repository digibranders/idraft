# 30. Risks, Legal Considerations and Open Questions

Status: Draft for architecture freeze
Last updated: 2026-09-30
Related: [01-research-findings.md](01-research-findings.md), [29-phase-roadmap.md](29-phase-roadmap.md), [ADR-022](adr/ADR-022-python-backend-simplified-platform.md)

Labels: **Likelihood** and **Impact** are High, Medium, Low. Every risk has a mitigation in the design and a trigger that tells us it is materializing. Retired risks and questions keep their ids so references stay valid; [ADR-022](adr/ADR-022-python-backend-simplified-platform.md) (2026-09-30) retired R-20 and Q-07 and added R-21 to R-23. The Better Auth limitations and the cookie and CORS issues between Vercel and the API, previously tracked in the Phase 0 and Phase 1 risk rows of doc 29, no longer apply: auth is our own module and web and API share one origin.

## 1. Risk register

| Id | Risk | L | I | Mitigation in design | Trigger to watch |
|---|---|---|---|---|---|
| R-01 | **Single collection vendor (DataForSEO)**: outage, price rise, account removal (its terms allow removal without notice) | M | H | Adapter contract; fallback adapters evaluated (Oxylabs or Bright Data for SEO, SearchAPI.io for AI); raw payloads let us re-parse, not re-collect; price book drift check | Error rate > 5% for 24 h; turnaround p95 > 6 h for 3 days; price rise > 30%; account notice |
| R-02 | **Billing differs from documentation** (page pricing, async AIO add-on formula) | H | M | Spike S-01 before budgets are quoted; provider-reported cost recorded per task; daily reconciliation; budgets with hard limits | Reconciliation difference > 10% |
| R-03 | **Google SERP changes** (num=100 removal in 2025, goto redirects in 2026) break parsing or raise per-keyword cost | H | M | Depth profiles; fixture schema hash check in the test suite; redirect unwrap; parser versioning; raw retained for re-parse | Schema hash mismatch on new fixtures; `schema_mismatch` > 0.5%; `unresolved_redirect` rate rise |
| R-04 | **Consumer-surface observations are not representative** (logged-out sessions, country-level location, model routing) | H | M | Honest labeling in UI and exports; `model_reported` stored; version boundaries; official API benchmarks as a second lens | Customer disputes; large divergence between scraper and API samples (S-13) |
| R-05 | **AI answer volatility makes per-prompt metrics noisy**; users over-read single changes | H | M | Replicates for priority subset; intervals; "detectable change" rule; BH filtering; panel-level emphasis | Support questions about "flapping" prompts |
| R-06 | **Replicates not independent** (provider caching or sticky sessions) | M | M | S-05 measurement; replicate spacing; switch budget from replicates to more prompts | Duplicate answer rate > 20% |
| R-07 | **Extraction errors** (ambiguous brand names, recommendation misclassification) distort metrics | M | H | Deterministic stages with evidence spans; gold set merge gates; uncertain state excluded not guessed; LLM adjudication with budget; re-derivation | Gold-set regression; user-reported false mentions |
| R-08 | **Cross-tenant data leak** through an application bug | L | H | Path scoping, repository enforcement, RLS, cross-tenant CI suite, 404 not 403 | Any cross-tenant test failure (blocks merge) |
| R-09 | **Single droplet is a single point of failure** (host failure, disk full) | M | H | Nightly encrypted backups (30-day retention) with a monthly scripted restore drill; DigitalOcean weekly droplet backups; runbook for rebuild; disk alerts at 70/85%; PostgreSQL move trigger defined | Disk > 70%; host degradation notice from DO |
| R-10 | **SERP and first-party raw payloads in R2 have one copy**; accidental deletion or bucket misconfiguration loses re-parse ability | L | M | Lifecycle rules reviewed in code; no second copy in V1 (ADR-022); normalized data is still in PostgreSQL and its backups, so a lost payload costs re-parse ability for the affected range, not the data | Lifecycle rule change; R2 incident |
| R-11 | **Cost blow-up** from misconfigured schedules (for example top 100 daily for 50,000 keywords) | M | H | Pre-flight estimates, budgets (soft/hard), DataForSEO account cost limit as backstop, balance alerts, depth profile defaults | Daily spend > 150% of 7-day average |
| R-12 | **Gemini API terms** restrict caching, analyzing and programmatic collection of grounded results | H (if used) | M | Gemini grounding not used for bulk measurement; legal review before any use; Gemini consumer data comes from the DataForSEO scraper, whose terms question is DataForSEO's relationship with Google | Product request to add Gemini API benchmarks |
| R-13 | **Consumer UI scraping legal climate** (Google v. SerpApi, Reddit suits in 2025 to 2026 involving SERP and AI data vendors) affects vendors | M | M | We buy from vendors rather than scrape; no self-operated browser automation; monitor vendor litigation; keep a second vendor evaluated | Vendor named in new litigation or injunction |
| R-14 | **Google OAuth verification** delays first-party integrations for external customers | M | M | Internal app mode for our own properties; start verification in Phase 11 | Verification rejection |
| R-15 | **First-party AI reports lack APIs** (GSC generative AI, Bing AI Performance) | H | L | File import with provenance; tables ready for APIs | API announcements (then build connectors) |
| R-16 | **Metric misinterpretation** (clients treating estimates as traffic, SOV as market share) | M | M | Labels, denominators, method pages, no composite score, estimates flagged | Client reports quoting metrics incorrectly |
| R-17 | **Team capacity**: MVP scope is about 45.5 engineer-weeks | M | M | Two parallel tracks; MVP cut defined; post-MVP phases independent | Phase slips > 30% |
| R-18 | **PostgreSQL growth beyond droplet disk** earlier than projected (larger payloads, more keywords) | M | M | Growth projections replaced with measurements in S-02/S-09; Volume attach or DB droplet runbook | Projected fill < 6 months |
| R-19 | **Provider adds ads/sponsored content to AI answers** that leak into mentions | M | M | Ads exclusion in normalizer; S-04 checks whether markdown includes ads | Ad text detected in `answer_text` by QA sampler |
| R-20 | Retired 2026-09-30 by ADR-022: BullMQ (and its PostgreSQL backend) is no longer in the stack; see R-21 | | | | |
| R-21 | **Taskiq maturity**: a smaller project than Celery; bugs in retries, the scheduler or the Redis broker could stall work | M | M | Phase 1 smoke test (both queues, retry by error class, worker restart, reconciler after a Redis flush); pin versions; the PostgreSQL task ledger means queue bugs never lose or double paid work; Celery is the documented fallback | Smoke test fails; tasks stuck in `queued` or `submitted` beyond the window; reconciler re-enqueues on most ticks |
| R-22 | **Two toolchains** (Python with uv, ruff and pytest; TypeScript with pnpm) raise CI time and context switching, and the API and web client can drift | M | L | OpenAPI is the only contract; the TypeScript client is generated in CI and committed, so drift fails the build; one CI workflow runs both; Definition of Done names both sets of checks | Generated-client diff failures in CI; deploy from main over 10 minutes |
| R-23 | **Self-hosted Next.js loses preview deployments** that Vercel gave per pull request | H | L | Playwright runs the key flows against the Compose stack in CI; UI review happens on a local Compose stack; one origin means no staging API to keep in sync | Design review regularly needs a running build that CI does not provide |

## 2. Legal and operational considerations

This section records engineering-relevant legal considerations. It is not legal advice; items marked "counsel" require review before external SaaS launch.

| Topic | Position and design consequence |
|---|---|
| **DataForSEO terms** | Terms (updated 12 June 2026, verified) contain no clause against storing, displaying to end users or reselling results; clauses 7.1 and 7.2 prohibit using SERP data to compete with or harm search engines and require indemnity for breaches of search engine terms. Action: written confirmation that multi-tenant display and resale of derived metrics is permitted (Q-03). |
| **Search engine and AI vendor terms (upstream)** | Collection of Google SERPs and consumer AI answers is performed by DataForSEO. We do not operate scrapers, proxies, CAPTCHA solving or browser automation. This limits our exposure but does not eliminate the vendor's (R-13). |
| **Official LLM API terms** | OpenAI, Anthropic, Perplexity, xAI benchmark usage must follow each vendor's terms on storing and displaying outputs; Gemini API grounding terms restrict caching and analysis of grounded results and require displaying Search Suggestions, so Gemini grounding is excluded from bulk measurement (R-12, counsel). |
| **Rank data retention** | Normalized rank data kept indefinitely; raw SERP payloads 400 days (`serp_raw`, doc 23 section 9.2). No upstream term found that requires deletion; revisit if a provider adds one. |
| **Copyright and content retention** | SERP titles and snippets and AI answer text are third-party or machine-generated content. We store them for analysis and show them to the tenant who tracked them, with source links. We do not republish them publicly, build a searchable public corpus, or use them to train models. Excerpts shown in the UI are limited to the tenant's own observations. Counsel review of display practices before external launch. |
| **AI-generated content** | Stored as evidence of what an engine output. Displayed with attribution to the engine and date. Claims extraction (Phase 15) labels claims as "stated by engine", never as facts. |
| **Browser automation and UI scraping** | Out of scope by design (exclusions list). Open-source projects that drive logged-in chat UIs show account-ban and terms risks (`research/06-open-source.md`). |
| **Rate limits** | We stay under 50% of documented provider limits; rate limiting is centralized per provider (doc 21 section 7). |
| **OAuth data handling** | Read-only scopes, encrypted refresh tokens, revocation on disconnect, deletion option for imported data, least-privilege worker access (doc 24 section 6). |
| **User privacy** | Minimal personal data (accounts, audit IPs). GDPR processor role for customer first-party data; DPA template required before external launch; data export and deletion via admin CLI in V1 (doc 24 section 13). |
| **Customer uploads** (support tickets, FAQ lists) | Users are told to remove personal data; uploads retained 30 days; only extracted question text is kept as prompt candidates. |
| **Cloudflare Radar data** | Licensed CC BY-NC 4.0 (verified); internal use only unless Cloudflare grants a commercial license. |
| **Third-party mention datasets** (DataForSEO LLM Mentions) | Shown as a labeled third-party dataset, not as our measurement. |

## 3. Open questions

| Id | Question | Why it matters | How to resolve | Owner / when |
|---|---|---|---|---|
| Q-01 | Is DataForSEO extra-page billing linear or 0.75x on our account, and is the async AIO add-on additive or a whole-task multiplier? | Up to 29% and 20% cost swings | S-01 | Phase 0 |
| Q-02 | Are DataForSEO LLM Scraper sessions logged-out, and how is country location applied? | Representativeness wording, location claims | Vendor question + S-04 observed values | Phase 0 |
| Q-03 | Does DataForSEO confirm in writing that multi-tenant display and resale of derived metrics is permitted? | External SaaS launch | Vendor legal contact | Before external launch |
| Q-04 | Default ChatGPT series: natural or forced web search? | Citation rates, representativeness | S-04 decision rule (doc 07 section 4.2) | Phase 0 |
| Q-05 | Are same-window replicates independent enough to justify their cost? | Replicate budget vs more prompts | S-05 | Phase 0 |
| Q-06 | Real SERP and AI payload sizes after compression | Storage projections, droplet lifetime | S-02, S-04 | Phase 0 |
| Q-07 | Retired 2026-09-30 by ADR-022: auth is our own FastAPI module, and S-07 is dropped | | | |
| Q-08 | What share of SERPs have async-only AI Overviews? | Cost and AIO presence accuracy | S-03 | Phase 0 |
| Q-09 | How often do DataForSEO consumer answers contain ads, and does `markdown` include them? | Mention accuracy | S-04 | Phase 0 |
| Q-10 | Should branded prompts be excluded from SOV as well as from rates? | Metric semantics | Product decision with first users (default: excluded) | Phase 9 |
| Q-11 | CTR curve for mobile and for layouts with AI Overview | Visibility accuracy | Monitor published studies; `ctr_v2` when justified | Phase 14 |
| Q-12 | Will Google or Bing expose generative AI performance via API? | First-party AI metrics automation | Monitor announcements quarterly | ongoing |
| Q-13 | How does GA4's AI Assistant channel treat `utm_source=chatgpt.com` without a medium? | AI referral attribution | S-14 | Phase 12 |
| Q-14 | Is DataForSEO's Perplexity LLM Responses endpoint affected by Perplexity's Sonar deprecation (2026-09-27)? | Benchmark engines | S-13 | Phase 14 |
| Q-15 | Does a local classifier (ONNX) reach the extraction quality targets at acceptable memory cost? | LLM adjudication cost at scale | Phase 14 evaluation | Phase 14 |
| Q-16 | Page performance (per-URL Search Console health): spikes PP-S1 to PP-S3, health thresholds, watchlist scope and size, query history. Questions PP-Q1 to PP-Q5 and risks PP-R1 to PP-R5 are kept in [32-page-performance.md](32-page-performance.md) section 12 | Step 7b feasibility and cost | Spikes in step 7b | Step 7b |

## 4. Hypotheses we will test with data (not assumptions we rely on)

| Hypothesis | Test |
|---|---|
| AI Overview citation probability increases as organic rank improves | AIO citation rate by rank bucket (doc 15 section 5), per intent |
| Pages cited by ChatGPT are frequently not in the organic top 10 | Cited-page organic performance (doc 15) |
| Fan-out queries overlap substantially with tracked keywords for commercial prompts | F3 coverage metric by intent |
| Recommendation rate is more stable than mention rate across weeks | Flip rate comparison by metric |
| Source categories differ systematically by engine | Category mix per engine (doc 14) |
