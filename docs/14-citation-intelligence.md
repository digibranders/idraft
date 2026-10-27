# 14. Citation and Source Intelligence

Status: Draft for architecture freeze
Last updated: 2026-09-29
Related: [04-data-model.md](04-data-model.md) sections 5.1 and 8.4, [13-ai-extraction-engine.md](13-ai-extraction-engine.md), [16-metrics-methodology.md](16-metrics-methodology.md) section 7, [15-seo-ai-correlation.md](15-seo-ai-correlation.md)

## 1. Purpose

Citations are the part of an AI answer a publisher can influence most directly. This module answers: which domains and pages do AI engines cite for our topics, how that changes, where our own pages appear, which sources competitors benefit from, and which publishers are worth pursuing. It works across AI Overview, AI Mode, ChatGPT and Gemini, and joins to organic rankings through the shared URL dictionary.

## 2. Citation data model (summary)

| Entity | Table | Key fields |
|---|---|---|
| Citation (one URL in one answer) | `ai.citations` | observation, `citation_index` (order), `url_id`, `domain_id`, `raw_url`, title, source name, `citation_kind`, `first_char_offset`, `answer_block_index`, `occurrences`, `domain_role`, `role_entity_id`, `referral_tag` |
| Retrieved result (ChatGPT only) | `ai.retrieval_results` | url, `was_cited`, fan-out link |
| Page | `core.urls` | canonical URL, path, domain |
| Domain | `core.domains` | host, registrable domain, default category |
| Publisher | `core.publishers` (new) | organization that owns one or more registrable domains |
| Project source stats | `ai.project_source_stats` (new) | first seen, last seen, occurrence counts per project and URL/domain |
| Daily domain rollup | `ai.daily_domain_citations` | per project, date, engine, domain |

Associated brand claim (which entity a citation supports) is inferred when a citation marker sits in the same answer block as an entity mention: `ai.citation_entity_links (observation_id, observed_at, citation_index, entity_id, derivation_id, method)` with method `same_block` in V1. It is an association, not proof that the source says anything about the entity.

```sql
CREATE TABLE core.publishers (
    id              uuid PRIMARY KEY DEFAULT uuidv7(),
    name            text NOT NULL UNIQUE,       -- 'G2', 'Reddit', 'Forbes', 'Capterra (Gartner)'
    publisher_type  text NOT NULL,              -- mirrors domain categories
    parent_publisher_id uuid REFERENCES core.publishers(id)
);
CREATE TABLE core.publisher_domains (
    publisher_id       uuid NOT NULL REFERENCES core.publishers(id) ON DELETE CASCADE,
    registrable_domain text NOT NULL,
    PRIMARY KEY (publisher_id, registrable_domain)
);

CREATE TABLE ai.project_source_stats (
    project_id        uuid NOT NULL,
    workspace_id      uuid NOT NULL,
    grain             text NOT NULL CHECK (grain IN ('url','domain')),
    ref_id            bigint NOT NULL,          -- url_id or domain_id
    engine_code       text NOT NULL,            -- '*' row holds all-engine totals
    first_seen_at     timestamptz NOT NULL,
    last_seen_at      timestamptz NOT NULL,
    citation_units    integer NOT NULL,
    observations      integer NOT NULL,
    prompts           integer NOT NULL,         -- approximate distinct count maintained by nightly recount
    PRIMARY KEY (project_id, grain, ref_id, engine_code)
);
```

`ai.project_source_stats` is upserted at ingest (first/last seen, counters) and recounted nightly for exact distinct prompt counts.

## 3. URL canonicalization (canonicalizer version 1)

Canonicalization determines whether two citations point at "the same page". It is shared by SERP results, citations, first-party pages and owned-domain matching. All rules are in `backend/src/idraft/extraction/urls.py`, with the test vectors in `backend/tests/extraction/test_urls.py`.

### 3.1 Steps

1. **Parse** with the WHATWG URL parser. Reject schemes other than `http` and `https` (recorded as invalid citation with raw URL kept).
2. **Unwrap redirectors** (no network): Google `/url?q=` and `/url?url=`, Google `/goto` when the destination is present as a parameter, Bing `/ck/a` (`u=` base64 with `a1` prefix), Facebook `l.php?u=`, Reddit `out.reddit.com`, `href.li`, and Vertex AI grounding redirect hosts when their target is decodable. Undecodable wrappers are kept and flagged `unresolved_redirect`.
3. **Scheme** lowercased; `http` and `https` are both allowed. The canonical form keeps the scheme as observed; `url_hash` is computed on the scheme-less form so `http://` and `https://` versions of a page merge.
4. **Host**: lowercase, IDNA to ASCII (punycode), strip trailing dot, drop default port. `www.` is kept in `host` and grouped by `registrable_domain`.
5. **Fragment**: removed entirely, including text fragments `#:~:text=...` (added by Google AI surfaces to citation links).
6. **Query**: remove tracking parameters. List v1: `utm_*`, `gclid`, `gbraid`, `wbraid`, `dclid`, `fbclid`, `msclkid`, `mc_cid`, `mc_eid`, `_hsenc`, `_hsmi`, `hsCtaTracking`, `igshid`, `si` (on youtube.com, youtu.be, spotify.com only), `srsltid`, `yclid`, `ref` and `ref_src` (only when value is a known referrer tag), `spm`, `_ga`, `_gl`, `oly_enc_id`, `oly_anon_id`, `vero_id`, `mkt_tok`. The value of `utm_source` is recorded as `referral_tag` before removal. Remaining parameters are sorted by name; empty values dropped.
7. **Path**: RFC 3986 section 6.2.2 normalizations: uppercase percent-encoding hex, decode percent-encoded unreserved characters, remove dot segments. Empty path becomes `/`. Trailing slash removed on non-root paths (heuristic, documented as unsafe by the RFC; accepted because it merges far more true duplicates than it creates false merges; per-domain exceptions list supported).
8. **Known equivalents** (per-domain rules, v1): `m.` and `mobile.` subdomains on `wikipedia.org` map to the desktop host; `amp/` path suffixes and `?amp=1` on known publishers map to the canonical article; `youtu.be/<id>` maps to `youtube.com/watch?v=<id>`.
9. **Registrable domain** via the Public Suffix List (`publicsuffixlist`, with private domains enabled so `user.github.io` and `user.substack.com` are separate registrable domains). The PSL snapshot version is pinned and upgraded deliberately (it is part of `canonicalizer_version`).
10. `url_hash = sha256(scheme-less canonical URL)`.

We do not fetch pages to follow HTTP redirects or read `rel=canonical` in V1. That would add network cost, SSRF surface, and time-dependence to ingest. A Phase 13 option resolves `rel=canonical` for **owned** domains only, where we can trust the result, via a periodic owned-sitemap crawl.

### 3.2 Test vectors (excerpt)

| Input | Canonical URL | registrable_domain | referral_tag | flags |
|---|---|---|---|---|
| `https://www.Example.com/Guide/?utm_source=chatgpt.com&b=2&a=1#:~:text=crm` | `https://www.example.com/Guide?a=1&b=2` | `example.com` | `chatgpt.com` | text_fragment_removed |
| `https://www.google.com/url?q=https%3A%2F%2Facme.io%2Fpricing&sa=D` | `https://acme.io/pricing` | `acme.io` | | redirect_unwrapped |
| `https://en.m.wikipedia.org/wiki/Customer_relationship_management` | `https://en.wikipedia.org/wiki/Customer_relationship_management` | `wikipedia.org` | | |
| `https://alice.github.io/post/` | `https://alice.github.io/post` | `alice.github.io` | | |
| `http://ACME.co.uk:80/a/./b/../c` | `http://acme.co.uk/a/c` | `acme.co.uk` | | |
| `https://youtu.be/dQw4w9WgXcQ?si=abc` | `https://youtube.com/watch?v=dQw4w9WgXcQ` | `youtube.com` | | |

### 3.3 As built (v1)

Where section 3.1 leaves a detail open, version 1 settles it as follows. Changing any of it is a new `canonicalizer_version`.

- **Parsing.** Python's `urllib.parse` with the WHATWG behaviour the steps need written out: surrounding whitespace and embedded tabs and newlines are ignored, and backslashes before the query are slashes. A rejected URL raises `UrlRejectedError` with a reason: `unsupported_scheme` (including a missing scheme), `missing_host`, `invalid_host`, `invalid_port` or `too_long` (over 32 KiB). A port may have leading zeros.
- **Credentials** (`user:pass@`) are dropped; a canonical URL never carries them.
- **Hosts.** Percent-escapes are decoded, then UTS 46 mapping and IDNA 2008 A-labels for labels that are not ASCII. ASCII labels allow letters, digits, hyphens (not first or last) and underscores. A host over 253 characters is invalid. A host whose last label is numeric must be a dotted-quad IPv4 address; IPv6 is written compressed in brackets, and a zone id (`%eth0`) is invalid. `idna` is pinned with the PSL, since its UTS 46 tables decide hosts too. For an IP, `registrable_domain` is the address and `public_suffix` is empty. A host that is itself a public suffix (`github.io`, `localhost`) is its own registrable domain.
- **Unwrapping** repeats until no wrapper is left, so canonicalizing a canonical URL never changes it (a destination is always shorter than its wrapper, and the 32 KiB limit bounds the work). A text fragment on any level is flagged. Google means a host whose registrable domain under the ICANN suffixes alone starts with `google.` (`google.co.uk` included, `google.github.io` not); `/url` and `/goto` read `q`, then `url`. Bing's `u` is `a1` then URL-safe base64 without padding. Vertex AI grounding redirects (`vertexaisearch.cloud.google.com/grounding-api-redirect/...`) carry an opaque token, so they are always `unresolved_redirect`. A destination that is not http(s) or does not parse leaves the wrapper in place, flagged. An unresolved `href.li` link keeps no query (its query has no `=`), so all of them share `https://href.li/`.
- **Known referrer values** for `ref` and `ref_src` (compared without case): `producthunt`, `hackernews`, `hn`, `reddit`, `twitter`, `facebook`, `linkedin`, `newsletter`, `rss`, `chatgpt.com`, `perplexity`, `perplexity.ai`, and anything starting `twsrc` (Twitter embeds).
- **Query.** Names and values get the path's percent-encoding normalization; tracking names are matched without case. A parameter with an empty name or value is dropped. Sorting is by name and stable, so repeated names keep their order. `+` is left as it is.
- **Path and query encoding.** Characters RFC 3986 does not allow are percent-encoded as UTF-8 (a lone surrogate as its own code unit, `%ED%A0%80`, where a browser would write U+FFFD), and a `%` that does not start an escape becomes `%25`. Trailing slashes are all removed on a non-root path; v1 has no per-domain exceptions.
- **AMP publishers** (by registrable domain): `theguardian.com`, `cnn.com`, `bbc.com`, `bbc.co.uk`, `nytimes.com`, `washingtonpost.com`, `forbes.com`, `businessinsider.com`, `independent.co.uk`, `reuters.com`, `techcrunch.com`, `theverge.com`. On these, trailing `amp` path segments are removed and `amp=1` or `amp=true` is dropped.
- **`youtu.be/<id>`** keeps its other parameters (`t`, for one) and replaces any `v` already there; an `&` in the id is encoded so it cannot split the query.
- **Hosts typed by people** (entity domains, a project's primary domain) go through `normalize_host`, which accepts a bare name or a URL and maps hosts the canonicalizer never produces (`en.m.wikipedia.org`, `youtu.be`) the way it maps them. Path prefixes go through `normalize_path_prefix`, the same normalization as canonical paths; the resolver refuses a prefix in any other form.
- **The Public Suffix List** is the snapshot bundled with the pinned `publicsuffixlist` package, whose version ends in the snapshot date.
- **Domain roles** (stage 2 of doc 13) are resolved by `idraft/extraction/domains.py`. A path prefix matches whole segments (`/acme` covers `/acme/sdk`, not `/acmecorp`), and the longest prefix wins. A watched entity's domain is named on the result (`role_entity_id`) but counts as `third_party`. A tie at the same specificity goes to own, then competitor, then watch, then the lower entity id, and is reported as a conflict.

## 4. Domain categories

Categories (`core.domain_categories`): `news`, `review_aggregator`, `ugc_forum`, `social`, `video`, `wiki_reference`, `vendor_site`, `marketplace`, `directory`, `government`, `education`, `blog_independent`, `affiliate`, `docs`, `other`.

Classification pipeline (in order, first hit wins):

1. **Tenant override** (`core.workspace_domain_categories`): users can recategorize any domain for their workspace.
2. **Seed list** (`source = 'seed_list'`): a curated list shipped with the app, covering the most-cited domains (initial target: 2,000 domains, built in Phase 13 from the platform's own citation frequency and reviewed manually).
3. **Rules** (`source = 'rule'`): TLD and pattern rules (`.gov` and `.gov.<cc>` government, `.edu` and `.ac.<cc>` education, known forum software paths, `docs.` and `developer.` hosts as docs).
4. **LLM classification** (`source = 'llm'`, budgeted, Phase 13): for unclassified domains with at least 5 citation units platform-wide, classify from the cited page titles and URLs we already have (no crawling), cheap model, JSON output, confidence stored. Low-confidence results stay `other`.

Role (own, competitor, third party) is **not** a category. It is a per-project interpretation stored on the citation.

## 5. Source graph

The graph is relational; we do not introduce a graph database.

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

Typical traversals (all SQL joins on indexed ids):

| Question | Path |
|---|---|
| Which pages are cited for topic T? | topic terms, prompts, observations, citations, urls |
| Which publishers dominate competitor-recommending answers? | observations where competitor recommended and own not mentioned, citations, domains, publishers |
| Which of our pages are cited, and do they rank? | citations with role own, urls, domain_rank_observations for the same url |
| Does a cited third-party page also rank organically for our keywords? | citations, urls, `seo.serp_snapshots.organic_url_ids` containment (GIN index on the array is **not** added in V1; the query runs per page against recent snapshots of linked keywords) |

## 6. Source intelligence features

| Feature | Definition | Screen |
|---|---|---|
| Top cited domains | C2 in doc 16, per engine and topic, with trend vs previous window | Citation Intelligence |
| Top cited pages | same at URL grain, with title and first/last seen | Citation Intelligence |
| Source share | C1 | Citation Intelligence |
| New and lost sources | C5, C6 with `min_support` | Citation Intelligence, alerts |
| Source category mix | C4 per engine: engines differ (for example, forums vs review sites) | Citation Intelligence |
| Competitor source overlap | C7 | Competitor Intelligence |
| Retrieved but not cited (ChatGPT) | C8: pages ChatGPT looked at but did not cite; own pages in this list are near misses | Prompt Explorer, Page Intelligence |
| Pages repeatedly influencing a topic | URLs cited in at least 25% of observations for a topic in each of the last 4 windows | Topic Explorer |
| Owned page citations | own URLs by citation units, engines, prompts, with organic rank for linked keywords | Page Intelligence |
| Publisher opportunities | section 7 | Citation Intelligence |

## 7. Publisher opportunities (evidence, not causation)

For a project and topic, rank third-party domains by how often they are cited in answers where competitors are visible and we are not:

```
For domain d in topic T over window W:
  A_d = observations citing d where at least one competitor is mentioned and own is not mentioned
  B_d = observations citing d where own is mentioned
  opportunity_d = |A_d| / (|A_d| + |B_d| + 1)       (share of d's appearances in "competitor-only" answers)
  reach_d       = distinct prompts citing d in T
```

The list shows domains with `reach_d >= 3`, sorted by `reach_d * opportunity_d`, with sample observations, the competitor(s) mentioned, the cited page titles, and the domain category. The UI wording: "Sources frequently cited in answers that mention competitors but not you". It never claims that getting featured on that domain will change AI answers.

## 8. Freshness, first seen and last seen

- `first_seen_at` for a project source is the earliest `observed_at` of a citation to it; `last_seen_at` the latest.
- A source is "lost" when not cited for 2 full windows after being cited with `min_support` in the window before (avoids flagging normal rotation).
- For owned pages, "time to first citation" after publication is reported when the page's publication date is known (sitemap `lastmod` or manual), labeled as observational.

## 9. Data quality specifics

| Issue | Handling |
|---|---|
| Duplicate URLs within an answer (Gemini annotations since 2026-07-28, repeated inline links) | Deduped per observation by `url_hash`; `occurrences` counts repeats |
| Citation to a redirector we cannot unwrap | Kept with `unresolved_redirect`; excluded from domain rankings by default (toggle to include) |
| Citation to the engine's own properties (for example `google.com/search?q=` links in AI Mode) | Categorized `other`, flagged `engine_internal`, excluded from source share by default |
| Tracking parameters on owned URLs creating false "new pages" | Removed by canonicalization; referral tag kept |
| Canonicalizer upgrade | New `canonicalizer_version`; `core.url_remap` maps old ids to new; rollups recomputed for the affected window |
