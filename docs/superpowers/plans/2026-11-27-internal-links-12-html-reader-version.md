# Internal links 12: the HTML reader's version and a per-page check

Why: the crawl of 2026-11-24 was read by a parser that lost every link below an empty comment
(`<!--->`). 263 of 389 pages were wrong, the orphan count was 228 (about 50 true), and nothing in
the data said so. The links can be re-read from the stored HTML (`crawl_relink`), but only if
someone knows a crawl needs it, and a wrong page must not look like a right one.

Two guards, no new screen, no provider call:

1. A **version** on every crawl for the code that reads its HTML, so an old crawl can be found and
   the API can say it is stale.
2. A **per-page check** at ingest and relink that flags a page whose HTML holds many more links than
   were read from it.

## What is stored

Migration `0048_html_reader_version` (check at build time that 0048 is still the next revision):

| Column | Type | Meaning |
|---|---|---|
| `seo.crawl_runs.html_reader_version` | `smallint` null | The oldest reader version that read any HTML page of this crawl. Null: read before this existed, which is version 1. |
| `seo.crawl_runs.pages_links_suspect` | `integer` null | Pages of the crawl with `links_suspect`. Null: not counted. |
| `seo.crawl_pages.html_anchors` | `smallint` null | Links the independent count found in the page's HTML (clamped to 32767). Null: not checked. |
| `seo.crawl_pages.links_read` | `smallint` null | Links `classify` returned for the page, before edges are merged (clamped). Null: not checked. |
| `seo.crawl_pages.links_suspect` | `boolean` null | The check's verdict. Null: not checked (an old crawl, a page read from the provider, a page with no HTML). False: checked and fine. |

Null is "unchecked", never "fine": a page or crawl that was not checked must not read as clean.
The raw and read counts are stored so the thresholds can change without reading HTML again.
The worker gets UPDATE on the new columns (as migration 0047 does); `downgrade` drops them together.
Nothing is backfilled: a null version reads as 1, and the check runs when a crawl is read or relinked.

`HTML_READER_VERSION` is an int constant in a new pure module `crawl/integrity.py` (no other idraft
import, like `crawl/placement.py`). Version 1 is the reader before the empty-comment fix
(2026-11-26); version 2 is the reader now. The rule, written in the module: **raise it in the same
commit that changes what `page_links_from_html` returns for the same HTML** (links, canonical,
facts: `classify`, `canonical_of`, `read_facts`, and the edge building after them).

A pin test keeps that honest, and says what it cannot do. It serialises (sorted, `rel` sorted, no
`repr` of sets) the output of `page_links_from_html` for a fixed set of HTML fixtures into a
checked-in golden JSON next to the constant; a change in output without a regenerated golden fails
with the message "bump HTML_READER_VERSION and regenerate". It only protects shapes that are in the
fixtures: the real bug was a shape nobody had. A Python patch release that changes `html.parser`
shows up as a failure too, which is wanted.

## How the version is stamped

- Ingest, `_links` step, in the transaction that moves pages out of `waiting`: if at least one page
  moved to `from_html` in that step, set `html_reader_version = least(coalesce(old, V), V)`. A step
  that moved no HTML page does not stamp. A crawl read across a deploy that raised V keeps the older
  number. A crawl read wholly from the provider (no HTML page) keeps null, and the report skips
  crawls without `from_html` pages.
- Relink: the per-page numbers and the crawl's `pages_links_suspect` are written in the swap
  transaction, and the version is set to V **last, after the recount succeeded**, so a relink that
  failed halfway never reads as current.
- Facts: the relink also rewrites the facts (it stores `facts_values` for each page), so V covers
  facts. `crawl_facts` (a facts-only backfill) does not touch the version.

## The per-page check

`integrity.anchor_count(html) -> int`: the number of anchors `classify` would keep, counted with a
regular expression that does not use `html.parser`, so the bug it guards against cannot also blind
it. First remove comments (`<!--` to `-->`, and the empty forms `<!-->` and `<!--->`), `<script>`,
`<style>` and `<template>` blocks. Then match `<a` followed by whitespace (not `<article>`,
`<aside>`, `<abbr>`, `<address>`, `<audio>`), case-insensitive, with a whitespace-preceded
`href` (not `xlink:href`) in double, single or no quotes. Count it when, after trimming, the value
is not empty, not `#...`, and has no scheme or is `http:`, `https:` or `//` (an allow-list; the
parser keeps nothing else). A `>` inside a quoted attribute can cut a tag early: that under-counts,
the safe direction.

`integrity.links_suspect(raw: int, read: int) -> bool`: true when `read == 0 and raw >= 3`, or when
`raw - read > max(3, raw * 3 // 100)`. The first rule catches a page that lost everything (the bug's
shape on a small page); the second a page that lost more than a few links or 3% of them.
Calibrated, not assumed: the plan's acceptance step runs the count over the 389 stored Eventus
pages, read only on the VPS, with the current reader (the number of pages flagged must be 0, or
every flag explained) and with the empty-comment fix switched off in the script (the pages that lost
links must be flagged); the thresholds are changed until both hold.

Written with `links_state` at ingest (`_PageLinks`: `html_anchors`, `links_read`, `links_suspect`)
and by relink. The crawl's count is `count(*) FILTER (WHERE links_suspect)` in `_SUMMARY` (end of
ingest) and in `recount_variants`' summary, written to `pages_links_suspect`.

Not seen by this check, named: a body cut short or links drawn by JavaScript (the count and the
reader agree), `is_clean` and the per-page and per-crawl edge caps (later stages), and pages read
from the provider. The report below counts pages by `links_state` so a crawl with `none` or
`from_provider` pages shows it.

## How an old crawl is found, and shown

- `python -m idraft.worker.html_reader_report`: for the latest finished crawl of every project that
  has `from_html` pages, print workspace, project, run, `coalesce(html_reader_version, 1)`,
  `pages_links_suspect`, the pages by `links_state`, and whether the version is below
  `HTML_READER_VERSION`. Read only: it changes nothing and calls no provider.
- The crawl API (`CrawlRun`) gets `html_reader_stale` (version below the current one) and
  `pages_links_suspect`, so the web session can show a banner; `backend/openapi/v1.json` is updated.
  No screen here.
- The fix for a listed crawl is `python -m idraft.worker.relink_crawl`, run by the owner's word.

## Out of scope (named, not built)

- The banner and a Pages tab filter on `links_suspect` (web session).
- An alert row, a re-read after every deploy, a `ship.sh` step that lists stale crawls.
- A truncation signal (no closing `</html>`).

## Tasks

1. Migration `0048`, `db/tables.py`, `tests/db/test_grants.py` (the page and run update lists).
2. `crawl/integrity.py`: `HTML_READER_VERSION`, `anchor_count`, `links_suspect`; unit tests for each
   shape above (empty-comment page, scripts, comments, templates, `xlink:href`, `<article>`,
   schemes, single quotes, unquoted, uppercase, whitespace, boundaries, small pages); the golden pin
   test. Calibration on the stored Eventus HTML (read only).
3. Ingest and relink: `_PageLinks` numbers, the stamp rules, the flag, the crawl's count; tests for a
   crawl whose reader drops links (a patched `classify`), for the stamp across a version bump, for a
   provider-only crawl (stays null), and for a relink whose recount fails (not stamped).
4. `worker/html_reader_report.py` and the `CrawlRun` fields with `openapi/v1.json`; tests.

Each task: tests first, targeted serial tests only, a Sonnet review before the next.
