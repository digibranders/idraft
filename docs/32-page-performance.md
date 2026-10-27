# 32. Page Performance (Search Console health per URL)

Status: Draft for the product owner's review; requirement received 2026-10-27
Last updated: 2026-10-27
Related: [18-first-party-integrations.md](18-first-party-integrations.md) sections 3, 4 and 12; [04-data-model.md](04-data-model.md) section 10; [19-api-specification.md](19-api-specification.md) sections 2.6 and 11.4; [20-frontend-specification.md](20-frontend-specification.md) sections 5.5 and 5.15; [16-metrics-methodology.md](16-metrics-methodology.md); [17-statistical-methodology.md](17-statistical-methodology.md); [24-security.md](24-security.md) sections 3.2 and 6; [29-phase-roadmap.md](29-phase-roadmap.md) section 1.1; design system [15-data-visualization.md](design-system/15-data-visualization.md), [13-filters-search.md](design-system/13-filters-search.md), [16-drawers-dialogs-popovers.md](design-system/16-drawers-dialogs-popovers.md)

Labels as in doc 18: **(verified date)** marks a fact read on a primary page, **INFERRED** marks our reasoning, **UNVERIFIED** marks a claim to confirm in a spike, **Decision** marks a design choice.

## 1. Summary

A team picks the important pages of a site (pricing, product pages, top articles). The product watches them in Google Search Console data and answers, for each page and for any month or date range: is this page healthy, what changed against the previous period, and why. Every Search Console filter that matters (country, device, search type, query, date) works the same way on the list and on the page detail. The whole feature is built on the Search Console connection of doc 18 and adds no new data source.

The selling point is simplicity. Search Console can show every number this feature shows, but a person has to build the same filtered report again for each URL, set the comparison by hand, switch tabs to find the cause, and cannot see several URLs next to each other with their changes. Section 3 lists the specific pains and the answer to each.

## 2. Goals, non-goals and principles

**Goals**

1. One screen lists all watched pages with clicks, impressions, CTR, position, the change against the previous period, and a plain health verdict. The pages that need attention come first.
2. One click on a page opens its detail (drawer or full page) with the comparison already running, a chart of this period against the previous one, and a short written answer to "what changed".
3. Filters (date, comparison, country, device, search type, query) are set once, shared by the list and the detail, and live in the URL so a link reproduces the view.
4. A monthly review takes minutes: last full month against the month before, stepping through the watched pages with the keyboard, then an export.

**Non-goals (this document)**

- Site-wide Search Console reporting, the query explorer and the keyword inbox. These are section 5.15 of doc 20 and Phase 11.
- Rewriting Google's numbers. Every figure is Google's, labeled "Google Search Console", dated in Pacific Time, and never merged with our own rank or AI observations (doc 18 principle 1).
- Bing, GA4 and Cloudflare per page. The detail is built so those panels can be added later (slice 4).
- Alerts, scheduled digests and annotations are in the plan as slices 3 and 4, not in the first release.

**Principles (the simplicity rules every screen is reviewed against)**

| # | Rule | Consequence |
|---|---|---|
| S1 | Comparison is on by default | A person never opens a page to see a bare number. The default is the last complete month against the month before it (D-PP-7) |
| S2 | Answers before charts | Each page opens with a verdict sentence and the three biggest drivers, then the chart |
| S3 | Set a filter once | One filter state per screen, shared by list and detail, kept in the URL |
| S4 | Plain words for direction | Position is stated as "improved by 2.1 places", never as a negative number that reads as bad |
| S5 | No false alarms | Provisional days and tiny numbers never produce a red or green change (sections 5.5 and 6) |
| S6 | Never a dead end | Every empty, syncing, no-data and no-access state says what happened and the next step |
| S7 | One concept per control | A metric is a checkbox, a filter is a chip, a comparison is one select. No hidden modes |

## 3. What is hard in Search Console, and what this feature does about it

| Pain in Search Console | Answer here |
|---|---|
| Looking at a page means adding a Page filter by hand, every visit | A saved watchlist; one click opens the page, with the filters you already chose |
| Comparison is a separate dialog, reset when you change view | Comparison is a standing control, default on, kept in the URL |
| Several pages cannot be compared side by side with their changes | The list shows every watched page with its change, sortable by who dropped most |
| Finding the cause means switching Queries, Countries and Devices tabs and subtracting in your head | A "What changed" panel names the country, device and queries that explain the move, with a bar per row for its share of the change |
| Position goes up when the page gets worse, which confuses reports | Position wording and colors follow the direction of improvement (S4) |
| Fresh days are incomplete, so the last week always looks like a collapse | The default window ends on the last final day; provisional days are hatched and excluded unless switched on |
| Only 16 months of history | We keep our copy of the daily rows for watched pages (workspace retention, doc 04 section 12) |
| The chart overlays up to four metrics on shared axes | One metric, two on dual axes, or small multiples with a shared crosshair (section 5.7) |
| Nothing links the page to rankings or AI answers | The detail carries a separately labeled panel of our tracked keywords and citations for the same URL (slice 4) |
| A report for a client is a screenshot | CSV export and a shareable link; digest later |

## 4. Users and jobs

| Job | Who | Frequency | What they need |
|---|---|---|---|
| Monthly review | SEO lead, account manager | Monthly | All important pages, month against month, worst first, exportable |
| Investigate a drop | SEO specialist | When a page falls | The cause by country, device and query, and the dates it started |
| Check a change | Content or developer | After an edit or release | This page, 28 days after against 28 days before, same filters |
| Report | Account manager | Monthly | The numbers and a sentence, ready to paste |

Permissions follow doc 24 section 3.2: `data:read` to view; a new key `pages:write` to add, remove and group watched pages (owner, admin and editor, the same roles as `keywords:write`); `integrations:manage` to connect Search Console (owner and admin). **Decision D-PP-1:** a new `pages:write` key rather than reusing `keywords:write`, because a role may manage keywords without managing which pages are watched.

## 5. Product design

### 5.1 Where it lives

The sidebar destination **Pages** (`/seo/pages`) gets two tabs: **Landing pages** (Page Intelligence, doc 20 section 5.5) and **Performance** (this feature). Routes, all under `[workspace]/[project]/seo/pages`:

| Route | Content |
|---|---|
| `performance` | Watchlist table with the filter bar; the page detail opens as a drawer, state in `?page=<urlId>` |
| `performance/[urlId]` | The same detail as a full page, for sharing and for a wider chart |
| `[urlId]` (existing) | Page Intelligence gains a "Search performance" section that mounts the same detail component |

**Decision D-PP-2:** one detail component with two shells (drawer and page), so there is one implementation and one set of tests. The static `performance` segment wins over the dynamic `[urlId]` segment in Next.js routing; a URL id can never be the string `performance` because ids are numbers.

Phase gating follows doc 20 section 3.10: the Performance tab is hidden until Search Console is connected on the project, then shows; before that the tab shows the connect state (5.9).

### 5.2 The list

```
+-----------------------------------------------------------------------------------------------+
| Pages        [ Landing pages ]  [ Performance ]                                               |
|-----------------------------------------------------------------------------------------------|
| Date [Last 28 days v]  Compare [Previous period v]  Country [All v]  Device [All v]           |
| Search type [Web v]   + Group [All v]                         Data through 2026-10-24 (PT)    |
|-----------------------------------------------------------------------------------------------|
| 41 pages   Declining 6   Growing 9   Stable 24   Low data 2          [Add pages] [Export CSV] |
|-----------------------------------------------------------------------------------------------|
| [] Page                       Group    Health      Clicks         Impr.        CTR     Position|
| [] /pricing                   Money    Sharp drop  317  -23.0%    41.2K +4%    0.8% -0.2  5.9 v 2.1 |
| [] /blog/seo-audit-guide      Blog     Declining   1.1K  -14.4%   96K  -2%     1.1%    7.8 v 0.9 |
| [] /product/rank-tracker      Money    Growing     842  +18.2%   30K  +9%     2.8%    4.2 ^ 1.3 |
+-----------------------------------------------------------------------------------------------+
```

- The summary line counts pages by health and filters the table when a count is clicked.
- Columns: Page (path first, host muted), Group, Health chip, Clicks, Impressions, CTR, Position (each with current value, the change, and for position the words "improved" or "slipped"), a 28-point clicks sparkline (current period), and the Indexing status of the page (D-PP-8). Column chooser per doc 20 section 4.
- **Default sort: attention first.** Sharp drop, then Declining by absolute click loss, then the rest by clicks. This is the opposite of Search Console's default (clicks descending) and is the point of the screen. The sort is a normal column sort that the user can change; the URL keeps it.
- Rows are selectable for bulk actions: set group, remove from watchlist, export selection.
- Row click opens the drawer. Keyboard follows the grid model of doc 20 section 4.8.
- Client-side table mode (the watchlist is capped at 200 pages by default, section 9), with the server computing all metrics for the chosen filters.

### 5.3 The detail (drawer or page)

```
+--------------------------------------------------------------------------+
| /pricing                    acme.com        [open page] [copy URL] [<][>]|
|--------------------------------------------------------------------------|
| [Sharp drop]  Clicks are down 23% (412 to 317) against 28 Aug to 24 Sep. |
|  Mobile in India explains most of it. Position slipped 2.1 places.       |
|--------------------------------------------------------------------------|
| Date [Last 28 days v] Compare [Previous period v] Country Device Type    |
| Query [contains v] [ ........ ]   (live from Google)                    |
|--------------------------------------------------------------------------|
| [x] Clicks        [x] Impressions   [ ] CTR            [ ] Position       |
|     317 vs 412        41.2K vs 39.6K    0.8% vs 1.0%       5.9 vs 3.8     |
|     -23.0%            +4.0%             -0.2 pts           slipped 2.1    |
|--------------------------------------------------------------------------|
| Clicks                                                                   |
|  /\    /\_   current ----   previous - - - (aligned by day number)       |
| ____/  \/    \__                                                         |
| Impressions                                                              |
|  ...                                                                     |
|--------------------------------------------------------------------------|
| What changed:  [Countries] [Devices] [Queries] [Search appearance]       |
| Country        Clicks now  Before   Change   Share of the change        |
| India          88          201      -113     =========== 66%            |
| United States  120         118      +2       .                           |
|--------------------------------------------------------------------------|
| Other channels for this page (slice 4): Tracked keywords, AI citations   |
+--------------------------------------------------------------------------+
```

Parts in order:

1. **Header.** Path, host, open and copy actions, and previous and next arrows that move through the list in its current sort **without losing any filter** (also `j` and `k`). This is what makes the monthly review fast.
2. **Verdict card.** The health chip and one to three sentences produced by deterministic rules (section 6.3). No language model is involved, so the text is testable and free. The index status is the card's second row (state, reason, "Check now"); the crawl and check dates are a tooltip. The method version is not shown on screen. A position flag is not repeated here, because the tile shows it.
3. **Filters.** The same state as the list (S3). Period, comparison, country and device are always visible. Search type and the query condition sit behind one "More filters" button that shows how many are on (D-PP-10). Date, comparison, country, device and search type are stored filters (instant). Query and search appearance are live filters, marked "live from Google" because each change calls Google (section 7.5).
4. **Metric tiles.** Four tiles in the style of Search Console, each a checkbox: label, current value, previous value, change. The checked tiles drive the chart, up to four at once, each with its own series color. Default checked: Clicks and Impressions. **More metrics** (D-PP-9) adds optional tiles, each labeled with its source and off by default: Share of site clicks (Search Console, page clicks over the property's clicks), Tracked keyword rank (our rank tracking, average of the tracked keywords whose ranking URL is this page), AI citations (our AI tracking), and Sessions and Conversions (Google Analytics 4, once that connection exists). Rank and AI metrics are not split by country or device, and the tile says so; a page with no tracked keywords or no AI citations shows "No data" with the reason.
5. **Chart** (section 5.7).
6. **What changed** (section 5.8).
7. **Other channels** (slice 4): our tracked keywords whose ranking URL is this page, and AI citations of this page, each labeled with its own source and never mixed into the Google numbers.
8. **Data note footer:** "Google Search Console. Dates are Pacific Time. Final data through 2026-10-24. 2 days are provisional and excluded." Query rows add "The query list covers 88% of this page's clicks; the rest are anonymized queries Google does not report."

### 5.4 Filters

| Filter | Values | Tier | Search Console equivalent | Notes |
|---|---|---|---|---|
| Period | A month picker (default: the last complete month), quick ranges (Last 7 days, Last 28 days, Last 3 months, Whole history) and a custom range of two dates | Stored | Date | Ends on the last final day by default (5.5). D-PP-7 |
| Compare | Previous period (default), Same period last year, Previous month, Custom range, None | Stored | Compare | "Previous month" appears when the range is one calendar month |
| Country | Multi-select, searchable, shows countries with data first | Stored | Country | ISO 3166-1 alpha-3 internally, names shown |
| Device | Desktop, Mobile, Tablet; multi-select | Stored | Device | |
| Search type | Web (default), Image, Video, News, Discover, Google News | Stored | Search type | Web multimodal is UI-only in Google and is not available (doc 18 section 4.2) |
| Group | Our watchlist groups | Stored | none | Our addition; filters the list |
| Query | contains, does not contain, equals, matches regex | Live | Query | Detail only. Works on the Queries tab and on the tiles and chart (section 7.5) |
| Search appearance | Google's list for the page (FAQ, videos and so on) | Live | Search appearance | Detail only; slice 2. Needs the two-step query of doc 18 section 4.2 |

**Not offered, by design.** The Page filter (the watchlist and the group filter replace it) and Web multimodal. Every other Search Console filter has a row above. The detail also drills down: clicking a row in the What changed tables applies that country, device or query as a filter chip, so the next question is one click away.

All filter values live in the query string with the `nuqs` parsers of doc 20 section 3.6; defaults are omitted from the URL.

### 5.5 Comparison semantics

1. **Default window.** The range ends on the last day Google has finalized (doc 18 section 4.4 final probe), not on yesterday. Provisional days are fetched, hatched on the chart and excluded from tiles and verdicts unless the user switches on "Include provisional days". **Decision D-PP-3:** this default prevents the false collapse that fresh, incomplete days create in the current period. A banner names the excluded days.
2. **Previous period** is the window of equal length ending the day before the current one starts. **Same period last year** is the same dates one year earlier (leap day handled by calendar date). **Previous month** is the calendar month before. **Custom** takes any two ranges.
3. **Unequal lengths.** When the two ranges have different day counts (for example 31 days against 28), clicks and impressions changes are computed on the per-day average and the tile says "per day, 31 against 28 days". CTR and position are ratios and need no adjustment.
4. **History limit.** The comparison range must start on or after our earliest stored day for that page. If it does not, the compare control explains the earliest available date instead of showing zeros.
5. **Chart alignment.** The two series are aligned by day number within the range (day 1 with day 1). The tooltip shows both real dates. Weekday mix can differ between ranges that are not multiples of seven days; the footer says so when it does.
6. **Aggregation.** Clicks and impressions are sums. CTR is summed clicks over summed impressions. Position is the impression-weighted average, `sum(position_sum) / sum(impressions)` (doc 18 section 10). A filter changes the rows summed, never the formula.

### 5.6 Metrics and wording

| Metric | Value shown | Change shown | Direction |
|---|---|---|---|
| Clicks | integer, compact over 10,000 | percent, with the absolute difference in the tooltip | up is better |
| Impressions | same | same | up is better |
| CTR | one decimal percent | percentage points ("-0.2 pts") | up is better |
| Position | one decimal | "improved by 2.1" or "slipped 2.1" in places | lower is better; the arrow and color follow improvement |
| Share of site clicks | one decimal percent | percentage points | up is better |

Colors follow the color semantics of doc 20 section 4.7, with "detectable" decided for first-party counts by the rules of section 6 (these are census counts, so the interval rule of doc 17 section 6.2 does not apply): a change is colored only when it is material, otherwise grey with "within normal range". Position below 20 impressions in either period shows "Insufficient data" (doc 20 section 4.5). Impressions are Google's page-level counts, so the sum over pages is not a site total and no screen adds them up as one (doc 18 section 4.2).

### 5.7 Chart

Built from the existing chart frame and ECharts wrapper with the design system rules of doc 15 section 4.

- **One metric:** one chart, current solid in `chart-1`, previous dashed in `chart-reference`, 240 px.
- **Two to four metrics:** small multiples (140 px each, synced crosshair through `echarts.connect`). There is no overlay: two units on one chart with two axes are the unreadable part of Search Console (D-PP-10).
- **Granularity:** day for ranges up to 31 days, week up to 16 weeks, month beyond; a segmented control overrides it. A week is a block of 7 days counted from the start of the range, labeled by its first day, so both periods are cut the same way.
- **Position chart** has an inverted axis so improvement rises.
- Provisional days are hatched with the tooltip "Provisional: Google may still revise this day" (doc 18 section 4.4).
- Zero-impression days draw as gaps for position and CTR, and as zero for clicks and impressions.
- A table view of the same series (a toggle) serves screen readers and export (doc 20 section 4.10, design system 20).

### 5.8 What changed

The tabs list the items that moved the chosen metric (the first checked tile). Each table has columns Item, Now, Before, Change, and a bar for the item's share of the net change (signed, so gains and losses are visible at once).

| Tab | Source | Rows | Extra |
|---|---|---|---|
| Countries | Stored | All countries with data in either period | Country filter on click |
| Devices | Stored | Desktop, Mobile, Tablet | Device filter on click |
| Queries | Live | Top 1,000 by absolute change | Switch: Biggest losers, Biggest gainers, New queries, Lost queries; query filter on click; the coverage note of 5.3 |
| Search appearance | Live (slice 2) | Appearances present in either period | |

**Decision D-PP-4:** queries are fetched live and cached rather than stored for every watched page in the first release (section 7.5). The cost is a visible half-second to three seconds the first time a page is opened for a given filter; the benefit is no storage and no backfill of query-level rows, which are the expensive ones. Stored daily query rows for watched pages are a possible later upgrade (open question PP-Q4) that would add long query history and a "queries lost since" timeline.

### 5.9 Adding pages

Dialog **Add pages**, with three sources:

1. **Paste URLs** (one per line, up to 500). The API validates each: the host must belong to the connected property; the URL is canonicalized through `core.urls` (doc 04 section 5.1); duplicates are reported. For each URL the dialog shows the result of a probe against Search Console: "Found, 1,240 clicks in the last 28 days", "Found in 2 forms (with and without trailing slash), they will be added together", or "No search data in the last 28 days" (allowed; the page shows "No data yet").
2. **Suggested from Search Console.** The 25 pages with the most clicks in the last 28 days that are not yet watched, from one live call. Tick and add.
3. **From a sitemap URL** (slice 2). Fetched with the SSRF controls of doc 24 section 7.3, with a preview and a count. Import from CSV reuses the import wizard (slice 2).

Also: a **Watch this page** button on Page Intelligence and on the keyword and ranking-URL surfaces (the rank columns already show ranking URLs), all opening the same dialog with the URL filled in.

**URL forms.** Google may report one page under several strings (with and without a trailing slash, `http` and `https`, `www`). When a page is added, the probe lists the exact strings Google uses and stores them in `core.watched_pages.gsc_page_forms`. Pulls ask for each form and the ingest sums them (doc 18 section 4.7 collapse rule, with the collapse count logged). A nightly job re-checks the forms for pages whose clicks fall to zero (a changed URL form is a classic cause) and reports it as a flag on the page.

### 5.10 States

| State | Shown | Next step offered |
|---|---|---|
| Search Console not connected | Empty state with a one-line value statement and a "Connect Search Console" button (owner or admin); others see "Ask an owner or admin to connect Search Console" | Connect |
| Connected, no pages watched | Empty state: "Add the pages that matter" with the three sources of 5.9 | Add pages |
| First sync running | Banner "Loading your history, 14 of 486 days" and the list shows pages with a progress cell | Wait; the last 28 days load first (doc 18 section 4.3 ordering) |
| `reauth_required` | The doc 18 banner "Sync paused since <date>", existing data stays visible | Reconnect |
| Page has no data in range | Row shows "No data"; detail explains "Google reported no impressions for this page in these filters" and offers to widen the filters | Clear filters |
| Low data | Health chip "Low data" with the counts | None needed |
| Live query rate limited | Inline "Google is busy. Retrying in 20 s" with a retry button; stored tabs keep working | Retry |
| Permission missing | The Add and Remove actions are absent, not disabled (doc 20 section 3.9) | None |

### 5.11 Keyboard and accessibility

The list follows the grid keyboard model already built for the keyword table. In the detail: `j` and `k` move to the next and previous page, `[` and `]` change the comparison preset, `e` exports, `Escape` closes the drawer and returns focus to the row. Metric tiles are checkboxes with visible labels; chart colors never carry meaning alone (the previous series is dashed and the health chip has text); the table view mirrors the chart. Contrast, focus and reduced-motion rules of design system 20 apply, and the sparkline is `aria-hidden` with the numbers beside it.

## 6. Health model (`page_health_v1`)

A pure function in `backend/src/idraft/domain/page_performance/health.py` (no database, no I/O), with its constants in one table below and a method version stored in `ops.component_versions` like other metric methods. It takes the current and previous totals of clicks and impressions (after the filters and provisional rules) and returns a verdict plus flags.

### 6.1 Verdict

| Verdict | Rule (evaluated in order) |
|---|---|
| `no_data` | Impressions are zero in both periods |
| `new` | Previous impressions are zero and current impressions are above zero |
| `lost` | Previous clicks are at least 25 and current clicks are zero |
| `low_data` | Clicks over both periods are under 30 and impressions over both periods are under 300 |
| `low_data` (small numbers) | None of the four change rules below applies because the absolute change is under the minimum, yet the change is 10% or more either way. The sentence says so ("Small numbers: clicks went from 27 to 4. That is under 25 clicks of difference, so it is not treated as a real change.") instead of calling a fall from 27 to 4 "steady" |
| `sharp_drop` | Basis metric change is at or below -40% and the absolute change meets the minimum |
| `declining` | Basis metric change is at or below -10% and the absolute change meets the minimum |
| `growing` | Basis metric change is at or above +10% and the absolute change meets the minimum |
| `stable` | Otherwise |

The **basis metric** is clicks when the two periods together have at least 30 clicks, otherwise impressions. The absolute minimum is 25 clicks or 500 impressions respectively. When the periods have unequal lengths the change uses per-day averages (5.5). Verdicts use final days only.

**Decision D-PP-5:** the thresholds are constants in `page_health_v1`, not user settings, in the first release. They are conservative on purpose (S5). A workspace setting is open question PP-Q2; changing a constant bumps the method version and the UI shows it in the methodology page.

### 6.2 Flags (secondary, each with its plain sentence)

| Flag | Rule | Sentence |
|---|---|---|
| `ctr_fell_impressions_rose` | CTR down by at least 15% relative while impressions are up by at least 10% | "Impressions rose but fewer people clicked. Check the title and snippet, and whether an AI answer now sits above the result." |
| `position_slipped` | Position worse by at least 1.5 places with at least 100 impressions in each period | "Average position slipped 2.1 places." |
| `position_improved` | Mirror of the above | "Average position improved 1.3 places." |
| `segment_drives_change` | One country and device pair, one country or one device (tried in that order) carries at least 50% of the net click change, at least 25 clicks of it, and at least 1.5 times its usual share of the page's clicks (so the biggest segment of a mostly desktop page does not "explain" every change) | "Mobile in India explains most of it (71% of the change)." |
| `index_status_changed` | The index status is not "Indexed" and changed inside the current period | "Google dropped this page from its index on Sep 12: crawled, currently not indexed." |
| `url_form_changed` | Clicks fell to zero while another string for the same path has clicks (5.9) | "Google now reports this page under a different URL form." |
| `provisional_excluded` | Provisional days were excluded | "2 days are still provisional." |

### 6.3 The verdict sentence

Template per verdict with the numbers filled in, then up to two flag sentences, longest-impact first. Example: `Clicks are down 23% (412 to 317) against 28 Aug to 24 Sep.` plus `Mobile in India explains most of it.` plus `Average position slipped 2.1 places.` All text comes from the message catalog with ICU placeholders; the API returns codes and numbers, never English (doc 20 section 3.11). A unit test per verdict and per flag pins the output.

## 7. Data design

### 7.1 Why a watchlist makes this cheap

The full property ingest of doc 18 (page, query, country and device for every URL) is large. This feature needs far less, because the user names the pages. For a watched page, one Search Analytics call filtered to that page and grouped by `[date, country, device]` returns complete totals, including anonymized-query traffic, because the query is not a grouping dimension (doc 18 section 4.2: grouping by page or query may drop data; a page filter without a page dimension does not). It carries every stored filter of 5.4. Rows per page are small (countries with traffic times three devices times days).

INFERRED sizing: a page with traffic from about 80 countries gives at most 80 x 3 rows per day, far fewer in practice because most countries have a few days of traffic; 16 months is on the order of 100,000 rows per page and search type, about four calls at 25,000 rows each. A watchlist of 200 pages with two search types is about 1,600 calls for the whole backfill, and about 400 calls a day for the daily sync, well inside the buckets of doc 18 section 4.5. To be measured in spike PP-S1.

### 7.2 Shapes (extends doc 18 section 4.2)

| Shape | Purpose | `dimensions` | Filter | `aggregationType` | Target table |
|---|---|---|---|---|---|
| D (watched page) | Everything the list and detail need except queries | `[date, country, device]` | `page equals <form>` per URL form | `auto` | `fp.gsc_watched_page_daily` (new) |
| A (property totals) | Share of site, hidden context | `[date, country, device]` | none | `byProperty` | `fp.gsc_property_daily` (doc 18) |
| Q (live) | Queries tab and query filter | `[query]` or `[date]` with a query filter | `page equals <form>` plus the user's query filter | `auto` | none; Redis cache |
| X (live) | Search appearance, slice 2 | two-step per doc 18 section 4.2 | `page equals <form>` | `auto` | none; Redis cache |
| P (probe) and suggestions | Add-page probe, suggested pages | `[page]` over 28 days | none, or `page contains <path>` | `byPage` | none |

One call spans a date range (not one day), chunked to 31 days for the daily sync and 120 days for backfill, with `startRow` paging until a page returns no rows. **UNVERIFIED:** that a date-ranged call grouped by date returns the same figures as the one-day calls of doc 18; spike PP-S1 compares them and the Search Console UI for ten pages.

### 7.3 Tables

```sql
-- Which pages a project watches. Tenant table with the standard RLS policy (doc 04 section 10).
CREATE TABLE core.watched_pages (
    workspace_id    uuid NOT NULL,
    project_id      uuid NOT NULL,
    url_id          bigint NOT NULL,                 -- canonical URL in core.urls
    integration_id  uuid NOT NULL,                   -- the GSC property it is read from
    group_id        uuid,                            -- optional, one group per page
    gsc_page_forms  text[] NOT NULL,                 -- exact strings Google reports for this page
    added_by        uuid NOT NULL,
    added_at        timestamptz NOT NULL DEFAULT now(),
    archived_at     timestamptz,
    first_data_date date,                            -- earliest day with rows, for the compare limit
    PRIMARY KEY (project_id, url_id)
);

CREATE TABLE core.page_groups (
    group_id     uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    project_id   uuid NOT NULL,
    name         text NOT NULL,
    UNIQUE (project_id, name)
);

-- Daily rows at the grain every stored filter needs. Partitioned by metric_date month. Same replacement rule
-- as the other fp daily tables (doc 04 section 10): delete then insert per (integration, type, url, day).
CREATE TABLE fp.gsc_watched_page_daily (
    integration_id  uuid NOT NULL,
    metric_date     date NOT NULL,
    search_type     text NOT NULL,
    url_id          bigint NOT NULL,
    country_iso3    char(3) NOT NULL,
    device          text NOT NULL,                   -- 'DESKTOP','MOBILE','TABLET'
    workspace_id    uuid NOT NULL,
    project_id      uuid NOT NULL,
    clicks          integer NOT NULL,
    impressions     integer NOT NULL,
    position_sum    numeric(14,2) NOT NULL,          -- position x impressions
    data_state      text NOT NULL CHECK (data_state IN ('final','all')),
    ingested_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (integration_id, metric_date, search_type, url_id, country_iso3, device)
) PARTITION BY RANGE (metric_date);
```

Retention follows the `fp.gsc_page_daily` rule (doc 04 section 12.1). `core.watched_pages` rows are archived, not deleted, when a page is removed; the daily rows are kept so re-adding a page restores its history without a new backfill. The migration also adds the quota key `watched_pages` (default 200 per project) to the quota table and the `pages:write` permission to the role catalog.

### 7.4 Sync

- Adding a page enqueues `gsc_watched_page_backfill(url_id)` on the `collect` queue: last 28 days first (so the list is useful in seconds), then the rest of the 16 months from newest to oldest. The recent-first order is the opposite of doc 18 section 4.3 for a reason: here the user is waiting at the screen for one specific page; the oldest-day-expiring concern is met by the order of the rest and by the 16-month request being queued at once.
- The daily `gsc_sync` of an integration gains a step: for every watched page and active search type, a final probe over the last 10 days, replacement of days that became final, and a provisional pull (`dataState = all`) for the days after the last final day. Freshness tiers, replacement transactions and the `first_incomplete_date` rule are doc 18 section 4.4 unchanged.
- Property totals (shape A) for each active search type are pulled once per sync with the same tiers.
- Quotas use the three buckets of doc 18 section 4.5; live calls (7.5) take tokens from the same buckets at a higher priority than backfill so a person at the screen is never starved by a backfill, and below the daily sync.
- Search types: only types with data on the property are pulled (probe P of doc 18). A page watched for Web only costs one type.

### 7.5 Live queries and the cache

The Queries tab and the query filter call Google when needed:

1. The API builds shape Q for the current and the previous range (two calls, run concurrently), paged to at most 5,000 rows each (a cap that keeps the live call under about three seconds; the footer says when the cap was reached).
2. The API merges the two result sets by query, computes changes and the coverage note, and returns one response.
3. Results are cached in Redis for 6 hours under `gsc:live:{integration}:{sha256 of the normalized request}`; Google's finalized data changes at most daily, and provisional days are excluded by default, so a cache hit is safe. Requests that include provisional days are cached for 30 minutes.
4. A query filter on the tiles and chart works by a live shape Q call grouped by `[date]` with the query filter and the page filter, so the chart reflects "this page, only queries containing pricing". These results use the same cache.
5. Failures follow doc 18 section 4.6. A quota failure returns the problem code `gsc_quota_exceeded` with `retry_after`, and the stored parts of the screen stay usable.

### 7.6 Reconciliation tests

The data is Google's, so correctness is agreement with it:

1. For every watched page, the sum of `fp.gsc_watched_page_daily` over country and device for a day equals the `fp.gsc_page_daily` row for that page and day (when the full ingest exists) and equals a direct `[date, page]` call.
2. Spike PP-S1 compares clicks and impressions for ten real pages and four date ranges with numbers copied from the Search Console UI; clicks and impressions must match exactly, position within 0.1.
3. The URL-form sum is tested with a fixture where one page has two forms.

## 8. API (extends the first-party routes `{P}/fp/...` of doc 19; `{P}` is `/api/v1/workspaces/{w}/projects/{p}`)

All metric values are `MetricValue` objects with `observation_class: 'first_party'`, `source: 'gsc_api'`, `data_state` and `coverage` (doc 19 section 2.6). A comparison is a pair of values and a `delta`, with `delta.is_detectable` set by the health rules (not by a confidence interval; these are census counts, doc 18 principle 5). Responses carry codes and numbers, never English.

| Method | Path | Permission | Request | Response |
|---|---|---|---|---|
| GET | `{P}/page-performance/meta` | `data:read` | none | `{ integration_id, property, timezone: 'America/Los_Angeles', final_through: Date, provisional_days: Date[], earliest_day: Date, sync: { state, days_done?, days_total?, last_success_at } , search_types: string[] }` |
| GET | `{P}/page-performance/watchlist` | `data:read` | `date_from`, `date_to`, `compare` (`previous_period` default, `previous_year`, `previous_month`, `custom`, `none`), `compare_from?`, `compare_to?`, `include_provisional?`, `search_type?`, `filter[country_iso3]`, `filter[device]`, `filter[group_id]`, `filter[health]`, `sort` (`-attention` default, `-clicks`, `clicks_change`, `-impressions`, `position_change`, `path`), `cursor`, `limit` | `Page<WatchedPageRow>` plus `meta.counts_by_health` |
| POST | `{P}/page-performance/watchlist` | `pages:write` | `{ urls: string[] (max 500), group_id? }` | per-URL outcome `added`, `already_watched`, `invalid_url`, `wrong_host`, `over_quota` with `gsc_forms` and `clicks_28d` when found |
| POST | `{P}/page-performance/watchlist/validate` | `pages:write` | `{ urls: string[] }` | same outcomes without writing, for the dialog preview |
| PATCH | `{P}/page-performance/watchlist/{url_id}` | `pages:write` | `{ group_id? }` | `One<WatchedPage>` |
| DELETE | `{P}/page-performance/watchlist/{url_id}` | `pages:write` | none | 204; the page is archived, history kept |
| POST | `{P}/page-performance/watchlist/bulk` | `pages:write` | `{ url_ids: bigint[], action: 'set_group' \| 'remove', group_id? }` | per-id outcomes |
| GET | `{P}/page-performance/suggestions` | `data:read` | `limit?` (default 25) | `{ data: Array<{ url: UrlRef, clicks_28d, impressions_28d }> }`, live, cached 1 hour |
| GET | `{P}/page-performance/pages/{url_id}` | `data:read` | the watchlist filters | `One<PageDetail>`: `url`, `health: { verdict, flags[], method_version }`, `tiles` (clicks, impressions, ctr, position, share_of_site_clicks, each `{ current, previous, delta }`), `summary: { sentence_keys: Array<{ key, params }> }`, `notes` (excluded provisional days, per-day basis, earliest day) |
| GET | `{P}/page-performance/pages/{url_id}/series` | `data:read` | the filters plus `metrics[]`, `granularity` | `{ data: Array<{ metric, current: Point[], previous: Point[] \| null }> }`, `Point = { date, value, is_partial }` |
| GET | `{P}/page-performance/pages/{url_id}/breakdown` | `data:read` | the filters plus `dimension` (`country`, `device`, `query`, `search_appearance`), `metric`, `mode?` (`losers`, `gainers`, `new`, `lost`), `filter[query]` with `op` | `Page<BreakdownRow>` with `current`, `previous`, `change`, `share_of_change`; query and appearance responses add `meta.coverage` and `meta.live: true` |
| GET | `{P}/page-performance/export` | `data:read` | the watchlist filters | CSV stream of the list, or of one page's breakdown with `url_id` and `dimension` |

Problem codes added to the catalog: `gsc_not_connected`, `gsc_reauth_required`, `gsc_quota_exceeded`, `watched_pages_quota_exceeded`, `page_not_watched`, `compare_range_before_history`, `invalid_regex`.

## 9. Quotas, audit and security

- Watchlist cap 200 pages per project by default (quota key `watched_pages`), raised per workspace by an admin through the quota routes (deferred to step 10 for editing; the default applies until then).
- Add, remove and group changes write `ops.audit_logs` (`page_watch.add`, `page_watch.remove`, `page_watch.group`).
- The suggestions and live query calls need a connected, healthy integration; the access token never leaves the worker or the API process (doc 24 section 6).
- Pasted URLs are parsed and canonicalized, never fetched. Sitemap import (slice 2) follows the SSRF controls and size limits of doc 24 section 7.3.
- Regex query filters are validated and run by Google, not by us; our side only checks the length (at most 200 characters) and that Google accepts it (`invalid_regex`).
- Query text is customer data and stays out of logs and Sentry events; the live response cache is keyed by hash and stores query text only inside the cached value, with the same TTL.

## 10. Build slices

The feature depends on the Search Console connection of doc 18 section 4 (OAuth connect, property picker, `fp.connections`, `fp.integrations`, the Google quota buckets), which is Phase 12. It needs none of the other Phase 12 sources. **Decision D-PP-6:** pull only the connection and the Search Console parts of Phase 12 forward, as a step of their own, rather than waiting for the whole phase.

**Recommended place in the build order:** a new step **7b** after step 7 (SEO analytics, the internal alpha), because the product then shows its own rank data and this step adds Google's. It can move earlier if the product owner wants it before the deploy; nothing here needs the AI track. Google OAuth also needs the production domain (`idraft.ai`) for the consent screen and redirect URIs, and verification takes time, so the Google Cloud project, the consent screen and the verification request should start as soon as the domain is live (section 12, PP-R1).

| Slice | Contents | Acceptance |
|---|---|---|
| 0. Spikes | PP-S1 (shape D against the Search Console UI, date-ranged against one-day calls, row counts, the URL forms of ten pages), PP-S2 (live query latency for Q on busy pages, the 5,000-row cap), PP-S3 (URL Inspection scope and quota), FP-S3 and FP-S8 of doc 18 | Written results in `spikes/`; section 7 numbers replaced with measurements |
| 1. Core | Connect and property picker (doc 18 4.1), `core.watched_pages`, groups, shape D and A sync with backfill and freshness tiers, health function, `meta`, watchlist, detail, series, country and device breakdown, export, quotas, audit. Frontend: tab and route, filter model, list, drawer and page shell, tiles, chart with all three layouts, What changed for countries and devices, add dialog (paste and suggestions), all states of 5.10, mocks world, e2e | A project with Search Console connected and 20 pages added shows the list within 60 seconds of the first sync for the last 28 days, full history in under 30 minutes (to be measured); reconciliation tests pass; every verdict and flag has a unit test; keyboard walkthrough of 20 pages without the mouse; cross-tenant suite covers every route |
| 2. Live | Queries and search appearance tabs, query filter with the cache, sitemap and CSV import, "Watch this page" entry points | Queries tab loads in under 3 seconds p95 on pages with 5,000 queries (measured in PP-S2); cache hit rate visible in the Operations screen; quota failure leaves stored tabs working |
| 3. Indexing health and alerts | URL Inspection daily check for watched pages (`fp.url_inspections`), the Indexing card in the detail and the Indexing column in the list, the `index_status_changed` flag; email digest of declining pages (opt-in, the email worker of step 10); annotations on the chart. The product owner asked for indexing status as part of "health" (D-PP-8), so build it with slice 1 if spike PP-S3 confirms the scope and quota | Inspection stays within 2,000 per day per property including retries; a page that loses its index status shows a flag the same day |
| 4. Other channels | The optional metrics of 5.3: share of site clicks (slice 1, Search Console only), tracked keyword rank and AI citations (read from our own tables, no new source), GA4 sessions and conversions (when the GA4 connection of Phase 12 lands) | Each metric carries its own source label; none is summed with Google numbers; each can be switched off |

Estimates (INFERRED, to be revised after the spikes): slice 1 backend about 3 engineer-weeks and frontend about 3.5; slice 2 about 1.5 and 1.5; slice 3 about 2 and 1; slice 4 about 1 and 1.

**Process.** As with keywords and rank, the order is: backend plan (with the OpenAPI contract published first), then the frontend plan against the generated client and the mock world (`src/mocks/gsc-world.ts`, deterministic per URL id like the rank history), reviewed per task on the Opus model.

**Frontend structure (for the plan).** `src/features/page-performance/` with the screens, `components/app/metric/` gains `MetricToggleTile` (checkbox tile with current, previous and change), the chart layouts reuse `ChartFrame` and `EChart`, the list uses the client mode of `DataTable`, the drawer uses `Inspector`, filters use `FilterBar` and the `nuqs` parsers. Features must not import other features (lint boundary), so the shared detail mounted in Page Intelligence goes through `components/app/`.

## 11. Testing

- **Unit (pure):** `page_health_v1` truth table (every verdict boundary, per-day averaging, low-data rule), the verdict sentence builder, the comparison range calculator (leap years, month ends, unequal lengths), position and CTR aggregation, URL form summing.
- **Backend integration:** replacement transaction per day, backfill ordering, provisional to final, quota failures, cross-tenant for every route, watchlist quota, audit rows.
- **Contract:** the generated client types compile against the mock handlers; mock and real responses are checked with the same schema tests used for keywords.
- **Frontend:** filter state in the URL round trip, tile toggles driving the chart layouts, drawer next and previous keeping filters, every state of 5.10, keyboard walkthrough, accessibility checks on the chart table view.
- **End to end:** add pages by paste, change comparison, open a page, drill into a country, export.
- **Real data:** the spike PP-S1 numbers become fixtures with the page paths scrubbed.

## 12. Risks and open questions

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| PP-R1 | Google OAuth verification for the Search Console scope delays use by customers outside the team | M | H | Start the Google Cloud project and the consent screen with the production domain as soon as it is live; use an Internal app for Digibranders first; doc 18 section 3.2 notes the 7-day refresh expiry in Testing mode |
| PP-R2 | Date-ranged filtered calls disagree with the UI or with one-day calls | L | H | Spike PP-S1 before slice 1; fall back to one-day calls (more calls, same tables) |
| PP-R3 | A page's URL forms change and its history splits | M | M | URL form probe on add, nightly check, the `url_form_changed` flag (5.9) |
| PP-R4 | Live query latency feels slow on large pages | M | M | 5,000-row cap, concurrent current and previous calls, 6-hour cache, skeleton rows; upgrade path in PP-Q4 |
| PP-R5 | Users read Google's numbers as ours | L | M | Source chip and the data note on every panel (doc 20 section 4.4) |

| ID | Question | Why it matters | How to settle | Needed by |
|---|---|---|---|---|
| PP-Q1 | Is `webmasters.readonly` enough for the URL Inspection API, and are 2,000 per day and 600 per minute per property still the limits? (Google's January 2022 announcement gives those figures; the current page was not read) | Slice 3 feasibility | Spike PP-S3 | Slice 3 |
| PP-Q2 | Should health thresholds be a workspace setting? | Different sites have different noise | Review after the first month of real use | After slice 1 |
| PP-Q3 | One watchlist per project, or shared across projects on the same property? | Agencies with many projects per property (doc 18 FP-Q4) | Follows FP-Q4 | Slice 1 |
| PP-Q4 | Store daily query rows for watched pages for query history beyond 16 months? | Storage and call volume against the value of query timelines | Measure live latency and usage in slice 2 | Slice 2 |
| PP-Q5 | Is the per-project cap of 200 pages right? | Cost and screen speed | Measure client-mode table speed at 200 and 500 | Slice 1 |

## 13. Decisions

| ID | Decision | Section |
|---|---|---|
| D-PP-1 | New permission `pages:write` | 4 |
| D-PP-2 | One detail component, drawer and full page shells | 5.1 |
| D-PP-3 | Default range ends on the last final day; provisional days excluded unless switched on | 5.5 |
| D-PP-4 | Queries are live and cached in the first release | 5.8, 7.5 |
| D-PP-5 | Health thresholds are method constants (`page_health_v1`) | 6.1 |
| D-PP-6 | Pull the Search Console connection and its parts forward from Phase 12 | 10 |
| D-PP-7 | The period control opens on the last complete month against the month before; a range menu is one click away (product owner, 2026-10-27) | 5.4, 5.5 |
| D-PP-8 | "Health" means the search trend plus the index status of the page (product owner, 2026-10-27); page speed is not part of it | 5.3, 6, 10 |
| D-PP-9 | Extra metrics (share of site, tracked keyword rank, AI citations, GA4 sessions and conversions) are selectable and off by default (product owner, 2026-10-27) | 5.3 |
| D-PP-10 | The detail is cut to what decides something: one verdict card with the index status inside, search type and query behind "More filters", no overlay chart, the provisional-days and unequal-length notes as one quiet line under the chart. The page drawer is 720 px wide by default and can be resized (480 px up to the window less 56 px, remembered), as the inspector of doc 16 section 2.2 (product owner, 2026-10-27) | 5.3, 5.4, 5.7 |
