# Internal links web, plan 07: owner decisions D8 to D16

Scope: the web parts only. The backend session does the API side. Wire a task only after its fields are in
`backend/openapi/v1.json` on develop (merge develop, run `pnpm gen:api` in its own commit). Subagents: Sonnet or
Haiku, one at a time. Tests: targeted and serial. The Playwright and axe specs are not run in the worktree; they run
once on develop in the main checkout.

D8, D9, D11 and D12 are accepted as planned (in-app alerts only; the Links tab Added and Lost columns are for the
crawl in view). They need no new web work beyond what plan 05 built.

## Tasks

### T1. D13 wording (no API needed)

- Scan `src`, `messages` and `design-preview` for visible "Equity" wording. Result on 2026-11-23: none. `equity` only
  appears in code identifiers (`equity_share`, `equity_points`) and comments, none of it rendered.
- Rule for later tasks: the change column and every string say "Link strength change", in points, never the share.
  The column is built when the API sends the points (open point P1 of the run log). Add a glossary line for it in
  `docs/glossary/terms.md` first.
- Done when: a test in the catalog suite asserts no `en.json` string contains "equity".

### T2. D10 Today labels (needs `rank_as_of`, `citations_as_of`)

- The rank and citation column headers read "Today".
- When the crawl in view is older than that date, a small note under the table header shows the crawl date.
- Touch: `pages/page-columns.tsx`, `pages/page-extras-cells.tsx`, `messages/en.json`, the mock world and handlers.

### T3. D16 server-side sorts (needs the new sort values)

- Rank, citation and anchor columns sort on the server like Change: map the column id to the API sort field in
  `pages/page-columns.tsx`, extend `PageSort` in `lib/internal-links/types.ts`, send it from `pages-tab.tsx`.
- The mock handler sorts the same way so the screen can be tested.

### T4. D15 shareable client summary link (needs the share endpoints)

- A "Share link" action beside the client summary download (`export/client-summary-action.ts`). The download stays.
- Dialog: create, copy, expiry choice (7, 30 or 90 days, 30 default), revoke. Shows the current link and its expiry.
- Public read-only page outside the app shell, no sign-in, no navigation into the app, reading the summary by token.
  Expired or revoked token shows a plain "This link is no longer available" page.
- Reuse the client summary view (`lib/internal-links/client-summary.ts`). Mock handlers for create, read and revoke.

## Gates per task

Prettier and eslint on changed files, one typecheck, `vitest --maxWorkers=1` on the touched folders, a review by a
fresh Sonnet subagent, a log entry in `web-run-log.md`.
