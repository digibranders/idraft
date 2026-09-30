# AI Development UI Rules

Read this before implementing or modifying any UI. These rules override habits and generic defaults.

**Before implementing or modifying UI, read the Design System documentation (`DESIGN_SYSTEM.md` and the relevant files in `docs/design-system/`) and reuse existing components and patterns. Do not invent new visual patterns without updating the Design System first.**

## The rules

1. **Reuse before building.** Look in `apps/web/src/components/ui`, `components/app` and `docs/design-system/25-component-inventory.md`. If a component exists, use it. If it almost fits, extend it through a documented variant, not a copy.
2. **Tokens only.** No hex, `rgb()`, `hsl()`, `oklch()` literals, no Tailwind palette classes (`bg-blue-500` does not exist here), no arbitrary values (`p-[13px]`, `bg-[#...]`). Use token utilities: `bg-surface`, `bg-surface-subtle`, `text-foreground-secondary`, `border-border-subtle`, `bg-primary`, `text-positive-text`, and so on.
3. **Type utilities only.** Every text element uses one of the 15 composite utilities: `type-page-title`, `type-inspector-title`, `type-section-title`, `type-subsection-title`, `type-body`, `type-body-strong`, `type-prose`, `type-table`, `type-meta`, `type-label`, `type-micro`, `type-metric`, `type-metric-sm`, `type-mono`, `type-kbd`. Add `num` to every compared number.
4. **Spacing scale only.** Allowed steps: 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12 (4 px base). Sizes: `h-control` (36, default), `h-control-sm` (32, pagination and icon buttons in tables and inspectors), `h-control-lg` (40, auth and onboarding only), `h-row` (40, Default density), `h-row-compact` (32, Compact density and every table embedded in a panel or inspector), `h-row-header` (40), `h-topbar` (52), `w-sidebar` (208), `h-sidebar-item` (32), `h-tab` (44), `h-metric-strip` (76), `h-badge` (22), `size-avatar` (32), `h-save-bar` (56, settings save bar), `w-inspector` (400), `w-inspector-wide` (440, prompt, citation and answer evidence).
5. **Format through `@/lib/format`.** Never call `Intl.*`, `toFixed`, `toLocaleString` or date-fns `format` in components. Ranks use `formatRankCell` / `formatRankChange`; rates use `formatPercent` / `formatPointsDelta`; dates use `formatTableDateTime` / `formatDetailDateTime` / `formatRelative`; URLs use `displayUrl`.
6. **Never choose green or red yourself.** Tones come from `formatMetricDelta` and `formatRankChange`. Undetectable changes stay neutral.
7. **Tables for records.** Any list users compare, sort, filter or act on in bulk is a `DataTable` with `col.*` column helpers. Never a card grid.
8. **One filter system.** Use `FilterBar` in the page header with neutral `FilterChip`s for screen scope and filters. The date range and location are project-wide scope controls in the `TopBar`, never in the filter bar. No filter forms, no table-specific filter panels.
9. **Record detail opens in the right inspector** (`useInspector`, URL `?inspect=type:id`). Full pages only for deep objects documented in `docs/design-system/16-drawers-dialogs-popovers.md`.
10. **Summaries are a `MetricStrip`** (one 76 px panel with full-height dividers), not large KPI cards.
11. **Every metric shows its denominator or sample size** where the API provides it; unknown values render as beyond depth, insufficient data or not applicable, never as zero.
12. **Charts go through `ChartFrame` and the ECharts wrapper** with theme colors from tokens. No Recharts, no pie or donut charts, no gradients, no chart animation. Own brand is always `chart-1`.
13. **Base UI primitives through `components/ui`.** Do not import Radix, MUI, Ant, Chakra or Mantine. Icons are Lucide through the `Icon` wrapper, 16 px default, 14 px in tables, 18 px in the sidebar.
14. **Accessibility is required, not optional.** Visible focus (`:focus-visible` ring), keyboard access, accessible names for icon buttons, labels above inputs, text alternatives for charts, non-drag alternatives for drag interactions, 24 px minimum targets. Single-key shortcuts (every single-character and sequence shortcut in `docs/design-system/20-accessibility.md` section 14, such as `/`, `f`, `j`, `k` and the triage keys) can be turned off in the user menu (WCAG 2.1.4).
15. **Keep state in the URL** (filters, sort, search, view, inspector, tab) with the shared `nuqs` parsers in `lib/filters/parsers.ts`.
16. **Copy is neutral and precise.** Sentence case, no exclamation marks, no hype, and **no em-dashes (U+2014) or en-dashes (U+2013) anywhere**. Ranges use "to". Use the glossary terms in `docs/design-system/22-content-formatting.md`.
17. **States are part of the work.** Every screen ships loading (skeleton), empty (reason plus action), error (retry), partial and stale states. No full-page spinners. Skeletons pulse (no shimmer). A refetch keeps previous data at full opacity (no dimming) with the static 2 px `RefetchBar`.
18. **Motion is 100 to 200 ms and only for state changes.** Nothing animates on load. Respect reduced motion.
19. **Both themes, both densities.** Check light and dark, Default and Compact density, in the `/design-system` preview route before opening a pull request.
20. **Run the checks** in `apps/web`: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; update visual regression baselines only together with a design-system document change.

## When something is missing

If the design system does not cover what you need: stop, propose the addition (document section, tokens, component spec, preview entry), then implement it. Do not create a local one-off style.

## Prohibited (fast list)

Oversized KPI cards · gradients · glassmorphism · glow · radii above 10 px · pills for badges · shadows on panels · colored metric backgrounds · second accent color · rainbow charts · pie charts · illustrations · full-page spinners · count-up animations · huge page headers · nested cards · record lists as cards · icon-only controls without tooltip · uppercase tracked labels · monospace for ordinary numbers · hard-coded colors, spacing or z-index · em-dashes and en-dashes · combined AI+SEO scores.
