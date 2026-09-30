# 26. Implementation Guidelines

Status: Accepted (design-system v2)
Last updated: 2026-09-30
Stack versions verified 2026-09-29 (`research/09-frontend-stack.md`): Next.js 16.3, React 19.3, Tailwind CSS 4.3, shadcn CLI 4.21 (Base UI default), @base-ui/react 1.8, @tanstack/react-table 9.2, @tanstack/react-virtual 3.14, @tanstack/react-query 5.104, echarts 6.1, lucide-react 1.48, nuqs 2.10, date-fns 4.4 with @date-fns/tz 1.5, react-hook-form 7.89, zod 4.6 (client-side form schemas only), openapi-typescript and openapi-fetch (API client generated from the backend's OpenAPI document, [ADR-022](../adr/ADR-022-python-backend-simplified-platform.md)), geist 1.7, @playwright/test 1.63. The app is self-hosted as a Next.js standalone build on the droplet (no Vercel).

## 1. Source-of-truth files

Coding agents and engineers read these before any UI work ([AI_DEVELOPMENT_UI_RULES.md](../../AI_DEVELOPMENT_UI_RULES.md)):

| File | Role |
|---|---|
| `DESIGN_SYSTEM.md` | Entry point and summary |
| `AI_DEVELOPMENT_UI_RULES.md` | Highest-priority rules for coding agents |
| `docs/design-system/*` | The specification |
| `apps/web/src/styles/tokens.css` | Token values (both themes) |
| `apps/web/src/styles/globals.css` | Tailwind mapping, composite type utilities |
| `apps/web/src/styles/app.css` | The application's stylesheet entry: `globals.css` plus the source folders |
| `apps/web/src/lib/format/` | All value formatting |
| `apps/web/src/lib/design/` | Token contrast tests, runtime token reader |
| `apps/web/src/components/ui/` | Design-system primitives |
| `apps/web/src/components/app/` | Application components (cells, charts, tables, metric, inspector, forms, status) |

## 2. Directory structure

```
apps/web/src/
  app/                              Next.js routes (App Router); thin, compose features
  components/
    ui/                             Primitives built on Base UI (shadcn base-nova, restyled)
      button.tsx  icon-button.tsx  split-button.tsx  toggle-button.tsx  toggle-group.tsx
      segmented-control.tsx  toolbar.tsx  copy-button.tsx  external-link-button.tsx  text-link.tsx
      icon.tsx  kbd.tsx  spinner.tsx  live-indicator.tsx  separator.tsx  scroll-area.tsx
      skeleton.tsx  avatar.tsx  badge.tsx  tag.tsx  truncate.tsx  collapsible.tsx
      tooltip.tsx  toggletip.tsx  popover.tsx  preview-card.tsx  menu.tsx  context-menu.tsx
      dialog.tsx  alert-dialog.tsx  stepper-dialog.tsx  drawer.tsx  tabs.tsx  pagination.tsx
      progress.tsx  meter.tsx  toast.tsx
      field.tsx  input.tsx  input-variants.ts  input-group.tsx  password-input.tsx  otp-field.tsx
      textarea.tsx  select.tsx  combobox.tsx
      multi-select.tsx  checkbox.tsx  checkbox-group.tsx  radio-group.tsx  switch.tsx
      setting-row.tsx  slider.tsx  calendar.tsx  date-picker.tsx  number-field.tsx
      secret-input.tsx  secret-reveal.tsx  file-dropzone.tsx  search-input.tsx  save-bar.tsx
      error-summary.tsx  form-alert.tsx  read-only-field.tsx
      icons/custom/                 Custom glyphs when Lucide lacks one (07-icons.md)
    app/                            Reusable application components (domain-aware, no data fetching)
      types.ts                      Shared component types (25-component-inventory.md section 1.5)
      data-table/                   DataTable, column helpers (col.*), toolbar, bulk bar, column chooser, TableFooter
      cells/                        RankCell, RankDeltaCell, DeltaCell, MetricCell, URLCell, DomainCell, ...
      metric/                       MetricStrip, MetricItem, MetricCard, Delta, ConfidenceIndicator, SampleCount,
                                    value states (InsufficientData, NotCollected, NotApplicable, BeyondDepth)
      chart/                        EChart wrapper, ChartFrame, RankHistoryChart, RateTrendChart, MatrixScatter,
                                    Heatmap; options/ holds the build<Name>Option functions
      sparkline/                    Canvas sparkline renderer and SparklineCell
      filters/                      FilterBar, FilterChip, filter editors, DateRangePicker
      forms/                        FormField, UrlInput, DomainInput (react-hook-form and lib/forms normalizers)
      inspector/                    Inspector shell, InspectorHeader, InspectorTabs, useInspector
      status/                       StatusBadge, FreshnessIndicator, CollectionProgress, EmptyState, RefetchBar,
                                    InlineError, ErrorPage, Banner, EventTimeline, TriageToast
      evidence/                     ResponsePreview, EvidenceText, CitationList
      seo/                          SERPFeatureList, AIOverviewStatus, KeywordIntentBadge, CannibalizationIndicator
      ai/                           EngineBadge, MentionStatus, CitationStatus, RecommendationStatus
      cross/                        SEOAIStatus, SEOAIComparisonRow, SEOAIMatrix, QuadrantSummary
      shell/                        Sidebar, TopBar, PageHeader, DetailPageHeader, CommandPalette,
                                    NotificationCenter, HelpMenu, ThemeSwitch, ThemeMenu
    design-system/                  Preview route sections (not imported by product code)
  features/                         Screen-level feature modules (data fetching, composition)
    rankings/  keyword-detail/  prompts/  prompt-detail/  citations/  sources/  competitors/
    matrix/  pages/  discover/  integrations/  settings/  costs/  alerts/  overview/
      components/  hooks/  queries.ts  columns.tsx  filters.ts
  lib/
    utils.ts                        cn() class merge helper (clsx plus tailwind-merge, shadcn convention)
    format/                         Formatters (tested)
    design/                         Token reader, contrast tests
    filters/                        nuqs parsers and filter field registry
    metrics/                        Metric definitions registry (labels, definitions, polarity)
    a11y/                           announce() live-region announcer, useShortcut
    forms/                          applyServerErrors (validation items of a problem to fields), input normalizers (display preview only; the API normalizes)
    api/                            Generated OpenAPI types (schema.d.ts), openapi-fetch clients, query keys
  styles/
    tokens.css  globals.css
```

Rules:
1. `components/ui` imports only Base UI, Lucide, `cn`, `cva` and tokens (react-day-picker only inside `calendar.tsx`). It knows nothing about SEO or AI and never formats values: primitives receive display strings computed by the caller with `@/lib/format`. `NumberInput` stays in `ui/number-field.tsx` and receives its format from the caller (`numberInputFormat` in `@/lib/format`, to be added, [25-component-inventory.md](25-component-inventory.md) section 23, item 54; [10-forms.md](10-forms.md) section 11).
2. `components/app` may import `components/ui`, `lib/format`, `lib/metrics`, `lib/design`, `lib/a11y`, API schema types from `@/lib/api/types` (re-exported from the generated `schema.d.ts`, types only) and `next/link`. It never fetches data. Only `components/app/forms/` may also import react-hook-form and the `@/lib/forms` normalizers. The API schema type `MetricCell` is re-exported as `MetricCellValue`, because `MetricCell` is also a component name ([25-component-inventory.md](25-component-inventory.md) section 1.5).
3. `features/*` fetch data (TanStack Query), compose `components/app`, and own screen state. Features never import other features; shared pieces move to `components/app`.
4. `app/` routes import features only.
5. Enforced with `eslint-plugin-boundaries` (or `dependency-cruiser`) in CI.

## 3. Naming conventions

| Thing | Convention | Examples |
|---|---|---|
| Component files | kebab-case | `rank-delta-cell.tsx`, `metric-strip.tsx` |
| Components | PascalCase, domain prefix only when ambiguous | `RankDeltaCell`, `EngineBadge`, `SEOAIMatrix` |
| Hooks | `use` + PascalCase | `useInspector`, `useSavedView`, `useChartTheme` |
| Utilities | camelCase verbs | `formatRankChange`, `displayUrl`, `readTokens` |
| Tokens (CSS) | kebab-case role names ([01-foundations.md](01-foundations.md) section 2.1) | `--surface-subtle`, `--positive-text` |
| Tailwind classes | only token utilities and allowed scale steps | `bg-surface`, `text-foreground-secondary`, `px-3`, `h-control` |
| Feature folders | kebab-case nouns matching routes | `keyword-detail`, `prompt-detail` |
| Column helpers | `col.<type>` | `col.rank`, `col.url` |
| Chart configs | `build<Name>Option(data, theme)` pure functions in `components/app/chart/options/` | `buildRankHistoryOption` |
| Query keys | hierarchical arrays ([20-frontend-specification.md](../20-frontend-specification.md) section 3.5) | `['ws', ws, 'p', p, 'seo', 'rankings', filters]` |
| Test ids | `data-testid` only in E2E-critical components, kebab-case | `data-testid="rank-table"` |
| CSS classes | No custom global class names except the composite utilities in `globals.css` | |
| Icons | Lucide PascalCase names through the `Icon` wrapper | `<Icon icon={ListFilter} size="sm" />` |

### 3.1 Token utilities

`globals.css` registers named size utilities from the `--size-*` tokens in `tokens.css` and 15 composite type utilities. Components use these names instead of numeric heights, widths and text sizes. Values follow [reference/visual-spec.md](reference/visual-spec.md) sections 3 and 4.

**Size utilities.** Each `--spacing-<name>` in `globals.css` works with every sizing utility (`h-`, `w-`, `min-w-`, `max-w-`, `size-`).

| Utility | Value | Use |
|---|---|---|
| `h-control-sm` | 32 px | Pagination, icon buttons in tables and inspectors, table toolbar controls |
| `h-control` | 36 px | Default control: buttons, inputs, selects, filter buttons, filter chips, segmented controls, top-bar controls |
| `h-control-lg` | 40 px | Auth and onboarding only |
| `h-control-touch` | 44 px | Primary actions on touch phones only |
| `h-row` | 40 px | Default table row (Default density) |
| `h-row-compact` | 32 px | Compact density, and every table embedded in a panel or inspector |
| `h-row-header` | 40 px | Table header row |
| `h-topbar` | 52 px | Top bar |
| `w-sidebar`, `w-sidebar-collapsed` | 208 px, 56 px | Sidebar |
| `h-sidebar-item` | 32 px | Sidebar item |
| `h-tab` | 44 px | Underline tab row |
| `h-metric-strip` | 76 px | `MetricStrip` `md` |
| `h-badge` | 22 px | Badges and domain chips |
| `size-avatar` | 32 px | Avatar |
| `h-save-bar` | 56 px | Sticky settings save bar (`SaveBar`, [10-forms.md](10-forms.md) section 13.2); also `pb-save-bar` for the space the form reserves |
| `w-inspector`, `w-inspector-wide` | 400 px, 440 px | Inspector default; prompt, citation and answer evidence |
| `min-w-inspector-min`, `max-w-inspector-max` | 360 px, 640 px | Inspector resize limits |
| `w-drawer` | 560 px | Non-modal `StatisticsPanel` |
| `min-w-popover-min`, `max-w-popover-max` | 280 px, 360 px | Popovers |
| `min-w-menu-min`, `max-w-menu-max` | 180 px, 280 px | Menus |
| `max-w-tooltip-max` | 320 px | Tooltips |
| `w-command` | 640 px | Command palette |
| `size-icon-xs`, `size-icon-sm`, `size-icon`, `size-icon-md`, `size-icon-lg` | 12, 14, 16, 18, 20 px | Icons; 16 px default, 18 px in the sidebar |

Density is a CVA axis on table rows: `density: { default: 'h-row', compact: 'h-row-compact' }`. Default (40 px) and Compact (32 px) are the only two densities; any other row height class is a lint error.

**Type utilities (15).** Each sets size, line height, weight and tracking together; some also set the color.

| Utility | Size / line | Weight | Use |
|---|---|---|---|
| `type-page-title` | 24 / 32 | 600, tracking -0.015em | Page `h1` |
| `type-inspector-title` | 18 / 26 | 600 | Inspector title, right-column titles ("Alert rules") |
| `type-section-title` | 16 / 24 | 600 | Panel titles |
| `type-subsection-title` | 14 / 20 | 600 | Section titles inside panels and inspectors, day headers |
| `type-body` | 14 / 20 | 400 | Body, navigation, controls, tabs |
| `type-body-strong` | 14 / 20 | 500 | Active tab, active nav item, button labels, entity names in feeds |
| `type-prose` | 14 / 22 | 400 | AI answer text, long help |
| `type-table` | 13 / 20 | 400 | Table cells |
| `type-meta` | 13 / 20 | 400, tertiary | Meta lines, times, metric strip labels |
| `type-label` | 12 / 16 | 400, tertiary | Table headers, key-value labels, legends, axis labels, sidebar group labels |
| `type-micro` | 12 / 16 | 500 | Badges |
| `type-metric` | 24 / 32 | 600, tracking -0.02em, tabular | Metric strip values |
| `type-metric-sm` | 18 / 24 | 600, tabular | Inspector key-value values |
| `type-mono` | 13 / 20 | 400, Geist Mono | URLs and domains in tables, code |
| `type-kbd` | 11 / 16 | 500 | Keyboard hints ("⌘K") |

The application body is 14 / 20 (`body` in `globals.css`). Do not combine `text-*`, `leading-*`, `font-*` and `tracking-*` classes to rebuild a type style.

## 4. shadcn/ui and Base UI

- `apps/web/components.json` configures the shadcn CLI for the Base UI base (`base-nova`). `shadcn init` is not run: it would overwrite `globals.css`. The CLI is used to fetch a component's source for its Base UI wiring, into a scratch folder: `pnpm exec shadcn add tooltip --path <scratch folder>`. The component is then written in `components/ui/` to the contract in [25-component-inventory.md](25-component-inventory.md). Check `package.json` afterwards: the CLI adds the `cn` package, which this project does not use (`cn` comes from `@/lib/utils`).
- Components are copied into `components/ui/`, then **restyled to tokens before merge**. Import checklist per component:
  1. Replace `text-sm`, `text-xs` and other size classes with the composite `type-*` utilities.
  2. Replace radius classes with the documented radius for that element ([06-surfaces-borders-radius.md](06-surfaces-borders-radius.md) section 3).
  3. Replace `bg-accent` hover styles with `bg-surface-hover`; `bg-primary` stays; `bg-muted` becomes `bg-surface-subtle`; `text-muted-foreground` becomes `text-foreground-tertiary`.
  4. Replace heights with the size utilities of section 3.1 (`h-control`, `h-control-sm`, `h-row`, `h-row-compact`, `h-badge`) and paddings with allowed steps.
  5. Replace arbitrary values (shadcn's Button uses `hover:bg-[color-mix(...)]`) with tokens.
  6. Verify focus uses the global `:focus-visible` ring or `focus-ring-inset`.
  7. Add the component to the preview route with every variant and state, in both themes and both densities.
  8. Add visual regression screenshots.
- Base UI specifics: composition uses the `render` prop (not `asChild`); state styling uses Base UI data attributes (`data-open`, `data-highlighted`, `data-selected`, `data-disabled`, `data-checked`, `data-invalid`); overlays use Portal, Positioner, Popup; transitions use `data-starting-style` and `data-ending-style`. `shadcn/tailwind.css` is not imported: Tailwind 4 already has `data-open:`, `data-disabled:` and `not-data-disabled:` as presence variants, which is how Base UI writes its state, while the shadcn file redefines `data-selected:` to match only `data-selected="true"` and would break Base UI's empty attribute.
- Third-party pieces inside shadcn's Base style: Calendar (react-day-picker 10), and Chart (Recharts). **Recharts is not used**: charts go through ECharts ([15-data-visualization.md](15-data-visualization.md)). Command palette uses Base UI Autocomplete inside a Dialog, not cmdk (dormant since 2025-03). Toasts use the Base UI Toast component.
- No other component framework (MUI, Ant, Chakra, Mantine) and no Radix packages alongside Base UI (lint blocks them).

Three things found while building the first primitives:
- The application's stylesheet is `src/styles/app.css`: it imports `globals.css` (the design system, which names no sources) and lists the folders Tailwind reads class names from. The static preview has its own entry, `design-preview/preview.css`, so neither bundle carries the other's classes. A folder named in an `@source` line of `app.css` should exist when the dev server starts: a folder created later is not scanned until `app.css` is saved again or the server restarts. `src/features/` therefore exists from the start. If classes are still missing in development after a restart while `pnpm build` has them, stop the server, delete `apps/web/.next/dev` and start it again.
- A Server Component cannot hand a function to a client primitive, and an icon imported straight from `lucide-react` is one: `<Button icon={Download}>` in a Server Component fails the build ("Functions cannot be passed directly to Client Components"). Three routes work. Render the button from a client component, which is where feature code lives anyway. Use a primitive without `'use client'` (`Icon`, `Badge`, `LinkButton`, `TextLink`, `Spinner`, `Separator`, `Skeleton`, `Avatar`, `ScrollArea`), which runs on the server and takes the icon there. Or import the icon from a `'use client'` module that re-exports it (`export { Download } from 'lucide-react'`), which makes it a client reference that can cross.
- A primitive has `'use client'` only when it uses a hook or an event handler of its own. A Base UI part without hooks on our side does not need it: Base UI's own modules carry the directive.

## 5. Variant system

Use `class-variance-authority` (CVA) with shadcn's `cn` helper (`@/lib/utils`), matching shadcn upstream so future diffs stay readable.

The canonical `buttonVariants` definition (7 variants including `destructive-solid`, sizes `sm`, `md`, `lg`, `icon-xs`, `icon-sm`, `icon`, and a base class with `border`) is in [09-buttons-controls.md](09-buttons-controls.md) section 2.9. It is not repeated here so the two cannot drift; copy it from there.

When to add a variant versus a new component:

| Situation | Decision |
|---|---|
| Same element and behavior, different visual emphasis | Variant (for example `Button` `subtle`) |
| Different semantics or accessibility role | New component (a toggle button is `Toggle`, not a `Button` variant) |
| Different content structure | New component (`RankCell` is not a `NumberCell` variant) |
| Variant count on one axis would exceed 7 | Stop and review; split the component |
| A one-off style for one screen | Not allowed; propose a system change |

Variant axes are limited to: `variant` or `tone`, `size`, and for tables `density`. Boolean style props (`isBold`, `hasBorder`) are not allowed.

A class string that lives in a lookup constant (`Record<Size, string>`) is wrapped in `cn('…')`, or the lookup is a `cva`. ESLint and Prettier read class names only inside `className`, `cn` and `cva`; a bare string in a constant is checked by neither, so an off-scale or unknown class would pass.

Every primitive takes the attributes of its root element (`ComponentProps<'span'>`, or the Base UI part's props) and passes them on, with `ref`, before its own `className`. That is what lets `Tooltip` and Base UI's `render` prop compose with any primitive.

## 6. Server and client boundaries (Next.js 16)

- Layouts and page frames are Server Components (identity, project configuration, flags), fetched from the API over the Docker network with the session cookie forwarded ([20-frontend-specification.md](../20-frontend-specification.md) section 3.5). Analytics data is fetched client-side with TanStack Query ([20-frontend-specification.md](../20-frontend-specification.md) section 3.4).
- `"use client"` boundaries sit at feature components and interactive `components/app` pieces (tables, charts, filter bar, inspector), never at page roots.
- Charts and the evidence viewer load with `next/dynamic` (`ssr: false`) and render skeletons of final size meanwhile.
- `proxy.ts` (Next 16 replacement for `middleware.ts`) handles session presence and the per-request CSP nonce.
- Fonts: `geist` package through `next/font/local` in the root layout, exposing `--font-geist-sans` and `--font-geist-mono`.
- Theme: `next-themes` provider in a client component wrapping the app; class on `<html>` ([01-foundations.md](01-foundations.md) section 3).

## 7. URL state

All shareable state lives in the URL through `nuqs` 2 (`NuqsAdapter` from `nuqs/adapters/next/app`): filters, date window, compare, sort, search, saved view, selected record (`inspect=keyword:<id>`), inspector tab, page tab. Parsers are defined once in `lib/filters/parsers.ts` and shared by filter bar, tables and links ([13-filters-search.md](13-filters-search.md) section 5). Local-only UI state (hover, open menus, column resize drag) stays in React state.

## 8. Formatting, tokens in code, and charts

- Values are formatted only with `@/lib/format`. Metric labels, definitions and polarity come from `lib/metrics/definitions.ts`.
- Colors in JavaScript (ECharts, canvas) come from `readTokens()` in `lib/design/read-tokens.ts`, which reads CSS variables from `document.documentElement` and caches them per theme.
- Chart options are built by pure functions (`buildXOption(data, theme)`) that are unit-tested with snapshot assertions on the option object (no canvas needed).

## 9. Enforcement (lint and CI)

| Rule | Tool | Scope | Status |
|---|---|---|---|
| No hex or color functions in code; no em-dashes or en-dashes in string literals | ESLint `no-restricted-syntax` | all `*.ts(x)` | Implemented in `apps/web/eslint.config.mjs` (verified 2026-09-29) |
| No `Intl.NumberFormat`, `Intl.DateTimeFormat`, `toFixed`, `toLocaleString`, `toLocaleDateString` outside `lib/format` | ESLint `no-restricted-properties` | all except `lib/format` and tests | Implemented |
| No competing component or icon libraries; no Recharts; no Radix | ESLint `no-restricted-imports` | all | Implemented |
| Only registered Tailwind classes (palette classes and default sizes do not exist after the theme reset) | `eslint-plugin-better-tailwindcss` `no-unknown-classes` with an absolute `settings.entryPoint` and `cwd` (relative ones switch the rule off when ESLint starts outside `apps/web`) | all `src/**/*.{ts,tsx}`: class strings in `className`, `cn()` and `cva()` | Implemented |
| No arbitrary values (`p-[13px]`, `bg-[...]`) outside `components/ui`; no arbitrary breakpoints (`min-[900px]:`) anywhere; no weight classes (`font-bold`) outside `components/ui` | better-tailwindcss `no-restricted-classes` with the pattern `\[([^\[\]])*?\](?!:)`, file override excluding `components/ui/**` | features, app components, routes | Implemented |
| Spacing only on the allowed steps | better-tailwindcss `no-restricted-classes` with an allowlist, because Tailwind 4 accepts any multiple of 0.25 and a list of forbidden numbers cannot keep up: padding, margin (logical sides included), gap, space and scroll utilities whose value is not one of `0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12`, with any variant and with the important marker on either side. The pattern is `OFF_SCALE_SPACING` in `apps/web/eslint.config.mjs` | all sources | Implemented |
| No raw `z-*` numbers | better-tailwindcss `no-restricted-classes`: `z-50`, `z-[60]`, with variants and the important marker (use `z-(--z-dropdown)`) | all sources | Implemented |
| Conflicting and duplicate classes | better-tailwindcss `no-conflicting-classes`, `no-duplicate-classes` | all sources | Implemented |
| Class ordering and formatting | Prettier (`pnpm format:check`) with the Tailwind plugin, `tailwindFunctions: ["cn", "cva"]` (ESLint ordering rule off) | all except `design-preview` and `src/styles` | Implemented |
| No `dangerouslySetInnerHTML` | ESLint `react/no-danger` | all | Implemented |
| No literal text in JSX | `eslint-plugin-i18next` `no-literal-string`, type-aware: JSX text, template literals, conditional text and every string prop are checked, except props typed as a set of literal values (`variant`, `size`) and a short list of technical attributes. Literals in `aria-description`, `aria-valuetext`, `aria-roledescription`, `aria-placeholder` and `label` on native elements are caught by `no-restricted-syntax` | `src/**/*.tsx` except the preview sections and tests | Implemented |
| Components do not fetch; form state only in features, `components/app/forms` and the component preview (`components/design-system`, which shows a live form); primitives import only React, Base UI, Lucide, cva, cn and each other | `no-restricted-imports`, `no-restricted-globals` (`fetch`), and a boundaries file category for the API clients | `src/components/**` | Implemented |
| Warnings fail the run | `eslint . --max-warnings 0` | all | Implemented |
| No em-dash or en-dash in any source text, comments included | Vitest `src/test/source-text.test.ts` | every source file of `apps/web` | Implemented |
| Import boundaries | `eslint-plugin-boundaries` (`dependencies` with the rules of section 2, `no-unknown-files`, `no-unknown-dependencies`), resolving `@/` through `eslint-import-resolver-typescript`. A file in a folder that has no layer is an error, so a new folder cannot escape the rules | `src/**` except tests | Implemented |
| Token contrast and CVD separation | Vitest `tokens.contrast.test.ts` | tokens | Implemented (220 tests passing with the v2 tokens) |
| Formatter behavior | Vitest `format.test.ts` | formatters | Implemented |
| Copy: no U+2013/U+2014 in `messages/en.json` | Vitest | message catalog | Phase 1 |
| Accessibility | `@axe-core/playwright` on every preview section and page template | CI | Phase 1 |
| Visual regression | Playwright screenshots (section 11) | CI | Phase 1 |

Note (verified 2026-09-29): typescript-eslint 8.x does not support TypeScript 7 yet; the workspace pins TypeScript 6.0 for type-aware linting until typescript-eslint supports 7.x. Next 16 removed `next lint`; ESLint runs directly.

## 10. Design-system preview (component explorer)

**Decision: a gated `/design-system` route inside the Next.js app**, not Storybook or Ladle.

| Option | Assessment |
|---|---|
| Storybook 10 with `@storybook/nextjs-vite` | Capable, but runs on Vite instead of the app's Turbopack build, needs its own font and CSS setup (limited `next/font/local` support), and duplicates the app's providers. Justified only if other teams need a standalone catalogue |
| Ladle | Barely maintained (no release since 2025-11), no Next integration |
| **Custom `/design-system` route** | Uses the real app build, fonts, tokens, providers and theme. Zero extra toolchain. Screenshots use the same Playwright setup as E2E |

The route (`app/(internal)/design-system/[section]/page.tsx`) is available in development and in the CI build used for screenshots, and in production only to platform operators (there are no preview deployments, [ADR-022](../adr/ADR-022-python-backend-simplified-platform.md)). Sections: shell (sidebar and top bar), tokens (color swatches with contrast values read live), typography (the 15 type utilities), spacing and size utilities, icons, buttons and controls (including `SegmentedControl` and `CountTabs`), forms, badges and filter chips, metric strip, tables (header row, 40 px and 32 px rows, selected row; with a 10,000-row fixture), filters, charts (each chart type with fixture data, including `BarList`, `StackedBar100` and `ChartTooltip`), overlays, states, application components (SEO, AI including `EngineStatusGlyph` and `EnginePresenceSquare`, cross-channel, feeds and `RuleList`). Each section renders every variant in light and dark side by side and in Default and Compact density.

A static Phase 0 version exists at `apps/web/design-preview/index.html`. It has four screens behind hash routes, switched from the sidebar: `#/overview` (template T1, [24-page-templates.md](24-page-templates.md) section 9.2: setup checklist, six-item metric strip with the channel group divider, small multiples with a shared axis and a table alternative, rank distribution, quadrant summary, change feed, opportunities and two summary tables), `#/rankings` (template T2, the default), `#/prompts` (Topics & Prompts, template T2, [24-page-templates.md](24-page-templates.md) section 9.5: the Topics tab with prompts grouped under each topic, the Prompts tab at `#/prompts/explorer`, Panels and Versions, the topic and prompt inspectors, and the Add prompts dialog with its lint) and `#/settings/<section>` (template T4: the local navigation, which is a `Select` below 1024 px, the three account sections (Profile, Security with the password and recovery-code dialogs and the session list, Preferences that apply at once), the project General and Engines sections, the cost notice, the `SaveBar`, the discard confirmation when leaving a dirty form, and project deletion confirmed by typing the slug). Other destinations answer with a toast that they are not in the preview. The Overview and the keyword inspector are rendered from a layout and can be customized ([23-application-patterns.md](23-application-patterns.md) section 18): `design-preview/customize.js` moves card nodes from a card bank into the grid and edits a draft; the rules it uses are `src/lib/layouts/*.ts`, transpiled to `design-preview/vendor/layouts/` by `design-preview/core-modules.mjs`, so the preview runs the code the unit tests cover. The same step transpiles `src/lib/stats` (Wilson intervals, the detectable change rule, panel sizing) and the number formatters of `src/lib/format`. The Topics & Prompts page is generated from them: `design-preview/prompts-data.js` builds 302 prompts with counts per engine, fitted to the totals the Overview shows, and the page computes every rate, interval, change and sort from those counts. Its modules are `prompts.js` (the page and the Prompts tab), `prompts-topics.js`, `prompts-inspector.js`, `prompts-topic-inspector.js`, `prompts-state.js` (the shared filters), `prompts-cells.js` and `prompts-parts.js`. Layouts are kept in browser storage in the preview. It is fully responsive to the rules of [19-responsive-behavior.md](19-responsive-behavior.md) and was checked at 2560, 1920, 1680, 1600, 1440, 1366, 1280, 1180, 1100, 1024, 960, 900, 820, 768, 700, 600, 480, 414, 390, 360 and 320 px (no horizontal page scroll at any width; every visible text element meets WCAG AA contrast in both themes). It shows: the shell (expanded sidebar, 56 px rail, navigation drawer; the Collapse button and `[` shortcut that collapse the sidebar at 1280 px and up and expand the rail as an overlay at 1024 to 1279 px, through the `rail:`, `narrow:` and `peek:` variants in `globals.css`; the top bar collapse order; the `ThemeSwitch` with its circular reveal), the page header, the metric strip (5, 3 plus 2, and 2-column layouts with context lines), the filter bar at each class and the mobile filter sheet, the Rank Tracker table with column tiers, selection, the active row and sparklines, the mobile list rows, four ECharts charts themed from tokens (mention rate with interval band, rank history with guides and depth band, rank distribution, and the 100% stacked bar with contrast-chosen labels), controls, badges, engine glyphs and `BarList`. Every menu, popover, filter editor (with Clear and Apply), the `DateRangePicker` (presets, two months, typed From and To, Apply), the Add keywords dialog (with a `Combobox` for location and a `Select` for language), dialog, the command palette, toasts, tooltips, the inspector (docked, overlay and sheet), row menus and sorting work in `design-preview/interactions.js`. Chart code is `design-preview/charts.js`; ECharts and the engine logos (`vendor/logos/`, from `@lobehub/icons-static-svg`) are copied into `design-preview/vendor/` by `design-preview/vendor.mjs`. It uses token utilities only (no hex, no arbitrary values). Icons are real Lucide glyphs: the page marks each icon slot as `<svg data-icon="name" class="size-icon"></svg>`, and `design-preview/icons.mjs` fills it from `lucide-static` 1.48.0 (the same icon set and version as `lucide-react`) with a 1.75 px non-scaling stroke ([07-icons.md](07-icons.md) section 2). Rebuild with `pnpm run preview` in `apps/web`, which fills the icons and then compiles the CSS with the Tailwind CLI. `lucide-react` itself is installed when the Next.js app is scaffolded, because it needs React.

## 11. Visual regression testing

**Decision:** Playwright `toHaveScreenshot` against the preview route and page templates, run in a pinned Docker image (`mcr.microsoft.com/playwright:v1.63.0-noble`) so fonts and rendering are deterministic. Argos CI (MIT, free up to 5,000 screenshots per month) can be added later for review UX; Chromatic and Percy are not needed (Chromatic is tied to Storybook; Lost Pixel is archived).

| Setting | Value |
|---|---|
| Viewports | 1440 x 900 (primary), 1280 x 800, 390 x 844 (mobile templates only) |
| Themes | light and dark for every section |
| Density | Default (40 px rows) and Compact (32 px rows) for table sections |
| Determinism | `await document.fonts.ready`; `page.clock.setFixedTime('2026-09-29T12:00:00Z')`; timezone `UTC`; `deviceScaleFactor: 1`; animations disabled (Playwright default for screenshots); fixture data only, no network |
| Threshold | `maxDiffPixelRatio: 0.001` for primitives, `0.002` for page templates |
| Scope | Every `components/ui` primitive state, every `components/app` component, the six page templates |
| Updating baselines | Only in a pull request that also changes the corresponding design-system document; reviewers see the diff images as CI artifacts |

Budget: about 400 screenshots per run, under 5 minutes on CI.

## 12. Frontend performance guidelines

| Area | Guideline | Budget |
|---|---|---|
| Route JS | Server Components for shells; client boundaries at features; ECharts and the evidence viewer lazy-loaded | 180 KB shared + 60 KB route (gzip) |
| Tables | Virtualize above 100 rows; fixed row heights; memoized columns; stable row ids; canvas sparklines; tooltips mounted on demand | 10,000 rows: first paint under 150 ms, sort under 100 ms |
| Data | TanStack Query with hierarchical keys, `placeholderData: keepPreviousData` on filter changes, `staleTime` 5 minutes for analytics | |
| Charts | Tree-shaken ECharts (170 KB chunk); LTTB over 2,000 points; server downsampling beyond 180 days; mount on visibility; dispose on unmount | 10,000-point scatter under 250 ms |
| Fonts | Two variable font files, `display: swap`, preloaded by `next/font` | no CLS from fonts |
| Images | Favicons only, 16 px, lazy, from one allowlisted endpoint | |
| Web Vitals (p75) | LCP 2.0 s Overview and 2.5 s elsewhere; INP 200 ms; CLS 0.05 | measured in RUM |

Anti-patterns: rendering hidden tabs' charts, formatting in render loops without memoization, one tooltip component per cell mounted eagerly, client components at page roots, fetching table data in Server Components.

## 13. Pull request checklist for UI changes

1. Uses existing components and tokens; no new visual pattern without a design-system document change.
2. Lint, typecheck, unit tests, a11y checks and visual regression pass.
3. Both themes and both densities checked in the preview route.
4. Screens pass the review checklist in [27-design-review-checklist.md](27-design-review-checklist.md).
