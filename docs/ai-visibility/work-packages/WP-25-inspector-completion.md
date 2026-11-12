# WP-25: Prompt inspector completion: header, Latest, History, Stats (R-11 prompt part)

| Field | Value |
|---|---|
| Wave | W2: Topics & Prompts, inspectors, Citations, dialogs, runs and settings |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-25-inspector-completion` in `.claude/worktrees/wp-25` (`infra/dev/wp-start WP-25 inspector-completion`) |
| Depends on (merged on develop first) | [WP-07 app-parts-a](WP-07-app-parts-a.md), [WP-08 app-parts-b](WP-08-app-parts-b.md), [WP-04 chart-frame](WP-04-chart-frame.md) |
| Owner decisions | D-02 Prompt inspector tabs: 5 or 6 (and where Versions and Runs go) (default: 6 tabs: Latest, History, Citations, Competitors, Fan-out (only when an enabled engine exposes it), Stats. Versions and runs are sections of History; the full timeline is on Prompt Detail. DS 23 4.1 amended to allow 6) |
| Estimate | 6 Sonnet-agent tasks, about 4 hours with one task in flight |
| Rows | 35 (built already: 26, to do: 9) |

## Goal

Close every remaining prompt inspector row that needs no slice 2 to 4 data: topic path badge, tab count decision (D-02), Open statistics link, hashed evidence, source chips, stale event, model change marker, method and sample count parts, `ConfidenceIndicator` in the design system page.

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- web.md 2.11
- docs/design-system/23 4.1, 4.2

## Files this package owns

- `apps/web/src/features/prompts/prompt-inspector.tsx (sole owner in wave 2)`
- `apps/web/src/features/prompts/inspector-latest.tsx`
- `apps/web/src/features/prompts/inspector-history.tsx`
- `apps/web/src/features/prompts/inspector-stats.tsx`
- `apps/web/src/features/prompts/inspector-strip.tsx`

## Files it must not touch

- Any file another work package owns (each WP file lists its own); ask the coordinator for a lease instead
- `backend/openapi/v1.json` and `apps/web/src/lib/api/schema.ts` except by regeneration in the same push as your own API change
- `backend/src/idraft/api/main.py`, `permissions.py`, `problems.py`, `resources.py` (WP-01 registered everything); new problem codes go in your own module as `ProblemError` subclasses
- `apps/web/src/lib/navigation/registry.ts` except flipping your own page's status to `live`
- `apps/web/src/mocks/handlers/index.ts` (WP-02 registered your handler module)
- `apps/web/e2e/support.ts` (add `apps/web/e2e/support/<slug>.ts` instead)
- Message namespaces of other packages in `apps/web/messages/en.json`
- `docs/ai-visibility/tracker.json` and `TRACKER.md` (the coordinator owns them)
- The main checkout, `.claude/worktrees/release`, Colima and the `idraft-dev-*` containers

## Contract

Consumes the observation detail (CF-26 hashes checked in the evidence package).

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

One Sonnet implementer per tab group (two), one Sonnet reviewer.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-25 inspector-completion`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-25-inspector-completion.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Header: path badge, tab count, Open statistics, hashes | WB-PI-01, WB-PI-02, WB-PI-04..06, WB-PI-08..10, WB-PI-12, WB-PI-15..19, WB-PI-22, WB-PI-23 |
| 2 | Latest: source chips; built rows confirmed | WB-PIL-01..06 |
| 3 | History: stale event, model change marker | WB-PIH-01..05, WB-PIH-07, WB-PIH-08, WB-PIH-11 |
| 4 | Stats: aggregation label, SampleCount, ConfidenceIndicator entry | WB-PIS-01..04, WB-PIS-06 |
| 5 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- Each tab has loading, empty and error states and works at 390 px as a sheet
- Visible and usable at 390, 768, 1024 and 1280 px in light and dark, Default and Compact density, checked in a browser against the mock (`NEXT_PUBLIC_API_MOCKING=all`) and, once the backend is on develop, against the dev API
- Loading (skeleton), empty (reason and action), error (retry), partial and stale states for every new surface; no full-page spinner; a refetch keeps previous data with the RefetchBar
- axe clean (no serious or critical) at the four widths in both themes; keyboard path for every action; single-key shortcuts through `useShortcut`
- Every percent shows its count; unknown is never zero; colour only for a detectable change; engines never pooled silently; no em-dash or en-dash in any string
- Unit and component tests beside the files (Vitest with MSW); an e2e flow in the package's own spec file
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check` in the medium lane; `pnpm test` and `pnpm build` through `infra/dev/heavy` before the last push
- As built note written (doc 19 and doc 29 for backend; the package's section in the relevant spec for web) and the tracker report sent

## Review

- After every task: a fresh Sonnet reviewer subagent reads the task, the detailed plan and the diff, runs the task's targeted tests, checks the house rules (tokens, type utilities, `@/lib/format`, ASCII copy, no shell heredoc edits) and returns PASS or a numbered fix list; the implementer fixes and the reviewer re-checks
- At the end: a second fresh Sonnet reviewer reads the whole package diff against this file's acceptance criteria and the row list, and opens every changed page at the four widths

## Commit and push

- One commit per task, message `WP-25: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-25 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-25 <status> | branch ai/wp-25-inspector-completion @ <short sha> | rows done <n>/35 | steps <n>/6 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| WB-PI-01 | WB | BUILT | Header: prompt text in quotes as `h2`, clamped to 2 lines |
| WB-PI-02 | WB | BUILT | Header icons: previous (K), next (J), More, Close (Escape) |
| WB-PI-04 | WB | BUILT | Position "3 of 250", type word "Prompt", freshness |
| WB-PI-05 | WB | BUILT | Badges: topic (returns to the topic drawer), Branded, Archived (G91) |
| WB-PI-06 | WB | PARTIAL | Badge: topic path when opened from the Prompts tab (G91) |
| WB-PI-08 | WB | BUILT | Run now button in the header |
| WB-PI-09 | WB | BUILT | Archive with Undo; archived prompt shows no actions |
| WB-PI-10 | WB | BUILT | Strip: Mention rate per engine with k of n, plus one Citation rate ave |
| WB-PI-12 | WB | BUILT | Tabs Latest, History, Competitors, Stats in `?itab=` (G90) |
| WB-PI-15 | WB | SPEC | Tab count limit 5 (DS23 4.1) vs 6 with Fan-out |
| WB-PI-16 | WB | BUILT | Facts section: topic, language, importance, added, added by |
| WB-PI-17 | WB | BUILT | Load error with reason, unknown prompt, malformed id |
| WB-PI-18 | WB | BUILT | Responsive: docked at 1440, overlay from 768, full-screen sheet below  |
| WB-PI-19 | WB | BUILT | Resize handle |
| WB-PI-22 | WB | NOT BUILT | "Open statistics" link to the statistics panel (G102) |
| WB-PI-23 | WB | NOT BUILT | Hashed evidence shown (answer and raw SHA-256) |
| WB-PIL-01 | WB | BUILT | Latest valid answer per engine over 90 days, first 280 characters mark |
| WB-PIL-02 | WB | BUILT | Facts per card: mentioned, cited, order of mention (never Rank) (D-9) |
| WB-PIL-03 | WB | PARTIAL | First three sources as chips, "+N" overflow |
| WB-PIL-04 | WB | BUILT | "Open evidence" per engine to the answer viewer |
| WB-PIL-05 | WB | BUILT | Partial answers marked |
| WB-PIL-06 | WB | BUILT | No valid answer, pending, no text states |
| WB-PIH-01 | WB | BUILT | Mention rate chart per engine with 95% Wilson band (G94) |
| WB-PIH-02 | WB | BUILT | Engine select for the chart |
| WB-PIH-03 | WB | BUILT | Hollow points under 4 answers, gap with none |
| WB-PIH-04 | WB | BUILT | Chart frame Table view with the same numbers |
| WB-PIH-05 | WB | BUILT | Latest 10 answers table with outcome words (G95) |
| WB-PIH-07 | WB | BUILT | Events: added, engine reports another model (G96, M-19) |
| WB-PIH-08 | WB | NOT BUILT | Event: "Gemini had no valid answer for N days" (stale) |
| WB-PIH-11 | WB | NOT BUILT | Model change marker on the chart |
| WB-PIS-01 | WB | BUILT | Per engine Mention and Citation estimate, Wilson interval bar, sample  |
| WB-PIS-02 | WB | BUILT | "Too few answers for a reliable rate" |
| WB-PIS-03 | WB | BUILT | Method note |
| WB-PIS-04 | WB | PARTIAL | Aggregation label and `SampleCount` component |
| WB-PIS-06 | WB | NOT BUILT | `ConfidenceIndicator` registered in the design system page |
