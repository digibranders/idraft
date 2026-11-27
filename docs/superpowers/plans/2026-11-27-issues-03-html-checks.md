# Issues page, slice 2: checks read from the stored HTML (and slow pages)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Add 12 checks to the Issues page, all computed from data the crawl can keep without a new provider call: 11 read from each page's stored HTML and `slow-pages` from the provider's page timing. After this slice the catalogue has 41 of the 47 checks.

**Architecture:** A pure module reads one page's HTML into a small set of facts (`backend/src/idraft/crawl/page_facts.py`). Ingest and the re-read of a stored crawl write the facts into new nullable columns of `seo.crawl_pages`; a new operator command fills them for a crawl that is already stored, from its stored HTML, with no provider call. The rules are SQL conditions like the slice 1 rules (spec section 4). A check whose facts were never read for the crawl answers `not_run` with `not_collected`.

**Tech stack:** Python 3.13, FastAPI, SQLAlchemy Core, Alembic, pytest with testcontainers; Next.js web app for the words.

Spec addendum: section 15 of `docs/superpowers/specs/2026-11-26-issues-page-design.md`. Rules for builders are those of the earlier plans (`2026-11-26-issues-01-backend.md` "Rules for every task", `2026-11-26-issues-02-web.md`): absolute paths, Write and Edit tools only, targeted serial checks, no dashes, no attribution lines, test first.

## What is read, and where it is kept

New nullable columns of `seo.crawl_pages` (migration 0042; the worker needs `UPDATE` on each, as migration 0037 did; NULL means not read):

| Column | Type | Meaning |
|---|---|---|
| `facts_read` | boolean not null default false | The facts below were read from this page's HTML |
| `meta_description` | text (cut at 1000) | The text of `<meta name="description">`, trimmed; empty string when the tag is missing or empty |
| `h1_count` | smallint | Number of `<h1>` elements with visible text |
| `word_count` | integer | Words in the body text, without scripts, styles, `noscript`, `template` and comments |
| `text_hash` | bigint | A 64 bit hash of the body text with whitespace collapsed and letters lower-cased; NULL when `word_count` is 0 |
| `images_without_alt` | smallint | `<img>` elements that have no `alt` attribute (an empty `alt=""` is a decorative image and does not count) |
| `og_complete` | boolean | `og:title`, `og:description` and `og:image` are all present with content |
| `jsonld_errors` | smallint | `<script type="application/ld+json">` blocks whose content is not valid JSON |
| `hreflang_errors` | smallint | Problems in the page's hreflang links: a language code that is not valid (BCP 47 shape or `x-default`), the same code twice, or links with no link to the page itself |
| `http_resources` | smallint | On an `https` page: `src` and `href` of images, scripts, stylesheets, iframes and media that start with `http://` |
| `response_ms` | integer | From the provider's page item (`page_timing.duration_time`, milliseconds); NULL when the provider gave none |

Counts are capped at 32,767 (smallint). Reading never raises: pages are untrusted (follow `crawl/head.py`: bounded size, no exceptions out).

Return links of hreflang (does the other page link back) are not checked in this slice. It is listed in the spec's open points.

## The checks (catalogue order inside the tab)

Placement in `catalogue.py` follows the mock's order. Technical: Status, Pages that earn visits, Redirects, Indexing, Sitemap, Links, Security, Languages, Speed. On-page: Titles, Descriptions, Headings, Content, Images, Structured data, Social tags, Addresses, Keywords. (`Search results` for `low-ctr` comes with a later slice.) Category ids: `security`, `languages`, `speed`, `descriptions`, `headings`, `content`, `images`, `structured_data`, `social_tags`.

| id | Tab | Category | Severity | Rule (on a live page unless noted) | Detail |
|---|---|---|---|---|---|
| `mixed-content` | technical | security | warning | live, `facts_read`, `http_resources > 0` | count |
| `hreflang` | technical | languages | warning | live, `facts_read`, `hreflang_errors > 0` | count |
| `slow-pages` | technical | speed | warning | live, `response_ms > 3000` | milliseconds as `count` |
| `description-missing` | on_page | descriptions | warning | live, `facts_read`, description empty | none |
| `description-duplicate` | on_page | descriptions | notice | live, indexable, `facts_read`, description not empty, and another such page has the same description (trimmed, lower-cased) | count of other pages, one other path |
| `h1-missing` | on_page | headings | warning | live, `facts_read`, `h1_count = 0` | none |
| `h1-multiple` | on_page | headings | notice | live, `facts_read`, `h1_count > 1` | count |
| `thin-content` | on_page | content | warning | live, `facts_read`, `word_count < 200` | count of words |
| `duplicate-content` | on_page | content | warning | live, indexable, `facts_read`, `word_count >= 50`, and another such page has the same `text_hash` | count of other pages, one other path |
| `image-alt` | on_page | images | notice | live, `facts_read`, `images_without_alt > 0` | count |
| `social-tags` | on_page | social_tags | notice | live, `facts_read`, not `og_complete` | none |
| `schema-errors` | on_page | structured_data | warning | live, `facts_read`, `jsonld_errors > 0` | count |

Thresholds (3000 ms, 200 words, 50 words) are constants in `catalogue.py` beside the others.

States: the facts checks need `need="facts"`; `slow-pages` needs `need="timing"`. A check with `need="facts"` is `not_run` with `not_collected` when no page of the crawl has `facts_read`; with `need="timing"` when no page of the crawl has `response_ms`. The service reads both with one `EXISTS` each.

## Tasks

### Task 1: The reader of a page's facts (pure) 

**Files:** create `backend/src/idraft/crawl/page_facts.py`, `backend/tests/crawl/test_page_facts.py`.

- [ ] Test first, on small HTML strings, one test per fact and the edge cases: a description in either attribute order and a `<meta name="Description">` in another letter case; an empty one; two descriptions (the first wins); h1 with only whitespace or only an image (does not count), nested tags inside h1 (counts once); body words with script, style, noscript, template and comments excluded, a page with 49, 50, 199 and 200 words; the same text with other case and spacing gives the same hash, different text a different one, no text gives NULL; `<img>` without `alt`, with `alt=""` and with `alt="x"`; Open Graph complete, missing one, `content=""` does not count; JSON-LD valid, invalid, empty, two blocks one bad; hreflang valid pair, bad code (`en_US`, `english`), duplicate, no self link, `x-default`; mixed content on an `https` page for img, script, link rel stylesheet, iframe, video source, and none on an `http` page; protocol-relative URLs are fine; garbage and truncated HTML never raise; an input over the size bound is cut, not refused.
- [ ] Implement `PageFacts` (frozen dataclass) and `read_facts(html: str, page_url: str) -> PageFacts` with the standard library `html.parser`, one pass. Follow the style of `crawl/head.py` (docstring first, `Final` constants, `shortcut:` comments where a limit is known). The 64 bit hash: `hashlib.blake2b(text.encode(), digest_size=8)` as a signed integer.
- [ ] Commit: "Issues: read a page's facts from its HTML".

### Task 2: Store the facts: migration, ingest, re-read, backfill command

**Files:** create `backend/src/idraft/db/migrations/versions/0042_crawl_page_facts.py`; modify `backend/src/idraft/db/tables.py`, `backend/src/idraft/providers/dataforseo/on_page.py` (`PageItem.response_ms` from `meta`'s sibling `page_timing.duration_time`; the value must be an int between 0 and 600000, else None), `backend/src/idraft/collectors/crawl_ingest.py` (page insert writes `response_ms`; where the HTML is read, `read_facts` runs and the columns are written in the same statement that moves the page out of `waiting`), `backend/src/idraft/collectors/crawl_relink.py` (the re-read writes the facts too), a new `backend/src/idraft/collectors/crawl_facts.py` (`backfill_facts(sessions, store, workspace_id, run_id)`: reads each stored HTML of a finished crawl, writes only the facts, never touches links; pages whose HTML is gone keep NULL; returns counts read and missing), `backend/src/idraft/cli.py` (a command `crawl-facts --run-id`, as the relink command is wired; read `test_cli_relink.py`), tests beside the existing ones (`tests/collectors/test_crawl_ingest.py`, `test_crawl_relink.py`, a new `test_crawl_facts.py`, `tests/providers` for `response_ms`, `tests/db` if a migration test exists).

- [ ] Test first: ingest of a page with HTML stores its facts and `facts_read = true`; a page whose HTML the provider could not give (links from the provider) keeps `facts_read = false` and NULL facts; `response_ms` is stored from the provider item and out of range values give NULL; relink writes the facts for pages it re-reads; `backfill_facts` fills a stored crawl from its stored HTML, is repeatable, and reports missing HTML; the worker role can update the new columns (copy how 0037's grants are tested, if they are).
- [ ] Migration: add the columns of the table above, the column grants for `app_worker` (`UPDATE` on each column), downgrade drops them. Revision `0042`, `down_revision` is the current head (check `ls backend/src/idraft/db/migrations/versions`; it was `0041`). Do not backfill in the migration.
- [ ] Commit: "Issues: keep a page's HTML facts and response time in the crawl".

### Task 3: The rules, details and states

**Files:** modify `backend/src/idraft/api/issues/catalogue.py`, `rules.py`, `details.py`, `service.py`, `sources.py` or a new small `facts.py` for the two `EXISTS` reads, `backend/src/idraft/api/schemas/issues.py` (`CheckId` and `NotRunReason` unchanged), `backend/src/idraft/api/internal_links/reads.py` (a page filter for a facts check must match nothing when no facts were read: the same `not_run` rule as the list), tests under `backend/tests/api/issues/`, `backend/openapi/v1.json`.

- [ ] Test first: extend `tests/api/issues/support.py` with the facts columns for the existing fixture rows (default: facts read, one description per page unique, one H1, 300 words, unique hash, no images without alt, og complete, no errors, 200 ms) and add rows that make each of the 12 checks fire, plus rows at the thresholds (199 and 200 words, 49 and 50 words with the same hash, 3000 and 3001 ms) and rows that must not fire (a non-live page with bad facts; a variant; a page with `facts_read = false` and NULL facts; an `og_complete` page; `alt=""`). Work every expected list out from the rule table above, not from the code. Tests: each check finds exactly its pages; details for each kind (count, target path for the two duplicates, byte order as for titles); `not_run` with `not_collected` when no page has `facts_read` or no page has `response_ms`, and the strip then leaves those checks out; the CSV of a check; `filter[issue]` on the Pages list; the list now has 41 checks in catalogue order and the existing slice 1 tests still pass (update their counts).
- [ ] Implement: catalogue rows and thresholds; rules as SQL (shared-description and shared-hash sets as uncorrelated hashed sets like `_shared_titles`, evaluated once; keep the MATERIALIZED CTE and its EXPLAIN test); details; the `need` values `facts` and `timing`; `CheckId` literal. The EXPLAIN test must still show a single CTE scan and no per-row SubPlan for the new rules.
- [ ] Regenerate `backend/openapi/v1.json`; run `tests/api/test_openapi.py`.
- [ ] Commit: "Issues: the checks read from the stored HTML, and slow pages".

### Task 4: Web: words, mocks, categories

**Files:** `apps/web/messages/en.json` (namespace `issues`: names, why and fix of the 12 checks from the table below, the nine new category names, new `found` messages), `apps/web/src/lib/issues/{types,detail}.ts` (+ tests), `apps/web/src/mocks/issue-rules.ts` and `handlers/issues.ts` (the mock list has 41 checks, with facts for the mock crawl), `apps/web/src/lib/api/schema.ts` (regenerated in its own commit first: `pnpm gen:api`), and any test that counts checks.

Texts (names, why, fix) follow the mock `issues-data.js` (read-only at `/Users/a12345/Desktop/AI/idraft/platform/apps/web/design-preview/issues-data.js`), with these edits: `schema-errors` name "Pages with structured data errors" keeps the mock text; `thin-content` name "Pages with little text" (fewer than 200 words); `hreflang` why "A wrong language code, a repeated code or a missing link to the page itself makes Google ignore the language versions." and fix "Use valid language codes, one link per language, and a link to the page itself."; `slow-pages` name "Slow pages", why "The page took more than 3 seconds to answer in the crawl. Slow pages lose visitors and are crawled less." New found messages: `words` "{count, plural, one {# word} other {# words}}", `milliseconds` "{count} ms", `h1Count` "{count} H1 headings", `imagesWithoutAlt` "{count, plural, one {# image} other {# images}} without alt text", `httpResources` "{count, plural, one {# resource loads} other {# resources load}} over HTTP", `hreflangProblems` "{count, plural, one {# problem} other {# problems}} in the language links", `jsonldErrors` "{count, plural, one {# block} other {# blocks}} that cannot be read", `sameDescription` "Same description as {target}" with the more form, `sameText` "Same text as {target}" with the more form, `noDescription` "No description", `noH1` "No H1", `noOpenGraph` "Open Graph tags are missing".

- [ ] Test first (words test for every id and category; `detailMessage` per new key with the rendered text; mock parity tests of slice 1 extended to all 41 checks), implement, run the targeted checks of `2026-11-26-issues-02-web.md`.
- [ ] Commits: "Regenerate the API client for the HTML checks", then "Issues: words, details and mocks for the HTML checks".

### Task 5: Check on screen (lead), re-read an old crawl

- [ ] The lead looks at the list and one new check at 1280 by 720 as before.
- [ ] Operator note in the spec: `crawl-facts` fills the latest crawl of each project; run it once after the release (no spend).
