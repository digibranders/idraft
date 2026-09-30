# 02. Product Requirements

Status: Draft for architecture freeze
Last updated: 2026-09-29
Related: [00-executive-summary.md](00-executive-summary.md), [29-phase-roadmap.md](29-phase-roadmap.md) (phase per requirement), [16-metrics-methodology.md](16-metrics-methodology.md)

## 1. Product statement

One platform that measures how a brand, its domains, pages, keywords, prompts and competitors appear in traditional search results and in AI-generated answers, and connects the two through a shared model of topics, domains, pages, competitors and history:

```
keyword -> SERP ranking -> SERP features -> AI Overview -> AI Mode -> AI prompt
        -> brand mention -> domain citation -> source -> referral -> conversion
```

The product owns its keyword and prompt inventories, taxonomy, normalized observations, history, extraction, scoring, statistics and analysis. It buys commodity collection (SERPs and consumer AI answers) from DataForSEO.

## 2. Users and jobs

| Persona | Primary jobs |
|---|---|
| **SEO lead / agency strategist** | Track rankings daily; explain drops; report visibility and competitor movement; find pages to improve; prove results to clients |
| **Content / GEO lead** | See whether AI answers mention and cite the brand; find sources AI engines rely on; find prompts and topics where competitors win; plan content and outreach |
| **Marketing or brand manager** | Understand share of voice in AI answers and search; track perception (recommendation, sentiment) |
| **Agency account manager / client viewer** | Read-only dashboards and scheduled reports per client project |
| **Workspace admin** | Manage members, integrations, budgets, providers |
| **Platform operator (internal)** | Keep collection healthy, costs within budget, data correct |

## 3. Product areas and requirements

Requirement ids: `SEO-`, `AI-`, `VIS-` (AI visibility intelligence), `X-` (cross-channel), `DISC-`, `FP-`, `PLAT-`, `NFR-`. Phase numbers refer to [29-phase-roadmap.md](29-phase-roadmap.md). "MVP" = Phases 0 to 9 plus 10a.

### 3.1 Traditional SEO keyword tracking (area A)

| Id | Requirement | Phase |
|---|---|---|
| SEO-01 | Track Google organic rank per keyword, location (country to city), language, device, with a stable daily or weekly schedule | 4 |
| SEO-02 | Store organic rank (canonical) and absolute rank; ranking URL, title, snippet for tracked entities | 4 |
| SEO-03 | Preserve full history append-only; depth of each check recorded; ranks beyond depth shown as "not in top N" | 4 |
| SEO-04 | Depth profiles (top 10/20/50/100 daily with weekly top-100 deep checks) chosen per project, group or keyword | 3, 4 |
| SEO-05 | Keyword attributes: tags, topics, clusters, groups (multi-membership), intent, funnel stage, priority, business value, target URL, source, active flag | 3 |
| SEO-06 | Keyword metrics: search volume, monthly history, CPC, competition, keyword difficulty, intent, trend, seasonality; timestamped snapshots | 3 |
| SEO-07 | SERP feature presence and ownership history: AI Overview, featured snippet, PAA, local pack, images, video, news, knowledge panel, shopping, discussions, related searches, sitelinks, ads | 4 |
| SEO-08 | AI Overview per check: presence, own citation and position, competitor citations, cited URLs and domains, text, same-check organic rank | 4 |
| SEO-09 | Competitor ranks for configured competitors from the same SERP; discovered competitors suggested from stored SERPs | 4, 5 |
| SEO-10 | Metrics: current/previous/best/worst/average/median rank, change, top-3/10/20/100 counts, new/lost, volume-weighted and equal-weight visibility, estimated clicks (labeled), SEO SOV, feature ownership, AIO presence and citation rates, volatility, URL stability | 5 |
| SEO-11 | Events: entered/lost top N, new/lost ranking, URL changed, feature gained/lost, AIO appeared/disappeared, AIO citation gained/lost, overtakes | 4 |
| SEO-12 | Alerts on events with digests, dedupe, flapping suppression and anomaly hold | 5 |
| SEO-13 | Landing pages: per owned URL keywords, rank distribution, volume represented, visibility contribution, trend | 5 |
| SEO-14 | Cannibalization detection with evidence and conservative classification | 5 |
| SEO-15 | Import (CSV, bulk paste, API, GSC) with preview and duplicate handling; export (CSV/XLSX) | 3, 5, 11 (GSC) |
| SEO-16 | "Check now" on demand within quota and budget | 4 |
| SEO-17 | Keyword gap vs each competitor | 5 |

### 3.2 AI prompt tracking (area B)

| Id | Requirement | Phase |
|---|---|---|
| AI-01 | Prompt inventory with metadata (topic, intent, funnel, persona, language, country, branded flag, type, source, importance, creation method, tags) | 6 |
| AI-02 | Immutable prompt versions; observations reference versions; version boundaries visible | 6 |
| AI-03 | Core panel (locked, membership history) and discovery panel; promotion flow with criteria | 6 |
| AI-04 | Collect ChatGPT and Gemini consumer-surface answers and Google AI Mode for prompts; AI Overview for keywords | 7 |
| AI-05 | Replicates per engine with a priority subset; scheduled weekly by default | 7 |
| AI-06 | Preserve raw responses, answer text/markdown, citations with positions, retrieved results, fan-out queries, provider metadata, model, versions, cost, latency, errors | 7 |
| AI-07 | Optional official API benchmarks as a separate observation class | 14 |
| AI-08 | Keyword-level AI Mode runs for selected keyword groups | 7 |

### 3.3 AI visibility intelligence (area C)

| Id | Requirement | Phase |
|---|---|---|
| VIS-01 | Brand mention and domain citation as separate facts; four-outcome mix | 8, 9 |
| VIS-02 | Recommendation classification, structured rank (only for ordered lists), mention order, prominence, sentiment distribution | 8, 9 |
| VIS-03 | Metrics per doc 16 with denominators, sample sizes and intervals; prompt-weighted by default | 9 |
| VIS-04 | Breakdowns by topic, intent, engine, country, language, persona | 9 |
| VIS-05 | Competitor SOV and gaps; untracked entity candidates | 8, 9 |
| VIS-06 | Citation intelligence: top domains and pages, source share, diversity, categories, new/lost sources, retrieved-not-cited, publisher opportunities | 9 (basic), 13 |
| VIS-07 | Volatility metrics and detectable period changes | 9, 14 |
| VIS-08 | Evidence viewer with highlighted spans and citations for every observation | 8 |
| VIS-09 | Branded prompts separated from default metrics | 9 |

### 3.4 SEO and AI correlation (area D)

| Id | Requirement | Phase |
|---|---|---|
| X-01 | Many-to-many keyword-prompt links with link type and status | 6, 10a |
| X-02 | Keyword-level channel rows (organic rank, AIO, AI Mode, ChatGPT, Gemini, owned citations, competitor leaders, GSC) | 10a |
| X-03 | SEO/AI matrix with explicit thresholds and drill-down, keyword level | 10a |
| X-04 | AIO citation rate by organic rank bucket | 10a |
| X-05 | Page intelligence joining organic, AIO, AI citations and first-party metrics by URL | 10a, 12 |
| X-06 | Cluster-level matrix, longitudinal association analysis, domain dominance comparison, AI-first opportunities | 10b |
| X-07 | Diagnostics: why losing keyword, why losing prompt (evidence vs hypotheses) | 15 |

### 3.5 Discovery (areas 14, 22)

| Id | Requirement | Phase |
|---|---|---|
| DISC-01 | Keyword discovery inbox from Labs, PAA, autocomplete, related searches, competitors, GSC, fan-out; accept/reject/snooze/promote | 11 |
| DISC-02 | Prompt discovery inbox from keywords (templates, LLM variants), GSC and Bing queries, PAA, uploads, fan-out; near-duplicate detection | 11 |
| DISC-03 | Modeled AI demand displayed only with honest labeling | 11 |

### 3.6 First-party data (area 32)

| Id | Requirement | Phase |
|---|---|---|
| FP-01 | GSC OAuth, 16-month backfill, daily sync; queries and pages matched to keywords and URLs | 12 |
| FP-02 | Import of GSC generative AI and Bing AI Performance exports with provenance | 12 |
| FP-03 | Bing Webmaster query and page stats | 12 |
| FP-04 | GA4 AI referral sessions and key events (Google channel and our classifier side by side) | 12 |
| FP-05 | Cloudflare AI crawler statistics; optional server log ingestion | 12 |

### 3.7 Platform

| Id | Requirement | Phase |
|---|---|---|
| PLAT-01 | Multi-tenant workspaces, projects, memberships, RBAC, API keys, audit logs | 1 |
| PLAT-02 | Budgets, quotas, cost metering per call, cost reporting per project/workload/provider | 1, 5 |
| PLAT-03 | Schedules, runs, task ledger, retries, dead letters, operations screen | 1, 4 |
| PLAT-04 | Backups with restore testing, monitoring and alerting | 1 |
| PLAT-05 | Public API for integrations (read and import) | 1 onward |
| PLAT-06 | Versioning of every measurement-affecting component | 1 onward |

## 4. Non-functional requirements

| Id | Requirement | Target |
|---|---|---|
| NFR-01 | Collection reliability | 98% of scheduled rank checks and 95% of AI tasks ingested within window + 6 hours |
| NFR-02 | Dashboard latency (p95) | overview 300 ms, lists 500 ms, matrix 800 ms on the V1 droplet |
| NFR-03 | Availability (API) | 99.5% monthly (single host; planned maintenance excluded) |
| NFR-04 | Data durability | RPO 24 h (V1), RTO 4 h for full rebuild; PITR (minutes) before external SaaS |
| NFR-05 | Scale without rewrite | 10,000 prompts/week, 100,000+ AI observations/month, tens of thousands of keywords, millions of observations/month via documented scaling steps (doc 28) |
| NFR-06 | Security | Tenant isolation tested in CI; encrypted credentials; 2FA for admins; OWASP ASVS L2 as the review baseline |
| NFR-07 | Cost transparency | Every provider call metered; monthly cost per project reproducible to within 5% of provider invoices |
| NFR-08 | Reproducibility | Any metric value reproducible from stored observations and component versions |
| NFR-09 | Accessibility | WCAG 2.2 AA for the web app |
| NFR-10 | Honesty | No metric without denominator; estimates labeled; no composite AI score; no claims of AI search volume |

## 5. Explicit V1 exclusions

Cloro; custom large-scale browser scraping; proxy networks; CAPTCHA solving; Kubernetes; multiple droplets (V1); managed PostgreSQL or Redis; ClickHouse; a global keyword database; a global prompt database; an opaque "AI visibility score"; automated article or mass GEO content generation; hundreds of engines; Gemini API grounding for bulk measurement (terms).

## 6. Success criteria for MVP

1. Internal team and first clients use the Rank Tracker daily instead of their previous rank tracker for at least 4 weeks.
2. AI visibility reports for at least 3 projects are produced from the platform, with every number traceable to observations.
3. Monthly provider cost per project is within 10% of the forecast in doc 27.
4. No cross-tenant incident; restore drill passes every week.
5. A client question like "we rank 2, are we cited in the AI Overview, and does ChatGPT recommend us?" is answered from one screen.
