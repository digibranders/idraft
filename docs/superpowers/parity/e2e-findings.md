# End to end specs of the Overview and the Prompts page: findings

Branch `port/e2e` (cut from `port/real-app` at 6fe302f1). Written 2026-11-17. The flow specs were run for the first time
in this port: the earlier builders could not run Playwright here and edited specs blind. They were run against a
production test build of the app, before and after the fixes. Only `apps/web/e2e/**` and this file changed; no
application source, message or register was touched.

Result: 466 flow tests in the scope before (380 pass, 59 fail or time out, 27 skip), 480 after (447 pass, 0 fail, 33 skip,
of which 6 are `test.fixme` for app bugs listed below). `pnpm lint`, `pnpm typecheck` and `pnpm format:check` pass in
`apps/web`.

## Before and after, per spec

"fail" counts a test that failed or timed out. A first stale locator waits for its timeout, so one stale word can cost
30 s to 120 s and, in `ai-prompts.spec.ts`, took eight accessibility tests down with it.

| Spec | Before | After |
|---|---|---|
| `e2e/flows/ai-add-prompts-shots.spec.ts` | 0 pass, 0 fail, 24 skip | 0 pass, 0 fail, 24 skip |
| `e2e/flows/ai-add-prompts.spec.ts` | 13 pass, 1 fail, 0 skip | 14 pass, 0 fail, 0 skip |
| `e2e/flows/ai-app-parts-a.spec.ts` | 12 pass, 0 fail, 0 skip | 12 pass, 0 fail, 0 skip |
| `e2e/flows/ai-app-parts-b.spec.ts` | 28 pass, 0 fail, 0 skip | 28 pass, 0 fail, 0 skip |
| `e2e/flows/ai-chart-bars.spec.ts` | 15 pass, 0 fail, 0 skip | 15 pass, 0 fail, 0 skip |
| `e2e/flows/ai-chart-grids.spec.ts` | 17 pass, 0 fail, 0 skip | 17 pass, 0 fail, 0 skip |
| `e2e/flows/ai-chart-platform.spec.ts` | 15 pass, 0 fail, 0 skip | 15 pass, 0 fail, 0 skip |
| `e2e/flows/ai-citations-inspectors.spec.ts` | 34 pass, 0 fail, 0 skip | 34 pass, 0 fail, 0 skip |
| `e2e/flows/ai-citations.spec.ts` | 13 pass, 1 fail, 0 skip | 14 pass, 0 fail, 0 skip |
| `e2e/flows/ai-compare.spec.ts` | 12 pass, 4 fail, 0 skip | 16 pass, 0 fail, 0 skip |
| `e2e/flows/ai-controls.spec.ts` | 58 pass, 0 fail, 0 skip | 58 pass, 0 fail, 0 skip |
| `e2e/flows/ai-evidence.spec.ts` | 10 pass, 1 fail, 0 skip | 11 pass, 0 fail, 0 skip |
| `e2e/flows/ai-layouts-core.spec.ts` | 45 pass, 0 fail, 0 skip | 45 pass, 0 fail, 0 skip |
| `e2e/flows/ai-layouts.spec.ts` | 43 pass, 0 fail, 0 skip | 43 pass, 0 fail, 0 skip |
| `e2e/flows/ai-overview-competitors.spec.ts` | 5 pass, 1 fail, 0 skip | 6 pass, 0 fail, 0 skip |
| `e2e/flows/ai-overview-engines.spec.ts` | 10 pass, 0 fail, 0 skip | 10 pass, 0 fail, 0 skip |
| `e2e/flows/ai-overview-scope.spec.ts` (new) | new | 5 pass, 0 fail, 0 skip |
| `e2e/flows/ai-overview-sources.spec.ts` | 2 pass, 5 fail, 3 skip | 6 pass, 0 fail, 4 skip |
| `e2e/flows/ai-overview-topics.spec.ts` | 9 pass, 2 fail, 0 skip | 11 pass, 0 fail, 0 skip |
| `e2e/flows/ai-overview.spec.ts` | 10 pass, 8 fail, 0 skip | 16 pass, 0 fail, 2 skip |
| `e2e/flows/ai-prompt-inspector.spec.ts` | 6 pass, 0 fail, 0 skip | 6 pass, 0 fail, 0 skip |
| `e2e/flows/ai-prompts-groups.spec.ts` (new) | new | 6 pass, 0 fail, 0 skip |
| `e2e/flows/ai-prompts.spec.ts` | 2 pass, 10 fail, 0 skip | 12 pass, 0 fail, 0 skip |
| `e2e/flows/ai-runs-costs.spec.ts` | 7 pass, 2 fail, 0 skip | 9 pass, 0 fail, 0 skip |
| `e2e/flows/ai-settings.spec.ts` | 1 pass, 1 fail, 0 skip | 2 pass, 0 fail, 0 skip |
| `e2e/flows/ai-topics-by-engine.spec.ts` | 7 pass, 21 fail, 0 skip | 28 pass, 0 fail, 0 skip |
| `e2e/flows/shell.spec.ts` | 6 pass, 2 fail, 0 skip | 8 pass, 0 fail, 3 skip |
| Total | 380 pass, 59 fail, 27 skip | 447 pass, 0 fail, 33 skip |

The "after" numbers come from one full run of all these files, except `ai-overview-sources.spec.ts`, which was run again
alone after the last commit (the full run still had its every-card axe flow failing, see finding O2; it is `fixme` now).
`ai-controls`, `ai-layouts*`, `ai-chart-*`, `ai-app-parts-*`, `ai-citations-inspectors`, `ai-prompt-inspector` and
`ai-overview-engines` passed unchanged.

## Stale specs fixed (the screen changed on purpose)

| Spec or helper | What was stale | Now |
|---|---|---|
| `support/ai-overview.ts` `numbersOf`, `heroValue` | read the figure with its screen reader sentence ("23 , core prompts, not branded") | read only what is drawn (the `sr-only` span is skipped) |
| `support/ai-overview.ts` `BUILTIN_CARD_TITLES` | headline card called "Headline numbers", other titles unchecked | the group keeps the name "Headline numbers", the card draws "AI visibility rate"; every built card now has its title |
| `ai-overview.spec.ts` | Mention position, Recommendation rate and Sentiment tiles expected `n/a`, `Not collected yet` | the mock now carries them: a figure, or `n/a` |
| `ai-overview.spec.ts` | "Date range" button and dialog | the glossary word is "Period" |
| `ai-overview.spec.ts` | Branded chip looked for inside the Scope region | the chip sits in the row under the bar; found on the page |
| `ai-overview.spec.ts` toolbar test | measured the sticky bar after the page had scrolled (4 px higher) | scrolls to the top before each measure |
| `ai-overview-competitors.spec.ts` | `columnheader` named "Brand" matched two headers | `exact: true` |
| `ai-overview-topics.spec.ts`, `support/ai-overview-topics.ts` | heat map column "AI Overview" | "Google AI Overview" |
| `ai-overview-sources.spec.ts`, `support/ai-overview-sources.ts` | the Default layout holds 9 cards with Key changes; the flow hid seven cards that no longer exist | Default has 11 cards without Key changes; the flow hides ten, keeps Top cited domains, adds Key changes and the ten others (12 cards) |
| same | "Answers collected" card, title "Answer collection calendar" | "Run calendar" |
| same | link name "searchenginejournal.com, Third party: ..." | the link is named by the domain; the role is text beside it |
| same | "By role" view of Top cited domains | removed on purpose (commit 5938b525): the test checks the Table view and that the View choice is gone |
| same | counts beside percents, old sentences of four cards | the sentences the cards now draw (units, answers, ran a search) |
| `ai-compare.spec.ts` | Groups tab row "SEO", "Content Marketing" (parent groups) | the flat tab lists Technical SEO, Blog Strategy, Local SEO, Paid Search; the drawer by address still opens SEO |
| same | "avg of" | "average of" |
| same | `filter({ has: icons })` with a locator that starts at the grid, so it never matched | a locator relative to the cell |
| `ai-add-prompts.spec.ts` | Groups tab row "SEO" | "Technical SEO" |
| `ai-citations.spec.ts` | "N of M units" in the strip value | the strip draws the share and change; the counts are the value's accessible description |
| `ai-evidence.spec.ts` | the newest answer always has an "Open at the provider" link | the mock leaves the link out for some answers (and which one is newest follows the clock): the runs are tried from the newest back |
| `ai-prompts.spec.ts` | Stats text "The interval is the 95 percent Wilson interval..." | "A rate is successes over valid answers in the period..." |
| same | History rows named "Mentioned and cited / only" | History rows read "Mentioned: yes" |
| `ai-topics-by-engine.spec.ts` | Content Marketing row, four tabs named "Prompts", "Groups beside this one", the parent "SEO" above Technical SEO, the By platform metric choice | Blog Strategy, "Prompts (n)", "Related groups", no parent line, no metric choice (removed, unit tests say so), Groups chip in the Add prompts dialog |
| `ai-runs-costs.spec.ts` | links named "Collecting answers" and "Gemini degraded" | links named "View run" and "View run for Gemini" with those words as text |
| `ai-settings.spec.ts` | "3 engines that are on" | "3 platforms that are on" |
| `shell.spec.ts` | a planned destination was Keywords | Competitors (Keywords is built); the 375 px test is one test per page |

## App bugs found (not fixed, per the brief)

Each has a `test.fixme` with the finding number, so it shows in the report as skipped, with its reason.

### O1. Competitor gap: the table wrapper scrolls with no keyboard stop (Overview, 768 and 1280 px)

axe rule `scrollable-region-focusable` (serious, WCAG 2.1.1). Reproduction: sign in as `priya@digibranders.test`, open
`/digibranders/fynix/ai` at 768 or at 1280 px wide (Default layout, any theme or density), run axe with the tags
wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa. The node is `.-mx-4.overflow-x-auto` inside
`[data-layout-card="lost-to-competitor"]`, drawn by `src/features/ai-overview/cards/competitors/lost-to-card.tsx`
(line 156). At 1024 and 390 px the page passes. Test: `ai-overview.spec.ts`, "axe: no serious or critical violation at
768 px" and "... at 1280 px" (fixme).

### O2. Top fan-out queries: the same wrapper (Overview card added by Customize, 768 px)

Same rule, node `.-mx-4`, drawn by `src/features/ai-overview/cards/sources/parts/fanout-table.tsx` (line 34). Found in
the 12 card layout the sources flow saves (Top cited domains, Key changes and the ten added cards), at 768 px, Default
density, light theme: the first step the flow reached after 390 px. The flow stops at the first violation, so more may
follow at other widths. Test: `ai-overview-sources.spec.ts`, "every card renders at 390, 768, 1024 and 1280 px ..."
(fixme, in both copies of it). The fan-out card in the Default layout is narrower and was not flagged in the Default
layout run, but O1 ends that run first at 768 and 1280.

### S1. Keywords, Costs and Runs scroll sideways at 375 px

Reproduction: sign in as `tomas@digibranders.test`, open each path at 375 x 812 and read
`document.documentElement.scrollWidth - clientWidth`: `/digibranders/fynix/seo/keywords` 87 px,
`/digibranders/fynix/costs` 160 px, `/digibranders/fynix/ops/runs` 109 px. The first elements past the screen are
`div.order-2.ml-auto.flex.h-control-sm.items-center.gap-3` (the right hand end of the page header) with a
`p.type-meta.whitespace-nowrap` in it on Costs and Runs, and a button pair on Keywords. Settings > Schedules (0 px) is
fine. The rule is 19-responsive-behavior.md ("the page itself never scrolls sideways"). Test: `shell.spec.ts`, "at 375 px
/digibranders/fynix/seo/keywords ...", "costs", "ops/runs" (fixme).

### P1. A first click on a Brands trigger can close the list at once (Prompts, low)

At 1440 x 900, Prompts, Groups tab: a mouse click on "Brands mentioned in the answers for Technical SEO: ... Open the
list" opens the popover and the same click leaves `aria-expanded="false"`. The cell sits at the right edge of the
table, so the click moves focus and scrolls the table sideways; `ListPopover` closes on any scroll (its own comment
says so), so it closes right after it opened. A second click opens it. A person whose click scrolls the table would see
the same. Enter on the focused trigger works. Not under a `fixme`: the new spec waits for the scroll to end first
(`openBrands` in `ai-prompts-groups.spec.ts`).

### O3. A page jump after choosing a Platform right after load (Overview, intermittent, not reproduced reliably)

Twice in 1440 x 1100 runs the document scrolled by 173 px (and by 447 px after a Group choice) between the click on a
Platform option and the next read, while the cards below were still loading; the sticky scope bar then sat at y 60
instead of 64. With a wait of 1 s or more before the click it did not happen, and a third attempt right after load did
not scroll either. Recorded as an observation; no test depends on it (the toolbar test now scrolls to the top).

## Skipped or `fixme`, and why

| Where | Count | Reason |
|---|---|---|
| `ai-add-prompts-shots.spec.ts` | 24 | A picture taking pass, off unless `WP27_SHOTS=1` (in the file). Not a test. |
| `ai-overview-sources.spec.ts` second describe | 3 | They need a server that starts with the AI seed (the development server); the production test build has Eventus Security with no platform on, and each test skips itself with that reason. Not run here. |
| `ai-overview-sources.spec.ts` every card axe flow | 1 (the Eventus copy of it is among the 3 above for the same flow) | `test.fixme`, finding O2 |
| `ai-overview.spec.ts` axe at 768 and 1280 px | 2 | `test.fixme`, finding O1 |
| `shell.spec.ts` 375 px Keywords, Costs, Runs | 3 | `test.fixme`, finding S1 |

Nothing was deleted. Two tests changed meaning because the screen removed the feature: the By role view of Top cited
domains (now asserted to be absent) and the By platform metric choice (the same).

## New flow specs

`e2e/flows/ai-overview-scope.spec.ts` (5 tests, Fynix, editor):

- Platform: choosing Gemini writes `engine=gemini_web`, the headline stops saying "Average of 2 platforms", the Answer
  outcomes card draws Gemini alone; Reset scope puts All platforms and the plain address back.
- Group: choosing Technical SEO writes `topic=...`, the Prompts tile goes from 23 to 4; Reset scope clears it.
- An old link `engine=gemini_web,chatgpt_web,google_ai_mode` (one platform is off) reads as All platforms and the
  address is tidied.
- A competitor name in Share of voice opens its drawer (tabs Overview, Prompts, Cited domains, `inspect=competitor:...`);
  Escape closes it, removes the key and returns the focus to the name.
- A group with no prompt in the chosen location (`topic=` Paid Search with `country=US`) keeps the scope bar with the
  chosen group, says "No prompts ask in ...", and Clear location brings the cards back.

`e2e/flows/ai-prompts-groups.spec.ts` (6 tests, Fynix, editor):

- The Groups tab is one flat list with two levels (`aria-level` 1 and 2); Expand all shows the prompts, Collapse all hides them.
- A group row opens its drawer with the tabs Overview, Prompts (2), Competitors, Related, and the Prompts tab lists the prompts.
- The Brands popover opens, marks "You" and "Not a competitor" brands with Add; Escape closes it and the focus returns.
- Add as competitor shows the toast "Copper added to your competitors" with Undo; the row says Added; Undo takes it off.
- The Screenshot and Cited pages columns exist only while one platform is chosen.
- The prompt drawer opens each of Latest, History, Citations, Competitors and Stats with that tab's own content.

The old-link case with the notice that says several platforms were read as All platforms needs a project with all three
platforms on; Fynix has two. The unit tests (`use-platform-link-fallback.test.tsx`) cover that wording.

## Visual specs

`e2e/visual/pages.spec.ts` is the only visual spec file (projects `visual-desktop` and `visual-mobile`). It has no page
for the AI visibility Overview or the Prompts page: its signed in pages are the workspace, settings, Keywords (list,
inspector, import review), Costs and Runs. No baseline images are tracked in the repository (they are made in the pinned
Docker image), so none could be compared and none was regenerated. Every project page shows the sidebar, so the
screenshots of Keywords, Costs, Runs and the settings pages may differ wherever the sidebar of the AI visibility group
or the "Last run" line changed in the port; that was not checked. Baselines need regenerating in the Docker image once
the port is merged.

## How to run the flow specs here

Tested on 2026-11-17 on macOS, Playwright 1.63 with its bundled Chromium (the browsers are already in
`~/Library/Caches/ms-playwright`; if one is missing, `pnpm exec playwright install chromium`). Run from `apps/web` of the
worktree. Use `localhost`, never `127.0.0.1`: the mock worker and the `__Host-` session cookie need it.

1. Build once, the way `webServer` in `playwright.config.ts` does (about 2 minutes), and rebuild after any change under
   `src/` or `messages/`:

   ```bash
   cd apps/web
   NEXT_PUBLIC_APP_ENV=test NEXT_PUBLIC_API_MOCKING=all NEXT_PUBLIC_RELEASE=e2e HOSTNAME=127.0.0.1 \
     API_INTERNAL_ORIGIN=http://127.0.0.1:8000 pnpm build
   node scripts/prepare-standalone.mjs
   ```

2. Serve it on a free port (check `lsof -nP -iTCP -sTCP:LISTEN` first; never kill a server that is not yours):

   ```bash
   PORT=3417 HOSTNAME=127.0.0.1 NEXT_PUBLIC_APP_ENV=test NEXT_PUBLIC_API_MOCKING=all \
     API_INTERNAL_ORIGIN=http://127.0.0.1:8000 node .next/standalone/apps/web/server.js
   ```

3. Run the specs against it (the mock state lives in the browser, so several Playwright processes can share one server):

   ```bash
   E2E_BASE_URL=http://localhost:3417 pnpm exec playwright test --project e2e e2e/flows/ai-overview-scope.spec.ts
   E2E_BASE_URL=http://localhost:3417 pnpm exec playwright test --project e2e e2e/flows/ai-*.spec.ts e2e/flows/shell.spec.ts
   ```

   Add `-g "part of a title"` to pick tests, `--reporter=list` to watch, and `--timeout=60000` to give the 30 s default
   more room (a spec that calls `test.describe.configure({ timeout })` keeps its own). One worker, as the config says.

4. Stop the server you started. `next dev` is not needed for the e2e; if you use it, delete the `AGENTS.md` and
   `CLAUDE.md` it writes into `apps/web`.

Timing: the whole set of this file's specs takes about 35 to 50 minutes, nearly all of it the accessibility matrices
(`ai-layouts*`, `ai-controls`, `ai-overview`, `ai-prompts`, `ai-topics-by-engine`). A failing test costs its timeout,
so when iterating, run one spec with `-g` and a short `--timeout`.

Traps met:

- The mocks are in the browser's memory: a test that writes (turns a platform on, adds a prompt) must move on by links,
  not by `page.goto`, as the older specs say.
- The mock answers' provider links, and which answer is newest, follow the clock. A test that needs a link tries the
  runs from the newest back.
- Playwright scrolls a target into view before it clicks. A control that closes on scroll (the Brands list) needs the
  scroll to finish first.
- The default 30 s test timeout is shorter than some flows. A spec that needs more says so in its own
  `test.describe.configure` or `test.setTimeout`.
