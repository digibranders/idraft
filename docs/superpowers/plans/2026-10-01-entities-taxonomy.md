# Brands, Entities, Domains, Locations and Taxonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task ends with: gates green (`backend/check.sh`), an independent review on the Opus model, fixes, commit.

**Goal:** The shared vocabulary that SEO and AI both judge against: a project's own brand and competitors with their aliases and domains, the locations collection can target, and the taxonomy keywords and prompts will be filed under; with the URL canonicalizer, the domain role resolver and the alias matcher that later ingest and extraction use, and an alias test that shows today what extraction will count.

**Architecture:** Step 4 of the build order (`docs/29-phase-roadmap.md` section 1.1, Phase 2), specified in `docs/04-data-model.md` sections 5.1 to 5.3 and 6, `docs/19-api-specification.md` sections 3.2.5, 3.3, 3.4 and 3.5, `docs/14-citation-intelligence.md` sections 3 and 4, and `docs/13-ai-extraction-engine.md` stages 1, 2, 4 and 5. The canonicalizer, resolver and matcher are pure code in `sightline.extraction` (no database, no I/O, enforced by import-linter). Routes follow the projects and workspaces packages: `routes.py`, `service.py`, `repository.py` per resource, every write in a workspace transaction under row-level security, every change in the audit log.

**Tech stack:** `tldextract` with its bundled Public Suffix List and no network (private domains on), `idna` for hosts, `pyahocorasick` for the alias automaton, `google-re2` for user-entered patterns. All four were checked to install and run on Python 3.13.

---

## Scope

Built here: tables for domains, domain categories (seeded), locations and their provider map, entities, aliases, entity domains, project entities, a project domain roles view, taxonomy vocabularies and terms; the routes of doc 19 sections 3.4 (Phase 2 rows) and 3.5 (except term assignments), `GET /api/v1/locations`, `GET /api/v1/domain-categories`, `GET {P}/domains`; `primary_domain`, `default_location_id` and `own_entity` on project create and change; the canonicalizer v1 with doc 14's test vectors, the domain role resolver, text normalization with an offset map, the alias automaton and its disambiguation score; `POST {P}/alias-test`; the DataForSEO location sync (client call, job, monthly schedule, a command to run it once).

Not here, and where it arrives:

| Item | Arrives with |
|---|---|
| `core.urls`, `core.url_remap` (first written by SERP ingest) | step 5 |
| `{P}/term-assignments`, and `keyword_count` and `prompt_count` on terms | step 5 (keywords), step 8 (prompts); the counts are left out of `TermNode` until then |
| `meta.rederivations` (re-derivation after entity changes), `meta.backfills` (competitor rank backfill) | steps 8 and 5; `entity_config_version` is bumped here |
| `alias-test` with `observation_id`, and the disambiguation signals that need answer structure, citations or the prompt (list position, cited domain, prompt hint) | step 8 |
| `core.publishers`, `core.publisher_domains`, `core.workspace_domain_categories`, domain classification rules | step 11 (source intelligence) |
| Competitor suggestions, entity candidates | steps 7 and 8 |
| Locations for the AI surfaces (`llm_scraper`, `ai_mode`) | step 8 |

## Decisions

- **D1. Global dictionaries are written by both roles, listed by neither.** `core.domains`, `core.locations` and `core.provider_location_map` have no workspace and no row-level security. `app_api` may `SELECT` and `INSERT` domains (an entity domain or a primary domain creates its host row); locations are written by the worker's sync only. No route lists domains; locations and domain categories are the registries of doc 19 section 3.2.5.
- **D2. Every tenant table carries `workspace_id`.** `core.entity_domains` gets the column doc 04 left out, so row-level security applies to it like to the others (doc 04 updated).
- **D3. `core.project_domain_roles` is a view, not a materialized view.** A materialized view cannot have row-level security, so the API could read every workspace's rows through it. A view with `security_invoker = true` applies the base tables' policies to whoever reads it. Ingest (step 5) keeps its own in-process cache; if it needs a materialized view, it gets one then, readable by the worker only.
- **D4. The canonicalizer is the one doc 14 specifies, in Python.** Doc 14 names TypeScript paths from before ADR-022; the rules, list v1 and test vectors are taken as written. The Public Suffix List is the snapshot bundled with the pinned `tldextract`, so upgrading `tldextract` is a canonicalizer version change.
- **D5. Offsets are into the text as sent.** The alias test highlights the text the caller gave; markdown is matched as its source text (stage 3 block parsing arrives with extraction, step 8).
- **D6. The alias test scores what text alone can tell.** Stage 5 signals available from text: a disambiguation hint within 40 tokens (+0.35), a capitalized span mid-sentence (+0.15), a lowercase span of a normally capitalized name (-0.25). Base 0.30 for ambiguous entities and aliases that require context, 0.95 otherwise; accepted at 0.70, uncertain from 0.40. The other signals arrive with extraction and are documented as such in the response.
- **D7. A change to an entity bumps every project that uses it.** Any write to an entity, its aliases, its domains or a project role increments `core.projects.entity_config_version` for each project with the entity attached (removed roles included, since their history is read), in the same transaction.
- **D8. Locations come from DataForSEO's free list.** `GET /v3/serp/google/locations` gives every location code with its parent, country and type; the sync upserts `core.locations` (id = location code, doc 04 section 5.2) and `core.provider_location_map` with `supports = {serp}`, deactivates codes no longer listed, and runs monthly and on demand (`python -m sightline.worker.sync_locations`). Without DataForSEO credentials there is nothing to sync and the list is empty.

## File structure

| File | Responsibility |
|---|---|
| `backend/src/sightline/db/migrations/versions/0010_entities_taxonomy.py` | The tables, the view, seeds, policies and grants; foreign keys from `core.projects` |
| `backend/src/sightline/db/tables.py` | Their metadata |
| `backend/src/sightline/extraction/urls.py` | The canonicalizer v1 and host normalization |
| `backend/src/sightline/extraction/domains.py` | Domain role resolution (stage 2) |
| `backend/src/sightline/extraction/text.py` | Normalization for matching, with an offset map |
| `backend/src/sightline/extraction/aliases.py` | The alias automaton, matching and disambiguation score |
| `backend/src/sightline/api/entities/{routes,service,repository}.py` | Entities, aliases, entity domains; project entities, project domains, alias test |
| `backend/src/sightline/api/taxonomy/{routes,service,repository}.py` | Vocabularies and terms |
| `backend/src/sightline/api/registries.py` | Locations and domain categories |
| `backend/src/sightline/api/schemas/{entities,taxonomy,registries}.py` | Request and response models |
| `backend/src/sightline/providers/dataforseo/locations.py` | The locations call |
| `backend/src/sightline/collectors/locations.py` | The sync |
| `backend/src/sightline/worker/{assembly,sync_locations}.py` | The monthly job and the one-off command |

## Tasks

### Task 1: Schema

- [ ] Tests first: the metadata matches the migrated schema; every tenant table has the tenant policy and its grants (the catalog and grant matrix tests); a domain category seed of the 15 codes of doc 14 section 4; one primary own entity per project (partial unique index); the view shows a workspace only its own rows, as `app_api`; `core.projects.primary_domain_id` and `default_location_id` refer to their tables.
- [ ] Migration 0010, `tables.py`, doc 04 (the `workspace_id` of `core.entity_domains`, the view, D1).
- [ ] Gates, Opus review, fixes, commit.

### Task 2: Canonicalizer and domain resolver (pure)

- [ ] Tests first: doc 14's six test vectors and one per rule (each redirector, each tracking parameter, `si` only on its hosts, the referral tag, dot segments, percent-encoding, trailing slash, `m.wikipedia`, `amp`, IDNA, default ports, IP hosts, rejected schemes); properties (idempotent, the hash ignores the scheme); host input for entity domains (`Acme.COM.`, `https://www.acme.com/x`); resolver specificity (path prefix over host over registrable, `own` wins a tie with a warning).
- [ ] `extraction/urls.py`, `extraction/domains.py`, dependencies.
- [ ] Gates, Opus review, fixes, commit.

### Task 3: Alias matching (pure)

- [ ] Tests first: normalization keeps an exact offset map (NFKC, case fold, diacritics, curly quotes and dashes, zero-width, whitespace); each match mode; word boundaries with possessives and plurals; overlap (longest wins), negatives, products counting toward their parent (`via_product`), domain-shaped aliases (`alias_domain`); regex through RE2 (an invalid pattern is refused, a pathological one is linear); the score and status of D6; a property that every span's offsets slice the original text to something that normalizes to the alias.
- [ ] `extraction/text.py`, `extraction/aliases.py`.
- [ ] Gates, Opus review, fixes, commit.

### Task 4: Entities, aliases and entity domains

- [ ] Tests first: create with aliases and domains in one request; list with filters and cursor; detail; change; delete only when never attached (`409 entity_in_use`); duplicates (`409 duplicate`); aliases singly and in batches of up to 200, `422 invalid_regex`; entity domains canonicalized, `domain_role_conflict` warning; every change audited and bumping `entity_config_version` of the projects using the entity; another workspace's entity is `404`; permissions (`data:read`, `entities:write`).
- [ ] `api/entities/`, `api/schemas/entities.py`, router registration, doc 19 notes (what is left out, D5, D6).
- [ ] Gates, Opus review, fixes, commit.

### Task 5: Project entities, project domains, alias test, project fields

- [ ] Tests first: attach with a role, one primary own (`409 primary_own_exists`), more than 10 SEO competitors (`422 competitor_limit`), change, remove keeps history (`409 cannot_remove_primary_own`); `GET {P}/domains` from the view; the alias test over a project's entities with spans, statuses and negatives applied, `413` over 100 KB, `observation_id` refused until step 8; project create with `primary_domain`, `default_location_id` (must exist) and `own_entity` (entity, domains, aliases, primary own role, one transaction).
- [ ] The routes, the project service changes, doc 19 "what is accepted today".
- [ ] Gates, Opus review, fixes, commit.

### Task 6: Taxonomy

- [ ] Tests first: vocabularies workspace-wide and per project, list with `filter[project_id]` including workspace-wide ones, duplicates, delete cascading; terms as a tree and flat, `filter[q]`, slugs generated and unique among siblings, batch of up to 500 with `path` strings creating missing parents, move recomputing the subtree's paths, `422 cycle_detected`, delete with and without `cascade` (`409 has_children`); `is_single_valued` change allowed (no assignments exist yet); permissions (`taxonomy:write`).
- [ ] `api/taxonomy/`, `api/schemas/taxonomy.py`.
- [ ] Gates, Opus review, fixes, commit.

### Task 7: Locations and registries

- [ ] Tests first: the DataForSEO call reads the documented answer (synthetic fixture); the sync upserts, sets parents, deactivates what is gone and is safe to run twice; `GET /api/v1/locations` filters by text, country, type and `supports`, with a cursor; `GET /api/v1/domain-categories`; the monthly job is on the scheduler's list and does nothing without credentials.
- [ ] `providers/dataforseo/locations.py`, `collectors/locations.py`, `api/registries.py`, the job and the command.
- [ ] Gates, Opus review, fixes, commit.

### Task 8: End to end and docs

- [ ] The onboarding flow through the API (doc 29 Phase 2 acceptance): a project with an own brand and domains and 5 competitors; the alias test on sample answers; locations searchable after a sync against the fake DataForSEO. Cross-tenant and permission coverage for every new route. OpenAPI regenerated.
- [ ] Docs 04, 13, 14, 19, 21, 29, 31, review log, README.
- [ ] Whole-branch Opus review, fixes, commit.
