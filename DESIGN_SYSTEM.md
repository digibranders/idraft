# Design System

The UI source of truth for the SEO + AI Visibility application. All frontend implementation conforms to it. Coding agents: read [AI_DEVELOPMENT_UI_RULES.md](AI_DEVELOPMENT_UI_RULES.md) first.

**Character:** a professional analytical instrument. Neutral, calm, precise, with two table densities (Default 40 px rows, Compact 32 px). One cobalt accent, Geist type, 14 px base (13 px table cells), 36 px controls, 40 px table rows, tables over cards, a right inspector for records, and color only when it means something. Visual values come from the reference screens ([visual-spec.md](docs/design-system/reference/visual-spec.md), [ADR-DS-018](docs/design-system/adr/ADR-DS-018-visual-v2-reference-screens.md)).

## Documents

| # | Document | Decides |
|---|---|---|
| 00 | [Design principles](docs/design-system/00-design-principles.md) | Principles, density rules, hierarchy toolkit, decisions made for you |
| 01 | [Foundations](docs/design-system/01-foundations.md) | Token architecture, theme mechanism, z-index scale |
| 02 | [Color system](docs/design-system/02-color-system.md) | Light and dark tokens (OKLCH with hex), semantic rules, chart palettes, contrast results |
| 03 | [Typography](docs/design-system/03-typography.md) | Geist, 15 composite type utilities, tabular numbers |
| 04 | [Spacing and density](docs/design-system/04-spacing-density.md) | 4 px scale, component heights, Default and Compact density modes |
| 05 | [Layout and grid](docs/design-system/05-layout-grid.md) | Shell, regions, widths, scroll model, inspector docking |
| 06 | [Surfaces, borders, radius](docs/design-system/06-surfaces-borders-radius.md) | Surface layers, border tokens, radius scale, shadows for overlays only |
| 07 | [Icons](docs/design-system/07-icons.md) | Lucide, sizes, stroke, glyph assignments, engine logos policy |
| 08 | [Interaction states](docs/design-system/08-interaction-states.md) | Hover, focus, selected, active, pressed, disabled, loading, error |
| 09 | [Buttons and controls](docs/design-system/09-buttons-controls.md) | Button hierarchy and sizes, toggles, tabs, menus |
| 10 | [Forms](docs/design-system/10-forms.md) | Every input type, validation, settings forms |
| 11 | [Navigation](docs/design-system/11-navigation.md) | Sidebar, top bar, tabs, shortcuts |
| 12 | [Tables](docs/design-system/12-tables.md) | DataTable anatomy, cells, sorting, keyboard, saved views, virtualization |
| 13 | [Filters and search](docs/design-system/13-filters-search.md) | FilterBar, chips, editors, URL state, search, command palette entry |
| 14 | [Badges and status](docs/design-system/14-badges-status.md) | Badge tones, status, engines, change indicators |
| 15 | [Data visualization](docs/design-system/15-data-visualization.md) | ECharts theme, chart types, rank charts, SEO/AI matrix, sparklines |
| 16 | [Drawers, dialogs, popovers](docs/design-system/16-drawers-dialogs-popovers.md) | Inspector, dialogs, popovers, tooltips, command palette |
| 17 | [Empty, loading, error states](docs/design-system/17-empty-loading-error-states.md) | Skeletons, empty states, errors, freshness, collection progress |
| 18 | [Notifications and alerts](docs/design-system/18-notifications-alerts.md) | Toasts, banners, notification center, event timeline |
| 19 | [Responsive behavior](docs/design-system/19-responsive-behavior.md) | Breakpoints, column priority, tablet and mobile |
| 20 | [Accessibility](docs/design-system/20-accessibility.md) | WCAG 2.2 AA mapping, keyboard, ARIA, charts |
| 21 | [Motion](docs/design-system/21-motion.md) | Durations, easing, allowed and prohibited motion |
| 22 | [Content and formatting](docs/design-system/22-content-formatting.md) | Voice, numbers, ranks, dates, URLs, truncation, glossary |
| 23 | [Application patterns](docs/design-system/23-application-patterns.md) | Progressive disclosure, metric strip, inspector content, evidence, costs |
| 24 | [Page templates](docs/design-system/24-page-templates.md) | Six templates and wireframes for every major screen |
| 25 | [Component inventory](docs/design-system/25-component-inventory.md) | Every component: purpose, props, variants, states, accessibility |
| 26 | [Implementation guidelines](docs/design-system/26-implementation-guidelines.md) | Code structure, naming, variants, shadcn policy, enforcement, preview, visual tests, performance |
| 27 | [Review checklist and anti-patterns](docs/design-system/27-design-review-checklist.md) | Screen and component review, prohibited patterns |
| ADR | [Design decisions](docs/design-system/adr/README.md) | Rationale and revisit triggers |
| REF | [Visual reference screens](docs/design-system/reference/README.md) | Seven high-fidelity screens, the source of the v2 visual values recorded in [visual-spec.md](docs/design-system/reference/visual-spec.md); product and data rules in documents 00 to 27 win on any conflict |

## Code

| Path | Contents | Verified |
|---|---|---|
| [`apps/web/src/styles/tokens.css`](apps/web/src/styles/tokens.css) | All tokens, light and dark | 220 contrast, gamut and colorblind tests pass (v2 tokens) |
| [`apps/web/src/styles/globals.css`](apps/web/src/styles/globals.css) | Tailwind v4 mapping, default theme reset, `type-*`, `num`, `focus-ring` | Compiles with Tailwind 4.3.3; forbidden defaults generate nothing |
| [`apps/web/src/lib/format/`](apps/web/src/lib/format/) | Number, rank, delta, date, URL formatters | Unit tested |
| [`apps/web/src/components/ui/`](apps/web/src/components/ui/) | Primitives on Base UI (shadcn `base-nova`, restyled to the tokens) | Unit and `vitest-axe` tests per primitive |
| [`apps/web/src/components/app/`](apps/web/src/components/app/) | Application components: the shell (`shell/`), states (`status/`), `FormField` (`forms/`) | Unit and `vitest-axe` tests |
| [`apps/web/src/features/`](apps/web/src/features/) | Screens: data fetching and composition (auth, session, shell, projects, account) | Unit and `vitest-axe` tests; Playwright flows in `apps/web/e2e/flows/` |
| [`apps/web/messages/en.json`](apps/web/messages/en.json) | Every visible string | `src/i18n/messages.test.ts` fails on dashes, `!`, empty or padded messages |
| [`apps/web/eslint.config.mjs`](apps/web/eslint.config.mjs) | Enforcement rules ([26](docs/design-system/26-implementation-guidelines.md) section 9) | Catches hex colors, dashes, raw formatting, banned libraries, unknown or off-scale classes, literal strings in JSX, import boundaries |
| `/design-system` route ([`apps/web/src/components/design-system/`](apps/web/src/components/design-system/)) | The component preview inside the app: tokens, typography, sizes, icons, buttons, forms, badges, overlays, feedback. A 404 in production builds | Every section rendered through axe in both themes |
| [`apps/web/design-preview/index.html`](apps/web/design-preview/index.html) | Static Phase 0 preview of the v2 shell and screens: sidebar, top bar, metric strip, buttons, segmented control, `CountTabs`, filter chips, badges, table, `EngineStatusGlyph`, `BarList`. It stays as the visual reference until every page it shows is ported | Built from token utilities only; compiled with the Tailwind CLI to `preview.compiled.css` |

Commands (in `apps/web`): `pnpm dev` (development server), `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`, `pnpm build` (production build, standalone output), `pnpm e2e` (Playwright flows with axe), `pnpm e2e:visual` (screenshots; baselines are made in the pinned Playwright image only), `pnpm run preview` (rebuilds the static preview in `design-preview/`). [`apps/web/README.md`](apps/web/README.md) has the three ways to run the app.

## Ten decisions to remember

1. Neutral surfaces, one cobalt accent (`primary`, `#1E65E3`), semantic green, red, amber only for meaning.
2. Geist Sans 14 px base, 13 px in table cells, 24 px page titles; Geist Mono only for technical values; tabular figures for numbers.
3. 4 px spacing scale; 36 px controls and 40 px table rows by default; Compact density (32 px rows) per table; embedded tables always 32 px.
4. Sidebar 208 px, top bar 52 px, 20 px gutters, 16 px between page blocks, full-width analytics, 400 px inspector (440 px for prompt, citation and answer evidence).
5. Borders and tonal layers; shadows only for overlays; radius 2 to 10 px (2 px only for bar-list bars and engine presence squares).
6. Tables for records; one 76 px metric strip panel for summaries, never KPI cards; cards only when justified.
7. One `FilterBar` with neutral chips for screen scope and filters; the date range and location sit in the top bar as project-wide scope; all view state in the URL.
8. Ranks use arrows (`↑5`), metrics use signs (`+5.3 pts`); color only when the change is real.
9. ECharts with a quiet theme and animation off; own brand is `chart-1`; no pie or donut charts; ranks plotted inverted with depth bands.
10. Every number honest: units, denominators, sample sizes, estimates labeled, unknown shown as unknown.
