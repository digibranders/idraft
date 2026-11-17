# Internal links 03: web slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web side of the internal link tracker, slice 1: the design-system additions (tier tokens, `TierBadge`, `LinkCard`, `LinkCanvas`), the SEO page "Internal links" with its Pages, Links, Journey (canvas and tree list) and Tier flow tabs, the page inspector, bulk tagging with keys 1 to 8 and 0, tier rules and CSV import, the workspace "Page tiers" settings, the project "Internal links" settings, the "Map this site's internal links" checkbox of the new-project form, and every crawl state of spec section 9, matching the static mock in `apps/web/design-preview/il*.js`.

**Architecture:** A feature folder `apps/web/src/features/internal-links` renders one route, `/[workspace]/[project]/seo/internal-links`, whose tab, filters, link scope, worklist and journey state live in the address through `nuqs`. Pure modules in `apps/web/src/lib/internal-links` hold everything that can be a function (scopes, tier codes, page flags, the CSV check, the journey layout, the elbow geometry, the URL codec of the journey, the tier flow bins) and are unit tested first. The canvas is drawn with plain DOM columns and one SVG layer, exactly like the mock, from a pure layout over lazily loaded neighbor lists; no new dependency is added. Every read and write goes through the generated client (`apiQuery`, `apiMutation`) against plan 02's contract, and the MSW handlers answer the same contract so the Playwright flow and the component tests run without a backend.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 6, Tailwind v4 tokens, Base UI primitives, TanStack Query 5, TanStack Table 9 through `DataTable`, `nuqs` 2, next-intl 4, openapi-fetch and openapi-typescript, MSW 2, Vitest 5 with vitest-axe, Playwright 1.63 with `@axe-core/playwright`.

---

## Where this plan sits

- Spec: `docs/superpowers/specs/2026-11-16-internal-link-tracker-design.md`, sections 3 (slice 1), 5, 7, 8, 9, 11 and 12.
- Plan 01 (crawl spike) and plan 02 (backend, `docs/superpowers/plans/2026-11-16-internal-links-02-backend-slice-1.md`) come before this one. This plan is written against plan 02's "Names", "API contract" and "Errors and states" sections as they stand after its Task 12 (read API). Every path below is plan 02's workspace-scoped form (its decision D1): `{W}` is `/api/v1/workspaces/{workspace_id}` and `{P}` is `{W}/projects/{project_id}`.
- The mock is the visual and behaviour reference: `apps/web/design-preview/il.js`, `il-pages.js`, `il-links.js`, `il-drawer.js`, `il-journey.js`, `il-journey-layout.js`, `il-flow.js`, `il-dialogs.js`, `il-settings.js`, `il-model.js` and `il-data.js`. Open it with `pnpm run preview` in `apps/web` and the file `apps/web/design-preview/index.html#/internal-links`. The "Mock to app map" below says, per app file, what to copy exactly. The screenshots named by number (`01-pages.png`, `03-bulk.png`, `04-inspector.png`, `05-journey.png`, `06-journey-open.png`, `07-tree.png`, `08-flow.png`, `09-links.png`, `10-settings-tiers.png`, `11-rules.png`, `12-first-crawl.png`) were taken by the mock session into `/private/tmp/claude-501/-Users-a12345-Desktop-AI-idraft/3d97ec7f-5e6f-4378-9eb8-5066d0b9681b/scratchpad/ux/`; that folder may be gone, and the mock itself is the reference.
- Worktree: `/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-web`, branch `feat/internal-links-web`, cut from `origin/develop`. Paths in the tasks are relative to the worktree root. Work merges into `develop`, never into `main` (AGENTS.md).
- Shared files other tracks also change: `apps/web/messages/en.json`, `apps/web/src/components/design-system/registry.ts`, `apps/web/src/components/design-system/section-slugs.ts`, `apps/web/src/styles/tokens.css`, `apps/web/src/styles/globals.css`, `apps/web/src/lib/navigation/registry.ts`, `apps/web/src/lib/api/schema.ts` (generated), `apps/web/src/mocks/handlers/index.ts`, `apps/web/src/mocks/respond.ts`, `docs/design-system/25-component-inventory.md`. Rebase on `develop` before each merge; on a conflict in `en.json` keep both sides' keys, and regenerate `schema.ts` with `pnpm gen:api` rather than merging it by hand.
- Files this plan never touches: anything under `backend/`, `infra/`, `docs/ops/`, `apps/web/design-preview/`, and every file another session has uncommitted in the main checkout. Every commit names its files; never `git add -A` or `git add .`. No attribution lines in commit messages.

### The gate at the end of every task

From the worktree root, then in `apps/web`. Each command must end as shown.

```bash
pnpm install --frozen-lockfile          # Done in ...s
cd apps/web
pnpm format                             # writes Prettier's layout into the files this task touched
pnpm lint                               # exits 0, no output after the eslint banner
pnpm typecheck                          # exits 0
pnpm test                               # Test Files  N passed (N); Tests  M passed (M)
pnpm format:check                       # All matched files use Prettier code style!
pnpm build                              # ✓ Compiled successfully (route list printed)
```

A task may run one test file while it works (`pnpm vitest run path/to/file.test.ts`); the full gate runs before its commit.

---

## Decisions

Each is a choice the spec left open or that the code forced, with the reason.

- **W1. One route, the tab in the address.** `/[workspace]/[project]/seo/internal-links` with `?tab=links|journey|flow` (Pages has no key), as Citations does (`features/citations/citation-scope.ts`). The mock's hash routes (`#/internal-links/journey`) are a preview device. The tab is the one change that pushes a history entry; everything else replaces.
- **W2. The canvas is our own DOM and SVG, not React Flow and elkjs.** Spec 7.5 names React Flow and elkjs. The mock, which the owner approved, is fixed-width flex columns (`w-64`, 64 px gaps) with orthogonal elbow edges on a shared vertical spine, computed from card rectangles, and dashed return arrows drawn on demand. That layout is a column assignment, which the pure `buildJourney` already decides; elkjs would only reorder what the spec orders by tier. React Flow would bring about 180 kB minified, its own focus and pan model (which fights the keyboard model of spec 7.5: arrows between cards, Enter to open, F to re-center, Escape to the focus), and its own node styling. With our own DOM the cards are real buttons in reading order, zoom is a CSS `scale` with buttons (the non-drag alternative the spec asks for), and nothing new enters `package.json`. The pure parts are `lib/internal-links/journey-layout.ts` (which cards and stubs exist in which column) and `lib/internal-links/journey-geometry.ts` (edge paths from rectangles), both unit tested; jsdom has no layout, so geometry is tested as a function of rectangles. Consequence: no ESLint or bundle rule changes, because no package is added.
- **W3. The tree list is a plain table with disclosure buttons, not `DataTable` tree mode.** `DataTable`'s `RowTree.level` is `1 | 2 | 3` and level 3 is always a leaf, while a journey goes up to 12 steps. The mock's tree list is a plain table whose first cell holds an indented disclosure button (`aria-expanded`) and a "Make the focus" button; that is what the plan builds (`features/internal-links/journey/tree-list.tsx`), with Right and Left Arrow on a disclosure button to open and close as in the mock. Widening `DataTable` to deeper trees is a design-system change for another plan.
- **W4. Equity share is never shown.** The owner removed it from the mock on 2026-11-16. The API still returns `equity_share` on `PageRow`, `Neighbor` and `TierStat`, and the pages list still accepts `sort=equity_share`; the web never reads those fields, never sends that sort, and never names equity in a string. The spec's equity mentions (Pages column, card meta, tooltip, inspector strip, tier flow strip, child order) are replaced by: linking pages (all scopes) as the tie-break, the tier strip of the mock (pages, share of pages, average depth), and no equity column. The final grep of Task 18 checks the source.
- **W5. Every list sends an explicit sort.** The pages list defaults to `-equity_share` on the server, which is hidden here. The Pages tab sends `sort=-linking_pages` by default and lets the user sort by Page, Status, Depth, Linking pages and Outlinks (`path`, `status_code`, `click_depth`, `linking_pages`, `outlinks`). The mock sorts by tier first; the API has no tier sort, which is contract gap G1. When the backend adds it, the default becomes `tier` with a one-line change in `pages/page-columns.tsx`.
- **W6. Paging is the house `DataTable` server mode over cursors, 100 rows a page.** The mock shows 25 rows and "Show 25 more". `DataTable`'s page sizes are 100, 200 and 500 (12-tables.md), and the pages and edges lists answer at most 200. The tabs use server mode with `pageSizes={[100, 200]}`, a stack of cursors kept in component state for Previous and Next, and `meta.total` for "Select all N matching". This is open point P1 for the owner.
- **W7. Neighbors are read 50 at a time and shown 8 at a time.** Back-link markers need every link of an opened card, and the first in-link column groups pages by tier. Each opened list is read with `limit=50` (the API maximum), offsets 0, 50, 100 as "+N more" passes what is loaded. The layout counts back links among the loaded links only; when a list has more than 50 links, its back-link marker may undercount. Comment in code: `shortcut: back links are counted among the loaded neighbors (50 a request), upgrade when the API answers back links (gap G4)`.
- **W8. The web sorts children itself.** The contract does not state the order of neighbors (gap G3). `journey-layout.ts` sorts loaded children by tier position (Untiered last), then by `linking_pages_all` descending, then by path. With equity out of the UI (W4), that is the mock's order without equity.
- **W9. The journey's link control is Editorial or All links.** The mock's journey toolbar has a two-way switch, while the other tabs offer the four scopes. The journey reads the shared `scope` key: `editorial` and `all` are what its switch offers; an address that says `auto_generated` or `template` draws those cards, with the remaining scopes as group cards, so a shared link never breaks.
- **W10. Tier flow is an accessible HTML table with heat fills, not an ECharts heatmap.** The mock draws a table whose cells are buttons with a sequential fill; spec 7.6 asks for a table alternative anyway. `SEQUENTIAL_BINS` (`components/app/chart/heat-bins.ts`) gives fills with measured text colors in both themes. A cell is a link to the Links tab filtered to that pair (`stier`, `ttier`, `scope`).
- **W11. "Linked from tiers" reuses `ShareBarCell`.** The inventory check of spec 7.9 finds `components/app/chart/stacked-share-bar.tsx` (`ShareBarCell`, a 96 by 12 px bar named as one image). Its `ShareColor` gains `tier-1` to `tier-8` and `tier-none`, with no labels inside. No `StackedMiniBar` is made.
- **W12. Tier colors are new tokens, one cobalt sequential scale per theme.** `--tier-1` to `--tier-8` and `--tier-none` in `tokens.css` (both themes), exposed as `--color-tier-*` in `globals.css`, grouped in `token-groups.ts`, and tested at 3:1 against `surface` and `surface-subtle` in both themes. The values were measured with culori on 2026-11-16 (Task 1 lists them with their ratios). Class names are static maps in `components/app/tier/tier-colors.ts`, because Tailwind does not see a class built from a variable.
- **W13. CSV export downloads from the API.** The pages and edges lists answer `format=csv`. The typed client would reject a `text/csv` 2xx (`nonJsonGuard` in `lib/api/client.ts`), so a new helper `lib/api/download.ts` fetches through `apiFetch` with the request id, turns an error into an `ApiProblem` with `problemFrom`, and saves the blob with `downloadBlob`.
- **W14. The CSV import has a client-side Check step.** The mock checks the text before Apply. The API has no dry run (gap G6) and applies nothing while `errors` is not empty. The dialog parses the text with the pure `parseTierCsv` (columns, tier codes and names against the workspace list, line numbers), shows the rows and errors, and only then posts; the server's `pending` and `errors` are shown after Apply.
- **W15. Tier rules are saved as a diff.** The API has one call per rule (gap G7 asks for a bulk save). The dialog keeps a draft list; Save sends DELETE for removed rules, PATCH for changed ones (with `position`), POST for new ones, in that order, then refetches. A rule always names a real tier: the contract's `TierRuleCreate.tier_id` is a UUID, so the rule dialog does not offer Untiered (the mock did).
- **W16. Rule previews are counts.** Each draft rule shows "Matches N pages" from `POST {P}/tier-rules/preview` (`would_apply`), debounced 300 ms. The preview has no sample URLs (gap G5); the mock shows none either.
- **W17. Worklists that count links open the Links tab.** `broken_and_redirected` and `links_to_non_indexable` are edge worklists in the API (`filter[worklist]` on `/internal-links/edges`). The mock shows them as chips on the Pages tab; here their chips sit in the same row, say "links", and open the Links tab filtered to the worklist (gap G2).
- **W18. "No website" comes from the project.** The route already holds the project (`projectsOfMembership`), whose `primary_domain` is null when no website is set. No request is made in that state.
- **W19. The crawl in scope is always the latest finished crawl.** Slice 1 has no crawl picker (spec 7.10 moves it to slice 2). Every read sends no `run` (the API's default is `latest`). The header shows "Crawled 14 Nov, 40 pages" from the run with `is_latest` in `GET {P}/link-crawls?limit=10`, which is polled every 30 seconds while a run is `queued`, `crawling` or `processing`.
- **W20. Single keys go through `useShortcut`.** Keys 1 to 8 and 0 on the Pages tab with a selection are nine small `TierKey` components, one `useShortcut('single-key')` each (a hook per component, never in a loop). The canvas's own keys (arrows, Enter, Space, F, Escape) are widget keys on a focused card, like the grid keys of 20-accessibility.md section 6.3; F also follows the single-key switch (`SingleKeysContext`), as section 14 requires of a printable key.
- **W21. Mocks are part of the work.** E2E runs against a build with `NEXT_PUBLIC_API_MOCKING=all`, so `src/mocks/handlers/internal-links.ts` answers every route of the contract from a fixture of the Eventus Security project (`eventus-security`, `eventussecurity.com`, the same site the mock shows), with module state reset by `onMockReset`. Tier changes live in the memory of one page session, as every handler's state does (`src/mocks/state.ts`).
- **W22. The settings section slugs are `tiers` and `links`.** `SettingsFrame` names a section's label `items.<slug>` in `messages/en.json`, whose keys must be camelCase, so the slugs are one word: workspace `/settings/tiers` ("Page tiers") and project `/settings/links` ("Internal links").

## Dependencies on plan 02

The generated client needs the backend's OpenAPI. Each backend task commits its routes to `backend/openapi/v1.json`; this plan regenerates `apps/web/src/lib/api/schema.ts` in its own commit right after (AGENTS.md).

| This plan | Needs from plan 02 | Can start before it lands |
|---|---|---|
| 0 Worktree | Nothing | Yes |
| 1 Tokens and `TierBadge` | Nothing | Yes |
| 2 Pure lib: scopes, tiers, flags, CSV | Nothing (structural types) | Yes |
| 3 Pure journey: codec, layout, geometry | Nothing (structural types) | Yes |
| 4 `LinkCard` and `LinkCanvas` | Nothing | Yes |
| 5 Client, queries, mocks | Tasks 3 (page tiers), 6 (rules, tags), 10 (crawls, settings, `map_internal_links`), 12 (reads) merged, or the backend branch merged into this one | No: see Task 5 step 1 |
| 6 to 16 Screens | Task 5 of this plan | After 5 |
| 17 Playwright flow | 6 to 16 | After 16 |
| 18 Final checks | All | Last |

While Task 5 waits, Tasks 1 to 4 run. If plan 02 is finished on `feat/internal-links-backend` but not merged, Task 5 merges that branch into this one (`git merge --no-ff origin/feat/internal-links-backend`), so the web branch can only merge into `develop` after the backend branch, which is the order anyway.

## File map

| File | Task | What it holds |
|---|---|---|
| `apps/web/src/styles/tokens.css`, `globals.css` | 1 | `--tier-1..8`, `--tier-none`, both themes, `--color-tier-*` |
| `apps/web/src/lib/design/contrast-requirements.ts`, `tokens.contrast.test.ts` | 1 | `TIER_TOKENS` at 3:1 |
| `apps/web/src/components/design-system/token-groups.ts` | 1 | "Page tiers" group |
| `apps/web/src/components/app/tier/tier-colors.ts`, `tier-badge.tsx` | 1 | Static class maps, `TierBadge` |
| `apps/web/src/components/app/chart/stacked-share-bar.tsx` | 1 | `tier-*` share colors |
| `apps/web/src/lib/internal-links/scopes.ts`, `tiers.ts`, `page-flags.ts`, `tier-csv.ts`, `flow.ts` | 2 | Pure rules |
| `apps/web/src/lib/internal-links/journey-codec.ts`, `journey-layout.ts`, `journey-geometry.ts` | 3 | Pure journey |
| `apps/web/src/components/app/link-canvas/link-card.tsx`, `link-canvas.tsx`, `canvas-edges.tsx`, `canvas-keys.ts` | 4 | Design-system components |
| `apps/web/src/components/design-system/link-canvas-section.tsx`, `registry.ts`, `section-slugs.ts` | 1, 4 | Preview section `links` |
| `docs/design-system/02-color-system.md`, `15-data-visualization.md`, `20-accessibility.md`, `25-component-inventory.md` | 1, 4, 8 | Specs |
| `apps/web/src/lib/api/schema.ts` (generated), `apps/web/src/lib/api/download.ts` | 5 | Client, CSV download |
| `apps/web/src/lib/internal-links/types.ts`, `queries.ts`, `mutations.ts` | 5 | Schema aliases, query and mutation options |
| `apps/web/src/mocks/internal-links-fixtures.ts`, `apps/web/src/mocks/handlers/internal-links.ts`, `handlers/index.ts`, `respond.ts` | 5 | Mock API |
| `apps/web/src/lib/navigation/registry.ts`, `registry.test.ts` | 6 | Sidebar item |
| `apps/web/src/app/[workspace]/[project]/seo/internal-links/page.tsx` | 6 | Route |
| `apps/web/src/features/internal-links/index.ts`, `url-state.ts`, `internal-links-screen.tsx`, `crawl-header.tsx`, `crawl-states.tsx`, `summary-strip.tsx`, `crawl-reads.ts` | 6 | Shell |
| `apps/web/src/features/internal-links/pages/*` | 7, 8 | Pages tab, bulk bar, keys |
| `apps/web/src/features/internal-links/inspector/*` | 9 | Page inspector |
| `apps/web/src/features/internal-links/links/*` | 10 | Links tab |
| `apps/web/src/features/internal-links/journey/*` | 11 | Journey tab |
| `apps/web/src/features/internal-links/flow/*` | 12 | Tier flow tab |
| `apps/web/src/features/internal-links/rules/*` | 13 | Tier rules and CSV import dialogs |
| `apps/web/src/features/workspace-settings/page-tiers/*`, routes `settings/tiers` | 14 | Page tiers settings |
| `apps/web/src/features/project-settings/internal-links-screen.tsx`, route `settings/links`, `features/settings/settings-frame.tsx`, `lib/routes/paths.ts` | 14, 15 | Settings sections |
| `apps/web/src/features/onboarding/new-project-form.tsx`, `new-project.test.tsx` | 15 | The checkbox |
| `apps/web/e2e/flows/internal-links.spec.ts`, `apps/web/e2e/support/internal-links.ts`, `apps/web/e2e/visual/pages.spec.ts` | 17 | Flow, axe, baselines |
| `apps/web/messages/en.json` | 1 to 15 | Strings, in the task that first uses them |

## Mock to app map

Open the mock file beside the app file and copy the named parts exactly: classes are the mock's token utilities (they compile in the app), widths are the mock's, and copy is the mock's words with typographic quotes.

| App file | Mock file | Copy exactly |
|---|---|---|
| `components/app/tier/tier-badge.tsx` | `il-model.js` `tierBadge` | `inline-flex h-badge items-center gap-1.5 rounded-sm border border-border bg-surface px-1.5 type-label text-foreground whitespace-nowrap`; a `size-2 shrink-0 rounded-xs` square; the code alone, or "T1 Money pages" with `withName`; the title is the code and name |
| `components/app/link-canvas/link-card.tsx` | `il-journey.js` `cardButton`, `stubButton`, `groupButton`, `cardWrap` | Card: `relative w-full text-left rounded-md border border-l-4 px-2.5 py-2 flex flex-col gap-0.5`, focus card `border-primary-border ring-1 ring-primary-border`, others `border-border-strong`, opened `bg-primary-subtle`, else `bg-surface hover:bg-surface-hover`; three lines: path (`type-table text-foreground truncate`, `pr-12`), anchor or title (`type-label text-foreground-secondary truncate`), meta (tier code, "N linking pages", status badge, "Both ways" badge `bg-primary-subtle text-primary-text`). Stub: `border-dashed`, third line "Already on the canvas at step 1 out. Select to find it." Group: `bg-surface-subtle`, "Previous, next and related: N links" or "Menu and footer: N links", second line "Select to show them as cards." or "Shown as cards. Select to hide.". Hover tools top right: "Make /x the focus" (crosshair) and "Details of /x" (panel-right-open), `size-6` buttons. Back-link marker bottom right: corner-up-left icon and count, `aria-pressed` |
| `components/app/link-canvas/link-canvas.tsx` | `il-journey.js` `buildCanvas`, `column`, `drawEdges`, `elbow`, `legend`, `toolbar` | Scroller `overflow-auto bg-surface-subtle`, inner `relative flex w-max items-start p-4` with a 64 px column gap, columns `flex w-64 shrink-0 flex-col gap-2` with an `h3` `type-label text-foreground-tertiary` ("Step 2 in", "Focus page", "Step 1 out"), zoom steps 60, 80, 100, 120 percent, "Fit to view", legend `border-t border-border-subtle px-4 py-2 type-meta text-foreground-secondary` with six line samples, height = window minus top minus 72 px, at least 440 px |
| `lib/internal-links/journey-layout.ts` | `il-journey-layout.js` `buildJourney`, `treeRows`, `backsOf` | `PER_CARD = 8`, `MAX_CARDS = 300`, `MAX_STEPS = 12`; the three kinds; "Both ways" group on the first in column; one heading and one cap per tier on the first in column ("T1: 5"); stubs for pages already placed |
| `lib/internal-links/journey-geometry.ts` | `il-journey.js` `elbow`, `drawEdges`, `edgeLook` | `CORNER = 8`; spine halfway; quadratic corners; return arrow `M c,b C c,y c2,y c2,b2+3` with `y = max(bottoms) + 40`; dash `2 4` auto-generated, `6 4` template and return; colors `foreground-tertiary` editorial, `border-strong` others, `warning-text` redirect, `negative-text` broken; draw order template and auto, editorial, then redirect and broken |
| `features/internal-links/internal-links-screen.tsx`, `crawl-header.tsx` | `il.js` `pageRow`, `tabs`, `crawlMenu` (label only), `moreMenu`, `exportMenu` | Tab icons `file-text`, `link`, `workflow`, `grid-3x3`; right side: "Crawled 14 Nov, 40 pages" with the `radar` icon (no menu in slice 1), More actions (Tier rules, Import tiers from CSV, Crawl settings, Edit page tiers with "Workspace"), Export (Export this tab (CSV) only), Crawl now (primary, `refresh-cw`, "Crawling" with a spinning icon and disabled while a crawl runs) |
| `features/internal-links/summary-strip.tsx` | `il.js` `strip` | Pages, Tiered "37 of 40" (a link to the Untiered filter when not all are tiered), T1 pages, T1 average depth, No editorial links in; hidden below `md` |
| `features/internal-links/crawl-states.tsx` | `il.js` `stateBanner`, `emptyPanel`, `firstCrawlPanel` | Banner words of the mock per state; the first-crawl panel: radar icon, "Mapping eventussecurity.com", "1,240 pages found so far. Started 4 minutes ago, when the website was added.", a 2 px progress line, the lead "Tag your most important pages while you wait. Tiers do not need a crawl, and rules apply to every page the crawl finds.", "Set up tier rules", "Import tiers from CSV", eight `h-6` skeleton rows |
| `features/internal-links/pages/*` | `il-pages.js` `COLUMNS`, `chips`, `bulkBar`, `allMatchingNote`, `EMPTY` | Column labels, widths and header tips; issue chips row ("All pages", then each worklist with its count, "No issues" when all are 0); "Links: Editorial" scope menu; bulk bar "N pages selected", Set tier (tiers with their key, Untiered with 0, Reset to rule), Add tag, Remove tag, Open in journey (one page only, "Select one page to open its journey"), Export; empty worklist titles and reasons |
| `features/internal-links/inspector/*` | `il-drawer.js` `tierSection`, `metricStrip`, `linkingSection`, `pageList`, `flagsSection`, `FLAG_TEXT` | Tier select, source line "Manual, set by Priya Nair on 12 Nov" with "Reset to rule", tags with Add tag; strip Depth, Links in ("editorial, 36 in all"), Links out; "Linking pages by tier", "Linking pages by placement"; "Linking pages (N)" and "Outlinks (N)" with 8 rows and "View all in Links"; flag texts. Skip the route, suggestions, changes, tracked keywords, AI citations and anchor statistics sections (slices 2 and 3); keep a plain "Top anchors" list (spec 7.4) |
| `features/internal-links/links/*` | `il-links.js` `COLUMNS`, toolbar | Columns Source page, Source tier, Target page, Target tier, Anchor text, Placement, Rel, Target status, Target indexable, Occurrences; "Search source or target" (see gap G8); Placement and Links menus; empty "No links match" |
| `features/internal-links/journey/*` | `il-journey.js` `toolbar`, `viewSwitch`, `pagePicker`, `focusNote`, `treeTable`, `treeRow` | View switch Canvas and Tree list (no Path finder); focus picker with "Search pages" and the tier badge per row; Editorial and All links; zoom label, Zoom out, Zoom in, Fit to view; focus note lines ("18 editorial links in.", "Editorial orphan: no editorial links in. Choose All links to see the menu and automatic links that reach it.", "Redirect: it passes visitors to its target.", "Not found: this page has no links out."); tree columns Page, Tier, Anchor text, Link type, Linking pages, Status; muted rows "Links back to /x (step 0)" and "/x: listed above" |
| `features/internal-links/flow/*` | `il-flow.js` `summaryStrip`, `sentence`, `heatmap`, `lostRows` | Strip cells `min-w-48 flex-1` with the tier badge, "14 pages", "35.0% of pages, average depth 1.5" (no equity); the sentence "Supporting pages (T2) send 22 editorial links to T1."; table From, To T1 to Untiered, Total; cell names "26 editorial links from T1 Money pages to T1 Money pages, show them"; "Links to errors and non-indexable pages" with Page, Why, Pages linking to it |
| `features/internal-links/rules/*` | `il-dialogs.js` `openRules`, `openImportTiers` | Rules: title, description, rows of match type, path, tier, up, down, delete, "Matches N pages", "No rules yet...", Add rule, Save rules, Cancel, discard question. Import: title, description, the text area "Tiers as CSV", Check, the checked table, "Apply N tiers", toast "N pages tagged as T1" |
| `features/workspace-settings/page-tiers/*` | `il-settings.js` `mountPageTiers`, `openRename`, `removeTier` | Heading and description, table Tier, Name, Description, Pages, actions Rename and Delete, the fixed Untiered row ("Pages with no tier set and no matching rule", "Always there"), Add tier ("A workspace can have up to 8 tiers"), rename dialog hints, delete dialog with "Move them to:" and "Codes close up: T3 becomes T2." |
| `features/project-settings/internal-links-screen.tsx` | `il-settings.js` `mountInternalLinks` | Heading and description, Schedule select (Weekly, Every two weeks, Monthly, Off) with "Runs at night in the project's time zone", Render JavaScript with "Costs 10 times as much per page.", Allowed subdomains with its hint, Recent crawls table (When, Started by, Pages, Cost), "Open Internal links". Skip the alert rules (slice 2) and "Map internal links when a website is added" (gap G9) |
| `features/onboarding/new-project-form.tsx` | `il-dialogs.js` `openAddWebsite` | Checkbox "Map this site's internal links", ticked, with "Crawls the site in the background. About $0.15 per 1,000 pages." |

## Message keys

Strings land in `apps/web/messages/en.json` in the task that first uses them. The catalog test rejects dashes, straight double quotes, "n't" contractions, exclamation marks, double spaces and keys that are not camelCase. Quoted anchors use typographic quotes (“See plans”). Counts use ICU plurals: `{count, plural, one {# page} other {# pages}}`.

| Namespace | Holds | Task |
|---|---|---|
| `tierBadge` | The badge's accessible name pattern | 1 |
| `linkCanvas` | Card names, stub and group words, markers, tooltip rows, legend, zoom, full canvas message | 4 |
| `navigation.items.internalLinks` | "Internal links" | 6 |
| `internalLinks.title`, `.tabs.*`, `.header.*`, `.strip.*`, `.crawl.*`, `.states.*`, `.scope.*` | Shell | 6 |
| `internalLinks.pages.*`, `.columns.*`, `.flags.*`, `.worklists.*`, `.bulk.*` | Pages tab | 7, 8 |
| `internalLinks.inspector.*` | Inspector | 9 |
| `internalLinks.links.*` | Links tab | 10 |
| `internalLinks.journey.*` | Journey toolbar, focus note, tree list | 11 |
| `internalLinks.flow.*` | Tier flow | 12 |
| `internalLinks.rules.*`, `internalLinks.csv.*` | Dialogs | 13 |
| `pageTiers.*`, `settings.items.tiers` | Workspace settings | 14 |
| `internalLinksSettings.*`, `settings.items.links` | Project settings | 14 |
| `onboarding.mapLinks`, `onboarding.mapLinksHint` | Checkbox | 15 |

## URL state

All keys are read through `nuqs` with `parseAsString` and parsed by the pure `parseInternalLinksSearch` (Task 6); a value that does not read falls back to its default and nothing throws. `history: 'replace'` except `tab` and `focus`, which push (Back returns to the previous tab or focus, spec 7.5).

| Key | Values | Default | Read by |
|---|---|---|---|
| `tab` | `links`, `journey`, `flow` | Pages (no key) | Shell |
| `scope` | `auto_generated`, `template`, `all` | `editorial` (no key) | Every tab |
| `view` | `under_linked_t1`, `orphans`, `editorial_orphans`, `deep_only_through_auto` | none | Pages (worklist) |
| `lview` | `broken_and_redirected`, `links_to_non_indexable` | none | Links (worklist) |
| `sort` | `path`, `status_code`, `click_depth`, `linking_pages`, `outlinks`, each with `-` | `-linking_pages` | Pages |
| `q` | path contains, 1 to 200 characters | none | Pages |
| `tier`, `tag`, `status`, `idx`, `flag` | filter bar values (`13-filters-search.md` section 5) | none | Pages |
| `lq` | target path contains | none | Links |
| `sq`, `stier`, `ttier`, `place`, `tstatus` | filter bar values (`sq` is "Source page contains", gap G8); a tier flow cell writes `stier` and `ttier` (the mock's `pair`) | none | Links |
| `src`, `tgt` | a `url_id`: the links from or to one page (the inspector's "View all in Links") | none | Links |
| `focus` | a `url_id` | the home page (first page by path) | Journey |
| `jv` | `tree` | canvas (no key) | Journey |
| `dir` | `in` | `out` | Journey tree |
| `open` | card keys, comma separated (`o:12.34,i:56`) | none | Journey canvas |
| `grp` | group keys (`g:o:o:12:auto_generated`) | none | Journey canvas |
| `more` | `listKey*count` pairs | none | Journey canvas |
| `topen` | tree row keys | none | Journey tree |
| `inspect`, `itab` | `page:<url_id>` (house inspector) | none | Pages, Links |
| `density`, `cols` | house table state | compact, defaults | Pages, Links |

Re-centering clears `open`, `grp`, `more` and `topen` in the same write as `focus`.

## Accessibility checklist for the canvas

1. The scroller is `role="group"` named "Link journey canvas. The tree list shows the same journey as a table." (the mock's words), so the tree list is named as its text alternative.
2. Every card, stub, group card and "+N more" is a `button` in DOM order: columns left to right, items top to bottom.
3. A card's accessible name reads "/pricing, T1 Money pages, 12 linking pages, linked as “See plans”, content"; the focus card ends "focus page"; a stub "/pricing, already on the canvas at step 1 out. Select to find it."; a group card "Previous, next and related: 2 links. Select to show them as cards."
4. A card that can open has `aria-expanded`; a stub and the focus have none.
5. Arrow Right and Left move to the nearest card in the next or previous column (by vertical distance), Up and Down within a column; Enter and Space open or close; F makes the card the focus (and is off when single-key shortcuts are off); Escape returns focus to the focus card.
6. The back-link marker is a `button` with `aria-pressed` and the name "Links back to 2 earlier pages" ("Gets links back from 2 earlier pages" on the left); hover or focus draws the return arrows, click pins them.
7. Hover and focus show the house tooltip with title, tier, status, depth from home, linking pages editorial and all, this link's placement and rel, and "Links both ways" when reciprocal (no equity, W4).
8. The SVG layer is `aria-hidden`; nothing it shows is only there: edge kinds are in each card's name (placement), redirect and broken targets in the status badge, back links in the marker.
9. Zoom out, Zoom in and Fit to view are `IconButton`s with tooltips; zoom is never only a gesture.
10. Layout changes move in 150 ms with `motion-safe:transition-transform` and do not move under reduced motion; nothing animates on load.
11. Opening past 300 cards is refused with a toast "The canvas is full" and "It holds at most 300 cards. Close a card, or use the tree list to follow the rest."; focus stays on the card.
12. Focus survives a rebuild: after opening or closing, the card with the same key takes focus.
13. Every check runs in vitest-axe in both themes (Task 4) and in Playwright axe on the Journey tab (Task 17).

## Contract gaps for the backend

Each is coped with in this plan as stated; the backend can close it later without a web change unless noted.

| Id | What is missing | Exact field or parameter wanted | Web fallback here |
|---|---|---|---|
| G1 | No sort by tier on `GET {P}/internal-links/pages` | `sort=tier` and `-tier` (tier position, Untiered last, then path) | Default sort `-linking_pages` (W5); the Tier column does not sort |
| G2 | `broken_and_redirected` and `links_to_non_indexable` are edge worklists only | `filter[worklist]` values `broken_and_redirected` and `links_to_non_indexable` on the pages list, and page counts in `Worklists` (`pages_with_broken_and_redirected`, `pages_linking_to_non_indexable`) | The chips open the Links tab filtered to the edge worklist and count links (W17) |
| G3 | `/internal-links/neighbors` sorts by tier then equity share, which the UI does not show (W4) | Sorted by tier position (Untiered last), then `linking_pages_all` descending, then path | The web sorts loaded children again (W8) |
| G4 | Back links and per-tier groups need every link of a card | `filter[tier]` (tier id or `none`) on neighbors, and `meta.by_tier: TierCount[]` for the first in column; or `filter[url_ids]` to ask which earlier pages a card links to | Read 50 at a time, count among loaded (W7) |
| G5 | Rule preview has counts only | `TierRulePreview.sample_paths: string[]` (5) | Counts only, as the mock |
| G6 | CSV import has no dry run | `POST {P}/pages/tiers/import?dry_run=true` answering the same `TierImportResult` with `applied=false` | Client-side check with `parseTierCsv` (W14) |
| G7 | Rules are saved one by one | `PUT {P}/tier-rules` taking the whole ordered list `[{rule_id?, match_type, value, tier_id}]` in one transaction | Diff of DELETE, PATCH, POST calls (W15); a failure halfway leaves the rules partly saved, and the dialog says which rule failed |
| G8 | One search over source or target on edges | `q` matching source path or target path | The Links search box sends `q_target`; a filter field "Source page contains" sends `q_source` |
| G9 | No setting for "Map internal links when a website is added" on a project whose domain is set later, and `PATCH` of `primary_domain` cannot start a crawl | `InternalLinksSettings.map_on_add: bool` and `ProjectPatch.map_internal_links: bool` | The no-website state links to Settings > Domains; once a domain is set, the page offers Crawl now |
| G10 | No Search Console fields on `PageRow` | `gsc_clicks_28d`, `gsc_impressions_28d` (null when not connected) | The GSC columns of the mock are left out |
| G11 | `CrawlRun` has no host to name in "Mapping eventussecurity.com" | `CrawlRun.host` | The web names the project's `primary_domain.host` |

## Not in this plan

- Slice 2: the crawl picker and "Older crawl" badge, the Changes tab, alerts and alert rules, lost-link worklists, the "First seen" and "Lost on" columns and the Status menu of the Links tab, the Path finder view and "Route from home", the Change and Equity change columns, tracked keyword and average rank columns, anchor statistics ("Anchor text pointing here", generic anchors, anchor matches keyword), "T1 pages linking out to weak pages".
- Slice 3: link opportunities and the Opportunities tab, suggested links in the inspector, tier suggestions, AI citation columns, the client summary export.
- Any equity share figure (W4).
- Search Console columns (G10).
- Reordering tiers and per-project tier lists (spec 3, "when asked").

## Open points for the owner

- **P1. Page size.** The mock shows 25 rows with "Show 25 more"; the plan uses the house table's 100 and 200 rows a page with Previous and Next (W6). Changing it means a design-system change to `DataTable` page sizes.
- **P2. Rules cannot set Untiered.** The mock offers Untiered in a rule; the contract's rules always name a tier (W15). Manual Untiered stays available in the bulk bar and the inspector.
- **P3. Tier flow as a table.** Spec 7.6 names an ECharts heatmap; the plan follows the mock's table (W10).
- **P4. Motion on the canvas.** Spec 7.5 says layout changes move in 150 ms; the plan's canvas does not animate (cards appear and go at once, which also meets reduced motion). A FLIP animation can follow if the owner wants it.

---

### Task 0: Worktree, branch and a green baseline

**Files:** none changed.

- [ ] **Step 1: Make the worktree**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform
git fetch origin
git worktree add .claude/worktrees/internal-links-web -b feat/internal-links-web origin/develop
cd .claude/worktrees/internal-links-web
```

Expected: `Preparing worktree (new branch 'feat/internal-links-web')` and `HEAD is now at <sha>`.

- [ ] **Step 2: Run the gate on the untouched branch**

Run the gate of "The gate at the end of every task". Expected: every command passes. A failure here belongs to `develop`, not to this plan: report it and stop.

- [ ] **Step 3: Check what plan 02 has landed**

```bash
grep -c '"/api/v1/workspaces/{workspace_id}/page-tiers"\|internal-links/neighbors\|link-crawls' backend/openapi/v1.json
```

Expected while plan 02 is unmerged: `0`. Tasks 1 to 4 do not need it. Task 5 step 1 says what to do when it is still `0`.

---

### Task 1: Tier color tokens, `TierBadge` and tier share colors

**Files:**
- Modify: `apps/web/src/styles/tokens.css`, `apps/web/src/styles/globals.css`
- Modify: `apps/web/src/lib/design/contrast-requirements.ts`, `apps/web/src/lib/design/tokens.contrast.test.ts`
- Modify: `apps/web/src/components/design-system/token-groups.ts`
- Create: `apps/web/src/lib/internal-links/tiers.ts`, `apps/web/src/lib/internal-links/tiers.test.ts`
- Create: `apps/web/src/components/app/tier/tier-colors.ts`, `apps/web/src/components/app/tier/tier-badge.tsx`, `apps/web/src/components/app/tier/tier-badge.test.tsx`
- Modify: `apps/web/src/components/app/chart/stacked-share-bar.tsx`, `apps/web/src/components/app/chart/stacked-share-bar.test.tsx`
- Create: `apps/web/src/components/design-system/link-canvas-section.tsx`
- Modify: `apps/web/src/components/design-system/registry.ts`, `registry.test.tsx`, `section-slugs.ts`
- Modify: `apps/web/messages/en.json`
- Modify: `docs/design-system/02-color-system.md`, `docs/design-system/25-component-inventory.md`

The values below were measured with culori against `surface` on 2026-11-16 (light `oklch(0.997 0.001 255)`, dark `oklch(0.195 0.006 260)`):

| Token | Light | Ratio | Dark | Ratio |
|---|---|---|---|---|
| `--tier-1` | `oklch(0.38 0.150 262)` `#0F3A90` | 10.24 | `oklch(0.85 0.065 262)` `#B7CFF9` | 11.56 |
| `--tier-2` | `oklch(0.43 0.155 262)` `#1B49A3` | 8.28 | `oklch(0.80 0.085 262)` `#A0BEF5` | 9.77 |
| `--tier-3` | `oklch(0.48 0.160 262)` `#2757B6` | 6.66 | `oklch(0.76 0.120 262)` `#87B1FD` | 8.46 |
| `--tier-4` | `oklch(0.52 0.150 262)` `#3664BE` | 5.58 | `oklch(0.72 0.135 262)` `#75A3F9` | 7.30 |
| `--tier-5` | `oklch(0.56 0.135 262)` `#4772C3` | 4.68 | `oklch(0.68 0.140 262)` `#6796EE` | 6.28 |
| `--tier-6` | `oklch(0.59 0.115 262)` `#577CC1` | 4.11 | `oklch(0.64 0.130 262)` `#608BDB` | 5.38 |
| `--tier-7` | `oklch(0.62 0.095 262)` `#6686C0` | 3.63 | `oklch(0.60 0.115 262)` `#5A7FC5` | 4.59 |
| `--tier-8` | `oklch(0.645 0.075 262)` `#758EBC` | 3.28 (3.11 on `surface-subtle`) | `oklch(0.565 0.095 262)` `#5775AE` | 3.99 (3.82 on `surface-subtle`) |
| `--tier-none` | `oklch(0.600 0.010 256)` `#7C8186` | 3.91 | `oklch(0.600 0.010 256)` `#7C8186` | 4.64 |

- [ ] **Step 1: Write the failing contrast test**

In `apps/web/src/lib/design/contrast-requirements.ts`, append:

```ts
/**
 * The page tier scale (internal links, spec 7.9): the 4 px card edge and the badge square are marks that are
 * not text, so each tier reaches 3:1 on the surfaces a card or a badge sits on. The badge always pairs the
 * color with its code, so the color never carries the meaning alone.
 */
export const TIER_TOKENS = [
  'tier-1',
  'tier-2',
  'tier-3',
  'tier-4',
  'tier-5',
  'tier-6',
  'tier-7',
  'tier-8',
  'tier-none',
] as const;

/** The surfaces tier marks sit on: cards and badges on `surface`, the canvas on `surface-subtle`. */
export const TIER_SURFACES = ['surface', 'surface-subtle'] as const;
```

In `apps/web/src/lib/design/tokens.contrast.test.ts`, change the import to

```ts
import {
  LABEL_PAIRS,
  NON_TEXT_TOKENS,
  TEXT_SURFACES,
  TEXT_TOKENS,
  TIER_SURFACES,
  TIER_TOKENS,
} from './contrast-requirements';
```

and add inside `describe.each(Object.entries(themes))`, after the graphical mark test:

```ts
  it.each(TIER_SURFACES.flatMap((bg) => TIER_TOKENS.map((tier) => [tier, bg] as const)))(
    'page tier %s meets 3:1 on %s',
    (tier, bg) => {
      expect(wcagContrast(color(tokens, tier), color(tokens, bg))).toBeGreaterThanOrEqual(3);
    },
  );

  it('orders the tier scale by contrast, T1 the strongest', () => {
    const ratios = TIER_TOKENS.slice(0, 8).map((tier) => wcagContrast(color(tokens, tier), color(tokens, 'surface')));
    expect([...ratios].sort((a, b) => b - a)).toEqual(ratios);
  });
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd apps/web && pnpm vitest run src/lib/design/tokens.contrast.test.ts
```

Expected: FAIL, `missing token --tier-1`.

- [ ] **Step 3: Add the tokens**

In `apps/web/src/styles/tokens.css`, in the `:root` block after `--seq-7: oklch(0.40 0.150 262);`:

```css
  /* 1. Internal links: page tiers (one cobalt sequential scale, the strongest for T1; spec 7.9) */
  --tier-1: oklch(0.38 0.150 262);
  --tier-2: oklch(0.43 0.155 262);
  --tier-3: oklch(0.48 0.160 262);
  --tier-4: oklch(0.52 0.150 262);
  --tier-5: oklch(0.56 0.135 262);
  --tier-6: oklch(0.59 0.115 262);
  --tier-7: oklch(0.62 0.095 262);
  --tier-8: oklch(0.645 0.075 262);
  --tier-none: oklch(0.600 0.010 256);
```

In the `.dark` block after `--seq-7: oklch(0.80 0.10 262);`:

```css
  --tier-1: oklch(0.85 0.065 262);
  --tier-2: oklch(0.80 0.085 262);
  --tier-3: oklch(0.76 0.120 262);
  --tier-4: oklch(0.72 0.135 262);
  --tier-5: oklch(0.68 0.140 262);
  --tier-6: oklch(0.64 0.130 262);
  --tier-7: oklch(0.60 0.115 262);
  --tier-8: oklch(0.565 0.095 262);
  --tier-none: oklch(0.600 0.010 256);
```

In `apps/web/src/styles/globals.css`, after `--color-seq-7: var(--seq-7);`:

```css
  --color-tier-1: var(--tier-1);
  --color-tier-2: var(--tier-2);
  --color-tier-3: var(--tier-3);
  --color-tier-4: var(--tier-4);
  --color-tier-5: var(--tier-5);
  --color-tier-6: var(--tier-6);
  --color-tier-7: var(--tier-7);
  --color-tier-8: var(--tier-8);
  --color-tier-none: var(--tier-none);
```

In `apps/web/src/components/design-system/token-groups.ts`, add a group after "Scales":

```ts
  {
    title: 'Page tiers',
    note: 'Internal links: the edge of a link card and the square of a tier badge. 3:1 on surface and surface-subtle.',
    tokens: ['tier-1', 'tier-2', 'tier-3', 'tier-4', 'tier-5', 'tier-6', 'tier-7', 'tier-8', 'tier-none'],
  },
```

- [ ] **Step 4: Run the token tests and see them pass**

```bash
pnpm vitest run src/lib/design/tokens.contrast.test.ts src/components/design-system/token-groups.test.ts
```

Expected: PASS, with 18 new tier cases per theme.

- [ ] **Step 5: Write the failing tier helper test**

`apps/web/src/lib/internal-links/tiers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { MAX_TIERS, tierLabel, tierPosition, UNTIERED_POSITION } from './tiers';

describe('tier helpers', () => {
  it('reads the position from the code the API sends', () => {
    expect(tierPosition({ code: 'T1' })).toBe(1);
    expect(tierPosition({ code: 'T8' })).toBe(8);
  });

  it('puts Untiered after every tier', () => {
    expect(tierPosition(null)).toBe(UNTIERED_POSITION);
    expect(UNTIERED_POSITION).toBeGreaterThan(MAX_TIERS);
  });

  it('refuses a code that is not T1 to T8', () => {
    expect(() => tierPosition({ code: 'T9' })).toThrow('Not a tier code: T9');
    expect(() => tierPosition({ code: 'X' })).toThrow('Not a tier code: X');
  });

  it('labels a tier with its code and name, as filters and tooltips show it', () => {
    expect(tierLabel({ code: 'T1', name: 'Money pages' }, 'Untiered')).toBe('T1 Money pages');
    expect(tierLabel(null, 'Untiered')).toBe('Untiered');
  });
});
```

- [ ] **Step 6: Run it and see it fail**

```bash
pnpm vitest run src/lib/internal-links/tiers.test.ts
```

Expected: FAIL, `Failed to resolve import "./tiers"`.

- [ ] **Step 7: Write the tier helpers**

`apps/web/src/lib/internal-links/tiers.ts`:

```ts
/**
 * Page tiers as the screens read them (spec 5.1): the code (T1 to T8) comes from the position, and a `null`
 * tier is Untiered. Structural types, so the helpers work on the API's `TierRef` and `PageTier` alike.
 */

/** A workspace has at most this many tiers. */
export const MAX_TIERS = 8;
/** Untiered sorts after every tier. */
export const UNTIERED_POSITION = 99;

export interface TierCodeLike {
  code: string;
}

export interface TierNameLike extends TierCodeLike {
  name: string;
}

const CODE = /^T([1-8])$/;

/** 1 for T1; `UNTIERED_POSITION` for Untiered. Throws on a code the API never sends. */
export function tierPosition(tier: TierCodeLike | null): number {
  if (tier === null) return UNTIERED_POSITION;
  const match = CODE.exec(tier.code);
  if (match === null) throw new Error(`Not a tier code: ${tier.code}`);
  return Number(match[1]);
}

/** "T1 Money pages", or the word for Untiered. */
export const tierLabel = (tier: TierNameLike | null, untiered: string): string =>
  tier === null ? untiered : `${tier.code} ${tier.name}`;
```

- [ ] **Step 8: Run it and see it pass**

```bash
pnpm vitest run src/lib/internal-links/tiers.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 9: Write the failing `TierBadge` test**

`apps/web/src/components/app/tier/tier-badge.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TierBadge } from './tier-badge';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const T1 = { code: 'T1', name: 'Money pages' };

afterEach(() => document.documentElement.classList.remove('dark'));

describe('TierBadge', () => {
  it('is an outline badge with a square in the tier color and the code', () => {
    renderWithProviders(<TierBadge tier={T1} />);
    const badge = screen.getByText('T1').closest('[data-slot="tier-badge"]');
    expect(badge).toHaveClass('h-badge', 'rounded-sm', 'border', 'border-border', 'bg-surface', 'type-label');
    expect(badge?.querySelector('[data-tier-square]')).toHaveClass('bg-tier-1', 'size-2');
    expect(badge).toHaveAttribute('title', 'T1 Money pages');
  });

  it('shows the code and the name where names show (filters, the inspector)', () => {
    renderWithProviders(<TierBadge tier={T1} withName />);
    expect(screen.getByText('T1 Money pages')).toBeInTheDocument();
  });

  it('shows Untiered with the neutral square and no title', () => {
    renderWithProviders(<TierBadge tier={null} />);
    const badge = screen.getByText('Untiered').closest('[data-slot="tier-badge"]');
    expect(badge?.querySelector('[data-tier-square]')).toHaveClass('bg-tier-none');
    expect(badge).not.toHaveAttribute('title');
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(
      <p>
        <TierBadge tier={T1} /> <TierBadge tier={{ code: 'T8', name: 'Archive' }} withName /> <TierBadge tier={null} />
      </p>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 10: Run it and see it fail**

```bash
pnpm vitest run src/components/app/tier/tier-badge.test.tsx
```

Expected: FAIL, `Failed to resolve import "./tier-badge"`.

- [ ] **Step 11: Write the color maps, the badge and its messages**

`apps/web/src/components/app/tier/tier-colors.ts`:

```ts
import { tierPosition, type TierCodeLike } from '@/lib/internal-links/tiers';

/**
 * Whole class names per tier position, so Tailwind compiles them (26 section 10: a class is never built from a
 * variable). Index 0 is T1; Untiered has its own entry.
 */
const FILLS = [
  'bg-tier-1',
  'bg-tier-2',
  'bg-tier-3',
  'bg-tier-4',
  'bg-tier-5',
  'bg-tier-6',
  'bg-tier-7',
  'bg-tier-8',
] as const;
const EDGES = [
  'border-l-tier-1',
  'border-l-tier-2',
  'border-l-tier-3',
  'border-l-tier-4',
  'border-l-tier-5',
  'border-l-tier-6',
  'border-l-tier-7',
  'border-l-tier-8',
] as const;

/** The fill of a tier's square or bar segment. */
export const tierFill = (tier: TierCodeLike | null): string =>
  tier === null ? 'bg-tier-none' : (FILLS[tierPosition(tier) - 1] ?? 'bg-tier-none');

/** The 4 px left edge of a link card. */
export const tierEdge = (tier: TierCodeLike | null): string =>
  tier === null ? 'border-l-tier-none' : (EDGES[tierPosition(tier) - 1] ?? 'border-l-tier-none');
```

`apps/web/src/components/app/tier/tier-badge.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { tierFill } from './tier-colors';
import { tierLabel, type TierNameLike } from '@/lib/internal-links/tiers';
import { cn } from '@/lib/utils';

export interface TierBadgeProps {
  /** `null` is Untiered. */
  tier: TierNameLike | null;
  /** "T1 Money pages" where names show (filters, tooltips, the inspector); the code alone in tables and cards. */
  withName?: boolean | undefined;
  className?: string | undefined;
}

/**
 * A page's tier (spec 7.9, 25 section 14.15): an outline badge with a square in the tier color and the code, so
 * the color never carries the meaning alone. The full name is the title of a code-only badge.
 */
export function TierBadge({ tier, withName = false, className }: TierBadgeProps): ReactElement {
  const t = useTranslations('tierBadge');
  const label = tierLabel(tier, t('untiered'));
  return (
    <span
      data-slot="tier-badge"
      title={tier !== null && !withName ? label : undefined}
      className={cn(
        'inline-flex h-badge items-center gap-1.5 rounded-sm border border-border bg-surface px-1.5 type-label whitespace-nowrap text-foreground',
        className,
      )}
    >
      <span data-tier-square="" aria-hidden="true" className={cn('size-2 shrink-0 rounded-xs', tierFill(tier))} />
      {withName || tier === null ? label : tier.code}
    </span>
  );
}
```

In `apps/web/messages/en.json`, add a top-level member before `"setupChecklist"`:

```json
  "tierBadge": {
    "untiered": "Untiered"
  },
```

- [ ] **Step 12: Run it and see it pass**

```bash
pnpm vitest run src/components/app/tier/tier-badge.test.tsx src/i18n/messages.test.ts
```

Expected: PASS.

- [ ] **Step 13: Give the share bar the tier colors**

In `apps/web/src/components/app/chart/stacked-share-bar.tsx`, widen `ShareColor`:

```ts
export type ShareColor =
  | `chart-${1 | 2 | 3 | 4 | 5 | 6}`
  | 'chart-other'
  | `rank-band-${1 | 2 | 3 | 4 | 5}`
  | 'rank-band-none'
  | `tier-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
  | 'tier-none';
```

add to `FILL`:

```ts
  'tier-1': 'bg-tier-1',
  'tier-2': 'bg-tier-2',
  'tier-3': 'bg-tier-3',
  'tier-4': 'bg-tier-4',
  'tier-5': 'bg-tier-5',
  'tier-6': 'bg-tier-6',
  'tier-7': 'bg-tier-7',
  'tier-8': 'bg-tier-8',
  'tier-none': 'bg-tier-none',
```

and add to `LABEL_ON` the measured text color of each fill (the test "leaves a label out only where neither text colour reaches 4.5 to 1" checks it: T1 to T5 carry `foreground-inverse` at 4.52 to 11.07 in both themes; T6 to T8 and Untiered reach 4.5 with neither token in one theme). `ShareBarCell` draws no label anyway; the record must still be true:

```ts
  'tier-1': 'text-foreground-inverse',
  'tier-2': 'text-foreground-inverse',
  'tier-3': 'text-foreground-inverse',
  'tier-4': 'text-foreground-inverse',
  'tier-5': 'text-foreground-inverse',
  'tier-6': null,
  'tier-7': null,
  'tier-8': null,
  'tier-none': null,
```

In `apps/web/src/components/app/chart/stacked-share-bar.test.tsx`, the `COLORS` list of the `LABEL_ON` tests names every share color; add the nine after `'rank-band-none',`:

```ts
    'tier-1',
    'tier-2',
    'tier-3',
    'tier-4',
    'tier-5',
    'tier-6',
    'tier-7',
    'tier-8',
    'tier-none',
```

Run `pnpm vitest run src/components/app/chart/stacked-share-bar.test.tsx`. Expected: PASS ("has an entry for every segment colour" counts 22).

- [ ] **Step 14: Add the preview section**

`apps/web/src/components/design-system/link-canvas-section.tsx`:

```tsx
import type { ReactElement } from 'react';

import { SpecimenGroup, SpecimenRow } from './specimen';
import { TierBadge } from '@/components/app/tier/tier-badge';

const TIERS = [
  { code: 'T1', name: 'Money pages' },
  { code: 'T2', name: 'Supporting pages' },
  { code: 'T3', name: 'Content pages' },
  { code: 'T4', name: 'Utility pages' },
  { code: 'T5', name: 'Campaign pages' },
  { code: 'T6', name: 'Archive' },
  { code: 'T7', name: 'Legal' },
  { code: 'T8', name: 'Other' },
];

/** Internal links (spec 7.9): the tier badge, and in Task 4 the link card and the canvas. */
export function LinkCanvasSection(): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <SpecimenGroup title="TierBadge" note="Code only in tables and cards; code and name in filters and the inspector.">
        <SpecimenRow label="Code">
          {TIERS.map((tier) => (
            <TierBadge key={tier.code} tier={tier} />
          ))}
          <TierBadge tier={null} />
        </SpecimenRow>
        <SpecimenRow label="Code and name">
          {TIERS.slice(0, 4).map((tier) => (
            <TierBadge key={tier.code} tier={tier} withName />
          ))}
          <TierBadge tier={null} withName />
        </SpecimenRow>
      </SpecimenGroup>
    </div>
  );
}
```

In `apps/web/src/components/design-system/section-slugs.ts`, add `'links',` after `'layouts',`. In `apps/web/src/components/design-system/registry.ts`, import `LinkCanvasSection` from `./link-canvas-section` and add after the `layouts` entry:

```ts
  { slug: 'links', title: 'Internal links', render: LinkCanvasSection },
```

In `apps/web/src/components/design-system/registry.test.tsx`, the test "lists the sections, in order, each once" names every slug: add `'links',` after `'layouts',`.

- [ ] **Step 15: Run the registry test**

```bash
pnpm vitest run src/components/design-system/registry.test.tsx
```

Expected: PASS, the `links` section rendered in both themes with no axe violation.

- [ ] **Step 16: Write the specs**

In `docs/design-system/02-color-system.md`, add after section 7.3's table:

```markdown
### 7.4 Page tiers

`--tier-1` to `--tier-8` and `--tier-none` color a page's tier in Internal links: the 4 px left edge of a link card and the square of a `TierBadge`. One cobalt sequential scale per theme, T1 the strongest contrast. Each reaches 3:1 on `surface` and `surface-subtle` in both themes (`tokens.contrast.test.ts`, `TIER_TOKENS`). The color is never the only cue: the badge always writes the code, and a card's name says its tier.

| Token | Light | Dark |
|---|---|---|
| `--tier-1` | `0.38 0.150 262` `#0F3A90` | `0.85 0.065 262` `#B7CFF9` |
| `--tier-2` | `0.43 0.155 262` `#1B49A3` | `0.80 0.085 262` `#A0BEF5` |
| `--tier-3` | `0.48 0.160 262` `#2757B6` | `0.76 0.120 262` `#87B1FD` |
| `--tier-4` | `0.52 0.150 262` `#3664BE` | `0.72 0.135 262` `#75A3F9` |
| `--tier-5` | `0.56 0.135 262` `#4772C3` | `0.68 0.140 262` `#6796EE` |
| `--tier-6` | `0.59 0.115 262` `#577CC1` | `0.64 0.130 262` `#608BDB` |
| `--tier-7` | `0.62 0.095 262` `#6686C0` | `0.60 0.115 262` `#5A7FC5` |
| `--tier-8` | `0.645 0.075 262` `#758EBC` | `0.565 0.095 262` `#5775AE` |
| `--tier-none` | `0.600 0.010 256` `#7C8186` | `0.600 0.010 256` `#7C8186` |
```

In `docs/design-system/25-component-inventory.md`, after entry 14.14 (`SERPPreview`), add:

````markdown
### 14.15 TierBadge
`components/app/tier/tier-badge.tsx` · V1 · [02 §7.4](02-color-system.md), internal link tracker spec 7.9

Purpose: a page's tier: an outline badge with a 8 px square in the tier color and the code ("T1"), or the code and name ("T1 Money pages").

```ts
interface TierBadgeProps {
  tier: { code: string; name: string } | null; // null is Untiered
  withName?: boolean;                          // default false
  className?: string;
}
```

- **Variants:** none (the color comes from the tier's position, `tier-colors.ts`).
- **States:** none; never wraps.
- **A11y:** plain text; the code or label is the meaning, the square is `aria-hidden`; a code-only badge has the label as its title.
- **Use:** tier cells of the Pages and Links tables, cards, the tier flow headers; `withName` in filters, tooltips, the inspector and settings.
- **Not for:** a choice of tier (a `Select` of labels), counts.
````

- [ ] **Step 17: Run the gate and commit**

Run the gate. Expected: every command passes.

```bash
git add apps/web/src/styles/tokens.css apps/web/src/styles/globals.css \
  apps/web/src/lib/design/contrast-requirements.ts apps/web/src/lib/design/tokens.contrast.test.ts \
  apps/web/src/components/design-system/token-groups.ts apps/web/src/lib/internal-links/tiers.ts \
  apps/web/src/lib/internal-links/tiers.test.ts apps/web/src/components/app/tier/tier-colors.ts \
  apps/web/src/components/app/tier/tier-badge.tsx apps/web/src/components/app/tier/tier-badge.test.tsx \
  apps/web/src/components/app/chart/stacked-share-bar.tsx apps/web/src/components/app/chart/stacked-share-bar.test.tsx \
  apps/web/src/components/design-system/link-canvas-section.tsx apps/web/src/components/design-system/registry.ts \
  apps/web/src/components/design-system/registry.test.tsx apps/web/src/components/design-system/section-slugs.ts \
  apps/web/messages/en.json docs/design-system/02-color-system.md docs/design-system/25-component-inventory.md
git commit -m "Internal links: page tier tokens, TierBadge and tier share colors"
```

---

### Task 2: Pure rules: link scopes, page flags, the tier CSV check and the tier flow

**Files:**
- Create: `apps/web/src/lib/internal-links/scopes.ts`, `scopes.test.ts`
- Create: `apps/web/src/lib/internal-links/page-flags.ts`, `page-flags.test.ts`
- Create: `apps/web/src/lib/internal-links/tier-csv.ts`, `tier-csv.test.ts`
- Create: `apps/web/src/lib/internal-links/flow.ts`, `flow.test.ts`

All four take structural types, so they run before the generated client exists and the API's types satisfy them.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/internal-links/scopes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { EDGE_SCOPES, inScope, parseLinkScope, scopeOf } from './scopes';

describe('link scopes (spec 4)', () => {
  it('maps each placement to its scope', () => {
    expect(scopeOf('content')).toBe('editorial');
    expect(scopeOf('auto_generated')).toBe('auto_generated');
    for (const placement of ['navigation', 'header', 'footer', 'sidebar', 'breadcrumb'] as const) {
      expect(scopeOf(placement)).toBe('template');
    }
  });

  it('lists the three edge scopes in the order group cards show them', () => {
    expect(EDGE_SCOPES).toEqual(['editorial', 'auto_generated', 'template']);
  });

  it('reads the address, editorial for anything else', () => {
    expect(parseLinkScope('all')).toBe('all');
    expect(parseLinkScope('template')).toBe('template');
    expect(parseLinkScope(null)).toBe('editorial');
    expect(parseLinkScope('equity')).toBe('editorial');
  });

  it('puts every edge in All and each edge in its own scope', () => {
    expect(inScope('template', 'all')).toBe(true);
    expect(inScope('template', 'editorial')).toBe(false);
    expect(inScope('editorial', 'editorial')).toBe(true);
  });
});
```

`apps/web/src/lib/internal-links/page-flags.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { pageFlags, type FlaggedPage } from './page-flags';

const page = (over: Partial<FlaggedPage> = {}): FlaggedPage => ({
  flags: [],
  broken_outlinks: 0,
  redirect_outlinks: 0,
  linking_pages: 5,
  is_indexable: true,
  status_code: 200,
  tier: { code: 'T2' },
  ...over,
});

describe('pageFlags (spec 7.2, mock il-model.js flags)', () => {
  it('has none for a healthy page', () => {
    expect(pageFlags(page(), 'editorial')).toEqual([]);
  });

  it('keeps the order of the mock: page errors, link structure, then outlinks', () => {
    const flags = pageFlags(
      page({ flags: ['deep_only_through_auto', 'orphan', 'redirect'], broken_outlinks: 2, redirect_outlinks: 1 }),
      'editorial',
    );
    expect(flags.map((flag) => flag.key)).toEqual([
      'redirect',
      'orphan',
      'deepOnlyThroughAuto',
      'brokenOutlinks',
      'redirectOutlinks',
    ]);
  });

  it('gives errors the negative tone and risks the warning tone', () => {
    const flags = pageFlags(page({ flags: ['broken', 'editorial_orphan'] }), 'editorial');
    expect(flags).toEqual([
      { key: 'errorPage', tone: 'negative' },
      { key: 'editorialOrphan', tone: 'warning' },
    ]);
  });

  it('flags a live, indexable T1 page with fewer than 3 editorial linking pages, only in the editorial scope', () => {
    const thin = page({ tier: { code: 'T1' }, linking_pages: 2 });
    expect(pageFlags(thin, 'editorial')).toEqual([{ key: 'fewEditorialLinks', tone: 'warning' }]);
    expect(pageFlags(thin, 'all')).toEqual([]);
    expect(pageFlags({ ...thin, is_indexable: false }, 'editorial').map((flag) => flag.key)).not.toContain(
      'fewEditorialLinks',
    );
  });

  it('marks a page whose placement is unknown in the neutral tone', () => {
    expect(pageFlags(page({ flags: ['placement_unknown'] }), 'editorial')).toEqual([
      { key: 'placementUnknown', tone: 'neutral' },
    ]);
  });
});
```

`apps/web/src/lib/internal-links/tier-csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { MAX_CSV_ROWS, parseTierCsv } from './tier-csv';

const TIERS = [
  { tier_id: 't1', code: 'T1', name: 'Money pages' },
  { tier_id: 't2', code: 'T2', name: 'Supporting pages' },
];

describe('parseTierCsv (spec 5.2, the Check step)', () => {
  it('reads a URL and a tier code or name per line, with or without a header', () => {
    const result = parseTierCsv('url,tier\nhttps://a.com/pricing,T1\n/contact,money pages\n', TIERS);
    expect(result.rows).toEqual([
      { line: 2, url: 'https://a.com/pricing', tierId: 't1' },
      { line: 3, url: '/contact', tierId: 't1' },
    ]);
    expect(result.errors).toEqual([]);
  });

  it('names unknown tiers and missing columns with their line numbers', () => {
    const result = parseTierCsv('/a,T9\n/b\n\n/c,T2', TIERS);
    expect(result.rows).toEqual([{ line: 4, url: '/c', tierId: 't2' }]);
    expect(result.errors).toEqual([
      { line: 1, code: 'unknown_tier', value: 'T9' },
      { line: 2, code: 'missing_column', value: '' },
    ]);
  });

  it('keeps quoted URLs whole', () => {
    expect(parseTierCsv('"/a,b",T2', TIERS).rows).toEqual([{ line: 1, url: '/a,b', tierId: 't2' }]);
  });

  it('refuses more rows than the API takes', () => {
    const text = Array.from({ length: MAX_CSV_ROWS + 1 }, (_, index) => `/p${String(index)},T1`).join('\n');
    expect(parseTierCsv(text, TIERS).errors).toEqual([{ line: MAX_CSV_ROWS + 1, code: 'too_many_rows', value: '' }]);
  });
});
```

`apps/web/src/lib/internal-links/flow.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { flowLevel, strongestSenderToT1, tierShares } from './flow';

const T1 = { tier_id: 'a', code: 'T1', name: 'Money pages' };
const T2 = { tier_id: 'b', code: 'T2', name: 'Supporting pages' };

describe('tier flow (spec 7.6, mock il-flow.js)', () => {
  it('leaves a zero cell without fill and bins the rest into six steps of the sequential scale', () => {
    expect(flowLevel(0, 26)).toBeNull();
    expect(flowLevel(1, 26)).toBe(1);
    expect(flowLevel(26, 26)).toBe(6);
    expect(flowLevel(14, 26)).toBe(4);
    expect(flowLevel(3, 0)).toBeNull();
  });

  it('finds the tier, other than T1, that sends the most links to T1', () => {
    const cells = [
      { from_tier: T1, to_tier: T1, links: 26 },
      { from_tier: T2, to_tier: T1, links: 22 },
      { from_tier: null, to_tier: T1, links: 1 },
    ];
    expect(strongestSenderToT1(cells)).toEqual({ from: T2, links: 22, top: T1 });
    expect(strongestSenderToT1([{ from_tier: T2, to_tier: T1, links: 0 }])).toEqual({ from: null, links: 0, top: T1 });
    expect(strongestSenderToT1([])).toBeNull();
  });

  it('gives each tier its share of the pages', () => {
    const shares = tierShares([
      { tier: T1, pages: 14, average_depth: 1.5 },
      { tier: null, pages: 26, average_depth: null },
    ]);
    expect(shares.total).toBe(40);
    expect(shares.rows.map((row) => row.share)).toEqual([0.35, 0.65]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd apps/web && pnpm vitest run src/lib/internal-links/
```

Expected: FAIL, four files with `Failed to resolve import`.

- [ ] **Step 3: Write the modules**

`apps/web/src/lib/internal-links/scopes.ts`:

```ts
/**
 * Link scopes (spec 4): editorial is `content`, auto-generated is `auto_generated`, template is navigation,
 * header, footer, sidebar and breadcrumb; All is the three together. Every count on screen follows the scope
 * in view, editorial by default.
 */

export const LINK_SCOPES = ['editorial', 'auto_generated', 'template', 'all'] as const;
export type LinkScope = (typeof LINK_SCOPES)[number];
export type EdgeScope = Exclude<LinkScope, 'all'>;
export const EDGE_SCOPES: readonly EdgeScope[] = ['editorial', 'auto_generated', 'template'];

export const PLACEMENTS = [
  'content',
  'auto_generated',
  'navigation',
  'header',
  'footer',
  'sidebar',
  'breadcrumb',
] as const;
export type Placement = (typeof PLACEMENTS)[number];

export const DEFAULT_SCOPE: LinkScope = 'editorial';

/** The message key of a scope under `internalLinks.scope` (keys are camelCase). */
export const SCOPE_KEY: Readonly<Record<LinkScope, 'editorial' | 'autoGenerated' | 'template' | 'all'>> = {
  editorial: 'editorial',
  auto_generated: 'autoGenerated',
  template: 'template',
  all: 'all',
};

/** The message key of a placement under `internalLinks.placement`. */
export const PLACEMENT_KEY: Readonly<
  Record<Placement, 'content' | 'autoGenerated' | 'navigation' | 'header' | 'footer' | 'sidebar' | 'breadcrumb'>
> = {
  content: 'content',
  auto_generated: 'autoGenerated',
  navigation: 'navigation',
  header: 'header',
  footer: 'footer',
  sidebar: 'sidebar',
  breadcrumb: 'breadcrumb',
};

export function scopeOf(placement: Placement): EdgeScope {
  if (placement === 'content') return 'editorial';
  if (placement === 'auto_generated') return 'auto_generated';
  return 'template';
}

export const inScope = (edge: EdgeScope, view: LinkScope): boolean => view === 'all' || edge === view;

/** The scope the address names; editorial for a missing or unknown value. */
export const parseLinkScope = (text: string | null | undefined): LinkScope =>
  LINK_SCOPES.find((scope) => scope === text) ?? DEFAULT_SCOPE;
```

`apps/web/src/lib/internal-links/page-flags.ts`:

```ts
import type { LinkScope } from './scopes';
import { tierPosition, type TierCodeLike } from './tiers';

/** What a page row carries that flags read (the API's `PageRow` satisfies it). */
export interface FlaggedPage {
  flags: readonly string[];
  broken_outlinks: number;
  redirect_outlinks: number;
  /** Linking pages in the scope in view. */
  linking_pages: number;
  is_indexable: boolean;
  status_code: number | null;
  tier: TierCodeLike | null;
}

export type FlagKey =
  | 'errorPage'
  | 'redirect'
  | 'nonIndexable'
  | 'orphan'
  | 'editorialOrphan'
  | 'deepOnlyThroughAuto'
  | 'placementUnknown'
  | 'brokenOutlinks'
  | 'redirectOutlinks'
  | 'fewEditorialLinks';

export interface DisplayFlag {
  key: FlagKey;
  tone: 'negative' | 'warning' | 'neutral';
}

/** The API's row flags, in the mock's order, with their key and tone. */
const ROW_FLAGS: readonly (readonly [string, DisplayFlag])[] = [
  ['broken', { key: 'errorPage', tone: 'negative' }],
  ['redirect', { key: 'redirect', tone: 'warning' }],
  ['non_indexable', { key: 'nonIndexable', tone: 'warning' }],
  ['orphan', { key: 'orphan', tone: 'negative' }],
  ['editorial_orphan', { key: 'editorialOrphan', tone: 'warning' }],
  ['deep_only_through_auto', { key: 'deepOnlyThroughAuto', tone: 'warning' }],
  ['placement_unknown', { key: 'placementUnknown', tone: 'neutral' }],
];

/** Fewer editorial linking pages than this makes a T1 page under-linked (spec 7.2). */
export const FEW_EDITORIAL_LINKS = 3;

/**
 * The flags a page shows (spec 7.2, mock `il-model.js` `flags`): the row's own flags, then two read from its
 * outlink counts, then "Few editorial links" for a live, indexable T1 page while the editorial scope is in view.
 */
export function pageFlags(page: FlaggedPage, scope: LinkScope): DisplayFlag[] {
  const flags = ROW_FLAGS.filter(([name]) => page.flags.includes(name)).map(([, flag]) => flag);
  if (page.broken_outlinks > 0) flags.push({ key: 'brokenOutlinks', tone: 'negative' });
  if (page.redirect_outlinks > 0) flags.push({ key: 'redirectOutlinks', tone: 'warning' });
  const liveT1 = page.status_code === 200 && page.is_indexable && page.tier !== null && tierPosition(page.tier) === 1;
  if (scope === 'editorial' && liveT1 && page.linking_pages < FEW_EDITORIAL_LINKS) {
    flags.push({ key: 'fewEditorialLinks', tone: 'warning' });
  }
  return flags;
}
```

`apps/web/src/lib/internal-links/tier-csv.ts`:

```ts
import { parseCsv } from '@/lib/csv/csv';

/** The API reads at most this many rows (its CSV body is at most 1 MB; plan 02 `too_many_rows`). */
export const MAX_CSV_ROWS = 20_000;

export interface CsvTier {
  tier_id: string;
  code: string;
  name: string;
}

export interface CsvTierRow {
  line: number;
  url: string;
  tierId: string;
}

export interface CsvTierError {
  line: number;
  code: 'unknown_tier' | 'missing_column' | 'too_many_rows';
  /** The tier text that did not match; empty for the other codes. */
  value: string;
}

const isHeader = (cells: readonly string[]): boolean =>
  cells[0]?.trim().toLowerCase() === 'url' && cells[1]?.trim().toLowerCase() === 'tier';

/**
 * The Check step of the CSV import (spec 5.2, decision W14): one page per line, `url` then `tier` (a code such as
 * T1 or a name such as Money pages, any letter case), an optional header line, blank lines skipped. Line numbers
 * are the lines of the text, so the errors point where the person typed. Whether a URL is in the crawl is the
 * API's answer (`pending`), not this check's.
 */
export function parseTierCsv(
  text: string,
  tiers: readonly CsvTier[],
): { rows: CsvTierRow[]; errors: CsvTierError[] } {
  const byName = new Map<string, string>();
  for (const tier of tiers) {
    byName.set(tier.code.toLowerCase(), tier.tier_id);
    byName.set(tier.name.trim().toLowerCase(), tier.tier_id);
  }
  const rows: CsvTierRow[] = [];
  const errors: CsvTierError[] = [];
  const lines = text.split(/\r?\n/);
  let counted = 0;
  for (const [index, raw] of lines.entries()) {
    const line = index + 1;
    const cells = parseCsv(raw)[0];
    if (cells === undefined) continue;
    if (line === 1 && isHeader(cells)) continue;
    counted += 1;
    if (counted > MAX_CSV_ROWS) {
      errors.push({ line, code: 'too_many_rows', value: '' });
      break;
    }
    const url = cells[0]?.trim() ?? '';
    const tierText = cells[1]?.trim() ?? '';
    if (url === '' || tierText === '') {
      errors.push({ line, code: 'missing_column', value: '' });
      continue;
    }
    const tierId = byName.get(tierText.toLowerCase());
    if (tierId === undefined) errors.push({ line, code: 'unknown_tier', value: tierText });
    else rows.push({ line, url, tierId });
  }
  return { rows, errors };
}
```

`apps/web/src/lib/internal-links/flow.ts`:

```ts
import { tierPosition, type TierNameLike } from './tiers';

/** Fill steps of a non-zero cell: indexes 1 to 6 of `SEQUENTIAL_BINS`, the lightest bin left for nothing. */
const STEPS = 6;

/** The bin index of a cell, or `null` for a zero cell (no fill, tertiary text, as the mock draws it). */
export function flowLevel(value: number, max: number): number | null {
  if (value <= 0 || max <= 0) return null;
  return Math.min(STEPS, Math.ceil((value / max) * STEPS));
}

export interface FlowCellLike<TTier extends TierNameLike> {
  from_tier: TTier | null;
  to_tier: TTier | null;
  links: number;
}

/**
 * The sentence above the matrix (mock `il-flow.js` `sentence`): the tier, other than T1, that sends the most links
 * to T1. `null` when the workspace has no T1 in the flow; `from: null, links: 0` when nothing reaches it.
 */
export function strongestSenderToT1<TTier extends TierNameLike>(
  cells: readonly FlowCellLike<TTier>[],
): { from: TTier | null; links: number; top: TTier } | null {
  const top = cells.map((cell) => cell.to_tier).find((tier) => tier !== null && tierPosition(tier) === 1);
  if (top === undefined || top === null) return null;
  const senders = cells.filter(
    (cell) => cell.to_tier !== null && tierPosition(cell.to_tier) === 1 && (cell.from_tier === null || tierPosition(cell.from_tier) !== 1),
  );
  const best = senders.reduce<FlowCellLike<TTier> | null>(
    (current, cell) => (current === null || cell.links > current.links ? cell : current),
    null,
  );
  if (best === null || best.links === 0) return { from: null, links: 0, top };
  return { from: best.from_tier, links: best.links, top };
}

export interface TierStatLike<TTier> {
  tier: TTier | null;
  pages: number;
  average_depth: number | null;
}

/** Each tier's share of the crawl's pages, for the strip (no equity: decision W4). */
export function tierShares<TTier>(
  stats: readonly TierStatLike<TTier>[],
): { total: number; rows: (TierStatLike<TTier> & { share: number })[] } {
  const total = stats.reduce((sum, stat) => sum + stat.pages, 0);
  return { total, rows: stats.map((stat) => ({ ...stat, share: total === 0 ? 0 : stat.pages / total })) };
}
```

- [ ] **Step 4: Run them and see them pass**

```bash
pnpm vitest run src/lib/internal-links/
```

Expected: PASS, 5 files (with `tiers.test.ts`).

- [ ] **Step 5: Run the gate and commit**

```bash
git add apps/web/src/lib/internal-links/scopes.ts apps/web/src/lib/internal-links/scopes.test.ts \
  apps/web/src/lib/internal-links/page-flags.ts apps/web/src/lib/internal-links/page-flags.test.ts \
  apps/web/src/lib/internal-links/tier-csv.ts apps/web/src/lib/internal-links/tier-csv.test.ts \
  apps/web/src/lib/internal-links/flow.ts apps/web/src/lib/internal-links/flow.test.ts
git commit -m "Internal links: pure scopes, page flags, tier CSV check and tier flow bins"
```

---

### Task 3: Pure journey: the address codec, the layout and the edge geometry

**Files:**
- Create: `apps/web/src/lib/internal-links/journey-codec.ts`, `journey-codec.test.ts`
- Create: `apps/web/src/lib/internal-links/journey-layout.ts`, `journey-layout.test.ts`
- Create: `apps/web/src/lib/internal-links/journey-geometry.ts`, `journey-geometry.test.ts`

The layout is the mock's `il-journey-layout.js` over lists that load lazily: it asks a `lookup` for each list it needs, records the request, and draws a `loading` item until the list arrives. Nothing here touches the DOM.

- [ ] **Step 1: Write the failing codec test**

`apps/web/src/lib/internal-links/journey-codec.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { formatKeySet, formatMore, MAX_ADDRESS_KEYS, parseKeySet, parseMore } from './journey-codec';

describe('the journey in the address (spec 7.5)', () => {
  it('reads and writes a set of keys as a comma list', () => {
    expect([...parseKeySet('o:1.2,i:3, ,o:1.2')]).toEqual(['o:1.2', 'i:3']);
    expect(formatKeySet(new Set(['o:1.2', 'i:3']))).toBe('o:1.2,i:3');
    expect(formatKeySet(new Set())).toBeNull();
    expect([...parseKeySet(null)]).toEqual([]);
  });

  it('drops keys with characters a key never has, and keeps at most 300', () => {
    expect([...parseKeySet('o:1.2,<script>,o:9')]).toEqual(['o:1.2', 'o:9']);
    const many = Array.from({ length: MAX_ADDRESS_KEYS + 5 }, (_, index) => `o:${String(index)}`).join(',');
    expect(parseKeySet(many).size).toBe(MAX_ADDRESS_KEYS);
  });

  it('reads and writes the "+N more" counts as key*count pairs', () => {
    const more = parseMore('m:o|f*2,m:i|f|t1*1,bad*0,m:x*abc');
    expect([...more]).toEqual([
      ['m:o|f', 2],
      ['m:i|f|t1', 1],
    ]);
    expect(formatMore(more)).toBe('m:o|f*2,m:i|f|t1*1');
    expect(formatMore(new Map())).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing layout test**

`apps/web/src/lib/internal-links/journey-layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  buildJourney,
  buildTree,
  cardKey,
  FOCUS_KEY,
  groupKey,
  isFull,
  MAX_CARDS,
  moreKey,
  PER_CARD,
  pruneJourney,
  type JourneyItem,
  type JourneyNeighbor,
  type JourneyState,
  type ListLookup,
  type LoadedList,
} from './journey-layout';
import type { EdgeScope, LinkScope } from './scopes';

const tier = (code: string | null): JourneyNeighbor['tier'] => (code === null ? null : { code, name: `${code} pages` });

function node(id: string, path: string, code: string | null, over: Partial<JourneyNeighbor> = {}): JourneyNeighbor {
  return {
    url_id: id,
    path,
    title: null,
    status_code: 200,
    redirect_url_id: null,
    tier: tier(code),
    linking_pages: 1,
    linking_pages_all: 1,
    click_depth: 1,
    anchor: path,
    placement: 'content',
    scope: 'editorial',
    rel: [],
    is_followed: true,
    has_children: true,
    reciprocal: false,
    ...over,
  };
}

const HOME = node('1', '/', 'T2');
const PRICING = node('2', '/pricing', 'T1', { reciprocal: true });
const BLOG = node('3', '/blog', 'T3');
const POST = node('4', '/blog/post', 'T3');
const OLD = node('5', '/old', null);
const ARCHIVE = node('6', '/archive', null);

/** Lists by "url|direction|scope". The focus is /, url 1. */
const LISTS: Record<string, readonly JourneyNeighbor[]> = {
  '1|out|editorial': [BLOG, PRICING],
  '2|out|editorial': [POST, HOME],
  '3|out|editorial': [POST],
  '4|out|editorial': [HOME, PRICING],
  '1|in|editorial': [PRICING, OLD],
  '5|in|editorial': [ARCHIVE, POST],
  '1|out|template': [ARCHIVE],
};
const OTHER: Record<string, LoadedList<JourneyNeighbor>['otherScopes']> = {
  '1|out|editorial': [{ scope: 'template', pages: 1 }],
};

function lookupFrom(lists: Record<string, readonly JourneyNeighbor[]>, totals: Record<string, number> = {}): ListLookup<JourneyNeighbor> {
  return ({ urlId, direction, scope }) => {
    const id = `${urlId}|${direction}|${scope}`;
    const items = lists[id] ?? [];
    return { status: 'ready', items, total: totals[id] ?? items.length, otherScopes: OTHER[id] ?? [] };
  };
}

const state = (over: Partial<JourneyState> = {}): JourneyState => ({
  focus: '1',
  scope: 'editorial' as LinkScope,
  open: new Set(),
  groups: new Set(),
  more: new Map(),
  ...over,
});

const ofKind = <K extends JourneyItem<JourneyNeighbor>['kind']>(items: readonly JourneyItem<JourneyNeighbor>[], kind: K) =>
  items.filter((item): item is Extract<JourneyItem<JourneyNeighbor>, { kind: K }> => item.kind === kind);

describe('buildJourney (spec 7.5, mock il-journey-layout.js)', () => {
  it('shows the focus page outlinks in step 1 out, by tier, nothing opened by itself', () => {
    const layout = buildJourney(state(), lookupFrom(LISTS));
    const cards = ofKind(layout.out[0]?.items ?? [], 'card');
    expect(cards.map((card) => card.node.path)).toEqual(['/pricing', '/blog']);
    expect(cards.every((card) => !card.open)).toBe(true);
    expect(layout.out).toHaveLength(1);
  });

  it('collapses the other scopes of an opened card into group cards with their counts', () => {
    const groups = ofKind(buildJourney(state(), lookupFrom(LISTS)).out[0]?.items ?? [], 'group');
    expect(groups).toEqual([
      expect.objectContaining({ scope: 'template', count: 1, open: false, key: groupKey('out', FOCUS_KEY, 'template') }),
    ]);
  });

  it('opens a group card into cards of its scope', () => {
    const layout = buildJourney(state({ groups: new Set([groupKey('out', FOCUS_KEY, 'template')]) }), lookupFrom(LISTS));
    expect(ofKind(layout.out[0]?.items ?? [], 'card').map((card) => card.node.path)).toContain('/archive');
  });

  it('makes a link to a page two steps back a back-link marker, never a card', () => {
    const pricing = cardKey('out', ['2']);
    const post = cardKey('out', ['2', '4']);
    const layout = buildJourney(state({ open: new Set([pricing, post]) }), lookupFrom(LISTS));
    const postCard = ofKind(layout.out[1]?.items ?? [], 'card').find((card) => card.key === post);
    expect(postCard?.backs.map((back) => [back.urlId, back.key])).toEqual([
      ['1', FOCUS_KEY],
      ['2', pricing],
    ]);
    // The post's links all lead back: no third column
    expect(layout.out).toHaveLength(2);
  });

  it('makes a link to a page in a sibling branch a stub that points at the original', () => {
    const layout = buildJourney(
      state({ open: new Set([cardKey('out', ['2']), cardKey('out', ['3'])]) }),
      lookupFrom(LISTS),
    );
    const second = layout.out[1]?.items ?? [];
    expect(ofKind(second, 'card').map((card) => card.node.path)).toEqual(['/blog/post']);
    expect(ofKind(second, 'stub')).toEqual([expect.objectContaining({ urlId: '4', at: { dir: 'out', step: 2 } })]);
  });

  it('puts pages that link both ways with the focus in a "Both ways" group on the first in column, as cards when open', () => {
    const closed = buildJourney(state(), lookupFrom(LISTS));
    const first = closed.in[0]?.items ?? [];
    expect(ofKind(first, 'group')).toEqual([expect.objectContaining({ scope: 'both', count: 1 })]);
    expect(ofKind(first, 'tierhead').map((head) => [head.tier?.code ?? null, head.count])).toEqual([[null, 1]]);
    const open = buildJourney(state({ groups: new Set([groupKey('in', FOCUS_KEY, 'both')]) }), lookupFrom(LISTS));
    const cards = ofKind(open.in[0]?.items ?? [], 'card');
    expect(cards.map((card) => card.node.path)).toEqual(['/pricing', '/old']);
    expect(cards[0]?.bothWays).toBe(true);
  });

  it('follows the same rules on the left: an in-link from a page already on the canvas is a stub', () => {
    const old = cardKey('in', ['5']);
    const layout = buildJourney(
      state({ open: new Set([old, cardKey('out', ['2'])]) }),
      lookupFrom(LISTS),
    );
    const second = layout.in[1]?.items ?? [];
    expect(ofKind(second, 'card').map((card) => card.node.path)).toEqual(['/archive']);
    expect(ofKind(second, 'stub').map((stub) => [stub.node.path, stub.at])).toEqual([['/blog/post', { dir: 'out', step: 2 }]]);
  });

  it('shows 8 children a card, then "+N more", and 8 more for each press', () => {
    const many = Array.from({ length: 20 }, (_, index) => node(String(100 + index), `/p${String(index)}`, 'T3'));
    const lists = { '1|out|editorial': many };
    const first = buildJourney(state(), lookupFrom(lists)).out[0]?.items ?? [];
    expect(ofKind(first, 'card')).toHaveLength(PER_CARD);
    expect(ofKind(first, 'more')).toEqual([expect.objectContaining({ count: 12, key: moreKey('o|f') })]);
    const twice = buildJourney(state({ more: new Map([[moreKey('o|f'), 1]]) }), lookupFrom(lists)).out[0]?.items ?? [];
    expect(ofKind(twice, 'card')).toHaveLength(16);
  });

  it('counts the links it has not loaded yet in "+N more"', () => {
    const items = ofKind(buildJourney(state(), lookupFrom(LISTS, { '1|out|editorial': 60 })).out[0]?.items ?? [], 'more');
    expect(items).toEqual([expect.objectContaining({ count: 58 })]);
  });

  it('asks for every list it needs and draws a loading item until one arrives', () => {
    const loading: ListLookup<JourneyNeighbor> = () => ({ status: 'loading', items: [], total: 0, otherScopes: [] });
    const layout = buildJourney(state(), loading);
    expect(layout.pending).toBe(true);
    expect(layout.requests).toEqual([
      { urlId: '1', direction: 'out', scope: 'editorial', pages: 1 },
      { urlId: '1', direction: 'in', scope: 'editorial', pages: 1 },
    ]);
    expect(ofKind(layout.out[0]?.items ?? [], 'loading')).toHaveLength(1);
  });

  it('is full at 300 cards', () => {
    expect(MAX_CARDS).toBe(300);
    expect(isFull({ cardCount: 299 })).toBe(false);
    expect(isFull({ cardCount: 300 })).toBe(true);
  });

  it('drops opened keys that no longer exist once nothing is loading', () => {
    const stale = state({ open: new Set([cardKey('out', ['99'])]), more: new Map([[moreKey('o|o:99'), 1]]) });
    const layout = buildJourney(stale, lookupFrom(LISTS));
    expect(pruneJourney(stale, layout)).toEqual({ open: new Set(), groups: new Set(), more: new Map() });
    expect(pruneJourney(state(), buildJourney(state(), lookupFrom(LISTS)))).toBeNull();
  });
});

describe('buildTree (spec 7.5 tree list)', () => {
  it('shows a back link as a muted row and a page listed elsewhere as "listed above"', () => {
    const pricingKey = 't.2';
    const blogKey = 't.3';
    const { rows } = buildTree(
      { focus: '1', dir: 'out', scope: 'editorial' as EdgeScope, open: new Set([pricingKey, blogKey, 't.2.4']) },
      lookupFrom(LISTS),
    );
    expect(rows.map((row) => [row.kind, row.level, row.kind === 'page' && row.level === 0 ? 'focus' : row.key])).toEqual([
      ['page', 0, 'focus'],
      ['page', 1, 't.2'],
      ['back', 2, 't.2.1'],
      ['page', 2, 't.2.4'],
      ['back', 3, 't.2.4.2'],
      ['back', 3, 't.2.4.1'],
      ['page', 1, 't.3'],
      ['listed', 2, 't.3.4'],
    ]);
    const back = rows.find((row) => row.key === 't.2.4.1');
    expect(back).toEqual(expect.objectContaining({ kind: 'back', step: 0 }));
  });
});
```

- [ ] **Step 3: Write the failing geometry test**

`apps/web/src/lib/internal-links/journey-geometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { CORNER, edgeLook, elbowPath, returnArrowPath } from './journey-geometry';

const box = (left: number, top: number, width = 256, height = 72) => ({ left, top, width, height });

describe('edge geometry (mock il-journey.js elbow and drawEdges)', () => {
  it('draws a straight line between cards at the same height', () => {
    expect(elbowPath(box(0, 0), box(320, 0))).toBe('M256,36 H288 V36 H320');
  });

  it('turns down a spine halfway between the cards with rounded corners', () => {
    expect(CORNER).toBe(8);
    expect(elbowPath(box(0, 0), box(320, 100))).toBe('M256,36 H280 Q288,36 288,44 V128 Q288,136 296,136 H320');
  });

  it('turns up the same way', () => {
    expect(elbowPath(box(0, 100), box(320, 0))).toBe('M256,136 H280 Q288,136 288,128 V44 Q288,36 296,36 H320');
  });

  it('draws a return arrow below both cards, 40 px under the lower one', () => {
    expect(returnArrowPath(box(640, 0), box(0, 100))).toBe('M768,72 C768,212 128,212 128,175');
  });

  it('styles edges by scope and target status, and orders them so a colour shows on its own last segment', () => {
    expect(edgeLook('editorial', 200)).toEqual({ tone: 'editorial', dash: null, rank: 1 });
    expect(edgeLook('auto_generated', 200)).toEqual({ tone: 'muted', dash: '2 4', rank: 0 });
    expect(edgeLook('template', 200)).toEqual({ tone: 'muted', dash: '6 4', rank: 0 });
    expect(edgeLook('editorial', 301)).toEqual({ tone: 'redirect', dash: null, rank: 2 });
    expect(edgeLook('template', 404)).toEqual({ tone: 'broken', dash: '6 4', rank: 2 });
    expect(edgeLook(null, null)).toEqual({ tone: 'editorial', dash: null, rank: 1 });
  });
});
```

- [ ] **Step 4: Run them and see them fail**

```bash
cd apps/web && pnpm vitest run src/lib/internal-links/journey-
```

Expected: FAIL, three files with `Failed to resolve import`.

- [ ] **Step 5: Write the codec**

`apps/web/src/lib/internal-links/journey-codec.ts`:

```ts
/**
 * The opened cards, groups and "+N more" counts of the journey as address values (spec 7.5: a link reproduces the
 * view). Keys are built by `journey-layout.ts` from url ids (digits), `.`, `:`, `|`, scope names and short letters;
 * anything else in the address is dropped, never thrown on.
 */

/** The canvas holds at most 300 cards, so no address needs more keys than that. */
export const MAX_ADDRESS_KEYS = 300;
const KEY = /^[a-z0-9_.:|]{1,400}$/;
const MAX_MORE = 40;

export function parseKeySet(text: string | null | undefined): Set<string> {
  const keys = new Set<string>();
  for (const part of (text ?? '').split(',')) {
    const key = part.trim();
    if (!KEY.test(key)) continue;
    keys.add(key);
    if (keys.size === MAX_ADDRESS_KEYS) break;
  }
  return keys;
}

export const formatKeySet = (keys: ReadonlySet<string>): string | null => (keys.size === 0 ? null : [...keys].join(','));

export function parseMore(text: string | null | undefined): Map<string, number> {
  const more = new Map<string, number>();
  for (const part of (text ?? '').split(',')) {
    const at = part.lastIndexOf('*');
    if (at <= 0) continue;
    const key = part.slice(0, at).trim();
    const count = Number(part.slice(at + 1));
    if (!KEY.test(key) || !Number.isInteger(count) || count < 1 || count > MAX_MORE) continue;
    more.set(key, count);
    if (more.size === MAX_ADDRESS_KEYS) break;
  }
  return more;
}

export const formatMore = (more: ReadonlyMap<string, number>): string | null =>
  more.size === 0 ? null : [...more].map(([key, count]) => `${key}*${String(count)}`).join(',');
```

- [ ] **Step 6: Write the layout**

`apps/web/src/lib/internal-links/journey-layout.ts`:

```ts
import type { EdgeScope, LinkScope, Placement } from './scopes';
import { tierPosition, type TierNameLike } from './tiers';

/**
 * Which cards, stubs and group cards the journey canvas shows, and which rows the tree list shows (spec 7.5, the
 * mock's il-journey-layout.js). Each link of an opened card is one of three kinds: a new page (a card in the next
 * column), a back link (a page earlier on the card's own path: counted on the card, never a card) or a page seen
 * elsewhere (a stub that points at the original). Lists load lazily: the layout asks `lookup` for each list it
 * needs, records the request, and draws a `loading` item until it arrives.
 */

export const PER_CARD = 8;
export const MAX_CARDS = 300;
export const MAX_STEPS = 12;
/** The API's largest `limit` on neighbors. */
export const READ_LIMIT = 50;
export const FOCUS_KEY = 'f';

export type Direction = 'out' | 'in';

/** What the layout reads of a neighbor (the API's `Neighbor` satisfies it). */
export interface JourneyNeighbor {
  url_id: string;
  path: string;
  title: string | null;
  status_code: number | null;
  redirect_url_id: string | null;
  tier: TierNameLike | null;
  linking_pages: number;
  linking_pages_all: number;
  click_depth: number | null;
  anchor: string | null;
  placement: Placement | null;
  scope: EdgeScope | null;
  rel: readonly string[];
  is_followed: boolean;
  has_children: boolean;
  reciprocal: boolean;
}

/** One list: a page's links on one side in one scope, `pages` reads of `READ_LIMIT` from offset 0. */
export interface ListRequest {
  urlId: string;
  direction: Direction;
  scope: LinkScope;
  pages: number;
}

export interface LoadedList<N> {
  status: 'loading' | 'error' | 'ready';
  /** The rows of every page read so far, in the API's order. */
  items: readonly N[];
  total: number;
  otherScopes: readonly { scope: EdgeScope; pages: number }[];
}

export type ListLookup<N> = (request: ListRequest) => LoadedList<N>;

export interface JourneyState {
  focus: string;
  scope: LinkScope;
  open: ReadonlySet<string>;
  groups: ReadonlySet<string>;
  more: ReadonlyMap<string, number>;
}

export interface Placed {
  dir: Direction;
  step: number;
}

export interface BackLink<N> {
  urlId: string;
  /** The key of the earlier card on this card's path (`FOCUS_KEY` for the focus). */
  key: string;
  node: N;
}

export type JourneyItem<N> =
  | { kind: 'head'; parentKey: string; urlId: string }
  | { kind: 'tierhead'; tier: TierNameLike | null; count: number }
  | {
      kind: 'card';
      key: string;
      urlId: string;
      node: N;
      parentKey: string;
      dir: Direction;
      step: number;
      canOpen: boolean;
      open: boolean;
      bothWays: boolean;
      /** Links of an opened card to pages earlier on its path; empty while closed. */
      backs: readonly BackLink<N>[];
    }
  | { kind: 'stub'; key: string; urlId: string; node: N; parentKey: string; dir: Direction; at: Placed }
  | {
      kind: 'group';
      key: string;
      scope: EdgeScope | 'both';
      count: number;
      open: boolean;
      parentKey: string;
      dir: Direction;
    }
  | { kind: 'more'; key: string; parentKey: string; count: number }
  | { kind: 'loading'; key: string; parentKey: string }
  | { kind: 'failed'; key: string; parentKey: string; request: ListRequest };

export interface JourneyColumn<N> {
  step: number;
  items: JourneyItem<N>[];
}

export interface JourneyLayout<N> {
  out: JourneyColumn<N>[];
  in: JourneyColumn<N>[];
  cardCount: number;
  requests: ListRequest[];
  /** Every key the layout can show: opened, group and more keys outside it are stale. */
  validKeys: ReadonlySet<string>;
  /** A list is still loading: stale keys are not judged yet. */
  pending: boolean;
}

const side = (dir: Direction): string => (dir === 'out' ? 'o' : 'i');
export const cardKey = (dir: Direction, ids: readonly string[]): string => `${side(dir)}:${ids.join('.')}`;
export const groupKey = (dir: Direction, parentKey: string, scope: EdgeScope | 'both'): string =>
  `g:${side(dir)}:${parentKey}:${scope}`;
export const moreKey = (owner: string): string => `m:${owner}`;

/** Tier first (Untiered last), then the best linked, then the path (decision W8: no equity). */
export const compareChildren = (a: JourneyNeighbor, b: JourneyNeighbor): number =>
  tierPosition(a.tier) - tierPosition(b.tier) ||
  b.linking_pages_all - a.linking_pages_all ||
  a.path.localeCompare(b.path);

const readsFor = (shown: number): number => Math.max(1, Math.ceil(shown / READ_LIMIT));
const isStepOneOut = (placed: Placed | undefined): boolean => placed?.dir === 'out' && placed.step === 1;

interface Parent {
  key: string;
  urlId: string;
  /** Url ids from the focus to this page, both included. */
  path: readonly string[];
  /** The card keys of `path`, `FOCUS_KEY` first. */
  keys: readonly string[];
}

export const isFull = (layout: Pick<JourneyLayout<unknown>, 'cardCount'>): boolean => layout.cardCount >= MAX_CARDS;

export function buildJourney<N extends JourneyNeighbor>(state: JourneyState, lookup: ListLookup<N>): JourneyLayout<N> {
  const placed = new Map<string, Placed>();
  const requests = new Map<string, ListRequest>();
  const validKeys = new Set<string>([FOCUS_KEY]);
  let cardCount = 1;
  let pending = false;

  const read = (urlId: string, direction: Direction, scope: LinkScope, pages: number): LoadedList<N> => {
    const id = `${urlId}|${direction}|${scope}`;
    const known = requests.get(id);
    if (known === undefined || known.pages < pages) requests.set(id, { urlId, direction, scope, pages });
    const list = lookup({ urlId, direction, scope, pages: Math.max(pages, known?.pages ?? 0) });
    if (list.status === 'loading') pending = true;
    return list;
  };
  const moreOf = (key: string): number => state.more.get(key) ?? 0;

  const sides: Record<Direction, JourneyColumn<N>[]> = { out: [], in: [] };
  for (const dir of ['out', 'in'] as const) {
    let current: Parent[] = [{ key: FOCUS_KEY, urlId: state.focus, path: [state.focus], keys: [FOCUS_KEY] }];
    for (let step = 1; step <= MAX_STEPS && current.length > 0; step += 1) {
      const items: JourneyItem<N>[] = [];
      const next: Parent[] = [];
      for (const parent of current) {
        if (parent.key !== FOCUS_KEY && !state.open.has(parent.key)) continue;
        const free = (candidate: N): boolean =>
          candidate.url_id !== parent.urlId && !parent.path.includes(candidate.url_id);

        const emit = (nodes: readonly N[], owner: string, unloaded: number): void => {
          const key = moreKey(owner);
          validKeys.add(key);
          const limit = PER_CARD * (1 + moreOf(key));
          const sorted = [...nodes].sort(compareChildren);
          for (const child of sorted.slice(0, limit)) {
            const childKey = cardKey(dir, [...parent.path.slice(1), child.url_id]);
            validKeys.add(childKey);
            const at = placed.get(child.url_id);
            // A page that links both ways with the focus is a card on both sides (marked Both ways), not a stub
            const twoWay = dir === 'in' && parent.key === FOCUS_KEY && isStepOneOut(at);
            if (at !== undefined && !twoWay) {
              items.push({ kind: 'stub', key: childKey, urlId: child.url_id, node: child, parentKey: parent.key, dir, at });
              continue;
            }
            if (!twoWay) placed.set(child.url_id, { dir, step });
            const open = state.open.has(childKey);
            const path = [...parent.path, child.url_id];
            const keys = [...parent.keys, childKey];
            let backs: BackLink<N>[] = [];
            if (open) {
              // shortcut: back links are counted among the loaded neighbors (50 a request), upgrade when the API answers back links (gap G4)
              const own = read(child.url_id, dir, state.scope, readsFor(PER_CARD * (1 + moreOf(moreKey(`${side(dir)}|${childKey}`)))));
              backs = own.items
                .filter((link) => parent.path.includes(link.url_id))
                .map((link) => ({ urlId: link.url_id, key: keys[path.indexOf(link.url_id)] ?? FOCUS_KEY, node: link }));
            }
            items.push({
              kind: 'card',
              key: childKey,
              urlId: child.url_id,
              node: child,
              parentKey: parent.key,
              dir,
              step,
              canOpen: child.has_children && step < MAX_STEPS,
              open,
              bothWays: child.reciprocal,
              backs,
            });
            next.push({ key: childKey, urlId: child.url_id, path, keys });
            cardCount += 1;
          }
          const remaining = Math.max(0, sorted.length - limit) + unloaded;
          if (remaining > 0) items.push({ kind: 'more', key, parentKey: parent.key, count: remaining });
        };

        const owner = `${side(dir)}|${parent.key}`;
        const firstIn = dir === 'in' && parent.key === FOCUS_KEY;
        // The first in column caps per tier on what is loaded; its own "+N more" reads the next 50
        const pages = firstIn ? 1 + moreOf(moreKey(owner)) : readsFor(PER_CARD * (1 + moreOf(moreKey(owner))));
        const list = read(parent.urlId, dir, state.scope, pages);
        items.push({ kind: 'head', parentKey: parent.key, urlId: parent.urlId });
        if (list.status === 'loading') {
          items.push({ kind: 'loading', key: `l:${owner}`, parentKey: parent.key });
          continue;
        }
        if (list.status === 'error') {
          items.push({
            kind: 'failed',
            key: `e:${owner}`,
            parentKey: parent.key,
            request: { urlId: parent.urlId, direction: dir, scope: state.scope, pages },
          });
          continue;
        }
        const children = list.items.filter(free);
        const unloaded = Math.max(0, list.total - list.items.length);
        const groups = state.scope === 'all' ? [] : list.otherScopes.filter((group) => group.pages > 0);
        if (children.length === 0 && unloaded === 0 && groups.length === 0) {
          items.pop();
          continue;
        }
        if (firstIn) {
          const both = children.filter((child) => isStepOneOut(placed.get(child.url_id)));
          const rest = children.filter((child) => !both.includes(child));
          if (both.length > 0) {
            const key = groupKey('in', FOCUS_KEY, 'both');
            validKeys.add(key);
            const open = state.groups.has(key);
            items.push({ kind: 'group', key, scope: 'both', count: both.length, open, parentKey: FOCUS_KEY, dir });
            if (open) emit(both, key, 0);
          }
          const byTier = new Map<number, N[]>();
          for (const child of rest) {
            const position = tierPosition(child.tier);
            byTier.set(position, [...(byTier.get(position) ?? []), child]);
          }
          for (const position of [...byTier.keys()].sort((a, b) => a - b)) {
            const members = byTier.get(position) ?? [];
            items.push({ kind: 'tierhead', tier: members[0]?.tier ?? null, count: members.length });
            emit(members, `${owner}|t${String(position)}`, 0);
          }
          const loadKey = moreKey(owner);
          validKeys.add(loadKey);
          if (unloaded > 0) items.push({ kind: 'more', key: loadKey, parentKey: parent.key, count: unloaded });
        } else {
          emit(children, owner, unloaded);
        }
        for (const group of groups) {
          const key = groupKey(dir, parent.key, group.scope);
          validKeys.add(key);
          const open = state.groups.has(key);
          items.push({ kind: 'group', key, scope: group.scope, count: group.pages, open, parentKey: parent.key, dir });
          if (!open) continue;
          const groupPages = readsFor(PER_CARD * (1 + moreOf(moreKey(key))));
          const members = read(parent.urlId, dir, group.scope, groupPages);
          if (members.status === 'loading') items.push({ kind: 'loading', key: `l:${key}`, parentKey: parent.key });
          else if (members.status === 'error') {
            items.push({
              kind: 'failed',
              key: `e:${key}`,
              parentKey: parent.key,
              request: { urlId: parent.urlId, direction: dir, scope: group.scope, pages: groupPages },
            });
          } else emit(members.items.filter(free), key, Math.max(0, members.total - members.items.length));
        }
      }
      if (!items.some((item) => item.kind !== 'head')) break;
      sides[dir].push({ step, items });
      current = next;
    }
  }
  return { out: sides.out, in: sides.in, cardCount, requests: [...requests.values()], validKeys, pending };
}

/**
 * The opened cards, groups and counts that still exist once every list has loaded; `null` when nothing is stale
 * (or a list is still loading, so a key cannot be judged yet). A card that closes takes its descendants' keys
 * with it this way.
 */
export function pruneJourney(
  state: Pick<JourneyState, 'open' | 'groups' | 'more'>,
  layout: Pick<JourneyLayout<unknown>, 'validKeys' | 'pending'>,
): { open: Set<string>; groups: Set<string>; more: Map<string, number> } | null {
  if (layout.pending) return null;
  const open = new Set([...state.open].filter((key) => layout.validKeys.has(key)));
  const groups = new Set([...state.groups].filter((key) => layout.validKeys.has(key)));
  const more = new Map([...state.more].filter(([key]) => layout.validKeys.has(key)));
  const same = open.size === state.open.size && groups.size === state.groups.size && more.size === state.more.size;
  return same ? null : { open, groups, more };
}

export type TreeRow<N> =
  | { kind: 'page'; key: string; level: number; urlId: string; node: N | null; canOpen: boolean; open: boolean; bothWays: boolean }
  | { kind: 'back'; key: string; level: number; urlId: string; node: N; step: number }
  | { kind: 'listed'; key: string; level: number; urlId: string; node: N }
  | { kind: 'loading'; key: string; level: number }
  | { kind: 'failed'; key: string; level: number; request: ListRequest }
  | { kind: 'more'; key: string; level: number; count: number };

/**
 * The tree list (spec 7.5): one direction, rows in reading order. A link to a page earlier on the row's path is a
 * muted "Links back to" row, a page shown higher in the tree is "listed above"; neither expands. Each opened row
 * reads one page of 50 links; more than that is one muted "more" row.
 */
export function buildTree<N extends JourneyNeighbor>(
  input: { focus: string; dir: Direction; scope: LinkScope; open: ReadonlySet<string> },
  lookup: ListLookup<N>,
): { rows: TreeRow<N>[]; requests: ListRequest[]; pending: boolean } {
  const rows: TreeRow<N>[] = [];
  const requests: ListRequest[] = [];
  const listed = new Set<string>();
  let pending = false;

  const walk = (urlId: string, key: string, level: number, node: N | null, path: readonly string[]): void => {
    listed.add(urlId);
    const open = level === 0 || input.open.has(key);
    const canOpen = level === 0 || (node !== null && node.has_children && level < MAX_STEPS);
    rows.push({ kind: 'page', key, level, urlId, node, canOpen, open: open && canOpen, bothWays: node?.reciprocal ?? false });
    if (!open || !canOpen) return;
    const request: ListRequest = { urlId, direction: input.dir, scope: input.scope, pages: 1 };
    requests.push(request);
    const list = lookup(request);
    if (list.status === 'loading') {
      pending = true;
      rows.push({ kind: 'loading', key: `${key}.loading`, level: level + 1 });
      return;
    }
    if (list.status === 'error') {
      rows.push({ kind: 'failed', key: `${key}.failed`, level: level + 1, request });
      return;
    }
    for (const child of [...list.items].sort(compareChildren)) {
      if (child.url_id === urlId) continue;
      const childKey = `${key}.${child.url_id}`;
      if (path.includes(child.url_id)) {
        rows.push({ kind: 'back', key: childKey, level: level + 1, urlId: child.url_id, node: child, step: path.indexOf(child.url_id) });
      } else if (listed.has(child.url_id)) {
        rows.push({ kind: 'listed', key: childKey, level: level + 1, urlId: child.url_id, node: child });
      } else {
        walk(child.url_id, childKey, level + 1, child, [...path, child.url_id]);
      }
    }
    const unloaded = list.total - list.items.length;
    if (unloaded > 0) rows.push({ kind: 'more', key: `${key}.more`, level: level + 1, count: unloaded });
  };

  walk(input.focus, 't', 0, null, [input.focus]);
  return { rows, requests, pending };
}
```

- [ ] **Step 7: Write the geometry**

`apps/web/src/lib/internal-links/journey-geometry.ts`:

```ts
import type { EdgeScope } from './scopes';

/** The radius of an elbow's corners (mock `CORNER`). */
export const CORNER = 8;
/** How far below the lower card a return arrow dips. */
const RETURN_DIP = 40;

/** A card's rectangle inside the unscaled canvas, in pixels. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const right = (box: Box): number => box.left + box.width;
const middle = (box: Box): number => box.top + box.height / 2;
const bottom = (box: Box): number => box.top + box.height;
const center = (box: Box): number => box.left + box.width / 2;

/**
 * An orthogonal edge with rounded corners from the middle of `from`'s right side to the middle of `to`'s left side,
 * down a spine halfway between them (the mock's `elbow`). Cards of one parent share the spine.
 */
export function elbowPath(from: Box, to: Box): string {
  const startX = right(from);
  const startY = middle(from);
  const endX = to.left;
  const endY = middle(to);
  const spine = startX + (endX - startX) / 2;
  const dy = endY - startY;
  const r = Math.min(CORNER, Math.abs(dy) / 2, Math.abs(spine - startX), Math.abs(endX - spine));
  if (Math.abs(dy) < 1 || r < 1) return `M${startX},${startY} H${spine} V${endY} H${endX}`;
  const sign = dy > 0 ? 1 : -1;
  return `M${startX},${startY} H${spine - r} Q${spine},${startY} ${spine},${startY + sign * r} V${endY - sign * r} Q${spine},${endY} ${spine + r},${endY} H${endX}`;
}

/** A dashed return arrow from the bottom of `from` to the bottom of `to`, dipping under both (the mock's back-link arrows). */
export function returnArrowPath(from: Box, to: Box): string {
  const dip = Math.max(bottom(from), bottom(to)) + RETURN_DIP;
  return `M${center(from)},${bottom(from)} C${center(from)},${dip} ${center(to)},${dip} ${center(to)},${bottom(to) + 3}`;
}

export interface EdgeLook {
  tone: 'editorial' | 'muted' | 'redirect' | 'broken';
  dash: string | null;
  /** Drawn in rank order, so a redirect or broken colour shows on its own last segment. */
  rank: 0 | 1 | 2;
}

/**
 * The look of an edge (spec 7.5, the legend): editorial solid, auto-generated dotted, template dashed; amber into a
 * redirect and red into a broken target. `null` scope is the redirect child of a redirect focus and the Both ways
 * group, which draw as editorial.
 */
export function edgeLook(scope: EdgeScope | null, targetStatus: number | null): EdgeLook {
  const dash = scope === 'auto_generated' ? '2 4' : scope === 'template' ? '6 4' : null;
  if (targetStatus !== null && targetStatus >= 400) return { tone: 'broken', dash, rank: 2 };
  if (targetStatus !== null && targetStatus >= 300) return { tone: 'redirect', dash, rank: 2 };
  if (scope === null || scope === 'editorial') return { tone: 'editorial', dash, rank: 1 };
  return { tone: 'muted', dash, rank: 0 };
}
```

- [ ] **Step 8: Run them and see them pass**

```bash
pnpm vitest run src/lib/internal-links/journey-
```

Expected: PASS, 3 files. If the stub test of the left side fails because the post was placed at step 2 out, check that the out side is built before the in side (the `for (const dir of ['out', 'in'])` order): that is what makes `/blog/post` a stub on the left.

- [ ] **Step 9: Run the gate and commit**

```bash
git add apps/web/src/lib/internal-links/journey-codec.ts apps/web/src/lib/internal-links/journey-codec.test.ts \
  apps/web/src/lib/internal-links/journey-layout.ts apps/web/src/lib/internal-links/journey-layout.test.ts \
  apps/web/src/lib/internal-links/journey-geometry.ts apps/web/src/lib/internal-links/journey-geometry.test.ts
git commit -m "Internal links: pure journey layout, tree rows, edge geometry and address codec"
```

---

### Task 4: `LinkCard`, `LinkCanvas` and `ZoomControls`

**Files:**
- Create: `apps/web/src/components/app/link-canvas/link-card.tsx`
- Create: `apps/web/src/components/app/link-canvas/link-canvas.tsx`
- Create: `apps/web/src/components/app/link-canvas/zoom-controls.tsx`
- Create: `apps/web/src/components/app/link-canvas/link-canvas.test.tsx`
- Modify: `apps/web/src/components/design-system/link-canvas-section.tsx`
- Modify: `apps/web/messages/en.json`
- Modify: `docs/design-system/15-data-visualization.md`, `docs/design-system/20-accessibility.md`, `docs/design-system/25-component-inventory.md`

The canvas is presentational: it draws a `JourneyLayout` (Task 3) and reports what the person does through callbacks; the feature owns the reads and the address. Mock: `il-journey.js` `buildCanvas`, `cardButton`, `stubButton`, `groupButton`, `cardWrap`, `drawEdges`, `legend`, `toolbar` zoom part.

- [ ] **Step 1: Add the messages**

In `apps/web/messages/en.json`, add a top-level member after `"tierBadge"`:

```json
  "linkCanvas": {
    "label": "Link journey canvas. The tree list shows the same journey as a table.",
    "focusColumn": "Focus page",
    "stepOut": "Step {step} out",
    "stepIn": "Step {step} in",
    "from": "From {path}",
    "into": "Into {path}",
    "tierHead": "{tier}: {count}",
    "untiered": "Untiered",
    "linkingPages": "{count, plural, one {# linking page} other {# linking pages}}",
    "bothWays": "Both ways",
    "notCrawled": "Not crawled",
    "cardName": "{path}, {tier}, {linking}, linked as “{anchor}”, {placement}",
    "cardNameNoAnchor": "{path}, {tier}, {linking}, {placement}",
    "focusName": "{path}, {tier}, {linking}, focus page",
    "linkedAs": "{scope}: {anchor}",
    "stubLine": "Already on the canvas at {at}. Select to find it.",
    "stubName": "{path}, already on the canvas at {at}. Select to find it.",
    "atOut": "step {step} out",
    "atIn": "step {step} in",
    "groupAutoGenerated": "Previous, next and related: {count, plural, one {# link} other {# links}}",
    "groupTemplate": "Menu and footer: {count, plural, one {# link} other {# links}}",
    "groupEditorial": "Editorial: {count, plural, one {# link} other {# links}}",
    "groupBoth": "Both ways: {count, plural, one {# page} other {# pages}}",
    "groupBothMeta": "Also shown on the right, marked Both ways",
    "groupOpenMeta": "Shown as cards. Select to hide.",
    "groupClosedMeta": "Select to show them as cards.",
    "groupName": "{label}. {meta}",
    "more": "+{count} more",
    "moreName": "Show {count} more pages",
    "loading": "Loading links",
    "failed": "These links could not be loaded.",
    "retry": "Try again",
    "makeFocus": "Make {path} the focus",
    "details": "Details of {path}",
    "backOut": "Links back to {count, plural, one {# earlier page} other {# earlier pages}}",
    "backIn": "Gets links back from {count, plural, one {# earlier page} other {# earlier pages}}",
    "backTipOut": "Links back to earlier pages",
    "backTipIn": "Earlier pages that link here",
    "backTipHint": "Hover shows the return arrows. Select to keep them.",
    "backRow": "{tier} {path}: “{anchor}”, {scope}",
    "tipTier": "{tier}.",
    "tipStatus": "Status {status}.",
    "tipStatusUnknown": "Not crawled.",
    "tipDepth": "Depth from home {depth}.",
    "tipDepthNone": "Not reachable from home.",
    "tipLinking": "Linking pages: {scoped} in view, {all} in all.",
    "tipLink": "This link: {placement}, {rel}.",
    "tipBoth": "Links both ways.",
    "follow": "follow",
    "redirectTarget": "redirect target",
    "scope": {
      "editorial": "editorial",
      "autoGenerated": "auto-generated",
      "template": "menu and footer",
      "all": "all links"
    },
    "placement": {
      "content": "content",
      "autoGenerated": "auto-generated",
      "navigation": "navigation",
      "header": "header",
      "footer": "footer",
      "sidebar": "sidebar",
      "breadcrumb": "breadcrumb"
    },
    "legend": {
      "label": "Legend",
      "editorial": "Editorial",
      "autoGenerated": "Auto-generated (previous, next, related)",
      "template": "Menu and footer link",
      "redirect": "Through a redirect",
      "broken": "Broken target",
      "back": "Back link (shown on hover or when pinned)"
    },
    "zoomLevel": "{percent}%",
    "zoomOut": "Zoom out",
    "zoomIn": "Zoom in",
    "fit": "Fit to view"
  },
```

- [ ] **Step 2: Write the failing canvas test**

`apps/web/src/components/app/link-canvas/link-canvas.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LinkCanvas, type CanvasFocus, type LinkCanvasProps } from './link-canvas';
import { SingleKeysContext } from '@/lib/a11y/use-shortcut';
import {
  buildJourney,
  cardKey,
  type JourneyNeighbor,
  type JourneyState,
  type ListLookup,
} from '@/lib/internal-links/journey-layout';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

function node(id: string, path: string, code: string | null, over: Partial<JourneyNeighbor> = {}): JourneyNeighbor {
  return {
    url_id: id,
    path,
    title: `${path} title`,
    status_code: 200,
    redirect_url_id: null,
    tier: code === null ? null : { code, name: code === 'T1' ? 'Money pages' : 'Content pages' },
    linking_pages: 3,
    linking_pages_all: 5,
    click_depth: 1,
    anchor: `Go to ${path}`,
    placement: 'content',
    scope: 'editorial',
    rel: [],
    is_followed: true,
    has_children: true,
    reciprocal: false,
    ...over,
  };
}

const LISTS: Record<string, readonly JourneyNeighbor[]> = {
  '1|out|editorial': [node('3', '/blog', 'T3'), node('2', '/pricing', 'T1', { reciprocal: true })],
  '2|out|editorial': [node('4', '/blog/post', 'T3'), node('1', '/', 'T3')],
  '3|out|editorial': [node('4', '/blog/post', 'T3')],
  '4|out|editorial': [node('1', '/', 'T3'), node('2', '/pricing', 'T1')],
  '1|in|editorial': [node('5', '/old', null)],
};
const lookup: ListLookup<JourneyNeighbor> = ({ urlId, direction, scope }) => {
  const items = LISTS[`${urlId}|${direction}|${scope}`] ?? [];
  return { status: 'ready', items, total: items.length, otherScopes: [] };
};
const FOCUS: CanvasFocus = {
  urlId: '1',
  path: '/',
  title: 'Home',
  tier: { code: 'T3', name: 'Content pages' },
  linkingPages: 4,
  linkingPagesAll: 9,
  statusCode: 200,
  clickDepth: 0,
};
const base: JourneyState = { focus: '1', scope: 'editorial', open: new Set(), groups: new Set(), more: new Map() };

function canvas(over: Partial<LinkCanvasProps<JourneyNeighbor>> = {}, state: Partial<JourneyState> = {}) {
  const props: LinkCanvasProps<JourneyNeighbor> = {
    layout: buildJourney({ ...base, ...state }, lookup),
    focus: FOCUS,
    zoom: 1,
    pinned: new Set(),
    onTogglePin: vi.fn(),
    onToggleCard: vi.fn(),
    onToggleGroup: vi.fn(),
    onMore: vi.fn(),
    onRefocus: vi.fn(),
    onDetails: vi.fn(),
    onRetry: vi.fn(),
    onFull: vi.fn(),
    ...over,
  };
  return { props, ...renderWithProviders(<LinkCanvas {...props} />) };
}

afterEach(() => document.documentElement.classList.remove('dark'));

describe('LinkCanvas (spec 7.5)', () => {
  it('names the canvas region after its text alternative', () => {
    canvas();
    expect(
      screen.getByRole('group', { name: 'Link journey canvas. The tree list shows the same journey as a table.' }),
    ).toBeInTheDocument();
  });

  it('names each card like a sentence, and only cards that can open carry aria-expanded', () => {
    canvas();
    expect(screen.getByRole('button', { name: '/, T3 Content pages, 4 linking pages, focus page' })).not.toHaveAttribute(
      'aria-expanded',
    );
    const pricing = screen.getByRole('button', {
      name: '/pricing, T1 Money pages, 3 linking pages, linked as “Go to /pricing”, content',
    });
    expect(pricing).toHaveAttribute('aria-expanded', 'false');
    expect(within(pricing).getByText('Both ways')).toBeInTheDocument();
  });

  it('labels the columns from the focus', () => {
    canvas();
    expect(screen.getByRole('heading', { name: 'Focus page' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Step 1 out' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Step 1 in' })).toBeInTheDocument();
  });

  it('opens a card with Enter and moves with the arrows in reading order', async () => {
    const { props, user } = canvas();
    const pricing = screen.getByRole('button', { name: /^\/pricing, T1/ });
    pricing.focus();
    await user.keyboard('{Enter}');
    expect(props.onToggleCard).toHaveBeenCalledWith(cardKey('out', ['2']));
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: /^\/blog, T3/ })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: /focus page$/ })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: /^\/old, Untiered/ })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /focus page$/ })).toHaveFocus();
  });

  it('re-centers with F, and F does nothing when single-key shortcuts are off', async () => {
    const { props, user } = canvas();
    screen.getByRole('button', { name: /^\/pricing, T1/ }).focus();
    await user.keyboard('f');
    expect(props.onRefocus).toHaveBeenCalledWith('2');

    const onRefocus = vi.fn();
    const off = renderWithProviders(
      <SingleKeysContext value={false}>
        <LinkCanvas {...props} onRefocus={onRefocus} />
      </SingleKeysContext>,
    );
    within(off.container).getByRole('button', { name: /^\/pricing, T1/ }).focus();
    await off.user.keyboard('f');
    expect(onRefocus).not.toHaveBeenCalled();
  });

  it('shows back links on an opened card as a marker that pins its return arrows', async () => {
    const pricing = cardKey('out', ['2']);
    const post = cardKey('out', ['2', '4']);
    const { props, user } = canvas({}, { open: new Set([pricing, post]) });
    const marker = screen.getByRole('button', { name: 'Links back to 2 earlier pages' });
    expect(marker).toHaveAttribute('aria-pressed', 'false');
    await user.click(marker);
    expect(props.onTogglePin).toHaveBeenCalledWith(post);
  });

  it('makes a page seen elsewhere a stub that finds the original', async () => {
    const { user } = canvas({}, { open: new Set([cardKey('out', ['2']), cardKey('out', ['3'])]) });
    const stub = screen.getByRole('button', {
      name: '/blog/post, already on the canvas at step 2 out. Select to find it.',
    });
    expect(stub).not.toHaveAttribute('aria-expanded');
    await user.click(stub);
    expect(screen.getByRole('button', { name: /^\/blog\/post, T3 Content pages, 3 linking pages, linked/ })).toHaveFocus();
  });

  it('refuses to open past 300 cards and says why through onFull', async () => {
    const layout = { ...buildJourney(base, lookup), cardCount: 300 };
    const { props, user } = canvas({ layout });
    await user.click(screen.getByRole('button', { name: /^\/pricing, T1/ }));
    expect(props.onFull).toHaveBeenCalledTimes(1);
    expect(props.onToggleCard).not.toHaveBeenCalled();
  });

  it('opens the inspector and re-centers from the card tools', async () => {
    const { props, user } = canvas();
    await user.click(screen.getByRole('button', { name: 'Details of /pricing' }));
    expect(props.onDetails).toHaveBeenCalledWith('2');
    await user.click(screen.getByRole('button', { name: 'Make /pricing the focus' }));
    expect(props.onRefocus).toHaveBeenCalledWith('2');
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = canvas({}, { open: new Set([cardKey('out', ['2']), cardKey('out', ['2', '4'])]) });
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 3: Run it and see it fail**

```bash
cd apps/web && pnpm vitest run src/components/app/link-canvas/
```

Expected: FAIL, `Failed to resolve import "./link-canvas"`.

- [ ] **Step 4: Write `LinkCard`**

`apps/web/src/components/app/link-canvas/link-card.tsx`:

```tsx
'use client';

import { ChevronDown, ChevronRight, CornerUpLeft, Crosshair, PanelRightOpen } from 'lucide-react';
import type { KeyboardEvent, ReactElement } from 'react';

import { tierEdge } from '@/components/app/tier/tier-colors';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import type { TierNameLike } from '@/lib/internal-links/tiers';
import { cn } from '@/lib/utils';

/** What every node of the canvas carries for the keyboard model and the edges (spec 7.5). */
export interface CanvasNodeData {
  nodeKey: string;
  parentKey: string | null;
  column: number;
  urlId: string | null;
  kind: 'card' | 'stub' | 'group';
  /** The accessible name. */
  name: string;
  /** Dashed outline: a back link's target while its arrows show, or the original a stub found. */
  highlighted: boolean;
  onActivate: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

export interface LinkCardPageProps extends CanvasNodeData {
  kind: 'card';
  path: string;
  /** The link's anchor (with its scope when not editorial), or the title on the focus card. */
  line: string;
  tier: TierNameLike | null;
  /** The tier code, or the word for Untiered. */
  tierText: string;
  linkingText: string;
  /** The status badge for a page that is not 200; `null` for a 200. */
  status: { text: string; tone: 'warning' | 'negative' | 'neutral' } | null;
  bothWaysText: string | null;
  focus: boolean;
  /** `null`: the card cannot open. */
  open: boolean | null;
  tip: { content: string; detail: string };
  tools: { focusLabel: string | null; onFocusPage: () => void; detailsLabel: string; onDetails: () => void };
  back: {
    count: number;
    label: string;
    pressed: boolean;
    tip: { content: string; detail: string };
    onToggle: () => void;
    onShow: (shown: boolean) => void;
  } | null;
}

export interface LinkCardStubProps extends CanvasNodeData {
  kind: 'stub';
  path: string;
  line: string;
  tier: TierNameLike | null;
  note: string;
}

export interface LinkCardGroupProps extends CanvasNodeData {
  kind: 'group';
  label: string;
  meta: string;
  open: boolean;
}

export type LinkCardProps = LinkCardPageProps | LinkCardStubProps | LinkCardGroupProps;

const BASE = 'relative flex w-full flex-col gap-0.5 rounded-md border px-2.5 py-2 text-left focus-visible:focus-ring';
const HIGHLIGHT = 'outline-2 outline-offset-2 outline-primary outline-dashed';

function dataOf(props: CanvasNodeData): Record<string, string> {
  return {
    'data-node': '',
    'data-key': props.nodeKey,
    'data-kind': props.kind,
    'data-col': String(props.column),
    ...(props.parentKey === null ? {} : { 'data-parent': props.parentKey }),
    ...(props.urlId === null ? {} : { 'data-url': props.urlId }),
  };
}

/**
 * One node of the link canvas (spec 7.5 and 7.9, 25 section 14.16): a page card with a left edge in its tier color,
 * a dashed stub for a page already on the canvas, or a group card that stands for the links of another scope.
 */
export function LinkCard(props: LinkCardProps): ReactElement {
  if (props.kind === 'group') {
    return (
      <button
        type="button"
        {...dataOf(props)}
        aria-label={props.name}
        aria-expanded={props.open}
        onClick={props.onActivate}
        onKeyDown={props.onKeyDown}
        className={cn(BASE, 'border-border-strong bg-surface-subtle hover:bg-surface-hover', props.highlighted && HIGHLIGHT)}
      >
        <span className="flex items-center gap-1">
          <Icon icon={props.open ? ChevronDown : ChevronRight} size="xs" className="text-foreground-tertiary" />
          <span className="type-label text-foreground">{props.label}</span>
        </span>
        <span className="type-meta text-foreground-tertiary">{props.meta}</span>
      </button>
    );
  }
  if (props.kind === 'stub') {
    return (
      <button
        type="button"
        {...dataOf(props)}
        aria-label={props.name}
        onClick={props.onActivate}
        onKeyDown={props.onKeyDown}
        className={cn(
          BASE,
          'border-dashed border-l-4 border-border-strong bg-surface hover:bg-surface-hover',
          tierEdge(props.tier),
          props.highlighted && HIGHLIGHT,
        )}
      >
        <span className="truncate type-table text-foreground">{props.path}</span>
        <span className="truncate type-label text-foreground-secondary">{props.line}</span>
        <span className="type-meta text-foreground-tertiary">{props.note}</span>
      </button>
    );
  }
  const { back, tools } = props;
  return (
    <div className="group relative">
      <Tooltip content={props.tip.content} detail={props.tip.detail}>
        <button
          type="button"
          {...dataOf(props)}
          aria-label={props.name}
          aria-expanded={props.open === null ? undefined : props.open}
          onClick={props.onActivate}
          onKeyDown={props.onKeyDown}
          className={cn(
            BASE,
            'border-l-4',
            tierEdge(props.tier),
            props.focus ? 'border-primary-border ring-1 ring-primary-border' : 'border-border-strong',
            props.open === true ? 'bg-primary-subtle' : 'bg-surface hover:bg-surface-hover',
            props.highlighted && HIGHLIGHT,
          )}
        >
          <span className="flex min-w-0 items-center gap-1 pr-12">
            {props.open === null ? null : (
              <Icon icon={props.open ? ChevronDown : ChevronRight} size="xs" className="text-foreground-tertiary" />
            )}
            <span className="truncate type-table text-foreground">{props.path}</span>
          </span>
          <span className="truncate type-label text-foreground-secondary">{props.line}</span>
          <span
            className={cn(
              'flex flex-wrap items-center gap-x-1.5 gap-y-0.5 type-meta text-foreground-tertiary',
              back !== null && 'pr-10',
            )}
          >
            <span className="text-foreground-secondary">{props.tierText}</span>
            <span className="num">{props.linkingText}</span>
            {props.status === null ? null : <Badge tone={props.status.tone}>{props.status.text}</Badge>}
            {props.bothWaysText === null ? null : (
              <span className="inline-flex h-badge items-center rounded-sm bg-primary-subtle px-1.5 type-label whitespace-nowrap text-primary-text">
                {props.bothWaysText}
              </span>
            )}
          </span>
        </button>
      </Tooltip>
      <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
        {tools.focusLabel === null ? null : (
          <IconButton icon={Crosshair} size="icon-xs" variant="secondary" label={tools.focusLabel} onClick={tools.onFocusPage} />
        )}
        <IconButton icon={PanelRightOpen} size="icon-xs" variant="secondary" label={tools.detailsLabel} onClick={tools.onDetails} />
      </div>
      {back === null ? null : (
        <Tooltip content={back.tip.content} detail={back.tip.detail}>
          <button
            type="button"
            aria-label={back.label}
            aria-pressed={back.pressed}
            onClick={back.onToggle}
            onMouseEnter={() => back.onShow(true)}
            onMouseLeave={() => back.onShow(false)}
            onFocus={() => back.onShow(true)}
            onBlur={() => back.onShow(false)}
            className="absolute right-2.5 bottom-2 flex items-center gap-1 rounded-sm px-1 type-label whitespace-nowrap text-primary-text hover:underline focus-visible:focus-ring aria-pressed:bg-primary-subtle"
          >
            <Icon icon={CornerUpLeft} size="xs" />
            <span className="num">{back.count}</span>
          </button>
        </Tooltip>
      )}
    </div>
  );
}
```

`IconButton` defaults to `ghost`; the mock's tool buttons have a border (`border border-border bg-surface`), which is the `secondary` variant, so it is passed.

- [ ] **Step 5: Write `ZoomControls`**

`apps/web/src/components/app/link-canvas/zoom-controls.tsx`:

```tsx
'use client';

import { Scan, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { IconButton } from '@/components/ui/icon-button';

/** The zoom steps of the canvas (mock `ZOOMS`). */
export const ZOOMS = [0.6, 0.8, 1, 1.2] as const;
export type Zoom = (typeof ZOOMS)[number];

export interface ZoomControlsProps {
  zoom: Zoom;
  onZoomChange: (zoom: Zoom) => void;
  onFit: () => void;
}

/** Zoom out, zoom in and fit to view: the non-drag alternative to pan and zoom (spec 7.5). */
export function ZoomControls({ zoom, onZoomChange, onFit }: ZoomControlsProps): ReactElement {
  const t = useTranslations('linkCanvas');
  const at = ZOOMS.indexOf(zoom);
  return (
    <div className="ml-auto flex items-center gap-1.5">
      <span className="w-10 text-right type-meta num text-foreground-tertiary">
        {t('zoomLevel', { percent: Math.round(zoom * 100) })}
      </span>
      <IconButton
        icon={ZoomOut}
        label={t('zoomOut')}
        variant="secondary"
        size="icon-sm"
        disabled={at <= 0}
        onClick={() => onZoomChange(ZOOMS[at - 1] ?? zoom)}
      />
      <IconButton
        icon={ZoomIn}
        label={t('zoomIn')}
        variant="secondary"
        size="icon-sm"
        disabled={at >= ZOOMS.length - 1}
        onClick={() => onZoomChange(ZOOMS[at + 1] ?? zoom)}
      />
      <IconButton icon={Scan} label={t('fit')} variant="secondary" size="icon-sm" onClick={onFit} />
    </div>
  );
}
```

- [ ] **Step 6: Write `LinkCanvas`**

`apps/web/src/components/app/link-canvas/link-canvas.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import {
  use,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';

import { LinkCard, type LinkCardPageProps } from './link-card';
import { ZOOMS, type Zoom } from './zoom-controls';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SingleKeysContext } from '@/lib/a11y/use-shortcut';
import { edgeLook, elbowPath, returnArrowPath, type Box, type EdgeLook } from '@/lib/internal-links/journey-geometry';
import {
  FOCUS_KEY,
  isFull,
  type Direction,
  type JourneyItem,
  type JourneyLayout,
  type JourneyNeighbor,
  type ListRequest,
} from '@/lib/internal-links/journey-layout';
import { PLACEMENT_KEY, SCOPE_KEY } from '@/lib/internal-links/scopes';
import type { TierNameLike } from '@/lib/internal-links/tiers';
import { cn } from '@/lib/utils';

/** The page the journey is centered on, from the inspector read of the feature. */
export interface CanvasFocus {
  urlId: string;
  path: string;
  title: string | null;
  tier: TierNameLike | null;
  linkingPages: number;
  linkingPagesAll: number;
  statusCode: number | null;
  clickDepth: number | null;
}

export interface LinkCanvasHandle {
  /** The largest zoom step at which the whole journey fits the width. */
  fitZoom: () => Zoom;
}

export interface LinkCanvasProps<N extends JourneyNeighbor> {
  layout: JourneyLayout<N>;
  focus: CanvasFocus;
  /** Lines under the focus card: "18 editorial links in.", the orphan and redirect notes. */
  focusNote?: ReactNode;
  zoom: Zoom;
  /** Cards whose return arrows stay drawn. */
  pinned: ReadonlySet<string>;
  onTogglePin: (key: string) => void;
  onToggleCard: (key: string) => void;
  onToggleGroup: (key: string) => void;
  onMore: (key: string) => void;
  onRefocus: (urlId: string) => void;
  onDetails: (urlId: string) => void;
  onRetry: (request: ListRequest) => void;
  /** Opening was refused: the canvas holds 300 cards. */
  onFull: () => void;
  ref?: Ref<LinkCanvasHandle>;
}

/** The space between columns that the elbows' spine runs in (mock `gap-16`; a style, since 64 px is no spacing step). */
const COLUMN_GAP = 64;
const MIN_HEIGHT = 440;
/** The legend line and the page's bottom padding stay in view under the canvas. */
const BELOW = 72;
const FLASH_MS = 1500;

interface DrawnEdge {
  id: string;
  d: string;
  look: EdgeLook;
}

const STROKE: Readonly<Record<EdgeLook['tone'], string>> = {
  editorial: 'stroke-foreground-tertiary',
  muted: 'stroke-border-strong',
  redirect: 'stroke-warning-text',
  broken: 'stroke-negative-text',
};

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function statusBadge(status: number | null, notCrawled: string): LinkCardPageProps['status'] {
  if (status === null) return { text: notCrawled, tone: 'neutral' };
  if (status === 200) return null;
  return { text: String(status), tone: status >= 400 ? 'negative' : 'warning' };
}

/**
 * The link journey canvas (spec 7.5, 25 section 14.17): the focus in the middle column, links out to the right and
 * links in to the left, one column a step; elbow edges on a shared spine, return arrows for back links on hover,
 * focus or pin. Cards are buttons in reading order with the keyboard model of 20-accessibility.md section 7.1.
 */
export function LinkCanvas<N extends JourneyNeighbor>({
  layout,
  focus,
  focusNote,
  zoom,
  pinned,
  onTogglePin,
  onToggleCard,
  onToggleGroup,
  onMore,
  onRefocus,
  onDetails,
  onRetry,
  onFull,
  ref,
}: LinkCanvasProps<N>): ReactElement {
  const t = useTranslations('linkCanvas');
  const singleKeys = use(SingleKeysContext);
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const restoreKey = useRef<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [edges, setEdges] = useState<{ lines: DrawnEdge[]; arrows: DrawnEdge[]; width: number; height: number }>({
    lines: [],
    arrows: [],
    width: 0,
    height: 0,
  });
  const [height, setHeight] = useState(MIN_HEIGHT + 120);

  const tierText = useCallback((tier: TierNameLike | null): string => tier?.code ?? t('untiered'), [t]);
  const tierLong = useCallback(
    (tier: TierNameLike | null): string => (tier === null ? t('untiered') : `${tier.code} ${tier.name}`),
    [t],
  );

  // Every keyed item, the paths by url id (for the column heads), and the cards whose back links show
  const { byKey, pathOf } = useMemo(() => {
    const keyed = new Map<string, Extract<JourneyItem<N>, { kind: 'card' | 'stub' | 'group' }>>();
    const paths = new Map<string, string>([[focus.urlId, focus.path]]);
    for (const column of [...layout.out, ...layout.in]) {
      for (const item of column.items) {
        if (item.kind === 'card' || item.kind === 'stub' || item.kind === 'group') keyed.set(item.key, item);
        if (item.kind === 'card' || item.kind === 'stub') paths.set(item.urlId, item.node.path);
      }
    }
    return { byKey: keyed, pathOf: paths };
  }, [layout, focus.urlId, focus.path]);
  const shownBacks = useMemo(() => {
    const keys = new Set(pinned);
    if (hoverKey !== null) keys.add(hoverKey);
    return keys;
  }, [pinned, hoverKey]);
  const highlighted = useMemo(() => {
    const keys = new Set<string>();
    for (const key of shownBacks) {
      const item = byKey.get(key);
      if (item?.kind === 'card') for (const back of item.backs) keys.add(back.key);
    }
    if (flashKey !== null) keys.add(flashKey);
    return keys;
  }, [shownBacks, byKey, flashKey]);

  // Edges are measured from the cards as laid out, in unscaled pixels (the mock's `boxIn`)
  const draw = useCallback((): void => {
    const root = inner.current;
    if (root === null) return;
    const origin = root.getBoundingClientRect();
    const elements = new Map<string, Element>();
    for (const element of root.querySelectorAll('[data-node]')) {
      const key = element.getAttribute('data-key');
      if (key !== null) elements.set(key, element);
    }
    const boxOf = (key: string): Box | null => {
      const rect = elements.get(key)?.getBoundingClientRect();
      if (rect === undefined) return null;
      return {
        left: (rect.left - origin.left) / zoom,
        top: (rect.top - origin.top) / zoom,
        width: rect.width / zoom,
        height: rect.height / zoom,
      };
    };
    const statusOf = (key: string): number | null => {
      if (key === FOCUS_KEY) return focus.statusCode;
      const item = byKey.get(key);
      return item?.kind === 'card' || item?.kind === 'stub' ? item.node.status_code : null;
    };
    const lines: DrawnEdge[] = [];
    for (const [key, item] of byKey) {
      const parent = boxOf(item.parentKey);
      const child = boxOf(key);
      if (parent === null || child === null) continue;
      const inbound = item.dir === 'in';
      const look =
        item.kind === 'group'
          ? edgeLook(item.scope === 'both' ? null : item.scope, null)
          : edgeLook(item.node.scope, inbound ? statusOf(item.parentKey) : item.node.status_code);
      lines.push({ id: key, d: elbowPath(inbound ? child : parent, inbound ? parent : child), look });
    }
    lines.sort((a, b) => a.look.rank - b.look.rank);
    const arrows: DrawnEdge[] = [];
    for (const key of shownBacks) {
      const item = byKey.get(key);
      const from = boxOf(key);
      if (item?.kind !== 'card' || from === null) continue;
      for (const back of item.backs) {
        const to = boxOf(back.key);
        if (to === null) continue;
        const d = item.dir === 'out' ? returnArrowPath(from, to) : returnArrowPath(to, from);
        arrows.push({ id: `${key}>${back.key}`, d, look: { tone: 'editorial', dash: '6 4', rank: 2 } });
      }
    }
    setEdges({ lines, arrows, width: root.scrollWidth, height: root.scrollHeight });
  }, [byKey, shownBacks, zoom, focus.statusCode]);

  useLayoutEffect(() => {
    draw();
    // Focus survives a rebuild: the card that was activated takes it back
    const key = restoreKey.current;
    if (key !== null) {
      restoreKey.current = null;
      for (const element of inner.current?.querySelectorAll<HTMLElement>('[data-node]') ?? []) {
        if (element.dataset.key === key) element.focus({ preventScroll: true });
      }
    }
  }, [draw]);

  useEffect(() => {
    const root = inner.current;
    if (root === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => draw());
    observer.observe(root);
    return () => observer.disconnect();
  }, [draw]);

  // The canvas takes the rest of the window below its top, so a tall window shows more of the journey
  useLayoutEffect(() => {
    const fit = (): void => {
      const top = scroller.current?.getBoundingClientRect().top ?? 0;
      setHeight(Math.max(MIN_HEIGHT, Math.round(window.innerHeight - top - BELOW)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  useEffect(() => {
    if (flashKey === null) return undefined;
    const timer = window.setTimeout(() => setFlashKey(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flashKey]);

  useImperativeHandle(
    ref,
    () => ({
      fitZoom: () => {
        const room = scroller.current?.clientWidth ?? 0;
        const width = inner.current?.offsetWidth ?? 0;
        return [...ZOOMS].reverse().find((step) => width * step <= room) ?? ZOOMS[0];
      },
    }),
    [],
  );

  const nodesOf = (): HTMLElement[] => [...(inner.current?.querySelectorAll<HTMLElement>('[data-node]') ?? [])];
  const focusKey = (key: string): void => {
    for (const element of nodesOf()) if (element.dataset.key === key) element.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const current = event.currentTarget;
    const nodes = nodesOf();
    const column = Number(current.dataset.col);
    const topOf = (element: HTMLElement): number => element.getBoundingClientRect().top;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const columns = [...new Set(nodes.map((element) => Number(element.dataset.col)))].sort((a, b) => a - b);
      const ahead = step > 0 ? columns.filter((value) => value > column) : columns.filter((value) => value < column).reverse();
      const target = ahead[0];
      if (target === undefined) return;
      const here = nodes.filter((element) => Number(element.dataset.col) === target);
      const nearest = here.reduce<HTMLElement | null>(
        (best, element) =>
          best === null || Math.abs(topOf(element) - topOf(current)) < Math.abs(topOf(best) - topOf(current)) ? element : best,
        null,
      );
      if (nearest === null) return;
      event.preventDefault();
      nearest.focus();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const same = nodes.filter((element) => Number(element.dataset.col) === column);
      const next = same[same.indexOf(current) + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next === undefined) return;
      event.preventDefault();
      next.focus();
    } else if ((event.key === 'f' || event.key === 'F') && singleKeys && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      const urlId = current.dataset.url;
      if (urlId !== undefined && urlId !== focus.urlId && current.dataset.kind === 'card') onRefocus(urlId);
      else current.scrollIntoView?.({ block: 'center', inline: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      focusKey(FOCUS_KEY);
    }
  };

  const findOriginal = (urlId: string): void => {
    const original = nodesOf().find((element) => element.dataset.kind === 'card' && element.dataset.url === urlId);
    if (original === undefined) return;
    original.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    original.focus({ preventScroll: true });
    setFlashKey(original.dataset.key ?? null);
  };

  const opening = (open: boolean, run: () => void, key: string): void => {
    if (!open && isFull(layout)) {
      onFull();
      return;
    }
    restoreKey.current = key;
    run();
  };

  const linkedAs = (node: N): string => {
    if (node.anchor === null) return node.title ?? '';
    if (node.scope === null || node.scope === 'editorial') return node.anchor;
    return t('linkedAs', { scope: t(`scope.${SCOPE_KEY[node.scope]}`), anchor: node.anchor });
  };
  const placementWord = (node: N): string =>
    node.placement === null ? t('redirectTarget') : t(`placement.${PLACEMENT_KEY[node.placement]}`);

  const renderItem = (item: JourneyItem<N>, column: number, heads: number): ReactNode => {
    switch (item.kind) {
      case 'head':
        return heads > 1 ? (
          <p key={`head-${item.parentKey}`} className="truncate type-meta text-foreground-tertiary">
            {t(column > layout.in.length ? 'from' : 'into', { path: pathOf.get(item.urlId) ?? '' })}
          </p>
        ) : null;
      case 'tierhead':
        return (
          <p key={`tier-${item.tier?.code ?? 'none'}`} className="type-label text-foreground-tertiary">
            {t('tierHead', { tier: tierText(item.tier), count: item.count })}
          </p>
        );
      case 'loading':
        return (
          <div key={item.key} role="status" aria-label={t('loading')}>
            <Skeleton shape="block" height="row" />
          </div>
        );
      case 'failed':
        return (
          <div key={item.key} className="flex flex-col items-start gap-1 rounded-md border border-border-subtle bg-surface p-2">
            <p className="type-meta text-foreground-secondary">{t('failed')}</p>
            <Button variant="secondary" size="sm" onClick={() => onRetry(item.request)}>
              {t('retry')}
            </Button>
          </div>
        );
      case 'more':
        return (
          <Button
            key={item.key}
            variant="secondary"
            size="sm"
            data-node=""
            data-key={item.key}
            data-kind="more"
            data-col={String(column)}
            aria-label={t('moreName', { count: item.count })}
            onKeyDown={onKeyDown}
            onClick={() => opening(false, () => onMore(item.key), item.key)}
          >
            {t('more', { count: item.count })}
          </Button>
        );
      case 'group': {
        const label =
          item.scope === 'both'
            ? t('groupBoth', { count: item.count })
            : item.scope === 'auto_generated'
              ? t('groupAutoGenerated', { count: item.count })
              : item.scope === 'template'
                ? t('groupTemplate', { count: item.count })
                : t('groupEditorial', { count: item.count });
        const meta = item.scope === 'both' ? t('groupBothMeta') : item.open ? t('groupOpenMeta') : t('groupClosedMeta');
        return (
          <LinkCard
            key={item.key}
            kind="group"
            nodeKey={item.key}
            parentKey={item.parentKey}
            column={column}
            urlId={null}
            name={t('groupName', { label, meta })}
            highlighted={highlighted.has(item.key)}
            label={label}
            meta={meta}
            open={item.open}
            onActivate={() => opening(item.open, () => onToggleGroup(item.key), item.key)}
            onKeyDown={onKeyDown}
          />
        );
      }
      case 'stub': {
        const at = t(item.at.dir === 'out' ? 'atOut' : 'atIn', { step: item.at.step });
        return (
          <LinkCard
            key={item.key}
            kind="stub"
            nodeKey={item.key}
            parentKey={item.parentKey}
            column={column}
            urlId={item.urlId}
            name={t('stubName', { path: item.node.path, at })}
            highlighted={highlighted.has(item.key)}
            path={item.node.path}
            line={linkedAs(item.node)}
            tier={item.node.tier}
            note={t('stubLine', { at })}
            onActivate={() => findOriginal(item.urlId)}
            onKeyDown={onKeyDown}
          />
        );
      }
      case 'card':
        return renderCard(item, column);
    }
  };

  const tipOf = (
    path: string,
    tier: TierNameLike | null,
    status: number | null,
    depth: number | null,
    scoped: number,
    all: number,
    link: N | null,
    both: boolean,
  ): { content: string; detail: string } => ({
    content: path,
    detail: [
      t('tipTier', { tier: tierLong(tier) }),
      status === null ? t('tipStatusUnknown') : t('tipStatus', { status }),
      depth === null ? t('tipDepthNone') : t('tipDepth', { depth }),
      t('tipLinking', { scoped, all }),
      ...(link === null ? [] : [t('tipLink', { placement: placementWord(link), rel: link.rel.length === 0 ? t('follow') : link.rel.join(' ') })]),
      ...(both ? [t('tipBoth')] : []),
    ].join(' '),
  });

  const renderCard = (item: Extract<JourneyItem<N>, { kind: 'card' }>, column: number): ReactElement => {
    const { node } = item;
    const linking = t('linkingPages', { count: node.linking_pages });
    const backCount = item.backs.length;
    const name =
      node.anchor === null
        ? t('cardNameNoAnchor', { path: node.path, tier: tierLong(node.tier), linking, placement: placementWord(node) })
        : t('cardName', { path: node.path, tier: tierLong(node.tier), linking, anchor: node.anchor, placement: placementWord(node) });
    const backRows = item.backs.map((back) =>
      t('backRow', {
        tier: tierText(back.node.tier),
        path: back.node.path,
        anchor: back.node.anchor ?? '',
        scope: back.node.scope === null ? '' : t(`scope.${SCOPE_KEY[back.node.scope]}`),
      }),
    );
    return (
      <LinkCard
        key={item.key}
        kind="card"
        nodeKey={item.key}
        parentKey={item.parentKey}
        column={column}
        urlId={item.urlId}
        name={name}
        highlighted={highlighted.has(item.key)}
        path={node.path}
        line={linkedAs(node)}
        tier={node.tier}
        tierText={tierText(node.tier)}
        linkingText={linking}
        status={statusBadge(node.status_code, t('notCrawled'))}
        bothWaysText={item.bothWays ? t('bothWays') : null}
        focus={false}
        open={item.canOpen ? item.open : null}
        tip={tipOf(node.path, node.tier, node.status_code, node.click_depth, node.linking_pages, node.linking_pages_all, node, item.bothWays)}
        tools={{
          focusLabel: t('makeFocus', { path: node.path }),
          onFocusPage: () => onRefocus(item.urlId),
          detailsLabel: t('details', { path: node.path }),
          onDetails: () => onDetails(item.urlId),
        }}
        back={
          backCount === 0
            ? null
            : {
                count: backCount,
                label: t(item.dir === 'out' ? 'backOut' : 'backIn', { count: backCount }),
                pressed: pinned.has(item.key),
                tip: { content: t(item.dir === 'out' ? 'backTipOut' : 'backTipIn'), detail: [...backRows, t('backTipHint')].join(' ') },
                onToggle: () => onTogglePin(item.key),
                onShow: (shown) => setHoverKey(shown ? item.key : null),
              }
        }
        onActivate={() => {
          if (item.canOpen) opening(item.open, () => onToggleCard(item.key), item.key);
        }}
        onKeyDown={onKeyDown}
      />
    );
  };

  const column = (label: string, index: number, children: ReactNode): ReactElement => (
    <div key={`${label}-${String(index)}`} className="flex w-64 shrink-0 flex-col gap-2">
      <h3 className="type-label text-foreground-tertiary">{label}</h3>
      {children}
    </div>
  );
  const columnItems = (items: readonly JourneyItem<N>[], index: number): ReactNode => {
    const heads = items.filter((item) => item.kind === 'head').length;
    return items.map((item) => renderItem(item, index, heads));
  };

  const left = [...layout.in].reverse();
  const focusColumn = left.length;
  const focusLinking = t('linkingPages', { count: focus.linkingPages });
  const direction = (dir: Direction, step: number): string => t(dir === 'out' ? 'stepOut' : 'stepIn', { step });

  return (
    <div className="flex flex-col">
      <div
        ref={scroller}
        role="group"
        aria-label={t('label')}
        className="overflow-auto bg-surface-subtle"
        style={{ height }}
      >
        <div style={{ width: edges.width * zoom, height: edges.height * zoom }} className="relative">
          <div
            ref={inner}
            className="relative flex w-max items-start p-4"
            style={{ columnGap: COLUMN_GAP, transform: `scale(${String(zoom)})`, transformOrigin: '0 0' }}
          >
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute top-0 left-0"
              width={edges.width}
              height={edges.height}
            >
              <defs>
                <marker id="link-canvas-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M1 1L9 5L1 9z" className="fill-primary" />
                </marker>
              </defs>
              {edges.lines.map((line) => (
                <path
                  key={line.id}
                  d={line.d}
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray={line.look.dash ?? undefined}
                  className={STROKE[line.look.tone]}
                />
              ))}
              {edges.arrows.map((arrow) => (
                <path
                  key={arrow.id}
                  d={arrow.d}
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                  markerEnd="url(#link-canvas-arrow)"
                  className="stroke-primary"
                />
              ))}
            </svg>
            {left.map((side, index) => column(direction('in', side.step), index, columnItems(side.items, index)))}
            {column(
              t('focusColumn'),
              focusColumn,
              <div className="flex flex-col gap-2">
                <LinkCard
                  kind="card"
                  nodeKey={FOCUS_KEY}
                  parentKey={null}
                  column={focusColumn}
                  urlId={focus.urlId}
                  name={t('focusName', { path: focus.path, tier: tierLong(focus.tier), linking: focusLinking })}
                  highlighted={highlighted.has(FOCUS_KEY)}
                  path={focus.path}
                  line={focus.title ?? ''}
                  tier={focus.tier}
                  tierText={tierText(focus.tier)}
                  linkingText={focusLinking}
                  status={statusBadge(focus.statusCode, t('notCrawled'))}
                  bothWaysText={null}
                  focus
                  open={null}
                  tip={tipOf(focus.path, focus.tier, focus.statusCode, focus.clickDepth, focus.linkingPages, focus.linkingPagesAll, null, false)}
                  tools={{ focusLabel: null, onFocusPage: () => undefined, detailsLabel: t('details', { path: focus.path }), onDetails: () => onDetails(focus.urlId) }}
                  back={null}
                  onActivate={() => undefined}
                  onKeyDown={onKeyDown}
                />
                {focusNote}
              </div>,
            )}
            {layout.out.map((side, index) =>
              column(direction('out', side.step), focusColumn + 1 + index, columnItems(side.items, focusColumn + 1 + index)),
            )}
          </div>
        </div>
      </div>
      <Legend />
    </div>
  );
}

function Legend(): ReactElement {
  const t = useTranslations('linkCanvas.legend');
  const entries = [
    ['editorial', 'border-foreground-tertiary'],
    ['autoGenerated', 'border-dotted border-border-strong'],
    ['template', 'border-dashed border-border-strong'],
    ['redirect', 'border-warning-text'],
    ['broken', 'border-negative-text'],
    ['back', 'border-dashed border-primary'],
  ] as const;
  return (
    <ul
      aria-label={t('label')}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-subtle px-4 py-2 type-meta text-foreground-secondary"
    >
      {entries.map(([key, line]) => (
        <li key={key} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('w-6 border-t-2', line)} />
          {t(key)}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 7: Run the canvas tests and see them pass**

```bash
pnpm vitest run src/components/app/link-canvas/
```

Expected: PASS, 10 tests. jsdom has no layout, so the arrows move by DOM order within a column and by the first card of the next column; Playwright (Task 17) checks the real geometry.

- [ ] **Step 8: Add the canvas to the preview section**

Replace `apps/web/src/components/design-system/link-canvas-section.tsx` with the whole file below: the tier badges of Task 1, then a live canvas with a card, a stub, a group card, a back-link marker, a redirect and a broken target (every state of spec 7.9).

`apps/web/src/components/design-system/link-canvas-section.tsx`:

```tsx
'use client';

import { useRef, useState, type ReactElement } from 'react';

import { SpecimenGroup, SpecimenRow } from './specimen';
import { LinkCanvas, type CanvasFocus, type LinkCanvasHandle } from '@/components/app/link-canvas/link-canvas';
import { ZoomControls, type Zoom } from '@/components/app/link-canvas/zoom-controls';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { buildJourney, cardKey, type JourneyNeighbor, type ListLookup } from '@/lib/internal-links/journey-layout';

const TIERS = [
  { code: 'T1', name: 'Money pages' },
  { code: 'T2', name: 'Supporting pages' },
  { code: 'T3', name: 'Content pages' },
  { code: 'T4', name: 'Utility pages' },
  { code: 'T5', name: 'Campaign pages' },
  { code: 'T6', name: 'Archive' },
  { code: 'T7', name: 'Legal' },
  { code: 'T8', name: 'Other' },
];

const page = (id: string, path: string, code: string | null, over: Partial<JourneyNeighbor> = {}): JourneyNeighbor => ({
  url_id: id,
  path,
  title: path,
  status_code: 200,
  redirect_url_id: null,
  tier: code === null ? null : { code, name: code === 'T1' ? 'Money pages' : 'Content pages' },
  linking_pages: 4,
  linking_pages_all: 9,
  click_depth: 1,
  anchor: `About ${path}`,
  placement: 'content',
  scope: 'editorial',
  rel: [],
  is_followed: true,
  has_children: true,
  reciprocal: false,
  ...over,
});
const LISTS: Record<string, readonly JourneyNeighbor[]> = {
  '1|out|editorial': [
    page('2', '/pricing', 'T1', { reciprocal: true }),
    page('3', '/blog', 'T3'),
    page('7', '/old-offer', null, { status_code: 301, has_children: false }),
    page('8', '/threat-hunting', 'T1', { status_code: 404, has_children: false }),
  ],
  '2|out|editorial': [page('4', '/blog/post', 'T3'), page('1', '/', 'T3')],
  '3|out|editorial': [page('4', '/blog/post', 'T3')],
  '4|out|editorial': [page('1', '/', 'T3'), page('2', '/pricing', 'T1')],
  '1|in|editorial': [page('2', '/pricing', 'T1'), page('5', '/about', null)],
};
const OTHER = { '1|out|editorial': [{ scope: 'template' as const, pages: 9 }] };
const lookup: ListLookup<JourneyNeighbor> = ({ urlId, direction, scope }) => {
  const key = `${urlId}|${direction}|${scope}`;
  const items = LISTS[key] ?? [];
  return { status: 'ready', items, total: items.length, otherScopes: key in OTHER ? OTHER[key as keyof typeof OTHER] : [] };
};
const FOCUS: CanvasFocus = {
  urlId: '1',
  path: '/',
  title: 'Home',
  tier: { code: 'T3', name: 'Content pages' },
  linkingPages: 4,
  linkingPagesAll: 9,
  statusCode: 200,
  clickDepth: 0,
};
const LAYOUT = buildJourney(
  {
    focus: '1',
    scope: 'editorial',
    open: new Set([cardKey('out', ['2']), cardKey('out', ['3']), cardKey('out', ['2', '4'])]),
    groups: new Set(),
    more: new Map(),
  },
  lookup,
);

function CanvasSpecimen(): ReactElement {
  const [zoom, setZoom] = useState<Zoom>(1);
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  const handle = useRef<LinkCanvasHandle>(null);
  const none = (): void => undefined;
  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface">
      <div className="flex items-center border-b border-border-subtle px-3 py-2">
        <ZoomControls zoom={zoom} onZoomChange={setZoom} onFit={() => setZoom(handle.current?.fitZoom() ?? 1)} />
      </div>
      <LinkCanvas
        ref={handle}
        layout={LAYOUT}
        focus={FOCUS}
        focusNote={<p className="type-meta text-foreground-tertiary">4 editorial links in.</p>}
        zoom={zoom}
        pinned={pinned}
        onTogglePin={(key) =>
          setPinned((current) => {
            const next = new Set(current);
            if (!next.delete(key)) next.add(key);
            return next;
          })
        }
        onToggleCard={none}
        onToggleGroup={none}
        onMore={none}
        onRefocus={none}
        onDetails={none}
        onRetry={none}
        onFull={none}
      />
    </div>
  );
}
/** Internal links (spec 7.9): the tier badge, the link card and the canvas. */
export function LinkCanvasSection(): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <SpecimenGroup title="TierBadge" note="Code only in tables and cards; code and name in filters and the inspector.">
        <SpecimenRow label="Code">
          {TIERS.map((tier) => (
            <TierBadge key={tier.code} tier={tier} />
          ))}
          <TierBadge tier={null} />
        </SpecimenRow>
        <SpecimenRow label="Code and name">
          {TIERS.slice(0, 4).map((tier) => (
            <TierBadge key={tier.code} tier={tier} withName />
          ))}
          <TierBadge tier={null} withName />
        </SpecimenRow>
      </SpecimenGroup>
      <SpecimenGroup
        title="LinkCanvas and LinkCard"
        note="Cards, a stub (Already on the canvas), a group card (Menu and footer), a back-link marker (hover, focus or pin it), a redirect and a broken target."
      >
        <CanvasSpecimen />
      </SpecimenGroup>
    </div>
  );
}
```

Run `pnpm vitest run src/components/design-system/registry.test.tsx`. Expected: PASS in both themes.

- [ ] **Step 9: Write the specs**

`docs/design-system/25-component-inventory.md`, after 14.15:

````markdown
### 14.16 LinkCard
`components/app/link-canvas/link-card.tsx` · V1 · internal link tracker spec 7.5 and 7.9

Purpose: one node of the link canvas: a page card, a stub for a page already on the canvas, or a group card for the links of another scope.

```ts
type LinkCardProps = LinkCardPageProps | LinkCardStubProps | LinkCardGroupProps; // `kind` tells them apart
```

- **Variants:** `kind` card, stub, group (structure, not style).
- **States:** default, hover, focus (focus ring), opened (`primary-subtle`), the focus page (`primary-border` ring), highlighted (dashed primary outline: a back-link target or a found original), stub (dashed border), group (`surface-subtle`), error target (status badge in the negative tone, redirect in the warning tone).
- **A11y:** a `button` named like a sentence ("/pricing, T1 Money pages, 12 linking pages, linked as “See plans”, content"); `aria-expanded` only when it can open; the back-link marker is a toggle button (`aria-pressed`) named "Links back to 2 earlier pages"; tools ("Make /x the focus", "Details of /x") are `IconButton`s with tooltips.
- **Use:** inside `LinkCanvas` only.
- **Not for:** record lists (a table), cards on a dashboard.

### 14.17 LinkCanvas
`components/app/link-canvas/link-canvas.tsx` · V1 · internal link tracker spec 7.5, [15 §13](15-data-visualization.md), [20 §7.1](20-accessibility.md)

Purpose: the journey of links from one page: the focus in the middle, links out to the right and links in to the left, one column a step, grown one card at a time.

```ts
interface LinkCanvasProps<N extends JourneyNeighbor> {
  layout: JourneyLayout<N>;        // lib/internal-links/journey-layout.ts
  focus: CanvasFocus;
  focusNote?: ReactNode;
  zoom: 0.6 | 0.8 | 1 | 1.2;
  pinned: ReadonlySet<string>;
  onTogglePin, onToggleCard, onToggleGroup, onMore: (key: string) => void;
  onRefocus, onDetails: (urlId: string) => void;
  onRetry: (request: ListRequest) => void;
  onFull: () => void;              // opening refused at 300 cards
  ref?: Ref<{ fitZoom: () => Zoom }>;
}
```

- **Variants:** none. `ZoomControls` (`zoom-controls.tsx`) sits in the toolbar above it.
- **States:** loading list (a skeleton row and `role="status"`), failed list (words and Try again), full canvas (refused through `onFull`), back links shown on hover, focus or pin.
- **A11y:** the scroller is a named `group` whose name points to the tree list; keyboard model in 20 §7.1; the SVG is `aria-hidden` and nothing it shows is only there.
- **Use:** the Journey tab of Internal links.
- **Not for:** a whole-site graph (spec 3: "when asked"), any other diagram.
````

`docs/design-system/15-data-visualization.md`, a new last section after section 12 (Performance):

```markdown
## 13. Link canvas (internal links)

The journey canvas of Internal links (25 §14.17) is a diagram, not a chart. Columns are 256 px wide with a 64 px gap; edges are orthogonal with 8 px rounded corners on a vertical spine halfway between two columns, 1.5 px strokes: editorial solid in `foreground-tertiary`, auto-generated dotted (`2 4`) and template dashed (`6 4`) in `border-strong`, an edge into a redirect in `warning-text` and into a broken target in `negative-text`, drawn last so the color shows on its own segment. Back links are never drawn by default: hovering, focusing or pinning a card's marker draws dashed `primary` return arrows that dip 40 px under both cards and outlines their targets. A legend under the canvas names all six. Zoom is 60, 80, 100 or 120 percent with buttons and Fit to view; there is no minimap and nothing animates.
```

`docs/design-system/20-accessibility.md`, a first subsection of section 7 (Drag alternatives), after its rules:

```markdown
### 7.1 Link canvas

The link canvas (25 §14.17) is a named `group` whose name says the tree list shows the same journey as a table. Cards, stubs, group cards and "+N more" are buttons in reading order (columns left to right, top to bottom in a column). Right and Left Arrow move to the nearest card of the next or previous column; Up and Down move within a column; Enter and Space open or close a card or group; F makes the focused card the focus page and follows the single-key switch (section 14); Escape returns to the focus card. Opening past 300 cards is refused with a message, and focus stays on the card. After a card opens or closes, focus stays on it.
```

- [ ] **Step 10: Run the gate and commit**

```bash
git add apps/web/src/components/app/link-canvas/link-card.tsx apps/web/src/components/app/link-canvas/link-canvas.tsx \
  apps/web/src/components/app/link-canvas/zoom-controls.tsx apps/web/src/components/app/link-canvas/link-canvas.test.tsx \
  apps/web/src/components/design-system/link-canvas-section.tsx apps/web/messages/en.json \
  docs/design-system/15-data-visualization.md docs/design-system/20-accessibility.md docs/design-system/25-component-inventory.md
git commit -m "Internal links: LinkCard, LinkCanvas and zoom controls with their preview and specs"
```

---

### Task 5: The generated client, queries, mutations, the CSV download and the mock API

**Files:**
- Modify (generated): `apps/web/src/lib/api/schema.ts`
- Create: `apps/web/src/lib/internal-links/types.ts`, `apps/web/src/lib/internal-links/queries.ts`, `apps/web/src/lib/internal-links/mutations.ts`, `apps/web/src/lib/internal-links/queries.test.ts`
- Create: `apps/web/src/lib/api/download.ts`, `apps/web/src/lib/api/download.test.tsx`
- Create: `apps/web/src/mocks/internal-links-world.ts`, `apps/web/src/mocks/handlers/internal-links.ts`, `apps/web/src/mocks/handlers/internal-links.test.ts`
- Modify: `apps/web/src/mocks/handlers/index.ts`, `apps/web/src/mocks/respond.ts`, `apps/web/src/mocks/handlers/term-assignments.ts`, `apps/web/src/mocks/handlers/projects.ts`

- [ ] **Step 1: Bring in plan 02's OpenAPI and regenerate the client**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-web
git fetch origin
git merge --no-edit origin/develop
grep -c 'internal-links/neighbors' backend/openapi/v1.json
```

Expected: `1` or more. If it prints `0`, plan 02 is not on `develop` yet: run `git merge --no-ff --no-edit origin/feat/internal-links-backend` and check again. If that also prints `0`, stop here and work on nothing past Task 4 until plan 02's Task 12 has committed its OpenAPI.

```bash
cd apps/web && pnpm gen:api && pnpm vitest run src/lib/api/schema.test.ts
git add src/lib/api/schema.ts
git commit -m "Internal links: regenerate the API client for plan 02"
```

Expected: the schema test passes. Then check the names this plan uses:

```bash
grep -c '"/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages"\|PageRowPage: {\|NeighborList: {\|TierFlowResponse: {\|CrawlRunPage: {\|TierRuleView: {\|PageTierList: {\|InternalLinksSettings: {\|TierImportResult: {' src/lib/api/schema.ts
```

Expected: `9`. A lower count means plan 02 renamed something: find the new name in `schema.ts` and use it in `types.ts` below; nothing else names schema types.

- [ ] **Step 2: Write the failing query and download tests**

`apps/web/src/lib/internal-links/queries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { checkUrlId, DEFAULT_PAGE_QUERY, pageFilterOf, pageParams } from './queries';

describe('the pages query (plan 02 API contract)', () => {
  it('sends only what is set, with an explicit sort (never the server default, decision W5)', () => {
    expect(pageParams({ ...DEFAULT_PAGE_QUERY })).toEqual({ scope: 'editorial', sort: '-linking_pages', limit: 100 });
  });

  it('sends lists as arrays the client joins with commas', () => {
    expect(
      pageParams({
        ...DEFAULT_PAGE_QUERY,
        scope: 'all',
        tierIds: ['none', 'b5f7f0a0-0000-7000-8000-000000000001'],
        status: ['4xx'],
        indexable: false,
        flags: ['orphan'],
        worklist: 'orphans',
        q: '/blog',
        cursor: 'abc',
      }),
    ).toEqual({
      scope: 'all',
      sort: '-linking_pages',
      limit: 100,
      'filter[tier]': ['none', 'b5f7f0a0-0000-7000-8000-000000000001'],
      'filter[status]': ['4xx'],
      'filter[indexable]': false,
      'filter[flags]': ['orphan'],
      'filter[worklist]': 'orphans',
      q: '/blog',
      cursor: 'abc',
    });
  });

  it('turns the same filters into the bulk body filter, on the latest crawl', () => {
    expect(pageFilterOf({ ...DEFAULT_PAGE_QUERY, tierIds: ['none'], q: '/blog' })).toEqual({ tier_ids: ['none'], q: '/blog' });
    expect(pageFilterOf(DEFAULT_PAGE_QUERY)).toEqual({});
  });

  it('sends url ids as the strings the API takes, and refuses anything else', () => {
    expect(checkUrlId('9223372036854775807')).toBe('9223372036854775807');
    expect(() => checkUrlId('0')).toThrow('Not a url id: 0');
    expect(() => checkUrlId('abc')).toThrow('Not a url id: abc');
  });
});
```

`apps/web/src/lib/api/download.test.tsx`:

```ts
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { downloadApiFile } from './download';
import { isApiProblem } from './problem';
import { server } from '@/test/msw';

vi.mock('@/lib/csv/csv-write', async (original) => ({
  ...(await original<typeof import('@/lib/csv/csv-write')>()),
  downloadBlob: vi.fn(),
}));

describe('downloadApiFile (decision W13)', () => {
  it('asks for the file with the query the list uses and saves it', async () => {
    let asked = '';
    server.use(
      http.get('*/api/v1/files/pages', ({ request }) => {
        asked = new URL(request.url).search;
        return new HttpResponse('url\n/a\n', { headers: { 'content-type': 'text/csv' } });
      }),
    );
    const { downloadBlob } = await import('@/lib/csv/csv-write');
    await downloadApiFile('/api/v1/files/pages', { scope: 'all', 'filter[tier]': ['none', 'x'], format: 'csv' }, 'pages.csv');
    expect(decodeURIComponent(asked)).toBe('?scope=all&filter[tier]=none,x&format=csv');
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'pages.csv');
  });

  it('turns an error answer into an ApiProblem', async () => {
    server.use(
      http.get('*/api/v1/files/pages', () =>
        HttpResponse.json({ code: 'no_crawl', status: 404, title: 'No crawl' }, { status: 404, headers: { 'content-type': 'application/problem+json' } }),
      ),
    );
    await expect(downloadApiFile('/api/v1/files/pages', {}, 'pages.csv')).rejects.toSatisfy((error) => isApiProblem(error, 'no_crawl'));
  });
});
```

- [ ] **Step 3: Run them and see them fail**

```bash
pnpm vitest run src/lib/internal-links/queries.test.ts src/lib/api/download.test.tsx
```

Expected: FAIL, `Failed to resolve import "./queries"` and `"./download"`.

- [ ] **Step 4: Write the types, queries, mutations and the download**

`apps/web/src/lib/internal-links/types.ts`:

```ts
import type { Schemas } from '@/lib/api/types';

/**
 * The internal links types of the generated client (plan 02's API contract), under their API names. Import from
 * here, so a rename in the OpenAPI document breaks one file.
 */
export type PageRow = Schemas['PageRow'];
export type PageRowPage = Schemas['PageRowPage'];
export type PageDetail = Schemas['PageDetail'];
export type EdgeRow = Schemas['EdgeRow'];
export type EdgeRowPage = Schemas['EdgeRowPage'];
export type Neighbor = Schemas['Neighbor'];
export type NeighborList = Schemas['NeighborList'];
export type TierFlow = Schemas['TierFlow'];
export type TierStat = Schemas['TierStat'];
export type TierFlowCell = Schemas['TierFlowCell'];
export type Worklists = Schemas['Worklists'];
export type PageTier = Schemas['PageTier'];
export type TierRef = Schemas['TierRef'];
export type TierRuleView = Schemas['TierRuleView'];
export type CrawlRun = Schemas['CrawlRun'];
export type InternalLinksSettings = Schemas['InternalLinksSettings'];
export type TierImportResult = Schemas['TierImportResult'];
export type PageFilter = Schemas['PageFilter'];

/** The workspace and project every read is under. */
export interface LinksScope {
  workspaceId: string;
  projectId: string;
}

export type StatusClass = '2xx' | '3xx' | '4xx' | '5xx';
export type PageFlagFilter = 'orphan' | 'editorial_orphan' | 'deep_only_through_auto' | 'placement_unknown' | 'has_broken_outlinks';
export type PageWorklist = 'under_linked_t1' | 'orphans' | 'editorial_orphans' | 'deep_only_through_auto';
export type EdgeWorklist = 'broken_and_redirected' | 'links_to_non_indexable';
/** The sorts the Pages tab offers; `equity_share` is never sent (decision W4). */
export type PageSort = 'path' | '-path' | 'status_code' | '-status_code' | 'click_depth' | '-click_depth' | 'linking_pages' | '-linking_pages' | 'outlinks' | '-outlinks';
export type CrawlState = CrawlRun['state'];
```

`apps/web/src/lib/internal-links/queries.ts`:

```ts
import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import { projectKey, workspaceKey, type QueryKey } from '@/lib/api/keys';
import { READ_LIMIT, type Direction } from './journey-layout';
import type { EdgeScope, LinkScope, Placement } from './scopes';
import type {
  EdgeWorklist,
  LinksScope,
  PageFilter,
  PageFlagFilter,
  PageSort,
  PageWorklist,
  StatusClass,
} from './types';

/**
 * The reads of Internal links (plan 02's API contract), as `apiQuery` options. Every key starts with the project,
 * so `internalLinksKeys` reaches them after a write.
 */

const W = '/api/v1/workspaces/{workspace_id}';
// Literal strings, so each path below keeps its literal type for the typed client
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const PAGES = `${P}/internal-links/pages` as const;
const PAGE = `${P}/internal-links/pages/{url_id}` as const;
const EDGES = `${P}/internal-links/edges` as const;
const NEIGHBORS = `${P}/internal-links/neighbors` as const;
const FLOW = `${P}/internal-links/tier-flow` as const;
const WORKLISTS = `${P}/internal-links/worklists` as const;
const CRAWLS = `${P}/link-crawls` as const;
const RULES = `${P}/tier-rules` as const;
const TIERS = `${W}/page-tiers` as const;
const SETTINGS = `${P}/settings` as const;

/** The list paths with their ids filled in, for the CSV download (decision W13). */
export const pagesPath = (scope: LinksScope): `/api/v1/${string}` =>
  `/api/v1/workspaces/${scope.workspaceId}/projects/${scope.projectId}/internal-links/pages`;
export const edgesPath = (scope: LinksScope): `/api/v1/${string}` =>
  `/api/v1/workspaces/${scope.workspaceId}/projects/${scope.projectId}/internal-links/edges`;

/** Rows a page of the Pages and Links tables asks for (decision W6). */
export const PAGE_LIMIT = 100;
/** The crawls the header and the settings list read. */
export const CRAWL_LIMIT = 10;

const pathOf = (scope: LinksScope): { workspace_id: string; project_id: string } => ({
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
});

/** A `core.urls` id: a 64-bit integer the API takes and answers as a string (plan 02 API contract). */
export function checkUrlId(urlId: string): string {
  if (!/^[1-9][0-9]{0,18}$/.test(urlId)) throw new Error(`Not a url id: ${urlId}`);
  return urlId;
}

export interface PageQuery {
  scope: LinkScope;
  tierIds: readonly string[];
  tagIds: readonly string[];
  status: readonly StatusClass[];
  indexable: boolean | null;
  flags: readonly PageFlagFilter[];
  worklist: PageWorklist | null;
  q: string | null;
  sort: PageSort;
  cursor: string | null;
  limit: number;
}

export const DEFAULT_PAGE_QUERY: PageQuery = {
  scope: 'editorial',
  tierIds: [],
  tagIds: [],
  status: [],
  indexable: null,
  flags: [],
  worklist: null,
  q: null,
  sort: '-linking_pages',
  cursor: null,
  limit: PAGE_LIMIT,
};

/** The query values of the pages list; anything unset is left out, as the address leaves it out. */
export function pageParams(query: PageQuery) {
  return {
    scope: query.scope,
    sort: query.sort,
    limit: query.limit,
    ...(query.tierIds.length === 0 ? {} : { 'filter[tier]': [...query.tierIds] }),
    ...(query.tagIds.length === 0 ? {} : { 'filter[tag]': [...query.tagIds] }),
    ...(query.status.length === 0 ? {} : { 'filter[status]': [...query.status] }),
    ...(query.indexable === null ? {} : { 'filter[indexable]': query.indexable }),
    ...(query.flags.length === 0 ? {} : { 'filter[flags]': [...query.flags] }),
    ...(query.worklist === null ? {} : { 'filter[worklist]': query.worklist }),
    ...(query.q === null ? {} : { q: query.q }),
    ...(query.cursor === null ? {} : { cursor: query.cursor }),
  };
}

/** The same selection as a bulk body's `filter` ("Select all N matching", always the latest crawl). */
export function pageFilterOf(query: PageQuery): PageFilter {
  return {
    ...(query.tierIds.length === 0 ? {} : { tier_ids: [...query.tierIds] }),
    ...(query.tagIds.length === 0 ? {} : { tag_ids: [...query.tagIds] }),
    ...(query.status.length === 0 ? {} : { status: [...query.status] }),
    ...(query.indexable === null ? {} : { indexable: query.indexable }),
    ...(query.flags.length === 0 ? {} : { flags: [...query.flags] }),
    ...(query.worklist === null ? {} : { worklist: query.worklist }),
    ...(query.q === null ? {} : { q: query.q }),
  };
}

export const pagesQuery = (scope: LinksScope, query: PageQuery): ApiQueryOptions<typeof PAGES> =>
  apiQuery(PAGES, { params: { path: pathOf(scope), query: pageParams(query) } });

export const pageDetailQuery = (scope: LinksScope, urlId: string, linkScope: LinkScope): ApiQueryOptions<typeof PAGE> =>
  apiQuery(PAGE, { params: { path: { ...pathOf(scope), url_id: checkUrlId(urlId) }, query: { scope: linkScope } } });

export interface EdgeQuery {
  scope: LinkScope;
  sourceTierIds: readonly string[];
  targetTierIds: readonly string[];
  tagIds: readonly string[];
  placements: readonly Placement[];
  targetStatus: readonly StatusClass[];
  source: string | null;
  target: string | null;
  worklist: EdgeWorklist | null;
  qSource: string | null;
  qTarget: string | null;
  cursor: string | null;
  limit: number;
}

export const DEFAULT_EDGE_QUERY: EdgeQuery = {
  scope: 'editorial',
  sourceTierIds: [],
  targetTierIds: [],
  tagIds: [],
  placements: [],
  targetStatus: [],
  source: null,
  target: null,
  worklist: null,
  qSource: null,
  qTarget: null,
  cursor: null,
  limit: PAGE_LIMIT,
};

export function edgeParams(query: EdgeQuery) {
  return {
    scope: query.scope,
    limit: query.limit,
    ...(query.sourceTierIds.length === 0 ? {} : { 'filter[source_tier]': [...query.sourceTierIds] }),
    ...(query.targetTierIds.length === 0 ? {} : { 'filter[target_tier]': [...query.targetTierIds] }),
    ...(query.tagIds.length === 0 ? {} : { 'filter[tag]': [...query.tagIds] }),
    ...(query.placements.length === 0 ? {} : { 'filter[placement]': [...query.placements] }),
    ...(query.targetStatus.length === 0 ? {} : { 'filter[target_status]': [...query.targetStatus] }),
    ...(query.source === null ? {} : { 'filter[source]': checkUrlId(query.source) }),
    ...(query.target === null ? {} : { 'filter[target]': checkUrlId(query.target) }),
    ...(query.worklist === null ? {} : { 'filter[worklist]': query.worklist }),
    ...(query.qSource === null ? {} : { q_source: query.qSource }),
    ...(query.qTarget === null ? {} : { q_target: query.qTarget }),
    ...(query.cursor === null ? {} : { cursor: query.cursor }),
  };
}

export const edgesQuery = (scope: LinksScope, query: EdgeQuery): ApiQueryOptions<typeof EDGES> =>
  apiQuery(EDGES, { params: { path: pathOf(scope), query: edgeParams(query) } });

/** One page of `READ_LIMIT` neighbors (decision W7). */
export const neighborsQuery = (
  scope: LinksScope,
  { urlId, direction, linkScope, offset }: { urlId: string; direction: Direction; linkScope: LinkScope | EdgeScope; offset: number },
): ApiQueryOptions<typeof NEIGHBORS> =>
  apiQuery(NEIGHBORS, {
    params: {
      path: pathOf(scope),
      query: { url_id: checkUrlId(urlId), direction, scope: linkScope, limit: READ_LIMIT, ...(offset === 0 ? {} : { offset }) },
    },
  });

export const tierFlowQuery = (scope: LinksScope, linkScope: LinkScope): ApiQueryOptions<typeof FLOW> =>
  apiQuery(FLOW, { params: { path: pathOf(scope), query: { scope: linkScope } } });

export const worklistsQuery = (scope: LinksScope): ApiQueryOptions<typeof WORKLISTS> =>
  apiQuery(WORKLISTS, { params: { path: pathOf(scope) } });

export const crawlsQuery = (scope: LinksScope): ApiQueryOptions<typeof CRAWLS> =>
  apiQuery(CRAWLS, { params: { path: pathOf(scope), query: { limit: CRAWL_LIMIT } } });

export const tierRulesQuery = (scope: LinksScope): ApiQueryOptions<typeof RULES> =>
  apiQuery(RULES, { params: { path: pathOf(scope) } });

export const pageTiersQuery = (workspaceId: string): ApiQueryOptions<typeof TIERS> =>
  apiQuery(TIERS, { params: { path: { workspace_id: workspaceId } } });

export const linkSettingsQuery = (scope: LinksScope): ApiQueryOptions<typeof SETTINGS> =>
  apiQuery(SETTINGS, { params: { path: pathOf(scope) } });

/**
 * What a tier, rule or tag change makes stale (spec 6.6): every read of the project's internal links, its rules,
 * and the workspace's tier list (its page counts).
 */
export function internalLinksKeys(scope: LinksScope): QueryKey[] {
  const project = projectKey(scope.workspaceId, scope.projectId);
  return [[...project, 'internal-links'], [...project, 'tier-rules'], [...workspaceKey(scope.workspaceId), 'page-tiers']];
}

/** What a crawl request makes stale: the crawl list. */
export const crawlKeys = (scope: LinksScope): QueryKey[] => [[...projectKey(scope.workspaceId, scope.projectId), 'link-crawls']];
```

`apps/web/src/lib/internal-links/mutations.ts`:

```ts
import { apiMutation } from '@/lib/api/query';

/** The writes of Internal links (plan 02's API contract). */
const W = '/api/v1/workspaces/{workspace_id}';
// Literal strings, so each path below keeps its literal type for the typed client
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';

export const setTiersMutation = apiMutation('put', `${P}/pages/tiers`);
export const resetTiersMutation = apiMutation('post', `${P}/pages/tiers/reset`);
export const importTiersMutation = apiMutation('post', `${P}/pages/tiers/import`);
export const changeTagsMutation = apiMutation('put', `${P}/pages/tags`);
export const startCrawlMutation = apiMutation('post', `${P}/link-crawls`);
export const createRuleMutation = apiMutation('post', `${P}/tier-rules`);
export const updateRuleMutation = apiMutation('patch', `${P}/tier-rules/{rule_id}`);
export const deleteRuleMutation = apiMutation('delete', `${P}/tier-rules/{rule_id}`);
export const previewRuleMutation = apiMutation('post', `${P}/tier-rules/preview`);
export const createTierMutation = apiMutation('post', `${W}/page-tiers`);
export const updateTierMutation = apiMutation('patch', `${W}/page-tiers/{tier_id}`);
export const deleteTierMutation = apiMutation('delete', `${W}/page-tiers/{tier_id}`);
export const updateSettingsMutation = apiMutation('patch', `${P}/settings`);
```

`apps/web/src/lib/api/download.ts`:

```ts
import { apiFetch } from './api-fetch';
import { problemFrom } from './problem';
import { downloadBlob } from '@/lib/csv/csv-write';
import { newRequestId, REQUEST_ID_HEADER } from '@/lib/request-id';

/** A query value: lists go once, comma separated, as the typed client sends them (client.ts). */
export type DownloadQuery = Readonly<Record<string, string | number | boolean | readonly string[]>>;

/**
 * Saves a file the API answers (a list with `format=csv`, decision W13). The typed client refuses a 2xx that is not
 * JSON, so this one request goes through `apiFetch` with the request id, and an error answer becomes an
 * `ApiProblem` the screen shows as it shows any other.
 */
export async function downloadApiFile(path: `/api/v1/${string}`, query: DownloadQuery, name: string): Promise<void> {
  const search = Object.entries(query)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(Array.isArray(value) ? value.join(',') : String(value))}`)
    .join('&');
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const request = new Request(`${origin}${path}${search === '' ? '' : `?${search}`}`, {
    credentials: 'same-origin',
    headers: { [REQUEST_ID_HEADER]: newRequestId() },
  });
  const response = await apiFetch(request);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw problemFrom(response, body);
  }
  downloadBlob(await response.blob(), name);
}
```

- [ ] **Step 5: Run the tests and see them pass**

```bash
pnpm vitest run src/lib/internal-links/queries.test.ts src/lib/api/download.test.tsx
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Add the problem codes the mocks answer**

In `apps/web/src/mocks/respond.ts`, inside `PROBLEMS`, after `invalid_state_transition`:

```ts
  crawl_in_progress: [409, 'A crawl is already running'],
  no_crawl: [404, 'No finished crawl'],
  no_website: [422, 'The project has no website'],
  budget_exceeded: [422, 'Budget exceeded'],
  tier_limit: [422, 'Tier limit reached'],
  tier_in_use: [422, 'Tier is in use'],
```

- [ ] **Step 7: Write the mock world**

`apps/web/src/mocks/internal-links-world.ts`:

```ts
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from './fixtures';
import { onMockReset } from './state';
import { inScope, scopeOf, type EdgeScope, type LinkScope, type Placement } from '@/lib/internal-links/scopes';
import type {
  CrawlRun,
  EdgeRow,
  InternalLinksSettings,
  Neighbor,
  PageRow,
  PageTier,
  TierFlow,
  TierRef,
  TierRuleView,
  Worklists,
} from '@/lib/internal-links/types';

/**
 * The internal links of the mock API (decision W21): one finished crawl of eventussecurity.com (the Eventus
 * Security project, the site the design preview shows), the workspace's four default tiers, two tier rules,
 * and the state a session changes (tiers, rules, tags, crawls, settings). Kept in the memory of one page session,
 * as every handler's state is (`state.ts`).
 */

export const EVENTUS = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security') ?? MOCK_PROJECTS[0];
const HOST = 'https://eventussecurity.com';
const RUN_ID = '0192e4a0-1000-7000-8000-000000000001';
const FINISHED = '2026-11-14T03:12:00Z';
const OWNER = mockUser('owner');

interface FixturePage {
  id: string;
  path: string;
  title: string;
  status: number;
  redirectTo?: string;
  indexable?: boolean;
  reason?: string;
  inSitemap?: boolean;
}

const PAGES: readonly FixturePage[] = [
  { id: '101', path: '/', title: 'Eventus Security: managed security services' },
  { id: '102', path: '/services', title: 'Managed security services' },
  { id: '103', path: '/services/soc-as-a-service', title: 'SOC as a service' },
  { id: '104', path: '/services/managed-detection-and-response', title: 'Managed detection and response' },
  { id: '105', path: '/services/vapt', title: 'Vulnerability assessment and penetration testing' },
  { id: '106', path: '/services/penetration-testing', title: 'Redirects to /services/vapt', status: 301, redirectTo: '105', inSitemap: false },
  { id: '107', path: '/services/threat-hunting', title: 'Not found', status: 404, indexable: false, reason: 'Not found (404)', inSitemap: false },
  { id: '108', path: '/pricing', title: 'Plans and pricing' },
  { id: '109', path: '/contact', title: 'Talk to a security expert' },
  { id: '110', path: '/contact/thank-you', title: 'Thank you', indexable: false, reason: 'noindex meta tag', inSitemap: false },
  { id: '111', path: '/blog', title: 'Blog' },
  { id: '112', path: '/blog/what-is-a-soc', title: 'What is a SOC?' },
  { id: '113', path: '/blog/soc-vs-mdr', title: 'SOC vs MDR: which one you need' },
  { id: '114', path: '/blog/vapt-checklist', title: 'VAPT checklist for 2026' },
  { id: '115', path: '/blog/threat-report-2022', title: 'Threat report 2022' },
  { id: '116', path: '/about', title: 'About Eventus Security' },
  { id: '117', path: '/partners', title: 'Partners' },
  { id: '118', path: '/compare/eventus-vs-in-house-soc', title: 'Eventus vs an in-house SOC' },
].map((page) => ({ status: 200, ...page }));

type FixtureLink = readonly [from: string, to: string, placement: Placement, anchor: string];

const LINKS: readonly FixtureLink[] = [
  ['101', '102', 'navigation', 'Services'],
  ['101', '108', 'navigation', 'Pricing'],
  ['101', '109', 'navigation', 'Contact'],
  ['101', '111', 'navigation', 'Blog'],
  ['101', '116', 'footer', 'About'],
  ['103', '101', 'header', 'Home'],
  ['112', '101', 'header', 'Home'],
  ['103', '108', 'navigation', 'Pricing'],
  ['112', '108', 'navigation', 'Pricing'],
  ['113', '109', 'footer', 'Contact'],
  ['101', '103', 'content', 'SOC as a service'],
  ['101', '104', 'content', 'MDR'],
  ['102', '103', 'content', 'SOC as a service'],
  ['102', '104', 'content', 'Managed detection and response'],
  ['102', '105', 'content', 'VAPT'],
  ['102', '106', 'content', 'Penetration testing'],
  ['103', '108', 'content', 'See plans'],
  ['103', '104', 'content', 'add MDR'],
  ['103', '109', 'content', 'Talk to an expert'],
  ['104', '103', 'content', 'SOC as a service'],
  ['104', '107', 'content', 'Threat hunting'],
  ['104', '108', 'content', 'MDR pricing'],
  ['105', '109', 'content', 'Book a test'],
  ['108', '103', 'content', 'SOC as a service'],
  ['108', '109', 'content', 'Get a quote'],
  ['108', '118', 'content', 'Compare with an in-house SOC'],
  ['109', '110', 'content', 'Thank you'],
  ['111', '112', 'content', 'What is a SOC?'],
  ['111', '113', 'content', 'SOC vs MDR'],
  ['111', '114', 'content', 'VAPT checklist'],
  ['112', '103', 'content', 'SOC as a service'],
  ['112', '113', 'content', 'SOC vs MDR'],
  ['113', '104', 'content', 'MDR'],
  ['113', '112', 'content', 'What is a SOC?'],
  ['114', '105', 'content', 'VAPT services'],
  ['118', '103', 'content', 'our SOC'],
  ['112', '113', 'auto_generated', 'Next: SOC vs MDR'],
  ['113', '112', 'auto_generated', 'Previous: What is a SOC?'],
  ['113', '114', 'auto_generated', 'Next: VAPT checklist'],
  ['114', '113', 'auto_generated', 'Previous: SOC vs MDR'],
  ['114', '115', 'auto_generated', 'Next: Threat report 2022'],
  ['115', '114', 'auto_generated', 'Previous: VAPT checklist'],
];

const TIER_SEED = [
  ['Money pages', 'Service, pricing and contact pages that bring leads'],
  ['Supporting pages', 'Hubs, industries, comparisons and case studies that lead to money pages'],
  ['Content pages', 'Blog posts, guides and resources'],
  ['Utility pages', 'About, legal, partners and careers'],
] as const;
const tierId = (n: number): string => `0192e4a0-2000-7000-8000-00000000000${String(n)}`;
const MANUAL_SEED: readonly (readonly [string, number])[] = [
  ['101', 2],
  ['102', 2],
  ['108', 1],
  ['109', 1],
  ['116', 4],
  ['117', 4],
  ['118', 2],
];

export interface StoredTier {
  tier_id: string;
  name: string;
  description: string;
  updated_at: string;
}
export interface StoredRule {
  rule_id: string;
  match_type: 'exact' | 'prefix' | 'pattern';
  value: string;
  tier_id: string;
  created_at: string;
}
export interface StoredManual {
  tier_id: string | null;
  set_at: string;
}

interface World {
  tiers: StoredTier[];
  rules: StoredRule[];
  manual: Map<string, StoredManual>;
  tags: Map<string, Set<string>>;
  /** Crawls by project, newest first. */
  crawls: Map<string, CrawlRun[]>;
  settings: Map<string, InternalLinksSettings>;
  nextId: number;
}

function seed(): World {
  return {
    tiers: TIER_SEED.map(([name, description], index) => ({
      tier_id: tierId(index + 1),
      name,
      description,
      updated_at: FINISHED,
    })),
    rules: [
      { rule_id: '0192e4a0-3000-7000-8000-000000000001', match_type: 'prefix', value: '/services/', tier_id: tierId(1), created_at: FINISHED },
      { rule_id: '0192e4a0-3000-7000-8000-000000000002', match_type: 'pattern', value: '/blog/*', tier_id: tierId(3), created_at: FINISHED },
    ],
    manual: new Map(MANUAL_SEED.map(([id, position]) => [id, { tier_id: tierId(position), set_at: FINISHED }])),
    tags: new Map(),
    crawls: new Map([[EVENTUS.project_id, [finishedRun()]]]),
    settings: new Map(),
    nextId: 1,
  };
}

function finishedRun(): CrawlRun {
  return {
    run_id: RUN_ID,
    trigger: 'schedule',
    state: 'ready',
    ceiling: 2000,
    pages_found: PAGES.length,
    pages_crawled: PAGES.length,
    sitemap_pages: 14,
    render_javascript: false,
    estimated_cost_usd: '0.30',
    cost_usd: '0.30',
    stop_reason: null,
    error_code: null,
    error_message: null,
    hints: [],
    is_latest: true,
    created_at: '2026-11-14T03:00:00Z',
    submitted_at: '2026-11-14T03:00:05Z',
    finished_at: FINISHED,
    requested_by: null,
  };
}

let world = seed();
onMockReset(() => {
  world = seed();
});

export const linksWorld = (): World => world;
export const freshId = (): string => {
  world.nextId += 1;
  return `0192e4a0-9000-7000-8000-${String(world.nextId).padStart(12, '0')}`;
};

// -------------------------------------------------------------------------------------------------
// Tiers and rules

export function tierRef(id: string | null): TierRef | null {
  const position = world.tiers.findIndex((tier) => tier.tier_id === id);
  const tier = world.tiers[position];
  return tier === undefined ? null : { tier_id: tier.tier_id, code: `T${String(position + 1)}`, name: tier.name };
}

export function ruleMatches(rule: Pick<StoredRule, 'match_type' | 'value'>, path: string): boolean {
  if (rule.match_type === 'exact') return path === rule.value;
  if (rule.match_type === 'prefix') return path.startsWith(rule.value);
  const pattern = rule.value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${pattern}$`).test(path);
}

export interface Assigned {
  tier: TierRef | null;
  source: 'manual' | 'rule' | null;
  ruleId: string | null;
  setAt: string | null;
}

/** Manual beats rules; the first matching rule wins (spec 5.2). */
export function assignedTier(page: Pick<FixturePage, 'id' | 'path'>): Assigned {
  const manual = world.manual.get(page.id);
  if (manual !== undefined) return { tier: tierRef(manual.tier_id), source: 'manual', ruleId: null, setAt: manual.set_at };
  const rule = world.rules.find((candidate) => ruleMatches(candidate, page.path));
  if (rule !== undefined) return { tier: tierRef(rule.tier_id), source: 'rule', ruleId: rule.rule_id, setAt: FINISHED };
  return { tier: null, source: null, ruleId: null, setAt: null };
}

export const ruleView = (rule: StoredRule, position: number): TierRuleView => ({
  rule_id: rule.rule_id,
  position,
  match_type: rule.match_type,
  value: rule.value,
  tier: tierRef(rule.tier_id) ?? { tier_id: rule.tier_id, code: 'T1', name: '' },
  created_at: rule.created_at,
});

export function pageTierViews(): PageTier[] {
  return world.tiers.map((tier, index) => {
    const pages = PAGES.filter((page) => assignedTier(page).tier?.tier_id === tier.tier_id).length;
    const code = `T${String(index + 1)}`;
    return {
      tier_id: tier.tier_id,
      position: index + 1,
      code,
      name: tier.name,
      description: tier.description,
      label: `${code} ${tier.name}`,
      page_count: pages,
      rule_count: world.rules.filter((rule) => rule.tier_id === tier.tier_id).length,
      updated_at: tier.updated_at,
    };
  });
}

// -------------------------------------------------------------------------------------------------
// The crawl's graph

const byId = new Map(PAGES.map((page) => [page.id, page]));
export const crawledPage = (id: string): FixturePage | undefined => byId.get(id);
export const crawledPages = (): readonly FixturePage[] => PAGES;
const edgeScope = (link: FixtureLink): EdgeScope => scopeOf(link[2]);

function depths(withoutAuto: boolean): Map<string, number> {
  const found = new Map<string, number>([['101', 0]]);
  let frontier = ['101'];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      const step = (found.get(id) ?? 0) + 1;
      const redirect = byId.get(id)?.redirectTo;
      const targets = [
        ...LINKS.filter((link) => link[0] === id && !(withoutAuto && link[2] === 'auto_generated')).map((link) => link[1]),
        ...(redirect === undefined ? [] : [redirect]),
      ];
      for (const target of targets) {
        if (found.has(target)) continue;
        found.set(target, step);
        next.push(target);
      }
    }
    frontier = next;
  }
  return found;
}
const DEPTH = depths(false);
const DEPTH_WITHOUT_AUTO = depths(true);

const linksIn = (id: string, view: LinkScope): FixtureLink[] =>
  LINKS.filter((link) => link[1] === id && link[0] !== id && inScope(edgeScope(link), view));
const linksOut = (id: string, view: LinkScope): FixtureLink[] =>
  LINKS.filter((link) => link[0] === id && link[1] !== id && inScope(edgeScope(link), view));
const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

const statusClass = (status: number): '2xx' | '3xx' | '4xx' | '5xx' =>
  status >= 500 ? '5xx' : status >= 400 ? '4xx' : status >= 300 ? '3xx' : '2xx';
export const statusClassOf = statusClass;

export function pageRow(page: FixturePage, view: LinkScope): PageRow {
  const assigned = assignedTier(page);
  const inbound = unique(linksIn(page.id, view).map((link) => link[0]));
  const inboundAll = unique(linksIn(page.id, 'all').map((link) => link[0]));
  const outbound = unique(linksOut(page.id, view).map((link) => link[1]));
  const outboundAll = unique(linksOut(page.id, 'all').map((link) => link[1]));
  const targets = outboundAll.map((id) => byId.get(id)).filter((target) => target !== undefined);
  const indexable = page.indexable ?? page.status === 200;
  const depth = DEPTH.get(page.id) ?? null;
  const withoutAuto = DEPTH_WITHOUT_AUTO.get(page.id) ?? null;
  const byTier = new Map<string, { tier: TierRef | null; pages: number }>();
  for (const id of inbound) {
    const source = byId.get(id);
    const tier = source === undefined ? null : assignedTier(source).tier;
    const key = tier?.tier_id ?? 'none';
    byTier.set(key, { tier, pages: (byTier.get(key)?.pages ?? 0) + 1 });
  }
  const anchors = new Map<string, number>();
  for (const link of linksIn(page.id, view)) anchors.set(link[3], (anchors.get(link[3]) ?? 0) + 1);
  const topAnchor = [...anchors].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const editorialIn = linksIn(page.id, 'editorial').length;
  const flags: PageRow['flags'] = [];
  if (page.status >= 400) flags.push('broken');
  if (page.status >= 300 && page.status < 400) flags.push('redirect');
  if (page.status === 200 && !indexable) flags.push('non_indexable');
  if (page.id !== '101' && page.status === 200 && inboundAll.length === 0 && (page.inSitemap ?? true)) flags.push('orphan');
  else if (page.id !== '101' && page.status === 200 && inboundAll.length > 0 && editorialIn === 0) flags.push('editorial_orphan');
  if (depth !== null && (withoutAuto === null || withoutAuto > depth + 3)) flags.push('deep_only_through_auto');
  return {
    url_id: page.id,
    url: `${HOST}${page.path}`,
    path: page.path,
    title: page.title,
    status_code: page.status,
    resource_type: page.status >= 400 ? 'broken' : page.status >= 300 ? 'redirect' : 'html',
    redirect_url: page.redirectTo === undefined ? null : `${HOST}${byId.get(page.redirectTo)?.path ?? ''}`,
    is_indexable: indexable,
    non_indexable_reason: indexable ? null : (page.reason ?? null),
    canonical_url: null,
    in_sitemap: page.inSitemap ?? true,
    click_depth: depth,
    depth_without_auto: withoutAuto,
    equity_share: null,
    linking_pages: inbound.length,
    linking_pages_all: inboundAll.length,
    outlinks: outbound.length,
    outlinks_all: outboundAll.length,
    linked_from_tiers: [...byTier.values()],
    outlinks_to_t1: outbound.filter((id) => {
      const target = byId.get(id);
      return target !== undefined && assignedTier(target).tier?.code === 'T1';
    }).length,
    broken_outlinks: targets.filter((target) => target.status >= 400).length,
    redirect_outlinks: targets.filter((target) => target.status >= 300 && target.status < 400).length,
    non_indexable_outlinks: targets.filter((target) => target.status === 200 && target.indexable === false).length,
    top_anchor: topAnchor,
    tier: assigned.tier,
    tier_source: assigned.source,
    tier_rule_id: assigned.ruleId,
    tier_set_by: assigned.source === 'manual' ? { user_id: OWNER.user_id, name: OWNER.name, email: OWNER.email } : null,
    tier_set_at: assigned.setAt,
    tags: [...(world.tags.get(page.id) ?? [])].map((term_id) => ({ term_id, name: term_id.slice(-4) })),
    flags,
  };
}

/** The neighbors of one page on one side, as the API answers them (sorted by tier then path). */
export function neighborsOf(id: string, direction: 'in' | 'out', view: LinkScope): Neighbor[] {
  const page = byId.get(id);
  if (page === undefined) return [];
  if (direction === 'out' && page.redirectTo !== undefined) {
    const target = byId.get(page.redirectTo);
    return target === undefined ? [] : [neighbor(target, null, view, direction, id)];
  }
  const links = direction === 'out' ? linksOut(id, view) : linksIn(id, view);
  const seen = new Map<string, FixtureLink>();
  for (const link of links) {
    const other = direction === 'out' ? link[1] : link[0];
    if (!seen.has(other)) seen.set(other, link);
  }
  return [...seen]
    .map(([other, link]) => ({ other: byId.get(other), link }))
    .filter((entry): entry is { other: FixturePage; link: FixtureLink } => entry.other !== undefined)
    .map(({ other, link }) => neighbor(other, link, view, direction, id))
    .sort((a, b) => (a.tier?.code ?? 'T9').localeCompare(b.tier?.code ?? 'T9') || a.path.localeCompare(b.path));
}

function neighbor(page: FixturePage, link: FixtureLink | null, view: LinkScope, direction: 'in' | 'out', from: string): Neighbor {
  const row = pageRow(page, view);
  const children = direction === 'out' ? linksOut(page.id, view) : linksIn(page.id, view);
  const reverse = direction === 'out' ? linksOut(page.id, view) : linksIn(page.id, view);
  return {
    url_id: page.id,
    url: row.url,
    path: page.path,
    title: page.title,
    status_code: page.status,
    redirect_url_id: page.redirectTo ?? null,
    tier: row.tier,
    click_depth: row.click_depth,
    linking_pages: row.linking_pages,
    linking_pages_all: row.linking_pages_all,
    equity_share: null,
    anchor: link === null ? null : link[3],
    placement: link === null ? null : link[2],
    scope: link === null ? null : edgeScope(link),
    is_followed: true,
    rel: [],
    occurrences: 1,
    links: 1,
    has_children: children.length > 0 || page.redirectTo !== undefined,
    reciprocal: reverse.some((candidate) => (direction === 'out' ? candidate[1] : candidate[0]) === from),
  };
}

export function otherScopes(id: string, direction: 'in' | 'out', view: LinkScope): { scope: EdgeScope; pages: number }[] {
  if (view === 'all') return [];
  return (['editorial', 'auto_generated', 'template'] as const)
    .filter((scope) => scope !== view)
    .map((scope) => ({ scope, pages: neighborsOf(id, direction, scope).length }))
    .filter((entry) => entry.pages > 0);
}

export function edgeRows(view: LinkScope): EdgeRow[] {
  const order: Record<EdgeScope, number> = { template: 0, auto_generated: 1, editorial: 2 };
  const edgePage = (id: string): EdgeRow['source'] => {
    const page = byId.get(id);
    return {
      url_id: id,
      url: `${HOST}${page?.path ?? ''}`,
      path: page?.path ?? '',
      tier: page === undefined ? null : assignedTier(page).tier,
      status_code: page?.status ?? null,
      redirect_url: page?.redirectTo === undefined ? null : `${HOST}${byId.get(page.redirectTo)?.path ?? ''}`,
      is_indexable: page === undefined ? null : (page.indexable ?? page.status === 200),
    };
  };
  return LINKS.map((link, index) => ({ link, index }))
    .filter(({ link }) => inScope(edgeScope(link), view))
    .map(({ link, index }) => ({
      link_id: String(1000 + index),
      source: edgePage(link[0]),
      target: edgePage(link[1]),
      anchor: link[3],
      kind: 'text' as const,
      placement: link[2],
      scope: edgeScope(link),
      rel: [],
      is_followed: true,
      occurrences: 1,
    }))
    .sort((a, b) => order[a.scope] - order[b.scope] || a.target.path.localeCompare(b.target.path) || a.link_id.localeCompare(b.link_id));
}

export function tierFlow(view: LinkScope): TierFlow {
  const keys: (TierRef | null)[] = [...world.tiers.map((tier) => tierRef(tier.tier_id)), null];
  const pairs = new Set<string>();
  const counts = new Map<string, number>();
  for (const link of LINKS) {
    if (!inScope(edgeScope(link), view) || link[0] === link[1]) continue;
    const pair = `${link[0]}>${link[1]}`;
    if (pairs.has(pair)) continue;
    pairs.add(pair);
    const from = byId.get(link[0]);
    const to = byId.get(link[1]);
    if (from === undefined || to === undefined) continue;
    const key = `${assignedTier(from).tier?.tier_id ?? 'none'}>${assignedTier(to).tier?.tier_id ?? 'none'}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    run_id: RUN_ID,
    scope: view,
    stale: false,
    cells: keys.flatMap((from) =>
      keys.map((to) => ({ from_tier: from, to_tier: to, links: counts.get(`${from?.tier_id ?? 'none'}>${to?.tier_id ?? 'none'}`) ?? 0 })),
    ),
    tiers: keys.map((tier) => {
      const members = PAGES.filter((page) => (assignedTier(page).tier?.tier_id ?? null) === (tier?.tier_id ?? null));
      const reached = members.map((page) => DEPTH.get(page.id)).filter((depth) => depth !== undefined);
      return {
        tier,
        pages: members.length,
        equity_share: 0,
        average_depth: reached.length === 0 ? null : reached.reduce((sum, depth) => sum + depth, 0) / reached.length,
      };
    }),
  };
}

export function worklists(): Worklists {
  const rows = PAGES.map((page) => pageRow(page, 'editorial'));
  return {
    run_id: RUN_ID,
    under_linked_t1: rows.filter(
      (row) => row.tier?.code === 'T1' && row.status_code === 200 && row.is_indexable && (row.linking_pages < 3 || (row.click_depth ?? 99) > 3),
    ).length,
    orphans: rows.filter((row) => row.flags.includes('orphan')).length,
    editorial_orphans: rows.filter((row) => row.flags.includes('editorial_orphan')).length,
    deep_only_through_auto: rows.filter((row) => row.flags.includes('deep_only_through_auto')).length,
    broken_and_redirected: LINKS.filter((link) => (byId.get(link[1])?.status ?? 200) >= 300).length,
    links_to_non_indexable: LINKS.filter((link) => {
      const target = byId.get(link[1]);
      return target !== undefined && target.status === 200 && target.indexable === false;
    }).length,
  };
}

// -------------------------------------------------------------------------------------------------
// Crawls and settings

const PROGRESS_MS = 8000;

/** The crawls of a project with their mocked progress: a crawl started here runs 8 seconds, then is ready. */
export function crawlsOf(projectId: string, now = Date.now()): CrawlRun[] {
  const runs = world.crawls.get(projectId) ?? [];
  const advanced = runs.map((run) => {
    if (run.state !== 'queued' && run.state !== 'crawling') return run;
    const elapsed = now - Date.parse(run.created_at);
    // A website added in this session has no fixture to finish with: it keeps crawling
    const finishes = projectId === EVENTUS.project_id && elapsed >= PROGRESS_MS;
    if (!finishes) {
      return { ...run, state: 'crawling' as const, pages_found: Math.min(run.ceiling, 120 + Math.floor(elapsed / 25)), submitted_at: run.created_at };
    }
    return { ...finishedRun(), run_id: run.run_id, trigger: run.trigger, created_at: run.created_at, finished_at: new Date(now).toISOString() };
  });
  const latestDone = advanced.findIndex((run) => run.state === 'ready' || run.state === 'stopped_at_ceiling');
  return advanced.map((run, index) => ({ ...run, is_latest: index === latestDone }));
}

export function startCrawl(projectId: string, trigger: CrawlRun['trigger'], now = Date.now()): CrawlRun {
  const run: CrawlRun = {
    ...finishedRun(),
    run_id: freshId(),
    trigger,
    state: 'queued',
    pages_found: 0,
    pages_crawled: 0,
    cost_usd: null,
    is_latest: false,
    created_at: new Date(now).toISOString(),
    submitted_at: null,
    finished_at: null,
    requested_by: trigger === 'manual' ? { user_id: OWNER.user_id, name: OWNER.name, email: OWNER.email } : null,
  };
  world.crawls.set(projectId, [run, ...(world.crawls.get(projectId) ?? [])]);
  return run;
}

export const hasFinishedCrawl = (projectId: string): boolean => crawlsOf(projectId).some((run) => run.is_latest);

export const settingsOf = (projectId: string): InternalLinksSettings =>
  world.settings.get(projectId) ?? { schedule: 'weekly', render_javascript: false, allowed_subdomains: [] };

export const MOCK_LINKS_WORKSPACE = MOCK_WORKSPACE.workspace_id;
```

- [ ] **Step 8: Write the failing handler test**

`apps/web/src/mocks/handlers/internal-links.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MOCK_WORKSPACE } from '../fixtures';
import { EVENTUS } from '../internal-links-world';
import { mockBrowser } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const P = `${W}/projects/${EVENTUS.project_id}`;
const ROWS = z.object({ data: z.array(z.object({ path: z.string(), tier: z.object({ code: z.string() }).nullable() })) });

describe('the internal links mock API', () => {
  it('lists the latest crawl pages, with rule and manual tiers', async () => {
    const answer = await mockBrowser('editor').call('GET', `${P}/internal-links/pages?scope=editorial&sort=path&limit=100`);
    expect(answer.status).toBe(200);
    const rows = ROWS.parse(answer.body).data;
    expect(rows.find((row) => row.path === '/pricing')?.tier?.code).toBe('T1');
    expect(rows.find((row) => row.path === '/services/vapt')?.tier?.code).toBe('T1');
    expect(rows.find((row) => row.path === '/blog/soc-vs-mdr')?.tier?.code).toBe('T3');
  });

  it('sets a tier by hand on pages chosen by id, and the flow follows', async () => {
    const browser = mockBrowser('editor');
    const tiers = z.object({ data: z.array(z.object({ tier_id: z.string(), code: z.string() })) }).parse((await browser.call('GET', `${W}/page-tiers`)).body).data;
    const t4 = tiers.find((tier) => tier.code === 'T4')?.tier_id;
    const set = await browser.call('PUT', `${P}/pages/tiers`, { url_ids: ['111'], tier_id: t4 });
    expect(set.body).toEqual({ data: { matched: 1, changed: 1 } });
    const blog = ROWS.parse((await browser.call('GET', `${P}/internal-links/pages?q=%2Fblog&sort=path&limit=100`)).body).data[0];
    expect(blog).toEqual(expect.objectContaining({ path: '/blog', tier: expect.objectContaining({ code: 'T4' }) }));
  });

  it('answers one journey step with the other scopes counted for the group cards', async () => {
    const answer = await mockBrowser('viewer').call('GET', `${P}/internal-links/neighbors?url_id=101&direction=out&scope=editorial&limit=50`);
    const body = z
      .object({ data: z.array(z.object({ path: z.string() })), meta: z.object({ total: z.number(), other_scopes: z.array(z.object({ scope: z.string(), pages: z.number() })) }) })
      .parse(answer.body);
    expect(body.data.map((row) => row.path)).toEqual(['/services/managed-detection-and-response', '/services/soc-as-a-service']);
    expect(body.meta.other_scopes).toEqual([{ scope: 'template', pages: 5 }]);
  });

  it('refuses a crawl while one runs, and answers no_crawl for a project never crawled', async () => {
    const browser = mockBrowser('editor');
    expect((await browser.call('POST', `${P}/link-crawls`, {})).status).toBe(202);
    expect((await browser.call('POST', `${P}/link-crawls`, {})).code).toBe('crawl_in_progress');
    const fynix = `${W}/projects/0192d1a8-9a01-7b44-8c2d-1f0e9d8c7b01`;
    expect((await browser.call('GET', `${fynix}/internal-links/worklists`)).code).toBe('no_crawl');
  });
});
```

- [ ] **Step 9: Write the handlers**

`apps/web/src/mocks/handlers/internal-links.ts`:

```ts
import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller, workspaceCaller } from './access';
import { invalid, mock, noContent, problem } from '../respond';
import {
  crawledPage,
  crawledPages,
  crawlsOf,
  edgeRows,
  freshId,
  hasFinishedCrawl,
  linksWorld,
  neighborsOf,
  otherScopes,
  pageRow,
  pageTierViews,
  ruleMatches,
  ruleView,
  startCrawl,
  statusClassOf,
  tierFlow,
  tierRef,
  worklists,
} from '../internal-links-world';
import { parseLinkScope, type LinkScope } from '@/lib/internal-links/scopes';
import { MAX_TIERS } from '@/lib/internal-links/tiers';
import { parseTierCsv } from '@/lib/internal-links/tier-csv';
import type { PageRow } from '@/lib/internal-links/types';
import { csvLines } from '@/lib/csv/csv-write';

/**
 * Plan 02's internal links routes, answered from `internal-links-world.ts` (decision W21). Requests are checked as
 * the API checks them where a screen depends on it (membership, permission, unknown query, `no_crawl`); bodies are
 * trusted beyond their shape.
 */

const W = '/api/v1/workspaces/{workspace_id}';
// Literal strings, so each path below keeps its literal type for the typed client
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const LIST_QUERY = ['run', 'scope', 'cursor', 'limit', 'format'];
const PAGE_QUERY = [...LIST_QUERY, 'filter[tier]', 'filter[tag]', 'filter[status]', 'filter[indexable]', 'filter[flags]', 'filter[worklist]', 'q', 'sort'];
const EDGE_QUERY = [...LIST_QUERY, 'filter[source_tier]', 'filter[target_tier]', 'filter[tag]', 'filter[placement]', 'filter[target_status]', 'filter[source]', 'filter[target]', 'filter[worklist]', 'q_source', 'q_target'];

const listOf = (url: URL, key: string): string[] => (url.searchParams.get(key) ?? '').split(',').filter((value) => value !== '');
const scopeOf = (url: URL): LinkScope => parseLinkScope(url.searchParams.get('scope'));
const csv = (rows: readonly (readonly (string | number)[])[], name: string): HttpResponse<string> =>
  new HttpResponse(csvLines(rows.map((row) => row.map(String))), {
    headers: { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="${name}.csv"` },
  });

/** Offset paging under an opaque cursor, as the API's cursor pages read. */
function cursorPage<T>(url: URL, rows: readonly T[]): { data: T[]; page: { limit: number; next_cursor: string | null; has_more: boolean } } {
  const limit = Math.min(200, Number(url.searchParams.get('limit') ?? 50));
  const offset = Number(url.searchParams.get('cursor') ?? 0);
  const next = offset + limit < rows.length ? String(offset + limit) : null;
  return { data: rows.slice(offset, offset + limit), page: { limit, next_cursor: next, has_more: next !== null } };
}

function pageMatches(row: PageRow, url: URL): boolean {
  const tiers = listOf(url, 'filter[tier]');
  const statuses = listOf(url, 'filter[status]');
  const flags = listOf(url, 'filter[flags]');
  const indexable = url.searchParams.get('filter[indexable]');
  const worklist = url.searchParams.get('filter[worklist]');
  const q = url.searchParams.get('q');
  if (tiers.length > 0 && !tiers.includes(row.tier?.tier_id ?? 'none')) return false;
  if (statuses.length > 0 && (row.status_code === null || !statuses.includes(statusClassOf(row.status_code)))) return false;
  if (indexable !== null && String(row.is_indexable) !== indexable) return false;
  for (const flag of flags) {
    if (flag === 'has_broken_outlinks' ? row.broken_outlinks === 0 : !row.flags.includes(flag as PageRow['flags'][number])) return false;
  }
  if (worklist === 'orphans' && !row.flags.includes('orphan')) return false;
  if (worklist === 'editorial_orphans' && !row.flags.includes('editorial_orphan')) return false;
  if (worklist === 'deep_only_through_auto' && !row.flags.includes('deep_only_through_auto')) return false;
  if (worklist === 'under_linked_t1' && !(row.tier?.code === 'T1' && row.status_code === 200 && (row.linking_pages < 3 || (row.click_depth ?? 99) > 3))) return false;
  if (q !== null && !row.path.includes(q)) return false;
  return true;
}

const SORTS: Readonly<Record<string, (row: PageRow) => string | number>> = {
  path: (row) => row.path,
  status_code: (row) => row.status_code ?? 0,
  click_depth: (row) => row.click_depth ?? 999,
  linking_pages: (row) => row.linking_pages,
  outlinks: (row) => row.outlinks,
  equity_share: (row) => row.equity_share ?? 0,
};

function sortRows(rows: PageRow[], sort: string): PageRow[] {
  const desc = sort.startsWith('-');
  const read = SORTS[desc ? sort.slice(1) : sort] ?? SORTS.path;
  if (read === undefined) return rows;
  return [...rows].sort((a, b) => {
    const left = read(a);
    const right = read(b);
    const order = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
    return (desc ? -order : order) || a.path.localeCompare(b.path);
  });
}

/** The pages a bulk body names: its ids, or its filter on the latest crawl. */
function selected(body: Record<string, unknown>): string[] {
  if (Array.isArray(body.url_ids)) return body.url_ids.map(String);
  const filter = (body.filter ?? {}) as Record<string, unknown>;
  const url = new URL('http://mock/');
  if (Array.isArray(filter.tier_ids)) url.searchParams.set('filter[tier]', filter.tier_ids.join(','));
  if (Array.isArray(filter.status)) url.searchParams.set('filter[status]', filter.status.join(','));
  if (typeof filter.indexable === 'boolean') url.searchParams.set('filter[indexable]', String(filter.indexable));
  if (Array.isArray(filter.flags)) url.searchParams.set('filter[flags]', filter.flags.join(','));
  if (typeof filter.worklist === 'string') url.searchParams.set('filter[worklist]', filter.worklist);
  if (typeof filter.q === 'string') url.searchParams.set('q', filter.q);
  return crawledPages()
    .map((page) => pageRow(page, 'editorial'))
    .filter((row) => pageMatches(row, url))
    .map((row) => row.url_id);
}

export const internalLinkHandlers: HttpHandler[] = [
  // ---------------------------------------------------------------------------------------------
  // Workspace tiers

  mock('get', `${W}/page-tiers`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    return HttpResponse.json({ data: pageTierViews() });
  }),

  mock('post', `${W}/page-tiers`, async ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, { permission: 'workspace:update' });
    if (caller instanceof Response) return caller;
    const body = (await request.json()) as { name?: string; description?: string };
    const world = linksWorld();
    if (world.tiers.length >= MAX_TIERS) return problem(request, 'tier_limit');
    world.tiers.push({ tier_id: freshId(), name: body.name ?? '', description: body.description ?? '', updated_at: new Date().toISOString() });
    const created = pageTierViews().at(-1);
    return created === undefined ? problem(request, 'internal_error') : HttpResponse.json({ data: created }, { status: 201 });
  }),

  mock('patch', `${W}/page-tiers/{tier_id}`, async ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, { permission: 'workspace:update' });
    if (caller instanceof Response) return caller;
    const tier = linksWorld().tiers.find((candidate) => candidate.tier_id === params.tier_id);
    if (tier === undefined) return problem(request, 'not_found');
    const body = (await request.json()) as { name?: string; description?: string };
    if (body.name !== undefined) tier.name = body.name;
    if (body.description !== undefined) tier.description = body.description;
    tier.updated_at = new Date().toISOString();
    const view = pageTierViews().find((candidate) => candidate.tier_id === tier.tier_id);
    return view === undefined ? problem(request, 'internal_error') : HttpResponse.json({ data: view });
  }),

  mock('delete', `${W}/page-tiers/{tier_id}`, ({ request, cookies, params }) => {
    const caller = workspaceCaller(request, cookies, params.workspace_id, { permission: 'workspace:update', query: ['move_to'] });
    if (caller instanceof Response) return caller;
    const world = linksWorld();
    const view = pageTierViews().find((candidate) => candidate.tier_id === params.tier_id);
    if (view === undefined) return problem(request, 'not_found');
    const moveTo = new URL(request.url).searchParams.get('move_to');
    if ((view.page_count > 0 || view.rule_count > 0) && moveTo === null) {
      return problem(request, 'tier_in_use', { page_count: view.page_count, rule_count: view.rule_count });
    }
    const target = moveTo === 'none' ? null : moveTo;
    for (const [id, manual] of world.manual) if (manual.tier_id === view.tier_id) world.manual.set(id, { ...manual, tier_id: target });
    world.rules = world.rules.flatMap((rule) => (rule.tier_id !== view.tier_id ? [rule] : target === null ? [] : [{ ...rule, tier_id: target }]));
    world.tiers = world.tiers.filter((tier) => tier.tier_id !== view.tier_id);
    return noContent();
  }),

  // ---------------------------------------------------------------------------------------------
  // Rules, page tiers, import, tags

  mock('get', `${P}/tier-rules`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    return HttpResponse.json({ data: linksWorld().rules.map((rule, index) => ruleView(rule, index + 1)) });
  }),

  mock('post', `${P}/tier-rules`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'projects:write' });
    if (caller instanceof Response) return caller;
    const body = (await request.json()) as { match_type: 'exact' | 'prefix' | 'pattern'; value: string; tier_id: string; position?: number };
    if (tierRef(body.tier_id) === null) return invalid(request, [{ path: 'tier_id', code: 'unknown_tier', message: 'Not a tier of this workspace.', location: 'body' }]);
    const world = linksWorld();
    const rule = { rule_id: freshId(), match_type: body.match_type, value: body.value, tier_id: body.tier_id, created_at: new Date().toISOString() };
    const at = Math.min(Math.max((body.position ?? world.rules.length + 1) - 1, 0), world.rules.length);
    world.rules.splice(at, 0, rule);
    return HttpResponse.json({ data: ruleView(rule, at + 1) }, { status: 201 });
  }),

  mock('patch', `${P}/tier-rules/{rule_id}`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'projects:write' });
    if (caller instanceof Response) return caller;
    const world = linksWorld();
    const index = world.rules.findIndex((rule) => rule.rule_id === params.rule_id);
    const rule = world.rules[index];
    if (rule === undefined) return problem(request, 'not_found');
    const body = (await request.json()) as Partial<{ match_type: 'exact' | 'prefix' | 'pattern'; value: string; tier_id: string; position: number }>;
    const next = { ...rule, ...(body.match_type === undefined ? {} : { match_type: body.match_type }), ...(body.value === undefined ? {} : { value: body.value }), ...(body.tier_id === undefined ? {} : { tier_id: body.tier_id }) };
    world.rules.splice(index, 1);
    const at = Math.min(Math.max((body.position ?? index + 1) - 1, 0), world.rules.length);
    world.rules.splice(at, 0, next);
    return HttpResponse.json({ data: ruleView(next, at + 1) });
  }),

  mock('delete', `${P}/tier-rules/{rule_id}`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'projects:write' });
    if (caller instanceof Response) return caller;
    const world = linksWorld();
    if (!world.rules.some((rule) => rule.rule_id === params.rule_id)) return problem(request, 'not_found');
    world.rules = world.rules.filter((rule) => rule.rule_id !== params.rule_id);
    return noContent();
  }),

  mock('post', `${P}/tier-rules/preview`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    const body = (await request.json()) as { match_type: 'exact' | 'prefix' | 'pattern'; value: string; position?: number; rule_id?: string };
    const world = linksWorld();
    const earlier = world.rules.slice(0, (body.position ?? world.rules.length + 1) - 1).filter((rule) => rule.rule_id !== body.rule_id);
    const matching = crawledPages().filter((page) => ruleMatches(body, page.path));
    const wouldApply = matching.filter((page) => !world.manual.has(page.id) && !earlier.some((rule) => ruleMatches(rule, page.path)));
    return HttpResponse.json({ data: { matching_pages: matching.length, would_apply: wouldApply.length } });
  }),

  mock('put', `${P}/pages/tiers`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'projects:write' });
    if (caller instanceof Response) return caller;
    const body = (await request.json()) as Record<string, unknown>;
    const ids = selected(body);
    const tierId = typeof body.tier_id === 'string' ? body.tier_id : null;
    const world = linksWorld();
    let changed = 0;
    for (const id of ids) {
      if (world.manual.get(id)?.tier_id === tierId) continue;
      world.manual.set(id, { tier_id: tierId, set_at: new Date().toISOString() });
      changed += 1;
    }
    return HttpResponse.json({ data: { matched: ids.length, changed } });
  }),

  mock('post', `${P}/pages/tiers/reset`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'projects:write' });
    if (caller instanceof Response) return caller;
    const ids = selected((await request.json()) as Record<string, unknown>);
    const world = linksWorld();
    const changed = ids.filter((id) => world.manual.delete(id)).length;
    return HttpResponse.json({ data: { matched: ids.length, changed } });
  }),

  mock('post', `${P}/pages/tiers/import`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'projects:write' });
    if (caller instanceof Response) return caller;
    const { csv: text } = (await request.json()) as { csv: string };
    const parsed = parseTierCsv(text, pageTierViews());
    const errors = parsed.errors.map((error) => ({ line: error.line, code: error.code, message: `Line ${String(error.line)}: ${error.code}.` }));
    const byPath = new Map(crawledPages().map((page) => [page.path, page.id]));
    const pending = parsed.rows.filter((row) => !byPath.has(new URL(row.url, 'https://eventussecurity.com').pathname)).map((row) => ({ line: row.line, url: row.url }));
    const applied = errors.length === 0;
    if (applied) {
      for (const row of parsed.rows) {
        const id = byPath.get(new URL(row.url, 'https://eventussecurity.com').pathname);
        if (id !== undefined) linksWorld().manual.set(id, { tier_id: row.tierId, set_at: new Date().toISOString() });
      }
    }
    return HttpResponse.json({ data: { accepted: parsed.rows.length - pending.length, pending, errors, applied } });
  }),

  mock('put', `${P}/pages/tags`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'projects:write' });
    if (caller instanceof Response) return caller;
    const body = (await request.json()) as Record<string, unknown> & { add: string[]; remove: string[] };
    const ids = selected(body);
    const world = linksWorld();
    let added = 0;
    let removed = 0;
    for (const id of ids) {
      const tags = world.tags.get(id) ?? new Set<string>();
      for (const term of body.add) if (!tags.has(term) && tags.add(term)) added += 1;
      for (const term of body.remove) if (tags.delete(term)) removed += 1;
      world.tags.set(id, tags);
    }
    return HttpResponse.json({ data: { matched: ids.length, added, removed } });
  }),

  // ---------------------------------------------------------------------------------------------
  // Crawls

  mock('get', `${P}/link-crawls`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read', query: ['cursor', 'limit'] });
    if (caller instanceof Response) return caller;
    return HttpResponse.json(cursorPage(caller.url, crawlsOf(caller.project.project_id)));
  }),

  mock('post', `${P}/link-crawls`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'runs:trigger' });
    if (caller instanceof Response) return caller;
    const projectId = caller.project.project_id;
    if (caller.project.primary_domain === null) return problem(request, 'no_website');
    const running = crawlsOf(projectId).find((run) => run.state === 'queued' || run.state === 'crawling' || run.state === 'processing');
    if (running !== undefined) return problem(request, 'crawl_in_progress', { run_id: running.run_id });
    const body = (await request.json().catch(() => ({}))) as { higher_limit?: boolean };
    const run = startCrawl(projectId, body.higher_limit === true ? 'ceiling_retry' : 'manual');
    return HttpResponse.json({ data: run }, { status: 202 });
  }),

  // ---------------------------------------------------------------------------------------------
  // Reads

  mock('get', `${P}/internal-links/pages`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read', query: PAGE_QUERY });
    if (caller instanceof Response) return caller;
    if (!hasFinishedCrawl(caller.project.project_id)) return problem(request, 'no_crawl');
    const view = scopeOf(caller.url);
    const rows = sortRows(
      crawledPages().map((page) => pageRow(page, view)).filter((row) => pageMatches(row, caller.url)),
      caller.url.searchParams.get('sort') ?? '-equity_share',
    );
    if (caller.url.searchParams.get('format') === 'csv') {
      return csv([['URL', 'Tier', 'Status', 'Depth', 'Linking pages', 'Outlinks'], ...rows.map((row) => [row.url, row.tier?.code ?? '', row.status_code ?? '', row.click_depth ?? '', row.linking_pages, row.outlinks])], 'pages');
    }
    return HttpResponse.json({ ...cursorPage(caller.url, rows), meta: { run_id: '0192e4a0-1000-7000-8000-000000000001', scope: view, total: rows.length } });
  }),

  mock('get', `${P}/internal-links/pages/{url_id}`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read', query: ['run', 'scope'] });
    if (caller instanceof Response) return caller;
    if (!hasFinishedCrawl(caller.project.project_id)) return problem(request, 'no_crawl');
    const page = crawledPage(String(params.url_id));
    if (page === undefined) return problem(request, 'not_found');
    const view = scopeOf(caller.url);
    const row = pageRow(page, view);
    const linking = neighborsOf(page.id, 'in', view);
    const outlinks = neighborsOf(page.id, 'out', view);
    const placements = new Map<string, number>();
    for (const neighbor of linking) if (neighbor.placement !== null) placements.set(neighbor.placement, (placements.get(neighbor.placement) ?? 0) + 1);
    return HttpResponse.json({
      data: {
        page: row,
        linking_by_tier: row.linked_from_tiers,
        linking_by_placement: [...placements].map(([placement, pages]) => ({ placement: placement as NonNullable<(typeof linking)[number]['placement']>, pages })),
        top_anchors: row.top_anchor === null ? [] : [{ anchor: row.top_anchor, links: 1 }],
        linking_pages: linking.slice(0, 25),
        outlinks: outlinks.slice(0, 25),
        linking_pages_total: linking.length,
        outlinks_total: outlinks.length,
      },
    });
  }),

  mock('get', `${P}/internal-links/edges`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read', query: EDGE_QUERY });
    if (caller instanceof Response) return caller;
    if (!hasFinishedCrawl(caller.project.project_id)) return problem(request, 'no_crawl');
    const url = caller.url;
    const view = scopeOf(url);
    const sourceTiers = listOf(url, 'filter[source_tier]');
    const targetTiers = listOf(url, 'filter[target_tier]');
    const placements = listOf(url, 'filter[placement]');
    const statuses = listOf(url, 'filter[target_status]');
    const worklist = url.searchParams.get('filter[worklist]');
    const rows = edgeRows(worklist === null ? view : 'all').filter(
      (row) =>
        (sourceTiers.length === 0 || sourceTiers.includes(row.source.tier?.tier_id ?? 'none')) &&
        (targetTiers.length === 0 || targetTiers.includes(row.target.tier?.tier_id ?? 'none')) &&
        (placements.length === 0 || placements.includes(row.placement)) &&
        (statuses.length === 0 || (row.target.status_code !== null && statuses.includes(statusClassOf(row.target.status_code)))) &&
        (url.searchParams.get('filter[source]') === null || row.source.url_id === url.searchParams.get('filter[source]')) &&
        (url.searchParams.get('filter[target]') === null || row.target.url_id === url.searchParams.get('filter[target]')) &&
        (worklist !== 'broken_and_redirected' || (row.target.status_code ?? 200) >= 300) &&
        (worklist !== 'links_to_non_indexable' || (row.target.status_code === 200 && row.target.is_indexable === false)) &&
        row.source.path.includes(url.searchParams.get('q_source') ?? '') &&
        row.target.path.includes(url.searchParams.get('q_target') ?? ''),
    );
    if (url.searchParams.get('format') === 'csv') {
      return csv([['Source', 'Target', 'Anchor', 'Placement'], ...rows.map((row) => [row.source.url, row.target.url, row.anchor, row.placement])], 'links');
    }
    return HttpResponse.json({ ...cursorPage(url, rows), meta: { run_id: '0192e4a0-1000-7000-8000-000000000001', scope: view, total: rows.length } });
  }),

  mock('get', `${P}/internal-links/neighbors`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read', query: ['url_id', 'direction', 'run', 'scope', 'limit', 'offset'] });
    if (caller instanceof Response) return caller;
    if (!hasFinishedCrawl(caller.project.project_id)) return problem(request, 'no_crawl');
    const url = caller.url;
    const id = url.searchParams.get('url_id') ?? '';
    const page = crawledPage(id);
    if (page === undefined) return problem(request, 'not_found');
    const direction = url.searchParams.get('direction') === 'in' ? 'in' : 'out';
    const view = scopeOf(url);
    const all = neighborsOf(id, direction, view);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Math.min(50, Number(url.searchParams.get('limit') ?? 8));
    return HttpResponse.json({
      data: all.slice(offset, offset + limit),
      meta: {
        run_id: '0192e4a0-1000-7000-8000-000000000001',
        url_id: id,
        direction,
        scope: view,
        total: all.length,
        other_scopes: otherScopes(id, direction, view),
        focus: { url_id: id, status_code: page.status, redirect_url_id: page.redirectTo ?? null },
      },
    });
  }),

  mock('get', `${P}/internal-links/tier-flow`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read', query: ['run', 'scope'] });
    if (caller instanceof Response) return caller;
    if (!hasFinishedCrawl(caller.project.project_id)) return problem(request, 'no_crawl');
    return HttpResponse.json({ data: tierFlow(scopeOf(caller.url)) });
  }),

  mock('get', `${P}/internal-links/worklists`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read', query: ['run'] });
    if (caller instanceof Response) return caller;
    if (!hasFinishedCrawl(caller.project.project_id)) return problem(request, 'no_crawl');
    return HttpResponse.json({ data: worklists() });
  }),
];
```

The `projectCaller` query list names the parameters a route takes, so an unknown one is a `422` as in the API.

- [ ] **Step 10: Register the handlers, and give the settings and new-project mocks their new members**

In `apps/web/src/mocks/handlers/index.ts`, import `internalLinkHandlers` from `./internal-links` and spread it into `handlers` after `...integrationHandlers,`:

```ts
  // Internal links (plan 03)
  ...internalLinkHandlers,
```

In `apps/web/src/mocks/handlers/term-assignments.ts`, the `GET {P}/settings` answer gains the project's internal links settings, and `PATCH {P}/settings` takes `internal_links` with `seo` now optional (plan 02: at least one). Add the import:

```ts
import { linksWorld, settingsOf } from '../internal-links-world';
```

In the GET handler's `data`, after `seo: ...`:

```ts
        internal_links: settingsOf(projectId),
```

Replace the whole `mock('patch', `${P}/settings`, ...)` handler with this one. It keeps the seo checks and the seo merge as they are, makes `seo` optional when `internal_links` is given, and stores and answers the links settings:

```ts
  mock('patch', `${P}/settings`, async ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const seo = body.seo;
    const links = body.internal_links;
    const errors: ValidationItem[] = [
      ...extraMembers(body, ['seo', 'internal_links']),
      // Plan 02: at least one of the two; an empty body reads as a missing seo, as before
      ...(seo === undefined && links === undefined ? [bodyError('seo', 'missing', 'Field required')] : []),
      ...(seo !== undefined && !isRecord(seo) ? [notAnObject('seo')] : []),
      ...(links !== undefined && !isRecord(links) ? [notAnObject('internal_links')] : []),
    ];
    if (isRecord(seo)) {
      errors.push(...extraMembers(seo, Object.keys(SEO_FIELDS), 'seo'));
      for (const [name, allowed] of Object.entries(SEO_FIELDS)) {
        if (seo[name] === null) errors.push(bodyError(`seo.${name}`, 'null_not_allowed', 'Cannot be null.'));
        else errors.push(...enumError(seo[name], `seo.${name}`, allowed));
      }
    }
    if (isRecord(links)) {
      errors.push(...extraMembers(links, ['schedule', 'render_javascript', 'allowed_subdomains'], 'internal_links'));
      errors.push(...enumError(links.schedule, 'internal_links.schedule', LINK_SCHEDULES));
    }
    if (errors.length > 0) return invalid(request, errors);
    const projectId = caller.project.project_id;
    // The members sent replace those set before; the others keep their value
    const before = seoOf(caller.keywords.settings[projectId]);
    const settings: SeoValues = !isRecord(seo)
      ? before
      : {
          default_device: isOneOf(seo.default_device, SEO_FIELDS.default_device) ? seo.default_device : before.default_device,
          default_depth_profile: isOneOf(seo.default_depth_profile, SEO_FIELDS.default_depth_profile)
            ? seo.default_depth_profile
            : before.default_depth_profile,
          default_frequency: isOneOf(seo.default_frequency, SEO_FIELDS.default_frequency)
            ? seo.default_frequency
            : before.default_frequency,
          visibility_weight_scheme: isOneOf(seo.visibility_weight_scheme, SEO_FIELDS.visibility_weight_scheme)
            ? seo.visibility_weight_scheme
            : before.visibility_weight_scheme,
          visibility_volume_mode: isOneOf(seo.visibility_volume_mode, SEO_FIELDS.visibility_volume_mode)
            ? seo.visibility_volume_mode
            : before.visibility_volume_mode,
        };
    if (isRecord(links)) {
      const was = settingsOf(projectId);
      linksWorld().settings.set(projectId, {
        schedule: isOneOf(links.schedule, LINK_SCHEDULES) ? links.schedule : was.schedule,
        render_javascript: typeof links.render_javascript === 'boolean' ? links.render_javascript : was.render_javascript,
        allowed_subdomains: Array.isArray(links.allowed_subdomains)
          ? links.allowed_subdomains.filter((host): host is string => typeof host === 'string').slice(0, 10)
          : was.allowed_subdomains,
      });
    }
    const cookie = savedKeywords(request, withSettings(caller.keywordChanges, projectId, settings));
    if (typeof cookie !== 'string') return cookie;
    return HttpResponse.json(
      {
        data: {
          version: 1,
          seo: seoOf(settings),
          internal_links: settingsOf(projectId),
          entity_config_version: entityConfigVersion(caller.entityChanges, projectId),
        },
      },
      { headers: { 'set-cookie': cookie } },
    );
  }),
```

with, near `SEO_FIELDS`:

```ts
const LINK_SCHEDULES = ['weekly', 'every_two_weeks', 'monthly', 'off'] as const;
```

The merge of the five seo members above is the handler's existing merge, unchanged; if the file's current handler merges another member, keep that line too. `enumError` passes an absent value (the member left out), as it does for the seo members.

In `apps/web/src/mocks/handlers/projects.ts`, in the `POST {W}/projects` handler, after the project is created (where `project` is found in `projectList(next, ...)`), start the first crawl when the form asked for it (plan 02 decision D14):

```ts
    if (body.map_internal_links === true && project !== undefined && project.primary_domain !== null) {
      startCrawl(project.project_id, 'website_added');
    }
```

with `import { startCrawl } from '../internal-links-world';`, and add `'map_internal_links',` to `CREATE_FIELDS` at the top of the file so the member check takes it.

- [ ] **Step 11: Run the handler tests and the mock suites**

```bash
pnpm vitest run src/mocks/handlers/internal-links.test.ts src/mocks/handlers/keyword-groups.test.ts src/mocks/handlers/handlers.test.ts src/mocks/handlers/workspaces.test.ts
```

Expected: PASS. A type error in `internal-links.ts` at `mock('get', ...)` names a path plan 02 spelled differently: use the spelling of `schema.ts`.

- [ ] **Step 12: Run the gate and commit**

```bash
git add apps/web/src/lib/internal-links/types.ts apps/web/src/lib/internal-links/queries.ts \
  apps/web/src/lib/internal-links/queries.test.ts apps/web/src/lib/internal-links/mutations.ts \
  apps/web/src/lib/api/download.ts apps/web/src/lib/api/download.test.tsx \
  apps/web/src/mocks/internal-links-world.ts apps/web/src/mocks/handlers/internal-links.ts \
  apps/web/src/mocks/handlers/internal-links.test.ts apps/web/src/mocks/handlers/index.ts \
  apps/web/src/mocks/respond.ts apps/web/src/mocks/handlers/term-assignments.ts apps/web/src/mocks/handlers/projects.ts
git commit -m "Internal links: queries, mutations, CSV download and the mock API"
```

---

### Task 6: Route, sidebar item, address state and the page shell with every crawl state

**Files:**
- Modify: `apps/web/src/lib/navigation/registry.ts`, `apps/web/src/lib/navigation/registry.test.ts`, `apps/web/src/lib/routes/paths.ts`
- Create: `apps/web/src/app/[workspace]/[project]/seo/internal-links/page.tsx`
- Create: `apps/web/src/features/internal-links/index.ts`, `url-state.ts`, `url-state.test.ts`, `crawl-reads.ts`, `crawl-view.test.ts`, `tabs.ts`, `internal-links-screen.tsx`, `crawl-header.tsx`, `crawl-states.tsx`, `summary-strip.tsx`, `internal-links-screen.test.tsx`
- Create: `apps/web/src/test/internal-links-harness.tsx`
- Modify: `apps/web/messages/en.json`

Mock: `il.js` (`pageRow`, `tabs`, `strip`, `stateBanner`, `emptyPanel`, `firstCrawlPanel`) and the screenshots `01-pages.png` and `12-first-crawl.png`.

- [ ] **Step 1: Add the messages of the shell**

Merge into `apps/web/messages/en.json` (new keys inside existing objects; the `internalLinks` object is new, placed after `"linkCanvas"`):

```json
  "navigation": {
    "items": {
      "internalLinks": "Internal links"
    }
  },
  "internalLinks": {
    "title": "Internal links",
    "noAccessTitle": "You cannot see internal links",
    "noAccessReason": "Your role does not include reading this project's data. Ask an admin of the workspace for access.",
    "tabs": {
      "label": "Internal links views",
      "pages": "Pages",
      "links": "Links",
      "journey": "Journey",
      "flow": "Tier flow"
    },
    "scope": {
      "label": "Links",
      "chip": "Links: {scope}",
      "menu": "Link scope",
      "menuName": "Link scope: {scope}",
      "editorial": "Editorial",
      "autoGenerated": "Auto-generated",
      "template": "Menu and footer",
      "all": "All links"
    },
    "placement": {
      "content": "Content",
      "autoGenerated": "Auto-generated",
      "navigation": "Navigation",
      "header": "Header",
      "footer": "Footer",
      "sidebar": "Sidebar",
      "breadcrumb": "Breadcrumb"
    },
    "header": {
      "crawled": "Crawled {date}, {count, plural, one {# page} other {# pages}}",
      "crawledName": "Crawl shown: {date}, {count, plural, one {# page} other {# pages}}",
      "moreActions": "More actions",
      "crawlSettings": "Crawl settings",
      "editTiers": "Edit page tiers",
      "workspace": "Workspace",
      "export": "Export",
      "exportTab": "Export this tab (CSV)",
      "exportNone": "Export the Pages, Links or Tier flow tab.",
      "exportFailed": "The export could not be made",
      "crawlNow": "Crawl now",
      "crawling": "Crawling",
      "crawlingSince": "A crawl started {time}. One crawl runs at a time.",
      "crawlStarted": "Crawl started",
      "crawlStartedText": "{host} is being crawled. The tables keep showing the last crawl until it finishes.",
      "crawlBusy": "A crawl is already running",
      "crawlBudget": "The workspace budget for site crawls is used up, so the crawl did not start.",
      "crawlNoWebsite": "Add a website to the project first.",
      "crawlFailed": "The crawl could not be started"
    },
    "strip": {
      "label": "Crawl summary",
      "pages": "Pages",
      "tiered": "Tiered",
      "tieredValue": "{tiered} of {total}",
      "tieredTip": "Show the pages without a tier",
      "t1Pages": "T1 pages",
      "t1Depth": "T1 average depth",
      "noEditorial": "No editorial links in"
    },
    "states": {
      "noWebsiteTitle": "Add your website to map internal links",
      "noWebsiteReason": "Internal links crawls the project’s website, then shows how its pages link to each other. The first crawl starts as soon as a website is added.",
      "noWebsiteAction": "Add website",
      "neverTitle": "No crawl yet",
      "neverReason": "Crawl {host} to map how its pages link to each other.",
      "firstTitle": "Mapping {host}",
      "firstProgress": "{count, plural, one {# page} other {# pages}} found so far. Started {time}, when the website was added.",
      "firstProgressManual": "{count, plural, one {# page} other {# pages}} found so far. Started {time}.",
      "firstLead": "Tag your most important pages while you wait. Tiers do not need a crawl, and rules apply to every page the crawl finds.",
      "progressLabel": "Crawl progress",
      "runningLead": "Crawling now: {count, plural, one {# page} other {# pages}} found so far.",
      "runningText": "You are seeing the crawl of {date}. The tables switch to the new crawl when it finishes.",
      "failedLead": "The last crawl failed.",
      "failedSiteBlocked": "{host} answered 403 to our crawler on the start page, so nothing was crawled. Ask the site owner to allow the user agent “RSiteAuditor”.",
      "failedUnreachable": "{host} could not be reached, or its start page did not answer with a page.",
      "failedBudget": "The workspace budget for site crawls is used up, so the crawl did not run.",
      "failedOther": "The crawl service failed. Try again; if it fails again, contact support.",
      "failedShowing": "You are seeing the crawl of {date}.",
      "retry": "Try again",
      "ceilingLead": "Stopped at {count, plural, one {# page} other {# pages}}.",
      "ceilingText": "The site has far more URLs than its sitemap lists (filter pages that never end). The pages found so far are shown.",
      "ceilingAction": "Crawl again with a higher limit",
      "hintLead": "Very few pages were found.",
      "hintText": "The start page may build its links with JavaScript. Turn on Render JavaScript in the crawl settings; it costs 10 times as much per page.",
      "hintAction": "Crawl settings",
      "loadFailed": "Internal links could not be loaded",
      "loadFailedReason": "The crawl list did not load. Try again."
    }
  },
```

- [ ] **Step 2: Write the failing address and crawl-view tests**

`apps/web/src/features/internal-links/url-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseLinksSearch } from './url-state';

describe('the address of Internal links (URL state table)', () => {
  it('reads the defaults from an empty address', () => {
    expect(parseLinksSearch({})).toEqual({
      tab: 'pages',
      scope: 'editorial',
      worklist: null,
      edgeWorklist: null,
      sort: '-linking_pages',
      q: null,
      lq: null,
      source: null,
      target: null,
      focus: null,
      journeyView: 'canvas',
      treeDir: 'out',
      open: new Set(),
      groups: new Set(),
      more: new Map(),
      treeOpen: new Set(),
    });
  });

  it('reads every key, and drops values it does not know', () => {
    const state = parseLinksSearch({
      tab: 'journey',
      scope: 'all',
      view: 'orphans',
      lview: 'links_to_non_indexable',
      sort: 'click_depth',
      q: ' /blog ',
      focus: '101',
      jv: 'tree',
      dir: 'in',
      open: 'o:103,bad key',
      grp: 'g:o:f:template',
      more: 'm:o|f*2',
      topen: 't.103',
    });
    expect(state).toMatchObject({
      tab: 'journey',
      scope: 'all',
      worklist: 'orphans',
      edgeWorklist: 'links_to_non_indexable',
      sort: 'click_depth',
      q: '/blog',
      focus: '101',
      journeyView: 'tree',
      treeDir: 'in',
    });
    expect([...state.open]).toEqual(['o:103']);
    expect([...state.groups]).toEqual(['g:o:f:template']);
    expect([...state.more]).toEqual([['m:o|f', 2]]);
    expect([...state.treeOpen]).toEqual(['t.103']);
    expect(parseLinksSearch({ tab: 'changes', sort: '-equity_share', focus: '12x', view: 'lost' })).toMatchObject({
      tab: 'pages',
      sort: '-linking_pages',
      focus: null,
      worklist: null,
    });
  });
});
```

`apps/web/src/features/internal-links/crawl-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { crawlView } from './crawl-reads';
import type { CrawlRun } from '@/lib/internal-links/types';

const run = (over: Partial<CrawlRun>): CrawlRun => ({
  run_id: 'r',
  trigger: 'schedule',
  state: 'ready',
  ceiling: 2000,
  pages_found: 40,
  pages_crawled: 40,
  sitemap_pages: 30,
  render_javascript: false,
  estimated_cost_usd: '0.30',
  cost_usd: '0.30',
  stop_reason: null,
  error_code: null,
  error_message: null,
  hints: [],
  is_latest: false,
  created_at: '2026-11-14T03:00:00Z',
  submitted_at: '2026-11-14T03:00:05Z',
  finished_at: '2026-11-14T03:12:00Z',
  requested_by: null,
  ...over,
});

describe('crawlView (spec 9)', () => {
  it('needs a website first, and never reads crawls without one', () => {
    expect(crawlView(false, undefined, 'loading')).toEqual({ kind: 'no-website' });
  });

  it('waits, fails and says when there is no crawl at all', () => {
    expect(crawlView(true, undefined, 'loading')).toEqual({ kind: 'loading' });
    expect(crawlView(true, undefined, 'error')).toEqual({ kind: 'error' });
    expect(crawlView(true, [], 'ready')).toEqual({ kind: 'never' });
  });

  it('shows the first crawl in progress before any crawl has finished', () => {
    const first = run({ run_id: 'a', state: 'crawling', trigger: 'website_added', finished_at: null });
    expect(crawlView(true, [first], 'ready')).toEqual({ kind: 'first', run: first });
  });

  it('shows a failed first crawl as its own state', () => {
    const failed = run({ state: 'failed', error_code: 'site_blocked' });
    expect(crawlView(true, [failed], 'ready')).toEqual({ kind: 'failed-first', run: failed });
  });

  it('keeps the latest finished crawl and reports a newer running or failed one beside it', () => {
    const latest = run({ run_id: 'b', is_latest: true });
    const running = run({ run_id: 'c', state: 'crawling', finished_at: null });
    const failed = run({ run_id: 'd', state: 'failed', error_code: 'provider_error' });
    expect(crawlView(true, [running, latest], 'ready')).toEqual({ kind: 'ready', latest, active: running, failed: null });
    expect(crawlView(true, [failed, latest], 'ready')).toEqual({ kind: 'ready', latest, active: null, failed });
    expect(crawlView(true, [latest, failed], 'ready')).toEqual({ kind: 'ready', latest, active: null, failed: null });
  });
});
```

- [ ] **Step 3: Run them and see them fail**

```bash
cd apps/web && pnpm vitest run src/features/internal-links/
```

Expected: FAIL, `Failed to resolve import "./url-state"` and `"./crawl-reads"`.

- [ ] **Step 4: Write the address state**

`apps/web/src/features/internal-links/url-state.ts`:

```ts
'use client';

import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useMemo } from 'react';

import { parseKeySet, parseMore } from '@/lib/internal-links/journey-codec';
import type { Direction } from '@/lib/internal-links/journey-layout';
import { parseLinkScope, type LinkScope } from '@/lib/internal-links/scopes';
import type { EdgeWorklist, PageSort, PageWorklist } from '@/lib/internal-links/types';

/**
 * What Internal links keeps in its address (the URL state table of plan 03): the tab, the link scope, the
 * worklists, the sort and searches, and the journey. The filter bars keep their own keys (`useUrlFilters`).
 * `parseLinksSearch` is pure; `useLinksState` only reads and writes the address.
 */

export type LinksTabId = 'pages' | 'links' | 'journey' | 'flow';

export const LINKS_KEYS = ['tab', 'scope', 'view', 'lview', 'sort', 'q', 'lq', 'src', 'tgt', 'focus', 'jv', 'dir', 'open', 'grp', 'more', 'topen'] as const;
export type LinksKey = (typeof LINKS_KEYS)[number];
export type LinksSearch = Readonly<Partial<Record<LinksKey, string | null | undefined>>>;

const TABS: readonly LinksTabId[] = ['pages', 'links', 'journey', 'flow'];
const WORKLISTS: readonly PageWorklist[] = ['under_linked_t1', 'orphans', 'editorial_orphans', 'deep_only_through_auto'];
const EDGE_WORKLISTS: readonly EdgeWorklist[] = ['broken_and_redirected', 'links_to_non_indexable'];
export const PAGE_SORTS: readonly PageSort[] = [
  'path',
  '-path',
  'status_code',
  '-status_code',
  'click_depth',
  '-click_depth',
  'linking_pages',
  '-linking_pages',
  'outlinks',
  '-outlinks',
];
export const DEFAULT_SORT: PageSort = '-linking_pages';
const URL_ID = /^[1-9][0-9]{0,18}$/;

export interface LinksState {
  tab: LinksTabId;
  scope: LinkScope;
  worklist: PageWorklist | null;
  edgeWorklist: EdgeWorklist | null;
  sort: PageSort;
  q: string | null;
  lq: string | null;
  /** The Links tab narrowed to the links from or to one page (the inspector's "View all in Links"). */
  source: string | null;
  target: string | null;
  focus: string | null;
  journeyView: 'canvas' | 'tree';
  treeDir: Direction;
  open: Set<string>;
  groups: Set<string>;
  more: Map<string, number>;
  treeOpen: Set<string>;
}

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed.slice(0, 200);
};

export function parseLinksSearch(search: LinksSearch): LinksState {
  return {
    tab: TABS.find((tab) => tab === search.tab) ?? 'pages',
    scope: parseLinkScope(search.scope),
    worklist: WORKLISTS.find((list) => list === search.view) ?? null,
    edgeWorklist: EDGE_WORKLISTS.find((list) => list === search.lview) ?? null,
    sort: PAGE_SORTS.find((sort) => sort === search.sort) ?? DEFAULT_SORT,
    q: text(search.q),
    lq: text(search.lq),
    source: URL_ID.test(search.src ?? '') ? (search.src ?? null) : null,
    target: URL_ID.test(search.tgt ?? '') ? (search.tgt ?? null) : null,
    focus: URL_ID.test(search.focus ?? '') ? (search.focus ?? null) : null,
    journeyView: search.jv === 'tree' ? 'tree' : 'canvas',
    treeDir: search.dir === 'in' ? 'in' : 'out',
    open: parseKeySet(search.open),
    groups: parseKeySet(search.grp),
    more: parseMore(search.more),
    treeOpen: parseKeySet(search.topen),
  };
}

const PARSERS = Object.fromEntries(LINKS_KEYS.map((key) => [key, parseAsString])) as Record<LinksKey, typeof parseAsString>;

export type SetLinksSearch = (
  values: Partial<Record<LinksKey | string, string | null>>,
  options?: { history?: 'push' | 'replace' },
) => void;

/** The page's state from the address; nothing is written on load. */
export function useLinksState(): { state: LinksState; setSearch: SetLinksSearch } {
  const [search, setState] = useQueryStates(PARSERS, { history: 'replace' });
  const state = useMemo(() => parseLinksSearch(search), [search]);
  const setSearch = useCallback<SetLinksSearch>(
    (values, { history = 'replace' } = {}) => {
      void setState(values as Partial<Record<LinksKey, string | null>>, { history });
    },
    [setState],
  );
  return { state, setSearch };
}
```

- [ ] **Step 5: Write the crawl reads**

`apps/web/src/features/internal-links/crawl-reads.ts`:

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { startCrawlMutation } from '@/lib/internal-links/mutations';
import { crawlKeys, crawlsQuery, internalLinksKeys, pageTiersQuery } from '@/lib/internal-links/queries';
import type { CrawlRun, LinksScope, PageTier } from '@/lib/internal-links/types';

/** While a crawl runs, the list is read again this often (spec 6.2: pages found so far). */
export const CRAWL_POLL_MS = 30_000;

const ACTIVE: ReadonlySet<CrawlRun['state']> = new Set(['queued', 'crawling', 'processing']);
export const isActive = (run: CrawlRun): boolean => ACTIVE.has(run.state);

export type CrawlView =
  | { kind: 'no-website' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'never' }
  | { kind: 'first'; run: CrawlRun }
  | { kind: 'failed-first'; run: CrawlRun }
  | { kind: 'ready'; latest: CrawlRun; active: CrawlRun | null; failed: CrawlRun | null };

/**
 * What the page shows for the crawls of a project (spec 9), from the runs newest first. The screens always show
 * the latest finished crawl (decision W19); a newer run that is under way or failed is reported beside it.
 */
export function crawlView(
  hasWebsite: boolean,
  runs: readonly CrawlRun[] | undefined,
  status: 'loading' | 'error' | 'ready',
): CrawlView {
  if (!hasWebsite) return { kind: 'no-website' };
  if (runs === undefined) return status === 'error' ? { kind: 'error' } : { kind: 'loading' };
  const latestAt = runs.findIndex((run) => run.is_latest);
  const newest = runs[0];
  if (newest === undefined) return { kind: 'never' };
  const latest = runs[latestAt];
  if (latest === undefined) {
    if (isActive(newest)) return { kind: 'first', run: newest };
    return { kind: 'failed-first', run: newest };
  }
  const newer = runs.slice(0, latestAt);
  return {
    kind: 'ready',
    latest,
    active: newer.find(isActive) ?? null,
    failed: newer[0]?.state === 'failed' ? (newer[0] ?? null) : null,
  };
}

/** The crawls, polled while one runs. */
export function useCrawls(scope: LinksScope, enabled: boolean) {
  return useQuery({
    ...crawlsQuery(scope),
    enabled,
    refetchInterval: (query) => ((query.state.data?.data ?? []).some(isActive) ? CRAWL_POLL_MS : false),
  });
}

/** The workspace's tiers, which every tab, filter and dialog names. */
export const useWorkspaceTiers = (workspaceId: string) => useQuery(pageTiersQuery(workspaceId));
export type Tiers = readonly PageTier[];

/** Crawl now (and Crawl again with a higher limit): one crawl at a time, the budget checked first. */
export function useCrawlNow(scope: LinksScope, host: string) {
  const t = useTranslations('internalLinks.header');
  const queryClient = useQueryClient();
  const mutation = useMutation(startCrawlMutation);
  const start = (higherLimit = false): void => {
    mutation.mutate(
      {
        params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
        body: { higher_limit: higherLimit },
      },
      {
        onSuccess: () => {
          toast({ type: 'info', title: t('crawlStarted'), description: t('crawlStartedText', { host }) });
          for (const queryKey of [...crawlKeys(scope), ...internalLinksKeys(scope)]) void queryClient.invalidateQueries({ queryKey });
        },
        onError: (error) => {
          if (isApiProblem(error, 'crawl_in_progress')) toast({ type: 'info', title: t('crawlBusy') });
          else if (isApiProblem(error, 'budget_exceeded')) toast({ type: 'error', title: t('crawlFailed'), description: t('crawlBudget') });
          else if (isApiProblem(error, 'no_website')) toast({ type: 'error', title: t('crawlFailed'), description: t('crawlNoWebsite') });
          else toast({ type: 'error', title: t('crawlFailed') });
          for (const queryKey of crawlKeys(scope)) void queryClient.invalidateQueries({ queryKey });
        },
      },
    );
  };
  return { start, pending: mutation.isPending };
}
```

- [ ] **Step 6: Run the two tests and see them pass**

```bash
pnpm vitest run src/features/internal-links/
```

Expected: PASS, 7 tests.

- [ ] **Step 7: Write the tab registry, the strip, the states, the header and the screen**

`apps/web/src/features/internal-links/tabs.ts`:

```ts
import type { useTranslations } from 'next-intl';
import type { Route } from 'next';
import type { ReactNode } from 'react';

import type { LinksState, LinksTabId, SetLinksSearch } from './url-state';
import type { LinksScope, PageTier } from '@/lib/internal-links/types';

export type LinksTranslate = ReturnType<typeof useTranslations<'internalLinks'>>;

/** What a tab of the page is handed. */
export interface LinksTabContext {
  scope: LinksScope;
  workspaceSlug: string;
  projectSlug: string;
  timeZone: string;
  host: string;
  state: LinksState;
  setSearch: SetLinksSearch;
  tiers: readonly PageTier[];
  /** The page inspector (`?inspect=page:<url_id>`). */
  inspect: { open: (urlId: string) => void; urlId: string | null; setOrder: (urlIds: readonly string[]) => void };
  /** Opens the Journey on a page (spec 7.2 "Open in journey"); the focus pushes a history entry. */
  openJourney: (urlId: string) => void;
  /** Hands the page's Export menu this tab's download, or `null` while it has none. */
  registerExport: (run: (() => Promise<void>) | null) => void;
  /** A link inside the app that keeps nothing of this page's address. */
  hrefOf: (path: `/${string}`) => Route;
}

export interface LinksTabEntry {
  id: LinksTabId;
  label: (t: LinksTranslate) => string;
  render: (context: LinksTabContext) => ReactNode;
}

const ORDER: Readonly<Record<LinksTabId, number>> = { pages: 0, links: 1, journey: 2, flow: 3 };

/** The tabs in the page's order; a repeated id is a mistake of the code that lists them. */
export function defineLinksTabs(entries: readonly LinksTabEntry[]): readonly LinksTabEntry[] {
  const seen = new Set<LinksTabId>();
  for (const { id } of entries) {
    if (seen.has(id)) throw new Error(`The internal links tab "${id}" is listed twice`);
    seen.add(id);
  }
  return [...entries].sort((a, b) => ORDER[a.id] - ORDER[b.id]);
}

/** The tabs built so far: each tab's task adds its entry here (Pages in Task 7, Links 10, Journey 11, Tier flow 12). */
export const LINKS_TABS: readonly LinksTabEntry[] = defineLinksTabs([]);

export const activeLinksTab = (tabs: readonly LinksTabEntry[], wanted: LinksTabId): LinksTabEntry | null =>
  tabs.find((tab) => tab.id === wanted) ?? tabs[0] ?? null;
```

`apps/web/src/features/internal-links/summary-strip.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { Route } from 'next';
import type { ReactElement } from 'react';

import { StatChip } from '@/components/app/page-toolbar/stat-chip';
import { EMPTY_VALUE, formatDecimal, formatInteger } from '@/lib/format';
import { tierFlowQuery, worklistsQuery } from '@/lib/internal-links/queries';
import { tierPosition } from '@/lib/internal-links/tiers';
import type { LinksScope } from '@/lib/internal-links/types';

/**
 * The summary above the tabs (mock `il.js` `strip`): pages, how many are tiered (a link to the Untiered filter while
 * some are not), T1 pages and their average depth, and the pages no editorial link reaches. Hidden below `md`, as
 * in the mock. No equity figure (decision W4).
 */
export function SummaryStrip({ scope, untieredHref }: { scope: LinksScope; untieredHref: Route }): ReactElement | null {
  const t = useTranslations('internalLinks.strip');
  const flow = useQuery(tierFlowQuery(scope, 'editorial'));
  const lists = useQuery(worklistsQuery(scope));
  const tiers = flow.data?.data.tiers;
  const worklists = lists.data?.data;
  if (tiers === undefined || worklists === undefined) return null;
  const total = tiers.reduce((sum, stat) => sum + stat.pages, 0);
  const untiered = tiers.find((stat) => stat.tier === null)?.pages ?? 0;
  const t1 = tiers.find((stat) => stat.tier !== null && tierPosition(stat.tier) === 1);
  return (
    <div role="group" aria-label={t('label')} className="hidden items-center gap-4 md:flex">
      <StatChip label={t('pages')} value={formatInteger(total)} />
      <StatChip
        label={t('tiered')}
        value={t('tieredValue', { tiered: formatInteger(total - untiered), total: formatInteger(total) })}
        {...(untiered > 0 ? { href: untieredHref, tooltip: t('tieredTip') } : {})}
      />
      <StatChip label={t('t1Pages')} value={formatInteger(t1?.pages ?? 0)} />
      <StatChip
        label={t('t1Depth')}
        value={t1?.average_depth === null || t1 === undefined ? EMPTY_VALUE : formatDecimal(t1.average_depth, 1)}
      />
      <StatChip label={t('noEditorial')} value={formatInteger(worklists.orphans + worklists.editorial_orphans)} />
    </div>
  );
}
```

`apps/web/src/features/internal-links/crawl-states.tsx`:

```tsx
'use client';

import { Globe, Radar } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { LinkButton } from '@/components/ui/link-button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelative, formatTableDate } from '@/lib/format';
import type { CrawlRun } from '@/lib/internal-links/types';

/** The words of a failed crawl, by its error code (plan 02 "Errors and states"). */
export function failedText(t: ReturnType<typeof useTranslations<'internalLinks.states'>>, run: CrawlRun, host: string): string {
  if (run.error_code === 'site_blocked') return t('failedSiteBlocked', { host });
  if (run.error_code === 'site_unreachable') return t('failedUnreachable', { host });
  if (run.error_code === 'budget_exceeded') return t('failedBudget');
  return run.error_message ?? t('failedOther');
}

export function NoWebsite({ settingsHref }: { settingsHref: Route }): ReactElement {
  const t = useTranslations('internalLinks.states');
  return (
    <EmptyState
      icon={Globe}
      title={t('noWebsiteTitle')}
      reason={t('noWebsiteReason')}
      headingLevel={2}
      primaryAction={
        <LinkButton variant="primary" size="sm" render={<Link href={settingsHref} />}>
          {t('noWebsiteAction')}
        </LinkButton>
      }
    />
  );
}

export function NeverCrawled({ host, crawlNow }: { host: string; crawlNow: ReactNode }): ReactElement {
  const t = useTranslations('internalLinks.states');
  return <EmptyState icon={Radar} title={t('neverTitle')} reason={t('neverReason', { host })} headingLevel={2} primaryAction={crawlNow} />;
}

/**
 * The first crawl of a website (mock `firstCrawlPanel`, spec 9 "First crawl running"): progress with the pages found
 * so far, the lead to tag pages meanwhile with its actions, and skeleton rows, never an empty table.
 */
export function FirstCrawl({
  run,
  host,
  timeZone,
  actions,
}: {
  run: CrawlRun;
  host: string;
  timeZone: string;
  /** Set up tier rules and Import tiers from CSV (Task 13). */
  actions?: ReactNode;
}): ReactElement {
  const t = useTranslations('internalLinks.states');
  const time = formatRelative(run.created_at, timeZone);
  const share = run.ceiling === 0 ? 0 : Math.min(1, run.pages_found / run.ceiling);
  return (
    <section aria-labelledby="first-crawl-title" className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3" role="status">
        <Icon icon={Radar} className="text-primary-text" />
        <h2 id="first-crawl-title" className="type-body-strong">
          {t('firstTitle', { host })}
        </h2>
        <span className="type-meta num">
          {run.trigger === 'website_added'
            ? t('firstProgress', { count: run.pages_found, time })
            : t('firstProgressManual', { count: run.pages_found, time })}
        </span>
      </div>
      <div
        className="h-0.5 bg-surface-subtle"
        role="progressbar"
        aria-label={t('progressLabel')}
        aria-valuemin={0}
        aria-valuemax={run.ceiling}
        aria-valuenow={run.pages_found}
      >
        <div className="h-full bg-primary" style={{ width: `${String(Math.round(share * 100))}%` }} />
      </div>
      <div className="flex flex-col gap-2 border-b border-border-subtle px-4 py-3">
        <p className="type-body text-foreground">{t('firstLead')}</p>
        {actions === undefined ? null : <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="flex flex-col gap-2 p-4" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} shape="block" height="row" />
        ))}
      </div>
    </section>
  );
}

/** The banner above the tabs while a crawl runs, after one failed, or when one stopped at its ceiling (spec 9). */
export function CrawlBanners({
  latest,
  active,
  failed,
  host,
  timeZone,
  settingsHref,
  onRetry,
  onHigherLimit,
  canCrawl,
}: {
  latest: CrawlRun;
  active: CrawlRun | null;
  failed: CrawlRun | null;
  host: string;
  timeZone: string;
  settingsHref: Route;
  onRetry: () => void;
  onHigherLimit: () => void;
  canCrawl: boolean;
}): ReactElement {
  const t = useTranslations('internalLinks.states');
  const shown = formatTableDate(latest.finished_at ?? latest.created_at, timeZone);
  return (
    <>
      {active === null ? null : (
        <Banner
          tone="info"
          placement="region"
          live
          lead={t('runningLead', { count: active.pages_found })}
          message={t('runningText', { date: shown })}
        />
      )}
      {failed === null ? null : (
        <Banner
          tone="negative"
          placement="region"
          lead={t('failedLead')}
          message={`${failedText(t, failed, host)} ${t('failedShowing', { date: shown })}`}
          actions={
            canCrawl ? (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                {t('retry')}
              </Button>
            ) : null
          }
        />
      )}
      {latest.state !== 'stopped_at_ceiling' || active !== null ? null : (
        <Banner
          tone="warning"
          placement="region"
          lead={t('ceilingLead', { count: latest.ceiling })}
          message={t('ceilingText')}
          actions={
            canCrawl ? (
              <Button variant="secondary" size="sm" onClick={onHigherLimit}>
                {t('ceilingAction')}
              </Button>
            ) : null
          }
        />
      )}
      {!latest.hints.includes('render_javascript') ? null : (
        <Banner
          tone="info"
          placement="region"
          lead={t('hintLead')}
          message={t('hintText')}
          actions={
            <Link href={settingsHref} className="type-body text-link underline-offset-2 hover:underline">
              {t('hintAction')}
            </Link>
          }
        />
      )}
    </>
  );
}
```

`apps/web/src/features/internal-links/crawl-header.tsx`:

```tsx
'use client';

import { Download, MoreHorizontal, Radar, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { isActive } from './crawl-reads';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';
import { formatRelative, formatTableDate } from '@/lib/format';
import type { CrawlRun } from '@/lib/internal-links/types';

export interface CrawlHeaderProps {
  latest: CrawlRun | null;
  active: CrawlRun | null;
  timeZone: string;
  canCrawl: boolean;
  crawlPending: boolean;
  onCrawlNow: () => void;
  onExport: (() => void) | null;
  /** Items Task 13 adds (Tier rules, Import tiers from CSV) before the settings links. */
  extraItems?: readonly MenuItemDef[] | undefined;
  settingsHref: Route;
  tiersHref: Route;
}

/**
 * The page actions (mock `il.js` `pageRow`): the crawl in scope ("Crawled 14 Nov, 40 pages"; no picker in slice 1,
 * decision W19), More actions, Export and Crawl now. While a crawl runs Crawl now reads "Crawling", is disabled and
 * says when it started.
 */
export function CrawlHeader({
  latest,
  active,
  timeZone,
  canCrawl,
  crawlPending,
  onCrawlNow,
  onExport,
  extraItems = [],
  settingsHref,
  tiersHref,
}: CrawlHeaderProps): ReactElement {
  const t = useTranslations('internalLinks.header');
  const running = active !== null && isActive(active);
  const moreItems: MenuItemDef[] = [
    ...extraItems,
    { id: 'crawl-settings', kind: 'link', label: t('crawlSettings'), link: <Link href={settingsHref} /> },
    { id: 'edit-tiers', kind: 'link', label: t('editTiers'), detail: t('workspace'), link: <Link href={tiersHref} /> },
  ];
  const exportItems: MenuItemDef[] = [
    {
      id: 'export-tab',
      label: t('exportTab'),
      icon: Download,
      ...(onExport === null ? { disabledReason: t('exportNone') } : { onSelect: onExport }),
    },
  ];
  const crawlButton = (
    <Button
      variant="primary"
      size="sm"
      icon={RefreshCw}
      disabled={running || !canCrawl}
      loading={crawlPending}
      onClick={onCrawlNow}
    >
      {running ? t('crawling') : t('crawlNow')}
    </Button>
  );
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
      {latest === null ? null : (
        <span className="flex items-center gap-1.5 type-meta whitespace-nowrap text-foreground-secondary">
          <Icon icon={Radar} size="sm" className="text-foreground-tertiary" />
          <span className="num">
            {t('crawled', { date: formatTableDate(latest.finished_at ?? latest.created_at, timeZone), count: latest.pages_crawled })}
          </span>
        </span>
      )}
      <Menu align="end" trigger={<IconButton icon={MoreHorizontal} variant="secondary" size="icon-sm" label={t('moreActions')} />} items={moreItems} />
      <Menu
        align="end"
        trigger={
          <Button variant="secondary" size="sm" icon={Download}>
            {t('export')}
          </Button>
        }
        items={exportItems}
      />
      {running ? (
        <Tooltip content={t('crawlingSince', { time: formatRelative(active.created_at, timeZone) })}>
          <span>{crawlButton}</span>
        </Tooltip>
      ) : (
        crawlButton
      )}
    </div>
  );
}
```

The mock spins the icon while a crawl runs; the label "Crawling" and the disabled state carry that here (a spinning icon would need an arbitrary class, which lint refuses outside `components/ui`).

`apps/web/src/features/internal-links/internal-links-screen.tsx`:

```tsx
'use client';

import { Ban } from 'lucide-react';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { CrawlHeader } from './crawl-header';
import { crawlView, useCrawlNow, useCrawls, useWorkspaceTiers } from './crawl-reads';
import { CrawlBanners, FirstCrawl, NeverCrawled, NoWebsite, failedText } from './crawl-states';
import { SummaryStrip } from './summary-strip';
import { activeLinksTab, LINKS_TABS, type LinksTabContext } from './tabs';
import { useLinksState } from './url-state';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { PageToolbar } from '@/components/app/page-toolbar';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Tabs, TabsPanel } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import type { LinksScope } from '@/lib/internal-links/types';
import { useCan } from '@/lib/permissions';
import { projectPath, withQuery, workspaceSettingsPath } from '@/lib/routes/paths';

export interface InternalLinksProject {
  id: string;
  slug: string;
  name: string;
  timeZone: string;
  /** The project's website; `null` when none is set (spec 9 "No website"). */
  host: string | null;
}

export interface InternalLinksScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  project: InternalLinksProject;
}

/**
 * SEO > Internal links (spec 7, the mock `il.js`): the tabs with the page actions, the summary strip, the crawl
 * state banners, then the tab's own panel. Every number belongs to the latest finished crawl (decision W19).
 */
export function InternalLinksScreen(props: InternalLinksScreenProps): ReactNode {
  const t = useTranslations('internalLinks');
  const canRead = useCan('data:read');
  if (!canRead) {
    return (
      <div className="px-3 pt-3 md:px-4 lg:px-5">
        <PageToolbar title={t('title')} />
        <EmptyState icon={Ban} title={t('noAccessTitle')} reason={t('noAccessReason')} headingLevel={2} />
      </div>
    );
  }
  return <InternalLinksContent {...props} />;
}

function InternalLinksContent({ workspaceId, workspaceSlug, project }: InternalLinksScreenProps): ReactElement {
  const t = useTranslations('internalLinks');
  const states = useTranslations('internalLinks.states');
  const header = useTranslations('internalLinks.header');
  const common = useTranslations('common');
  const scope = useMemo((): LinksScope => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const host = project.host ?? '';
  const canCrawl = useCan('runs:trigger');
  const { state, setSearch } = useLinksState();
  const crawls = useCrawls(scope, project.host !== null);
  const tiers = useWorkspaceTiers(workspaceId);
  const view = crawlView(project.host !== null, crawls.data?.data, crawls.isError ? 'error' : crawls.isPending ? 'loading' : 'ready');
  const crawl = useCrawlNow(scope, host);

  const base = projectPath(workspaceSlug, project.slug, '/seo/internal-links');
  const settingsHref = projectPath(workspaceSlug, project.slug, '/settings/links');
  const tiersHref = workspaceSettingsPath(workspaceSlug, 'tiers');
  const domainsHref = projectPath(workspaceSlug, project.slug, '/settings/domains');
  const inspector = useInspector();
  // Task 9 reads `order` for the inspector's Previous and Next: until then only the setter is used
  const [, setOrderState] = useState<readonly string[]>([]);
  // The table reports its order on every change of rows; an equal order keeps the state, so no render loop starts
  const setOrder = useCallback(
    (ids: readonly string[]) =>
      setOrderState((current) => (current.length === ids.length && current.every((id, place) => id === ids[place]) ? current : ids)),
    [],
  );
  const [exportRun, setExportRun] = useState<(() => Promise<void>) | null>(null);
  const registerExport = useCallback((run: (() => Promise<void>) | null) => setExportRun(() => run), []);
  const onExport =
    exportRun === null
      ? null
      : () => {
          void exportRun().catch(() => toast({ type: 'error', title: header('exportFailed') }));
        };

  const crawlNowButton = (
    <Button variant="primary" size="sm" loading={crawl.pending} disabled={!canCrawl} onClick={() => crawl.start()}>
      {header('crawlNow')}
    </Button>
  );

  const context: LinksTabContext = {
    scope,
    workspaceSlug,
    projectSlug: project.slug,
    timeZone: project.timeZone,
    host,
    state,
    setSearch,
    tiers: tiers.data?.data ?? [],
    inspect: {
      open: (urlId) => inspector.open({ type: 'page', id: urlId }),
      urlId: inspector.target?.type === 'page' ? inspector.target.id : null,
      setOrder,
    },
    openJourney: (urlId) =>
      setSearch({ tab: 'journey', focus: urlId, open: null, grp: null, more: null, topen: null }, { history: 'push' }),
    registerExport,
    hrefOf: (path) => projectPath(workspaceSlug, project.slug, path),
  };

  const tab = activeLinksTab(LINKS_TABS, state.tab);
  let body: ReactNode;
  switch (view.kind) {
    case 'no-website':
      body = <NoWebsite settingsHref={domainsHref} />;
      break;
    case 'loading':
      body = null;
      break;
    case 'error':
      body = (
        <InlineError
          title={states('loadFailed')}
          reason={states('loadFailedReason')}
          errorId={null}
          onRetry={() => void crawls.refetch()}
          retrying={crawls.isFetching}
          retryLabel={common('retry')}
        />
      );
      break;
    case 'never':
      body = <NeverCrawled host={host} crawlNow={crawlNowButton} />;
      break;
    case 'first':
      body = <FirstCrawl run={view.run} host={host} timeZone={project.timeZone} />;
      break;
    case 'failed-first':
      body = (
        <EmptyState
          title={states('failedLead')}
          reason={failedText(states, view.run, host)}
          headingLevel={2}
          primaryAction={
            <Button variant="primary" size="sm" disabled={!canCrawl} onClick={() => crawl.start()}>
              {states('retry')}
            </Button>
          }
        />
      );
      break;
    case 'ready':
      body = (
        <>
          <CrawlBanners
            latest={view.latest}
            active={view.active}
            failed={view.failed}
            host={host}
            timeZone={project.timeZone}
            settingsHref={settingsHref}
            canCrawl={canCrawl}
            onRetry={() => crawl.start()}
            onHigherLimit={() => crawl.start(true)}
          />
          {tab === null ? null : (
            <TabsPanel value={tab.id} className="flex min-w-0 flex-col gap-3">
              {tab.render(context)}
            </TabsPanel>
          )}
        </>
      );
      break;
  }

  const ready = view.kind === 'ready';
  const untieredHref = withQuery(base, 'tier=none');
  return (
    <InspectorLayout inspector={null}>
      <div className="flex flex-col gap-3 px-3 pt-3 pb-5 md:px-4 lg:px-5">
        <Tabs
          variant="segmented"
          label={t('tabs.label')}
          value={tab?.id ?? 'pages'}
          // The tab is the one change of the page that makes a history entry
          onValueChange={(next) => setSearch({ tab: next === 'pages' ? null : next }, { history: 'push' })}
          items={LINKS_TABS.map((entry) => ({ value: entry.id, label: entry.label(t) }))}
          renderList={(tabList) => (
            <PageToolbar
              title={t('title')}
              tabs={tabList}
              stats={ready ? <SummaryStrip scope={scope} untieredHref={untieredHref as Route} /> : null}
              actions={
                // The empty states carry their own action; the header shows once there is a crawl to act on
                view.kind === 'no-website' || view.kind === 'never' || view.kind === 'failed-first' ? null : (
                  <CrawlHeader
                    latest={view.kind === 'ready' ? view.latest : null}
                    active={view.kind === 'ready' ? view.active : view.kind === 'first' ? view.run : null}
                    timeZone={project.timeZone}
                    canCrawl={canCrawl}
                    crawlPending={crawl.pending}
                    onCrawlNow={() => crawl.start()}
                    onExport={ready ? onExport : null}
                    settingsHref={settingsHref}
                    tiersHref={tiersHref}
                  />
                )
              }
            />
          )}
          className="gap-3"
        >
          {body}
        </Tabs>
      </div>
    </InspectorLayout>
  );
}
```

The house `Tabs` item has no icon (`TabItem` is a value, a label and a count), so the mock's tab icons are left out.

`apps/web/src/features/internal-links/index.ts`:

```ts
// What other code imports of the Internal links feature
export { InternalLinksScreen, type InternalLinksProject, type InternalLinksScreenProps } from './internal-links-screen';
```

`apps/web/src/app/[workspace]/[project]/seo/internal-links/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { InternalLinksScreen } from '@/features/internal-links';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('internalLinks');
  return { title: t('title') };
}

/**
 * SEO > Internal links (spec 7). The project shell above serves this page's loading and error states; the tab,
 * filters, scope and journey live in the address, so the page reads no search parameter.
 */
export default async function InternalLinksPage({
  params,
}: PageProps<'/[workspace]/[project]/seo/internal-links'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <InternalLinksScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      project={{
        id: current.project_id,
        slug: current.slug,
        name: current.name,
        timeZone: current.timezone,
        host: current.primary_domain?.host ?? null,
      }}
    />
  );
}
```

In `apps/web/src/lib/routes/paths.ts`, add `'tiers'` to `WorkspaceSettingsSection` (`... | 'budgets' | 'tiers'`), so `workspaceSettingsPath(workspaceSlug, 'tiers')` types; Task 14 builds the page it leads to.

- [ ] **Step 8: Add the sidebar item**

In `apps/web/src/lib/navigation/registry.ts`: add `'internalLinks'` to `NavKey` after `'pages'`, import `Network` from `lucide-react`, change the comment's "16 items" to "17 items", and add after the `pages` entry:

```ts
  {
    key: 'internalLinks',
    path: '/seo/internal-links',
    icon: Network,
    section: 1,
    group: 'seo',
    permission: 'data:read',
    status: 'live',
  },
```

In `apps/web/src/lib/navigation/registry.test.ts`: the first test expects `toHaveLength(17)` and the SEO group `['rankings', 'keywords', 'pages', 'internalLinks']`; the live list for an owner becomes `['keywords', 'internalLinks', 'aiOverview', 'prompts', 'citations', 'integrations', 'runs', 'costs', 'settings']`, and its title "lists only what is live: Keywords, Internal links, AI Overview, ...".

- [ ] **Step 9: Write the harness and the failing screen test**

`apps/web/src/test/internal-links-harness.tsx`:

```tsx
import { Suspense, type ReactElement } from 'react';

import { TopBarSlotProvider, TopBarSlotTarget } from '@/components/app/shell/top-bar-slot';
import { InternalLinksScreen, type InternalLinksProject } from '@/features/internal-links';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';

const project = (slug: string, host: string | null): InternalLinksProject => {
  const seed = MOCK_PROJECTS.find((candidate) => candidate.slug === slug);
  if (seed === undefined) throw new Error(`No fixture project ${slug}`);
  return { id: seed.project_id, slug: seed.slug, name: seed.name, timeZone: seed.timezone, host };
};

/** Eventus Security: the fixture crawl of eventussecurity.com. */
export const EVENTUS_LINKS = project('eventus-security', 'eventussecurity.com');
/** Fynix: never crawled. */
export const FYNIX_LINKS = project('fynix', 'fynix.digital');
/** Fynix with no website. */
export const NO_WEBSITE = project('fynix', null);

/** The Internal links page as a member of the fixture workspace with `role`, inside the shell's slots. */
export function internalLinksAs(role: Role, current: InternalLinksProject = EVENTUS_LINKS): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <TopBarSlotProvider>
      <TopBarSlotTarget />
      <PermissionProvider membership={membershipFactory(role)}>
        <Suspense fallback={null}>
          <InternalLinksScreen workspaceId={MOCK_WORKSPACE.workspace_id} workspaceSlug={MOCK_WORKSPACE.slug} project={current} />
        </Suspense>
      </PermissionProvider>
    </TopBarSlotProvider>
  );
}
```

`apps/web/src/features/internal-links/internal-links-screen.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { axe } from '@/test/axe';
import { EVENTUS_LINKS, FYNIX_LINKS, NO_WEBSITE, internalLinksAs } from '@/test/internal-links-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => document.documentElement.classList.remove('dark'));

describe('the Internal links page (spec 7.1 and 9)', () => {
  it('names the crawl in scope and offers Crawl now', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText(/^Crawled .+, 18 pages$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crawl now' })).toBeEnabled();
    expect(await screen.findByRole('group', { name: 'Crawl summary' })).toHaveTextContent('Pages18');
  });

  it('explains that a website is needed and links to the domains settings', () => {
    renderWithProviders(internalLinksAs('editor', NO_WEBSITE));
    expect(screen.getByRole('heading', { name: 'Add your website to map internal links' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add website' })).toHaveAttribute('href', '/digibranders/fynix/settings/domains');
  });

  it('offers the first crawl of a site never crawled, then shows its progress', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', FYNIX_LINKS));
    expect(await screen.findByRole('heading', { name: 'No crawl yet' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Crawl now' }));
    expect(await screen.findByRole('heading', { name: 'Mapping fynix.digital' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Crawl progress' })).toBeInTheDocument();
  });

  it('disables Crawl now for a viewer, who cannot start runs', async () => {
    renderWithProviders(internalLinksAs('viewer', EVENTUS_LINKS));
    expect(await screen.findByRole('button', { name: 'Crawl now' })).toBeDisabled();
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await screen.findByRole('group', { name: 'Crawl summary' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

The summary strip is `hidden md:flex`; jsdom loads no stylesheet, so the strip is in the accessibility tree there.

- [ ] **Step 10: Run the shell tests and the navigation tests**

```bash
pnpm vitest run src/features/internal-links/ src/lib/navigation/ src/features/shell/
```

Expected: PASS. No shell test lists the sidebar's links by name; `registry.test.ts` is the one list.

- [ ] **Step 11: Run the gate and commit**

```bash
git add apps/web/src/lib/navigation/registry.ts apps/web/src/lib/navigation/registry.test.ts apps/web/src/lib/routes/paths.ts \
  "apps/web/src/app/[workspace]/[project]/seo/internal-links/page.tsx" \
  apps/web/src/features/internal-links/ apps/web/src/test/internal-links-harness.tsx apps/web/messages/en.json
git commit -m "Internal links: route, sidebar item, address state and the page shell with crawl states"
```

`apps/web/src/features/internal-links/` is this plan's own new folder, so naming the folder adds only its files.

---

### Task 7: Pages tab: columns, worklists, scope, filters, paging and export

**Files:**
- Create: `apps/web/src/features/internal-links/scope-menu.tsx`
- Create: `apps/web/src/features/internal-links/pages/page-filters.ts`, `page-filters.test.ts`, `page-columns.tsx`, `worklist-chips.tsx`, `pages-tab.tsx`, `pages-tab.test.tsx`, `cursor-paging.ts`, `cursor-paging.test.ts`
- Modify: `apps/web/src/features/internal-links/tabs.ts`, `apps/web/messages/en.json`

Mock: `il-pages.js` (`COLUMNS`, `chips`, `EMPTY`, `fromTiers`, `flagList`, the toolbar) and `01-pages.png`. Skip the mock's Tier suggestions chip, the GSC, Change, keyword, rank, citation and anchor columns (slices 2 and 3, gap G10).

- [ ] **Step 1: Add the messages**

Merge into `apps/web/messages/en.json`:

```json
  "internalLinks": {
    "pages": {
      "caption": "Pages",
      "one": "page",
      "other": "pages",
      "search": "Search pages",
      "openJourney": "Open {path} in journey",
      "allPages": "All pages",
      "noIssues": "No issues",
      "worklistsLabel": "Worklists",
      "linkCount": "{count, plural, one {# link} other {# links}}",
      "emptyTitle": "No pages in this crawl",
      "emptyReason": "The crawl found no page. Check the website in the project settings, then crawl again.",
      "noMatchTitle": "No pages match",
      "noMatchReason": "Change the search, the view or the filters.",
      "clearFilters": "Clear filters",
      "showAll": "Show all pages",
      "loadFailed": "The pages could not be loaded",
      "loadFailedReason": "Try again in a moment.",
      "range": "Showing {from} to {to} of {total}"
    },
    "filters": {
      "tier": "Tier",
      "untiered": "Untiered",
      "tag": "Tag",
      "status": "Status",
      "indexable": "Indexable",
      "yes": "Yes",
      "no": "No",
      "flag": "Flag"
    },
    "columns": {
      "page": "Page",
      "tier": "Tier",
      "status": "Status",
      "depth": "Depth",
      "depthTip": "Fewest clicks from the home page over every followed link",
      "linking": "Linking pages",
      "linkingTip": "Unique pages that link here, in the link scope chosen",
      "fromTiers": "Linked from tiers",
      "fromTiersTip": "Linking pages by tier, in the link scope chosen",
      "fromTiersName": "Linking pages by tier. {list}",
      "fromTiersItem": "{tier}: {count}",
      "fromTiersOf": "of {count, plural, one {# linking page} other {# linking pages}}",
      "outlinks": "Outlinks",
      "outlinksTip": "Unique pages this page links to, in the link scope chosen",
      "flags": "Flags",
      "tags": "Tags",
      "reason": "Indexability reason",
      "sitemap": "In sitemap",
      "toT1": "Outlinks to T1",
      "broken": "Broken outlinks",
      "redirects": "Links to redirects",
      "nonIndexable": "Links to non-indexable pages",
      "topAnchor": "Top anchor",
      "anchor": "“{anchor}”",
      "notReachable": "Not reachable",
      "none": "None",
      "indexableValue": "Indexable",
      "yes": "Yes",
      "no": "No",
      "more": "+{count}"
    },
    "flags": {
      "errorPage": "Error page",
      "redirect": "Redirect",
      "nonIndexable": "Not indexable",
      "orphan": "Orphan",
      "editorialOrphan": "No editorial links in",
      "deepOnlyThroughAuto": "Deep only through previous and next",
      "placementUnknown": "Placement unknown",
      "brokenOutlinks": "Broken outlink",
      "redirectOutlinks": "Links to a redirect",
      "fewEditorialLinks": "Few editorial links",
      "hasBrokenOutlinks": "Has broken outlinks"
    },
    "worklists": {
      "underLinkedT1": "Under-linked T1 pages",
      "orphans": "Orphans",
      "editorialOrphans": "Editorial orphans",
      "deepOnlyThroughAuto": "Deep only through previous and next",
      "brokenAndRedirected": "Broken and redirected links",
      "linksToNonIndexable": "Links to non-indexable pages"
    },
    "worklistEmpty": {
      "underLinkedT1Title": "No under-linked T1 pages",
      "underLinkedT1Reason": "Every T1 page has at least 3 editorial linking pages and sits within 3 clicks of the home page.",
      "orphansTitle": "No orphans",
      "orphansReason": "Every page has at least one internal link pointing to it.",
      "editorialOrphansTitle": "No editorial orphans",
      "editorialOrphansReason": "Every page is linked from at least one editorial link, not only from menus or related blocks.",
      "deepOnlyThroughAutoTitle": "No pages deep only through previous and next",
      "deepOnlyThroughAutoReason": "Every page can be reached without relying on previous and next links."
    }
  },
```

- [ ] **Step 2: Write the failing filter and paging tests**

`apps/web/src/features/internal-links/pages/page-filters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { pageQueryOf } from './page-filters';
import { parseLinksSearch } from '../url-state';

describe('pageQueryOf', () => {
  it('reads the filter bar values, the worklist, the scope, the sort and the search into one query', () => {
    const state = parseLinksSearch({ scope: 'all', view: 'orphans', sort: 'path', q: '/blog' });
    const query = pageQueryOf(
      state,
      {
        tier: { kind: 'enum', values: ['none'] },
        status: { kind: 'enum', values: ['4xx', '9xx'] },
        idx: { kind: 'enum', values: ['no'] },
        flag: { kind: 'enum', values: ['orphan'] },
        tag: { kind: 'enum', values: ['t'] },
      },
      'c1',
      200,
    );
    expect(query).toEqual({
      scope: 'all',
      tierIds: ['none'],
      tagIds: ['t'],
      status: ['4xx'],
      indexable: false,
      flags: ['orphan'],
      worklist: 'orphans',
      q: '/blog',
      sort: 'path',
      cursor: 'c1',
      limit: 200,
    });
  });
});
```

`apps/web/src/features/internal-links/pages/cursor-paging.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { pageRange } from './cursor-paging';

describe('pageRange (decision W6)', () => {
  it('numbers the rows of the page shown', () => {
    expect(pageRange({ pageIndex: 0, rows: 100, limit: 100 })).toEqual({ from: 1, to: 100, offset: 0 });
    expect(pageRange({ pageIndex: 2, rows: 17, limit: 100 })).toEqual({ from: 201, to: 217, offset: 200 });
    expect(pageRange({ pageIndex: 0, rows: 0, limit: 100 })).toEqual({ from: 0, to: 0, offset: 0 });
  });
});
```

- [ ] **Step 3: Run them and see them fail**

```bash
cd apps/web && pnpm vitest run src/features/internal-links/pages/
```

Expected: FAIL, `Failed to resolve import`.

- [ ] **Step 4: Write the filters, the paging helper and the scope menu**

`apps/web/src/features/internal-links/pages/page-filters.ts`:

```ts
import type { FilterField, FilterValues } from '@/components/app/filters/types';
import { enumValuesOf } from '@/lib/filters/filter-values';
import type { PageQuery } from '@/lib/internal-links/queries';
import type { PageFlagFilter, PageTier, StatusClass } from '@/lib/internal-links/types';
import type { LinksState } from '../url-state';
import type { LinksTranslate } from '../tabs';

const STATUSES: readonly StatusClass[] = ['2xx', '3xx', '4xx', '5xx'];
const FLAGS: readonly (readonly [PageFlagFilter, 'orphan' | 'editorialOrphan' | 'deepOnlyThroughAuto' | 'placementUnknown' | 'hasBrokenOutlinks'])[] = [
  ['orphan', 'orphan'],
  ['editorial_orphan', 'editorialOrphan'],
  ['deep_only_through_auto', 'deepOnlyThroughAuto'],
  ['placement_unknown', 'placementUnknown'],
  ['has_broken_outlinks', 'hasBrokenOutlinks'],
];

/** The Pages filter bar (spec 7.2): tier, tag, status, indexable and flags. URL keys `tier`, `tag`, `status`, `idx`, `flag`. */
export function pageFilterFields(
  t: LinksTranslate,
  tiers: readonly PageTier[],
  tags: readonly { termId: string; name: string }[],
  tagsLoading: boolean,
): FilterField[] {
  return [
    {
      id: 'tier',
      kind: 'enum',
      multi: true,
      label: t('filters.tier'),
      options: [...tiers.map((tier) => ({ value: tier.tier_id, label: tier.label })), { value: 'none', label: t('filters.untiered') }],
      optionsLoading: tiers.length === 0,
    },
    {
      id: 'tag',
      kind: 'enum',
      multi: true,
      label: t('filters.tag'),
      options: tags.map((tag) => ({ value: tag.termId, label: tag.name })),
      optionsLoading: tagsLoading,
    },
    { id: 'status', kind: 'enum', multi: true, label: t('filters.status'), options: STATUSES.map((value) => ({ value, label: value })) },
    {
      id: 'idx',
      kind: 'enum',
      multi: false,
      label: t('filters.indexable'),
      options: [
        { value: 'yes', label: t('filters.yes') },
        { value: 'no', label: t('filters.no') },
      ],
    },
    {
      id: 'flag',
      kind: 'enum',
      multi: true,
      label: t('filters.flag'),
      options: FLAGS.map(([value, key]) => ({ value, label: t(`flags.${key}`) })),
    },
  ];
}

/** The pages read for the address and the filter bar; `cursor` and `limit` come from the table's pager. */
export function pageQueryOf(state: LinksState, values: FilterValues, cursor: string | null, limit: number): PageQuery {
  const idx = enumValuesOf(values.idx)[0];
  return {
    scope: state.scope,
    tierIds: enumValuesOf(values.tier),
    tagIds: enumValuesOf(values.tag),
    status: enumValuesOf(values.status).filter((value): value is StatusClass => STATUSES.includes(value as StatusClass)),
    indexable: idx === 'yes' ? true : idx === 'no' ? false : null,
    flags: enumValuesOf(values.flag).filter((value): value is PageFlagFilter => FLAGS.some(([flag]) => flag === value)),
    worklist: state.worklist,
    q: state.q,
    sort: state.sort,
    cursor,
    limit,
  };
}
```

`apps/web/src/features/internal-links/pages/cursor-paging.ts`:

```ts
'use client';

import { useCallback, useState } from 'react';

import type { PageSize } from '@/components/app/data-table/types';

/** The rows of the page shown as the pager names them: "Showing 201 to 217". */
export function pageRange({ pageIndex, rows, limit }: { pageIndex: number; rows: number; limit: number }): {
  from: number;
  to: number;
  offset: number;
} {
  const offset = pageIndex * limit;
  return rows === 0 ? { from: 0, to: 0, offset: 0 } : { from: offset + 1, to: offset + rows, offset };
}

/**
 * Previous and Next over a cursor-paged list (decision W6): the cursors of the pages seen are a stack, so Previous
 * returns to the cursor before. A new query (`resetKey`) starts again at the first page.
 */
interface PagingState {
  key: string;
  cursors: (string | null)[];
  size: PageSize;
}

/** The state for `key`: itself, or the first page of a new query with the same page size. */
const freshFor = (state: PagingState, key: string): PagingState =>
  state.key === key ? state : { key, cursors: [null], size: state.size };

export function useCursorPaging(resetKey: string) {
  const [state, setState] = useState<PagingState>({ key: resetKey, cursors: [null], size: 100 });
  const current = freshFor(state, resetKey);
  const next = useCallback(
    (cursor: string) =>
      setState((before) => {
        const base = freshFor(before, resetKey);
        return { ...base, cursors: [...base.cursors, cursor] };
      }),
    [resetKey],
  );
  const previous = useCallback(
    () =>
      setState((before) => {
        const base = freshFor(before, resetKey);
        return { ...base, cursors: base.cursors.slice(0, -1) };
      }),
    [resetKey],
  );
  const setSize = useCallback((size: PageSize) => setState({ key: resetKey, cursors: [null], size }), [resetKey]);
  return {
    cursor: current.cursors.at(-1) ?? null,
    pageIndex: current.cursors.length - 1,
    size: current.size,
    next,
    previous,
    setSize,
  };
}
```

`apps/web/src/features/internal-links/scope-menu.tsx`:

```tsx
'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Menu } from '@/components/ui/menu';
import { LINK_SCOPES, SCOPE_KEY, type LinkScope } from '@/lib/internal-links/scopes';

/** The link scope chip of every tab (spec 7.2: one chip, Editorial by default; mock "Links: Editorial"). */
export function ScopeMenu({ scope, onChange }: { scope: LinkScope; onChange: (scope: LinkScope) => void }): ReactElement {
  const t = useTranslations('internalLinks.scope');
  return (
    <Menu
      trigger={
        <Button variant="secondary" size="sm" aria-label={t('menuName', { scope: t(SCOPE_KEY[scope]) })}>
          {t('chip', { scope: t(SCOPE_KEY[scope]) })}
          <Icon icon={ChevronDown} size="sm" className="text-foreground-tertiary" />
        </Button>
      }
      items={LINK_SCOPES.map((value) => ({
        id: value,
        kind: 'radio' as const,
        label: t(SCOPE_KEY[value]),
        checked: value === scope,
        onSelect: () => onChange(value),
      }))}
    />
  );
}
```

- [ ] **Step 5: Run the pure tests and see them pass**

```bash
pnpm vitest run src/features/internal-links/pages/page-filters.test.ts src/features/internal-links/pages/cursor-paging.test.ts
```

Expected: PASS.

- [ ] **Step 6: Write the columns and the worklist chips**

`apps/web/src/features/internal-links/pages/page-columns.tsx`:

```tsx
'use client';

import { Workflow } from 'lucide-react';
import type { ReactNode } from 'react';

import { ShareBarCell } from '@/components/app/chart/stacked-share-bar';
import { col } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Badge } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/icon-button';
import { formatInteger } from '@/lib/format';
import { pageFlags } from '@/lib/internal-links/page-flags';
import type { LinkScope } from '@/lib/internal-links/scopes';
import { tierPosition } from '@/lib/internal-links/tiers';
import type { PageRow, PageSort, PageTier } from '@/lib/internal-links/types';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';
import type { LinksTranslate } from '../tabs';

/** Column id to the API's sort field (decision W5); the Tier column does not sort (gap G1). */
export const SORT_FIELD: Readonly<Record<string, string>> = {
  page: 'path',
  status: 'status_code',
  depth: 'click_depth',
  linking: 'linking_pages',
  outlinks: 'outlinks',
};

export const sortOfKeys = (keys: readonly { id: string; desc: boolean }[]): PageSort | null => {
  const [first] = keys;
  const field = first === undefined ? undefined : SORT_FIELD[first.id];
  if (first === undefined || field === undefined) return null;
  return `${first.desc ? '-' : ''}${field}` as PageSort;
};

export const keysOfSort = (sort: PageSort): { id: string; desc: boolean }[] => {
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  const id = Object.entries(SORT_FIELD).find(([, value]) => value === field)?.[0];
  return id === undefined ? [] : [{ id, desc }];
};

type Column = DataTableColumn<PageRow>;

/** A column whose cell this screen draws (a tier badge, a bar, flags), with the type's width rules. */
const custom = (
  id: string,
  type: Column['type'],
  header: string,
  cell: (row: PageRow) => ReactNode,
  extra: Partial<Column> = {},
): Column => ({ id, type, header, cell, priority: 1, defaultVisible: true, ...extra });

/**
 * The Pages columns of spec 7.2 and the mock (`il-pages.js` `COLUMNS`), without equity (decision W4): Page (path,
 * title below, Open in journey), Tier, Status, Depth, Linking pages, Linked from tiers, Outlinks and Flags by
 * default; the chooser holds tags, indexability reason, in sitemap, outlinks to T1, broken outlinks, links to
 * redirects, links to non-indexable pages and the top anchor.
 */
export function pageColumns(
  t: LinksTranslate,
  { tiers, scope, openJourney }: { tiers: readonly PageTier[]; scope: LinkScope; openJourney: (urlId: string) => void },
): Column[] {
  const segments = [
    ...tiers.map((tier) => ({ id: tier.tier_id, name: tier.label, color: `tier-${String(tier.position)}` as `tier-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}` })),
    { id: 'none', name: t('filters.untiered'), color: 'tier-none' as const },
  ];
  return [
    col.keyword<PageRow>('page', (row) => row.path, {
      header: t('columns.page'),
      detail: (row) => row.title ?? undefined,
      trailing: (row) => (
        <IconButton
          {...CELL_CONTROL}
          icon={Workflow}
          size="icon-xs"
          label={t('pages.openJourney', { path: row.path })}
          onClick={(event) => {
            event.stopPropagation();
            openJourney(row.url_id);
          }}
        />
      ),
    }),
    custom('tier', 'badge', t('columns.tier'), (row) => <TierBadge tier={row.tier} />, { width: 96 }),
    custom(
      'status',
      'status',
      t('columns.status'),
      (row) =>
        row.status_code === 200 ? (
          <span className="type-table num text-foreground-secondary">200</span>
        ) : (
          <Badge tone={(row.status_code ?? 0) >= 400 ? 'negative' : 'warning'}>{String(row.status_code ?? '')}</Badge>
        ),
      { width: 96, sortValue: (row) => row.status_code },
    ),
    custom(
      'depth',
      'count',
      t('columns.depth'),
      (row) =>
        row.click_depth === null ? (
          <span className="type-table text-foreground-tertiary">{t('columns.notReachable')}</span>
        ) : (
          <span className="type-table num">{formatInteger(row.click_depth)}</span>
        ),
      { headerTooltip: t('columns.depthTip'), width: 120, sortValue: (row) => row.click_depth },
    ),
    col.count<PageRow>('linking', (row) => row.linking_pages, { header: t('columns.linking'), headerTooltip: t('columns.linkingTip'), width: 120 }),
    custom(
      'fromTiers',
      'text',
      t('columns.fromTiers'),
      (row) => {
        const total = row.linked_from_tiers.reduce((sum, entry) => sum + entry.pages, 0);
        if (total === 0) return <span className="type-table text-foreground-tertiary">{t('columns.none')}</span>;
        const sorted = [...row.linked_from_tiers].sort((a, b) => tierPosition(a.tier) - tierPosition(b.tier));
        const list = sorted.map((entry) => t('columns.fromTiersItem', { tier: entry.tier?.code ?? t('filters.untiered'), count: entry.pages })).join(', ');
        const cells = sorted.map((entry) => ({
          segmentId: entry.tier?.tier_id ?? 'none',
          share: entry.pages / total,
          shareText: formatInteger(entry.pages),
          countText: formatInteger(entry.pages),
        }));
        return (
          <ShareBarCell
            label={t('columns.fromTiersName', { list })}
            segments={segments}
            cells={cells}
            denominatorText={t('columns.fromTiersOf', { count: total })}
          />
        );
      },
      { headerTooltip: t('columns.fromTiersTip'), width: 128 },
    ),
    col.count<PageRow>('outlinks', (row) => row.outlinks, { header: t('columns.outlinks'), headerTooltip: t('columns.outlinksTip'), width: 96 }),
    custom(
      'flags',
      'text',
      t('columns.flags'),
      (row) => {
        const flags = pageFlags(row, scope);
        if (flags.length === 0) return <span className="type-table text-foreground-tertiary">{t('columns.none')}</span>;
        return (
          <span className="flex flex-wrap items-center gap-1 py-1">
            {flags.slice(0, 2).map((flag) => (
              <Badge key={flag.key} tone={flag.tone}>
                {t(`flags.${flag.key}`)}
              </Badge>
            ))}
            {flags.length > 2 ? (
              <span className="type-label num text-foreground-tertiary" title={flags.slice(2).map((flag) => t(`flags.${flag.key}`)).join(', ')}>
                {t('columns.more', { count: flags.length - 2 })}
              </span>
            ) : null}
          </span>
        );
      },
      { width: 240 },
    ),
    col.text<PageRow>('tags', (row) => (row.tags.length === 0 ? null : row.tags.map((tag) => tag.name).join(', ')), {
      header: t('columns.tags'),
      defaultVisible: false,
      unknown: () => ({ label: t('columns.none') }),
    }),
    col.text<PageRow>('reason', (row) => row.non_indexable_reason ?? (row.is_indexable ? t('columns.indexableValue') : null), {
      header: t('columns.reason'),
      defaultVisible: false,
    }),
    col.text<PageRow>('sitemap', (row) => (row.in_sitemap ? t('columns.yes') : t('columns.no')), { header: t('columns.sitemap'), defaultVisible: false }),
    col.count<PageRow>('toT1', (row) => row.outlinks_to_t1, { header: t('columns.toT1'), defaultVisible: false, sortable: false }),
    col.count<PageRow>('broken', (row) => row.broken_outlinks, { header: t('columns.broken'), defaultVisible: false, sortable: false }),
    col.count<PageRow>('redirects', (row) => row.redirect_outlinks, { header: t('columns.redirects'), defaultVisible: false, sortable: false }),
    col.count<PageRow>('nonIndexable', (row) => row.non_indexable_outlinks, { header: t('columns.nonIndexable'), defaultVisible: false, sortable: false }),
    col.text<PageRow>('topAnchor', (row) => (row.top_anchor === null ? null : t('columns.anchor', { anchor: row.top_anchor })), {
      header: t('columns.topAnchor'),
      defaultVisible: false,
    }),
  ].map((column) => (SORT_FIELD[column.id] === undefined ? { ...column, sortValue: undefined } : column));
}
```

`col.text`'s `unknown` option takes a function returning `{ label }` (`UnknownValue` in `columns.tsx`). Only the five columns of `SORT_FIELD` sort: the server sorts, so a column without a server field must not offer it.

`apps/web/src/features/internal-links/pages/worklist-chips.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { formatInteger } from '@/lib/format';
import { worklistsQuery } from '@/lib/internal-links/queries';
import type { EdgeWorklist, LinksScope, PageWorklist, Worklists } from '@/lib/internal-links/types';
import { cn } from '@/lib/utils';

const PAGE_LISTS: readonly (readonly [PageWorklist, 'underLinkedT1' | 'orphans' | 'editorialOrphans' | 'deepOnlyThroughAuto'])[] = [
  ['under_linked_t1', 'underLinkedT1'],
  ['orphans', 'orphans'],
  ['editorial_orphans', 'editorialOrphans'],
  ['deep_only_through_auto', 'deepOnlyThroughAuto'],
];
const EDGE_LISTS: readonly (readonly [EdgeWorklist, 'brokenAndRedirected' | 'linksToNonIndexable'])[] = [
  ['broken_and_redirected', 'brokenAndRedirected'],
  ['links_to_non_indexable', 'linksToNonIndexable'],
];
const CHIP =
  'inline-flex h-control-sm items-center gap-1.5 rounded-md border px-2 type-body whitespace-nowrap focus-visible:focus-ring';
const OFF = 'border-border bg-surface text-foreground hover:bg-surface-hover';
const ON = 'border-primary-border bg-primary-subtle text-primary-text';

/**
 * The saved worklists of spec 7.2 as the mock's issue chips: All pages, the four page worklists with their counts,
 * and the two link worklists, which count links and open the Links tab (decision W17, gap G2).
 */
export function WorklistChips({
  scope,
  current,
  onPick,
  onPickEdges,
}: {
  scope: LinksScope;
  current: PageWorklist | null;
  onPick: (worklist: PageWorklist | null) => void;
  onPickEdges: (worklist: EdgeWorklist) => void;
}): ReactElement {
  const t = useTranslations('internalLinks');
  const read = useQuery(worklistsQuery(scope));
  const counts: Worklists | undefined = read.data?.data;
  const count = (value: number | undefined): string => (value === undefined ? '' : formatInteger(value));
  return (
    <div role="group" aria-label={t('pages.worklistsLabel')} className="flex flex-wrap items-center gap-2">
      <button type="button" aria-pressed={current === null} className={cn(CHIP, current === null ? ON : OFF)} onClick={() => onPick(null)}>
        {t('pages.allPages')}
      </button>
      {PAGE_LISTS.map(([id, key]) => (
        <button key={id} type="button" aria-pressed={current === id} className={cn(CHIP, current === id ? ON : OFF)} onClick={() => onPick(id)}>
          {t(`worklists.${key}`)}{' '}
          <span className="num type-body-strong">{count(counts?.[id])}</span>
        </button>
      ))}
      {EDGE_LISTS.map(([id, key]) => (
        <button key={id} type="button" aria-pressed={false} className={cn(CHIP, OFF)} onClick={() => onPickEdges(id)}>
          {t(`worklists.${key}`)}{' '}
          <span className="num type-body-strong">{counts === undefined ? '' : t('pages.linkCount', { count: counts[id] })}</span>
        </button>
      ))}
      {counts !== undefined && [...PAGE_LISTS, ...EDGE_LISTS].every(([id]) => counts[id] === 0) ? (
        <span className="type-meta text-foreground-tertiary">{t('pages.noIssues')}</span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 7: Write the failing Pages tab test**

`apps/web/src/features/internal-links/pages/pages-tab.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { axe } from '@/test/axe';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => document.documentElement.classList.remove('dark'));
const table = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Pages' });

describe('the Pages tab (spec 7.2)', () => {
  it('lists the pages with the slice 1 columns and never an equity column', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const grid = await table();
    for (const name of ['Page', 'Tier', 'Status', 'Depth', 'Linking pages', 'Linked from tiers', 'Outlinks', 'Flags']) {
      expect(within(grid).getByRole('columnheader', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    expect(within(grid).queryByRole('columnheader', { name: /equity/i })).toBeNull();
    expect(await within(grid).findByRole('rowheader', { name: /^\/pricing/ })).toBeInTheDocument();
  });

  it('narrows to a worklist from its chip and back to all pages', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    const grid = await table();
    await user.click(await screen.findByRole('button', { name: /^Orphans 1$/ }));
    expect(await within(grid).findByRole('rowheader', { name: /^\/partners/ })).toBeInTheDocument();
    expect(within(grid).queryByRole('rowheader', { name: /^\/pricing/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'All pages' }));
    expect(await within(grid).findByRole('rowheader', { name: /^\/pricing/ })).toBeInTheDocument();
  });

  it('changes every link count with the scope chip', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'q=%2Fpricing' });
    const grid = await table();
    const row = await within(grid).findByRole('row', { name: /^\/pricing/ });
    expect(row).toHaveTextContent(/T1.*200/);
    await user.click(screen.getByRole('button', { name: 'Link scope: Editorial' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'All links' }));
    expect(await screen.findByRole('button', { name: 'Link scope: All links' })).toBeInTheDocument();
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await within(await table()).findByRole('rowheader', { name: /^\/pricing/ });
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

(`/partners` is the fixture's one orphan: in the sitemap, linked by no page.)

- [ ] **Step 8: Write the tab and register it**

`apps/web/src/features/internal-links/pages/pages-tab.tsx`:

```tsx
'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { parseAsString, useQueryStates } from 'nuqs';
import { useEffect, useMemo, type ReactElement } from 'react';

import { useCursorPaging, pageRange } from './cursor-paging';
import { keysOfSort, pageColumns, sortOfKeys } from './page-columns';
import { pageFilterFields, pageQueryOf } from './page-filters';
import { WorklistChips } from './worklist-chips';
import { ScopeMenu } from '../scope-menu';
import type { LinksTabContext } from '../tabs';
import { DataTable } from '@/components/app/data-table/data-table';
import type { DataTableProps } from '@/components/app/data-table/types';
import { FilterBar } from '@/components/app/filters/filter-bar';
import { useUrlFilters } from '@/components/app/filters/use-url-filters';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { downloadApiFile, type DownloadQuery } from '@/lib/api/download';
import { formatInteger } from '@/lib/format';
import { useVocabularies } from '@/lib/keywords/taxonomy-reads';
import { pageParams, pagesPath, pagesQuery } from '@/lib/internal-links/queries';
import type { EdgeWorklist, PageRow, PageWorklist } from '@/lib/internal-links/types';
import { formatColumns, parseColumns, parseDensity } from '@/lib/tables/table-state';

const TABLE_KEYS = { density: parseAsString, cols: parseAsString };
/** One empty list for every render, so the table does not see new rows while nothing has loaded. */
const NO_ROWS: readonly PageRow[] = [];
const REQUIRED_COLUMNS = ['page'];
const EMPTY_KEY: Readonly<Record<PageWorklist, 'underLinkedT1' | 'orphans' | 'editorialOrphans' | 'deepOnlyThroughAuto'>> = {
  under_linked_t1: 'underLinkedT1',
  orphans: 'orphans',
  editorial_orphans: 'editorialOrphans',
  deep_only_through_auto: 'deepOnlyThroughAuto',
};

/** The Pages tab (spec 7.2, mock `il-pages.js`): worklist chips, the filter bar, the scope chip and the table. */
export function PagesTab({ context }: { context: LinksTabContext }): ReactElement {
  const t = useTranslations('internalLinks');
  const common = useTranslations('common');
  const { scope, state, setSearch, tiers } = context;
  const vocabularies = useVocabularies(scope);
  const tags = useMemo(
    () =>
      vocabularies.loaded
        .filter((entry) => entry.vocabulary.kind === 'tag')
        .flatMap((entry) => entry.terms.map((term) => ({ termId: term.termId, name: term.path }))),
    [vocabularies.loaded],
  );
  const fields = useMemo(() => pageFilterFields(t, tiers, tags, vocabularies.pending), [t, tiers, tags, vocabularies.pending]);
  const [values, setValues] = useUrlFilters(fields);
  const filtersKey = JSON.stringify([state.scope, state.worklist, state.sort, state.q, values]);
  const paging = useCursorPaging(filtersKey);
  const query = pageQueryOf(state, values, paging.cursor, paging.size);
  const read = useQuery({ ...pagesQuery(scope, query), placeholderData: keepPreviousData });
  const rows = read.data?.data ?? NO_ROWS;
  const total = read.data?.meta.total ?? null;

  const [table, setTable] = useQueryStates(TABLE_KEYS, { history: 'replace' });
  const columns = useMemo(
    () => pageColumns(t, { tiers, scope: state.scope, openJourney: context.openJourney }),
    [t, tiers, state.scope, context.openJourney],
  );
  const known = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);

  // The tab's Export downloads the same query as CSV from the API (decision W13)
  const { registerExport } = context;
  // The query as text, so the effect runs when the query changes and not on every render
  const csvParams = JSON.stringify({ ...pageParams({ ...query, cursor: null }), limit: undefined });
  useEffect(() => {
    const wanted = JSON.parse(csvParams) as DownloadQuery;
    registerExport(() => downloadApiFile(pagesPath(scope), { ...wanted, format: 'csv' }, 'internal-links-pages.csv'));
    return () => registerExport(null);
  }, [registerExport, csvParams, scope]);

  const range = pageRange({ pageIndex: paging.pageIndex, rows: rows.length, limit: paging.size });
  const filtered = Object.keys(values).length > 0 || state.q !== null || state.worklist !== null;
  const clear = (): void => {
    setValues({});
    setSearch({ q: null, view: null });
  };
  const status: DataTableProps<PageRow>['status'] = read.isError && read.data === undefined
    ? 'error'
    : read.isPending
      ? 'loading'
      : read.isFetching
        ? 'refetching'
        : rows.length === 0
          ? filtered
            ? 'filtered-empty'
            : 'empty'
          : 'ready';
  const worklistEmpty = state.worklist === null ? null : EMPTY_KEY[state.worklist];
  const openEdgeWorklist = (worklist: EdgeWorklist): void => setSearch({ tab: 'links', lview: worklist, scope: null }, { history: 'push' });
  const openRow = (row: PageRow, intent: 'inspector' | 'new-tab'): void => {
    if (intent === 'inspector') {
      context.inspect.open(row.url_id);
      return;
    }
    const next = new URLSearchParams(window.location.search);
    next.set('inspect', `page:${row.url_id}`);
    window.open(`${window.location.pathname}?${next.toString()}`, '_blank', 'noopener');
  };

  return (
    <div className="flex flex-col gap-3">
      <WorklistChips
        scope={scope}
        current={state.worklist}
        onPick={(worklist) => setSearch({ view: worklist })}
        onPickEdges={openEdgeWorklist}
      />
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar fields={fields} values={values} onChange={setValues} />
        <ScopeMenu scope={state.scope} onChange={(next) => setSearch({ scope: next === 'editorial' ? null : next })} />
      </div>
      <DataTable<PageRow>
        caption={t('pages.caption')}
        itemNoun={{ one: t('pages.one'), other: t('pages.other') }}
        columns={columns}
        getRowId={(row) => row.url_id}
        rows={rows}
        total={total}
        server={{
          rangeText: t('pages.range', { from: formatInteger(range.from), to: formatInteger(range.to), total: formatInteger(total ?? 0) }),
          offset: range.offset,
          hasPrevious: paging.pageIndex > 0,
          hasNext: read.data?.page.has_more ?? false,
          onPrevious: paging.previous,
          onNext: () => {
            const next = read.data?.page.next_cursor;
            if (next !== null && next !== undefined) paging.next(next);
          },
          pageSize: paging.size,
          onPageSizeChange: paging.setSize,
          pageSizes: [100, 200],
        }}
        sort={keysOfSort(state.sort)}
        onSortChange={(keys) => setSearch({ sort: sortOfKeys(keys) ?? null })}
        defaultSort={keysOfSort('-linking_pages')}
        density={parseDensity(table.density)}
        onDensityChange={(density) => void setTable({ density: density === 'compact' ? null : density })}
        columnState={{
          visible: parseColumns(table.cols, known, REQUIRED_COLUMNS),
          onChange: (visible) => void setTable({ cols: visible === null ? null : formatColumns(visible) }),
        }}
        search={state.q ?? ''}
        onSearchChange={(q) => setSearch({ q: q.trim() === '' ? null : q })}
        searchPlaceholder={t('pages.search')}
        rowName={(row) => row.path}
        onRowOpen={openRow}
        activeRowId={context.inspect.urlId}
        onRowOrderChange={context.inspect.setOrder}
        status={status}
        errorState={
          <InlineError
            title={t('pages.loadFailed')}
            reason={t('pages.loadFailedReason')}
            errorId={null}
            onRetry={() => void read.refetch()}
            retrying={read.isFetching}
            retryLabel={common('retry')}
          />
        }
        emptyState={<EmptyState title={t('pages.emptyTitle')} reason={t('pages.emptyReason')} headingLevel={3} />}
        filteredEmptyState={
          worklistEmpty !== null && Object.keys(values).length === 0 && state.q === null ? (
            <EmptyState
              title={t(`worklistEmpty.${worklistEmpty}Title`)}
              reason={t(`worklistEmpty.${worklistEmpty}Reason`)}
              headingLevel={3}
              primaryAction={
                <Button variant="secondary" size="sm" onClick={() => setSearch({ view: null })}>
                  {t('pages.showAll')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              title={t('pages.noMatchTitle')}
              reason={t('pages.noMatchReason')}
              headingLevel={3}
              primaryAction={
                <Button variant="secondary" size="sm" onClick={clear}>
                  {t('pages.clearFilters')}
                </Button>
              }
            />
          )
        }
      />
    </div>
  );
}
```

In `apps/web/src/features/internal-links/tabs.ts`, add the entry (and the imports `createElement` from `react` and `PagesTab` from `./pages/pages-tab`):

```ts
export const LINKS_TABS: readonly LinksTabEntry[] = defineLinksTabs([
  { id: 'pages', label: (t) => t('tabs.pages'), render: (context) => createElement(PagesTab, { context }) },
]);
```

- [ ] **Step 9: Run the tests and see them pass**

```bash
pnpm vitest run src/features/internal-links/
```

Expected: PASS. The Orphans chip reads "Orphans 1" (`/partners`).

- [ ] **Step 10: Run the gate and commit**

```bash
git add apps/web/src/features/internal-links/ apps/web/messages/en.json
git commit -m "Internal links: Pages tab with worklists, scope, filters, paging and export"
```

---

### Task 8: Bulk tiers and tags, select all matching, and keys 1 to 8 and 0

**Files:**
- Create: `apps/web/src/features/internal-links/pages/use-page-bulk.ts`, `bulk-tier-dialog.tsx`, `bulk-tag-dialog.tsx`, `tier-keys.tsx`, `bulk.test.tsx`
- Modify: `apps/web/src/features/internal-links/pages/pages-tab.tsx`, `apps/web/messages/en.json`, `docs/design-system/20-accessibility.md`

Mock: `il-pages.js` `bulkBar` and `allMatchingNote`, screenshot `03-bulk.png`. The house `BulkActionBar` replaces the toolbar while rows are selected and already offers "Select all N matching" (12-tables.md section 14); its actions are buttons, so Set tier and the tag changes open a small dialog instead of the mock's popover, and keys 1 to 8 and 0 set a tier at once.

- [ ] **Step 1: Add the messages**

```json
  "internalLinks": {
    "bulk": {
      "setTier": "Set tier",
      "setTierTitle": "Set the tier of {count, plural, one {# page} other {# pages}}",
      "tierLegend": "Tier",
      "untiered": "Untiered",
      "resetToRule": "Reset to rule",
      "resetToRuleHint": "Pages go back to the tier their rule gives.",
      "apply": "Apply",
      "tierSet": "Tier set",
      "tierSetText": "{count, plural, one {# page is} other {# pages are}} now {tier}.",
      "resetDone": "Tier reset",
      "resetDoneText": "{count, plural, one {# page went} other {# pages went}} back to the tier their rule gives.",
      "addTag": "Add tag",
      "removeTag": "Remove tag",
      "addTagTitle": "Add a tag to {count, plural, one {# page} other {# pages}}",
      "removeTagTitle": "Remove a tag from {count, plural, one {# page} other {# pages}}",
      "tag": "Tag",
      "tagPlaceholder": "Choose a tag",
      "noTags": "This project has no tag vocabulary yet. Add one in Settings under Taxonomy.",
      "noTagsLink": "Open Taxonomy",
      "tagAdded": "Tag added",
      "tagAddedText": "{tag} added to {count, plural, one {# page} other {# pages}}.",
      "tagRemoved": "Tag removed",
      "tagRemovedText": "{tag} removed from {count, plural, one {# page} other {# pages}}.",
      "openJourney": "Open in journey",
      "openJourneyOne": "Select one page to open its journey",
      "export": "Export",
      "tooMany": "At most 20,000 pages change at once. Narrow the filter first.",
      "failed": "The change could not be saved",
      "keysTier": "Set the tier of the selected pages, 1 for T1 to 8 for T8",
      "keysUntiered": "Set the selected pages to Untiered"
    }
  },
```

- [ ] **Step 2: Write the failing bulk test**

`apps/web/src/features/internal-links/pages/bulk.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

const rowOf = async (path: string): Promise<HTMLElement> =>
  within(await screen.findByRole('grid', { name: 'Pages' })).findByRole('row', { name: new RegExp(`^${path.replaceAll('/', '\\/')} `) });

describe('bulk tiers (spec 5.2)', () => {
  it('sets a tier on the selection from the bulk bar', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(within(await rowOf('/about')).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Set tier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set the tier of 1 page' });
    await user.click(within(dialog).getByRole('radio', { name: 'T3 Content pages' }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('1 page is now T3 Content pages.')).toBeInTheDocument();
    await waitFor(async () => expect(within(await rowOf('/about')).getByText('T3')).toBeInTheDocument());
  });

  it('sets a tier with keys 1 to 8 and Untiered with 0 while rows are selected', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await user.click(within(await rowOf('/about')).getByRole('checkbox'));
    // Keys belong to the page, not to the focused checkbox: move focus off the grid first
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('2');
    expect(await screen.findByText('1 page is now T2 Supporting pages.')).toBeInTheDocument();
    await user.click(within(await rowOf('/about')).getByRole('checkbox'));
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('0');
    expect(await screen.findByText('1 page is now Untiered.')).toBeInTheDocument();
  });

  it('offers no tier change to a viewer', async () => {
    renderWithProviders(internalLinksAs('viewer', EVENTUS_LINKS), { searchParams: 'q=%2Fabout' });
    await rowOf('/about');
    expect(screen.queryByRole('checkbox', { name: 'Select /about' })).toBeNull();
  });
});
```

- [ ] **Step 3: Run it and see it fail**

```bash
cd apps/web && pnpm vitest run src/features/internal-links/pages/bulk.test.tsx
```

Expected: FAIL, no checkbox in the row (the table has no selection yet).

- [ ] **Step 4: Write the bulk writes, the dialogs and the keys**

`apps/web/src/features/internal-links/pages/use-page-bulk.ts`:

```ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { changeTagsMutation, resetTiersMutation, setTiersMutation } from '@/lib/internal-links/mutations';
import { checkUrlId, internalLinksKeys, pageFilterOf, type PageQuery } from '@/lib/internal-links/queries';
import type { LinksScope, PageTier } from '@/lib/internal-links/types';

/** What a bulk action applies to: the chosen ids, or every page the filters match (spec 5.2 "Select all N matching"). */
export interface BulkTarget {
  ids: readonly string[];
  allMatching: boolean;
  /** The pages it names, for the toasts. */
  count: number;
}

/**
 * The bulk writes of the Pages tab: set a tier (or Untiered), reset to the rule, add or remove a tag. A tier change
 * needs no crawl (spec 6.6); every read of the project's internal links is read again after it.
 */
export function usePageBulk(scope: LinksScope, query: PageQuery, done: () => void) {
  const t = useTranslations('internalLinks.bulk');
  const queryClient = useQueryClient();
  const setTiers = useMutation(setTiersMutation);
  const reset = useMutation(resetTiersMutation);
  const tags = useMutation(changeTagsMutation);
  const path = { workspace_id: scope.workspaceId, project_id: scope.projectId };
  const selection = (target: BulkTarget) =>
    target.allMatching ? { filter: pageFilterOf(query) } : { url_ids: target.ids.map(checkUrlId) };
  const after = (title: string, description: string): void => {
    toast({ type: 'success', title, description });
    for (const queryKey of internalLinksKeys(scope)) void queryClient.invalidateQueries({ queryKey });
    done();
  };
  const failed = (error: Error): void => {
    toast({ type: 'error', title: t('failed'), ...(isApiProblem(error, 'too_many_subjects') ? { description: t('tooMany') } : {}) });
  };
  return {
    pending: setTiers.isPending || reset.isPending || tags.isPending,
    setTier: (target: BulkTarget, tier: PageTier | null): void =>
      setTiers.mutate(
        { params: { path }, body: { ...selection(target), tier_id: tier?.tier_id ?? null } },
        {
          onSuccess: (answer) =>
            after(t('tierSet'), t('tierSetText', { count: answer.data.matched, tier: tier?.label ?? t('untiered') })),
          onError: failed,
        },
      ),
    resetToRule: (target: BulkTarget): void =>
      reset.mutate(
        { params: { path }, body: selection(target) },
        { onSuccess: (answer) => after(t('resetDone'), t('resetDoneText', { count: answer.data.matched })), onError: failed },
      ),
    changeTag: (target: BulkTarget, tag: { termId: string; name: string }, add: boolean): void =>
      tags.mutate(
        { params: { path }, body: { ...selection(target), add: add ? [tag.termId] : [], remove: add ? [] : [tag.termId] } },
        {
          onSuccess: (answer) =>
            after(
              add ? t('tagAdded') : t('tagRemoved'),
              t(add ? 'tagAddedText' : 'tagRemovedText', { tag: tag.name, count: answer.data.matched }),
            ),
          onError: failed,
        },
      ),
  };
}
```

`apps/web/src/features/internal-links/pages/bulk-tier-dialog.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { RadioGroup } from '@/components/ui/radio-group';
import type { PageTier } from '@/lib/internal-links/types';

const RESET = 'reset';
const NONE = 'none';

/** Set tier for the selection (mock `bulkBar` "Set tier": each tier with its key, Untiered with 0, Reset to rule). */
export function BulkTierDialog({
  open,
  onOpenChange,
  count,
  tiers,
  pending,
  onSetTier,
  onReset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  tiers: readonly PageTier[];
  pending: boolean;
  onSetTier: (tier: PageTier | null) => void;
  onReset: () => void;
}): ReactElement {
  const t = useTranslations('internalLinks.bulk');
  const common = useTranslations('common');
  const [choice, setChoice] = useState<string | null>(null);
  const apply = (): void => {
    if (choice === RESET) onReset();
    else if (choice !== null) onSetTier(tiers.find((tier) => tier.tier_id === choice) ?? null);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <DialogHeader title={t('setTierTitle', { count })} closeLabel={common('close')} />
      <DialogBody>
        <RadioGroup
          legend={t('tierLegend')}
          value={choice}
          onValueChange={setChoice}
          options={[
            ...tiers.map((tier) => ({ value: tier.tier_id, label: tier.label, description: tier.description || undefined })),
            { value: NONE, label: t('untiered') },
            { value: RESET, label: t('resetToRule'), description: t('resetToRuleHint') },
          ]}
        />
      </DialogBody>
      <DialogFooter
        primary={
          <Button variant="primary" disabled={choice === null} loading={pending} onClick={apply}>
            {t('apply')}
          </Button>
        }
        secondary={
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {common('cancel')}
          </Button>
        }
      />
    </Dialog>
  );
}
```

`apps/web/src/features/internal-links/pages/bulk-tag-dialog.tsx`:

```tsx
'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Select } from '@/components/ui/select';

/** Add or remove one tag of the project's or workspace's `tag` vocabularies (spec 5.3). */
export function BulkTagDialog({
  mode,
  onClose,
  count,
  tags,
  taxonomyHref,
  pending,
  onApply,
}: {
  mode: 'add' | 'remove' | null;
  onClose: () => void;
  count: number;
  tags: readonly { termId: string; name: string }[];
  taxonomyHref: Route;
  pending: boolean;
  onApply: (tag: { termId: string; name: string }, add: boolean) => void;
}): ReactElement {
  const t = useTranslations('internalLinks.bulk');
  const common = useTranslations('common');
  const [termId, setTermId] = useState<string | null>(null);
  const tag = tags.find((candidate) => candidate.termId === termId) ?? null;
  return (
    <Dialog open={mode !== null} onOpenChange={(next) => (next ? undefined : onClose())} size="sm">
      <DialogHeader title={t(mode === 'remove' ? 'removeTagTitle' : 'addTagTitle', { count })} closeLabel={common('close')} />
      <DialogBody>
        {tags.length === 0 ? (
          <p className="type-body text-foreground-secondary">
            {t('noTags')}{' '}
            <Link href={taxonomyHref} className="text-link underline-offset-2 hover:underline">
              {t('noTagsLink')}
            </Link>
          </p>
        ) : (
          <Field>
            <FieldLabel>{t('tag')}</FieldLabel>
            <Select
              value={termId}
              onValueChange={setTermId}
              placeholder={t('tagPlaceholder')}
              options={tags.map((candidate) => ({ value: candidate.termId, label: candidate.name }))}
            />
          </Field>
        )}
      </DialogBody>
      <DialogFooter
        primary={
          <Button variant="primary" disabled={tag === null} loading={pending} onClick={() => tag !== null && onApply(tag, mode !== 'remove')}>
            {t('apply')}
          </Button>
        }
        secondary={
          <Button variant="secondary" onClick={onClose}>
            {common('cancel')}
          </Button>
        }
      />
    </Dialog>
  );
}
```

`apps/web/src/features/internal-links/pages/tier-keys.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { usePageShortcuts } from '@/components/app/shell/page-shortcuts';
import { useShortcut } from '@/lib/a11y/use-shortcut';
import type { PageTier } from '@/lib/internal-links/types';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8'] as const;

/** One key: a component per key, so each `useShortcut` is a hook of its own (decision W20). */
function TierKey({ digit, enabled, onPress }: { digit: string; enabled: boolean; onPress: () => void }): null {
  useShortcut(digit, onPress, { kind: 'single-key', enabled });
  return null;
}

/**
 * Keys 1 to 8 set the selection's tier and 0 clears it (spec 5.2), while rows are selected and the person may write.
 * They follow the single-key switch through `useShortcut` and are listed in the shortcuts dialog.
 */
export function TierKeys({
  tiers,
  enabled,
  onTier,
}: {
  tiers: readonly PageTier[];
  enabled: boolean;
  onTier: (tier: PageTier | null) => void;
}): ReactElement {
  const t = useTranslations('internalLinks.bulk');
  const entries = useMemo(
    () => [
      { id: 'internal-links-tier', label: t('keysTier'), keys: ['1', '8'] },
      { id: 'internal-links-untiered', label: t('keysUntiered'), keys: ['0'] },
    ],
    [t],
  );
  usePageShortcuts(entries);
  return (
    <>
      {DIGITS.map((digit) => {
        const tier = digit === '0' ? null : tiers[Number(digit) - 1];
        return (
          <TierKey
            key={digit}
            digit={digit}
            enabled={enabled && tier !== undefined}
            onPress={() => onTier(tier ?? null)}
          />
        );
      })}
    </>
  );
}
```

- [ ] **Step 5: Give the Pages table its selection and bulk actions**

In `apps/web/src/features/internal-links/pages/pages-tab.tsx`, add the imports:

```tsx
import { Download, Layers, Tag, Tags, Workflow } from 'lucide-react';
import { useState } from 'react';

import { BulkTagDialog } from './bulk-tag-dialog';
import { BulkTierDialog } from './bulk-tier-dialog';
import { TierKeys } from './tier-keys';
import { usePageBulk, type BulkTarget } from './use-page-bulk';
import type { RecordAction } from '@/components/app/data-table/types';
import { csvBlob, downloadBlob, safeText } from '@/lib/csv/csv-write';
import { useCan } from '@/lib/permissions';
```

(merge `useState` into the existing `react` import), and inside `PagesTab`, after the `useEffect` that registers the export (the export action reads its `csvParams`):

```tsx
  const bulkWords = useTranslations('internalLinks.bulk');
  const canWrite = useCan('projects:write');
  const [selected, setSelected] = useState<{ key: string; ids: ReadonlySet<string>; all: boolean }>({ key: filtersKey, ids: new Set(), all: false });
  // A new query starts with nothing selected
  const chosen = selected.key === filtersKey ? selected : { key: filtersKey, ids: new Set<string>(), all: false };
  const clearSelection = (): void => setSelected({ key: filtersKey, ids: new Set(), all: false });
  const bulk = usePageBulk(scope, query, clearSelection);
  const target: BulkTarget = { ids: [...chosen.ids], allMatching: chosen.all, count: chosen.all ? (total ?? 0) : chosen.ids.size };
  const [tierDialog, setTierDialog] = useState(false);
  const [tagDialog, setTagDialog] = useState<'add' | 'remove' | null>(null);
  const exportRows = (picked: readonly PageRow[]): void => {
    const header = ['URL', 'Title', 'Tier', 'Status', 'Depth', 'Linking pages', 'Outlinks'];
    const lines = picked.map((row) => [
      safeText(row.url),
      safeText(row.title ?? ''),
      row.tier === null ? t('filters.untiered') : safeText(`${row.tier.code} ${row.tier.name}`),
      row.status_code,
      row.click_depth,
      row.linking_pages,
      row.outlinks,
    ]);
    downloadBlob(csvBlob({ header, rows: lines }), 'internal-links-pages-selected.csv');
  };
  const bulkActions: RecordAction<PageRow>[] = [
    { id: 'set-tier', label: bulkWords('setTier'), icon: Layers, group: 'object', onSelect: () => setTierDialog(true) },
    { id: 'add-tag', label: bulkWords('addTag'), icon: Tag, group: 'object', onSelect: () => setTagDialog('add') },
    { id: 'remove-tag', label: bulkWords('removeTag'), icon: Tags, group: 'object', onSelect: () => setTagDialog('remove') },
    {
      id: 'open-journey',
      label: bulkWords('openJourney'),
      icon: Workflow,
      group: 'open',
      disabledReason: !chosen.all && chosen.ids.size === 1 ? null : bulkWords('openJourneyOne'),
      onSelect: (picked) => {
        const [first] = picked;
        if (first !== undefined) context.openJourney(first.url_id);
      },
    },
    {
      id: 'export',
      label: bulkWords('export'),
      icon: Download,
      group: 'copy',
      // Every matching row: the server's CSV of the query; else the loaded rows chosen
      onSelect: (picked, scopeOf) => {
        if (!scopeOf.allMatching) {
          exportRows(picked);
          return;
        }
        const wanted = JSON.parse(csvParams) as DownloadQuery;
        void downloadApiFile(pagesPath(scope), { ...wanted, format: 'csv' }, 'internal-links-pages.csv');
      },
    },
  ];
```

Pass the selection to the table (only for members who may write; a viewer gets no checkboxes):

```tsx
        selection={
          canWrite
            ? {
                selectedIds: chosen.ids,
                onChange: (ids) => setSelected({ key: filtersKey, ids, all: false }),
                matchingTotal: total,
                allMatching: chosen.all,
                onAllMatchingChange: (all) => setSelected({ ...chosen, key: filtersKey, all }),
              }
            : undefined
        }
        bulkActions={canWrite ? bulkActions : undefined}
```

and after the `DataTable`, inside the tab's root `div`:

```tsx
      <TierKeys tiers={tiers} enabled={canWrite && (chosen.all || chosen.ids.size > 0) && !bulk.pending} onTier={(tier) => bulk.setTier(target, tier)} />
      <BulkTierDialog
        open={tierDialog}
        onOpenChange={setTierDialog}
        count={target.count}
        tiers={tiers}
        pending={bulk.pending}
        onSetTier={(tier) => {
          setTierDialog(false);
          bulk.setTier(target, tier);
        }}
        onReset={() => {
          setTierDialog(false);
          bulk.resetToRule(target);
        }}
      />
      <BulkTagDialog
        mode={tagDialog}
        onClose={() => setTagDialog(null)}
        count={target.count}
        tags={tags}
        taxonomyHref={context.hrefOf('/settings/taxonomy')}
        pending={bulk.pending}
        onApply={(tag, add) => {
          setTagDialog(null);
          bulk.changeTag(target, tag, add);
        }}
      />
```

- [ ] **Step 6: List the keys in the accessibility spec**

In `docs/design-system/20-accessibility.md` section 14's table, after the `a, r, s, e` row:

```markdown
| `1` to `8`, `0` | Internal links, Pages tab, while rows are selected: set their tier to T1 to T8, or to Untiered with `0` (internal link tracker spec 5.2) | Single character | Yes |
```

- [ ] **Step 7: Run the tests and see them pass**

```bash
pnpm vitest run src/features/internal-links/
```

Expected: PASS, the bulk test included.

- [ ] **Step 8: Run the gate and commit**

```bash
git add apps/web/src/features/internal-links/pages/ apps/web/messages/en.json docs/design-system/20-accessibility.md
git commit -m "Internal links: bulk tiers and tags, select all matching, keys 1 to 8 and 0"
```

---

### Task 9: The page inspector

**Files:**
- Create: `apps/web/src/features/internal-links/inspector/page-inspector.tsx`, `page-inspector.test.tsx`
- Modify: `apps/web/src/features/internal-links/internal-links-screen.tsx`, `apps/web/messages/en.json`

Mock: `il-drawer.js` (`tierSection`, `metricStrip`, `linkingSection`, `pageList`, `flagsSection`, `FLAG_TEXT`, the footer) and `04-inspector.png`. Leave out the route from home, suggested links, changes since the last crawl, tracked keywords, AI citations and the anchor statistics (slices 2 and 3; plan 02 serves no route from home). Spec 7.4's "top 5 anchors" is a plain list.

- [ ] **Step 1: Add the messages**

```json
  "internalLinks": {
    "inspector": {
      "typeLabel": "Page",
      "typeNoun": "page",
      "back": "Back to Internal links",
      "position": "{index} of {count}",
      "tier": "Tier",
      "tierField": "Tier of this page",
      "sourceManual": "Manual, set by {name} on {date}",
      "sourceManualNoName": "Manual, set on {date}",
      "sourceRule": "Rule: {rule}",
      "sourceNone": "No tier set by hand and no rule matches.",
      "ruleExact": "path is {value}",
      "rulePrefix": "path starts with {value}",
      "rulePattern": "path matches {value}",
      "resetToRule": "Reset to rule",
      "tags": "Tags",
      "noTags": "No tags",
      "addTag": "Add tag",
      "removeTag": "Remove tag {tag}",
      "stripLabel": "Page summary",
      "depth": "Depth",
      "notReachable": "Not reachable",
      "linksIn": "Links in",
      "linksOut": "Links out",
      "inScope": "{scope}, {count} in all",
      "byTier": "Linking pages by tier",
      "byPlacement": "Linking pages by placement",
      "noLinksIn": "No links point here in this scope.",
      "topAnchors": "Top anchors pointing here",
      "anchor": "“{anchor}”",
      "anchorLinks": "{count, plural, one {# link} other {# links}}",
      "linkingPages": "Linking pages ({count})",
      "outlinks": "Outlinks ({count})",
      "showing": "Showing {shown} of {total}.",
      "viewAll": "View all in Links",
      "noneInScope": "None in this scope.",
      "flags": "Flags",
      "noFlags": "No flags. This page has no linking problems.",
      "flagText": {
        "errorPage": "The page answers with an error. Links to it lead visitors and crawlers nowhere.",
        "redirect": "The page redirects to another URL. Link to the final page instead.",
        "nonIndexable": "Search engines are told not to index this page, so it cannot rank.",
        "orphan": "No page links here, so crawlers can only find it through the sitemap or Search Console.",
        "editorialOrphan": "No editorial link points here. Only menus, footers or auto-generated blocks reach it.",
        "deepOnlyThroughAuto": "The blog’s previous and next links are the only short way here: without them this page is far deeper or cannot be reached.",
        "placementUnknown": "The page’s HTML was not available, so its links count as editorial until the next crawl.",
        "brokenOutlinks": "This page links to a page that returns an error.",
        "redirectOutlinks": "This page links to a URL that redirects. Update the link to the final URL.",
        "fewEditorialLinks": "A T1 page with fewer than 3 editorial linking pages. Add links from related pages."
      },
      "openJourney": "Open in journey",
      "visit": "Visit page",
      "copyUrl": "Copy URL",
      "copied": "URL copied",
      "loadFailed": "This page could not be loaded",
      "loadFailedReason": "Try again in a moment.",
      "notInCrawl": "This page is not in the latest crawl."
    }
  },
```

- [ ] **Step 2: Write the failing inspector test**

`apps/web/src/features/internal-links/inspector/page-inspector.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { axe } from '@/test/axe';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams('inspect=page:108'),
}));

afterEach(() => document.documentElement.classList.remove('dark'));
const inspector = (): Promise<HTMLElement> =>
  screen.findByRole('complementary', { name: '/pricing' }).catch(() => screen.findByRole('dialog', { name: '/pricing' }));

describe('the page inspector (spec 7.4)', () => {
  it('shows the tier with its source, the strip, the linking pages and the flags, and no equity', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'inspect=page:108' });
    const panel = await inspector();
    expect(await within(panel).findByText(/^Manual, set by .+ on /)).toBeInTheDocument();
    expect(within(panel).getByRole('group', { name: 'Page summary' })).toHaveTextContent(/Depth\s*1/);
    expect(within(panel).getByRole('heading', { name: /^Linking pages \(\d+\)$/ })).toBeInTheDocument();
    expect(within(panel).queryByText(/equity/i)).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Open in journey' })).toBeInTheDocument();
  });

  it('resets a manual tier to its rule', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'inspect=page:108' });
    const panel = await inspector();
    await user.click(await within(panel).findByRole('button', { name: 'Reset to rule' }));
    expect(await screen.findByText(/went back to the tier their rule gives/)).toBeInTheDocument();
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'inspect=page:108' });
    await within(await inspector()).findByText(/^Manual, set by/);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 3: Run it and see it fail**

```bash
cd apps/web && pnpm vitest run src/features/internal-links/inspector/
```

Expected: FAIL, no inspector named "/pricing".

- [ ] **Step 4: Write the inspector**

`apps/web/src/features/internal-links/inspector/page-inspector.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { Anchor, Copy, ExternalLink, Flag, Layers, Link2, ListTree, Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { BulkTagDialog } from '../pages/bulk-tag-dialog';
import { usePageBulk } from '../pages/use-page-bulk';
import type { LinksTabContext } from '../tabs';
import { Inspector } from '@/components/app/inspector/inspector';
import type { InspectorNavigation } from '@/components/app/inspector/inspector-header';
import { InspectorBody } from '@/components/app/inspector/inspector-tabs';
import { InspectorFooter } from '@/components/app/inspector/inspector-footer';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { MetricStrip } from '@/components/app/metric/metric-strip';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Tag } from '@/components/ui/tag';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { copyText } from '@/lib/dom/clipboard';
import { EMPTY_VALUE, formatInteger, formatTableDate } from '@/lib/format';
import { pageFlags, type FlagKey } from '@/lib/internal-links/page-flags';
import { DEFAULT_PAGE_QUERY, pageDetailQuery, tierRulesQuery } from '@/lib/internal-links/queries';
import { PLACEMENT_KEY, SCOPE_KEY, type Placement } from '@/lib/internal-links/scopes';
import { tierPosition } from '@/lib/internal-links/tiers';
import type { Neighbor, PageTier } from '@/lib/internal-links/types';

/** Rows of a linking pages or outlinks list before "View all in Links" (mock `LIST_LIMIT`). */
const LIST_LIMIT = 8;
const NONE = 'none';

export interface PageInspectorProps {
  context: LinksTabContext;
  urlId: string;
  tags: readonly { termId: string; name: string }[];
  canWrite: boolean;
  positionText: string | null;
  navigation: InspectorNavigation | null;
  onStep: ((direction: 'next' | 'previous') => void) | undefined;
  onClose: () => void;
}

/**
 * The inspector of one crawled page (spec 7.4, mock `il-drawer.js`): its tier with the source and tags, a strip
 * (depth, links in, links out), linking pages by tier and by placement, the top anchors, capped lists of linking
 * pages and outlinks, flags with what they mean, and Open in journey. No equity (decision W4).
 */
export function PageInspector({ context, urlId, tags, canWrite, positionText, navigation, onStep, onClose }: PageInspectorProps): ReactElement {
  const t = useTranslations('internalLinks.inspector');
  const words = useTranslations('internalLinks');
  const common = useTranslations('common');
  const { scope, state, tiers, timeZone } = context;
  const read = useQuery(pageDetailQuery(scope, urlId, state.scope));
  const rules = useQuery(tierRulesQuery(scope));
  const bulk = usePageBulk(scope, DEFAULT_PAGE_QUERY, () => undefined);
  const [tagMode, setTagMode] = useState<'add' | 'remove' | null>(null);
  const target = { ids: [urlId], allMatching: false, count: 1 };
  const detail = read.data?.data ?? null;
  const page = detail?.page ?? null;
  const scopeWord = words(`scope.${SCOPE_KEY[state.scope]}`);

  const ruleText = (ruleId: string | null): string | null => {
    const rule = rules.data?.data.find((candidate) => candidate.rule_id === ruleId);
    if (rule === undefined) return null;
    const key = rule.match_type === 'exact' ? 'ruleExact' : rule.match_type === 'prefix' ? 'rulePrefix' : 'rulePattern';
    return t(key, { value: rule.value });
  };
  const sourceLine = (): string => {
    if (page === null) return '';
    if (page.tier_source === 'manual') {
      const date = page.tier_set_at === null ? EMPTY_VALUE : formatTableDate(page.tier_set_at, timeZone);
      return page.tier_set_by === null ? t('sourceManualNoName', { date }) : t('sourceManual', { name: page.tier_set_by.name, date });
    }
    if (page.tier_source === 'rule') return t('sourceRule', { rule: ruleText(page.tier_rule_id) ?? EMPTY_VALUE });
    return t('sourceNone');
  };
  const placementLabel = (placement: Placement): string => words(`placement.${PLACEMENT_KEY[placement]}`);
  const flagLabel = (key: FlagKey): string => words(`flags.${key}`);
  const flagText = (key: FlagKey): string => t(`flagText.${key}`);
  const taxonomyHref = context.hrefOf('/settings/taxonomy');
  const viewAll = (filter: 'src' | 'tgt'): void =>
    context.setSearch({ tab: 'links', src: filter === 'src' ? urlId : null, tgt: filter === 'tgt' ? urlId : null }, { history: 'push' });
  const visit = (): void => {
    if (page !== null) window.open(page.url, '_blank', 'noopener');
  };
  const list = (items: readonly Neighbor[], total: number, title: string, filter: 'src' | 'tgt'): ReactElement => (
    <InspectorSection title={title} icon={Link2} status="ready">
      {items.length === 0 ? (
        <p className="type-body text-foreground-tertiary">{t('noneInScope')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.slice(0, LIST_LIMIT).map((item) => (
            <li key={item.url_id} className="flex min-w-0 items-center gap-2">
              <TierBadge tier={item.tier} />
              <button
                type="button"
                className="min-w-0 truncate text-left type-table text-link hover:underline focus-visible:focus-ring"
                onClick={() => context.inspect.open(item.url_id)}
              >
                {item.path}
              </button>
            </li>
          ))}
        </ul>
      )}
      {total > LIST_LIMIT ? <p className="type-meta">{t('showing', { shown: LIST_LIMIT, total })}</p> : null}
      {total > 0 ? (
        <Button variant="link" size="sm" onClick={() => viewAll(filter)}>
          {t('viewAll')}
        </Button>
      ) : null}
    </InspectorSection>
  );

  let body: ReactElement;
  if (read.isError && isApiProblem(read.error, 'not_found')) {
    body = (
      <InspectorBody>
        <EmptyState variant="inline" title={t('loadFailed')} reason={t('notInCrawl')} headingLevel={3} />
      </InspectorBody>
    );
  } else if (read.isError) {
    body = (
      <InspectorBody>
        <InlineError
          title={t('loadFailed')}
          reason={t('loadFailedReason')}
          errorId={null}
          onRetry={() => void read.refetch()}
          retrying={read.isFetching}
          retryLabel={common('retry')}
        />
      </InspectorBody>
    );
  } else {
    const flags = page === null ? [] : pageFlags(page, state.scope);
    const stripGroups = [
      {
        id: 'links',
        items: [
          { id: 'depth', label: t('depth'), value: page?.click_depth === null || page === null ? t('notReachable') : formatInteger(page.click_depth) },
          { id: 'in', label: t('linksIn'), value: formatInteger(page?.linking_pages ?? 0), context: t('inScope', { scope: scopeWord.toLowerCase(), count: page?.linking_pages_all ?? 0 }) },
          { id: 'out', label: t('linksOut'), value: formatInteger(page?.outlinks ?? 0), context: t('inScope', { scope: scopeWord.toLowerCase(), count: page?.outlinks_all ?? 0 }) },
        ],
      },
    ];
    body = (
      <InspectorBody>
        <InspectorSection title={t('tier')} icon={Layers} status={page === null ? 'loading' : 'ready'}>
          {page === null ? null : (
            <div className="flex flex-col gap-2">
              <Field>
                <FieldLabel display="visually-hidden">{t('tierField')}</FieldLabel>
                <Select<string>
                  value={page.tier?.tier_id ?? NONE}
                  disabled={!canWrite || bulk.pending}
                  placeholder={t('tierField')}
                  options={[...tiers.map((tier) => ({ value: tier.tier_id, label: tier.label })), { value: NONE, label: words('filters.untiered') }]}
                  onValueChange={(value) => bulk.setTier(target, tiers.find((tier: PageTier) => tier.tier_id === value) ?? null)}
                />
              </Field>
              <p className="flex flex-wrap items-baseline gap-x-2 type-meta text-foreground-secondary">
                {sourceLine()}
                {page.tier_source === 'manual' && canWrite ? (
                  <Button variant="link" size="sm" onClick={() => bulk.resetToRule(target)}>
                    {t('resetToRule')}
                  </Button>
                ) : null}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {page.tags.length === 0 ? <span className="type-meta text-foreground-tertiary">{t('noTags')}</span> : null}
                {page.tags.map((tag) => (
                  <Tag
                    key={tag.term_id}
                    label={tag.name}
                    removeLabel={t('removeTag', { tag: tag.name })}
                    {...(canWrite ? { onRemove: () => bulk.changeTag(target, { termId: tag.term_id, name: tag.name }, false) } : {})}
                  />
                ))}
                {canWrite ? (
                  <Button variant="secondary" size="sm" onClick={() => setTagMode('add')}>
                    {t('addTag')}
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </InspectorSection>
        <MetricStrip
          size="sm"
          label={t('stripLabel')}
          status={page === null ? 'loading' : 'ready'}
          groups={stripGroups}
        />
        {detail === null ? null : (
          <>
            <InspectorSection title={t('byTier')} icon={ListTree} status="ready">
              {detail.linking_by_tier.length === 0 ? (
                <p className="type-body text-foreground-tertiary">{t('noLinksIn')}</p>
              ) : (
                <dl className="flex flex-col gap-1">
                  {[...detail.linking_by_tier]
                    .sort((a, b) => tierPosition(a.tier) - tierPosition(b.tier))
                    .map((entry) => (
                      <div key={entry.tier?.tier_id ?? NONE} className="flex items-center justify-between gap-2">
                        <dt>
                          <TierBadge tier={entry.tier} withName />
                        </dt>
                        <dd className="type-table num">{formatInteger(entry.pages)}</dd>
                      </div>
                    ))}
                </dl>
              )}
              <h4 className="pt-2 type-label text-foreground-tertiary">{t('byPlacement')}</h4>
              <dl className="flex flex-col gap-1">
                {detail.linking_by_placement.map((entry) => (
                  <div key={entry.placement} className="flex items-center justify-between gap-2">
                    <dt className="type-table">{placementLabel(entry.placement)}</dt>
                    <dd className="type-table num">{formatInteger(entry.pages)}</dd>
                  </div>
                ))}
              </dl>
            </InspectorSection>
            <InspectorSection title={t('topAnchors')} icon={Anchor} status="ready">
              {detail.top_anchors.length === 0 ? (
                <p className="type-body text-foreground-tertiary">{t('noLinksIn')}</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {detail.top_anchors.map((entry) => (
                    <li key={entry.anchor} className="flex items-center justify-between gap-2 type-table">
                      <span className="min-w-0 truncate">{t('anchor', { anchor: entry.anchor })}</span>
                      <span className="num text-foreground-secondary">{t('anchorLinks', { count: entry.links })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </InspectorSection>
            {list(detail.linking_pages, detail.linking_pages_total, t('linkingPages', { count: detail.linking_pages_total }), 'tgt')}
            {list(detail.outlinks, detail.outlinks_total, t('outlinks', { count: detail.outlinks_total }), 'src')}
            <InspectorSection title={t('flags')} icon={Flag} status="ready">
              {flags.length === 0 ? (
                <p className="type-body text-foreground-tertiary">{t('noFlags')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {flags.map((flag) => (
                    <li key={flag.key} className="flex flex-col items-start gap-1">
                      <Badge tone={flag.tone}>{flagLabel(flag.key)}</Badge>
                      <span className="type-meta text-foreground-secondary">{flagText(flag.key)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </InspectorSection>
          </>
        )}
      </InspectorBody>
    );
  }

  const copyUrl = (): void => {
    if (page === null) return;
    void copyText(page.url).then((copied) =>
      toast(copied ? { type: 'success', title: t('copied') } : { type: 'error', title: common('copy.failed') }),
    );
  };
  return (
    <Inspector
      type="page"
      header={{
        title: page?.path ?? EMPTY_VALUE,
        typeLabel: t('typeLabel'),
        typeNoun: t('typeNoun'),
        positionText,
        navigation,
        ...(page?.title === null || page === null ? {} : { freshness: <span className="type-meta text-foreground-secondary">{page.title}</span> }),
      }}
      backLabel={t('back')}
      onClose={onClose}
      onStep={onStep}
      footer={
        <InspectorFooter
          start={
            page === null ? null : (
              <Button variant="secondary" size="sm" icon={Copy} onClick={copyUrl}>
                {t('copyUrl')}
              </Button>
            )
          }
          secondary={
            page === null ? null : (
              <Button variant="secondary" icon={ExternalLink} onClick={visit}>
                {t('visit')}
              </Button>
            )
          }
          primary={
            <Button variant="primary" icon={Workflow} onClick={() => context.openJourney(urlId)}>
              {t('openJourney')}
            </Button>
          }
        />
      }
    >
      {body}
      <BulkTagDialog
        mode={tagMode}
        onClose={() => setTagMode(null)}
        count={1}
        tags={tags}
        taxonomyHref={taxonomyHref}
        pending={bulk.pending}
        onApply={(tag, add) => {
          setTagMode(null);
          bulk.changeTag(target, tag, add);
        }}
      />
    </Inspector>
  );
}
```

Two checks against the code as it stands: `MetricStripGroup` takes `id` and `items` (seen in `metric-strip.tsx`); `InspectorHeaderProps.freshness` is a `ReactNode` slot under the title, where the page's title goes. `InspectorBody`'s `label` is optional.

- [ ] **Step 5: Mount it in the screen**

In `apps/web/src/features/internal-links/internal-links-screen.tsx`, import `PageInspector` from `./inspector/page-inspector`, `useVocabularies` from `@/lib/keywords/taxonomy-reads`, and in `InternalLinksContent`, before `return`:

```tsx
  const vocabularies = useVocabularies(scope);
  const tags = useMemo(
    () =>
      vocabularies.loaded
        .filter((entry) => entry.vocabulary.kind === 'tag')
        .flatMap((entry) => entry.terms.map((term) => ({ termId: term.termId, name: term.path }))),
    [vocabularies.loaded],
  );
  const canWrite = useCan('projects:write');
  const at = inspector.position(order);
  const inspectorHost =
    inspector.target?.type === 'page' && view.kind === 'ready' ? (
      <PageInspector
        key={inspector.target.id}
        context={context}
        urlId={inspector.target.id}
        tags={tags}
        canWrite={canWrite}
        positionText={at === null ? null : t('inspector.position', { index: at.index + 1, count: at.count })}
        navigation={
          at === null
            ? null
            : {
                onPrevious: () => inspector.step('previous', order),
                onNext: () => inspector.step('next', order),
                atFirst: at.index === 0,
                atLast: at.index === at.count - 1,
              }
        }
        onStep={(direction) => inspector.step(direction, order)}
        onClose={inspector.close}
      />
    ) : null;
```

change `<InspectorLayout inspector={null}>` to `<InspectorLayout inspector={inspectorHost}>`, and name the order Task 6 left unnamed: `const [order, setOrderState] = useState<readonly string[]>([]);` (drop the comment above it).

- [ ] **Step 6: Run the tests and see them pass**

```bash
pnpm vitest run src/features/internal-links/
```

Expected: PASS.

- [ ] **Step 7: Run the gate and commit**

```bash
git add apps/web/src/features/internal-links/ apps/web/messages/en.json
git commit -m "Internal links: the page inspector"
```

---

### Task 10: Links tab

**Files:**
- Create: `apps/web/src/features/internal-links/links/edge-filters.ts`, `edge-filters.test.ts`, `edge-columns.tsx`, `links-tab.tsx`, `links-tab.test.tsx`
- Modify: `apps/web/src/features/internal-links/tabs.ts`, `apps/web/messages/en.json`

Mock: `il-links.js` (`COLUMNS`, the toolbar, the pair chip) and `09-links.png`. Leave out First seen, Lost on and the Status menu (slice 2).

- [ ] **Step 1: Add the messages**

```json
  "internalLinks": {
    "links": {
      "caption": "Links",
      "one": "link",
      "other": "links",
      "search": "Search target pages",
      "sourceContains": "Source page",
      "sourceTier": "Source tier",
      "targetTier": "Target tier",
      "placement": "Placement",
      "targetStatus": "Target status",
      "from": "Links from {path}",
      "to": "Links to {path}",
      "fromPage": "Links from one page",
      "toPage": "Links to one page",
      "remove": "Remove {label}",
      "emptyTitle": "No links in this crawl",
      "emptyReason": "The crawl found no internal links in this scope.",
      "noMatchTitle": "No links match",
      "noMatchReason": "Try Links: All links, another placement or another search.",
      "clearFilters": "Clear filters",
      "loadFailed": "The links could not be loaded",
      "loadFailedReason": "Try again in a moment.",
      "range": "Showing {from} to {to} of {total}",
      "columns": {
        "source": "Source page",
        "sourceTier": "Source tier",
        "target": "Target page",
        "targetTier": "Target tier",
        "anchor": "Anchor text",
        "placement": "Placement",
        "rel": "Rel",
        "status": "Target status",
        "redirectsTo": "{status} to {url}",
        "notCrawled": "Not crawled",
        "indexable": "Target indexable",
        "occurrences": "Occurrences",
        "follow": "follow",
        "image": "Image: {alt}"
      }
    }
  },
```

- [ ] **Step 2: Write the failing filter test**

`apps/web/src/features/internal-links/links/edge-filters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { edgeQueryOf } from './edge-filters';
import { parseLinksSearch } from '../url-state';

describe('edgeQueryOf', () => {
  it('reads the filter bar, the worklist, the page and the searches into one edges query', () => {
    const state = parseLinksSearch({ scope: 'template', lview: 'broken_and_redirected', lq: '/services', tgt: '108' });
    expect(
      edgeQueryOf(
        state,
        {
          stier: { kind: 'enum', values: ['none'] },
          ttier: { kind: 'enum', values: ['t1'] },
          place: { kind: 'enum', values: ['footer', 'nowhere'] },
          tstatus: { kind: 'enum', values: ['3xx'] },
          sq: { kind: 'text', operator: 'contains', text: '/blog' },
        },
        null,
        100,
      ),
    ).toEqual({
      scope: 'template',
      sourceTierIds: ['none'],
      targetTierIds: ['t1'],
      tagIds: [],
      placements: ['footer'],
      targetStatus: ['3xx'],
      source: null,
      target: '108',
      worklist: 'broken_and_redirected',
      qSource: '/blog',
      qTarget: '/services',
      cursor: null,
      limit: 100,
    });
  });
});
```

- [ ] **Step 3: Run it and see it fail**

```bash
cd apps/web && pnpm vitest run src/features/internal-links/links/
```

Expected: FAIL, `Failed to resolve import "./edge-filters"`.

- [ ] **Step 4: Write the filters and the columns**

`apps/web/src/features/internal-links/links/edge-filters.ts`:

```ts
import type { FilterField, FilterValues } from '@/components/app/filters/types';
import { enumValuesOf } from '@/lib/filters/filter-values';
import type { EdgeQuery } from '@/lib/internal-links/queries';
import { PLACEMENT_KEY, PLACEMENTS, type Placement } from '@/lib/internal-links/scopes';
import type { PageTier, StatusClass } from '@/lib/internal-links/types';
import type { LinksTranslate } from '../tabs';
import type { LinksState } from '../url-state';

const STATUSES: readonly StatusClass[] = ['2xx', '3xx', '4xx', '5xx'];

/** The Links filter bar (spec 7.3: the Pages filters plus source and target). URL keys `stier`, `ttier`, `place`, `tstatus`, `tag`, `sq`. */
export function edgeFilterFields(
  t: LinksTranslate,
  tiers: readonly PageTier[],
  tags: readonly { termId: string; name: string }[],
  tagsLoading: boolean,
): FilterField[] {
  const tierOptions = [...tiers.map((tier) => ({ value: tier.tier_id, label: tier.label })), { value: 'none', label: t('filters.untiered') }];
  return [
    { id: 'stier', kind: 'enum', multi: true, label: t('links.sourceTier'), options: tierOptions, optionsLoading: tiers.length === 0 },
    { id: 'ttier', kind: 'enum', multi: true, label: t('links.targetTier'), options: tierOptions, optionsLoading: tiers.length === 0 },
    {
      id: 'place',
      kind: 'enum',
      multi: true,
      label: t('links.placement'),
      options: PLACEMENTS.map((value) => ({ value, label: t(`placement.${PLACEMENT_KEY[value]}`) })),
    },
    { id: 'tstatus', kind: 'enum', multi: true, label: t('links.targetStatus'), options: STATUSES.map((value) => ({ value, label: value })) },
    { id: 'tag', kind: 'enum', multi: true, label: t('filters.tag'), options: tags.map((tag) => ({ value: tag.termId, label: tag.name })), optionsLoading: tagsLoading },
    { id: 'sq', kind: 'text', label: t('links.sourceContains'), operators: ['contains'] },
  ];
}

export function edgeQueryOf(state: LinksState, values: FilterValues, cursor: string | null, limit: number): EdgeQuery {
  const source = values.sq;
  return {
    scope: state.scope,
    sourceTierIds: enumValuesOf(values.stier),
    targetTierIds: enumValuesOf(values.ttier),
    tagIds: enumValuesOf(values.tag),
    placements: enumValuesOf(values.place).filter((value): value is Placement => PLACEMENTS.includes(value as Placement)),
    targetStatus: enumValuesOf(values.tstatus).filter((value): value is StatusClass => STATUSES.includes(value as StatusClass)),
    source: state.source,
    target: state.target,
    worklist: state.edgeWorklist,
    qSource: source?.kind === 'text' && source.text.trim() !== '' ? source.text.trim() : null,
    qTarget: state.lq,
    cursor,
    limit,
  };
}
```

`apps/web/src/features/internal-links/links/edge-columns.tsx`:

```tsx
'use client';

import { col } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Badge } from '@/components/ui/badge';
import { PLACEMENT_KEY } from '@/lib/internal-links/scopes';
import type { EdgeRow } from '@/lib/internal-links/types';
import type { LinksTranslate } from '../tabs';

type Column = DataTableColumn<EdgeRow>;

const badgeColumn = (id: string, header: string, cell: Column['cell']): Column => ({
  id,
  type: 'badge',
  header,
  cell,
  priority: 1,
  defaultVisible: true,
  width: 96,
});

/** The Links columns of spec 7.3 and the mock (`il-links.js` `COLUMNS`). The server orders the rows (template first). */
export function edgeColumns(t: LinksTranslate): Column[] {
  return [
    { ...col.keyword<EdgeRow>('source', (row) => row.source.path, { header: t('links.columns.source') }), sortValue: undefined },
    badgeColumn('sourceTier', t('links.columns.sourceTier'), (row) => <TierBadge tier={row.source.tier} />),
    { ...col.text<EdgeRow>('target', (row) => row.target.path, { header: t('links.columns.target'), width: 240 }), sortValue: undefined },
    badgeColumn('targetTier', t('links.columns.targetTier'), (row) => <TierBadge tier={row.target.tier} />),
    {
      ...col.text<EdgeRow>(
        'anchor',
        (row) => (row.kind === 'image' ? t('links.columns.image', { alt: row.anchor }) : row.anchor),
        { header: t('links.columns.anchor'), width: 240 },
      ),
      sortValue: undefined,
    },
    { ...col.text<EdgeRow>('placement', (row) => t(`placement.${PLACEMENT_KEY[row.placement]}`), { header: t('links.columns.placement') }), sortValue: undefined },
    {
      ...col.text<EdgeRow>('rel', (row) => (row.rel.length === 0 ? t('links.columns.follow') : row.rel.join(' ')), { header: t('links.columns.rel'), width: 104 }),
      sortValue: undefined,
    },
    {
      id: 'status',
      type: 'status',
      header: t('links.columns.status'),
      priority: 1,
      defaultVisible: true,
      width: 180,
      cell: (row) => {
        const status = row.target.status_code;
        if (status === null) return <span className="type-table text-foreground-tertiary">{t('links.columns.notCrawled')}</span>;
        if (status === 200) return <span className="type-table num text-foreground-secondary">200</span>;
        return (
          <Badge tone={status >= 400 ? 'negative' : 'warning'}>
            {row.target.redirect_url === null ? String(status) : t('links.columns.redirectsTo', { status, url: row.target.redirect_url })}
          </Badge>
        );
      },
    },
    {
      ...col.text<EdgeRow>(
        'indexable',
        (row) => (row.target.is_indexable === null ? null : row.target.is_indexable ? t('columns.yes') : t('columns.no')),
        { header: t('links.columns.indexable'), width: 120 },
      ),
      sortValue: undefined,
    },
    { ...col.count<EdgeRow>('occurrences', (row) => row.occurrences, { header: t('links.columns.occurrences') }), sortValue: undefined },
  ];
}
```

- [ ] **Step 5: Write the failing tab test**

`apps/web/src/features/internal-links/links/links-tab.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { axe } from '@/test/axe';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => document.documentElement.classList.remove('dark'));
const grid = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Links' });

describe('the Links tab (spec 7.3)', () => {
  it('lists the edges with their placement and target status', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=links' });
    const table = await grid();
    for (const name of ['Source page', 'Source tier', 'Target page', 'Target tier', 'Anchor text', 'Placement', 'Rel', 'Target status', 'Target indexable', 'Occurrences']) {
      expect(within(table).getByRole('columnheader', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    expect(await within(table).findAllByRole('rowheader', { name: /^\/services\/soc-as-a-service/ })).not.toHaveLength(0);
  });

  it('opens the broken and redirected worklist from the Pages chips, every scope, as links', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=links&lview=broken_and_redirected' });
    const table = await grid();
    expect(await within(table).findByText(/^301 to https:\/\/eventussecurity\.com\/services\/vapt$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Broken and redirected links' })).toBeInTheDocument();
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=links' });
    await within(await grid()).findAllByRole('rowheader');
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 6: Write the tab and register it**

`apps/web/src/features/internal-links/links/links-tab.tsx`:

```tsx
'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { parseAsString, useQueryStates } from 'nuqs';
import { useEffect, useMemo, type ReactElement } from 'react';

import { edgeColumns } from './edge-columns';
import { edgeFilterFields, edgeQueryOf } from './edge-filters';
import { pageRange, useCursorPaging } from '../pages/cursor-paging';
import { ScopeMenu } from '../scope-menu';
import type { LinksTabContext } from '../tabs';
import { DataTable } from '@/components/app/data-table/data-table';
import type { DataTableProps } from '@/components/app/data-table/types';
import { FilterBar } from '@/components/app/filters/filter-bar';
import { useUrlFilters } from '@/components/app/filters/use-url-filters';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/tag';
import { downloadApiFile, type DownloadQuery } from '@/lib/api/download';
import { formatInteger } from '@/lib/format';
import { useVocabularies } from '@/lib/keywords/taxonomy-reads';
import { edgeParams, edgesPath, edgesQuery } from '@/lib/internal-links/queries';
import type { EdgeRow } from '@/lib/internal-links/types';
import { formatColumns, parseColumns, parseDensity } from '@/lib/tables/table-state';

const TABLE_KEYS = { density: parseAsString, cols: parseAsString };
const NO_EDGES: readonly EdgeRow[] = [];
const REQUIRED_COLUMNS = ['source'];

/** The Links tab (spec 7.3, mock `il-links.js`): every link edge, the same filters plus source and target. */
export function LinksTab({ context }: { context: LinksTabContext }): ReactElement {
  const t = useTranslations('internalLinks');
  const common = useTranslations('common');
  const { scope, state, setSearch, tiers } = context;
  const vocabularies = useVocabularies(scope);
  const tags = useMemo(
    () =>
      vocabularies.loaded
        .filter((entry) => entry.vocabulary.kind === 'tag')
        .flatMap((entry) => entry.terms.map((term) => ({ termId: term.termId, name: term.path }))),
    [vocabularies.loaded],
  );
  const fields = useMemo(() => edgeFilterFields(t, tiers, tags, vocabularies.pending), [t, tiers, tags, vocabularies.pending]);
  const [values, setValues] = useUrlFilters(fields);
  const filtersKey = JSON.stringify([state.scope, state.edgeWorklist, state.lq, state.source, state.target, values]);
  const paging = useCursorPaging(filtersKey);
  const query = edgeQueryOf(state, values, paging.cursor, paging.size);
  const read = useQuery({ ...edgesQuery(scope, query), placeholderData: keepPreviousData });
  const rows = read.data?.data ?? NO_EDGES;
  const total = read.data?.meta.total ?? null;
  const [table, setTable] = useQueryStates(TABLE_KEYS, { history: 'replace' });
  const columns = useMemo(() => edgeColumns(t), [t]);
  const known = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);

  const { registerExport } = context;
  const csvParams = JSON.stringify({ ...edgeParams({ ...query, cursor: null }), limit: undefined });
  useEffect(() => {
    const wanted = JSON.parse(csvParams) as DownloadQuery;
    registerExport(() => downloadApiFile(edgesPath(scope), { ...wanted, format: 'csv' }, 'internal-links-links.csv'));
    return () => registerExport(null);
  }, [registerExport, csvParams, scope]);

  const notes = [
    ...(state.edgeWorklist === null
      ? []
      : [{ key: 'lview', label: t(state.edgeWorklist === 'broken_and_redirected' ? 'worklists.brokenAndRedirected' : 'worklists.linksToNonIndexable') }]),
    ...(state.source === null ? [] : [{ key: 'src', label: t('links.fromPage') }]),
    ...(state.target === null ? [] : [{ key: 'tgt', label: t('links.toPage') }]),
  ];
  const range = pageRange({ pageIndex: paging.pageIndex, rows: rows.length, limit: paging.size });
  const filtered = Object.keys(values).length > 0 || notes.length > 0 || state.lq !== null;
  const status: DataTableProps<EdgeRow>['status'] =
    read.isError && read.data === undefined
      ? 'error'
      : read.isPending
        ? 'loading'
        : read.isFetching
          ? 'refetching'
          : rows.length === 0
            ? filtered
              ? 'filtered-empty'
              : 'empty'
            : 'ready';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar fields={fields} values={values} onChange={setValues} />
        <ScopeMenu scope={state.scope} onChange={(next) => setSearch({ scope: next === 'editorial' ? null : next })} />
        {notes.map((note) => (
          <Tag key={note.key} label={note.label} removeLabel={t('links.remove', { label: note.label })} onRemove={() => setSearch({ [note.key]: null })} />
        ))}
      </div>
      <DataTable<EdgeRow>
        caption={t('links.caption')}
        itemNoun={{ one: t('links.one'), other: t('links.other') }}
        columns={columns}
        getRowId={(row) => row.link_id}
        rows={rows}
        total={total}
        server={{
          rangeText: t('links.range', { from: formatInteger(range.from), to: formatInteger(range.to), total: formatInteger(total ?? 0) }),
          offset: range.offset,
          hasPrevious: paging.pageIndex > 0,
          hasNext: read.data?.page.has_more ?? false,
          onPrevious: paging.previous,
          onNext: () => {
            const next = read.data?.page.next_cursor;
            if (next !== null && next !== undefined) paging.next(next);
          },
          pageSize: paging.size,
          onPageSizeChange: paging.setSize,
          pageSizes: [100, 200],
        }}
        sort={[]}
        onSortChange={() => undefined}
        defaultSort={[]}
        density={parseDensity(table.density)}
        onDensityChange={(density) => void setTable({ density: density === 'compact' ? null : density })}
        columnState={{
          visible: parseColumns(table.cols, known, REQUIRED_COLUMNS),
          onChange: (visible) => void setTable({ cols: visible === null ? null : formatColumns(visible) }),
        }}
        search={state.lq ?? ''}
        onSearchChange={(lq) => setSearch({ lq: lq.trim() === '' ? null : lq })}
        searchPlaceholder={t('links.search')}
        rowName={(row) => `${row.source.path} ${row.target.path}`}
        onRowOpen={(row) => context.inspect.open(row.target.url_id)}
        status={status}
        errorState={
          <InlineError
            title={t('links.loadFailed')}
            reason={t('links.loadFailedReason')}
            errorId={null}
            onRetry={() => void read.refetch()}
            retrying={read.isFetching}
            retryLabel={common('retry')}
          />
        }
        emptyState={<EmptyState title={t('links.emptyTitle')} reason={t('links.emptyReason')} headingLevel={3} />}
        filteredEmptyState={
          <EmptyState
            title={t('links.noMatchTitle')}
            reason={t('links.noMatchReason')}
            headingLevel={3}
            primaryAction={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setValues({});
                  setSearch({ lq: null, lview: null, src: null, tgt: null });
                }}
              >
                {t('links.clearFilters')}
              </Button>
            }
          />
        }
      />
    </div>
  );
}
```

In `apps/web/src/features/internal-links/tabs.ts`, import `LinksTab` from `./links/links-tab` and add the entry:

```ts
  { id: 'links', label: (t) => t('tabs.links'), render: (context) => createElement(LinksTab, { context }) },
```

- [ ] **Step 7: Run the tests and see them pass**

```bash
pnpm vitest run src/features/internal-links/
```

Expected: PASS.

- [ ] **Step 8: Run the gate and commit**

```bash
git add apps/web/src/features/internal-links/ apps/web/messages/en.json
git commit -m "Internal links: Links tab"
```

---

### Task 11: Journey tab: canvas, tree list, focus picker and the address

**Files:**
- Create: `apps/web/src/features/internal-links/journey/use-neighbor-lookup.ts`, `focus-picker.tsx`, `focus-note.tsx`, `tree-list.tsx`, `journey-tab.tsx`, `journey-tab.test.tsx`
- Modify: `apps/web/src/features/internal-links/tabs.ts`, `apps/web/messages/en.json`

Mock: `il-journey.js` (`toolbar`, `viewSwitch`, `pagePicker`, `cardsSwitch`, `focusNote`, `treeTable`, `treeRow`, `render`) and `05-journey.png`, `06-journey-open.png`, `07-tree.png`. The Path finder view, "Route from home" and "Suggested links" are slices 2 and 3.

- [ ] **Step 1: Add the messages**

```json
  "internalLinks": {
    "journey": {
      "heading": "Link journey",
      "view": "View",
      "canvas": "Canvas",
      "tree": "Tree list",
      "focus": "Focus page",
      "focusTrigger": "Focus page: {path}. Change it.",
      "searchPages": "Search pages",
      "noPageMatch": "No crawled page matches “{query}”. Check the spelling or search for part of the path.",
      "loadingPages": "Loading pages",
      "clear": "Clear",
      "openList": "Show pages",
      "linksShown": "Links shown as cards",
      "editorial": "Editorial",
      "all": "All links",
      "follow": "Follow",
      "out": "Links out",
      "in": "Links in",
      "editorialIn": "{count, plural, one {# editorial link} other {# editorial links}} in.",
      "notFoundNote": "Not found: this page has no links out.",
      "redirectNote": "Redirect: it passes visitors to its target.",
      "orphanNote": "Orphan: no page links here.",
      "editorialOrphanNote": "Editorial orphan: no editorial links in.",
      "editorialOrphanFull": "Editorial orphan: no editorial links in. Choose All links to see the menu and automatic links that reach it.",
      "noOutlinksNote": "This page has no links out.",
      "full": "The canvas is full",
      "fullText": "It holds at most 300 cards. Close a card, or use the tree list to follow the rest.",
      "notInCrawlTitle": "This page is not in the latest crawl",
      "notInCrawlReason": "Choose a crawled page as the focus.",
      "loadFailed": "The journey could not be loaded",
      "treeCaption": "Link journey as a tree",
      "treeColumns": {
        "page": "Page",
        "tier": "Tier",
        "anchor": "Anchor text",
        "type": "Link type",
        "linking": "Linking pages",
        "status": "Status"
      },
      "focusRow": "Focus page",
      "expand": "Expand {path}",
      "collapse": "Collapse {path}",
      "makeFocus": "Make {path} the focus",
      "backOut": "Links back to {path} (step {step})",
      "backIn": "Gets a link back from {path} (step {step})",
      "listed": "{path}: listed above",
      "moreRows": "{count, plural, one {# more page} other {# more pages}} not listed here. See them in the Links tab.",
      "treeEmptyOut": "This page has no links out in this scope. Choose All links to include menu and automatic links.",
      "treeEmptyIn": "No page links here in this scope. Choose All links to include menu and automatic links.",
      "anchor": "“{anchor}”"
    }
  },
```

- [ ] **Step 2: Write the failing journey test**

`apps/web/src/features/internal-links/journey/journey-tab.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { axe } from '@/test/axe';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => document.documentElement.classList.remove('dark'));
const canvas = (): Promise<HTMLElement> =>
  screen.findByRole('group', { name: 'Link journey canvas. The tree list shows the same journey as a table.' });

describe('the Journey tab (spec 7.5)', () => {
  it('centers on the focus from the address, with its outlinks in step 1 out and its in-links on the left', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=journey&focus=103' });
    const area = await canvas();
    expect(await within(area).findByRole('button', { name: /^\/services\/soc-as-a-service, T1 Money pages, .* focus page$/ })).toBeInTheDocument();
    expect(await within(area).findByRole('button', { name: /^\/pricing, T1 Money pages, .*linked as “See plans”, content$/ })).toBeInTheDocument();
    expect(within(area).getByRole('heading', { name: 'Step 1 in' })).toBeInTheDocument();
  });

  it('writes an opened card to the address, so a reload shows the same view', async () => {
    const urls: string[] = [];
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103',
      onUrlUpdate: (update) => urls.push(update.queryString),
    });
    const area = await canvas();
    await user.click(await within(area).findByRole('button', { name: /^\/pricing, T1/ }));
    expect(decodeURIComponent(urls.at(-1) ?? '')).toContain('open=o:108');
    expect(await within(area).findByRole('heading', { name: 'Step 2 out' })).toBeInTheDocument();
  });

  it('marks a page that links back to the focus with the back-link marker once opened', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=journey&focus=103&open=o%3A108' });
    const area = await canvas();
    expect(await within(area).findByRole('button', { name: 'Links back to 1 earlier page' })).toBeInTheDocument();
  });

  it('shows the same journey as a tree list with muted back-link rows', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=journey&focus=103&jv=tree' });
    const table = await screen.findByRole('table', { name: 'Link journey as a tree' });
    await user.click(await within(table).findByRole('button', { name: 'Expand /pricing' }));
    expect(await within(table).findByText('Links back to /services/soc-as-a-service (step 0)')).toBeInTheDocument();
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=journey&focus=103&open=o%3A108' });
    await within(await canvas()).findByRole('button', { name: 'Links back to 1 earlier page' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

(`103` is `/services/soc-as-a-service`; its editorial outlinks are `/pricing`, `/services/managed-detection-and-response` and `/contact`; `/pricing` links back to it.)

- [ ] **Step 3: Run it and see it fail**

```bash
cd apps/web && pnpm vitest run src/features/internal-links/journey/
```

Expected: FAIL, no canvas (the Journey tab is not registered).

- [ ] **Step 4: Write the neighbor lookup**

`apps/web/src/features/internal-links/journey/use-neighbor-lookup.ts`:

```ts
'use client';

import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { READ_LIMIT, type ListLookup, type ListRequest, type LoadedList } from '@/lib/internal-links/journey-layout';
import { neighborsQuery } from '@/lib/internal-links/queries';
import type { LinksScope, Neighbor, NeighborList } from '@/lib/internal-links/types';

const STALE_MS = 60_000;

const pagesOf = (scope: LinksScope, request: ListRequest) =>
  Array.from({ length: request.pages }, (_, index) =>
    neighborsQuery(scope, { urlId: request.urlId, direction: request.direction, linkScope: request.scope, offset: index * READ_LIMIT }),
  );

/**
 * The neighbor lists of the journey (decision W7). `lookup` reads what the cache holds for a list, page by page of
 * 50; `useLoad` subscribes to every page the layout asked for, so an answer re-renders the journey. The layout is
 * pure: it is computed again from the cache on each render.
 */
export function useNeighborLookup(scope: LinksScope): {
  lookup: ListLookup<Neighbor>;
  useLoad: (requests: readonly ListRequest[]) => void;
} {
  const queryClient = useQueryClient();
  const lookup = useCallback<ListLookup<Neighbor>>(
    (request) => {
      const pages = pagesOf(scope, request).map((options) => queryClient.getQueryState<NeighborList>(options.queryKey));
      if (pages.some((page) => page?.status === 'error' && page.data === undefined)) {
        return { status: 'error', items: [], total: 0, otherScopes: [] };
      }
      const answers = pages.map((page) => page?.data);
      const [first] = answers;
      if (first === undefined || answers.some((answer) => answer === undefined)) {
        return { status: 'loading', items: [], total: 0, otherScopes: [] };
      }
      const list: LoadedList<Neighbor> = {
        status: 'ready',
        items: answers.flatMap((answer) => answer?.data ?? []),
        total: first.meta.total,
        otherScopes: first.meta.other_scopes,
      };
      return list;
    },
    [queryClient, scope],
  );
  const useLoad = (requests: readonly ListRequest[]): void => {
    useQueries({
      queries: requests.flatMap((request) => pagesOf(scope, request)).map((options) => ({ ...options, staleTime: STALE_MS })),
    });
  };
  return { lookup, useLoad };
}
```

`useLoad` is a hook called once per render by the tab, with the requests of the layout it just built.

- [ ] **Step 5: Write the focus picker, the focus note and the tree list**

`apps/web/src/features/internal-links/journey/focus-picker.tsx`:

```tsx
'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown, Crosshair } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { TierBadge } from '@/components/app/tier/tier-badge';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Icon } from '@/components/ui/icon';
import { DEFAULT_PAGE_QUERY, pagesQuery } from '@/lib/internal-links/queries';
import type { LinksScope, PageRow } from '@/lib/internal-links/types';

const PICK_LIMIT = 50;

/** The focus page control (mock `pagePicker`): a search over crawled pages, each with its tier badge. */
export function FocusPicker({ scope, path, onPick }: { scope: LinksScope; path: string; onPick: (urlId: string) => void }): ReactElement {
  const t = useTranslations('internalLinks.journey');
  const [query, setQuery] = useState('');
  const read = useQuery({
    ...pagesQuery(scope, { ...DEFAULT_PAGE_QUERY, sort: 'path', q: query.trim() === '' ? null : query.trim(), limit: PICK_LIMIT }),
    placeholderData: keepPreviousData,
  });
  return (
    <Combobox<PageRow>
      value={null}
      onValueChange={(row) => row !== null && onPick(row.url_id)}
      items={read.data?.data ?? []}
      itemToString={(row) => row.path}
      itemKey={(row) => row.url_id}
      renderItem={(row) => (
        <span className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate type-table">{row.path}</span>
          <TierBadge tier={row.tier} />
        </span>
      )}
      onQueryChange={setQuery}
      loading={read.isFetching}
      loadingText={t('loadingPages')}
      emptyText={(text) => t('noPageMatch', { query: text })}
      placeholder={t('searchPages')}
      clearLabel={t('clear')}
      openLabel={t('openList')}
      triggerLabel={t('focusTrigger', { path })}
      trigger={
        <Button variant="secondary" size="sm" className="max-w-80">
          <Icon icon={Crosshair} size="sm" className="text-foreground-tertiary" />
          <span className="truncate type-table">{path}</span>
          <Icon icon={ChevronDown} size="sm" className="text-foreground-tertiary" />
        </Button>
      }
    />
  );
}
```

`apps/web/src/features/internal-links/journey/focus-note.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { LinkScope } from '@/lib/internal-links/scopes';
import type { PageRow } from '@/lib/internal-links/types';

/** The lines under the focus card (mock `focusNote`), without the route from home (slice 2). */
export function FocusNote({ page, scope }: { page: PageRow; scope: LinkScope }): ReactElement | null {
  const t = useTranslations('internalLinks.journey');
  const lines: string[] = [];
  const status = page.status_code ?? 0;
  if (status === 200 && scope === 'editorial') lines.push(t('editorialIn', { count: page.linking_pages }));
  if (status >= 400) lines.push(t('notFoundNote'));
  else if (status >= 300) lines.push(t('redirectNote'));
  if (page.flags.includes('orphan')) lines.push(t('orphanNote'));
  else if (page.flags.includes('editorial_orphan')) lines.push(t(scope === 'editorial' ? 'editorialOrphanFull' : 'editorialOrphanNote'));
  else if (page.outlinks_all === 0 && status < 400) lines.push(t('noOutlinksNote'));
  if (lines.length === 0) return null;
  return <p className="max-w-64 type-meta text-foreground-tertiary">{lines.join(' ')}</p>;
}
```

`apps/web/src/features/internal-links/journey/tree-list.tsx`:

```tsx
'use client';

import { ChevronDown, ChevronRight, Crosshair } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, type KeyboardEvent, type ReactElement } from 'react';

import { useNeighborLookup } from './use-neighbor-lookup';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { formatInteger } from '@/lib/format';
import { buildTree, type Direction, type TreeRow } from '@/lib/internal-links/journey-layout';
import { PLACEMENT_KEY, type LinkScope, type Placement } from '@/lib/internal-links/scopes';
import type { LinksScope, Neighbor, PageRow } from '@/lib/internal-links/types';
import { cn } from '@/lib/utils';

const CELL = 'px-3 align-middle';
const TREE_COLUMNS = ['page', 'tier', 'anchor', 'type', 'linking', 'status'] as const;
/** Indent per level (mock: 20 px); a style, since it multiplies with the level. */
const INDENT = 20;

/**
 * The tree list (spec 7.5, decision W3): the canvas's text alternative and the better view for anchors. One
 * direction at a time; back links and pages listed higher are muted rows that do not open.
 */
export function TreeList({
  scope,
  focus,
  linkScope,
  dir,
  open,
  onToggle,
  onRefocus,
}: {
  scope: LinksScope;
  focus: PageRow;
  linkScope: LinkScope;
  dir: Direction;
  open: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onRefocus: (urlId: string) => void;
}): ReactElement {
  const t = useTranslations('internalLinks.journey');
  const words = useTranslations('internalLinks');
  const bothWays = useTranslations('linkCanvas')('bothWays');
  const { lookup, useLoad } = useNeighborLookup(scope);
  const tree = buildTree<Neighbor>({ focus: focus.url_id, dir, scope: linkScope, open }, lookup);
  useLoad(tree.requests);
  const body = useRef<HTMLTableSectionElement>(null);
  const pathOf = (row: TreeRow<Neighbor>): string => ('node' in row && row.node !== null ? row.node.path : focus.path);
  const placementLabel = (placement: Placement): string => words(`placement.${PLACEMENT_KEY[placement]}`);

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, row: TreeRow<Neighbor>): void => {
    if (row.kind !== 'page' || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) return;
    if ((event.key === 'ArrowRight') === row.open) return;
    event.preventDefault();
    onToggle(row.key);
  };

  const rows = tree.rows;
  return (
    <div className="overflow-x-auto">
      <table aria-label={t('treeCaption')} className="w-full border-collapse">
        <thead>
          <tr className="h-row-header">
            {TREE_COLUMNS.map((key) => (
              <th
                key={key}
                scope="col"
                className={cn(
                  'sticky top-0 z-(--z-table-header) border-b border-border bg-surface-subtle text-left type-table-header text-foreground-secondary',
                  CELL,
                  key === 'linking' && 'text-right',
                )}
              >
                {t(`treeColumns.${key}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={body}>
          {rows.map((row) => {
            const muted = row.kind !== 'page';
            const node = 'node' in row ? row.node : null;
            let label: string;
            if (row.kind === 'back') label = t(dir === 'out' ? 'backOut' : 'backIn', { path: row.node.path, step: row.step });
            else if (row.kind === 'listed') label = t('listed', { path: row.node.path });
            else if (row.kind === 'more') label = t('moreRows', { count: row.count });
            else label = pathOf(row);
            return (
              <tr key={row.key} className="group h-row-compact border-b border-border-subtle hover:bg-surface-hover">
                <td className={cn(CELL, 'min-w-72')}>
                  <div className="flex items-center gap-1.5" style={{ paddingLeft: row.level * INDENT }}>
                    {row.kind === 'page' && row.level > 0 && row.canOpen ? (
                      <button
                        type="button"
                        aria-expanded={row.open}
                        aria-label={t(row.open ? 'collapse' : 'expand', { path: label })}
                        onClick={() => onToggle(row.key)}
                        onKeyDown={(event) => onKey(event, row)}
                        className="flex size-6 shrink-0 items-center justify-center rounded-sm text-foreground-tertiary hover:bg-surface-selected hover:text-foreground focus-visible:focus-ring"
                      >
                        <Icon icon={row.open ? ChevronDown : ChevronRight} size="sm" />
                      </button>
                    ) : (
                      <span className="size-6 shrink-0" />
                    )}
                    <span className={cn('truncate type-table', muted ? 'text-foreground-tertiary' : 'text-foreground')}>{label}</span>
                    {row.kind === 'page' && row.bothWays ? (
                      <span className="inline-flex h-badge items-center rounded-sm bg-primary-subtle px-1.5 type-label whitespace-nowrap text-primary-text">
                        {bothWays}
                      </span>
                    ) : null}
                    {row.kind === 'page' && row.level > 0 ? (
                      <IconButton
                        icon={Crosshair}
                        size="icon-xs"
                        variant="secondary"
                        label={t('makeFocus', { path: label })}
                        onClick={() => onRefocus(row.urlId)}
                        className="ml-auto opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                      />
                    ) : null}
                  </div>
                </td>
                <td className={CELL}>{row.kind === 'page' || row.kind === 'back' || row.kind === 'listed' ? <TierBadge tier={node?.tier ?? focus.tier} /> : null}</td>
                <td className={cn(CELL, 'type-table', muted ? 'text-foreground-tertiary' : 'text-foreground-secondary')}>
                  {node === null ? (row.kind === 'page' ? t('focusRow') : '') : node.anchor === null ? '' : t('anchor', { anchor: node.anchor })}
                </td>
                <td className={cn(CELL, 'type-table text-foreground-secondary')}>
                  {node?.placement === null || node === null ? '' : placementLabel(node.placement)}
                </td>
                <td className={cn(CELL, 'text-right type-table num text-foreground-secondary')}>
                  {muted ? '' : formatInteger(node?.linking_pages ?? focus.linking_pages)}
                </td>
                <td className={CELL}>
                  {muted ? null : (node?.status_code ?? focus.status_code) === 200 ? (
                    <span className="type-table num text-foreground-secondary">200</span>
                  ) : (
                    <Badge tone={(node?.status_code ?? focus.status_code ?? 0) >= 400 ? 'negative' : 'warning'}>
                      {String(node?.status_code ?? focus.status_code ?? '')}
                    </Badge>
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length === 1 && !tree.pending ? (
            <tr>
              <td colSpan={6} className="px-3 py-6 type-body text-foreground-secondary">
                {t(dir === 'out' ? 'treeEmptyOut' : 'treeEmptyIn')}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 6: Write the tab**

`apps/web/src/features/internal-links/journey/journey-tab.tsx`:

```tsx
'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListTree, Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { FocusNote } from './focus-note';
import { FocusPicker } from './focus-picker';
import { TreeList } from './tree-list';
import { useNeighborLookup } from './use-neighbor-lookup';
import type { LinksTabContext } from '../tabs';
import { LinkCanvas, type LinkCanvasHandle } from '@/components/app/link-canvas/link-canvas';
import { ZoomControls, type Zoom } from '@/components/app/link-canvas/zoom-controls';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { formatKeySet, formatMore } from '@/lib/internal-links/journey-codec';
import { buildJourney, pruneJourney, READ_LIMIT, type Direction, type JourneyLayout } from '@/lib/internal-links/journey-layout';
import { DEFAULT_PAGE_QUERY, neighborsQuery, pageDetailQuery, pagesQuery } from '@/lib/internal-links/queries';
import type { Neighbor } from '@/lib/internal-links/types';

const EMPTY_LAYOUT: JourneyLayout<Neighbor> = { out: [], in: [], cardCount: 1, requests: [], validKeys: new Set(), pending: true };

/**
 * The Journey tab (spec 7.5, mock `il-journey.js`): the canvas and the tree list share one state, kept in the
 * address: focus, link scope, opened cards, groups and "+N more". The focus defaults to the home page.
 */
export function JourneyTab({ context }: { context: LinksTabContext }): ReactElement {
  const t = useTranslations('internalLinks.journey');
  const common = useTranslations('common');
  const { scope, state, setSearch } = context;
  const queryClient = useQueryClient();
  const home = useQuery({ ...pagesQuery(scope, { ...DEFAULT_PAGE_QUERY, sort: 'path', limit: 1 }), enabled: state.focus === null });
  const focusId = state.focus ?? home.data?.data[0]?.url_id ?? null;
  const focus = useQuery({ ...pageDetailQuery(scope, focusId ?? '1', state.scope), enabled: focusId !== null });
  const [zoom, setZoom] = useState<Zoom>(1);
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  const handle = useRef<LinkCanvasHandle>(null);
  const { lookup, useLoad } = useNeighborLookup(scope);

  const journeyState = useMemo(
    () => ({ focus: focusId ?? '', scope: state.scope, open: state.open, groups: state.groups, more: state.more }),
    [focusId, state.scope, state.open, state.groups, state.more],
  );
  const canvasOn = state.journeyView === 'canvas' && focusId !== null;
  // No layout before the focus is known: a list request needs a url id
  const layout = focusId === null ? EMPTY_LAYOUT : buildJourney<Neighbor>(journeyState, lookup);
  useLoad(canvasOn ? layout.requests : []);

  // Keys of cards whose parent closed are dropped from the address once every list has loaded
  const pruned = canvasOn ? pruneJourney(journeyState, layout) : null;
  useEffect(() => {
    if (pruned === null) return;
    setSearch({ open: formatKeySet(pruned.open), grp: formatKeySet(pruned.groups), more: formatMore(pruned.more) });
  }, [pruned, setSearch]);

  const toggle = (key: string, set: ReadonlySet<string>, param: 'open' | 'grp' | 'topen'): void => {
    const next = new Set(set);
    if (!next.delete(key)) next.add(key);
    setSearch({ [param]: formatKeySet(next) });
  };
  const refocus = (urlId: string): void =>
    setSearch({ focus: urlId, open: null, grp: null, more: null, topen: null }, { history: 'push' });

  const toolbar = (
    <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-3 py-2">
      <SegmentedControl
        semantics="view"
        label={t('view')}
        value={state.journeyView}
        onValueChange={(next) => setSearch({ jv: next === 'canvas' ? null : next })}
        items={[
          { value: 'canvas', label: t('canvas'), icon: Workflow },
          { value: 'tree', label: t('tree'), icon: ListTree },
        ]}
        size="sm"
      />
      <FocusPicker scope={scope} path={focus.data?.data.page.path ?? t('focus')} onPick={refocus} />
      <SegmentedControl
        semantics="radio"
        label={t('linksShown')}
        value={state.scope === 'all' ? 'all' : 'editorial'}
        onValueChange={(next) => setSearch({ scope: next === 'editorial' ? null : next, open: null, grp: null, more: null, topen: null })}
        items={[
          { value: 'editorial', label: t('editorial') },
          { value: 'all', label: t('all') },
        ]}
        size="sm"
      />
      {state.journeyView === 'tree' ? (
        <Select<Direction>
          value={state.treeDir}
          onValueChange={(next) => setSearch({ dir: next === 'out' ? null : next, topen: null })}
          placeholder={t('follow')}
          aria-label={t('follow')}
          options={[
            { value: 'out', label: t('out') },
            { value: 'in', label: t('in') },
          ]}
          size="sm"
        />
      ) : (
        <ZoomControls zoom={zoom} onZoomChange={setZoom} onFit={() => setZoom(handle.current?.fitZoom() ?? 1)} />
      )}
    </div>
  );

  let body: ReactElement;
  if (focus.isError && isApiProblem(focus.error, 'not_found')) {
    body = <EmptyState title={t('notInCrawlTitle')} reason={t('notInCrawlReason')} headingLevel={3} />;
  } else if (focus.isError || home.isError) {
    body = (
      <InlineError
        title={t('loadFailed')}
        reason={t('notInCrawlReason')}
        errorId={null}
        onRetry={() => void focus.refetch()}
        retrying={focus.isFetching}
        retryLabel={common('retry')}
      />
    );
  } else if (focus.data === undefined || focusId === null) {
    body = (
      <div className="flex flex-col gap-2 p-4" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} shape="block" height="row" />
        ))}
      </div>
    );
  } else {
    const page = focus.data.data.page;
    body =
      state.journeyView === 'tree' ? (
        <TreeList
          scope={scope}
          focus={page}
          linkScope={state.scope}
          dir={state.treeDir}
          open={state.treeOpen}
          onToggle={(key) => toggle(key, state.treeOpen, 'topen')}
          onRefocus={refocus}
        />
      ) : (
        <LinkCanvas<Neighbor>
          ref={handle}
          layout={layout}
          focus={{
            urlId: page.url_id,
            path: page.path,
            title: page.title,
            tier: page.tier,
            linkingPages: page.linking_pages,
            linkingPagesAll: page.linking_pages_all,
            statusCode: page.status_code,
            clickDepth: page.click_depth,
          }}
          focusNote={<FocusNote page={page} scope={state.scope} />}
          zoom={zoom}
          pinned={pinned}
          onTogglePin={(key) =>
            setPinned((current) => {
              const next = new Set(current);
              if (!next.delete(key)) next.add(key);
              return next;
            })
          }
          onToggleCard={(key) => toggle(key, state.open, 'open')}
          onToggleGroup={(key) => toggle(key, state.groups, 'grp')}
          onMore={(key) => setSearch({ more: formatMore(new Map([...state.more, [key, (state.more.get(key) ?? 0) + 1]])) })}
          onRefocus={refocus}
          onDetails={context.inspect.open}
          onRetry={(request) => {
            for (let index = 0; index < request.pages; index += 1) {
              const { queryKey } = neighborsQuery(scope, {
                urlId: request.urlId,
                direction: request.direction,
                linkScope: request.scope,
                offset: index * READ_LIMIT,
              });
              void queryClient.refetchQueries({ queryKey });
            }
          }}
          onFull={() => toast({ type: 'info', title: t('full'), description: t('fullText') })}
        />
      );
  }

  return (
    <section aria-labelledby="journey-title" className="overflow-hidden rounded-lg border border-border bg-surface">
      {/* The canvas's column titles are h3: this names the section above them */}
      <h2 id="journey-title" className="sr-only">
        {t('heading')}
      </h2>
      {toolbar}
      {body}
    </section>
  );
}
```

`SegmentedControlItem` takes `icon`, and `Select` passes `aria-label` through to its trigger (`SelectProps` extends the trigger's props).

In `apps/web/src/features/internal-links/tabs.ts`, import `JourneyTab` from `./journey/journey-tab` and add:

```ts
  { id: 'journey', label: (t) => t('tabs.journey'), render: (context) => createElement(JourneyTab, { context }) },
```

- [ ] **Step 7: Run the tests and see them pass**

```bash
pnpm vitest run src/features/internal-links/
```

Expected: PASS.

- [ ] **Step 8: Run the gate and commit**

```bash
git add apps/web/src/features/internal-links/ apps/web/messages/en.json
git commit -m "Internal links: Journey tab with the canvas, the tree list and the focus in the address"
```

---

### Task 12: Tier flow tab

**Files:**
- Create: `apps/web/src/features/internal-links/flow/flow-tab.tsx`, `flow-tab.test.tsx`
- Modify: `apps/web/src/features/internal-links/tabs.ts`, `apps/web/messages/en.json`

Mock: `il-flow.js` (`summaryStrip`, `sentence`, `heatmap`, `heatCell`, `lostRows`) and `08-flow.png`. No equity in the strip (decision W4); the matrix is the mock's table with sequential fills (decision W10).

- [ ] **Step 1: Add the messages**

```json
  "internalLinks": {
    "flow": {
      "stripLabel": "Pages by tier",
      "pages": "{count, plural, one {# page} other {# pages}}",
      "share": "{share} of pages, average depth {depth}",
      "shareNoDepth": "{share} of pages, depth n/a",
      "sentence": "{from} send {count, plural, one {# {scope} link} other {# {scope} links}} to {to}.",
      "sentenceNone": "No pages in other tiers link to {to} pages.",
      "untieredPages": "Untiered pages",
      "rowsToColumns": "Rows link to columns",
      "caption": "Links between tiers",
      "from": "From",
      "to": "To",
      "toTier": "To {tier}",
      "total": "Total",
      "cellName": "{count, plural, one {# {scope} link} other {# {scope} links}} from {from} to {to}, show them",
      "stale": "The tier flow is being worked out again after a tier change.",
      "errorsTitle": "Links to errors and non-indexable pages",
      "errorsText": "Links to these pages do not help a page that can rank. Redirects pass visitors to their target but cost a hop.",
      "errorsCaption": "Error and non-indexable pages",
      "errorsPage": "Page",
      "errorsWhy": "Why",
      "errorsLinking": "Pages linking to it",
      "errorStatus": "Error ({status})",
      "notIndexable": "Not indexable",
      "noErrors": "No error or non-indexable pages in this crawl.",
      "loadFailed": "The tier flow could not be loaded",
      "loadFailedReason": "Try again in a moment."
    }
  },
```

- [ ] **Step 2: Write the failing test**

`apps/web/src/features/internal-links/flow/flow-tab.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { axe } from '@/test/axe';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => document.documentElement.classList.remove('dark'));

describe('the Tier flow tab (spec 7.6)', () => {
  it('shows each tier with its pages and depth, no equity, and Untiered as its own row and column', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=flow' });
    const strip = await screen.findByRole('list', { name: 'Pages by tier' });
    expect(within(strip).getAllByRole('listitem')).toHaveLength(5);
    expect(strip).not.toHaveTextContent(/equity/i);
    const matrix = screen.getByRole('table', { name: 'Links between tiers' });
    expect(within(matrix).getByRole('rowheader', { name: 'Untiered' })).toBeInTheDocument();
    expect(within(matrix).getAllByRole('columnheader', { name: /^To\s/ })).toHaveLength(5);
  });

  it('links each cell to the Links tab filtered to the pair', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=flow' });
    const matrix = await screen.findByRole('table', { name: 'Links between tiers' });
    const cell = await within(matrix).findByRole('link', { name: /editorial links? from T2 Supporting pages to T1 Money pages, show them$/ });
    expect(cell.getAttribute('href')).toMatch(/tab=links&stier=[^&]+&ttier=[^&]+$/);
  });

  it('lists the error and non-indexable pages by how many pages link to them', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=flow' });
    const errors = await screen.findByRole('table', { name: 'Error and non-indexable pages' });
    expect(await within(errors).findByText('/services/threat-hunting')).toBeInTheDocument();
    expect(within(errors).getByText('noindex meta tag')).toBeInTheDocument();
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=flow' });
    await screen.findByRole('table', { name: 'Links between tiers' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 3: Run it and see it fail**

```bash
cd apps/web && pnpm vitest run src/features/internal-links/flow/
```

Expected: FAIL, no list named "Pages by tier".

- [ ] **Step 4: Write the tab and register it**

`apps/web/src/features/internal-links/flow/flow-tab.tsx`:

```tsx
'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, type ReactElement } from 'react';

import { ScopeMenu } from '../scope-menu';
import type { LinksTabContext } from '../tabs';
import { SEQUENTIAL_BINS } from '@/components/app/chart/heat-bins';
import { Banner } from '@/components/app/status/banner';
import { InlineError } from '@/components/app/status/inline-error';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { csvBlob, downloadBlob, safeText } from '@/lib/csv/csv-write';
import { formatDecimal, formatInteger, formatPercent } from '@/lib/format';
import { flowLevel, strongestSenderToT1, tierShares } from '@/lib/internal-links/flow';
import { DEFAULT_PAGE_QUERY, pagesQuery, tierFlowQuery } from '@/lib/internal-links/queries';
import { SCOPE_KEY } from '@/lib/internal-links/scopes';
import { tierPosition } from '@/lib/internal-links/tiers';
import type { PageRow, TierRef } from '@/lib/internal-links/types';
import { withQuery } from '@/lib/routes/paths';
import { cn } from '@/lib/utils';

const CELL = 'px-3';
const ERRORS_LIMIT = 25;
const keyOf = (tier: TierRef | null): string => tier?.tier_id ?? 'none';

/**
 * The Tier flow tab (spec 7.6, mock `il-flow.js`): pages per tier with their share and average depth (no equity),
 * the sentence about what reaches T1, the matrix of unique links from tier to tier in the scope in view (a cell
 * opens the Links tab filtered to the pair), and the error and non-indexable pages links lead to.
 */
export function FlowTab({ context }: { context: LinksTabContext }): ReactElement {
  const t = useTranslations('internalLinks.flow');
  const words = useTranslations('internalLinks');
  const scopeWords = useTranslations('linkCanvas.scope');
  const common = useTranslations('common');
  const { scope, state, setSearch } = context;
  const read = useQuery({ ...tierFlowQuery(scope, state.scope), placeholderData: keepPreviousData });
  const errorPages = useQuery(pagesQuery(scope, { ...DEFAULT_PAGE_QUERY, scope: 'all', status: ['4xx', '5xx'], sort: '-linking_pages', limit: ERRORS_LIMIT }));
  const hiddenPages = useQuery(pagesQuery(scope, { ...DEFAULT_PAGE_QUERY, scope: 'all', status: ['2xx'], indexable: false, sort: '-linking_pages', limit: ERRORS_LIMIT }));
  const flow = read.data?.data;
  const untiered = words('filters.untiered');
  const label = useCallback((tier: TierRef | null): string => (tier === null ? untiered : `${tier.code} ${tier.name}`), [untiered]);
  const scopeWord = scopeWords(SCOPE_KEY[state.scope]);

  const keys = useMemo(
    () => (flow === undefined ? [] : [...flow.tiers].sort((a, b) => tierPosition(a.tier) - tierPosition(b.tier)).map((stat) => stat.tier)),
    [flow],
  );
  const cells = useMemo(() => new Map((flow?.cells ?? []).map((cell) => [`${keyOf(cell.from_tier)}>${keyOf(cell.to_tier)}`, cell.links])), [flow]);
  const max = Math.max(0, ...cells.values());

  const { registerExport } = context;
  useEffect(() => {
    if (flow === undefined) {
      registerExport(null);
      return undefined;
    }
    registerExport(async () => {
      const header = [t('from'), ...keys.map((tier) => t('toTier', { tier: label(tier) })), t('total')];
      const rows = keys.map((from) => {
        const values = keys.map((to) => cells.get(`${keyOf(from)}>${keyOf(to)}`) ?? 0);
        return [safeText(label(from)), ...values, values.reduce((sum, value) => sum + value, 0)];
      });
      downloadBlob(csvBlob({ header, rows }), 'internal-links-tier-flow.csv');
    });
    return () => registerExport(null);
  }, [registerExport, flow, keys, cells, label, t]);

  if (read.isError && flow === undefined) {
    return (
      <InlineError
        title={t('loadFailed')}
        reason={t('loadFailedReason')}
        errorId={null}
        onRetry={() => void read.refetch()}
        retrying={read.isFetching}
        retryLabel={common('retry')}
      />
    );
  }
  if (flow === undefined) return <div aria-busy="true" className="h-40 rounded-lg border border-border bg-surface" />;

  const shares = tierShares([...flow.tiers].sort((a, b) => tierPosition(a.tier) - tierPosition(b.tier)));
  const strongest = strongestSenderToT1(flow.cells);
  const base = context.hrefOf('/seo/internal-links');
  const pairHref = (from: TierRef | null, to: TierRef | null): Route =>
    withQuery(base, new URLSearchParams({ ...(state.scope === 'editorial' ? {} : { scope: state.scope }), tab: 'links', stier: keyOf(from), ttier: keyOf(to) }).toString());
  const errors: PageRow[] = [...(errorPages.data?.data ?? []), ...(hiddenPages.data?.data ?? [])].sort(
    (a, b) => b.linking_pages_all - a.linking_pages_all,
  );

  return (
    <div className="flex flex-col gap-4">
      <ul aria-label={t('stripLabel')} className="flex flex-wrap rounded-lg border border-border bg-surface">
        {shares.rows.map((row) => (
          <li key={keyOf(row.tier)} className="flex min-w-48 flex-1 flex-col gap-1.5 border-r border-border-subtle px-4 py-3 last:border-r-0">
            <TierBadge tier={row.tier} className="self-start" />
            <p className="type-body-strong num text-foreground">{t('pages', { count: row.pages })}</p>
            <p className="type-meta num text-foreground-secondary">
              {row.average_depth === null
                ? t('shareNoDepth', { share: formatPercent(row.share) })
                : t('share', { share: formatPercent(row.share), depth: formatDecimal(row.average_depth, 1) })}
            </p>
          </li>
        ))}
      </ul>
      {strongest === null ? null : (
        <p className="type-body text-foreground">
          {strongest.links === 0
            ? t('sentenceNone', { to: strongest.top.code })
            : t('sentence', {
                from: strongest.from === null ? t('untieredPages') : `${strongest.from.name} (${strongest.from.code})`,
                count: strongest.links,
                scope: scopeWord,
                to: strongest.top.code,
              })}
        </p>
      )}
      {flow.stale ? <Banner tone="info" placement="region" message={t('stale')} /> : null}
      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3">
          <ScopeMenu scope={state.scope} onChange={(next) => setSearch({ scope: next === 'editorial' ? null : next })} />
          <span className="type-meta text-foreground-tertiary">{t('rowsToColumns')}</span>
        </div>
        <div className="overflow-x-auto">
          <table aria-label={t('caption')} className="w-full border-collapse">
            <thead>
              <tr>
                <th scope="col" className={cn(CELL, 'h-row-header border-b border-border bg-surface-subtle text-left type-table-header text-foreground-tertiary')}>
                  {t('from')}
                </th>
                {keys.map((tier) => (
                  <th
                    key={keyOf(tier)}
                    scope="col"
                    aria-label={t('toTier', { tier: label(tier) })}
                    className={cn(CELL, 'h-row-header border-b border-border bg-surface-subtle text-right type-table-header text-foreground-tertiary')}
                  >
                    <span className="inline-flex items-center justify-end gap-1.5">
                      {t('to')} <TierBadge tier={tier} />
                    </span>
                  </th>
                ))}
                <th scope="col" className={cn(CELL, 'h-row-header border-b border-border bg-surface-subtle text-right type-table-header text-foreground-tertiary')}>
                  {t('total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((from) => {
                const values = keys.map((to) => cells.get(`${keyOf(from)}>${keyOf(to)}`) ?? 0);
                return (
                  <tr key={keyOf(from)}>
                    <th scope="row" aria-label={label(from)} className={cn(CELL, 'border-r border-b border-border-subtle text-left')}>
                      <TierBadge tier={from} withName />
                    </th>
                    {keys.map((to, index) => {
                      const value = values[index] ?? 0;
                      const level = flowLevel(value, max);
                      const bin = level === null ? undefined : SEQUENTIAL_BINS[level];
                      return (
                        <td key={keyOf(to)} className="border-b border-border-subtle p-0 text-right">
                          <Link
                            href={pairHref(from, to)}
                            aria-label={t('cellName', { count: value, scope: scopeWord, from: label(from), to: label(to) })}
                            className={cn(
                              'block h-row px-3 py-2 type-table num focus-visible:focus-ring-inset',
                              bin === undefined ? 'text-foreground-tertiary hover:bg-surface-hover' : [bin.fill, bin.text],
                            )}
                          >
                            {formatInteger(value)}
                          </Link>
                        </td>
                      );
                    })}
                    <td className={cn(CELL, 'border-b border-border-subtle text-right type-table num text-foreground')}>
                      {formatInteger(values.reduce((sum, value) => sum + value, 0))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="flow-errors-title" className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex flex-col gap-1 px-4 py-3">
          <h2 id="flow-errors-title" className="type-subsection-title">
            {t('errorsTitle')}
          </h2>
          <p className="type-meta text-foreground-secondary">{t('errorsText')}</p>
        </div>
        {errors.length === 0 ? (
          <p className="px-4 pb-4 type-body text-foreground-secondary">{t('noErrors')}</p>
        ) : (
          <table aria-label={t('errorsCaption')} className="w-full border-collapse">
            <thead>
              <tr>
                {[t('errorsPage'), t('errorsWhy')].map((header) => (
                  <th key={header} scope="col" className={cn(CELL, 'h-row-header border-y border-border bg-surface-subtle text-left type-table-header text-foreground-tertiary')}>
                    {header}
                  </th>
                ))}
                <th scope="col" className={cn(CELL, 'h-row-header border-y border-border bg-surface-subtle text-right type-table-header text-foreground-tertiary')}>
                  {t('errorsLinking')}
                </th>
              </tr>
            </thead>
            <tbody>
              {errors.map((row) => (
                <tr key={row.url_id} className="h-row-compact border-b border-border-subtle">
                  <td className={cn(CELL, 'type-table')}>{row.path}</td>
                  <td className={cn(CELL, 'type-table text-foreground-secondary')}>
                    {(row.status_code ?? 0) >= 400 ? t('errorStatus', { status: row.status_code ?? 0 }) : (row.non_indexable_reason ?? t('notIndexable'))}
                  </td>
                  <td className={cn(CELL, 'text-right type-table num')}>{formatInteger(row.linking_pages_all)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
```

In `apps/web/src/features/internal-links/tabs.ts`, import `FlowTab` from `./flow/flow-tab` and add:

```ts
  { id: 'flow', label: (t) => t('tabs.flow'), render: (context) => createElement(FlowTab, { context }) },
```

- [ ] **Step 5: Run the tests and see them pass**

```bash
pnpm vitest run src/features/internal-links/
```

Expected: PASS.

- [ ] **Step 6: Run the gate and commit**

```bash
git add apps/web/src/features/internal-links/ apps/web/messages/en.json
git commit -m "Internal links: Tier flow tab"
```

---

### Task 13: Tier rules and the CSV import

**Files:**
- Create: `apps/web/src/features/internal-links/rules/rule-changes.ts`, `rule-changes.test.ts`, `rules-dialog.tsx`, `import-dialog.tsx`, `dialogs.test.tsx`
- Modify: `apps/web/src/features/internal-links/internal-links-screen.tsx`, `apps/web/messages/en.json`

Mock: `il-dialogs.js` (`openRules`, `openImportTiers`) and `11-rules.png`. Rules save as a diff (decision W15), previews are counts (W16), the import checks on the client first (W14). A rule always names a tier (open point P2).

- [ ] **Step 1: Add the messages**

```json
  "internalLinks": {
    "rules": {
      "open": "Tier rules",
      "title": "Tier rules",
      "description": "Rules tag pages by URL. The first matching rule wins, and a tier set by hand always beats a rule.",
      "listLabel": "Rules in order",
      "match": "Rule {position} match type",
      "path": "Rule {position} path",
      "tier": "Rule {position} tier",
      "up": "Move rule {position} up",
      "down": "Move rule {position} down",
      "delete": "Delete rule {position}",
      "exact": "Path is",
      "prefix": "Path starts with",
      "pattern": "Path matches",
      "matches": "Matches {count, plural, one {# page} other {# pages}}",
      "enterPath": "Enter a path to see matches",
      "pathRequired": "Enter a path.",
      "pathSlash": "Start the path with a slash.",
      "empty": "No rules yet. Add a rule to tag pages by URL, for example everything under /services/ as T1.",
      "add": "Add rule",
      "save": "Save rules",
      "saved": "Rules saved",
      "savedText": "{count, plural, one {# rule} other {# rules}} saved.",
      "failed": "Rule {position} could not be saved. The rules before it are saved.",
      "discardTitle": "Discard unsaved changes?",
      "discardText": "Your edits to the rules will be lost.",
      "keepEditing": "Keep editing",
      "discard": "Discard changes",
      "chooseTier": "Choose a tier",
      "setUp": "Set up tier rules"
    },
    "csv": {
      "open": "Import tiers from CSV",
      "title": "Import tiers from CSV",
      "description": "One page on each line: the URL, then the tier code or name. Pages you list get a tier set by hand.",
      "field": "Tiers as CSV",
      "placeholder": "url,tier",
      "check": "Check",
      "nothing": "Nothing to import. Add one URL and tier on each line.",
      "rowsCaption": "Rows to import",
      "line": "Line",
      "url": "URL",
      "tier": "Tier",
      "errorsTitle": "Fix these lines first",
      "unknownTier": "Line {line}: “{value}” is not a tier of this workspace.",
      "missingColumn": "Line {line}: give a URL and a tier.",
      "tooManyRows": "Line {line}: at most 20,000 rows at once.",
      "apply": "Apply {count, plural, one {# tier} other {# tiers}}",
      "applyNone": "Apply tiers",
      "imported": "Tiers imported",
      "importedText": "{count, plural, one {# page} other {# pages}} tagged.",
      "pending": "{count, plural, one {# row waits} other {# rows wait}} for a crawl that finds its URL.",
      "failed": "The tiers could not be imported",
      "serverErrors": "The import found problems. Nothing was changed.",
      "discardTitle": "Discard the CSV text?",
      "discardText": "The lines you pasted will be lost.",
      "keepEditing": "Keep editing",
      "discard": "Discard"
    }
  },
```

- [ ] **Step 2: Write the failing diff test**

`apps/web/src/features/internal-links/rules/rule-changes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { ruleChanges, type DraftRule } from './rule-changes';

const saved = [
  { rule_id: 'a', position: 1, match_type: 'prefix' as const, value: '/services/', tier: { tier_id: 't1', code: 'T1', name: 'Money pages' } },
  { rule_id: 'b', position: 2, match_type: 'pattern' as const, value: '/blog/*', tier: { tier_id: 't3', code: 'T3', name: 'Content pages' } },
];
const draft = (rule: Partial<DraftRule> & Pick<DraftRule, 'key'>): DraftRule => ({ ruleId: null, matchType: 'exact', value: '/', tierId: 't1', ...rule });

describe('ruleChanges (decision W15)', () => {
  it('finds nothing to do for an unchanged list', () => {
    const same = saved.map((rule) => draft({ key: rule.rule_id, ruleId: rule.rule_id, matchType: rule.match_type, value: rule.value, tierId: rule.tier.tier_id }));
    expect(ruleChanges(saved, same)).toEqual({ deletes: [], patches: [], creates: [] });
  });

  it('deletes, then patches with the new positions, then creates', () => {
    const next = [
      draft({ key: 'n', matchType: 'exact', value: '/pricing', tierId: 't1' }),
      draft({ key: 'b', ruleId: 'b', matchType: 'pattern', value: '/blog/*', tierId: 't2' }),
    ];
    expect(ruleChanges(saved, next)).toEqual({
      deletes: ['a'],
      patches: [{ ruleId: 'b', body: { tier_id: 't2', position: 2 } }],
      creates: [{ match_type: 'exact', value: '/pricing', tier_id: 't1', position: 1 }],
    });
  });
});
```

- [ ] **Step 3: Run it and see it fail**

```bash
cd apps/web && pnpm vitest run src/features/internal-links/rules/
```

Expected: FAIL, `Failed to resolve import "./rule-changes"`.

- [ ] **Step 4: Write the diff**

`apps/web/src/features/internal-links/rules/rule-changes.ts`:

```ts
import type { TierRuleView } from '@/lib/internal-links/types';

export type MatchType = TierRuleView['match_type'];

/** A row of the rules dialog. `key` is stable while the person edits; `ruleId` is `null` for a new rule. */
export interface DraftRule {
  key: string;
  ruleId: string | null;
  matchType: MatchType;
  value: string;
  tierId: string;
}

export interface RuleChanges {
  deletes: string[];
  patches: { ruleId: string; body: Partial<{ match_type: MatchType; value: string; tier_id: string; position: number }> }[];
  creates: { match_type: MatchType; value: string; tier_id: string; position: number }[];
}

/**
 * The calls that turn the saved rules into the draft (gap G7 asks for one bulk save): delete the removed rules,
 * patch the changed ones (a position that moved counts), then create the new ones at their positions. Sent in that
 * order, the positions the API keeps end as the draft's.
 */
export function ruleChanges(saved: readonly Pick<TierRuleView, 'rule_id' | 'position' | 'match_type' | 'value' | 'tier'>[], draft: readonly DraftRule[]): RuleChanges {
  const kept = new Set(draft.flatMap((rule) => (rule.ruleId === null ? [] : [rule.ruleId])));
  const deletes = saved.filter((rule) => !kept.has(rule.rule_id)).map((rule) => rule.rule_id);
  const patches: RuleChanges['patches'] = [];
  const creates: RuleChanges['creates'] = [];
  draft.forEach((rule, index) => {
    const position = index + 1;
    if (rule.ruleId === null) {
      creates.push({ match_type: rule.matchType, value: rule.value, tier_id: rule.tierId, position });
      return;
    }
    const before = saved.find((candidate) => candidate.rule_id === rule.ruleId);
    if (before === undefined) return;
    const body = {
      ...(before.match_type === rule.matchType ? {} : { match_type: rule.matchType }),
      ...(before.value === rule.value ? {} : { value: rule.value }),
      ...(before.tier.tier_id === rule.tierId ? {} : { tier_id: rule.tierId }),
    };
    const remaining = saved.filter((candidate) => !deletes.includes(candidate.rule_id));
    const moved = remaining.findIndex((candidate) => candidate.rule_id === rule.ruleId) + 1 !== position;
    if (Object.keys(body).length > 0 || moved) patches.push({ ruleId: rule.ruleId, body: { ...body, position } });
  });
  return { deletes, patches, creates };
}
```

Run `pnpm vitest run src/features/internal-links/rules/rule-changes.test.ts`. Expected: PASS.

- [ ] **Step 5: Write the two dialogs**

`apps/web/src/features/internal-links/rules/rules-dialog.tsx`:

```tsx
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState, type ReactElement } from 'react';

import { ruleChanges, type DraftRule, type MatchType } from './rule-changes';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { api, unwrap } from '@/lib/api/client';
import { useDebouncedValue } from '@/lib/dom/use-debounced-value';
import { createRuleMutation, deleteRuleMutation, updateRuleMutation } from '@/lib/internal-links/mutations';
import { internalLinksKeys, tierRulesQuery } from '@/lib/internal-links/queries';
import type { LinksScope, PageTier } from '@/lib/internal-links/types';

const MATCHES: readonly MatchType[] = ['exact', 'prefix', 'pattern'];
const PREVIEW = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tier-rules/preview';

/** "Matches N pages" of one draft rule (decision W16), asked 300 ms after the person stops typing. */
function RulePreview({ scope, rule, position }: { scope: LinksScope; rule: DraftRule; position: number }): ReactElement {
  const t = useTranslations('internalLinks.rules');
  const value = useDebouncedValue(rule.value.trim(), 300);
  const preview = useQuery({
    queryKey: ['ws', scope.workspaceId, 'p', scope.projectId, 'tier-rules', 'preview', { match: rule.matchType, value, position, rule: rule.ruleId }],
    enabled: value.startsWith('/'),
    queryFn: ({ signal }) =>
      unwrap(
        api.POST(PREVIEW, {
          params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
          body: { match_type: rule.matchType, value, position, ...(rule.ruleId === null ? {} : { rule_id: rule.ruleId }) },
          signal,
        }),
      ),
  });
  return (
    <span className="type-meta num text-foreground-tertiary" aria-live="polite">
      {value === '' || preview.data === undefined ? t('enterPath') : t('matches', { count: preview.data.data.would_apply })}
    </span>
  );
}

/** Tier rules (spec 5.2, mock `openRules`): ordered rows of match type, path and tier, saved together. */
export function RulesDialog({
  open,
  onOpenChange,
  scope,
  tiers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: LinksScope;
  tiers: readonly PageTier[];
}): ReactElement {
  const t = useTranslations('internalLinks.rules');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const saved = useQuery({ ...tierRulesQuery(scope), enabled: open });
  const create = useMutation(createRuleMutation);
  const update = useMutation(updateRuleMutation);
  const remove = useMutation(deleteRuleMutation);
  const baseId = useId();
  // `null` until the person edits: the saved rules are shown as they are
  const [draftState, setDraftState] = useState<DraftRule[] | null>(null);
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const base = useMemo(
    () =>
      (saved.data?.data ?? []).map((rule) => ({ key: rule.rule_id, ruleId: rule.rule_id, matchType: rule.match_type, value: rule.value, tierId: rule.tier.tier_id })),
    [saved.data],
  );
  const rows = draftState ?? base;
  const setDraft = (change: (current: DraftRule[]) => DraftRule[]): void => setDraftState((current) => change(current ?? base));
  const close = (next: boolean): void => {
    if (!next) {
      setDraftState(null);
      setErrors(new Map());
    }
    onOpenChange(next);
  };
  const changes = saved.data === undefined ? null : ruleChanges(saved.data.data, rows);
  const dirty = changes !== null && changes.deletes.length + changes.patches.length + changes.creates.length > 0;
  const edit = (key: string, change: Partial<DraftRule>): void =>
    setDraft((current) => current.map((rule) => (rule.key === key ? { ...rule, ...change } : rule)));
  const move = (index: number, step: number): void =>
    setDraft((current) => {
      const next = [...current];
      const [rule] = next.splice(index, 1);
      if (rule !== undefined) next.splice(index + step, 0, rule);
      return next;
    });
  const path = { workspace_id: scope.workspaceId, project_id: scope.projectId };
  const addRule = (): void =>
    setDraft((current) => [...current, { key: `new-${String(Date.now())}`, ruleId: null, matchType: 'prefix', value: '/', tierId: tiers[0]?.tier_id ?? '' }]);

  const save = async (): Promise<void> => {
    const problems = new Map<string, string>();
    for (const rule of rows) {
      if (rule.value.trim() === '') problems.set(rule.key, t('pathRequired'));
      else if (!rule.value.trim().startsWith('/')) problems.set(rule.key, t('pathSlash'));
    }
    setErrors(problems);
    if (problems.size > 0 || changes === null) return;
    setSaving(true);
    let position = 0;
    try {
      for (const ruleId of changes.deletes) await remove.mutateAsync({ params: { path: { ...path, rule_id: ruleId } } });
      for (const patch of changes.patches) {
        position = patch.body.position ?? 0;
        await update.mutateAsync({ params: { path: { ...path, rule_id: patch.ruleId } }, body: patch.body });
      }
      for (const body of changes.creates) {
        position = body.position;
        await create.mutateAsync({ params: { path }, body: { ...body, value: body.value.trim() } });
      }
      toast({ type: 'success', title: t('saved'), description: t('savedText', { count: rows.length }) });
      close(false);
    } catch {
      toast({ type: 'error', title: t('failed', { position }) });
    } finally {
      setSaving(false);
      for (const queryKey of internalLinksKeys(scope)) void queryClient.invalidateQueries({ queryKey });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="lg"
      dirty={dirty}
      discard={{ title: t('discardTitle'), description: t('discardText'), keepEditingLabel: t('keepEditing'), discardLabel: t('discard') }}
    >
      <DialogHeader title={t('title')} description={t('description')} closeLabel={common('close')} />
      <DialogBody>
        {rows.length === 0 ? (
          <p className="rounded-lg border border-border-subtle bg-surface-subtle px-4 py-6 type-body text-foreground-secondary">{t('empty')}</p>
        ) : (
          <ol aria-label={t('listLabel')} className="flex flex-col gap-3">
            {rows.map((rule, index) => {
              const position = index + 1;
              const error = errors.get(rule.key);
              return (
                <li key={rule.key} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-6 type-label num text-foreground-tertiary">{position}</span>
                    <Select<MatchType>
                      aria-label={t('match', { position })}
                      value={rule.matchType}
                      onValueChange={(matchType) => edit(rule.key, { matchType })}
                      placeholder={t('exact')}
                      options={MATCHES.map((value) => ({ value, label: t(value) }))}
                      size="sm"
                      className="w-40"
                    />
                    <Input
                      aria-label={t('path', { position })}
                      aria-invalid={error === undefined ? undefined : true}
                      aria-describedby={error === undefined ? undefined : `${baseId}-${rule.key}`}
                      value={rule.value}
                      onValueChange={(value) => edit(rule.key, { value })}
                      size="sm"
                      className="min-w-40 flex-1"
                    />
                    <Select<string>
                      aria-label={t('tier', { position })}
                      value={rule.tierId}
                      onValueChange={(tierId) => edit(rule.key, { tierId })}
                      placeholder={t('chooseTier')}
                      options={tiers.map((tier) => ({ value: tier.tier_id, label: tier.label }))}
                      size="sm"
                      className="w-48"
                    />
                    <IconButton icon={ChevronUp} size="icon-sm" label={t('up', { position })} disabled={index === 0} onClick={() => move(index, -1)} />
                    <IconButton icon={ChevronDown} size="icon-sm" label={t('down', { position })} disabled={index === rows.length - 1} onClick={() => move(index, 1)} />
                    <IconButton
                      icon={Trash2}
                      size="icon-sm"
                      label={t('delete', { position })}
                      onClick={() => setDraft((current) => current.filter((candidate) => candidate.key !== rule.key))}
                    />
                  </div>
                  <div className="flex items-center gap-3 pl-8">
                    {error === undefined ? null : (
                      <span id={`${baseId}-${rule.key}`} className="type-meta text-negative-text">
                        {error}
                      </span>
                    )}
                    <RulePreview scope={scope} rule={rule} position={position} />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <Button
          variant="secondary"
          size="sm"
          icon={Plus}
          className="mt-3 self-start"
          disabled={tiers.length === 0}
          onClick={addRule}
        >
          {t('add')}
        </Button>
      </DialogBody>
      <DialogFooter
        primary={
          <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
            {t('save')}
          </Button>
        }
        secondary={
          <Button variant="secondary" onClick={() => close(false)}>
            {common('cancel')}
          </Button>
        }
      />
    </Dialog>
  );
}
```

`apps/web/src/features/internal-links/rules/import-dialog.tsx`:

```tsx
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { Banner } from '@/components/app/status/banner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { importTiersMutation } from '@/lib/internal-links/mutations';
import { internalLinksKeys } from '@/lib/internal-links/queries';
import { parseTierCsv, type CsvTierError, type CsvTierRow } from '@/lib/internal-links/tier-csv';
import type { LinksScope, PageTier, TierImportResult } from '@/lib/internal-links/types';

/** Import tiers from CSV (spec 5.2, mock `openImportTiers`): Check on the client (decision W14), then Apply. */
export function ImportDialog({
  open,
  onOpenChange,
  scope,
  tiers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: LinksScope;
  tiers: readonly PageTier[];
}): ReactElement {
  const t = useTranslations('internalLinks.csv');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const apply = useMutation(importTiersMutation);
  const [text, setText] = useState('');
  const [checked, setChecked] = useState<{ rows: CsvTierRow[]; errors: CsvTierError[] } | null>(null);
  const [server, setServer] = useState<TierImportResult | null>(null);
  const labelOf = (tierId: string): string => tiers.find((tier) => tier.tier_id === tierId)?.label ?? '';
  const errorText = (error: CsvTierError): string =>
    error.code === 'unknown_tier'
      ? t('unknownTier', { line: error.line, value: error.value })
      : error.code === 'missing_column'
        ? t('missingColumn', { line: error.line })
        : t('tooManyRows', { line: error.line });
  const ready = checked !== null && checked.rows.length > 0 && checked.errors.length === 0;

  const submit = (): void =>
    apply.mutate(
      { params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } }, body: { csv: text } },
      {
        onSuccess: (answer) => {
          const result = answer.data;
          for (const queryKey of internalLinksKeys(scope)) void queryClient.invalidateQueries({ queryKey });
          if (!result.applied) {
            setServer(result);
            return;
          }
          toast({
            type: 'success',
            title: t('imported'),
            description: [t('importedText', { count: result.accepted }), ...(result.pending.length === 0 ? [] : [t('pending', { count: result.pending.length })])].join(' '),
          });
          setText('');
          setChecked(null);
          onOpenChange(false);
        },
        onError: () => toast({ type: 'error', title: t('failed') }),
      },
    );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      dirty={text !== ''}
      discard={{ title: t('discardTitle'), description: t('discardText'), keepEditingLabel: t('keepEditing'), discardLabel: t('discard') }}
    >
      <DialogHeader title={t('title')} description={t('description')} closeLabel={common('close')} />
      <DialogBody>
        <Field>
          <FieldLabel>{t('field')}</FieldLabel>
          <Textarea
            value={text}
            placeholder={t('placeholder')}
            onChange={(event) => {
              setText(event.target.value);
              setChecked(null);
              setServer(null);
            }}
          />
        </Field>
        <Button variant="secondary" size="sm" className="mt-2 self-start" onClick={() => setChecked(parseTierCsv(text, tiers))}>
          {t('check')}
        </Button>
        {checked === null ? null : checked.rows.length === 0 && checked.errors.length === 0 ? (
          <p className="mt-3 type-body text-foreground-secondary">{t('nothing')}</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {checked.errors.length === 0 ? null : (
              <Banner tone="negative" placement="region" lead={t('errorsTitle')} message={checked.errors.map(errorText).join(' ')} />
            )}
            {checked.rows.length === 0 ? null : (
              <table aria-label={t('rowsCaption')} className="w-full border-collapse">
                <thead>
                  <tr>
                    {[t('line'), t('url'), t('tier')].map((header) => (
                      <th key={header} scope="col" className="h-row-header border-b border-border bg-surface-subtle px-3 text-left type-table-header text-foreground-tertiary">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {checked.rows.slice(0, 50).map((row) => (
                    <tr key={row.line} className="h-row-compact border-b border-border-subtle">
                      <td className="px-3 type-table num">{row.line}</td>
                      <td className="max-w-72 truncate px-3 type-table">{row.url}</td>
                      <td className="px-3 type-table">{labelOf(row.tierId)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {server === null ? null : (
          <Banner
            tone="negative"
            placement="region"
            className="mt-3"
            lead={t('serverErrors')}
            message={server.errors.map((error) => error.message).join(' ')}
          />
        )}
      </DialogBody>
      <DialogFooter
        primary={
          <Button variant="primary" disabled={!ready} loading={apply.isPending} onClick={submit}>
            {ready ? t('apply', { count: checked.rows.length }) : t('applyNone')}
          </Button>
        }
        secondary={
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {common('cancel')}
          </Button>
        }
      />
    </Dialog>
  );
}
```

- [ ] **Step 6: Open them from the page**

In `apps/web/src/features/internal-links/internal-links-screen.tsx`, import `ListFilter` and `Upload` from `lucide-react`, `RulesDialog` from `./rules/rules-dialog` and `ImportDialog` from `./rules/import-dialog`; add `const [dialog, setDialog] = useState<'rules' | 'import' | null>(null);` and, for members who may write,

```tsx
  const ruleItems: MenuItemDef[] = canWrite
    ? [
        { id: 'rules', label: t('rules.open'), icon: ListFilter, onSelect: () => setDialog('rules') },
        { id: 'import', label: t('csv.open'), icon: Upload, onSelect: () => setDialog('import') },
      ]
    : [];
  const ruleButtons = canWrite ? (
    <>
      <Button variant="secondary" size="sm" onClick={() => setDialog('rules')}>
        {t('rules.setUp')}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setDialog('import')}>
        {t('csv.open')}
      </Button>
    </>
  ) : undefined;
```

(`MenuItemDef` from `@/components/ui/menu`; `canWrite` is the `useCan('projects:write')` of Task 9: move its line above these). Pass `extraItems={ruleItems}` to `CrawlHeader`, `actions={ruleButtons}` to `FirstCrawl` (the mock's "Set up tier rules" and "Import tiers from CSV" while the first crawl runs), and mount the two dialogs inside `InspectorLayout`, after the content `div`:

```tsx
      <RulesDialog open={dialog === 'rules'} onOpenChange={(next) => setDialog(next ? 'rules' : null)} scope={scope} tiers={tiers.data?.data ?? []} />
      <ImportDialog open={dialog === 'import'} onOpenChange={(next) => setDialog(next ? 'import' : null)} scope={scope} tiers={tiers.data?.data ?? []} />
```

- [ ] **Step 7: Write the dialog test, run it, see it pass**

`apps/web/src/features/internal-links/rules/dialogs.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

describe('tier rules and the CSV import (spec 5.2)', () => {
  it('lists the rules with live match counts and saves a new one', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Tier rules' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tier rules' });
    expect(await within(dialog).findAllByText(/^Matches \d+ pages?$/)).toHaveLength(2);
    await user.click(within(dialog).getByRole('button', { name: 'Add rule' }));
    const path = within(dialog).getByRole('textbox', { name: 'Rule 3 path' });
    await user.clear(path);
    await user.type(path, '/industries/');
    await user.click(within(dialog).getByRole('button', { name: 'Save rules' }));
    expect(await screen.findByText('3 rules saved.')).toBeInTheDocument();
  });

  it('checks the CSV, names a bad line, then applies a good one', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Import tiers from CSV' }));
    const dialog = await screen.findByRole('dialog', { name: 'Import tiers from CSV' });
    const field = within(dialog).getByRole('textbox', { name: 'Tiers as CSV' });
    await user.type(field, '/about,T9');
    await user.click(within(dialog).getByRole('button', { name: 'Check' }));
    expect(within(dialog).getByText(/Line 1: “T9” is not a tier of this workspace\./)).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, '/about,T3');
    await user.click(within(dialog).getByRole('button', { name: 'Check' }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply 1 tier' }));
    expect(await screen.findByText('1 page tagged.')).toBeInTheDocument();
  });
});
```

```bash
pnpm vitest run src/features/internal-links/
```

Expected: PASS.

- [ ] **Step 8: Run the gate and commit**

```bash
git add apps/web/src/features/internal-links/ apps/web/messages/en.json
git commit -m "Internal links: tier rules with live counts and the CSV import with a check step"
```

---

### Task 14: Workspace "Page tiers" and project "Internal links" settings

**Files:**
- Create: `apps/web/src/features/workspace-settings/page-tiers/page-tiers-screen.tsx`, `tier-dialogs.tsx`, `index.ts`, `page-tiers.test.tsx`
- Create: `apps/web/src/features/project-settings/internal-links-screen.tsx`, `internal-links-settings.test.tsx`
- Create: `apps/web/src/app/[workspace]/settings/(sections)/tiers/page.tsx`, `apps/web/src/app/[workspace]/[project]/settings/tiers/page.tsx`, `apps/web/src/app/[workspace]/[project]/settings/links/page.tsx`
- Modify: `apps/web/src/features/settings/settings-frame.tsx`, `apps/web/src/features/project-settings/index.ts`, `apps/web/messages/en.json`

Mock: `il-settings.js` (`mountPageTiers`, `openRename`, `removeTier`, `mountInternalLinks`) and `10-settings-tiers.png`. The mock's alert rules and "Map internal links when a website is added" are left out (slice 2, gap G9).

- [ ] **Step 1: Add the messages**

```json
  "settings": {
    "items": {
      "tiers": "Page tiers",
      "links": "Internal links"
    }
  },
  "pageTiers": {
    "title": "Page tiers",
    "description": "Every project in this workspace uses these tiers. T1 is the most important. Names and descriptions show wherever a tier is chosen.",
    "caption": "Page tiers",
    "code": "Tier",
    "name": "Name",
    "tierDescription": "Description",
    "pages": "Pages",
    "actions": "Actions",
    "noDescription": "No description",
    "untieredDescription": "Pages with no tier set and no matching rule",
    "always": "Always there",
    "rename": "Rename",
    "renameName": "Rename {label}",
    "delete": "Delete",
    "deleteName": "Delete {label}",
    "add": "Add tier",
    "addFull": "A workspace can have up to 8 tiers",
    "newName": "New tier",
    "readOnly": "Only owners and admins of the workspace can change the tiers.",
    "renameTitle": "Rename tier",
    "renameDescription": "{code} keeps its code. The name and description show wherever a tier is chosen.",
    "nameLabel": "Name",
    "nameHint": "1 to 60 characters",
    "nameError": "Use 1 to 60 characters.",
    "descriptionLabel": "Description",
    "descriptionHint": "Up to 200 characters",
    "descriptionError": "Use 200 characters or fewer.",
    "save": "Save",
    "saved": "Tier saved",
    "deleteTitle": "Delete {code}?",
    "deleteConfirm": "Delete {code}",
    "untiered": "Untiered",
    "deleteEmpty": "{label} has no pages and no rules.",
    "deleteInUse": "{pages, plural, one {# page} other {# pages}} and {rules, plural, one {# rule} other {# rules}} use {label}. Move them to:",
    "moveTo": "Move pages and rules to",
    "closeUp": "Codes close up: {from} becomes {to}.",
    "deleted": "Tier deleted",
    "added": "Tier added",
    "failed": "The tiers could not be changed",
    "loadFailed": "The tiers could not be loaded",
    "loadFailedReason": "Try again in a moment."
  },
  "internalLinksSettings": {
    "title": "Internal links",
    "description": "How this project’s website is crawled to map the links between its pages. Changes apply as soon as you make them.",
    "schedule": "Schedule",
    "scheduleHint": "Runs at night in the project’s time zone",
    "weekly": "Weekly",
    "everyTwoWeeks": "Every two weeks",
    "monthly": "Monthly",
    "off": "Off",
    "renderJavascript": "Render JavaScript",
    "renderJavascriptHint": "For sites that build their pages in the browser. Costs 10 times as much per page.",
    "subdomains": "Allowed subdomains",
    "subdomainsHint": "Comma separated, for example blog.{host}. Leave empty to crawl only {host}.",
    "subdomainsError": "Give at most 10 hosts, separated by commas.",
    "saveSubdomains": "Save subdomains",
    "saved": "Saved",
    "failed": "The setting could not be saved",
    "recent": "Recent crawls",
    "recentCaption": "Recent crawls",
    "when": "When",
    "startedBy": "Started by",
    "crawlPages": "Pages",
    "cost": "Cost",
    "state": "State",
    "trigger": {
      "websiteAdded": "Website added",
      "schedule": "Schedule",
      "manual": "Crawl now",
      "ceilingRetry": "Higher limit"
    },
    "states": {
      "queued": "Queued",
      "crawling": "Crawling",
      "processing": "Processing",
      "ready": "Ready",
      "stoppedAtCeiling": "Stopped at the limit",
      "failed": "Failed",
      "cancelled": "Cancelled"
    },
    "noCrawls": "No crawl yet.",
    "open": "Open Internal links",
    "loadFailed": "The settings could not be loaded"
  },
```

The `trigger` and `states` keys are camelCase (the catalog test requires it); `TRIGGER_KEY` and `STATE_KEY` in the screen map the API's values to them.

- [ ] **Step 2: Write the failing tests**

`apps/web/src/features/workspace-settings/page-tiers/page-tiers.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PageTiersScreen } from './page-tiers-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/settings/tiers',
  useSearchParams: () => new URLSearchParams(),
}));

function screenAs(role: Role) {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <PageTiersScreen workspaceId={MOCK_WORKSPACE.workspace_id} />
    </PermissionProvider>
  );
}

describe('Page tiers (spec 5.1 and 7.7)', () => {
  it('lists the four default tiers and the fixed Untiered row', async () => {
    renderWithProviders(screenAs('owner'));
    const table = await screen.findByRole('table', { name: 'Page tiers' });
    expect(await within(table).findByText('Money pages')).toBeInTheDocument();
    expect(within(table).getByText('Always there')).toBeInTheDocument();
  });

  it('renames a tier and keeps its code', async () => {
    const { user } = renderWithProviders(screenAs('owner'));
    await user.click(await screen.findByRole('button', { name: 'Rename T4 Utility pages' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename tier' });
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Legal and utility');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Legal and utility')).toBeInTheDocument();
  });

  it('asks where the pages and rules go before deleting a tier in use', async () => {
    const { user } = renderWithProviders(screenAs('owner'));
    await user.click(await screen.findByRole('button', { name: 'Delete T1 Money pages' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete T1?' });
    expect(within(dialog).getByText(/use T1 Money pages\. Move them to:$/)).toBeInTheDocument();
    expect(within(dialog).getByText('Codes close up: T2 becomes T1.')).toBeInTheDocument();
  });

  it('shows the list read-only to an editor', async () => {
    renderWithProviders(screenAs('editor'));
    await screen.findByRole('table', { name: 'Page tiers' });
    expect(screen.queryByRole('button', { name: 'Add tier' })).toBeNull();
    expect(screen.getByText('Only owners and admins of the workspace can change the tiers.')).toBeInTheDocument();
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(screenAs('owner'));
    await screen.findByText('Money pages');
    expect(await axe(container)).toHaveNoViolations();
    document.documentElement.classList.remove('dark');
  });
});
```

`apps/web/src/features/project-settings/internal-links-settings.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InternalLinksSettingsScreen } from './internal-links-screen';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { EVENTUS } from '@/mocks/internal-links-world';
import { SESSION_COOKIE } from '@/mocks/session';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/settings/links',
  useSearchParams: () => new URLSearchParams(),
}));

describe('Project settings > Internal links (spec 7.8)', () => {
  it('saves Render JavaScript at once and lists the recent crawls', async () => {
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    const { user } = renderWithProviders(
      <PermissionProvider membership={membershipFactory('editor')}>
        <InternalLinksSettingsScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          projectId={EVENTUS.project_id}
          projectSlug={EVENTUS.slug}
          host="eventussecurity.com"
          timeZone={EVENTUS.timezone}
        />
      </PermissionProvider>,
    );
    const toggle = await screen.findByRole('switch', { name: 'Render JavaScript' });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Recent crawls' })).toHaveTextContent('Ready');
  });
});
```

Run `cd apps/web && pnpm vitest run src/features/workspace-settings/page-tiers/ src/features/project-settings/internal-links-settings.test.tsx`. Expected: FAIL, the screens do not exist.

- [ ] **Step 3: Write the Page tiers screen and its dialogs**

`apps/web/src/features/workspace-settings/page-tiers/tier-dialogs.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { PageTier } from '@/lib/internal-links/types';

const NAME_MAX = 60;
const DESCRIPTION_MAX = 200;

/** Rename a tier (spec 5.1): name 1 to 60 characters, description up to 200; the code stays. */
export function RenameTierDialog({
  tier,
  pending,
  onClose,
  onSave,
}: {
  tier: PageTier | null;
  pending: boolean;
  onClose: () => void;
  onSave: (name: string, description: string) => void;
}): ReactElement {
  const t = useTranslations('pageTiers');
  const common = useTranslations('common');
  const [name, setName] = useState(tier?.name ?? '');
  const [description, setDescription] = useState(tier?.description ?? '');
  const [tried, setTried] = useState(false);
  const nameBad = name.trim().length < 1 || name.trim().length > NAME_MAX;
  const descriptionBad = description.trim().length > DESCRIPTION_MAX;
  return (
    <Dialog open={tier !== null} onOpenChange={(open) => (open ? undefined : onClose())} size="sm">
      <DialogHeader title={t('renameTitle')} description={t('renameDescription', { code: tier?.code ?? '' })} closeLabel={common('close')} />
      <DialogBody>
        <Field invalid={tried && nameBad}>
          <FieldLabel>{t('nameLabel')}</FieldLabel>
          <Input value={name} onValueChange={setName} />
          <FieldDescription>{t('nameHint')}</FieldDescription>
          {tried && nameBad ? <FieldError message={t('nameError')} /> : null}
        </Field>
        <Field invalid={tried && descriptionBad}>
          <FieldLabel>{t('descriptionLabel')}</FieldLabel>
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
          <FieldDescription>{t('descriptionHint')}</FieldDescription>
          {tried && descriptionBad ? <FieldError message={t('descriptionError')} /> : null}
        </Field>
      </DialogBody>
      <DialogFooter
        primary={
          <Button
            variant="primary"
            loading={pending}
            onClick={() => {
              setTried(true);
              if (!nameBad && !descriptionBad) onSave(name.trim(), description.trim());
            }}
          >
            {t('save')}
          </Button>
        }
        secondary={
          <Button variant="secondary" onClick={onClose}>
            {common('cancel')}
          </Button>
        }
      />
    </Dialog>
  );
}

/**
 * Delete a tier (spec 5.1): one in use asks where its pages and rules go (another tier or Untiered) and says that
 * the codes close up; an unused one asks only to confirm.
 */
export function DeleteTierDialog({
  tier,
  tiers,
  pending,
  onClose,
  onDelete,
}: {
  tier: PageTier | null;
  tiers: readonly PageTier[];
  pending: boolean;
  onClose: () => void;
  onDelete: (moveTo: string | null) => void;
}): ReactElement {
  const t = useTranslations('pageTiers');
  const common = useTranslations('common');
  const [moveTo, setMoveTo] = useState<string>('none');
  const inUse = tier !== null && (tier.page_count > 0 || tier.rule_count > 0);
  const later = tier === null ? undefined : tiers.find((candidate) => candidate.position === tier.position + 1);
  const moveOptions = [
    ...tiers.filter((candidate) => candidate.tier_id !== tier?.tier_id).map((candidate) => ({ value: candidate.tier_id, label: candidate.label })),
    { value: 'none', label: t('untiered') },
  ];
  return (
    <Dialog open={tier !== null} onOpenChange={(open) => (open ? undefined : onClose())} size="sm">
      <DialogHeader title={t('deleteTitle', { code: tier?.code ?? '' })} closeLabel={common('close')} />
      <DialogBody>
        <p className="type-body text-foreground">
          {inUse
            ? t('deleteInUse', { pages: tier.page_count, rules: tier.rule_count, label: tier.label })
            : t('deleteEmpty', { label: tier?.label ?? '' })}
        </p>
        {inUse ? (
          <Select<string>
            aria-label={t('moveTo')}
            value={moveTo}
            onValueChange={setMoveTo}
            placeholder={t('moveTo')}
            options={moveOptions}
          />
        ) : null}
        {later === undefined || tier === null ? null : <p className="type-meta text-foreground-secondary">{t('closeUp', { from: later.code, to: tier.code })}</p>}
      </DialogBody>
      <DialogFooter
        primary={
          <Button variant="destructive-solid" loading={pending} onClick={() => onDelete(inUse ? moveTo : null)}>
            {t('deleteConfirm', { code: tier?.code ?? '' })}
          </Button>
        }
        secondary={
          <Button variant="secondary" onClick={onClose}>
            {common('cancel')}
          </Button>
        }
      />
    </Dialog>
  );
}
```

`apps/web/src/features/workspace-settings/page-tiers/page-tiers-screen.tsx`:

```tsx
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { DeleteTierDialog, RenameTierDialog } from './tier-dialogs';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { InlineError } from '@/components/app/status/inline-error';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { workspaceKey } from '@/lib/api/keys';
import { formatInteger } from '@/lib/format';
import { createTierMutation, deleteTierMutation, updateTierMutation } from '@/lib/internal-links/mutations';
import { pageTiersQuery } from '@/lib/internal-links/queries';
import { MAX_TIERS } from '@/lib/internal-links/tiers';
import type { PageTier } from '@/lib/internal-links/types';
import { useCan } from '@/lib/permissions';

type Row = { kind: 'tier'; tier: PageTier } | { kind: 'untiered' };

/** Workspace settings > Page tiers (spec 5.1 and 7.7, mock `il-settings.js`). Owners and admins edit; others read. */
export function PageTiersScreen({ workspaceId }: { workspaceId: string }): ReactElement {
  const t = useTranslations('pageTiers');
  const common = useTranslations('common');
  const canEdit = useCan('workspace:update');
  const queryClient = useQueryClient();
  const read = useQuery(pageTiersQuery(workspaceId));
  const create = useMutation(createTierMutation);
  const update = useMutation(updateTierMutation);
  const remove = useMutation(deleteTierMutation);
  const [renaming, setRenaming] = useState<PageTier | null>(null);
  const [deleting, setDeleting] = useState<PageTier | null>(null);
  const tiers = read.data?.data ?? [];
  const full = tiers.length >= MAX_TIERS;
  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: workspaceKey(workspaceId) });
  const path = { workspace_id: workspaceId };
  const failed = (): void => {
    toast({ type: 'error', title: t('failed') });
  };

  const rows: Row[] = [...tiers.map((tier): Row => ({ kind: 'tier', tier })), { kind: 'untiered' }];
  const rowKey = (row: Row): string => (row.kind === 'tier' ? row.tier.tier_id : 'untiered');
  const columns: PlainColumn<Row>[] = [
            { id: 'code', header: t('code'), cell: (row) => <TierBadge tier={row.kind === 'tier' ? row.tier : null} /> },
            { id: 'name', header: t('name'), cell: (row) => (row.kind === 'tier' ? row.tier.name : t('untiered')) },
            {
              id: 'description',
              header: t('tierDescription'),
              wrap: true,
              cell: (row) =>
                row.kind === 'untiered' ? (
                  <span className="text-foreground-secondary">{t('untieredDescription')}</span>
                ) : row.tier.description === '' ? (
                  <span className="text-foreground-tertiary">{t('noDescription')}</span>
                ) : (
                  row.tier.description
                ),
            },
            { id: 'pages', header: t('pages'), cell: (row) => (row.kind === 'tier' ? formatInteger(row.tier.page_count) : '') },
            {
              id: 'actions',
              header: t('actions'),
              hideHeader: true,
              actions: true,
              cell: (row) =>
                row.kind === 'untiered' ? (
                  <span className="type-meta text-foreground-tertiary">{t('always')}</span>
                ) : canEdit ? (
                  <span className="flex justify-end gap-2">
                    <Button variant="secondary" size="sm" aria-label={t('renameName', { label: row.tier.label })} onClick={() => setRenaming(row.tier)}>
                      {t('rename')}
                    </Button>
                    <Button variant="secondary" size="sm" aria-label={t('deleteName', { label: row.tier.label })} onClick={() => setDeleting(row.tier)}>
                      {t('delete')}
                    </Button>
                  </span>
                ) : null,
            },
  ];
  const addButton = (
    <Button
      variant="secondary"
      icon={Plus}
      disabled={full}
      loading={create.isPending}
      onClick={() =>
        create.mutate(
          { params: { path }, body: { name: t('newName'), description: '' } },
          {
            onSuccess: (answer) => {
              toast({ type: 'success', title: t('added'), description: answer.data.label });
              refresh();
            },
            onError: failed,
          },
        )
      }
    >
      {t('add')}
    </Button>
  );

  return (
    <section aria-labelledby="page-tiers-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="page-tiers-title" className="type-section-title">
          {t('title')}
        </h2>
        <p className="type-body text-foreground-secondary">{t('description')}</p>
      </div>
      {read.isError ? (
        <InlineError
          title={t('loadFailed')}
          reason={t('loadFailedReason')}
          errorId={null}
          onRetry={() => void read.refetch()}
          retrying={read.isFetching}
          retryLabel={common('retry')}
        />
      ) : (
        <PlainTable<Row>
          caption={t('caption')}
          rows={rows}
          rowKey={rowKey}
          status={read.isPending ? 'loading' : 'ready'}
          errorState={null}
          emptyText={t('noDescription')}
          columns={columns}
        />
      )}
      {canEdit ? (
        full ? (
          <Tooltip content={t('addFull')}>
            <span className="self-start">{addButton}</span>
          </Tooltip>
        ) : (
          <span className="self-start">{addButton}</span>
        )
      ) : (
        <p className="type-meta text-foreground-secondary">{t('readOnly')}</p>
      )}
      <RenameTierDialog
        key={renaming?.tier_id ?? 'none'}
        tier={renaming}
        pending={update.isPending}
        onClose={() => setRenaming(null)}
        onSave={(name, description) =>
          renaming !== null &&
          update.mutate(
            { params: { path: { ...path, tier_id: renaming.tier_id } }, body: { name, description } },
            {
              onSuccess: (answer) => {
                toast({ type: 'success', title: t('saved'), description: answer.data.label });
                setRenaming(null);
                refresh();
              },
              onError: failed,
            },
          )
        }
      />
      <DeleteTierDialog
        key={deleting?.tier_id ?? 'none'}
        tier={deleting}
        tiers={tiers}
        pending={remove.isPending}
        onClose={() => setDeleting(null)}
        onDelete={(moveTo) =>
          deleting !== null &&
          remove.mutate(
            { params: { path: { ...path, tier_id: deleting.tier_id }, query: moveTo === null ? {} : { move_to: moveTo } } },
            {
              onSuccess: () => {
                toast({ type: 'success', title: t('deleted'), description: deleting.label });
                setDeleting(null);
                refresh();
              },
              onError: failed,
            },
          )
        }
      />
    </section>
  );
}
```

`apps/web/src/features/workspace-settings/page-tiers/index.ts`:

```ts
// What other code imports of the Page tiers settings
export { PageTiersScreen } from './page-tiers-screen';
```

- [ ] **Step 4: Write the project Internal links section**

`apps/web/src/features/project-settings/internal-links-screen.tsx`:

```tsx
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { LinkButton } from '@/components/ui/link-button';
import { Select } from '@/components/ui/select';
import { SettingRow } from '@/components/ui/setting-row';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { EMPTY_VALUE, formatCurrency, formatInteger, formatTableDateTime } from '@/lib/format';
import { updateSettingsMutation } from '@/lib/internal-links/mutations';
import { crawlsQuery, linkSettingsQuery } from '@/lib/internal-links/queries';
import type { CrawlRun, InternalLinksSettings } from '@/lib/internal-links/types';
import { useCan } from '@/lib/permissions';
import { projectPath } from '@/lib/routes/paths';

type Schedule = InternalLinksSettings['schedule'];
const SCHEDULE_KEY: Readonly<Record<Schedule, 'weekly' | 'everyTwoWeeks' | 'monthly' | 'off'>> = {
  weekly: 'weekly',
  every_two_weeks: 'everyTwoWeeks',
  monthly: 'monthly',
  off: 'off',
};
const TRIGGER_KEY: Readonly<Record<CrawlRun['trigger'], 'websiteAdded' | 'schedule' | 'manual' | 'ceilingRetry'>> = {
  website_added: 'websiteAdded',
  schedule: 'schedule',
  manual: 'manual',
  ceiling_retry: 'ceilingRetry',
};
const STATE_KEY: Readonly<Record<CrawlRun['state'], 'queued' | 'crawling' | 'processing' | 'ready' | 'stoppedAtCeiling' | 'failed' | 'cancelled'>> = {
  queued: 'queued',
  crawling: 'crawling',
  processing: 'processing',
  ready: 'ready',
  stopped_at_ceiling: 'stoppedAtCeiling',
  failed: 'failed',
  cancelled: 'cancelled',
};
const MAX_SUBDOMAINS = 10;

export interface InternalLinksSettingsScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  projectId: string;
  projectSlug: string;
  /** The project's website, for the subdomain hint; empty when none is set. */
  host: string;
  timeZone: string;
}

/**
 * Project settings > Internal links (spec 7.8, mock `il-settings.js` `mountInternalLinks`): the crawl schedule,
 * Render JavaScript with its cost, allowed subdomains, and the recent crawls with state, pages and cost. Each
 * change saves at once (`PATCH {P}/settings` with `internal_links`).
 */
export function InternalLinksSettingsScreen({ workspaceId, workspaceSlug, projectId, projectSlug, host, timeZone }: InternalLinksSettingsScreenProps): ReactElement {
  const t = useTranslations('internalLinksSettings');
  const common = useTranslations('common');
  const canWrite = useCan('projects:write');
  const scope = { workspaceId, projectId };
  const queryClient = useQueryClient();
  const settings = useQuery(linkSettingsQuery(scope));
  const crawls = useQuery(crawlsQuery(scope));
  const update = useMutation(updateSettingsMutation);
  const current = settings.data?.data.internal_links;
  const [subdomains, setSubdomains] = useState<string | null>(null);
  const [subdomainError, setSubdomainError] = useState<string | null>(null);

  const save = (patch: Partial<InternalLinksSettings>): void =>
    update.mutate(
      { params: { path: { workspace_id: workspaceId, project_id: projectId } }, body: { internal_links: patch } },
      {
        onSuccess: (answer) => {
          queryClient.setQueryData(linkSettingsQuery(scope).queryKey, answer);
          toast({ type: 'success', title: t('saved') });
        },
        onError: () => toast({ type: 'error', title: t('failed') }),
      },
    );
  const saveSubdomains = (): void => {
    const hosts = (subdomains ?? '').split(',').map((part) => part.trim()).filter((part) => part !== '');
    if (hosts.length > MAX_SUBDOMAINS) {
      setSubdomainError(t('subdomainsError'));
      return;
    }
    setSubdomainError(null);
    save({ allowed_subdomains: hosts });
  };

  const crawlColumns: PlainColumn<CrawlRun>[] = [
    { id: 'when', header: t('when'), cell: (run) => formatTableDateTime(run.created_at, timeZone) },
    { id: 'trigger', header: t('startedBy'), cell: (run) => run.requested_by?.name ?? t(`trigger.${TRIGGER_KEY[run.trigger]}`) },
    { id: 'state', header: t('state'), cell: (run) => t(`states.${STATE_KEY[run.state]}`) },
    { id: 'pages', header: t('crawlPages'), cell: (run) => formatInteger(run.pages_crawled) },
    { id: 'cost', header: t('cost'), cell: (run) => (run.cost_usd === null ? EMPTY_VALUE : formatCurrency(Number(run.cost_usd))) },
  ];
  const internalLinksHref = projectPath(workspaceSlug, projectSlug, '/seo/internal-links');

  if (settings.isError) {
    return (
      <InlineError
        title={t('loadFailed')}
        reason={t('loadFailed')}
        errorId={null}
        onRetry={() => void settings.refetch()}
        retrying={settings.isFetching}
        retryLabel={common('retry')}
      />
    );
  }
  return (
    <section aria-labelledby="internal-links-settings-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="internal-links-settings-title" className="type-section-title">
          {t('title')}
        </h2>
        <p className="type-body text-foreground-secondary">{t('description')}</p>
      </div>
      {current === undefined ? null : (
        <>
          <Field>
            <FieldLabel>{t('schedule')}</FieldLabel>
            <Select<Schedule>
              value={current.schedule}
              disabled={!canWrite}
              onValueChange={(schedule) => save({ schedule })}
              placeholder={t('schedule')}
              options={(Object.keys(SCHEDULE_KEY) as Schedule[]).map((value) => ({ value, label: t(SCHEDULE_KEY[value]) }))}
            />
            <FieldDescription>{t('scheduleHint')}</FieldDescription>
          </Field>
          <SettingRow
            label={t('renderJavascript')}
            description={t('renderJavascriptHint')}
            control={
              <Switch
                checked={current.render_javascript}
                disabled={!canWrite}
                busy={update.isPending}
                onCheckedChange={(render_javascript: boolean) => save({ render_javascript })}
              />
            }
          />
          <Field invalid={subdomainError !== null}>
            <FieldLabel>{t('subdomains')}</FieldLabel>
            <Input
              value={subdomains ?? current.allowed_subdomains.join(', ')}
              disabled={!canWrite}
              onValueChange={setSubdomains}
            />
            <FieldDescription>{t('subdomainsHint', { host: host === '' ? EMPTY_VALUE : host })}</FieldDescription>
            {subdomainError === null ? null : <FieldError message={subdomainError} />}
          </Field>
          {canWrite ? (
            <Button variant="secondary" size="sm" className="self-start" disabled={subdomains === null} onClick={saveSubdomains}>
              {t('saveSubdomains')}
            </Button>
          ) : null}
        </>
      )}
      <h3 className="pt-2 type-subsection-title">{t('recent')}</h3>
      <PlainTable<CrawlRun>
        caption={t('recentCaption')}
        rows={crawls.data?.data ?? []}
        rowKey={(run) => run.run_id}
        status={crawls.isError ? 'error' : crawls.isPending ? 'loading' : 'ready'}
        errorState={null}
        emptyText={t('noCrawls')}
        columns={crawlColumns}
      />
      <LinkButton variant="secondary" size="sm" className="self-start" render={<Link href={internalLinksHref} />}>
        {t('open')}
      </LinkButton>
    </section>
  );
}
```

Add `export { InternalLinksSettingsScreen } from './internal-links-screen';` to `apps/web/src/features/project-settings/index.ts`.

`Switch`'s change prop is Base UI's `onCheckedChange(checked, details)`; the typed `(render_javascript: boolean)` parameter takes the first argument.

- [ ] **Step 5: Routes and the settings navigation**

`apps/web/src/app/[workspace]/settings/(sections)/tiers/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { PageTiersScreen } from '@/features/workspace-settings/page-tiers';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.items');
  return { title: t('tiers') };
}

/** Workspace settings > Page tiers outside any project (spec 5.1). */
export default async function TiersPage({ params }: PageProps<'/[workspace]/settings/tiers'>): Promise<ReactNode> {
  const { workspace } = await params;
  const { membership } = await requireMembership(workspace);
  return <PageTiersScreen workspaceId={membership.workspace.workspace_id} />;
}
```

`apps/web/src/app/[workspace]/[project]/settings/tiers/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { PageTiersScreen } from '@/features/workspace-settings/page-tiers';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.items');
  return { title: t('tiers') };
}

/** Workspace settings > Page tiers inside the project shell: the tiers are the workspace's. */
export default async function ProjectTiersPage({ params }: PageProps<'/[workspace]/[project]/settings/tiers'>): Promise<ReactNode> {
  const { workspace } = await params;
  const { membership } = await requireMembership(workspace);
  return <PageTiersScreen workspaceId={membership.workspace.workspace_id} />;
}
```

`apps/web/src/app/[workspace]/[project]/settings/links/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { InternalLinksSettingsScreen } from '@/features/project-settings';
import { projectsOfMembership } from '@/lib/projects/server';
import { requireMembership } from '@/lib/session/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.items');
  return { title: t('links') };
}

/** Project settings > Internal links (spec 7.8). */
export default async function LinksSettingsPage({ params }: PageProps<'/[workspace]/[project]/settings/links'>): Promise<ReactNode> {
  const { workspace, project } = await params;
  const { membership } = await requireMembership(workspace);
  const current = (await projectsOfMembership(membership)).find((candidate) => candidate.slug === project);
  if (current === undefined) notFound();
  return (
    <InternalLinksSettingsScreen
      workspaceId={membership.workspace.workspace_id}
      workspaceSlug={membership.workspace.slug}
      projectId={current.project_id}
      projectSlug={current.slug}
      host={current.primary_domain?.host ?? ''}
      timeZone={current.timezone}
    />
  );
}
```

In `apps/web/src/features/settings/settings-frame.tsx`: add `'links'` to the end of `PROJECT` (after `'retention'`: `settings-frame.test.tsx` pins Data retention right after Schedules) and `'tiers'` to the end of `WORKSPACE` (after `'budgets'`). `WorkspaceSettingsSection` already has `'tiers'` (Task 6).

- [ ] **Step 6: Run the tests and see them pass**

```bash
pnpm vitest run src/features/workspace-settings/ src/features/project-settings/ src/features/settings/
```

Expected: PASS.

- [ ] **Step 7: Run the gate and commit**

```bash
git add apps/web/src/features/workspace-settings/page-tiers/ apps/web/src/features/project-settings/internal-links-screen.tsx \
  apps/web/src/features/project-settings/internal-links-settings.test.tsx apps/web/src/features/project-settings/index.ts \
  "apps/web/src/app/[workspace]/settings/(sections)/tiers/page.tsx" "apps/web/src/app/[workspace]/[project]/settings/tiers/page.tsx" \
  "apps/web/src/app/[workspace]/[project]/settings/links/page.tsx" apps/web/src/features/settings/settings-frame.tsx apps/web/messages/en.json
git commit -m "Internal links: workspace Page tiers and project Internal links settings"
```

---

### Task 15: "Map this site's internal links" in the new-project form

**Files:**
- Modify: `apps/web/src/features/onboarding/new-project-form.tsx`, `apps/web/src/features/onboarding/new-project.test.tsx`, `apps/web/messages/en.json`

Spec 6.2 and 7.8, plan 02 decision D14: the checkbox is ticked by default and sends `map_internal_links: true`; the API's default is false. In this app the onboarding step that adds the website is this form (step 1 of the new-project wizard), so it is the one place. A website added later in Settings > Domains is crawled on the project's next night (gap G9).

- [ ] **Step 1: Add the messages**

```json
  "onboarding": {
    "mapLinks": "Map this site’s internal links",
    "mapLinksHint": "Crawls the site in the background. About $0.15 per 1,000 pages."
  },
```

- [ ] **Step 2: Write the failing test**

In `apps/web/src/features/onboarding/new-project.test.tsx`, add inside `describe('New project', ...)`:

```tsx
  it('asks to map the internal links of the site by default, and not when unticked', async () => {
    const sent: unknown[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST' && request.url.endsWith('/projects')) {
        void request
          .clone()
          .json()
          .then((body: unknown) => sent.push(body));
      }
    });
    const { user } = renderWithProviders(form());
    await user.type(await screen.findByLabelText('Name'), 'Map Me');
    await user.type(screen.getByRole('textbox', { name: 'Site' }), 'map-me.example');
    const box = screen.getByRole('checkbox', { name: 'Map this site’s internal links' });
    expect(box).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ map_internal_links: true });
    server.events.removeAllListeners('request:start');
  });
```

Run `cd apps/web && pnpm vitest run src/features/onboarding/new-project.test.tsx`. Expected: FAIL, no such checkbox.

- [ ] **Step 3: Add the field**

In `apps/web/src/features/onboarding/new-project-form.tsx`:

1. `import { Controller, useForm, useWatch } from 'react-hook-form';` and `import { Checkbox } from '@/components/ui/checkbox';`.
2. `NewProjectValues` gains `map_internal_links: boolean;`; the zod object gains `map_internal_links: z.boolean(),`; `defaultValues` gains `map_internal_links: true,`.
3. The `create.mutateAsync` body gains, after `primary_domain`:

```ts
          // Ticked by default (spec 6.2); the API's own default is false (plan 02 decision D14)
          map_internal_links: values.map_internal_links,
```

4. After the `primary_domain` `FormField`, add:

```tsx
        <Controller
          control={form.control}
          name="map_internal_links"
          render={({ field }) => (
            <Checkbox
              name={field.name}
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(checked === true)}
              label={t('mapLinks')}
              description={t('mapLinksHint')}
            />
          )}
        />
```

- [ ] **Step 4: Run the onboarding tests and see them pass**

```bash
pnpm vitest run src/features/onboarding/
```

Expected: PASS. The earlier test "sends the site, the location and the brand" still passes (`toMatchObject` ignores the new member).

- [ ] **Step 5: Run the gate and commit**

```bash
git add apps/web/src/features/onboarding/new-project-form.tsx apps/web/src/features/onboarding/new-project.test.tsx apps/web/messages/en.json
git commit -m "Internal links: map the internal links of a new project's site by default"
```

---

### Task 16: States in both themes and both densities

**Files:**
- Create: `apps/web/src/features/internal-links/states.test.tsx`

Spec 9 and 11: loading skeletons (never an empty table during the first crawl), empty, error with Retry, partial (a read that failed beside ones that did not), stale (the tier flow being recomputed), in both themes and both table densities. Every state is already drawn by Tasks 6 to 14; this task pins them with tests that override single routes of the mock API.

- [ ] **Step 1: Write the tests**

`apps/web/src/features/internal-links/states.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { EVENTUS, tierFlow } from '@/mocks/internal-links-world';
import { mswPath, problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

const P = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${EVENTUS.project_id}`;
const run = (over: Record<string, unknown>) => ({
  run_id: 'r1',
  trigger: 'schedule',
  state: 'ready',
  ceiling: 6000,
  pages_found: 6000,
  pages_crawled: 6000,
  sitemap_pages: 100,
  render_javascript: false,
  estimated_cost_usd: '0.90',
  cost_usd: '0.90',
  stop_reason: null,
  error_code: null,
  error_message: null,
  hints: [],
  is_latest: true,
  created_at: '2026-11-14T03:00:00Z',
  submitted_at: '2026-11-14T03:00:05Z',
  finished_at: '2026-11-14T03:12:00Z',
  requested_by: null,
  ...over,
});
const crawls = (...runs: unknown[]) =>
  http.get(mswPath(`${P}/link-crawls`), () => HttpResponse.json({ data: runs, page: { limit: 10, next_cursor: null, has_more: false } }));

afterEach(() => document.documentElement.classList.remove('dark'));

describe('crawl states (spec 9)', () => {
  it('offers a higher limit after a crawl stopped at its ceiling and keeps the data', async () => {
    server.use(crawls(run({ state: 'stopped_at_ceiling', stop_reason: 'limit_exceeded' })));
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText('Stopped at 6,000 pages.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crawl again with a higher limit' })).toBeInTheDocument();
    expect(await screen.findByRole('grid', { name: 'Pages' })).toBeInTheDocument();
  });

  it('names a blocked site and keeps showing the last good crawl', async () => {
    server.use(crawls(run({ run_id: 'r2', state: 'failed', is_latest: false, error_code: 'site_blocked', finished_at: null }), run({})));
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText(/answered 403 to our crawler/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('suggests Render JavaScript when a crawl found very few pages', async () => {
    server.use(crawls(run({ pages_crawled: 2, hints: ['render_javascript'] })));
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText('Very few pages were found.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Crawl settings' })).toHaveAttribute('href', '/digibranders/eventus-security/settings/links');
  });

  it('shows a crawl that runs beside the latest one', async () => {
    server.use(crawls(run({ run_id: 'r3', state: 'crawling', is_latest: false, pages_found: 312, finished_at: null }), run({})));
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText('Crawling now: 312 pages found so far.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crawling' })).toBeDisabled();
  });

  it('shows the crawl list error with Retry', async () => {
    server.use(http.get(mswPath(`${P}/link-crawls`), ({ request }) => problem(request, 'internal_error')));
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText('Internal links could not be loaded')).toBeInTheDocument();
  });
});

describe('table and tab states', () => {
  it('shows the Pages error state with Retry when the list fails', async () => {
    server.use(http.get(mswPath(`${P}/internal-links/pages`), ({ request }) => problem(request, 'internal_error')));
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS));
    expect(await screen.findByText('The pages could not be loaded')).toBeInTheDocument();
  });

  it('says when the tier flow is being worked out again', async () => {
    server.use(http.get(mswPath(`${P}/internal-links/tier-flow`), () => HttpResponse.json({ data: { ...tierFlow('editorial'), stale: true } })));
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=flow' });
    expect(await screen.findByText('The tier flow is being worked out again after a tier change.')).toBeInTheDocument();
  });

  it.each([
    ['light', 'compact'],
    ['dark', 'compact'],
    ['light', 'default'],
    ['dark', 'default'],
  ])('has no axe violations in the %s theme at %s density', async (theme, density) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: density === 'default' ? 'density=default' : '',
    });
    await within(await screen.findByRole('grid', { name: 'Pages' })).findByRole('rowheader', { name: /^\/pricing/ });
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run them**

```bash
cd apps/web && pnpm vitest run src/features/internal-links/states.test.tsx
```

Expected: PASS. A failure here is a state a task drew wrong: fix it in that task's file, never in the test.

- [ ] **Step 3: Run the gate and commit**

```bash
git add apps/web/src/features/internal-links/states.test.tsx
git commit -m "Internal links: tests of every crawl and table state in both themes and densities"
```

---

### Task 17: Playwright flow, axe in both themes and visual baselines

**Files:**
- Create: `apps/web/e2e/support/internal-links.ts`, `apps/web/e2e/flows/internal-links.spec.ts`
- Modify: `apps/web/e2e/visual/pages.spec.ts`

Spec 11's flow, against the test build with every route mocked (`NEXT_PUBLIC_API_MOCKING=all`, decision W21). Baselines are made only in the pinned Playwright image (26 section 11); none are committed from this Mac.

- [ ] **Step 1: Write the support file**

`apps/web/e2e/support/internal-links.ts`:

```ts
import { expect, type Locator, type Page } from '@playwright/test';

/** An editor: writes tiers and rules, starts crawls. */
export const EDITOR = 'priya@digibranders.test';
export const THEME_KEY = 'idraft.theme';
export const EVENTUS_LINKS = '/digibranders/eventus-security/seo/internal-links';

export const pagesGrid = (page: Page): Locator => page.getByRole('grid', { name: 'Pages' });
export const canvasOf = (page: Page): Locator =>
  page.getByRole('group', { name: 'Link journey canvas. The tree list shows the same journey as a table.' });
export const card = (page: Page, path: string): Locator =>
  canvasOf(page).getByRole('button', { name: new RegExp(`^${path.replaceAll('/', '\\/')}, `) }).first();

/** Opens Internal links on Eventus Security with the query given and waits for its first table or canvas. */
export async function openLinks(page: Page, query = ''): Promise<void> {
  await page.goto(`${EVENTUS_LINKS}${query === '' ? '' : `?${query}`}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Internal links' })).toBeAttached();
}
```

- [ ] **Step 2: Write the flow**

`apps/web/e2e/flows/internal-links.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

import { expectAccessible, signIn } from '../support';
import { canvasOf, card, EDITOR, openLinks, pagesGrid, THEME_KEY } from '../support/internal-links';

test.describe('Internal links (spec 11)', () => {
  test('a new project with the box ticked shows its first crawl in progress', async ({ page }) => {
    await signIn(page, EDITOR);
    await page.goto('/digibranders/onboarding');
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Map Test');
    await page.getByRole('textbox', { name: 'Site' }).fill('map-test.example');
    await expect(page.getByRole('checkbox', { name: 'Map this site’s internal links' })).toBeChecked();
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL(/\/digibranders\/map-test(\/|$)/);
    // A client navigation: the mock API keeps its state in the page's memory (decision W21), so no reload
    await page.getByRole('link', { name: 'Internal links' }).click();
    await expect(page.getByRole('heading', { name: 'Mapping map-test.example' })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Crawl progress' })).toBeVisible();
    await expectAccessible(page);
  });

  test('tags pages in bulk and by rule, and the tier flow follows', async ({ page }) => {
    await signIn(page, EDITOR);
    await openLinks(page, 'tab=flow');
    const t4Row = page.getByRole('table', { name: 'Links between tiers' }).getByRole('row', { name: /^T4 Utility pages/ });
    const before = (await t4Row.getByRole('cell').last().textContent()) ?? '';

    // Bulk: every blog page to T4 through the bulk bar
    await openLinks(page, 'q=%2Fblog');
    await pagesGrid(page).getByRole('checkbox', { name: /^Select all/ }).check();
    await page.getByRole('button', { name: 'Set tier' }).click();
    const dialog = page.getByRole('dialog', { name: /^Set the tier of \d+ pages$/ });
    await dialog.getByRole('radio', { name: 'T4 Utility pages' }).check();
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText(/pages are now T4 Utility pages\.$/)).toBeVisible();

    // A rule: everything under /industries/ to T2
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Tier rules' }).click();
    const rules = page.getByRole('dialog', { name: 'Tier rules' });
    await rules.getByRole('button', { name: 'Add rule' }).click();
    await rules.getByRole('textbox', { name: 'Rule 3 path' }).fill('/industries/');
    await rules.getByRole('button', { name: 'Save rules' }).click();
    await expect(page.getByText('3 rules saved.')).toBeVisible();

    // The tab, not a reload: the mock API's changes live in the page's memory (decision W21)
    await page.getByRole('tab', { name: 'Tier flow' }).click();
    await expect(t4Row.getByRole('cell').last()).not.toHaveText(before);
  });

  test('follows a journey two steps out and two in, with a back link, re-centers and keeps the view on reload', async ({ page }) => {
    await signIn(page, EDITOR);
    await openLinks(page, 'tab=journey&focus=103');
    await expect(card(page, '/services/soc-as-a-service')).toBeVisible();

    // Two steps out
    await card(page, '/pricing').click();
    await expect(canvasOf(page).getByRole('heading', { name: 'Step 2 out' })).toBeVisible();
    await card(page, '/compare/eventus-vs-in-house-soc').click();

    // Two steps in
    await card(page, '/blog/what-is-a-soc').click();
    await expect(canvasOf(page).getByRole('heading', { name: 'Step 2 in' })).toBeVisible();

    // The back link of /pricing to the focus, and its return arrow on hover
    const marker = canvasOf(page).getByRole('button', { name: 'Links back to 1 earlier page' }).first();
    await marker.hover();
    await expect(canvasOf(page).locator('svg path[marker-end]')).not.toHaveCount(0);

    // Re-center on /pricing, then the tree list
    await card(page, '/pricing').hover();
    await canvasOf(page).getByRole('button', { name: 'Make /pricing the focus' }).click();
    await expect(page).toHaveURL(/focus=108/);
    await page.getByRole('radio', { name: 'Tree list' }).click();
    const tree = page.getByRole('table', { name: 'Link journey as a tree' });
    await expect(tree).toBeVisible();

    // A reload shows the same view from the address
    await page.reload();
    await expect(page.getByRole('table', { name: 'Link journey as a tree' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Focus page: /pricing. Change it.' })).toBeVisible();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`has no axe violations on every tab in the ${theme} theme`, async ({ page }) => {
      await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [THEME_KEY, theme] as const);
      await signIn(page, EDITOR);
      for (const query of ['', 'tab=links', 'tab=journey&focus=103&open=o%3A108', 'tab=journey&focus=103&jv=tree', 'tab=flow']) {
        await openLinks(page, query);
        await page.waitForLoadState('networkidle');
        await expectAccessible(page);
      }
      await page.goto('/digibranders/settings/tiers');
      await expectAccessible(page);
      await page.goto('/digibranders/eventus-security/settings/links');
      await expectAccessible(page);
    });
  }
});
```

The view switch is a `SegmentedControl`, built on Base UI's radio group, so its items are radios.

- [ ] **Step 3: Run the flow**

```bash
cd apps/web && pnpm e2e -- e2e/flows/internal-links.spec.ts
```

Expected: `4 passed` (the two theme runs count as two). The run builds the app with the mocks first (about 2 minutes).

- [ ] **Step 4: Add the visual pages**

In `apps/web/e2e/visual/pages.spec.ts`, add to `SIGNED_IN`:

```ts
  { name: 'internal-links-pages', path: '/digibranders/eventus-security/seo/internal-links' },
  { name: 'internal-links-links', path: '/digibranders/eventus-security/seo/internal-links?tab=links' },
  { name: 'internal-links-journey', path: '/digibranders/eventus-security/seo/internal-links?tab=journey&focus=103&open=o%3A108' },
  { name: 'internal-links-flow', path: '/digibranders/eventus-security/seo/internal-links?tab=flow' },
  { name: 'settings-page-tiers', path: '/digibranders/settings/tiers', as: ADMIN },
```

Baselines are made in the pinned image only (`mcr.microsoft.com/playwright:v1.63.0-noble`, 26 section 11): do not run `pnpm e2e:visual -- --update-snapshots` on this Mac and commit nothing under `e2e/visual/*-snapshots/`.

- [ ] **Step 5: Run the gate and commit**

```bash
git add apps/web/e2e/support/internal-links.ts apps/web/e2e/flows/internal-links.spec.ts apps/web/e2e/visual/pages.spec.ts
git commit -m "Internal links: Playwright flow, axe on every tab in both themes, visual pages"
```

---

### Task 18: Final checks and the review hand-off

**Files:** none new.

- [ ] **Step 1: The whole gate and the flows**

From the worktree root: the gate of "The gate at the end of every task", then `cd apps/web && pnpm e2e`. Expected: every command passes; the flows print `N passed` with no failure.

- [ ] **Step 2: No equity, no dashes, no slice 2 or 3**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-web
grep -n -i "equity" apps/web/messages/en.json; echo "exit $?"
grep -rn "equity_share" apps/web/src/features/internal-links apps/web/src/components/app/link-canvas apps/web/src/components/app/tier | grep -v "\.test\.ts"; echo "exit $?"
grep -rnP "\x{2014}|\x{2013}" apps/web/src/features/internal-links apps/web/src/components/app/link-canvas apps/web/src/lib/internal-links apps/web/messages/en.json; echo "exit $?"
```

Expected: each prints only `exit 1`. No message names equity, no screen reads `equity_share` (only the generated `schema.ts`, the mock world and the tests that reject it do), and no new text has a dash.

- [ ] **Step 3: Request the review**

Use superpowers:requesting-code-review with this plan, the spec and the mock as the brief. The review model is the one the owner set for reviews (memory "Model routing": Sonnet or Codex for builds and reviews, an Opus review after each plan task when the owner asks for it). Fix what it finds in the task's files, rerun the gate, and commit each fix on its own.

- [ ] **Step 4: Merge into develop**

After plan 02's branch is on `develop` (the web branch must never land first):

```bash
git fetch origin
git rebase origin/develop
cd apps/web && pnpm gen:api && git diff --stat -- src/lib/api/schema.ts
```

Expected: no diff in `schema.ts` (if there is one, commit it as "Internal links: regenerate the API client" and rerun the gate). Then merge `feat/internal-links-web` into `develop` the way AGENTS.md says (a merge commit, pushed to `origin/develop`), never into `main`.

---

## Self-review

### Spec coverage (slice 1, web)

| Spec | Requirement | Task |
|---|---|---|
| 3, 7.1 | SEO sidebar item "Internal links", tabs Pages, Links, Journey, Tier flow | 6, 7, 10, 11, 12 |
| 3, 6.2 | Crawl now, one at a time, shows when it started | 6 |
| 3, 6.2, 7.8 | Website-added checkbox, ticked by default | 15 |
| 5.1, 7.7 | Workspace Page tiers: rename, add up to 8, delete with move-to, closing-up note, Untiered fixed, code and color from position | 14 |
| 5.1 | Badges show the code; filters, tooltips, inspector and CSV show code and name | 1, 7, 9, 10 |
| 5.2 | Bulk tiers, shift-click range and select all N matching, keys 1 to 8 and 0 through `useShortcut` | 8 |
| 5.2 | Rules (exact, prefix, pattern), ordered, preview count before save | 13 |
| 5.2 | CSV import with pending rows and line-numbered errors | 13 |
| 5.2 | Source line ("Manual, set by ... on ...", "Rule: ..."), Reset to rule | 9 |
| 5.3 | Tags add and remove through the bulk bar and the inspector | 8, 9 |
| 7.2 | Pages columns, chooser columns, flags, filters (tier, tag, status, indexable, flags), link scope chip, Open in journey | 7 |
| 7.2 | Saved worklists with counts | 7 (page lists), 10 (link lists, W17) |
| 7.2, 7.3 | CSV export following the filter | 7, 8, 10 (W13) |
| 7.3 | Links table columns, filters, source and target search | 10 (G8) |
| 7.4 | Inspector: tier and source, tags, strip, by tier and placement, top 5 anchors, capped lists, flags, Open in journey | 9 |
| 7.5 | Canvas layout, growing, three kinds of link, Both ways, group cards, edge styles and legend, card, tooltip, re-center with Back, 300 cap, zoom buttons, keyboard, accessible names | 3, 4, 11 |
| 7.5 | Tree list with direction switch, back and listed rows, Both ways | 3, 11 (W3) |
| 7.5 | State in the URL (focus, scope, opened cards) | 3, 6, 11 |
| 7.5 | Edge states: editorial orphan offers All, redirect focus shows its target, focus not in crawl | 11 (FocusNote, not-in-crawl empty state; the redirect child comes from the API) |
| 7.6 | Tier flow matrix with table alternative, cell opens Links filtered, strip, scope chip, Untiered row and column | 12 (W10) |
| 7.8 | Project settings: schedule, Render JavaScript with the multiplier, allowed subdomains, recent crawls | 14 |
| 7.9 | Tier tokens with contrast tests, `TierBadge`, `LinkCanvas` and `LinkCard` with spec, states, keyboard and preview; `StackedMiniBar` checked against the inventory | 1, 4 (W11: `ShareBarCell` reused) |
| 9 | No website, first crawl, failed, stopped at ceiling, site blocked, few pages, budget exceeded, placement unknown | 6, 9, 16 |
| 11 | Web unit and axe tests; canvas link kinds; Playwright flow; visual baselines | 1 to 17 |
| 7.2, 7.4, 7.5, 7.6 | Equity share | Not shown anywhere (W4, the owner's decision of 2026-11-16) |

### Name consistency

- Address keys: `tab`, `scope`, `view`, `lview`, `sort`, `q`, `lq`, `src`, `tgt`, `focus`, `jv`, `dir`, `open`, `grp`, `more`, `topen` (Task 6 `LINKS_KEYS`); filter keys `tier`, `tag`, `status`, `idx`, `flag` (Task 7) and `stier`, `ttier`, `place`, `tstatus`, `tag`, `sq` (Task 10); the URL state table lists the same.
- Journey keys: `cardKey` (`o:`/`i:` and dotted ids), `groupKey` (`g:`), `moreKey` (`m:`), `FOCUS_KEY` `f` (Task 3), parsed by `parseKeySet` and `parseMore` (Task 3) and written by `formatKeySet` and `formatMore` (Task 11).
- Queries: `pagesQuery`, `pageDetailQuery`, `edgesQuery`, `neighborsQuery`, `tierFlowQuery`, `worklistsQuery`, `crawlsQuery`, `tierRulesQuery`, `pageTiersQuery`, `linkSettingsQuery`, `pagesPath`, `edgesPath`, `internalLinksKeys`, `crawlKeys` (Task 5), used under these names in Tasks 6 to 14.
- Components: `TierBadge` (1), `LinkCard`, `LinkCanvas`, `ZoomControls`, `ZOOMS`, `CanvasFocus`, `LinkCanvasHandle.fitZoom` (4), `InternalLinksScreen`, `CrawlHeader`, `CrawlBanners`, `FirstCrawl`, `NoWebsite`, `NeverCrawled`, `SummaryStrip`, `ScopeMenu` (6, 7), `PagesTab`, `LinksTab`, `JourneyTab`, `FlowTab` registered in `LINKS_TABS` (7, 10, 11, 12), `PageInspector` (9), `RulesDialog`, `ImportDialog` (13), `PageTiersScreen`, `InternalLinksSettingsScreen` (14).
- Message namespaces: `tierBadge`, `linkCanvas`, `internalLinks.*`, `pageTiers`, `internalLinksSettings`, `settings.items.tiers`, `settings.items.links`, `navigation.items.internalLinks`, `onboarding.mapLinks*`.

### Assumptions not verified

- Plan 02's generated schema names (`PageRowPage`, `NeighborList`, `TierRuleView`, `PageTierList`, `TierImportResult`, `PageFilter` and the rest) are taken from its pydantic models; Task 5 step 1 counts them in `schema.ts` and names the one file to change if any differs.
- The read routes' query parameters (`cursor`, `limit` from plan 02's `Cursor` dependency; `filter[...]` lists as arrays the client joins with commas) follow the backend code plan 02 shows; the mock handlers list the same names, so a difference fails `projectCaller`'s unknown-query check in the component tests.
- Run on 2026-11-16 against a copy of `develop` (the plan's whole-file code blocks written out, the modify steps of Tasks 1, 5 and the tab registrations applied by hand): Tasks 1 to 4 pass their tests with `tsc` and ESLint clean; the mock API, the queries, the download, the address state, the crawl view, the filters, the rule diff, the shell, the Pages, Links, Journey and Tier flow tabs and the state tests pass (99 tests); ESLint is clean on every new feature file. Not run: the tests of Tasks 8, 9, 13, 14 and 15 (their steps edit existing files by snippet), the Playwright flow, and `tsc` for anything that reads the generated schema, which does not exist until plan 02's OpenAPI lands. Prettier rewrites the long lines (`pnpm format` in the gate).
- `useQueries` with a changing list (Task 11 `useLoad`) re-renders when a page arrives; the layout reads the cache with `getQueryState` in the same render. If the subscriptions lag one render, the journey shows a `loading` card for that render only.
- Layout changes do not move in 150 ms (spec 7.5): cards appear and go at once, which also meets reduced motion. A FLIP animation is left for the owner to ask (open point P4).
- The mock world has no tag vocabulary; the tag dialogs then show "This project has no tag vocabulary yet" with a link to Taxonomy, which the tests do not cover beyond that state.

