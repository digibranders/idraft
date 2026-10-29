# 13. Filters and Search

Status: Accepted (design-system v2)
Last updated: 2026-09-29

## 1. One filtering system

Every analytical screen filters through one component, `FilterBar`, placed in the page header. Tables do not have their own filter forms; column header menus only add chips to the same bar. There are no filter sidebars and no filter forms above tables.

The date range and location are project-wide scope, not screen filters: they sit in the top bar on every page where they apply ([11-navigation.md](11-navigation.md) section 4) and are hidden where they do not (Settings, Integrations, and the screens without them in section 4). Everything screen-specific stays in the filter bar.

```
Top bar:     ... [Search  ⌘K]  [Cal Last 28 days v]  [Pin United States v]  [Bell] [◐] [?] [AB]
                                ^ project-wide scope (top bar, section 4)

Filter bar:  [vs previous period v]  [Desktop v]  [Topic: CRM x] [Rank: 1 to 10 x]  [+ Filter]  Clear all      (o) Cited  ( ) Mentioned  . Not mentioned
              ^ screen scope controls (always visible)  ^ active filter chips  ^ add  ^ reset  ^ engine status legend (Prompts only), right-aligned
```

## 2. Anatomy

| Part | Component | Size | Behavior |
|---|---|---|---|
| Top-bar scope | Date range (`DateRangePicker` trigger) and location, in the top bar, not in this bar ([11-navigation.md](11-navigation.md) section 4) | 36 px `secondary` buttons with a leading icon (`Calendar`, `MapPin`) and a trailing chevron | Project-wide: the value persists across pages. Hidden on screens where they do not apply (section 4). Never removable; they have defaults |
| Screen scope controls | `CompareSelect`, and per-screen always-on scopes (Device on SEO screens, Engine on AI screens) | 36 px (`h-control`), filter buttons: `secondary` button style (`surface`, 1 px `border`, radius 6 px) with a trailing chevron | Always visible. Show current value as label ("vs previous period", "Desktop"). Never removable; they have defaults |
| Active filter chip | `FilterChip` | 36 px (`h-control`), `rounded-md` (6 px, [06-surfaces-borders-radius.md](06-surfaces-borders-radius.md) section 3), `neutral-subtle` background, no border, `type-body` (14 px) | "Field: **Value**" with value in weight 500; clicking the chip reopens its editor popover; the `X` remove button (14 px icon in a 24 x 24 px target, [20-accessibility.md](20-accessibility.md) section 8) removes it |
| Add filter | `AddFilterButton` | 36 px ghost button "+ Filter" | Opens a field picker popover (searchable list of available fields grouped by domain), then that field's editor |
| Clear all | Link button | Vertically centered in the 36 px row | Removes all chips; does not reset scope controls (screen scope here, or date range and location in the top bar). Hidden when no chips |
| Result count | Table toolbar on table pages ([12-tables.md](12-tables.md) section 1); right side of the filter bar on T1 analytics overview pages ([24-page-templates.md](24-page-templates.md) section 3) | `type-meta` | "412 keywords" updates after filtering; announced politely (debounced 500 ms) |
| Engine status legend | A legend built from `EngineStatusGlyph` ([12-tables.md](12-tables.md) section 6), on screens whose table shows those glyphs (Prompts) | Glyphs at their table sizes; labels in `type-label` (12 px, `foreground-tertiary`); 16 px between entries | Right-aligned in the filter bar, on the same row as the filter buttons. Three entries in fixed order: Cited (10 px filled `primary` circle), Mentioned (10 px circle with a 2 px `primary` ring), Not mentioned (6 px `foreground-muted` dot). Static: not interactive and not a tab stop. It is a list (`ul`, `aria-label="Engine status legend"`); the glyphs are `aria-hidden` because each entry's label names the state |

Chips wrap to additional lines; the engine status legend stays right-aligned on the first row. The bar never scrolls horizontally on desktop. From 768 to 1023 px everything in the bar moves behind a "Filters" button with a count badge (the date range stays visible in the top bar); below 768 px that button opens a full-height sheet, which then also holds the date range and location ([19-responsive-behavior.md](19-responsive-behavior.md) sections 3.2 and 4).

Active filter chips are **neutral**, not accent-colored: accent tints are reserved for selection and current navigation, and a screen with five filters must not turn blue ([02-color-system.md](02-color-system.md) section 5).

## 3. Filter editors

Each filter field has a type that determines its editor popover (280 to 360 px wide, max 400 px tall with internal scroll):

| Field type | Editor | Chip label format | Examples |
|---|---|---|---|
| `enum` single | Radio list | `Device: Desktop` | device, panel type |
| `enum` multi | Checkbox list with search when more than 8 options, "Select all" and "Only" hover action per option | `Intent: Commercial, Transactional` (up to 2 values, then `Intent: 3 selected`) | intent, engine, SERP feature, mention status, citation status |
| `entity` multi | Async searchable combobox list with recent values first | `Competitor: HubSpot` (1 name, then `Competitor: 2 selected`, because entity names are long) | competitor, source domain, keyword group, tag |
| `tree` | Tree list with subtree selection and indeterminate parents | `Topic: CRM` (subtree implied, tooltip "Includes 6 subtopics") | topic, cluster, keyword group |
| `range` numeric | Two number fields plus presets | `Volume: 1,000 to 10,000`, `Volume: at least 1,000` | volume, KD, mention rate |
| `rankBucket` | Checkbox list of buckets (1 to 3, 4 to 10, 11 to 20, 21 to 50, 51 to 100, not ranking) plus custom range | `Rank: 1 to 10` | rank |
| `boolean` / tri-state | Segmented Any / Yes / No | `AI Overview: Present` | AI Overview present, cited, branded |
| `text` | Text field with operator (contains, starts with, equals, does not contain) | `Keyword contains: crm` | keyword text, URL path |
| `location` | Searchable location combobox (country, then region, city). Used by the top-bar location control, not as a chip | Button label `United States` | location |

Editor behavior:
- Single-choice editors apply immediately (no "Apply" button).
- Multi-choice editors (`enum` multi, `tree`, `rankBucket`, `range`, `text`) have a footer with a hairline above it, sticky at the bottom of the popover: "Clear" (`ghost`, `sm`) on the left unticks everything; "Apply" (`primary`, `sm`) on the right commits the selection, and Enter does the same. A user can tick several options without a refetch per tick, and nothing changes until they say so.
- "Apply" is disabled until the selection differs from the applied filter; "Clear" is disabled when nothing is ticked. Clear followed by Apply removes the filter.
- Escape or a click outside closes the editor and discards unapplied changes (the applied state stays); the chip, or "+ Filter", regains focus. The next open shows the applied state.
- Operators are shown only for text and numeric fields; enum filters are always "is any of".
- Every editor shows the count of matching records where the API can supply it cheaply (facet counts), otherwise none. Counts never block interaction.

## 4. Available filters by screen

| Screen | Top bar scope | Filter bar scope controls | Filters offered by "+ Filter" |
|---|---|---|---|
| Overview | Date, Location | Compare | Engine, Topic |
| Rankings | Date, Location | Compare, Device | Keyword group, Tag, Topic, Intent, Rank bucket, Ranking URL, SERP feature, AI Overview status, Volume, KD, Competitor outranking, Target URL match |
| Keyword detail | Date | none | Competitor |
| Pages | Date, Location | Device | Topic, Rank bucket, AI citation status, Engine |
| AI Overview (AI Visibility) | Date, Location | Compare, Engine | Topic, Intent, Panel, Branded, Persona |
| Prompts | Date, Location | Compare, Engine | Panel, Topic, Intent, Prompt type, Mention status, Citation status, Recommendation, Competitor mentioned, Branded, Linked keyword |
| Prompt detail | Date | Engine | none |
| Citations / Sources | Date, Location | Engine | Topic, Domain category, Domain role (own, competitor, third party), New or lost, Source domain |
| Competitors | Date, Location | Compare | Topic, Engine, Channel |
| Page detail | Date, Location | Device | Topic, Engine |
| Topics | Date, Location | Compare, Engine | Intent, Branded |
| Matrix | Date, Location | Device | Topic, Intent, Engines for AI axis, Quadrant |
| Reports | none (each report stores its own date range and locations) | none | none |
| Discover | none | none | Source, Status, Intent, Volume, KD |
| Costs | none | Month | Provider, Workload, Project |
| Settings, Integrations | none | none | none |

A top-bar control that does not apply to a screen is hidden there, not disabled; its value is kept and applies again on the next screen that uses it.

**Where Location appears.** Rank checks and AI observations are both collected per market (`location_id` on rank observations and AI observations, [04-data-model.md](../04-data-model.md) section 5.2), so the rule follows the data:

| Rule | Screens |
|---|---|
| Shown: the screen aggregates data that can come from several markets, so the market changes the numbers | Overview, Rankings, Pages, Page detail, AI Overview, Prompts, Citations and Sources, Competitors, Topics, Matrix |
| Hidden, market shown in the header meta line instead: the object has exactly one market as part of its identity (a tracked keyword's location, a prompt's `country_iso`) | Keyword detail, Prompt detail |
| Hidden: location is not a dimension of the screen, or the screen stores its own scope | Discover (candidates carry their own market as a column), Reports (saved per report), Costs, Settings, Integrations |

The Location menu lists the project's tracked locations plus "All locations" (the default, which aggregates). A project with a single tracked location still shows the control, labeled with that location, so every market-dependent page states its market in the same place; the menu then offers only that location and a "Manage locations" link to Settings. Ranks can be tracked down to city level, but AI observations are country-level: on AI screens a selected city filters AI data to its country, and the control says so in its menu ("AI data: United States") ([15-seo-ai-correlation.md](../15-seo-ai-correlation.md) section 2.1).

Filters that do not apply to a screen are not shown (not disabled). A filter carried in a URL to a screen that does not support it is ignored and shown as a dismissible notice "1 filter does not apply here".

Filter semantics that must be visible, from the product rules: Topic filters include subtopics; topic totals do not sum to the project total; AI screens hide Device (engine-level); Branded defaults to "Exclude" on AI screens and is shown as a chip `Branded: Excluded` that the user can change but not silently lose ([20-frontend-specification.md](../20-frontend-specification.md) section 4.2).

## 5. URL state

All filter, scope and search state is in the URL through `nuqs`: the value forms are defined once in `lib/filters/filter-values.ts`, and `useUrlFilters` (`components/app/filters/use-url-filters.ts`) keeps a filter bar's values under these keys.

| Rule | Detail |
|---|---|
| Keys | Short, stable, and listed in the key table below. A new key is added to that table and to `lib/filters/parsers.ts` in the same change |
| Values | Comma-separated ids for multi values (`eng=chatgpt_web,gemini_web`); ranges as `min..max` (`vol=1000..10000`); rank buckets as ids (`rank=top3,top10`) |
| Defaults | Omitted from the URL, so default URLs are clean |
| History | Filter, scope, search and sort changes use `replace` (no history entry per click). Opening the inspector uses `push`, so Back closes it; previous and next record and inspector tab changes (`itab`) use `replace` ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.7). The History column below is binding per key |
| Validation | Unknown or invalid values are dropped with a notice, including a range end outside the field's bounds; the parser never throws |
| Sharing | "Copy link" in the page header copies the canonical URL with the current state |

Key table (every query key used by the application):

| Key | Meaning | History | Owning doc |
|---|---|---|---|
| `from`, `to` | Custom date window bounds (`YYYY-MM-DD`), set by the top-bar date range | replace | 13 (this document), [10-forms.md](10-forms.md) section 10 |
| `win` | Date window preset (`28d`), set by the top-bar date range | replace | 13 |
| `cmp` | Comparison period (`CompareSelect`) | replace | 13 |
| `dev`, `loc`, `eng` | Scope controls: device (filter bar), location (top bar), engines (filter bar). Until the top bar has its location control, Rankings shows `loc` as a filter chip; the key and its value (a location id) stay the same when it moves | replace | 13 |
| `topic`, `grp`, `tag`, `intent`, `rank`, `feat`, `aio`, `vol` | Filters: topic, keyword group, tag, intent, rank bucket, SERP feature, AI Overview status, volume range | replace | 13 |
| `featown` | SERP feature you own filter | replace | 13 |
| `tmatch` | Target URL match filter (`match`, `mismatch`) | replace | 13 |
| `lang`, `stage`, `prio`, `src`, `depth`, `kd` | Filters of Rankings: language, funnel stage, priority at most (`prio=..2`), keyword source, depth profile, KD at most (`kd=..40`). On Rankings `vol` takes its lower end only (`vol=1000..`), as the API filters by `search_volume_gte` | replace | 13, [24-page-templates.md](24-page-templates.md) section 9.3 |
| `archived` | Rankings shows archived keywords instead of active ones (`archived=true`); a view switch, not a chip | replace | 13 |
| `cols`, `density` | Table visible columns in order (`cols=keyword,search_volume`) and row density (`density=compact`) | replace | [12-tables.md](12-tables.md) sections 10 and 11 |
| `quad` | Matrix quadrant filter, shown as a chip | replace | [23-application-patterns.md](23-application-patterns.md) section 15 |
| `domain` | Cited domain filter (Pages tab filtered to a registrable domain; named `domain`, not `source`, because `source` is the cited-URL inspector type) | replace | [23-application-patterns.md](23-application-patterns.md) section 15 |
| `role` | Domain role filter (own, competitor, third party) | replace | [23-application-patterns.md](23-application-patterns.md) section 15 |
| `chg` | Change type filter (`entered`, `lost`, `improved`, `declined`) | replace | [23-application-patterns.md](23-application-patterns.md) section 15 |
| `provider`, `project`, `workload` | Cost dimension filters | replace | [23-application-patterns.md](23-application-patterns.md) section 15 |
| `events` | `EventTimeline` event-type filter on full pages (`events=rank,url`) | replace | [18-notifications-alerts.md](18-notifications-alerts.md) section 7 |
| `q` | Table search text | replace | 13 (section 6) |
| `sort` | Sort keys (`sort=-volume,rank`) | replace | [12-tables.md](12-tables.md) section 8 |
| `view` | Saved view id | push | [12-tables.md](12-tables.md) section 11 |
| `by` | Table grouping column | replace | [23-application-patterns.md](23-application-patterns.md) section 15 |
| `metric` | `MetricSwitcher` value (`ai.mention_rate`) | replace | [23-application-patterns.md](23-application-patterns.md) section 15 |
| `status` | Triage status view (`new`, `accepted`, `snoozed`, `rejected`) | push | [23-application-patterns.md](23-application-patterns.md) section 15 |
| `tab` | Page tab (query-parameter tabs only; route tabs use the path) | push | [09-buttons-controls.md](09-buttons-controls.md) section 12 |
| `inspect` | Open inspector, `?inspect=type:id` (`inspect=keyword:9f2c`). Types: `keyword`, `prompt`, `citation`, `answer`, `page`, `competitor`, `domain` (registrable domain), `source` (cited URL), `run`, `candidate` (Discover candidate, evidence inspector, [24-page-templates.md](24-page-templates.md) section 9.11) | push on open, replace for previous and next record | [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.7 |
| `itab` | Inspector tab slug of the open type (for example `serp`, `ai`, `timeline`, `history`, `stats`); default `overview` | replace | [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.7 |
| `stats` | Page-level statistics panel, `<metric>:<engine>` | push | [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 8, [23-application-patterns.md](23-application-patterns.md) section 8 |
| `obs`, `vs` | Observation shown in the evidence viewer, and the comparison observation (`obs=<idA>&vs=<idB>`) | push | [23-application-patterns.md](23-application-patterns.md) section 15 |
| `notif` | Notification event id from an email, Slack or webhook link; marks the notification read on arrival, then removed with `replace` | replace | [18-notifications-alerts.md](18-notifications-alerts.md) section 10 |
| `rule`, `date` | Alerts events screen scoped to one rule and business date (`rule=<rule_id>&date=2026-09-29`) | replace | [18-notifications-alerts.md](18-notifications-alerts.md) section 10 |
| `next` | Return path after sign-in, on `/login` only | not applicable | [18-notifications-alerts.md](18-notifications-alerts.md) section 10 |

Example (`/<workspace>/<project>` prefix, then the project route from [11-navigation.md](11-navigation.md) section 1.1): `/acme/northwind/seo/rankings?win=28d&dev=desktop&loc=2840&topic=t_12&rank=top3,top10&sort=-volume&inspect=keyword:9f2c&itab=serp`.

## 6. Search

| Search | Where | Behavior |
|---|---|---|
| Command palette | Global, `Cmd/Ctrl+K` or the search field in the top bar | Navigation, entity search (keywords, prompts, domains, pages), actions ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md)) |
| Table search | Table toolbar, `/` on table pages when focus is not in an input | Filters the table by its identity column (and URL for page tables); client-side instantly in client mode, 250 ms debounced server query in server mode; stored as `q` in the URL; not a chip (it is visible in its own field) |
| Scoped search in pickers | Inside filter editors, comboboxes, column chooser | Filters the option list; async lists debounce 250 ms and show "Searching" after 300 ms ([10-forms.md](10-forms.md) section 6.3) |
| Keyword and prompt search in inboxes | Discovery tables | Same as table search, plus operator hints |

Table and page search use one component, `SearchInput` (`components/ui/search-input.tsx`), specified in [10-forms.md](10-forms.md) section 17, which owns its anatomy: 32 px (`sm`, `w-60`) in table toolbars and 36 px (`md`, `w-90`) on pages; 1 px `border` control outline (the visible label or placeholder and the leading icon identify it, [20-accessibility.md](20-accessibility.md) section 3.2, rule 6); leading `Search` icon, 14 px (`sm`) or 16 px (`md`), in `foreground-muted`; placeholder naming the object ("Search keywords"); trailing `Kbd` hint `/` while empty and not focused; clear button (`X`, `icon-xs`, 24 px target, name "Clear search") while not empty. Escape clears the text first, then blurs.

Matching rules: case-insensitive, diacritic-insensitive, matches anywhere in the string for table search; command palette ranks prefix matches above substring matches above fuzzy matches.

## 7. Keyboard shortcuts for filtering and search

| Shortcut | Action | Scope |
|---|---|---|
| `Cmd/Ctrl+K` | Open command palette | Global |
| `/` | Table pages: focus table search. Other pages: open the command palette in search mode ([20-accessibility.md](20-accessibility.md) section 14) | When focus is not in an input; can be disabled with other single-key shortcuts |
| `f` | Open "+ Filter" field picker | Table pages, when focus is not in an input; can be disabled with other single-key shortcuts |
| `Delete` or `Backspace` on a chip's focused remove button | Remove the filter | Filter bar |
| Tab / Shift+Tab | Move between chip buttons (edit and remove) in DOM order | Filter bar (a group of buttons, no roving focus) |
| `Escape` | Close editor, then clear search | Contextual |

All shortcuts are listed in the keyboard help dialog (`?`) and documented in [20-accessibility.md](20-accessibility.md).

## 8. Accessibility

- `FilterBar` is a `div` with `role="group"` and the accessible name "Filters" (not a landmark, not a toolbar); chips are buttons with names like "Topic: CRM. Edit filter" and remove buttons named "Remove filter Topic: CRM". Tab moves between chip buttons in DOM order ([20-accessibility.md](20-accessibility.md) sections 4.6 and 5).
- Editors are popovers with dialog semantics (focus moves into the editor, Escape returns focus to the chip).
- After a filter change, a polite live region announces the result count once the data arrives ("412 keywords").
- Removing a chip moves focus to the next chip, or to "+ Filter" when none remain.

## 9. Saved views and filters

Saved views ([12-tables.md](12-tables.md) section 11) store the full filter state. When a saved view is active, chips that differ from the view are marked with a 6 px `primary` dot at the chip's leading edge and the view menu shows "(edited)". This is the only place the accent marks filter state in the filter bar. The engine status legend (section 2) shows the table's cobalt glyphs as a key, not as state.
