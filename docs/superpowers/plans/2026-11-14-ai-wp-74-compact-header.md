# WP-74: compact page header on every AI page (PARKED, brief only)

Status: parked by the owner on 2026-11-14 before the detailed plan was written. This file holds the brief so the work can restart quickly. Branch: `ai/wp-74-compact-header` (cut from develop at 9cbccdc1). No code was written. No before screenshots were taken.

## Owner feedback (verbatim)

"asked for the sleek UI and top part like keywords page for all pages, no useless clutter or empty spaces, you made the same mistake again"

## Reference

The live Keywords page (`/seo/keywords`): route `apps/web/src/app/[workspace]/[project]/seo/keywords/`, feature code in `apps/web/src/features/rankings/`, shell parts in `apps/web/src/components/app/shell/` (`page-header.tsx`, `top-bar.tsx`, `breadcrumb.tsx`, `tab-nav.tsx`), data table toolbar in `components/app/data-table/`.

- No page H1 and no subtitle block (the breadcrumb and the sidebar already say where you are). Keep a visually hidden h1 for accessibility and tests.
- One compact toolbar row of about 40 px right under the breadcrumb: inline stat chips on the left (small label plus bold value, no boxes), then the Filter button with its active filter chips inline, and on the right "Updated 2d ago", the ... menu, Export and the primary action.
- The table starts immediately below; the first data row is within about 130 px of the breadcrumb.
- Do NOT change the Keywords page.

## Problems measured on production

1. Citations (`/ai/citations`, `features/citations/`): big H1 and subtitle, a separate tabs row, a tall 6 tile strip (two tiles are just "n/a"), a filter row, two full width banners ("200 most cited of 229", "previous period has no answers"), a stray "Shares are of 1,537 citation units" line: about 480 px before the first table row.
2. Overview (`/ai`, `features/ai-overview/`): big H1 and subtitle, a "Setup complete" bar that stays after setup (route slot `app/[workspace]/[project]/ai/ai-setup-slot.tsx`), a full width blue "Scheduled AI runs are paused" banner, a tall tile strip, a chip row, then cards with large empty or gray skeleton blocks (cards still show skeletons 10 s later).
3. Topics & Prompts (`/ai/prompts`, `features/prompts/`): closest to the reference, but its notices and chip rows also stack.

## Rules for the new header

- Stat chips replace the tile strip everywhere. Keep honest states: an n/a chip is omitted or shown muted with a tooltip, never a tall empty tile. Every percent keeps its count in the tooltip. The Delta and compare parts stay.
- Tabs (Domains, Pages, New and lost, Fan-out if present) become a segmented control in the same toolbar row or in the table toolbar, never their own row.
- Notices become small inline status chips or one slim line in the toolbar (for example a "Schedules paused" chip with a tooltip). "Compared with previous period: no answers" lives in the compare select hint. "200 of 229 domains, lower the minimum to see more" moves to the table footer next to the count.
- The "Setup complete" bar is hidden once complete; an icon in the ... menu brings it back.
- No explanatory sentence blocks above data (move them to info icons or footers).
- Overview cards: compact empty states (no 250 px boxes holding one sentence), skeleton height equals final height, no gaps between the header and the first card.
- Apply to Overview, Topics & Prompts, Citations (all tabs), and Runs and Costs only if they use the same pattern.
- Build ONE shared composition (a page toolbar with slots: stats, filters, tabs, status, actions) in `components/app/`, reusing the exact tokens, heights and spacing of the Keywords toolbar, then migrate the pages.

## Method (from the coordinator)

1. Invoke the design-taste-frontend skill; read `AI_DEVELOPMENT_UI_RULES.md` and `DESIGN_SYSTEM.md` (the project design system outranks the skill's house style); read docs 18, 24 and 25 of the design system.
2. Take BEFORE screenshots of production at 1440x900, 1024, 768 and 390, light and dark (save under the scratchpad, not the repo).
3. A Sonnet planner writes `docs/superpowers/plans/2026-11-14-ai-wp-74-compact-header.md` (replace this file), then Sonnet implementers per task with a fresh reviewer who opens the page in a real browser and compares it with Keywords side by side.
4. Acceptance: first table row or first card inside the top 140 px of content at 1440x900, no empty gray blocks, no two stacked banners, axe clean, keyboard order sane, phone layout works.
5. Update the e2e specs that assert the old headers (`ai-citations`, `ai-overview`, `ai-prompts`); leases on those specs and on `features/prompts`, `features/citations`, `features/ai-overview` and the `components/app` files are available from the coordinator (all owners are idle and merged).
6. Whole app lint, typecheck and format:check plus targeted tests; capped full suite through the lock; push fast forward to origin/develop; report `WP-74 merged` with the sha and AFTER screenshots at 1440 and 390 under `docs/ai-visibility/screens/wp-74/`.
7. Push a backup branch after every task. At most 2 subagents. No em-dashes; edit with the file tools.

## Suggested task order (for the planner)

T0 shared `PageToolbar` and stat chips; T1 Overview migration (shippable alone); T2 Citations; T3 Topics & Prompts; T4 Runs and Costs if the pattern applies; T5 e2e and unit tests asserting the old headers; T6 final gate, AFTER screenshots, As built note.

## Related parked work of WP-33 (on branch `ai/wp-33-overview-shell`)

Equal height card frames and entry exports (`layout-grid.tsx`), the WIP e2e part 2, and not started: strip text truncation at 768 and 390, layout shift on load, setup bar, phone filters sheet. Several of these overlap with this package (setup bar, strip, layout shift): do them inside WP-74.
