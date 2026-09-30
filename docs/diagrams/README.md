# Diagrams

Every Mermaid diagram in the documentation package, extracted from its source document (the source document is authoritative; when a source diagram changes, update the copy here). Generated 2026-09-29.

Last updated 2026-09-30: diagrams brought in line with [ADR-022](../adr/ADR-022-python-backend-simplified-platform.md), which wins wherever a source document has not caught up yet.

The locked deployment, paid-call lifecycle and data flow diagrams (architecture locked 2026-09-30) live in [architecture-locked.html](architecture-locked.html) in this folder.

| # | Diagram | Type | Source |
|---|---|---|---|
| 1 | [2. System context](#d1) | Flow | [03-system-architecture.md](../03-system-architecture.md) |
| 2 | [7.1 SEO rank collection](#d2) | Sequence | [03-system-architecture.md](../03-system-architecture.md) |
| 3 | [7.2 AI prompt collection](#d3) | Sequence | [03-system-architecture.md](../03-system-architecture.md) |
| 4 | [7.3 Combined data flow](#d4) | Flow | [03-system-architecture.md](../03-system-architecture.md) |
| 5 | [3. Conceptual model](#d5) | ER | [04-data-model.md](../04-data-model.md) |
| 6 | [4. Task lifecycle](#d6) | State machine | [06-dataforseo-seo-integration.md](../06-dataforseo-seo-integration.md) |
| 7 | [3.3 Import pipeline](#d7) | Flow | [08-seo-keyword-system.md](../08-seo-keyword-system.md) |
| 8 | [5. AI Overview in two contexts, one record](#d8) | Flow | [10-serp-feature-tracking.md](../10-serp-feature-tracking.md) |
| 9 | [2. Pipeline overview](#d9) | Flow | [13-ai-extraction-engine.md](../13-ai-extraction-engine.md) |
| 10 | [5. Source graph](#d10) | Flow | [14-citation-intelligence.md](../14-citation-intelligence.md) |
| 11 | [4.8 Sequence: OAuth connect and backfill](#d11) | Sequence | [18-first-party-integrations.md](../18-first-party-integrations.md) |
| 12 | [5.3 Queue lifecycle](#d12) | Flow | [21-scheduler-workers.md](../21-scheduler-workers.md) |
| 13 | [2. Deployment diagram](#d13) | Flow | [22-infrastructure-devops.md](../22-infrastructure-devops.md) |
| 14 | [8.1 Pipeline overview](#d14) | Flow | [22-infrastructure-devops.md](../22-infrastructure-devops.md) |
| 15 | [4. Backup lifecycle](#d15) | Flow | [23-backup-disaster-recovery.md](../23-backup-disaster-recovery.md) |
| 16 | [1. Summary](#d16) | Timeline | [29-phase-roadmap.md](../29-phase-roadmap.md) |
| 17 | Detailed ER: SEO observation core | ER | [04-data-model.md](../04-data-model.md) |
| 18 | Detailed ER: AI observation core | ER | [04-data-model.md](../04-data-model.md) |

<a id="d1"></a>
## 1. 2. System context

Source: [03-system-architecture.md](../03-system-architecture.md). Type: Flow.

```mermaid
flowchart LR
    user([Analyst / client user]) -->|"HTTPS, one origin,<br/>__Host-session cookie"| caddy

    subgraph droplet[DigitalOcean droplet: Docker Compose]
        caddy[Caddy<br/>TLS + reverse proxy]
        web[web<br/>Next.js standalone]
        api[api<br/>FastAPI, /api/v1]
        worker[worker<br/>Taskiq: collect + process queues,<br/>planner tick, scheduler]
        pg[(PostgreSQL 18)]
        redis[(Redis 8)]
        caddy -->|"/api/*"| api
        caddy -->|everything else| web
        web -->|server components,<br/>Docker network| api
        api --> pg
        api --> redis
        worker --> pg
        worker --> redis
    end

    worker -->|task_post / tasks_ready poll / task_get| d4s[DataForSEO APIs]
    worker -->|optional benchmarks| llm[Official LLM APIs<br/>OpenAI, Gemini, Anthropic,<br/>Perplexity, xAI]
    worker -->|OAuth reads| fp[Google Search Console<br/>Bing Webmaster<br/>GA4 Data API<br/>Cloudflare GraphQL]
    worker -->|PUT/GET objects| r2[(Cloudflare R2<br/>raw payloads)]
    backup[systemd timer<br/>pg_dump + zstd + age] -->|nightly encrypted dump| r2b[(Cloudflare R2<br/>seo-backups/daily/, 30 days)]
    pg --- backup
    worker -->|alerts, digests| mail[Transactional email]
    web -. errors .-> sentry[Sentry]
    api -. errors .-> sentry
    worker -. errors .-> sentry
    backup -. heartbeat .-> hc[Healthchecks.io]
    worker -. planner tick, maintenance heartbeats .-> hc
    uptime[Better Stack<br/>external uptime] -->|HTTPS check| caddy
```

<a id="d2"></a>
## 2. 7.1 SEO rank collection

Source: [03-system-architecture.md](../03-system-architecture.md). Type: Sequence.

```mermaid
sequenceDiagram
    autonumber
    participant S as worker (planner tick + dispatcher)
    participant PG as PostgreSQL
    participant Q as Taskiq (Redis)
    participant WC as worker (collect queue)
    participant D as DataForSEO SERP API
    participant R2 as R2
    participant WP as worker (process queue)

    S->>PG: find due schedules (next_run_at <= now)
    S->>PG: INSERT collection_run + collection_tasks (idempotent), staggered scheduled_for
    S->>PG: budget pre-flight (estimate vs ops.budgets)
    S->>Q: dispatcher enqueues submit_batch jobs (<=100 due tasks each) when scheduled_for arrives (21 section 4)
    Q->>WC: submit_batch
    WC->>PG: check fetch_cache for today's identical fingerprints
    WC->>D: POST task_post (up to 100 tasks, tag=task_id)
    D-->>WC: task ids + cost
    WC->>PG: tasks -> submitted, provider_task_id, cost event
    S->>Q: enqueue poll_ready every 60 s (30 s while a collection window is open)
    Q->>WC: poll_ready
    WC->>D: GET tasks_ready
    D-->>WC: ready task ids + tags
    WC->>Q: enqueue fetch_task (dedupe by provider_task_id)
    Note over S,WC: Sweeper: tasks older than the collection window are fetched directly by id with task_get
    Q->>WC: fetch_task
    WC->>D: GET task_get/advanced/{id}
    D-->>WC: SERP JSON
    WC->>R2: PUT raw/v1/serp_raw/dataforseo/.../sha256.json.zst
    WC->>PG: raw_payloads row, task -> fetched, fetch_cache row
    WC->>Q: enqueue ingest_serp
    Q->>WP: ingest_serp
    WP->>R2: GET payload (or from local tmp if same host just wrote it)
    WP->>PG: txn: serp_snapshot, serp_features, domain_rank_observations,<br/>ai.observations (AI Overview), citations, tracked_keyword_state, serp_current_results
    WP->>Q: enqueue extract_observation (if AIO), rollup_seo_day (debounced), evaluate_alerts (debounced)
```

<a id="d3"></a>
## 3. 7.2 AI prompt collection

Source: [03-system-architecture.md](../03-system-architecture.md). Type: Sequence.

```mermaid
sequenceDiagram
    autonumber
    participant S as worker (planner tick + dispatcher)
    participant PG as PostgreSQL
    participant Q as Taskiq (Redis)
    participant WC as worker (collect queue)
    participant D as DataForSEO AI endpoints
    participant R2 as R2
    participant WP as worker (process queue)

    S->>PG: plan ai_prompt run: prompt_versions in panel(s) x engines x locations x replicates
    S->>Q: enqueue submissions (task-based) or live_call jobs (live-only endpoints), rate-limited
    Q->>WC: submit / live_call
    WC->>D: request (prompt text, location, language, engine params)
    D-->>WC: task id, or full response for live
    WC->>R2: raw payload
    WC->>PG: raw_payloads, task status, cost event
    WC->>Q: ingest_ai
    Q->>WP: ingest_ai
    WP->>PG: ai.observations, ai.citations, ai.fanout_queries, ai.retrieval_results
    WP->>Q: extract_observation
    Q->>WP: extract_observation
    WP->>PG: ai.entity_mentions, ai.observation_facts (derivation_id pinning extractor_version, is_current)
    WP->>Q: rollup_ai_day (debounced per project/date), evaluate_alerts
```

<a id="d4"></a>
## 4. 7.3 Combined data flow

Source: [03-system-architecture.md](../03-system-architecture.md). Type: Flow.

```mermaid
flowchart TB
    subgraph inputs[Configuration]
        KW[Tracked keywords]
        PR[Prompts + panels]
        ENT[Entities, aliases, domains]
        TAX[Taxonomy terms]
        LNK[Keyword to prompt links]
    end
    subgraph collect[Collection]
        SERP[SERP snapshots]
        AIO[AI Overview parsed from SERP]
        AIM[AI Mode observations]
        CUI[ChatGPT / Gemini consumer observations]
        API[Official API benchmark observations]
        FP[GSC / Bing / GA4 / Cloudflare]
    end
    subgraph derive[Derivation]
        RANK[domain_rank_observations]
        FEAT[serp_features]
        CIT[citations]
        MEN[entity_mentions]
        FACT[observation_facts]
    end
    subgraph analytics[Analytics]
        SEOR[SEO rollups + state]
        AIR[AI rollups]
        XCH[SEO x AI matrix]
        PAGE[Page intelligence]
        SRC[Source intelligence]
    end
    KW --> SERP --> RANK & FEAT
    SERP --> AIO --> CIT
    KW --> AIM --> CIT
    PR --> CUI --> CIT
    PR --> API --> CIT
    CUI & AIM & AIO & API --> MEN --> FACT
    ENT --> RANK & FEAT & CIT & MEN
    RANK & FEAT --> SEOR
    FACT & CIT --> AIR
    SEOR & AIR & LNK & TAX --> XCH
    RANK & CIT & FP --> PAGE
    CIT --> SRC
    FP --> XCH
```

<a id="d5"></a>
## 5. 3. Conceptual model

Source: [04-data-model.md](../04-data-model.md). Type: ER.

```mermaid
erDiagram
    WORKSPACE ||--o{ PROJECT : owns
    WORKSPACE ||--o{ MEMBERSHIP : has
    USER ||--o{ MEMBERSHIP : has
    PROJECT ||--o{ PROJECT_DOMAIN : "owned/competitor hosts"
    PROJECT ||--o{ PROJECT_ENTITY : tracks
    ENTITY ||--o{ ENTITY_ALIAS : "matched by"
    ENTITY ||--o{ ENTITY_DOMAIN : "owns"
    DOMAIN ||--o{ URL : contains

    PROJECT ||--o{ TRACKED_KEYWORD : tracks
    KEYWORD ||--o{ TRACKED_KEYWORD : "tracked as"
    KEYWORD ||--o{ KEYWORD_METRIC_SNAPSHOT : "measured by"
    TRACKED_KEYWORD ||--o{ SERP_SNAPSHOT : "observed in"
    SERP_SNAPSHOT ||--o{ SERP_FEATURE : contains
    SERP_SNAPSHOT ||--o{ DOMAIN_RANK_OBSERVATION : "yields rank for"
    SERP_SNAPSHOT |o--o| AI_OBSERVATION : "AI Overview parsed as"

    PROJECT ||--o{ PROMPT : tracks
    PROMPT ||--o{ PROMPT_VERSION : "versioned as"
    PROMPT_PANEL ||--o{ PANEL_MEMBERSHIP : includes
    PROMPT ||--o{ PANEL_MEMBERSHIP : "member of"
    PROMPT_VERSION ||--o{ AI_OBSERVATION : "observed as"
    AI_ENGINE ||--o{ AI_OBSERVATION : produces
    AI_OBSERVATION ||--o{ AI_CITATION : cites
    AI_OBSERVATION ||--o{ AI_FANOUT_QUERY : "searched with"
    AI_OBSERVATION ||--o{ AI_ENTITY_MENTION : mentions
    AI_OBSERVATION ||--o{ AI_OBSERVATION_FACT : "summarized by"
    AI_CITATION }o--|| URL : "points to"

    KEYWORD ||--o{ KEYWORD_PROMPT_LINK : links
    PROMPT ||--o{ KEYWORD_PROMPT_LINK : links
    TAXONOMY_TERM ||--o{ KEYWORD_TERM : classifies
    TAXONOMY_TERM ||--o{ PROMPT_TERM : classifies

    COLLECTION_RUN ||--o{ COLLECTION_TASK : contains
    COLLECTION_TASK ||--o| RAW_PAYLOAD : "stored as"
    COLLECTION_TASK ||--o{ PROVIDER_COST_EVENT : costs
```

<a id="d6"></a>
## 6. 4. Task lifecycle

Source: [06-dataforseo-seo-integration.md](../06-dataforseo-seo-integration.md). Type: State machine.

```mermaid
stateDiagram-v2
    [*] --> pending: planner inserts task
    pending --> submitted: task_post accepted (provider id stored)
    pending --> submit_unknown: task_post outcome unknown (timeout after send)
    submit_unknown --> submitted: tag found by reconciler
    submit_unknown --> pending: tag not matched within 15 min (doc 21 section 6)
    pending --> failed: task_post rejected (invalid_request)
    submitted --> ready: found in tasks_ready (polled every 60 s, 30 s in a window)
    submitted --> ready: older than the window and task_get by id returns result (sweeper)
    ready --> fetched: task_get/advanced ok, raw stored in R2
    ready --> failed: task_get error (retryable)
    fetched --> ingested: normalize + DB write ok
    fetched --> failed: schema_mismatch (raw kept)
    failed --> pending: retry policy allows (new provider task)
    failed --> dead: attempts exhausted
    submitted --> dead: no result after 72h
    ingested --> [*]
```

<a id="d7"></a>
## 7. 3.3 Import pipeline

Source: [08-seo-keyword-system.md](../08-seo-keyword-system.md). Type: Flow.

```mermaid
flowchart LR
    U[Upload CSV / paste / API] --> S[Store file in R2<br/>imports/ prefix]
    S --> P[Parse + validate rows<br/>Pydantic model per row]
    P --> N[Normalize text, resolve location,<br/>expand device=both]
    N --> D[Duplicate analysis]
    D --> PV[Preview: new / duplicate / conflict / invalid counts]
    PV -->|user confirms| W[Write in batches of 1,000<br/>one transaction per batch]
    W --> M[Enqueue keyword_metrics fetch<br/>for new keywords]
    W --> R[Import report downloadable]
```

<a id="d8"></a>
## 8. 5. AI Overview in two contexts, one record

Source: [10-serp-feature-tracking.md](../10-serp-feature-tracking.md). Type: Flow.

```mermaid
flowchart LR
    SNAP[seo.serp_snapshots<br/>has_ai_overview, ai_overview_state] --> FEAT[seo.serp_features<br/>feature_type = ai_overview<br/>source_url_ids, owned_by_project]
    SNAP --> OBS[ai.observations<br/>engine = google_ai_overview<br/>serp_snapshot_id, tracked_keyword_id]
    OBS --> CIT[ai.citations<br/>url_id, domain_role, citation_index]
    OBS --> FACTS[ai.observation_facts<br/>own_mentioned, own_domain_cited]
    SNAP --> DRO[seo.domain_rank_observations<br/>organic_rank, cited_in_ai_overview]
```

<a id="d9"></a>
## 9. 2. Pipeline overview

Source: [13-ai-extraction-engine.md](../13-ai-extraction-engine.md). Type: Flow.

```mermaid
flowchart LR
    IN[Observation<br/>answer_text, markdown,<br/>citations, fan-out] --> S1[1 URL canonicalization]
    S1 --> S2[2 Domain role resolution]
    IN --> S3[3 Document structure<br/>blocks + offsets]
    S3 --> S4[4 Alias matching<br/>Aho-Corasick]
    S4 --> S5[5 Disambiguation rules]
    S3 --> S6[6 Structured list parsing]
    S4 & S6 --> S7[7 Mention assembly<br/>order, prominence, rank]
    S3 --> S8[8 Untracked entity candidates]
    S7 --> S9[9 Recommendation rules]
    S7 --> S10[10 Sentiment rules]
    S5 -->|uncertain| S11[11 LLM adjudication<br/>budgeted, optional]
    S9 -->|ambiguous| S11
    S10 -->|ambiguous| S11
    S2 & S7 & S9 & S10 & S11 --> OUT[entity_mentions<br/>observation_facts]
```

<a id="d10"></a>
## 10. 5. Source graph

Source: [14-citation-intelligence.md](../14-citation-intelligence.md). Type: Flow.

```mermaid
flowchart LR
    P[Prompt / keyword] --> O[Observation<br/>engine, date, replicate]
    O --> C[Citation<br/>index, kind, block]
    C --> U[Page<br/>core.urls]
    U --> D[Domain<br/>core.domains]
    D --> PB[Publisher<br/>core.publishers]
    O --> M[Entity mentions]
    C -. same block .-> M
    U -. ranks for .-> K[Tracked keyword<br/>domain_rank_observations]
    U -. first-party .-> G[GSC page metrics]
    T[Topic terms] --> P
```

<a id="d11"></a>
## 11. 4.8 Sequence: OAuth connect and backfill

Source: [18-first-party-integrations.md](../18-first-party-integrations.md). Type: Sequence.

```mermaid
sequenceDiagram
    autonumber
    actor U as Admin user
    participant W as web (Next.js)
    participant A as api (FastAPI)
    participant R as Redis (Taskiq broker)
    participant G as Google OAuth
    participant S as GSC API
    participant PG as PostgreSQL
    participant WC as worker (collect queue)
    participant R2 as R2
    participant WP as worker (process queue)

    U->>W: Connect Search Console
    W->>A: POST /integrations/gsc/authorize
    A->>R: store state + PKCE verifier (10 min TTL, bound to session and workspace)
    A-->>W: Google authorize URL (webmasters.readonly openid email, offline, consent)
    W->>G: redirect, user consents
    G->>A: GET /oauth/google/callback?code&state
    A->>R: consume state (single use)
    A->>G: exchange code + verifier
    G-->>A: access token, refresh token, id token (sub, email)
    A->>PG: ops.secrets (encrypted refresh token), fp.connections, audit log
    A->>S: GET sites.list
    S-->>A: properties + permission levels
    A-->>W: property picker (pre-selected match, overlap guard)
    U->>W: select properties, confirm 16-month backfill
    W->>A: POST selection
    A->>PG: fp.integrations (backfill pending), ops.schedules gsc_sync
    A->>R: enqueue gsc_backfill_plan (priority 10)
    R->>WC: gsc_backfill_plan
    WC->>S: shape P probe per search type (dataState=final)
    WC->>PG: collection_run + tasks per (type, day): last 28 days first, then oldest to newest
    loop each (type, day) task
        WC->>R: take tokens gsc:project, gsc:user:{sub}, gsc:site:{siteUrl}
        WC->>S: shape A totals, shape C page totals, shape B detail (startRow += 25000 until 0 rows)
        WC->>R2: raw response pages
        WC->>R: enqueue ingest_gsc_day
        R->>WP: ingest_gsc_day
        WP->>PG: one txn: delete day rows, insert A/B/C rows, upsert gsc_queries, advance backfill_state
    end
    alt refresh returns invalid_grant
        WC->>PG: connection + integrations -> reauth_required, pause schedules
        WC->>R: enqueue admin notification
    else quota exceeded
        WC->>PG: task failed, next_attempt_at = now + 15 min
    end
```

<a id="d12"></a>
## 12. 5.3 Queue lifecycle

Source: [21-scheduler-workers.md](../21-scheduler-workers.md). Type: Flow.

```mermaid
flowchart LR
    subgraph PG[PostgreSQL ledger]
      T1[(collection_tasks<br/>pending)]
      T2[(submitted)]
      T3[(ready)]
      T4[(fetched)]
      T5[(ingested)]
      TF[(failed / dead)]
    end
    subgraph R[Redis / Taskiq]
      J1[submit_batch<br/>queue: collect]
      J2[fetch_task<br/>queue: collect]
      J3[ingest_*<br/>queue: process]
      J4[extract / rollup / alerts<br/>queue: process]
    end
    P[Planner tick 60s<br/>in worker, Redis lock] --> T1
    D[Dispatcher tick 15s] -->|due + fair| J1
    T1 -.-> D
    J1 -->|provider accepted| T2
    J1 -->|rejected| TF
    PB[poll_ready: tasks_ready every 60 s,<br/>30 s in a window + id sweeper] --> J2
    T2 -.-> PB
    J2 -->|raw in R2| T4
    J2 -->|error| TF
    T4 --> J3
    J3 --> T5
    J3 -->|schema_mismatch| TF
    T5 --> J4
    TF -->|retry policy| T1
    REC[Reconciler 5 min] -. rebuilds jobs from ledger .-> R
```

<a id="d13"></a>
## 13. 2. Deployment diagram

Source: [22-infrastructure-devops.md](../22-infrastructure-devops.md). Type: Flow.

```mermaid
flowchart TB
    subgraph internet[Internet]
        users([Browsers])
        d4s[DataForSEO APIs]
        gha[GitHub Actions<br/>CI, deploy]
        ghcr[(GHCR<br/>images by digest)]
        betterstack[Better Stack<br/>external uptime]
    end

    users -->|HTTPS, one origin| fw

    subgraph do[DigitalOcean]
        fw{{Cloud Firewall<br/>in: 80, 443 tcp+udp from all<br/>22 from allowlist only or none<br/>ICMP}}
        dobk[(DigitalOcean weekly<br/>droplet backups)]
        subgraph droplet[Droplet s-2vcpu-4gb, Ubuntu 26.04]
            subgraph host[Host services: systemd]
                envfile["/etc/seo-platform/.env<br/>root-owned, mode 0600,<br/>written by deploy workflow"]
                backup[seo-backup.timer 01:30 UTC<br/>pg_dump, zstd, age, rclone]
                hostcheck[seo-hostcheck.timer every 5 min]
                ts[tailscaled]
                uu[unattended-upgrades<br/>reboot window 04:30 UTC]
            end
            subgraph edge[network: edge]
                caddy["caddy :80 :443<br/>/api/* to api, rest to web"]
            end
            subgraph backend[network: backend, internal, no egress]
                web[web<br/>Next.js standalone]
                api[api<br/>FastAPI]
                worker[worker<br/>Taskiq: collect + process,<br/>planner tick, scheduler]
                pg[(postgres 18)]
                redis[(redis 8)]
                mig[migrator, one-off]
            end
        end
    end

    fw --> caddy
    caddy -->|"/api/*"| api
    caddy -->|everything else| web
    web -->|server components| api
    api --> pg & redis
    worker --> pg & redis
    mig --> pg
    envfile -. env_file .-> web & api & worker

    worker -->|egress network: task_post,<br/>tasks_ready poll, task_get| d4s
    worker -->|PUT/GET| r2raw[(R2 seo-raw)]
    backup -->|nightly encrypted stream| r2bak[(R2 seo-backups/daily/<br/>30-day lifecycle)]
    droplet -. weekly snapshot .-> dobk
    gha -->|push by digest| ghcr
    gha -->|SSH over Tailscale| ts
    droplet -->|docker pull by digest| ghcr
    backup & hostcheck & worker -. pings .-> hc[Healthchecks.io]
    web & api & worker -. errors .-> sentry[Sentry]
    betterstack -->|GET /api/healthz| fw
```

<a id="d14"></a>
## 14. 8.1 Pipeline overview

Source: [22-infrastructure-devops.md](../22-infrastructure-devops.md). Type: Flow.

```mermaid
flowchart LR
    pr[Pull request] --> ci[ci.yml<br/>lint, typecheck, unit + integration tests,<br/>migration check, OpenAPI client drift check,<br/>image build no push]
    main[Push to main] --> rel[release.yml: build job<br/>build the three images, push to GHCR,<br/>output digests]
    rel --> dep["deploy job<br/>environment: production<br/>write /etc/seo-platform/.env from environment secrets,<br/>Tailscale join, SSH forced command"]
    dep --> host[deploy.sh on droplet<br/>pull by digest, run migrator,<br/>restart api and worker, then web,<br/>health gates]
    host --> ok{healthy?}
    ok -- yes --> done[record release, Sentry release,<br/>prune old images]
    ok -- no --> rb[rollback to previous tag]
```

<a id="d15"></a>
## 15. 4. Backup lifecycle

Source: [23-backup-disaster-recovery.md](../23-backup-disaster-recovery.md). Type: Flow.

```mermaid
flowchart TB
    subgraph droplet[Droplet]
        timer[seo-backup.timer<br/>01:30 UTC daily]
        svc[seo-backup.service<br/>backup-postgres.sh]
        pg[(postgres container)]
        timer --> svc
        svc -->|docker exec -u postgres<br/>pg_dump -Fc -U backup --snapshot| pg
        pg -->|custom format, zstd| enc[age to one offline recipient pair<br/>public keys only]
        enc --> tee[tee to sha256sum]
        tee -->|rclone rcat| daily
    end

    subgraph r2b[R2 bucket seo-backups]
        daily[daily/<br/>lifecycle: expire after 30 days]
    end

    droplet -. weekly droplet snapshot .-> dobk[(DigitalOcean weekly backups)]
    svc -. start / success / fail with exit code .-> hc[Healthchecks.io]

    subgraph drill[Monthly restore drill, scripted and recorded]
        rv[restore-verify.sh]
        rv -->|read latest dump| daily
        rv --> dec[age -d with offline identity]
        dec --> scratch[(temporary postgres:18 container)]
        scratch --> sanity[sanity SQL vs manifest]
        sanity -. result + duration recorded .-> log[drill record]
    end

    custodians([Offline recipient pair<br/>held by custodians]) -. identity for drill and full DR .-> dec
```

<a id="d16"></a>
## 16. 1. Summary

Source: [29-phase-roadmap.md](../29-phase-roadmap.md). Type: Timeline.

```mermaid
gantt
    dateFormat  YYYY-MM-DD
    title MVP tracks (illustrative start 2026-10-05)
    section Shared
    Phase 0 Validation        :p0, 2026-10-05, 1w
    Phase 1 Foundation        :p1, after p0, 25d
    Phase 2 Entities/Taxonomy :p2, after p1, 2w
    section SEO track
    Phase 3 Keywords          :p3, after p2, 2w
    Phase 4 Rank collection   :p4, after p3, 3w
    Phase 5 SEO analytics     :p5, after p4, 3w
    section AI track
    Phase 6 Prompts           :p6, after p2, 2w
    Phase 7 AI collection     :p7, after p6, 2w
    Phase 8 Extraction        :p8, after p7, 3w
    Phase 9 AI analytics      :p9, after p8, 3w
    section Integration
    Phase 10a Cross-channel   :p10, after p9, 2w
    Hardening + launch        :h, after p10, 1w
```

## 17. Detailed ER: SEO observation core

Source: [04-data-model.md](../04-data-model.md) section 7. Type: ER.

```mermaid
erDiagram
    PROJECTS ||--o{ TRACKED_KEYWORDS : has
    KEYWORDS ||--o{ TRACKED_KEYWORDS : "tracked as"
    KEYWORDS ||--o{ KEYWORD_METRIC_SNAPSHOTS : "measured by"
    TRACKED_KEYWORDS ||--o{ TRACKED_KEYWORD_CONFIG_HISTORY : versions
    TRACKED_KEYWORDS ||--o{ KEYWORD_GROUP_MEMBERS : "in"
    KEYWORD_GROUPS ||--o{ KEYWORD_GROUP_MEMBERS : contains
    TRACKED_KEYWORDS ||--o{ TRACKED_KEYWORD_TERMS : "classified by"
    TRACKED_KEYWORDS ||--|| TRACKED_KEYWORD_STATE : "current state"
    TRACKED_KEYWORDS ||--o{ SERP_SNAPSHOTS : "checked in"
    SERP_SNAPSHOTS ||--o{ SERP_FEATURES : contains
    SERP_SNAPSHOTS ||--o{ DOMAIN_RANK_OBSERVATIONS : "ranks per entity"
    SERP_SNAPSHOTS ||--o{ RANK_EVENTS : triggers
    SERP_SNAPSHOTS }o--|| RAW_PAYLOADS : "raw in R2"
    ENTITIES ||--o{ DOMAIN_RANK_OBSERVATIONS : "own or competitor"
    URLS ||--o{ DOMAIN_RANK_OBSERVATIONS : "ranking url"
    DOMAINS ||--o{ URLS : contains
    COLLECTION_TASKS ||--o| SERP_SNAPSHOTS : produces

    SERP_SNAPSHOTS {
        bigint id PK
        timestamptz observed_at PK
        uuid tracked_keyword_id
        smallint depth_requested
        bigint_array organic_url_ids
        boolean has_ai_overview
        bigint raw_payload_id
        smallint parser_version
    }
    DOMAIN_RANK_OBSERVATIONS {
        uuid tracked_keyword_id PK
        uuid entity_id PK
        timestamptz observed_at PK
        smallint organic_rank
        smallint absolute_rank
        bigint ranking_url_id
        boolean cited_in_ai_overview
        smallint depth_requested
    }
```

## 18. Detailed ER: AI observation core

Source: [04-data-model.md](../04-data-model.md) section 8. Type: ER.

```mermaid
erDiagram
    PROJECTS ||--o{ PROMPTS : has
    PROMPTS ||--o{ PROMPT_VERSIONS : "versioned as"
    PROMPT_PANELS ||--o{ PANEL_MEMBERSHIPS : "membership history"
    PROMPTS ||--o{ PANEL_MEMBERSHIPS : "member of"
    PROMPTS ||--o{ PROMPT_TERMS : "classified by"
    PROMPT_VERSIONS ||--o{ OBSERVATIONS : "observed as"
    SERP_SNAPSHOTS ||--o| OBSERVATIONS : "AI Overview"
    ENGINES ||--o{ OBSERVATIONS : produces
    OBSERVATIONS ||--o{ CITATIONS : cites
    OBSERVATIONS ||--o{ FANOUT_QUERIES : "searched with"
    OBSERVATIONS ||--o{ RETRIEVAL_RESULTS : retrieved
    OBSERVATIONS ||--o{ ENTITY_MENTIONS : mentions
    OBSERVATIONS ||--o{ OBSERVATION_FACTS : "facts per derivation"
    DERIVATIONS ||--o{ ENTITY_MENTIONS : pins
    DERIVATIONS ||--o{ OBSERVATION_FACTS : pins
    CITATIONS }o--|| URLS : "points to"
    KEYWORDS ||--o{ KEYWORD_PROMPT_LINKS : links
    PROMPTS ||--o{ KEYWORD_PROMPT_LINKS : links

    OBSERVATIONS {
        bigint id PK
        timestamptz observed_at PK
        text engine_code
        text observation_class
        uuid prompt_version_id
        bigint serp_snapshot_id
        smallint replicate_index
        text answer_text
        text model_reported
        bigint raw_payload_id
    }
    OBSERVATION_FACTS {
        bigint observation_id PK
        integer derivation_id PK
        boolean own_mentioned
        boolean own_domain_cited
        boolean own_recommended
        smallint own_structured_rank
        numeric own_prominence
        boolean is_valid
        boolean is_current
    }
```
