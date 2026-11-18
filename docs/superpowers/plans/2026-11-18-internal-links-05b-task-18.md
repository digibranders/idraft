# Internal links 05 Task 18 in step form: the Path finder

Expands Task 18 of `2026-11-17-internal-links-05-web-slices-2-3.md` against the code on `feat/internal-links-web` at 45aebd1f.

## What the real code changed against the outline

- The Journey tab is `features/internal-links/journey/journey-tab.tsx`. The view switch is a `SegmentedControl` (`semantics="view"`), the page picker is `FocusPicker` (one picker, its accessible name is the `focusTrigger` message), the layout switch and lane chips already show only in the canvas view, so the path view needs no extra hiding.
- `jv` allow-list lives in `url-state.ts` (`journeyView: 'canvas' | 'tree'`); Task 10 left `paths` out on purpose. It is added here with its test.
- Types: `Routes`, `Route`, `RouteStep` in `lib/internal-links/types.ts`; `routesQuery(scope, urlId, run)` in `queries.ts`; `closerNote` and `routeSteps` in `route-format.ts` (anchor is null for a redirect step, so the screen shows its own label); `isLinksDropped` in `contract-states.ts`; `reasonOf` in `problem-reason.ts`.
- `TierBadge` takes `tier` (a `TierRef` or null). `Badge` takes `tone` and a string child. Utilities `type-table`, `type-meta`, `type-subsection-title`, `size-icon-sm`, `border-border`, `text-foreground-tertiary` exist (`<Icon size="sm">` is used for icons).
- The "Open in canvas" helper is `context.openJourney(urlId)` (sets tab, focus, clears opened state, pushes history). It does not clear `jv`, so the button calls it and then writes `jv: null`.
- The API gives the same answer (both routes null) for a crawl with no start page and for a page not reached in 12 clicks, so the "no start page" sentence cannot be told apart from "cannot be reached". Both null renders the unreachable sentence. Noted as a contract gap.
- Mock data: `routesTo` in `mocks/internal-links-opportunities-world.ts`; handler `GET paths` (404 unknown, 410 dropped). Page 103 is `/services/soc-as-a-service` (1 click), 114 `/blog/vapt-checklist` (2 clicks, no editorial route), 117 `/partners` (unreachable).

## Files

- Create `journey/route-chain.tsx`, `journey/path-finder.tsx` and their tests.
- Modify `journey/journey-tab.tsx` (third view, picker label), `journey/focus-picker.tsx` (label by mode), `url-state.ts` and its test, `journey-tab.test.tsx` only if a view test needs it, `messages/en.json` (`internalLinks.paths`).

## Steps

- [ ] **Step 1: url-state test.** `jv=paths` reads as `journeyView: 'paths'`; unknown values read as canvas. Run, see it fail. Implement the three-way read. Run, pass.
- [ ] **Step 2: RouteChain tests (failing first).** Ordered list with `role="list"`; first card "Home page"; last card `aria-current="step"`; link line `linked as “anchor”` with the scope word for `auto_generated` ("auto-generated") and `template` ("menu and footer"), none for editorial; a redirect step shows "301 redirect" and never the backend anchor; status badge only when not 200; heading carries "N clicks" ("0 clicks" for a one step route); no text matching /equity/i.
- [ ] **Step 3: RouteChain.** Uses `routeSteps`, `TierBadge`, `Badge`, `Icon`; messages under `internalLinks.paths`.
- [ ] **Step 4: PathFinder tests (failing first).** From `jv=paths&focus=103` two chains "Over any link" and "Over editorial links only"; focus 114 shows the editorial null sentence; 117 shows the unreachable sentence; a page whose editorial route is longer shows the "Menus make this page N clicks closer" sentence (stubbed handler); picker labelled "Find the way to" and exactly one picker; the canvas view keeps "Focus page"; "Open in canvas" writes focus and removes `jv`; loading skeleton; 500 shows an error with Try again that reads again; 404 shows a neutral not found with no Try again; 410 shows the links dropped state; a crawl whose links are gone makes no read; invalid focus id shows the existing not found state; the run in view is sent as `run`; axe clean in light and dark.
- [ ] **Step 5: PathFinder and wiring.** `PathFinder({ context, page })` reads `routesQuery`; the tab renders it for `jv=paths`, adds the Path finder item to the switch, passes `mode` to `FocusPicker`.
- [ ] **Step 6: Messages, targeted checks, commit.** prettier, eslint, one typecheck, vitest one worker over `features/internal-links`, `lib/internal-links`, `mocks`, `i18n`, one `pnpm build`. Commit "Internal links: the Path finder as a third Journey view".
