# 00. Design Principles

Status: Accepted (design-system v2)
Last updated: 2026-09-29
Scope: every screen, component and chart in the web application. This folder is the UI source of truth. [DESIGN_SYSTEM.md](../../DESIGN_SYSTEM.md) is the entry point; [AI_DEVELOPMENT_UI_RULES.md](../../AI_DEVELOPMENT_UI_RULES.md) is the short rule set for coding agents.

## 1. What this product is

A measurement instrument for SEO rankings and AI answer visibility, used for hours at a time by analysts who compare, filter and drill into thousands of records. It is not a marketing dashboard. The governing sentence:

> The interface should look like a professional analytical instrument, not a collection of dashboard components.

Design read used for every decision in this system: information-dense product UI for SEO and GEO power users, with v2 sizing (14 px interface text, 36 px controls, 40 px table rows in Default density, 32 px in Compact), restrained instrument-grade language, built on shadcn/ui with Base UI primitives, Tailwind CSS v4 and Geist. Visual variance 2 of 10, motion 2 of 10. The visual values come from the reference screens through [reference/visual-spec.md](reference/visual-spec.md).

## 2. Principles

| # | Principle | What it means in practice |
|---|---|---|
| P1 | **Data first, chrome last** | Tables, numbers and charts get the pixels. Chrome (headers, panels, decoration) is thin and quiet. Real data (a metric strip, chart or table) starts within 200 px below the top bar when a page has tabs and a filter bar, and about 130 px below it otherwise ([23-application-patterns.md](23-application-patterns.md) section 3.2). |
| P2 | **Neutral by default, color means something** | About 95% of pixels are neutral. The single accent marks selection, current location, the primary action, links and the own-brand series. Green, red and amber appear only when a value is good, bad or needs attention, and only when that judgment is statistically defensible. |
| P3 | **One way to do each thing** | One filter pattern, one table, one inspector, one number formatter, one chart wrapper. A new pattern is added to this system first, then used. |
| P4 | **Density from organization, not compression** | Alignment, grouping, typographic hierarchy and progressive disclosure create density. Text does not go below 12 px (the 11 px keyboard hint is the only exception), `DataTable` rows not below 32 px, targets not below 24 px. |
| P5 | **Every number is honest** | Numbers carry units, denominators and sample sizes. Estimates are labeled. Unknown is shown as unknown, never as zero. Rank 1 is better than rank 10 and the UI never makes that ambiguous. |
| P6 | **Context is preserved** | Inspecting a record opens the right inspector over the list; the list keeps its scroll, filters and selection. Everything important is in the URL so views can be shared, reloaded and compared. |
| P7 | **Keyboard and screen reader are first-class** | Every action works without a mouse. Focus is always visible. Charts have text and table alternatives. |
| P8 | **Calm under load** | No full-page spinners, no layout shift, no animation for its own sake. Motion only confirms a change of state and lasts 100 to 200 ms. |
| P9 | **Separate channels stay separate** | SEO rank, AI rates and first-party metrics sit side by side with their own labels and axes. Nothing in the UI invents a combined score. |
| P10 | **Same product on every screen** | A user moving from Rankings to Prompts to Costs sees the same header, filter bar, table, badges and states. Consistency beats local cleverness. |

## 3. Information density rules

Density is required and must be earned. These rules apply to every screen:

1. **Tables over cards** for any list a user would sort, filter, compare or act on in bulk ([12-tables.md](12-tables.md) section 2).
2. **Metric strips over KPI cards.** Summary numbers sit in one horizontal strip of 3 to 6 metrics: a single panel, 76 px tall, with cells split by 1 px dividers ([23-application-patterns.md](23-application-patterns.md) section 2).
3. **Progressive disclosure in four levels** ([23-application-patterns.md](23-application-patterns.md) section 1): scan (row), hover (tooltip), inspect (right inspector), study (full page). Each piece of information is assigned to exactly one level where it first appears.
4. **Secondary information moves right or down, not into more borders.** Metadata goes to a second line in `type-meta`, a tooltip, or the inspector.
5. **No empty decoration.** No illustrations, background patterns, gradients, glow or decorative icons.
6. **Whitespace is a spacing token, never "some padding".** Every gap comes from the scale in [04-spacing-density.md](04-spacing-density.md).

## 4. Hierarchy toolkit (in order of preference)

When something needs to stand out, use the first tool on this list that works:

1. Position (top-left of its region, first column, pinned)
2. Typographic weight (500 or 600 instead of 400)
3. Text color step (`foreground` vs `foreground-secondary` vs `foreground-tertiary`)
4. Size step (one step in the type scale)
5. Surface step (`surface-subtle` background for a region)
6. Border (1 px `border` or `border-subtle`)
7. Accent or semantic color (only when it carries meaning)

Shadows and larger radii are never hierarchy tools; they are reserved for overlays ([06-surfaces-borders-radius.md](06-surfaces-borders-radius.md)).

## 5. Decisions made for you

A developer building a new screen does not decide any of the following; the answer is in this system:

| Question | Answer |
|---|---|
| Font | Geist Sans; Geist Mono only for URLs and domains in tables, IDs, keys, raw queries and code ([03](03-typography.md)) |
| Text size | One of 15 composite type utilities (`type-page-title` to `type-kbd`) ([03](03-typography.md)) |
| Spacing | 0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48 px ([04](04-spacing-density.md)) |
| Control height | 36 px default, 32 px small (pagination, icon buttons in tables and inspectors), 40 px only on auth and onboarding ([04](04-spacing-density.md)) |
| Table row height | 40 px default, 32 px in the Compact density setting and in tables embedded in panels and inspectors; 40 px header row ([04](04-spacing-density.md), [12](12-tables.md)) |
| Radius | 3, 4, 6, 8, 10 px or full, by element type: panels 8, controls 6, badges 4 ([06](06-surfaces-borders-radius.md)) |
| Colors | Tokens only ([02](02-color-system.md)); no hex, no Tailwind palette |
| Filter UI | Filter bar with secondary filter buttons (label and chevron) and removable neutral chips ([13](13-filters-search.md)) |
| Chart colors | `chart-1` to `chart-6` in fixed order, own brand is always `chart-1` ([15](15-data-visualization.md)) |
| Loading | Skeletons shaped like the final content; keep previous data during refetch ([17](17-empty-loading-error-states.md)) |
| Record detail | Right inspector, URL-addressable; full page only for deep objects ([16](16-drawers-dialogs-popovers.md)) |
| Numbers | `@/lib/format` only ([22](22-content-formatting.md)) |
| Rank change | Arrow plus positions (`↑5`), colored only when beyond the keyword's normal movement ([22](22-content-formatting.md)) |
| Citations and prompts | `CitationList`, `PromptCell` components ([25](25-component-inventory.md)) |
| SEO vs AI comparison | `SEOAIStatus`, `SEOAIMatrix`, `SEOAIComparisonRow` ([25](25-component-inventory.md)) |

## 6. What this system deliberately rejects

The full list with enforcement is in [27-design-review-checklist.md](27-design-review-checklist.md) section 3. The short form: oversized KPI cards, gradients, glassmorphism, glow, large radii, decorative shadows, rainbow charts, pie and donut charts, pill overload, colored metric backgrounds, decorative illustrations, full-page spinners, count-up animations, oversized headers, nested cards, more than one accent color, icon-only controls without labels or tooltips, and em-dashes in any UI text.

## 7. How to change the system

1. Propose the change with a screenshot or wireframe and the screens it affects.
2. Update the relevant document here, the tokens or components, and the design-system preview.
3. Add or update an ADR in [adr/](adr/) if the change reverses a decision.
4. Visual regression baselines are updated in the same pull request ([26-implementation-guidelines.md](26-implementation-guidelines.md) section 11).

A pull request that introduces a new visual pattern without steps 2 to 4 is rejected in review.
