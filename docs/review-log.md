# Review Log: Consistency Pass of 2026-09-29

Status: Complete for this pass
Scope: docs 00 to 31, `adr/*.md`. Research files in `research/` were read as the source of truth and not edited.
Method: the fixed decisions listed below were applied first. Then every doc was swept for conflicting numbers, names, enums, cross-references, dashes and marketing words. All edits are small in-place replacements; no document was rewritten.

## Fixed decisions applied

| Decision | Canonical source |
|---|---|
| Canonical data model; companion tables listed in 04 section 15 | 04 |
| Monitoring: Grafana Alloy host service (cap 128 MB), Grafana Cloud free, Sentry, Healthchecks.io, Better Stack, SQL ops checks; Beszel only as fallback | 25, ADR-021 |
| Secrets as tmpfs files mounted through Compose `secrets:` | 22 section 7 |
| Caddy: IP allowlist and body caps. API: rate limiting in Redis | 22 section 4.5 |
| Logs: size-based Docker rotation, about 14 days at expected volume, size-capped | 22 section 5.3 |
| Raw keys `raw/v1/<retention_class>/<provider>/<endpoint_slug>/<yyyy>/<mm>/<dd>/<sha256>.json.zst` | 23 section 9.1 |
| Restore test off-server with a dedicated `restore-test` age identity; server holds public recipients only | 23 section 5 |
| Scaling steps numbered as in 03 section 10 (1, 1b, 2, 3, 4, 5); trigger values from 28 section 7 and 8 | 28 |
| Engine code `perplexity_api`; one engine list | 04 section 8.1 |
| One workload list with a mapping table | 04 section 11.4.1 |
| API JSON is snake_case | 03, 19 |
| MVP = Phases 0 to 9 plus 10a | 29 |

## Changes made

| Doc | Section | Change | Reason |
|---|---|---|---|
| 00 | 6.3 | Calendar length now about 22 weeks including Phase 0 (about 19 after) | The doc 29 chart adds up to 22 weeks; old text said 18 to 20 |
| 00 | 7 | Removed link to empty `diagrams/` folder; added link to this log | Broken link |
| 01 | 2.4 | `poll_ready` every 2 minutes; limiter at 1,000 calls per minute (50% of 2,000) | Matched 06 section 3.2, 21 sections 5.2 and 7, ADR-018 |
| 01 | 3.3 | ChatGPT engine set: natural or forced search per S-04 rule, pingback plus polling | Conflicted with 07 section 4.2 and ADR-018 (no postback) |
| 01 | 3.3, 4.2 | Stale "add it" notes now state that `ai.engines.exposes_fanout` and provider `searchapi` exist | Already in 04 |
| 01 | 6.2, 11 | First-party upload and GSC property targets point to the dedicated `fp` tables of doc 18 | `fp.metric_observations` was superseded by doc 18 |
| 01 | 7.2 | Extraction versioning described through `derivation_id` | Matched 04 section 8.5 |
| 01 | 10.2 | Sampling plan: R = 1 for all core prompts, R = 3 on ChatGPT and Gemini for up to 100 priority prompts | Matched ADR-010, 07 section 4.2, 17 section 7.3 |
| 01 | 12 | S-08 limiter 1,000 per minute; S-09 targets from NFR-02; added S-15 and S-16 rows pointing to 06 and 07 | Single spike index S-01 to S-16; old values conflicted with 21 and 02 |
| 02 | 3 | SEO-15 phases include 11 (GSC import); SEO-16 "Check now" moved to Phase 4 | Matched 08 section 3.1 and 29 Phase 4 |
| 03 | 4 | `systemd/` lists backup, secrets, host-check, container-stats and Alloy units; restore test runs in GitHub Actions | Fixed decision: restore test off-server |
| 03 | 6 | Limiter 1,000 calls per minute; job names `classify_batch`, `rederive_range` | Matched 06, 21 |
| 03 | 7.1, 7.2 | Raw key shows class path; poll interval 2 min; dispatcher enqueues `submit_batch`; derivation wording | Fixed decision and 21 section 4 |
| 03 | 8 | Config row: non-secret env, secrets as tmpfs Compose secrets; deterministic BullMQ job ids per task | Fixed decision; 21 section 5.2 |
| 03 | 10 | Reference to 28 sections 7 and 8; step 1 triggers from 28; step 1b added; step 3 and 4 triggers from 28 | Scaling consistency |
| 04 | 2 | Extensions paragraph: V1 uses stock `postgres:18`; the PITR phase introduces a custom image with pgBackRest | Fixed decision |
| 04 | 4 | Additional Better Auth fields: `auth.users.is_platform_operator`, `auth.memberships.project_ids`, `auth.invitations.project_ids`, `auth.api_keys` columns (scopes, expiry, IP allowlist, rate limit, `last_used_ip`, `revoked_at`), `auth.workspaces.purge_after`; roles reference corrected to 24 section 3.1 | Required by 19 section 8 items 2 and 3, 24 |
| 04 | 4 | `core.projects`: `data_version bigint`, `entity_config_version integer`; `default_location_code` renamed `default_location_id` | 19 section 8 item 4; 19 uses `default_location_id` |
| 04 | 4.1, 11.2, 11.4 | Workload CHECKs: budgets add `extraction_llm`; schedules add `ai_benchmark`; runs and tasks get the task workload CHECK; cost events get a 14-value CHECK (`ai_mode` replaced by `ai_mode_keyword`) | Fixed decision: one workload list |
| 04 | 11.4.1 (new) | Mapping table: task workload to cost workload to budget group | Fixed decision |
| 04 | 7.1 | New view `core.keyword_weights` | Used in 09 section 6.5 SQL but undefined |
| 04 | 7.2, 7.4 | Cross-reference to 06 section 7.2; feature code `twitter` renamed `social_posts` | Broken reference; matched 06 section 5.4 |
| 04 | 7.6 | `seo.tracked_keyword_state`: `target_url_match`, `aio_state`, `aio_citation_position`, `aio_observation_id`, `current_depth_requested` | 19 section 8 item 11; 09 section 2 |
| 04 | 8.1 | `perplexity_sonar` renamed `perplexity_api` | Fixed decision |
| 04 | 8.2 | `ai.prompts.source` adds `llm_mentions` | 11 section 5.1 lists that source |
| 04 | 8.4 | `ai.citations.flags text[]` | Flags used in 14 sections 3.2 and 9 had no column |
| 04 | 8.5 | `ai.entity_mentions`: `mention_status` (accepted, uncertain), `structured_list_index`, match method `via_product` | 13 principle 4 and stages 4 to 6 needed them |
| 04 | 5.2 | `supports` comment says surfaces, not workloads | Avoided a second meaning of "workload" |
| 04 | 11.1 | `ops.secrets.kind` adds `webhook_signing_secret` | Needed by `ops.webhook_endpoints` |
| 04 | 11.2 | `ops.collection_runs`: `status_reason`, `blocked_by_budget_id`, `created_by_type`, `created_by_id`, `origin_request_id`; `ops.collection_tasks`: `ready_source`, `result_meta`, subject type `seed_set`; idempotency key comment matches 21 section 3.4; reference fixed to 21 section 3.4 | 19 section 8 item 12, 21, 25 section 13 |
| 04 | 11.3 | `object_key` example uses the class-first key scheme | Fixed decision |
| 04 | 11.5 | `ops.alert_rules.channels` uses `webhook`, new `destinations`; new tables `ops.alert_digests`, `ops.webhook_endpoints`, `ops.webhook_deliveries` (partitioned, 3-month retention) | 19 section 8 item 8, 19 section 5 |
| 04 | 11.8 (new) | DDL for `ops.idempotency_keys`, `ops.jobs`, `ops.exports`, `seo.keyword_imports`, `seo.keyword_import_rows`, `ops.maintenance_windows` | 19 section 8 items 5 to 7; 25 section 7.3 |
| 04 | 12.1, 15 | Partition row for webhook deliveries; pruning note; section 15 adds `ops.platform_alerts`, `ops.quality_counters_daily`, points keyword imports to 11.8, notes `snoozed_until` | Completeness of the canonical model |
| 05 | 4 | Platform credentials described as SOPS secrets rendered to tmpfs Compose secrets | Fixed decision |
| 06 | 2.2, 3.2 | Arithmetic: 94.7 pages; 28 calls per minute is 1.4% of the account limit | Matched 27 section 3.1; arithmetic error |
| 06 | 4 | Lifecycle diagram adds `submit_unknown`; submission goes through the dispatcher | Matched 04, 21 sections 4 and 6 |
| 06 | 4.3 | Raw key uses `serp_raw` class path; local spool is the `spool` volume capped at 5 GiB | Fixed decision; matched 22 sections 4.1 and 9.5 |
| 06 | 5.4 | Unknown feature types are inserted into the registry as `other:<type>` | 04 foreign key would otherwise reject them |
| 06 | 6.1 | Reconciliation writes provider-reported adjustment rows, not a `reconciliation` event type | Value was not allowed by 04 |
| 06 | 8, 9, 11 | "surfaces" wording; 50301 retries per 21 section 6 (max 4); S-01 method points to doc 01 | Matched 04, 21, 01 |
| 07 | 1 | Engine table adds `xai_api_search` and the inactive consumer codes; Copilot note no longer invents a code | Engine list identical to 04 |
| 07 | 4.1, 4.2, 6, 12 | Replicate stagger uses 21 section 3.3; S-04 uses 200 prompts; raw key uses `ai_raw` class path | Matched 21, 01, 23 |
| 08 | 1, 3.3, 5 | Table name `seo.keyword_metrics_current`; `case_sensitive` noted as a Phase 5 schema change; `snoozed_until` column | Name did not exist; 19 section 8 item 10 |
| 09 | 3 | Top-50 counts use checks at depth 50 or more | Deep profile runs depth-50 daily checks |
| 11 | 1, 5.2, 11 | Device lives in `ai.project_engines.provider_params`; `snoozed_until` column; prompt limit follows the 1,000 workspace quota | Matched 04; 19 section 8 item 10 |
| 12 | 4, 6 | Engine code list added; first-party `source` enum and `dataState` aligned with 04 and 18 | Fixed decision; stale enum |
| 13 | 3, stages 1, 5, 6, 9 | `entity_config_version` is a column (section 6 reference fixed); tracking parameters defer to 14 section 3.1; list index stored in `structured_list_index`; mention rows include uncertain status; Recommendation Rate denominator matches 16 A5 and A6 | Broken reference and conflicts with 04, 14, 16 |
| 15 | 6 | Page intelligence join: domain rollup joined on `domain_id`, not `url_id` | Table has no `url_id` |
| 16 | 2, 2.1 (new) | `MetricValue` shown in snake_case wire format, identical to 19 section 2.6 (camelCase only inside TypeScript), with optional fields and prompt-weighted numerator rule; registry keys for SEO, fan-out, volatility, surface presence and first-party metrics | Fixed decision; 19 section 8 item 15 |
| 16 | 5, 7, 12 | Research reference to section 4.3; C6 lost-sources rule matches 14 section 8; "weak organic, strong AI" uses 15 section 4.1 thresholds | Conflicts with 14, 15, research 07 |
| 17 | 4.3, 7.3, 8.2, 10 | Bootstrap B = 1,000 interactive, 2,000 exports; priority subset 1 replicate on AI Mode; "easier to act on"; rank-change coloring uses ranked checks and the accessible palette | Matched 17 section 5, 07, 11, 20; marketing word |
| 18 | 3.3, 4.7, 11.2, 12.1, 12.2, 14 | Raw key class path; `first_party_raw` 90 days (was 35); first-party calls write zero-cost events; question candidates go to `ai.prompt_candidates`; GSC keyword suggestions go to the keyword inbox; `credential_ref` nullable after disconnect; amendments marked applied | Fixed decisions; conflicts with 23 section 9.2, 04 section 11.4.1, 24 section 6 |
| 19 | 2.6 | Optional fields marked as also in doc 16 | 16 now matches |
| 19 | 2.13 | Permission list is the full doc 24 matrix; `platform_operator` pseudo-permission; stale scope mapping removed | Permission alignment |
| 19 | 3.x | `ops:manage` replaced by `ops:read` (reads) and `tasks:requeue` (requeue, retry); imports and candidate uploads use `imports:write`; alert acknowledge uses `alerts:write`; admin routes use `platform_operator` | Keys must exist in 24 section 3.2 |
| 19 | 3.2.5, 3.11 | Engine code list added; `Budget` and `ScheduleInput` unions use the canonical workloads; `Task` adds `submit_unknown` and `seed_set`; requeue note updated | Fixed decisions; 04, 21 |
| 19 | 3.7.9 | Fan-out, surface presence and volatility keys now registered in 16 section 2.1 | Were "proposed" |
| 19 | 8 | Items 1 to 8 and 10 to 18 marked resolved with pointers; item 9 narrowed to what is still open | Reflects this pass |
| 20 | 1, 3.5, 3.7, 4.x | snake_case metric fields; `MetricComparison` from 19 replaces `MetricChange`; doc 19 paths take precedence; 200-row cursor pages; `Retry-After` polling; `data_version` from `GET {P}`; `fresh_session_required` and `two_factor_enrollment_required` errors; SEO rank-change coloring per 17 section 10 | Conflicts with 19, 17 |
| 20 | 5.x | Permissions `taxonomy:write`, `api_keys:manage`, `workspace:update`, `imports:write`, `alerts:write`, `views:write`, `tasks:requeue`; discovery viewable with `data:read`; panel unlock with `panels:core:modify`; run triggers and provider status match 19; requeue route under the workspace path | Permission and route alignment |
| 20 | 5.x, 6, 10 | Phases: Keyword Detail 4, 5, 10a; Page Intelligence and matrix 10a or 10b; diagnostics 15; panel sizing and AI BH movers 9; costs unit and forecast 4; onboarding step 7 Phase 3; phase table split into 10a (MVP) and 10b | Matched 19 section 7 and 29 |
| 20 | 11 | Gap table G1, G3 to G6, G8, G11, G12 updated to resolved or narrowed | Stale gaps |
| 21 | 2 | First-party windows match 18 section 13; discovery subject `seed_set` | Conflict with 18; CHECK in 04 |
| 21 | 4, 5.2, 6, 10, 12, 13 | Priority read from the schedule; first-party ingest job names; `derivationId` in payload; requeue route under workspace path with `tasks:requeue`; `r2_config_audit` and first-party platform jobs listed; grace periods match 22; AI task volume about 3,400 per week | Conflicts with 18, 19, 22, 23, 27 |
| 22 | 1, 2, 3.1, 4.1, 5.3, 6.2, 6.6, 7.1, 9.1, 9.2, 10.2, 12.4, 12.8, 13 | Beszel replaced by Alloy host service (RAM 70 to 100 MB, cap 128 MB; RSS sum 2.6 to 3.5 GB); loopback metrics ports (api range 9460-9461); app log rotation 50 MB x 8 with service label; Alloy secret bundle; bootstrap installs Alloy and container-stats timer; Beszel kept as fallback | Fixed decision (monitoring, log retention) |
| 22 | 4.5 | Caddy comment: 2-minute poll | Matched 06, 21 |
| 22 | 8.3 | Deploy script: pre-migration backup for `-- requires-backup`, maintenance window, `bootstrap` mode for disaster recovery | Relied on by 23 sections 11 and 13.1 and 25 section 7.3 |
| 22 | 9.3 | `ops_health` runs in `worker-process`; staleness rule from 21 section 9 | Conflicts with 21 |
| 22 | 11 | Scaling table uses 03 numbering and 28 values; host-only urgent signals labelled | Fixed decision |
| 22 | 9.2 | Healthchecks count points to 25 section 12 | Three docs gave different counts |
| 23 | 2, 9.1, 9.2, 15, 17 | Raw lock text matches 9.4 (7 days all raw, 30 days `ai_raw`); `canary/v1/` lifecycle rule; stale concerns marked resolved; check names | Internal contradiction; 26 canary |
| 23 | 6.2, 6.3 | Backup script writes the Alloy textfile timestamp; unit may write `/var/lib/alloy/textfile` | 25 metric could not be written under `ProtectSystem=strict` |
| 23 | 8.2, 10, 13.3 | Task status sets include `submit_unknown`; reconcile clears `dispatched_at`; job ids per 21 section 5.2; pgBackRest differential Monday to Saturday | Conflicts with 04, 21; Sunday schedule clash |
| 24 | 1.1, 2.1, 2.2 | Platform secret location; CORS `x-request-id`; API key scopes use matrix keys | Consistency with 22, 25, 3.2 |
| 24 | 3.1, 3.2 | Platform operator flag described (04 column, `/v1/admin/*`, `platform_operator`); matrix adds `workspace:update`, `taxonomy:write`, `tasks:requeue`, `fp:logs:write`; clarified `alerts:write` and `ops:read` scope | Every key used in 19 and 20 now in the matrix |
| 24 | 5.1 | tmpfs Compose secrets instead of `env_file`; backup identities (`recovery`, `restore-test`) with storage, rotation, public-recipients-only server | Fixed decisions |
| 24 | 7.4, 8 | Pingback: Caddy allowlist, GET only, 1 KB cap; API rate limit in Redis; budget reference to 27 section 10.3 | Fixed decision; broken reference |
| 24 | 9, 11 | Loopback metrics ports; Redis ACL wording; pg-tunnel port 15432; redaction of pingback token and OAuth `code`/`state`; log retention "about 14 days at expected volume, size-capped" plus 14 days in Grafana Cloud | Fixed decision; 22, 25 |
| 25 | 2.1, 4.1, 4.3, 4.4, 5.3, 6, 8.1, 11, 12, 13 | Uptime check on `/healthz`; metrics ports; partition runway replaces default partitions; restore drill metric removed from textfile; `max_connections` 60; backup and restore alert severities from 23; database `seo`; unit `seo-backup.service`; Redis ACL command; admin API `/v1/admin/*`; requeue route; Healthchecks list 20 of 20 including `raw-replica` and `host-health`; section 13 rows marked done | Conflicts with 04, 22, 23, 19 |
| 26 | 3.3, 5, 8.2, 12 | Canary payloads under `canary/v1/` with a 30-day rule; RTY-04 uses `submit_unknown`; restore drill runs in GitHub Actions with 30 h freshness; section references; stale gap rows marked done | Conflicts with 23, 21 |
| 27 | 7, 10 | R2 steady state uses 400-day `serp_raw`; workload list and budget groups from 04 section 11.4.1 | Fixed decisions |
| 28 | 2.3, 3, 4, 7, 9 | Scenario letter note; `serp_raw` 400 days, `serp_raw_deep` removed; steps renumbered to 03 numbering and declared canonical; Redis cache uses `cache:` prefix | Fixed decisions; 22 section 4.3 |
| 29 | header, 1, 1 (Phase 5, 14) | Spike index; calendar length 22 weeks; typed client from contracts; custom webhooks signed (Slack incoming is not); Phase 14 extends Phase 9 BH and sizing | Conflicts with 01, 19, 20 |
| 30 | 2, R-10 | Raw SERP retention 400 days; only SERP and first-party raw have one copy; AI replica is decided | Matched 23 |
| 31 | Phase 0 | Spike reference points to 01 section 12 | Index now complete |
| ADR-004 | Decision, Consequences | Class-first keys and per-class retention; AI replica | Fixed decision |
| ADR-013 | Decision, Consequences, Revisit | Public recipients only on the server; `recovery` and `restore-test` identities with storage and rotation; custom image for pgBackRest; revisit trigger matches 23 section 13.2 | Fixed decision; old trigger conflicted with 22 and 23 |
| ADR-021 | Decision | Alloy runs as a host service without the Docker socket; Beszel fallback; checks run as scheduled SQL jobs | Fixed decision |

Final checks: a search of all docs for em-dash and en-dash characters returns zero hits, and none of the banned marketing words appear. A scan of 1,168 "doc NN section X.Y" references found none pointing to a missing section (the only hits were references to research files). All local Markdown links resolve.

## Unresolved issues

| # | Doc(s) | Issue | Recommendation |
|---|---|---|---|
| U1 | 20 section 5 | Many "Data:" lines still use indicative paths written before doc 19 (for example `.../overview/seo` for `{P}/seo/metrics/overview`, `/history` for `/rank-history`, `PATCH .../keyword-candidates` for `POST {P}/keyword-candidates/decide`, `costs/unit` for `costs/unit-costs`, `.../digests` for `{P}/alert-digests`, `topics/tree` with no equivalent). A precedence note (doc 19 wins) was added. | Replace each "Data:" line with the doc 19 path during the Phase 1 frontend contract review. |
| U2 | 19, 20 | Doc 20 needs endpoints doc 19 lacks: saved views CRUD (`core.saved_views` exists), `POST .../estimates`, `GET .../costs/reconciliation`, `POST .../alert-rules/preview`, batch alias dry-run; `/v1/me` lacks project slugs and `features`. | Add `{P}/saved-views` CRUD at Phase 5 with `views:write`; decide on the others; regenerate the doc 19 section 7 counts. |
| U3 | 00, 22, 23, 27 | Fixed infrastructure cost: 27 and 00 say $24 to $27 per month (R2 $0 to $3); 22 and 23 section 14.4 say R2 $1.40 to $6 at month 12 ($25 to $30 total). 27 section 7 says backups stay under 10 GB, while 23 section 14.2 shows tens of GB under GFS (34 dumps). | Recompute 27 sections 2, 7, 8 and 00 section 4 from 23 section 14 after spikes S-02 and S-09. Not changed now because scenario totals depend on it. |
| U4 | 22, 23 vs 27, 28 | Planning scenarios A, B, C mean different workloads (4 engines x 3 replicates in 22 and 23; V1 default design in 27 and 28). A note was added to 28. | Rename one set (for example S1 to S3 in 22 and 23). |
| U5 | 28 section 2.3, 22 section 9.5 | 28 says about 50 GB usable for PostgreSQL; 22 budgets about 40 GiB before the critical disk alert. Not contradictory in intent, but confusing. | Have 28 section 2.3 cite 22 section 9.5 and use 40 GB. |
| U6 | 04 section 15 and companions | Tables listed as canonical without DDL: `ops.task_attempts`, `seo.cannibalization_flags`, `seo.daily_page_metrics`, `ai.citation_entity_links`, `core.workspace_domain_categories`, `ai.external_mention_snapshots`, `ops.data_quality_flags`; also `core.url_remap` and `ops.backfill_progress` are named in 04 prose but not specified. | Write DDL before the Phase 0 schema freeze. |
| U7 | 04, 13, 19 | `ai.entity_candidates` has no surrogate id; the API addresses candidates by `normalized_name`. | Add `id uuid` or document the natural key in 19. |
| U8 | 15, 16 | `core.xch_keyword_weekly` has no recommendation columns although 15 lets the AI axis switch to recommendation rate; 16 section 12 lists "organic top-10 keywords with zero AI visibility", which 15 does not define. | Add the two columns; define or drop the 16 row. |
| U9 | 14, 16 section 13.4 | `ai.daily_domain_citations.prompts` and `url_count` are daily distinct counts that cannot be summed over windows; topic filters cannot be served from that rollup. 16 section 5 needs per-observation untracked-name counts that `ai.entity_candidates` does not keep. | Mark the columns daily-only; serve window distinct counts and topic filters from `ai.citations`; add an untracked count to `ai.observation_facts` in Phase 13. |
| U10 | 06, 07, 21 | LLM Responses standard tasks can take up to 72 hours, the same as the 72-hour dead-letter rule. | Use an endpoint-specific dead-letter age (for example 76 hours) for LLM Responses. |
| U11 | 11, 04 | 11 section 2 says restoring a prompt creates no version row, but 04 keeps `change_kind = 'restore'`. | Pick one rule. |
| U12 | 13, 14, 19 | Where the monthly LLM adjudication cap lives (budget group `extraction_llm` or `classifier_budget_usd_month` in project settings), and which workload pays for LLM domain classification (14 section 4). | Use the `extraction_llm` budget group; record domain classification as `extraction_llm` platform overhead. |
| U13 | 22, 25 | The unattended-upgrade reboot at 04:30 UTC (22 section 6.3) has no maintenance window, so it can fire P1 alert 1. | Open a standing weekly window or skip reboots outside the monthly window. |
| U14 | 23, 25 | 23 section 15 defines alerts for spool size, raw replica and R2 lifecycle or lock drift that have no rows in the 25 section 6 alert catalog. | Add three rows to 25 section 6. |
| U15 | 19, 25 | Platform alert acknowledgement (`POST /v1/ops/alerts/{id}/ack` in 25 section 7.4) has no route in 19. | Add a `/v1/admin/platform-alerts` route set to 19. |
| U16 | 01, 06, 07, 30 | Spike sample sizes: 06 adds a depth-20 sample to S-01; S-13 and S-14 are listed as Phase 0 in 01 but resolve questions in Phases 12 and 14 in 30. | Keep 01 section 12 as the only definition; mark S-13 and S-14 optional in Phase 0. |
| U17 | 22, 24, 31 | SSH exposure: 22 section 6.1 removes the port 22 rule in steady state (Tailscale only); 24 section 9 and 31 still describe port 22 from an allowlist. | Adopt 22 and update 24 section 9 and 31. |
| U18 | 19 section 8 | Open items 19 to 22: `ProjectSettingsV1` fields, archive versus delete, Better Auth route surface (S-07), keyword metrics source fallback order. | Decide in Phase 0. |
| U19 | 20 section 11 | Open gaps G3 (CSP `img-src` proposal), G7 (evidence block offsets), G9 (alert rule preview), G10 (Vercel preview suffix). | Decide in Phase 1. |
| U20 | 05, 07, 27 | Official API cost multiple: 05 section 6 says 10x to 100x, 27 section 4.3 says 10x to 25x, 07 section 7.2 says about 25x (examples $0.007 to $0.55 per call). | Replace with one range after spike S-16. |
| U21 | 17, 26 section 12 | 26 reports that the 17 section 7.2 example numbers (785 prompts, 11 points) do not match the formula (782.5, about 9.8) and that 17 references to 16 sections 5 and 6 are swapped. Not verified in this pass. | Check and correct in 17. |
| U22 | 16, 18, 19 | Metric key style: `fp_gsc_clicks` uses underscores while `ai.*` and `seo.*` keys use dots. | Rename to `fp.gsc_clicks` style before the API freeze. |
| U23 | 23, 25 | Healthchecks uses all 20 free checks; the pgBackRest checks need the Business plan ($20 per month) or merged checks. | Decide when pgBackRest is triggered. |
| U24 | 19 | `{P}/pages/insights` kind `third_party_influential_not_ranking` ships in 10a but third-party pages are Phase 13 elsewhere; `send-to-inbox` (10b) writes `ai.prompt_candidates`, a Phase 11 table. | Gate the kind to Phase 13; note the dependency. |
| U25 | 12, 04 | Replacement key wording: 12 section 7 says "(integration, date, dimensions)", 04 section 10 says "per (integration, date)". | Use one wording. |

## Resolved after the reconciliation pass (2026-09-29)

| # | Resolution |
|---|---|
| U2 | Saved views CRUD added to 19 section 3.11.5a (Phase 5, `views:write`). Estimates, reconciliation view, alert-rule preview and alias dry-run remain Phase 1 contract-review items |
| U3 | Fixed infrastructure harmonized to about $24 to $30 in 27 and 00 (R2 $0 to $6 at month 12 per 23) |
| U5 | 28 section 2.3 uses 40 GB usable per 22 section 9.5; times recomputed; 00 updated |
| U6 | DDL added in 04 section 15.1 for `ops.task_attempts`, `seo.cannibalization_flags`, `seo.daily_page_metrics`, `ai.citation_entity_links`, `core.workspace_domain_categories`, `ai.external_mention_snapshots`, `ops.data_quality_flags`, `core.url_remap`, `ops.backfill_progress` |
| U7 | Natural key for `ai.entity_candidates` documented in 04 section 15.1 |
| U8 | Recommendation columns added to `core.xch_keyword_weekly`; "top-10 keywords with zero AI visibility" defined in 15 section 5 |
| U9 | Daily-only distinct counts marked in 16; window distincts and topic filters served from `ai.citations` |
| U10 | 76-hour dead-letter age for LLM Responses standard tasks (21 section 8) |
| U11 | Restore creates no version row; `'restore'` removed from the 04 CHECK; 11 section 2 aligned |
| U12 | Adjudication cap is an `ops.budgets` row (`extraction_llm`); domain classification recorded as platform overhead (13 stage 11) |
| U13 | Standing 04:25 to 04:50 UTC maintenance window for unattended reboots (22) |
| U14 | Alerts 47 to 49 added to 25 section 6 |
| U15 | `/v1/admin/platform-alerts` routes added to 19 section 3.11.5b; 25 references updated |
| U16 | S-13 and S-14 marked optional in Phase 0 in 01 |
| U17 | SSH over Tailscale only, break-glass rule documented; 24 and 31 aligned with 22 |
| U20 | Official API cost multiple unified (5x to 50x cheap models, several hundred times flagship; S-16 measures) in 05, 07, 27 |
| U21 | Verified already corrected in 17 (782.5 prompts, 9.8 points; section references fixed) |
| U22 | First-party metric keys renamed to `fp.*` in 16, 18, 19, 20 |
| U24 | Third-party page insight kind gated to Phase 13 in 19 |
| U25 | Restatement wording aligned in 12 with 04 |

Still open (deliberately deferred to Phase 0 or Phase 1 contract review): U1 (doc 20 "Data:" lines to be replaced with doc 19 paths), U4 (scenario letters in 22 and 23), U18 (19 open items 19 to 22), U19 (20 open gaps), U23 (Healthchecks plan when pgBackRest arrives).

## Architecture lock (2026-09-30)

The stack was locked by [ADR-022](adr/ADR-022-python-backend-simplified-platform.md), which is the source of truth for every row below: FastAPI and Pydantic v2 backend, OpenAPI generated by FastAPI, TypeScript client generated with `openapi-typescript` and `openapi-fetch`, one origin with the API at `/api/v1`, cookie `__Host-session`, our own auth module, API keys and `Idempotency-Key` deferred, SQLAlchemy 2 and Alembic, database roles `app_api`, `app_worker`, `migrator` and `backup`, Next.js self-hosted with standalone output, polling only, Taskiq on Redis streams.

| Doc | Section | Change | Reason |
|---|---|---|---|
| 19 | Intro, 1.1 | Base URL is `https://<domain>/api/v1` on the web app's origin; Caddy routes `/api/*` to `api`; no callback surface, no `/metrics`; health at `/api/healthz` and `/api/readyz`; every `/v1/` path literal prefixed with `/api` | ADR-022 serving and hosting |
| 19 | 1.3, 1.4 | OpenAPI generated by FastAPI from Pydantic models, committed as `backend/openapi/v1.json`; `apps/web` client generated from it with `openapi-typescript` and `openapi-fetch`; external SDKs deferred | ADR-022 contracts |
| 19 | 2.1 | Session cookie `__Host-session` (no `Domain`), opaque id in `auth.sessions` with a 60 s Redis cache; API keys planned and deferred; route token removed; CSRF is SameSite=Lax plus an Origin check against the one origin; CORS not used | ADR-022 auth and security |
| 19 | 2.2, 2.6, 2.12, 2.13, 3.3 | Permission `preHandler` is a FastAPI dependency; auth bodies are snake_case; unknown fields rejected by Pydantic `extra="forbid"`; permission keys from `sightline.api.permissions`; `expandMetricCell()` moved to the web app's `lib/api` | Fastify, Zod and `packages/contracts` removed |
| 19 | 2.7 | problem+json produced by FastAPI exception handlers; example error codes are Pydantic error types; API key and idempotency codes marked planned | FastAPI replaces Fastify |
| 19 | 2.8 | Idempotency-Key deferred: header ignored in V1, design kept as planned; V1 duplicate protection from the task ledger's unique keys | ADR-022 deferred items |
| 19 | 2.9 | Rate limits are a Redis-backed FastAPI dependency; API key row planned; export concurrency counted in PostgreSQL; pingback row removed | ADR-022 queue and readiness |
| 19 | 3.1 | Better Auth routes replaced by our auth module: register, verify email, sign-in, TOTP verify, sign-out, password reset, password change, TOTP setup, confirm, recovery codes and disable, session list and revoke; Google sign-in removed (deferred) | ADR-022 auth |
| 19 | 3.2.4 | API key routes marked deferred (`Ph` = `deferred`), design kept | ADR-022 deferred items |
| 19 | 3.11.1, 3.11.7 | `pingback_vs_poll_ratio` fields removed from provider and platform ops summaries; `poll_ready_last_run_at` added to the platform summary | Polling only |
| 19 | 3.12, 6, 7, 8 | Pingback route and its rules removed; performance timing reported to Sentry instead of Prometheus; phase counts recomputed (Phase 1 54, Phase 4 24, MVP 262, deferred 4, total 336); gap 21 resolved | Polling only; own auth; no metrics export |
| 20 | 2 | Stack: self-hosted standalone Next.js, generated API client row, same-origin auth calls, static headers in `next.config.ts` with the nonce CSP in `proxy.ts`, Cloudflare optional | ADR-022 web hosting |
| 20 | 3.1, 3.2 | Location is `apps/web/` in a repository without Turborepo; no imports from `backend/`; reserved slugs and enums reach the app through generated types; API keys settings route deferred | `packages/contracts` removed |
| 20 | 3.4, 3.5 | Server components call the API over the Docker network (`API_INTERNAL_BASE_URL`) with the cookie forwarded; browser uses same-origin `/api/v1`; `openapi-fetch` wrapped for TanStack Query; no runtime response parsing | ADR-022 contracts and serving |
| 20 | 3.9, 3.10 | Permissions from the API enum; feature flags from the API configuration, not Vercel | Vercel and `packages/config` removed |
| 20 | 4.11, 9.4 | Lighthouse CI against the standalone build; alias test worker chunk removed; static asset caching with optional Cloudflare | No Vercel previews; extraction is Python |
| 20 | 5.18, 5.19.3, 5.19.6 | Providers view shows last poll instead of pingback ratio; API keys page deferred; alias test tool calls `POST {P}/alias-test` instead of a Web Worker, new gap G13 | Polling only; API keys deferred; extraction is Python |
| 20 | 7.3, 7.4 | `connect-src 'self'` only; no preview or staging origins; cookie `__Host-session` without `Domain`; CSRF wording for one origin | One origin |
| 20 | 8.1 to 8.4 | MSW typed from generated types; XSS fixtures in `data/fixtures/xss/`; contract test is the client generation check; E2E runs against the full Compose topology | `packages/testing` and Zod descriptors removed |
| 20 | 9, 10, 11 | Section 9 rewritten as build and deploy on the droplet (standalone image, env vars, no previews, release order `migrator`, `api` and `worker`, then `web`); Phase 1 row updated; G7 and G10 updated | ADR-022 CI/CD and hosting |
| 04 | 2, 4 | Better Auth table mapping replaced by our own `auth.users`, `auth.sessions`, `auth.verification_tokens`, `auth.totp_secrets` and `auth.invitations` DDL; workspaces and memberships unchanged ("organization" is workspace); `auth.api_keys` kept with a deferred note | ADR-022 auth |
| 04 | 11.2 | `ready_source` CHECK drops `'pingback'`; dispatcher comment names Taskiq | Polling only; Taskiq |
| 04 | 11.8 | `ops.idempotency_keys` marked deferred (table kept, unused in V1) | ADR-022 deferred items |
| 04 | 13 | Roles `app_api` (RLS enforced), `app_worker` (bypasses RLS), `migrator`, `backup`; two narrow `SECURITY DEFINER` functions remain (invitation by token, partition creation) | ADR-022 database roles, corrected the same day: the worker reads across workspaces by design |
| 04 | 14, 16 | Migrations are Alembic revisions with SQL in `op.execute`, run as `migrator` from the one-off container; DM-1 resolved | ADR-022 data |
| 04 | 4, 7.3, 8.3, 11.4.1, 12.2 | Zod comments now Pydantic; workload map in `sightline.domain.workloads`; partition maintenance is a Taskiq task | Zod and `packages/contracts` removed |
| 05 | 3, 3.5, 4 | Adapter contract rewritten in Python (Pydantic models, `Protocol`, shared `httpx.AsyncClient`, Pydantic response models); contract tests in pytest; platform credentials from `/etc/seo-platform/.env` | ADR-022 language; no SOPS |
| 06 | 1, 3, 4, 6.1, 11 | Pingback removed: `tasks_ready` polled every 60 s, 30 s while a collection window is open, id sweeper for tasks older than the window; `webhook_resend` unused; BullMQ limiter and jobs replaced by Taskiq tasks on `collect` and `process`; S-01 question updated | ADR-022 readiness and queue |
| 07 | 3, 11 | `pingback_url` removed from request bodies; `provider.llm` queue and discovery jobs mapped to Taskiq `collect` with Redis limiters; callback row points to polling | ADR-022 readiness and queue |
| 08 | 3.3, 9.3 | Import rows validated with Pydantic; cannibalization detector runs on the Taskiq `process` queue | Zod and BullMQ removed |
| 12 | Intro, 2 to 6, 8 | Canonical schemas are Pydantic v2 models in `sightline.domain.observations` (camelCase aliases on the wire); nightly drift canary replaced by the schema hash check in the test suite | ADR-022 contracts and testing |
| 13 | 2, 3, 4 | Stages 1 to 10 are pure Python in `sightline.extraction` on the `process` queue, Stage 11 on `collect`; inputs are frozen dataclasses; JS libraries swapped for `tldextract` and `markdown-it-py`, with a rule-based chunker and no language model in V1; Stage 11 output validated with Pydantic | ADR-022 language |
| 18 | 3.3, 4.6, 4.8, 5.2, 9.1, 9.2, 11.1, 13 | Taskiq task names on `collect` and `process`; incremental syncs dispatched before backfills; quota counters shown in the Operations screen instead of Prometheus; Pydantic response models with `httpx`; log agent marked as waiting for API keys; path `/api/v1/ingest/logs` | ADR-022 queue, metrics, deferred API keys |
| design-system/26 | Header, 2, 6, 10 | Generated OpenAPI client replaces `@contracts`; self-hosted standalone Next.js; server components fetch over the Docker network; no preview deployments | ADR-022 contracts and hosting |
| adr/ADR-022 | New | Architecture lock: Python backend, self-hosted Next.js, Taskiq on Redis streams, own auth, polling only, simplified operations | User decision 2026-09-30 after a review for over-engineering |
| adr/001, 005, 014, 018, 021 | Status | Superseded by ADR-022, original text kept | Same |
| adr/002, 012, 013, 017 | Amendment | Process model and host budget; shared fetch cache deferred; backup retention and restore testing; timing | Same |
| 00 | 2, 3, 6 | Ten decisions, decision table, build vs buy, estimates (45.5 engineer-weeks, 19.5 calendar weeks) | Same |
| 01 | Header, 12 | S-07 and S-08 dropped, S-10 moved to Phase 1; research text kept as history | Same |
| 03 | 1 to 8, 10 | Technology table, repository layout (`backend/`, `apps/web/`, `data/fixtures/`, `data/gold/`), six containers, two Taskiq queues, polling flows, scaling steps | Same |
| 21 | 5, 8, 12 | Taskiq settings (`RedisStreamBroker`, acknowledged delivery, one process with two receivers), polling-only readiness, one worker process | Same |
| 22 | 1 to 4, 7, 8, 9, 11 | Compose file, Caddyfile, RAM table, `.env` secrets flow, three-image CI/CD, four database roles, no Alloy | Same |
| 23 | 4 to 11, 14 to 17 | 30-day dailies, DigitalOcean weekly backups, monthly scripted restore drill; GFS, bucket lock and the CI restore workflow removed | Same |
| 24 | 2, 4, 5, 7.4, 9 to 11, 14 | Own auth module and same-origin cookie; API keys and envelope encryption deferred; `.env` secrets; roles; Python logging | Same |
| 25 | All | Sentry, Healthchecks, Better Stack and the Operations screen; metrics catalog and Alloy removed; alert catalog reduced to 42; `ops.slo_samples` | Same |
| 26 | 2, 3.3, 4, 5 | pytest and Vitest tooling; schema hash check in the normal suite; gold sets 100 and 100, single annotation | Same |
| 27, 28 | Fixed costs; 7, 9 | About $30 a month fixed; resize and scaling triggers from ADR-022 | Same |
| 29, 31 | Phases 0 and 1 | Phase 0 about 1 week, Phase 1 about 3.5 weeks; checklists rewritten | Same |
| 30 | Risks | R-20 and Q-07 retired; R-21 (Taskiq maturity), R-22 (two toolchains), R-23 (no preview deployments) added | Same |
| diagrams/README | 11 of 18 diagrams | Updated to the locked architecture; `architecture-locked.html` added as the reference page | Same |
| 04 | 13, 15.1 | `ops.slo_samples` added; roles as above | Replaces the external metrics store |
| 13 | Stage 8 | Candidate chunker is rule-based; no language model in the worker in V1 | The 4 GB budget in ADR-022 depends on it |

Corrections made to ADR-022 on the day it was written, after the document owners checked it against the detail:

| Point | First version | Corrected | Why |
|---|---|---|---|
| Database roles | One `app` role for api and worker, under RLS | `app_api` under RLS, `app_worker` bypassing it | The planner, dispatcher, rollups and purge read across workspaces by design |
| Queue broker | "Taskiq with the Redis broker", two queues in one process | `RedisStreamBroker`; one broker per queue; one process runs both receivers, with a three-service fallback | The list broker loses a message when a worker dies mid-task, and a Taskiq broker is bound to one queue |
| Retries | "up to 3 times" on the diagram | By error class with backoff (doc 21 section 6: 4, 6 or 10 attempts) | The diagram was wrong; doc 21 was right |
| Heartbeats | Four checks | Plus the host check and the restore drill | Without the host check nothing reports disk, swap or a dead `web` container |
| R2 cost | About $1 | About $1 at the start, $1.50 to $6 by month 12 | Raw payloads and 30 dailies accumulate |

Open after the lock (none blocks Phase 0):

| Id | Item | Decide by |
|---|---|---|
| L1 | Taskiq single-process entrypoint with two receivers (`taskiq.api.run_receiver_task`) is unverified | Phase 1 smoke test |
| L2 | The roadmap still assumes three engineers for its 19.5 calendar weeks | Re-estimate at the end of Phase 1 |
| L3 | The log-ingest route and its agent need API keys, which are deferred | Phase 12 |
| L4 | The alias test tool now calls the API and only tests saved configuration | Phase 2 |
| L5 | Python markdown and tokenizer library choices in doc 13 (the type checker is settled: mypy strict) | Phase 8 |
| L6 | CSP keeps a per-request nonce in the Next.js proxy, not a static header | Confirm in Phase 1 |

## Backend foundation (2026-09-30)

Plan: [superpowers/plans/2026-09-30-backend-foundation.md](superpowers/plans/2026-09-30-backend-foundation.md). Code: `backend/`, `infra/compose/docker-compose.dev.yml`, `.github/workflows/backend.yml`.

| Doc | Section | Change | Reason |
|---|---|---|---|
| 04-data-model.md | 13 | Policies compare with `NULLIF(current_setting('app.workspace_id', true), '')::uuid` | Found while building the tenant transaction: a pooled connection keeps the setting as an empty string after a tenant transaction, and `''::uuid` raises. Pinned by a test on PostgreSQL 18 |
| 22-infrastructure-devops.md | 4.1, 4.5 | `api` runs `sightline.api.main:create_app --factory --no-access-log`; `/api/healthz` is liveness only | The app is built by a factory so nothing is read at import; doc 19 section 3.12 owns the health routes and doc 22 contradicted it |
| 25-observability.md | 3.1 | `request_id` is `req_` plus a UUIDv7 in Crockford base32 | Doc 19 showed `req_01J9...`, doc 25 said UUIDv7; this is both |
| 26-testing-quality.md | 2.2 | Types: mypy strict | Closes the type checker half of L5 |

Built beyond the plan because the specs require it and running the image showed the gap:

| Item | What | Why |
|---|---|---|
| Access log | `AccessLogMiddleware` writes one JSON line per request with the route template; uvicorn's access log is off | uvicorn's line is plain text and prints the raw URL, query string included (doc 25 section 3) |
| Server and library logs | `logging` records (uvicorn, SQLAlchemy, Alembic) go through the same JSON and redaction pipeline | One JSON object per line for every process |
| HTTP client loggers | `httpx` and `httpcore` log at warning and above only | At info they print every request URL; the provider client will use them |
| 500 log line | The catch-all handler passes the request id explicitly | Starlette runs it outside the middleware stack, after the id is unbound from the log context |

### Code review of the backend foundation (2026-09-30)

An independent review reproduced 5 high and 10 medium findings by running code. All five high findings and the medium ones below are fixed on the branch, each with a test that fails without the fix.

| Finding | Fix | Doc |
|---|---|---|
| Sentry events carried cookies, passwords, bodies, query strings and frame locals | No bodies, cookies, query strings or locals; `before_send` and `before_breadcrumb` use the log redaction rules; `request_id` tag | 24 §11 (already required it) |
| `/api/readyz` failed when the database was ahead of the build, which breaks rollback | A revision this build does not know means a newer build migrated the database: ready | 22 §8.5 |
| The migrator did not run as doc 22 defined it | `python -m sightline.db.migrate` needs only `DATABASE_URL`, logs JSON, takes an advisory lock | 22 §4.1 |
| Database errors logged bound parameters | `hide_parameters=True`; response-model errors log locations only | 25 §3.2 |
| Redaction missed header lists, models, dataclasses and keys such as `new_password`; one input crashed the log call | Word-based key matching in `config/redaction.py`; the renderer can no longer raise | 25 §3.2 |
| Readiness used the request pool and could hang on a frozen server | Its own connection, a hard timeout, no graceful close; failures logged at warning | 19 §3.12 |
| Connection strings were plain strings | `SecretStr`, no value in any validation error; strict URL validation; https required in production | 24 §5.1 |
| Inbound request ids were loosely checked, and Caddy was to add a UUID | The api owns the format and validates it as UUIDv7; Caddy does not add the header; web mints the same format | 25 §3.3 |
| Problem responses: non-JSON extensions crashed, headers were dropped, framework 401/403/429 had a generic code, wrong content type gave 422 | `jsonable_encoder`, headers carried, catalogue codes, 415, `errors[]` capped at 50, standard members protected | 19 §2.7 |
| The OpenAPI document was public and described FastAPI's default errors | Not served without a session; every operation documents `application/problem+json` with the `Problem` schema | 19 §1.1 |
| Deploy gate expected `/api/healthz` to return the release | The gate checks image digests with `docker inspect` | 22 §8.4 |

Carried into the next plans, because they need tables, roles or auth to exist:

| Id | Item | Plan |
|---|---|---|
| F1 | Tests and the dev stack connect as a superuser, which bypasses RLS. The schema plan creates `app_api` (no superuser, no BYPASSRLS, not the owner) in the test fixtures and runs the cross-tenant tests as that role | 2 |
| F2 | `app_api` needs `USAGE` on `ops` and `SELECT` on `ops.alembic_version`, or readiness reports `migrations: false` | 2 |
| F3 | The catch-all error handler runs outside the middleware stack: workspace and user ids bound by the auth middleware must be passed to the 500 log line the way the request id is | 3 |
| F4 | Check what Sentry's Redis integration records before session ids become cache keys | 3 |

### Schema, roles and tenant isolation (2026-09-30)

Plan `docs/superpowers/plans/2026-09-30-schema-roles-rls.md`, built on branch `backend/schema`. Revisions `0002` (runtime role access), `0003` (identity and tenancy) and `0004` (operations). Carried items F1 and F2 above are closed: the test suite, the development stack and the image smoke test all connect as the real roles, created by the same init script production uses, and `/api/readyz` answers 200 as `app_api`.

| Doc | Section | Change | Why |
|---|---|---|---|
| 04-data-model.md | 4 | Real DDL for `auth.workspaces`, `auth.memberships` and `auth.api_keys` | They were comments left from the Better Auth era |
| 04-data-model.md | 4 | `core.projects.primary_domain_id` gets its foreign key in Phase 2 | `core.domains` does not exist yet |
| 04-data-model.md | 12.2 | `ops.partitioned_tables` registry; `ops.maintain_partitions()` is the definer entry point; `ops.ensure_monthly_partitions` is owner-only, returns a count, serialises callers with a table lock, bounds its lock wait, quotes names and sets the autovacuum options | A definer function that accepts any table name would let the worker create tables anywhere; two workers must not race; names must survive quoting |
| 04-data-model.md | 13 | Policies call `auth.current_workspace_id()` and have `WITH CHECK`; own-membership and own-workspace visibility through `auth.current_user_id()`; what RLS does and does not protect against | One definition of the setting; "list my workspaces" runs before a workspace is chosen; the old text implied RLS also guards against injection |
| 04-data-model.md | 13.1 (new) | The grant matrix, per table and per column | It is the contract the tests check |
| 21-scheduler-workers.md | maintenance jobs | `ensure_partitions` calls `ops.maintain_partitions()` | The function it named is not callable by the worker |
| 22-infrastructure-devops.md | 4.2.2 | The init script as built; migrations never create roles; revision `0002` fails fast when roles are missing; `pg_hba.conf` and the password rotation row name the real roles | The text said the first migration keeps roles in sync, which a non-superuser `migrator` cannot do |
| 24-security.md | 3.1, 4, 12 | RLS bounds a request to the workspace the application chose, and nothing more; `app_worker` is listed among the roles that bypass RLS; grants as the containment for injection; audit id and time come from the database | Section 4 said only `migrator` and `backup` bypass RLS and overstated what RLS proves |
| 26-testing-quality.md | 5 | DB-RLS-01 to 03 and DB-GRANT-01 name the real roles; new DB-GRANT-02 (catalog equals the matrix) and DB-GRANT-03 (the refused statements); DB-PART-01 covers the registry function | The cases still said `app` |
| 31-implementation-checklist.md | Phase 1 | Partition item names the function as built | Same |
| backend/pyproject.toml | ruff | Rule `S608` on for application code | Doc 24 section 4 relies on "no string-built SQL"; now the build enforces it |

An independent review (Fable model) ran SQL as each role against the migrated development database. It reported the isolation itself sound (no cross-workspace read or write as `app_api`) and these findings, all fixed on the branch with a test that fails without the fix:

| Finding | Severity | Fix |
|---|---|---|
| `app_api` could set `auth.users.is_platform_operator`, change any email, and update or delete any row in the auth tables | High | Column grants: the API inserts and updates named columns only; no `DELETE` on users, sessions or tokens |
| `app_api` could read `ops.raw_payloads`, a cache shared by all workspaces, and every secret column in `auth` was reachable by both roles | High | No API grant on `ops.raw_payloads`; the worker reads four columns of `auth.users` and nothing else in the secret-bearing tables |
| `app_worker`, which bypasses RLS, could move any row to another workspace | Medium | `UPDATE` on named columns only, never `workspace_id`, `project_id` or an identity column |
| Two concurrent `ensure_monthly_partitions` calls could collide; a registry row for a dropped table stopped all maintenance; names were concatenated | Medium | Callers serialised by a lock (first an advisory lock, replaced after the second review, below); stale rows skipped; `format('%I.%I')` |
| Audit `id` and `occurred_at` could be supplied by the writer | Medium | `INSERT` granted per column, excluding both |
| Docs overstated RLS (24 section 4), named the wrong partition entry point, and said migrations keep roles in sync | Medium, low | Rows above |
| `auth.invitation_by_token` returns a row whatever its status | Low | Kept (the API must answer "expired", not "unknown"); the contract is documented on the function and pinned by a test |

A second review (Fable model) of the fixes confirmed every finding above closed, listed about 90 attacks as correctly refused, and found no new escalation path. It reported three more things to fix before merge and several smaller ones, all done:

| Finding | Severity | Fix |
|---|---|---|
| The docs listed only what injected SQL as `app_api` cannot do. It can still reset any password and create a session for any user, so it can sign in as an existing operator | Medium (docs) | Stated plainly in 04 section 13.1 ("What the grants cannot prevent") and 24 section 4. Inherent: the API is the authenticator |
| The grant test read tables and columns for our two roles only: a column grant to `PUBLIC` or a third role, a sequence or function grant, or schema `CREATE` would have passed | Medium (tests) | The test now reads column grantees, sequences, partitions, function callers (including `PUBLIC`) and schema privileges |
| `app_api` could block partition maintenance by holding the advisory lock, whose key is public | Medium | `LOCK TABLE ops.partitioned_tables`, a table no runtime role has any privilege on; `lock_timeout = '5s'` on the function bounds the wait for the parent's lock |
| A session-level setting left on a pooled connection scoped later transactions | Low | `workspace_transaction` and `user_transaction` write both settings every time |
| `app_worker` could read invitation token hashes | Low | Column `SELECT`, every column except `token_hash` |
| `app_api` could insert a run with forged counters and cost | Low | Column `INSERT` on what a manual run asks for |
| 23 section 13 still named three roles and `app` | Low (docs) | Four roles |
| "Nothing is granted to `PUBLIC`" ignored the two setting functions; DB-GRANT-01 named a Phase 4 table; role `statement_timeout` read as a limit; `S608` "enforces" | Note (docs) | Reworded in 04, 24 and 26 |

A third, short review (Fable model) of that fix commit reproduced the lock, grant and scope claims and found one test gap: a column grant on a partition passed every catalog query, and partitions have no row-level security of their own. The partition check now reads column privileges too. It also corrected two doc phrases ("re-point", not "rewrite", a session) and noted that `infra/sql/roles-restore.sql` does not exist yet.

Accepted without change: either runtime role can create large objects (mass inserts consume storage the same way; `vacuumlo` goes in the maintenance plan), and `sightline.db.ddl.grants` accepts a repeated privilege name.

Carried into later plans:

| Id | Item | Plan |
|---|---|---|
| F5 | `ops.collection_runs.schedule_id` and `blocked_by_budget_id` have no `ON DELETE` action, so deleting a schedule or budget with history fails. Decide `SET NULL` versus soft delete when the purge and schedule routes are designed | 4 (worker) and the purge plan |
| F6 | The purge and retention jobs need `DELETE` grants that do not exist yet (sessions, verification tokens, tasks, cost events, raw payload registry rows). Each grant ships with the job that uses it | maintenance plan |
| F7 | `auth.users.email` and `disabled_at` are not writable by the API. The change-email and disable-user routes add their column grant, or a definer function, when they are built | 3 (auth) |
| F8 | The raw payload routes need a definer function joining `ops.raw_payloads` to a row of the current workspace | Phases 4 and 7 |
| F9 | Doc 22 uses the database name `seo` in `pg_hba.conf`; the development stack uses `sightline`. Pick one when the production Compose file is written | 6 (droplet) |
| F10 | `core.layouts` (04 section 11.6a, specified by the frontend session) has a `workspace_id`: its migration needs `tenant_isolation`, grants for `app_api` only, a row in 13.1, and a decision on how the per-user rows are kept private inside a workspace (application check or a policy on `auth.current_user_id()`) | the plan that builds layouts |
| F11 | `vacuumlo` or a revoke of the large object functions in the init script | maintenance plan |

### Auth: accounts, sessions and two-factor (2026-09-30)

Plan `docs/superpowers/plans/2026-09-30-auth-accounts-sessions.md`, built on branch `backend/auth`. Revision `0005` (the auth audit function). Routes: the 16 auth routes and 3 current-user routes of doc 19 section 3.1, and `GET /api/v1/openapi.json` behind a session. Carried items F3 (ids on the 500 log line) and F4 (Sentry and Redis) are closed.

Decisions the specs left open, now written into the docs:

| Decision | Doc | Why |
|---|---|---|
| Registration is by invitation unless `REGISTRATION=open`; the first account comes from `python -m sightline.cli create-operator` | 24 section 2, 19 section 3.1, 22 section 7.1 | The first users are the agency and its clients. Open registration would let anyone create a workspace and spend the provider budget |
| A registration with a valid invitation token is verified at once; the address is compared by the database as `citext` | 24 section 2 | The token was sent to that mailbox. A comparison in Python called two addresses equal that PostgreSQL stores as different accounts |
| Revocation sets `revoked_at` and writes a Redis tombstone; the API never deletes a session row | 24 section 2 | Doc 24 said "deletes the row"; `app_api` has no `DELETE` on sessions, and a delete of the cache key alone can be undone by a slow reader |
| Cached sessions carry an HMAC bound to the token hash | 24 section 2 | Without it, anyone who could write to Redis could become any user |
| The breached-password check is the Pwned Passwords range API, failing open | 24 section 2 | No bundled list to keep current; only 5 hex characters of a SHA-1 leave the server |
| Recovery codes are 80-bit random values stored as `sha256` | 04 section 4, 24 section 2 | They are random like session tokens. Ten argon2 verifications per attempt would be a cheap way to exhaust the API |
| Auth events go to `ops.audit_logs` through `ops.record_auth_event`; a failure is committed before the error is returned and before it is counted | 04 section 13, 24 section 12 | The events have no workspace, which the row-level policy rejects for `app_api`; a row written in a transaction that then fails would be lost |
| Email is a port with a console sender (local origins only) and a Resend sender; tokens travel in the URL fragment | 24 section 2, 22 section 7.1 | One POST to swap the provider; a fragment is never sent to a server, so tokens stay out of access logs |
| The Origin check covers every state-changing request under `/api/`, public routes included | 19 section 2.1, 24 section 2.1 | It also stops login CSRF |
| The failure count is cleared only when a sign-in completes | 24 section 2 | Otherwise someone who knows the password could start over after every few wrong codes and guess the second factor without limit |
| A user with two-factor on must re-authenticate with a code | 19 section 3.1, 24 section 2 | Otherwise a stolen cookie plus the password would be enough to replace the recovery codes. What remains: a cookie stolen within 10 minutes of sign-in is already fresh (accepted, and the user is emailed on every change to the second factor or the password) |
| Sign-in locks the user row; a password change or reset writes it before revoking | 24 section 2 | A revocation of every session must not miss one created at the same moment |
| The 60 s cache is not trusted for anything that changes an account | 24 section 2 | A disabled user's session can stay cached for a minute |
| Log lines carry `user_id`, never the session | 25 section 3.1, 24 section 11 | The redaction treats a session id as a credential; the user is what an operator needs |

Each task was followed by an independent review (Fable model) that ran the code. What the reviews found and what was done:

| Task | Findings fixed |
|---|---|
| 1. Primitives and settings | Hashing and lookups raised on text UTF-8 cannot carry; a time without a zone was read as local time; the range listing was read without a size limit; the production email rule also stopped the worker |
| 2. Audit function and metadata | The action pattern was looser than its message; a `NULL` target echoed the row in the error; the drift check missed primary keys, which columns have defaults, and undeclared tables |
| 3. Email | A name could still become a link (bare domains, `mailto:`); the Resend post followed redirects if the client did; a subject could carry a Unicode line break; the console sender could run on a server that forgot `APP_ENV` |
| 4. Sessions | Sliding a session did not check that the user was still enabled; a cache entry with a time lacking its zone was a 500; anyone able to write to Redis could forge a session; a rotated session could be given a longer life than the policy; a configured origin with `:443` never matched a browser |
| 5. Registration and sign-in | An invitation verified a different address that folded to the same text; two sign-ins that both rewrote an old hash deadlocked; the invitation was not re-checked inside the insert; emails accepted invisible characters; token routes had no limit |
| 6. Passwords and sessions | An image URL with a NUL was a 500; a just-disabled user could still change their password; a right change did not clear the failure count; a reset could complete for a user disabled meanwhile; a Redis outage lost the audit row of a wrong password |
| 7. Two-factor | A sign-in with the right password cleared the failure count before the code was given, so the second factor could be guessed without limit by anyone holding the password (found while briefing the reviewer and fixed before the review returned; the review reproduced it on the older commit); the password alone could make a session fresh and then replace the recovery codes; enrolment could confirm a secret the code was not checked against; no notice was sent when the second factor changed; a test of the failure count passed without the behaviour it named |
| 8. Operator CLI and the served document | A password that is not UTF-8 produced a traceback; every database error read "could not connect"; the served document had no cache header; an existing account that is not an operator was reported the same way as one that is |

A final review of the whole branch (Fable model) checked every changed doc sentence against the code, every revocation for its cache eviction, every credential path for lock check, audit and counting, and the merge against `main` and both frontend branches (clean). It found one thing to fix before merge and several smaller ones, all done: a disabled user with a cached session could still replace recovery codes, turn two-factor off and read `/me`; two refused-credential paths wrote no audit row; re-authentication had no limit of its own; four audit actions and two `429` answers were missing from the docs; the email address pattern was defined twice.

Carried into the next plans:

| Id | Item | Plan |
|---|---|---|
| F12 | `two_factor_enrollment_required`: an owner or admin without TOTP is blocked from workspace routes. Needs `require_permission` and the workspace routes | launch hardening |
| F13 | While `REGISTRATION=invited`, creating a workspace should be limited to platform operators, or an invited client could create a second workspace and spend on it | 3b |
| F14 | Invitation routes: create, resend, cancel, accept, decline. Accepting must mark the invitation `accepted`; registration only reads it. The invitation email reuses the email port and the fragment token | create and accept in 3b; resend, cancel and decline at launch hardening |
| F15 | The general request limit (600 per minute per user) and `GET /api/v1/roles` | launch hardening |
| F16 | Verification and reset emails are sent from a background task in the api process. Move them to the worker outbox, which also removes the keep-alive timing difference between known and unknown addresses | launch hardening |
| F17 | Purge of expired sessions and used tokens, with the `DELETE` grants it needs | launch hardening |
| F18 | Production Compose: `APP_ENV=production`, `EMAIL_PROVIDER=resend`, `EMAIL_FROM`, `TOTP_ENCRYPTION_KEY` in `required-secrets.txt`; `--forwarded-allow-ips` and Caddy `trusted_proxies` verified with a test that the api sees the real client address | 6 (droplet) |
| F19 | The frontend branch adds the permission `layouts:manage` to doc 24 section 3.2. When it merges, `sightline.api.permissions` and its test need the same row | at that merge |
| F21 | `sightline/api/auth/service.py` is about 970 lines. Split it along its section headers: two-factor and re-authentication into their own module, the shared helpers (`_audit`, `_limit`, `_credential_*`, hashing) into a base both use | launch hardening, or earlier if a plan has to add to the file |
| F22 | Two tests set private attributes of the service to inject a failing email sender; give the `client_for` fixture an `email_sender` argument instead | launch hardening |
| F20 | `auth.users.email` and `disabled_at` still have no route. A disable-user path must revoke the user's sessions and evict them from the cache | launch hardening |

### Build order set by the product owner (2026-09-30)

After the auth branch was reviewed, the product owner asked for the main features first and for everything optional at the start, two-factor named as the example, to move to the end. The order is [29-phase-roadmap.md](29-phase-roadmap.md) section 1.1. What changed:

- Two-factor stays in the API as built and reviewed, as an opt-in. Blocking owners and admins who have not enrolled (F12) moves to launch hardening. Docs 00, 03, 19, 24, 29 and 31 now say so.
- The next backend plan (3b) is cut to workspaces, projects, membership, permission checks, and invitation create and accept. The rest of F14, and F15, F16, F17, F20, F21 and F22, move to launch hardening. F13 (who may create a workspace while registration is by invitation) stays in 3b because it limits provider spend.
- The droplet and deploy plan moves from before the feature phases to directly after rank collection, because daily rank history only builds on a server that runs every day.
- Nothing that protects tenant data or provider spend moved.

### Workspaces, members, invitations and projects (2026-09-30)

Plan `docs/superpowers/plans/2026-09-30-workspaces-projects.md`, built on branch `backend/workspaces`. Step 1 of the build order (29 section 1.1). No migration: every grant and policy the routes need was already in place. Routes: 4 for workspaces, 3 for members, 4 for invitations, 4 for projects (19 sections 3.2 and 3.3). Carried item F13 (who may create a workspace) is closed; F14 is closed for create, withdraw and accept.

Each task was reviewed on the Opus model by a reviewer that ran the code, as the product owner asked on 2026-09-30 (reviews before that were on Fable). What the reviews changed:

| Task | Found by review and fixed |
|---|---|
| 1. Access layer | An absent audit snapshot was stored as the JSON value `null`, not SQL NULL; an unknown query parameter was refused before the session check, so an anonymous caller could list a route's parameters; the access label dropped `fresh` or a second permission when two dependencies declared them; the workspace id could come from the query on a route that forgot it in its path; a suspended workspace was fully usable |
| 2. Workspaces | A browser in India reports `Asia/Calcutta`, which PostgreSQL's time zone data does not carry, and `localtime` and `posixrules` were accepted as zones; a rename took `FOR UPDATE`, which waits for and blocks every insert that references the workspace; no limit on workspace creation with open registration; a disabled account with a cached session could list its workspaces |
| 3. Members | Locking the owner rows deadlocked (500) when an owner was promoted while another change waited, and could refuse a legal change; the member list scanned every session once per member; a role change re-judged the scope the member already had; every role was shown who has two-factor on |
| 4. Invitations | An invitation outlived its sender's authority: a removed or demoted owner's pending invitation still granted the owner role; inviting an owner needed no fresh session while promoting one did; the audit entry recorded the offered role for someone who already belonged and kept their own; the inviter's name opened the email as free text; no limit per invited address; the response did not say which workspace was joined |
| 5. Projects | A request that waited for a row lock ended as a 500; archived projects counted against the limit with no way to free a slot; the "not limited to some projects" rule ran after body validation and was invisible to the access table |
| Whole branch | An address that grows when normalised passed the length check and was stored before the request failed; attempts refused for a taken slug used up the daily workspace allowance; a project id under another path parameter name would have passed the access table; update fields that refuse null were typed as nullable in the API document; invitations withdrawn by a demotion left no audit entry; an owner's invitation for the owner role outlived their demotion to admin and blocked the address. The review of those fixes found that normalising an address before bounding its length let one unauthenticated megabyte of accents block the server for most of a minute, fixed before merge |

Decisions that changed the specification, all in doc 19: an invitation is accepted by its token (`POST /api/v1/invitations/accept`), not by its id; accepting returns the workspace as well as the membership; `two_factor_enabled` and `last_active_at` of a member are null unless the caller manages members; a suspended workspace is read-only (`403 workspace_suspended`); a lock wait is `409 conflict`; the project limit counts active and paused projects.

Carried into the next plans:

| Id | Item | Plan |
|---|---|---|
| F23 | The policies on `auth.memberships` and `auth.workspaces` widen what a `DELETE` can reach, not only what can be read (04 section 13). Split the read rule into a `SELECT`-only policy, so the database itself refuses a delete that forgets its workspace | launch hardening |
| F24 | A deleted project's slug stays taken (`UNIQUE (workspace_id, slug)` has no condition). Decide with the delete route: free the slug on delete, or a partial unique index | the plan that builds project delete |
| F25 | `holds_pending_invitation` lets a token register an account when its workspace is being deleted or its sender has lost the right to invite. The account joins nothing, since acceptance checks both. Tighten it when registration is next touched | launch hardening |
| F26 | In a suspended workspace an invitation cannot be withdrawn, because every write is refused. Decide what a suspended workspace may still do when the route that suspends one is built | the plan that builds suspension |
| F27 | A route that takes a project id in its query or body (`filter[project_id]` on workspace-level lists, `project_id` in a budget) must check `access.sees(...)` itself: the membership dependency only checks the path. Add a guard test when the first such route is built | 2 (entities) and 4 (worker: budgets) |
| F28 | The member list shows every member's email to every role, including a viewer limited to one project (19 section 3.2.2 says `member`). Confirm with the product owner that a client stakeholder should see the agency's addresses | product owner |
| F29 | `deep_check_weekday` and `status` of a project are stored and steer nothing yet; they take effect with the schedules of rank collection | 4 (rank collection) |
| F30 | The disable-user route (F20), when built, must also withdraw the pending invitations the user sent. Acceptance already refuses them | launch hardening |
| F31 | Error codes are not in the OpenAPI document: `Problem.code` is a plain string and the members a code adds (`limit`, `used`, `reauth_url`) are untyped, so the web client has no types for them. Enumerate the codes and their extensions per route | launch hardening, or earlier if the web app asks |
| F32 | The web app's client generation needs `--enum-values` for the reserved slug enums to exist at runtime (told to the UI session) | UI session |
| F33 | Every route refuses a query parameter it does not declare, the health routes included. A monitor that adds a cache-busting parameter would read the API as down: keep probes free of query strings, or exempt the two health routes when the monitors are set up | 6 (droplet) |
| F34 | With the daily workspace allowance used up, a taken slug still answers `409`, so slug existence can be asked without limit by anyone who may create workspaces. Slugs are not secret; the general request limit (F15) bounds it | launch hardening |
| F35 | Addresses are normalised (NFC) when read from a request, and nothing normalises rows stored before. No environment holds accounts yet except the local operator, whose address is ASCII. If that changes before this ships, normalise `auth.users.email` and `auth.invitations.email` in a revision | 6 (droplet), before the first real accounts |

### Worker, queues and task ledger (2026-09-30)

Plan: [superpowers/plans/2026-09-30-worker-ledger.md](superpowers/plans/2026-09-30-worker-ledger.md). Code: `backend/src/sightline/{domain,collectors,providers/contract.py,worker}`, migrations 0006 to 0008, `backend/smoke.sh`.

Every task was reviewed on the Opus model, most of them twice (the fixes were reviewed again). The invariant the plan is for held under every review: no path sends a task to the provider twice, including a redelivered message, two handlers at once, the reconciler releasing a task whose old message turns up later, and a worker stopped or Redis wiped mid-run. What the reviews changed:

| Task | Found by review and fixed |
|---|---|
| 1. Rules | A `time` with `fold=1` moved a window across a clock change; a window carried past midnight by a clock change (Nuuk) made a monthly schedule drift for good, so the day of the month is now a column; naive times were read in the machine's zone; two different tasks could share an idempotency key; backoff caps were untestable and could overflow |
| 2. Worker process | After Redis was wiped the worker never read its queues again yet reported healthy; a listener restart left handlers running beyond the concurrency cap; the documented Redis ACL blocked the broker's claim lock; 100 messages were taken at a time, so a stopping worker stranded them; scheduled runs could be skipped or sent twice; receivers took messages after SIGTERM; a failing scheduler stopped the worker with exit code 0. The read loop of the stream is now the worker's own |
| 3. Ledger and budget | Inserting more than 2,047 tasks exceeded the parameter limit of a statement; the run guard, written with a bound parameter, failed on the sixth run created on a connection; a cancelled run's tasks were still sent; budget-held tasks were claimed again every tick and crowded out other work; two runs planned minutes apart could both take the same budget room; a zero-task run never completed; a cost could be recorded twice |
| 4. Planner | A failing schedule used up every tick; a week-old window was planned and then cancelled; a workload could write through the planner's session, which bypasses row-level security; lists of thousands of scopes or refs in a statement took longer to plan than a statement may run |
| 5. Dispatcher and submission | A provider that could not give its batch size stranded a whole tick; one database error while recording an answer lost every provider id in the batch; a mistagged request put one task's cost on another, possibly in another workspace; a whole-call error copied one workspace's request text onto others' tasks; the request params serialized as an empty object |
| 6. Reconciler | One failing step skipped the rest; a backlog after Redis loss took hours to release; a submission never confirmed was ended with no cost, so the budget forgot money that may have been spent |

Decisions that changed the specification: doc 04 (schedules name their weekday or day of the month; the run guard covers scheduled runs only; a budget that blocked a run can be deleted; the dispatcher's partial index), doc 21 (sections 3 to 6, 8.2, 10 and 12, as built), doc 22 (the Redis ACL is tested from the document), doc 27 (planning counts what running runs still expect to spend). Plan decision D4 is new to doc 21: a task not sent 24 hours after its window is cancelled, and a window found that late is not planned.

Carried into the next plans:

| Id | Item | Plan |
|---|---|---|
| F36 | Resolve `submit_unknown` by asking the provider (`id_list`, `tasks_ready`) within 15 minutes, as doc 21 section 6 describes. Until then such a task ends `dead` after the result lifetime and is charged its share of the run's estimate | 3 (DataForSEO client) |
| F37 | The requeue route must refuse, or warn on, a task that ended `submission_never_confirmed`: the provider may already have it | 5 (runs and tasks routes) |
| F38 | A manual, backfill or retry run is guarded only by its request: add a partial unique index on `origin_request_id` with the route that starts such runs | 5 |
| F39 | A schedule that has runs cannot be deleted (their foreign key has no action, and the run guard's check rules out `SET NULL`). Decide soft delete or a relaxed check with the schedules route | 5 |
| F40 | `ops.schedules.workspace_id` is not tied to its project's workspace by the schema; the planner refuses a mismatched schedule, but a composite foreign key would make it impossible | launch hardening |
| F41 | The shared DataForSEO rate limiter, `retry_after` from the adapter, and halving the limiter on `rate_limited` | 3 |
| F42 | Alerts: a schedule overdue by more than an hour must count only schedules whose workload is registered; failed and deferred planner counts, reconcile step failures and unmatched accepted tasks are logged at error level and need routing | 10 (launch hardening) |
| F43 | Each worker start leaves two consumer names in each stream's group; a message read at the moment of a stop waits the redelivery time. A stable consumer name per container, or deleting the name at stop after claiming its pending messages | launch hardening |
| F44 | A cron run whose send fails after its claim is lost for its period (the partition job has three months of partitions ahead) | launch hardening |
| F45 | Tests in `tests/collectors` other than the planner's read the real clock; near the end of a month the partition of the month before is what they rely on. Move them to a fixed clock as the planner's are | when next touched |
| F46 | The worker's database pool (8, no overflow, 5 s wait) is shared by 12 handlers and 3 ticks. When ingest jobs hold connections for seconds, recording a provider's answer can exhaust its three tries and leave paid tasks in `submit_unknown` with the ids only in the log. Reserve connections for recording answers, or size the pool from the concurrency; correct doc 22's "waits on the pool" | 5 (ingest jobs) |
| F47 | A schedule that fails for good is found first on every tick; 50 of them stop the planner from reaching healthy schedules. Back failed schedules off across ticks | 5 (first real workload) |
| F48 | The claim orders by `scheduled_for` only; priority orders only the batches of a tick. A manual "check now" in a project with thousands of due tasks waits several ticks. Order each project's share by priority first | 5 (manual runs) |
| F49 | The stream brokers' connections have no socket timeout or keepalive: a half-open connection could leave a read blocked while the heartbeat stays fresh | launch hardening |
| F50 | At 10 times V1 load: `ops.collection_runs` has no index on `status`, and the budget holds cost one query per due scope each tick | before 10x load |
| F51 | Migration 0007 gives a monthly schedule whose `next_run_at` falls on the 29th to 31st day 28, and the planner then passes that window with no `missed_window` run. No environment has such rows | none unless rows appear |
| F52 | The cron claim's minute is read from the process clock, the one process clock left in the worker; a run completed while a budget held it back loses `status_reason = 'budget_exceeded'` | launch hardening |

The whole-branch review found one more way to break at-most-once, fixed before merge: if the commit recording an answer succeeded but its reply was lost, the retry could apply the old answer to a later attempt of the same task. Answers are now recorded only against the attempt they answer. It also fixed: a provider that cannot give its result lifetime no longer stops tasks of every provider from ending; a task accepted without a cost is charged its estimate when it dies; a row that cannot be written is logged with the provider's id and cost; runs of a project row deleted outright are stopped.

### DataForSEO client, rate limiter and raw storage (2026-10-01)

Plan `docs/superpowers/plans/2026-09-30-dataforseo-raw-storage.md`, branch `backend/dataforseo`. Each task was reviewed on the Opus model before its commit.

| Task | Found and fixed |
|---|---|
| 1. Contract, errors, tags | Unknown 4xxxx codes failed tasks for good (now: the 401xx and 402xx families pause, anything unknown is retried); not-ready and no-results were errors (now answers); the tag's 8 hex digits of the run id were a timestamp shared by every run of a minute (now the whole id, with the installation and the attempt); a gateway timeout while posting tasks was retried blind (now an unknown outcome); DataForSEO credentials without raw storage were accepted |
| 2. Rate limiter | A call our limiter held back was reported as the provider's rate limit, which slowed the limiter further and ended tasks after six tries the provider never saw (now `throttled`: not an attempt, nothing slowed); a Redis failure in the limiter left tasks `submit_unknown` although nothing was sent; any HTTP 5xx or 5xxxx while posting tasks other than 501, 503, 505 and 50301 is now an unknown outcome, since the tasks may have been created; the slow-down now halves every bucket's burst and rate, families included; a clock stepping back stalled a bucket; family names could collide with other keys; the attempt stamp was untested and defaulted to 0 (now required before an adapter sends; `make_tag` checks the installation); the limiter's tests let a wrong refill rate and unbounded idle banking pass, and two relied on 50 ms margins |
| 3. Client and SERP adapter | A cost too large to round raised after the POST, which left every task of the batch unknown with its provider ids unlogged (and broke fetch and the task list too); a deeply nested answer escaped the same way; a call refused as a whole whose answer named tasks it had created failed them, though they were paid for (now read task by task); keywords with `%` or `+` were searched wrongly (now escaped as DataForSEO documents); `people_also_ask_click_depth: 0` was sent, outside the documented 1 to 4; the list of posted tasks could be taken as complete when it was not (a null result, a count that did not match, offset paging across tasks of one second; now split by period and checked against its count); an origin that was not HTTPS, a family with no limit and a builder bug could each leave tasks unknown though nothing was sent; a read that timed out was `timeout`, the kind that means "the provider may have the task"; one slow-down per refused task could outlast the handler |
| 4. Raw storage | The same bytes coming again returned a row whose object had expired or was about to, and bytes kept under a second class were answered with the first class's shorter-lived object (now one row per class and hash, migration 0009, and an aging object is written again and its expiry moved); nothing checked that a payload read back was the one stored (now a zstd content checksum, one whole frame and nothing after it, and a read checked against the registered sha256); the S3 connection pool was smaller than the worker's concurrency; botocore's debug logs showed the access key id and signatures; a body cut off mid-read escaped as an aiohttp error, and an object was read whole before any size check; hashing ran on the event loop; tests did not pin the exact error text, the signing region or the absence of trailing checksums |
| 5. Ready, fetched, resolver | The list of posted tasks was called at `/v3/tasks/id_list`; DataForSEO documents it per API (`/v3/serp/id_list`), so the resolver would never have worked; a listing without a tag was taken as proof a task was absent, which would send it again and pay twice (now nothing in such a look is sent again); a task not found was sent again at once with no limit on attempts (now the `timeout` policy: a wait, and `dead` after four); a task whose result was fetched and not stored ended at 72 hours though the provider keeps it 30 days; a fetch failing for days was asked for every five minutes (now an eighth of the task's age, up to six hours); submissions a minute apart each had their own listing (now one look, and a pass is bounded in time); a resolved cost was charged when it was found, not when it was sent; guards on attempt, provider id, provider code, window bounds, sweep limit, `retry_after` and retention classes were untested |
| Whole branch | The ready poll fetched a task again a minute after a failed fetch, ignoring the wait the provider named (now it waits); a task the provider itself failed (50301) was fetched for 72 hours and never sent again (now the retry policy resends it); a connection that never opened counted as an attempt, so minutes of network trouble ended tasks never sent (now `not_sent`, the renamed `throttled`, which also covers the limiter); the 30 day keep after a storage failure was lost at the next fetch error (the mark now sticks); S-01 did not measure how soon `id_list` lists a task or the clock offset the resolver relies on (now it reads it at 1, 5 and 15 minutes); a task accepted without a cost was never charged once fetched (now its estimate); a production server with credentials could run with the default installation `local` (now refused, and doc 23 says what a restored copy runs with); tasks of a provider the worker no longer has looped between sweeper and fetch; docs 06, 21, 22 (Compose made the optional credentials mandatory), 25 and the README had drifted; spike fixtures kept the account's money and other installations' tasks |

Carried:

| Id | Item | Plan |
|---|---|---|
| F53 | Spike S-01 checks whether any 402xx code refuses one API only (such as a subscription code). Today every 402xx pauses all of DataForSEO, which would let one unsubscribed API stop SERP collection | 3 (Task 7, S-01) |
| F54 | Recording an answer is tried again when its commit reply is lost. A failure that does not count (a pause, `throttled`) gives the attempt number back, so a retried record could land on the next submission of the task, which has the same number. The 30 second wait before that submission makes it unreachable today; bind the record to the submission's time as well as its attempt | when the ledger is next touched |
| F55 | A handler cancelled while it waits for its turn under the limiter (the 8 minute limit, a crash) leaves its batch `submit_unknown`, though nothing was sent. A graceful stop waits for handlers | launch hardening |
| F56 | The reconciliation of `ops.raw_payloads` with the bucket (doc 23 section 9.2): remove objects no row names, and rows whose object is gone. Needed before `ai_raw` grows, where an orphan never expires | with the retention jobs (launch hardening) |
| F57 | Object keys always end in `.json.zst`, though `content_type` may be `text/html` (doc 04). Decide the suffix before the first HTML payload is stored | with the first HTML endpoint |
| F58 | Spike S-01 measures DataForSEO's clock offset and `id_list` lag against the resolver's window (a minute before, 15 minutes after). The resolver logs `posted_after_seconds` for every task it finds, to watch the margin in production | 3 (Task 7, S-01) |
| F59 | Tasks never collected (another installation's, an earlier attempt's after a resend, unreadable tags) stay in `tasks_ready`, which lists 1,000 ids a call; enough of them leave only the sweeper. Collect or skip them | before the first real workload |
| F60 | A fetch refused for credentials, payment or the account limit does not pause the provider: the poll and the sweeper keep calling | launch hardening |
| F61 | A slow fetch racing a second one (after the 15 minute stale release) can store a payload no task names; harmless except in `ai_raw`, where the registry reconciliation (F56) removes it | with F56 |
| F62 | `fetched` is not terminal, so a run never completes until ingest exists: the rank workload must not be registered before `ingest_serp` | 5 (rank collection) |
| F64 | Looks the resolver cannot decide (an untagged task on the account in the window) or cannot make are tried again first on every pass; ten of them fill a pass and newer unknown submissions wait. Give each look a backoff | before `RESOLVE_UNKNOWN_SUBMISSIONS` is turned on |
| F65 | The end to end test does not cover the sweeper, a storage failure, a rate limit or a call never made; the collector tests do | when the first real workload is added |
| F63 | The web session's CI and image proposal (`apps/web/Dockerfile`, Playwright projects, the `web.yml` steps, the Compose `web` service with `API_INTERNAL_ORIGIN`) goes into the deploy plan. Playwright runs inside `mcr.microsoft.com/playwright:v1.63.0-noble`, pinned by digest (doc 22 section 8.6), with `corepack enable && pnpm install --frozen-lockfile` first and no `E2E_BASE_URL`: the config builds and serves the test build on 127.0.0.1:3100 itself, since a server on another host is not a secure context (no mock service worker, no `__Host-` cookie) | 7 (droplet and deploy) |

### Brands, entities, domains, locations and taxonomy (2026-10-01)

Plan `docs/superpowers/plans/2026-10-01-entities-taxonomy.md`, branch `backend/entities`. Each task was reviewed on the Opus model before its commit.

| Task | Found and fixed |
|---|---|
| 1. Schema | Deleting an entity cascaded into its project roles, so the API (which may not delete roles) could erase a role and its history (now refused by the key); a term's parent could sit in another vocabulary, so deleting one vocabulary deleted terms of another (the parent key is now on the vocabulary); the slug check passed upper case on a `citext` column and paths were not checked; the API could set any column of the shared `core.domains`, classification included, and a registrable domain unrelated to its host (now four columns, with consistency checks); an entity could claim only one path prefix per host (entity domains now have their own id); views were outside the grant tests (a view a runtime role reads must now run with the reader's rights, and no materialized view may be readable); most workspace keys could be dropped without a test failing (now one test per key, and a catalog rule that keys between tenant tables carry the workspace); names and aliases took surrounding spaces, aliases that ignore case could repeat in another case, and vocabulary names compared with case; `country_iso` took lower case; parents had no index; docs 19, 21, 23, 29 and 31 still described a materialized view |
| 2. Canonicalizer and resolver | Two outputs were not fixed points, which would have made `url_hash` values unstable once written: a `youtu.be` id holding `&` split the query on the next pass, and wrappers nested past 5 levels unwrapped further each time (now unwrapped to the end, under a 32 KiB limit, `too_long`); a huge port and IPv6 zone ids raised errors other than `UrlRejectedError` (zone ids are now invalid); Google redirects were read on private suffixes, so a page on `google.github.io` could make its citation canonicalize to any URL (now ICANN suffixes only); `/url` read whichever of `url` and `q` came first; a text fragment on a wrapper was lost without its flag; `idna` was not pinned; hosts and prefixes typed by people could be stored in forms that never match (`en.m.wikipedia.org`, `/acme/`, a newline in a prefix); a watched entity on the result disagreed with doc 04 (doc 04 now says it is named); eleven mutants survived the tests (now each has one), and a property over arbitrary text checks every output is a fixed point |
| 3. Alias matching | Negatives cost positives times negatives, minutes inside the 100 KB alias test (now sorted with range minimums); a pattern was checked case-sensitively but run ignoring case, whose program is larger, so one stored alias could stop a project's matching (now checked with its own setting under a program size limit, and a pattern that cannot run is left out and reported); `™`, `℠` and footnote digits decomposed into letters glued onto a name; a lone surrogate crashed RE2; Indic vowel signs counted as boundaries and kana voicing marks were dropped, merging different letters; patterns were not normalized like the text, so `Nestlé` never matched; the longest span won before scoring, so a discarded span could hide one that counted; hint distance, sentence starts and the hit list could grow super-linearly (now bisect, a backward walk, and a 250,000 match limit); sentence starts missed no-break spaces, opening quotes, `1)`, table cells and `…`; spans had no status of their own; nine mutants survived the tests |
| 4. Entity routes (with the step 4 models) | Two parent changes at once could each pass the cycle check and write a cycle (now one parent change at a time per workspace, an advisory lock); the list's cursor used Python's `lower()` while the database sorted by PostgreSQL's, which differ for some letters, so paging skipped rows (now the database's key); a parent deleted while a child was written gave a 500 (now the parent row is held until commit); an entity domain was looked up by its id alone before a delete, leaving one check between entities; a batch of 200 aliases wrote 200 audit statements under the entity lock (now one); tests did not pin the version bump of every write route, the id tie-break, an unknown parent on change, cross-entity domain deletes or the role filter for limited members |
| 5. Project roles, project domains, the alias test, project fields | Matching the canonical name by itself overrode the aliases people set up to tell it apart: a context-bound, case-sensitive or negative alias of the name's text lost to the plain name at 0.95 (now any stored alias of the name's text, in any mode, stands for the name; the test names bent around it are restored); `own_entity` answered 500 for an alias with spaces around it or only spaces, a public suffix domain, and two aliases that Python's casefold keeps apart but PostgreSQL's `lower()` does not (now checked per item in the schema, and repeats are left out by the database's rule); the primary own entity could be made not primary, then changed or removed, and the 409s advised "make another one primary", which itself answered 409 (now another own entity takes over, and the primary one stays until then: `primary_own_exists` is gone); the alias test checked the size before the project, so a deleted project answered 413, and compiled the patterns on the event loop; no request body limit existed, though doc 19 promised 1 MB (now a middleware refuses a larger body before it is read, chunked ones included); a re-attach and a removal kept no earlier role in the audit log, and a project change logged domain row ids where creation logs hosts; `primary_needs_own` answered with a different path and message on create and change; the alias test dropped `via_entity_id`; twelve mutants survived the tests (byte counting, removed roles in the matcher, path prefix hosts, lone surrogates, `added_at`, the version bump and audit action on removal, the competitor limit's counting and boundary, role order, the project check) |
| 6. Taxonomy | A batch creating more than 2,978 terms (the spec allows 5,000: 500 paths of 10 levels) answered 500, because its audit entries went into one statement past the driver's 32,767 parameters (now 1,000 entries a statement, for every batch); a move was refused over a slug the client never chose, as when `C++` (slug `c`) moved next to `C` (now numbered `c-2`, as an insert is; a given slug still conflicts); a body that is one item or a batch reported errors from both shapes at paths such as `TermBatch.items` (now only the shape sent is checked, aliases included); names in composed and decomposed form could be siblings; `path` was capped at 1,000 characters, under ten names of 200; a description change read the parent and siblings; the pattern for paths below a term escaped with `/`, the separator itself; nine mutants survived the tests (the scope check on create, deleted projects, the lock and the read after it, level order, audit contents) |
| 7. Locations and registries | Entries that passed validation but the database refuses (a code past `integer`, NUL in a name) aborted the whole sync (now skipped); skipped entries counted as unlisted, so a format change could deactivate locations, and a list where nothing could be read reported success (now any skipped entry stops deactivation, and an unreadable list is an error); query text with NUL and cursors with huge ids or lone surrogates answered 500 (now 422 and 400, the entity list included); the command blamed the file for a database that was down and DataForSEO for Redis; two syncs at once could time out on each other's rows (now one at a time); a map row never got `serp` back; duplicates, a quadratic cycle walk and a second parse of the answer; nine mutants survived the tests |
| 8. End to end, docs, whole branch | Giving an entity a role while it was being deleted answered 500 (now the entity is held, as a parent is, and the delete waits and is refused); a project change with a new primary domain locked the project before inserting the host, the opposite order of an entity domain write, and hosts went in in the order given, so two requests could deadlock into `409 conflict` (now hosts first, sorted); no test pinned the Origin check before the body limit; doc 19 named field codes as problem codes in the route tables |

Carried:

| Id | Item | Plan |
|---|---|---|
| F66 | Four step 2 keys between tenant tables do not carry the workspace: `ops.budgets.project_id`, `ops.schedules.project_id`, `ops.collection_runs.schedule_id` and `blocked_by_budget_id`. Only the worker writes them today; make them composite (as `tests/db/test_rls.py` lists) before a route writes budgets or schedules | the schedules and budgets routes |
| F67 | Migration 0010 adds constraints with plain `ALTER TABLE`, fine on small tables. On a large table, use `CREATE UNIQUE INDEX CONCURRENTLY` with `ADD CONSTRAINT ... USING INDEX`, and foreign keys `NOT VALID` then `VALIDATE` | the first constraint on a large table |
| F69 | `color_index`, `track_seo` and an entity's `description` bump `entity_config_version` (D7), though they do not change what extraction counts; once re-derivation exists each bump schedules 90 days of it. Decide which fields bump | 8 (extraction) |
| F70 | Taxonomy hides the vocabularies of a deleted project; entity visibility and the projects that name an entity do not look at `deleted_at`. Align them | project delete (step 10) |
| F71 | Merging this branch changes `backend/openapi/v1.json`, so main's web check fails until the web session's regenerated client lands (`frontend/entities`). Merge the two back to back | the step 4 merge |
| F68 | A failed monthly location sync waits a month: the queue does not retry and the failure is only logged. Add a daily "sync when older than a month" check, or an alert on the job's failure | launch hardening (alerts) |

### Keywords, tracked keywords, groups, schedules, runs, costs and imports (2026-10-05)

Plan `docs/superpowers/plans/2026-10-01-keywords.md` (imports sub-plan `docs/superpowers/plans/2026-10-05-keyword-imports.md`), branch `backend/keywords`. Each task was reviewed on the Opus model before its commit.

| Task | Found and fixed |
|---|---|
| 1. Schema | Schedules could be deleted outright, so runs lost the schedule they named (now a schedule is deleted by setting `deleted_at`); a tracked keyword could name a schedule of another project (the key now carries the project); snapshots were not unique per task, and the current row did not name a snapshot of its own key (both now enforced); import rows did not record what writing them did; a project's runs and a subject's recent tasks had no index; no test failed when a constraint or index was dropped (a catalog test now pins every one) |
| 2. Shared keyword rules | Search operators were not read on the normalized text, so full-width look-alikes got through while real keywords that look like operators were refused (now read on the normalized text); control characters were accepted and invisible characters stayed in stored text (now refused and cleaned); writing did not check the quota before writing, did not refuse a deleted project, and counted a deleted project's keywords against the quota |
| 3. Keyword and tracked keyword routes | Link writes now go in batches, with id lists as one array; a restored keyword now keeps its links and overrides; a merge now leaves one term per single-valued vocabulary; the keywords of a deleted project answer 404; URL, quota and row locks are now taken in one order; trend and seasonality are read over twelve calendar months; import column mappings use a named field enum |
| 4. List and bulk changes | Bounded filter lists are accepted as comma lists; body filters take archived keywords unless they say otherwise; unknown terms and blank text match nothing; link changes are counted per keyword in the database and capped; a bulk change writes one summary audit entry; cursor values are bound to their project; subtree queries stop on repeats |
| 5. Groups and term assignments | Duplicates are locked before their terms are merged; the groups that keywords are put in are held; group depth is capped at ten levels and paths at 2,048 bytes; groups are listed level by level; deleted keywords no longer block a vocabulary from becoming single-valued, and lose surplus terms when they come back; vocabularies are held only for writes that add terms |
| 6. Labs adapter | Batches are cut by a workload key, so one batch is one Labs call; requests Labs would not take are refused before sending; keywords are escaped; a spelling Labs reads as another is sent once; a no-results answer is read as empty; absurd costs are distrusted; live tasks of unknown outcome are sent again |
| 7. Keyword metrics through the ledger | An answer that cannot be read or written now waits 5 minutes and fails after a day, one answer per transaction; an empty reading keeps current metrics and is no material change; readings are judged against the snapshot before them; a blocked new-keyword run is not made again for 24 hours; manual runs no worker can plan are cancelled after 10 minutes; manual runs open their window when planned and keep the plan's configuration; archived keywords are refused by refresh; planner steps fail on their own |
| 8. Schedules, runs and settings | `next_run_at` is recomputed only when the rule changes, and outside the period the last window ran in; a restored keyword keeps its schedule only while it is live; item routes refuse a deleted project; window starts are plain `HH:MM`; `all` with `stale_days` is a `selector_conflict`; changes that change nothing are not audited |
| 9. Costs | A nightly 35 day rebuild; rollups take turns and write in key order; a BRIN index on cost events; dates bounded to 2000 to 2100; `blocked_runs` counted by when the run was blocked; a deleted project's costs stay its history; a zero limit reads as 100% used; spend reads stop at the month's end |
| 10. Imports (parts A and B) | A NUL character in a cell stopped every workspace's imports (now `cell_invalid`, text stored without it, and an import that always errors ends as `parse_failed` or `write_failed` instead of blocking the queue); the number of columns was unbounded (now at most 100); one cell over 128 KiB failed the whole file; duplicate API headers were accepted; the 50 MB limit applied to every method of the upload path (now `POST` only); the upload held a database connection during the transfer; an import read before was given up on after one storage hiccup; the worker could not delete term links, so a keyword brought back under a single-valued vocabulary stopped the import (migration 0012); a report was refused for an import that failed while writing; groups and terms were made while the quota lock was held and read every sibling each time (now made first, with a cache, and at most 50 tags a row); merge and repeat targets were locked in different orders (now one id order); a repeat could be filed under a keyword deleted since. Found on the way: `_recent_task` compared a task's `created_at`, which the ledger sets to the first of the month (its partition key), so after day 1 of a month a keyword still waiting for metrics got a new run every minute |
| 11. End to end, docs, whole branch | The report of a large import read every source cell of every row (about 100 MB of JSON for a 50 MB file with `device: both`) and could get the API container killed: the report no longer reads them. A CSV upload was copied through base64, JSON and bytes, several times its size at once, on the API and on the worker: it is now stored as the file itself, compressed, and the worker reads it in a thread. A group name was matched with Python's lower case, which differs from the database's for a final sigma, so the insert failed on the sibling index and ended the import: the lookup uses the database's `lower`. Imports the bucket would not give back took both places of a worker pass, so those behind them waited: they are passed over without using a place (at most 8 per pass). The import claims scanned the whole table every 5 seconds: two partial indexes (migration 0012). The doc said `would_use` counted creates only; it counts merges that bring back an archived keyword too. A test used a clock read when its module was imported. |

Decisions that changed the specification, as "As built (step 5)" notes: doc 04 (tables, indexes and worker grants), doc 06 (the Labs live call), doc 08 (text rules, groups and the import pipeline), doc 16 (the four keyword metric keys), doc 19 (sections 3.6, 3.11), doc 21 (the ticks and the planner's three steps), doc 27 (price book rows, budget group and cost rollup), docs 29 and 31 (status). F66 is met for schedules and for runs naming a schedule (migration 0011); the keys of `ops.budgets.project_id` and `blocked_by_budget_id` are still plain.

Carried:

| Id | Item | Plan |
|---|---|---|
| F72 | `seo_rank` schedules can be made before any planner plans them. When the rank workload registers, the migration of that step must start them from their next window, or the planner records their past windows as missed | 5 (rank collection), in the migration that registers the workload |
| F73 | Costs with no project (workspace level) are not rolled up into `ops.cost_daily` yet; doc 04 section 11.4 rolls them up under the all-zero project. Build it with their first writers (`keyword_research`, `first_party`) | the first workspace-level cost writer |
| F74 | No `Idempotency-Key` is checked on the import create and confirm routes, which doc 19 says require it | 10 (launch hardening), with the general rule of doc 19 section 2.8 |
| F75 | The presigned upload route (`upload-url`) is not built; imports take the file by multipart upload. XLSX files and the `competitors` column are not built either | 10 (launch hardening), unless asked sooner |
| F76 | `force_separate` (a separate case-sensitive keyword) is refused with `force_separate_not_available`. It needs a case-sensitive keyword identity, which doc 08 puts in Phase 5 | 10 (launch hardening), with that identity |
| F78 | When a Labs answer was paid for but could not be stored, the task fails with no cost event, so `spent_in_month` and the hard budget limit do not see the spend (each retry, up to four attempts, is charged by DataForSEO). Record a cost event with the failure, or keep the answer in memory for one more try | 5 (rank collection), with the next live workload |
| F79 | Two projects of one workspace that overlap on keywords and plan their monthly refresh in the same tick send the overlap in two Labs calls when more than 700 tasks share a location and language, and pay twice. Cut batches by keyword across projects, or skip a keyword another planned task already covers | 5 (rank collection) |
| F80 | The import worker holds a database connection and the import row lock while it downloads a source (up to 50 MB). The API side was changed; the worker's read could happen before the transaction that claims | launch hardening |
| F81 | `GET .../rows` returns each row's source cells (`raw`) at up to 200 rows a page, which is up to about 40 MB for a file of 100 wide columns | launch hardening, with a smaller page for wide files |
| F77 | Tracked keyword rows lack the rank columns the web session asked for: current position, change against yesterday and ranking URL | 5 (rank collection). **Closed** by rank collection (2026-10-05): the rows carry `state` with current, change, best and worst, features, AI Overview and target URL match |

### Keywords, imports, schedules and costs screens, web app (2026-10-05)

Plan `docs/superpowers/plans/2026-10-01-keywords-ui.md` (sub-plans `2026-10-05-keyword-groups-ui.md`, `2026-10-05-keyword-import-ui.md`, `2026-10-05-costs-runs-ui.md`), branch `frontend/keywords`, on the contract of `backend/openapi/v1.json`. Each of Tasks 1 to 12 was reviewed by an independent reviewer on the Opus model before its commit, and every finding was fixed, with the gates run again, before the commit. The whole-branch review of Task 13 (three independent reviewers on the Opus model, each with its own lens: contract and mock fidelity, consistency and accessibility, shared infrastructure) is below the table.

| Task | Found and fixed |
|---|---|
| 1. Data table | A focused row far from the view is rendered as a range of its own, and rows render again only every 160 px of scroll; focus is kept by row id; cell controls hand Escape and the arrows back to the grid and menus return to their cell; a click in a portaled menu no longer opens the row; "Select all matching" is offered only once every loaded row is selected, unticking under it keeps the rest, and selected rows a filter hides stay selected and reach actions through an `ActionScope`; server pages carry their offset into `aria-rowindex`; selection, sort and count changes are announced |
| 2. Filters, inspector, stepper, strip, chart, progress | A single-choice filter applies on a click, Space or Enter and no longer while the arrow keys move through its options; range ends accept group separators and show an error for anything but a whole number instead of dropping the end and removing the filter; text is trimmed; the filter bar keeps the values of fields it does not show and announces its result count; the inspector's Escape leaves open lists, menus, comboboxes, tooltips and text composition alone and closes once per press; a docked resize reflows the list once, on release; charts read their colors again when the theme changes; the stepper blocks step jumps while Continue checks, drops an answer for a step no longer shown, focuses the first error after it renders and keeps the step when the check throws; the width store keeps a width in memory when storage is blocked or full |
| 3. Client and mocks | The mocks were held to the backend as built, rule by rule: a body filter takes archived and active keywords unless `is_active` is set, adding a term to a single-valued vocabulary replaces it, bulk updates refuse `nothing_to_change` and `added_and_removed`, groups refuse a slash, a tree past 10 levels and a path over 2,048 bytes, a repeated sort field is `invalid_sort`, list filters take 1 to 100 values, and schedules answer the first failing stage as the service does |
| 4. Rankings | Fixed in the task's own commit. What it settled: a filter of a shared link that does not read, including a range end outside its bounds, is dropped with a notice; a later page that fails to load leaves the rows and offers a retry; filtered-to-nothing states show the applied filters as read-only chips; the tracked count of active keywords is not quoted in the Archived view |
| 5. Keyword inspector | Fixed in the task's own commit. What it settled: leaving a keyword with unsaved changes asks first, and a save in flight holds the inspector on its keyword; a keyword the filters or the search leave out of the table says so; groups and tags save pessimistically, since one save is several requests, and a partial save says so; the depth profile changes through a dialog with a reason, because it starts a configuration version |
| 6. Add keywords | Fixed in the task's own commit. What it settled: every add goes through `bulk-create` and the list is read by the API's own text rules first (repeats in any casing once, a refused line named by its number, `both` counted as two); over the plan's limit nothing is added and the dialog says by how much; keywords tracked already come back with "Show it" and "Unarchive"; the text rules moved from the mocks to `src/lib/keywords` |
| 7. Bulk actions | Selection and focus bugs: the selection is dropped for good when the filters, the view or the API's search change, and focus goes back to the grid after a dialog changed the rows. Also: ids go in requests of 5,000 and group removals in requests of 100, and a change that landed in part says so; archive by filter has no Undo, since the rows it changed are not known; in client mode the list's search runs in memory, so "every matching keyword" sends no `q` and "Select all N matching" is not offered while that search narrows the rows |
| 8. Keyword groups | Text left in a group field is a search, not a group (`MultiSelect.commitOnBlur`); groups are made on save from the list read at that time, and a create refused as a duplicate uses the group that has the name; forms say which groups were made when a later step fails; group paths match without the browser's locale and a typed path with spaces finds its group; Manage groups names the group of its form, closes forms of deleted or deselected groups, asks before closing a dirty form, keeps the tree when a later read fails and offers only moves within 10 levels; the inspector refreshes group counts after saving |
| 9. Import | Many findings across the browser's reading of the file, the mapping, the dialog and the header, among them one on the unarchive step, a risk to existing data. The fixes: unarchiving is marked before its first request, repeated rows are left out of it, and its answers show an import that goes over the limit; a lone CR ends a CSV line, and a header line longer than the bytes read, two headers that read alike and a file with a header only are refused in the browser; mapping keys are compared with the file's headers trimmed and without case; failure codes are told in words in the dialog and the toast, and the report is offered only when the import links to one; going back from Map and Continue goes to Map again, and a change of defaults alone keeps the mapping; the upload goes through the mutation cache, so a 401 is handled as everywhere; a Confirm that answers late tells the header and moves nobody; every import under way is followed in the header, each with its own toast and report; members limited to some projects see only the vocabularies of a project; the import address of a member who may not import is replaced by the page |
| 10. Keyword metrics | Matching the filters never names the rows of the previous filters, and a failed later page has its own reason; the dialog freezes its start choice and keeps its choices while it closes; after `keyword_unknown` the list is read again and the chosen keywords that left it are dropped, so the retry goes through. The poll for first metrics follows cursors in client mode (at most 5 pages) and reads the visible page again in server mode, counts only visible time and reads at once when the tab is shown. Runs a reload found show at once, are let go of after a 403 or five failed reads, say when queued too long and are reported once across remounts; the start of a refresh is announced |
| 11. Schedules and keyword defaults | Selector members are kept only when a schedule already named groups, and a rename never rewrites a selector the form cannot show whole; the delete sentence no longer invents a count of keywords; one guard and one question serve both unsaved forms of General; the start time takes a keypad with a colon; groups and terms wait for their lists; focus returns to the right place; toasts name a foreign time zone; Add keywords opens on the saved default device |
| 12. Costs and runs | Runs: a no-access state for members without `data:read`, focus back to the grid after the cancel question, a poll of the open runs alone that no longer flashes the table or reads every page again, the project's time zone named, the held tasks kept when one poll fails, and the cancel reason as the API's code. Costs: a stable chart option, a UTC day hook for tabs left open overnight, a retry and a notice for the provider filter, a failed budget shown in the summary, a project row's budget named and matched to the workload filter, the month in the chart summary. The Runs link in the project switcher carries the project, Enter on an empty actions cell opens nothing, and the budget meter reads its real share |

Whole-branch review of Task 13 (2026-10-06), part 1 (shared infrastructure, and the app against the backend as built), fixed before merge. Two findings were critical and reproduced in scratch tests. The Rankings list in client mode could stop loading for good when a page arrived in the same notification batch as its fetching state (a hidden tab does it every time), and a write made during that background load was cancelled and lost from the table; the effect now follows the page count and the fetching flag and never cancels a fetch in flight, and the regression tests slow the query library's notifier. Also fixed: closing an inspector the page had opened went back to a page address from before it opened and undid filter and view changes made meanwhile; the whole list was read again, up to 50 requests, on every window focus, save and remount (it is fresh for 5 minutes and a saved keyword is patched into the cached lists); a hidden tab ended an import's reading phase as slow, and Start again cancelled an import that was ready; past 2,000 runs an ended run stayed Running and the poll never stopped; first metrics did not reach rows older than the newest 1,000 after a large import; a server page kept the scroll of the one before; the import dialog's code loaded with every Rankings visit; the new workspace routes had no loading or error state. Against the backend as built: Move to group could be refused by the bulk update's link cap (the cap counts every group named, and the mock did not apply it); the header followed metrics runs the system starts for new keywords and runs of other members; an import that failed while writing refreshed nothing and said to import again though earlier batches were written and the report was kept; four import row reasons (`repeated_in_file`, `tracked`, `casing_differs`, `archived`) and six invalid-row codes had other names or no words, and the mock took a bad intent or funnel stage as valid; run reasons `missed_window` and `not_planned` showed as raw codes; the depth dialog offered a profile the next backend step refuses; Costs named an archived project deleted; search text and a paste could exceed the API's limits. The mocks were aligned to the backend on import statuses and links, the moment a budget blocks a refresh, the costs range and project checks, `pct_used` of a zero limit and the `manual_run_limit` problem.

Part 2 (consistency, accessibility, design system, duplication), fixed before merge. The bulk bar no longer clips its actions at common desktop widths: those that do not fit go into a More actions menu. A header's definition and a cell's reason are the focused cell's description and open as its tooltip from the keyboard, and a Rankings row is named by keyword, device and location. A Runs search that finds nothing is a search state with Clear search. An inspector is never titled by an empty heading and its More menu is named after its record. Unarchive asks above 100 keywords, Archive and Unarchive are neutral, and an import's start is announced. Dialogs opened from a menu give focus back to that menu's button (tested), and a refresh counts "read" as succeeded in its bar and its toast. Copy has one wording for permission, plan limit, device, quotes, chip hints and counts. Manage groups and server paging controls stay focusable and say why, and the time columns name their zone. Costs and Schedules show the request id, and a failed region of Costs is announced. The dark theme pass covers Costs, Runs and Schedules, a 375 px pass covers the four list pages, and the Rankings dialogs are checked with axe. Duplicates removed: one plain table (Costs and Schedules), one hook for the error id, one month select, one reader of an enum filter, one set of depth names, one plan limit sentence and one set of chip hints. Left: followed work is still tracked in component state for imports and in the query cache for refreshes (plan, Task 4 as built).

Decisions that changed the specification, as "As built (keywords UI, step 5 part 1)" notes: doc 20 sections 5.3, 5.3.1, 5.16, 5.18 and 5.19, doc 11 sections 1 and 5, and doc 25 section 23 (deviations 132 to 140, and 141 to 143 of the second part of the review).

Carried (F85 was carried here and is fixed: the chart's grid now holds the axis labels, checked by rendering the same option before and after, so `30,000` starts inside the card):

| Id | Item | Plan |
|---|---|---|
| F82 | The browser's Back on an inspector with unsaved changes is not caught: it is the documented limit of `useLeaveGuard` | when the router offers a hook for history navigation |
| F83 | The metrics refresh sends no `Idempotency-Key`: the contract does not declare the header and no write of this app sends one | 10 (launch hardening), with F74 |
| F84 | The import's Confirm step counts every duplicate as one that merges, though rows that repeat an earlier row of the file are always skipped: the counts do not tell them from tracked duplicates, so the number is an upper bound (the Review step says so) | when the API counts repeated rows apart |
| F85 | The y-axis labels of the inspector's "Search volume by month" chart are cut at the left edge (a label such as `30,000` reads `0,000` in the 400 px card): the grid padding in `lib/charts/category-chart.ts` is too narrow for five-digit values. Seen in the keyword inspector's visual spec. Fixed on 2026-10-06: the grid padding is now the outer edge of the axis labels (`outerBoundsMode: 'same'`, `outerBoundsContain: 'axisLabel'`), so the plot shrinks to the width of the labels. Visual check: the same option rendered with the SVG renderer put the right edge of the y labels at 32 px before (the label `30,000` starts at about -9 px) and at 44 px after (it starts inside the card). The inspector's visual baseline waits for F86 | fixed |
| F86 | The visual specs for Rankings, its inspector, the import's Review step, Costs and Runs have no baselines yet: they are made only in the pinned Playwright image (`pnpm e2e:visual` inside it) and no baseline is committed | the first run of the visual suite in the image |
| F87 | The full list of a run's `status_reason` codes is not in doc 19 section 3.11.4 (`missed_window`, `not_planned`, `budget_exceeded`, `cancelled_by_user`, `project_not_collecting`, `workload_unavailable`), and a run's `failed` status is never produced by the backend, which closes runs as `completed_with_errors` | the backend's next documentation pass |
| F88 | The bulk update's link cap (`min(20000, 200000 / links)`) counts every group id named, also those that change nothing, so Move to group in a project with many groups needs smaller batches than the work requires | when the backend counts only real changes, or never |
| F89 | When `backend/rank` lands, tracked keyword rows gain a required `state` (the typed mock factories will fail `tsc`), the list gains `include` options, twelve filters and four sorts, and the three rank columns can be built | step 5 part 2 (rank collection) frontend plan. **Closed** by `docs/superpowers/plans/2026-10-06-rank-columns-ui.md` (2026-10-06): the mocks carry a derived rank state with the twelve filters, four sorts and the new `include` values; Rankings shows Rank, Change, Ranking URL, Best rank and Updated, three filters (`rank`, `chg`, `stale`) and fills a new keyword's first check in while the page is open. The other filters (`feature_present`, `feature_owned`, `aio_state`, `ranking_url_id`, `target_url_match`), the sparkline, SERP features, AI Overview, competitor columns and the metric strip are separate plans |
| F90 | Two bulk and refresh details stay as built: an analyst (`runs:trigger` without `keywords:write`) cannot refresh "the selection", since choosing rows needs `keywords:write`; followed work is tracked in component state for imports and in the query cache for refreshes | when either changes |

Review of the rank columns (2026-10-06, plan `docs/superpowers/plans/2026-10-06-rank-columns-ui.md`, branch `frontend/rank-columns`), an independent review on the Opus model, fixed before merge, each with its test first. A stale rank had no cue below 1680 px, where Updated is hidden: the Rank cell now carries a clock for it, and a warning when checks after the last good one failed (the API keeps `current` and only counts the failures). A failed row told three stories (Rank warning, URL "Pending", Best rank "Not ranking", Change "first check"): one rule now, and the never-succeeded keyword is stale from its creation, as in the backend. The Change type could be shrunk by the width resolver below its header (84 px minimum). A long ranking URL was cut twice; its end now always shows. The first-check poll no longer runs for old keywords of a paused project. Rows that tie on a sort come in row id order in client mode as the API orders them. "Select all N matching" counts the matches again just before a delete, archive or change by filter and stops when they changed. The tests of the wider Rankings grid get longer limits. A link naming several values of a single-choice chip was already reported by the hook; tests pin it. Also: copy (a change tooltip sentence, "Freshness: Stale", the previous rank in the tooltip, no repeated "not in the top 20", "no change within the depth checked"), archived mock keywords stop being checked, and a marker wraps with its date. Decisions that changed the specification are noted in doc 20 section 5.3 and doc 25 deviations 144 and 145.

### Rank collection (2026-10-05)

Plans `docs/superpowers/plans/2026-10-05-rank-collection.md` and `2026-10-05-rank-ingest.md`, branch `backend/rank`. Each task was reviewed on the Opus model before the next began.

| Task | Found and fixed |
|---|---|
| 1. Schema | Review fixes in the commit "Rank schema review fixes": the snapshot identity key, the feature type on events, size limits and indexes |
| 2. Parser | Review fixes in "SERP parser review fixes": payload size as the database counts it, text cleaning, lenient reads, citation kinds, local pack blocks and People Also Ask sources |
| 3. Rank rules | The debounce let a daily depth-20 check declare a keyword last seen at 45 lost (the state now keeps `last_ranked_rank`, R16a); a weekly deep check ended or hid a debounce run; page-one features changed with the depth of the check; the AI Overview was counted as owned; a grouped sub-result got its own rank |
| 4. Ingest | A device and operating system that do not belong together failed the whole batch (now that task only); an error that may mend (storage, a write that cannot be made now) was told apart from a payload that is unreadable for good, so the first waits and the second ends the task with its reason (R20) |
| 5. Workload | A weekly profile away from its weekday made an empty new-keyword run again every minute; a cancelled run counted as the day's check for other schedules (the check is judged by the task, not the run); an archived keyword was still sent after it was planned; one keyword the provider would refuse took its batch down |
| 6. End to end | Proved a new keyword is checked with nobody asking, a due schedule checks each keyword once however often the provider relists it, and a lost submission answer is found and ingested once |
| 7. Rank state on tracked keywords | A grouped URL raised `KeyError` in the rows; the filters could disagree with the values the row showed (the label rule is one `CASE`, kept equal to the Python rule by a test over a grid); removed competitors and the own-series index were fixed in "Rank state API review fixes" |
| 8. Rank routes | The rank-events route did not check that the project exists (caught by the cross-tenant suite); the history window was built from a dict with the wrong key and answered 500; the failed-checks query scanned the whole ledger; a summary could describe a competitor instead of the project; live keywords and projects, raw inline and event dates were fixed in "Rank routes review fixes" |
| 9. Check now | A live search that failed could be tried four times and paid each time (now twice at most; the cost event is still open, F78); the quota count read tasks and waiting runs in two statements, so a run the planner committed between them counted zero times (now one statement); check now without a depth went to depth 100 on the deep weekday (now the daily depth); a shallow check now cancelled that day's scheduled check, including the weekly deep one (a check now no longer stands for the day's check); the API accepted keywords the worker would never plan (other engines, a profile not offered, a keyword over 700 characters) and answered 202 for a run of no tasks; a Redis outage in the pause check gave a 500; the worker did not validate the selector (depth and number of keywords); `RunDetail.results` was missing |
| 10. Cost checks | Built with tests; the first version stored timestamps in a form Redis readers could not parse (now ISO) |

Decisions that changed the specification, as "As built (step 5, rank collection)" notes: doc 04 (the rank tables and a live task), doc 06 (the live endpoint, fetch and ingest), doc 09 (the rank rules), doc 10 (features on page one, the AI Overview as cited), doc 12 (the path of the SERP types), doc 19 (rank state, rank routes, check now), doc 21 (the ingest tick, the first rank check, account jobs, live SERP), doc 26 (the tag pattern), doc 27 (SERP prices and reconciliation), docs 29 and 31 (status).

Carried:

| Id | Item | Plan |
|---|---|---|
| F78 | (widened) A live call that was paid for but failed, for Labs and now for a live SERP search, writes no cost event, so budgets and the check-now quota do not see it. Live SERP is tried twice at most meanwhile. Carry an estimated cost on a failed live result and write it with the failure | the next live workload, or launch hardening |
| F91 | The live estimate adds no asynchronous AI Overview surcharge, but the live body still asks for it. If DataForSEO bills it, estimates are low by about one page a task. Settle with spike S-01, then seed a live surcharge row or send `load_async_ai_overview: false` | S-01 |
| F92 | F48: the dispatcher claims by `scheduled_for` only, so after a provider pause check-now tasks wait behind a project's overdue scheduled backlog. Order the claim by priority first | launch hardening |
| F93 | Check now: the quota counts failed tasks that never left (an invalid request, a request that could not be built); `collection_tasks` has no index on workspace and endpoint, so each count scans the month's partition (a partial index on `(workspace_id, created_at)` for the live endpoint fixes it); the live call id is dropped, so live snapshots have no `provider_task_id`; live cost events say `price_unit = 'item'` where `task` is meant | launch hardening |
| F94 | Check now has no `Idempotency-Key` (as F74) and no `Retry-After` on the `202`; its budget is judged when the run is planned, so `budget_blocked` appears on the run, not in the `202` (doc 19 says it is in the 202) | launch hardening, with F74 |
| F95 | Top 100 events and numeric changes between ranks 21 and 100 cannot fire in the `standard` profile (the state would need the previous deep check); a citation change across a check where the AI Overview did not load is not reported | a product decision |
| F96 | `balance_check` and `cost_reconcile` keep their readings in Redis, raise no `ops.platform_alerts` row and ping no Healthchecks check; the account's day is taken as UTC, and spend after the last reading of a day is not in that day's comparison (up to 15 minutes) | the operations step (doc 25) |
| F97 | Every SERP fixture and the live answer shape (taken to equal `task_get/advanced`) are synthetic until spike S-01 captures real ones; re-run the parser tests on the captured set before the first deploy | S-01, before deploy |
| F98 | The competitor backfill from stored snapshots and `ops.derivation_log`, the shared fetch cache, the data quality tables, `ops.task_attempts`, the load test on recorded payloads and the real 14-day run were deferred (plan R14) | steps 6 and 7 |
