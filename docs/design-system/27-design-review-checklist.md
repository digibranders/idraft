# 27. Design Review Checklist and Anti-patterns

Status: Accepted (design-system v2)
Last updated: 2026-09-29

Every new screen, and every change that affects layout, color, typography or interaction, passes this checklist before merge. The reviewer ticks each item or writes why it does not apply.

## 1. Screen review checklist

### Structure and density
- [ ] Is information that users compare, sort or act on in bulk shown as a table ([12-tables.md](12-tables.md) section 2)?
- [ ] Does real data start within 200 px below the 52 px top bar when the page has tabs and a filter bar, and about 130 px below it otherwise, at 1440 x 900 ([23-application-patterns.md](23-application-patterns.md) section 3.2)?
- [ ] Are there unnecessary cards, nested panels or borders around every group?
- [ ] Is summary data in a metric strip (one 76 px panel, cells split by full-height dividers, delta inline after the value) rather than large KPI cards?
- [ ] Is the spacing on the scale: 20 px page gutter, 16 px between page blocks, panels with 16 px padding, 8 px radius and a 48 px title row ([reference/visual-spec.md](reference/visual-spec.md) section 4)?
- [ ] Are controls 36 px (`h-control`), with 32 px (`h-control-sm`) only for pagination and icon buttons in tables and inspectors? Are the table toolbar and table footer 48 px, and menu, select and combobox option rows 32 px?
- [ ] Are table rows 40 px (`h-row`), or 32 px (`h-row-compact`) in Compact density and in tables embedded in panels and inspectors, under a 40 px header row on `surface-subtle`?
- [ ] Is the inspector 400 px, or 440 px for prompt, citation and answer evidence, with no shadow when docked?
- [ ] Could secondary information move to a tooltip, the inspector or a detail page ([23-application-patterns.md](23-application-patterns.md) progressive disclosure)?
- [ ] Is the hierarchy clear from position, weight and text color alone, without decoration ([00-design-principles.md](00-design-principles.md) section 4)?
- [ ] Does the screen follow one of the page templates ([24-page-templates.md](24-page-templates.md))?

### Consistency
- [ ] Does it look like the same product as Rankings and Prompts (same header, filter bar, table, badges, states)?
- [ ] Are filters the standard `FilterBar` with neutral chips, with the date range and location in the top bar rather than the filter bar ([13-filters-search.md](13-filters-search.md) section 1, [11-navigation.md](11-navigation.md) section 4)?
- [ ] Does record detail open in the inspector (or a documented full page)?
- [ ] Are only documented components used? Does it introduce an undocumented UI pattern? If yes, is the design-system document updated in the same pull request?

### Color and type
- [ ] Does every color convey meaning? Is the accent used only for primary action, selection (selected row, selected segment, pressed `CountTabs` item), current location, focus, links and the own-brand series?
- [ ] Are deltas colored only when detectable or emphasized, via `formatMetricDelta` / `formatRankChange`?
- [ ] Are categorical badges (engine, intent, type) neutral?
- [ ] Are only token utilities used (no hex, no palette classes, no arbitrary values)?
- [ ] Is every text element one of the 15 `type-*` utilities (body 14 px, table cells 13 px, page title 24 px)?
- [ ] Are numbers tabular (`num`) and right-aligned in tables?
- [ ] Is dark mode correct (layered surfaces, readable semantic colors, charts re-themed)?

### Numbers and honesty
- [ ] Do metrics show denominators and sample sizes where the metric contract requires them?
- [ ] Are estimates labeled; is unknown shown as unknown (beyond depth, insufficient, not applicable) rather than zero?
- [ ] Are rank semantics unambiguous (arrows, inverted rank axes)?
- [ ] Are SEO, AI and first-party values kept in separate columns and axes with no combined score?
- [ ] Is all formatting done through `@/lib/format`?

### States
- [ ] Are loading (skeleton), empty (reason plus action), error (with retry), partial and stale states designed ([17-empty-loading-error-states.md](17-empty-loading-error-states.md))?
- [ ] Does a refetch keep previous data visible at full opacity (no dimming, no skeleton flash), with the static 2 px `RefetchBar` ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) section 3.4)?
- [ ] Are permission-restricted actions hidden or disabled with a reason?

### Interaction, URL and keyboard
- [ ] Is URL state preserved (filters, sort, search, view, inspector, tab)? Does reload restore the view? Does Back close the inspector?
- [ ] Can every action be done by keyboard; is focus always visible and never hidden under sticky elements?
- [ ] Do icon-only controls have tooltips and accessible names?
- [ ] Do drag interactions (column resize, reorder, inspector resize, matrix selection) have non-drag alternatives?

### Responsive and accessibility
- [ ] Does it work at 1440 px; does it remain fully usable at 1280 px; is the tablet layout usable; is the mobile view limited to monitoring as specified ([19-responsive-behavior.md](19-responsive-behavior.md))?
- [ ] Do column priorities hide the right columns at smaller widths, following the viewport tiers rather than the inspector state ([19-responsive-behavior.md](19-responsive-behavior.md) section 6.1)?
- [ ] Does axe report zero violations; do charts have summaries and table alternatives ([20-accessibility.md](20-accessibility.md))?
- [ ] Is motion limited to state changes and disabled under reduced motion ([21-motion.md](21-motion.md))?

### Copy
- [ ] Is copy concise, neutral and specific, in sentence case, with no exclamation marks and no em-dashes or en-dashes ([22-content-formatting.md](22-content-formatting.md) section 1)?
- [ ] Are terms used exactly as in the glossary ([22-content-formatting.md](22-content-formatting.md) section 9)?

## 2. Component review checklist

- [ ] Placed in the right layer (`components/ui`, `components/app`, `features`) ([26-implementation-guidelines.md](26-implementation-guidelines.md) section 2).
- [ ] Variants limited to documented axes; no boolean style props.
- [ ] All interaction states from [08-interaction-states.md](08-interaction-states.md) implemented and visible in the preview route in both themes.
- [ ] Keyboard and ARIA pattern documented and tested.
- [ ] Visual regression screenshots added.
- [ ] Listed in [25-component-inventory.md](25-component-inventory.md) with purpose, props, states and when not to use.

## 3. Anti-patterns (prohibited unless this document is changed)

| Anti-pattern | Why it is prohibited | Do instead |
|---|---|---|
| Oversized KPI cards (a row of large boxed numbers) | Wastes the first viewport; decorative | `MetricStrip` |
| Gradients (backgrounds, buttons, text, chart areas) | Decorative, reduces legibility | Flat tokens |
| Glassmorphism, backdrop blur | Decorative, contrast unpredictable | Solid `surface-elevated` |
| Glow effects, neon accents | Decorative, "AI product" cliché | None |
| Radii above 10 px; pill-shaped badges and chips | Soft consumer look, wastes space | Radius scale ([06](06-surfaces-borders-radius.md)) |
| Shadows on panels, cards or tables | Floating-card look | Borders and tonal surfaces |
| Colored backgrounds for every metric | Color loses meaning | Neutral with semantic deltas |
| More than one accent color | Breaks the neutral system | Cobalt only |
| Rainbow or arbitrary chart colors | Unreadable, not colorblind-safe | Chart palette in fixed order |
| Pie or donut charts | Poor comparison | 100% stacked or horizontal bars |
| 3D charts, chart shadows, animated chart entrances | Decorative | Flat ECharts theme |
| Decorative illustrations and large empty-state artwork | Noise | `EmptyState` with one icon at most |
| Full-page spinners | Hides structure, feels slow | Skeletons and progressive loading |
| Count-up number animations, bouncing, floating, continuous motion | Distracting | Static values; 100 to 200 ms state transitions |
| Oversized page headers (hero-like) | Pushes data down | `PageHeader` within the height budget of [23-application-patterns.md](23-application-patterns.md) section 3.2 |
| Excessive badges (more than 3 per row) | Noise | Inspector for metadata |
| Nested cards | Visual clutter | Dividers and wells |
| Lists of records as cards | Cannot compare or sort | `DataTable` |
| Horizontal-scroll-heavy tables without column priorities | Hidden information | Column priority and inspector |
| Hidden navigation (hamburger on desktop) | Slows power users | Persistent sidebar |
| Icon-only ambiguous controls | Unclear | Label or tooltip plus accessible name |
| Giant filter forms above tables | Takes the viewport | `FilterBar` |
| Placeholder text as label | Accessibility failure | Label above control |
| Uppercase labels with wide tracking | Harder to read, templated look | Sentence case |
| Monospace for ordinary numbers | Uneven table typography | Geist Sans with `num` |
| Hard-coded colors, spacing or z-index | System drift | Tokens and scale |
| Em-dashes or en-dashes in UI text | House style | Colon, comma, parentheses, "to" |
| Hype copy, exclamation marks, anthropomorphic AI language | Unprofessional | [22-content-formatting.md](22-content-formatting.md) section 1 |
| A combined "AI + SEO score" | Methodologically unsound | Matrices and component metrics |
| Red/green deltas for statistically undetectable changes | False signal | Neutral with "Within normal variation" |

## 4. Enforcement summary

| Mechanism | Catches |
|---|---|
| Tailwind theme reset (`--color-*: initial` and equivalents) | Palette colors, default font sizes, radii, shadows do not exist as classes |
| ESLint rules ([26-implementation-guidelines.md](26-implementation-guidelines.md) section 9) | Hex colors, color functions, dashes in strings, raw formatting, competing libraries, unknown classes, arbitrary values, off-scale spacing, raw z-index |
| Token tests | Contrast regressions, gamut, chart palette separation |
| Formatter tests | Number, rank, date and URL display regressions |
| Visual regression | Unintended visual change in primitives, components and templates |
| axe in CI | Accessibility regressions |
| This checklist in pull request review | Structure, density, honesty and consistency issues no tool can catch |
