# 11. AI Prompt System

Status: Draft for architecture freeze
Last updated: 2026-09-29
Related: [04-data-model.md](04-data-model.md) section 8.2, [07-dataforseo-ai-integration.md](07-dataforseo-ai-integration.md), [13-ai-extraction-engine.md](13-ai-extraction-engine.md), [16-metrics-methodology.md](16-metrics-methodology.md), [17-statistical-methodology.md](17-statistical-methodology.md), [15-seo-ai-correlation.md](15-seo-ai-correlation.md)

A prompt is a measurement instrument. If the instrument changes silently, the trend line is meaningless. This document defines how prompts are created, versioned, grouped into panels, discovered, linked to keywords, and scheduled.

## 1. Prompt model

| Field | Column | Purpose |
|---|---|---|
| Text | `ai.prompt_versions.text` | Exactly what is sent (with optional `context_preamble`) |
| Topic, subtopic, cluster, product, persona, tags | `ai.prompt_terms` | Shared taxonomy with keywords |
| Intent, funnel stage | `ai.prompts.intent`, `funnel_stage` | informational, commercial, transactional, navigational, local; tofu/mofu/bofu |
| Prompt type | `prompt_type` | question, comparison, recommendation, how_to, definition, local, transactional, other |
| Language, country | `language_code`, `country_iso` | Market the prompt represents; must map to engine-supported locations |
| Device | engine-level (`ai.project_engines.provider_params.device`), not per prompt | Consumer scrapers run desktop sessions; AI Mode supports device |
| Branded | `is_branded` | Computed at save (own-brand alias match in text), overridable. Branded prompts are excluded from default visibility metrics |
| Importance | `importance` 1 to 5 | Importance 1 = **priority subset** (extra replicates) |
| Expected frequency | `expected_frequency` | daily, weekly, monthly |
| Source, creation method | `source`, `creation_method` | Provenance (manual, gsc_query, paa, llm_variant, ...) |
| Panel membership | `ai.panel_memberships` | Core, discovery, experiment, custom, with history |
| Version | `ai.prompt_versions` | Immutable text per version |
| Active | `is_active` | Inactive prompts are not scheduled; history stays |

## 2. Versioning rules

1. **Text is immutable per version.** Any change to `text` or `context_preamble` creates a new `ai.prompt_versions` row. `prompts.current_version_id` points to the version that will be scheduled next.
2. **Observations reference the version**, not just the prompt. Metrics for a prompt over a window use all its versions, and the response carries version boundaries for charts ([17-statistical-methodology.md](17-statistical-methodology.md) section 9).
3. **Change kinds** (`change_kind`): `wording` (meaning may change), `typo` (no intended change in meaning), `context` (persona preamble changed), and restore (back to an earlier text), which creates no new row: the unique `text_hash` constraint prevents a duplicate version, so restore re-points `current_version_id` to the earlier version and writes an audit log entry.
4. **Core panel protection.** Prompts in a locked core panel can only get a new version from an `admin` with a written reason; the UI warns that the series will show a break. `typo` changes are allowed for `editor` but still create a version.
5. **Metadata changes are not versions.** Changing tags, topic, intent or importance does not create a version; these are descriptive. They are audit-logged.

## 3. Panels

| Panel type | Purpose | Stability rules |
|---|---|---|
| **Core** (one per project) | Longitudinal measurement: trends, competitor tracking, before/after, experiments baseline | Locked by default. Membership changes need `panels:core:modify` and a reason; a warning appears when more than 10% of the panel changes within 90 days. Membership history (`valid_from`, `valid_to`) is used by every window metric |
| **Discovery** | Rotating exploration: new questions, candidate topics, fan-out-derived prompts | Free to change. Runs monthly by default, 1 replicate |
| **Experiment** | A fixed prompt set for a content experiment (treatment topic) with a matched control set | Frozen for the experiment's duration (Phase 15) |
| **Custom** | Client-specific reporting sets | No special rules |

A prompt can belong to several panels. It is observed once per cycle even if it is in two panels scheduled the same day (planner dedupes by prompt version, engine, location, replicate, and run window).

### 3.1 Promotion from Discovery to Core

Candidates for promotion are discovery prompts that meet all of:
- at least 3 valid observations per enabled engine in the last 90 days,
- at least one tracked entity (own or competitor) mentioned in at least 30% of observations (the prompt is informative: an answer that names nobody cannot show competitive movement; idea borrowed from Lettertrace, MIT, `research/06-open-source.md`),
- not branded,
- not a near-duplicate of an existing core prompt (trigram similarity < 0.8 on normalized text).

Promotion is a user action (`panels:core:modify`), recorded with reason, and takes effect from the next cycle. History from the discovery period stays attached to the prompt and is shown before the core membership start with a marker.

### 3.2 Panel sizing guidance

Shown in the panel settings screen, using the formulas in [17-statistical-methodology.md](17-statistical-methodology.md) section 7:

- "With 250 prompts and the measured flip rate of 22% on ChatGPT, this panel can detect a change of about 9 points in weekly mention rate."
- Recommended core sizes: 150 to 300 prompts per major topic for weekly trend detection; 1,000 prompts across topics for a mid-size brand.

## 4. Prompt design guidelines (enforced by lint rules in the editor)

| Rule | Why | Enforcement |
|---|---|---|
| Non-branded prompts must not contain own or competitor aliases | Otherwise mention is guaranteed | Auto-detect; prompt becomes branded or the user edits |
| Avoid leading wording ("Why is Acme the best CRM?") | Measures agreement, not visibility | Warning on superlative + brand patterns |
| One question per prompt | Multi-question prompts produce mixed answers and ambiguous lists | Warning on multiple question marks |
| Include the decision context when it matters ("for a 20-person SaaS startup") | Real buyer prompts are contextual; context changes recommendations | Suggestion |
| Persona context goes in `context_preamble`, not mixed into the question | Lets reports group by persona and lets the question text stay comparable | Editor field |
| Length: 5 to 60 words for question text; hard limits per engine (ChatGPT scraper 2,000 chars, AI Mode 700, LLM Responses 500) | Engine limits and realism | Validation |
| Language matches `language_code` | Mismatch confuses engines and extraction | Language detection warning (`franc` library) |

Four standard intent variants per topic idea (pattern from AEO Radar, MIT): **recommendation** ("What's the best X for Y?"), **comparison** ("X vs Y for Z?"), **how-to/tutorial** ("How do I do T with a tool?"), **procurement** ("What should I consider when buying X?"). The prompt generator offers these as templates.

## 5. Prompt discovery

### 5.1 Sources

| Source | How candidates are produced | Phase |
|---|---|---|
| SEO tracked keywords | Templates and LLM rewriting into natural questions (section 5.3); linked back with `link_type = 'generated'` | 11 |
| Keyword discovery inbox | Same, from accepted candidates | 11 |
| Google Search Console queries | Question-shaped or long (>= 5 words) queries with impressions; used verbatim or rewritten | 11 (basic), 12 |
| Bing Webmaster queries and Bing AI "grounding queries" (imported export) | Verbatim candidates, labeled by source | 12 |
| People Also Ask questions | From stored SERP features; already question-shaped | 11 |
| Autocomplete, related searches | From discovery calls and stored features | 11 |
| Competitor keywords | From Labs `ranked_keywords` via the keyword inbox | 11 |
| Site crawl / FAQ pages | Extract questions from FAQ blocks and headings on owned pages | 15 |
| Customer FAQ, support and CRM questions | CSV upload of questions (text only; users must strip personal data; the uploader warns and we do not store uploader files beyond 30 days) | 11 |
| Query fan-out | ChatGPT fan-out queries are search queries, not prompts. They are candidates for **keywords** (keyword inbox) and for grouping; a fan-out query that is question-shaped can also be a prompt candidate | 11 |
| DataForSEO LLM Mentions questions | Questions where competitors are mentioned (third-party dataset; US English ChatGPT and AIO) | 13 |
| Modeled AI demand | Used only to **rank** candidates (doc 07 section 8) | 11 |

### 5.2 Prompt candidate inbox

```sql
CREATE TABLE ai.prompt_candidates (
    id                 uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id       uuid NOT NULL,
    project_id         uuid NOT NULL REFERENCES core.projects(id) ON DELETE CASCADE,
    text               text NOT NULL,
    normalized_text    text NOT NULL,
    language_code      text NOT NULL,
    country_iso        char(2),
    source             text NOT NULL,           -- same enum as ai.prompts.source
    source_ref         jsonb NOT NULL,          -- keyword id, gsc query hash, serp snapshot id, observation id, upload id
    generation         jsonb,                   -- for llm_generated: model, prompt template version, seed keyword
    suggested_terms    uuid[] NOT NULL DEFAULT '{}',
    suggested_intent   text,
    linked_keyword_ids uuid[] NOT NULL DEFAULT '{}',
    ai_demand_estimate integer,                 -- modeled; labeled
    gsc_impressions_28d integer,
    near_duplicate_of  uuid,                    -- existing prompt id if similarity >= 0.8
    status             text NOT NULL DEFAULT 'new' CHECK (status IN ('new','accepted','rejected','snoozed','added')),
    snoozed_until      timestamptz,             -- set with status 'snoozed'; the candidate returns to 'new' after it
    decided_by         uuid,
    decided_at         timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, normalized_text, language_code, country_iso)
);
```

Inbox actions mirror the keyword inbox: accept, reject, snooze, edit text, assign terms and intent, **add to discovery panel** (default), add to core (admin), link to keywords.

### 5.3 Keyword-to-prompt generation

1. **Templates first** (free, deterministic): for keyword k with intent i, apply the intent's template set. Example for commercial "best crm for startups": "What is the best CRM for startups?", "Which CRM should a 20-person startup use?", "What are the best alternatives to HubSpot for startups?" (competitor name from the project's competitor list only when the user enables comparison templates), "Recommend a CRM for a SaaS startup."
2. **LLM variants** (optional, budgeted): a cheap model generates up to 5 natural variants given keyword, intent, persona, and language, with instructions to avoid brand names unless comparison is requested. Output validated (language, length, no own-brand alias unless allowed), near-duplicates removed (trigram similarity >= 0.8 against each other and existing prompts).
3. Every generated candidate records `creation_method` (`template` or `llm_generated`), the template or model version, and is linked to its seed keyword with `link_type = 'generated'`.

**Honesty rule:** generated prompts are plausible phrasings, not observed user prompts. The UI never shows a volume figure for them except the labeled "Modeled AI demand" of the seed keyword.

## 6. Keyword and prompt linking

Keywords and prompts are separate entities with a many-to-many link (`core.keyword_prompt_links`, [04-data-model.md](04-data-model.md) section 9).

| Link type | Created by | Status on creation |
|---|---|---|
| `exact_match` | A prompt created from a keyword with identical normalized text (for example a keyword-like prompt "crm for startups") | active |
| `generated` | Section 5.3 | active |
| `manual` | User | active |
| `cluster` | Keyword and prompt share a `cluster` term | suggested |
| `semantic` | Token-set Jaccard >= 0.5 on normalized, stopword-stripped text, or trigram similarity >= 0.6 (V1); embedding similarity later | suggested |
| `ai_suggestion` | LLM proposes links for unlinked prompts (budgeted, Phase 11) | suggested |
| `fanout` | A prompt's ChatGPT fan-out query matches a tracked keyword (exact normalized) in at least 2 observations | suggested |

Suggested links need one click to activate. Only active links feed the SEO/AI matrix. Each prompt has at most one `is_primary` link, used when a single keyword must represent the prompt in a table.

Keyword-level AI visibility does not require prompts: AI Overview observations are keyed to tracked keywords directly, and `ai_mode_keyword` runs AI Mode on tracked keywords. Prompts add the conversational engines (ChatGPT, Gemini) and conversational phrasing.

## 7. AI demand estimates (labeling policy)

- The only volume-like number for prompts is DataForSEO AI Keyword Data's `ai_search_volume`, which DataForSEO describes as derived from People Also Ask statistics via a proprietary algorithm (verified 2026-09-29).
- Displayed as **"Modeled AI demand"**, with the tooltip: "A DataForSEO estimate modeled from Google People Also Ask data. It is not a count of prompts sent to ChatGPT or other assistants. No AI provider publishes prompt volumes."
- Applied to keywords (and to prompts through their primary keyword link), used for sorting and prioritization only.
- Never summed, never used in visibility formulas, never called "search volume".

## 8. Scheduling

Defaults ([07-dataforseo-ai-integration.md](07-dataforseo-ai-integration.md) section 4.2 and [21-scheduler-workers.md](21-scheduler-workers.md) section 2):

| Panel | Engines | Replicates | Cadence |
|---|---|---|---|
| Core, importance 1 (priority subset, max 100 prompts by default) | ChatGPT, Gemini, AI Mode | 3, 3, 1 | weekly |
| Core, other | ChatGPT, Gemini, AI Mode | 1 | weekly |
| Discovery | ChatGPT, AI Mode | 1 | monthly |
| Experiment | as configured | 3 | weekly or daily during the experiment |
| Benchmarks (optional) | official APIs | 1 | weekly on 100 core prompts |

Future options (configuration only, no redesign): daily for importance 1 prompts, weekly for standard, monthly for discovery.

Budget: the planner estimates each AI run and checks `ops.budgets` for `ai_prompt`. A blocked run is visible with its estimate and the budget that blocked it.

## 9. Prompt Explorer data requirements

Per prompt, the explorer needs (all from rollups and facts, never from raw text at list time):

- mention rate, citation rate, recommendation rate per engine with n and interval (28-day window default)
- four-outcome mix
- competitor mention rates and SOV
- top cited domains and pages
- fan-out queries (ChatGPT)
- linked keywords with their current organic rank and AI Overview status
- volatility (flip rate, citation Jaccard)
- answer list: each observation with engine, date, replicate, status, highlighted mentions (evidence spans) and citations
- version and panel membership timeline

## 10. AI alerts

| Rule type | Condition | Notes |
|---|---|---|
| `ai_mention_lost` / `ai_mention_gained` | prompt-engine moved from mentioned in >= 50% of the previous 2 windows to 0 in the current window (or inverse), with at least 2 observations per window | Per-prompt; labeled "possible change" unless detectability criteria are met |
| `ai_citation_lost` / `ai_citation_gained` | same logic for own-domain citation | |
| `ai_panel_change` | panel-level mention or citation rate changed with a 95% interval excluding zero (paired design, doc 17 section 6.1) | Weekly; the most meaningful AI alert |
| `ai_competitor_sov_overtake` | competitor SOV exceeds own SOV for a topic in the current window and did not in the previous | |
| `ai_new_source` | a domain crosses `min_support` citation units for the first time in a topic | Source intelligence |
| `ai_model_changed` | a new `model_reported` value appears for an engine | Info; creates a version boundary |
| `ai_collection_degraded` | valid-observation rate for an engine below 90% in a run | Ops, not visibility |

Delivery, digesting, dedupe and flapping suppression are the same as SEO alerts ([08-seo-keyword-system.md](08-seo-keyword-system.md) section 12.2).

## 11. Limits

| Limit | V1 default |
|---|---|
| Active prompts per project | 1,000 (the workspace default `max_active_prompts`, doc 04 section 4.1, governs the total) |
| Core panel size | 1,500 |
| Replicates per engine | 1 to 5 in UI (schema allows 20 for experiments) |
| Engines per project | ChatGPT, Gemini, AI Mode, AI Overview (plus optional benchmarks) |
| Prompt length | engine-specific limits in section 4 |
