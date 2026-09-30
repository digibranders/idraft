# 22. Content, Copy and Formatting

Status: Accepted (design-system v2)
Last updated: 2026-09-29
Implementation: [`apps/web/src/lib/format/`](../../apps/web/src/lib/format/) (number, rank, delta, date, url) with tests in `format.test.ts` (passing on 2026-09-29). Components must use these functions; lint blocks `Intl.*`, `toFixed`, `toLocaleString` and `toLocaleDateString` outside `lib/format`.

## 1. Voice and style

The product speaks like a precise instrument: concise, neutral, specific. It reports what happened and what the user can do.

| Rule | Good | Bad |
|---|---|---|
| State facts plainly | "Collection completed" | "Great news! Your AI visibility scan is ready!" |
| Be specific about scope | "12 prompts have incomplete data" | "Oops! Something went wrong with a few prompts." |
| No hype or anthropomorphism | "ChatGPT mentioned Northwind in 47% of answers" | "ChatGPT loves Northwind!" |
| Say what to do next | "Reconnect Google Search Console to resume syncing" | "Please try again later" |
| No exclamation marks | "Keyword added" | "Keyword added!" |
| No filler | "Delete 12 keywords?" | "Are you sure you want to go ahead and delete these keywords?" |
| Neutral about uncertainty | "Within normal variation" | "Nothing to worry about" |

Mechanics:
- **Sentence case** for everything: titles, buttons, labels, tabs, badges, menu items. Proper nouns keep their case (ChatGPT, Google AI Overview, Search Console).
- **No em-dashes or en-dashes** anywhere in UI text (U+2014, U+2013). Use a colon, comma, parentheses or a full stop. Ranges use "to" ("1 to 10", "Sep 1 to Sep 28"). Lint and a message-catalog test enforce this.
- **Middle dot** (`·`) separates inline metadata, at most once per line in dense contexts and at most twice in detail headers.
- **Arrow** `→` is allowed for transitions in timelines and tooltips ("#8 → #4", "example.com/a → example.com/b").
- **Quotes**: typographic double quotes for quoted user content in copy ("Delete group “Pricing”?").
- **Buttons**: verb first, at most 3 words ("Add keywords", "Run check", "Export CSV"). A button never says "OK" or "Yes"; it names the action ("Delete 12 keywords").
- **Empty and error text**: one sentence of reason, one action ([17-empty-loading-error-states.md](17-empty-loading-error-states.md)).
- **Numbers in copy** always go through the formatters, including inside sentences.

## 2. Numbers

| Kind | Function | Table | Summary / axis | Tooltip |
|---|---|---|---|---|
| Count | `formatCount` / `formatInteger` | `1,240`, `12,480` | `12.5K`, `1.24M` (exact below 10,000) | exact |
| Search volume | `formatCount` | `12,400` | `12.4K` | exact plus "Google Ads, Aug 2026" source |
| Percentage (rates) | `formatPercent` | `47.2%` | `47.2%`; headline values drop the decimal when the interval half-width is at least 2 points (`34%`) | with interval "29% to 39%" |
| Rate change | `formatPointsDelta` | `+5.3 pts` | `+5.3 pts` | "up 5.3 percentage points" ([20-accessibility.md](20-accessibility.md) section 9.2) |
| Relative change (counts, money) | `formatRelativeChange` | `+12.4%` | same | exact before and after |
| Signed count change | `formatSignedInteger` | `+12`, `−3` | same | |
| Currency (USD) | `formatCurrency` | `$24.18`; below one cent `$0.0042` | `$1.24M` above $100,000 | exact |
| Decimal score | `formatDecimal` | `0.042` | same | |
| Interval | `formatInterval` | n/a | "29% to 39%" | same |
| Sample | `formatSampleCount` | "612 of 1,800" | same | same |
| Rank (cell) | `formatRankCell` | `3`, `>20` | n/a | |
| Rank (inline) | `formatRankInline` | n/a | `#3`, "not in top 20" | same |

Rules:
1. **Tables show exact values** with grouping separators; summaries and axes abbreviate at 10,000 and above with three significant digits; tooltips always show exact values.
2. **Rates change in points, never relative percent.** A move from 2% to 3% is "+1 pt", not "+50%".
3. **Minus sign** is U+2212 (`−`), which has the plus sign's width in tabular figures. CSV exports use ASCII hyphen-minus.
4. **Zero** changes render without sign ("0", "0 pts").
5. **Missing values** render `n/a` in `foreground-tertiary` with the accessible name "No data" ([20-accessibility.md](20-accessibility.md) section 9.1), or a specific unknown state (beyond depth, insufficient, not applicable).
6. **Decimals**: percentages 1 decimal (0 for headline values with wide intervals); average rank 1 decimal ("14.2"); currency 2 (4 below one cent); scores 3.
7. **Locale** comes from the user profile (default `en-US`). Formats in this document are `en-US` examples.

## 3. Ranks and rank changes

| Case | Display | Accessible text |
|---|---|---|
| Ranked | `3` in cells, `#3` inline | "rank 3" |
| Beyond depth | `>20` (depth of that check) in `foreground-tertiary` as plain text in cells, never a chip; "not in top 20" in tiles, the inspector and tooltips | "not in top 20" |
| Improved beyond normal movement | `↑5` in `positive-text` | "improved 5 positions" |
| Improved within normal movement | `↑1` in `foreground-secondary` | "improved 1 position" |
| Declined | `↓3` (tone by the same rule) | "declined 3 positions" |
| No change | `0` | "no change" |
| Entered tracked depth | `New` (positive) | "entered the tracked depth" |
| Dropped out of tracked depth | `Lost` (negative) | "dropped out of the tracked depth" |
| Beyond depth in both checks | empty | "still beyond tracked depth" |
| First check | empty | "first check" |
| Average rank | `14.2` with the ranked count ("14.2 across 612 ranked") | |

Emphasis rule (from [17-statistical-methodology.md](../17-statistical-methodology.md) section 10): a rank change is colored only when `abs(change) > max(2, 2 x mean absolute daily change over the last 30 ranked checks)`. Implemented in `classifyRankChange`.

## 4. Dates and times

| Context | Function | Example |
|---|---|---|
| Table timestamp | `formatTableDateTime` | `Sep 29, 18:32` (year added when not the current year: `Sep 29, 2025, 18:32`) |
| Detail timestamp | `formatDetailDateTime` | `Sep 29, 2026 · 18:32 EDT` |
| Relative freshness | `formatRelative` | `just now`, `12m ago`, `3h ago`, `2d ago`; after 7 days the table format |
| Business date | `formatBusinessDate` | `Sep 29, 2026` |
| Chart axis | `formatChartDate` | `Sep 29` |
| Range | `formatDateRange` | `Sep 1 to Sep 28, 2026`, `Dec 15, 2025 to Jan 11, 2026` |

Timezone behavior:
- Timestamps from the API are UTC and are displayed in the **project timezone**. The timezone abbreviation appears in detail formats; table formats omit it and the column header tooltip says "Times in Europe/Berlin (project timezone)".
- Business dates (rollup dates, week starts) are already computed in the project timezone by the API and are never converted.
- Workspace-level screens (Costs, Operations) use the workspace timezone and say so in the page header meta line.
- Hovering a timestamp shows the viewer's local time when it differs from the project timezone.
- Timezone abbreviations come from the locale's data (`EDT`, `CEST`, or `GMT+5:30` depending on locale). The IANA name is shown in tooltips and settings.
- Durations: `1h 12m`, `45s`, `3d`. `lib/format` has no duration formatter yet: one (for example `formatDuration`) must be added to `lib/format` with tests in `format.test.ts` before any component displays a duration. Components never build duration strings themselves.
- Weeks start on Monday.

## 5. URLs and domains

| Display | Function | Example |
|---|---|---|
| Domain | `displayDomain` | `example.com` (strips `www.` only; keeps other subdomains) |
| URL | `displayUrl` | host `example.com` plus path `/blog/article-title`; tracking parameters (`utm_*`, `gclid`, `srsltid`, ...) and fragments (including `#:~:text=`) removed for display |
| Path truncation | `truncatePath` | `/blog/…/how-to-choose-a-crm` (keeps first and last segments) |

Rules:
- The original URL is always kept in data and is what the copy action copies and the open action opens.
- In tables scoped to one domain (owned pages), the host is hidden and only the path shows.
- External links open in a new tab with `rel="noopener noreferrer nofollow"` and a trailing 14 px `ExternalLink` icon ([07-icons.md](07-icons.md) section 2); the `ExternalLinkButton` uses 14 px at `sm` and 16 px at `md` ([09-buttons-controls.md](09-buttons-controls.md) section 9.2).
- Favicons only in domain-first tables ([07-icons.md](07-icons.md) section 5).
- Unparseable URLs render the raw string with a `warning-text` icon and "Invalid URL" in the tooltip.

## 6. Truncation rules

| Content | Table | Inspector and detail |
|---|---|---|
| Keyword | End ellipsis, single line | Full text, wraps |
| Prompt | End ellipsis, single line | Full text in a quote box (`surface-subtle`, 1 px `border-subtle`, radius 6, 12 px padding), wraps |
| URL / path | Middle truncation, in `type-mono` (13 / 20 px) | Full display URL, wraps at slashes |
| Domain | End ellipsis on subdomain, registrable domain always visible, in `type-mono` | Full host |
| Source title | End ellipsis | Wraps to 2 lines, then ellipsis with "Show more" |
| Competitor name | End ellipsis at 24 characters | Full name |
| Answer text | Never in tables (use `ResponsePreview` in inspector) | Full, evidence view |

Truncated values always have a tooltip with the full value (on hover and keyboard focus), and the full value is available in the inspector. Table rows never grow to fit long content, at either density (40 px Default, 32 px Compact, [12-tables.md](12-tables.md) section 3.1).

## 7. Change and status copy

| Event | Copy |
|---|---|
| Rank improvement | "Rank improved #8 → #4" |
| Entered top 10 | "Entered top 10 (#12 → #7)" |
| URL change | "Ranking URL changed: /pricing → /blog/crm-pricing" |
| AI Overview citation | "AI Overview started citing /crm" |
| Mention rate change | "ChatGPT mention rate increased 5.3 pts (detectable)" |
| Collection states | "Queued", "Running: 412 of 1,000 checks", "Completed", "Completed with errors: 12 failed", "Partial data", "Failed", "Budget blocked" |
| Freshness | "Updated 12m ago", "Last collected Sep 29, 18:30 CEST", "Provider delayed", "Stale: last collected Sep 27, 18:30 CEST" ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 7.1) |

## 8. Units and labels

- Units belong in column headers when every cell shares them ("Cost (USD)", "Volume"); percentages keep `%` in cells.
- Metric labels come from one registry, `lib/metrics/definitions.ts`, keyed by the API metric key (`ai.mention_rate`), holding: label ("Mention rate"), short label ("Mention"), one-sentence definition, unit, polarity, and methodology link. Tables, charts, tooltips and exports use the same entry, so a metric is named identically everywhere.

## 9. Terminology glossary

Use these terms exactly. Synonyms in the right column are not used in the UI.

| Term | Definition | Do not use |
|---|---|---|
| **Keyword** | A search query tracked in Google for rank | search term, query (except "GSC query" for Search Console data) |
| **Tracked keyword** | A keyword measured in one location, language and device | keyword instance |
| **Prompt** | A conversational question sent to AI engines | query, question (as a noun for the object) |
| **Prompt version** | Immutable text of a prompt at a point in time | revision |
| **Panel** | A named set of prompts: Core, Discovery, Experiment, Custom | list, collection (of prompts) |
| **Engine** | An AI surface we observe: ChatGPT, Gemini, AI Mode, AI Overview, official APIs | model, platform, LLM (as a UI label) |
| **Observation** | One recorded answer from one engine for one prompt or keyword | response (as the object name), sample |
| **Run** | One scheduled or manual collection cycle | job, scan, crawl |
| **Collection** | The process of fetching data from providers | scraping |
| **Check** | One rank measurement of one tracked keyword | scan |
| **Mention** | The brand's name appears in an answer | appearance, visibility (as a synonym) |
| **Citation** | An answer links or references a URL | source link, reference (except in AI Overview "references" provider context) |
| **Source** | A domain or page cited by engines | publisher (except for the publisher entity) |
| **Recommendation** | The answer presents the brand as a suggested choice | endorsement |
| **Domain** | A registrable domain (example.com) | site, website (in data contexts) |
| **Organic rank** | Position among organic results (canonical rank) | position (alone), ranking |
| **Absolute position** | Position among all SERP elements | pixel rank, visual rank |
| **Prominence** | How early the brand is first mentioned in an answer (0 to 1) | rank, position |
| **Structured rank** | Position in an ordered list inside an answer | AI rank, AI position |
| **Visibility** | SEO: CTR-weighted visibility percentage. AI: not used as a single metric; use the specific rate | score |
| **Share of voice** | Share among tracked entities (AI) or of available clicks (SEO), as defined | SOV (only in dense column headers, with tooltip) |
| **Confidence interval** | 95% range for a rate from repeated observations | margin, error bars (in UI copy) |
| **Competitor** | A tracked entity with the competitor role | rival |
| **Topic** | A taxonomy term shared by keywords and prompts | category (reserved for domain categories) |
| **AI Overview** | Google's AI summary in the search results page | SGE, AIO (except dense headers, with tooltip) |
| **AI Mode** | Google's conversational AI search surface | |
| **Depth** | Number of organic results checked (top 20, top 100) | limit |
| **Estimate** | A modeled value (CTR clicks, AI demand) | forecast, prediction |

## 10. Contextual help and metric definitions

- Every metric label that is not self-explanatory (Mention rate, Citation share, Prominence, Visibility, Confidence interval, Structured rank, Share of voice, Recommendation rate) shows a 14 px `Info` button next to it in headers, metric strips and chart titles.
- The button opens a `MetricInfo` popover (max 360 px) with content in this fixed order: definition (one sentence from the registry), formula in plain words, denominator and sample size for the current view, aggregation, method version, "Open statistics" (AI rates only), and a link "Methodology" to the in-app methodology page for the metric, always last ([23-application-patterns.md](23-application-patterns.md) section 8.1).
- Tooltips on the metric value itself show numbers (interval, n); the info popover shows meaning. The two are never merged.
- The methodology link sits in the same place in every popover (last line), satisfying consistent help (WCAG 3.2.6).
