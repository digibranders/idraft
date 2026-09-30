# 17. Empty, Loading and Error States

Status: Accepted (design-system v2)
Last updated: 2026-09-29
Implementation: `apps/web/src/components/app/status/` (`EmptyState`, skeletons, `RefetchBar`, `CollectionProgress`, `InlineError`, `ErrorPage`, `FreshnessIndicator`) and `apps/web/src/components/app/metric/` (`InsufficientData`, `NotApplicable`, `BeyondDepth`, `NotCollected`, `CollectionIssue`, `UncertainFootnote`), per [26-implementation-guidelines.md](26-implementation-guidelines.md) section 2; `FieldError` is part of `components/ui/field.tsx` and `TableErrorRow` lives in `components/app/data-table/`
Related: [20-frontend-specification.md](../20-frontend-specification.md) sections 3.7, 3.8 and 4.5, [21-scheduler-workers.md](../21-scheduler-workers.md) sections 6, 9 and 11, [25-observability.md](../25-observability.md) section 6, [12-tables.md](12-tables.md), [14-badges-status.md](14-badges-status.md), [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md), [18-notifications-alerts.md](18-notifications-alerts.md), [22-content-formatting.md](22-content-formatting.md)

A measurement instrument is judged by how it behaves when data is missing, late, partial or wrong. This document specifies every state a data region can be in other than "complete and current", and the components that render them.

## 1. State model

Every data region (page, section, table, chart, metric strip, inspector section) is in exactly one primary state. Freshness and completeness are shown alongside the data, not instead of it.

| State | Meaning | Rendered as |
|---|---|---|
| Loading | First fetch for this query key, nothing to show | Skeleton (section 3) |
| Refreshing | New fetch with previous data available | Previous data plus `RefetchBar` (section 3.4) |
| Ready | Data present | Content, with `FreshnessIndicator` and any completeness notice |
| Empty | The query succeeded and the scope has no records | `EmptyState` (section 2) |
| Filtered empty | Records exist, filters exclude all of them | `EmptyState` filtered variant (section 2.3) |
| Error | The query failed | `InlineError`, table error row or error page (section 5) |
| Forbidden | The user lacks the permission | `EmptyState` permission variant (section 2.3) |

Data qualifiers that can apply to a Ready region (several at once): **partial**, **stale**, **delayed**, **running**, **collection issue** (sections 6 and 7). Value-level states (insufficient, not applicable, beyond depth, not collected) apply to single cells and tiles (section 8).

Rules:
1. Unknown is never shown as zero. A `null` value renders a value state from section 8, never `0`, never an empty string, never a dash glyph.
2. A region never goes back to a skeleton once it has shown data in this session for the same screen; refetches keep previous data.
3. No full-page spinners and no blocking overlays. The app shell (sidebar, top bar, page header) always renders.
4. Every non-ready state says why, and what to do if anything can be done.

## 2. Empty states

### 2.1 EmptyState component

```
                +------------------------------------------+
                |                 [icon 20]                |
                |                                          |
                |         No keywords tracked yet          |  type-subsection-title
                |  Add keywords to start daily rank checks |  type-body, foreground-secondary
                |            for this project.             |
                |                                          |
                |      [Add keywords]   Import a CSV       |  primary button, secondary link
                +------------------------------------------+
                     max width 400 px, padding 32 px
```

| Part | Specification |
|---|---|
| Container | Max width 400 px, centered horizontally in its region, 32 px padding, no border, no background, no illustration |
| Icon | Optional, 20 px (`size-icon-lg`), `foreground-tertiary`, the object's glyph from [07-icons.md](07-icons.md) section 6 (for example `Tag` for keywords). Omitted when it adds nothing |
| Title | `type-subsection-title` (14 / 20 px, 600), `foreground`, heading level matching its region (`h2` in a page, `h3` in a panel or inspector section) |
| Reason | Exactly one sentence, `type-body` (14 / 20 px), `foreground-secondary`, 4 px below the title. Longer explanations belong in help, not here |
| Actions | 16 px below the reason: one primary button (36 px, `h-control`) and optionally one secondary text link, 12 px apart. No action when the user cannot perform it |
| Spacing | Icon to title 12 px |
| Alignment | Centered text in tables, panels and pages. Left-aligned in the `inline` variant |

Variants:

| Variant | Where | Difference |
|---|---|---|
| `region` (default) | Table body below the real table header, chart panel, page content | As above. In a table it sits 32 px below the header, not vertically centered in a tall viewport |
| `inline` | Inspector sections, metric strip slots, small panels under 200 px tall | No icon, 16 px padding, left-aligned, title and reason on one line where they fit, action as a text link |

Placement rules: a table that is empty still renders its header and toolbar (so the user sees what would be there); a chart panel keeps its title and frame; the metric strip shows each metric's label with its value state rather than one empty state for the strip.

### 2.2 Copy rules

- Title: what is missing, stated as a fact. "No competitors added", not "Nothing here yet!" and not "Let's add your first competitor".
- Reason: why, or what will change it, with the real number, time or name: "First rank check scheduled for Sep 30, 02:00 CEST."
- Primary action: verb plus object, 3 words at most ([22-content-formatting.md](22-content-formatting.md)).
- No exclamation marks, no "Oops", no humour, no illustrations, no marketing ("Unlock insights").
- Times are shown in the project timezone with its abbreviation.

### 2.3 Copy catalogue

| Case | Title | Reason | Primary action | Secondary |
|---|---|---|---|---|
| No keywords | No keywords tracked yet | Add keywords to start daily rank checks for this project. | Add keywords | Import a CSV |
| No prompts (core panel) | No prompts in the core panel | Promote prompts from the discovery panel or add them directly. | Add prompts | Open discovery panel |
| No observations yet (AI) | No answers collected yet | First AI run scheduled for Oct 1, 01:00 CEST (weekly on Wednesdays). | Run now (`runs:trigger`) | View schedule |
| No observations yet (SEO) | No rank checks yet | First rank check scheduled for Sep 30, 02:00 CEST. | Check now (`runs:trigger`) | View schedule |
| No citations | No citations in this window | None of the 1,800 valid answers in the last 28 days cited a page for these filters. | none | Show last 90 days |
| No competitors | No competitors added | Add competitors to compare rankings and AI share of voice with your domain. | Add competitor | none |
| No integrations | No integrations connected | Connect Google Search Console to see clicks and impressions next to tracked ranks. | Connect Search Console | View all integrations |
| Filtered to zero | No keywords match these filters | 1,000 keywords are tracked; the 3 active filters exclude all of them. | Clear filters | none |
| No permission | You do not have access to Costs | Viewing costs needs the costs:read permission, which owners and admins can grant: Priya Shah (owner). | none | Back to Overview |
| Feature not available yet | AI Overview history is not available yet | This section fills in when AI Overview tracking is turned on for this workspace. | none | none |
| Not found (inspector or page) | This keyword does not exist or you do not have access to it | Check the link, or search for the keyword. | none | Back to Rankings |

Variant rules:
- **Filtered to zero**: below the reason, the active filters render as read-only chips (the same chips as the filter bar, without remove buttons), so the user sees what excludes the data. "Clear filters" does what the filter bar's "Clear all" does: it removes every filter chip and keeps the scope controls (date window, comparison, device, engines) ([13-filters-search.md](13-filters-search.md) section 2). The table header and toolbar stay.
- **No observations yet**: used only when no run has completed for the scope. If a run is in progress, the reason becomes the running state: "First AI run in progress: 412 of 1,000 answers collected." with a compact `CollectionProgress`.
- **Read-only users**: the primary action is omitted and the reason names who can act: "Editors and admins can add keywords: Dana Kim, Luis Ortega." At most three names, then "and 2 others". When the viewer cannot read the member list, the sentence names roles only: "Editors and admins can add keywords."
- **No permission** follows the inline 403 rule ([20-frontend-specification.md](../20-frontend-specification.md) section 3.7): it names the permission and who can grant it, and never retries.
- **Feature not available yet** is used only inside a released screen where a planned section would otherwise look broken. Unreleased screens and navigation items are absent, and their routes render the 404 page ([20-frontend-specification.md](../20-frontend-specification.md) section 3.10). The copy never promises a date and never says "coming soon".
- **No citations** is different from not collected: it appears only when valid answers exist in the window and none cited a page. With zero valid answers the region shows `NotCollected` or the collection-issue state instead.

## 3. Loading

### 3.1 Skeleton rules

- Skeleton blocks are `surface-subtle` with `rounded-sm` (4 px). They are sized to the final content so nothing shifts when data arrives (CLS budget 0.05, [20-frontend-specification.md](../20-frontend-specification.md) section 4.11).
- Text bars are 12 px tall for 13 px and 14 px text, 10 px for 12 px text, 14 px for 16 px text and 20 px for 24 px text, vertically centered in the line height of the real text style.
- Bar widths vary by a fixed pattern per row index (for example 72%, 56%, 64%, 48%), never random, so re-renders do not flicker.
- Everything known before the data arrives is real, not skeleton: page titles, table headers, column widths, chart titles, legend labels for configured series, metric labels, tab labels.
- Animation: **pulse, never shimmer**. Skeleton blocks pulse opacity 1 to 0.6 and back over 1.5 s, ease-in-out, infinite ([21-motion.md](21-motion.md) section 8.1). Under reduced motion they are static.
- Skeletons have `aria-hidden="true"`; the region carries `aria-busy="true"` and a visually hidden "Loading keywords" label.

### 3.2 Skeleton shapes

| Region | Skeleton |
|---|---|
| Table | Real 48 px toolbar and real 40 px header row (`h-row-header`, with its vertical header dividers); **12 skeleton rows** at the current row height (40 px Default, 32 px Compact; always 32 px in embedded tables, [12-tables.md](12-tables.md) section 3.1) with the real row dividers; text columns show a left-aligned 12 px bar (identity column 60% to 80% of width), numeric columns a right-aligned 32 px wide bar, badge columns a 22 px tall bar (the badge height), sparkline columns a bar at the sparkline height (20 px Default, 16 px Compact) and 70% width, the checkbox column an empty 16 px box |
| Metric strip | The real panel at its final 76 px height (`h-metric-strip`) with real full-height dividers and 20 px cell padding. Each cell keeps its real label (`type-meta`); the value is a 20 px tall by 72 px bar centered in the 32 px `type-metric` line, with one 12 px tall by 96 px bar 8 px to its right for the inline delta and context. The inspector key-value grid (`size="sm"`) keeps its real 64 px cells, labels and borders; its value bar is 18 px tall by 56 px (`type-metric-sm`) ([23-application-patterns.md](23-application-patterns.md) section 2.2) |
| Chart | Real 48 px title row with its title and legend; real axes where the domain is known before data (time axis from the date window, rank axis from 1 to the depth); gridlines at default ticks; a single flat `--chart-band` block across the plot at 40% of plot height and 24 px tall. No fake series lines |
| Inspector section | Heading real; two to four text bars; a chart block at the chart's real height |
| Evidence viewer | Header bars, then 6 paragraph bars of decreasing width |
| Page header | Title (`type-page-title`, 24 / 32 px) and 36 px actions are real (server-rendered); meta line bar 12 px by 240 px, 4 px below the title, in the 20 px `type-meta` line |

### 3.3 Progressive sections

- Each section owns its query, Suspense boundary and error boundary. The page renders the shell and headers at once and reveals sections as their data arrives, in any order, without layout movement because each skeleton reserves the final height.
- The page is never blocked on its slowest section. A 3-second chart does not delay a 300 ms table.
- Server-prefetched regions (Overview tiles, Keyword Detail header, [20-frontend-specification.md](../20-frontend-specification.md) section 3.4) render with data on first paint and never show skeletons.
- Route transitions use the segment's `loading.tsx`, which renders the page skeleton inside the persistent shell.
- Tables that fetch the full dataset in 200-row pages ([20-frontend-specification.md](../20-frontend-specification.md) section 4.8) render the first page as soon as it arrives. The toolbar count reads "Loading 1,200 of 4,812 rows" in `type-meta` until the last page lands; client sort and export are disabled with that reason until then.

### 3.4 Refetching: keep previous data

When filters, window or sort change, or `data_version` invalidates the cache:
- Previous data stays in place (`placeholderData: keepPreviousData`), fully legible.
- A **2 px `RefetchBar`** appears at the top edge of the refetching region: under the filter bar for a page-wide change, under the table header for a table-only change, under the section heading for one section. It is a static full-width bar in `primary`, with no animation: it appears and disappears, it never travels (indeterminate bars are not used, [21-motion.md](21-motion.md) section 8.3).
- The bar appears only if the refetch takes longer than 150 ms, so fast cache hits do not flash.
- Previous values keep full opacity for the whole refetch. They are never dimmed, because dimming drops text and chart labels below AA contrast ([21-motion.md](21-motion.md) section 6). Interaction stays enabled.
- After 400 ms of refetching, "Updating" with a 14 px spinner appears in the table toolbar or chart panel header ([12-tables.md](12-tables.md) section 7.1, section 3.5 below).
- The region sets `aria-busy="true"` while refetching. No announcement is made unless the result changes the row count, which is announced politely ("312 keywords").

### 3.5 Spinners

`LoaderCircle`, rotating once every 800 ms ([21-motion.md](21-motion.md) section 8.2), is allowed only in these places:
1. Buttons with a pending action, after 400 ms ([08-interaction-states.md](08-interaction-states.md) section 5).
2. The running state of `CollectionProgress`, `FreshnessIndicator` and the `StatusBadge` Running state.
3. Group headings in the command palette while a server search is in flight.
4. The combobox "Searching" row while an async search runs ([10-forms.md](10-forms.md) section 6.3).
5. A table cell whose value is computed on demand (for example a bootstrap interval), with the text "Computing".
6. The table toolbar or chart panel header during a refetch longer than 400 ms, with the text "Updating" (section 3.4).

Size: 14 px in `sm` controls, tables, toolbars and badges; 16 px in `md` and `lg` buttons ([21-motion.md](21-motion.md) section 8.2).

Under reduced motion the icon does not rotate and the adjacent text carries the state. Spinners never appear alone in a region, never at page level, never larger than 16 px.

## 4. Background jobs and collection progress

Background work (scheduled runs, Check now, Run prompt now, imports, exports, backfills) is shown with one component, `CollectionProgress`, in three densities.

### 4.1 Status vocabulary

Run statuses come from [21-scheduler-workers.md](../21-scheduler-workers.md) (`ops.collection_runs.status`). "Partial" is a display state derived from the data, not a run status.

| Display state | Source | Icon | Colour | Copy (compact) |
|---|---|---|---|---|
| Queued | run `planned` | `CalendarClock` | `foreground-tertiary` | Queued for 02:00 CEST |
| Running | run `running` | `LoaderCircle` (rotating) | `primary-text` | Running: 412 of 1,000 checks |
| Completed | run `completed` | `CircleCheck` | `positive-text` | Completed Sep 29, 04:12 CEST: 1,000 checks |
| Completed with errors | run `completed_with_errors` (failed plus dead at least 2% of tasks) | `TriangleAlert` | `warning-text` | Completed with errors: 23 of 1,000 checks failed |
| Partial | a displayed window includes a day whose run is still running or completed with errors | `CircleDashed` | `warning-text` | Partial: 612 of 1,000 keywords checked today |
| Failed | run `failed` | `CircleX` | `negative-text` | Failed at 02:14 CEST: provider authentication error |
| Budget blocked | run `budget_blocked` | `Receipt` | `warning-text` | Blocked by budget: estimate $84.20, $40.00 left |
| Cancelled | run `cancelled` | `CircleSlash` | `foreground-tertiary` | Cancelled by Dana Kim at 09:14 |

Task counts come from task statuses ([21-scheduler-workers.md](../21-scheduler-workers.md) section 5.3):

| Count shown | Task statuses |
|---|---|
| Done ("412 of 1,000") | `ingested`, `skipped_cached`, `failed`, `dead`, `cancelled` (terminal) |
| Failed | `failed`, `dead` |
| In flight | `pending`, `submit_unknown`, `submitted`, `ready`, `fetched` |

The unit noun comes from the workload: `seo_rank` "checks", `ai_prompt` "answers", `ai_mode_keyword` "checks", `keyword_metrics` "keywords", first-party syncs "days", imports "rows", exports "rows". No estimated time remaining is shown in V1.

### 4.2 Densities and placement

```
Compact (page header meta line, inspector freshness line):
  (o) Running: 412 of 1,000 checks · 3 failed                      View run

Standard (status line under the page header, import progress, run inspector):
  +------------------------------------------------------------------------+
  | (o) Rank checks running                         Started 02:00 CEST     |
  |     [######################..............................]  412 / 1,000|
  |     409 done · 3 failed · 588 in flight              View run in Ops   |
  +------------------------------------------------------------------------+

Full (Operations, run detail header):
  +------------------------------------------------------------------------+
  | seo_rank · scheduled · window 02:00 to 08:00 CEST       Running        |
  | [##########################xx..................................]        |
  | Ingested 402  Cached 7  Failed 2  Dead 1  Pending 311  Submitted 240   |
  | Ready 30  Fetched 7  Cancelled 0                                       |
  | Estimate $1.20 · Actual so far $0.49 · Started 02:00:04 CEST           |
  +------------------------------------------------------------------------+
```

| Density | Where | Content |
|---|---|---|
| Compact | Page header meta line (via `FreshnessIndicator`), inspector freshness line, table toolbar | Icon, one line of copy, optional link. Height 20 px (`type-meta`, 13 / 20 px) |
| Standard | Status line directly under the page header on screens whose data the run changes (while running or for 24 h after a non-completed end); import and export progress after the dialog closes | Icon, title, 4 px progress bar, counts line, link to the run |
| Full | Operations run detail and runs inspector | Every task status count, cost estimate and actual, timings |

Progress bar: 4 px tall, `rounded-sm`, track `surface-subtle`, done segment `primary`, failed segment `negative-solid` at the end of the done part. The bar has `role="progressbar"` with `aria-valuenow` (done), `aria-valuemax` (total) and `aria-valuetext` ("412 of 1,000 checks, 3 failed").

Links: "View run" opens the run inspector in Operations for users who can see runs ([20-frontend-specification.md](../20-frontend-specification.md) section 5.18: owners and admins, or the user who triggered the run); others see no link.

### 4.3 Lifecycle and toasts

- The UI polls the run at the `Retry-After` interval returned by the API until the status is terminal ([20-frontend-specification.md](../20-frontend-specification.md) section 3.5).
- **Runs the user started** (Check now, Run now, import, export, backfill): a toast on completion ([18-notifications-alerts.md](18-notifications-alerts.md) section 3): "Rank check finished: best crm for startups is #4" with "Open"; "Import finished: 1,204 added, 38 skipped" with "View report"; failures use the error toast only when no inline place shows it.
- **Scheduled runs** never toast. Their state is in `FreshnessIndicator`, and their failures surface as banners and notification-center items.
- When a run reaches a terminal state, the affected queries are invalidated (the `data_version` poll does this within 60 s; a run the user started invalidates at once).
- A `budget_blocked` run shows the inline notice from [20-frontend-specification.md](../20-frontend-specification.md) section 3.7 with the estimate, the budget name and "Open budgets" (`budgets:manage`), or "An admin can raise the budget: Priya Shah" for others.

## 5. Errors

### 5.1 Field errors

- Below the control, 6 px gap: 12 px `CircleX` (`size-icon-xs`) plus message in `type-meta`, `negative-text` ([10-forms.md](10-forms.md) section 2 owns the field anatomy). The control gets a 1 px `negative-solid` border, `aria-invalid="true"` and `aria-describedby` pointing at the message ([08-interaction-states.md](08-interaction-states.md) section 1).
- Validation runs on blur, then on every change once the field has shown an error. On submit, focus moves to the first invalid field.
- 422 responses map onto fields by path ([20-frontend-specification.md](../20-frontend-specification.md) section 3.7). Errors without a field path appear as a negative banner at the top of the form or dialog body.
- Messages say what is wrong and what is valid: "Slug can use lowercase letters, numbers and hyphens" and "ops is reserved; choose another slug", not "Invalid input".

### 5.2 Inline region errors

`InlineError` replaces the content of a section, chart panel or inspector section that failed to load:

```
  +------------------------------------------------------------------+
  | (x) Could not load rank history                                  |
  |     The server returned an error. Your filters are unchanged.    |
  |     [Retry]   Error ID 7f3a9c1e  [copy]                          |
  +------------------------------------------------------------------+
```

- Keeps the region's title and reserved height. 16 px padding, left-aligned.
- `CircleX` 16 px in `negative-text`, title `type-body-strong`, reason `type-body` `foreground-secondary`, then a 32 px (`sm`, `h-control-sm`) secondary "Retry" button and the Sentry event id in `type-mono` with a copy button. The id lets support find the event ([20-frontend-specification.md](../20-frontend-specification.md) section 7.5).
- Network errors say "Could not reach the server. Check your connection." and retry automatically when the browser comes back online.
- Retry keeps any previous data visible and uses the `RefetchBar`.

### 5.3 Table load failure

- The header and toolbar stay. The body shows one error row spanning all columns, 48 px tall, with the same content as `InlineError` on one line: icon, "Could not load keywords.", Retry, error id.
- A failure after some 200-row pages loaded keeps the loaded rows and appends the error row: "Loaded 1,200 of 4,812 rows. Loading stopped: network error." with "Retry" (resumes from the failed cursor). The toolbar count and any summary computed from rows say "partial" until complete; client-side export stays disabled.
- Server-paginated tables that fail on a page change keep the previous page visible and show the error row above it.

### 5.4 Provider failure and collection issues

When collection for the data on screen failed at the provider (run `failed`, or failed plus dead tasks above 2%), the last good data stays on screen with a qualifier:
- Page level: a negative banner ([18-notifications-alerts.md](18-notifications-alerts.md) section 4) "Today's rank checks failed at the provider. Showing results from Sep 28." with "View run" (if permitted).
- Value level: the collection-issue marker (section 8.1) on affected cells and tiles; values remain visible.
- AI engines with a valid-observation rate below 90% in the run show the collection-issue marker on that engine's values ([20-frontend-specification.md](../20-frontend-specification.md) section 4.5).

### 5.5 Partial data

A warning banner under the page header when a displayed window includes incomplete collection: "Partial data: 612 of 1,000 keywords checked today. Today's metrics include only checked keywords." The banner is not dismissible and disappears when the run completes. Tiles and aggregates computed over the partial day show the partial qualifier in their tooltip, and charts mark the partial point as hollow.

### 5.6 Stale data

Thresholds come from [21-scheduler-workers.md](../21-scheduler-workers.md) section 9 (section 7.3 below). Row-level staleness uses the stale badge ([14-badges-status.md](14-badges-status.md)). A page-level warning banner appears only when more than 5% of the in-scope keywords or prompt-engine pairs are stale (minimum 20), the same threshold as ops alerts 22 and 23 ([25-observability.md](../25-observability.md) section 6): "86 of 1,000 keywords have not been checked for over 36 hours. Their ranks are from their last successful check."

### 5.7 Delayed provider results

A run is **delayed** when it is still `running` after its window end. Delay is not failure: tasks are waiting for provider results.
- `FreshnessIndicator` shows "Provider delayed" (section 7).
- Status line copy: "Provider delayed: 212 checks waiting for results since 04:10 CEST. Earlier results are shown."
- Six hours after the window end the run is overdue ([21-scheduler-workers.md](../21-scheduler-workers.md) section 9) and the state escalates from info to warning with the banner "Rank checks are 6 hours overdue. The operations team has been alerted."

### 5.8 Full-page failure

`error.tsx` in each route segment renders inside the persistent shell:

```
  (x)  This page could not be loaded
       An unexpected error occurred. Your data is not affected.
       [Try again]   Go to Overview
       Error ID 7f3a9c1e  [copy]
```

`EmptyState` layout with `CircleX` 20 px in `negative-text`. "Try again" calls the boundary's `reset`. 404 uses `not-found.tsx` with the not-found copy from section 2.3. 401 never renders a page error; it redirects to login.

### 5.9 Integration authentication failure

When a first-party integration loses access (revoked token, expired refresh, removed property):
- A negative banner on every screen that shows that source's data and on Settings, Integrations: "Google Search Console access expired on Sep 27. Data after that date is missing." Action "Reconnect" (`integrations:manage`), which is a top-level navigation to the OAuth start. Users without the permission see "An admin can reconnect: Priya Shah."
- Charts and tables of that source end at the last synced day with a boundary label "Sync stopped"; missing days are gaps, never zeros.
- A notification-center item for users with `integrations:manage` ([18-notifications-alerts.md](18-notifications-alerts.md) section 5).

### 5.10 Backup failure (platform operators only)

Backup and restore-drill failures (alerts 40 and 41, [25-observability.md](../25-observability.md) section 6) are shown only to platform operators, in Operations, Health and the notification center: "Nightly backup failed (exit 3). Last good backup Sep 28, 02:10 UTC." with a runbook link. They never appear to workspace members.

### 5.11 Status code mapping

| Condition ([20-frontend-specification.md](../20-frontend-specification.md) section 3.7) | Component |
|---|---|
| 401 | Redirect to login; no UI state |
| 403 `fresh_session_required` | Re-authentication dialog ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 4.4) |
| 403 | `EmptyState` permission variant |
| 404 | `not-found.tsx`, or the not-found inspector body |
| 409 | Conflict dialog |
| 422 | Field errors, or a form banner |
| 429 | Info toast with countdown, "Too many requests. Retrying in 12 s", dismissed when the retry succeeds |
| `budget_blocked` | Inline notice (section 4.3) |
| 5xx, network | `InlineError`, table error row, or error page |

## 6. Failure, warning, incomplete, delayed

These four are easy to confuse and must look and read differently.

| Class | Meaning | Colour | Icon | Copy pattern | Action |
|---|---|---|---|---|---|
| **Failure** | Something did not happen and will not without action or retry. Data for the scope is missing | `negative-text` on `negative-subtle` | `CircleX` | "<Thing> failed. <Consequence>." Example: "Today's rank checks failed at the provider. Showing results from Sep 28." | Retry, Reconnect, View run |
| **Warning** | Data exists but needs attention before it is trusted or acted on: stale, completed with errors, budget threshold | `warning-text` on `warning-subtle` | `TriangleAlert` (`Clock` for stale, `Receipt` for budget) | "<Fact with numbers>. <What it means>." Example: "86 of 1,000 keywords have not been checked for over 36 hours." | View affected rows, Open budgets |
| **Incomplete** | Collection for the scope is still in progress or covered only part of it; values are correct for what they cover | `warning-text` on `warning-subtle` | `CircleDashed` | "Partial data: <n> of <total> <unit> <verb>. <Scope of the numbers>." | None; resolves itself |
| **Delayed** | Collection is on its way but later than its window; nothing is wrong yet | `info-text` on `info-subtle` | `Hourglass` | "Provider delayed: <n> <unit> waiting since <time>. Earlier results are shown." | None until overdue, then escalates to Warning |

Shared rules: the icon is always paired with text (colour is never the only signal, WCAG 1.4.1); copy states a number and a time; the class never changes the displayed values themselves, only qualifies them.

## 7. Data freshness

### 7.1 FreshnessIndicator

One component states how current the data on a page, inspector or tile is. It reads run state and `data_version` from the API.

| State | Icon | Colour | Copy |
|---|---|---|---|
| Fresh, under 24 h | none | `foreground-tertiary` | Updated 12m ago |
| Fresh, 24 h or older (weekly workloads) | none | `foreground-tertiary` | Last collected Sep 29, 18:30 CEST |
| Running | `LoaderCircle` | `primary-text` | Running: 412 of 1,000 checks |
| Partial | `CircleDashed` | `warning-text` | Partial data |
| Provider delayed | `Hourglass` | `info-text` | Provider delayed |
| Stale | `Clock` | `warning-text` | Stale: last collected Sep 27, 18:30 CEST |
| Last run failed | `CircleX` | `negative-text` | Last run failed · showing Sep 28 |
| Budget blocked | `Receipt` | `warning-text` | Blocked by budget · showing Sep 28 |

Precedence when several apply: failed, budget blocked, stale, partial, delayed, running, fresh. The tooltip lists every applicable fact:

```
Rank checks (daily, 02:00 CEST window)
Last completed run: Sep 29, 02:00 to 04:12 CEST, 1,000 checks
Next run: Sep 30, 02:00 CEST
Your local time: Sep 29, 20:30 EDT
```

Rules:
- Relative times use the formats in [22-content-formatting.md](22-content-formatting.md) ("12m ago", "3h ago"); absolute times use the project timezone with its abbreviation; the tooltip adds the viewer's local time when it differs ([20-frontend-specification.md](../20-frontend-specification.md) section 3.12).
- The time shown is the end of the last completed collection the data comes from, not the time of the last page load.
- Rendered as `<time datetime="...">`. The relative text updates every 60 s with the `data_version` poll; ticks are not announced. A change of state (fresh to running, running to completed) is announced politely once.
- The indicator is a button when it has a tooltip, so keyboard users can reach it; it opens nothing else.

### 7.2 Placement

| Surface | Placement |
|---|---|
| Page header | End of the meta line under the title, separated by `·`. Multi-workload pages (Overview) show the least fresh workload, with each workload in the tooltip |
| Inspector | Freshness line in the header ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.1) |
| Metric tile | Only when the tile's source differs from the page (first-party tiles: "GSC · updated 3h ago") |
| Table rows | Stale badge and last-checked column ([12-tables.md](12-tables.md)); not a per-row indicator |
| Workspace screens (Costs, Ops) | Times in the workspace timezone, stated in the header |

### 7.3 Stale thresholds

From [21-scheduler-workers.md](../21-scheduler-workers.md) section 9:

| Subject | Stale when |
|---|---|
| Tracked keyword, daily profile | No successful check for 36 hours |
| Tracked keyword, weekly profile | No successful check for 9 days |
| Prompt-engine pair, weekly cadence | No valid observation for 9 days |
| Page or inspector | Its last completed run is older than the subject threshold, or more than 5% of in-scope subjects are stale (minimum 20) |
| First-party daily sync | No successful sync for 36 hours (the daily rule, applied until [18-first-party-integrations.md](../18-first-party-integrations.md) defines its own) |

The API computes staleness (`is_stale`); the UI never recomputes it from timestamps.

## 8. Unknown, insufficient and absent values

The states of [20-frontend-specification.md](../20-frontend-specification.md) section 4.5 as components. Each works in three places: table cell, metric tile value, inspector value.

| Component | When | Cell (compact) | Tile and inspector | Tooltip | Accessible name |
|---|---|---|---|---|---|
| `NotCollected` | No run has completed for the scope | "Pending" in `foreground-tertiary` | "First check scheduled for Sep 30, 02:00 CEST" | Schedule and cadence | "Not collected yet, first check Sep 30, 02:00" |
| `InsufficientData` | Below the minimum sample (fewer than 4 valid observations per engine for AI rate cells, flip rate with T below 3, volatility with fewer than 10 ranked checks, GSC position with fewer than 20 impressions) | Hatched cell with "Insufficient" in `foreground-tertiary`; counts kept where required ("1 of 3") | "Insufficient data" plus the counts line | "3 valid observations; 4 needed" | "Insufficient data, 3 of 4 required observations" |
| `NotApplicable` | The measured surface did not exist (AI Overview citation rate with no AI Overview in window) | "No AIO" in `foreground-tertiary` | "No AI Overview in window" with the presence rate ("present in 0 of 28 checks") | Why the metric cannot exist | "Not applicable, no AI Overview in window" |
| `BeyondDepth` | Rank is null with a requested depth | Text `>20` from `formatRankCell` in `foreground-tertiary` (not a chip) | Text "not in top 20" from `formatRankInline` (not a chip) | "Checked to depth 20 on Sep 29; not found" | "not in top 20" from `describeRank` |

Shared rules:
- Hatching: 1 px diagonal lines in `border-subtle` at 45 degrees, 4 px apart, on `surface-subtle`. It is a data pattern required by the methodology, not decoration.
- These values **sort last** in both directions (beyond-depth after all ranked values, insufficient after all measured values), per [12-tables.md](12-tables.md).
- CSV export writes an empty value plus a status column (`not_collected`, `insufficient`, `not_applicable`, `beyond_depth`), never `0`.
- Charts: insufficient points are hollow without a CI band; beyond-depth checks are hollow markers in the hatched band; not-collected days are gaps; not-applicable periods have no mark ([15-data-visualization.md](15-data-visualization.md)).
- Deltas against any of these states use categorical labels (new, lost, first check), never a number ([22-content-formatting.md](22-content-formatting.md)).

### 8.1 Collection issue and uncertain footnote

Two qualifiers attach to a value instead of replacing it:
- `CollectionIssue`: a 14 px `TriangleAlert` in `warning-text` after the value, when the valid-observation rate is below 90% or the stale flag is set. It is a link to the run in Operations for users who can see runs, otherwise a tooltip: "Only 81% of answers were valid in this run." The value stays visible.
- `UncertainFootnote`: a `type-meta` line under a tile or section, "12 uncertain mentions excluded", linking to the review list.

## 9. Accessibility and verification

- Loading regions: `aria-busy="true"` plus a visually hidden label; skeletons hidden from assistive technology.
- State changes that matter are announced once through a polite live region: data loaded after an error, row count after a filter change, run completed. Errors in a region the user is working in use `role="alert"`; errors in background regions do not interrupt.
- Error ids and retry buttons are reachable by keyboard; Retry keeps focus on itself while loading and moves focus to the region heading on success.
- Every state in this document has a fixture in the `/design-system` preview and a Playwright screenshot per theme; every screen's component tests render loading, empty, filtered empty, error and forbidden states ([26-implementation-guidelines.md](26-implementation-guidelines.md)).
- A copy test checks that state strings contain no exclamation marks and no em-dashes or en-dashes.

## 10. Component summary

| Component | Section |
|---|---|
| `EmptyState` (`region`, `inline`) | 2 |
| `Skeleton`, `SkeletonTable`, `SkeletonMetricStrip`, `SkeletonChart`, `SkeletonText` | 3.1, 3.2 |
| `RefetchBar` | 3.4 |
| `CollectionProgress` (compact, standard, full) | 4 |
| `FieldError`, `InlineError`, `TableErrorRow`, `ErrorPage` | 5 |
| `FreshnessIndicator` | 7 |
| `NotCollected`, `InsufficientData`, `NotApplicable`, `BeyondDepth` | 8 |
| `CollectionIssue`, `UncertainFootnote` | 8.1 |

Banners used by this document are specified in [18-notifications-alerts.md](18-notifications-alerts.md) section 4. The inventory is in [25-component-inventory.md](25-component-inventory.md).
