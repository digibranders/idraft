# ADR-DS-018: Visual v2 from reference screens

Status: Accepted
Date: 2026-09-29

## Context
The seven reference screens in [reference/README.md](../reference/README.md) were generated from the v1 tokens to calibrate finish. The user chose them as the exact visual source of truth for the product. Every visual value in them was measured and recorded in [reference/visual-spec.md](../reference/visual-spec.md). They differ from v1 in density, accent saturation, sizes and some component styling. Product and data rules (information architecture, detectability, denominators, `n/a`, accessibility, URL state, keyboard behavior) are not part of this decision and stay as specified.

## Decision
Adopt visual-spec.md as the visual layer of the design system (v2). `tokens.css` and `globals.css` carry its values, and documents 00 to 27 follow them:
- Sizing: 14 px body text, 13 px table cells, 36 px controls, 40 px table rows (Default density) and header rows, 32 px rows only in Compact density and embedded tables. Default and Compact are the only two densities.
- A brighter, more saturated cobalt accent: `--primary` `#1E65E3`, `--primary-text` `#175AD0`, `--primary-subtle` `#EAF1FE`, `--primary-border` `#B5CCF6`.
- Shell: 208 px sidebar with 32 px items, 52 px top bar (breadcrumb with a `House` root; search, the project-wide date range and location, notifications, theme, help, avatar), 24 px page title, 20 px page gutter, 16 px between page blocks. Screen-specific scope and filters stay in the filter bar; URL keys do not change.
- The metric strip stays one panel (76 px, full-height dividers), never KPI cards.
- Inspector: 400 px default, 440 px for prompt, citation and answer evidence, 360 to 640 px, no shadow when docked.
- The selected segment of a segmented control uses the accent (`primary-subtle` fill, `primary-border` outline, `primary-text` label).
- New components: `CountTabs`, `EngineStatusGlyph`, `EnginePresenceSquare`, `BarList`, `StackedBar100`, `ChartTooltip`, `QuoteBox`, `DomainChip`, `RuleList`.

## Alternatives considered
Keep the v1 density (32 px rows and controls, 13 px base): more rows per screen, but it does not match the screens the user chose. Copy the earlier BrandLens set: rejected, because it has a saturated indigo accent, multicolored pills, KPI cards with tinted icon tiles and a donut chart, which break the one-accent, strip-over-cards and no-donut rules.

## Tradeoffs
Fewer rows per viewport: about 11 at 1440 x 900 in Default density instead of 17, so the height budget for data is now 200 px below the top bar on pages with tabs and a filter bar, and about 130 px otherwise ([23-application-patterns.md](../23-application-patterns.md) section 3.2). Compact density (32 px) stays available per table. The accent now marks one more state (the selected segment and the pressed `CountTabs` item), so reviewers check that it still marks only selection, action, location, focus, links and the own-brand series. The 400 px inspector leaves more room for the table; content that needs width uses the 440 px wide variant or the full page. Two chart values (olive and the checkbox outline) are darker than the screens so the color-vision and 3:1 tests pass.

## Revisit trigger
A new reference set replaces these screens, or usability testing shows analysts losing throughput at the default density.
