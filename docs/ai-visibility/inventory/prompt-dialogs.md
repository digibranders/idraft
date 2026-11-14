# Prompt dialogs: add, import, generate, edit, organize and manage prompts

Status: specification for the upgrade, not built unless a row says BUILT
Date: 2026-11-12
Branch read: `ai/prompts-slice1` (develop tip `246d3574`), worktree `.claude/worktrees/ai-prompts`
Scope: every dialog, drawer, menu, toggle and bulk action through which a person adds, imports, generates,
edits, organizes and manages AI prompts in Topics & Prompts and Discover > Prompts. Out of scope: AI readiness
(owner, 2026-11-12), answer reading, rates and charts.

Owner decisions this spec applies (2026-11-12):

- `prompt_type` comes from a server rule at create: " vs " or "versus" gives `comparison`, "how to" gives
  `how_to`, a leading interrogative gives `question`. A person may override it in the Add dialog and on `PATCH`.
- A version restore is not a `change_kind`. It re-points `current_version_id` and writes an audit entry.
- Every prompt runs twice a week (Monday and Thursday). Panels run twice a week too; a per-panel cadence is not
  offered.
- The manual run cap stays at 20 manual runs a day per project.
- No AI readiness work.

## 0. How to read this document

- **ID**: `PD-<flow>-<nn>`. Flows: `ADD` (Add prompts dialog), `PASTE` (paste with columns), `CSV` (file import),
  `GEN` (generate from keywords), `CAND` (suggestions and candidates inbox), `POST` (after an add), `EDIT`
  (details and text edit), `VER` (versions and restore), `ARC` (archive and restore), `PAN` (panels), `TOP`
  (topic assignment), `ROW` (row menu), `BULK` (bulk bar), `INS` (inspector), `LINT` (lint rules), `QC`
  (quota and cost preview), `ERR` (error map), `ROLE` (permissions), `STATE` (empty and loading), `A11Y`
  (keyboard and accessibility), `TEST` (tests).
- **STATUS**: `BUILT` (with the file), `PARTIAL` (what is missing is named), `NOT BUILT`.
- **API**: an existing route as `METHOD {P}/path`, or `NEW` with the proposed shape. `{P}` is
  `/api/v1/workspaces/{workspace_id}/projects/{project_id}`. "web only" means no API change.
- **Size**: S (under a day), M (one to three days), L (more than three days), for the web part unless the row
  says backend.
- **Deps**: other IDs or backend items (B10 to B18 of the gap analysis, N01 onward of section 18 here).
- Copy in quotes is the proposed English string. Strings follow the house rules: no em-dashes, sentence case,
  the verb and the count on the primary button.

## 1. The facts every flow rests on (as built, read from code)

| Fact | Value | Where |
|---|---|---|
| Longest prompt that can be saved | 2,000 characters (code points) after trim and NFC; longer is `422 validation_failed` with `prompt_too_long` and fails the whole request, bulk included | `backend/src/idraft/api/schemas/ai.py` `_prompt_text`; `domain/ai_engines.py` `PROMPT_TEXT_MAX` |
| Engine length limits | ChatGPT 2,000, Gemini 2,000, Google AI Mode 700. A prompt of 701 to 2,000 is saved and AI Mode skips it | `domain/ai_engines.py` `ENGINES` |
| Characters refused | control, format, line and paragraph separator characters (`printable`) | `schemas/common.py`; web mirror `UNSAVABLE` in `add-prompts-dialog.tsx` |
| Prompt identity | sha256 of the NFC trimmed text, with `language_code` and `country_iso`. Case and inner spacing count ("Best CRM?" and "best crm?" are two prompts). Archived prompts count | `prompt_service.py` `key_of`, docs/19 3.7.1 As built |
| Country rule | `country_iso` is required and must be a country in which every enabled engine has a location, else `location_not_supported`. With no engine enabled nothing is checked. A prompt brought back from the archive is not checked again | `prompt_service.py` `_country_error` |
| Active prompt quota | `core.workspace_quotas.max_active_prompts`, default 150, counted across the whole workspace (all projects, archived projects included). `422 quota_exceeded` with `limit`, `used`, `requested` | `prompt_service.py` `quota_error`; `BASE_PLAN.max_prompts = 150` |
| One add | `bulk-create`: 1 to 1,000 items, always `200`; items rejected one by one (`location_not_supported`, `term_unknown`, `single_valued_vocabulary`, `duplicate_in_request`, `duplicate` with `on_duplicate: error`), duplicates listed in `skipped` with `existing_id` under `on_duplicate: skip` (default); the rest written all or none. Only accepted items count against the quota. No Idempotency-Key | `prompt_routes.py` `bulk_create_prompts`, `prompt_service.py` `bulk_create` |
| Lint | `POST {P}/prompts/lint` (`data:read`): 1 to 1,000 texts, optional `engine_codes`; returns per text `text` (as saved), `is_branded`, `matched_aliases`, `warnings` of two rules only (`contains_brand_alias` warning with a UTF-16 span; `engine_limit` warning, or error when over 2,000), and `quota { limit, used }`. Nothing stored. `language_code` is not taken | `prompt_service.py` `lint`, `_lint` |
| Metadata at create | `intent` (informational, navigational, commercial, transactional, local, unknown; default unknown), `funnel_stage` (tofu, mofu, bofu, retention, unknown; default unknown), `prompt_type` (question, comparison, recommendation, how_to, definition, local, transactional, other; default question), `importance` 1 to 5 (default 3), `term_ids` up to 20. No `source` or `creation_method` in the body: every prompt is saved `manual` and `human` | `schemas/ai.py` `PromptCreate` |
| PATCH | `intent`, `funnel_stage`, `prompt_type`, `importance`, `is_branded`, `is_active`, `term_ids` (replaces). `text`, `language_code`, `country_iso` are `immutable_field`. No `If-Match`. `is_active: true` counts against the quota | `schemas/ai.py` `PromptPatch`, `prompt_service.py` `update` |
| Archive | `DELETE {P}/prompts/{id}` (204, again 204 on an archived one); `POST {P}/prompts/bulk-archive` `{ ids (1 to 1,000), archive }` answers `{ matched, updated }`; bringing back is all or none against the quota | `prompt_routes.py` |
| Run now | one prompt: `POST {P}/prompts/{id}/run-now { engine_codes }`; many: `POST {P}/ai/runs { prompt_ids (1 to 150), engine_codes? }`, one manual run of the day's 20 (`429 manual_run_limit`), each task one AI answer of the month (`422 quota_exceeded`), `meta { prompts, answers, estimated_cost_usd, skipped[], manual_runs_today }`; `409 check_pending`, `422 nothing_to_run`, `422 price_unavailable`, `503 provider_paused`, `budget_blocked` | `operations/run_routes.py` `ai_bulk_run`, `schemas/ai_bulk.py` |
| Cadence and cost | twice a week, 1 answer per engine, standard queue. Monthly cost per engine = prompts x 2 x 52 / 12 x the price book's standard task price (150 prompts on all three engines is about $4.68 a month) | `domain/ai_engines.py` `monthly_cost`; `GET {P}/engines` `estimated_monthly_cost_usd` |
| Roles | `prompts:write` owner, admin, editor; `runs:trigger` owner, admin, editor, analyst; `data:read` all but billing; `panels:core:modify` owner, admin; `taxonomy:write` owner, admin, editor; `imports:write` owner, admin, editor | `backend/src/idraft/api/permissions.py` |
| Audit | `prompt.created`, `prompt.updated`, `prompt.archived`, `prompt.bulk_changed` | `prompt_service.py` |
| Not built | versions, restore, timeline, panels, memberships, candidates, from-keywords preview, bulk-update, `filter[prompt_type_in]`, `filter[funnel_stage_in]`, `filter[is_branded]`, `sort`, `include`, the six extra lint rules, prompt imports | docs/19 3.7.1 As built |

## 2. What is wrong with the current Add prompts dialog

File: `apps/web/src/features/prompts/add-prompts-dialog.tsx` (556 lines), test `add-prompts.test.tsx` (22 cases).
Compared with `apps/web/src/features/rankings/add-keywords/add-keywords-dialog.tsx`, the keyword import wizard in
`apps/web/src/features/rankings/import/` and Nuwtonic's Add Prompt (notes `nuwtonic-add-prompt.md`).

What it does well and must keep: it reads the pasted list as the API reads it (`readPromptLines`: NFC, trim,
control and format characters dropped, white space folded, joiners kept), names repeats and refused lines by the
line number the person sees, blocks a line the API would refuse for the whole request before sending, offers
only countries every enabled engine asks in, maps every `bulk-create` rejection to its line, treats a skipped
duplicate as "already tracked" and not as an error, says the quota, debounces the lint, speaks changes through
the announcer once, and submits once.

What is wrong:

| # | Problem | Evidence | Reference that does it right | Fix (ID) |
|---|---|---|---|---|
| W01 | "Already tracked" is decided against `list.rows`, which is the loaded page of ACTIVE prompts only. An archived duplicate or one on an unloaded page passes the client check, is counted in the quota line, labels the button "Add 5 prompts", and is then skipped by the server | `prompts-screen.tsx` passes `existing={list.rows}`; list default `filter[is_active]=true` | Add keywords counts "as the API reads it"; Nuwtonic's "Added" state | Lint answers `tracked` per text (N01); dialog uses it (PD-ADD-09) |
| W02 | Every prompt is sent as `prompt_type: 'question'`, `intent: 'unknown'`, `funnel_stage: 'unknown'`, `importance: 3` (`API_DEFAULTS`), so Type, Intent and Stage columns and filters have no data (G10, AP-03, AP-05) | `API_DEFAULTS` line 56 | Add keywords sends priority and funnel stage chosen in the form | Server rule for type (N02); Details section with Type, Intent, Stage, Importance (PD-ADD-12 to 15) |
| W03 | No cost. The person adds prompts that are asked twice a week on up to three engines and sees no answers count and no money | none in the dialog | Add keywords: "N checks a day, $X a day, $Y a month" (`plan.cost`) | Plan block with answers a month and cost per engine (PD-QC-01 to 04) |
| W04 | The quota line is only a note; Add stays enabled over the quota and the API refuses the whole add | `over` is "Only a note" (line 280) | Add keywords disables Add while over the plan (`blocked`, `focusableWhenDisabled`, `aria-describedby`) | Block when the exact count is over (PD-QC-02), possible once W01 is fixed |
| W05 | Lint rules: only own brand and engine length. No word count, one question, leading wording, language mismatch, competitor name (doc 11 section 4, G83, B17) | `prompt_service.py` `_lint` | Design preview `prompts.js` `lint` (stricter than allowed, see 4.10 of the gap analysis) | Seven-rule lint (PD-LINT-01 to 09, N03) |
| W06 | Topic is a flat `Select` of term paths, one topic only, no inline create, and a topic of a single-valued vocabulary is not separated from others | `topicOptions` | Add keywords: `GroupPicker` creates groups typed as paths before the add and says which were left behind; `MultiSelect` with `keepOnePerSingleVocabulary` | Topic picker with tree, search, "Create topic" and up to 20 terms (PD-TOP-01 to 05) |
| W07 | Findings show the first 5 lines, then "And N more", as text under the field. With 200 pasted lines the person cannot see which lines are fine, which are left out and why | `SHOWN_FINDINGS = 5` | Keyword import Review step: counts per outcome, first 20 rows per outcome, a choice per outcome | A "Check" view of the list grouped by outcome (PD-ADD-08), while the field stays the source |
| W08 | One shared language, country and topic per add; no way to paste columns (country, topic) from a spreadsheet; tabs are folded into spaces silently | `cleanLine` folds `\s+` | Keyword import: paste and file both map columns | Paste with columns (PD-PASTE-01 to 06) and CSV import (PD-CSV) |
| W09 | Result view lists "Line 12: reason" only. No "Show it" for an already tracked prompt, no "Restore" for an archived one, no link to the prompts just added | `outcome` view | `add-keywords-result.tsx`: "Show it" and "Unarchive" per keyword | Result view with actions (PD-POST-03, 04) |
| W10 | After the add: a toast, nothing else. No Undo, no "Ask now", the table does not select or highlight the new rows, and the first answers are up to four days away (next Monday or Thursday) without the page saying when | `toast({ type: 'success' ...})` | Rankings toast "View" plus Undo pattern; Nuwtonic "Run now" next to new prompts | Toast with Undo and "Ask now", new rows marked, next run time (PD-POST-01, 02, 05, 06) |
| W11 | The button reads "Add 0 prompts" state as "Add prompts" while the list is all tracked; the person learns only on submit ("Every line is already tracked") | `submit` label from `fresh.length` | Add keywords disables with a reason | Disable with reason when nothing would be sent (PD-ADD-20) |
| W12 | No entry from a topic menu with the topic chosen in every place (G82 partly built), none from the inspector, none from Discover, no keyboard shortcut | `openAdd(target.key)` in the topic row only | Rankings: `N` opens Add keywords (shortcut in the help sheet) | Entry points (PD-ADD-01 to 05) |
| W13 | No "Generate from keywords", no import, no suggestions: the person has to write every prompt by hand | More menu G03 not built | Nuwtonic: 88 suggested prompts with stage and intent chips, one-click Add, "Added" state | PD-GEN, PD-CSV, PD-CAND |
| W14 | `is_branded` is computed and shown as a note only; there is no override at add, though `PATCH` takes one | `findings.branded` is a note | doc 11 section 1 "computed at save, overridable" | Branded override in Details (PD-ADD-16) |
| W15 | Country list is not explained when it is short: an engine with few locations silently removes countries, and with no engine on every country is offered and the prompt then cannot be asked anywhere | `countriesForEngines` returns all countries when no engine is on | doc 11 "must map to engine-supported locations" | Country hint names the engines and offers "Engine settings" (PD-ADD-11) |
| W16 | Panel and reason are missing (the preview has them); fine for slice 1, but the dialog has no slot for them | design preview `#prompt-panel`, `#prompt-reason` | preview | Panel field once B10 lands (PD-ADD-17, 18) |

What Nuwtonic does that we keep, and what we drop (synthesis U-06, AP-01 to AP-24):

- Keep: suggestions as a list with stage and intent chips, one-click Add per row, a bulk add with a bar, the
  "Already tracked" state on a suggestion, quota shown at the point of adding, a card layout at phone width.
- Drop: buyer-intent colours (AP-07), the toolbar frequency, location and language that change nothing (AP-13),
  "slots" weighted by frequency (AP-16), unexplained quota (AP-14), "Add all" without a preview, per-prompt
  frequency (cadence is twice a week for all, owner 2026-11-12), the inline-edit row that edits prompt text in
  place (our text is a version).

## 3. Entry points and keyboard (all flows)

| ID | Entry | Where | Opens | STATUS | API | Size | Deps |
|---|---|---|---|---|---|---|---|
| PD-ADD-01 | "Add prompts" primary button | Topics & Prompts page header (icon only under 640 px, label stays the accessible name) | Add prompts dialog, defaults: project language and country, no topic | BUILT `prompts-screen.tsx` `addButton`, `headerAdd` | none | none | none |
| PD-ADD-02 | Split button chevron next to "Add prompts": "Paste a list", "Import CSV", "Generate from keywords", "Review suggestions (N)" | Page header | the dialog on the chosen tab, the import dialog, the generate dialog, Discover > Prompts | NOT BUILT | none for the menu | S | PD-CSV, PD-GEN, PD-CAND |
| PD-ADD-03 | Topic row menu "Add prompt" | Topics table row menu | Add dialog with the topic chosen | BUILT `prompts-screen.tsx` `rowMenu.addPrompt` | none | none | none |
| PD-ADD-04 | Topic drawer button "Add prompts" | Topic inspector header (secondary) | Add dialog with the topic chosen | NOT BUILT (G82) | none | S | none |
| PD-ADD-05 | Keyboard `N` | Topics & Prompts with no field focused, `prompts:write` | Add dialog; `Shift+N` opens Import CSV | NOT BUILT | none | S | listed in the shortcut sheet |
| PD-ADD-06 | Empty state action "Add prompts" and "Generate from keywords" | Prompts tab and Topics tab when the project has no prompt | Add dialog / generate dialog | PARTIAL: empty state exists, actions not both | none | S | PD-STATE-01 |
| PD-ADD-07 | Command palette "Add prompts", "Import prompts", "Generate prompts from keywords" | Cmd+K | same | NOT BUILT | none | S | palette registry |

## 4. Add prompts dialog (redesign)

Purpose: add one prompt or a pasted list to the project, with what the prompts share, seeing before saving what
each line becomes, what the add takes of the quota and what it costs.

### 4.1 Layout at desktop (560 px Medium dialog, 16 section 4.1)

The dialog stays 560 px. It has two tabs at the top of the body, "Type or paste" (default) and "Suggestions"
(from the candidates inbox and keyword templates, PD-CAND-20). No analytics: counts and money only (16 section 4.2
rule 2).

```
+--------------------------------------------------------------+
| Add prompts                                             [x]  |
| Asked on ChatGPT, Gemini and AI Mode twice a week (Mon, Thu) |
| [Type or paste]  [Suggestions 24]                            |
|--------------------------------------------------------------|
| Prompts                                                      |
| [ textarea, 6 rows, grows to 14, then scrolls             ]  |
| 12 lines: 9 new, 2 already tracked, 1 repeat     [Check v]   |
|   (Check expands the line check list, PD-ADD-08)             |
|                                                              |
| Country [ United States       v]  Language [ English     v]  |
| Only countries every enabled engine asks in. Engine settings |
| Topics  [ chips: CRM / Startups  x ] [ + type to search ]    |
|                                                              |
| > Details (type, intent, stage, importance, branded)         |
|   collapsed; "Type: set from wording" summary when closed    |
| > Panel (Discovery)     (only once panels exist)             |
|                                                              |
| Plan                                                         |
| 9 prompts x 3 engines x 2 runs a week = 78 answers a month   |
| About $0.09 a month: ChatGPT $0.03, Gemini $0.03, AI Mode    |
| $0.03 (standard queue)                                       |
| Workspace prompts: 131 of 150 used, 140 after this add       |
|--------------------------------------------------------------|
|                              [Cancel]  [Add 9 prompts]       |
+--------------------------------------------------------------+
```

Field order follows 10-forms.md: the list first, the shared market second (country before language, as the
country decides what is offered), taxonomy third, optional details collapsed, the plan last above the footer.
Country and Language sit side by side at 560 px (two columns, 16 px gap) and stack under 480 px of dialog
width.

### 4.2 Layout at phone width (under 768 px)

Full-screen sheet (19-responsive-behavior.md section 9): sticky 48 px header with the title and Close, the tabs
under it as a 2-item segmented control, body scrolls, sticky footer with Cancel and the primary button at full
width side by side (primary right). The textarea starts at 5 rows. Country, Language and Topics stack one per
row. The plan block moves into the sticky footer as one line ("9 prompts, about $0.09 a month, 140 of 150"),
with "Details" as a disclosure that opens the full plan text above the buttons. The line check list opens as a
bottom sheet (max 85dvh). Tab order and labels are the same as desktop.

### 4.3 Fields

| ID | Field | Label | Control | Default | Validation (client, as the API reads it) | Error text | STATUS | API | Size | Deps |
|---|---|---|---|---|---|---|---|---|---|---|
| PD-ADD-08 | Prompts | "Prompts" | `Textarea`, monospace off, spellcheck off, `submitOnModEnter`, counter | empty | at least 1 line after cleaning; at most 1,000 lines that would be sent; each line at most 2,000 characters and no refused character; the counter reads "N lines: A new, B already tracked, C repeats" | "Enter at least one prompt." / "Add at most 1,000 prompts at once. This list has 1,204." / per line in the check list: "Line 7 is longer than 2,000 characters and cannot be added." / "Line 9 has a character that cannot be saved." | PARTIAL: field, cleaning, counter, refusals BUILT `add-prompts-dialog.tsx`; the counter split and the check list NOT BUILT | lint (existing) plus N01 | M | N01 |
| PD-ADD-09 | Line check list | "Check" disclosure under the field, opens a list grouped by outcome | `Disclosure` with a `ul` per group, not a data table: "Will be added (9)", "Already tracked (2)", "Repeats in the list (1)", "Cannot be added (0)", "Warnings (3)". Each item: line number, the text clamped to one line, the reason, and for "Already tracked" a "Show it" link (opens the inspector in a new tab of the page state, after the dialog closes) and, for an archived one, "Restore" | collapsed when there is no problem; opens by itself when a line cannot be added | groups computed from `readPromptLines`, the lint `tracked` extra and the lint warnings | none of its own | NOT BUILT | lint plus N01 | M | N01, PD-LINT |
| PD-ADD-10 | Language | "Language" | `Select`, searchable, language names in the UI locale | project default language, else `en` | required; one of `LANGUAGE_CODES` | "Choose a language." | BUILT `add-prompts-dialog.tsx` | none | none | none |
| PD-ADD-11 | Country | "Country" | `Select`, searchable, only countries every enabled engine has a location in | project default country when offered, else empty | required; must be offered | "Choose a country." Hint: "Only countries every enabled engine asks in. ChatGPT asks in 4 countries, Gemini in 4, AI Mode in 2." plus a link "Engine settings" (opens Settings > AI engines in a new tab). With no engine on: "No engine is on, so these prompts will not be asked until one is. Turn one on in Engine settings." (warning tone, does not block) | PARTIAL: list and hint BUILT; engine counts, link and the no-engine warning NOT BUILT | `GET {P}/engines` (existing) | S | none |
| PD-ADD-12 | Prompt type | "Type" | `Select`: "Set from wording" (default, sends nothing), Question, Comparison, Recommendation, How to, Definition, Local, Transactional, Other | "Set from wording" | one of the values | none | NOT BUILT | NEW N02: `prompt_type` optional on `PromptCreate`; when left out the server rule sets it; lint returns `suggested_prompt_type` per text so the check list says "Type: comparison (from wording)" | S web, S backend | N02 |
| PD-ADD-13 | Intent | "Intent" | `Select`: Not set, Informational, Commercial, Transactional, Navigational, Local | Not set (`unknown`) | enum | none | NOT BUILT | existing `PromptCreate.intent` | S | none |
| PD-ADD-14 | Funnel stage | "Stage" | `SegmentedControl` or `Select`: Not set, Top (tofu), Middle (mofu), Bottom (bofu), Retention | Not set | enum | none | NOT BUILT | existing `PromptCreate.funnel_stage` | S | none |
| PD-ADD-15 | Importance | "Importance" | `Select` 1 to 5 with words: "1, highest (priority subset)", "2", "3, default", "4", "5, lowest" | 3 | 1 to 5 | none | NOT BUILT | existing `PromptCreate.importance` | S | none |
| PD-ADD-16 | Branded | "Branded" | `RadioGroup`: "Set from brand names (recommended)", "Always branded", "Never branded" | Set from brand names | none | none; when "Never branded" is chosen and a line names the own brand, the line gets a warning "Line 4 names Acme but is marked not branded. Its answers will count in the rates." | NOT BUILT | NEW N04: `is_branded` optional on `PromptCreate` as an override (doc 19 `PromptCreate.is_branded`) | S web, S backend | N04 |
| PD-ADD-17 | Panel | "Panel" | `Select` of the project's panels; core shows "(locked)" | Discovery when it exists, else Core | panel must exist | "Choose a panel." | NOT BUILT (G81) | NEW B10 `panel_ids`, `panel_reason` on `PromptCreate` | S | B10 |
| PD-ADD-18 | Reason (locked panel) | "Reason" | `Input`, shown only for a locked panel | empty | required, 1 to 500 characters, when the panel is locked | "Say why these prompts join the core panel. It is kept with the change." | NOT BUILT | B10 `panel_reason` | S | B10, PD-ROLE-04 |
| PD-ADD-19 | Topics | "Topics" | Topic picker (PD-TOP-01) | the topic the dialog was opened from, else none | at most 20 terms; at most one per single-valued vocabulary | "A prompt takes at most 20 topics and tags." / "Pick one term of {vocabulary}: it takes one." | PARTIAL: one topic `Select` BUILT | existing `term_ids` | M | PD-TOP |
| PD-ADD-20 | Primary button | "Add N prompts" / "Add prompt" | `Button` primary, `loading`, `focusableWhenDisabled`, `aria-describedby` the plan block | disabled until a line would be sent | disabled with a reason in its tooltip and the plan block: no line to send ("Every line is already tracked."), a line cannot be added ("Fix or remove the lines that cannot be added."), over the quota ("This add needs 12 places and the workspace has 9."), locked panel without a reason | as in the left column | PARTIAL: button BUILT, never disabled | none | S | N01 |
| PD-ADD-21 | Secondary | "Cancel" | `Button` secondary in `DialogClose` | none | none | none | BUILT | none | none | none |
| PD-ADD-22 | Discard guard | AlertDialog "Discard unsaved changes?" / "The prompts you typed will be lost." / "Keep editing", "Discard changes" | stacked AlertDialog | none | on Esc, Close, Cancel, browser back while dirty | none | BUILT (`dirty`, `discard` props) | none | none | none |
| PD-ADD-23 | "Ask these now" | checkbox under the plan: "Ask them now as well (one manual run of today's 20, about $0.03)" | `Checkbox`, shown with `runs:trigger` and at least one engine on | off | disabled with reason when the day's 20 manual runs are used ("Today's 20 manual runs are used. They reset at 00:00 UTC.") or more than 150 prompts would be added | none | NOT BUILT | `POST {P}/ai/runs` after the add; `GET {P}/runs` `meta.manual_runs_today` for the count | M | PD-POST-02, PD-QC-05 |

Not offered in the dialog, and why: per-prompt frequency (twice a week for every prompt, owner decision);
context preamble and persona (not built, docs/19 As built); keyword links (`keyword_ids`, wait for
`core.keyword_prompt_links`, N08).

### 4.4 Live preview and counters (the plan block)

The plan block is the decision line of the dialog. It is computed from one lint call (debounced 300 ms, as now)
so the numbers are the API's, not the browser's guess.

| ID | Line | Wording | Rule | STATUS | API | Size | Deps |
|---|---|---|---|---|---|---|---|
| PD-QC-01 | Answers | "9 prompts x 3 engines x 2 runs a week = 78 answers a month" | prompts = lines that would be created (not tracked, not repeats, not refused); per engine count only prompts within that engine's length; answers a month = sum over enabled engines of fitting prompts x 2 x 52 / 12, rounded down | NOT BUILT | NEW N05 lint `estimate` | S | N05 |
| PD-QC-02 | Quota | "Workspace prompts: 131 of 150 used, 140 after this add." Over: "This add needs 12 places and the workspace has 9. Remove 3 lines, or archive prompts you no longer need." (negative tone, blocks) | `used` and `limit` from lint `quota`; "after" = used + would-create count from N01 | PARTIAL: note only, not blocking, count includes archived duplicates (W01, W04) | lint `quota` (existing) plus N01 | S | N01 |
| PD-QC-03 | Cost | "About $0.09 a month: ChatGPT $0.03, Gemini $0.03, AI Mode $0.03 (standard queue)." Engine with no price: "AI Mode: no price in the price book." Under $0.01: "under $0.01" | per engine monthly cost = fitting prompts x 2 x 52 / 12 x the engine's standard task price, to the cent, same formula as `monthly_cost` | NOT BUILT | NEW N05 (`estimate.engines[].monthly_cost_usd`) | S | N05 |
| PD-QC-04 | Engines skipped | "AI Mode skips 2 of these (over 700 characters)." | from lint `engine_limit` warnings | PARTIAL: per line BUILT (`findings.engineLimit`), sum NOT BUILT | lint (existing) | S | none |
| PD-QC-05 | Ask now cost | "Asking them now adds 27 answers, about $0.03, and uses 1 of today's 20 manual runs (4 used)." | answers = fitting prompt x engine pairs; cost per engine as above for one run | NOT BUILT | N05 `estimate.engines[].run_now_cost_usd`; `GET {P}/runs` meta | S | N05 |
| PD-QC-06 | Next run | "First scheduled answers: Thursday 14 Nov from 01:00 (project time)." | next `ai_prompt` schedule occurrence | NOT BUILT | `GET {P}/schedules` (existing) | S | none |
| PD-QC-07 | Header meter | Page header meta "131 of 150 prompts" with a small `Meter` | workspace quota | NOT BUILT (AP-17) | lint `quota` with `texts` empty is refused (min 1); NEW N06 `GET {W}/quotas` or `meta.quota` on `GET {P}/prompts` | S | N06 |

Rounding and words: money through `formatCurrency` (two decimals; "under $0.01"); counts through `formatInteger`;
"about" before every estimate; never a bare number without its unit.

### 4.5 Duplicate detection and "Already tracked"

| ID | Case | What the person sees | Rule | STATUS | API | Size | Deps |
|---|---|---|---|---|---|---|---|
| PD-ADD-24 | Repeat inside the list | check list group "Repeats in the list": "Line 9 repeats line 3 and is left out." | same cleaned text; the client already folds these and the API would reject `duplicate_in_request` | BUILT (`findings.repeat`) | none | none | none |
| PD-ADD-25 | Active prompt with the same text, language, country | "Line 4 is already tracked. Show it" | lint `tracked.is_active = true` | PARTIAL (only loaded active rows) | N01 | S | N01 |
| PD-ADD-26 | Archived prompt with the same identity | "Line 5 is archived. Restore it" (Restore counts against the quota and keeps its history and answers) | lint `tracked.is_active = false`; Restore calls `PATCH is_active: true` after the dialog closes, or is collected into the add: a "Restore archived (1)" checkbox in the group, default on, which sends a `bulk-archive archive: false` with the add | NOT BUILT | N01; existing `bulk-archive` | M | N01, PD-ARC-05 |
| PD-ADD-27 | Same text, different case or spacing | not a duplicate for the API; the check list adds a note "Line 6 differs from a tracked prompt only in case or spacing: 'best crm for startups'. Both will be asked." (note tone, does not block) | NEW N01 returns `near_duplicate_of` when the casefolded, space-folded text matches | NOT BUILT | N01 | S | N01 |
| PD-ADD-28 | Same text in another country or language | not a duplicate; no note | identity includes country and language | BUILT (by the rule) | none | none | none |
| PD-ADD-29 | Race: someone adds the same prompt while the dialog is open | the server `skipped` list wins; result view says "already tracked" | `on_duplicate: skip` | BUILT | existing | none | none |

### 4.6 Country and language handling

- Offered countries: those in which every enabled engine has a location (`countriesForEngines`). The hint names
  the count per engine. When an engine is on with no location in the chosen project country, the default is
  empty and the hint says "The project's country, Germany, is not offered: AI Mode has no location there."
- Language does not filter countries. A language mismatch with the text is a lint warning (PD-LINT-06), never a
  block.
- One language and one country per add from this tab. Several countries at once: through the paste columns or
  the CSV (each row its own country), not a multi-select, because each country is a separate prompt against the
  quota and a multi-select hides that multiplication. The plan block would have to say "x 3 countries".

## 5. Paste with columns (inside "Type or paste")

Purpose: paste rows from a spreadsheet with a prompt and its own country, language, topic or type, without a
file.

| ID | Element | Behaviour | STATUS | API | Size | Deps |
|---|---|---|---|---|---|---|
| PD-PASTE-01 | Detection | A paste whose lines hold at least one tab in more than half of the non-blank lines is read as columns; a notice appears above the field: "Pasted as columns: Prompt, Country, Topic. Change" | NOT BUILT (today tabs become spaces) | web only | M | none |
| PD-PASTE-02 | Header row | First row is a header when every cell matches a known column name (case and spaces ignored): prompt, text, question; country, country_iso, market; language, language_code; topic, topics; tags; type, prompt_type; intent; stage, funnel_stage; importance, priority. Otherwise columns are positional: 1 prompt, 2 country, 3 language, 4 topic | NOT BUILT | web only | S | PD-PASTE-01 |
| PD-PASTE-03 | Column mapping popover | "Change" opens a popover with one `Select` per column (Prompt, Country, Language, Topic, Tags, Type, Intent, Stage, Importance, Ignore), sample of the first 3 cells | NOT BUILT | web only | M | PD-PASTE-02 |
| PD-PASTE-04 | Cell reading | Country: ISO-2 or English country name, matched to the offered countries; Language: ISO-2 or English name; Topic: a path "CRM/Startups" (created on add when missing and allowed, PD-TOP-03); Tags: semicolon list; Type, Intent, Stage: the enum value or its English label; Importance 1 to 5. A cell that cannot be read is a per-line error: "Line 4: country 'Narnia' is not one the engines ask in." Blank cells take the dialog's shared value | NOT BUILT | web only; bulk-create items carry their own values | M | PD-PASTE-02 |
| PD-PASTE-05 | Shared fields in column mode | Country, Language, Topics in the form become "Default for rows without one" (label change) | NOT BUILT | none | S | PD-PASTE-01 |
| PD-PASTE-06 | Limits | 1,000 rows sent at most; identity per row is text, language, country, so the counter and the duplicate checks are per row | NOT BUILT | lint plus N01 take texts only: N01 must take `items: [{ text, language_code, country_iso }]` | S | N01 |

## 6. CSV import (720 px multi-step dialog)

Purpose: add prompts from a file (a list kept in a sheet, an export of another tool, FAQ questions), each row
with its own metadata, with a preview of every row before anything is written.

Decision: the file is parsed in the browser (the app already has `lib/csv/csv-head` and the keyword import's
dropzone), rows are checked with the lint, and written through `bulk-create`. No new import job: the quota caps
a workspace at 150 active prompts, so a file over 1,000 rows has no useful case, and a server import job (as for
keywords, `keyword-imports`) would be weeks of backend work for no user gain. The FAQ upload of doc 19 3.7.3
(`prompt-candidates/uploads`) feeds the candidates inbox later and is a different flow. The import marks its
prompts with `source: csv_import` and `creation_method: imported` (N07).

Steps: Upload, Map columns, Review, Confirm (16 section 4.6). A paste does not open this dialog (it is PD-PASTE).

### 6.1 Layout

Desktop: 720 px Large dialog, stepper at the top of the body, footer with Back at the left and Cancel plus the
step's primary at the right. Phone: full-screen sheet; the stepper becomes "Step 2 of 4: Map columns"; the
mapping table becomes one card per column (header, sample, the mapping select); the review lists stay lists.

### 6.2 Elements

| ID | Step | Element | Behaviour, validation and copy | STATUS | API | Size | Deps |
|---|---|---|---|---|---|---|---|
| PD-CSV-01 | Entry | "Import CSV" in the Add split menu, `Shift+N`, the More menu "Import prompts" | opens step Upload | NOT BUILT (G03) | none | S | PD-ADD-02 |
| PD-CSV-02 | Upload | Template download | link "Download the template (CSV)": a UTF-8 file with BOM, header `prompt,country,language,topic,tags,type,intent,stage,importance` and two example rows using the project's country and language | NOT BUILT | web only (generated in the browser) | S | none |
| PD-CSV-03 | Upload | Dropzone | reuse `features/rankings/import/file-dropzone.tsx`: drop or "Choose file"; accepts `.csv` and `.tsv`, `text/csv`, `text/tab-separated-values` | NOT BUILT | web only | S | none |
| PD-CSV-04 | Upload | File checks before reading | at most 5 MB ("The file is 7.2 MB. The most is 5 MB."), UTF-8 with or without BOM; UTF-16 with BOM is read; any other encoding: "The file is not UTF-8. Save it as 'CSV UTF-8' and try again."; delimiter detected from the header line (comma, semicolon, tab); quoted fields with line breaks inside a quote are refused for the prompt column ("Row 12: a prompt has a line break. One line per prompt.") | NOT BUILT | web only (`lib/csv/csv-head`) | M | none |
| PD-CSV-05 | Upload | Row limits | at most 1,000 data rows ("The file has 1,240 rows. Import at most 1,000 at once: split the file."), at most 50 columns, a header row required ("The first row must name the columns."), at least one data row ("The file has no rows under the header.") | NOT BUILT | web only | S | none |
| PD-CSV-06 | Upload | Defaults for rows without a value | Country, Language, Topics as in the Add dialog, with the label "For rows without one" | NOT BUILT | none | S | PD-ADD-10, 11, 19 |
| PD-CSV-07 | Map | Mapping table | columns "Column in file", "Maps to" (`Select`: Prompt, Country, Language, Topic, Tags, Type, Intent, Stage, Importance, Ignore), "Sample" (first 3 values). Automatic mapping by header names as PD-PASTE-02. Summary line: "1 required column mapped of 1. 3 optional columns mapped." | NOT BUILT | web only | M | none |
| PD-CSV-08 | Map | Mapping errors | no Prompt column: "Map one column to Prompt." A field mapped twice: on both rows "Mapped twice. Map Topic to one column." Continue moves focus to the first error | NOT BUILT | web only | S | PD-CSV-07 |
| PD-CSV-09 | Review | Counts per outcome | one line each with the count: New, Already tracked, Archived, Repeated in file, Cannot be added, Over the quota. Example: "86 new, 4 already tracked, 2 archived, 3 repeated in the file, 5 cannot be added." | NOT BUILT | lint with N01 on items (chunks of 1,000 texts) | M | N01 |
| PD-CSV-10 | Review | Per-outcome sections | first 20 rows each, a simple list (row number, prompt clamped to one line, reason); "and 66 more" with "Download all rows (CSV)" | NOT BUILT | web only | M | PD-CSV-09 |
| PD-CSV-11 | Review | Choices | Archived: `RadioGroup` "Restore them (counts against the quota)" or "Leave them archived" (default leave); Already tracked: "Update their topics and metadata from the file" or "Leave them as they are" (default leave; update uses `PATCH` per prompt, metadata only, never text) | NOT BUILT | existing `PATCH`, `bulk-archive`; N09 bulk-update would make it one call | M | N09 optional |
| PD-CSV-12 | Review | Per-row reasons (codes) | `prompt_missing` "No prompt in this row.", `prompt_too_long` "Longer than 2,000 characters.", `prompt_unsupported_character` "Has a character that cannot be saved.", `country_unknown` "Country 'X' is not one every enabled engine asks in.", `language_invalid` "Language 'X' is not one we know.", `topic_invalid` "Topic path 'X' has an empty part.", `topic_not_allowed` "Topic 'X' does not exist and you cannot create topics.", `type_invalid`, `intent_invalid`, `stage_invalid`, `importance_invalid` "Importance is 1 to 5.", `too_many_terms` "More than 20 topics and tags.", `repeated_in_file` "Same prompt as row 4.", `tracked`, `archived` | NOT BUILT | web only plus N01 | S | none |
| PD-CSV-13 | Review | Quota | "Importing 86 prompts takes 86 of the workspace's 19 remaining places. Import fails unless you remove 67 rows or archive prompts." blocks Continue; plan block with answers and cost as PD-QC-01 to 03 | NOT BUILT | lint `quota`, N05 | S | N05 |
| PD-CSV-14 | Confirm | Summary and button | "86 prompts will be added to the project, 2 archived prompts restored. About $0.84 a month." Button "Import 86 prompts" | NOT BUILT | none | S | none |
| PD-CSV-15 | Confirm | Write and progress | rows grouped by their shared fields are sent in `bulk-create` requests of at most 1,000 items, in order; the dialog shows a progress line "Adding 86 prompts..." and stays open (writes take seconds, not a background job); topic paths are created first (PD-TOP-03) | NOT BUILT | existing `bulk-create`; N07 for `source` | M | N07 |
| PD-CSV-16 | Confirm | Partial success | a `quota_exceeded` on a later request leaves the earlier ones written: the result view says "60 added. 26 were not: the workspace ran out of room after row 61." with "Download the rows that were not added (CSV)" | NOT BUILT | existing | S | PD-CSV-15 |
| PD-CSV-17 | Result | Errors file | CSV of every row not added with columns `row, prompt, reason_code, reason`, named `prompts-import-errors-YYYY-MM-DD.csv` in project time | NOT BUILT | web only | S | none |
| PD-CSV-18 | Result | Close | toast "86 prompts imported" with "Show them" (filters the Prompts tab to "Added today by me") and Undo (archives them, PD-POST-01) | NOT BUILT | existing `bulk-archive` | S | PD-POST-01 |

## 7. Generate from keywords

Purpose: turn tracked keywords into natural prompts with the four standard templates (doc 11 section 5.3 step 1:
templates first, free and deterministic), edit them, and add them, linked back to their keyword.

### 7.1 Layout

720 px Large dialog, two steps: "Choose keywords", "Review prompts". Phone: full-screen sheet, steps as "Step 1 of
2".

```
Choose keywords
  Source  (o) Keywords  ( ) Keyword groups
  [ search keywords                    ] 24 chosen of 200
  [x] best crm for startups      US  Commercial  vol 2,400
  [ ] crm pricing                US  Commercial  vol 1,900
  ...
  Templates  [x] Recommendation [x] Comparison [x] How to [ ] Procurement
  [ ] Use competitor names in comparisons (HubSpot, Pipedrive)
  Language English   Country United States (from each keyword when left as "From keyword")
                                                [Cancel] [Generate prompts]
Review prompts
  72 prompts from 24 keywords. 6 are already tracked, 3 are near duplicates.
  best crm for startups
    [x] What is the best CRM for startups?                Recommendation  [edit]
    [x] Which CRM should a 20-person startup use?         Recommendation  [edit]
    [ ] HubSpot vs Pipedrive for startups?   Comparison   Already tracked
  ...
  Plan: 63 prompts x 3 engines ... Workspace prompts 87 of 150, 150 after.
  Generated phrasing, not observed user prompts. No volume is shown for them.
                                       [Back] [Cancel] [Add 63 prompts]
```

### 7.2 Elements

| ID | Element | Behaviour, validation and copy | STATUS | API | Size | Deps |
|---|---|---|---|---|---|---|
| PD-GEN-01 | Entry | Add split menu, More menu "Generate from keywords", empty state action, Rankings bulk bar "Make prompts" on selected keywords (opens step 2 directly) | NOT BUILT (G03) | none | S | PD-ADD-02 |
| PD-GEN-02 | Source | `RadioGroup` Keywords or Keyword groups; groups expand to their tracked keywords (one country each); the count line "24 chosen of 200 at most" | NOT BUILT | existing `GET {P}/tracked-keywords`, keyword groups | M | none |
| PD-GEN-03 | Keyword picker | searchable checklist with country, intent, volume; a keyword tracked in two countries is two rows; at most 200 ("Choose at most 200 keywords. 24 chosen.") | NOT BUILT | existing | M | none |
| PD-GEN-04 | Templates | four `Checkbox`es, default the three without procurement; at least one ("Choose at least one template.") | NOT BUILT | B18 `templates` | S | B18 |
| PD-GEN-05 | Competitor names | `Checkbox` "Use competitor names in comparisons", off by default; shows the first three competitor names; with it on, a note "Prompts that name a competitor count as comparisons, not branded." | NOT BUILT | B18 `allow_competitor_names` | S | B18 |
| PD-GEN-06 | Market | Language and Country: "From each keyword" (default) or one chosen; a keyword whose country no engine asks in is listed under "Cannot be used: Germany is not a country every enabled engine asks in." | NOT BUILT | existing engines | S | none |
| PD-GEN-07 | Generate (preview call) | "Generate prompts" calls the preview; loading: skeleton rows in step 2 with "Writing prompts from 24 keywords"; nothing is stored | NOT BUILT | B18 `POST {P}/prompts/from-keywords/preview` | S | B18 |
| PD-GEN-08 | Review list | grouped by keyword; each suggestion a checkbox, the text, the template as a neutral `Badge`, the prompt type; default checked unless already tracked or a near duplicate | NOT BUILT | B18 response | M | B18 |
| PD-GEN-09 | Edit before add | "Edit" turns the line into an `Input` (Enter keeps, Esc reverts); edited text is re-linted; an edited suggestion keeps its keyword link and becomes `creation_method: human` with `generated_from` kept | NOT BUILT | lint; N07 | S | N07 |
| PD-GEN-10 | Dedupe | against tracked prompts (exact identity, "Already tracked", unchecked, not checkable unless archived: "Archived. Restore instead"); against each other and tracked prompts by trigram similarity at least 0.8 ("Near duplicate of 'What is the best CRM for startups?'", unchecked by default, checkable) | NOT BUILT | B18 `near_duplicate_of`; N01 | S | B18, N01 |
| PD-GEN-11 | Lint per suggestion | same rules as PD-LINT; a template output that names the own brand is not produced (server rule) | NOT BUILT | lint | S | PD-LINT |
| PD-GEN-12 | Shared fields | Topics (default: each keyword's topic terms, shown as "From keyword"), Panel, Importance | NOT BUILT | `term_ids` | S | PD-TOP |
| PD-GEN-13 | Honesty banner | info `Banner` at the top of step 2: "Generated phrasing, not observed user prompts. No volume is shown for them." (doc 11 section 5.3 honesty rule) | NOT BUILT | none | S | none |
| PD-GEN-14 | Plan and button | PD-QC-01 to 03; "Add 63 prompts"; disabled with reason over the quota | NOT BUILT | N05 | S | N05 |
| PD-GEN-15 | Write | `bulk-create` with `generated_from { tracked_keyword_id, template }` per item, `creation_method: template`, `source: seo_keyword`, `link_type: generated` link | NOT BUILT | N07, N08 | M backend | N07, N08 |
| PD-GEN-16 | Result | as PD-POST; the toast offers "Show them" | NOT BUILT | none | S | PD-POST |

LLM variants (doc 11 section 5.3 step 2, `prompt-candidates/generate`) are not in this dialog: they cost money
and are Phase 11. When they come they arrive in the candidates inbox, not here.

## 8. Suggestions and the candidates inbox (Discover > Prompts)

Purpose: review machine-proposed prompts (templates, GSC questions, People Also Ask, fan-out questions) and
accept, edit, reject or snooze them, one at a time or in bulk, with the "Already tracked" state.

### 8.1 Layout

Desktop: Discover > Prompts page (T6 list template): `CountTabs` "New 24", "Snoozed 3", "Rejected 12", "Added
40"; filter bar chips Source, Stage, Intent, Type, Country, Language, "Has near duplicate"; `DataTable` columns:
checkbox, Prompt (two lines), Source (`Badge`), Stage, Intent, Type, Country, Evidence ("GSC 1,204 impressions in
28 days" or "From keyword best crm for startups"), Status or the "Already tracked" badge, row actions "Add",
"Edit and add", More (Reject, Snooze 30 days, Open source). Row opens the candidate inspector (400 px): full text,
source details, suggested topics, linked keywords, near duplicate with a word diff, actions.

Phone: rows become two-line list rows (prompt, then "Source, Stage, Country"); "Add" is a 44 px button at the
right of the row; the bulk bar docks above the bottom edge.

Inside the Add dialog: the "Suggestions" tab (PD-CAND-20) shows the same New candidates as a compact checklist,
for the person who opened "Add prompts" and does not know the inbox exists.

### 8.2 Elements

| ID | Element | Behaviour and copy | STATUS | API | Size | Deps |
|---|---|---|---|---|---|---|
| PD-CAND-01 | Page and tabs | as 8.1; count on each tab from the list `meta.counts` | NOT BUILT | NEW per doc 19 3.7.3 `GET {P}/prompt-candidates` plus `meta.counts { new, snoozed, rejected, added }` | L | N10 |
| PD-CAND-02 | Filter chips | Source, Stage (tofu, mofu, bofu), Intent, Type, Country, Language, Has near duplicate; counts on chips come from the same filtered set as the rows (fixes Nuwtonic AP-02) | NOT BUILT | N10 filters | M | N10 |
| PD-CAND-03 | Sort | "Most impressions", "Newest", "Modeled AI demand" (label "Modeled AI demand", tooltip from doc 11 section 7) | NOT BUILT | N10 `sort` | S | N10 |
| PD-CAND-04 | Row "Add" | one click; adds with the candidate's text, language, country, suggested topics, intent, type from the server rule, into the default panel (Discovery); the row turns into "Added" with "Show it"; toast with Undo | NOT BUILT | N10 `POST {P}/prompt-candidates/decide { ids, action: 'add' }` | S | N10 |
| PD-CAND-05 | Row "Edit and add" | opens the Add dialog with the line, country, language and topics filled; on add, the candidate is marked added and linked | NOT BUILT | N10 `PATCH` then `decide add`, or `decide` with `edits` | M | N10, PD-ADD |
| PD-CAND-06 | Reject | menu item, no confirm; toast with Undo; optional reason in a popover ("Not relevant", "Brand question", "Duplicate", "Other") | NOT BUILT | N10 `decide reject` | S | N10 |
| PD-CAND-07 | Snooze | "Snooze 30 days" and "Snooze 7 days" | NOT BUILT | N10 `decide snooze, snooze_days` | S | N10 |
| PD-CAND-08 | Already tracked state | a candidate whose identity a prompt holds shows "Already tracked" (active) or "Archived, restore" instead of Add; not selectable for Add | NOT BUILT | N10 returns `tracked { prompt_id, is_active }` | S | N10 |
| PD-CAND-09 | Near duplicate | `Badge` "Near duplicate" with a popover: the tracked prompt, the word diff, "Add anyway", "Reject as duplicate" | NOT BUILT | N10 `near_duplicate_of` | M | N10 |
| PD-CAND-10 | Bulk bar | "N selected", "Select all N matching", Add (with the plan as a confirm when over 20: "Add 48 prompts? About $0.46 a month. 138 of 150 after."), Reject, Snooze, Set topic, Clear | NOT BUILT | N10 `decide` (max 500 ids) | M | N10, PD-QC |
| PD-CAND-11 | Bulk accept partial | `decide add` answers `prompts_created` and `rejected [{id, code}]`; the toast says "40 added. 8 were not: 6 already tracked, 2 over the quota." with "Show which" (filters to those ids) | NOT BUILT | N10 | S | N10 |
| PD-CAND-12 | Honesty | info banner on candidates with `creation_method` template or llm: "Generated phrasing, not observed user prompts." | NOT BUILT | none | S | none |
| PD-CAND-13 | Empty state | "No suggestions yet. They come from your tracked keywords and Search Console questions." actions "Generate from keywords", "Connect Search Console" | NOT BUILT | none | S | none |
| PD-CAND-14 | Candidate inspector | 400 px: text, source details (keyword, GSC query with impressions, PAA question with its SERP date), suggested topics (editable), linked keywords, actions Add, Edit and add, Reject, Snooze | NOT BUILT | N10 | M | N10 |
| PD-CAND-20 | "Suggestions" tab in the Add dialog | the first 50 New candidates sorted by evidence, as a checklist with source and stage badges; checked ones are added with the dialog's shared fields; "Open the inbox" link | NOT BUILT | N10 | M | N10 |

## 9. After the add

| ID | Element | Behaviour and copy | STATUS | API | Size | Deps |
|---|---|---|---|---|---|---|
| PD-POST-01 | Success toast | "9 prompts added" with description "First answers Thursday 14 Nov from 01:00." and actions "Ask now" (when allowed) and Undo; Undo archives exactly the created ids (`bulk-archive archive: true`) and then says "9 prompts archived. They stay in Archived." (archive is the only removal; the toast says so to avoid a later "already tracked" surprise) | PARTIAL: toast BUILT, no description, no actions | existing `bulk-archive` | S | none |
| PD-POST-02 | "Ask now" | from the toast or the dialog checkbox; one `ConfirmDialog` (400 px, neutral): title "Ask 9 prompts now?", description "One manual run of today's 20 (4 used). 27 answers, about $0.03. Answers arrive within minutes.", button "Ask 9 prompts"; over 150 prompts: "This is 2 manual runs: 150 and 30 prompts." | NOT BUILT for the add path; the confirm BUILT for the bulk bar (`use-prompt-actions.tsx` `runDescription`) | existing `POST {P}/ai/runs`; N05 for the cost before the call | S | N05 |
| PD-POST-03 | Result view (when something was skipped or refused) | replaces the form: "9 prompts added." then "2 already tracked" with each line's text and "Show it", "1 archived" with "Restore" (quota checked), then "1 line could not be added" with its line and reason; buttons "Done" (primary, focus) and "Copy the lines not added" | PARTIAL: counts and reasons BUILT; texts, Show it, Restore, Copy NOT BUILT | existing | M | N01 |
| PD-POST-04 | Show it | closes the dialog, clears filters that hide the prompt, selects and opens it in the inspector | NOT BUILT | none | S | none |
| PD-POST-05 | New rows in the table | the table sorts nothing new: it keeps the person's sort, scrolls to nothing, but the created rows get a 4 s `primary-subtle` highlight and an "Added just now" filter chip appears in the filter bar ("Added just now: 9", removable) | NOT BUILT | web only (ids from `created`) | S | none |
| PD-POST-06 | No answers yet | the new rows show "Not asked yet" in every engine cell until the first answer, with the tooltip "Asked next on Thursday 14 Nov." | PARTIAL: empty cells BUILT, wording NOT BUILT | `GET {P}/schedules` | S | none |
| PD-POST-07 | Focus | on close, focus returns to the trigger; after Show it, to the opened inspector's title | PARTIAL | none | S | none |

## 10. Prompt details: edit metadata, edit text

### 10.1 Edit details (metadata, no version)

Purpose: change what describes a prompt without changing what is asked. Opens from the inspector More menu
"Edit details", the row menu, `E` on a focused row, and the bulk bar "Edit details" (PD-BULK-07).

Desktop: 560 px dialog "Edit details". Phone: full-screen sheet. Header shows the prompt text (read only, clamped
to 3 lines) with "Text is fixed. To ask something else, edit the text as a new version." (link to 10.2, or, while
versions are not built, "archive it and add a new one").

| ID | Field | Control | Default | Validation | Error | STATUS | API | Size | Deps |
|---|---|---|---|---|---|---|---|---|---|
| PD-EDIT-01 | Type | `Select` of the 8 types, with "(set from wording)" after the current value when the server set it | current | enum | none | NOT BUILT | existing `PATCH prompt_type`; NEW N02 `prompt_type_source: 'rule' or 'person'` on `Prompt` | S | N02 |
| PD-EDIT-02 | Intent | `Select` | current | enum | none | NOT BUILT | existing `PATCH intent` | S | none |
| PD-EDIT-03 | Stage | `Select` | current | enum | none | NOT BUILT | existing `PATCH funnel_stage` | S | none |
| PD-EDIT-04 | Importance | `Select` 1 to 5 | current | 1 to 5 | none | NOT BUILT (G125, W5) | existing `PATCH importance` | S | none |
| PD-EDIT-05 | Branded | `Switch` "Branded" with "Set from brand names: yes (names Acme)" under it; turning it off on a prompt that names the brand shows the warning of PD-ADD-16 | current | none | none | NOT BUILT | existing `PATCH is_branded` | S | none |
| PD-EDIT-06 | Topics | Topic picker | current terms | at most 20; one per single-valued vocabulary | as PD-ADD-19 | NOT BUILT | existing `PATCH term_ids` (replaces) | S | PD-TOP |
| PD-EDIT-07 | Language, Country | read only, with "Fixed. Archive and add a new prompt for another market." | current | none | none | NOT BUILT | `immutable_field` | S | none |
| PD-EDIT-08 | Save | "Save details"; disabled until something changed; sends only changed fields | none | at least one field | `validation_failed` mapped to fields; `term_unknown` on Topics "A topic cannot be used in this project."; 404 "This prompt was deleted."; 403 "You cannot change prompts in this project." | NOT BUILT | existing `PATCH` | S | none |
| PD-EDIT-09 | Concurrency | none today (no `If-Match`); last write wins; the toast after save says "Details saved" | none | none | none | NOT BUILT | NEW N11 (optional): `ETag`/`If-Match` on `PATCH`, `412 precondition_failed` opens the 720 px conflict dialog of 16 section 4.4 | S backend | N11 |
| PD-EDIT-10 | Audit line | under the footer: "Changes are recorded. They do not create a version and do not break the trend." | none | none | none | NOT BUILT | none | S | none |

### 10.2 Edit text (creates a version)

Purpose: change what is asked while keeping the prompt's history. The trend shows a boundary at the change.

Desktop: 720 px dialog "Edit prompt text" (16 section 1.1). Phone: full-screen sheet.

| ID | Field | Control | Default | Validation | Error | STATUS | API | Size | Deps |
|---|---|---|---|---|---|---|---|---|---|
| PD-EDIT-20 | Current text | read only block, "Version 3, since 2 Oct" | none | none | none | NOT BUILT | B11 | S | B11 |
| PD-EDIT-21 | New text | `Textarea`, one line, with the live lint list under it (PD-LINT) and a word diff against the current text | current text | not empty, at most 2,000, printable, differs from every version ("This is the text of version 1. Restore it instead." with a Restore link) | "Enter the new text." / "Longer than 2,000 characters." / as left | NOT BUILT | B11 `POST {P}/prompts/{id}/versions` (`409 duplicate` maps to the restore message) | M | B11 |
| PD-EDIT-22 | Change kind | `RadioGroup`: "Wording (the meaning may change)", "Typo (same meaning)"; "Context" appears only when preambles exist | Typo when the diff is at most 2 characters per word changed, else Wording | required | "Choose what kind of change this is." | NOT BUILT | B11 `change_kind` | S | B11 |
| PD-EDIT-23 | Reason | `Input` "Why the change" | empty | required for a locked core member that is not a typo, 1 to 500 characters; optional otherwise | "Say why. The core panel is locked and keeps the reason with the change." | NOT BUILT | B11 `change_reason`, `422 reason_required` | S | B11, B10 |
| PD-EDIT-24 | Series break warning | warning `Banner`: "Charts will show a version boundary on 12 Nov. Rates before and after are compared separately." For a core member: "This prompt is in the locked core panel. Only an admin can change it." | none | none | none | NOT BUILT | B11 `meta.warnings: ['series_break']` | S | B11 |
| PD-EDIT-25 | Save | "Save as version 4"; editor gets `panels:core:modify` refusal on a locked core member unless Typo: button disabled with "Only an admin can change the wording of a core prompt. A typo fix is allowed." | none | none | `412 precondition_failed` opens the conflict dialog | NOT BUILT | B11 `If-Match` | S | B11 |

## 11. Versions list and restore

| ID | Element | Behaviour and copy | STATUS | API | Size | Deps |
|---|---|---|---|---|---|---|
| PD-VER-01 | Versions section in the inspector | new tab "Versions" in the prompt inspector (after Stats; moves into the More tabs menu below 440 px), newest first: "v3 Current" badge, date, author, change kind as a neutral `Badge`, reason, the text with a word diff to the previous version (toggle "Show changes") | NOT BUILT | B11 `GET {P}/prompts/{id}/versions` | M | B11 |
| PD-VER-02 | Restore button per older version | secondary `sm` "Restore"; hidden on the current version; hidden without `prompts:write`; disabled with a reason for an editor on a locked core member | NOT BUILT | B11 restore | S | B11 |
| PD-VER-03 | Restore dialog | 400 px `ConfirmDialog` neutral: title "Restore version 1?", description "Version 1 becomes the text that is asked from the next run. No new version is made, the change is recorded, and charts show a boundary today." field Reason (required for a locked core member, optional otherwise), button "Restore version 1" | NOT BUILT | B11 `POST {P}/prompts/{id}/versions/{vid}/restore { change_reason }` with `If-Match`; `409 invalid_state_transition` "This version is already current."; restore is not a `change_kind` (owner decision): the list then shows the restored row as "Current" with a line "Restored on 12 Nov by Ana: reason" taken from the audit entry | S | B11, N12 |
| PD-VER-04 | Restore history line | the timeline needs the restore events, which are audit entries, not versions | NOT BUILT | NEW N12: `GET {P}/prompts/{id}/versions` returns `current_since` and `restores: [{ version_id, restored_at, restored_by, reason }]`, or the `timeline` route carries them | S backend | B11 |
| PD-VER-05 | Project-wide versions feed | Topics & Prompts "Versions" tab: date, prompt, change ("v2 to v3, wording"), author, reason; row opens the prompt | NOT BUILT (G67) | B12 `GET {P}/prompt-versions` | M | B12 |
| PD-VER-06 | Boundary marker | History chart markLine "v3" at the version date | NOT BUILT (G70) | B11 timeline | S | B11 |

## 12. Archive and restore

| ID | Element | Behaviour and copy | STATUS | API | Size | Deps |
|---|---|---|---|---|---|---|
| PD-ARC-01 | Archive one | inspector More "Archive", row menu "Archive": runs at once, no confirm; toast "Prompt archived. Its answers stay." with Undo | BUILT `prompt-inspector.tsx`, `use-prompt-actions.tsx` | existing `DELETE` / `bulk-archive` | none | none |
| PD-ARC-02 | Archive many | bulk bar "Archive": at most 100 at once without confirm, over 100 a `ConfirmDialog` "Archive 120 prompts?" "They are no longer asked. Their answers, versions and topics stay, and you can restore them." button "Archive 120 prompts"; toast with Undo | BUILT `use-prompt-actions.tsx` (`CONFIRM_ARCHIVE_ABOVE`) | existing `bulk-archive` | none | none |
| PD-ARC-03 | Quota effect line | every archive toast adds "Frees 9 places: 122 of 150 used." | NOT BUILT | lint `quota` or N06 | S | N06 |
| PD-ARC-04 | Archived view | filter chip "Status: Active" (default) with Archived and All; archived rows show an "Archived" badge and dimmed rates; the row menu offers Restore instead of Archive and Run now | NOT BUILT | existing `filter[is_active]=false`; "All" needs NEW N13 `filter[is_active]` to accept `any` | M | N13 |
| PD-ARC-05 | Restore one | row menu or inspector "Restore": runs at once; toast "Prompt restored. It is asked from the next run." Undo archives again. Quota refusal: toast error "No room: the workspace has 150 of 150 active prompts. Archive one first." | PARTIAL: restore as Undo BUILT; as an action NOT BUILT | existing `PATCH is_active: true` | S | PD-ARC-04 |
| PD-ARC-06 | Restore many | bulk bar on the Archived view "Restore": `ConfirmDialog` always (it costs places): "Restore 12 prompts? They take 12 of the workspace's 19 remaining places and are asked from the next run (about $0.12 a month)." Over the quota: button disabled "12 places needed, 9 left." | NOT BUILT | existing `bulk-archive archive: false` (all or none) | S | N05, N06 |
| PD-ARC-07 | Country no longer offered | a restored prompt is not checked against the engines' countries; the restore toast warns when an enabled engine has no location in its country: "AI Mode does not ask in Germany, so it skips this prompt." | NOT BUILT | existing engines | S | none |
| PD-ARC-08 | Locked core member | archiving a core member needs `panels:core:modify` and a reason (`422 panel_locked`); editor: disabled with "Only an admin can archive a core prompt." | NOT BUILT | B10 | S | B10 |

## 13. Panels

Panels are not built (B10). Until they are, no panel UI ships, and the Add dialog has no Panel field. Every panel
runs twice a week (owner decision), so no cadence control.

| ID | Element | Behaviour and copy | STATUS | API | Size | Deps |
|---|---|---|---|---|---|---|
| PD-PAN-01 | Panels tab | table: Name, "Locked" badge, Kind (Core, Discovery, Custom), Prompts, "Changed in 90 days" (core only, with the 10% limit), Last run; row opens the panel inspector | NOT BUILT (G60) | B10 `GET {P}/panels` | L | B10 |
| PD-PAN-02 | Create panel | 400 px dialog "New panel": Name (`Input`, 1 to 80 characters, unique in the project: "A panel has this name already."), Kind (`RadioGroup` Discovery, Custom; Experiment hidden until Phase 15); button "Create panel" | NOT BUILT (G61) | B10 `POST {P}/panels` (`409 duplicate`, `422 core_panel_exists`) | S | B10 |
| PD-PAN-03 | Rename | 400 px dialog "Rename panel": Name, "Save name" | NOT BUILT | B10 `PATCH {P}/panels/{id} { name }` | S | B10 |
| PD-PAN-04 | Delete | AlertDialog "Delete Discovery panel?" "Its 40 prompts stay in the project and keep their answers. Their membership history is kept." button "Delete panel" (destructive); the core panel has no Delete ("The core panel cannot be deleted.") | NOT BUILT | B10 `DELETE` (`409 invalid_state_transition`) | S | B10 |
| PD-PAN-05 | Add to panel | bulk bar and row menu "Add to panel" submenu listing panels; a locked panel opens the reason dialog (PD-PAN-07); result toast "12 added to Discovery. 3 were members already." | NOT BUILT (G47) | B10 `POST {P}/panels/{id}/memberships { prompt_ids, reason? }` | M | B10 |
| PD-PAN-06 | Remove from panel | same, "Remove from panel"; for the core panel the reason is required | NOT BUILT | B10 `/memberships/remove` | M | B10 |
| PD-PAN-07 | Locked core reason dialog | 400 px dialog "Change the core panel": text "The core panel is locked so its trend stays comparable. Changes are recorded with a reason and take effect from the next run." Reason (`Textarea`, required, 1 to 500: "Say why. It is kept with the change."), churn line (PD-PAN-08), button "Add 12 to Core" or "Remove 12 from Core" | NOT BUILT (G62) | B10 `reason`, `422 reason_required`, `422 panel_locked` | S | B10 |
| PD-PAN-08 | Churn warning | warning `Banner` in the reason dialog when the change would pass 10% in 90 days: "This takes the core panel's change in 90 days to 14% (limit 10%). Trends across this period are less comparable." Does not block | NOT BUILT | B10 `meta.churn_90d`, `churn_warning`; NEW N14 a dry run `?dry_run=true` that returns the churn before writing | S | B10, N14 |
| PD-PAN-09 | Lock and unlock | panel inspector Switch "Locked" (admin only); unlock asks for a reason in a 400 px dialog | NOT BUILT | B10 `PATCH is_locked` (`panels:core:modify`) | S | B10 |
| PD-PAN-10 | Membership history | panel inspector list: prompt, added or removed, by, when, reason | NOT BUILT (G64) | B10 `GET .../memberships?include_history=true` | M | B10 |
| PD-PAN-11 | Panel filter chip | "Panel: Core" on the Prompts tab | NOT BUILT (G09) | B10 `filter[panel]` | S | B10 |
| PD-PAN-12 | Run now for a panel | panel row menu "Ask now": confirm as PD-POST-02, in runs of 150 | NOT BUILT (G66) | existing `POST {P}/ai/runs` with the member ids | S | B10 |
| PD-PAN-13 | Core size limit | adding past 1,500 members: "The core panel holds at most 1,500 prompts." | NOT BUILT | B10 `422 core_panel_size_limit` | S | B10 |

## 14. Topic assignment

| ID | Element | Behaviour and copy | STATUS | API | Size | Deps |
|---|---|---|---|---|---|---|
| PD-TOP-01 | Topic picker | `MultiSelect` with a tree list: topics indented under their parents (the Topics tab is an indented tree, owner decision), search matches any part of the path, chips show the leaf with the parent as a prefix in `foreground-tertiary` ("CRM / Startups"); tags (non-topic vocabularies) listed in a second group "Tags"; one per single-valued vocabulary kept (reuse `useTermChoices`, `keepOnePerSingleVocabulary`) | PARTIAL: flat topic `Select` BUILT | existing `GET {W}/vocabularies`, terms | M | none |
| PD-TOP-02 | Nested topics | choosing a child does not add its parent (a prompt counts under its topic and every ancestor already, as the summary rolls up); the picker says so once under the field: "A prompt counts under its topic and the topics above it." | NOT BUILT | none | S | PD-TOP-01 |
| PD-TOP-03 | Create topic inline | typing a name with no match offers "Create topic 'Startups'" and, with a slash, "Create 'CRM / Startups'" (path, creates missing parents); created when the form is saved, not when typed (as `useEnsureGroups`); left behind when the add fails, and the alert says so: "Topic 'Startups' was created. The prompts were not added." | NOT BUILT | existing `POST {W}/vocabularies/{id}/terms { name, parent_id }` or `{ path }` (`taxonomy:write`) | M | none |
| PD-TOP-04 | No permission to create | without `taxonomy:write` the "Create" option is replaced by "Only editors can create topics." | NOT BUILT | none | S | PD-TOP-03 |
| PD-TOP-05 | Bulk "Set topics" | bulk bar "Topics" opens a 400 px dialog: picker plus `RadioGroup` "Add to their topics" (default), "Replace their topics", "Remove these topics"; button "Update 12 prompts"; result toast "Topics updated on 12 prompts." | NOT BUILT | today `PATCH term_ids` per prompt (replace only, so the client reads, merges and writes each; up to 150 calls); NEW N09 `POST {P}/prompts/bulk-update { ids, set, add_term_ids, remove_term_ids }` makes it one call | M | N09 |
| PD-TOP-06 | Topic from the topic drawer | "Add prompts" in the drawer opens the Add dialog with that topic (G82) | NOT BUILT | none | S | PD-ADD-04 |

## 15. Row menu, bulk bar, inspector menu: every item

### 15.1 Prompt row menu (button at row end, right-click, `Shift+F10`)

| ID | Item | Group | Shown when | Disabled when (reason) | STATUS | API | Size | Deps |
|---|---|---|---|---|---|---|---|---|
| PD-ROW-01 | Open | open | always | never | BUILT `use-prompt-actions.tsx` `forPrompt` | none | none | none |
| PD-ROW-02 | Ask now | object | `runs:trigger`, active prompt | no enabled engine takes it ("No enabled engine asks this prompt: too long for AI Mode and no ChatGPT location in Germany."), busy | BUILT (label "Run now"; rename to "Ask now" only if the whole app renames, else keep "Run now") | existing `run-now` | none | none |
| PD-ROW-03 | Edit details | object | `prompts:write` | archived | NOT BUILT | existing `PATCH` | S | PD-EDIT |
| PD-ROW-04 | Edit text | object | `prompts:write`, versions built | locked core member for an editor (except typo) | NOT BUILT | B11 | S | B11 |
| PD-ROW-05 | Topics | object | `prompts:write` | none | NOT BUILT | `PATCH term_ids` | S | PD-TOP |
| PD-ROW-06 | Add to panel, Remove from panel | object | `prompts:write`, panels built | as PD-PAN | NOT BUILT | B10 | S | B10 |
| PD-ROW-07 | Copy prompt | copy | always | none | BUILT | none | none | none |
| PD-ROW-08 | Copy link | copy | always | none | NOT BUILT (G03) | none | S | none |
| PD-ROW-09 | Archive / Restore | destructive group, neutral tone | `prompts:write` | busy; Restore over the quota ("No room: 150 of 150.") | Archive BUILT; Restore NOT BUILT | existing | S | PD-ARC-05 |

### 15.2 Bulk bar (one or more rows selected)

| ID | Item | Behaviour | STATUS | API | Size | Deps |
|---|---|---|---|---|---|---|
| PD-BULK-01 | "N selected" and "Select all N matching" | the second selects every prompt matching the filters across pages (at most 150 active by quota; Archived view can hold more) | PARTIAL: selection BUILT (`selection-model.ts`); "all matching" NOT BUILT | existing list with filters | S | none |
| PD-BULK-02 | Hidden by filter note | "3 selected prompts are hidden by the filters." | NOT BUILT (G47) | none | S | none |
| PD-BULK-03 | Ask now | confirm when more than 1 (BUILT copy: runs of 150, used of 20) plus the cost line | BUILT `use-prompt-actions.tsx`; cost before the call NOT BUILT | existing `POST {P}/ai/runs`; N05 | S | N05 |
| PD-BULK-04 | Export | CSV of the selected rows | BUILT `export-rows.ts` | none | none | none |
| PD-BULK-05 | Archive | as PD-ARC-02 | BUILT | existing | none | none |
| PD-BULK-06 | Topics | as PD-TOP-05 | NOT BUILT | N09 | M | N09 |
| PD-BULK-07 | Edit details | 400 px dialog with Type, Intent, Stage, Importance, each "Leave as is" by default; "Update 12 prompts" | NOT BUILT | today `PATCH` per id; N09 | M | N09 |
| PD-BULK-08 | Add to panel, Remove from panel | as PD-PAN-05, 06 | NOT BUILT | B10 | S | B10 |
| PD-BULK-09 | Restore (Archived view) | as PD-ARC-06 | NOT BUILT | existing | S | PD-ARC-04 |
| PD-BULK-10 | Clear | Esc or the X clears the selection | BUILT | none | none | none |

### 15.3 Prompt inspector header and More menu

| ID | Item | Behaviour | STATUS | API | Size | Deps |
|---|---|---|---|---|---|---|
| PD-INS-01 | Run now (header button) | as today | BUILT `prompt-inspector.tsx` | existing | none | none |
| PD-INS-02 | More: Edit details | opens 10.1 | NOT BUILT | `PATCH` | S | PD-EDIT |
| PD-INS-03 | More: Edit text | opens 10.2 | NOT BUILT | B11 | S | B11 |
| PD-INS-04 | More: Copy prompt, Copy link | | Copy prompt in the row menu only; NOT BUILT here | none | S | none |
| PD-INS-05 | More: Archive / Restore | Archive BUILT (`archiveAction`); Restore on an archived prompt NOT BUILT | existing | S | PD-ARC-05 |
| PD-INS-06 | Facts block editable in place | Type, Intent, Stage, Importance shown as facts; each fact has a pencil that opens the Edit details dialog focused on that field (no inline editing in the inspector: 16 section 2.5) | PARTIAL: Topic, Language, Importance, Added, Added by BUILT (`factsOf`); Type, Intent, Stage, Branded source, Source, Creation method NOT BUILT | existing `Prompt` fields | S | none |
| PD-INS-07 | Versions tab | as PD-VER-01 | NOT BUILT | B11 | M | B11 |
| PD-INS-08 | Panels line | "In Core since 2 Oct, Discovery since 12 Nov" | NOT BUILT | B10 `include=panels` | S | B10 |

## 16. Lint rules (the editor's checks)

Where: Add dialog check list, paste and CSV review, generate review, Edit text. Severity decides the tone and
whether it blocks. Rules that only warn never block; only what the API would refuse blocks.

| ID | Rule (`LintWarning.rule`) | When it appears | Wording | Severity, blocks | STATUS | API | Size | Deps |
|---|---|---|---|---|---|---|---|---|
| PD-LINT-01 | `engine_limit` | longer than an enabled engine takes | "Line 3 is too long for AI Mode (700 characters), which skips it." Over 2,000: "Line 3 is longer than 2,000 characters and cannot be added." | warning; error over 2,000 (blocks) | BUILT | existing lint | none | none |
| PD-LINT-02 | `contains_brand_alias` | names an own brand alias | "Line 4 names Acme, so it counts as branded and stays out of the rates unless branded prompts are included." | note, no block | BUILT | existing lint | none | none |
| PD-LINT-03 | `word_count` (doc 19 `length`) | under 5 or over 60 words, counted on white space (scripts without spaces counted by characters / 2, see N03) | "Line 6 has 3 words. Prompts of 5 to 60 words read like real questions." | warning, no block (the preview's error was too strict, gap analysis 4.10) | NOT BUILT | NEW N03 | S backend | N03 |
| PD-LINT-04 | `multiple_questions` | more than one `?` (also full-width and Arabic question marks) | "Line 7 asks more than one question. Answers to it will mix them." | warning | NOT BUILT | N03 | S backend | N03 |
| PD-LINT-05 | `leading_wording` | a superlative ("best", "top", "leading", "number one") within 3 words of an own or competitor alias, or "why is X the best" | "Line 8 asks why Acme is the best. It measures agreement, not visibility." | warning | NOT BUILT | N03 | S backend | N03 |
| PD-LINT-06 | `language_mismatch` | detected language differs from `language_code` with confidence; only for texts of at least 4 words | "Line 9 reads as German, and the prompts are set to English." | warning | NOT BUILT | N03 (lint takes `language_code`) | M backend | N03 |
| PD-LINT-07 | `contains_competitor_alias` | names a tracked competitor alias | "Line 10 names HubSpot. A competitor named in the prompt is likely to be named in the answer." For type comparison: note "Line 10 compares with HubSpot." | warning; note when the prompt type is comparison | NOT BUILT | N03 (matcher already loads competitor aliases) | S backend | N03 |
| PD-LINT-08 | `suggested_prompt_type` (not a warning, a field) | always | in the check list "Type: comparison (from wording)" | info | NOT BUILT | N02 | S backend | N02 |
| PD-LINT-09 | `tracked`, `near_duplicate_of` (fields) | identity match / casefold match | as PD-ADD-25 to 27 | note | NOT BUILT | N01 | S backend | N01 |

Order in the check list: errors, then warnings, then notes, each by line (as today, `TONE_ORDER`). A line with
several findings shows the most serious first and "and 2 more checks" which expands in place.

## 17. Error states mapped to the real API codes

| ID | Code (HTTP) | Route | Where it shows | Text |
|---|---|---|---|---|
| PD-ERR-01 | `quota_exceeded` (422, `limit`, `used`, `requested`) | bulk-create, POST prompts, PATCH is_active, bulk-archive restore | `FormAlert` at the top of the dialog body; toast for restore | "The workspace has 148 of 150 active prompts, so these 9 do not fit. Archive prompts you no longer need, then try again." (BUILT `add.quotaExceeded`; add `requested`) |
| PD-ERR-02 | `validation_failed` + `prompt_too_long` at `items.N.text` (422) | bulk-create | field error naming lines | "Line 7 is longer than 2,000 characters and cannot be added." (BUILT) |
| PD-ERR-03 | `validation_failed` + `value_error` (printable) | bulk-create | field error naming lines | "Line 9 has a character that cannot be saved." (BUILT) |
| PD-ERR-04 | rejected `location_not_supported` | bulk-create item | result view per line | "an enabled engine does not ask in this country." (BUILT); add the engine: use the item `message`, which names it |
| PD-ERR-05 | rejected `term_unknown` | bulk-create item | result view | "the topic cannot be used in this project." (BUILT) |
| PD-ERR-06 | rejected `single_valued_vocabulary` | bulk-create item | result view | "the topic belongs to a vocabulary that takes one term." (BUILT) |
| PD-ERR-07 | rejected `duplicate_in_request` | bulk-create item | result view | "the same prompt is in the list twice." (BUILT; the client folds repeats first, so this means a spelling the client did not fold) |
| PD-ERR-08 | rejected `duplicate` (`on_duplicate: error`, not used by the dialog) | bulk-create item | result view | "the project already tracks this prompt." (BUILT) |
| PD-ERR-09 | `duplicate` (409, `existing_id`) | POST prompts (single, not used) | | "This prompt is already tracked. Show it" |
| PD-ERR-10 | `too_many_matches` (422) | lint, create | `FormAlert` | "A brand alias matches this text too many times. Narrow a substring alias in Entities." with a link |
| PD-ERR-11 | `immutable_field` (422) | PATCH | never sent by the UI; fallback "Text, language and country are fixed." |
| PD-ERR-12 | `forbidden` (403) | every write | `FormAlert` | "You do not have permission to add prompts to this project." (BUILT) |
| PD-ERR-13 | `fresh_session_required` (403) | none of these today | re-auth dialog | as 16 section 4.4 |
| PD-ERR-14 | `not_found` (404) | PATCH, DELETE, project gone | toast or alert | "This prompt was deleted." / "This project was deleted." |
| PD-ERR-15 | `rate_limited` (429) | any | toast | "Too many requests. Try again in 2 minutes." (BUILT for runs) |
| PD-ERR-16 | `manual_run_limit` (429) | ai/runs, run-now | confirm dialog error, toast | "Today's 20 manual runs are used. They reset at 00:00 UTC." (BUILT `inspector.runLimit`) |
| PD-ERR-17 | `check_pending` (409, `engine_codes` or `prompt_ids`) | run-now, ai/runs | toast | "An answer is already on its way on ChatGPT." (BUILT) |
| PD-ERR-18 | `nothing_to_run` (422, `skipped`) | ai/runs | toast | "Nothing was asked: every prompt is too long for the engines or has no location." (BUILT `bulk.runNothingStarted`) |
| PD-ERR-19 | `price_unavailable` (422) | ai/runs | toast | "There is no price for this engine yet, so it cannot be asked now." |
| PD-ERR-20 | `provider_paused` (503) | ai/runs, run-now | toast | "The provider is refusing requests. Try again in 15 minutes." (BUILT `inspector.runPaused`) |
| PD-ERR-21 | `budget_blocked` (run status) | run plan | Runs page, toast on poll | "The month's budget is used, so the run was not asked." |
| PD-ERR-22 | network or 5xx | any | `FormAlert`, the list stays | "The prompts were not added. Try again in a moment." (BUILT) |
| PD-ERR-23 | B10 `panel_locked`, `reason_required`, `core_panel_exists`, `core_panel_size_limit` | panels, archive | dialog field or `FormAlert` | as PD-PAN-07, 13, PD-ARC-08 |
| PD-ERR-24 | B11 `duplicate` (version), `invalid_state_transition`, `precondition_failed` | versions, restore | field / conflict dialog | as PD-EDIT-21, PD-VER-03 |
| PD-ERR-25 | N10 `decide` rejected codes `tracked`, `quota_exceeded`, `panel_locked`, `invalid_state_transition` | candidates | toast summary | as PD-CAND-11 |

## 18. NEW API needs

Each item: what, proposed shape, why, size (backend), and the gap item it closes.

| ID | Item | Proposed shape | Why | Size | Closes |
|---|---|---|---|---|---|
| N01 | Lint knows what the project tracks | `POST {P}/prompts/lint` accepts `items: [{ text, language_code, country_iso }]` (as an alternative to `texts`, 1 to 1,000); each result adds `tracked: { prompt_id, is_active } \| null` (exact identity, archived included) and `near_duplicate_of: { prompt_id, text } \| null` (casefold and space-folded match, later trigram >= 0.8). `quota` gains `would_create` (items not tracked and not repeated) | the dialog counts and blocks "as the API reads it" (W01, W04); one call instead of reading every prompt | S | W01, G80 |
| N02 | prompt_type rule and override | `PromptCreate.prompt_type` optional with no default; when left out the server sets it: contains " vs " or "versus" (word bounded, case folded) gives `comparison`, starts with or contains "how to" gives `how_to`, a leading interrogative (what, which, who, where, when, why, how, is, are, can, should, does, do; per language list for the project languages) gives `question`, else `other`. `Prompt` adds `prompt_type_source: 'rule' \| 'person'`. Lint returns `suggested_prompt_type`. `GET {P}/prompts` adds `filter[prompt_type_in]` | owner decision 2026-11-12, B16 | S | B16, G10 |
| N03 | Lint rules (B17) | `LintRule` gains `word_count`, `multiple_questions`, `leading_wording`, `language_mismatch`, `contains_competitor_alias`; lint body takes `language_code` (or per item via N01); each warning keeps `rule`, `severity`, `message`, `span` | doc 11 section 4, G83 | M | B17, G83 |
| N04 | is_branded override at create | `PromptCreate.is_branded?: boolean`; `Prompt.is_branded_source: 'computed' \| 'override'` | doc 11 section 1, doc 19 `PromptCreate` | S | W14 |
| N05 | Cost and answers estimate | lint response adds `estimate: { engines: [{ engine_code, prompts_fit, answers_per_month, monthly_cost_usd \| null, run_now_answers, run_now_cost_usd \| null }], total_monthly_cost_usd \| null }` for the items that would be created, at the standard queue price; alternatively `ProjectEngine.unit_price_usd` and the web computes (smaller, but two sources of the formula) | W03; the bulk run confirm can show money before the call | S | W03 |
| N06 | Workspace prompt quota read | `GET {W}/quotas` returning `{ prompts: { limit, used } , ai_observations_month: { limit, used } }`, or `meta.quota` on `GET {P}/prompts` | header meter (AP-17) and archive toasts without a lint call | S | AP-17 |
| N07 | Provenance at create | `PromptCreate.source?` (`manual`, `csv_import`, `seo_keyword`, `paa`, `gsc_query`, ...), `creation_method?` (`human`, `template`, `imported`; `llm_generated` only from the server), `generated_from?: { tracked_keyword_id, template }` | imports and generated prompts are told apart in filters and audits | S | none |
| N08 | Keyword links | `core.keyword_prompt_links` table, `PromptCreate.keyword_ids?`, link type `generated` from `generated_from` | doc 11 section 6, generate flow | M | B13 part |
| N09 | Bulk update | `POST {P}/prompts/bulk-update { ids (1 to 1,000), set?: { intent?, funnel_stage?, prompt_type?, importance?, is_branded? }, add_term_ids?, remove_term_ids?, replace_term_ids? }` answers `{ matched, updated }`, one transaction, audit `prompt.bulk_changed` plus one `prompt.updated` each | bulk Topics and Edit details in one call (doc 19 3.7.1 lists it) | M | G47 |
| N10 | Candidates inbox | doc 19 3.7.3 as specified, plus `meta.counts` per status, `tracked` per candidate, `decide` accepting `edits: [{ id, text?, term_ids?, intent? }]` so "Edit and add" is one call | PD-CAND | L | B18, U-06 |
| B18 | From keywords preview | doc 19 3.7.1 `POST {P}/prompts/from-keywords/preview { tracked_keyword_ids (max 200), templates?, allow_competitor_names? }` answering per keyword `suggestions [{ text, template, prompt_type, near_duplicate_of }]`; add `tracked` (N01 shape) and `language_code`, `country_iso` per suggestion; templates per language (English first; other languages answer `template_language_unsupported` per keyword) | PD-GEN | M | G03 |
| B10 | Panels | doc 19 3.7.2 routes, tables `ai.prompt_panels`, `ai.panel_memberships`, a locked core panel per project seeded with every active prompt, `panel_ids` and `panel_reason` on create, `filter[panel]`, `include=panels`, `panel_locked` on archive | PD-PAN, PD-ADD-17, 18 | L | G09, G60 to G66, G81 |
| N14 | Membership dry run | `POST {P}/panels/{id}/memberships?dry_run=true` (and `/remove`) answers `meta.churn_90d`, `churn_warning` without writing | the churn warning shows before the person confirms | S | G62 |
| B11 | Versions and restore | doc 19 3.7.1: `GET {P}/prompts/{id}/versions`, `POST .../versions { text, change_kind, change_reason? }` with `If-Match`, `POST .../versions/{vid}/restore { change_reason }` (no `change_kind`, re-points `current_version_id`, audit `prompt.version_restored`), `GET .../timeline` | PD-EDIT-20 to 25, PD-VER | L | G67 to G70 |
| N12 | Restore events in the versions read | `GET .../versions` adds `restores: [{ version_id, restored_at, restored_by, reason }]` from the audit entries | a restore leaves no version row, so the list needs the events to explain "current since" | S | B11 part |
| B12 | Project-wide version feed | `GET {P}/prompt-versions?filter[change_kind_in]&from&to` (cursor, newest first) with `prompt_id`, `prompt_text`, `version_no`, `change_kind`, `change_reason`, `created_by`, `created_at`, and restore events | PD-VER-05 | M | G67 |
| N11 | Optimistic concurrency on PATCH | `ETag` on `GET {P}/prompts/{id}`, `If-Match` on `PATCH`, `412 precondition_failed` | two editors changing details at once (optional, low priority) | S | none |
| N13 | Archived and active together | `filter[is_active]` accepts `any` | "Status: All" view | S | none |

Not asked of the backend: a prompt import job (the browser parses, `bulk-create` writes, section 6), a
frequency per prompt (owner decision), LLM variants in the Add dialog (Phase 11, budgeted, inbox only).

## 19. Permissions and role behaviour

| ID | Role | What they see and can do |
|---|---|---|
| PD-ROLE-01 | Viewer (`data:read`) | no "Add prompts" button, no split menu, no `N` shortcut, no Edit, Archive, Restore, Topics or panel items; row menu Open, Copy prompt, Copy link; the inspector shows facts read only; Discover > Prompts lists candidates with no actions and a line "Ask an editor to add suggestions." |
| PD-ROLE-02 | Analyst (`data:read`, `runs:trigger`, `exports:create`) | as viewer, plus Run now / Ask now in the row menu, bulk bar and inspector, and Export; no add, edit or archive |
| PD-ROLE-03 | Editor (`prompts:write`, `taxonomy:write`, `imports:write`, `runs:trigger`) | everything in this document except: changing a locked core panel's membership, archiving a locked core member, a wording change of a locked core member, lock and unlock. Those show disabled with "Only an admin can change the locked core panel." Typo versions of core members are allowed |
| PD-ROLE-04 | Admin and owner (`panels:core:modify`) | everything, with a reason required on the locked core panel |
| PD-ROLE-05 | Member limited to some projects | same as their role inside their projects; creating a topic in a workspace-wide vocabulary is refused (`403`), so the picker offers "Create" only in the project's vocabularies |
| PD-ROLE-06 | Rule | the client hides or disables, the API decides (`lib/permissions/permissions.ts`); a `403` still maps to PD-ERR-12 |

## 20. Empty and loading states

| ID | Where | State | Content |
|---|---|---|---|
| PD-STATE-01 | Prompts tab, no prompt | empty | title "No prompts yet", text "Prompts are the questions you track in ChatGPT, Gemini and AI Mode. Start with 20 to 50 your buyers would ask.", actions "Add prompts" (primary), "Generate from keywords", "Import CSV" (`prompts:write` only); viewer: text only |
| PD-STATE-02 | Prompts tab, no engine on | warning banner above the table | "No AI engine is on, so no prompt is asked. Turn one on in Engine settings." |
| PD-STATE-03 | Add dialog, engines loading | the Add button is not shown until engines arrive (BUILT); the dialog never opens with an empty country list |
| PD-STATE-04 | Add dialog, countries failed | inline error under Country with Retry (as Add keywords `countriesFailed`) |
| PD-STATE-05 | Add dialog, lint pending | the plan block keeps its last numbers dimmed with "Checking..." for at most the debounce plus the call; the button stays enabled (the API has the last word) |
| PD-STATE-06 | Add dialog, lint failed | "The list could not be checked. You can still add it; the server checks it." (info), plan block shows the client counts only |
| PD-STATE-07 | Generate, preview loading | skeleton rows, "Writing prompts from 24 keywords" |
| PD-STATE-08 | Generate, nothing produced | "No prompts came from these keywords. Pick keywords with a clear topic, or another template." |
| PD-STATE-09 | Candidates, filtered empty | "No suggestions match these filters." action "Clear filters" |
| PD-STATE-10 | Versions tab, one version | "This is the first version. A text edit adds the next one." |
| PD-STATE-11 | Archived view empty | "No archived prompts." |
| PD-STATE-12 | CSV import, reading | "Reading 1,000 rows..." progress line; never a spinner alone |

## 21. Keyboard and accessibility

| ID | Item | Rule |
|---|---|---|
| PD-A11Y-01 | Shortcuts | `N` Add prompts, `Shift+N` Import CSV, `E` Edit details on the focused row, `Mod+Enter` submits the Add dialog from the textarea (BUILT `submitOnModEnter`), `Esc` closes (discard guard when dirty), `/` focuses search; all listed in the shortcut sheet |
| PD-A11Y-02 | Focus | initial focus on the Prompts field; after a server field error, focus on the field (BUILT `shouldFocus`); after the result view, on Done (BUILT); on close, back to the trigger |
| PD-A11Y-03 | Announcements | quota, errors, warnings and result through the shared announcer with keys and an 800 ms debounce, no live region of the dialog's own (BUILT); add the plan line (cost) under the quota key |
| PD-A11Y-04 | Disabled primary | `focusableWhenDisabled` with `aria-describedby` the plan block and the reason, as Add keywords |
| PD-A11Y-05 | Check list | `ul` with `aria-label` "Checks of the list"; each group a heading level 3; each item starts with "Line N" so a screen reader user can find it in the textarea; icons `aria-hidden` with the tone in words ("Cannot be added:") |
| PD-A11Y-06 | Topic picker | combobox with `aria-expanded`, tree items with `aria-level`, chips removable with Backspace, "Create topic" option announced as "Create topic Startups" |
| PD-A11Y-07 | Phone | 44 px targets in sheets, sticky footer never covers the focused field (scroll into view on focus) |
| PD-A11Y-08 | Language of text | each prompt text rendered with `lang` set to its `language_code` (BUILT in the inspector) |
| PD-A11Y-09 | Bulk over 100 | always confirms with the count (16 section 4.5, 20-accessibility criterion 3.3.4) (BUILT for archive) |

## 22. Tests to write

Unit and component (Vitest with MSW, next to the files; the existing 22 cases of `add-prompts.test.tsx` stay):

| ID | Test |
|---|---|
| PD-TEST-01 | the counter splits new, already tracked, repeats from the lint `tracked` answer, and an archived duplicate on an unloaded page is counted as tracked, not new |
| PD-TEST-02 | Add is disabled with the reason when the lint `would_create` is over the remaining quota, and enabled again when lines are removed |
| PD-TEST-03 | the plan block shows answers a month and the cost per engine from `estimate`, "under $0.01", and "no price" for an engine without one |
| PD-TEST-04 | Type "Set from wording" sends no `prompt_type`; a chosen type sends it; the check list shows the suggested type |
| PD-TEST-05 | Details fields send intent, stage, importance and the branded override; the "Never branded" warning shows on a line that names the brand |
| PD-TEST-06 | the topic picker creates a typed path on submit, not before; a failed add says the topic was created; without `taxonomy:write` there is no Create option |
| PD-TEST-07 | the archived group's "Restore" sends `bulk-archive archive: false` with the add and the quota counts it |
| PD-TEST-08 | a tab-separated paste is read as columns with a header, maps country names and ISO codes, and names an unknown country by its line |
| PD-TEST-09 | CSV: a non-UTF-8 file, a file over 5 MB, over 1,000 rows and one without a header are refused with their messages before any request |
| PD-TEST-10 | CSV: the mapping refuses no Prompt column and a field mapped twice; Review counts per outcome match the lint; Confirm sends chunks of at most 1,000 and a quota refusal of a later chunk shows partial success and the errors file |
| PD-TEST-11 | Generate: the preview is called with the chosen keyword ids and templates; tracked suggestions are unchecked and not checkable; an edited suggestion is re-linted and keeps `generated_from` |
| PD-TEST-12 | the success toast's Undo archives exactly the created ids; "Ask now" opens the confirm with the run count, the used manual runs and the cost, and calls `POST ai/runs` once per 150 |
| PD-TEST-13 | the result view's "Show it" closes the dialog and opens the inspector of `existing_id` |
| PD-TEST-14 | Edit details sends only changed fields; Language and Country are read only; a `403` and a `404` show their text |
| PD-TEST-15 | Restore version: the dialog requires a reason for a locked core member, sends `If-Match`, and `409 invalid_state_transition` shows "already current" |
| PD-TEST-16 | Restore many from the Archived view confirms always and is disabled over the quota |
| PD-TEST-17 | role matrix: viewer sees no add or edit items, analyst sees Run now and Export only, editor sees a disabled locked-core change with the admin reason |
| PD-TEST-18 | lint rules: each new rule's wording appears on its line and none blocks the add |

Backend (pytest, next to `tests/api/ai`): N01 `tracked` for an active, an archived, another country, a decomposed
spelling; N02 rule table (" vs ", "versus" word bounded, "how to", leading interrogative, other) and the override;
N03 each rule with a positive and a negative text and a non-Latin script; N05 estimate equals `monthly_cost` per
engine and counts only fitting prompts; N09 bulk update all or none and audits; B18 dedupe against tracked and
between suggestions.

End to end (Playwright, `apps/web/e2e/flows/ai-prompts.spec.ts`):

| ID | Flow |
|---|---|
| PD-TEST-20 | paste 12 lines with 2 tracked and 1 repeat, see the counts and the cost, add, see the toast, Undo, see them in Archived, restore one |
| PD-TEST-21 | import the template CSV with one bad country, review, import, download the errors file |
| PD-TEST-22 | generate from 3 keywords, uncheck one, edit one, add, see the new rows highlighted with "Added just now" |
| PD-TEST-23 | phone width: the Add dialog is a sheet with the sticky plan line and the buttons reachable with the keyboard open |
| PD-TEST-24 | viewer login: no add entry point anywhere, `N` does nothing |

## 23. Build order

1. Web only, no backend: PD-ADD-11 hint, PD-ADD-13 to 15 (Intent, Stage, Importance through existing fields),
   PD-TOP-01 to 04 (picker with create), PD-POST-01, 03 to 06, PD-INS-02 and 06, PD-EDIT-01 to 08 (details
   dialog, `PATCH`), PD-ROW-03, 05, 08, PD-ARC-03 to 07, PD-ADD-02, 04, 05, PD-PASTE (columns).
2. Small backend, big effect: N01 (exact counts, unblocks PD-QC-02 blocking and PD-ADD-25 to 27), N02 (type),
   N05 (cost), N04, N07, N06. Then PD-QC, PD-ADD-12, 16, 20, 23, PD-POST-02.
3. CSV import (web only after N01 and N07).
4. N03 lint rules, N09 bulk update with PD-TOP-05 and PD-BULK-07.
5. B18 and N08, then the generate dialog.
6. B11, N12, B12: versions, Edit text, restore.
7. B10, N14: panels and the locked core flows.
8. N10: candidates inbox and the Suggestions tab.

## 24. Open points

- Undo of an add archives (there is no delete): the archived prompts then block a re-add as "archived". Accept
  (and say it in the toast, as specified) or ask the backend for a hard delete of prompts with no answers made in
  the last 10 minutes by the same person.
- "Run now" or "Ask now": the app says "Run now"; this spec keeps "Run now" on buttons and uses "Ask" only in
  sentences, unless the owner renames it everywhere.
- Language detection (N03 `language_mismatch`) needs a library on the backend; short prompts detect badly, hence
  the 4-word floor.
- The quota is workspace-wide while the dialog is per project: the plan line says "Workspace prompts" so an agency
  with several projects reads it right.
