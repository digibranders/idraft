# Internal links 00: roadmap

This page says in what order the internal link tracker is built, who does what, where each piece lands, and what the owner has to decide. It does not repeat the plans. Read it first; then open the plan you are about to run.

- Spec: `docs/superpowers/specs/2026-11-16-internal-link-tracker-design.md`
- Reference UI (done, on `develop`): the design preview route `#/internal-links`, files `apps/web/design-preview/il*.js`
- Plan 01, crawl spike: `2026-11-16-internal-links-01-crawl-spike.md`
- Plan 02, backend slice 1: `2026-11-16-internal-links-02-backend-slice-1.md`
- Plan 03, web slice 1: `2026-11-16-internal-links-03-web-slice-1.md`

## What exists today

| Piece | State |
|---|---|
| Research and spec | Done, merged and pushed |
| Mock in the design preview (all slices, including changes, alerts, opportunities and the path finder) | Done on `develop`, tested in a headless browser; the latest mock commits are local and not pushed |
| Backend and real app | Nothing built. Plans 01 to 03 are written. |
| Crawl spike S-17 | Not run. It spends real money, so it waits for the owner. |

## Scope of this program

Slice 1 only, as plans 02 and 03 define it: tiers and tags, bulk tagging, tier rules and CSV import, the crawl (on website add, weekly, Crawl now), Pages and Links tabs, the Journey canvas and tree list, the Tier flow, the settings screens. The slice 2 and 3 screens that the mock already shows (crawl picker, Changes, alerts, Opportunities, Path finder, rank and anchor columns, client summary) are built after slice 1 ships and are not planned yet.

The UI never shows an equity share (owner decision, 2026-11-16). The backend may compute it for ordering and for later use.

## Order

```
Plan 01 tasks 1 to 6 (no spend) ──┐
                                   ├─ owner go-ahead and two test sites ─ Plan 01 task 7 (about $2.75, cap $5) ─ write-up, gate ─┐
                                                                                                                                     │
Plan 02 tasks 1 to 4, 6, 7, 12 (no dependency on the spike) ───────────────────────────────────────────────────────────────────────┤
                                                                                                                                     ▼
                                                      Plan 02 task 0 (adjust to spike), tasks 5, 8, 9, 10, 11, 13, 14 ──── OpenAPI on develop
                                                                                                                                     │
Plan 03 tasks 0 to 4 (design system and pure modules, no API needed) ───────────────────────────────────────────────────────────────┤
                                                                                                                                     ▼
                                                                                        Plan 03 task 5 onward (generated client) ─ tasks 6 to 18
```

1. **Plan 01 first, in part.** Tasks 1 to 6 (classifier, spike script, tests) cost nothing and run at once. The paid run (task 7) waits for the owner. Plan 02 imports the classifier from plan 01, so plan 01 merges before plan 02 tasks 5 and 8.
2. **Plan 02 in parallel.** Tasks 1, 2, 3, 4, 6, 7 and 12 do not depend on the spike results and can start the day the backend worktree opens. Task 0 (read the spike, adjust the plan) comes before the tasks it can change: 5, 8, 9 and 11.
3. **Plan 03 in parallel with plan 02.** Tasks 0 to 4 (tier tokens, `TierBadge`, pure rules, journey layout, `LinkCard`, `LinkCanvas`) need no API. Task 5 needs `backend/openapi/v1.json` with the internal links routes on `develop`. If that is not there yet, the web session stops after task 4 and reports. It never invents a schema.
4. **Hand-over.** Plan 02 task 13 checks the contract against plan 03's expectations. The web session regenerates the client in its own commit right after (`pnpm gen:api`, AGENTS.md).
5. **Acceptance on a real site.** Plan 02 task 14 and plan 03 task 17 run against a real crawl of the spike sites. Only then does the owner decide to release.

## Worktrees and branches

| Plan | Worktree | Branch |
|---|---|---|
| 01 | `.claude/worktrees/internal-links-spike` | `feat/internal-links-spike` |
| 02 | `.claude/worktrees/internal-links-backend` | `feat/internal-links-backend` |
| 03 | `.claude/worktrees/internal-links-web` | `feat/internal-links-web` |

All three are cut from `origin/develop` and merge into `develop`. Nothing goes to `main` except through `infra/ship.sh` when the owner says to release (AGENTS.md). Shared files that other tracks also change (messages, design-system registry, tokens, `ProjectSettings`) are named in each plan; merge `develop` into the branch before the final gate.

## Review steps

Every plan task ends with an independent review (owner rule). Opus plans and reviews; Sonnet builds. In addition:

- After plan 02 task 3, 6 and 12: a review of row-level security and permissions, because these tasks add tables and read paths.
- After plan 02 task 9: a review of cost control (budget check before posting, no blind repost after a timeout).
- After plan 03 task 4 and task 11: a review of the canvas for keyboard use and screen reader names, in both themes.
- Before merging each branch: the gate of AGENTS.md for the parts touched (backend `./check.sh`; web lint, typecheck, test, format check, build).

## Decisions the owner has to make

| # | Decision | Needed before | Recommendation |
|---|---|---|---|
| D1 | Go-ahead to spend up to $5 on the spike, and the names of one WordPress site and one other CMS site to crawl besides cleanstart.com | Plan 01 task 7 | Approve; estimate is $2.75 |
| D2 | Crawl billing by `max_crawl_pages`: a site with no sitemap would cost about $7.50 a crawl at the 50,000 page ceiling (plan 02, O1) | Plan 02 task 9 | Decide after the spike prices it; likely use the larger of 2,000 and 3 times the pages seen last time |
| D3 | Template pass guards that amend spec 6.3 (steady count, minimum folder size, self links; plan 01 decision 6) | Plan 01 gate | Accept; the spec is edited at the gate |
| D4 | Pages list size: the house table sizes (100 or 200 rows) or the mock's 25 with "Show 25 more" (plan 03, P1) | Plan 03 task 7 | House sizes |
| D5 | Rules cannot set Untiered; tier flow is a table, not a chart; no 150 ms layout motion on the canvas (plan 03, P2 to P4) | Plan 03 tasks 11 to 13 | Accept all three for slice 1 |
| D6 | Push the unpushed mock commits on `develop` | Whenever | Push, they are reviewed and tested |
| D7 | Where this track sits next to the AI visibility program | Before staffing | Its own track; nothing here touches the AI visibility tables |

## Contract gaps the backend should close

Plan 03 lists, in its "Contract gaps for the backend" section, the places where the web has to work around the API (for example no `sort=tier` on pages, no dry run for CSV import, no bulk save of tier rules). Each has a web fallback written into plan 03, so none blocks the build. Closing them removes web code. Take them to the backend session after plan 02 task 12.

## Out of scope for the whole program

- Slice 2 and 3 screens in the real app (planned after slice 1 ships).
- Any equity share figure in the UI.
- Crawl limits and pricing (owner: discuss later).
- Two-factor and other hardening (build order: core features first).

## Done means

- The spike write-up exists and the spec reflects it.
- The backend passes `./check.sh` and its acceptance run on a real crawl of a spike site.
- The web passes its gate, the Playwright flow and axe on every tab in both themes.
- The real Internal links page matches the mock screen by screen, apart from the decisions D4 and D5.
- The owner reviewed it on `develop` and said to release.
