# Internal links 05b, Task 15: Pages tab additions (step form)

Start commit 36163935. Source: plan 05 Task 15, written against the screens of plan 03 as they stand. Owner overrides apply: no equity column and no points delta anywhere (P1 stays open).

**Files**

- Create: `src/lib/internal-links/page-extras.ts` (+ test): `comparisonOf`, `changeParts`, `anchorCell`, `gscCell` pure readings.
- Create: `src/features/internal-links/pages/page-extras-cells.tsx`: cells of the new columns.
- Create: `src/features/internal-links/pages/tier-suggestions.tsx` (+ test), `important-tiers.ts`.
- Modify: `page-columns.tsx`, `pages-tab.tsx`, `worklist-chips.tsx`, `page-filters.ts`, `url-state.ts`, `lib/internal-links/page-flags.ts`, `components/ui/menu.tsx` (item level `closeOnClick`), `crawl-picker.tsx`, `scope-menu.tsx`, `changes/change-links-panel.tsx`, `messages/en.json`, and the tests named below.

## Step 1: failing tests

1. `page-extras.test.ts`: `comparisonOf(summaryState, enrichState)`: first_crawl wins, pending or an enrichment that is not done is `updating`, failed or `unavailable` is `unavailable`, else `ready`. `changeParts(change)`: null for unchanged, `+2` positive, `-3` negative, New for is_new, depth moves in words, equity points never read.
2. `page-columns.test.tsx`: default columns gain `change` (after Outlinks); chooser holds keywords, rank, citations, anchors, matches, clicks, impressions; no `equityChange`; `SORT_FIELD` has six fields (`change` added); cells: Change shows `+2`, `-3`, nothing for zero, New, `n/a` with tip "No earlier crawl" for first_crawl, `Updating` while enrichment runs; Average rank one decimal; AI citations tip; Anchors `4 anchors, 25% generic`, `Not stored` for a dropped crawl; Matches Yes, No, No keywords; Clicks `Syncing` and `Not connected`. No cell says equity.
3. `page-flags.test.ts` and `page-filters.test.ts`: `generic_anchors` maps to "Mostly generic anchors" (warning) and is a filter option.
4. `url-state.test.ts`: `view=lost_links_top`, `view=weak_outlinks` and `sort=change`, `-change` are read; other values are not.
5. `pages-tab.test.tsx`: Change column visible sends `include=changes`; turning on Average rank adds `keywords`, AI citations adds `citations`; sort by Change sends `change`; both new chips show counts and set `view`; the first chip label follows the alert setting (max_position 3 reads "Lost links to T1 to T3"); on a dropped crawl the weak chip is missing; the flag filter sends `filter[flags]=generic_anchors`; no text or label says equity.
6. `tier-suggestions.test.tsx`: chip "Suggested tiers 3"; popover table with page, now, suggested, why; Accept posts `{url_ids:[id]}`, Dismiss and Accept all (`{all:true}`) likewise; success invalidates through `internalLinksKeys`, toasts "1 page moved", row leaves; not_connected note; viewer sees no buttons; missing numbers show the neutral reason; no chip with no suggestions; axe in light and dark.
7. `menu.test.tsx`: a radio item with `closeOnClick` closes the menu and focus returns to the trigger. Journey and header tests keep Escape only where still needed.

Run each file; they must fail for the reason named (missing column, missing export).

## Step 2: implement

- `page-extras.ts`, `page-extras-cells.tsx`, columns built with the existing `custom` helper; `change` sorts by `change`; others never sort. `pageColumns` takes `{ comparison, linksAvailable }`.
- Pages tab reads `changesSummaryQuery` (the header's cache entry) for the comparison, sends `include` from `moreIncludes(visible)`.
- `PAGE_SORTS` gains change, `WORKLISTS` gains the two lists. Empty copy for both.
- Chips: new chips after Links to non-indexable pages; weak chip only when the crawl keeps its links; the lost chip names the tiers from the alert setting.
- `TierSuggestions` mounts in the chip group (it needs the chips' focus target). Popover with a `PlainTable`; Accept, Dismiss, Accept all through the mutations; focus goes to the next action, or to All pages when the list empties.
- `MenuItemDef.closeOnClick` passes to the radio item; the crawl picker, scope menu and the Changes scope menus set it.

## Step 3: messages, targeted checks, commit

Keys in `internalLinks.columns`, `.flags`, `.worklists`, `.worklistEmpty`, `.suggestions`, `.pages.change`. Targeted checks only: prettier, eslint on changed files, one typecheck, vitest on `src/features/internal-links`, `src/lib/internal-links`, `src/mocks`, `src/i18n`, `src/components/ui/menu.test.tsx`; one build.

## Decisions kept out

Link strength change (equity) column, the points delta kind and any equity text: not built. Sorting by rank, citations and anchors: API has no sort.
