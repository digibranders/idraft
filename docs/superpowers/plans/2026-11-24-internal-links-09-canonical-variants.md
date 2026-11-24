# Internal links 09: variants count as their canonical page

Owner decision, 2026-11-24: the Internal links numbers count canonical pages only, so CleanStart
reads 585 pages, not 733. The 148 others are the same pages under another address (a query
string: `?page=2`, tracking parameters on `/book-a-demo`, filters on `/careers`), each naming its
plain address as canonical.

## The rule

A crawled page is a **variant** when its canonical is a different URL, that URL is a page of the
same crawl, and that page is not itself a variant.

- A canonical that points to a page that was not crawled leaves the page counting.
- A canonical that points on (A names B, B names C) leaves A counting: only B folds into C.
- A cycle (A names B, B names A) leaves both counting.
- A self canonical, or none, counts.

Variants stay stored. For every count and for the link graph they fold into the canonical page:
a link to a variant is a link to the page it names, the links a variant carries are ignored, and a
link that the fold turns into a page linking to itself is ignored.

## Where it is done, and why

At ingest, in the metrics step (`crawl_ingest._count_and_read`, `crawl_variants_sql.apply_variants`).
Links in, orphans, depth, equity and the tier flow are all stored by that step, so a filter in the
reads alone would show 585 pages with link counts that still include the variants.

The fold is written on the stored links, and can be undone:

- `crawl_pages.variant_of_url_id`: the canonical page a variant folds into (null for a page that
  counts).
- `crawl_links.target_url_id` is re-pointed at the canonical page, the first target stays in
  `crawl_links.folded_from_url_id`.
- `crawl_links.ignored`: the link does not count (from a variant, or folded onto its own page).
- `crawl_runs.pages_variant`: how many variants the crawl has (null: not counted).

Every reader of links asks for `NOT ignored` (`reads._in_view`, neighbors, route finder, anchors,
opportunities, the weak outlinks worklist, the change diff, the tier flow). Readers of pages leave
variants out by default (`page_filter.page_conditions`), including the bulk tier bodies and the
tier rule preview.

`apply_variants` first puts links back and clears the counts, so it can be run again.

## API

- `GET .../link-crawls`: `pages_variant` (null: not counted) and `pages` (`pages_crawled` less
  `pages_variant`).
- `GET .../internal-links/pages`: variants are left out, `meta.total` too. `filter[include_variants]=true`
  lists them with the rest; `filter[flags]=variant` lists only them. A row of a variant has the
  `variant` flag, and its `canonical_url` says what it folds into. The same two fields are on
  `PageFilter` for the bulk bodies.
- Worklist counts, tier counts, the tier flow, the rule preview and the client summary follow.

## Stored crawls: the recount (operator step, needs the owner's go)

Migration 0037 adds columns only. A crawl finished before it has no variants until it is
recounted: `crawl_ingest.recount_variants(sessions, workspace_id=..., run_id=...)` gives it what a
fresh ingest gives (counts, flags, depth, equity, anchors, tier flow, run counters) without a new
crawl. It takes finished crawls whose second job has ended, takes the project lock, can be run
again, and touches one crawl per call. It leaves the changes against the previous crawl as they
were. It is run by `python -m idraft.worker.recount_variants --workspace-id W --project-id P` (worker
settings, `PROCESS_ROLE=worker`), one project at a time, for its latest crawl; both ids are
required, so no other tenant is touched.

## Not done, on purpose

- The crawler still fetches variant URLs. Skipping them would save about a fifth of CleanStart's
  crawl (148 of 733 pages) and a fifth of its cost (about $0.02), but needs the provider to skip
  by pattern and a rule for what a variant URL is before it is fetched (a canonical is only known
  after the fetch). Later, if crawl cost or time matters.
- `core.page_tier_levels` page counts (`page_count` of a tier) still count the rows that hold the
  tier, variants included. They guard deleting a tier, they are not the site's page count.

## Behaviour to know about (from the review)

- **Links to non-indexable pages.** A link to a variant now counts as a link to its indexable
  canonical page, so "Links to non-indexable pages" no longer lists "you link to a canonicalised
  URL". The first target stays in `crawl_links.folded_from_url_id`; the API does not expose it
  yet. A follow-up if owners want that finding back.
- **Broken after the fold.** If a variant's canonical page is a 404 or a redirect, a link to the
  variant now counts as broken or redirected.
- **One-time noise in changes.** The first crawl after a project is recounted or deployed is
  compared with a previous crawl that was not folded, so the change lists show some lost and added
  links. Recount the latest crawl before the next one runs.
- **Duplicate link rows.** A page that links both a variant and its canonical page has two link
  rows to the canonical page; counts use distinct pairs.
- **The recount is visible half done.** It commits the counts first and the depth, equity and tier
  flow in a second transaction, so a viewer can see a mix for a moment (or until a rerun, if the
  process dies between them). It is idempotent. It holds the crawl row for the first transaction and
  the project row only for the second.
- A crawl whose links were dropped is never recounted: it has nothing to count from.
- A start page that is a variant (`/index.html` naming `/`) stands for its canonical page in the
  depth walk, the orphan flags and the route finder.
