# 14. Badges, Status and Change Indicators

Status: Accepted (design-system v2)
Last updated: 2026-09-29

## 1. Badge component

One `Badge` component with two properties: `tone` and `variant`.

| Property | Values |
|---|---|
| `tone` | `neutral` (default), `positive`, `negative`, `warning`, `info` |
| `variant` | `subtle` (tinted background, default), `outline` (1 px border, surface background), `text` (no box, color only) |
| Size | One size: 22 px tall (`h-badge`), `type-micro` (12 / 16 px, weight 500), 8 px horizontal padding (`px-2`), `rounded-sm` (4 px) |
| Icon | Optional leading 12 px icon, 4 px gap |

| Tone + variant | Background | Text | Border |
|---|---|---|---|
| neutral subtle | `neutral-subtle` | `neutral-text` | 1 px `neutral-border`, always on (the tint is close to the hover and selected fills of a row, and one look everywhere needs no prop). On a selected or active row (`surface-selected`) the fill switches to `surface` so the badge keeps a visible edge against the tint: the row is a `group` with `aria-selected`, and the badge carries `group-aria-selected:bg-surface` |
| neutral outline | `surface` | `foreground-secondary` | `border` |
| positive subtle | `positive-subtle` (mint) | `positive-text` | none; optional leading `Check` icon |
| positive outline | `surface` | `positive-text` | `positive-border` |
| negative subtle | `negative-subtle` | `negative-text` | none |
| negative outline | `surface` | `negative-text` | `negative-border` |
| warning subtle | `warning-subtle` | `warning-text` | none |
| info subtle | `info-subtle` | `info-text` | none |

Badges never use `rounded-full` (no pills), never use solid saturated fills, and never wrap.

## 2. When to use which tone

| Metadata kind | Tone | Examples |
|---|---|---|
| Categorical labels (no judgment) | neutral subtle | ChatGPT, Gemini, AI Mode, AI Overview, Commercial, Informational, Question, Core panel, Discovery |
| Secondary categorical labels next to other badges | neutral outline | Branded, Estimate, Mono engine class labels |
| Lifecycle state | semantic subtle | Active (positive), Paused (neutral), Failed (negative), Partial (warning), Running (info) |
| Event outcome | semantic subtle or outline | New (positive outline), Lost (negative outline), Cited (positive subtle), Mentioned (neutral subtle) |
| Own-domain facts | positive subtle, optional leading `Check` | Cited, Owned, "Cited · source 2 of 5" (the source position with its denominator) |
| Estimates and methodology markers | neutral outline | Estimate, Modeled, Sampled |

Rules:
1. **Categorical metadata is neutral.** Intent, engine, prompt type, panel and topic badges are never colored, even if colors would look "helpful".
2. **Semantic tone requires a judgment the system can defend.** "Cited" and "Owned" are positive only for the project's own domain or page; a competitor being cited is neutral. v2 uses the positive subtle badge (mint fill, green text) for both, not a cobalt tint, so the accent stays reserved for selection and navigation.
3. **Maximum two badges per table cell and three per row** in compact density. More metadata moves to the inspector.
4. Badges are not buttons. Interactive tags are `FilterChip` or `Tag` (removable, with its own focus style).

## 3. Status indicators

| Component | Use | Spec |
|---|---|---|
| `StatusBadge` | Run, integration, schedule, collection status in tables and headers | Badge with icon and word: `Running` (info, rotating `LoaderCircle`), `Completed` (positive, `CircleCheck`), `Completed with errors` (warning, `TriangleAlert`), `Partial` (warning, `CircleDashed`), `Failed` (negative, `CircleX`), `Queued` (neutral, `CalendarClock`; `Clock` means stale), `Budget blocked` (warning, `Receipt`), `Cancelled` (neutral, `CircleSlash`), `Paused` (neutral). Icons per [17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 4.1 |
| `StatusDot` | Only for real live state in dense places: integration connection in lists, notification unread | 6 px `rounded-full`, semantic `-solid`, always followed by a text label or with an accessible name. Decorative dots are not allowed |
| `FreshnessIndicator` | Data age in page headers and inspectors | `Updated 12m ago` (`type-meta`); becomes `warning-text` with `Clock` icon and "Stale" after the staleness threshold; `Partial data` and `Provider delayed` states ([17-empty-loading-error-states.md](17-empty-loading-error-states.md)) |

Color is never the only carrier of status: every status has an icon and a word.

## 4. Engine representation

| Aspect | Rule |
|---|---|
| Label | Official product names: "ChatGPT", "Gemini", "Google AI Mode" (short: "AI Mode"), "Google AI Overview" (short: "AI Overview"), official API engines as "OpenAI API (search)", "Perplexity API" |
| Visual | `EngineBadge`: neutral subtle badge with the short name, with an optional leading 16 px `EngineLogo` (`logo` prop). No brand colors: the badge stays neutral ([07-icons.md](07-icons.md) section 5) |
| Class | Observation class is shown where engines from different classes appear together: a neutral outline badge "Consumer UI", "SERP AI" or "Official API" after the engine name in headers and tooltips ([20-frontend-specification.md](../20-frontend-specification.md) principle 5) |
| Charts | Two chart kinds exist and never mix. **Entity charts** (own brand vs competitors) color by entity: own brand `chart-1`, competitors `chart-2` to `chart-6`. **Engine charts** (one entity split by engine) color by engine in fixed order: ChatGPT `chart-1`, Gemini `chart-2`, AI Mode `chart-3`, AI Overview `chart-4`, official API engines `chart-5` and `chart-6`. The legend always names the series, and the chart title says which kind it is ("Mention rate by engine") |
| Column order | ChatGPT, Gemini, AI Mode, AI Overview, then official APIs, everywhere |

## 5. Change indicators

The decision: **ranks use arrows, metrics use signs.** Never both, never three indicators.

| Value type | Primary indicator | Example | Color rule |
|---|---|---|---|
| Rank change | Arrow glyph plus positions moved | `↑5`, `↓3`, `0`, `New`, `Lost` (empty on the first check) | `positive-text` or `negative-text` only when emphasized (beyond the keyword's normal movement), `New` and `Lost` always ([02-color-system.md](02-color-system.md) section 6); otherwise `foreground`. `0` is always neutral |
| Rate change | Signed percentage points | `+5.3 pts`, `−0.9 pts` | Colored only when detectable |
| Count change | Signed integer | `+12`, `−3` | Colored by polarity only when detectable |
| Money or volume change | Signed relative percent | `+12.4%` | Never colored (neutral polarity) |
| No change | `0`, `0 pts` or `0%` (never a dash glyph) | `0` | Neutral |

Why arrows for ranks: a signed rank change is ambiguous ("−5" could mean improved by 5 or dropped by 5). The arrow shows direction on the ranking itself: up means better. Metrics use signs because their numeric direction and their meaning agree for rates and counts.

Implementation: `RankDelta` and `Delta` components (and the table cells `RankDeltaCell` and `DeltaCell`) call `formatRankChange` and `formatMetricDelta` ([`apps/web/src/lib/format`](../../apps/web/src/lib/format/)), which return `{ text, label, tone }` (`RankChangeDisplay`, `MetricDeltaDisplay`). Components never compute tone and never compose screen reader text.

Rank change styling: the arrow and the number share one color and the type style of their context (`type-table num` in table cells); the arrow is a text glyph, not an icon, so it scales and colors with the number. No background and no badge box. Colored changes (emphasized moves, `New` and `Lost`) are `positive-text` or `negative-text`; all others, and `0`, are `foreground`.

Accessible names come from the formatter's `label`: `↑5` is "improved 5 positions", `New` is "entered the tracked depth", `Lost` is "dropped out of the tracked depth", `0` is "no change", and the first check has empty visible text with the label "first check". `+5.3 pts` is "up 5.3 pts"; a non-detectable metric delta also carries the formatter's `note` "Within normal variation", shown in its tooltip.

## 6. SERP feature badges

`SERPFeatureBadge` shows one feature: 12 px icon (`size-icon-xs`, [07-icons.md](07-icons.md) section 2) plus short label in neutral subtle; owned features use `primary-text` icon and label with an outline `primary-border`. Feature short labels: AI Overview, Snippet (featured snippet), PAA, Local pack, Images, Video, Top stories, Knowledge panel, Shopping, Discussions, Sitelinks, Ads. In table cells, features render as icon-only fixed slots (`SERPFeatureList`) with names in tooltips and in the accessible name.

## 7. Counts and numeric badges

- Counts in sidebar navigation: the neutral subtle badge (22 px, `type-micro num`, 4 px radius), max "99+" ([11-navigation.md](11-navigation.md) section 2).
- Counts in `CountTabs` (event-type filters with counts, [09-buttons-controls.md](09-buttons-controls.md) section 12.1): the neutral subtle badge on items that are not pressed; on a pressed item a deeper blue badge (`primary-hover` fill, `primary-foreground` text).
- Counts in tabs (inbox tabs only): a plain `type-micro` counter after the label, 6 px gap, `foreground-tertiary`, no background ([09-buttons-controls.md](09-buttons-controls.md) section 12).
- Unread notification count on the bell: `primary` background with `primary-foreground` text is the one place a solid accent badge is allowed (it signals a pending user action).
