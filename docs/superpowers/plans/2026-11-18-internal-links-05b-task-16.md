# Internal links 05, Task 16: Inspector additions (step form)

Start commit 4497570c. Expands Task 16 of `2026-11-17-internal-links-05-web-slices-2-3.md` against the inspector as built in plan 03 and the Pages tab of Task 15.

## What exists

- `features/internal-links/inspector/page-inspector.tsx` builds the body from `InspectorSection` cards (h3 title, icon, `status`). `detail.extras` is a `PageDetailExtras`: `anchors` (an `AnchorDetail`: `distinct` and `top` nullable on a dropped crawl), `change` (`PageChange` or null), `citations`, `gsc` (`GscPage`), `keywords` (`KeywordRow[]`).
- `lib/internal-links/page-extras.ts`: `comparisonOf(summary, enrich)` and `changeParts(change)` (links in and depth move, no equity). Reused as is.
- The mock world already serves `pageDetailExtras` for every scenario (enrich, gsc, first crawl, dropped links).

## Decisions (owner overrides of the outline)

1. No link strength or equity points anywhere. Changes show editorial links in, the click depth move in words, "New page", nothing else. Tests assert no "equity" or "strength" in text, aria-labels or titles.
2. Changes section: absent only on a first crawl. Comparison still being worked out: neutral "Updating". Failed: neutral "Not available". Comparison from `comparisonOf(changesSummary state, crawl enrich_state)`, with the summary pending read as updating (as the Pages tab does).
3. Dropped crawl (`linksAvailable` false or `anchors.distinct` null): the Anchors section says "Not stored".
4. Google data: ok shows clicks and impressions with "last 28 days (Google data)"; pending "Search Console is syncing."; not connected "Search Console is not connected."
5. Citations: "today's numbers" caveat; "Cited in 0 answers" when all zero.
6. Order: after "Linking pages by tier and by placement", before the capped linking pages and outlinks. The old "Top anchors pointing here" card is replaced by the new Anchors section (same data, now with generic flags, the summary and the keyword match; the mock has one anchors section only).
7. Sections use `InspectorSection`; tables (tracked keywords, anchors) have an `sr-only` caption, `scope` headers and row headers; the tables are plain markup, not `PlainTable`, because cards are never nested.

## Steps

1. Messages: `internalLinks.inspectorExtras` in `messages/en.json` (changes, newPage, editorialIn, depth, deeper, shallower, unreachable, reachable, noChange, updating, unavailable, keywords, keywordsSource, keywordsCaption, noKeywords, keyword, rank, notRanking, moved, up, down, volume, citations, citationsSub, chatgpt, gemini, aiMode, cited, anchors, anchorsCaption, anchorText, links, generic, anchorSummary, noAnchors, notStored, matches, noMatch, google, gscOk, gscOff, gscPending). Remove the three old top anchor keys.
2. Failing test `extras-sections.test.tsx` (unit, `ExtrasSections` with plain props): changes rows and tones, New page, first crawl absent, Updating, Not available, no change; keywords table (caption, headers, rank, moved up and down, volume, empty text); citations (counts, total, zero line, caveat); anchors (rows, Generic badge, summary, keyword match three ways, empty, Not stored for null distinct and for `linksAvailable` false); Google three states; no equity or strength in text or labels; axe light and dark. Run, see it fail (module missing).
3. Implement `extras-sections.tsx`: `ExtrasSections({ extras, comparison, linksAvailable })`.
4. Page inspector: read the changes summary, compute the comparison, render `ExtrasSections` after the by-tier card, drop the old anchors card. Update the two tests that stub the detail read without `extras`; add inspector tests with the scenario switches (enrich running and failed, gsc pending and not connected, first crawl, dropped crawl) and the no equity assertion.
5. Checks: prettier, eslint, one typecheck, vitest one worker over `features/internal-links`, `lib/internal-links`, `mocks`, `i18n`, one `pnpm build`.
6. Commit the code by file names.
