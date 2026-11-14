# WP-27: Add prompts dialog redesign: plan block, checks, fields, topics, after the add (R-10)

| Field | Value |
|---|---|
| Wave | W2: Topics & Prompts, inspectors, Citations, dialogs, runs and settings |
| Kind | web |
| Status | in `docs/ai-visibility/tracker.json` (the coordinator updates it from your reports) |
| Branch and worktree | `ai/wp-27-add-dialog` in `.claude/worktrees/wp-27` (`infra/dev/wp-start WP-27 add-dialog`) |
| Depends on (merged on develop first) | [WP-13 prompts-lane](WP-13-prompts-lane.md), [WP-07 app-parts-a](WP-07-app-parts-a.md) |
| Owner decisions | D-07 Undo of an add (default: Undo archives the created prompts (no hard delete); the toast says so); D-21 Branded definition for lint (default: Own aliases only (as built); competitor aliases get their own warning rule); D-35 "Run now" or "Ask now" (default: Keep "Run now" on buttons) |
| Estimate | 10 Sonnet-agent tasks, about 8 hours with one task in flight |
| Rows | 132 (built already: 20, to do: 112) |

## Goal

Rebuild the Add prompts dialog to prompt-dialogs.md sections 3 to 5 and 9: split button and entry points, `N` shortcut, the line check list grouped by outcome, Type set from wording with override, Intent, Funnel stage, Importance, Branded override, topic picker with nested topics and inline create, the plan block (answers, quota, cost, engines skipped, Ask now cost, next run, header meter), duplicate cases from lint `tracked`, Ask these now, the success toast with Undo, Show it, new rows highlighted, focus, roles, error map, states and the tests. Includes the manual runs left and quota meter in the header and inspector (W19).

## Read first

- AGENTS.md and CLAUDE.md at the repository root (branches, develop only, releases only by `infra/ship.sh` on the owner's word, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6 (ownership, lock, models, coordination)
- docs/ai-visibility/owner-requirements.md (R-01 to R-11)
- The inventory rows listed at the end of this file, in docs/ai-visibility/inventory/
- AI_DEVELOPMENT_UI_RULES.md and DESIGN_SYSTEM.md (tokens, type utilities, no em-dashes in copy)
- docs/design-system/24-page-templates.md and 25-component-inventory.md (the parts this package uses)
- The approved preview in apps/web/design-preview for the screens this package touches
- docs/ai-visibility/inventory/prompt-dialogs.md sections 1 to 5, 9, 14, 16, 17, 19 to 22
- the Add keywords dialog in features/rankings as the reference

## Files this package owns

- `apps/web/src/features/prompts/add-prompts-dialog.tsx`
- `apps/web/src/features/prompts/add/ (new)`
- `apps/web/src/features/prompts/topic-picker/ (new)`
- `apps/web/src/features/prompts/limits/ (new)`

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

Consumes C1 (lint items, tracked, estimate, suggested type, limits read).

Web against mocks first: write the MSW handler to the generated types in your own handler module, with a test that the mock answers what the schema says; wire to the real route only after it is on develop and `pnpm gen:api` ran.

## Model plan

Opus plans; three Sonnet implementers (dialog shell, fields and topic picker; check list and plan block; after-add flow and limits); one Sonnet reviewer; Haiku writes the error map strings and test fixtures.

Every implementer is a fresh subagent for one task, writes the tests first, and edits files only with the file tools (never shell heredocs, `sed` or replace scripts). At most two subagents of this session run at once (MASTER-PLAN section 4).

## Steps

| # | Task | Rows |
|---|---|---|
| 0 | Start: `infra/dev/wp-start WP-27 add-dialog`; report `planning`; Opus writes the detailed task plan `docs/superpowers/plans/<date>-ai-wp-27-add-dialog.md` (each task: files, tests first, checks, the rows it closes) and commits it on the branch | process |
| 1 | Entry points, split button, `N`, empty state actions, topic drawer button | PD-ADD-01..06 |
| 2 | Fields: prompts, check list, language, country, type, intent, stage, importance, branded | PD-ADD-08..16, WB-ADD-01..06, WB-ADD-12, WB-ADD-13, WB-ADD-18 |
| 3 | Topic picker with nested topics and create | PD-ADD-19, PD-TOP-01..04, PD-TOP-06, WB-ADD-04 |
| 4 | Plan block: answers, quota, cost, skipped, Ask now cost, next run, meter | PD-QC-01..07, WB-ADD-07, WB-ADD-16 |
| 5 | Duplicate cases and lint rule display | PD-ADD-24..29, PD-LINT-01..09, WB-ADD-15 |
| 6 | Buttons, discard, Ask these now, result, toast with Undo, Show it, focus | PD-ADD-20..23, PD-POST-01..07, WB-ADD-08..11 |
| 7 | Limits before the click in header and inspector; bulk Add prompt for a topic | WB-TPH-14, WB-TPH-18, WB-PI-20, WB-BLK-09, WB-KEY-07 |
| 8 | Roles, error map, states, accessibility | PD-ROLE-01..06, PD-ERR-01..22, PD-STATE-01..06, PD-A11Y-01..09 |
| 9 | Tests | PD-TEST-01..07, PD-TEST-12, PD-TEST-13, PD-TEST-17, PD-TEST-18, PD-TEST-20, PD-TEST-23, PD-TEST-24 |
| 10 | As built notes; rebase; final checks through the lock; push; report `merged` | process |

## Acceptance criteria

- The 22 existing cases of `add-prompts.test.tsx` stay green
- Phone: the dialog is a sheet with a sticky plan line and reachable buttons with the keyboard open
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

- One commit per task, message `WP-27: <task title>` (no attribution lines, no dashes), naming only this package's files; never stage another session's files
- Before each push: `git fetch origin && git rebase origin/develop`; resolve generated files by regeneration, migrations by renumbering (MASTER-PLAN 3.7 and 3.9); re-run the targeted checks
- Push with `git push origin HEAD:develop` (fast-forward only); if rejected, rebase again
- Never push `main`, never run `infra/ship.sh`, never deploy

## Report to the coordinator

Run `infra/dev/wp-status WP-27 <status> "<note>"` and send the same line to the coordinator session, at each of: start (`planning`), plan committed (`building`), each push to develop, review start (`review`), blocked (`blocked`), done (`merged`). The line format:

```text
WP-27 <status> | branch ai/wp-27-add-dialog @ <short sha> | rows done <n>/132 | steps <n>/11 | blockers: <none or list> | next: <one line>
```

## Rows covered

Status words are the inventory's. SPEC marks a specification or contract row that has no status column of its own (errors, roles, states, tests, contract needs): treat it as to do until this package proves it. A BUILT row is confirmed, not rebuilt.

| Row | Inventory | Status at 246d3574 | Item |
|---|---|---|---|
| PD-ADD-01 | PD | BUILT | "Add prompts" primary button |
| PD-ADD-02 | PD | NOT BUILT | Split button chevron next to "Add prompts": "Paste a list", "Import CS |
| PD-ADD-03 | PD | BUILT | Topic row menu "Add prompt" |
| PD-ADD-04 | PD | NOT BUILT | Topic drawer button "Add prompts" |
| PD-ADD-05 | PD | NOT BUILT | Keyboard `N` |
| PD-ADD-06 | PD | PARTIAL | Empty state action "Add prompts" and "Generate from keywords" |
| PD-ADD-08 | PD | PARTIAL | Prompts |
| PD-ADD-09 | PD | NOT BUILT | Line check list |
| PD-ADD-10 | PD | BUILT | Language |
| PD-ADD-11 | PD | PARTIAL | Country |
| PD-ADD-12 | PD | NOT BUILT | Prompt type |
| PD-ADD-13 | PD | NOT BUILT | Intent |
| PD-ADD-14 | PD | NOT BUILT | Funnel stage |
| PD-ADD-15 | PD | NOT BUILT | Importance |
| PD-ADD-16 | PD | NOT BUILT | Branded |
| PD-ADD-19 | PD | PARTIAL | Topics |
| PD-ADD-20 | PD | PARTIAL | Primary button |
| PD-ADD-21 | PD | BUILT | Secondary |
| PD-ADD-22 | PD | BUILT | Discard guard |
| PD-ADD-23 | PD | NOT BUILT | "Ask these now" |
| PD-ADD-24 | PD | BUILT | Repeat inside the list |
| PD-ADD-25 | PD | PARTIAL | Active prompt with the same text, language, country |
| PD-ADD-26 | PD | NOT BUILT | Archived prompt with the same identity |
| PD-ADD-27 | PD | NOT BUILT | Same text, different case or spacing |
| PD-ADD-28 | PD | BUILT | Same text in another country or language |
| PD-ADD-29 | PD | BUILT | Race: someone adds the same prompt while the dialog is open |
| PD-TOP-01 | PD | PARTIAL | Topic picker |
| PD-TOP-02 | PD | NOT BUILT | Nested topics |
| PD-TOP-03 | PD | NOT BUILT | Create topic inline |
| PD-TOP-04 | PD | NOT BUILT | No permission to create |
| PD-TOP-06 | PD | NOT BUILT | Topic from the topic drawer |
| PD-QC-01 | PD | NOT BUILT | Answers |
| PD-QC-02 | PD | PARTIAL | Quota |
| PD-QC-03 | PD | NOT BUILT | Cost |
| PD-QC-04 | PD | PARTIAL | Engines skipped |
| PD-QC-05 | PD | NOT BUILT | Ask now cost |
| PD-QC-06 | PD | NOT BUILT | Next run |
| PD-QC-07 | PD | NOT BUILT | Header meter |
| PD-LINT-01 | PD | BUILT | `engine_limit` |
| PD-LINT-02 | PD | BUILT | `contains_brand_alias` |
| PD-LINT-03 | PD | NOT BUILT | `word_count` (doc 19 `length`) |
| PD-LINT-04 | PD | NOT BUILT | `multiple_questions` |
| PD-LINT-05 | PD | NOT BUILT | `leading_wording` |
| PD-LINT-06 | PD | NOT BUILT | `language_mismatch` |
| PD-LINT-07 | PD | NOT BUILT | `contains_competitor_alias` |
| PD-LINT-08 | PD | NOT BUILT | `suggested_prompt_type` (not a warning, a field) |
| PD-LINT-09 | PD | NOT BUILT | `tracked`, `near_duplicate_of` (fields) |
| PD-POST-01 | PD | PARTIAL | Success toast |
| PD-POST-02 | PD | NOT BUILT | "Ask now" |
| PD-POST-03 | PD | PARTIAL | Result view (when something was skipped or refused) |
| PD-POST-04 | PD | NOT BUILT | Show it |
| PD-POST-05 | PD | NOT BUILT | New rows in the table |
| PD-POST-06 | PD | PARTIAL | No answers yet |
| PD-POST-07 | PD | PARTIAL | Focus |
| PD-ROLE-01 | PD | SPEC | Viewer (`data:read`) |
| PD-ROLE-02 | PD | SPEC | Analyst (`data:read`, `runs:trigger`, `exports:create`) |
| PD-ROLE-03 | PD | SPEC | Editor (`prompts:write`, `taxonomy:write`, `imports:write`, `runs:trig |
| PD-ROLE-04 | PD | SPEC | Admin and owner (`panels:core:modify`) |
| PD-ROLE-05 | PD | SPEC | Member limited to some projects |
| PD-ROLE-06 | PD | SPEC | Rule |
| PD-ERR-01 | PD | SPEC | `quota_exceeded` (422, `limit`, `used`, `requested`) |
| PD-ERR-02 | PD | SPEC | `validation_failed` + `prompt_too_long` at `items.N.text` (422) |
| PD-ERR-03 | PD | SPEC | `validation_failed` + `value_error` (printable) |
| PD-ERR-04 | PD | SPEC | rejected `location_not_supported` |
| PD-ERR-05 | PD | SPEC | rejected `term_unknown` |
| PD-ERR-06 | PD | SPEC | rejected `single_valued_vocabulary` |
| PD-ERR-07 | PD | SPEC | rejected `duplicate_in_request` |
| PD-ERR-08 | PD | SPEC | rejected `duplicate` (`on_duplicate: error`, not used by the dialog) |
| PD-ERR-09 | PD | SPEC | `duplicate` (409, `existing_id`) |
| PD-ERR-10 | PD | SPEC | `too_many_matches` (422) |
| PD-ERR-11 | PD | SPEC | `immutable_field` (422) |
| PD-ERR-12 | PD | SPEC | `forbidden` (403) |
| PD-ERR-13 | PD | SPEC | `fresh_session_required` (403) |
| PD-ERR-14 | PD | SPEC | `not_found` (404) |
| PD-ERR-15 | PD | SPEC | `rate_limited` (429) |
| PD-ERR-16 | PD | SPEC | `manual_run_limit` (429) |
| PD-ERR-17 | PD | SPEC | `check_pending` (409, `engine_codes` or `prompt_ids`) |
| PD-ERR-18 | PD | SPEC | `nothing_to_run` (422, `skipped`) |
| PD-ERR-19 | PD | SPEC | `price_unavailable` (422) |
| PD-ERR-20 | PD | SPEC | `provider_paused` (503) |
| PD-ERR-21 | PD | SPEC | `budget_blocked` (run status) |
| PD-ERR-22 | PD | SPEC | network or 5xx |
| PD-STATE-01 | PD | SPEC | Prompts tab, no prompt |
| PD-STATE-02 | PD | SPEC | Prompts tab, no engine on |
| PD-STATE-03 | PD | SPEC | Add dialog, engines loading |
| PD-STATE-04 | PD | SPEC | Add dialog, countries failed |
| PD-STATE-05 | PD | SPEC | Add dialog, lint pending |
| PD-STATE-06 | PD | SPEC | Add dialog, lint failed |
| PD-A11Y-01 | PD | SPEC | Shortcuts |
| PD-A11Y-02 | PD | SPEC | Focus |
| PD-A11Y-03 | PD | SPEC | Announcements |
| PD-A11Y-04 | PD | SPEC | Disabled primary |
| PD-A11Y-05 | PD | SPEC | Check list |
| PD-A11Y-06 | PD | SPEC | Topic picker |
| PD-A11Y-07 | PD | SPEC | Phone |
| PD-A11Y-08 | PD | SPEC | Language of text |
| PD-A11Y-09 | PD | SPEC | Bulk over 100 |
| PD-TEST-01 | PD | SPEC | the counter splits new, already tracked, repeats from the lint `tracke |
| PD-TEST-02 | PD | SPEC | Add is disabled with the reason when the lint `would_create` is over t |
| PD-TEST-03 | PD | SPEC | the plan block shows answers a month and the cost per engine from `est |
| PD-TEST-04 | PD | SPEC | Type "Set from wording" sends no `prompt_type`; a chosen type sends it |
| PD-TEST-05 | PD | SPEC | Details fields send intent, stage, importance and the branded override |
| PD-TEST-06 | PD | SPEC | the topic picker creates a typed path on submit, not before; a failed  |
| PD-TEST-07 | PD | SPEC | the archived group's "Restore" sends `bulk-archive archive: false` wit |
| PD-TEST-12 | PD | SPEC | the success toast's Undo archives exactly the created ids; "Ask now" o |
| PD-TEST-13 | PD | SPEC | the result view's "Show it" closes the dialog and opens the inspector  |
| PD-TEST-17 | PD | SPEC | role matrix: viewer sees no add or edit items, analyst sees Run now an |
| PD-TEST-18 | PD | SPEC | lint rules: each new rule's wording appears on its line and none block |
| PD-TEST-20 | PD | SPEC | paste 12 lines with 2 tracked and 1 repeat, see the counts and the cos |
| PD-TEST-23 | PD | SPEC | phone width: the Add dialog is a sheet with the sticky plan line and t |
| PD-TEST-24 | PD | SPEC | viewer login: no add entry point anywhere, `N` does nothing |
| WB-ADD-01 | WB | BUILT | Paste one prompt or many (one per line, up to 1,000) |
| WB-ADD-02 | WB | BUILT | Counter of lines |
| WB-ADD-03 | WB | BUILT | Per line findings: repeat, already tracked, branded, engine limit, too |
| WB-ADD-04 | WB | BUILT | Topic select (with the topic preselected from a topic row) |
| WB-ADD-05 | WB | BUILT | Language select (required) |
| WB-ADD-06 | WB | BUILT | Country select limited to countries every enabled engine asks in |
| WB-ADD-07 | WB | BUILT | Quota line "Adds N of your remaining M" and over-quota state |
| WB-ADD-08 | WB | BUILT | Result view: created, skipped, rejected lines with reasons |
| WB-ADD-09 | WB | BUILT | Discard confirm on Escape or Cancel when lines are typed |
| WB-ADD-10 | WB | NOT VERIFIED | Cmd or Ctrl Enter submits |
| WB-ADD-11 | WB | BUILT | Announcer for lint results (not live regions) |
| WB-ADD-12 | WB | NOT BUILT | Type select prefilled by the server rule, person can change it |
| WB-ADD-13 | WB | NOT BUILT | Intent, importance, funnel stage fields |
| WB-ADD-15 | WB | NOT BUILT | Lint: 5 to 60 words, one question, leading wording, language mismatch, |
| WB-ADD-16 | WB | NOT BUILT | Run time and cost estimate for the added prompts |
| WB-ADD-18 | WB | PARTIAL | Description sentence names the engines and the cadence |
| WB-TPH-14 | WB | NOT BUILT | Active prompt quota meter in the header ("120 of 150 active prompts") |
| WB-TPH-18 | WB | NOT BUILT | Manual runs left today ("14 of 20 manual runs left today") before a cl |
| WB-PI-20 | WB | NOT BUILT | Manual runs left today in the header row |
| WB-BLK-09 | WB | NOT BUILT | Bulk "Add prompt" for a topic selection |
| WB-KEY-07 | WB | NOT VERIFIED | Cmd or Ctrl Enter submits Add prompts |
