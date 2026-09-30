# 24. Page Templates

Status: Accepted (design-system v2)
Last updated: 2026-09-29
Depends on: [05-layout-grid.md](05-layout-grid.md), [11-navigation.md](11-navigation.md), [12-tables.md](12-tables.md), [13-filters-search.md](13-filters-search.md), [15-data-visualization.md](15-data-visualization.md), [23-application-patterns.md](23-application-patterns.md). Product sources: [20-frontend-specification.md](../20-frontend-specification.md) section 5, [15-seo-ai-correlation.md](../15-seo-ai-correlation.md), [27-cost-model.md](../27-cost-model.md).

Every screen is built from one of six templates. A template fixes the regions, their order, their sizes and their scroll behavior; the screen fills them with content. A screen that needs a region no template has is a design-system change ([00-design-principles.md](00-design-principles.md) section 7).

## 1. Reading the wireframes

- Wireframes are schematic: they show information architecture and component placement, not visual design. Sizes in the region tables are authoritative; the drawings are not to scale vertically.
- Horizontal scale is about 12 px per character. Full-shell drawings are 120 characters wide (1440 px viewport). Screen drawings in section 9 omit the sidebar and top bar (shown once in 9.1) and are 104 characters wide: the 1,232 px main column at 1440 (208 px sidebar), or an 832 px main column plus a 400 px inspector. Inspector columns are drawn about 40 to 50 characters wide for legibility; the real widths are 400 px, and 440 px for prompt, citation and answer evidence ([23-application-patterns.md](23-application-patterns.md) section 4).
- Metric strips are drawn with three text rows (label, value, context) for legibility. The built strip is one 76 px panel with two rows: the context follows the delta on the value row ([23-application-patterns.md](23-application-patterns.md) section 2).
- Screen drawings in section 9 draw the filter bar directly under the title block. When a page has a metric strip, the built page places the strip between the title block (or tabs) and the filter bar, 16 px from each ([23-application-patterns.md](23-application-patterns.md) section 3.1).
- `[Label]` is a button, `[Label v]` a menu or select, `[Field: Value x]` a filter chip, `(i)` a `MetricInfo` trigger, `[x]` a checked checkbox, `[ ]` unchecked, `~~~` a chart area, `###` a bar, `{Name}` a highlighted mention.
- Sample values come from the Northwind CRM demo project (1,000 tracked keywords, 250 core prompts, ChatGPT, Gemini and AI Mode, AI Overview from SERP checks, competitors HubSpot, Pipedrive, Zoho, Freshsales, Salesforce).
- Routes follow [11-navigation.md](11-navigation.md) section 1 (project-scoped paths such as `/seo/rankings`).

## 2. Template selection

| Template | Job | Screens |
|---|---|---|
| T1 Analytics overview | Summarize a scope across channels and point to where to look | Overview, AI Visibility Overview, Costs |
| T2 Data table | Scan, filter, sort, compare and act on many records of one type | Rankings, Keywords, Pages list, Prompts, Citations, Sources, Competitors (tables), Topics, Alerts events, Operations runs |
| T3 Detail | Study one object in depth | Keyword Detail, Prompt Detail, Page Intelligence, Panel detail, Run detail |
| T4 Settings | Configure a project or workspace | Project and workspace settings, alert rule editor, entity editor |
| T5 Integration | Connect and monitor one external data source | Search Console, Bing, GA4, Cloudflare, file imports |
| T6 Discovery | Triage candidates into tracked objects | Discover: Keywords, Prompts, Opportunities; Competitor candidates |

The SEO and AI Matrix is a T2 variant with a chart region between the header and the table (section 9.9).

## 3. T1 Analytics overview

**Purpose.** Answer "what changed and where should I look" for a project, a channel or the workspace's spend, in one scroll. It summarizes; it does not list records beyond short, capped lists.

```text
| Sidebar 208 px   | Top bar 52 px: breadcrumb, search, date range, location, alerts, theme, help, user                |
+------------------+---------------------------------------------------------------------------------------------------+
|                  | PageHeader: title, meta line (freshness per channel), actions                                     |
|                  +---------------------------------------------------------------------------------------------------+
|                  | Notice region (only when present): SetupChecklist, CollectionProgress, partial data               |
|                  +---------------------------------------------------------------------------------------------------+
|                  | S1 MetricStrip md: 6 headline metrics (SEO items, group divider, AI items)                        |
|                  +---------------------------------------------------------------------------------------------------+
|                  | FilterBar: compare, chips (date range and location are in the top bar)                            |
|                  +---------------------------------------------------------------------------------------------------+
|                  | S2 ChartFrame: main trend (280 px)                           | Side list (360 px)                 |
|                  | ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~   | short ranked list or               |
|                  | ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~   | distribution                       |
|                  +--------------------------------------------------------------+------------------------------------+
|                  | S3 Cross-channel summary (QuadrantSummary)      | or second panel                                 |
|                  +-------------------------------------------------+-------------------------------------------------+
|                  | S4 ChangeFeed: Key changes (max 8)              | Opportunities (max 5)                           |
|                  +-------------------------------------------------+-------------------------------------------------+
|                  | S5 Channel detail table                         | Competitor table                                |
```

| Region | Component | Height | Behavior |
|---|---|---|---|
| Page header | `PageHeader` without tabs; the filter bar follows S1 | 92 px from the top bar to the first block ([23-application-patterns.md](23-application-patterns.md) section 3.2) | Scrolls with the page |
| Notice region | `SetupChecklist` (40 px collapsed), `CollectionProgress` notice, partial-data `Banner` | 0 when empty | Present only when there is something to act on |
| S1 Headline | `MetricStrip` `md` (one panel) | 76 px | Items link to the filtered table that lists their members |
| S2 Main trend | `ChartFrame` 280 px plus 360 px side column (`grid-cols-[minmax(0,1fr)_360px]`) | about 360 px with frame | Stacks below 1280 px |
| S3 Summary | `QuadrantSummary` (2 x 2 `MetricCard`) or two equal panels | about 220 px | Quadrant click opens the Matrix filtered to it |
| S4 Changes | `ChangeFeed` and an opportunities list (`OpportunityStatus` rows) in two equal panels | up to 8 rows | Each item links to evidence |
| S5 Detail | Two equal panels with `SimpleTable` or capped `DataTable` (10 rows) | up to 10 rows | "View all" to the T2 screen |

Rules: at most 5 major sections (S1 to S5). Sections and side-by-side panels are separated by 16 px (`gap-4`, the gap between page blocks); each panel is a `surface` panel with a 1 px `border`, 8 px radius, 16 px padding and a 48 px title row (`type-section-title`); panels are never nested. No section repeats a metric shown in S1.

**Components used:** `PageHeader`, `FilterBar`, `MetricStrip`, `ChartFrame`, `QuadrantSummary`, `ChangeFeed`, `OpportunityStatus`, `SimpleTable`, `DataTable` (capped), `FreshnessIndicator`, `SetupChecklist`, `CollectionProgress`, `EmptyState`.

**States.**

| State | Behavior |
|---|---|
| First load | Every section renders its skeleton at final height; SEO and AI sections load independently (separate requests) |
| Before first collection | `SetupChecklist` expanded, S1 items show `Pending` with the first check time; S2 to S5 show one `EmptyState` sentence each ("First results after Sep 30, 02:00") |
| One channel not enabled | Its S1 items and panels are absent (not disabled); the header meta names only the enabled channel |
| Partial data | Warning `Banner` in the notice region with the affected scope and a link to the run |
| Filtered to zero | Not applicable: overview filters narrow scope but sections always show a value or an explicit unknown state |

**URL state:** `win`, `from`, `to`, `cmp`, `loc`, `eng`, `topic`, plus `stats` when a statistics panel is open. No `inspect` except for alert events and competitors opened from lists.

**Responsive:** below 1280 px, S2 to S5 stack to one column; S1 wraps to two rows ([23-application-patterns.md](23-application-patterns.md) section 2.3). Below 768 px, charts are 200 px tall and 180 px below a 480 px container ([19-responsive-behavior.md](19-responsive-behavior.md) section 8); tables in S5 show their first two columns plus the value column.

## 4. T2 Data table

**Purpose.** Work with many records of one type: scan, filter, sort, compare, select, act, and inspect one record without losing the list.

```text
| Sidebar          | Top bar 52 px                                                                                     |
+------------------+----------------------------------------------------------+----------------------------------------+
|                  | PageHeader: title [View v]  [Sec] [Sec] [...] [Primary]  | InspectorHeader (sticky)               |
|                  | meta: Updated 12m ago · 1,000 tracked keywords           | name, actions, badges, type, freshness |
|                  | Tabs (optional, 44 px)                                   | Tab   Tab   Tab   Tab (44 px underline)|
|                  +----------------------------------------------------------+----------------------------------------+
|                  | MetricStrip md (optional, 76 px)                         | MetricStrip sm (key-value grid)        |
|                  +----------------------------------------------------------+                                        |
|                  | FilterBar: scopes, chips, [+ Filter]                     |                                        |
|                  +----------------------------------------------------------+----------------------------------------+
|                  | Toolbar 48: [Search /]  412 keywords  [Density] [Cols]   | InspectorSection                       |
|                  +----------------------------------------------------------+ chart 180 px                           |
|                  | Header row 40 (sticky)                                   |                                        |
|                  +----------------------------------------------------------+----------------------------------------+
|                  | Row 40                                                   | InspectorSection                       |
|                  | Row 40 (active: inset bar, surface-selected)             | SimpleTable, max 10 rows               |
|                  | Row 40                                                   |                                        |
|                  | ...                                                      |                                        |
|                  +----------------------------------------------------------+----------------------------------------+
|                  | Footer 48: 1 to 200 of 12,480 · Updated 12m ago  [<] [>] | Footer (edit mode only)                |
```

| Region | Component | Height | Behavior |
|---|---|---|---|
| Page header | `PageHeader` with `SavedViewMenu`, optional tabs; the filter bar follows the strip when there is one | Top bar to first block: 92 px (strip first), 144 px (filter bar first), 196 px with tabs ([23-application-patterns.md](23-application-patterns.md) section 3.2) | Fixed; does not scroll |
| Metric strip | `MetricStrip` `md` | 76 px plus the 16 px block gap | Optional; summarizes the filtered scope (not the page); sits between the header and the filter bar; fixed above the table |
| Table toolbar | `DataTable` toolbar: the title row of the table panel, 32 px `sm` controls; replaced by the bulk bar when rows are selected | 48 px | Table search, row count, density, columns, export |
| Table | `DataTable` inside a panel (1 px `border`, 8 px radius): 40 px header row on `surface-subtle` with 1 px dividers between header cells, 40 px rows (32 px in Compact density) | Fills remaining height | Body is the scroll container; header sticks; identity column pinned |
| Footer | `TableFooter`: count and freshness; range text ("1 to 200 of 12,480") with 32 px previous and next buttons only in server mode, no page numbers ([12-tables.md](12-tables.md) section 12) | 48 px | Sticky at the bottom of the table region |
| Inspector | `Inspector` (400 px) with `InspectorHeader` (44 px underline tabs at its bottom), `MetricStrip` `sm` as the first section, `InspectorSection`; footer in edit mode only ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.1) | Full height below the top bar | Docks when the main column keeps at least 720 px, else overlays ([05-layout-grid.md](05-layout-grid.md) section 6) |

Vertical budget at 1440 x 900 without tabs: top bar 52, header offset 20, title block 56, strip 76, filter bar 36, three 16 px gaps, table toolbar 48, table header 40 and footer 48 leave 476 px, which is 11 rows at 40 px (Default density) or 14 rows at 32 px (Compact).

**Components used:** `PageHeader`, `SavedViewMenu`, `FilterBar`, `FilterChip`, `MetricStrip`, `DataTable` with cells from [12-tables.md](12-tables.md) section 6, `TableFooter`, `Pagination` (server mode), `Inspector`, `InspectorHeader`, `InspectorSection`, `SimpleTable`, `ChartFrame` (inspector variant), `TriageToast` for reversible bulk actions.

**States.** Loading, refetch, empty, filtered-to-zero and error follow [12-tables.md](12-tables.md) section 7 and [17-empty-loading-error-states.md](17-empty-loading-error-states.md). The header, filter bar and table header stay visible in every state. An inspector open on a record that the new filter excludes stays open with the notice "Hidden by the current filters".

**URL state:** all filter keys, `q`, `sort`, `view`, `tab`, `by`, `inspect`, `itab`, `stats`.

**Responsive:** column tiers by viewport width ([19-responsive-behavior.md](19-responsive-behavior.md) section 6.1; section 9.3 shows the sets), inspector overlay below 720 px of main column, full-screen sheet below 768 px viewport, filter bar collapses to "Filters (3)" below 768 px.

## 5. T3 Detail

**Purpose.** Study one object: its history, its evidence, its related objects. Reached from "Open page" in the inspector header, Cmd/Ctrl+click, alerts and shared links.

```text
| Sidebar          | Top bar 52 px                                                                                     |
+------------------+---------------------------------------------------------------------------------------------------+
|                  | DetailPageHeader: object name (h1)                       [Sec] [Sec] [...] [Primary]              |
|                  | meta: object facts · freshness                                                                    |
|                  | FilterBar: compare (object-level filters only)                                                    |
|                  +---------------------------------------------------------------------------------------------------+
|                  | MetricStrip md (object key metrics) or up to 4 MetricCards                                        |
|                  +---------------------------------------------------------------------------------------------------+
|                  | Local tabs (only when justified, 44 px underline)                                                 |
|                  +---------------------------------------------------------------------------------------------------+
|                  | Evidence column (8 of 12)                                         Right rail (4 of 12)            |
|                  | +-------------------------------------------------------------+   +-----------------------------+ |
|                  | | Primary trend: ChartFrame 240 px                            |   | Rail panel: short list      | |
|                  | | ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ |   | 32 px rows                  | |
|                  | | ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ |   +-----------------------------+ |
|                  | +-------------------------------------------------------------+   +-----------------------------+ |
|                  | +-------------------------------------------------------------+   | Rail panel: status or       | |
|                  | | Observations / history (table)                              |   | distribution                | |
|                  | +-------------------------------------------------------------+   +-----------------------------+ |
|                  | +-------------------------------------------------------------+   +-----------------------------+ |
|                  | | Related entities, secondary evidence                        |   | Events (EventTimeline)      | |
|                  | +-------------------------------------------------------------+   +-----------------------------+ |
```

| Region | Component | Height | Behavior |
|---|---|---|---|
| Object header | `DetailPageHeader` ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 3): `h1` is the object name (keyword text, prompt in quotes, URL path) in `type-page-title`; meta line holds the object facts | 116 px from the top bar to the strip; 168 px with a filter bar (the back link line adds 24 px, [23-application-patterns.md](23-application-patterns.md) section 3.2) | Scrolls with the page |
| Key metrics | `MetricStrip` `md`, or up to 4 `MetricCard` when one metric per channel is the point of the page ([23-application-patterns.md](23-application-patterns.md) section 2.5) | 76 px or about 120 px | Deltas follow the page's compare setting |
| Local tabs | `Tabs` `variant="underline"`, 16 px below the strip | 44 px | Only when justified (below); they switch the grid content, not the header or strip |
| Grid | 12-column grid (`grid grid-cols-12 gap-4`): evidence column `col-span-8`, right rail `col-span-4`, both starting 16 px below the tabs (or the strip) | Content | Each column stacks its panels with 16 px gaps (`flex flex-col gap-4`); the two columns scroll with the page and are not sticky |
| Primary trend | `ChartFrame` 240 px, first panel of the evidence column | about 320 px | Legend toggles overlays (competitors, events, deep checks) |
| Evidence panels | Panels in the evidence column holding `DataTable` (capped) or `SimpleTable` | Content | "View all" opens the relevant T2 screen filtered to this object |
| Right rail | Stacked panels of short content: status per engine, feature presence, recent events. Each panel has a 48 px title row; tables inside are 32 px rows (`h-row-compact`) | Content | Short lists and status panels only; long tables and wide charts go in the evidence column |
| Events | `EventTimeline` ([18-notifications-alerts.md](18-notifications-alerts.md) section 7) as the last rail panel | Content, latest 50 events, then "Show older events" (32 px `secondary` `sm`) | |

**Tabs only where justified.** A detail page gets local tabs only when a group of content (a) needs its own controls (a date picker for snapshots, a compare mode), or (b) answers a different question (diagnostics), or (c) would push the default content below 3 screen heights. Otherwise one scrolling page with section headings is faster to scan and search with Cmd/Ctrl+F.

**Components used:** `DetailPageHeader`, `MetricStrip`, `MetricCard`, `ChartFrame`, `DataTable`, `SimpleTable`, `EventTimeline`, `SEOAIStatus` (`inline`), evidence viewer components, `StatisticsPanel`.

**States.** Object not found: a full-width `EmptyState` "This keyword is no longer tracked" with a link to the list. Archived object: `Archived` neutral badge in the meta line, actions reduced to "Restore". Sections with no data show one sentence each ("No URL changes in the last 90 days") so absence is visible.

**URL state:** path identifies the object; `tab`, `win`, `cmp`, `obs`, `vs`, `stats`.

**Responsive:** below 1280 px the grid becomes one column: the rail panels follow the evidence panels in the same order; below 768 px tabs become a scrollable tab row and tables show identity plus one value column.

## 6. T4 Settings

**Purpose.** Change configuration with clear consequences: cost, re-derivation, version boundaries.

```text
| Sidebar          | Top bar 52 px                                                                                     |
+------------------+---------------------------------------------------------------------------------------------------+
|                  | PageHeader: Settings (title block only, 92 px to the first block)                                 |
|                  +---------------------------------------------------------------------------------------------------+
|                  | Local nav 200   | Section title (type-section-title)                                              |
|                  | Your account    | One-sentence description (type-meta)                                            |
|                  |  Profile        |                                                                                 |
|                  |  Security       |                                                                                 |
|                  |  Preferences    |                                                                                 |
|                  | Project         |                                                                                 |
|                  |  General        |                                                                                 |
|                  |  Entities       | Field group: label 6 px control, helper text                                    |
|                  |  Domains        | [Control 36 px                      ]                                           |
|                  |  Taxonomy       |                                                                                 |
|                  |  Engines        | Field group                                                                     |
|                  |  Schedules      | [Control                            ]                                           |
|                  |  Alert rules    |                                                                                 |
|                  |  Retention      | Consequence notice: estimate delta, re-derivation scope                         |
|                  | Workspace       |                                                                                 |
|                  |  General        |                                                                                 |
|                  |  Members        |                                                                                 |
|                  |  API keys       +---------------------------------------------------------------------------------+
|                  |  Budgets        | Save bar (sticky when dirty): 3 changes    [Discard] [Save changes]             |
```

| Region | Component | Size | Behavior |
|---|---|---|---|
| Header | `PageHeader`, title only | 92 px to the first block | Scrolls |
| Local navigation | `SettingsNav` (32 px items, sidebar styling, [11-navigation.md](11-navigation.md) section 5) | 200 px wide | Sticky; current item `aria-current="page"` |
| Form column | Form sections from [10-forms.md](10-forms.md) | 640 px max (`max-w-form`) | Left-aligned next to the navigation; empty space stays to the right |
| Consequence notice | `Banner` (info or warning) | Content | Required when a change affects cost, history or other users |
| Save bar | `SaveBar` | 56 px | Appears when the form is dirty; sticky at the bottom of the form column; "Discard" `ghost`, "Save changes" `primary` |

**Save behavior.**

| Change type | Behavior |
|---|---|
| Form section with several fields | Explicit save through the save bar; leaving with unsaved changes asks "Discard unsaved changes?" with "Keep editing" and "Discard changes" ([10-forms.md](10-forms.md) section 13.2) |
| A single switch with no cost, history or permission effect (for example "Show favicons") | Applies immediately; no toast, no save bar (the switch position is the confirmation, [10-forms.md](10-forms.md) section 13.3) |
| Anything that changes cost (engines, replicates, schedules, depth) | Save bar shows the monthly estimate delta ("+$42.10 per month, estimate") before save |
| Anything that re-derives history (aliases, entity domains) | Confirmation dialog naming the scope ("Re-derives the last 90 days; charts will show a version boundary") |
| Destructive (delete project, remove member) | Separate "Danger zone" section at the end, `destructive` buttons opening an `AlertDialog`. Only project or workspace deletion requires typing the slug; removing a member is a normal confirmation ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 4.5) |

**Components used:** `PageHeader`, `SettingsNav`, form components ([10-forms.md](10-forms.md)), `Banner`, `SaveBar`, `DataTable` for list-type settings (members, API keys, alert rules), dialogs ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md)).

**States:** read-only for roles without permission (fields render as read-only text, save bar never appears, one `Banner` names the missing permission); saving (primary button loading after 400 ms); server validation errors map to fields and the save bar reads "2 errors".

**URL state:** path per section (`/settings/engines`); no query state except `inspect` on list-type sections.

**Responsive:** below 1024 px the local navigation becomes a `Select` above the form; the form column takes full width.

## 7. T5 Integration

**Purpose.** Connect one external source, show exactly what it can access, configure it, and make sync health and errors visible.

```text
| Sidebar          | Top bar 52 px                                                                                     |
+------------------+---------------------------------------------------------------------------------------------------+
|                  | PageHeader: Google Search Console        [Sync now] [...] [Reconnect]                             |
|                  | meta: Connected · Last sync 38m ago                                                               |
|                  | Tabs: Search Console   Bing   GA4   Cloudflare   Imports                                          |
|                  +---------------------------------------------------------------------------------------------------+
|                  | S1 Connection: status, account, property, connected by, since                                     |
|                  +---------------------------------------------------------------------------------------------------+
|                  | S2 Access (scopes in plain language)            | S3 Configuration (form fields)                  |
|                  +-------------------------------------------------+-------------------------------------------------+
|                  | S4 Sync status: MetricStrip md (last sync, coverage, rows, next sync)                             |
|                  | Sync history: EventTimeline or DataTable (runs)                                                   |
|                  +---------------------------------------------------------------------------------------------------+
|                  | S5 Errors: DataTable of sync errors (empty state when none)                                       |
```

| Region | Component | Height | Behavior |
|---|---|---|---|
| Header | `PageHeader` with source tabs (`TabNav`, one per connected or available source) | 196 px to the first block | Primary action is the one that fixes the current state: "Connect" (not connected), "Reconnect" (re-auth required), otherwise none |
| S1 Connection | `ConnectionStatus`: `StatusBadge` (Connected, Re-auth required, Revoked, Not connected), account, property, connected by, connected since | 1 to 3 lines | A `Banner` "Sync paused since Sep 21: reconnect to resume" when re-auth is required |
| S2 Access | `ScopeList`: each scope as a sentence ("Read search performance for sc-domain:northwind.com"), read-only | Content | Never shows raw OAuth scope strings except in a tooltip |
| S3 Configuration | Form fields, save bar per T4 | Content | Property picker, backfill range, query matching checkbox (booleans in save-bar forms are checkboxes, [10-forms.md](10-forms.md) section 13.2) |
| S4 Sync status | `MetricStrip` `md`: Last sync, Coverage (days with data over days in window), Rows imported, Next sync; history below | 76 px plus list | Provisional days labeled |
| S5 Errors | `DataTable` of errors (time, kind, message escaped, count, action) | Content | Empty: "No sync errors in the last 30 days" |

**Components used:** `PageHeader`, `TabNav`, `ConnectionStatus`, `StatusBadge`, `StatusDot` (in lists only), `ScopeList`, `Banner`, form components, `SaveBar`, `MetricStrip`, `EventTimeline`, `DataTable`.

**States:** Not connected (S1 shows what the source adds and a "Connect" primary; S2 lists requested access before OAuth; S3 to S5 absent), Connecting (top-level navigation to the OAuth start, returns to a property picker), Backfilling (`CollectionProgress` in the meta line with "Backfilling: 212 of 480 days"), Re-auth required, Revoked, Disconnected with or without data deletion.

**URL state:** path per source (`/integrations/gsc`); `win` for sync history.

**Responsive:** S2 and S3 stack below 1280 px.

## 8. T6 Discovery

**Purpose.** Triage candidates (keywords, prompts, competitors, opportunities) quickly and honestly: every candidate shows where it came from and why it is suggested, and nothing becomes tracked without an explicit promotion.

```text
| Sidebar          | Top bar 52 px                                                                                     |
+------------------+----------------------------------------------------------+----------------------------------------+
|                  | PageHeader: Discover [View v]         [...] [Generate]   | Inspector: evidence panel              |
|                  | meta: Updated 3h ago · 24 new candidates                 | candidate text                         |
|                  | Tabs: Keywords 24   Prompts 12   Opportunities           | source, suggested because              |
|                  | FilterBar: [+ Filter] (source, status, intent, volume)   |                                        |
|                  +----------------------------------------------------------+----------------------------------------+
|                  | Toolbar: [New 24][Accepted][Snoozed][Rejected] [Search /]| MetricStrip sm                         |
|                  +----------------------------------------------------------+----------------------------------------+
|                  | Header row                                               | Evidence sections                      |
|                  +----------------------------------------------------------+ (source detail, SERP or answer         |
|                  | Row 40 (Default density): candidate, source chips,       | examples, near duplicates)             |
|                  |   evidence line in type-meta                             |                                        |
|                  | Row 40                                                   +----------------------------------------+
|                  | ...                                                      | Footer: [Reject] [Snooze] [Accept]     |
```

| Region | Component | Height | Behavior |
|---|---|---|---|
| Header | `PageHeader` with count tabs | 196 px to the first block | Primary action is "Generate" on Prompts (opens the generator), none on Keywords |
| Status control | `SegmentedControl` `sm` in the table toolbar: New, Accepted, Snoozed, Rejected (counts on New only) | 32 px | Writes `status=`; each status is its own list |
| Table | `DataTable` in Default density (40 px rows; the second line carries the evidence summary, [04-spacing-density.md](04-spacing-density.md) section 3) | Fills | Single-key triage `a`, `r`, `s` on the focused row ([23-application-patterns.md](23-application-patterns.md) section 10) |
| Evidence panel | `Inspector` with candidate header, `MetricStrip` `sm`, evidence sections | Full height | Footer holds Reject (`ghost`), Snooze (`secondary`), Accept (`primary`) |
| Bulk bar | Replaces the toolbar on selection | 48 px | Accept, Snooze, Reject, then Assign group, Tags, Topic, then "Promote to tracked" (opens a dialog with quota and cost) |

**Components used:** `PageHeader`, `FilterBar`, `SegmentedControl`, `DataTable`, `Inspector`, `TriageToast`, `OpportunityStatus` (Opportunities tab), `ResponsePreview` (prompt candidates with an observed source), dialogs.

**States:** empty New list ("No new keyword candidates. Discovery runs every Monday."), all triaged (same empty state with the count triaged this week), generator running (`CollectionProgress` in meta), optimistic failure (row returns with warning icon).

**URL state:** `tab` (as path segment), `status`, filters, `q`, `sort`, `inspect`, `view`.

**Responsive:** below 1280 px the evidence panel overlays; below 768 px rows collapse to two-line list items and triage uses the row "More" menu.

## 9. Screen wireframes

The wireframes below define structure. For the finished visual quality of sections 9.2 to 9.7, see the high-fidelity screens in [reference/README.md](reference/README.md); where a reference image and a wireframe disagree, the wireframe wins.

### 9.1 Application shell

```text
| [N] Northwind  v | ⌂ > Northwind CRM > Rankings  [Search  ⌘K] [Cal 28 days v] [Pin US v] [Bell 3] [◐] [?] [AB]       |
+------------------+----------------------------------------------------------+----------------------------------------+
| Overview         | Rankings [View: Top 10 losses v] [Import] [...] [Add]    | best crm for startups [^][v][...][⤢][x]|
| Matrix           | Updated 12m ago · 1,000 tracked keywords                 | [US · Desktop] [Depth 20]              |
|                  |                                                          | Keyword · 12m ago           [Check now]|
| SEO              | Tracked 1,000 | Top 10 301 | Avg rank 9.1                | Overview   SERP   AI   Timeline        |
|  > Rankings      | [vs prev v] [Desktop v] [Tag: crm x] [+ Filter]          +----------------------------------------+
|    Keywords      +----------------------------------------------------------+ Rank 3 ↑5     | Best rank 2            |
|    Pages         | [Search /]  1,000 keywords  [Density v] [Cols]           | Avg rank 4.6  | Volume 12,400          |
|                  +----------------------------------------------------------+----------------------------------------+
| AI Visibility    | Keyword              Rank   Δ   Ranking URL     Vol      | Rank history, 30 days                  |
|    Overview      +----------------------------------------------------------+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ |
|    Prompts       | best crm for startups   3  ↑5   /blog/best-crm   12,400  | ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ |
|    Citations     | crm software small biz  7  ↓1   /pricing         33,100  +----------------------------------------+
|    Sources       | hubspot alternatives   14  ↓6   /compare/hubspot  8,100  | Ranking URL                            |
|                  | crm pricing           >20  Lost (none)              880  | /blog/best-crm-startups                |
| Competitors      | ...                                                      | Target /pricing · Mismatch             |
| Topics           +----------------------------------------------------------+----------------------------------------+
| Discover      24 | 1,000 keywords · Updated 12m ago                         | (footer only in edit mode)             |
|                  |                                                          |                                        |
| Reports          |                                                          |                                        |
| Integrations     |                                                          |                                        |
| Settings         |                                                          |                                        |
|                  |                                                          |                                        |
| Last run 06:12   |                                                          |                                        |
| [<<] Collapse    |                                                          |                                        |
```

`⌂` is the `House` icon for the project root and `>` the `ChevronRight` separator; `[Cal 28 days v]` and `[Pin US v]` are the top-bar date range and location scope controls. `[⤢]` is the inspector's expand button ("Open page", a 32 px `Maximize2` icon button), `[◐]` the theme menu and `[?]` the help menu. At 1440 px the Workspace item sits inside the Project menu ([19-responsive-behavior.md](19-responsive-behavior.md) section 3.2). The sidebar groups are separated by 16 px of space, not lines. The metric strip sits between the title block and the filter bar. The key-value grid is drawn on two lines for width.

| Region | Component | Notes |
|---|---|---|
| Sidebar | `Sidebar` (208 px, 56 px collapsed, `sidebar` fill, 1 px `border` right edge) | Workspace and project switcher at top (28 px monogram); 32 px items with 18 px icons; the active item in `surface-selected` with `primary-text` label and icon; 15 items in 3 sections ([11-navigation.md](11-navigation.md) sections 1 and 1.1); Discover count badge; collapse at the bottom (`[`), with the collection status line (`type-label`) above it |
| Top bar | `TopBar` (52 px, `surface`, bottom hairline) | Left: breadcrumb (16 px `House` icon in `foreground-tertiary` for the project root, 14 px `ChevronRight` separators in `foreground-muted`, ancestors in `foreground-tertiary`, current page in `foreground` 500) with the workspace and project menus. Right, 36 px controls 12 px apart: search field that opens the command palette (360 to 440 px, `⌘K` hint box); date range button; location button (both project-wide scope, hidden where they do not apply); notifications; theme menu (moves into the user menu below 1440 px); help menu; 32 px avatar for the user menu ([11-navigation.md](11-navigation.md) section 4, [19-responsive-behavior.md](19-responsive-behavior.md) section 3.2) |
| Page header | `PageHeader` | T2 variant shown |
| Content | Template region | Scroll model per template ([05-layout-grid.md](05-layout-grid.md) section 2.2) |
| Inspector | `Inspector` 400 px (keyword default; 440 px for prompt, citation and answer evidence, [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.2) | Docked below the top bar, own scroll, sticky header; Escape closes |
| Toasts | `Toaster` | Bottom right of the main column, 360 px; they never cover a docked inspector ([18-notifications-alerts.md](18-notifications-alerts.md) section 3.1) |
| Landmarks | `nav` Primary, `nav` Breadcrumb, `main`, `complementary` | "Skip to content" first focusable |

### 9.2 Overview (T1)

```text
| Overview                                                                  [Create report] [...]      |
| SEO updated 2h ago · AI updated Sep 28, 02:10                                                        |
| [vs previous period v] [Branded: Excluded x] [+ Filter]                                              |
+------------------------------------------------------------------------------------------------------+
| Setup: 7 of 9 steps complete  [==========      ]           [Continue setup] [Show steps]             |
+------------------------------------------------------------------------------------------------------+
| Visibility (i) |Top 10          |AIO citation    |ChatGPT mention |Gemini mention  |AI Mode mention  |
| 31.4% +1.2 pts |301 +14         |38.2% +0.4 pts  |34% +2.1 pts    |29% −0.8 pts    |41% −6.0 pts     |
| vol-weighted   |of 986 checked  |157 of 411      |612 of 1,800    |402 of 1,296    |398 of 980 obs   |
+----------------+----------------+----------------+----------------+----------------+-----------------+
| Visibility and mention rate, 28 days   [Series v] [Table]    | Rank distribution (986 checked)       |
| Sep 1 to Sep 28 · 986 keywords · 250 prompts                 | 1           ##              41        |
| ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  | 2 to 3      ###             47        |
| ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  | 4 to 10     ##########     213        |
| ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  | 11 to 20    #########      187        |
| Small multiples: SEO visibility, ChatGPT, Gemini, AI Mode    | 21 to 100   ####            84        |
| Method: prompt-weighted, 95% Wilson intervals. (i)           | Not in top 20 ##########   414        |
+--------------------------------------------------------------+---------------------------------------+
| SEO and AI matrix (keywords)      [Open Matrix]  | Not classified                                    |
| AI strong, SEO weak 9 kw| Strong in both   41 kw | Near threshold 133                                |
| 7.1K volume             | 58.2K volume           | Insufficient AI data 57                           |
+-------------------------+------------------------+ Not tracked in location 12                        |
| Weak in both      212 kw| SEO strong, AI weak 84 | Definition: AI presence = equal-weight            |
| 71.0K volume            | 96.4K volume           | mention rate on ChatGPT, Gemini, AIO              |
+--------------------------------------------------+---------------------------------------------------+
| Key changes                 View all 23 changes  | Opportunities                  View all           |
| Needs attention 2                                | Top 3, not cited in AIO   22 kw  31.2K            |
|  AI Mode mention rate −6.0 pts (detectable)  2d  | Top 10, no AI mentions    17 kw  24.8K            |
|  Collection: 12 checks failed Sep 28         1d  | Cited, weak rank           6 pages                |
| Changes 3                                        | Competitor ahead in both  37 kw  52.0K            |
|  Entered top 10: 14 keywords                 3d  | AIO present, not ranking  41 kw  18.3K            |
|  ChatGPT citation rate +3.4 pts (detectable) 5d  |                                                   |
|  New sources: 37 domains                     6d  |                                                   |
| Notices 1                                        |                                                   |
|  Extractor v3 → v4 on Sep 14                15d  |                                                   |
+--------------------------------------------------+---------------------------------------------------+
| AI by engine (core, non-branded)                       | Competitors                  View all       |
| Engine   Mention  Citation  Recommend.  SOV   Own cit. | Entity     SEO SOV  Vis.   AI SOV (CGPT)    |
| ChatGPT  34%      21%       18%         27%   9.1%     | Northwind  18.2%   31.4%   27%              |
| Gemini   29%      14%       15%         24%   6.0%     | HubSpot    24.0%   40.1%   33%              |
| AI Mode  41%      33%       n/a         31%   12.4%    | Pipedrive   9.6%   14.8%   12%              |
| Equal-weight average (3 engines): mention 35%          | Zoho        6.1%    9.9%    8%              |
```

| Region | Component | Notes |
|---|---|---|
| Header | `PageHeader`, no tabs; meta shows freshness per channel | Secondary "Create report"; no primary |
| Filter bar | Compare; chips for Engine, Topic via "+ Filter"; `Branded: Excluded` default chip. Date range and location are in the top bar | [13-filters-search.md](13-filters-search.md) section 4 |
| Notice | `SetupChecklist` (collapsed) | Only until setup completes |
| S1 | `MetricStrip` `md`, 3 SEO items, group divider, 3 AI items (one per engine, never pooled) | Visibility links to Rankings; Top 10 to Rankings `rank=top10`; AI items to Prompts with `eng=` |
| S2 | `ChartFrame` 280 px with metric small multiples (SEO visibility, then one per engine with CI bands; shared x axis); side list: rank distribution as horizontal bars with counts | Depth note in the side list tooltip: "Top 50 and 100 from deep checks (last 8 days)" |
| S3 | `QuadrantSummary` plus a side list of the unclassified groups and the definition line | Quadrant labels from [15-data-visualization.md](15-data-visualization.md) section 8 |
| S4 | `ChangeFeed` (max 8, grouped by severity) and opportunities list (`OpportunityStatus` rows with count and volume represented) | Each row links to the filtered view |
| S5 | `SimpleTable` "AI by engine" (A1, A2, A5, A7, A8 per engine, equal-weight line only with two or more engines) and capped competitor table | Competitor names with color swatches |

[20-frontend-specification.md](../20-frontend-specification.md) section 5.2 lists 12 SEO tiles. They are distributed here: visibility, top 10 and AIO citation in S1; rank distribution (which carries top 3, top 20 and the full bucket histogram) in S2; equal-weight visibility, average rank and estimated clicks in the Visibility item's inspector and on the Rankings strip.

### 9.3 Rank Tracker (T2)

Route `/seo/rankings`. Default state with the inspector closed:

```text
| Rankings  [View: Default v]                                    [Import] [Export] [...] [Add keywords]|
| Updated 12m ago · 1,000 tracked keywords                                                             |
| [vs previous period v] [Desktop v] [+ Filter]                                                        |
+------------------------------------------------------------------------------------------------------+
| Tracked        |Top 3           |Top 10          |Top 20          |Average rank    |Visibility (i)   |
| 1,000          |88 +6           |301 +14         |488 +9          |9.1             |31.4% +1.2 pts   |
| 986 checked    |of 986 checked  |of 986 checked  |of 986 checked  |612 ranked      |volume-weighted  |
+----------------+----------------+----------------+----------------+----------------+-----------------+
| [Search keywords /]   1,000 keywords                 [Group: none v] [Density v] [Columns] [Export]  |
+------------------------------------------------------------------------------------------------------+
| [ ] Keyword              Rank    Δ  Ranking URL       Volume  Intent   Features AIO       Trend      |
+------------------------------------------------------------------------------------------------------+
| [ ] best crm for startups   3   ↑5  /blog/best-crm..  12,400  Commerc. [][][]+2 Cited #2  /\/-       |
| [ ] crm software for sm..   7   ↓1  /pricing          33,100  Commerc. [][]     Not cited --\_       |
| [ ] hubspot alternatives   14   ↓6  /compare/hubspot   8,100  Commerc. [][][]   No AIO    \__/       |
| [ ] crm pricing           >20 Lost  (none)               880  Transac. [][]     Not cited __..       |
| [ ] free crm for startups      New  /blog/free-crm     5,400  Informa. []       Pending   ....       |
| [ ] ...                                                                                              |
+------------------------------------------------------------------------------------------------------+
| 1,000 keywords · Updated 12m ago                                                                     |
```

In the drawing, `[]` stands for a SERP feature icon slot, intent badges are shortened to fit the sketch (the UI shows "Commercial"), and the Competitor and Updated columns (priority 4) are hidden at 1440 px (see below).

**Columns.**

| # | Column | Type ([12-tables.md](12-tables.md) section 5) | Screen default / type min width | Priority ([19-responsive-behavior.md](19-responsive-behavior.md) section 6.2) | Notes |
|---|---|---|---|---|---|
| 0 | (select) | `select` | 40 / 40 | always | Checkbox |
| 1 | Keyword | `keyword` | 280 / 200, flex | 1 (pinned) | Location and device in tooltip; cannibalization and target mismatch icons |
| 2 | Rank | `rank` | 64 / 56 | 1 | `RankCell`: `>20` beyond depth; `Pending` before the first check |
| 3 | Δ | `rankDelta` | 56 / 48 | 1 | `RankDeltaCell`; header tooltip defines the emphasis rule |
| 4 | Ranking URL | `url` | 200 / 180 | 2 | `URLCell`; host hidden (single domain); `+1` when two owned URLs rank |
| 5 | Volume | `volume` | 80 / 72 | 2 | Header "Volume" with `Estimate` badge in the header tooltip |
| 6 | Intent | `badge` | 96 / 88 | 3 | Neutral badge; "Manual" marker when overridden |
| 7 | SERP features | `features` | 120 / 112 | 3 | `SERPFeatureList`, owned in `primary-text` |
| 8 | AI Overview | `aiOverview` | 104 / 96 | 2 | `AIOverviewStatus` |
| 9 | Competitor | `competitor` | 120 / 120 | 4 | First selected competitor's rank; more competitors via the column chooser |
| 10 | Trend | `sparkline` | 96 / 88 | 2 | 30 checks, inverted, depth breaks |
| 11 | Updated | `date` | 104 / 104 | 4 | Stale badge after threshold |
| 12 | (actions) | `actions` | 40 / 40 | always | Row "More" menu |

Column chooser extras (not in the default set): Previous rank, Best rank, Target URL, KD, Absolute rank, Volatility, URL stability, GSC clicks, impressions and average position (labeled GSC), Priority, Group, Tags, additional competitors.

**Width resolution.** [19-responsive-behavior.md](19-responsive-behavior.md) section 6.1 owns the tiers: priority 1 is always visible, priority 2 from 1280 px, priority 3 from 1440 px, priority 4 from 1680 px. Tiers follow the viewport, not the table region, so opening the inspector never hides or reveals columns. When the visible set's default widths exceed the table region, the flex column shrinks to its minimum, then columns shrink toward their minimums; if the set still does not fit, the table scrolls horizontally inside its region with Keyword pinned. Hidden columns stay in the chooser and in the inspector. The resulting sets for this table:

| Viewport | Table region | Visible columns |
|---|---|---|
| 1920 | 1,672 px | All 11 at default width; Keyword grows to its 480 px maximum |
| 1680 | 1,432 px | All 11 (1,400 px at default widths) |
| 1440 | 1,192 px | All except Competitor and Updated (1,176 px) |
| 1440, inspector docked | 792 px | Same set as 1440; the table scrolls horizontally with Keyword pinned |
| 1280 | 1,032 px | Keyword, Rank, Δ, Ranking URL, Volume, AI Overview, Trend (960 px) |
| 1024 (sidebar collapsed) | 928 px | Keyword, Rank, Δ; Default density adds the secondary line under the keyword ([19-responsive-behavior.md](19-responsive-behavior.md) section 6.6) |
| 768 | 736 px | Keyword, Rank, Δ, as at 1024 |

At 1280 px the inspector overlays (the main column would be 672 px, 1,072 minus 400, below the 720 px minimum, [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.6), so the table keeps its 1,032 px set.

**Grouping.** "Group: none" menu in the toolbar: Keyword group, Topic, Ranking URL, Intent. One level. Group header rows show the group name, keyword count, summed volume and top 10 count; never averaged ranks unless the API supplies them with `n_ranked`.

**Bulk actions.** Add tags, Move to group, Set target URL, Set priority, Check now (shows remaining manual quota), Create prompts, Export, then after a separator Archive (reversible, `TriageToast` undo; over 100 rows it first confirms with the count, [20-accessibility.md](20-accessibility.md) section 2, WCAG 3.3.4) and Delete (confirmation with exact count).

**Density.** At desktop widths both densities keep one line per row, as the reference screens show: Default (40 px rows, 11 visible at 1440 x 900) and Compact (32 px rows, 14 visible). Location and device are in the keyword tooltip and the previous rank in the rank tooltip. Below 1280 px, Default density adds a secondary line under the keyword ([19-responsive-behavior.md](19-responsive-behavior.md) section 6.6).

**Inspector.** Keyword inspector per [23-application-patterns.md](23-application-patterns.md) section 4.2 (Overview, SERP, AI, Timeline). `j` and `k` step through rows in the current sort.

| Region | Component | Notes |
|---|---|---|
| Header | `PageHeader`, `SavedViewMenu` | Primary "Add keywords"; "Import" secondary; Export in toolbar and More |
| Filter bar | Compare and Device scopes; chips from [13-filters-search.md](13-filters-search.md) section 4. Date range and location are in the top bar | The Rank filter editor shows bucket counts as facets, which replaces a separate distribution bar |
| Strip | `MetricStrip` `md`, 6 items for the filtered scope | Top 50 and 100 counts are in the Rank filter facets and Overview |
| Toolbar | Table search, count, grouping, density, columns, export | Bulk bar replaces it on selection |
| Table | `DataTable` with the columns above | Default sort Volume descending |
| Footer | Count and freshness | Client mode up to 10,000 keywords |

### 9.4 Keyword Detail (T3)

Route `/seo/keywords/[tkId]`. Laid out on the T3 grid (section 5): the evidence column holds the rank history, URL, competitor, AI Overview history and GSC panels; the right rail stacks related prompts (the AI answers panel), SERP features and events. The content is unchanged from the single-column version; only the arrangement follows reference screen 3.

```text
| best crm for startups                                             [Link prompts] [...] [Check now]   |
| United States · Desktop · Google · depth 20 (deep check Mondays) · Updated 12m ago                   |
| Target /pricing · Group Product/CRM · Tags: comparison                                               |
| [Last 90 days v] [vs previous period v] [Competitors: 2 selected x] [+ Filter]                       |
+------------------------------------------------------------------------------------------------------+
| Rank           |Best rank       |Average rank    |Days in top 10  |Volume          |AI Overview      |
| 3 ↑5           |2               |4.6             |61              |12,400          |Cited #2         |
| Sep 29, 02:14  |Sep 12          |88 of 90 checks |of 90 checks    |Estimate, Aug   |18 of 28 checks  |
+----------------+----------------+----------------+----------------+----------------+-----------------+
| Overview    SERP snapshots    Diagnostics                                                            |
+======================================================================================================+
Evidence column (8 of 12)                                           Right rail (4 of 12)
+----------------------------------------------------------------+  +----------------------------------+
| Rank history, 90 days                             [Table] [...]|  | Related prompts (mention rate)   |
| [Organic] [Absolute] [Events] [Deep checks]                    |  | Prompt     ChatGPT Gemini AI Mode|
| Northwind 3 · HubSpot 1 · Pipedrive 5 · -- Previous period     |  | "best CR.." 8 of 12 3 of 4 2 of 4|
| 1  :~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ |  | "which C.." 5 of 12 1 of 4    n/a|
| 10 :- - - - - - - - - - - - - - - - - - - - - - - - - - Top 10 |  | Suggested: "cheap CRM.."         |
| 20 :///////////////// Not in top 20 ////////////////////////// |  |                        [Activate]|
|    events:  URL changed Sep 12     AI Overview appeared Sep 10 |  +----------------------------------+
+----------------------------------------------------------------+  | SERP features, last 30 checks    |
| Target and ranking URL                                         |  | AI Overview ##.##..###.# 24 of 30|
| Target  /pricing                                               |  | PAA         ########..## 26 of 30|
| Ranking /blog/best-crm-startups  Mismatch                      |  | Video       ..#####.....  6 of 30|
| Sep 12  /pricing → /blog/best-crm-startups                     |  | Snippet     ............  0 of 30|
| Aug 30  /blog/crm-guide → /pricing                             |  | AIO owned (cited) in 18 of 30    |
| URL stability 0.93 (28 checks)                                 |  +----------------------------------+
+----------------------------------------------------------------+  | Events (latest 50)               |
| Competitor ranks (latest check)                     View all 20|  | Sep 29  Rank improved #8 → #3    |
| Domain            Now   30d ago   Role                         |  | Sep 12  Ranking URL changed      |
| hubspot.com         1         2   Competitor                   |  | Sep 10  AI Overview appeared     |
| g2.com              2         3   Third party                  |  | [Show older events]              |
| pipedrive.com       5         3   Competitor                   |  +----------------------------------+
+----------------------------------------------------------------+
| AI Overview history                                     View all|
| Date    Present  Own cited  Cited instead            Rank      |
| Sep 29  Yes      #2         g2.com, hubspot.com         3      |
| Sep 28  Yes      No         g2.com                      4      |
| Sep 27  No       n/a        n/a                         4      |
+----------------------------------------------------------------+
| Google Search Console (Google-reported)                        |
| Clicks 412 · Impr. 18,300 · Avg position 4.2                   |
| ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ |
| Own chart and axis; never on the rank chart                    |
+----------------------------------------------------------------+
```

**Tabs, justified.**

| Tab | Why it is a tab |
|---|---|
| Overview | Default content: one scrolling page, everything above |
| SERP snapshots | Needs its own controls (snapshot date picker, compare with a second date, RBO distance) and a 1,000 px wide two-column compare |
| Diagnostics (Phase 15) | Answers a different question ("why am I losing this keyword") with evidence and hypotheses in fixed order ([20-frontend-specification.md](../20-frontend-specification.md) section 5.14) |

Competitor ranks, SERP features, AI Overview history, related prompts, GSC and events are sections, not tabs: each is short and users read them together.

| Region | Component | Notes |
|---|---|---|
| Header | `DetailPageHeader`; the 3 tabs sit below the strip (T3) | "Check now" primary (quota-aware); "Link prompts" secondary; More: Edit target URL, Tags, Archive, Copy link |
| Strip | `MetricStrip` `md` (76 px panel, 6 cells) | Volume carries `Estimate`; AI Overview item uses `AIOverviewStatus` text |
| Layout | T3 grid: evidence column `col-span-8`, rail `col-span-4`, 16 px gaps | Below 1280 px the rail panels follow the evidence panels in one column |
| Rank history | Evidence column. `ChartFrame` 240 px, inverted axis (1 at the top), depth band, guide lines at 3, 10, 20, event strip ([15-data-visualization.md](15-data-visualization.md) section 7) | Competitor overlays limited to 5 |
| Target and ranking URL | Evidence column. `SimpleTable` of URL changes | Cannibalization evidence when flagged, labeled as a hypothesis |
| Competitor ranks | Evidence column. `SimpleTable` (top 20 in "View all") | Role badges neutral |
| SERP features | Right rail. Feature heatmap (`Heatmap`, 1 row per feature, 1 cell per check) with presence counts | Owned cells in `primary` fill, present in `chart-reference`, absent empty |
| AI Overview history | Evidence column. `DataTable` capped at 10 | "View AIO" opens the AI Overview content in the inspector with the evidence viewer |
| Related prompts | Right rail (the AI answers panel). `SimpleTable` (32 px rows) with `k of n` per engine | "Activate" on suggested links (`prompts:write`) |
| GSC | Evidence column. `ChartFrame` 180 px, own axis, labeled "Google-reported" | Low-data rule applies |
| Events | Right rail, last panel. `EventTimeline` (latest 50) with the feed rows of [23-application-patterns.md](23-application-patterns.md) section 9.3 | "Show older events" loads 50 more ([18-notifications-alerts.md](18-notifications-alerts.md) section 7) |

### 9.5 Prompt Explorer (T2)

Route `/ai/prompts` (tab Explorer). Shown with the prompt inspector open. Its default width is 440 px; at 1440 with the sidebar expanded it docks at its full width (the main column keeps 792 px: 1440 minus 208 minus 440, above the 720 px minimum), per the docking rule in [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.6. The drawing is schematic.

```text
| Prompts [View: Default v]   [Import] [...] [Add] | "What is the best CRM for a     [^][v][...][⤢][x] |
| Updated Sep 28, 02:10 · 250 core prompts         | 20-person startup?"                               |
| Explorer   Panels   Versions                     | CRM > Startups · Recommendation · Core · v3       |
| [28 days v][vs prev v][Engines 3][Panel: Core x] | Prompt · Updated Sep 28, 02:10        [Run now]   |
| [Branded: Excluded x] [+ Filter]                 |                                                   |
+--------------------------------------------------+---------------------------------------------------+
| Mention  Citation  Recommend.  SOV   Prompts     | Latest  History  Citations  Comp.  Stats          |
| 34%      21%       18%         27%   250         | ChatGPT      Gemini       AI Mode     Citation    |
+--------------------------------------------------+---------------------------------------------------+
| [Search /] 250  [Engine cols: Mention v] [Cols]  | 67%          75%          50%         38%         |
+--------------------------------------------------+---------------------------------------------------+
| Prompt          Topic   CGPT Gem  Mode Ment. Cit.| 8 of 12 obs  3 of 4 obs   2 of 4 obs  avg of 3    |
+--------------------------------------------------+---------------------------------------------------+
| best CRM for a. CRM     67%  75%  50%  64%   38% | ChatGPT · Sep 28, 01:14 · rep 3 · Valid           |
| which CRM is e. CRM     42%  3obs n/a  42%   25% | 1. {Northwind} is a solid pick for small          |
| CRM with best . Pricing 17%  25%  0%   14%   8%  | teams because it ... [1]                          |
| alternatives t. Compar. 58%  50%  75%  61%   44% | 2. {HubSpot} offers a free tier... [2]            |
| ...                                              | Mentioned Yes · Cited Yes · Rank 1 of 3           |
|                                                  | [Open evidence]                                   |
|                                                  | Gemini · Sep 27 · rep 1 · Valid ...               |
```

The drawing narrows the table to fit; at 1440 all columns below except Top competitor and Updated (priority 4) are visible.

**Columns.**

| # | Column | Type | Default / min width | Priority | Notes |
|---|---|---|---|---|---|
| 0 | (select) | `select` | 40 / 40 | always | |
| 1 | Prompt | `prompt` | 360 / 240, flex | 1 (pinned) | One line; `PromptTypeBadge` hidden in Compact density; lock icon for locked core panel |
| 2 | Topic | `badge` | 140 / 88 | 3 | Deepest term; path in tooltip |
| 3 | ChatGPT | `engineGroup` | 72 | 2 | Value of the engine-column metric (default Mention rate A1) |
| 4 | Gemini | `engineGroup` | 72 | 2 | Same |
| 5 | AI Mode | `engineGroup` | 72 | 2 | Same |
| 6 | Mention rate | `rate` | 112 / 72 | 1 | Equal-weight average of the engines in scope; header "Mention rate (avg of 3)" with tooltip naming the engines. When one engine is in scope this column shows that engine and the engine group collapses |
| 7 | Citation rate | `rate` | 112 / 72 | 2 | Same rule (A2) |
| 8 | Top competitor | `competitor` | 140 / 120 | 4 | Entity with the highest mention rate on this prompt, with its rate |
| 9 | Trend | `sparkline` | 96 / 88 | 3 | Weekly mention rate (equal-weight); gaps where insufficient |
| 10 | Updated | `date` | 104 / 104 | 4 | Last valid observation; stale badge |
| 11 | (actions) | `actions` | 40 / 40 | always | Run now, Edit, Open page |

Priorities follow [19-responsive-behavior.md](19-responsive-behavior.md) section 6.3: 1280 shows Prompt, the three engine columns, Mention rate and Citation rate; 1440 adds Topic and Trend; 1680 adds Top competitor and Updated. Default widths of all columns total 1,360 px, so all fit at 1680 (1,424 px table region). Docking the inspector never changes the set; the table scrolls horizontally with Prompt pinned. Column chooser extras: Recommendation rate, SOV, Change (per engine, colored only when detectable), Volatility, Linked keywords (count and primary keyword rank), Versions, Panel.

The toolbar "Engine columns" `MetricSwitcher` sets which metric the engine group shows (Mention, Citation, Recommendation, SOV) and writes `metric=`.

**Inspector** (440 px): header with prompt text in quotes, meta (topic path, type, panel, version); strip (sm) with one item per engine plus the equal-weight citation rate; tabs Latest, History, Citations, Competitors, Stats ([23-application-patterns.md](23-application-patterns.md) section 4.2). "Stats" shows per engine: estimate, `ConfidenceIndicator`, `SampleCount`, aggregation, and the link to the full statistics panel.

| Region | Component | Notes |
|---|---|---|
| Header | `PageHeader`, tabs Explorer, Panels, Versions | Primary "Add prompts" |
| Filter bar | Compare and Engine scopes; `Panel: Core` and `Branded: Excluded` default chips. The date range and location are in the top bar (location filters prompts by market, [13-filters-search.md](13-filters-search.md) section 4) | Device hidden on AI screens |
| Strip | `MetricStrip` `md` for the filtered scope: Mention, Citation, Recommendation, SOV (per selected engine; with 3 engines the strip shows per-engine mention items instead) | Never a silently pooled value |
| Table | `DataTable`, engine column group header "ChatGPT · Gemini · AI Mode" | Default sort Mention rate descending |
| Inspector | 440 px prompt inspector | `j`/`k` stepping |

### 9.6 Prompt Detail (T3)

Route `/ai/prompts/[promptId]`.

```text
| "What is the best CRM for a 20-person startup?"                [Edit] [Statistics] [...] [Run now]   |
| v3 · Core since Jun 1, 2026 · CRM > Startups · Commercial · Recommendation · Not branded             |
| Overview   Answers   Citations   Competitors   Fan-out   History                                     |
| [vs previous period v] [Engines: 3 v]                                                                |
+------------------------------------------------------------------------------------------------------+
| ChatGPT mention|Gemini mention  |AI Mode mention |Citation (avg 3)|Recommend. CGPT |Structured top 3 |
| 67%            |75%             |50%             |38%             |50%             |4 of 9 lists     |
| 8 of 12 obs    |3 of 4 obs      |2 of 4 obs      |equal-weight    |6 of 12 obs     |ChatGPT          |
+----------------+----------------+----------------+----------------+----------------+-----------------+
| Engine     Mention        Citation     Recommend.     Top-3 list   Outcome mix (A4)                  |
| ChatGPT    8 of 12  67%   5 of 12      6 of 12        4 of 9       [####====..::]  4 outcomes        |
|            52% to 79%     29% to 56%   classified 11 of 12                                           |
| Gemini     3 of 4   75%   1 of 4       Insufficient   n/a          [##==..]                          |
| AI Mode    2 of 4   50%   2 of 4       n/a            n/a          [##..::]                          |
+------------------------------------------------------------------------------------------------------+
| ChatGPT mention, 12 weeks       | Gemini mention, 12 weeks        | AI Mode mention, 12 weeks        |
| ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  | ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  | ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~   |
| CI band · v3 boundary Sep 14    | hollow points: insufficient     | model change Sep 2               |
+---------------------------------+---------------------------------+----------------------------------+
| Recommendation and sentiment (when mentioned)    | Related keywords                                  |
| Recommended given mentioned  6 of 8 (A6)         | Keyword              Rank  AIO        Vol         |
| Sentiment: positive 5 · neutral 2 · negative 0 · | best crm for startups   3  Cited #2  12,400       |
| mixed 1 (A13, four shares, no score)             | crm for small teams     9  Not cited  4,400       |
```

**Tabs** (6, the maximum):

| Tab | Content | Why a tab |
|---|---|---|
| Overview | Strip, per-engine rate table with intervals and outcome mix, per-engine trend small multiples (140 px each) with CI bands and boundaries, recommendation and sentiment, related keywords | Default |
| Answers | Observations table (engine, date, replicate, status, facts) with the evidence viewer in a split layout; compare two (`AnswerCompare`) | Own controls: selection, compare, view mode |
| Citations | Top domains and pages per engine with new and lost markers and `min_support` | Own `min_support` control and engine split |
| Competitors | Mention, recommendation and SOV per entity per engine; A14 gap with paired interval | Entity comparison table with metric switcher |
| Fan-out | Queries by frequency, matched keywords with rank, "Add to keyword inbox" (engines with fan-out only; tab hidden otherwise) | Different question and data source |
| History | Version diffs, panel membership, model and extractor changes (`EventTimeline`); volatility metrics (flip rate, citation Jaccard, within-run disagreement), descriptive only | Audit trail read rarely |

Layout on the T3 grid (section 5), Overview tab: the rate table and the per-engine small multiples take the evidence column; recommendation and sentiment and related keywords stack in the right rail. Other tabs use the full width.

[20-frontend-specification.md](../20-frontend-specification.md) section 5.6 lists eight tabs; Recommendation moves into Overview and Volatility into History to respect the 6-tab limit ([11-navigation.md](11-navigation.md) section 6).

| Region | Component | Notes |
|---|---|---|
| Header | `DetailPageHeader` | Primary "Run now" (`runs:trigger`); "Edit" opens the prompt editor dialog with lint and the version warning; "Statistics" opens `StatisticsPanel` |
| Strip | `MetricStrip` `md` | Small samples show counts first ("8 of 12 obs") |
| Rate table | `SimpleTable` with `ConfidenceIndicator` text under each rate | 100% stacked outcome bar per engine, never collapsed |
| Trends | Small multiples, shared axes, `echarts.connect` crosshair | Version and model boundaries drawn |

### 9.7 Citation Intelligence (T2)

Route `/ai/citations` with tabs Domains, Pages, New and lost.

```text
| Citations  [View: Default v]                                                    [Export] [...]       |
| Updated Sep 28, 02:10 · 18,420 citation units in 4,812 observations                                  |
| Domains   Pages   New and lost                                                                       |
| [Engines: 3 v] [Role: Third party x] [Topic: CRM x] [+ Filter]                                       |
+------------------------------------------------------------------------------------------------------+
| Citation units |Distinct domains|Effective srcs  |Own cit. share  |New sources     |Lost sources     |
| 18,420         |1,204           |86.3            |9.1% +0.8 pts   |37              |12               |
| 4,812 obs      |registrable     |inverse HHI (C3)|1,676 units     |min support 2   |after 2 windows  |
+----------------+----------------+----------------+----------------+----------------+-----------------+
| [Search domains /]  1,204 domains       [min support: 2 v] [Density v] [Columns] [Export]            |
+------------------------------------------------------------------------------------------------------+
| Domain             Role        Category    Units  Share   Δ share   CGPT  Gem Mode  Cited with Trend |
+------------------------------------------------------------------------------------------------------+
| > g2.com           Third party Review site 1,912  10.4%  +1.1 pts    12%   9%  10%  HubSpot    /\_/  |
| > northwind.com    Own         Vendor site 1,676   9.1%  +0.8 pts    11%   6%  12%  Northwind  _/-   |
|     /pricing                                 612   3.3%               4%   2%   5%                   |
|     /blog/best-crm                           388   2.1%               3%   1%   2%                   |
| > hubspot.com      Competitor  Vendor site 1,402   7.6%  −0.4 pts     9%   7%   6%  HubSpot    -\_   |
| > capterra.com     Third party Review site   988   5.4%  +0.2 pts     6%   5%   5%  Pipedrive  ___   |
|   ...                                                                                                |
```

**Domain columns.** Domain (`domain`, 220, pinned, favicon per `DomainCell`), Role (`badge`: Own, Competitor, Third party, neutral), Category (`badge`), Citation units (`count`, C2), Source share (`rate`, C1), Δ share (`rateDelta`), Observations and Prompts (`count`, chooser), ChatGPT, Gemini, AI Mode share (`engineGroup`), Cited with (`competitor`: entity most often mentioned in answers citing the domain; this is the competitor overlap signal at row level), New or Lost (`badge`, outline, when applicable), Trend (`sparkline`).

**Drill-down.** Domain rows expand to their cited pages (one level, [12-tables.md](12-tables.md) section 16), top 10 pages with "View all 48 pages" opening the Pages tab filtered to the domain (`domain=`). Clicking a domain row opens the domain inspector; clicking a page row opens the source (cited URL) inspector.

**Owned vs third-party.** `Role` scope chip (Own, Competitor, Third party) with counts; the strip's "Own citation share" is always shown regardless of the role filter, because it answers the main question of the screen.

**Competitor overlap.** At row level through "Cited with"; at domain level in the inspector (entities co-mentioned when cited); at entity level through C7 on the Competitors screen.

**Engine breakdown.** Engine group columns follow the Engine scope; with one engine selected, the group collapses and Share is that engine's value.

| Tab | Content |
|---|---|
| Domains | As drawn |
| Pages | URL grain: page (`url` with host), escaped title, domain role, units, share, engines, first seen, last seen; "Retrieved, not cited (ChatGPT)" as a scope chip (C8) with own pages marked |
| New and lost | C5 and C6 lists with `min_support` control and the rule in `MetricInfo` ("Lost after 0 units in 2 following windows") |

Categories and publisher opportunities live under AI Visibility > Sources ([11-navigation.md](11-navigation.md) section 1).

### 9.8 Competitor Intelligence (T2 variant)

Route `/competitors`, tabs Comparison, SEO, AI, Candidates. Comparison tab:

```text
| Competitors  [View: Default v]                                            [...] [Add competitor]     |
| SEO updated 2h ago · AI updated Sep 28, 02:10 · 5 tracked competitors                                |
| Comparison   SEO   AI   Candidates 6                                                                 |
| [vs previous period v] [Engine: ChatGPT v] [+ Filter]                                                |
+------------------------------------------------------------------------------------------------------+
| Channel summary                                                                                      |
| Metric                        Northwind  HubSpot    Pipedrive  Zoho       Freshsales Salesforce      |
| SEO share of voice (top 20)   18.2%      24.0%      9.6%       6.1%       3.2%       11.8%           |
| SEO visibility (vol-weighted) 31.4%      40.1%      14.8%      9.9%       5.1%       22.0%           |
| Average rank                  9.1 (612)  6.2 (540)  12.4 (301) 15.0 (188) 17.7 (92)  8.8 (402)       |
| AI share of voice, ChatGPT    27%        33%        12%        8%         4%         16%             |
| Mention rate, ChatGPT         34%        41%        16%        11%        5%         22%             |
| Recommendation rate, ChatGPT  18%        22%        9%         6%         n/a        10%             |
| Citation share, ChatGPT       9.1%       11.0%      3.2%       1.9%       0.8%       4.4%            |
+------------------------------------------------------------------------------------------------------+
| By topic   Metric [AI mention rate v]                                          Engine: ChatGPT       |
| Topic                         Northwind  HubSpot    Pipedrive  Zoho         Freshsales Gap vs leader |
| CRM for startups              47.2%      58.1%      22.4%      18.0%        9.3%       −10.9 pts     |
| CRM pricing                   31.0%      29.5%      12.2%      Insufficient n/a        0 pts         |
| Sales pipeline                22.8%      41.6%      44.0%      12.5%        6.1%       −21.2 pts     |
+------------------------------------------------------------------------------------------------------+
| HubSpot ahead in both channels: 37 keywords [v]  | Source overlap with HubSpot: Jaccard 0.42         |
| Keyword              Ours  Theirs  AI SOV gap    | Domain        Units with them  With us            |
| hubspot alternatives   14       1     −18 pts    | g2.com                   611      402             |
| best crm for startups   3       1      −6 pts    | capterra.com             388      201             |
```

| Region | Component | Notes |
|---|---|---|
| Header | `PageHeader`, tabs, `SavedViewMenu` | Primary "Add competitor" opens the entity editor; adding states the SOV boundary effect |
| Channel summary | `DataTable` (entity columns, metric rows), own brand first with `chart-1` swatch | SEO and AI rows separated by a group header row; AI rows follow the Engine scope (one engine at a time) |
| By topic | Entity comparison table ([23-application-patterns.md](23-application-patterns.md) section 6.1) with `MetricSwitcher`: AI mention, AI citation, AI recommendation, SEO visibility, Average rank, Share of voice (SEO or AI per the metric group) | Highest value per row in weight 500; gap column colored only when detectable |
| Ahead in both | `DataTable` capped at 10 for the competitor chosen in the panel title menu | Links to Matrix preset view |
| Source overlap | `SimpleTable` (C7) | Top 10 shared domains |

The SEO and AI tabs hold the single-channel detail (keyword gap counts and lists; per-engine SOV trends). Candidates is a T6 list of untracked brands and domains with "Track".

### 9.9 SEO and AI Matrix (T2 with chart region)

Route `/matrix`, tabs Keywords, Clusters, Pages.

```text
| Matrix  [View: Default v]                                          [Edit thresholds] [...] [Export]  |
| SEO updated 2h ago · AI updated Sep 28, 02:10 · 1,000 keywords, 986 checked                          |
| Keywords   Clusters   Pages                                                                          |
| [Desktop v] [AI metric: Mention rate v] [+ Filter]                                                   |
| Definition: AI presence = equal-weight mean of own mention rate on ChatGPT, Gemini, AI Overview.     |
| SEO strong: rank 10 or better; weak: worse than 20 or not in top 20.                                 |
| AI strong: 50% or more; weak: 10% or less.                                                           |
+------------------------------------------------------------------------------------------------------+
| AI strong, SEO weak     | Strong in both          | Scatter: x organic rank (better →), y AI presence|
| 9 kw · 7.1K vol         | 41 kw · 58.2K vol       | 100% :  .     :   .      o   O  o    .   o       |
+-------------------------+-------------------------+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~   |
| Weak in both            | SEO strong, AI weak     |  50% :- - - - - - - - - - - - - - - - - - - -    |
| 212 kw · 71.0K vol      | 84 kw · 96.4K vol       |      :  o  .   O   .  :  o  .  O   o   .         |
+-------------------------+-------------------------+  10% :- - - - - - - - - - - - - - - - - - - -    |
| Near threshold 133      | Insufficient AI 57      |   NR : oOo . o  .  O  .   o  .   o   O           |
| Not tracked in loc. 12  | Quadrant filter: none   | x: NR 100 50 20 10 3 1 (NR = not ranking)        |
+-------------------------+-------------------------+--------------------------------------------------+
| [Search /]  1,000 keywords                                         [Density v] [Columns] [Export]    |
+------------------------------------------------------------------------------------------------------+
|                             SEO                       AI              Context                        |
| Keyword               Vol  Rank     Δ  AIO          CGPT   Gem  Mode  Owned page Leader SEO Condition|
+------------------------------------------------------------------------------------------------------+
| best crm for st..  12,400     3    ↑5  Cited #2      47%   12%   n/a  /pricing   HubSpot 1  n/a      |
| crm software fo..  33,100     7    ↓1  Not cited      0%    0%    0%  n/a        HubSpot 2  Top 10,..|
| crm pricing           880   >20  Lost  Not cited     31% 3 obs   22%  /pricing   Zoho 4     Cited, ..|
```

| Region | Component | Notes |
|---|---|---|
| Header | `PageHeader` with tabs; the definition line is part of the header meta area and always visible (also in exports and screenshots) | "Edit thresholds" opens a popover with the four thresholds and engines; changes write the URL |
| Quadrant summary | `QuadrantSummary` (2 x 2 `MetricCard`, the one justified card grid) plus unclassified counts | Clicking a quadrant filters scatter and table (`quad=` as a filter chip "Quadrant: SEO strong, AI weak") |
| Scatter | `ChartFrame` 480 px (min 400), [15-data-visualization.md](15-data-visualization.md) section 8 | Box select into the table; hollow points for insufficient |
| Table | `DataTable` of `SEOAIComparisonRow` with column group headers (SEO, AI, Context) | `OpportunityStatus` in "Condition"; row opens keyword inspector |

Layout: quadrant summary and scatter share one row (`grid-cols-[minmax(0,1fr)_minmax(0,1fr)]` at 1440; stacked below 1280 px). Below 1024 px the scatter is replaced by the summary and table ([15-data-visualization.md](15-data-visualization.md) section 8). The chart region scrolls away; the table header then sticks under the page header (the matrix page scrolls as a document until the table, whose body then scrolls).

### 9.10 Page Intelligence (T3)

List: `/seo/pages` (Landing pages tab, T2): columns Page (`url`, host hidden), Keywords ranking (`count`), Average rank (`rank`, with `n`), Top 10 (`count`), Volume represented (`volume`, Estimate), AIO citations (`count`), ChatGPT, Gemini, AI Mode citation units (`engineGroup`), Retrieved not cited (`count`, ChatGPT), GSC clicks (`count`, labeled), Trend. Detail: `/seo/pages/[urlId]`:

```text
| /pricing                                                   [Copy URL] [...] [Visit page ↗]           |
| Northwind CRM pricing and plans · northwind.com · Updated 2h ago                                     |
| [Last 12 weeks v] [vs previous period v]                                                             |
+------------------------------------------------------------------------------------------------------+
| SEO            |AI Overview     |ChatGPT         |Gemini          |AI Mode         |GSC clicks       |
| 14 keywords    |22 checks       |31 units        |9 units         |12 units        |4,120            |
| avg rank 5.8   |cited, 12 kw    |18 prompts      |7 prompts       |9 prompts       |Google-reported  |
+----------------+----------------+----------------+----------------+----------------+-----------------+
| SEO: keywords in top 10 | AIO citations           | AI citation units       | GSC clicks             |
| ~~~~~~~~~~~~~~~~~~~~~~~ | ~~~~~~~~~~~~~~~~~~~~~~  | ~~~~~~~~~~~~~~~~~~~~~~  | ~~~~~~~~~~~~~~~~~~~~~~ |
| Small multiples: shared time axis, own y axis per channel, 140 px each                               |
+------------------------------------------------------------------------------------------------------+
| Keywords ranking with this URL       View all 14 | Prompts citing this URL               View all 18 |
| Keyword                 Rank  Δ    Volume  AIO   | Prompt                    Engines        Units    |
| crm pricing plans         2  ↑1   2,900  Cited #1| "how much does a CRM c.." ChatGPT, Mode      6    |
| crm software for sm..     7  ↓1  33,100 Not cited| "cheapest CRM for sma.."  ChatGPT            4    |
+--------------------------------------------------+---------------------------------------------------+
| Associated mentions (same answer block)          | Retrieved, not cited (ChatGPT)                    |
| Northwind 41 · HubSpot 12 · Pipedrive 5          | 23 of 54 retrievals not cited                     |
| Association, not proof the page says this.       | Prompts: "best CRM under $50" ...                 |
```

| Region | Component | Notes |
|---|---|---|
| Header | `DetailPageHeader`; `h1` is the path; title (escaped) and host in the meta line | `ExternalLinkButton` "Visit page" (the live URL; "Open page" is reserved for the inspector action that opens a full page, [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.1) is the primary-position action but uses `secondary` (it leaves the product); no `primary` |
| Strip | `MetricStrip` `md`, one item per channel | Six channels fit one strip; `MetricCard` not needed |
| Trends | Small multiples (`grid-cols-[repeat(auto-fill,minmax(280px,1fr))]`), 140 px, one per channel, separate y axes | Never one chart with mixed units |
| Tables | Two capped `DataTable`s | Keyword rows open the keyword inspector; prompt rows the prompt inspector |
| Associated mentions | `SimpleTable` with the fixed caveat line | [15-seo-ai-correlation.md](../15-seo-ai-correlation.md) section 6 wording |
| First-party | GA4 AI referral sessions (two classifiers side by side) appear as a third row of panels when connected | Source chips on every first-party value |

Layout on the T3 grid (section 5): the small multiples and the two tables take the evidence column; associated mentions, retrieved not cited and first-party panels stack in the right rail.

### 9.11 Discover (T6)

Route `/discover/keywords`.

```text
| Discover  [View: Default v]                     [...]       | Keyword candidate       [^][v][...][x] |
| Updated Mon 06:00 · 24 new keyword candidates               | crm for nonprofits                     |
| Keywords 24   Prompts 12   Opportunities                    | Sources: Related searches, GSC         |
| [Source: any v] [+ Filter]                                  | Suggested because: related to 3 tracked|
+-------------------------------------------------------------+----------------------------------------+
| [New 24][Accepted][Snoozed][Rejected]  [Search /]  [Cols]   | Volume   KD    AI demand  GSC impr.    |
+-------------------------------------------------------------+----------------------------------------+
| [ ] Candidate            Sources      Vol    KD  Intent     | 2,900    22    Estimate   1,240        |
+-------------------------------------------------------------+ Estimate          low        28 days   |
| [ ] crm for nonprofits   Related, GSC 2,900  22  Commerc.   +----------------------------------------+
|     related to 3 tracked keywords · GSC 1,240 impr.         | Source detail                          |
| [ ] crm with email mark..  PAA        1,600  35  Commerc.   | Related searches for "best crm for     |
|     PAA on "best crm for startups" (4 of 7 checks)          | startups" (Sep 22, Sep 29)             |
| [ ] simple crm             Fan-out      880  18  Informa.   | GSC query: 1,240 impressions, pos 18.4 |
|     ChatGPT searched this in 6 of 12 answers                +----------------------------------------+
| [ ] ...                                                     | Opportunity score 0.62 (i)             |
|                                                             | Sorting aid, not a KPI                 |
|                                                             +----------------------------------------+
|                                                             | [Reject r]  [Snooze s]  [Accept a]     |
```

| Region | Component | Notes |
|---|---|---|
| Header | `PageHeader` with count tabs Keywords, Prompts, Opportunities | Prompts tab adds primary "Generate prompts" |
| Status | `SegmentedControl` in the toolbar, next to the result count | `status=new` default |
| Table | `DataTable`, Default density (40 px rows); second line is the evidence summary in `type-meta` | Keyword columns: Candidate, Sources (neutral chips, max 2 then "+1"), Volume (Estimate), KD, CPC (chooser), Intent, AI demand (Estimate, chooser), GSC impressions (28 days), Competitor best rank (chooser), Opportunity score (chooser, with factor popover), Data as of |
| Evidence panel | `Inspector` 400 px (no "Open page": candidates have no full page): strip with volume, KD, modeled AI demand (Estimate), GSC impressions; source detail per source; near duplicates; triage footer (the one inspector footer outside edit mode) with `Kbd` hints | Prompt candidates show "Generated phrasing, not an observed user prompt" or "Bing grounding phrase, not a user prompt" at the top; no volume column |
| Bulk bar | Accept, Snooze, Reject, Assign group, Tags, Topic, Intent, Priority, then "Promote to tracked" | Promote dialog: location, device (both creates two), depth profile, group, quota impact, daily cost estimate |

The Opportunities tab lists `OpportunityStatus` conditions (section 7.3 of [23-application-patterns.md](23-application-patterns.md)) and publisher opportunities with the same triage actions (Accept adds to a work list; it creates nothing tracked).

### 9.12 Integrations (T5)

Route `/integrations/gsc`.

```text
| Google Search Console                                                   [Sync now] [...]             |
| Connected · Last sync 38m ago · Property sc-domain:northwind.com                                     |
| Search Console   Bing   GA4   Cloudflare   Imports                                                   |
+------------------------------------------------------------------------------------------------------+
| Connection                                                                                           |
| Status  [Connected]   Account  analytics@northwind.com   Connected by  M. Keller   Since  Mar 4, 2026|
+------------------------------------------------------------------------------------------------------+
| Access                                           | Configuration                                     |
| Read search performance for the property         | Property      [sc-domain:northwind.com v]         |
| Read URL inspection results (not used in V1)     | Backfill      [16 months v]                       |
| Cannot modify properties, sitemaps or settings   | Query matching [x]   Match GSC queries to         |
| Scope strings in tooltip                         |               tracked keywords (exact)            |
|                                                  | Save bar appears when changed                     |
+--------------------------------------------------+---------------------------------------------------+
| Last sync      |Coverage        |Rows imported   |Provisional days|Unmatched       |Next sync        |
| 38m ago        |28 of 28 days   |1.24M           |2               |8,412           |Sep 30, 04:00    |
| completed      |window          |this month      |final after 3d  |[Add to inbox]  |daily            |
+----------------+----------------+----------------+----------------+----------------+-----------------+
| Sync history                                                                         View all        |
| Sep 29, 04:02  Completed  Sep 26 to Sep 28 · 41,220 rows · 2 provisional days                        |
| Sep 28, 04:01  Completed  Sep 25 to Sep 27 · 40,980 rows                                             |
| Sep 27, 04:03  Completed with errors  1 request failed (quota), retried Sep 27, 05:00                |
+------------------------------------------------------------------------------------------------------+
| Errors (last 30 days)                                                                                |
| Sep 27, 04:03  Quota exceeded  "User rate limit exceeded" (escaped)  1  Retried automatically        |
```

| Region | Component | Notes |
|---|---|---|
| Header | `PageHeader` with `TabNav` per source | No primary while connected and healthy; "Reconnect" becomes primary when re-auth is required; "Disconnect" is in More, below a separator |
| Connection | `ConnectionStatus` | Re-auth required: warning `Banner` "Sync paused since Sep 21: reconnect to resume" above this row |
| Access | `ScopeList` | Plain-language scopes; raw strings in tooltips |
| Configuration | Form fields with `SaveBar`; "Query matching" is a checkbox | Backfill change shows the time estimate |
| Sync status | `MetricStrip` `md` | Coverage never implies completeness beyond the window |
| History and errors | `EventTimeline` and `DataTable` | Error messages escaped |

Nothing on this page combines first-party data with synthetic observations; data views live under their own routes ([20-frontend-specification.md](../20-frontend-specification.md) section 5.15).

### 9.13 Settings (T4)

Route `/settings/engines` (project settings, Engines).

```text
| Project         | Engines                                                                            |
|  General        | Engines observed for this project's prompts. Changes apply from the next run.      |
|  Entities       +------------------------------------------------------------------------------------+
|  Domains        | Engine              Class         Enabled  Replicates  Locations                   |
|  Taxonomy       | ChatGPT             Consumer UI   [x]      [3 v]       United States               |
|  Engines        | Gemini              Consumer UI   [x]      [1 v]       United States               |
|  Schedules      | AI Mode             SERP AI       [x]      [1 v]       United States               |
|  Alert rules    | AI Overview         SERP AI       from SERP checks (Rankings schedule)             |
|  Retention      | Perplexity API      Official API  [ ]      Phase 14 benchmark                      |
| Workspace       +------------------------------------------------------------------------------------+
|  General        | [i] Estimated cost change: +$42.10 per month (Estimate, price book Sep 2026).      |
|  Members        |     Gemini replicates 1 → 3 adds 2 observations per prompt per week.               |
|  API keys       +------------------------------------------------------------------------------------+
|  Budgets        |                                                                                    |
|  Costs          |                                                                                    |
|  Operations     | 1 unsaved change                                 [Discard] [Save changes]          |
```

| Region | Component | Notes |
|---|---|---|
| Header | `PageHeader` title "Settings" (92 px to the first block, not drawn) | Breadcrumb in top bar names the section |
| Local nav | `SettingsNav` 200 px | Project and workspace groups ([11-navigation.md](11-navigation.md) section 5) |
| Form | `SimpleTable`-style editable rows with `Checkbox` (Enabled) and `Select`; booleans in a save-bar form are checkboxes, never switches ([10-forms.md](10-forms.md) section 13.2) | Class badges neutral outline |
| Consequence | Info `Banner` with the estimate delta | Appears as soon as a cost-affecting field changes |
| Save bar | `SaveBar`, sticky | Explicit save; the change affects cost |

### 9.14 Costs (T1 with tables)

Route `/costs` (workspace).

```text
| Costs                                                                         [Export CSV] [...]     |
| September 2026 · Workspace timezone Europe/Berlin; provider days in UTC · Updated 5m ago             |
| [Month: September 2026 v] [+ Filter]                                                                 |
+------------------------------------------------------------------------------------------------------+
| Month to date           | Projected month end (i) | Budget                  | Blocked runs           |
| $1,284.10               | $1,910.00  Estimate     | 64% of $2,000.00        | 1                      |
| Sep 1 to Sep 29         | actual plus planned     | [==========    :  ]     | AI prompts, Northwind  |
+-------------------------+-------------------------+-------------------------+------------------------+
| Spend by day, by workload           [Table] [...]            | By workload           Cost   Share    |
| ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  | SEO rank          $612.40   47.7%     |
| ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  | AI prompts        $498.20   38.8%     |
| stacked bars, workload order fixed, neutral legend           | Keyword research   $96.30    7.5%     |
| Actual cost from provider-reported events                    | Extraction LLM     $41.10    3.2%     |
|                                                              | Fixed infra        $36.10    2.8%     |
+--------------------------------------------------------------+---------------------------------------+
| [By provider] [By project] [Unit costs] [Budgets]                                 [Columns] [Export] |
+------------------------------------------------------------------------------------------------------+
| Provider     Endpoints  Requests   Units       Cost (USD)  Share   vs last month  Cost source        |
| DataForSEO   9          1,041,220  1,062,400   $1,196.80   93.2%   +12.4%         Provider reported  |
| OpenAI       1          18,400     22.1M tok   $41.10      3.2%    +3.0%          From tokens        |
| DigitalOcean 2          n/a        n/a         $36.10      2.8%    0%             Price book estimate|
+------------------------------------------------------------------------------------------------------+
| Reconciliation: provider spend vs recorded events, last run Sep 29, 00:45 UTC, difference 0.3%       |
```

| Region | Component | Notes |
|---|---|---|
| Header | `PageHeader`; meta states both timezones | Secondary "Export CSV"; no primary |
| Filter bar | Month scope; chips Provider, Workload, Project. The top-bar date range and location do not apply and are hidden | [13-filters-search.md](13-filters-search.md) section 4 |
| Summary | `CostSummary` with `BudgetMeter` | Projection labeled Estimate with method in `MetricInfo` |
| Spend chart | `ChartFrame` 240 px stacked bars by workload (categorical palette in fixed workload order, not semantic colors) plus a 360 px `SimpleTable` by workload | No area gradients, no donut |
| Breakdown | Panel with `Tabs` `variant="segmented"` (panels switch, [09-buttons-controls.md](09-buttons-controls.md) section 6): By provider, By project, Unit costs, Budgets; each a `DataTable` ([23-application-patterns.md](23-application-patterns.md) section 11.3) | Project rows show `BudgetMeter` (64 px) and `BudgetStatusBadge` |
| Reconciliation | One `type-meta` line with link to the reconciliation run | Difference above 2% shows the warning icon |

Budget editing happens in Settings > Budgets and usage (T4); the Budgets view here is read-only with an "Edit budgets" link for `budgets:manage`.

## 10. New components introduced

Components first named in this document. Components introduced in [23-application-patterns.md](23-application-patterns.md) section 16 are not repeated.

| Component | Purpose | Used in |
|---|---|---|
| `SettingsNav` | 200 px local navigation for project and workspace settings, sidebar item styling | T4 |
| `SaveBar` | Sticky form save bar with change count, Discard and Save changes, and optional estimate delta | T4, T5 |
| `ConnectionStatus` | Integration connection row: status badge, account, property, connected by, since | T5 |
| `ScopeList` | Plain-language list of an integration's access scopes, raw scope strings in tooltips | T5 |
| `TopBar` | 52 px top bar on `surface` with a bottom hairline: breadcrumb (`House` root, `ChevronRight` separators) with workspace and project menus, search field with `⌘K` hint, date range and location scope buttons, notifications, theme menu, help menu, 32 px avatar for the user menu | 9.1 |
| `Banner` | Inline notice (info, warning, negative) with icon, one or two sentences and up to 2 actions ([18-notifications-alerts.md](18-notifications-alerts.md) section 4); used for consequences, partial data, re-auth | T1, T4, T5 |

`Banner`, `TopBar` and `Toaster` may already be specified in [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md), [17-empty-loading-error-states.md](17-empty-loading-error-states.md) or [18-notifications-alerts.md](18-notifications-alerts.md); if so, those definitions win and this table only records the usage. The inspector header opens the full page with the expand icon button ("Open page", `Maximize2`, [23-application-patterns.md](23-application-patterns.md) section 4.1).
