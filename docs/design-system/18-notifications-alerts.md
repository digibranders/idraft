# 18. Notifications and Alerts

Status: Accepted (design-system v2)
Last updated: 2026-09-29
Implementation, per [26-implementation-guidelines.md](26-implementation-guidelines.md) section 2: `Toaster` and `toast()` in `apps/web/src/components/ui/toast.tsx`; `NotificationBell`, `NotificationCenter`, `NotificationItem` in `apps/web/src/components/app/shell/`; `Banner`, `SeverityIcon`, `EventTimeline`, `AnomalyHoldNotice` in `apps/web/src/components/app/status/`; `AlertEventsTable` and `DigestView` in `apps/web/src/features/alerts/components/`
Related: [20-frontend-specification.md](../20-frontend-specification.md) section 5.17 (Alerts screen), [08-seo-keyword-system.md](../08-seo-keyword-system.md) section 12 (SEO rules, aggregation, anomaly hold), [11-ai-prompt-system.md](../11-ai-prompt-system.md) section 10 (AI rules), [19-api-specification.md](../19-api-specification.md) (`AlertEvent`, digests), [25-observability.md](../25-observability.md) sections 6 and 7 (platform alerts), [12-tables.md](12-tables.md), [14-badges-status.md](14-badges-status.md), [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md), [17-empty-loading-error-states.md](17-empty-loading-error-states.md), [22-content-formatting.md](22-content-formatting.md)

This document specifies how the product tells users that something happened: toasts, banners, the notification center, the Alerts screen, the event timeline, and the copy and link rules shared with email and Slack.

## 1. Channels

| Channel | Carries | Lifetime | Never used for |
|---|---|---|---|
| **Toast** | Result of the user's own action when the UI that started it is gone (dialog closed, background job finished); Undo for reversible actions | 6 s without an action; until dismissed with an action or on error (section 3) | Alert events, page conditions, errors that need the user to change something |
| **Inline banner** | A condition of the page or region the user is looking at: partial data, stale data, provider failure, integration access lost, budget blocked, anomaly hold, read-only mode | While the condition lasts | Confirmations, marketing, tips |
| **Inline message** | Field and region states: validation, region load errors, empty states ([17-empty-loading-error-states.md](17-empty-loading-error-states.md)) | While the state lasts | Page-wide conditions |
| **Notification center** (bell) | Alert events from rules with the in-app destination, system notices addressed to the user (export ready, integration access lost), platform alerts for operators | 30 days in the panel; full history on the Alerts screen | Confirmations of actions the user just saw complete |
| **Alerts screen** | Every alert event of the project, with acknowledge and filters | Retention of `ops.alert_events` | Real-time interruption |
| **Email, Slack, webhooks** | Immediate critical events and hourly or daily digests ([08-seo-keyword-system.md](../08-seo-keyword-system.md) section 12.2) | External | Outside UI scope, except the link format (section 10) |

Choosing: if the user must read it to trust the numbers on screen, it is a banner. If it happened to an object the user cares about while they were elsewhere, it is a notification. If it confirms what the user just did, it is a toast, or nothing when the change is already visible in place.

## 2. Severity model

Alert events carry `severity: 'info' | 'warning' | 'critical'` from the API ([19-api-specification.md](../19-api-specification.md), `AlertEvent`). Platform alerts map P3, P2 and P1 to the same three levels ([25-observability.md](../25-observability.md) section 7.1). The UI never derives severity itself.

| Severity | Icon (Lucide) | Icon colour | Tinted background (banners, badges) | Meaning |
|---|---|---|---|---|
| Info | `Info` | `info-text` | `info-subtle`, border `info-border` | Worth knowing; no action expected |
| Warning | `TriangleAlert` | `warning-text` | `warning-subtle`, border `warning-border` | Review within the day |
| Critical | `OctagonAlert` | `negative-text` | `negative-subtle`, border `negative-border` | Act now: data or money at risk |

Rules:
1. **Severity is urgency, not polarity.** "Keyword entered top 10" is good news with severity info; the event text and the value arrows carry direction, and value colouring follows the delta rules of [02-color-system.md](02-color-system.md) section 6, independent of severity.
2. Severity always appears as icon plus text label ("Critical") where space allows, or icon with an accessible name in dense rows. Colour is never the only signal.
3. `OctagonAlert` is reserved for critical severity; `CircleX` stays the glyph for a failed status ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 6). A critical event about a failure ("Provider collection failed") uses `OctagonAlert` in lists and `CircleX` in the status it links to.
4. Sort order by severity: critical, warning, info.

## 3. Toast

Base UI Toast (shadcn `toast`, [research/09-frontend-stack.md](../../research/09-frontend-stack.md) section 14).

### 3.1 Layout

```
                                            +--------------------------------------------+
                                            | (v) 12 keywords archived        [Undo] [x] |
                                            +--------------------------------------------+
                                            +--------------------------------------------+
                                            | (v) Import finished             [View] [x] |
                                            |     1,204 added, 38 skipped as duplicates  |
                                            +--------------------------------------------+
                                                         20 px from right and bottom
```

| Property | Value |
|---|---|
| Viewport | Bottom-right, 20 px from the right edge of the main column and the bottom of the viewport. When the inspector is docked, toasts align to the main column's right edge so they never cover the inspector footer. Below 768 px: bottom center, full width minus 24 px |
| Width | 360 px |
| Height | 48 px of content minimum (a 32 px action plus 8 px padding above and below), 50 px with the border; grows to two lines of description at most |
| Surface | `surface-elevated`, 1 px `border`, `rounded-lg`, `shadow-popover`, `--z-toast` (100) |
| Padding, gap | 8 px vertical, 12 px horizontal; 8 px between icon, text and actions; 8 px between stacked toasts |
| Icon | 16 px status icon, leading |
| Title | `type-body-strong`, `foreground`, one line |
| Description | Optional, `type-meta`, `foreground-secondary`, at most 2 lines |
| Action | At most one, a 32 px (`sm`) ghost button with a label of 2 words at most ("Undo", "View report", "Download") |
| Close | `X`, 24 px icon button, always present |
| Visible limit | **3**. Base UI `limit={3}`: the three newest are shown, the newest at the bottom; an older one comes back when there is room again |

### 3.2 Types and durations

| Type | Icon | Duration | Live region |
|---|---|---|---|
| Success | `CircleCheck` (`positive-text`) | 6 s | polite |
| Info | `Info` (`info-text`) | 6 s | polite |
| Any toast with an action (Undo, View, Retry) | per type | Persistent until dismissed or the action is used, so the action can be reached by keyboard | polite |
| Progress (promise) | `LoaderCircle` | Until resolved, then updates by id to success or error | polite |
| Error | `CircleX` (`negative-text`) | Persistent until dismissed | assertive |

Durations follow [20-accessibility.md](20-accessibility.md) section 10.5. Timers pause while the pointer is over the toast region, while any toast has focus, and while the window is not focused. There is no warning toast type: warnings are conditions, and conditions are banners.

### 3.3 When to toast

| Situation | Toast |
|---|---|
| Dialog submitted and closed | Success: "Competitor added: HubSpot" |
| Reversible bulk action (archive, remove tag, mute) | Success with Undo: "12 keywords archived". The toast persists until dismissed; the action also stays reversible from its status view |
| Background job the user started finishes (Check now, Run now, import, export, backfill) | Success or error with View: "Export ready: rankings-2026-09-29.csv" with Download |
| 429 rate limit | Info: "Too many requests. Retrying in 12 s", updated each second, closed when the retry succeeds |
| Inline edit saved (table cell, inspector section) | None; the new value is visible in place |
| Setting applied immediately (auto-save switch) | None; the control shows the new state ([10-forms.md](10-forms.md) section 13.3) |
| Copy to clipboard | None; the icon swaps to a check ([08-interaction-states.md](08-interaction-states.md) section 5). If the Clipboard API rejects, an error toast "Could not copy. Select the text and copy it manually." appears and the value is selected in its field; this is the one error toast for a direct user action, because the icon button has no room for inline text ([09-buttons-controls.md](09-buttons-controls.md) section 9.1) |
| Scheduled run finished | None; `FreshnessIndicator` updates |
| Alert event fired | None; bell badge and notification center |
| Validation error, permission error, failed save the user must fix | None; inline field error or form banner |

Error toasts are allowed only for failures of background work whose originating UI is gone (and the copy failure above), and their only action is "Retry" or "View" (the copy failure has none). Anything the user must change (input, permissions, configuration) is shown inline where it can be changed.

Toast copy: result first, past tense, with the object and count: "12 keywords archived", "Rank check finished: best crm for startups is #4", "Import failed: file has no keyword column". Identical toasts (same id) update in place instead of stacking.

## 4. Banner

`Banner` states a condition of a page, inspector or dialog.

```
+------------------------------------------------------------------------------------------+
| (!) Partial data: 612 of 1,000 keywords checked today. Today's metrics include only       |
|     checked keywords.                                                        View run     |
+------------------------------------------------------------------------------------------+
| Metric strip ...                                                                          |
```

| Property | Page banner | Region banner (inspector, dialog, panel) |
|---|---|---|
| Position | Directly under the page header (and filter bar), above the first content region | Top of the inspector body, dialog body or panel |
| Width | Full content width, no radius, 1 px bottom border in the family's `-border` | Content width, `rounded-md`, 1 px border all sides |
| Padding | 8 px vertical, 20 px horizontal (the page gutter) | 8 px vertical, 12 px horizontal |
| Background | Family `-subtle` | Family `-subtle` |
| Icon | 16 px, family `-text` | same |
| Text | `type-body`, `foreground`; an optional lead phrase in `type-body-strong` ("Partial data:") then one or two sentences | same |
| Actions | Right-aligned, up to 2, as text links or 32 px (`sm`) secondary buttons | same |
| Dismiss | `X` 24 px, only when dismissible | same |

Variants: **info**, **warning**, **negative** (tokens from section 2; negative uses `CircleX`, because banners describe conditions, not events).

Rules:
- **Dismissible only when non-critical.** Banners about the correctness or completeness of the numbers on screen (partial, stale, provider failure, integration access lost, budget blocked) are not dismissible; they disappear when the condition ends. Info banners (scheduled maintenance, read-only mode notice) are dismissible; the setup checklist is not a banner ([23-application-patterns.md](23-application-patterns.md) section 13); a dismissal is stored per user and condition id, and the banner returns if the condition changes (a new maintenance window, a new failure).
- At most 2 page banners. More conditions collapse into the second banner as "2 more notices" with a disclosure listing them. Order: negative, warning, info.
- Banners present at first render have no live role. A banner that appears during the session uses `role="status"` (info, warning) or `role="alert"` (negative).
- A banner never contains a form, a chart or more than two sentences. Details go behind its action.

Catalogue of page banners:

| Condition | Variant | Copy | Action |
|---|---|---|---|
| Partial data | warning | Partial data: 612 of 1,000 keywords checked today. Today's metrics include only checked keywords. | View run |
| Stale above 5% | warning | 86 of 1,000 keywords have not been checked for over 36 hours. Their ranks are from their last successful check. | Show stale keywords |
| Provider failure | negative | Today's rank checks failed at the provider. Showing results from Sep 28. | View run |
| Integration access lost | negative | Google Search Console access expired on Sep 27. Data after that date is missing. | Reconnect |
| Budget blocked | warning | This week's AI run was blocked by the Project budget (estimate $84.20, $40.00 left). | Open budgets |
| Anomaly hold | warning | Alerts for Sep 28 are on hold: 64% of comparable keywords moved more than 10 positions. | Review held alerts |
| Provider delayed, overdue | warning | Rank checks are 6 hours overdue. The operations team has been alerted. | none |
| Read-only role | info | You have view access to this project. Editors and admins can change settings. | none |

## 5. Notification center

### 5.1 Bell and unread badge

- Top bar icon button, 32 px, `Bell` at 18 px (`size-icon-md`), accessible name "Notifications, 12 unread" (or "Notifications" when none).
- Unread badge: top-right of the button, offset 4 px up and right; 16 px tall, minimum 16 px wide, 4 px horizontal padding, `rounded-sm`, `type-micro`, `num`. Colours: `primary` fill with `primary-foreground` text; `negative-solid` fill with `foreground-inverse` text when any unread item is critical. Content: the count up to 99, then "99+". Hidden at zero.
- The unread count is fetched every 60 s while the tab is visible and on window focus, together with the `data_version` poll.
- New events never toast and never play a sound. The badge is the only real-time signal.

### 5.2 Panel

Decision: a Base UI Popover anchored to the bell, **380 px wide** and up to **560 px tall** (`min(560 px, var(--available-height))`). This is one of two documented exceptions (the other is the `DateRangePicker` popover, 648 px wide, [10-forms.md](10-forms.md) section 10.2) to the popover size limits in [05-layout-grid.md](05-layout-grid.md) section 4 and [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 5.1 (360 px wide, 400 px tall): notification items carry three lines and need the width, and a drawer would cover the page the user is working in. Below 768 px the panel is a full-screen sheet ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.6).

```
+--------------------------------------------------------------+
| Notifications                        Mark all read   [gear]  |  header 48 px
| [   All   |  Unread 12  ]                                    |  32 px segmented
|--------------------------------------------------------------|
| Today                                                        |  day heading, sticky
| * (!) Rank dropped 7 positions                        2h ago |
|       best crm for startups  #4 → #11                        |
|       Acme CRM · US desktop                                  |
| * (i) Keyword entered top 10                          3h ago |
|       crm for startup  #12 → #8                              |
|       Acme CRM · US mobile                                   |
|   (i) Rank improved 3 or more positions · 12 keywords 5h ago |
|       crm pricing, hubspot alternatives, +10         [v]     |
|       Acme CRM                                               |
| Yesterday                                                    |
| * (X) Provider collection failed                     Sep 28  |
|       Rank checks, 23 of 1,000 failed                        |
|       Acme CRM · Run 4812                                    |
|   (!) AI citation lost                               Sep 28  |
|       "best crm for a 20-person startup" · ChatGPT           |
|       Acme CRM                                               |
|--------------------------------------------------------------|
| View all alert events                                        |  footer 40 px
+--------------------------------------------------------------+
  * = unread dot   (i) info  (!) warning  (X) critical (OctagonAlert)
```

| Part | Specification |
|---|---|
| Surface | `surface-elevated`, 1 px `border`, `rounded-lg`, `shadow-popover`, `--z-dropdown` |
| Header | 12 px padding. Row 1: "Notifications" (`h2`, `type-subsection-title`, 14 / 20 px, 600), "Mark all read" (32 px `sm` ghost button), settings link (`icon-sm` 32 px icon button with a 14 px `Settings` icon, [09-buttons-controls.md](09-buttons-controls.md) section 3, opens Settings, Notifications). Row 2: All and Unread tabs, a 32 px (`sm`) segmented control whose selected segment is `primary-subtle` with a `primary-border` outline and a `primary-text` label ([09-buttons-controls.md](09-buttons-controls.md) section 6); the Unread tab shows its count |
| Day groups | Sticky day heading, 28 px, `type-label`, `surface-elevated`: "Today", "Yesterday", then "Sep 27". Days in the viewer's timezone |
| Body | Scrolls; newest first; loads 30 items, then the next 30 when the end is reached |
| Footer | 40 px, 1 px `border-subtle` top: "View all alert events" link to the Alerts events screen of the current project |
| Scope | All projects in the current workspace that the user can access |

### 5.3 Item anatomy

| Element | Specification |
|---|---|
| Container | Full-width row, 8 px vertical and 12 px horizontal padding, three lines (about 76 px: two 20 px `type-body` lines and one 20 px `type-meta` line). Hover `surface-hover`; focus ring inset |
| Unread dot | 6 px `rounded-full` status dot in `primary`, in a 12 px left gutter. It is a real state (unread), removed when read. Read items keep the gutter empty so text stays aligned |
| Severity icon | 14 px (`size-icon-sm`), severity colour, top-aligned with line 1 |
| Line 1: event title | `type-body-strong` when unread, `type-body` when read; the catalogue phrase from section 9 ("Keyword entered top 10"). Timestamp right-aligned in `type-meta`, `num`: relative up to 7 days ("2h ago"), then the date ("Sep 21"); absolute time with timezone in the tooltip |
| Line 2: entity and values | Entity label as a link (`foreground`, underline on hover), then inline values in `type-body` with tabular numbers ("#4 → #11"). Prompt text is quoted and truncated to one line |
| Line 3: context | `type-meta`: project name, then scope (location and device, engine, run id), separated by `·` |
| Hover actions | Right side, on hover and focus: "Mark as read" (`Check`, 24 px icon button; "Mark as unread" on read items) and More (`Ellipsis`) with Open, Open rule, Acknowledge (`alerts:write`), Mute this rule for 7 days (`alerts:write`) |

Behaviour:
- Activating an item opens the entity where it lives: a keyword opens Rank Tracker with `?inspect=keyword:<id>` and the filters that match the event scope; a run opens the run inspector in Operations; a digest opens the digest view. The item becomes read.
- Opening the panel does not mark anything read. "Mark all read" applies to the current tab's scope.
- Read state is per user. Acknowledge is a separate, shared state on the Alerts screen (section 6).
- Keyboard: the list uses roving focus. Up and Down move between items, Enter opens, Shift+F10 opens the item menu, Tab moves to the item's hover actions, Esc closes the panel and returns focus to the bell.

### 5.4 Grouped items

Events of the same rule, event kind, project and day collapse into one item when there are 3 or more:
- Line 1: the event title plus the count: "Rank improved 3 or more positions · 12 keywords".
- Line 2: the first two entity labels and "+10".
- A 24 px disclosure button (`ChevronDown`) expands the group inline to the first 5 events, then "View all 12" (the Alerts events screen filtered to the rule and date).
- The group is unread while any member is unread; marking the group read marks all members.

### 5.5 Empty states

| Tab | Title | Reason | Action |
|---|---|---|---|
| All | No notifications | Alert events from your rules and system notices appear here. | Manage alert rules (link) |
| Unread | No unread notifications | Items you have not opened appear here. | none |

Inline `EmptyState` variant ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 2.1), centered in the panel body.

### 5.6 What appears in the notification center

| Source | Audience | Example |
|---|---|---|
| Alert events with the in-app destination | Users with `data:read` on the project | Keyword entered top 10 |
| Anomaly hold notices | Same as the held rules | Alerts held for Sep 28 |
| Integration access lost | Users with `integrations:manage` | Google Search Console access expired |
| Budget soft and hard limits | Users with `budgets:manage` | API budget threshold reached (80%) |
| Async export ready | The user who requested it | Export ready: rankings-2026-09-29.csv |
| Platform alerts (P1, P2) | Platform operators only | Nightly backup failed |

## 6. Alerts screen: event rows

Route `alerts/events` ([20-frontend-specification.md](../20-frontend-specification.md) section 5.17). A `DataTable` ([12-tables.md](12-tables.md)) with grouping by rule and date.

```
+------------------------------------------------------------------------------------------------+
| Alert events                                           Updated 4m ago                          |
| Filter bar: [Last 7 days v] [Severity v] [Rule v] [Status: Open v]  + Filter                   |
|------------------------------------------------------------------------------------------------|
| (!) Alerts for Sep 28 are on hold: 64% of comparable keywords moved more than 10 positions.   |
|     312 events held.                                                     Review held alerts   |
|------------------------------------------------------------------------------------------------|
| Severity   Event                          Entity                   Time       Status     Action|
| v Rank dropped 5 or more positions · Sep 29 · 23 events                                        |
| (!) Warn   Rank dropped 7 positions #4 → #11  best crm for startups   08:12     New    [Ack] ...|
| (!) Warn   Rank dropped 5 positions #9 → #14  crm pricing             08:12     New    [Ack] ...|
| > Keyword entered top 10 · Sep 29 · 6 events                                                   |
| (X) Crit   Provider collection failed          Run 4812 (seo_rank)    04:12     Acknowledged   |
|                                                                                 by Dana Kim ...|
+------------------------------------------------------------------------------------------------+
```

| Column | Content | Width, alignment |
|---|---|---|
| Severity | `SeverityIcon` 14 px plus label ("Critical", "Warning", "Info"); sorts critical first | 96 px |
| Event | Catalogue phrase plus inline values ("Rank dropped 7 positions", "#4 → #11"); values follow the delta colour rules | flexible, min 240 px |
| Entity | Type glyph 14 px and label (keyword, prompt, domain, page, run) as a link that opens its inspector on this screen | flexible, min 200 px |
| Project | Project name. Shown only in workspace-wide views; hidden on the project-scoped screen | 160 px |
| Time | `occurred_at` in the project timezone; relative under 24 h, then date and time; absolute in the tooltip; default sort descending | 112 px, left-aligned, `num` |
| Status | New, Acknowledged (with "by Dana Kim" as a second line in `type-label` in Comfortable density, tooltip in Compact density, the default), Held (anomaly hold), Muted (flapping, with "until Oct 6") | 128 px |
| Action | "Acknowledge" 32 px (`sm`) secondary button for `alerts:write` on New rows; More menu: Open entity, Open rule, Copy link | 120 px |

Rules:
- Group rows (rule plus date) show the rule name, date and count, sort by highest severity then count, and expand to their events. Expansion state lives in the URL with the filters.
- Row click opens the entity inspector, not an event detail. The event's evidence (values, thresholds, compared checks) is in the entity inspector's Timeline tab, where the event is highlighted.
- Bulk acknowledge: checkbox selection, then "Acknowledge 23 events" in the bulk bar. The action scope follows [12-tables.md](12-tables.md) section 14 (up to 10,000 events); the client sends requests of up to 500 events ([19-api-specification.md](../19-api-specification.md)).
- Held rows use `foreground-secondary` text and the status "Held". The anomaly hold banner sits above the table for any held day in the window (section 8.3).
- Muted rows show the flapping note: "Muted until Oct 6 after 3 firings in 7 days" ([08-seo-keyword-system.md](../08-seo-keyword-system.md) section 12.2).

## 7. EventTimeline

The historical event list for one object. Used in Keyword Detail (events and ranking URL changes), Prompt Detail (History tab), Page Intelligence, the Timeline tab of the keyword inspector and the History tab of the prompt inspector ([23-application-patterns.md](23-application-patterns.md) section 4.2).

`EventTimeline` rows use the change feed row style of section 7.1, the same style as `ChangeFeed` on Overview ([23-application-patterns.md](23-application-patterns.md) section 9.2). Only the content differs: `EventTimeline` lists the events of one object, `ChangeFeed` the key changes of a project.

```
[ All events 12 ] [ Rank 5 ] [ URL 1 ] [ AIO 2 ] [ AI 4 ]                     CountTabs filter

+----------------------------------------------------------------------------------------+
| Sep 29 · 2 events                                                                      |  day header row
|----------------------------------------------------------------------------------------|
| 10:24  [↗] Rank improved #8 → #4, best crm for startups [Ranking]       Google    View |  36 px row
| 06:12  [~] AI Overview appeared, own page cited #2      [SERP feature]  Google    View |
+----------------------------------------------------------------------------------------+

+----------------------------------------------------------------------------------------+
| Sep 26 · 1 event                                                                       |
|----------------------------------------------------------------------------------------|
| 14:21  [f] Ranking URL changed /blog/crm → /pricing     [URL]           Google    View |
+----------------------------------------------------------------------------------------+

                                  [Show older events]
```

### 7.1 Change feed row style

| Part | Specification |
|---|---|
| Structure | One `<section>` per day with a visible day heading (`h3` on a page, `h4` in an inspector section); an `<ol>` of events inside; each event `<li>` contains a `<time datetime>` |
| Day group | On pages: one panel per day (`surface`, 1 px `border`, radius 8, no shadow), 16 px between day panels. In the inspector and in a detail page rail: the day groups sit inside the section without their own panel border, separated by the day header row |
| Day header row | 40 px, 16 px horizontal padding (12 px in the inspector), 1 px `border-subtle` bottom border. The day ("Today", "Yesterday", then "Sep 26"; "Sep 26, 2025" when not the current year) in `type-subsection-title` (14 / 20 px, 600), then "· 7 events" in `type-meta` |
| Row | 36 px, 16 px horizontal padding (12 px in the inspector), 1 px `border-subtle` divider between rows. One line; a sentence that does not fit wraps to two lines at most and the row grows. No connecting rail line, no timeline dots, no cards |
| Time | First column, fixed width so times align: `HH:MM`, 13 px (`type-meta`), `num`, `foreground-tertiary`. The full date and time with timezone are in its tooltip |
| Icon | 16 px, 12 px after the time, glyph by event type (table below). Rank moves use `TrendingUp` or `TrendingDown` in `positive-text` or `negative-text` only when the move is emphasized by `formatRankChange` ([14-badges-status.md](14-badges-status.md) section 5); unemphasized rank moves and every other event type are `foreground-tertiary`. The icon is `aria-hidden`; the sentence carries the meaning |
| Sentence | `type-body` (14 / 20 px), `foreground`, 12 px after the icon. Entity names (keyword, domain, engine, "AI Overview") in weight 500; links to pages or URLs in `primary-text`. Inline values use tabular numbers; the arrow "→" joins before and after values ("#8 → #4", "/blog/crm → /pricing"). Change copy per [22-content-formatting.md](22-content-formatting.md) section 7 |
| Value colour | A changed value inside the sentence follows [02-color-system.md](02-color-system.md) section 6: coloured only when beyond normal movement or detectable, otherwise `foreground` |
| Type badge | A neutral badge (`neutral-subtle` fill, `neutral-text`, 22 px, radius 4) naming the event type: "Ranking", "URL", "SERP feature", "AI answer", "Citation", "Competitor", "Version", "Alert". Left-aligned in a fixed column so badges align across rows |
| Source | `type-meta`, `foreground-tertiary`, in a fixed column after the badge: the engine or system that produced the event ("Google", "ChatGPT", "AI Overview", "System") |
| View link | Right-aligned "View" in `type-body`, `link` (`primary-text`). It opens the evidence that proves the event: the SERP snapshot, run, answer evidence or release note. Accessible name names the evidence ("View SERP snapshot, Sep 29") |
| Narrow containers | In the inspector and in a detail page rail, the type badge and source columns are hidden; the source joins the View link's accessible name and tooltip. Time, icon, sentence and View stay |
| Paging | Latest 50 events; "Show older events" (36 px secondary button on pages, 32 px in the inspector) loads 50 more. The inspector shows the latest 10 (the inspector list cap, [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.4) with "Open full timeline" |

Event type glyphs:

| Event type | Glyph |
|---|---|
| Rank improved or declined, entered or left top N | `TrendingUp` or `TrendingDown` by direction |
| New or lost ranking | `ListOrdered` |
| Ranking URL changed | `FileText` |
| SERP feature gained or lost, AI Overview appeared or disappeared | `ScanSearch` |
| AI citation gained or lost | `Link2` |
| AI mention gained or lost | `AtSign` |
| Competitor overtook | `Users` |
| Version boundary (prompt version, extractor, model, panel membership) | `GitCommitVertical` |
| Alert fired | severity icon |

Filters: a `CountTabs` row above the list ([09-buttons-controls.md](09-buttons-controls.md)): "All events" and one item per event type present in the list, each with its count in a count badge. Items are bordered, 36 px on pages and 32 px in the inspector. A selected item is solid `primary` with a white (`primary-foreground`) label and a deeper blue count badge; unselected items have neutral count badges. Behaviour is unchanged: "All events" clears the type filters, each type item is a toggle button (`aria-pressed`) and several types can be on at once. Filter state is local to the component and mirrored to the URL on full pages (`?events=rank,url`).

Empty: inline `EmptyState` "No events in this window", reason "Rank changes, URL changes and AI events for this keyword appear here."

## 8. Aggregation, digests, hold and mute

### 8.1 Aggregation display

- Grouping key everywhere in the UI: rule, event kind, project and day. The notification center collapses groups of 3 or more (section 5.4); the Alerts screen always groups (section 6).
- Group copy states the count and the subject type: "12 similar events" as the disclosure label, "Rank improved 3 or more positions · 12 keywords" as the title.
- Groups sort by highest severity, then by the sum of search volume or prompt importance, matching digest order ([08-seo-keyword-system.md](../08-seo-keyword-system.md) section 12.2).

### 8.2 Digests

Route `alerts/digests`. A table of sent digests (mode, period, event count, channels, anomaly hold flag). The digest detail page renders the digest as it was sent: groups by rule, top 20 items inline, escaped text only, and a link to the full event list for the period. The page states "Sent Sep 29, 09:00 CEST to email (4 recipients) and Slack (#seo-alerts)".

### 8.3 Anomaly hold notice

When the mass-movement check flags a day (more than 30% of comparable keywords moved more than 10 positions, [17-statistical-methodology.md](../17-statistical-methodology.md) section 10), alerts for that day are held and one notice is sent instead.

| Surface | Presentation |
|---|---|
| Notification center | One warning item: "Alerts held for Sep 28", line 2 "64% of comparable keywords moved more than 10 positions", line 3 "Acme CRM · 312 events held" |
| Alerts events screen | Warning banner for each held day in the window: "Alerts for Sep 28 are on hold: 64% of comparable keywords moved more than 10 positions. This pattern comes from a collection anomaly or a search engine update. 312 events held." Action "Review held alerts" filters the table to status Held |
| Rank Tracker and Overview for that date | Info banner: "Sep 28 shows unusual rank movement across this project. Alerts for that day are on hold." |
| Digests | The digest row carries the "Anomaly hold" flag |

Copy names both explanations and does not guess between them. The held events stay visible with status Held.

### 8.4 Flapping mute

A subject that fires the same rule type 3 times in 7 days is muted for 7 days. The Status column shows "Muted" with "until Oct 6"; the notification center shows one info item "Muted after 3 firings in 7 days" for that subject; the digest carries the same note.

## 9. Alert copy rules

1. **Neutral and precise.** State the event and its values. No exclamation marks, no emoji, no judgment words ("great", "alarming", "huge"), no second person urging ("You should act now").
2. **Sentence case**, event phrase first, entity separate. The title is a fixed catalogue phrase per rule type so events group and scan; the entity and values go on the next line or column.
3. **Numbers from `@/lib/format`**: ranks as "#4", changes as positions, rates as "3 of 4 answers" when n is small, percentages with the rules in [22-content-formatting.md](22-content-formatting.md).
4. **Uncertainty is named**: AI rules that fire without meeting detectability say "possible change" ([11-ai-prompt-system.md](../11-ai-prompt-system.md) section 10). "Detectable change" is used only when the API reports `is_detectable: true`.
5. **Arrows only between values**: "#8 → #4", never as decoration.
6. **No dashes as punctuation**; ranges use "to".

Catalogue (examples):

| Rule type | Title | Line 2 |
|---|---|---|
| `entered_top_n` | Keyword entered top 10 | crm for startup #12 → #8 |
| `lost_top_n` | Keyword left top 10 | crm pricing #9 → #14 |
| `rank_drop` | Rank dropped 7 positions | best crm for startups #4 → #11 |
| `lost_ranking` | Keyword lost ranking | crm software reviews, not in top 20 (last seen #18) |
| `aio_citation_lost` | AI Overview citation lost | best crm for startups, acme.com/pricing was #2 |
| `ai_citation_lost` | AI citation lost | "best crm for a 20-person startup" · ChatGPT, cited in 0 of 4 answers (was 3 of 4) |
| `ai_mention_gained` | AI mention gained (possible change) | "crm with email sync" · Gemini, 3 of 4 answers (was 0 of 4) |
| `ai_panel_change` | Core panel mention rate changed | ChatGPT 34% → 29%, detectable change |
| `competitor_overtook` | Competitor overtook domain | hubspot.com #3 passed acme.com #4 on best crm for startups |
| `url_changed` | Ranking URL changed | crm pricing /blog/crm → /pricing |
| `ai_model_changed` | New model version reported | ChatGPT reports gpt-5.2; charts show a version boundary |
| `ai_collection_degraded` | AI collection degraded | Gemini, 81% of answers valid in run 4790 (90% expected) |
| Provider run failure | Provider collection failed | Rank checks, 23 of 1,000 failed |
| Budget soft limit | API budget threshold reached (80%) | Project budget, $1,600 of $2,000 used |

Rewrites:

| Do not write | Write |
|---|---|
| Great news! You're in the top 10! | Keyword entered top 10 |
| Warning: huge ranking drop detected | Rank dropped 7 positions |
| Uh oh, ChatGPT stopped citing you | AI citation lost |
| Something went wrong with collection | Provider collection failed |
| You're about to run out of budget! | API budget threshold reached (80%) |

## 10. Link format for email, Slack and webhooks

Email and Slack rendering is outside UI scope, but their links land in the UI and must open the exact view:

| Target | URL |
|---|---|
| Keyword event | `https://app.<domain>/<ws-slug>/<project-slug>/seo/rankings?inspect=keyword:<tkId>&itab=timeline&notif=<event_id>` |
| Prompt event | `.../ai/prompts?inspect=prompt:<promptId>&itab=history&eng=<engine>&notif=<event_id>` |
| Event group | `.../alerts/events?rule=<rule_id>&date=2026-09-29` |
| Digest | `.../alerts/digests/<digest_id>` |
| Run | `https://app.<domain>/<ws-slug>/ops/runs/<runId>` |

Rules:
- Links carry ids, slugs and filter codes only. Keyword text, prompt text, answer text and personal data never appear in URLs ([19-api-specification.md](../19-api-specification.md) webhook payload rule).
- `notif=<event_id>` marks the matching notification read on arrival and is then removed from the URL with a replace.
- Links survive sign-in through `/login?next=<path>`. A link to an object the user cannot access renders the 404 page, which never confirms that the object exists.
- The inspector parameters follow [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.7, so a notification opens the list with its filters and the inspector.

## 11. Accessibility

- Toast region: Base UI Toast viewport, a labelled landmark ("Notifications") reachable with F6. Toasts do not take focus when they appear. Timers pause while a toast has focus (WCAG 2.2.1).
- Error toasts announce assertively; all other toasts and new banners announce politely; banners present at load are not announced.
- The bell's accessible name includes the unread count; the count change is not announced on every poll.
- Notification items expose one accessible name that reads title, entity, values, project and time in that order; the unread state is part of the name ("Unread. Keyword entered top 10, ...").
- Severity is conveyed by icon plus text or accessible name, never colour alone.
- Everything in this document works with keyboard only, and every action in a hover menu has a keyboard path.

## 12. Component summary

| Component | Primitive | Section |
|---|---|---|
| `Toaster`, `toast()` | Base UI Toast | 3 |
| `Banner` (info, warning, negative; page, region) | none | 4 |
| `NotificationBell`, `NotificationCenter`, `NotificationItem`, `NotificationGroup` | Base UI Popover; Drawer on mobile | 5 |
| `SeverityIcon`, `SeverityLabel` | none | 2 |
| `AlertEventsTable` | `DataTable` | 6 |
| `EventTimeline` (change feed row style) | none | 7 |
| `AnomalyHoldNotice` | `Banner`, `NotificationItem` | 8.3 |
| `DigestView` | none | 8.2 |
| `AlertRuleList` | `Switch` | 13 |

The inventory with props and ownership is in [25-component-inventory.md](25-component-inventory.md).

## 13. Alert rule list

Alert rules are managed in Settings, Alerts ([24-page-templates.md](24-page-templates.md), T4). The list of a project's rules renders as a rule list: one panel with one row per rule.

```
+--------------------------------------------------------------------------+
| [~]  Keyword position changes                                     (on )  |
|      When a keyword moves by 3 or more positions                         |
|--------------------------------------------------------------------------|
| [@]  AI answer mentions                                           (on )  |
|      When fieldnote.io is cited or stops being cited                     |
+--------------------------------------------------------------------------+
```

| Part | Specification |
|---|---|
| Container | One panel: `surface`, 1 px `border`, radius 8, no shadow. Rows are divided by 1 px `border-subtle` |
| Row | 16 px padding; the icon, the text block and the switch on one row, the text block taking the free width |
| Icon | 16 px, `foreground-secondary`, top-aligned with the title; the glyph of the rule's event type (section 7.1 table) |
| Title | 14 px weight 600 (`type-subsection-title`), `foreground`; a link to the rule editor |
| Description | 13 px `type-meta` (`foreground-tertiary`), one sentence stating the trigger, directly below the title |
| Switch | Right-aligned, vertically centered: 36 x 20 px, `primary` track when on ([09-buttons-controls.md](09-buttons-controls.md) section 8.3). Its accessible name is the rule title ("Keyword position changes"); its state is on or off. It shows and sets the rule's enabled state and saves at once, as an auto-save switch ([10-forms.md](10-forms.md) section 13.3) |
| Actions | "New rule" is a secondary button in the panel title row or page header, per [09-buttons-controls.md](09-buttons-controls.md) section 2.6 |
| Hover | None on the row; the title link and the switch have their own states |

The rule's delivery settings, thresholds and scope are edited in the rule editor, not in the list.

