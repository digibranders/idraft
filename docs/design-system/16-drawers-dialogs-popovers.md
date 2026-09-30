# 16. Inspector, Drawers, Dialogs, Popovers and Overlays

Status: Accepted (design-system v2)
Last updated: 2026-09-29
Implementation: `apps/web/src/components/ui/` (Base UI 1.8 primitives: Dialog, AlertDialog, Drawer, Popover, PreviewCard, Tooltip, Menu, ContextMenu, Autocomplete) and `apps/web/src/components/app/inspector/`
Related: [05-layout-grid.md](05-layout-grid.md) (widths and docking), [06-surfaces-borders-radius.md](06-surfaces-borders-radius.md) (surfaces, radius, shadows), [08-interaction-states.md](08-interaction-states.md) (focus rules), [12-tables.md](12-tables.md), [13-filters-search.md](13-filters-search.md), [17-empty-loading-error-states.md](17-empty-loading-error-states.md), [20-accessibility.md](20-accessibility.md), [21-motion.md](21-motion.md), [25-component-inventory.md](25-component-inventory.md)

This document decides which container a piece of content lives in, and specifies every container that sits above or beside the page: the right inspector, full-page detail, dialogs, popovers, menus, tooltips, preview cards, the statistics panel and the command palette.

## 1. Choosing a container

The product has four disclosure levels (scan, hover, inspect, study; [00-design-principles.md](00-design-principles.md) section 3). Each container below belongs to one level. Pick the first row whose "use when" is true.

| Container | Level | Use when | Never use for | Width |
|---|---|---|---|---|
| **Tooltip** | hover | At most three lines of text, or one mini table (up to 7 rows; chart series tooltips up to 8 rows, [15-data-visualization.md](15-data-visualization.md) section 10), that name or explain a single element: truncated values, icon labels, column definitions, absolute timestamps | Anything interactive, anything the user must read to complete a task | max 320 px |
| **PreviewCard** | hover | A read-only summary of a linked object, so the user can decide whether to open it (citation URL, competitor name, domain in a cell) | Actions, forms, the only path to information | 320 px |
| **Popover** | hover or click | Short, focused interaction anchored to a control: filter editing, quick settings, metric method definition, column chooser | Record detail, multi-step tasks, anything over 400 px tall | 280 to 360 px |
| **Menu** | click | A list of commands or single choices from a button or a row | Content, forms, navigation trees | 180 to 280 px |
| **Right inspector** | inspect | Detail of one record picked from a list, while the list stays visible and keeps its scroll, filters and selection | Creating objects, destructive confirmation, multi-record study | 360 to 640 px |
| **Statistics panel** (`StatisticsPanel`) | inspect | A deep explanation of one metric (estimate, uncertainty, movers, version boundaries); non-modal, in the inspector region ([23-application-patterns.md](23-application-patterns.md) section 8.6) | Record detail (use the inspector) | 560 px |
| **Dialog** | task | A bounded task with a clear end: create, add, edit settings of one object, import, confirm | Analytics, charts, tables of records, browsing | 400 / 560 / 720 px |
| **AlertDialog** | task | Confirming a destructive or irreversible action, discarding unsaved edits | Information that does not need a decision | 400 px |
| **Full page** | study | Deep objects with several charts, their own filterable tables, long editors, or work that takes minutes | Quick lookups from a list | content width |

### 1.1 Product decisions

| Object or task | Container | Notes |
|---|---|---|
| Keyword detail | Inspector 400 px from any list; full page `/seo/keywords/[tkId]` for study | Inspector tabs: Overview, SERP, AI, Timeline |
| Prompt detail | Inspector 440 px; full page `/ai/prompts/[promptId]` | Prompt text needs width; answers are long |
| Citation | Inspector 440 px only | Shows the answer context and the cited page; no full page |
| Answer (observation evidence) | Inspector 440 px | Evidence viewer with the entity side panel stacked below the answer ([20-frontend-specification.md](../20-frontend-specification.md) section 4.9) |
| Page (owned URL) | Inspector 400 px; full page `/seo/pages/[urlId]` (Page Intelligence) | |
| Competitor | Inspector 400 px | Study happens in Competitor Intelligence filtered to that entity; no separate page in V1 |
| Domain (registrable domain) | Inspector 400 px | "Open in Citations" link carries the domain filter |
| Source (cited URL, third-party or own) | Inspector 400 px | Content per [23-application-patterns.md](23-application-patterns.md) section 4.2; no full page |
| Run (Operations) | Inspector 400 px from the runs table; full page `ops/runs/[runId]` for the task table | |
| Discover candidate | Inspector 400 px | Evidence panel per [24-page-templates.md](24-page-templates.md) section 9.11; no full page |
| Create project | Full page (onboarding wizard) | Nine steps with engines, locations and cost estimate ([20-frontend-specification.md](../20-frontend-specification.md) section 5.1); too large for a dialog |
| Add competitor | Dialog 560 px | Name, domains, colour slot preview, SOV effect note |
| Add keywords (paste or type) | Dialog 560 px | |
| Import keywords | Multi-step dialog 720 px (section 4.6) | The route `rankings/import` renders Rank Tracker with this dialog open, so links from onboarding and email still work |
| Edit prompt text | Dialog 720 px | Creates a version; lint warnings, change kind and reason inline |
| Configure integration | Full page (Settings, Integrations) | Connect is a top-level navigation to OAuth; the post-return property picker is a 560 px dialog |
| Alert rule create and edit | Full page `/settings/alert-rules/[id]` (Settings > Alert rules, [11-navigation.md](11-navigation.md) section 1.1) | Preview count and scope builder need width |
| Delete keywords, remove competitor | AlertDialog 400 px | Section 4.5 |
| Delete project or workspace | AlertDialog 400 px with typed name and re-authentication | Section 4.5 |
| Filter editing | Popover 280 to 360 px | Content rules in [13-filters-search.md](13-filters-search.md) |
| Metric methodology | Tooltip on the column header (one-sentence definition); Popover from the (i) button (definition, formula reference, method version); `StatisticsPanel` for AI rates (section 8); Methodology help page for the full text | Four depths of the same topic, each on its own level |
| Row actions | Menu from the row More button and the row context menu | Section 5.4 |
| Hover summary of a cited URL or a competitor | PreviewCard | Section 6.3 |

Rule: an object has exactly one inspector type and at most one full page. A new object type gets its row in this table before it is built.

## 2. Right inspector

The inspector is the product's main detail pattern: every record in every table opens in it, and the list beside it stays usable.

### 2.1 Anatomy

The inspector is a floating card under the top bar: rounded, bordered, with a soft shadow, 12 px from the top bar and from the right and bottom edges of the window. Its body is a column of cards on the page background ([ADR-DS-019](adr/ADR-DS-019-card-drawer-inspector.md)).

```
| Top bar (always full width; the inspector never narrows it)                                              |
+-----------------------------------------------------+----------------------------------------------------+
| Rankings table (main column, >= 720 px)             |  12 px                                             |
|                                                     |  +----------------------------------------------+  |
| [] best crm for startups   4   6   ^2  ...          |  | best crm for startups  [Check now] [⋮] [x]   |  |
| [>] crm pricing  (active row, 2 px edge)            |  | (2 lines max)                                |  |
| [] crm for startup  12  new ...                     |  | [US · Desktop] [Depth 20] [Cited #1]         |  |
|                                                     |  | Keyword · 12 of 986 · Updated 12m ago  [^][v]|  |
|                                                     |  | Overview   SERP   AI   Timeline              |  |
|                                                     |  +==============================================+  |
|                                                     |  | +-----------+ +-----------+ +-----------+    |  |
|                                                     |  | | Rank      | | Avg rank  | | Volume    |    |  |
|                                                     |  | | 4         | | 5.3       | | 8,100     |    |  |
|                                                     |  | | ↑2 best 2 | | 30 days   | | per month |    |  |
|                                                     |  | +-----------+ +-----------+ +-----------+    |  |
|                                                     |  | +------------------------------------------+ |  |
|                                                     |  | | (i) Rank history          [30 days v]    | |  |
|                                                     |  | | (chart, 180 px)                          | |  |
|                                                     |  | | o you   o hubspot.com   o pipedrive.com  | |  |
|                                                     |  | +------------------------------------------+ |  |
|                                                     |  | +------------------------------------------+ |  |
|                                                     |  | | (i) AI mentions by engine                | |  |
|                                                     |  | | ChatGPT   ######----   67%   8 of 12     | |  |
|                                                     |  | +------------------------------------------+ |  |
|                                                     |  | +------------------------------------------+ |  |
|                                                     |  | | (i) Competing domains       [View all]   | |  |
|                                                     |  | | Domain            Rank   Change          | |  |
|                                                     |  | +------------------------------------------+ |  |
|                                                     |  +----------------------------------------------+  |
+-----------------------------------------------------+----------------------------------------------------+
```

The double line is the bottom edge of the tab row. `(i)` stands for the 16 px section icon.

| Part | Specification |
|---|---|
| Container | `<aside aria-labelledby="inspector-title">`: `background` fill (the page background, so the `surface` cards inside read as cards), 1 px `border`, radius 10 px (`rounded-xl`), `shadow-inspector`, `overflow-hidden`. It sits under the top bar, 12 px from it and 12 px from the right and bottom window edges, in both docked and overlay mode. The top bar always spans the full width: the inspector is a sibling of the page content below the top bar, never of the top bar. Below 768 px it is a full-screen sheet with no radius, border or margin (section 2.6) |
| Header | Fixed at the top of the card (the body scrolls under it), padding 16 px top and sides; the tab row is its last row and its 1 px `border` bottom line is the header's lower edge |
| Header row 1 | Title left: `h2`, `type-inspector-title` (18 / 26 px, weight 600), `foreground`, clamped to 2 lines with `text-wrap: balance`; the full text is the first line of the first card when clamped (prompts, long URLs). URLs use middle truncation per [22-content-formatting.md](22-content-formatting.md). At the top right, 4 px apart: the object's most frequent command as a 32 px `secondary` `sm` button with a leading icon when it has one (keyword: "Check now" with `RefreshCw`; prompt: "Run now"), then More actions (`EllipsisVertical`, 32 px ghost `IconButton`), then Close (`X`, tooltip "Close (Esc)"). "Open page" and the width options are in the More menu |
| Row 2: status badges | One row 8 px below the title, 22 px badges, gap 6 px, at most 4: scope (location and device, engine), depth, stale, estimate, version boundary. Badge rules in [14-badges-status.md](14-badges-status.md). A fifth concern moves into the first card |
| Row 3: context line | Object type label ("Keyword", "Prompt", "Citation"), position counter "12 of 986" (`num`) and `FreshnessIndicator` ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 7), all in `type-meta`, separated by " · ". Right-aligned: Previous (`ChevronUp`, tooltip "Previous keyword (K)") and Next (`ChevronDown`, "Next keyword (J)") as 32 px ghost icon buttons, beside the counter they change |
| Tabs | 44 px underline tabs (section 2.3), last row of the header |
| Body | Cards (section 2.4), 16 px padding, 12 px between cards, own scroll container |
| Footer | Edit mode only (section 2.5). The one exception is the triage footer of the Discover `candidate` inspector (Reject, Snooze, Accept; [23-application-patterns.md](23-application-patterns.md) section 4.1) |

Header actions never exceed five: the command button, More and Close in row 1, Previous and Next in row 3. Other object-specific commands (Archive, Copy ID, Open page) live in the More menu.

### 2.2 Widths and resizing

| Inspector type | Default width |
|---|---|
| Keyword, page, competitor, domain, source, run, candidate | 400 px (`--size-inspector`) |
| Prompt, citation, answer evidence | 440 px (`--size-inspector-wide`, section 10) |
| Minimum, maximum (all types) | 360 px (`--size-inspector-min`), 640 px (`--size-inspector-max`) |

Resizing:
- A vertical separator on the inspector's left edge: 1 px visible line (`border`), 8 px hit area centered on it, `cursor: col-resize`. Hover and drag show a 2 px `border-strong` line; keyboard focus shows the `ring`.
- Semantics: `role="separator"`, `aria-orientation="vertical"`, `aria-label="Resize inspector"`, `aria-valuenow` (current width in px), `aria-valuemin="360"`, `aria-valuemax` (the effective maximum, section 2.6), `aria-controls` pointing at the inspector, `tabindex="0"`.
- Keyboard: Left arrow widens by 16 px, Right arrow narrows by 16 px, Shift plus arrow changes by 64 px, Home sets the minimum, End sets the effective maximum, Enter resets to the type's default. Double-click on the handle resets to default. The More menu also contains "Width: Default, Wide, Maximum" (Default is the type's default width, Wide is 440 px `--size-inspector-wide`, Maximum is the effective maximum of section 2.6) and "Reset width" (same as Default) for pointer users who do not find the handle.
- Width snaps to multiples of 8 px while dragging. The table reflows on pointer up, not on every pointer move (one reflow per drag keeps 10,000-row tables responsive).
- Width persists per user per inspector type in `localStorage` (a per-viewer convenience; losing it is harmless). Reads are wrapped in try/catch and fall back to the default.

### 2.3 Tabs: 44 px underline

Decision (v2, reverses v1): inspector tabs are the 44 px underline tabs of [09-buttons-controls.md](09-buttons-controls.md) section 12, the same form as page tabs: 14 px labels 24 px apart, the active label in `primary-text` at weight 500 with a 2 px `primary` underline, and a 1 px `border` line along the bottom of the row. v1 used a 28 px segmented control.

Reasons: the reference screens use underline tabs in the inspector; one tab form for switching record sections leaves the segmented control to view options and chart modes inside panels ([09-buttons-controls.md](09-buttons-controls.md) sections 6 and 12), so its accent-tinted selected state never sits in the inspector header next to the tab row; and the inspector header is still recognizable as a separate level because it sits in its own column under the inspector title.

Rules:
- At most 5 tabs. Labels are one word where possible (keyword inspector: "Overview", "SERP", "AI", "Timeline"). An object that needs a sixth tab needs a full page instead.
- Tabs hug their labels and start at the left content edge; labels never truncate. At the 400 px default the row is 360 px wide (20 px padding on each side), which fits the four keyword labels; at the 440 px wide default the row is 400 px, which fits the five prompt labels. When a narrower width cannot fit every label, the tabs that do not fit move into a trailing "More tabs" menu button outside the tablist (`Tabs` `overflow="menu"`, [25-component-inventory.md](25-component-inventory.md) section 3.38).
- Semantics: Base UI Tabs (`role="tablist"`), arrow keys move between tabs with automatic activation ([20-accessibility.md](20-accessibility.md) section 5), the panel is `role="tabpanel"` labelled by its tab. Panels render their skeleton immediately, so arrow keys never wait on a fetch.
- The first tab is always "Overview" and is the default. Tab state lives in the URL (section 2.7).

### 2.4 Sections

Every section of the inspector body is a card. This is the one place where bordered panels sit inside a container; [06-surfaces-borders-radius.md](06-surfaces-borders-radius.md) section 1 lists it as the exception.

- **Card:** `surface` fill, 1 px `border`, radius 8 px (`rounded-lg`), no shadow. Cards are 12 px apart. A card is never nested inside another card.
- **Card header:** 48 px row with 16 px horizontal padding: a 16 px icon in `foreground-tertiary` that names the kind of content (`ChartLine` for a trend, `Sparkles` for AI, `ListOrdered` for ranked lists, `Search` for results, `History` for events), the title as `h3` in `type-subsection-title`, and at most one right-aligned control: a 32 px `secondary` `sm` button ("View all"), a 32 px `Select` (chart window or metric), or a status badge.
- **Metric cards:** the first row of the Overview tab is 3 equal cards, 12 px apart (items per type in [23-application-patterns.md](23-application-patterns.md) section 4.2). Each has 12 px padding and shows the label (`type-label`), the value (`type-metric-sm`, 18 / 24 px), then one line in `type-meta`: a delta through the formatters, a context such as "30 days" or "per month", or both. Nothing else goes in a metric card. A fourth value goes into the note line of the card it qualifies ("best 2" under Rank), not into a fourth card.
- **Chart card:** the chart is 180 px tall with 16 px side padding and follows [15-data-visualization.md](15-data-visualization.md). The legend sits under the plot as a wrapping row of 8 px dots and names in `type-label`. A window or metric `Select` in the card header changes what the chart shows. At most 3 series; small multiples, dual comparisons and chart tables with more than 10 rows belong on the full page.
- **Bar list card:** one 36 px row per item: a 16 px `EngineLogo` when the items are engines ([07-icons.md](07-icons.md) section 5) and the name (112 px together, `type-body`), an 8 px pill bar on a `neutral-subtle` track with a `primary` fill, the percent (`type-table num`), and the counts behind it ("8 of 12", `type-meta num`), so no rate appears without its denominator. An item with no data shows "n/a" and an empty track. A one-line `type-meta` sentence under the title says what the share is of.
- **Table card:** mini tables ([12-tables.md](12-tables.md) section 15) run edge to edge inside the card: a header row on `surface-subtle` with 12 px labels (`type-label`), 32 px rows (`h-row-compact`) with `border-subtle` dividers, 16 px padding on the first and last cells, and the own row in `surface-selected` with its text in `primary-text`. At most 4 columns, not sortable, never virtualized. A table that needs sorting or filtering links to the list or full page that has it.
- Lists inside a card show at most 10 rows, then "View all", which switches to the tab that holds the full list or opens the full page.
- Cards are not collapsible. The built-in order is fixed per inspector type so users learn where things are. A person can hide, reorder and add the cards of the Overview tab through "Customize cards" in the More menu ([23-application-patterns.md](23-application-patterns.md) section 18); the layout is per record type, so every keyword opens with the same cards. While customizing, the inspector shows a footer with "Reset", "Cancel" and "Save layout". The header, badges, tabs and the other tabs are not customizable.

### 2.5 Editing inside the inspector

Allowed edits are small attribute changes of the inspected record: target URL, tags, group, priority, intent override, notes. Anything that creates a version, changes a measurement instrument, or has side effects on other records uses a dialog (prompt text, aliases, panel membership in a locked core panel).

- "Edit" in a section header switches that section into a form. Only one section is in edit mode at a time.
- While editing, a sticky footer appears: `surface` background, 1 px `border-subtle` top border, 12 px vertical and 20 px horizontal padding, 36 px (`md`) buttons right-aligned: "Cancel" (secondary) then "Save" (primary). One primary button in the inspector.
- Save is pessimistic for measurement settings and optimistic for tags and notes ([20-frontend-specification.md](../20-frontend-specification.md) section 3.5). Success is shown in place (the section returns to read mode with the new value); no toast.
- Leaving a dirty inspector (Close, Esc, J, K, clicking another row, browser back) opens the discard AlertDialog (section 4.3).

### 2.6 Docking, overlay and sheet

The rules in [05-layout-grid.md](05-layout-grid.md) section 6 apply, with this width resolution order:

1. Compute the available inspector width: viewport width minus sidebar width minus 720 px (the minimum main column) minus the 12 px the card keeps from the window edge.
2. If the available width is at least 360 px (the inspector minimum), the inspector **docks** at `min(preferred width, available width)`. Docking wins over the preferred width.
3. Otherwise, if the viewport is at least 768 px wide, the inspector **overlays** the main column at its preferred width.
4. Below 768 px, the inspector is a **full-screen sheet**.

| Viewport, sidebar | Available width | Keyword (400) | Prompt (440) |
|---|---|---|---|
| 1920, expanded 208 | 980 | docks at 400 | docks at 440 |
| 1440, expanded 208 | 500 | docks at 400 (main 820) | docks at 440 (main 780) |
| 1440, collapsed 56 | 652 | docks at 400 | docks at 440 |
| 1280, collapsed 56 | 492 | docks at 400 (main 812) | docks at 440 (main 772) |
| 1280, expanded 208 | 340 | overlays at 400 | overlays at 440 |
| 1024, collapsed 56 | 236 | overlays at 400 | overlays at 440 |
| 390 (mobile) | n/a | full-screen sheet | full-screen sheet |

The effective maximum for the resize separator when docked is `min(640, available width)`; in overlay mode it is `min(640, viewport width minus 56)`.

| Mode | Stacking | Semantics | Behaviour |
|---|---|---|---|
| Docked | `--z-inspector` (50), `shadow-inspector` | Non-modal `aside` landmark | The page content below the top bar shrinks; the top bar does not. The card is sticky 12 px under the top bar and as tall as the rest of the window less 12 px. The table keeps scroll position and pinned columns |
| Overlay | `--z-drawer` (70), `shadow-inspector`, no scrim | Non-modal `aside`; main content stays interactive | Clicking the main content does not close it (users compare rows while it is open); it floats 12 px under the top bar and 12 px from the right and bottom edges; popups opened from inside it portal into its container so they stack above it ([01-foundations.md](01-foundations.md) section 6) |
| Sheet (below 768 px) | `--z-drawer` (70) with `--scrim` | Base UI Drawer, modal: focus trap, `aria-modal="true"`, background inert | Header shows a back button (`ChevronLeft`, "Back to Rankings") instead of Close; the sheet enters from the bottom edge and swipe down closes ([21-motion.md](21-motion.md) section 4.4, [19-responsive-behavior.md](19-responsive-behavior.md)) |

The docked and overlay inspector are one layout component, not a Base UI popup. Only the sheet uses Base UI Drawer.

### 2.7 URL addressing: one canonical approach

Decision: the inspector is addressed by **query parameters** on the list page, managed with `nuqs`:

```
/acme/crm/seo/rankings?loc=2840&dev=desktop&win=28d&inspect=keyword:0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11&itab=serp
```

| Parameter | Format | Default (omitted from the URL) |
|---|---|---|
| `inspect` | `<type>:<id>`; types `keyword`, `prompt`, `citation`, `answer`, `page`, `competitor`, `domain` (a registrable domain), `source` (a cited URL), `run`, `candidate` (a Discover candidate) | none (inspector closed) |
| `itab` | tab slug of that inspector type | `overview` |

The inspector tab uses `itab` because page-level tabs already own `tab` ([20-frontend-specification.md](../20-frontend-specification.md) section 3.6), and a prompt detail page can show its own tab and a citation inspector at once.

Why query parameters and not Next.js intercepting routes (`@drawer/(.)keywords/[tkId]`):

1. **A deep link must open the list with the inspector.** With intercepting routes, a pasted or reloaded URL renders the full page, so a shared "look at this row" link loses the filtered list. Query parameters reload to the same list, the same filters and the same open record.
2. **Ten inspector types on dozens of list screens.** Intercepting routes need a parallel slot, a `default.js` and an intercept segment per type per parent route; a new list screen would need all of them. One `inspect` parameter works on every screen with no route files.
3. **Filters already live in the query string.** The inspector parameter composes with them in one `nuqs` state model instead of splitting state between the path and the query.
4. **Objects without a full page** (citation, competitor, domain, source, answer, candidate) have no route to intercept.
5. The inspector renders client data anyway (analytics fetch in the browser through TanStack Query, [20-frontend-specification.md](../20-frontend-specification.md) section 3.4), so server rendering of the intercepted route gives no benefit.

The full page stays at its own path (`/seo/keywords/[tkId]`) and is reached by "Open page". This replaces the `@drawer` intercepting routes listed in [20-frontend-specification.md](../20-frontend-specification.md) section 3.2.

History rules:

| Action | History operation | Result of browser Back afterwards |
|---|---|---|
| Open the inspector (row click, Enter, palette, notification) | push | Closes the inspector |
| Previous or next record (J, K, buttons) | replace | Closes the inspector (does not step back through records) |
| Change inspector tab | replace | Closes the inspector |
| Close (X, Esc) when this session pushed the entry | `history.back()` | n/a (keeps forward history clean) |
| Close when the page was loaded with `inspect` already present | replace (remove `inspect` and `itab`) | Leaves the site's previous page as before |
| Open page | push to the full-page route; the inspector tab maps to the page tab or section of the same name | Returns to the list with the inspector open |

Deep link behaviour: the list page renders normally; the inspector opens immediately with its header skeleton and fetches its record in parallel with the list. If the record is not in the current filtered list, the inspector still shows it; the position counter and previous and next buttons are hidden until the user opens a record from the list.

### 2.8 Focus management

Docked and overlay inspector (non-modal):
1. Opening moves focus to the inspector title (`h2` with `tabindex="-1"`), so screen readers announce "Keyword, best crm for startups" and the next Tab reaches the header actions.
2. Tab order: header actions, tabs, section content, footer. Focus is not trapped; Tab past the end of the inspector moves to the next element in document order, and F6 moves focus between the main column and the inspector.
3. Esc, when focus is inside the inspector and no popup is open inside it, closes the inspector and returns focus to the originating row (the row's identity cell in the table grid, [12-tables.md](12-tables.md)). If the row is outside the virtualized window it is scrolled into view first; if it no longer exists (filtered out, deleted), focus goes to the table grid container.
4. The row open in the inspector carries the active-row style ([08-interaction-states.md](08-interaction-states.md) section 4) and `aria-current="true"`.
5. Esc closes one layer per keypress, innermost first: tooltip, then menu or popover, then dialog, then inspector.

Sheet (below 768 px, modal): Base UI Drawer semantics: focus moves to the title, is trapped inside the sheet, Esc and Back close it, focus returns to the originating row.

### 2.9 Loading, errors and freshness inside the inspector

- The header renders at once from the row already in the list cache (title, scope badges) through TanStack Query `initialData`, so the inspector never opens blank.
- Sections show skeletons shaped like their content ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 3). Each section has its own query and error boundary; one failed section shows an inline error with Retry and does not blank the others.
- Record not found or not accessible: the body shows "This keyword does not exist or you do not have access to it." with a Close button. The copy never implies the record exists ([20-frontend-specification.md](../20-frontend-specification.md) section 3.7).
- The freshness line in the header states when the record's data was last collected and whether a collection is running for it.
- After "Check now" or "Run now", the freshness line becomes a compact `CollectionProgress` ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 4) and the sections refetch when the run completes.

### 2.10 Navigating between records

- J and K (next and previous) and the header buttons follow the list's current sort and filters, including rows outside the virtualized window. At the first or last row the matching button is disabled with the tooltip "First keyword in this list".
- Navigation preserves the tab: moving from keyword 12 to keyword 13 on the SERP tab shows SERP for keyword 13.
- The table scrolls to keep the active row visible (`scroll-padding` clears sticky headers).
- The next and previous records are prefetched when a record finishes loading, so J usually renders from cache.
- On a record switch, sections show skeletons for the new record; previous-record data is never shown under the new title.
- J and K are single-key shortcuts: active only when focus is in the table or the inspector and not in a text input, and they can be turned off with all single-key shortcuts in Settings > Preferences (WCAG 2.1.4, [20-accessibility.md](20-accessibility.md)).

## 3. Full-page detail

A full page is for study. It exists only for objects listed in section 1.1.

An object gets a full page when at least one is true:
1. It needs two or more charts at full content width, or small multiples.
2. It contains its own filterable or sortable table of child records.
3. It contains an editor with a live preview or test tool (entity aliases).
4. Typical use takes more than two minutes of reading and comparing.

| Full page | Route | Why it is a page |
|---|---|---|
| Keyword Detail | `/seo/keywords/[tkId]` | Rank history with competitors, SERP snapshot compare, features heatmap, AIO history table |
| Prompt Detail | `/ai/prompts/[promptId]` | Per-engine rates table, small-multiple trends, answers table with evidence |
| Page Intelligence | `/seo/pages/[urlId]` | Channel small multiples, keywords and prompts tables |
| Panel detail | `panels/[panelId]` | Membership history, sizing calculator |
| Run detail (Operations) | `ops/runs/[runId]` | Virtualized task table with filters |
| Entity editor | `settings/entities/[id]` | Alias editor with test tool |
| Alert rule editor | `/settings/alert-rules/[id]` | Scope builder with preview count |
| New project | `onboarding` | Nine-step wizard |

Page rules:
- **Back link** above the title: "← Rankings" (`type-meta`, `link` colour). It returns to the list URL the user came from (stored in `sessionStorage` per tab), with its filters and the inspector open on this record; without a stored URL it links to the list with default filters.
- **Header**: title `h1` in `type-page-title` (24 / 32 px), wrapping to at most 2 lines; one meta line in `type-meta` 4 px below (scope, versions, freshness); actions right-aligned (at most one primary button); page tabs are 44 px underline tabs whose state is `?tab=`.
- **Sections** follow the panel and grid rules of [05-layout-grid.md](05-layout-grid.md) section 3: a 12-column grid with 8 columns of evidence (charts and tables) and a 4-column right rail of stacked panels. The window scrolls; only the top bar sticks.
- **Child records** open in their own inspector on the full page (a citation on Prompt Detail opens the citation inspector). A full page never opens another object's full page in a dialog.
- A full page and the inspector for the same object show the same numbers from the same queries. The inspector is a subset, never a different calculation.

## 4. Dialogs

### 4.1 Sizes

| Size | Width | Use |
|---|---|---|
| Small | 400 px | Confirmations, single-field forms (rename, set target URL for 12 keywords), re-authentication |
| Medium | 560 px | Standard forms: add competitor, add keywords, invite member, create API key, property picker |
| Large | 720 px | Multi-step flows (import), editors with inline validation lists (edit prompt), conflict resolution showing two versions |

Width is fixed per size and capped at the viewport width minus 32 px. No other widths.

### 4.2 Anatomy

```
                 +--------------------------------------------------------+
                 | Add competitor                                    [x]  |  header: 24 px padding
                 | Tracked for SEO rank and AI share of voice.            |
                 |--------------------------------------------------------|
                 | Name                                                   |  body: 24 px padding,
                 | [ HubSpot                                           ]  |  scrolls when tall
                 |                                                        |
                 | Domains                                                |
                 | [ hubspot.com                          ] [Registrable v]|
                 | + Add domain                                           |
                 |                                                        |
                 | (i) Share of voice is recalculated from today. Earlier |
                 |     weeks will show a version boundary.                |
                 |--------------------------------------------------------|
                 |                               [Cancel] [Add competitor]|  footer: 16 px vertical
                 +--------------------------------------------------------+
```

| Part | Specification |
|---|---|
| Surface | `surface-elevated`, `rounded-xl` (10 px), `shadow-dialog`; `--z-dialog` (80) |
| Scrim | `--scrim` over the whole viewport, same z-index layer as the dialog |
| Position | Horizontally centered; top edge at 12vh (minimum 48 px) so a dialog that grows between steps extends downward instead of jumping |
| Header | Title (`h2`, `type-section-title`, 16 / 24 px), optional description (`type-body`, `foreground-secondary`, one or two sentences), Close (`X`, 32 px `icon-sm` button, top right, [09-buttons-controls.md](09-buttons-controls.md) section 2.2). Padding 24 px top and sides, 16 px bottom |
| Body | 24 px horizontal padding, 0 top, 24 px bottom. Form rules in [10-forms.md](10-forms.md). Scrolls internally |
| Footer | 16 px vertical and 24 px horizontal padding. Actions right-aligned, 8 px gap: secondary ("Cancel") then primary. A step's "Back" button sits at the left edge. 1 px `border-subtle` top border only while the body is scrolled away from its end |
| Max height | Viewport height minus 12vh top offset minus 48 px; header and footer stay fixed, the body scrolls |

Rules:
- Exactly one primary button. Its label is the verb and object: "Add competitor", "Import 1,204 keywords", "Delete 12 keywords". Never "OK", "Submit" or "Yes".
- **No analytics inside dialogs**: no charts, no metric strips, no record tables, no inspectors. A dialog may show counts that inform the decision ("Matches 312 keywords", "Estimated cost $4.10 per month") with a link that opens the full view in a new tab.
- A dialog never opens another dialog, with one exception: the discard or destructive AlertDialog may stack on top of a dialog (one level). While it is open, the dialog under it is dimmed with the scrim color.
- Server errors that are not tied to a field appear as a negative `FormAlert` (the region banner look) at the top of the body ([18-notifications-alerts.md](18-notifications-alerts.md) section 4); field errors map to fields.
- On success the dialog closes and a success toast confirms the result, because the dialog that showed the task is gone ([18-notifications-alerts.md](18-notifications-alerts.md) section 3).

### 4.3 Focus, Escape and outside click

| Behaviour | Clean dialog | Dirty dialog (any field changed) |
|---|---|---|
| Initial focus | First field; the Close button for dialogs without fields | same |
| Tab | Trapped inside the dialog (Base UI Dialog) | same |
| Esc | Closes | Opens the discard AlertDialog |
| Close button, Cancel | Closes | Opens the discard AlertDialog |
| Click on the scrim | Closes | Ignored (no prompt, no animation). Focus stays where it was |
| Browser back | Closes (the dialog does not add a history entry) | Discard AlertDialog |
| On close | Focus returns to the trigger; if the trigger is gone, to the page `h1` | same |

The discard AlertDialog uses the copy from [10-forms.md](10-forms.md) section 13.2: title "Discard unsaved changes?", description "Your changes to this competitor will be lost.", buttons "Keep editing" (secondary, initial focus) and "Discard changes" (`destructive-solid`).

### 4.4 Re-authentication and conflict dialogs

- 403 `fresh_session_required` opens a 400 px dialog "Confirm it is you" with password or TOTP, stacked above the current dialog (the permitted one level), then retries the original request once ([20-frontend-specification.md](../20-frontend-specification.md) section 3.7).
- 409 conflict opens a 720 px dialog "This prompt changed while you were editing" with the server version and the local version side by side, and "Reload" and, where allowed, "Overwrite".

### 4.5 Destructive confirmation (AlertDialog)

Use Base UI AlertDialog for every destructive or irreversible action.

```
                 +----------------------------------------------+
                 | Delete 12 keywords?                          |
                 | Their rank history and SERP snapshots are    |
                 | deleted and alert rules stop matching them.  |
                 | Archive keeps the history instead.           |
                 |----------------------------------------------|
                 |              [Cancel] [Delete 12 keywords]   |
                 +----------------------------------------------+
```

- Size small (400 px). No Close button; Esc and Cancel cancel; scrim click does nothing.
- Initial focus on Cancel. The confirm button uses the `destructive-solid` variant ([09-buttons-controls.md](09-buttons-controls.md) section 2.3: `negative-button` fill, `negative-button-foreground` text, `negative-button-hover` on hover) and repeats the verb and count.
- The description states what is lost, when, and the reversible alternative if one exists.
- Reversible actions (archive, remove tag, mute) do not confirm. They run at once and show a toast with Undo ([18-notifications-alerts.md](18-notifications-alerts.md) section 3). Exception: a bulk operation over 100 rows always confirms with the count ([20-accessibility.md](20-accessibility.md) section 2, criterion 3.3.4).
- **Typed confirmation only for irreversible deletion of a project or a workspace.** The dialog adds a field "Type acme-crm to confirm" (the slug, `type-mono` in the label). The destructive button stays disabled until the value matches exactly (case-sensitive, trimmed). The request then passes through re-authentication (section 4.4). Everything else, including deleting thousands of keywords, uses the plain AlertDialog.

### 4.6 Multi-step dialogs

Used for imports (keywords, first-party reports). Size large (720 px).

```
+----------------------------------------------------------------------+
| Import keywords                                                 [x]  |
| [v] Upload  >  Map columns  >  Review  >  Confirm                    |
|----------------------------------------------------------------------|
| Column in file        Maps to                 Sample                 |
| keyword               [Keyword          v]    best crm for startups  |
| country               [Location         v]    US                     |
| tags                  [Tags             v]    comparison; crm        |
| volume                [Ignore           v]    2400                   |
|                                                                      |
| 1 required column mapped of 1. 2 optional columns mapped.            |
|----------------------------------------------------------------------|
| [Back]                                         [Cancel] [Continue]   |
+----------------------------------------------------------------------+
```

- Steps for imports: **Upload**, **Map columns**, **Review**, **Confirm**.
- The stepper sits at the top of the body as an ordered list (`<ol>`, `type-label`): completed steps show `CircleCheck` 14 px in `foreground-secondary` and are buttons that return to that step; the current step is `foreground`, weight 500, `aria-current="step"`; future steps are `foreground-tertiary` and not interactive. No numbered circles and no progress bar.
- "Continue" validates the current step; errors appear on the step, and focus moves to the first error.
- The Review step shows counts per outcome (new, duplicate, variant, conflict, invalid, over quota) with the default action for each and the first 20 affected rows per outcome in a simple list, not a data table.
- The final button names the result: "Import 1,204 keywords". After it is pressed the dialog closes, the page header shows `CollectionProgress` for the import job, and a toast with "View report" appears on completion ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 4).
- Step state survives closing the dialog only through the discard rule: closing a dialog past step 1 is a dirty close.

## 5. Popovers and menus

### 5.1 Popover

| Property | Value |
|---|---|
| Primitive | Base UI Popover: Trigger, Portal, Positioner, Popup |
| Width | 280 px minimum, 360 px maximum (`--size-popover-max`); content-sized between |
| Height | Maximum `min(400 px, var(--available-height))`; the content region scrolls (Base UI ScrollArea), header and footer stay fixed |
| Surface | `surface-elevated`, 1 px `border`, `rounded-lg` (8 px), `shadow-popover`, `--z-dropdown` (60). No arrow |
| Padding | 12 px for list popovers (filters, column chooser); 16 px for text popovers (method definition) |
| Positioning | Side `bottom`, align `start`, 4 px offset, `collisionPadding` 8 px; Base UI collision avoidance flips to the opposite side, then shifts along the edge; it never falls back to the side of the trigger (`POPUP_COLLISION`), and a popup that still does not fit is limited to the available height. Transform origin from `--transform-origin` |
| Modality | Non-modal. Focus moves to the first focusable element (or the popup when none); Esc and outside click close; focus returns to the trigger |

These limits match [05-layout-grid.md](05-layout-grid.md) section 4. Exception: the notification center popover ([18-notifications-alerts.md](18-notifications-alerts.md) section 5.2) is 380 px wide and up to 560 px tall. Exception: the `DateRangePicker` popover ([10-forms.md](10-forms.md) section 10.2) is 648 px wide (preset column plus two months). These two are the only documented exceptions to the popover size limits.

Uses: filter editing ([13-filters-search.md](13-filters-search.md) owns the content), quick settings (density, chart options), the metric method popover from (i), column chooser, date range picker.

Nesting: a popover may open one more floating layer (a Select list, a date picker, a Menu). Inside a dialog or the navigation drawer, such a layer takes the z-index of what it is in (`--z-dropdown` is set to `--z-dialog` or `--z-drawer` on their portal), so it comes out above it. That layer may not open anything further. A popover never opens a dialog; an action that needs a dialog closes the popover first.

### 5.2 Menu

| Property | Value |
|---|---|
| Primitive | Base UI Menu (buttons), Base UI ContextMenu (right-click) |
| Width | 180 to 280 px, content-sized |
| Container | `surface-elevated`, 1 px `border`, `rounded-lg`, `shadow-popover`, 4 px padding, max height `min(400 px, var(--available-height))` with scroll |
| Item | 32 px tall (the option row height shared with selects and comboboxes), 8 px horizontal padding, `rounded-md`, `type-body`; highlighted item `surface-elevated-hover` (`data-highlighted`), with the inset focus ring when it has keyboard focus |
| Item icon | 14 px (`size-icon-sm`), leading, `foreground-tertiary`, 8 px to the label. Either every item in a group has an icon or none does |
| Shortcut hint | Right-aligned `Kbd` ([09-buttons-controls.md](09-buttons-controls.md) section 11), 16 px minimum gap from the label |
| Group label | `type-meta`, 28 px row, not focusable |
| Separator | 1 px `border-subtle`, 4 px vertical margin |
| Checkbox and radio items | Leading 14 px check indicator slot, `aria-checked` |
| Submenu | Trailing `ChevronRight` 14 px; at most one submenu level |
| Disabled item | `foreground-disabled`, stays in the list, focusable; the reason replaces the shortcut hint in `type-meta` ("20 of 20 used today") |
| Destructive items | Last, after a separator; label and icon `negative-text`; highlighted state `negative-subtle` |

Keyboard follows Base UI defaults: arrows, Home and End, type-ahead, Enter and Space activate, Esc closes, Right opens a submenu, Left closes it.

### 5.3 Menu content order

1. Open actions (Open, Open page, Open in new tab)
2. Object commands (Check now, Add tag, Move to group, Set target URL)
3. Copy actions (Copy link, Copy keyword, Copy ID)
4. Separator, then destructive actions (Archive, Delete)

### 5.4 Row menus and context menus

- Every table row has a More button (`Ellipsis`, 24 px) in its last column, visible on row hover and row focus and always present in the accessibility tree ([04-spacing-density.md](04-spacing-density.md) section 4).
- Right-click on a row opens a ContextMenu with the same items, built from the same action definitions. Right-click also makes that row the focused row. Shift plus right-click shows the browser's native menu.
- Keyboard: Shift+F10 or the Menu key on a focused row opens the row menu.
- When rows are selected and the user right-clicks a selected row, the menu applies to the selection and says so in its first group label ("12 keywords selected"). Right-clicking an unselected row acts on that row only.
- Row menus never contain inspector content; they are commands.

## 6. Tooltips and preview cards

### 6.1 Tooltip

| Property | Value |
|---|---|
| Primitive | Base UI Tooltip with one app-level Tooltip.Provider |
| Open delay | 400 ms on hover. At once on keyboard focus: moving focus is a deliberate act, and the delay exists to keep tooltips from flickering while the pointer crosses the page |
| Moving between tooltips | 0 ms: once a tooltip has been shown, another trigger opens its tooltip instantly for 300 ms after the previous one closed (Provider delay grouping; the popup gets `data-instant`) |
| Close | When pointer and focus leave both trigger and tooltip; Esc; no timeout |
| Max width | 320 px (`--size-tooltip-max`); text wraps |
| Padding | 6 px vertical, 8 px horizontal |
| Surface | `surface-elevated`, 1 px `border`, `rounded-md` (6 px), `shadow-popover`, `--z-tooltip` (110) |
| Text | `type-meta` size with `foreground` colour for the main line; a secondary line in `foreground-tertiary`; shortcut hints as `Kbd` ([09-buttons-controls.md](09-buttons-controls.md) section 11) |
| Position | Side `top` (default), `bottom` for table headers and top-bar items, `right` for the collapsed sidebar; 6 px offset; collision flip |

Chart tooltips ([15-data-visualization.md](15-data-visualization.md) section 10) belong to the same family: `surface-elevated`, 1 px `border`, `shadow-popover`, with an 8 px radius (`rounded-lg`) because they hold a small table. The date is the first line in `type-subsection-title` (14 / 20 px, weight 600); below it, one row per series with an 8 px dot in the series color, the series name, and the value right-aligned (`num`).

Decision: tooltips use the **elevated surface**, not an inverse (dark on light) fill.

Reasons: the token system has no inverse surface, and adding one would create a colour used nowhere else; an inverse tooltip turns into a bright box in dark mode, the brightest object on screen, which contradicts the layered dark theme ([02-color-system.md](02-color-system.md) section 3); [06-surfaces-borders-radius.md](06-surfaces-borders-radius.md) already assigns `shadow-popover` to tooltips, so tooltips, popovers and menus read as one family. Contrast is met: `foreground` on `surface-elevated` is about 17:1 in light and 14:1 in dark, and `foreground-tertiary` meets 4.5:1 (tested pairs, [02-color-system.md](02-color-system.md) section 9); the 1 px `border` plus shadow separate the tooltip from `surface` tables.

Content rules:
- One idea: at most three lines of text, or one mini table of up to 7 rows (chart series tooltips up to 8 rows, [15-data-visualization.md](15-data-visualization.md) section 10). A tooltip that needs a heading, a list or a link is a popover or preview card.
- No interactive content: no links, buttons or inputs. Base UI tooltips are not focus targets.
- Never the only place for information needed to complete a task. On touch devices tooltips do not appear, so anything essential is also in the inspector.
- Icon-only controls: the tooltip text equals the `aria-label` and adds the shortcut ("Close inspector (Esc)").
- Truncated cells: the tooltip shows the full value ([12-tables.md](12-tables.md)).
- Values: a tooltip may add detail to a value ("95% interval 31% to 37%, Wilson on pooled counts"); it is attached with `aria-describedby`.
- Disabled controls stay focusable and their tooltip states the reason ([08-interaction-states.md](08-interaction-states.md) section 1).

### 6.2 WCAG 1.4.13 (content on hover or focus)

| Requirement | Implementation |
|---|---|
| Dismissible | Esc closes the tooltip without moving pointer or focus |
| Hoverable | The pointer can move from the trigger onto the tooltip without it closing (Base UI hoverable popup; the 6 px gap is bridged) |
| Persistent | Stays open until pointer and focus leave, Esc is pressed, or the information becomes invalid; never closes on a timer |

The same three rules apply to preview cards.

### 6.3 PreviewCard

Base UI PreviewCard shows a read-only summary when the pointer rests on a link to an object.

- Open delay 600 ms, close delay 300 ms. Keyboard focus on the link opens it after the same delay.
- 320 px wide, 16 px padding, `surface-elevated`, 1 px `border`, `rounded-lg`, `shadow-popover`, `--z-dropdown`.
- Content: object type label (`type-meta`), title (`type-body-strong`, 2 lines), up to 3 key-value lines (`type-meta` labels, `type-body` values, tabular numbers), freshness line.
- Examples: a cited URL shows title, host, role chip, citation count in window; a competitor name shows its domains, series colour swatch and SOV in window.
- The trigger is always a link that opens the same object in the inspector. The card never holds actions; everything in it is reachable by opening the object.

## 7. Command palette

Opened with Cmd+K (macOS) or Ctrl+K from anywhere, including text inputs, and from the search button in the top bar. Built from Base UI Autocomplete rendered `inline open` inside a Base UI Dialog.

### 7.1 Layout

```
+----------------------------------------------------------------+
| [Q] [Keywords x] crm pri|                                  Esc |  header 48 px: 32 px input
|----------------------------------------------------------------|
| Recent                                                         |
|   [T] crm pricing                        Keyword · US desktop  |
| Keywords                                            (loading)  |
|   [T] crm pricing                        Keyword · US desktop  |  highlighted: surface-hover
|   [T] crm pricing for startups           Keyword · US mobile   |
|   [T] hubspot crm pricing                Keyword · UK desktop  |
|   [Q] Search all keywords for "crm pri"                        |
| Pages                                                          |
|   [#] Rankings                                   SEO           |
| Actions                                                        |
|   [+] Add keywords                                             |
|----------------------------------------------------------------|
| ↑↓ Move   ↵ Inspect   ⌘↵ Open page   Esc Close                 |  footer 32 px, type-kbd
+----------------------------------------------------------------+
```

| Property | Value |
|---|---|
| Size | 640 px wide (`--size-command`), max 480 px tall (`--size-command-max-h`), capped by viewport minus 32 px |
| Position | Top edge at 12vh, horizontally centered |
| Surface | `surface-elevated`, `rounded-xl`, `shadow-dialog`, `--scrim` behind, `--z-command` (90) |
| Header | 48 px: 8 px vertical padding around a borderless 32 px input, 16 px leading `Search` icon (`foreground-tertiary`), scope chip slot, "Esc" hint right in `type-kbd`; 1 px `border-subtle` bottom |
| Group heading | `type-meta`, 28 px row, 12 px horizontal padding, `role="presentation"` with the group labelled by it |
| Item | 32 px, 12 px horizontal padding, 16 px leading icon (the object's glyph from [07-icons.md](07-icons.md) section 6), label in `type-body` with matched characters in weight 500, context right-aligned in `type-meta` (type and scope), shortcut hints right-aligned as `Kbd` for actions |
| Footer | 32 px, 12 px padding, key hints in `type-kbd`, `foreground-tertiary`, 1 px `border-subtle` top |

### 7.2 Groups and ranking

Group order: **Recent, Pages, Keywords, Prompts, Domains, Projects, Actions**. Empty groups are hidden.

| Group | Source | Search |
|---|---|---|
| Recent | Last 8 objects opened or actions run by this user in this workspace | Client |
| Pages | Navigation routes the user can access (permission and flag aware) | Client |
| Keywords, Prompts, Domains | Server entity search in the current project | Server, debounced 150 ms, minimum 2 characters, stale requests aborted |
| Projects | Projects from `/v1/me` | Client |
| Actions | Commands available on the current screen plus global ones (Add keywords, Theme: System, Light, Dark, Switch project) | Client |

Matching and ranking, per group:
1. Exact match of the whole label
2. Prefix of the whole label
3. Prefix of any word in the label
4. Substring
5. Fuzzy subsequence (all query characters in order), client groups only

Ties sort by recency of use, then alphabetically. Each group shows at most **5** items, then a row "Search all keywords for "crm pri"" that opens the list screen with the text filter applied (`?q=`). Server groups show a 14 px `LoaderCircle` in their heading while a request is in flight and keep their previous results until the new ones arrive (no flashing).

### 7.3 Scoping chips

Typing a scope prefix followed by a colon converts it into a chip in the input and restricts results to that group, with up to 20 items:

| Prefix | Scope |
|---|---|
| `kw:` | Keywords |
| `pr:` | Prompts |
| `dom:` | Domains |
| `proj:` | Projects |
| `go:` | Pages |
| `>` | Actions |

Backspace in an empty input removes the chip. The chip is a 22 px neutral badge with the scope name and a remove button.

### 7.4 Keyboard

| Key | Result |
|---|---|
| Up, Down | Move the highlight; wraps at the ends |
| Enter | Default action: objects with an inspector open it (on the current list if it lists that type, else on the type's list page with default filters plus `inspect`); pages navigate; actions run |
| Cmd+Enter (Ctrl+Enter) | Objects with a full page open the full page; others behave as Enter |
| Shift+Enter | Open the object's URL in a new tab |
| Esc | Closes the palette and returns focus to the element focused before it opened |
| Cmd+K (Ctrl+K) | Toggles the palette |

### 7.5 Recent, empty and no-result states

- Recent holds the last 8 items per user per workspace: objects opened anywhere in the app (not only through the palette) and actions run from the palette. Stored in `localStorage` keyed by user id and workspace id as ids plus labels only, cleared at sign-out. An item that no longer resolves is removed when selected, with the inline message "This keyword no longer exists".
- Empty query: Recent, then Pages, then Actions.
- Empty query and no recent items: Pages and Actions only.
- No results: the list shows "No results for "xyz"" in `type-body` `foreground-secondary`, a "Search all keywords for "xyz"" row, and a hint line in `type-meta`: "Scope a search with kw:, pr:, dom:, proj: or go:".

### 7.6 Accessibility

- Dialog with a visually hidden title "Command palette".
- The input is a combobox (`aria-expanded="true"`, `aria-controls` the listbox, `aria-activedescendant` the highlighted option). Base UI Autocomplete provides this.
- Groups are `role="group"` labelled by their heading. Each option's accessible name includes its context: "crm pricing, keyword, US desktop".
- A polite live region announces the result count 500 ms after typing stops: "14 results".
- Focus returns to the previously focused element on close.

## 8. Statistics panel

The statistics content of [20-frontend-specification.md](../20-frontend-specification.md) section 6 (estimate, uncertainty, period comparison, movers, version boundaries, panel sizing) renders as the non-modal `StatisticsPanel` in the inspector region. Placement, URL and content are owned by [23-application-patterns.md](23-application-patterns.md) section 8.6.

- A rate inside an open record inspector (prompt) opens that inspector's "Stats" tab (`itab=stats`).
- A page-level metric (strip item, rate column header, chart "Statistics" action) opens the panel in the inspector region at 560 px (`--size-drawer`), replacing an open record inspector; its header has "Back to <record>" when one was open.
- Non-modal like every inspector: no focus trap, no scrim, the page stays interactive. Docking, overlay and sheet rules are those of section 2.6; Esc closes it and returns focus to the trigger.
- URL: `?stats=<metric>:<engine>`, pushed on open, so Back closes it; closing restores `inspect` when a record was open.
- Header like the inspector header without tabs, previous and next, or resize.

The modal `SideDrawer` (Base UI Drawer, side right, 560 px) has no V1 use and is Later ([25-component-inventory.md](25-component-inventory.md)).

## 9. Motion for overlays

Implementation: CSS transitions on `[data-starting-style]` and `[data-ending-style]` (Base UI waits for them before unmounting). [21-motion.md](21-motion.md) sections 2.1 and 4 own these values; this table restates them.

| Overlay | Enter | Exit | Property |
|---|---|---|---|
| Inspector and `StatisticsPanel`, docked | 200 ms (`--duration-slow`), `--ease-standard`, content only | Instant (0 ms) | Content opacity only. The column appears at full width instantly and the main column reflows at once, without animated width |
| Inspector and `StatisticsPanel`, overlay | 200 ms | 150 ms (`--duration-base`), `--ease-exit` | Translates its full width from the right edge plus opacity |
| Inspector sheet (below 768 px) | 200 ms | 150 ms | Translates its full height from the bottom edge plus opacity; scrim opacity |
| Dialog, AlertDialog | 200 ms | 150 ms | Opacity 0 to 1 and an 8 px translate; no scale; scrim opacity |
| Command palette | 150 ms (`--duration-base`) | 100 ms | Opacity and a 4 px translate; no scale; scrim opacity |
| Popover, menu, preview card | 150 ms | 100 ms (`--duration-fast`) | Opacity and a 4 px translate from the side it opens on (`data-side`); no scale. Transform origin `--transform-origin` |
| Tooltip | 150 ms | 100 ms | Opacity only; no animation when `data-instant` is set |
| Record switch in the inspector (J, K) | none | none | Content swaps instantly |

Reduced motion: `prefers-reduced-motion: reduce` sets all duration tokens to 0 ms ([`tokens.css`](../../apps/web/src/styles/tokens.css)), so every overlay appears and disappears instantly and no transform is applied.

## 10. Tokens this document requires

These sizes appear above and are defined in `tokens.css` (with `--spacing-*` aliases in `globals.css`):

| Token | Value |
|---|---|
| `--size-inspector`, `--size-inspector-wide` | 25rem (400 px), 27.5rem (440 px) |
| `--size-inspector-min`, `--size-inspector-max` | 22.5rem (360 px), 40rem (640 px) |
| `--size-dialog-sm`, `--size-dialog-md`, `--size-dialog-lg` | 25rem, 35rem, 45rem |
| `--size-drawer` | 35rem (560 px, `StatisticsPanel`) |
| `--size-popover-min`, `--size-popover-max`, `--size-popover-max-h` | 17.5rem, 22.5rem, 25rem (exceptions: notification center 380 px, `DateRangePicker` 648 px, section 5.1) |
| `--size-menu-min`, `--size-menu-max` | 11.25rem, 17.5rem |
| `--size-tooltip-max`, `--size-preview-card` | 20rem |
| `--size-command`, `--size-command-max-h` | 40rem, 30rem |

## 11. Component summary

Components defined here: `Inspector` (with `InspectorHeader`, `InspectorTabs`, `InspectorSection`, `InspectorFooter`, `InspectorResizeHandle`), `DetailPageHeader`, `Dialog` (with `DialogHeader`, `DialogBody`, `DialogFooter`), `ConfirmDialog`, `TypeToConfirmField`, `DiscardChangesDialog`, `StepperDialog`, `Popover`, `Menu`, `RowMenu`, `RowContextMenu`, `Tooltip`, `PreviewCard`, `CommandPalette`, `StatisticsPanel` (content owned by [23-application-patterns.md](23-application-patterns.md) section 8.6) and `SideDrawer` (Later). Props and ownership are in [25-component-inventory.md](25-component-inventory.md).
