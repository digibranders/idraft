# WP-27 add-dialog: detailed task plan

Brief: [WP-27](../../ai-visibility/work-packages/WP-27-add-dialog.md) (132 rows, steps 0 to 10), requirement R-10.
Spec the rows come from: [prompt-dialogs.md](../../ai-visibility/inventory/prompt-dialogs.md) sections 3 to 5, 9, 14, 16, 17, 19 to 22.
Branch `ai/wp-27-add-dialog`, worktree `.claude/worktrees/wp-27`, cut from `origin/develop` (WP-13, WP-25, WP-26 merged; migration head 0024).
Web only, no backend change. Not in Release A (Tier 3, RELEASE-A): nothing here blocks a release.
Written 2026-11-14. Read with AGENTS.md, MASTER-PLAN sections 3 to 6, AI_DEVELOPMENT_UI_RULES.md, DESIGN_SYSTEM.md.

## Ground rules for every task

- One fresh Sonnet implementer per task, then one fresh Sonnet read-only reviewer (PASS or a numbered fix list). Tests first:
  write the cases, run them, see them fail for the right reason, then write the code. Files are edited with Write and Edit only
  (never heredoc, `sed`, replace scripts). Haiku writes the message strings, the error map table and the MSW fixtures (T0, T8).
- One commit per task, `WP-27: <task title>`, no attribution, no dashes, only this package's files, never another session's.
  No commit or push from this planning step; the implementer of T0 commits this plan first (`WP-27: Task plan`).
- Command forms (medium lane; heavy lane only in T10). `<paths>` are repo-relative to `apps/web`.
  - tests: `infra/dev/heavy --lane medium --label wp27-tN --wait 30 --max 20 -- bash -c 'cd apps/web && pnpm exec vitest run <paths> --maxWorkers=3'`
  - lint: `pnpm --dir apps/web exec eslint --max-warnings 0 <files>`; format: `pnpm --dir apps/web exec prettier --check <files>`
  - types: `pnpm --dir apps/web typecheck` (medium lane, once per task)
  - always also `src/test/source-text.test.ts` and `src/i18n/messages.test.ts` (no em-dash or en-dash, catalog shape) in T0 and the last
    step of every task that adds strings.
- House rules the reviewer checks: design tokens and the 15 `type-*` utilities only; numbers and dates through `@/lib/format`
  (`formatInteger`, `formatCurrency`, `formatList`, `formatDate`; API money strings through `money()` in `@/lib/format/money`);
  every percent shows its count; unknown is never 0; engines never pooled; ASCII copy, sentence case, no dashes; Lucide through `Icon`;
  features never import another feature (eslint boundaries): so no import from `features/rankings`, copy the pattern instead;
  no `any`, no `as` on API data (zod or the generated types); skeleton, empty with reason, error with retry, partial, stale.
- Wire format of the C1 contract (c1-prompts.md, As built): `prompt_type` left out means the server rule sets it; `is_branded`
  is sent only when the person touched the Branded control; the lint estimate, `tracked`, `near_duplicate_of` and
  `would_create` exist only for the `items` body shape (`{text, language_code, country_iso}`); the `texts` body shape can take
  `language_code` for `language_mismatch`; `suggested_prompt_type` is in both shapes; `estimate.engines[].monthly_cost_usd` and
  `run_now_cost_usd` are decimal strings or null (null: no price in the price book).

## Verified facts (read from code at the branch base)

1. `add-prompts-dialog.tsx` (556 lines) is one component. It decides "already tracked" from `existing` (the loaded active page, W01),
   sends `API_DEFAULTS` (`prompt_type: 'question'`, intent, stage, importance), calls `usePromptLint` (texts shape only,
   `prompt-queries.ts`, leased to WP-19), keeps the quota line a note, has one topic `Select`, and renders the result view inline.
2. `add-prompts.test.tsx` (22 cases) pins the OLD wire format and copy: the lint body `{ texts, engine_codes }` (cases 1 to 5),
   the create body with `prompt_type: 'question'` (case 1), the line "Adds 1 prompt of your remaining 126." (cases 1, 4, 5, 20)
   and "quota is only a note, the click still sends" (case 6). The redesign changes exactly these on purpose (PD-TEST-04, PD-QC-02).
   So "the 22 cases stay green" is read as: every case keeps its title and its flow; an assertion that pins the old body or the old
   quota line is changed in T2 (body) and T5 (quota), each change listed in the As built note; no case is deleted or weakened.
   Expected edits: cases 1, 2, 3, 4, 5 (bodies and the quota line), 6 (over quota now blocks: the case is rebuilt as a race,
   lint says it fits and `bulk-create` answers `quota_exceeded`), 20 (announcer text). The other 14 stay byte for byte.
3. The mocks are behind the contract. `mocks/handlers/prompts.ts` lint takes `texts` only (an `items` body is a 422 for an extra
   member), has two of the seven rules, no `tracked`, `near_duplicate_of`, `would_create` or `estimate`; `PROMPT_FIELDS` lacks
   `is_branded`, `source`, `creation_method`, `generated_from`; `prompt_type` defaults to `question`. `GET {P}/ai/limits` has no
   mock: `mocks/handlers/prompt-limits.ts` is the empty module WP-02 registered for this package, but it is registered after
   `promptHandlers`, so it cannot override the lint route without an edit in `prompts.ts` (lease L1).
4. Seams already pre-created for WP-27: `seams/toolbar.ts` (comment lines `limitsMeter` from `../toolbar/limits-meter`, slot `actions`)
   and `seams/actions.ts` (`addPromptForTopicsAction` from `../actions/add-prompt-for-topics-action`, surface `bulk`). The brief owns
   `add/` and `limits/`, not `toolbar/` or `actions/`: the implementations live in `limits/` and `add/` and the two import lines
   are uncommented with the path changed (an edit inside the seam files, which is the seam protocol).
5. Already built by earlier packages: the topic drawer "Add prompts" button (`topic-drawer/use-topic-header.tsx`, `extras.onAddPrompt`,
   wired in `prompts-screen.tsx`); the bulk Run now confirm with runs of 150 and the day's 20 (`use-prompt-actions.tsx`
   `runDescription`, `bulkRun`, `bulkArchive` in `prompt-queries.ts`); `Meter` (`components/app/metric/meter.tsx`);
   `SplitButton`, `MultiSelect` with `creatable`, `Sheet`, `ConfirmDialog` in `components/ui`; `useShortcut`
   (`lib/a11y/use-shortcut.ts`, kinds `single-key` and others; single keys are off while typing and when the person turned them off);
   `useInspector().open({type:'prompt', id})` writes `?inspect=prompt:<id>` (URL state), callable from anywhere on the page.
6. `toast()` takes ONE action (`components/ui/toast.tsx`, "One action at most"). PD-POST-01 wants Undo and "Ask now" on one toast: see D5.
7. `Dialog` fills the screen below 640 px, never opens another overlay except the discard question (DS 16 section 4). So the check list
   is an inline disclosure at every width (the spec's bottom sheet on phone is a nested overlay: deviation D6), and "Ask now" after the
   add opens its `ConfirmDialog` only once the dialog is closed.
8. `DialogFooter` has `start`, `secondary`, `primary` slots: the one-line plan summary on phone goes in `start` (`sm:hidden`).
9. No `Disclosure` component exists. Build the Details, Check and Plan disclosures from a `Button` (`aria-expanded`, `aria-controls`)
   and a region, inside `add/` (reusable by WP-28), unless the implementer finds one in `components/app` first (grep, then decide).
10. Term create is `POST {W}/vocabularies/{id}/terms` with `{items:[{path}]}` (creates missing parents; an existing path adds nothing and
    returns no term, so the new leaf id is read from the tree after the call). The taxonomy mock handles `path`. Permission
    `taxonomy:write`; a member limited to some projects may write only a vocabulary of their project (`canWriteSharedTaxonomy`
    in `lib/permissions/permissions.ts`, PD-ROLE-05).
11. The schedules read (`GET {P}/schedules`) gives `is_active` and `next_run_at` per schedule; the owner keeps AI schedules paused, so
    "next run" must say so honestly (D7).
12. e2e: `e2e/flows/ai-prompts.spec.ts` belongs to WP-17. This package writes `apps/web/e2e/flows/ai-add-prompts.spec.ts` and, if it
    needs helpers, `apps/web/e2e/support/add-prompts.ts` (never `support.ts`).

## Decisions taken (never blocked on; the coordinator may overrule)

- D-07 Undo of an add archives exactly the created ids (`POST bulk-archive {ids, archive: true}`), never a delete. The toast says
  so in its description ("They stay in Archived."), and after the Undo a second toast says "N prompts archived. They stay in
  Archived." An archived prompt blocks a re-add as "archived" (PD-ADD-26 offers Restore), which is why the text says it.
- D-21 Branded for the lint is the own aliases only, as built. Competitor aliases are their own warning rule
  (`contains_competitor_alias`, PD-LINT-07). The Branded control does not change what lint computes; "Never branded" only warns when
  the lint says a line names the own brand (`is_branded` true in the lint answer).
- D-35 Keep "Run now" on buttons and menu items. "Ask" appears only in sentences ("Ask them now as well", the confirm title
  "Ask 9 prompts now?" as the spec words it). The existing bulk confirm keeps its own wording.
- D1 Lint input. With a language and a country chosen the dialog sends the `items` shape (debounced 300 ms, as now). Before a country
  is chosen it sends `texts` with `language_code` (warnings only) and the plan block says "Choose a country to check what is tracked."
  Items are the distinct cleaned lines that are not refused client side (too long, unsavable); tracked lines are NOT removed first,
  the lint answers them. While the lint is pending or failed, `existing` (the loaded active rows) is the fallback and the button stays
  enabled (PD-STATE-05, 06).
- D2 What is sent to `bulk-create`: lines the lint did not mark tracked (or, while the lint is unavailable, `existing` did not),
  `on_duplicate: 'skip'`, `term_ids` from the picker, `prompt_type` only for a chosen type, `is_branded` only when touched,
  `intent`, `funnel_stage`, `importance` as chosen (the API defaults when "Not set"/3). One request (at most 1,000 items).
- D3 Restore archived (PD-ADD-26): a checkbox in the "Archived" group, default on, label with the count. On submit: `bulk-create`
  first, then `bulk-archive {ids, archive:false}` for the archived `tracked.prompt_id`s. The quota check counts
  `would_create + restore count` against `limit - used`. If the restore fails after the create succeeded, the result view says
  "N prompts were added. M archived prompts could not be restored: <reason>" and offers Restore on each line.
- D4 Quota block (PD-QC-02): Add is disabled when `would_create + restore count > limit - used`, with the spec sentence. The server
  still has the last word (a race shows the existing `quota_exceeded` alert).
- D5 One toast action. The toast carries Undo (D-07). "Ask now" is reachable (a) from the dialog checkbox PD-ADD-23 (runs after the
  add, one confirm-free call because the person asked in the form, with the cost line shown beside the checkbox), (b) from the
  result view (when it shows), and (c) as the toast description's second step only if the coordinator grants L7 (a second toast action).
  Smallest honest treatment, recorded in the As built; PD-POST-02 and PD-TEST-12 are tested on (a) and (b) with the same confirm copy.
- D6 The line check list is an inline disclosure at every width, not a bottom sheet (nested overlay rule).
- D7 Next run (PD-QC-06): from the active ai_prompt schedules' earliest `next_run_at`, in the project's time zone. With none active:
  "Scheduled answers are paused, so these are asked only when you ask them now." Never a date the schedule would not honour.
- D8 Add menu alternatives (PD-ADD-02): `add/add-menu-entries.ts` is a registry. WP-27 ships the split button, the registry and the
  rule "no alternatives, no chevron" (the SplitButton docs forbid repeating the default action). "Import CSV" (WP-28), "Generate from
  keywords" (WP-44), "Review suggestions" (WP-46) each add one line. So PD-ADD-02 is built as a mechanism; the chevron appears when
  the first of those lands (named reason in the report).
- D9 Added-just-now (PD-POST-05): `add/just-added-store.ts` keeps the created ids and the add time (a `useSyncExternalStore`
  store, 4 s). The highlight and the "Added just now: 9" chip need table hooks in leased files (L2). Without L2 the store and the
  tests ship and the rows are listed in the report as seam only.
- D10 Phone summary: the plan line moves into `DialogFooter` `start` below `sm`; the full block stays in the body (a "Details" toggle).

## Leases and files outside the brief's owned list

Owned (brief): `add-prompts-dialog.tsx`, `add/`, `topic-picker/`, `limits/` (all under `apps/web/src/features/prompts/`).
New files nobody owns, added to this package (no lease): `apps/web/src/mocks/prompt-lint-rules.ts` and `.test.ts` (the mock's lint rules),
`apps/web/e2e/flows/ai-add-prompts.spec.ts`, `apps/web/e2e/support/add-prompts.ts`. Own module, already registered:
`apps/web/src/mocks/handlers/prompt-limits.ts` (with `prompt-limits.test.ts`).

| # | Path | Task | Change | Held by now |
|---|---|---|---|---|
| L1 | `apps/web/src/mocks/handlers/prompts.ts` (and `prompts-state.ts` if the state type needs a field) | T0 | widen `PROMPT_FIELDS` (`is_branded`, `source`, `creation_method`, `generated_from`); a `prompt_type` left out takes the wording rule and stores `prompt_type_source`; `is_branded` sent is kept with `is_branded_source: override`; the lint resolver hands the `items` shape (and the new rules) to `prompt-lint-rules.ts` in a few lines | WP-31 (additive, device) |
| L2 | `apps/web/src/features/prompts/prompts-screen.tsx` | T1, T6, T7 | one hunk replacing `addOpen`, `addTopic`, `openAdd`, `addButton`, `headerAdd`, `AddPromptsDialog` by `useAddPrompts(...)` (`add/use-add-prompts.tsx`); empty-state actions; the `justAdded` ids passed to the table; `limitsMeter` needs no screen edit (seam) | WP-19 (5 hunks), WP-30 (shared), later WP-17 |
| L3 | `apps/web/src/features/prompts/prompt-inspector.tsx` | T7 | `<ManualRunsLeft />` beside the Run now button (WB-PI-20) | nobody listed (hot spot: one holder at a time) |
| L4 | `apps/web/src/features/prompts/prompt-columns.tsx` and `rate-columns.tsx` | T6 | row highlight class for the created ids; "Not asked yet" tooltip wording for new rows (PD-POST-05, 06) | WP-19 (`rate-columns.tsx`), prompt-columns leased to WP-19 per the coordinator note |
| L5 | `apps/web/src/features/prompts/seams/toolbar.ts`, `seams/actions.ts` | T7 | uncomment the WP-27 import and slot lines; change the import paths to `../limits/limits-meter` and `../add/add-for-topics-action` | seam protocol, no lease needed; listed for the reviewer |
| L6 | the file that gives `TopBarControls` its `shortcuts` list (find it first: `grep -rn "shortcuts=" src/features src/app`) | T1 | one entry "N Add prompts" for the prompts page | unknown; only if it is outside `features/prompts` |
| L7 | `apps/web/src/components/ui/toast.tsx` | optional | a second `action` (D5 option c) | none; do NOT build unless granted |

L1 and L2 are the two that gate the plan. Without L1 the dialog cannot be tested against a mock that answers C1. Without L2 the
split button, `N`, empty-state actions and the highlight cannot reach the page (the dialog can still be built and tested alone).
Ask for L1 before T0 starts and L2 before T1 starts; T7 needs L3.

## Target structure (clean seams for WP-28, WP-44, WP-46)

```text
features/prompts/add-prompts-dialog.tsx   public export kept, same props plus optional ones; a thin shell composing add/ parts
features/prompts/add/
  add-model.ts          PURE. classify lines (new, tracked active, tracked archived, near duplicate, repeat, refused), counts,
                        quota and plan arithmetic, disabled reason. Takes plain rows, knows no React or API type beyond generated ones.
  add-payload.ts        PURE. values + lint -> PromptCreate items (type and is_branded only when chosen), restore ids, chunking
  add-values.ts         zod schema, defaults, dirty rule (every field counts)
  add-queries.ts        useAddLint (items or texts shape), useNextScheduled (D7)
  add-errors.ts         PURE. problem code -> message key and tone (T8; used by T6's submit)
  details-section.tsx   Type, Intent, Stage, Importance, Branded in a disclosure with a closed-state summary
  check-list.tsx        grouped list by outcome. Props are plain rows: WP-28's review step reuses it
  plan-block.tsx        plan lines (answers, quota, cost, skipped, ask now, next run). Props are plain numbers: WP-28 PD-CSV-13 reuses it
  after-add.tsx         result view, success toast builder, Undo, Show it, Ask now confirm (`useAfterAdd`)
  use-add-prompts.tsx   entry hook: open state, topic default, `N`, entry node, dialog node, `requestAdd` store
  add-entry.tsx         header "Add prompts" (plain or split) and empty-state actions
  add-menu-entries.ts   registry of split menu alternatives (D8)
  just-added-store.ts   ids and time of the last add (D9)
  add-for-topics-action.ts   PromptActionEntry for the bulk bar (WB-BLK-09)
features/prompts/topic-picker/   topic-picker.tsx, topic-picker-model.ts (pure), use-ensure-topics.ts
features/prompts/limits/         limits-queries.ts (`useAiLimits`, `GET {P}/ai/limits`), limits-model.ts (pure), limits-meter.tsx
                                 (toolbar seam entry), manual-runs-left.tsx (inspector)
messages: only `prompts.add.*` (extend) and `prompts.limits.*` (the reserved empty namespace). Read-only reuse of existing
          `prompts.bulk.runConfirm*`, `prompts.inspector.runLimit`, `runPaused`, `runQueuedHint`.
```

## Schedule

Cap: two subagents at once (one implementer plus the previous task's read-only reviewer; two implementers only if the coordinator
raises the cap). Order: T0 alone, then T1 (needs L2) and T2 are independent (T1 touches the hook and the screen, T2 the dialog
internals) and may swap order; then T3, T4, T5 in that order (each ends with one wiring line in `add-prompts-dialog.tsx`; the
implementer rebases on the previous task's commit first); then T6, T7, T8, T9, T10. T3 and T4 touch disjoint files and are the
second-best pair for two implementers. Push after T2 (first working redesign), after T6 and at T10, each after `git fetch origin &&
git rebase origin/develop`, `git push origin HEAD:develop`, then `infra/dev/wp-status` and the coordinator line (brief format).
Prove-it-bites (reviewer, scratch commit never pushed): T2, T4, T5, T6, T8 list their guards below.

---

## T0: Foundation: C1 mocks, pure model, queries (brief step 0, the part every later step shares)

Rows closed: none (enables all). Owned unless marked.
Files:
- `apps/web/src/mocks/handlers/prompt-limits.ts` + `prompt-limits.test.ts`: `GET {P}/ai/limits` to the generated `AiLimitsResponse`
  (`prompts` from `activePromptCount`, `ai_observations_month`, `manual_runs_today` read from the same counter `prompt-run-now.ts`
  and `runs.ts` use, so Run now moves it). A schema test parses the answer with a zod mirror of the generated type and checks
  `used` follows an add, a Run now and an archive.
- `apps/web/src/mocks/prompt-lint-rules.ts` + `.test.ts` (new): the `items` lint: `tracked` (identity text+language+country,
  archived included), `near_duplicate_of` (casefold and space fold, only when not tracked), `quota.would_create` (not tracked, not
  repeated, not over 2,000), `estimate` per engine (answers `floor(fit * 2 * 52 / 12)`, cost from the fixture engine price, one engine
  with `null` price so "no price" is reachable, run-now values unrounded) and the five rules (`word_count` 5 to 60,
  `multiple_questions`, `leading_wording`, `language_mismatch` with the 4-word floor, `contains_competitor_alias`) with the wording of
  c1-prompts.md. Mirrors `backend/src/idraft/api/ai/prompt_lint*.py`: read it before writing (read only).
- LEASE L1 `mocks/handlers/prompts.ts`: the few lines in facts 3. Do not rewrite the file.
- `add/add-model.ts` + `add-model.test.ts`: `classifyLines(lines, lintRows, existingKeys, restore)`, `lineCounts`, `quotaState(limits,
  wouldCreate, restore)`, `planNumbers(estimate, wouldCreate)`, `disabledReason(...)`. Pure and exhaustive: archived duplicate on an unloaded
  page counts as tracked, repeat folds, refused stays refused, quota arithmetic at the edges (0 left, exactly fits, one over).
- `add/add-payload.ts` + test: `buildItems(values, lines)`: no `prompt_type` key for "Set from wording", `is_branded` key only when
  touched, `term_ids` empty array when none; `restoreIds(lintRows)`; one request at most 1,000.
- `add/add-queries.ts` + test: `useAddLint` (items when language and a two-letter country are valid, else `texts` + `language_code`;
  `placeholderData: keepPreviousData`, `staleTime: 0`, key under `promptsKey(scope)` so `refreshPrompts` clears it), `useNextScheduled`.
  Uses `api.POST` through `unwrap` as `prompt-queries.ts` does; does not edit `prompt-queries.ts` (leased).
- `limits/limits-queries.ts` + test: `useAiLimits(scope)` (`apiQuery` of `GET {P}/ai/limits`, `staleTime` short, refetched by
  `refreshPrompts`'s key prefix).
- Characterization: before any edit, run `add-prompts.test.tsx` (22 green) and copy its pass list into the commit message body.
- Commit this plan file.
Failing tests first: the model and payload tests above (names: `counts an archived duplicate that is not on the loaded page as tracked`,
`a repeat is left out and named by its first line`, `quota fits at exactly the room left and is over by one`,
`prompt_type is absent for set-from-wording and present for a chosen type`, `is_branded is absent unless touched`,
`a null estimate price gives no cost, not zero`), `the limits mock answers the generated shape and moves with an add`,
`the items lint mock answers tracked, near duplicate, would_create and estimate for the project's own prompts`.
Verify: vitest on `src/features/prompts/add src/features/prompts/limits src/mocks/handlers/prompt-limits.test.ts src/mocks/prompt-lint-rules.test.ts
src/mocks/handlers/prompts.test.ts src/features/prompts/add-prompts.test.tsx src/test/source-text.test.ts src/i18n/messages.test.ts`;
eslint and prettier on the new files; typecheck. `prompts.test.ts` and the 22 cases must still pass (the edit in `prompts.ts` is additive).
Reviewer checks: the pure model imports nothing from React; the mock answers the schema (test present); `prompts.ts` diff is a few lines.

## T1: Entry points, split button, N, empty states (brief step 1)

Rows: PD-ADD-01..06, PD-TOP-06, PD-STATE-01, PD-STATE-02. Needs L2 (and L6 if the shortcut list is outside this package).
Files: `add/use-add-prompts.tsx`, `add/add-entry.tsx`, `add/add-menu-entries.ts`, `add/just-added-store.ts` (+ tests);
LEASE `prompts-screen.tsx` (L2, hunk one); LEASE L6 if needed.
Outline: `useAddPrompts({scope, project, engines, canWrite, existing})` owns `open` and `termId` (a new topic remounts the form with `key`, as
today), registers `useShortcut('n', open, {kind:'single-key', enabled: canWrite && enginesLoaded && !open})`, returns `{openAdd, entry,
emptyActions, dialog}`. `entry` is the header button: icon only below 640 px with the label as the accessible name; a `SplitButton`
only when `addMenuItems(...)` returns an item (D8), else the plain `Button`. Not drawn before engines are known (as today) and never for
a role without `prompts:write` (PD-ROLE-01). Empty states (Prompts tab and Topics tab, PD-STATE-01): "Add prompts" primary,
alternatives from the registry, text only for a viewer; PD-STATE-02 banner (`noEngineTitle`) is confirmed by a test, not rebuilt.
Topic row menu "Add prompt" and the drawer button call the same `openAdd(termId)` (confirm both with tests; the drawer is WP-20's code).
Failing tests first: `N opens the dialog from the page and does nothing while typing in a field`,
`N does nothing for a viewer and before the engines are known`, `the header shows a plain button without alternatives and a split
button when the registry has one`, `a topic row menu and the topic drawer open the dialog with that topic chosen`,
`the empty Prompts tab offers Add prompts to an editor and text only to a viewer`, `the header icon button keeps the label as its name below 640 px`.
Guards for prove-it-bites: role gate on the entry and on `N`.
Verify: vitest on `src/features/prompts/add src/features/prompts/prompts.test.tsx src/features/prompts/topic-drawer-wiring.test.tsx
src/features/prompts/row-menu.test.tsx`; eslint; prettier; typecheck.
Reviewer checks: the screen hunk is the single L2 hunk and the old Add tests of `prompts.test.tsx` pass unchanged.

## T2: Dialog shell and fields (brief step 2, without the check list)

Rows: PD-ADD-10..16, PD-ADD-21, PD-ADD-22, PD-STATE-03, PD-STATE-04, WB-ADD-01, 05, 06, 09, 12, 13, 18, PD-TEST-04, PD-TEST-05, PD-A11Y-02.
Files: `add-prompts-dialog.tsx` (shell), `add/add-values.ts`, `add/details-section.tsx`, `add/add-payload.ts` (wire), `add-prompts.test.tsx` (the
edits listed in fact 2: bodies only), new `add/details-section.test.tsx`, `add/add-dialog-fields.test.tsx`; messages `prompts.add.*`.
Outline: move the form state, zod schema and submit out of the old file into `add/`; keep the props
(`scope, open, onOpenChange, engines, existing, defaults`) and the 22 flows. Order (spec 4.1): Prompts, Country and Language side by
side (stack under 480 px dialog width; Country first), Topics (T3 slot, the old `Select` stays until T3), Details disclosure,
plan slot (T5). Description sentence names the engines and "twice a week (Monday and Thursday)" (WB-ADD-18, read engine labels from
`engines`; with none on, the no-engine sentence). Country hint names the engines and counts ("ChatGPT asks in 4 countries..."), links "Engine
settings" (new tab, `settings` engines route from `lib/navigation`), and the no-engine warning (tone warning, does not block);
countries read failure shows an inline error under Country with Retry (PD-STATE-04, `useCountries`); engines still loading never opens
the dialog with an empty list (PD-STATE-03, confirmed by the screen gate, test through `useAddPrompts`). Details: Type (`Select`, first
option "Set from wording", sends nothing), Intent, Stage (`SegmentedControl` or `Select`), Importance 1 to 5 with words, Branded
`RadioGroup` (Set from brand names (recommended), Always branded, Never branded); closed summary "Type: set from wording". The dirty rule
counts every field (PD-ADD-22) so the discard AlertDialog guards Details too. Initial focus on the Prompts field.
Failing tests first: `Type set from wording sends no prompt_type and a chosen type sends it` (PD-TEST-04),
`details send intent, stage, importance and the branded override only when touched` (PD-TEST-05),
`always branded sends is_branded true, never branded sends false, the default sends no key`,
`a Mod+Enter in the textarea submits once`, `Escape and Cancel with typed text ask to discard, also when only a Details field changed`,
`countries that failed show a retry`, `the no-engine warning shows and does not block`, `the description names the enabled engines`.
Guards: `is_branded` only when touched; `prompt_type` absent for set-from-wording; discard dirty covers Details.
Verify: vitest on `src/features/prompts/add src/features/prompts/add-prompts.test.tsx src/features/prompts/prompts.test.tsx`; eslint;
prettier; typecheck; messages test. Push after this task.
Reviewer checks: the 22 cases are all present and only the listed assertions changed; the shell is under 300 lines; no old
`API_DEFAULTS` left.

## T3: Topic picker (brief step 3)

Rows: PD-ADD-19, PD-TOP-01..04, WB-ADD-04, PD-TEST-06, PD-A11Y-06, PD-ROLE-05.
Files: `topic-picker/topic-picker.tsx`, `topic-picker-model.ts`, `use-ensure-topics.ts` (+ tests), wiring in `add-prompts-dialog.tsx`.
Outline: `MultiSelect` over the topic vocabularies' terms (`useVocabularies` from `@/lib/keywords/taxonomy-reads`, kind `topic`)
indented by depth, chips show the leaf with the parent prefix in `foreground-tertiary`; non-topic vocabularies in a second group "Tags"
(label `Vocabulary: path`); a single-valued vocabulary keeps the term chosen last (port the idea of `keepOnePerSingleVocabulary`, written
here, not imported); at most 20 terms ("A prompt takes at most 20 topics and tags."). One hint under the field: "A prompt counts under its
topic and the topics above it." (PD-TOP-02; choosing a child never adds its parent.) `creatable`: typed name offers "Create topic
'Startups'", with a slash "Create 'CRM / Startups'" (path, missing parents created); the choice is `kind: 'new'` in the form and is created
on submit, not when typed, by `useEnsureTopics` (`POST terms {items:[{path}]}`, then reads the tree for the leaf id), before `bulk-create`.
If the add then fails, the alert says "Topic 'Startups' was created. The prompts were not added." Without `taxonomy:write` the option
is replaced by the text "Only editors can create topics." (PD-TOP-04). A member limited to some projects creates only in the project's
own topic vocabulary (`vocabulary.project_id === scope.projectId`); with none, the text of PD-TOP-04 (PD-ROLE-05). Preselection from a
topic row or the drawer (`defaults.termId`) shows as a chip. Empty and error states: "No topics yet" with the create hint; a load failure
with Retry (`Vocabularies.retry`); never says "none" while loading. `MultiSelect` has no `aria-level`: the label carries the path, the
chip announces "CRM / Startups" (PD-A11Y-06, honest treatment if `MultiSelect` cannot take levels; do not fork the primitive).
Failing tests first: `creates the typed path on submit and not before` (assert no POST on typing, one POST on submit, in order before
bulk-create), `a failed add says the topic was created and the prompts were not added`, `without taxonomy:write there is no Create
option`, `a project-limited member can create only in their project vocabulary`, `choosing a child does not add the parent`,
`two terms of a single-valued vocabulary keep the last`, `more than 20 terms is refused with its text`, `the topic of the row it was
opened from is chosen`.
Guards: create on submit not on type; taxonomy gate; 20-term cap.
Verify: vitest on `src/features/prompts/topic-picker src/features/prompts/add src/features/prompts/add-prompts.test.tsx`; eslint; prettier; typecheck.

## T4: Check list, duplicates and lint rules (brief steps 2 (check list) and 5)

Rows: PD-ADD-08 (counter), 09, 24, 25, 27, 28, PD-LINT-01..09, WB-ADD-02, 03, 11, 15, PD-TEST-01, PD-TEST-18, PD-A11Y-05, PD-A11Y-08.
Files: `add/check-list.tsx`, `add/add-model.ts` (grouping), `add/add-announce.ts` (message keys), wiring in the dialog; tests
`check-list.test.tsx`, `add-model.test.ts` additions, `lint-rules.test.tsx`.
Outline: the counter under the field reads "12 lines: 9 new, 2 already tracked, 1 repeat" from `classifyLines` (new = lint
`would_create` when known, else the client count). The "Check" disclosure lists groups with a heading level 3 each: "Will be added",
"Already tracked", "Archived", "Repeats in the list", "Cannot be added", "Warnings"; every item starts "Line N", text clamped to one line
with `lang` = the prompt's `language_code` (PD-A11Y-08), the reason, and for tracked "Show it" (closes the dialog, T6 `useInspector`)
and for archived the Restore checkbox (state only here; T6 sends it, PD-ADD-26 closes there). Opens by itself when a line cannot be
added. Suggested type per line "Type: comparison (from wording)" from `suggested_prompt_type` (PD-LINT-08), hidden when the person
chose a type. Near duplicates are notes (not blocking): "Line 6 differs from a tracked prompt only in case or spacing: '...'. Both will
be asked." (PD-ADD-27). Same text in another country or language shows no note (PD-ADD-28, covered by the test with another country).
Order: errors, then warnings, then notes, by line (`TONE_ORDER`); a line with several findings shows the most serious and
"and 2 more checks" (expands in place). Lint rule wording as PD-LINT-01..07 with the engine and brand names; only an error
(over 2,000, unsavable) blocks, every new rule is a warning or a note that never blocks (PD-TEST-18). `contains_competitor_alias`
is a note when the effective type is comparison. `engine_limit` for an engine that is off is dropped (as today). Announcer: the
existing keys (`add-prompts-quota`, `-errors`, `-warnings`, `-result`) stay; a `-checks` key speaks the group counts once after the
debounce (no live region of its own, WB-ADD-11, PD-A11Y-05: `ul` with `aria-label` "Checks of the list", icons `aria-hidden`, tone in
words). `check-list.tsx` takes plain rows (`{line, text, language, group, reasons[], actions}`), so WP-28 reuses it for CSV rows.
Failing tests first: `an archived duplicate that is not on the loaded page counts as tracked, not new` (PD-TEST-01),
`the counter splits new, already tracked and repeats from the lint answer`, `each new lint rule shows its wording on its line and none
blocks the add` (PD-TEST-18, one case per rule with the mock's texts), `a near duplicate is a note and both are sent`,
`the same text in another country is not a duplicate`, `a line with several findings shows the most serious and a count`,
`the check list opens by itself when a line cannot be added`, `groups have level 3 headings and items start with Line N`, axe clean.
Guards: tracked decided by lint not `existing` (mutation: use `existing` only, the unloaded-page test must fail); errors-only blocks.
Verify: vitest on `src/features/prompts/add src/features/prompts/add-prompts.test.tsx`; eslint; prettier; typecheck; messages test.

## T5: Plan block, quota, cost, Ask now cost, next run (brief step 4)

Rows: PD-QC-01..06, PD-ADD-20, WB-ADD-07, WB-ADD-16, PD-STATE-05, PD-STATE-06, PD-TEST-02, PD-TEST-03, PD-A11Y-04.
Files: `add/plan-block.tsx`, `add/add-model.ts` (plan lines), `add/add-queries.ts` (`useNextScheduled`), wiring; tests
`plan-block.test.tsx`, `add-model.test.ts` additions; the quota cases of `add-prompts.test.tsx` (fact 2, edits to cases 1, 4, 5, 6, 20).
Outline: lines in order. Answers: "9 prompts x 3 engines x 2 runs a week = 78 answers a month" from `estimate` (sum of
`answers_per_month`; per engine only prompts that fit; the engines named are the ones in the estimate). Cost: "About $0.09 a month:
ChatGPT $0.03, Gemini $0.03, AI Mode $0.03 (standard queue)"; an engine with `null`: "AI Mode: no price in the price book."; under one cent
"under $0.01"; all null: no sum, only the engine lines. Engines skipped: "AI Mode skips 2 of these (over 700 characters)." from the
`engine_limit` warnings. Quota: "Workspace prompts: 131 of 150 used, 140 after this add." (`limit`, `used`, `would_create` + restored
count); over: "This add needs 12 places and the workspace has 9. Remove 3 lines, or archive prompts you no longer need." (negative tone, blocks, D4).
Ask now (shown only with `runs:trigger` and at least one engine on): "Asking them now adds 27 answers, about $0.03, and uses 1 of today's
20 manual runs (4 used)." from `run_now_answers`, `run_now_cost_usd` and `useAiLimits().manual_runs_today`; over 150 prompts "This is 2
manual runs: 150 and 30 prompts" (runs = `ceil(n / 150)`, and disabled with the reason when `used + runs > limit`, PD-ADD-23's reason text).
Next run (D7). Pending: last numbers dimmed with "Checking..." for the debounce plus the call, the button stays enabled (PD-STATE-05);
lint failed: "The list could not be checked. You can still add it; the server checks it." (info) and the client counts only (PD-STATE-06);
`texts` shape (no country yet): "Choose a country to check what is tracked." and no estimate, never a zero. Primary button
"Add N prompts" / "Add prompt", `focusableWhenDisabled`, `aria-describedby` the plan block id; disabled reasons: no line to send
("Every line is already tracked."), a line cannot be added, over the quota, with the reason in its tooltip and in the block (PD-ADD-20,
PD-A11Y-04). Phone: plan summary in `DialogFooter` `start` (D10). Every percent-free; every number through `formatInteger` and
`formatCurrency`; "about" before every estimate.
Failing tests first: `Add is disabled with the reason when would_create is over the room, and enabled again when lines are removed`
(PD-TEST-02), `the plan shows answers a month and the cost per engine from estimate, under $0.01 and no price for an engine
without one` (PD-TEST-03), `the lint pending keeps the last numbers dimmed and the button enabled`, `the lint failed shows the info
line and still adds`, `Ask now cost uses run_now values and the day's manual runs`, `no estimate and no zero before a country is chosen`,
`next run says scheduled answers are paused when no schedule is active`, `a disabled Add is focusable and describes its reason`, axe clean.
Guards: quota block arithmetic (mutation: `>=` for `>`, or `would_create` replaced by `fresh.length`); manual runs `ceil(n/150)` and the
`used + runs > limit` test; null price never rendered as `$0.00`.
Verify: vitest on `src/features/prompts/add src/features/prompts/add-prompts.test.tsx src/features/prompts/limits`; eslint; prettier;
typecheck; messages test.

## T6: Submit, restore, Ask now, result view, toast with Undo, Show it, focus (brief step 6)

Rows: PD-ADD-23, 26, 29, PD-POST-01..07, WB-ADD-08, PD-TEST-07, 12, 13, PD-A11Y-03, PD-A11Y-09. Needs L4 for PD-POST-05 and 06 in the table.
Files: `add/after-add.tsx`, `add/just-added-store.ts`, `add/add-payload.ts`, the dialog shell, tests `after-add.test.tsx`,
`submit-flow.test.tsx`; LEASE L4 (the table hooks) and the L2 hunk for the `justAdded` ids.
Outline: submit = ensure topics (T3), `bulk-create` (D2), then `bulk-archive archive:false` for the restore ids (D3), then
`refreshPrompts`. A clean add closes the dialog and shows the toast "9 prompts added", description "First answers Thursday 14 Nov from 01:00."
(D7) plus "They can be undone: Undo archives them." (D-07), action Undo: `bulkArchive(scope, createdIds, true)` then toast "9 prompts
archived. They stay in Archived." and `refreshPrompts`; Undo never touches skipped or restored ids and is a no-op for zero created ids.
With "Ask them now as well" ticked (PD-ADD-23) the add is followed by `bulkRun(scope, createdIds, engineCodes)` in chunks of 150, one
manual run each, stopping at the first refusal, using the same problem mapping as `use-prompt-actions` (`manual_run_limit`, `check_pending`,
`nothing_to_run`, `price_unavailable`, `provider_paused`, `quota_exceeded`), and the toast tells what was asked and what was not. When
something was skipped or refused the result view replaces the form (PD-POST-03): "9 prompts added.", "2 already tracked" with each text
and "Show it", "1 archived" with "Restore", "1 line could not be added" with its line and reason (per-item `message` of
`location_not_supported` names the engine, PD-ERR-04), buttons "Done" (primary, focus, as today) and "Copy the lines not added"; the race
(someone added the same prompt, PD-ADD-29) arrives as `skipped` with `existing_id` and reads "already tracked". Show it: closes the dialog
and calls `useInspector().open({type:'prompt', id})` (URL state; clearing hiding filters is left to the screen, listed under L2) and
focus moves to the inspector title (PD-POST-07; on a plain close, focus returns to the trigger, the `Dialog` default). New rows: the store
holds the ids for 4 s; with L4 the rows get the `primary-subtle` highlight and the filter bar shows "Added just now: 9" (removable);
"Not asked yet" cells get the tooltip "Asked next on Thursday 14 Nov." (PD-POST-06). A request over 100 prompts to ask or archive
confirms with the count (PD-A11Y-09, the confirm copy reuses `prompts.bulk.*`). Announce the result and the plan line under their
existing keys (PD-A11Y-03).
Failing tests first: `the toast Undo archives exactly the created ids and says it archives` (PD-TEST-12, asserts the request body
`{ids: created, archive: true}`, the HTTP method is POST bulk-archive and no DELETE), `Ask now calls ai/runs once per 150 prompts with the
created ids and shows the cost and the used runs in its confirm`, `Ask now is absent for a role without runs:trigger`,
`Restore sends bulk-archive archive:false with the add and the quota counts it` (PD-TEST-07), `a restore that fails after the create says so
and keeps the created prompts`, `Show it closes the dialog and opens the inspector of existing_id` (PD-TEST-13),
`a race duplicate reads as already tracked in the result view`, `Copy the lines not added copies the refused and skipped lines`,
`focus goes to Done in the result view and back to the trigger on close`, `the just-added store holds the ids for 4 seconds`.
Guards: Undo ids (mutation: include `skipped` ids, or use DELETE, the exact-ids test fails); Ask now role gate (`runs:trigger`);
chunking per 150; restore only for archived ids the person left ticked.
Verify: vitest on `src/features/prompts/add src/features/prompts/add-prompts.test.tsx src/features/prompts/prompts.test.tsx
src/features/prompts/bulk-actions.test.tsx`; eslint; prettier; typecheck; messages test. Push after this task.

## T7: Limits before the click, bulk Add prompt (brief step 7)

Rows: PD-QC-07, WB-TPH-14, WB-TPH-18, WB-PI-20, WB-BLK-09. Needs L3, L5.
Files: `limits/limits-model.ts`, `limits/limits-meter.tsx`, `limits/manual-runs-left.tsx`, `add/add-for-topics-action.ts`, `add/use-add-prompts.tsx`
(`requestAdd`), tests; LEASE L3 (`prompt-inspector.tsx`, one line), seam edits L5.
Outline: header meter as a toolbar seam `actions` entry: "120 of 150 active prompts" with `Meter` (no red until over, `warnFrom` near the
limit) and "14 of 20 manual runs left today" as text beside it (WB-TPH-18; "left" = `limit - used`; never raises the cap;
unknown while loading or failed: "Limits unavailable", never a zero). `useAiLimits` refetches after an add, a run and an archive
(shared `promptsKey` prefix). Inspector: `ManualRunsLeft` text in the header row beside Run now (WB-PI-20), hidden without
`runs:trigger`. Bulk action `add-prompt-for-topics` on surface `bulk` (`permission: 'prompts:write'`): when the selection has topics,
"Add prompt" opens the dialog with those topics chosen via a small `requestAdd({termIds})` in `use-add-prompts.tsx` (the dialog is
mounted by the screen, so the action reaches it through the hook's store, not a prop). The label stays "Add prompt".
Failing tests first: `the header shows N of limit active prompts and the runs left today`, `the meter is neutral until over`,
`limits unavailable shows text, not zero`, `the meter updates after an add`, `the inspector header shows the manual runs left for an editor and
nothing for a viewer`, `the bulk bar offers Add prompt for a topic selection and opens the dialog with those topics`,
`the analyst sees the runs left but no Add prompt`. axe clean.
Guards: runs left = limit - used (mutation: show `used`); permission on the bulk entry.
Verify: vitest on `src/features/prompts/limits src/features/prompts/add src/features/prompts/seams src/features/prompts/prompt-inspector.test.tsx
src/features/prompts/bulk-actions.test.tsx`; eslint; prettier; typecheck.

## T8: Roles, error map, states, accessibility (brief step 8)

Rows: PD-ROLE-01..04, 06, PD-ERR-01..22, PD-A11Y-07, PD-TEST-17.
Files: `add/add-errors.ts` + test (Haiku drafts the table and strings, Sonnet wires), `add/role-matrix.test.tsx`, `add/phone.test.tsx`,
small fixes in the touched components. Messages `prompts.add.errors.*`.
Outline: the error map is one pure function `addProblem(error, ctx) -> {message, tone, field?, retryable}` used by the submit and Ask now
paths, one case per row: PD-ERR-01 `quota_exceeded` ("The workspace has 148 of 150 active prompts, so these 9 do not fit...", uses
`used`, `limit`, `requested`), 02 and 03 (`items.N.text` named by the line the person typed it on, `prompt_too_long`, `value_error`),
04 to 08 (per item rejects; 04 uses the item `message` which names the engine), 09 (`duplicate`, "Show it" with `existing_id`),
10 (`too_many_matches`, link to Entities), 11 (`immutable_field` fallback), 12 (`forbidden`), 13 (`fresh_session_required`: use the app's
global re-auth handler if one exists, else the generic failure; documented), 14 (`not_found`, project gone), 15 (`rate_limited`
with retry seconds), 16 to 20 (the run problems: reuse `prompts.inspector.runLimit`, `runPaused`, `bulk.runNothingStarted` keys, add
`price_unavailable` and `check_pending` with the engine), 21 (`budget_blocked` text mapped, no live surface here: shown only by the
Runs page, WP-30), 22 (network or 5xx: "The prompts were not added. Try again in a moment.", the form keeps its text). Unknown
codes fall to the generic failure and never lose the typed list. Roles: viewer sees no entry, no `N`, no split menu; analyst sees no Add
but keeps Run now and Export elsewhere (checked here by rendering the page); editor sees all of this; admin the same; a project-limited
member as their role inside their projects (PD-ROLE-01..06; the client hides, the API decides, a 403 still maps to PD-ERR-12).
Phone (PD-A11Y-07, PD-TEST-23's component half): below 640 px the dialog is full screen, targets are 44 px (`h-control-lg`), the
sticky footer never covers the focused field (scroll the field into view on focus, using the existing helper in `components/app` if
there is one), the plan summary sits in the footer. Language of text: `lang` on each prompt text (T4) re-verified.
Failing tests first: `addProblem maps every code of PD-ERR-01..22 to its text and tone` (a table test, one row per code, the text exact),
`an unknown code gives the generic failure and keeps the list`, `a 5xx keeps the typed lines and says nothing was added`,
`role matrix: viewer, analyst, editor, admin and a project-limited member see the right entries and Add/Run controls` (PD-TEST-17),
`the primary button at 390 px is reachable with the keyboard open` (jsdom proxy: focus order and sticky footer classes; the real check is
the browser pass of T9).
Guards: error map (mutation: swap two codes' texts or drop `requested`, the table test fails); role gating (mutation: drop `prompts:write`
on the entry).
Verify: vitest on `src/features/prompts/add src/features/prompts/add-prompts.test.tsx src/features/prompts/prompts.test.tsx`; eslint;
prettier; typecheck; messages test.

## T9: Tests, e2e, browser pass (brief step 9)

Rows: PD-TEST-20, 23, 24, WB-ADD-10, WB-KEY-07, PD-A11Y-01. (The component tests of the other PD-TEST rows are written inside T2 to T8.)
Files: `apps/web/e2e/flows/ai-add-prompts.spec.ts`, `apps/web/e2e/support/add-prompts.ts` (a helper to start with N tracked prompts if
needed), a matrix audit in the As built.
Outline: e2e against the mock (`NEXT_PUBLIC_API_MOCKING=all`): PD-TEST-20 paste 12 lines with 2 tracked and 1 repeat, see the counts and
the cost, add, see the toast, Undo, see them in Archived (`filter[is_active]=any` or the Archived view), restore one; PD-TEST-23 phone
width 390: the dialog is a sheet with the sticky plan line and the buttons reachable with the keyboard open; PD-TEST-24 viewer login: no add
entry point anywhere (header, empty state, topic menu, drawer, bulk bar), `N` does nothing. WB-ADD-10 and WB-KEY-07: a Mod+Enter test
in the textarea (component test already from T2, verified here on the real page). PD-A11Y-01: `N` and `Mod+Enter` verified; `Shift+N`
belongs to WP-28, `E` to WP-29, `/` to WP-17: recorded with those reasons. Browser pass (reviewer, headless Playwright only, port 3209, stop it
after): 390, 768, 1024, 1280 px, light and dark, Default and Compact density, axe no serious or critical in both themes, no horizontal scroll;
loading, empty, error, partial and stale states of every new surface. Reconcile the 22 cases (fact 2) one last time.
Verify: `infra/dev/heavy --lane medium --label wp27-t9 --wait 30 --max 20 -- bash -c 'cd apps/web && pnpm exec playwright test e2e/flows/ai-add-prompts.spec.ts'`
(confirm the project's e2e script first: `grep e2e apps/web/package.json`); vitest on `src/features/prompts`; eslint; prettier; typecheck.

## T10: As built, rebase, final checks, push (brief step 10)

Files: As built section in the spec the web package belongs to (`docs/ai-visibility/inventory/prompt-dialogs.md` status lines are the
coordinator's; this package appends an "As built (WP-27)" section to `docs/19-api-specification.md` only if a contract note changed,
else only to `docs/29-phase-roadmap.md` and the package's own section in the design system docs `docs/design-system/25-component-inventory.md`
under SplitButton and the plan block parts, append-only, check that file's lease first).
Contents: the 22-case edit list, D1 to D10, the seam paths (`add/`, `topic-picker/`, `limits/`), what WP-28, WP-44 and WP-46 reuse (check list,
plan block, `add-menu-entries.ts`, `after-add.tsx`), rows built, rows with a named reason, the leases used.
Checks: `git fetch origin && git rebase origin/develop` (messages: keep both sides then `src/i18n/messages.test.ts`; generated files
by regeneration; no migration here), then through the heavy lane: `infra/dev/heavy --lane heavy --label wp27-final --wait 30 --max 40 -- bash -c
'pnpm install --frozen-lockfile && cd apps/web && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build'`.
Push `git push origin HEAD:develop` (fast forward only), `infra/dev/wp-status WP-27 merged "<note>"`, the coordinator line:
`WP-27 merged | branch ai/wp-27-add-dialog @ <sha> | rows done <n>/132 | steps 11/11 | blockers: <none or list> | next: <line>`.
The final reviewer reads the whole diff against the brief's acceptance criteria and the row table, and opens the dialog at four widths.

---

## Rows and the task that closes them (132)

| Task | Rows |
|---|---|
| T1 | PD-ADD-01..06, PD-TOP-06, PD-STATE-01, PD-STATE-02 |
| T2 | PD-ADD-10..16, PD-ADD-21, PD-ADD-22, PD-STATE-03, PD-STATE-04, WB-ADD-01, WB-ADD-05, WB-ADD-06, WB-ADD-09, WB-ADD-12, WB-ADD-13, WB-ADD-18, PD-TEST-04, PD-TEST-05, PD-A11Y-02 |
| T3 | PD-ADD-19, PD-TOP-01..04, WB-ADD-04, PD-TEST-06, PD-A11Y-06, PD-ROLE-05 |
| T4 | PD-ADD-08, PD-ADD-09, PD-ADD-24, PD-ADD-25, PD-ADD-27, PD-ADD-28, PD-LINT-01..09, WB-ADD-02, WB-ADD-03, WB-ADD-11, WB-ADD-15, PD-TEST-01, PD-TEST-18, PD-A11Y-05, PD-A11Y-08 |
| T5 | PD-QC-01..06, PD-ADD-20, WB-ADD-07, WB-ADD-16, PD-STATE-05, PD-STATE-06, PD-TEST-02, PD-TEST-03, PD-A11Y-04 |
| T6 | PD-ADD-23, PD-ADD-26, PD-ADD-29, PD-POST-01..07, WB-ADD-08, PD-TEST-07, PD-TEST-12, PD-TEST-13, PD-A11Y-03, PD-A11Y-09 |
| T7 | PD-QC-07, WB-TPH-14, WB-TPH-18, WB-PI-20, WB-BLK-09 |
| T8 | PD-ROLE-01..04, PD-ROLE-06, PD-ERR-01..22, PD-A11Y-07, PD-TEST-17 |
| T9 | PD-TEST-20, PD-TEST-23, PD-TEST-24, WB-ADD-10, WB-KEY-07, PD-A11Y-01 |
| T0, T10 | none (T0 enables every row; T10 is process) |

Count check: 9 + 21 + 9 + 23 + 14 + 16 + 5 + 29 + 6 = 132. The ids were matched one to one against
`docs/ai-visibility/tracker.json` (WP-27 rows): none missing, none twice.
Rows that need a built ("BUILT") confirmation only, with a test and no new code: PD-ADD-01, 03, 04, 21, 22, 24, 28, 29, PD-LINT-01, 02,
WB-ADD-01, 04, 05, 06, 09, 11, PD-TOP-06, PD-STATE-02.

## Rows that cannot be fully built against the current API, mocks or neighbours

| Row | Gap | Smallest honest treatment |
|---|---|---|
| PD-ADD-02 | the alternatives belong to WP-28 (Import CSV), WP-44 (Generate), WP-46 (Suggestions); a menu that only repeats the default is forbidden by `SplitButton` | the registry and split button ship (D8); the chevron shows when the first alternative lands |
| PD-ADD-06 | "Generate from keywords" has no dialog (WP-44) | empty state shows Add prompts and the registry's entries; the report names the gap |
| PD-POST-02 | the toast takes one action (fact 6) | D5: Ask now from the dialog checkbox and the result view; L7 optional |
| PD-POST-05, PD-POST-06 | the table lives in files leased to WP-19 | `just-added-store` and tests ship; the highlight, chip and tooltip need L4; otherwise reported as seam only |
| PD-QC-06 | the AI schedules are paused (owner rule), so there may be no next run | D7: say so, never invent a date |
| PD-QC-01..03 with Restore | the estimate covers `would_create` only; restored archived prompts are not in it | the plan says "plus M restored, not in the estimate" and counts them in the quota |
| PD-QC-02, PD-ADD-20 before a country is chosen | `quota.would_create` and `estimate` exist only for the `items` shape | "Choose a country to check what is tracked."; the button follows the client count and the server has the last word |
| PD-ADD-09 phone bottom sheet | nested overlay forbidden (DS 16 section 4) | D6: inline disclosure |
| PD-A11Y-06 `aria-level` | `MultiSelect` has no levels | the path is the label; no fork of the primitive |
| PD-ERR-13 | no flow of this dialog needs a fresh session | mapped, covered by the table test, falls to the generic failure unless a global handler exists |
| PD-ERR-21 | `budget_blocked` shows on the Runs page, after the worker plans | text mapped and tested; no live surface in this dialog (WP-30) |
| PD-A11Y-01 | `Shift+N`, `E`, `/` belong to WP-28, WP-29, WP-17 | `N` and `Mod+Enter` here; the rest recorded with those packages |
| PD-ADD-26 Restore quota text | `would_create` counts near duplicates, restore adds places | the plan adds the two; a race still ends in the existing `quota_exceeded` alert |

## Open questions and leases needed (for the coordinator)

1. L1 `apps/web/src/mocks/handlers/prompts.ts` (few lines, held additively by WP-31): the mock lint, create and type rule are behind the
   C1 contract; this gates T0. Alternative if WP-31 is still building: grant it as additive and shared, rebase keeps both sides.
2. L2 `apps/web/src/features/prompts/prompts-screen.tsx` (one hunk, about 40 lines, held by WP-19 with WP-30 shared and WP-17 later):
   gates T1, T6 and the highlight in T7. Entry-point rows that need an edit in a leased file: PD-ADD-02, 05 (the `N` hook is mounted
   by the hook, the screen call site is the hunk), 06 (header and empty-state actions), PD-POST-05 (ids to the table). The seam from
   the owned folder is `add/use-add-prompts.tsx`: after the hunk, later changes stay in `add/`.
3. L3 `prompt-inspector.tsx` (one line, WB-PI-20). L4 `prompt-columns.tsx` and `rate-columns.tsx` (PD-POST-05, 06). L6 the shell
   file that lists page shortcuts, only if it is outside `features/prompts`. L7 a second toast action (optional, D5).
4. The 22 existing cases cannot stay byte for byte: 7 of them pin the old wire format or the "note only" quota line that this redesign
   replaces by owner spec (PD-TEST-04, PD-QC-02, W04). Confirm the reading in fact 2 (each case kept, assertions on the body and the
   quota line updated, listed in the As built). The alternative is to keep sending `prompt_type: 'question'` and the texts-shaped lint,
   which contradicts the spec and the WP-13 follow-up notes.
5. D5: accept "Undo on the toast, Ask now on the checkbox and the result view" for PD-POST-01 and PD-POST-02, or grant L7.
6. D3: restore after create (create first, restore second) leaves a partial result if the restore fails; accept, or ask WP-13 for a
   combined route (not needed for Release A, not planned).
7. D7: the owner keeps AI schedules paused; the "next run" line says so. Confirm the wording is acceptable until they resume.
8. The brief's owned list names `limits/` and `add/`; the seam files name `toolbar/limits-meter` and `actions/add-prompt-for-topics-action`.
   This plan uses `limits/` and `add/` and edits the two import paths (L5). Say if a `toolbar/` folder is preferred.
9. Shared files used read only and not edited: `en.json` outside `prompts.add.*` and `prompts.limits.*`, `prompt-queries.ts`,
   `use-prompt-actions.tsx`, `topic-drawer/*`, `components/ui/*`, `lib/api/schema.ts` (no API change, so no regeneration).
