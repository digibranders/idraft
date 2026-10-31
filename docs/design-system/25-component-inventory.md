# 25. Component Inventory

Status: Accepted (design-system v2)
Last updated: 2026-10-05
Implementation: `apps/web/src/components/ui/`, `apps/web/src/components/app/`, `apps/web/src/features/*/components/`, hooks and helpers in `apps/web/src/lib/`
Depends on: every document from [00-design-principles.md](00-design-principles.md) to [24-page-templates.md](24-page-templates.md), [26-implementation-guidelines.md](26-implementation-guidelines.md), [27-design-review-checklist.md](27-design-review-checklist.md) and the [ADRs](adr/README.md). Formatters: [`apps/web/src/lib/format/`](../../apps/web/src/lib/format/).

This is the list of every component the web application may use. Before building UI, find the component here. If it exists, use it. If it almost fits, add a documented variant (section 21). If nothing fits, change this document first ([00-design-principles.md](00-design-principles.md) section 7).

Where another document already specifies a component in depth, the entry summarizes and links to it; the linked section wins on visual detail. Where two documents disagree, this inventory records the stricter or more specific rule and lists the disagreement in section 23.

## 1. How to read this inventory

### 1.1 Entry format

Every entry has the same parts:

| Part | Meaning |
|---|---|
| Header line | File path relative to `apps/web/src/`, status, and the owning document section |
| Purpose | One or two sentences: the job the component does |
| Props | A TypeScript interface. Types from `@/lib/format` and the shared types in section 1.5 are used wherever a value has a formatter |
| Variants | CVA axes (`variant` or `tone`, `size`, `density` only; [26-implementation-guidelines.md](26-implementation-guidelines.md) section 5). "None" means the component has one appearance. Props such as `form` or `placement` that change structure, not style, are listed under Props |
| States | Interaction and data states the component must render, in the precedence of [08-interaction-states.md](08-interaction-states.md) section 1 |
| A11y | APG pattern or role, keyboard, ARIA, labeling |
| Use | When to reach for it |
| Not for | When not to use it, and what to use instead |

`§` in this document means "section" in the linked document.

### 1.2 Status

| Status | Meaning |
|---|---|
| **V1** | Needed for the MVP: phases 1 to 9 plus 10a in [29-phase-roadmap.md](../29-phase-roadmap.md), screens per [20-frontend-specification.md](../20-frontend-specification.md) section 10 |
| **Later** | Needed only by post-MVP phases (10b to 15) or superseded; specified here so the API is stable, not built before its phase |

### 1.3 Layers and file locations

Layer rules come from [26-implementation-guidelines.md](26-implementation-guidelines.md) section 2 and are enforced by `eslint-plugin-boundaries`.

| Layer | Path | May import | Never |
|---|---|---|---|
| Primitives | `components/ui/` | Base UI 1.8 (`@base-ui/react`, shadcn `base-nova` preset, restyled), `lucide-react` through `Icon`, `cn`, `cva`, tokens; react-day-picker 10 inside `calendar.tsx` only | Domain words (keyword, prompt, engine), `@/lib/format`, `@/lib/metrics`, `@contracts`, Next.js APIs, data fetching |
| Application components | `components/app/<area>/` | `components/ui`, `@/lib/format`, `@/lib/metrics`, `@/lib/design`, `@/lib/a11y`, contract types from `@contracts` (types only), `next/link` | Data fetching (TanStack Query, `fetch`), feature modules |
| Screen compositions | `features/<feature>/components/` | Everything above, TanStack Query, `nuqs` parsers from `lib/filters` | Other features (shared pieces move to `components/app`) |
| Routes | `app/` | `features/*` only | Components directly |

Application areas used in this inventory (26 §2): `data-table/`, `cells/`, `metric/`, `chart/`, `sparkline/`, `filters/`, `inspector/`, `status/`, `evidence/`, `seo/`, `ai/`, `cross/`, `shell/`. One area is added by this inventory: `forms/` for form components that bind react-hook-form or `@contracts` normalizers (section 23, item 50).

Consequence of the layer rule, applied throughout: **`components/ui` never formats values.** A primitive that shows a number (a tab count, a pagination range, a textarea counter) receives a display string computed by the caller in `components/app` or `features` with `@/lib/format`.

### 1.4 Rules every component follows

1. Colors, radii, shadows, sizes and z-index come from token utilities only (`bg-surface`, `text-foreground-secondary`, `rounded-md`, `h-control`, `z-(--z-dropdown)`). No hex, no color functions, no palette classes, no arbitrary values outside `components/ui` ([02-color-system.md](02-color-system.md) §10, [26-implementation-guidelines.md](26-implementation-guidelines.md) §9).
2. Every text element uses exactly one `type-*` utility ([03-typography.md](03-typography.md) §2). Every compared number adds `num`.
3. Focus is the global `:focus-visible` ring; dense containers use `focus-ring-inset`. No component removes the outline ([08-interaction-states.md](08-interaction-states.md) §2).
4. Every interactive target is at least 24 x 24 px ([20-accessibility.md](20-accessibility.md) §8).
5. Values are formatted only through `@/lib/format`; tone (green, red, neutral) comes only from `formatRankChange` or `formatMetricDelta` and is mapped to classes by `TONE_TEXT` (section 20.3). A component never picks a semantic color itself.
6. Base UI state comes from data attributes (`data-open`, `data-highlighted`, `data-selected`, `data-disabled`, `data-checked`, `data-invalid`, `data-pressed`, `data-popup-open`); composition uses the `render` prop, not `asChild`.
7. `className` on a design-system component may set layout only (margin, width, flex and grid placement). Boolean style props (`isBold`, `hasBorder`) do not exist.
8. Unknown is never zero: `null` values render a value state (sections 11.11 to 11.14), never `0`, never an empty string.
9. Copy follows [22-content-formatting.md](22-content-formatting.md): sentence case, no exclamation marks, no em-dashes or en-dashes, ranges with "to".
10. Motion uses the duration tokens and stops under reduced motion ([21-motion.md](21-motion.md)).

### 1.5 Shared types

Interfaces below use these types. Formatter types come from `@/lib/format` ([`rank.ts`](../../apps/web/src/lib/format/rank.ts), [`delta.ts`](../../apps/web/src/lib/format/delta.ts), [`number.ts`](../../apps/web/src/lib/format/number.ts), [`url.ts`](../../apps/web/src/lib/format/url.ts)); API wire types come from `packages/contracts` ([19-api-specification.md](../19-api-specification.md) §2.6). The contract type `MetricCell` is imported as `MetricCellValue` because `MetricCell` is also a component name (section 23, item 55).

```ts
// apps/web/src/components/app/types.ts
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type {
  RankObservation, RankChange, RankBucket, ChangeTone, Polarity, DeltaUnit,
  MetricDeltaInput, DisplayUrl, NumberContext,
} from '@/lib/format';
import type {
  MetricValue, MetricComparison, MetricSeries, MetricPoint, MetricCell as MetricCellValue,
} from '@contracts/metrics';

export type {
  RankObservation, RankChange, RankBucket, ChangeTone, Polarity, DeltaUnit, MetricDeltaInput,
  DisplayUrl, NumberContext, MetricValue, MetricComparison, MetricSeries, MetricPoint, MetricCellValue,
};

/** Table and list density ([04-spacing-density.md](04-spacing-density.md) §3): 'default' is 40 px rows (`h-row`, labelled Comfortable), 'compact' is 32 px rows (`h-row-compact`). The default is 'compact' (`DEFAULT_DENSITY`). */
export type Density = 'default' | 'compact';

/** Engine codes as returned by the API (`engine_code`). The contracts package is the source of truth. */
export type EngineCode =
  | 'chatgpt_web' | 'chatgpt_web_forced_search' | 'gemini_web' | 'google_ai_mode'
  | 'google_ai_overview' | 'openai_api_search' | 'perplexity_api' | 'gemini_api_grounded';

/** Observation classes are never pooled ([19-api-specification.md](../19-api-specification.md) §2.6 rule 6). */
export type ObservationClass = 'consumer_ui' | 'serp_ai' | 'official_api';

/** `project_entities.color_index`, mapped to `--chart-{n}`; own brand is always 1. */
export type EntityColorIndex = 1 | 2 | 3 | 4 | 5 | 6;

export interface EntityRef {
  id: string;
  name: string;
  role: 'own' | 'competitor';
  /** null for entities beyond the sixth: they render with `chart-other` (dashed). */
  colorIndex: EntityColorIndex | null;
}

export type DomainRole = 'own' | 'competitor' | 'third_party';
export type Severity = 'info' | 'warning' | 'critical';
export type RunStatus =
  | 'planned' | 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'budget_blocked' | 'cancelled';

/** Metric registry key, for example 'ai.mention_rate' ([22-content-formatting.md](22-content-formatting.md) §8). */
export type MetricKey = string;

/** Value-level unknown states ([17-empty-loading-error-states.md](17-empty-loading-error-states.md) §8). */
export type UnknownValueKind = 'not_collected' | 'insufficient' | 'not_applicable' | 'beyond_depth';

/** Noun for sample counts; always present ([23-application-patterns.md](23-application-patterns.md) §8.3). */
export type SampleNoun = 'obs' | 'checks' | 'prompts' | 'keywords' | 'answers' | 'rows' | 'days';

/** ISO 8601 instant (UTC) or business date (YYYY-MM-DD, already in the project timezone). */
export type IsoInstant = string;
export type BusinessDate = string;

/** Inspector object types ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) §2.7, refined in section 23, item 36). */
export type InspectorType =
  | 'keyword' | 'prompt' | 'citation' | 'answer' | 'page' | 'competitor' | 'domain' | 'source' | 'run'
  | 'candidate';   // Discover candidate (evidence inspector, 24 §9.11)

/** One row or record action; groups fix menu order ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) §5.3). */
export interface RecordAction<TRow> {
  id: string;
  label: string;
  icon?: LucideIcon;
  group: 'open' | 'object' | 'copy' | 'destructive';
  /** Shown instead of the shortcut; the item stays focusable. */
  disabledReason?: string | null;
  /** Platform-neutral shortcut id registered with `useShortcut` (section 19.5). */
  shortcut?: string;
  onSelect: (rows: readonly TRow[]) => void;
}

export type Slot = ReactNode;

/** TanStack Table v9 column type, re-exported by `app/data-table/columns.ts`; built only through `col.*`. */
export type { ColumnDef } from '@tanstack/react-table';
```

## 2. Summary index

Paths are relative to `apps/web/src/`. `ui/` is `components/ui/`; `app/` is `components/app/`.

| Component | Category | Layer / path | Status | Doc |
|---|---|---|---|---|
| Button | Foundation | `ui/button.tsx` | V1 | 09 §2 |
| IconButton | Foundation | `ui/icon-button.tsx` | V1 | 09 §3 |
| SplitButton | Foundation | `ui/split-button.tsx` | V1 | 09 §4 |
| ToggleButton | Foundation | `ui/toggle-button.tsx` | V1 | 09 §5 |
| SegmentedControl | Foundation | `ui/segmented-control.tsx` on `ui/radio-group.tsx` | V1 | 09 §6 |
| Toolbar | Foundation | `ui/toolbar.tsx` | V1 | 09 §7 |
| CopyButton | Foundation | `ui/copy-button.tsx` | V1 | 09 §9.1 |
| ExternalLinkButton | Foundation | `ui/external-link-button.tsx` | V1 | 09 §9.2 |
| TextLink | Foundation | `ui/text-link.tsx` | V1 | 20 §19 |
| Icon | Foundation | `ui/icon.tsx` | V1 | 07 |
| Kbd | Foundation | `ui/kbd.tsx` | V1 | 09 §11 |
| Spinner | Foundation | `ui/spinner.tsx` | V1 | 21 §8.2 |
| Separator | Foundation | `ui/separator.tsx` | V1 | 06 §5 |
| ScrollArea | Foundation | `ui/scroll-area.tsx` | V1 | 16 §5.1 |
| Skeleton (and composite skeletons) | Foundation | `ui/skeleton.tsx`, `app/status/skeletons.tsx` | V1 | 17 §3 |
| Avatar | Foundation | `ui/avatar.tsx` | V1 | 11 §4 |
| Badge | Foundation | `ui/badge.tsx` | V1 | 14 §1 |
| Tag | Foundation | `ui/tag.tsx` | V1 | 14 §2 |
| Truncate | Foundation | `ui/truncate.tsx` | V1 | 20 §13.4 |
| Collapsible | Foundation | `ui/collapsible.tsx` | V1 | 20 §5 |
| Tooltip | Foundation | `ui/tooltip.tsx` | V1 | 16 §6.1 |
| Toggletip | Foundation | `ui/toggletip.tsx` | V1 | 20 §5 |
| Popover | Foundation | `ui/popover.tsx` | V1 | 16 §5.1 |
| PreviewCard | Foundation | `ui/preview-card.tsx` | V1 | 16 §6.3 |
| Menu | Foundation | `ui/menu.tsx` | V1 | 09 §10, 16 §5.2 |
| ContextMenu | Foundation | `ui/context-menu.tsx` | V1 | 16 §5.4 |
| RowMenu | Foundation | `app/data-table/row-menu.tsx` | V1 | 16 §5.4 |
| RowContextMenu | Foundation | `app/data-table/row-menu.tsx` | V1 | 16 §5.4 |
| Dialog (DialogHeader, DialogBody, DialogFooter) | Foundation | `ui/dialog.tsx` | V1 | 16 §4 |
| ConfirmDialog | Foundation | `ui/alert-dialog.tsx` | V1 | 16 §4.5 |
| TypeToConfirmField | Foundation | `ui/alert-dialog.tsx` | V1 | 16 §4.5 |
| DiscardChangesDialog | Foundation | `ui/alert-dialog.tsx` | V1 | 10 §13.2, 16 §4.3 |
| ReauthDialog | Foundation | `app/shell/reauth-dialog.tsx` | V1 | 16 §4.4 |
| ConflictDialog | Foundation | `app/shell/conflict-dialog.tsx` | V1 | 16 §4.4 |
| StepperDialog | Foundation | `ui/stepper-dialog.tsx` | V1 | 16 §4.6 |
| Sheet (Drawer) | Foundation | `ui/drawer.tsx` | V1 | 16 §2.6, 19 §9 |
| Drawer | Foundation | `ui/drawer.tsx` | V1 | 19 §3.1 |
| SideDrawer | Foundation | `ui/drawer.tsx` | Later | 16 §8 |
| Tabs | Foundation | `ui/tabs.tsx` | V1 | 09 §12 |
| TabNav | Foundation | `app/shell/tab-nav.tsx` | V1 | 09 §12 |
| Pagination | Foundation | `ui/pagination.tsx` | V1 | 09 §13 |
| Progress | Foundation | `ui/progress.tsx` | V1 | 17 §4.2 |
| Meter | Foundation | `ui/meter.tsx` | V1 | 23 §11.2 |
| Toaster, toast() | Foundation | `ui/toast.tsx` | V1 | 18 §3 |
| LiveIndicator | Foundation | `ui/live-indicator.tsx` | V1 | 21 §8.4 |
| CountTabs | Foundation | `ui/count-tabs.tsx` | V1 | 23 §9.3, 18 §7, visual-spec §5 |
| Field parts (Field, FieldLabel, FieldDescription, Fieldset) | Forms | `ui/field.tsx` | V1 | 10 §2 |
| FieldError | Forms | `ui/field.tsx` | V1 | 10 §2, 17 §5.1 |
| FormField | Forms | `app/forms/form-field.tsx` | V1 | 10 §2 |
| Input | Forms | `ui/input.tsx` | V1 | 10 §4 |
| InputGroup | Forms | `ui/input-group.tsx` | V1 | 10 §4 |
| PasswordInput | Forms | `ui/password-input.tsx` | V1 | 10 §21 |
| OtpField | Forms | `ui/otp-field.tsx` | V1 | 10 §21 |
| Textarea | Forms | `ui/textarea.tsx` | V1 | 10 §5 |
| Select | Forms | `ui/select.tsx` | V1 | 10 §6.2 |
| Combobox | Forms | `ui/combobox.tsx` | V1 | 10 §6.3 |
| MultiSelect | Forms | `ui/multi-select.tsx` | V1 | 10 §6.4 |
| Checkbox | Forms | `ui/checkbox.tsx` | V1 | 09 §8.1 |
| CheckboxGroup | Forms | `ui/checkbox-group.tsx` | V1 | 10 §7 |
| Radio, RadioGroup, RadioCard | Forms | `ui/radio-group.tsx` | V1 | 09 §8.2, 10 §7 |
| Switch | Forms | `ui/switch.tsx` | V1 | 09 §8.3 |
| SettingRow | Forms | `ui/setting-row.tsx` | V1 | 10 §8 |
| Slider | Forms | `ui/slider.tsx` | V1 | 09 §8.4 |
| Calendar | Forms | `ui/calendar.tsx` | V1 | 10 §10.1 |
| DatePicker | Forms | `ui/date-picker.tsx` | Later | 10 §10.3 |
| DateRangePicker | Forms | `app/filters/date-range-picker.tsx` | V1 | 10 §10.2 |
| NumberInput | Forms | `ui/number-field.tsx` | V1 | 10 §11 |
| UrlInput | Forms | `app/forms/url-input.tsx` | V1 | 10 §12 |
| DomainInput | Forms | `app/forms/domain-input.tsx` | V1 | 10 §12 |
| SecretInput | Forms | `ui/secret-input.tsx` | Later | 10 §14 |
| SecretReveal | Forms | `ui/secret-reveal.tsx` | V1 | 10 §14 |
| FileDropzone | Forms | `ui/file-dropzone.tsx` | V1 | 10 §15 |
| SearchInput (SearchField) | Forms | `ui/search-input.tsx` | V1 | 10 §17, 13 §6 |
| SaveBar | Forms | `ui/save-bar.tsx` | V1 | 10 §13.2 |
| ErrorSummary | Forms | `ui/error-summary.tsx` | V1 | 10 §18 |
| FormAlert | Forms | `ui/form-alert.tsx` | V1 | 10 §23 |
| ReadOnlyField | Forms | `ui/read-only-field.tsx` | V1 | 10 §20 |
| AppShell | Shell | `app/shell/app-shell.tsx` | V1 | 05 §2 |
| SkipLink | Shell | `app/shell/skip-link.tsx` | V1 | 20 §4.5 |
| Sidebar (SidebarGroup, SidebarItem) | Shell | `app/shell/sidebar.tsx` | V1 | 11 §2, 19 §3.1 |
| TopBar | Shell | `app/shell/top-bar.tsx` | V1 | 11 §4, 19 §3.2 |
| Breadcrumb | Shell | `app/shell/breadcrumb.tsx` | V1 | 11 §4 |
| ProjectSwitcher | Shell | `app/shell/project-switcher.tsx` | V1 | 11 §8 |
| WorkspaceMenu | Shell | `app/shell/workspace-menu.tsx` | V1 | 11 §4 |
| UserMenu | Shell | `app/shell/user-menu.tsx` | V1 | 11 §4 |
| ThemeSwitch | Shell | `app/shell/theme-switch.tsx` | V1 | 11 §4 |
| ThemeMenu | Shell | `app/shell/theme-menu.tsx` | V1 | 19 §3.2 |
| HelpMenu | Shell | `app/shell/help-menu.tsx` | V1 | 20 §15 |
| PageHeader | Shell | `app/shell/page-header.tsx` | V1 | 23 §3 |
| DetailPageHeader | Shell | `app/shell/detail-page-header.tsx` | V1 | 16 §3, 24 §5 |
| SettingsNav | Shell | `app/shell/settings-nav.tsx` | V1 | 24 §6 |
| CommandPalette | Shell | `app/shell/command-palette.tsx` | V1 | 16 §7 |
| KeyboardShortcutsDialog | Shell | `app/shell/keyboard-shortcuts-dialog.tsx` | V1 | 20 §14 |
| LayoutProvider | Layouts | `features/layouts/layout-provider.tsx` | V1 | 23 §18 |
| LayoutGrid | Layouts | `features/layouts/layout-grid.tsx` | V1 | 23 §18.4 |
| CardFrame | Layouts | `features/layouts/card-frame.tsx` | V1 | 23 §18.2 |
| NumberStrip | Layouts | `features/layouts/number-strip.tsx` | V1 | 23 §18.2 |
| CardCatalogDialog | Layouts | `features/layouts/card-catalog-dialog.tsx` | V1 | 23 §18.3 |
| CardOptionsPopover | Layouts | `features/layouts/card-options-popover.tsx` | V1 | 23 §18.2 |
| LayoutSaveBar | Layouts | `features/layouts/layout-save-bar.tsx` | V1 | 23 §18.2 |
| CustomizeButton | Layouts | `features/layouts/customize-button.tsx` | V1 | 23 §18.2 |
| NotificationBell | Shell | `app/shell/notification-bell.tsx` | V1 | 18 §5.1 |
| NotificationCenter | Shell | `app/shell/notification-center.tsx` | V1 | 18 §5.2 |
| NotificationItem | Shell | `app/shell/notification-item.tsx` | V1 | 18 §5.3 |
| NotificationGroup | Shell | `app/shell/notification-item.tsx` | V1 | 18 §5.4 |
| DesktopOnlyNotice | Shell | `app/shell/desktop-only-notice.tsx` | V1 | 19 §11 |
| AuthCard | Shell | `app/shell/auth-card.tsx` | V1 | 24 §11 |
| FilterBar | Filters | `app/filters/filter-bar.tsx` | V1 | 13 §2 |
| ScopeControl | Filters | `app/filters/scope-control.tsx` | V1 | 13 §2 |
| CompareSelect | Filters | `app/filters/compare-select.tsx` | V1 | 13 §2, 23 §6.4 |
| FilterChip | Filters | `app/filters/filter-chip.tsx` | V1 | 13 §2 |
| AddFilterButton (FieldPicker) | Filters | `app/filters/add-filter-button.tsx` | V1 | 13 §2 |
| FilterEditor | Filters | `app/filters/filter-editor.tsx` | V1 | 13 §3 |
| FilterSheet | Filters | `app/filters/filter-sheet.tsx` | V1 | 19 §4.2 |
| DataTable | Data: tables | `app/data-table/data-table.tsx` | V1 | 12 |
| DataTableToolbar | Data: tables | `app/data-table/toolbar.tsx` | V1 | 12 §1 |
| BulkActionBar | Data: tables | `app/data-table/bulk-action-bar.tsx` | V1 | 12 §14 |
| ColumnChooser | Data: tables | `app/data-table/column-chooser.tsx` | V1 | 12 §10 |
| ColumnHeaderMenu | Data: tables | `app/data-table/column-header-menu.tsx` | V1 | 12 §10, 20 §7 |
| DensityToggle | Data: tables | `app/data-table/density-toggle.tsx` | V1 | 04 §3 |
| SavedViewMenu | Data: tables | `app/data-table/saved-view-menu.tsx` | V1 | 12 §11, 23 §14 |
| TableFooter | Data: tables | `app/data-table/table-footer.tsx` | V1 | 12 §1 |
| NewResultsNotice | Data: tables | `app/data-table/new-results-notice.tsx` | V1 | 20 §10.4 |
| DataTableList | Data: tables | `app/data-table/data-table-list.tsx` | V1 | 19 §6.7 |
| SimpleTable | Data: tables | `app/data-table/simple-table.tsx` | V1 | 12 §15 |
| KeyValueTable | Data: tables | `app/data-table/key-value-table.tsx` | V1 | 19 §12.3 |
| Column helpers `col.*` | Data: tables | `app/data-table/columns.ts` | V1 | 12 §5 |
| KeywordCell | Cells | `app/cells/keyword-cell.tsx` | V1 | 12 §6 |
| PromptCell | Cells | `app/cells/prompt-cell.tsx` | V1 | 12 §6 |
| RankCell | Cells | `app/cells/rank-cell.tsx` | V1 | 12 §6 |
| RankDeltaCell | Cells | `app/cells/rank-delta-cell.tsx` | V1 | 12 §6 |
| DeltaCell | Cells | `app/cells/delta-cell.tsx` | V1 | 12 §6 |
| MetricCell | Cells | `app/cells/metric-cell.tsx` | V1 | 12 §6 |
| NumberCell | Cells | `app/cells/number-cell.tsx` | V1 | 12 §6 |
| DomainCell | Cells | `app/cells/domain-cell.tsx` | V1 | 12 §6 |
| URLCell | Cells | `app/cells/url-cell.tsx` | V1 | 12 §6 |
| SparklineCell | Cells | `app/sparkline/sparkline-cell.tsx` | V1 | 12 §6, 15 §9 |
| EngineCell | Cells | `app/cells/engine-cell.tsx` | V1 | 12 §6 |
| EngineMetricCell | Cells | `app/cells/engine-metric-cell.tsx` | V1 | 12 §6 |
| StatusCell | Cells | `app/cells/status-cell.tsx` | V1 | 12 §6 |
| CitationCell | Cells | `app/cells/citation-cell.tsx` | V1 | 12 §6 |
| CompetitorCell | Cells | `app/cells/competitor-cell.tsx` | V1 | 12 §6 |
| CostCell | Cells | `app/cells/cost-cell.tsx` | V1 | 12 §6 |
| DateCell | Cells | `app/cells/date-cell.tsx` | V1 | 12 §6 |
| MetricStrip | Data: metrics | `app/metric/metric-strip.tsx` | V1 | 23 §2 |
| MetricItem (MetricLabel) | Data: metrics | `app/metric/metric-item.tsx` | V1 | 23 §2.1 |
| MetricCard | Data: metrics | `app/metric/metric-card.tsx` | V1 | 23 §2.5 |
| Delta | Data: metrics | `app/metric/delta.tsx` | V1 | 14 §5 |
| ConfidenceIndicator | Data: metrics | `app/metric/confidence-indicator.tsx` | V1 | 23 §8.2 |
| SampleCount | Data: metrics | `app/metric/sample-count.tsx` | V1 | 23 §8.3 |
| MetricInfo | Data: metrics | `app/metric/metric-info.tsx` | V1 | 22 §10, 23 §8.1 |
| MetricSwitcher | Data: metrics | `app/metric/metric-switcher.tsx` | V1 | 23 §6.1 |
| StatisticsPanel | Data: metrics | `app/metric/statistics-panel.tsx` | V1 | 23 §8.6 |
| ChartFrame (ChartLegend) | Data: charts | `app/chart/chart-frame.tsx` | V1 | 15 §2 |
| EChart | Data: charts | `app/chart/echart.tsx` | V1 | 15 §3 |
| RateTrendChart | Data: charts | `app/chart/rate-trend-chart.tsx` | V1 | 15 §5 |
| RankHistoryChart | Data: charts | `app/chart/rank-history-chart.tsx` | V1 | 15 §7 |
| RankDistributionChart | Data: charts | `app/chart/rank-distribution-chart.tsx` | V1 | 15 §5 |
| OutcomeMixBar | Data: charts | `app/chart/outcome-mix-bar.tsx` | V1 | 15 §5 |
| Heatmap | Data: charts | `app/chart/heatmap.tsx` | V1 | 15 §5 |
| SmallMultiples | Data: charts | `app/chart/small-multiples.tsx` | V1 | 15 §5 |
| Sparkline (renderer) | Data: charts | `app/sparkline/sparkline.tsx` | V1 | 15 §9 |
| BarList | Data: charts | `app/chart/bar-list.tsx` | V1 | 15 §5.1, visual-spec §5 |
| StackedBar100 | Data: charts | `app/chart/stacked-bar-100.tsx` | V1 | 15 §5.2, visual-spec §5 |
| ChartTooltip | Data: charts | `app/chart/chart-tooltip.tsx` | V1 | 15 §4, 15 §10, visual-spec §5 |
| EmptyState | Data: states | `app/status/empty-state.tsx` | V1 | 17 §2 |
| StatusBadge | Data: states | `app/status/status-badge.tsx` | V1 | 14 §3, 17 §4.1 |
| StatusDot | Data: states | `app/status/status-dot.tsx` | V1 | 14 §3 |
| FreshnessIndicator | Data: states | `app/status/freshness-indicator.tsx` | V1 | 17 §7 |
| CollectionProgress | Data: states | `app/status/collection-progress.tsx` | V1 | 17 §4 |
| RefetchBar | Data: states | `app/status/refetch-bar.tsx` | V1 | 17 §3.4 |
| InlineError | Data: states | `app/status/inline-error.tsx` | V1 | 17 §5.2 |
| TableErrorRow | Data: states | `app/data-table/table-error-row.tsx` | V1 | 17 §5.3 |
| ErrorPage | Data: states | `app/status/error-page.tsx` | V1 | 17 §5.8 |
| Banner | Data: states | `app/status/banner.tsx` | V1 | 18 §4 |
| NotCollected | Data: states | `app/metric/value-states.tsx` | V1 | 17 §8 |
| InsufficientData | Data: states | `app/metric/value-states.tsx` | V1 | 17 §8, 23 §8.4 |
| NotApplicable | Data: states | `app/metric/value-states.tsx` | V1 | 17 §8 |
| BeyondDepth | Data: states | `app/metric/value-states.tsx` | V1 | 17 §8 |
| CollectionIssue | Data: states | `app/metric/value-states.tsx` | V1 | 17 §8.1 |
| UncertainFootnote | Data: states | `app/metric/value-states.tsx` | V1 | 17 §8.1 |
| EventTimeline | Data: events | `app/status/event-timeline.tsx` | V1 | 18 §7, 23 §9.1 |
| ChangeFeed | Data: events | `features/overview/components/change-feed.tsx` | V1 | 23 §9.2 |
| SeverityIcon (SeverityLabel) | Data: events | `app/status/severity.tsx` | V1 | 18 §2 |
| AlertEventsTable | Data: events | `features/alerts/components/alert-events-table.tsx` | V1 | 18 §6 |
| AnomalyHoldNotice | Data: events | `app/status/anomaly-hold-notice.tsx` | V1 | 18 §8.3 |
| DigestView | Data: events | `features/alerts/components/digest-view.tsx` | V1 | 18 §8.2 |
| TriageToast | Data: events | `app/status/triage-toast.ts` | V1 | 23 §10.3 |
| RuleList | Data: events | `features/alerts/components/rule-list.tsx` | V1 | 23 §9.4 |
| SetupChecklist | Data: setup | `features/overview/components/setup-checklist.tsx` | V1 | 23 §13 |
| ConnectionStatus | Data: setup | `features/integrations/components/connection-status.tsx` | Later | 24 §7 |
| ScopeList | Data: setup | `features/integrations/components/scope-list.tsx` | Later | 24 §7 |
| RankDelta | SEO | `app/metric/rank-delta.tsx` | V1 | 14 §5, 22 §3 |
| RankTrend | SEO | `app/sparkline/rank-trend.tsx` | V1 | 15 §9 |
| RankDistribution | SEO | `app/seo/rank-distribution.tsx` | V1 | 24 §9.2 |
| SERPFeatureBadge | SEO | `app/seo/serp-feature-badge.tsx` | V1 | 14 §6 |
| SERPFeatureList | SEO | `app/seo/serp-feature-list.tsx` | V1 | 12 §6, 14 §6 |
| KeywordIntentBadge | SEO | `app/seo/keyword-intent-badge.tsx` | V1 | 14 §2 |
| SearchVolumeCell | SEO | `app/cells/search-volume-cell.tsx` | V1 | 22 §2, 24 §9.3 |
| RankingURLCell | SEO | `app/cells/ranking-url-cell.tsx` | V1 | 24 §9.3 |
| TargetURLIndicator | SEO | `app/seo/target-url-indicator.tsx` | V1 | 12 §6, 23 §4.1 |
| CannibalizationIndicator | SEO | `app/seo/cannibalization-indicator.tsx` | V1 | 12 §6 |
| RankHistoryChart (alias RankingHistoryChart) | SEO | `app/chart/rank-history-chart.tsx` | V1 | 15 §7 |
| CompetitorRankCell | SEO | `app/cells/competitor-rank-cell.tsx` | V1 | 24 §9.3 |
| AIOverviewStatus | SEO | `app/seo/ai-overview-status.tsx` | V1 | 12 §6, 23 §7.1 |
| SERPPreview | SEO | `app/seo/serp-preview.tsx` | V1 | 19 §12.3 |
| EngineBadge (observation class badge) | AI | `app/ai/engine-badge.tsx` | V1 | 14 §4 |
| MentionStatus | AI | `app/ai/mention-status.tsx` | V1 | 23 §5 |
| CitationStatus | AI | `app/ai/citation-status.tsx` | V1 | 12 §6 |
| RecommendationStatus | AI | `app/ai/recommendation-status.tsx` | V1 | 23 §5.5 |
| PromptTypeBadge | AI | `app/ai/prompt-type-badge.tsx` | V1 | 12 §6 |
| MentionRate | AI | `app/ai/mention-rate.tsx` | V1 | 23 §2, 24 §9.5 |
| CitationRate | AI | `app/ai/citation-rate.tsx` | V1 | 23 §2, 24 §9.5 |
| ProminenceIndicator | AI | `app/ai/prominence-indicator.tsx` | V1 | 22 §9, 23 §5.5 |
| StructuredRank | AI | `app/ai/structured-rank.tsx` | V1 | 22 §9, 23 §5.5 |
| ResponsePreview | AI | `app/evidence/response-preview.tsx` | V1 | 23 §5.1 |
| EvidenceViewer | AI | `app/evidence/evidence-viewer.tsx` | V1 | 23 §5.2 |
| EvidenceText | AI | `app/evidence/evidence-text.tsx` | V1 | 23 §5.1 |
| EvidenceHighlight | AI | `app/evidence/evidence-highlight.tsx` | V1 | 23 §5.3 |
| CitationMarker | AI | `app/evidence/citation-marker.tsx` | V1 | 23 §5.4 |
| EntityToggleList | AI | `app/evidence/entity-toggle-list.tsx` | V1 | 23 §5.1 |
| CitationList | AI | `app/evidence/citation-list.tsx` | V1 | 23 §5.4 |
| FactsFooter | AI | `app/evidence/facts-footer.tsx` | V1 | 23 §5.5 |
| AnswerViewMode | AI | `app/evidence/answer-view-mode.tsx` | V1 | 23 §5.1 |
| SafeMarkdown | AI | `app/evidence/safe-markdown.tsx` | V1 | 23 §5.6 |
| AnswerCompare | AI | `app/evidence/answer-compare.tsx` | Later | 23 §6.3 |
| SourceDomainCell | AI | `app/cells/source-domain-cell.tsx` | V1 | 24 §9.7 |
| ObservationStatus | AI | `app/ai/observation-status.tsx` | V1 | 23 §5.2 |
| VolatilityIndicator | AI | `app/ai/volatility-indicator.tsx` | V1 | 24 §9.6 |
| EngineStatusGlyph | AI | `app/ai/engine-status-glyph.tsx` | V1 | visual-spec §5, 12 §6 |
| EnginePresenceSquare | AI | `app/ai/engine-presence-square.tsx` | V1 | visual-spec §5 |
| QuoteBox | AI | `app/evidence/quote-box.tsx` | V1 | 23 §4.4 |
| DomainChip | AI | `app/ai/domain-chip.tsx` | V1 | 23 §4.4 |
| SEOAIStatus | Cross-channel | `app/cross/seo-ai-status.tsx` | V1 | 23 §7.1 |
| SEOAIComparisonRow | Cross-channel | `app/cross/seo-ai-comparison-row.ts` | V1 | 23 §6.2 |
| SEOAIMatrix | Cross-channel | `app/cross/seo-ai-matrix.tsx` | V1 | 15 §8 |
| MatrixScatter | Cross-channel | `app/chart/matrix-scatter.tsx` | V1 | 15 §8 |
| QuadrantSummary | Cross-channel | `app/cross/quadrant-summary.tsx` | V1 | 15 §8, 23 §2.5 |
| OpportunityStatus | Cross-channel | `app/cross/opportunity-status.tsx` | V1 | 23 §7.3 |
| KeywordPromptLink | Cross-channel | `app/cross/keyword-prompt-link.tsx` | V1 | 23 §4.2 |
| CrossChannelTrend | Cross-channel | `app/cross/cross-channel-trend.tsx` | V1 | 24 §9.10 |
| PageVisibilitySummary | Cross-channel | `app/cross/page-visibility-summary.tsx` | V1 | 24 §9.10 |
| CostSummary | Cost | `app/metric/cost-summary.tsx` | V1 | 23 §11.1 |
| BudgetMeter | Cost | `app/metric/budget-meter.tsx` | V1 | 23 §11.2 |
| BudgetStatusBadge | Cost | `app/status/budget-status-badge.tsx` | V1 | 23 §11.5 |
| ProviderCostTable | Cost | `features/costs/components/provider-cost-table.tsx` | V1 | 23 §11.3 |
| UnitCostList | Cost | `features/costs/components/unit-cost-list.tsx` | V1 | 23 §11.4 |
| Inspector | Inspector | `app/inspector/inspector.tsx` | V1 | 16 §2 |
| InspectorHeader | Inspector | `app/inspector/inspector-header.tsx` | V1 | 16 §2.1, 23 §4.1 |
| InspectorTabs | Inspector | `app/inspector/inspector-tabs.tsx` | V1 | 16 §2.3 |
| InspectorSection | Inspector | `app/inspector/inspector-section.tsx` | V1 | 16 §2.4 |
| InspectorFooter | Inspector | `app/inspector/inspector-footer.tsx` | V1 | 16 §2.5 |
| InspectorResizeHandle | Inspector | `app/inspector/inspector-resize-handle.tsx` | V1 | 16 §2.2 |
| useInspector | Hooks | `app/inspector/use-inspector.ts` | V1 | 16 §2.7 |
| useSavedView | Hooks | `app/data-table/use-saved-view.ts` | V1 | 12 §11 |
| useReducedMotion | Hooks | `lib/design/motion.ts` | V1 | 21 §11.3 |
| useChartTheme, readTokens | Hooks | `lib/design/read-tokens.ts`, `app/chart/use-chart-theme.ts` | V1 | 26 §8 |
| useShortcut | Hooks | `lib/a11y/use-shortcut.ts` | V1 | 20 §14 |
| useViewportClass | Hooks | `lib/design/use-viewport-class.ts` | V1 | 19 §2 |
| announce() | Hooks | `lib/a11y/announcer.ts` | V1 | 20 §10 |
| Formatters | Utilities | `lib/format/*` | V1 | 22 |
| Metric definitions registry | Utilities | `lib/metrics/definitions.ts` | V1 | 22 §8 |
| TONE_TEXT, engine helpers | Utilities | `app/metric/tone.ts`, `lib/metrics/engines.ts` | V1 | 02 §6, 14 §4 |

## 3. Foundation primitives

### 3.1 Button
`ui/button.tsx`, `ui/button-variants.ts`, `ui/link-button.tsx` · V1 · [09 §2](09-buttons-controls.md) (full CVA in 09 §2.9)

Purpose: the one clickable action element. Every other button-like component reuses `buttonVariants`, which lives in `ui/button-variants.ts` without `'use client'` so server code can call it.

```ts
import type { Button as ButtonPrimitive } from '@base-ui/react/button';
type ButtonVariant = 'primary' | 'secondary' | 'subtle' | 'ghost' | 'destructive' | 'destructive-solid' | 'link';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon-xs' | 'icon-sm' | 'icon';
interface ButtonProps extends ButtonPrimitive.Props {
  variant?: ButtonVariant;          // default 'secondary'
  size?: ButtonSize;                // default 'md'
  icon?: LucideIcon;                // leading only; replaced by Spinner while loading
  loading?: boolean;                // set by the caller after 400 ms pending
  type?: 'button' | 'submit';       // default 'button'
}
```

- **Variants:** `variant` 7 values, `size` 6 values (09 §2.2, §2.3). `destructive-solid` only as the confirm button of a `ConfirmDialog`.
- **States:** hover, pressed, focus, disabled (`data-disabled`), disabled with reason (`focusableWhenDisabled` plus `Tooltip`), loading (`aria-busy`, width kept, label at `opacity-0`).
- **A11y:** APG button; native `<button>`; Enter and Space; shortcut exposed with `aria-keyshortcuts`. A loading button stays in the tab order, ignores click, Enter and Space, and does not submit its form again.
- **LinkButton** (`ui/link-button.tsx`): an action that navigates. `interface LinkButtonProps { render: React.ReactElement; variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; icon?: LucideIcon; children: Slot; className?: string }`. It puts `buttonVariants` on the link it is given (`render={<Link href="…" />}`), so it is announced and behaves as a link. `Button` with `nativeButton={false}` is not used for this: Base UI gives whatever it renders the button role. It has no `'use client'`, so a Server Component can render it with an icon.
- **Use:** any command; at most one `primary` per region (page header, dialog, inspector, empty state, save bar). Labels: verb first, 3 words at most.
- **Not for:** icon-only actions (use `IconButton`), on/off view options (`ToggleButton`), navigation inside running text (`TextLink`), a list of choices (`Select`).

### 3.2 IconButton
`ui/icon-button.tsx` · V1 · [09 §3](09-buttons-controls.md)

Purpose: an icon-only `Button` with a required accessible name and matching tooltip.

```ts
interface IconButtonProps extends Omit<ButtonProps, 'size' | 'children' | 'icon' | 'loading'> {
  icon: LucideIcon;
  label: string;                    // aria-label and tooltip text; never contains "button"
  size?: 'icon-xs' | 'icon-sm' | 'icon';   // 24, 32, 36 px; default 'icon-sm'
  shortcut?: readonly string[];     // key ids as Kbd takes them (['mod', 'k']): rendered as Kbd in the tooltip, aria-keyshortcuts on the button
  iconSize?: 'md';                  // 18 px, for the top bar (07 §2)
  tooltipSide?: 'top' | 'bottom' | 'right';   // 'bottom' in the top bar and in table headers, 'right' in the collapsed sidebar
}
```

- **Variants:** `size` 3 values (`icon-xs` for inline info triggers; `icon-sm` for tables and inspectors; `icon` next to 36 px controls in page headers, filter bars and the top bar); `variant` default `ghost`: no border, `foreground-secondary` icon (09 §3), `foreground` on hover.
- **States:** as `Button`; tooltip opens after 400 ms on hover and at once on keyboard focus.
- **A11y:** `aria-label` equals the tooltip text; icon `aria-hidden`; repeated row buttons include the row name ("More actions for crm pricing").
- **Use:** only the universally understood actions in [07-icons.md](07-icons.md) §4 (close, more, copy, external link, collapse sidebar, settings, search, filter, sort direction, density, column chooser), the inspector's Expand button ("Open page", `Maximize2`; section 23, item 30) and the collapsed sidebar.
- **Not for:** any other action; it gets a text label (`Button`).

### 3.3 SplitButton
`ui/split-button.tsx` · V1 · [09 §4](09-buttons-controls.md)

Purpose: a default action plus a menu of alternatives, for example "Export" with "Export XLSX" and "Schedule export".

```ts
interface SplitButtonProps {
  label: string;                    // default action, verb first
  icon?: LucideIcon;
  onAction: () => void;
  menuLabel: string;                // group aria-label and trigger name ("More export options")
  items: ReadonlyArray<{ id: string; label: string; icon?: LucideIcon; onSelect: () => void; disabledReason?: string }>;
  variant?: 'secondary' | 'primary';
  size?: 'sm' | 'md';
  loading?: boolean;
}
```

- **Variants:** `variant` 2 values, `size` 2 values.
- **States:** each half has the `Button` states; trigger keeps pressed background while `data-popup-open`.
- **A11y:** wrapper `role="group"` with `aria-label`; right half is a `Menu.Trigger` with `aria-haspopup="menu"`, `aria-expanded`.
- **Use:** when the default is chosen at least 80% of the time.
- **Not for:** menus that do not have a dominant default (use a `Menu` trigger button); the menu never repeats the default action.

### 3.4 ToggleButton (Toggle)
`ui/toggle-button.tsx` · V1 · [09 §5](09-buttons-controls.md)

Purpose: a persistent on/off view option in a toolbar ("Patterns", "Show annotations", "Sync scroll").

```ts
interface ToggleButtonProps {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  label: string;                    // does not change between states
  icon?: LucideIcon;
  iconOnly?: 'label' | 'icon';      // 'icon' renders icon-sm with tooltip and aria-label
  size?: 'sm' | 'icon-sm';
  disabledReason?: string;
}
```

- **Variants:** `size` 2 values.
- **States:** off (ghost styles), on (`data-pressed`: `bg-surface-selected`, icon `text-primary-text`), hover while on keeps selected, disabled.
- **A11y:** APG button (toggle); Base UI `Toggle` sets `aria-pressed`; Enter, Space.
- **Use:** view options on the current screen that do not persist data.
- **Not for:** settings with immediate saved effect (`Switch`), choosing one of several views (`SegmentedControl`), form booleans (`Checkbox`).

### 3.5 SegmentedControl
`ui/segmented-control.tsx` on Base UI `RadioGroup` (the same primitive `ui/radio-group.tsx` builds on; they share `useRadioFocus`) · V1 · [09 §6](09-buttons-controls.md). `ui/toggle-group.tsx` remains for independent toggles only

Purpose: one visual control, 2 to 5 short options side by side, with three semantic implementations chosen by purpose.

```ts
interface SegmentedControlProps<TValue extends string> {
  semantics: 'view' | 'radio';      // 'view': switches a view option; 'radio': sets a form value. Panels use Tabs variant="segmented"
  label: string;                    // group name (legend for 'radio', aria-label for 'view')
  value: TValue;
  onValueChange: (value: TValue) => void;   // empty value is rejected
  items: ReadonlyArray<{ value: TValue; label: string; icon?: LucideIcon; count?: string; disabled?: boolean }>;
  size?: 'sm' | 'md';               // 32 or 36 px track
  focusRef?: React.Ref<{ focus(): void }>;   // a form passes field.ref: a failed submit focuses the chosen segment
}
```

- **Variants:** `size` 2 values. Bordered group (1 px `border`, `rounded-md`) with inner 1 px `border` dividers between segments.
- **States:** unselected (no fill, `foreground-secondary` label at weight 400), hover, selected (`bg-primary-subtle`, 1 px `primary-border` outline, `primary-text` label at weight 500; the accent may mark a selected segment), focus, disabled. Each item reserves the width of its weight 500 label, so selection never shifts the layout ([visual-spec §6](reference/visual-spec.md)); selection changes the fill in 100 ms with no sliding thumb.
- **A11y:** single-choice segmented controls are `role="radiogroup"` with `role="radio"` items; arrow keys move and select, Tab leaves ([09 §6](09-buttons-controls.md), [20-accessibility.md](20-accessibility.md) §5; section 23, item 2).
- **Use:** density toggle, chart or table view, "Absolute or Share", triage status (New, Accepted, Snoozed, Rejected), device in forms.
- **Not for:** more than 5 options or labels longer than 2 words (`Select`), switching panels (`Tabs variant="segmented"`), independent toggles (`ToggleButton`).

### 3.6 Toolbar
`ui/toolbar.tsx` · V1 · [09 §7](09-buttons-controls.md)

Purpose: groups the buttons of a table, chart or timeline header into one Tab stop.

```ts
interface ToolbarProps {
  label: string;                    // "Keyword table actions"
  children: Slot;                   // Toolbar.Button render={<Button size="sm" variant="ghost" />}, Toolbar.Group, Toolbar.Separator
}
```

- **Variants:** none; all controls are 32 px (`sm`, `h-control-sm`), `gap-1.5`, separators `h-6 w-px bg-border-subtle`.
- **States:** inherits from its controls.
- **A11y:** APG toolbar, `role="toolbar"`, `aria-orientation="horizontal"`; Tab in and out, Left and Right move, Home and End, `loopFocus`.
- **Use:** table toolbar view controls, chart frame actions, event timeline filters.
- **Not for:** a search field (sits outside the toolbar so arrow keys edit text), page header actions (plain button group).

### 3.7 CopyButton
`ui/copy-button.tsx` · V1 · [09 §9.1](09-buttons-controls.md)

Purpose: copies an original value (full URL, raw id, key) with confirmation.

```ts
interface CopyButtonProps {
  value: string;                    // the original value, never the display string
  label?: string;                   // default "Copy"; "Copy URL", "Copy ID", "Copy ranking URL"
  form?: 'icon' | 'labeled';        // 'labeled' for secrets shown once
  size?: 'icon-xs' | 'icon-sm' | 'sm' | 'md';
}
```

- **Variants:** `size` 4 values.
- **States:** idle, copied (icon swaps to `Check` in `text-positive-text` for 1.5 s, tooltip "Copied"), failed (toast "Could not copy. Select the text and copy it manually.").
- **A11y:** button; `announce('Copied')` politely; focus stays on the button.
- **Use:** URLs, ids, keys, error ids.
- **Not for:** copying back what the user just typed (secret inputs), sharing a view (use "Copy link" in the page More menu, which copies the canonical URL).

### 3.8 ExternalLinkButton
`ui/external-link-button.tsx` · V1 · [09 §9.2](09-buttons-controls.md)

Purpose: opens a destination outside the product in a new tab.

```ts
interface ExternalLinkButtonProps {
  href: string;                     // only http and https render; other schemes render disabled with reason
  label: string;                    // names the destination: "Open in GSC", "View SERP"
  variant?: 'secondary' | 'link';
  size?: 'sm' | 'md' | 'icon-xs';   // 'icon-xs' for row hover actions ("Open /pricing in a new tab")
}
```

- **Variants:** `variant` 2 values, `size` 3 values.
- **States:** as `Button`; invalid scheme disabled.
- **A11y:** `target="_blank"`, `rel="noopener noreferrer nofollow"`, trailing `ExternalLink` icon, visually hidden "(opens in a new tab)".
- **Use:** provider consoles, live pages, cited URLs.
- **Not for:** in-app navigation (`TextLink`, `Button render={<Link />}`).

### 3.9 TextLink
`ui/text-link.tsx` · V1 · [20 §19](20-accessibility.md) (`Link`)

Purpose: a link in running text, meta lines and "View all" slots.

```ts
type TextLinkProps = (
  | { href: string }                        // a plain anchor
  | { render: React.ReactElement }          // <NextLink href=... /> from components/app; it carries the destination
) & {
  children: Slot;
  variant?: 'standalone' | 'inline';        // default 'standalone'
  tone?: 'link' | 'inherit';                // 'inherit' for back links and meta-line links that take the text color
} & AnchorAttributes;                       // target, rel, aria-*, data-* are passed on
```

- **Variants:** `variant` 2 values: `inline` inside a sentence, underlined at rest (20 §19); `standalone` for "View all", back links and meta-line links, underlined on hover and focus. `tone` 2 values.
- **States:** hover and focus underline (instant), visited identical.
- **A11y:** native `<a>`; repeated links ("View all") include the object ("View all 20 competitors").
- **Use:** "Show all 20", "Methodology", back links, links inside helper text.
- **Not for:** actions that change data (`Button variant="link"`), external destinations (`ExternalLinkButton`).

### 3.10 Icon
`ui/icon.tsx` · V1 · [07-icons.md](07-icons.md)

Purpose: the only way to render a Lucide glyph; fixes size and stroke.

```ts
interface IconProps {
  icon: LucideIcon;
  size?: 'xs' | 'sm' | 'default' | 'md' | 'lg';  // 12, 14, 16 (default), 18, 20 px (`size-icon-xs`, `size-icon-sm`, `size-icon`, `size-icon-md`, `size-icon-lg`); stroke per 07 §2
  label?: string;                   // only for meaningful standalone icons; otherwise aria-hidden
}
```

- **Variants:** `size` 5 values; color is `currentColor`.
- **States:** none.
- **A11y:** `aria-hidden` by default; with `label`, `role="img"` and `aria-label`.
- **Use:** every icon, with the glyph assignments in 07 §6.
- **Not for:** engine logos (`EngineLogo`, section 15.1), favicons (`DomainCell`), rank arrows (text glyphs `↑` `↓` from the formatter).

### 3.11 Kbd
`ui/kbd.tsx` · V1 · [09 §11](09-buttons-controls.md)

Purpose: shows a keyboard shortcut.

```ts
interface KbdProps {
  keys: readonly string[];          // platform-neutral ids: ['mod', 'k'], ['/'], ['shift', 'f10']
  singleKey?: 'always' | 'respect-setting';  // 'respect-setting' hides the hint when single-key shortcuts are off
  decorative?: boolean;             // inside an interactive element: hidden from assistive technology
}
```

- **Variants:** none (20 px tall, `type-kbd`, `rounded-sm` (4 px) hint box, as the "⌘K" hint in the top bar search field).
- **States:** hidden when single-key shortcuts are off and the combination is a single character.
- **A11y:** one `<kbd>` per key, `aria-hidden`, followed by the key names in a visually hidden element ("Command K", "Control Shift Up arrow"), so a screen reader never reads a glyph; with `decorative` the whole hint is `aria-hidden` (the element carries `aria-keyshortcuts`). `useAriaKeyShortcuts(keys)` gives that attribute's value: `Control+k`, `Meta+k` on a Mac, `Shift+F10`, `Control+Plus`, and `undefined` for a sequence of two keys, which the attribute cannot express. The server renders the words ("Ctrl"); a Mac switches to the glyphs when it hydrates.
- **Use:** tooltips, menu items, search field hint, command palette footer, shortcuts dialog.
- **Not for:** inline shortcut hints on buttons (only the command palette trigger shows one).

### 3.12 Spinner
`ui/spinner.tsx` · V1 · [21 §8.2](21-motion.md), [17 §3.5](17-empty-loading-error-states.md)

Purpose: indicates a running process, only in the places listed in 17 §3.5 (for example loading buttons, running `CollectionProgress` and `FreshnessIndicator`, on-demand computed cells, and the "Updating" text of a refetch longer than 400 ms).

```ts
interface SpinnerProps {
  size?: 'sm' | 'md';               // 14 px in controls and tables, 16 px elsewhere
  label?: string;                   // visible text sits next to it; otherwise this becomes the accessible label
}
```

- **Variants:** `size` 2 values.
- **States:** rotating (800 ms linear); static under reduced motion.
- **A11y:** wrapper `role="status"` with text ("Loading keywords"); glyph `aria-hidden`.
- **Use:** only the places listed in 17 §3.5, always with text.
- **Not for:** page or region loading (`Skeleton`), marking the refetching region (`RefetchBar`; only the "Updating" text in the toolbar or chart header may carry a spinner), anything larger than 16 px.

### 3.13 Separator
`ui/separator.tsx` · V1 · [06 §5](06-surfaces-borders-radius.md)

Purpose: 1 px divider between regions, toolbar groups and metric strip items.

```ts
interface SeparatorProps {
  orientation?: 'horizontal' | 'vertical';
  tone?: 'subtle' | 'default';      // border-subtle (default) or border (metric strip group divider)
  semantics?: 'decorative' | 'separator';   // 'separator' exposes role="separator"; menus use Menu.Separator
}
```

- **Variants:** `tone` 2 values.
- **States:** none.
- **A11y:** decorative separators are `aria-hidden`.
- **Use:** between sections, toolbar groups, strip items.
- **Not for:** hierarchy that position or weight already show; borders around every group (06 §1).

### 3.14 ScrollArea
`ui/scroll-area.tsx` · V1 · [16 §5.1](16-drawers-dialogs-popovers.md)

Purpose: token-styled scrolling region inside popovers, menus and panels with fixed header and footer.

```ts
interface ScrollAreaProps { maxHeight: 'popover' | 'menu' | 'command' | 'fill'; label?: string; children: Slot }
```

- **Variants:** none (thin scrollbar in `border-strong`).
- **States:** overflow, no overflow; `scrollbar-gutter: stable`.
- **A11y:** focusable (`tabIndex={0}`) with `label` when the content has no focusable children.
- **Use:** popover bodies, notification list, command palette list.
- **Not for:** table bodies (the `DataTable` owns its scroll container), the page.

### 3.15 Skeleton
`ui/skeleton.tsx` (block), `app/status/skeletons.tsx` (`SkeletonText`, `SkeletonTable`, `SkeletonMetricStrip`, `SkeletonChart`) · V1 · [17 §3](17-empty-loading-error-states.md)

Purpose: placeholder blocks shaped like the final content, so nothing shifts when data arrives.

```ts
interface SkeletonProps { shape: 'text-14' | 'text-13' | 'text-12' | 'block' | 'badge' | 'sparkline'; widthPct?: 48 | 56 | 64 | 72 | 80 | 100; height?: 'row' | 'chart-140' | 'chart-180' | 'chart-240' | 'chart-280' }   // text-14: body and controls; text-13: table cells and meta; text-12: labels
interface SkeletonTableProps { columns: ReadonlyArray<ColumnDef<unknown>>; density: Density; rows?: 12 }
interface SkeletonMetricStripProps { labels: readonly string[]; size: 'md' | 'sm' }   // labels are real
interface SkeletonChartProps { title: string; height: 140 | 180 | 240 | 280 | 480; xDomain?: readonly [BusinessDate, BusinessDate]; rankDepth?: number }
```

- **Variants:** none; `surface-subtle`, `rounded-sm`, widths from a fixed per-row pattern.
- **States:** pulsing (opacity 1 to 0.6, 1.5 s, in phase across the page); static under reduced motion.
- **A11y:** `aria-hidden`; the region sets `aria-busy="true"` and a visually hidden "Loading {object}"; announced only after 2 s.
- **Use:** first load of a query key; everything known in advance (titles, headers, labels) is real.
- **Not for:** refetch with previous data (keep data, add `RefetchBar`), spinners, blank panels.

### 3.16 Avatar
`ui/avatar.tsx` · V1 · [11 §4](11-navigation.md)

Purpose: the user's initials in the top bar user menu and in member lists.

```ts
interface AvatarProps { name: string; imageUrl?: string | null; size?: 'sm' | 'md' }   // 20 or 32 px (md: `size-avatar`, the top bar)
```

- **Variants:** `size` 2 values; `rounded-full` circle; photo, or initials `type-micro` on `neutral-subtle`.
- **States:** image, initials fallback.
- **A11y:** decorative next to a visible name (`alt=""`); inside the user menu trigger the button carries the name.
- **Use:** user menu trigger, members table.
- **Not for:** entities or engines (swatch or `EngineBadge`).

### 3.17 Badge
`ui/badge.tsx` · V1 · [14 §1](14-badges-status.md)

Purpose: a 22 px (`h-badge`) non-interactive label for categorical metadata or state: 8 px horizontal padding (`px-2`), `rounded-sm` (4 px), `type-micro` (12/16, 500).

```ts
interface BadgeProps {
  tone?: 'neutral' | 'positive' | 'negative' | 'warning' | 'info';  // default 'neutral'
  variant?: 'subtle' | 'outline' | 'text';                           // default 'subtle'
  icon?: LucideIcon;                                                  // 12 px leading
  children: string;
}                                                                     // plus the attributes of a span, passed on to the root
```

- **Variants:** `tone` 5 values x `variant` 3 values (the combinations in 14 §1; warning and info have no outline form, and the props type refuses it). Neutral subtle: `neutral-subtle` fill, `neutral-text` label, 1 px `neutral-border` always on, `surface` fill inside a selected row (`group-aria-selected:bg-surface`). Positive subtle: `positive-subtle` fill, `positive-text` label, optional 12 px check icon ("Cited", "Owned", "Cited · source 2 of 5").
- **States:** none; never wraps; transparent border for forced colors.
- **A11y:** plain text; the word carries meaning; a badge with a tooltip reaches 24 px width by padding or spacing.
- **Use:** engine, intent, prompt type, panel, role, Estimate, Stale, New, Lost. Categorical metadata is always neutral. At most 2 per cell and 3 per row in Compact density.
- **Not for:** interactive tags (`Tag`, `FilterChip`), lifecycle states with icons (`StatusBadge`), counts in navigation (sidebar count), pills (`rounded-full` is not allowed on text).

### 3.18 Tag
`ui/tag.tsx` · V1 · [14 §2](14-badges-status.md), [10 §6.4](10-forms.md)

Purpose: a removable value chip (keyword tags, aliases, multi-select chips).

```ts
interface TagProps { label: string; onRemove?: () => void; removeLabel?: string }  // removeLabel default "Remove {label}"
```

- **Variants:** none (`h-badge px-2 rounded-sm border-neutral-border bg-neutral-subtle type-micro`: 22 px, the neutral badge style).
- **States:** default, focused remove button, disabled (no remove).
- **A11y:** remove is a button named "Remove {label}" (24 px target via spacing exception in chip rows); Backspace and Delete remove when focused.
- **Use:** inside `MultiSelect` controls, tag lists in inspectors.
- **Not for:** filters (`FilterChip`), read-only categories (`Badge`).

### 3.19 Truncate
`ui/truncate.tsx` · V1 · [20 §13.4](20-accessibility.md), [22 §6](22-content-formatting.md)

Purpose: single-line truncation with the full value in a tooltip on hover.

```ts
interface TruncateProps {
  text: string;                     // full value
  display?: string;                 // pre-truncated display (middle truncation from truncatePath)
  // no `mode`: passing `display` is what makes it a middle truncation
}                                   // plus the attributes of a span; pass `lang` (BCP 47) when the content is not English
```

- **Variants:** none.
- **States:** fits (no tooltip), truncated (tooltip). The width is measured when the pointer arrives, not on mount: no observer per cell, and a value that changes in place is always judged by its current width.
- **A11y:** carries `data-truncate` for the text-spacing test; the accessible name is the full text.
- **Use:** every single-line cell, chip value, title in lists.
- **Not for:** titles (they wrap to 2 lines), prose.

### 3.20 Collapsible
`ui/collapsible.tsx` · V1 · [20 §5](20-accessibility.md), [21 §5](21-motion.md)

Purpose: a disclosure that shows or hides a short block (grouped notifications, "2 more notices", evidence panels on narrow widths).

```ts
interface CollapsibleProps { open: boolean; onOpenChange: (open: boolean) => void; triggerLabel: string; children: Slot }
```

- **Variants:** none.
- **States:** open, closed; chevron rotates 90 degrees in 100 ms; the panel opens instantly (no height animation).
- **A11y:** APG disclosure; `aria-expanded`, `aria-controls`; Enter, Space.
- **Use:** optional detail inside a region.
- **Not for:** inspector sections (never collapsible, 16 §2.4), expandable table rows (`DataTable` grouping).

### 3.21 Tooltip
`ui/tooltip.tsx` · V1 · [16 §6.1](16-drawers-dialogs-popovers.md)

Purpose: one or two lines that name or explain one element (truncated values, icon labels, column definitions, exact values).

```ts
interface TooltipProps {
  content: string;                  // main line in type-meta foreground
  detail?: string;                  // second line in foreground-tertiary
  side?: 'top' | 'bottom' | 'right';   // 'bottom' for table headers and top bar, 'right' for the collapsed sidebar
  purpose?: 'description' | 'label';   // default 'description'
  shortcut?: readonly string[];     // key caps after the text; aria-keyshortcuts on the trigger
  disabled?: boolean;
  shouldOpen?: () => boolean;       // asked before each opening; Truncate answers from the measured width
  children: React.ReactElement;     // the trigger: any primitive, since all pass their props and ref on
}
```

- **Variants:** none (`surface-elevated`, 1 px border, `rounded-md`, `shadow-popover`, max 320 px).
- **States:** closed (nothing mounted), open after 400 ms of hover or at once on keyboard focus, instant when moving between triggers (`data-instant`).
- **A11y:** opens on hover and focus; Escape closes; hoverable; no timeout (WCAG 1.4.13). With `purpose="description"` the text is in a `hidden` element next to the trigger, which `aria-describedby` points at: it is in the server HTML, is read whether the tooltip is open or not, and is added to a description the trigger already has. With `purpose="label"` (icon buttons, truncated values) nothing is attached, because the text repeats the accessible name. The popup itself is `aria-hidden` in both cases, so nothing is read twice. The hidden element is a `span` right after the trigger, which has three consequences. The trigger must sit where a `span` is valid: not directly in a `tr`, `tbody`, `ul`, `ol` or `dl` (React reports the invalid nesting in development); in a table header the trigger is the button inside the `th`. The trigger is no longer the last child, so a container that uses `space-*`, `divide-*` or `last:` would treat it as a middle item; layouts here use `gap`, which a hidden element does not affect. And on a trigger that cannot take focus (a badge, an icon) the tooltip is for pointer users only, so it never carries information that is not also elsewhere.
- **Use:** every truncated value, abbreviated header, icon-only control, exact value behind a compact number.
- **Not for:** interactive content or links (`Toggletip`, `Popover`), information needed to complete a task, touch-primary devices (information also lives in the inspector).

### 3.22 Toggletip
`ui/toggletip.tsx` · V1 · [20 §5](20-accessibility.md), [19 §9](19-responsive-behavior.md)

Purpose: an info button that opens a small non-modal popover, used where a tooltip would need a link or on touch.

```ts
interface ToggletipProps { label: string; content: Slot; width?: 'sm' | 'md' }   // label: "About {subject}"; 280 or 360 px
```

- **Variants:** `width` 2 values.
- **States:** closed, open.
- **A11y:** disclosure button (`aria-expanded`) opening a non-modal popover; Escape closes and returns focus; links inside are Tab stops.
- **Use:** generic explanations; the metric instance is `MetricInfo`.
- **Not for:** metric definitions (use `MetricInfo`, which has a fixed content order).

### 3.23 Popover
`ui/popover.tsx` · V1 · [16 §5.1](16-drawers-dialogs-popovers.md)

Purpose: short, focused interaction anchored to a control (filter editors, column chooser, quick settings, date range, method definitions).

```ts
interface PopoverProps {
  trigger: React.ReactElement;
  title?: string;                   // a visible heading that names the popup; without it pass aria-label
  padding?: 'list' | 'text';        // 12 or 16 px
  width?: 'content' | 'min' | 'max' | 'notifications' | 'date-range';  // 'content' (default) sizes between 280 and 360 px; 280, 360, 380, 648 px ('notifications' only for NotificationCenter, 18 §5.2; 'date-range' only for DateRangePicker, 10 §10.2)
  side?: 'bottom' | 'top' | 'left' | 'right';   // default 'bottom'
  align?: 'start' | 'center' | 'end';           // default 'start'
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: Slot;
  footer?: Slot;                    // stays fixed while the body scrolls
}
```

- **Variants:** `width` 5 values.
- **States:** closed, open (150 ms enter, 100 ms exit, 4 px from the open side), collision flipped to the opposite side and shifted along the edge; it never moves to the side of its trigger, and is limited to the available height when it still does not fit.
- **A11y:** non-modal; focus moves to the first focusable element; Escape and outside click close; focus returns to the trigger; one nested floating layer at most.
- **Use:** anything interactive under 400 px tall that belongs to a control.
- **Not for:** record detail (`Inspector`), multi-step tasks (`Dialog`), commands (`Menu`), opening a dialog (close the popover first).

### 3.24 PreviewCard
`ui/preview-card.tsx` · V1 · [16 §6.3](16-drawers-dialogs-popovers.md)

Purpose: read-only hover summary of a linked object (cited URL, competitor, domain).

```ts
interface PreviewCardProps {
  trigger: React.ReactElement;      // always a link that opens the object in the inspector
  typeLabel: string;
  title: string;
  facts: ReadonlyArray<{ label: string; value: string }>;   // at most 3, values preformatted
  freshness?: Slot;
}
```

- **Variants:** none (320 px, 16 px padding).
- **States:** closed, open after 600 ms, closes after 300 ms.
- **A11y:** opens on focus after the same delay; hoverable, dismissible, persistent (WCAG 1.4.13); no actions inside.
- **Use:** links to objects in dense cells where a glance saves an inspector open.
- **Not for:** actions or the only path to information.

### 3.25 Menu
`ui/menu.tsx` · V1 · [09 §10](09-buttons-controls.md), [16 §5.2](16-drawers-dialogs-popovers.md)

Purpose: a list of commands or single choices opened from a button.

```ts
interface MenuItemDef {
  id: string;                       // for radio items also the value
  label: string;
  icon?: LucideIcon;                // either every item in a group has an icon or none
  shortcut?: readonly string[];
  kind?: 'action' | 'checkbox' | 'radio' | 'submenu' | 'link';
  checked?: boolean;
  group?: string;                   // group label text
  tone?: 'default' | 'destructive'; // destructive items are listed last after a separator, wherever they are given
  disabledReason?: string;          // replaces the shortcut hint and describes the item; the item stays focusable
  onSelect?: () => void;
  link?: React.ReactElement;        // for kind 'link': <Link href="..." /> from components/app
  items?: readonly MenuItemDef[];   // one submenu level at most
}
interface MenuProps { trigger: React.ReactElement; items: readonly MenuItemDef[]; align?: 'start' | 'end'; open?: boolean; onOpenChange?: (open: boolean) => void }
```

- **Variants:** none (180 to 280 px, 32 px items).
- **States:** closed, open, item highlighted (`surface-hover`, instant), destructive highlighted (`negative-subtle`), disabled with reason.
- **A11y:** APG menu button; `aria-haspopup="menu"`, `aria-expanded`; `menuitem`, `menuitemcheckbox`, `menuitemradio`; arrows, Home, End, type-ahead, Enter, Escape; Right and Left for the submenu.
- **Use:** More menus, header menus, view menus, grouping menus.
- **Not for:** choosing a form value (`Select`, `Combobox`), navigation trees, content.

### 3.26 ContextMenu
`ui/context-menu.tsx` · V1 · [16 §5.4](16-drawers-dialogs-popovers.md)

Purpose: the Base UI right-click menu primitive; used only through `RowContextMenu`.

```ts
interface ContextMenuProps { items: readonly MenuItemDef[]; children: React.ReactElement; heading?: string }
```

- **Variants, States, A11y:** as `Menu`; Shift plus right-click shows the native browser menu.
- **Use:** table rows.
- **Not for:** anything that is not also reachable from a visible menu.

### 3.27 RowMenu
`app/data-table/row-menu.tsx` · V1 · [16 §5.4](16-drawers-dialogs-popovers.md), [12 §13](12-tables.md)

Purpose: the "More" menu in a row's actions column, built from the same action definitions as the context menu.

```ts
interface RowMenuProps<TRow> {
  row: TRow;
  rowName: string;                  // "More actions for {rowName}"
  actions: ReadonlyArray<RecordAction<TRow>>;   // order: open, object, copy, destructive
}
```

- **Variants:** none; trigger `IconButton` `icon-xs` `Ellipsis`.
- **States:** hidden visually until row hover or focus, always in the accessibility tree; always visible on touch-primary tablets.
- **A11y:** menu button; Shift+F10 or the Menu key on a focused row opens it.
- **Use:** every `DataTable` with row actions.
- **Not for:** inspector content (row menus hold commands only).

### 3.28 RowContextMenu
`app/data-table/row-menu.tsx` · V1 · [16 §5.4](16-drawers-dialogs-popovers.md)

Purpose: right-click menu on a row with the `RowMenu` items; applies to the selection when the row is selected.

```ts
interface RowContextMenuProps<TRow> {
  row: TRow;
  selection: readonly TRow[];       // when the row is selected, actions apply to all selected rows
  itemNoun: { one: string; other: string };   // heading "12 keywords selected"
  actions: ReadonlyArray<RecordAction<TRow>>;
  children: React.ReactElement;     // the row
}
```

- **Variants, States, A11y:** as `ContextMenu`; right-click also focuses that row.
- **Use / Not for:** as `RowMenu`.

### 3.29 Dialog (DialogHeader, DialogBody, DialogFooter)
`ui/dialog.tsx` · V1 · [16 §4](16-drawers-dialogs-popovers.md)

Purpose: a bounded task with a clear end (create, add, edit one object, import).

```ts
interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size: 'sm' | 'md' | 'lg';         // 400, 560, 720 px
  dirty?: boolean;                  // Escape, Close and Cancel open DiscardChangesDialog when true; the scrim does nothing
  discard?: { title: string; description: string; keepEditingLabel: string; discardLabel: string };   // required together with `dirty`
  initialFocus?: React.RefObject<HTMLElement | null>;   // overrides the first field
  children: Slot;
}
interface DialogHeaderProps { title: string; description?: string; closeLabel: string }   // Close is a 32 px icon button
interface DialogBodyProps { children: Slot }                                    // scrolls; server errors as a FormAlert at top
interface DialogFooterProps { primary: Slot; secondary?: Slot; start?: Slot }   // start (left aligned): step "Back" (16 §4.6) or a destructive outline action in a non-destructive dialog (09 §2.6)
function DialogClose(props: { children: React.ReactElement }): React.ReactElement;   // wraps "Cancel", so it closes the way Close does
```

- **Variants:** `size` 3 values.
- **States:** clean, dirty, submitting (primary loading), server error; full-screen sheet below 640 px. The footer shows its top border only while the body is cut off below (`data-cut` on the body). While the discard question is open above it, the dialog is dimmed.
- **A11y:** modal dialog named by its title; everything outside is hidden from assistive technology and focus guards send Tab back in; focus starts in the first field of the body that is shown and enabled, on Close when there is none, or where `initialFocus` says; Escape closes (or asks when dirty); focus returns to the trigger.
- **Use:** add keywords, add competitor, edit prompt text, invite member, property picker.
- **Not for:** analytics, charts, record tables or inspectors inside it; record detail (`Inspector`); confirmations (`ConfirmDialog`); a dialog opening another dialog (only the discard or destructive alert may stack).

### 3.30 ConfirmDialog
`ui/alert-dialog.tsx` · V1 · [16 §4.5](16-drawers-dialogs-popovers.md)

Purpose: confirms a destructive or irreversible action.

```ts
interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;                    // "Delete 12 keywords?"
  description: string;              // what is lost, when, and the reversible alternative
  confirmLabel: string;             // repeats verb and count: "Delete 12 keywords"
  cancelLabel: string;              // "Cancel"
  onConfirm: () => Promise<void> | void;   // resolves: the dialog closes; rejects: it stays open and the caller passes `error`
  error?: string | null;            // shown above the buttons as a FormAlert
  typedConfirmation?: { expected: string; label: Slot };  // project or workspace deletion only
  tone?: 'destructive' | 'neutral'; // 'neutral' for session expiry ("Stay signed in")
}
```

- **Variants:** `tone` 2 values; confirm uses `destructive-solid` ([09 §2.3](09-buttons-controls.md), tokens `--negative-button*`).
- **States:** idle, typed value not matching (confirm disabled), confirming (loading), error (inline banner).
- **A11y:** `role="alertdialog"`; initial focus on Cancel; Escape equals Cancel; no Close button; scrim click does nothing.
- **Use:** delete, disconnect, remove member; bulk operations over 100 rows (section 23, item 27); session expiry warning.
- **Not for:** reversible actions (archive, remove tag, mute: run at once with an undo toast).
- **Naming:** other docs say `AlertDialog` for the Base UI primitive; product code uses `ConfirmDialog` or `DiscardChangesDialog`.

### 3.31 TypeToConfirmField
`ui/alert-dialog.tsx` · V1 · [16 §4.5](16-drawers-dialogs-popovers.md)

Purpose: the typed-name field inside `ConfirmDialog` for irreversible project or workspace deletion.

```ts
interface TypeToConfirmFieldProps { expected: string; label: Slot; value: string; onValueChange: (value: string) => void }
```

- **Variants:** none; label "Type {expected} to confirm" with `expected` in `type-mono`. The caller passes the label as rich text from the catalog.
- **States:** empty, mismatch, match (case-sensitive, trimmed).
- **A11y:** labeled input; the label states what to type, and the confirm button stays disabled until it matches.
- **Use:** only project and workspace deletion, followed by re-authentication.
- **Not for:** any other deletion, including thousands of keywords (section 23, item 44).

### 3.32 DiscardChangesDialog
`ui/alert-dialog.tsx` · V1 · [10 §13.2](10-forms.md), [16 §4.3](16-drawers-dialogs-popovers.md)

Purpose: asks before unsaved edits are lost (dirty dialog, dirty inspector section, settings navigation).

```ts
interface DiscardChangesDialogProps {
  open: boolean;
  title: string;                    // "Discard unsaved changes?"
  description: string;              // "Your changes to Budgets will be lost."
  keepEditingLabel: string;         // "Keep editing"
  discardLabel: string;             // "Discard changes"
  onKeepEditing: () => void;        // also what Escape does
  onDiscard: () => void;
}
```

- **Variants:** none. Copy: title "Discard unsaved changes?", body "Your changes to {objectName} will be lost.", buttons "Keep editing" (secondary, initial focus) and "Discard changes" (`destructive-solid`) (section 23, item 8).
- **States / A11y:** as `ConfirmDialog`.
- **Use:** leaving any dirty form; stacks one level above a dialog.
- **Not for:** clean forms; the save bar "Discard" button (resets immediately without asking).

### 3.33 ReauthDialog
`app/shell/reauth-dialog.tsx` · V1 · [16 §4.4](16-drawers-dialogs-popovers.md)

Purpose: "Confirm it is you" (password or TOTP) on `403 fresh_session_required`, then one retry.

```ts
interface ReauthDialogProps {
  open: boolean;
  method: 'password' | 'totp';      // how to ask first
  onSubmit: (method: 'password' | 'totp', secret: string) =>
    Promise<'ok' | 'invalid' | 'second-factor-required'>;   // the feature performs the request; anything else rejects
  onCancel: () => void;
}
```

- **Variants:** none (400 px).
- **States:** idle, submitting, invalid (on the field, which is emptied), switched to the code (`second-factor-required`: the account has two-factor on, so the password alone is refused; a warning `FormAlert` says so), failed (a lock with its wait, or one plain sentence). Each opening starts clean.
- **A11y:** modal; `autocomplete="current-password"` or `"one-time-code"` with `inputMode="numeric"`; paste allowed.
- **Use:** only on that 403 code; may stack above the current dialog.
- **Not for:** sign-in screens.

### 3.34 ConflictDialog
`app/shell/conflict-dialog.tsx` · V1 · [16 §4.4](16-drawers-dialogs-popovers.md)

Purpose: `409 conflict` resolution showing the server version and the local version side by side.

```ts
interface ConflictDialogProps<TValue> {
  open: boolean;
  title: string;                    // "This prompt changed while you were editing"
  server: TValue; local: TValue;
  renderVersion: (value: TValue) => Slot;
  onReload: () => void;
  onOverwrite?: () => Promise<void>;    // only where allowed
}
```

- **Variants:** none (720 px). **States:** idle, overwriting. **A11y:** modal; initial focus on "Reload".
- **Use:** optimistic-concurrency failures on edits. **Not for:** validation errors (`FormAlert`).

### 3.35 StepperDialog
`ui/stepper-dialog.tsx` · V1 · [16 §4.6](16-drawers-dialogs-popovers.md)

Purpose: a multi-step 720 px dialog (keyword import: Upload, Map columns, Review, Confirm).

```ts
interface StepperDialogProps<TStep extends string> {
  steps: ReadonlyArray<{ id: TStep; label: string }>;
  current: TStep;
  completed: ReadonlySet<TStep>;
  onStepChange: (step: TStep) => void;     // only to completed steps
  onContinue: () => Promise<'ok' | 'invalid'>;   // validates the current step
  finalLabel: string;               // names the result: "Import 1,204 keywords"
  title: string;
  children: Slot;
}
```

- **Variants:** none.
- **States:** per step; closing after step 1 is a dirty close.
- **A11y:** stepper is an `<ol>`; current step `aria-current="step"`; completed steps are buttons with `CircleCheck`; focus moves to the first error on invalid Continue.
- **Use:** imports and first-party report uploads.
- **Not for:** onboarding (full-page wizard), single-screen forms.

### 3.36 Sheet (Drawer)
`ui/drawer.tsx` · V1 · [16 §2.6](16-drawers-dialogs-popovers.md), [19 §9](19-responsive-behavior.md)

Purpose: the Base UI Drawer primitive for edge-attached modal panels: mobile inspector sheet, navigation drawer, filter sheet, bottom sheets for popovers on phones.

```ts
interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: 'left' | 'right' | 'bottom';
  size: 'nav' | 'full' | 'bottom-85';     // min(280px, 100vw - 56px), 100vw x 100dvh, max-height 85dvh
  title: string;
  headerAction?: 'close' | 'back';        // mobile inspector uses 'back' ("Back to Rankings")
  footer?: Slot;                          // sticky; buttons 44 px when touch-primary
  children: Slot;
}
```

- **Variants:** `side` 3 values, `size` 3 values.
- **States:** closed, open (travels its full width in 200 ms, exits in 150 ms), swipe-dragging.
- **A11y:** modal; focus trapped; Escape and Back close; swipe always has a button alternative.
- **Use:** only below the widths in 19 §9 and for the navigation drawer below 1024 px.
- **Not for:** the docked or overlay inspector (a layout component, not a popup), desktop dialogs.

### 3.37 Drawer and SideDrawer
`ui/drawer.tsx` · `Drawer` V1 · [19 §3.1](19-responsive-behavior.md) · `SideDrawer` Later · [16 §8](16-drawers-dialogs-popovers.md)

`Drawer` is the navigation drawer below 1024 px: a modal panel from the left edge on Base UI `Drawer`, `min(280px, 100vw - 56px)` wide, `surface`, with a scrim.

```ts
interface DrawerProps { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: Slot }   // title names it and is not shown
```

- **States:** closed, open (200 ms in, 150 ms out, from the left), swiping. **A11y:** modal, everything outside inert; Escape, a click on the scrim and a swipe to the left close it; focus returns to the button that opened it.
- **Use:** the sidebar's contents on tablet and phone. **Not for:** record detail (`Inspector`), filters on phones (a bottom sheet).

`SideDrawer` is the right-hand variant described below.

Purpose: a 560 px modal right drawer above an open inspector for deep metric explanation.

```ts
interface SideDrawerProps { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: Slot }
```

- **Status note:** its only V1 use, the Statistics drawer, is replaced by the non-modal `StatisticsPanel` in the inspector region ([23 §8.6](23-application-patterns.md), [23 §17](23-application-patterns.md); section 23, item 29). Kept for a future need that must sit above the inspector.
- **A11y:** modal, focus trap, Escape and scrim click close.
- **Not for:** statistics (`StatisticsPanel`), record detail (`Inspector`).

### 3.38 Tabs
`ui/tabs.tsx` · V1 · [09 §12](09-buttons-controls.md)

Purpose: switches panels on one page. Page tabs and inspector tabs are 44 px underline tabs (`h-tab`); in-panel tabs (chart modes) are 32 px segmented (`sm`).

```ts
interface TabsProps<TValue extends string> {
  variant: 'underline' | 'segmented';
  label: string;                    // tablist name
  value: TValue;
  onValueChange: (value: TValue) => void;   // callers write ?tab= (page) or ?itab= (inspector)
  items: ReadonlyArray<{ value: TValue; label: string; count?: string; disabled?: boolean }>;   // count preformatted with formatCompact, underline only
  children: Slot;                   // one <TabsPanel value> per item
}
interface TabsPanelProps<TValue extends string> { value: TValue; children: Slot }
```

- **Variants:** `variant` 2 values. Underline: 44 px row, labels `type-body` 24 px apart (`gap-6`), 1 px `border` bottom across the row. Segmented: the `SegmentedControl` styling (section 3.5).
- **States:** selected (underline: `type-body-strong` in `primary-text` with a 2 px `primary` indicator that moves instantly; segmented: weight 400 unselected and 500 selected, with the width of the 500 label reserved, `primary-subtle` fill), hover, focus, disabled.
- **A11y:** APG tabs with automatic activation; the panel renders its skeleton immediately so arrow keys never wait on a fetch ([20 §5](20-accessibility.md); section 23, item 1); Home, End.
- **Use:** page tabs (at most 6, nouns of 1 to 2 words), inspector tabs (at most 5), chart modes in panels.
- **Not for:** tabs that change the route path (`TabNav`), view options (`SegmentedControl`), wizards (`StepperDialog`).

### 3.39 TabNav
`app/shell/tab-nav.tsx` · V1 · [09 §12](09-buttons-controls.md), [24 §7](24-page-templates.md)

Purpose: route tabs rendered as a `<nav>` of links with underline styling.

```ts
interface TabNavProps { label: string; items: ReadonlyArray<{ href: string; label: string; count?: string; current: boolean }> }
```

- **Variants:** none (identical to underline tabs).
- **States:** current (`aria-current="page"`), hover, focus.
- **A11y:** navigation landmark named by `label`; links; Tab and Enter.
- **Use:** Integrations sources, Discover tabs, SEO Keywords sub-routes.
- **Not for:** query-parameter tabs (`Tabs`).

### 3.40 Pagination
`ui/pagination.tsx` · V1 · [09 §13](09-buttons-controls.md), [12 §12](12-tables.md)

Purpose: cursor pagination controls for server-mode tables (above 10,000 rows) and admin lists.

```ts
interface PaginationProps {
  rangeText: string;                // "Showing 1 to 200 of 48,210 keywords" (formatInteger in the caller); never page numbers
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  pageSize: 100 | 200 | 500;
  onPageSizeChange: (size: 100 | 200 | 500) => void;
  announcement: string;             // "Rows 201 to 400 of 48,210"
}
```

- **Variants:** none; lives in the 48 px `TableFooter` (section 23, item 24). Range text on the left in `type-meta num`; Previous and Next are 32 px square buttons (`h-control-sm`) with a 1 px `border`, radius 6 and a chevron icon. The numbered page buttons of the reference screens (current page in `primary-subtle` with `primary-text`) are not used, because pagination is cursor-based ([12 §12](12-tables.md)).
- **States:** first page (previous disabled), last page, loading (skeleton rows after 300 ms).
- **A11y:** `<nav aria-label="Pagination">`; `IconButton` "Previous page" and "Next page"; polite announcement; focus stays on the pressed button.
- **Use:** server-mode `DataTable`, offset admin lists.
- **Not for:** client-mode tables up to 10,000 rows (virtualized, no pagination), "Load more" lists (`Button variant="subtle"`).

### 3.41 Progress
`ui/progress.tsx` · V1 · [17 §4.2](17-empty-loading-error-states.md), [21 §8.3](21-motion.md)

Purpose: a determinate 4 px bar for job progress.

```ts
interface ProgressProps {
  value: number;                    // done
  max: number;                      // total
  failed?: number;                  // negative-solid segment after the done part
  valueText: string;                // "412 of 1,000 checks, 3 failed"
  width?: 'fill' | '64';            // 64 px in meta lines
}
```

- **Variants:** none (track `surface-subtle`, fill `primary`, `rounded-sm`).
- **States:** in progress (value steps with a 200 ms `scaleX` transition), complete, failed.
- **A11y:** `role="progressbar"`, `aria-valuenow`, `aria-valuemax`, `aria-valuetext`; only start and finish are announced.
- **Use:** inside `CollectionProgress`, `SetupChecklist`.
- **Not for:** unknown duration (`Spinner` with text), budgets and shares (`Meter`); indeterminate bars do not exist.

### 3.42 Meter
`ui/meter.tsx` · V1 · [23 §11.2](23-application-patterns.md)

Purpose: a static measure of a share of a known extent (budget use).

```ts
interface MeterProps {
  value: number;                    // may exceed max; fill stops at the end
  max: number;
  thresholds?: ReadonlyArray<{ at: number; label: string }>;   // soft limit tick
  fillTone: 'muted' | 'warning';    // chosen by BudgetMeter, never by features
  valueText: string;                // "64% of $2,000.00"
  width: 64 | 160;
}
```

- **Variants:** none; 6 px, 1 px `border-strong` outline track, transparent inside.
- **States:** below threshold, above threshold, over 100%.
- **A11y:** `role="meter"` with `aria-valuetext`; the text value is always visible next to it.
- **Use:** through `BudgetMeter`.
- **Not for:** job progress (`Progress`), rates (text plus `ConfidenceIndicator`).

### 3.43 Toaster and toast()
`ui/toast.tsx` · V1 · [18 §3](18-notifications-alerts.md)

Purpose: confirms the result of the user's own action when the UI that started it is gone; offers Undo for reversible actions.

```ts
type ToastType = 'success' | 'info' | 'error' | 'progress';
interface ToastOptions {
  id?: string;                      // same id updates in place
  type: ToastType;
  title: string;                    // result first, past tense: "12 keywords archived"
  description?: string;             // at most 2 lines
  action?: { label: string; onAction: () => void };   // at most one, 2 words; using it closes the toast
}
declare function toast(options: ToastOptions): string;
declare function dismissToast(id?: string): void;      // one toast, or all of them
function ToastProvider(props: { children: Slot }): React.ReactElement;   // once, at the root
interface ToasterProps { label: string; closeLabel: string }             // "Notifications", "Close"; once, inside the provider
```

- **Variants:** none (360 px, `surface-elevated`, visible limit 3).
- **States:** success and info dismiss after 6 s; toasts with an action and error toasts persist until dismissed (section 23, item 25); timers pause on hover, focus and hidden document; progress updates by id.
- **A11y:** Base UI Toast region named "Notifications", reachable with F6; toasts never take focus; error assertive, others polite. The Close button is kept out of the accessibility tree until the pointer or focus is in the region (Base UI), so a screen reader does not hear "Close" after every toast; the action button is always exposed. Placement: bottom right at 360 px from 768 px up, across the bottom below; aligning to the main column while the inspector is docked arrives with the shell.
- **Use:** dialog submitted and closed, reversible bulk actions with Undo, background jobs the user started, 429 retry countdown.
- **Not for:** alert events, page conditions (`Banner`), validation or permission errors (inline), inline edits (visible in place), copy confirmation, warnings.

### 3.44 LiveIndicator
`ui/live-indicator.tsx` · V1 · [21 §8.4](21-motion.md)

Purpose: a 6 px pulsing dot with the word "Live" on screens that show a run in progress.

```ts
interface LiveIndicatorProps { running: boolean; paused: boolean }   // paused by the "Pause updates" toggle
```

- **Variants:** none. **States:** pulsing, static (reduced motion or paused), absent (not running).
- **A11y:** the word "Live" is the text; the dot is `aria-hidden`.
- **Use:** Operations run detail, at most one per screen. **Not for:** freshness (`FreshnessIndicator`).

### 3.45 CountTabs
`ui/count-tabs.tsx` · V1 · [23 §9.3](23-application-patterns.md), [18 §7](18-notifications-alerts.md), [visual-spec §5](reference/visual-spec.md)

Purpose: the visible form of the event-type filter owned by 18 §7: "All events" plus one toggle per event type present, each with its count. Several types can be on at once.

```ts
interface CountTabsProps<TValue extends string> {
  label: string;                    // toolbar name: "Event types"
  allLabel: string;                 // "All events"
  allCountText: string;             // preformatted by the caller (formatCompact)
  items: ReadonlyArray<{ value: TValue; label: string; countText: string; disabledReason?: string }>;   // only the types present
  value: readonly TValue[];         // empty: "All" is pressed
  onValueChange: (value: readonly TValue[]) => void;   // the caller mirrors it to the URL: ?events=rank,url
  size?: 'sm' | 'md';               // 32 or 36 px; md on full pages, sm in the inspector
}
```

- **Variants:** `size` 2 values. Separate bordered items (1 px `border`, `rounded-md`, `surface`), label `type-body`, count in a neutral `Badge` after the label. Pressed item: solid `primary` fill, `primary-foreground` label in weight 500, count badge on `primary-hover` with `primary-foreground` text.
- **States:** unpressed, hover (`surface-hover`), pressed, focus, disabled with reason. "All" is pressed when no type is selected; pressing a type unpresses "All"; unpressing the last type presses "All" again.
- **A11y:** `Toolbar` (`role="toolbar"`, named by `label`): one Tab stop, Left and Right move, Home and End; each item is a toggle button with `aria-pressed`; the accessible name includes the count ("Rank moves, 12").
- **Use:** event-type filters above `EventTimeline` on full pages and in the inspector, and above full event lists.
- **Not for:** switching panels (`Tabs`), a single-choice view option (`SegmentedControl`), page filters (`FilterBar`).

## 4. Form components

Layout, validation timing, error copy and server error mapping are in [10-forms.md](10-forms.md) §3, §18, §19 and §23. Every field control below is rendered inside `FormField` (react-hook-form) or, for inline and non-form uses, inside the Field parts directly.

### 4.1 Field parts (Field, FieldLabel, FieldDescription, Fieldset)
`ui/field.tsx` · V1 · [10 §2](10-forms.md)

Purpose: thin wrappers over Base UI `Field.Root`, `Field.Label`, `Field.Description` and `Fieldset` that apply the anatomy (label 6 px control 6 px helper).

```ts
interface FieldProps { invalid?: boolean; disabled?: boolean; width?: 'short' | 'date' | 'medium' | 'long' | 'full'; children: Slot }   // default width 'full'
interface FieldLabelProps { children: string; optional?: string; display?: 'visible' | 'visually-hidden' }   // optional: the marker text "(optional)" from the catalog, shown in type-meta
interface FieldDescriptionProps { children: Slot }                                              // not rendered while an error shows (the caller renders FieldError instead)
interface FieldsetProps { legend: string; children: Slot }
```

- **Variants:** `width` 5 values (`w-30`, `w-40`, `w-60`, `w-90`, `w-full`, full below 640 px).
- **States:** default, invalid, disabled.
- **A11y:** Base UI wires ids, `htmlFor`, `aria-describedby`, `aria-invalid`; the control carries `aria-required`; groups use `fieldset` and `legend`. `optional` is the text itself, not a boolean: a primitive cannot read the catalog, so `FormField` passes it.
- **Use:** every labeled control.
- **Not for:** filters (filter editors are not forms), read-only facts (`ReadOnlyField`).

### 4.2 FieldError
`ui/field.tsx` · V1 · [10 §2](10-forms.md), [17 §5.1](17-empty-loading-error-states.md)

Purpose: the error line under a control, in place of the helper text.

```ts
interface FieldErrorProps { message: string }   // says what to do and states the constraint (10 §19)
```

- **Variants:** none: `flex items-start gap-1 type-meta text-negative-text`, leading `CircleX` 12 px (section 23, item 17).
- **States:** rendered by `FormField` only when the user has changed the field or the form was submitted; it shows whenever it is rendered (`Field.Error match`).
- **A11y:** `Field.Error`, referenced by `aria-describedby`; read on refocus, not announced on blur.
- **Use:** every field-level validation and mapped server error.
- **Not for:** errors without a field (`FormAlert`), region load errors (`InlineError`).

### 4.3 FormField
`app/forms/form-field.tsx` · V1 · [10 §2](10-forms.md), [10 §22](10-forms.md)

Purpose: binds one react-hook-form field (`useController`) to the Field parts and a control.

```ts
import type { Control, FieldPath, FieldPathValue, FieldValues, RefCallBack } from 'react-hook-form';
interface FormFieldControl<TValue> {
  name: string; value: TValue; onChange: (value: TValue) => void; onBlur: () => void;
  ref: RefCallBack;                 // on the element that takes focus
  invalid: boolean; disabled: boolean;
  required: boolean;                // true unless `optional`; the control passes it as aria-required
  controlProps: { name; ref; onBlur; disabled; 'aria-required' };   // spread on the control: <Input {...field.controlProps} />
  label: string;                    // for a group control, which shows it as its legend
}
interface FormFieldProps<TValues extends FieldValues, TName extends FieldPath<TValues>> {
  control: Control<TValues>;
  name: TName;                      // equals the API body path (limit_usd)
  label: string;                    // at most 4 words, no colon
  optional?: boolean;               // adds "(optional)" from the catalog
  description?: string;
  width?: FieldProps['width'];
  labelDisplay?: 'visible' | 'visually-hidden';
  kind?: 'control' | 'group';       // 'group' for RadioGroup, SegmentedControl, a single Checkbox: no FieldLabel, the control shows the label
  render: (field: FormFieldControl<FieldPathValue<TValues, TName>>) => React.ReactElement;
}
```

- **Variants:** none.
- **States:** pristine, touched, invalid (shown from the first blur after a change, or from a submit), revalidating on change, submitting, server error (`type: 'server'`, shown at once, cleared on change). A reset starts the field over.
- **A11y:** as Field parts; every control takes the field's `ref` so `shouldFocusError` works, and a group control (`RadioGroup`, `SegmentedControl`) takes it as `focusRef`. With `kind="group"` the field renders no label: the control shows it (a legend, or the label of a single `Checkbox`).
- **Use:** every field of a react-hook-form form (dialogs and save-bar settings).
- **Not for:** switches (they save immediately and never belong to a form), filter editors, inline table cell editors (validate on submit only).

### 4.4 Input
`ui/input.tsx`, `ui/input-variants.ts` · V1 · [10 §4](10-forms.md)

Purpose: single-line text entry.

```ts
interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';        // 32, 36 (default), 40 px (auth and onboarding only)
  variant?: 'outline' | 'bare';     // 'bare' inside an InputGroup, which draws the border
  onValueChange?: (value: string) => void;   // from Base UI; react-hook-form's onChange takes it directly
}
```

- **Variants:** `size` 3 values, `variant` 2 values. `inputVariants` (in `ui/input-variants.ts`, no `'use client'`) is shared with the `Select` trigger.
- **States:** default (no hover change), focus (ring, border unchanged), invalid (`data-invalid:border-negative-solid`), disabled, read-only (use `ReadOnlyField`).
- **A11y:** labeled through Field; `autoComplete` per 10 §21 (`off` for keywords, domains, prompts); 16 px font in the mobile layout.
- **Use:** names, short identifiers, emails.
- **Not for:** URLs and domains (`UrlInput`, `DomainInput`), numbers (`NumberInput`), dates (`DateRangePicker`), search (`SearchInput`), secrets (`SecretInput`), passwords (`PasswordInput`).

### 4.5 InputGroup
`ui/input-group.tsx` · V1 · [10 §4](10-forms.md)

Purpose: draws one border around an input and its adornments (prefix, suffix, icon, 24 px buttons).

```ts
interface InputGroupProps {
  prefix?: string;                  // "$"; not part of the value
  suffix?: string;                  // "%", "days", "keywords"
  leadingIcon?: LucideIcon;
  trailing?: Slot;                  // IconButton size="icon-xs", 4 px from the edge
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactElement;     // <Input variant="bare" /> or a NumberField input
}
```

- **Variants:** `size` 3 values.
- **States:** focus ring while the input has focus (`has-[input:focus-visible]:focus-ring`; a focused trailing button shows its own ring), invalid and disabled read from the input inside (`has-data-invalid`, `has-data-disabled`).
- **A11y:** prefix and suffix text is `aria-hidden` (the label names the unit); trailing buttons have their own names.
- **Use:** units, clear and reveal buttons, date input with calendar button.
- **Not for:** composite values of two fields (two fields in a row).

### 4.6 Textarea
`ui/textarea.tsx` · V1 · [10 §5](10-forms.md)

Purpose: multi-line text (keyword paste, prompt text, notes); grows from 3 to 8 lines.

```ts
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  counter?: string | null;          // "612 of 700", shown from 80% of the limit; caller formats
  counterOver?: boolean;            // switches the counter to negative-text (content state, not style)
  submitOnModEnter?: boolean;       // Cmd or Ctrl plus Enter submits when this is the main field
}
```

- **Variants:** none.
- **States:** default, focus, invalid, disabled, over limit.
- **A11y:** Field wiring; the counter is part of the description.
- **Use:** multi-line input.
- **Not for:** single values (`Input`); truncating paste with `maxLength` (the limit is a validation error).

### 4.7 Select
`ui/select.tsx` · V1 · [10 §6.2](10-forms.md)

Purpose: choose one of 5 to 15 known options.

```ts
interface SelectProps<TValue extends string> {
  value: TValue | null;
  onValueChange: (value: TValue) => void;
  placeholder: string;              // "Select a workload"
  options: ReadonlyArray<{ value: TValue; label: string; description?: string; group?: string; disabled?: boolean }>;
  size?: 'sm' | 'md' | 'lg';
  name?: string; required?: boolean; disabled?: boolean;
}                                   // plus the attributes of the trigger button; the width is set on Field
```

- **Variants:** `size` 3 values.
- **States:** closed, open below the trigger (`alignItemWithTrigger={false}`, 4 px offset), highlighted, selected (`Check`), disabled, invalid; bottom sheet above 8 options on phones (arrives with the mobile layout).
- **A11y:** APG select-only combobox; Enter, Space, arrows open; type-ahead; Escape closes without change; trigger shows the chosen value. Consecutive options with the same `group` are listed under that name.
- **Use:** workload, language, engine, page size, column mapping.
- **Not for:** 2 to 4 options worth seeing (`SegmentedControl` or `RadioGroup`), more than 15 or server-loaded options (`Combobox`), commands (`Menu`); native `<select>` is not used.

### 4.8 Combobox
`ui/combobox.tsx` · V1 · [10 §6.3](10-forms.md)

Purpose: searchable single choice for more than 15 options or server-loaded sets (locations, domains).

```ts
interface ComboboxProps<TItem> {
  value: TItem | null;
  onValueChange: (value: TItem | null) => void;
  items: readonly TItem[];
  itemToString: (item: TItem) => string;
  itemKey: (item: TItem) => string;
  groupOf?: (item: TItem) => string;
  renderItem?: (item: TItem) => Slot;        // a richer row; the text stays the name of the option
  onQueryChange?: (query: string) => void;   // server mode: caller debounces 250 ms, min 2 characters, 50 results
  loading?: boolean;
  loadingText?: string;                      // "Searching"
  emptyText: (query: string) => string;      // "No locations match "berl""
  placeholder: string;
  clearLabel: string;                        // "Clear"
  openLabel: string;                         // "Show options"
  trigger?: React.ReactElement;              // a button opens the list and the search field sits inside the popup (a switcher)
  triggerLabel?: string;                     // required with `trigger`: "Project: fynix.digital" (a combobox is not named by its content)
  footer?: Slot;                             // under the list: "Create project"
  size?: 'sm' | 'md' | 'lg'; disabled?: boolean; name?: string; required?: boolean;
}
```

- **Variants:** `size` as `Input`; two forms chosen by `trigger`: a text field with the list below it (forms), or a button with the search inside the popup (`ProjectSwitcher`).
- **States:** empty, typing, searching (32 px status row "Searching" after 300 ms, previous results kept), results, no results, value set (Clear button), invalid; unmatched text cleared on blur.
- **A11y:** APG editable combobox; focus stays in the input with `aria-activedescendant`; arrows open and move, Enter chooses, Escape closes; the loading and empty rows are in a status region. Announcing the result count is the caller's (`announce()`), since a primitive cannot reach the announcer. `inputRef`, `id`, `onBlur` and `aria-required` reach the text field for forms.
- **Use:** location, domain, entity pickers.
- **Not for:** several values (`MultiSelect`), short known lists (`Select`).

### 4.9 MultiSelect
`ui/multi-select.tsx` · V1 · [10 §6.4](10-forms.md)

Purpose: several values from a list, or free values with suggestions (tags, aliases).

```ts
interface MultiSelectProps<TItem> {
  value: readonly TItem[];
  onValueChange: (value: readonly TItem[]) => void;
  items: readonly TItem[];
  itemToString: (item: TItem) => string;
  itemKey: (item: TItem) => string;
  presentation: 'chips' | 'summary';   // chips in forms; summary ("3 selected") at fixed control heights (32 or 36 px)
  creatable?: { label: (query: string) => string; onCreate: (query: string) => TItem };   // "Create "q4-launch""
  placeholder: string;
}
```

- **Variants:** none; `presentation` is structural.
- **States:** empty, with chips (wraps to 3 rows then scrolls), open (stays open after each pick), creatable row, invalid.
- **A11y:** combobox plus multi-select listbox; Backspace in an empty input removes the last chip; chip remove buttons "Remove {value}"; summary tooltip lists all values.
- **Use:** tags in Add keywords, aliases, competitor tracking scopes in forms.
- **Not for:** filters (`FilterEditor` enum multi), one value (`Combobox`).

### 4.10 Checkbox
`ui/checkbox.tsx` · V1 · [09 §8.1](09-buttons-controls.md)

Purpose: a boolean that takes effect on save, "I agree", or row selection.

```ts
interface CheckboxProps {
  checked: boolean | 'indeterminate';
  onCheckedChange?: (checked: boolean) => void;
  label: string;                    // the visible label, or the name in a table cell ("Select crm pricing")
  labelDisplay?: 'visible' | 'visually-hidden';
  description?: string;             // describes the box; not part of its name
  disabled?: boolean;
}                                   // plus the attributes and the ref of the box
```

- **Variants:** none (16 px box, `rounded-sm` (4 px), in a 24 px hit area; unchecked 1 px `border-strong`; checked solid `primary` with a white check).
- **States:** unchecked, checked, indeterminate (parents only), hover, focus (inset in cells), disabled, invalid.
- **A11y:** APG checkbox; `aria-checked` true, false or mixed; Space; clicking the label toggles.
- **Use:** booleans saved with a form, table selection, filter enum lists.
- **Not for:** immediate settings (`Switch`), one of several (`RadioGroup`).

### 4.11 CheckboxGroup
`ui/checkbox-group.tsx` · V1 · [10 §7](10-forms.md)

Purpose: zero or more independent choices under one legend, with an optional "Select all" parent above 5 options.

```ts
interface CheckboxGroupProps<TValue extends string> {
  legend: string;
  value: readonly TValue[];
  onValueChange: (value: readonly TValue[]) => void;
  options: ReadonlyArray<{ value: TValue; label: string; description?: string; disabledReason?: string }>;
  orientation?: 'vertical' | 'horizontal';   // horizontal only for 3 or fewer options of 2 words or less
}
```

- **Variants:** none.
- **States:** as Checkbox; group error under the whole group ("Select at least one").
- **A11y:** `fieldset` and `legend`.
- **Use:** Track (SEO rankings, AI visibility), zones, engines in forms.
- **Not for:** exactly one choice (`RadioGroup`).

### 4.12 Radio, RadioGroup, RadioCard
`ui/radio-group.tsx` · V1 · [09 §8.2](09-buttons-controls.md), [10 §7](10-forms.md)

Purpose: exactly one choice from 2 to 6 options; radio cards when each option needs a sentence of consequence (at most 4).

```ts
interface RadioGroupProps<TValue extends string> {
  legend: string;
  value: TValue | null;             // null only when "no choice" is valid in the schema
  onValueChange: (value: TValue) => void;
  options: ReadonlyArray<{ value: TValue; label: string; description?: string; disabled?: boolean }>;
  presentation?: 'list' | 'cards';
  disabled?: boolean;
  focusRef?: React.Ref<{ focus(): void }>;   // a form passes field.ref
}
```

- **Variants:** none; `presentation` is structural (radio: 16 px circle, the same size as the checkbox, 1 px `border-strong`, checked solid `primary` with a 6 px white dot, in a 24 px hit area; cards: `rounded-md border p-3`, checked `border-primary-border bg-surface-selected`).
- **States:** unchecked, checked, hover, focus (on the card via `has-focus-visible`), disabled, invalid.
- **A11y:** APG radio group named by the legend (`role="radiogroup"`); each radio is named by its label and described by its description; arrows move and select; Tab leaves.
- **Use:** action on hard budget limit, depth profile, filter enum single.
- **Not for:** short options users should see side by side in a row (`SegmentedControl semantics="radio"`), more than 6 options (`Select`).

### 4.13 Switch
`ui/switch.tsx` · V1 · [09 §8.3](09-buttons-controls.md)

Purpose: a setting that takes effect and is saved the moment it flips.

```ts
interface SwitchProps {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;   // starts the mutation; optimistic
  busy?: boolean;                   // after 400 ms pending: aria-busy, further toggles ignored
  disabled?: boolean;
}                                   // named by its SettingRow; on its own it needs aria-label
```

- **Variants:** none (36 x 20 px track, `primary` when on, white thumb, 24 px hit area).
- **States:** off, on, hover, focus, busy, disabled, failed (reverted, error line under the row).
- **A11y:** `role="switch"`, `aria-checked`; Space and Enter; failure announced politely by the caller.
- **Use:** notification preferences, "Pause collection", "Show favicons", inside `SettingRow`.
- **Not for:** any form with a save bar, filters, booleans saved with other fields (`Checkbox`) (section 23, item 41).

### 4.14 SettingRow
`ui/setting-row.tsx` · V1 · [09 §8.3](09-buttons-controls.md), [10 §8](10-forms.md)

Purpose: the row that hosts an immediate `Switch`: label and description left, switch right, error line below.

```ts
interface SettingRowProps { label: string; description?: string; control: React.ReactElement; error?: string | null }
```

- **Variants:** none. **States:** default, busy, error. **A11y:** the row is a Base UI `Field`, so the switch is labeled by `label` and described by `description` and by `error` when there is one, and a click on the label flips it.
- **Use:** sections that contain only immediate switches. **Not for:** save-bar forms (a section is either all switches or a form, never mixed).

### 4.15 Slider
`ui/slider.tsx` · V1 · [09 §8.4](09-buttons-controls.md)

Purpose: a threshold easier to judge visually than numerically (matrix rank and AI thresholds), always paired with a `NumberInput`.

```ts
interface SliderProps {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min: number; max: number; step: number;
  getAriaValueText: (value: number) => string;   // "Rank threshold 10", from @/lib/format in the caller
  pairedInputId: string;            // the NumberInput bound to the same value
}
```

- **Variants:** none. **States:** default, dragging, focus, disabled.
- **A11y:** APG slider; arrows, Page Up, Page Down (10 steps), Home, End; clicking the track sets a value (drag alternative, WCAG 2.5.7).
- **Use:** matrix threshold popover. **Not for:** any value that needs exactness without a paired input.

### 4.16 Calendar
`ui/calendar.tsx` · V1 · [10 §10.1](10-forms.md)

Purpose: the one styled react-day-picker 10 grid used by date pickers.

```ts
interface CalendarProps {
  mode: 'single' | 'range';
  selected: { from: BusinessDate | null; to: BusinessDate | null };
  onSelect: (value: { from: BusinessDate | null; to: BusinessDate | null }) => void;
  timeZone: string;                 // project timezone, set after mount
  months: 1 | 2;
  snapTo?: 'day' | 'iso-week';
  maxSpanDays?: number;             // 400 for daily data
  zoneNote: string;                 // "Dates in Europe/Berlin"
}
```

- **Variants:** none. **States:** day selected, range start and end (`bg-primary`), in range (`bg-primary-subtle`), today (`text-primary-text`), disabled future days (not focusable).
- **A11y:** grid; arrows by day, Page Up and Page Down by month, Shift plus Page keys by year, Home and End; Monday week start.
- **Use:** inside `DateRangePicker` and `DatePicker`. **Not for:** direct use in screens.

### 4.17 DatePicker
`ui/date-picker.tsx` · Later · [10 §10.3](10-forms.md)

Purpose: a single business date typed as `YYYY-MM-DD` with a calendar button.

```ts
interface DatePickerProps { value: BusinessDate | null; onValueChange: (value: BusinessDate | null) => void; timeZone: string; label: string }
```

- **Variants:** none (`w-40` InputGroup). **States:** empty, typed valid, typed invalid (error on blur), calendar open.
- **A11y:** labeled input; "Choose date" icon button; typed input is the primary path.
- **Status note:** no MVP screen takes a single date; date windows use `DateRangePicker`.
- **Not for:** windows (`DateRangePicker`).

### 4.18 DateRangePicker
`app/filters/date-range-picker.tsx` · V1 · [10 §10.2](10-forms.md)

Purpose: the project-wide date window scope control in the top bar ([11 §4](11-navigation.md)) and window fields in forms.

```ts
type WindowPreset = '7d' | '28d' | '90d' | '12w';
interface DateRangeValue { preset: WindowPreset | 'custom'; from: BusinessDate; to: BusinessDate }
interface DateRangePickerProps {
  value: DateRangeValue;
  onValueChange: (value: DateRangeValue) => void;   // callers write win, or from and to, through nuqs
  timeZone: string;
  granularity: 'day' | 'week';      // week snaps to Monday to Sunday
  size?: 'sm' | 'md';               // 32 or 36 px; md in the top bar: a 36 px secondary button with a leading Calendar icon and a chevron
}
```

- **Variants:** `size` 2 values.
- **States:** closed (label is the preset name or `formatDateRange` output), open with preset list and two months, custom editing (applies only on "Apply"), invalid typed dates, span limit message.
- **A11y:** trigger names its value; dialog-like popover; typed From and To inputs labeled "Start date" and "End date" first, grid second; focus moves to the selected preset, returns to the trigger.
- **Use:** the top-bar date range on every page where it applies (hidden on Settings, Integrations and the screens 13 §4 lists without it); first section of the filter sheet on phones.
- **Not for:** month scopes on Costs (`Select` of months).

### 4.19 NumberInput
`ui/number-field.tsx` · V1 · [10 §11](10-forms.md)

Purpose: numeric entry with units, validation by schema, no silent clamping.

```ts
interface NumberInputProps {
  value: number | undefined;        // undefined means "not set", never 0
  onValueChange: (value: number | undefined) => void;
  format: Intl.NumberFormatOptions; // from numberInputFormat(kind) in @/lib/format, supplied by the caller (section 23, item 54)
  locale: string;
  prefix?: string; suffix?: string;
  steppers?: { min: number; max: number };   // only for integers with a range of 20 or less
  label: string;
}
```

- **Variants:** none (`w-30`, `num`).
- **States:** empty, editing (grouping accepted), blurred (grouped display), out of range (error with the range), steppers disabled at bounds.
- **A11y:** Base UI NumberField (spinbutton); Up and Down step, Shift plus arrow by 10; wheel scrubbing off; range stated in helper text.
- **Use:** budgets, limits, replicates, percentages (typed as whole percent; the schema converts).
- **Not for:** identifiers that look numeric (`Input` with `type-mono`), thresholds users judge visually (add a `Slider` next to it).

### 4.20 UrlInput
`app/forms/url-input.tsx` · V1 · [10 §12](10-forms.md)

Purpose: a page URL (target URL) with a live normalization preview.

```ts
interface UrlInputProps {
  value: string;
  onValueChange: (value: string) => void;
  projectDomain: string;            // "Enter a URL on example.com, the project domain"
  normalize: (raw: string) => { ok: true; url: string } | { ok: false; code: 'spaces' | 'scheme' | 'host' | 'other_domain' };   // normalizeTrackedUrl from @contracts
}
```

- **Variants:** none (`w-90`, `type="text"`, `inputMode="url"`, `spellCheck={false}`, `autoComplete="off"`).
- **States:** empty, valid (helper replaced by "Will track: example.com/pricing" via `displayUrl`, debounced 150 ms), invalid after blur (messages from 10 §12), server 422 `url_not_allowed`.
- **A11y:** Field wiring; the preview is the description.
- **Use:** target URL fields, cited URL entry.
- **Not for:** hosts (`DomainInput`), search (`SearchInput`).

### 4.21 DomainInput
`app/forms/domain-input.tsx` · V1 · [10 §12](10-forms.md)

Purpose: a registrable host for competitors and projects; drops any path and says so.

```ts
interface DomainInputProps {
  value: string;
  onValueChange: (value: string) => void;
  normalize: (raw: string) => { ok: true; domain: string; ignoredPath: string | null } | { ok: false; code: 'spaces' | 'scheme' | 'host' | 'private' };   // normalizeDomain from @contracts
}
```

- **Variants, A11y:** as `UrlInput`. **States:** preview "Will track: hubspot.com (path /products/crm ignored)", invalid, duplicate (`409 duplicate`: "hubspot.com is already a competitor").
- **Use:** Add competitor, project domains, onboarding. **Not for:** page URLs (`UrlInput`).

### 4.22 SecretInput
`ui/secret-input.tsx` · Later · [10 §14](10-forms.md)

Purpose: entering a provider token; never pre-filled.

```ts
interface SecretInputProps {
  value: string;
  onValueChange: (value: string) => void;
  revealLabel: string;              // "Show token"
  saved?: { lastFour: string; addedLabel: string } | null;   // renders the "Token saved · ends in 4f2a · Added Sep 12, 2026" line and "Replace token"
  onVerify?: () => Promise<{ ok: boolean; message: string }>;
}
```

- **Variants:** none (`type-mono`, `w-full`). **States:** saved (read-only line), replacing (empty input), revealed, verifying, verified, error.
- **A11y:** reveal is a `ToggleButton` with `aria-pressed`; `autoComplete="off"`, `data-1p-ignore`, `data-lpignore`.
- **Status note:** first used by Cloudflare and other first-party integrations (phase 12).
- **Not for:** passwords of the user's own account (`Input type="password"` with `autocomplete`), showing a new key (`SecretReveal`).

### 4.23 SecretReveal
`ui/secret-reveal.tsx` · V1 · [10 §14](10-forms.md)

Purpose: shows a newly created secret once (API key) with a labeled Copy button and a warning.

```ts
interface SecretRevealProps { value: string; warning: string; copyLabel?: string }   // warning: "This key is shown once. Store it before closing."
```

- **Variants:** none (`type-mono`, `bg-surface-subtle`, `select-all`). **States:** shown, copied.
- **A11y:** read-only text plus `CopyButton form="labeled"`; the warning is a region `Banner` above it.
- **Use:** API key creation dialog. **Not for:** saved secrets (never sent to the browser).

### 4.24 FileDropzone
`ui/file-dropzone.tsx` · V1 · [10 §15.1](10-forms.md)

Purpose: CSV or TSV selection for imports; drag and drop is an enhancement of a real button.

```ts
interface FileDropzoneProps {
  accept: readonly string[];        // ['.csv', '.tsv', 'text/csv']
  constraints: string;              // "CSV or TSV, UTF-8, up to 50 MB and 10,000 rows" (caller formats)
  file: { name: string; sizeText: string; rowCountText: string | null } | null;
  onFile: (file: File) => void;
  onRemove: () => void;
  error?: string | null;
}
```

- **Variants:** none (96 px, dashed `border-strong`, `bg-surface-subtle`). **States:** empty, drag over (`border-primary-border bg-primary-subtle`, "Drop to upload"), selected (one-line row), error.
- **A11y:** the box is not focusable; "Choose file" is a real button opening a hidden file input; errors are field errors.
- **Use:** step 1 of imports, with a "Paste" tab alternative. **Not for:** images or attachments.

### 4.25 SearchInput (SearchField)
`ui/search-input.tsx` · V1 · [10 §17](10-forms.md), [13 §6](13-filters-search.md)

Purpose: page and table search. `SearchField` in 13 §6 is the same component (section 23, item 18).

```ts
interface SearchInputProps {
  value: string;
  onValueChange: (value: string) => void;   // caller debounces 250 ms and writes q
  placeholder: string;              // "Search keywords"
  size?: 'sm' | 'md';               // sm w-60 in table toolbars, md w-90 on pages
  shortcutHint?: 'slash' | 'none';
  landmark?: 'search' | 'none';     // page-level search sits in a <search> element
}
```

- **Variants:** `size` 2 values.
- **States:** empty (Kbd "/" when not focused), focused, with value (24 px Clear button), searching (no spinner inside the field).
- **A11y:** `type="search"` with the WebKit cancel button hidden; labeled (visually hidden label in toolbars); Escape clears, then blurs; `/` focuses it on table pages when focus is not in an input.
- **Use:** table toolbar search, discovery inboxes, picker lists.
- **Not for:** global search (`CommandPalette`), structured filters (`FilterBar`).

### 4.26 SaveBar
`ui/save-bar.tsx` · V1 · [10 §13.2](10-forms.md), [24 §6](24-page-templates.md)

Purpose: sticky bottom bar of a dirty settings form: change count, optional estimate delta, Discard and Save changes.

```ts
interface SaveBarProps {
  visible: boolean;                 // formState.isDirty
  summary: string;                  // "2 unsaved changes" or "2 errors" (caller formats)
  estimate?: string | null;         // "+$42.10 per month, estimate"
  saving?: boolean;
  onDiscard: () => void;            // resets immediately, no confirmation
  discardLabel: string;             // "Discard"
  saveLabel: string;                // "Save changes"; the button is the submit button of the form
  form?: string;                    // the id of the form, when the bar is rendered outside it
}
```

- **Variants:** none (56 px `min-h-save-bar`, token `--size-save-bar`, taller only when the summary wraps; `bg-surface border-t`, contents aligned to the 640 px form column).
- **States:** hidden, visible, saving (primary loading after 400 ms; Discard disabled), failed (stays; focus to first error or summary), saved (hidden; polite "Changes saved"; no toast).
- **A11y:** the form reserves the bar's height (`pb-save-bar`) and the scroll container sets `scroll-padding-bottom` to `var(--size-save-bar)` (56 px) ([10-forms.md](10-forms.md) §13.2); buttons "Discard" (ghost) and "Save changes" (primary, `type="submit"`); a group named by its summary; when it leaves with focus on one of its buttons, focus moves to the first field of the form.
- **Use:** settings and integration configuration forms. **Not for:** dialogs (footer holds actions), sections with switches.

### 4.27 ErrorSummary
`ui/error-summary.tsx` · V1 · [10 §18](10-forms.md)

Purpose: lists every error of a long form at its top after a failed submit and takes focus.

```ts
interface ErrorSummaryProps { errors: ReadonlyArray<{ fieldId: string; label: string; message: string }>; title: string; headingRef?: React.Ref<HTMLHeadingElement> }   // "Fix 2 fields to save"; the form focuses the heading
```

- **Variants:** none (negative banner surface, `CircleX` 16 px). **States:** hidden, shown, shrinking as errors are fixed.
- **A11y:** heading with `tabIndex={-1}` receives focus; not a live region; each error is one link (label in `type-body-strong`, then the message) that focuses its field. `fieldId` is the id of what takes focus: the input, the `Select` trigger, the first OTP cell. A group control has no single element to focus, so its link scrolls to the group.
- **Use:** forms with more than 6 fields or more than one section. **Not for:** short forms (focus moves to the first invalid field).

### 4.28 FormAlert
`ui/form-alert.tsx` · V1 · [10 §23](10-forms.md)

Purpose: a form-level error that has no field (quota, permission, limit), shown above the footer or save bar.

```ts
interface FormAlertProps { message: string; tone?: 'negative' | 'warning' | 'positive'; live?: boolean }   // names the limit and the way out
```

- **Variants:** `tone` 3 values (region `Banner` styling). `positive` reports the outcome of the step before, such as "Your password was changed" on the sign-in page. **States:** hidden, shown.
- **A11y:** `role="alert"` for `negative` and `role="status"` for `warning` and `positive`: it appears after a submit or a redirect, so it is announced. An alert that takes focus when it appears passes `live={false}` and has no role: focus has it read, and a live region would read it twice ([10-forms.md](10-forms.md) section 18).
- **Use:** `422 quota_exceeded`, `competitor_limit`, `budget_exceeded`. **Not for:** field errors (`FieldError`), conflicts (`ConflictDialog`).

### 4.29 ReadOnlyField
`ui/read-only-field.tsx` · V1 · [10 §20](10-forms.md)

Purpose: a fact shown for reference and not editable here (keyword text after creation, workspace id, sync time).

```ts
interface ReadOnlyFieldProps { label: string; value: string; font?: 'sans' | 'mono'; reason?: string }   // inside <ReadOnlyList>, the dl; copyValue arrives with CopyButton
```

- **Variants:** none (`dt` `type-label`, `dd` `type-body` on `bg-surface-subtle rounded-md px-3 min-h-control`). **States:** plain, with copy.
- **A11y:** description list; not a tab stop unless it has a copy button.
- **Use:** immutable identity, settings for users without write permission (instead of disabled controls). **Not for:** values that become editable later in the same form (disabled control with reason).

### 4.30 PasswordInput
`ui/password-input.tsx` · V1 · [10 §21](10-forms.md)

Purpose: a password of the user's own account, with a button that shows it.

```ts
interface PasswordInputProps extends Omit<InputProps, 'type' | 'variant' | 'autoComplete'> {
  autoComplete: 'current-password' | 'new-password';   // required
  showLabel: string;                // "Show password"
  hideLabel: string;                // "Hide password"
}
```

- **Variants:** `size` as `Input`. **States:** hidden, shown, invalid, disabled (input and button together).
- **A11y:** the button is named by what it will do and has no pressed state; paste and password managers work (WCAG 3.3.8); a shown password is not spell-checked or capitalized; `ref` goes to the input.
- **Use:** sign in, sign up, reset and change password, the re-authentication dialog. **Not for:** provider tokens (`SecretInput`).

### 4.31 OtpField
`ui/otp-field.tsx` · V1 · [10 §21](10-forms.md)

Purpose: a one-time code, one digit per cell.

```ts
interface OtpFieldProps {
  value?: string; onValueChange?: (value: string) => void; onValueComplete?: (value: string) => void;
  length?: number;                  // default 6
  inputRef?: React.Ref<HTMLInputElement>;   // the first cell, for focus after a failed submit
  digitLabel?: (position: number, length: number) => string;   // "Digit 2 of 6", for cells after the first
  disabled?: boolean;
}
```

- **Variants:** none (40 px cells, `gap-2`, tabular figures; digits at 16 px below 768 px). **States:** empty, filling, complete, invalid, disabled.
- **A11y:** Base UI `OTPField`: a group named by the `FieldLabel`; the first cell carries that name and every other cell its position from `digitLabel`; `autocomplete="one-time-code"` and the numeric keyboard; a pasted code fills every cell; digits only.
- **Use:** the code step of sign-in, the re-authentication dialog. **Not for:** recovery codes (a plain `Input` in `type-mono`).

## 5. Shell and navigation

Shell components are Server Components where they only lay out, and client components where they hold menus or shortcuts ([26-implementation-guidelines.md](26-implementation-guidelines.md) §6). They receive identity, permissions and flags as props from the layout; they never fetch.

### 5.1 AppShell
`app/shell/app-shell.tsx` · V1 · [05 §2](05-layout-grid.md)

Purpose: the viewport frame: sidebar, top bar, main column and inspector slot, with the scroll model and landmarks.

```ts
interface AppShellProps {
  sidebar: Slot;
  topBar: Slot;
  inspector?: Slot;                 // Inspector (docked or overlay); the sheet is portaled
  scrollModel: 'document' | 'table';   // table pages: the table body is the scroll container
  children: Slot;                   // page header plus content
}
```

- **Variants:** none. **States:** sidebar expanded, collapsed rail, drawer; inspector closed, docked, overlay, sheet (docking rule in 16 §2.6).
- **A11y:** `SkipLink` first; `header` (top bar), `nav` "Primary", `main`, `aside` (inspector); `--sticky-stack-height` drives `scroll-padding-top`; F6 region cycling; the page never scrolls horizontally.
- **Use:** every authenticated route. **Not for:** auth and onboarding layouts (their own centered layout with `h-control-lg`).

### 5.2 SkipLink
`app/shell/skip-link.tsx` · V1 · [20 §4.5](20-accessibility.md)

Purpose: first focusable element; "Skip to main content", plus "Skip to results" on table pages.

```ts
interface SkipLinkProps { targets: ReadonlyArray<{ label: 'Skip to main content' | 'Skip to results'; targetId: string }> }
```

- **Variants:** none. **States:** visually hidden until focused, then top-left over the top bar on `surface-elevated`.
- **A11y:** links; main content target is the page `h1` (`tabIndex={-1}`); results target is the grid's last focused cell.
- **Use:** in `AppShell` only. **Not for:** in-page anchors.

### 5.3 Sidebar (SidebarGroup, SidebarItem)
`app/shell/sidebar.tsx` · V1 · [11 §1 to §3](11-navigation.md), [19 §3.1](19-responsive-behavior.md)

Purpose: primary navigation: 15 items in 3 sections (11 §1), project switcher at the top, collapse toggle at the bottom. Below 1024 px it renders inside a left `Sheet` (navigation drawer).

```ts
interface SidebarProps {
  mode: 'expanded' | 'rail' | 'drawer';   // 208 px (`w-sidebar`), 56 px, 280 px sheet
  onToggle: () => void;             // persisted in a cookie; shortcut "["
  projectSwitcher: Slot;
  groups: ReadonlyArray<SidebarGroupProps>;
}
interface SidebarGroupProps { label: string | null; items: ReadonlyArray<SidebarItemProps> }   // label is text, not a link
interface SidebarItemProps {
  href: string;
  label: string;
  icon: LucideIcon;                 // 07 §6 assignments
  current: boolean;
  count?: string | null;            // actionable counts only, "99+" max; preformatted
  shortcut?: readonly string[];
}
```

- **Variants:** none; `mode` is structural. `sidebar` background with a 1 px `border` right edge. Items 32 px (`h-sidebar-item`), 4 px apart, 8 px inset, `rounded-md`, 18 px icons (`size-icon-md`), 12 px icon-to-label gap, label `type-body` in `foreground-secondary`. Group labels `type-label` (12 px tertiary), 16 px above and 4 px below; groups are separated by 16 px of space, with no divider lines. Footer: collection status in `type-label`, 16 px from the bottom.
- **States:** item default, hover, current (`surface-selected` fill, label `type-body-strong` in `primary-text`, icon in `primary-text`, `aria-current="page"`), focus; rail items are 32 px squares with tooltips; rail counts become a 6 px `primary` dot with the count in the name.
- **A11y:** `nav` "Primary"; links; collapsed items keep their names; the drawer is modal and returns focus to the menu button.
- **Use:** the shell. **Not for:** sub-pages (page tabs), settings sections (`SettingsNav`), nested trees (one level only).

### 5.4 TopBar
`app/shell/top-bar.tsx` · V1 · [11 §4](11-navigation.md), [19 §3.2](19-responsive-behavior.md)

Purpose: 52 px bar (`h-topbar`, `surface` background, 1 px `border-subtle` bottom hairline) with the breadcrumb on the left and, on the right: command palette trigger, the project-wide date range and location scope controls, notifications, theme, help and user menu. Right-side controls are 36 px and 12 px apart; the avatar is 32 px.

```ts
interface TopBarProps {
  breadcrumb: Slot;                 // Breadcrumb with WorkspaceMenu and ProjectSwitcher
  onOpenCommandPalette: () => void;
  dateRange: Slot | null;           // DateRangePicker (md); null on pages where it does not apply (Settings, Integrations, 13 §4)
  location: Slot | null;            // ScopeControl with the MapPin icon; null where location does not apply (13 §4)
  notifications: Slot;              // NotificationBell
  help: Slot;                       // HelpMenu, immediately left of the user menu at every width
  theme: Slot;                      // ThemeSwitch at 1440 px and up; ThemeMenu items in UserMenu below
  user: Slot;                       // UserMenu
  onOpenNavigation?: () => void;    // menu button below 1024 px
}
```

- **Variants:** none. Order on the right: search, date range, location, notifications, theme, help, user menu. **States:** search field 36 px tall (16 px search icon, placeholder in `foreground-tertiary`, "⌘K" `Kbd` hint box at the right), 440 px wide at 1680 and up, 360 px at 1440 to 1679, 240 px at 1280 to 1439, icon button below 1280; date range and location as 36 px `secondary` buttons with a leading 16 px icon (`Calendar`, `MapPin`), the value as label and a trailing chevron; location becomes an icon button below 1024; both move into the filter sheet below 768 and are not rendered where they do not apply. Collapse order: [19 §3.2](19-responsive-behavior.md) (section 23, item 38).
- **A11y:** `header` landmark; switchers and scope controls are buttons whose names include the current value ("Date range: Last 28 days", "Location: United States"); the search trigger shows `⌘K`.
- **Use:** every shell page. **Not for:** page titles or actions (`PageHeader`).

### 5.5 Breadcrumb
`app/shell/breadcrumb.tsx` · V1 · [11 §4](11-navigation.md)

Purpose: the project root, Workspace, Project and the current page in the top bar; the workspace and project segments are menus.

```ts
interface BreadcrumbProps {
  projectRootHref: string;          // the leading House icon links to the project Overview
  workspace: Slot | null;           // WorkspaceMenu; null below 1680 px, when it moves into the project menu
  project: Slot;                    // ProjectSwitcher (presentation "topbar")
  page: { label: string };
}
```

- **Variants:** none. A leading `House` icon (16 px, `foreground-tertiary`) for the project root, named "Project overview"; `ChevronRight` separators (14 px, `foreground-muted`); ancestors in `type-body` `foreground-tertiary` (hover `foreground`); the current page in `type-body-strong` (500) `foreground`. **States:** full at 1680 px and up; without the workspace item below 1680 px; only the project switcher below 1024 px; ancestors truncate with an ellipsis before the current page.
- **A11y:** `nav` "Breadcrumb" with an `ol`; the `House` link has the accessible name "Project overview"; separators `aria-hidden`; last item `aria-current="page"`.
- **Use:** top bar only. **Not for:** back links on detail pages (`DetailPageHeader`).

### 5.6 ProjectSwitcher
`app/shell/project-switcher.tsx` · V1 · [11 §8](11-navigation.md)

Purpose: switch project with search, recent first, "Create project" at the bottom; shows the project timezone.

```ts
interface ProjectSwitcherProps {
  current: { id: string; name: string; timeZone: string };
  projects: ReadonlyArray<{ id: string; name: string; workspaceName: string; recent: boolean }>;
  onSelect: (projectId: string) => void;   // keeps destination, resets project-specific filters
  canCreate: boolean;
  onCreate: () => void;
  presentation: 'sidebar' | 'rail' | 'topbar';
}
```

- **Variants:** none. Sidebar presentation, 12 px from the top of the sidebar: 28 px square monogram with radius 6 (`foreground` fill with a `foreground-inverse` letter in the light theme, `primary` fill in the dark theme), name in `type-subsection-title` (14/20, 600; the screens show about 15 px, within tolerance, [visual-spec §6](reference/visual-spec.md)), chevron. **States:** closed, open, searching, no results.
- **A11y:** menu button whose name includes the current project; searchable list is a combobox.
- **Use:** sidebar top (rail: the 28 px monogram alone), top bar below 1024 px. **Not for:** workspace switching (`WorkspaceMenu`).

### 5.7 WorkspaceMenu
`app/shell/workspace-menu.tsx` · V1 · [11 §4](11-navigation.md)

Purpose: breadcrumb menu: switch workspace, Costs, Operations, Members, Workspace settings.

```ts
interface WorkspaceMenuProps {
  current: { id: string; name: string };
  workspaces: ReadonlyArray<{ id: string; name: string }>;
  links: ReadonlyArray<{ id: 'costs' | 'operations' | 'members' | 'settings'; href: string; allowed: boolean }>;
  onSelect: (workspaceId: string) => void;
}
```

- **Variants, States, A11y:** as `Menu`; links the user cannot use are absent. **Use:** top bar breadcrumb. **Not for:** project navigation.

### 5.8 UserMenu
`app/shell/user-menu.tsx` · V1 · [11 §4](11-navigation.md), [20 §14](20-accessibility.md)

Purpose: avatar menu: name and email, theme (below 1440 px), "Account settings" (Settings > Profile), sign out. Personal preferences live in Settings > Preferences ([11 §5](11-navigation.md)).

```ts
interface UserMenuProps {
  user: { name: string; email: string; avatarUrl: string | null };
  singleKeyShortcuts: boolean; onSingleKeyShortcutsChange: (on: boolean) => void;
  defaultDensity: Density; onDefaultDensityChange: (density: Density) => void;
  motion: 'system' | 'reduced'; onMotionChange: (motion: 'system' | 'reduced') => void;
  theme?: Slot;                     // ThemeMenu items when the top bar is narrow
  onOpenShortcuts: () => void;
  onSignOut: () => void;
}
```

- **Variants:** none. **States:** as `Menu` with checkbox and radio items.
- **A11y:** trigger named "Account menu, {name}"; settings are `menuitemcheckbox` and `menuitemradio`.
- **Use:** top bar. **Not for:** workspace settings.

### 5.9 ThemeSwitch and ThemeMenu
`app/shell/theme-switch.tsx`, `app/shell/theme-menu.tsx` · V1 · [11 §4](11-navigation.md), [19 §3.2](19-responsive-behavior.md), [01 §3](01-foundations.md), [21 §5.1](21-motion.md)

Purpose: the theme choice (section 23, item 39). `ThemeSwitch` is the top-bar control at 1440 px and up; `ThemeMenu` renders the System, Light, Dark radio items inside `UserMenu` below 1440 px. Only one of them is visible at any width.

```ts
interface ThemeSwitchProps { resolvedTheme: 'light' | 'dark'; onToggle: (next: 'light' | 'dark', origin: { x: number; y: number }) => void }
interface ThemeMenuProps { value: 'system' | 'light' | 'dark'; onValueChange: (value: 'system' | 'light' | 'dark') => void }
```

- **ThemeSwitch:** 52 by 28 px pill, 22 px knob with `shadow-switch-knob`, 3 px inset, 1 px `inset-ring` in `border`. Light: `--theme-switch-day` track, `Sun` glyph (14 px, `--theme-switch-sun`) on the right. Dark: `--theme-switch-night` track, filled `Moon` glyph (`--theme-switch-moon`) on the left. The knob slides and the glyphs cross-fade over `--duration-slow`. Clicking sets an explicit Light or Dark (leaving System) and runs the circular reveal from the switch centre ([21 §5.1](21-motion.md)).
- **ThemeMenu:** radio items; the checked item shows the check glyph.
- **A11y:** `ThemeSwitch` is `role="switch"` named "Dark theme" with `aria-checked` true in dark; the glyphs are decorative. Glyph contrast on the track is at least 3:1 (tested in `tokens.contrast.test.ts`). `ThemeMenu` items are `menuitemradio`. **Not for:** per-chart theming (charts follow the theme).

### 5.10 HelpMenu
`app/shell/help-menu.tsx` · V1 · [20 §15](20-accessibility.md)

Purpose: consistent help in the same position on every page: Methodology, Keyboard shortcuts, Documentation, Contact support.

```ts
interface HelpMenuProps { methodologyHref: string; docsHref: string; supportHref: string; onOpenShortcuts: () => void }
```

- **Variants:** none. **States:** as `Menu`. **A11y:** `CircleHelp` icon button named "Help" (07 §6).
- **Use:** top bar, immediately left of the user menu. **Not for:** metric definitions (`MetricInfo`).

### 5.11 PageHeader
`app/shell/page-header.tsx` · V1 · [23 §3](23-application-patterns.md)

Purpose: title block, meta line, saved view menu, actions, local tabs and filter bar slot, within the 180 px data budget.

```ts
interface PageHeaderProps {
  title: string;                    // h1, never truncates, wraps to 2 lines at most
  viewMenu?: Slot;                  // SavedViewMenu, only on T2, T6, Matrix, Competitors
  meta?: Slot;                      // FreshnessIndicator first, then one scope fact; at most two middle dots
  primaryAction?: Slot;             // at most one
  secondaryActions?: Slot;          // at most two visible
  moreActions?: readonly MenuItemDef[];   // includes "Copy link"; destructive items below a separator
  tabs?: Slot;                      // Tabs variant="underline" or TabNav
  filterBar?: Slot;
  sticky: 'stack' | 'scroll';       // stack on T2 and T6; scroll on T1, T3, T4, T5
}
```

- **Variants:** none. Title `type-page-title` (24/32, 600); meta line `type-meta` 4 px below; the header starts 20 px below the top bar inside the 20 px page gutter; actions are 36 px buttons, right-aligned and vertically centered on the title block; no bottom border (page blocks are 16 px apart).
- **States:** default; below 1024 px secondary actions collapse into More; below 768 px the filter bar becomes the Filters button.
- **A11y:** one `h1` per page (`tabIndex={-1}` for route focus); "More actions" menu button.
- **Use:** every page. **Not for:** KPI values (`MetricStrip`), help paragraphs, a second filter row, detail pages (`DetailPageHeader`).

### 5.12 DetailPageHeader
`app/shell/detail-page-header.tsx` · V1 · [16 §3](16-drawers-dialogs-popovers.md), [24 §5](24-page-templates.md)

Purpose: `PageHeader` for a full-page object: back link, object name as `h1`, object facts in the meta line. Formerly called "ObjectHeader" and "PageHeader object mode" in 24 (section 23, item 48).

```ts
interface DetailPageHeaderProps extends Omit<PageHeaderProps, 'title' | 'viewMenu' | 'sticky'> {
  back: { label: string; href: string };   // "← Rankings"; href restored from sessionStorage per tab
  objectName: string;               // keyword text, prompt in typographic quotes, URL path
  objectFacts: Slot;                // "United States · Desktop · depth 20"
  lang?: string;                    // prompt language
  archived?: boolean;               // shows Archived badge; actions reduce to Restore
}
```

- **Variants:** none. **States:** normal, archived, not found (page renders `EmptyState` instead).
- **A11y:** back link is a `TextLink`; `h1` wraps to 2 lines.
- **Use:** Keyword Detail, Prompt Detail, Page Intelligence, Panel detail, Run detail, entity and alert rule editors. **Not for:** list pages (`PageHeader`).

### 5.13 SettingsNav
`app/shell/settings-nav.tsx` · V1 · [24 §6](24-page-templates.md), [11 §5](11-navigation.md)

Purpose: 200 px local navigation for project and workspace settings.

```ts
interface SettingsNavProps { groups: ReadonlyArray<{ label: 'Your account' | 'Project settings' | 'Workspace settings'; items: ReadonlyArray<{ href: string; label: string; current: boolean }> }> }
```

- **Variants:** none (32 px items, sidebar styling). **States:** current, hover, focus; below 1024 px becomes a `Select` above the form.
- **A11y:** `nav` "Settings"; `aria-current="page"`. **Use:** T4 pages. **Not for:** page tabs.

### 5.14 CommandPalette
`app/shell/command-palette.tsx` · V1 · [16 §7](16-drawers-dialogs-popovers.md)

Purpose: global navigation, entity search and actions (Base UI Autocomplete inline inside a Dialog).

```ts
type PaletteGroup = 'recent' | 'pages' | 'keywords' | 'prompts' | 'domains' | 'projects' | 'actions';
interface PaletteItem { id: string; group: PaletteGroup; label: string; context: string; icon: LucideIcon; shortcut?: readonly string[]; hasFullPage: boolean }
interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;   // feature debounces server groups 150 ms, min 2 characters
  scope: PaletteGroup | null;       // set by prefixes kw:, pr:, dom:, proj:, go:, >
  onScopeChange: (scope: PaletteGroup | null) => void;
  groups: ReadonlyArray<{ group: PaletteGroup; items: readonly PaletteItem[]; loading: boolean; searchAllLabel?: string }>;
  onSelect: (item: PaletteItem, intent: 'default' | 'full-page' | 'new-tab') => void;
}
```

- **Variants:** none (640 px, max 480 px; full-screen sheet below 640 px).
- **States:** empty query (Recent, Pages, Actions), results (5 per group, then "Search all ..."), group loading (14 px spinner in its heading, previous results kept), no results with scope hint.
- **A11y:** dialog titled "Command palette" (visually hidden); combobox input with `aria-activedescendant`; groups `role="group"`; result count announced after 500 ms; focus returns on close.
- **Use:** Cmd or Ctrl plus K anywhere, the top bar trigger. **Not for:** table search (`SearchInput`), filters.

### 5.15 KeyboardShortcutsDialog
`app/shell/keyboard-shortcuts-dialog.tsx` · V1 · [11 §7](11-navigation.md), [20 §14](20-accessibility.md)

Purpose: lists every shortcut by scope, opened with `?`.

```ts
interface KeyboardShortcutsDialogProps { open: boolean; onOpenChange: (open: boolean) => void; singleKeyEnabled: boolean; sections: ReadonlyArray<{ title: string; rows: ReadonlyArray<{ keys: readonly string[]; action: string }> }> }
```

- **Variants:** none (`Dialog size="md"`, read-only, one "Close" button). **States:** single-key rows marked off when the switch is off.
- **A11y:** `SimpleTable` per section; `Kbd` with readable labels. **Use:** `?`, Help menu, user menu. **Not for:** onboarding tips.

### 5.16 NotificationBell
`app/shell/notification-bell.tsx` · V1 · [18 §5.1](18-notifications-alerts.md)

Purpose: top bar entry to the notification center with the unread badge.

```ts
interface NotificationBellProps { unread: number; unreadText: string; hasCritical: boolean; open: boolean; onOpenChange: (open: boolean) => void }   // unreadText "12" or "99+"
```

- **Variants:** none (32 px, `Bell` 18 px). **States:** no unread (badge hidden), unread (`primary` badge), critical unread (`negative-solid` badge).
- **A11y:** name "Notifications, 12 unread"; count changes are not announced. **Use:** top bar. **Not for:** toasts or banners.

### 5.17 NotificationCenter
`app/shell/notification-center.tsx` · V1 · [18 §5.2](18-notifications-alerts.md)

Purpose: 380 px popover (full-screen sheet below 768 px) listing alert events and system notices for the workspace.

```ts
interface NotificationCenterProps {
  tab: 'all' | 'unread';
  onTabChange: (tab: 'all' | 'unread') => void;
  days: ReadonlyArray<{ label: string; items: ReadonlyArray<NotificationItemProps | NotificationGroupProps> }>;
  onMarkAllRead: () => void;        // scope of the current tab
  onLoadMore: () => void;           // 30 at a time
  settingsHref: string;
  allEventsHref: string;
}
```

- **Variants:** none (the documented popover width exception).
- **States:** loading, list, empty per tab (inline `EmptyState`), loading more.
- **A11y:** labeled popover; list uses roving focus (Up, Down, Enter, Shift+F10); Escape returns to the bell; opening marks nothing read.
- **Use:** the bell. **Not for:** the full history (Alerts events screen).

### 5.18 NotificationItem
`app/shell/notification-item.tsx` · V1 · [18 §5.3](18-notifications-alerts.md)

Purpose: one three-line notification row.

```ts
interface NotificationItemProps {
  id: string;
  severity: Severity;
  title: string;                    // catalogue phrase, 18 §9
  entity: { label: string; href: string; lang?: string };
  values?: string;                  // "#4 → #11"
  context: string;                  // "Acme CRM · US desktop"
  occurredAt: IsoInstant;
  timeText: string;                 // "2h ago" or "Sep 21"
  read: boolean;
  actions: ReadonlyArray<RecordAction<string>>;   // Mark as read or unread, Open, Open rule, Acknowledge, Mute 7 days
  onOpen: () => void;
}
```

- **Variants:** none. **States:** unread (6 px `primary` dot, title `type-body-strong`), read, hover (`surface-hover`), focus (inset ring).
- **A11y:** one accessible name in the order title, entity, values, project, time, prefixed "Unread." when unread. **Use:** notification center. **Not for:** the Alerts screen (`AlertEventsTable`).

### 5.19 NotificationGroup
`app/shell/notification-item.tsx` · V1 · [18 §5.4](18-notifications-alerts.md)

Purpose: collapses 3 or more events of the same rule, kind, project and day.

```ts
interface NotificationGroupProps extends Omit<NotificationItemProps, 'entity' | 'values'> {
  count: number; countText: string;         // "12 keywords"
  firstEntities: readonly string[];         // first two labels, then "+10"
  expanded: boolean; onExpandedChange: (expanded: boolean) => void;
  members: readonly NotificationItemProps[];   // first 5 when expanded, then "View all 12"
}
```

- **Variants:** none. **States:** collapsed, expanded; unread while any member is unread. **A11y:** 24 px disclosure button with `aria-expanded`.
- **Use / Not for:** as `NotificationItem`.

### 5.20 DesktopOnlyNotice
`app/shell/desktop-only-notice.tsx` · V1 · [19 §11](19-responsive-behavior.md)

Purpose: explains that a feature is not offered on a touch-primary phone and offers "Copy link".

```ts
interface DesktopOnlyNoticeProps { feature: string; presentation: 'sheet' | 'page'; onClose?: () => void }   // "Open on desktop for keyword import."
```

- **Variants:** none. **States:** shown, link copied ("Link copied" announced).
- **A11y:** section with a heading naming the feature. **Use:** only for the features in 19 §11, only when mobile layout and touch-primary both hold. **Not for:** hiding features on narrow fine-pointer windows.

### 5.20 Layout customization components
`features/layouts/*` · V1 · [23 §18](23-application-patterns.md), [layout customization spec](../superpowers/specs/2026-09-30-layout-customization-design.md)

Purpose: let a person choose the cards and headline numbers of a screen. The rules (catalog, sanitizing, resolution, row packing, draft edits) are pure functions in `lib/layouts` (destined for `packages/contracts`), covered by unit tests; these components are only the interface.

```ts
interface LayoutProviderProps { screen: ScreenKey; children: ReactNode }   // effective layout, mode, draft and actions for one screen
interface LayoutGridProps { zone: 'cards' }                                 // renders CardFrame per card, in either mode
interface CardFrameProps { item: CardItem; mode: 'view' | 'customize'; children: ReactNode }
interface NumberStripProps { zone: 'numbers' }                              // MetricStrip fed from the layout
interface CardCatalogDialogProps { open: boolean; onOpenChange: (open: boolean) => void; insertAt?: number }
interface CardOptionsPopoverProps { item: CardItem }                        // radio groups generated from the card type's OptionDefinition
interface LayoutSaveBarProps { canManageTeamDefault: boolean }
interface CustomizeButtonProps { presentation: 'button' | 'menu-item' }
```

- **Card components** receive `{ options, width, mode }` and the page scope from context. They know nothing about layouts; an existing panel becomes a card by being registered in `features/layouts/registry.tsx`.
- **States:** view, customize, customize with a picked-up card, saving (Save loading after 400 ms), save failed (the bar reads "Could not save. Try again."), layout failed to load (built-in default shown, Customize disabled, region `Banner` with Retry), conflict (`412`: dialog "This layout was changed somewhere else." with "Keep mine" and "Load the other version").
- **A11y:** `CardFrame` toolbar is `role="toolbar"`; the handle is a toggle button with the pick-up keys of [20 §7](20-accessibility.md); card content is `inert` in customize mode; one polite live region for changes.
- **Drag:** `@dnd-kit/core` and `@dnd-kit/sortable`, imported only by `LayoutGrid` and `NumberStrip`.
- **Not for:** table columns (`ColumnChooser`), saved table views (`SavedViewMenu`), the sidebar.

### 5.21 AuthCard
`app/shell/auth-card.tsx` · V1 · [24 §11](24-page-templates.md)

Purpose: the one panel of an auth screen (T7): the product name above it, a heading, one sentence, the form or a confirmation, and up to two links below it.

```ts
interface AuthCardProps extends ComponentProps<'section'> {
  productName: string;     // shown above the panel, not a link
  title: string;           // the h1 of the page
  description: ReactNode;  // one sentence, at most two lines
  links?: ReactNode;       // at most two standalone TextLinks, below the panel
  children: ReactNode;     // the form, or the confirmation that replaces it
}
```

- **Variants:** none (400 px; below 640 px the border, fill and padding go and the panel fills the width).
- **States:** the form's own (idle, submitting, failed); confirmation replaces `children`.
- **A11y:** the page's only `h1`; the panel is a `section` named by the heading; `main` is the page layout's.
- **Use:** every T7 screen. **Not for:** dialogs, settings forms, empty states.

## 6. Filters and search

One filter system: `FilterBar` in the page header ([13-filters-search.md](13-filters-search.md) §1). State lives in the URL through `lib/filters/parsers.ts`.

### 6.1 FilterBar
`app/filters/filter-bar.tsx` · V1 · [13 §2](13-filters-search.md), [19 §4](19-responsive-behavior.md)

Purpose: screen scope controls, active filter chips, "+ Filter" and "Clear all" in one row that wraps. The project-wide date range and location are not part of it: they are in the `TopBar` (section 5.4, [13 §1](13-filters-search.md)).

```ts
interface FilterBarProps {
  scopes: Slot;                     // CompareSelect, ScopeControl (device, engine, or month on Costs); never the date range or location
  chips: Slot;                      // FilterChip list
  onAddFilter: () => void;
  onClearAll: () => void;           // removes chips, keeps scopes; hidden with no chips
  resultCount?: string | null;      // "412 keywords" on T1; T2 shows it in the table toolbar (section 23, item 63)
  notice?: string | null;           // "1 filter does not apply here"
  activeCount: number;              // badge on the "Filters" button below 768 px
  onOpenSheet: () => void;
}
```

- **Variants:** none. **States:** no chips, chips wrapping (sticky stack height updates), narrow (768 to 1023 px: everything behind "Filters"), mobile (sheet, which also holds the date range and location).
- **A11y:** `role="group"` named "Filters" (20 §4.6 over 13 §8; section 23, item 66); Tab moves through chip buttons in DOM order; result count announced politely 500 ms after the last filter change, once results arrive ([20-accessibility.md](20-accessibility.md) §10.2); after a chip is removed focus moves to the next chip or "+ Filter".
- **Use:** every analytical screen. **Not for:** forms above tables, table-specific filter panels, filter sidebars.

### 6.2 ScopeControl
`app/filters/scope-control.tsx` · V1 · [13 §2](13-filters-search.md)

Purpose: always-visible, non-removable scope triggers with defaults: Device on SEO screens, Engine on AI screens and Month on Costs in the filter bar; Location in the top bar.

```ts
interface ScopeControlProps<TValue extends string> {
  label: string;                    // "Device", "Location"
  value: TValue | readonly TValue[];
  display: string;                  // "Desktop", "Engines 3", "United States"
  options: ReadonlyArray<{ value: TValue; label: string }> | { search: (query: string) => Promise<ReadonlyArray<{ value: TValue; label: string }>> };   // search: async list (locations)
  selection: 'single' | 'multiple';
  icon?: LucideIcon | null;         // leading 16 px icon; MapPin for the top-bar location
  onValueChange: (value: TValue | readonly TValue[]) => void;
}
```

- **Variants:** none (36 px secondary trigger with a 16 px `ChevronDown`, and a leading 16 px icon when `icon` is set; the location trigger is at most 180 px, [11 §4](11-navigation.md)). **States:** default value, changed value; the location trigger becomes an icon button below 1024 px ([19 §3.2](19-responsive-behavior.md)).
- **A11y:** trigger name includes the value ("Device: Desktop"). **Use:** scopes only. **Not for:** removable filters (`FilterChip`).

### 6.3 CompareSelect
`app/filters/compare-select.tsx` · V1 · [13 §2](13-filters-search.md), [23 §6.4](23-application-patterns.md)

Purpose: comparison period scope: None, Previous period (default), Same period last year, Custom.

```ts
type CompareMode = 'none' | 'previous' | 'last_year' | 'custom';
interface CompareSelectProps { value: CompareMode; custom?: { from: BusinessDate; to: BusinessDate }; onValueChange: (mode: CompareMode, custom?: { from: BusinessDate; to: BusinessDate }) => void }
```

- **Variants, States, A11y:** as `ScopeControl`; writes `cmp`. **Use:** every screen with deltas. **Not for:** screens without comparisons (Discover).

### 6.4 FilterChip
`app/filters/filter-chip.tsx` · V1 · [13 §2](13-filters-search.md)

Purpose: one active filter: "Field: **Value**", reopens its editor, removable.

```ts
interface FilterChipProps {
  field: string;                    // "Topic"
  valueText: string;                // "CRM", "Commercial, Transactional", "3 selected", "1,000 to 10,000"
  tooltip?: string;                 // full value; "Includes 6 subtopics"
  differsFromView?: boolean;        // 6 px primary dot when a saved view is active (data state)
  readOnly?: boolean;               // filtered-empty state shows chips without remove buttons
  onEdit: () => void;
  onRemove: () => void;
}
```

- **Variants:** none (36 px, `rounded-md` (6 px), `neutral-subtle` fill, no border; label `type-body` ("Tag: crm") with the value in weight 500; 14 px `X` remove icon; truncates at 240 px) (section 23, item 19).
- **States:** default, hover, focus, editor open, read-only.
- **A11y:** two buttons: "Topic: CRM. Edit filter" and "Remove filter Topic: CRM" (24 px target); Delete or Backspace on a focused remove button removes the filter; Tab moves between chips (section 23, item 66).
- **Use:** every non-scope filter. **Not for:** table search (visible in its own field), scopes.

### 6.5 AddFilterButton (FieldPicker)
`app/filters/add-filter-button.tsx` · V1 · [13 §2](13-filters-search.md)

Purpose: "+ Filter" opens a searchable field picker grouped by domain, then that field's editor.

```ts
interface AddFilterButtonProps { fields: ReadonlyArray<{ id: string; label: string; group: string }>; onPick: (fieldId: string) => void }
```

- **Variants:** none (36 px ghost). **States:** closed, picker open, searching.
- **A11y:** menu button; picker is a combobox list; shortcut `f` (single-key policy). **Use:** filter bar. **Not for:** scopes.

### 6.6 FilterEditor
`app/filters/filter-editor.tsx` · V1 · [13 §3](13-filters-search.md)

Purpose: the popover editor for one filter field; its form is fixed by the field type.

```ts
type FilterField =
  | { type: 'enum'; selection: 'single' | 'multiple'; options: ReadonlyArray<{ value: string; label: string; count?: string }> }
  | { type: 'entity'; search: (query: string) => void; options: ReadonlyArray<{ value: string; label: string; recent: boolean }> }
  | { type: 'tree'; nodes: ReadonlyArray<{ value: string; label: string; parent: string | null }> }
  | { type: 'range'; min?: number; max?: number; presets: ReadonlyArray<{ label: string; min: number | null; max: number | null }> }
  | { type: 'rankBucket'; buckets: ReadonlyArray<{ id: RankBucket | 'not_ranking'; label: string; count?: string }> }
  | { type: 'boolean'; labels: { any: string; yes: string; no: string } }
  | { type: 'text'; operators: ReadonlyArray<'contains' | 'starts_with' | 'equals' | 'not_contains'> }
  | { type: 'location' };
interface FilterEditorProps { field: FilterField; label: string; value: unknown; onApply: (value: unknown) => void }
```

- **Variants:** none (popover 280 to 360 px, max 400 px tall).
- **States:** single-choice editors apply immediately; multi-choice apply with the footer "Apply" button or Enter, and Escape or a click outside discards (13 §3); facet counts when cheap; searching (after 300 ms).
- **A11y:** popover with dialog semantics; multi-select lists are listboxes (Space toggles, Shift+arrow extends); Escape keeps the applied state and returns focus to the chip.
- **Use:** behind every chip and "+ Filter". **Not for:** forms. `value` is typed per field by the parser registry in `lib/filters/parsers.ts`, which narrows `unknown`.

### 6.7 FilterSheet
`app/filters/filter-sheet.tsx` · V1 · [19 §4.2](19-responsive-behavior.md)

Purpose: full-height bottom sheet below 768 px with staged filter changes.

```ts
interface FilterSheetProps { open: boolean; onOpenChange: (open: boolean) => void; staged: Slot; applyLabel: string; applyBusy: boolean; onApply: () => void; onClearAll: () => void }   // applyLabel "Show 412 keywords"
```

- **Variants:** none (44 px rows, nested views with back buttons). **States:** clean, staged, counting (`aria-busy`, previous number kept).
- **A11y:** modal sheet; closing discards staged changes without confirmation. **Use:** mobile layout. **Not for:** desktop.

## 7. Data: tables

[12-tables.md](12-tables.md) is the specification; [20-accessibility.md](20-accessibility.md) §6 is binding on its keyboard and ARIA behavior; [19-responsive-behavior.md](19-responsive-behavior.md) §6 owns column priorities.

### 7.1 DataTable
`app/data-table/data-table.tsx` · V1 · [12](12-tables.md), [20 §6](20-accessibility.md), [ADR-DS-005](adr/ADR-DS-005-tanstack-table.md)

Purpose: the one table for record lists: sorting, selection, pinning, resizing, reordering, grouping, virtualization, client and server modes, grid keyboard model.

```ts
type SortKey = string;              // '-volume', 'rank'
interface ServerModeProps<TRow> {
  rows: readonly TRow[];
  total: number | null;             // null: unknown, aria-rowcount -1
  rangeText: string;                // "Showing 1 to 200 of 48,210 keywords"
  hasPrevious: boolean; hasNext: boolean;
  onPrevious: () => void; onNext: () => void;
  pageSize: 100 | 200 | 500; onPageSizeChange: (size: 100 | 200 | 500) => void;
}
interface DataTableProps<TRow> {
  id: string;                       // persistence and saved-view key
  caption: string;                  // grid name ("Keywords")
  itemNoun: { one: string; other: string };
  columns: ReadonlyArray<ColumnDef<TRow>>;   // built with col.*
  getRowId: (row: TRow) => string;
  data?: readonly TRow[];           // client mode, up to 10,000 rows
  server?: ServerModeProps<TRow>;   // above 10,000 rows
  loadProgress?: { loaded: number; total: number } | null;   // background 200-row pages
  sort: readonly SortKey[]; onSortChange: (sort: readonly SortKey[]) => void;   // max 2 keys
  defaultSort: readonly SortKey[];
  density: Density; onDensityChange: (density: Density) => void;
  search: string; onSearchChange: (q: string) => void; searchPlaceholder: string;
  grouping?: { options: ReadonlyArray<{ id: string; label: string }>; value: string | null; onChange: (id: string | null) => void };
  selection?: { selectedIds: ReadonlySet<string>; onChange: (ids: ReadonlySet<string>) => void; matchingTotal: number | null; allMatching: boolean; onSelectAllMatching: () => void };
  bulkActions?: ReadonlyArray<RecordAction<TRow>>;
  rowActions?: ReadonlyArray<RecordAction<TRow>>;
  onRowOpen?: (row: TRow, intent: 'inspector' | 'new-tab') => void;
  activeRowId?: string | null;      // open in the inspector
  newRowIds?: ReadonlySet<string>;  // New badge plus one-time highlight (max 50)
  newResultsAvailable?: boolean; onRefresh?: () => void;
  status: 'loading' | 'ready' | 'refetching' | 'error' | 'empty' | 'filtered-empty';
  error?: { message: string; errorId: string; partial: string | null } | null; onRetry?: () => void;
  emptyState: Slot; filteredEmptyState: Slot;
  toolbarExtras?: Slot;             // MetricSwitcher, status SegmentedControl, grouping menu
  savedViews?: Slot;                // SavedViewMenu lives in the page header; this only wires state
}
```

- **Variants:** `density` (Compact 32 px `h-row-compact`, the default since 2026-10-29; Default 40 px `h-row`). No other visual variants. The table sits inside a panel (1 px `border`, radius 8). Header row 40 px (`h-row-header`) on `surface-subtle`, labels `type-table-header` (12 / 16 px, capitals, 0.04em, tertiary, weight 400), 1 px `border-subtle` vertical dividers between header cells only; body rows `type-table` (12/16) with `border-subtle` horizontal dividers only; every column, numbers included, left aligned with `num`, except the row-actions column, which is right aligned; URLs in the mono family at the table size, truncated with an ellipsis.
- **States:** loading (real header, 12 skeleton rows), ready, refetching (previous rows at full opacity, `aria-busy`, `RefetchBar` under the header, "Updating" after 400 ms), partial load ("Loading 1,200 of 4,812 rows", client sort and export disabled with that reason), empty, filtered empty (header stays), error (`TableErrorRow`), row hover, selected (`surface-selected`, key text in `primary-text`), active (inset 2 px `primary` edge), focused cell, group rows, expanded children, new rows, below 768 px the `DataTableList`.
- **A11y:** native table with explicit roles, `role="grid"` (`treegrid` when grouped); one roving tab stop; keyboard map 20 §6.3 (Enter opens, Space selects, Shift+Space ranges, Ctrl or Cmd+A, Shift+F10 row menu, Enter or F2 widget mode, Escape never clears selection); `aria-rowcount` includes header rows, `aria-rowindex` on every rendered row, focused row always rendered; `aria-sort` on the primary sort `th`; sort summary text for multi-sort; identity cell is `th role="rowheader"`; hint paragraph describes keys.
- **Use:** any list users compare, sort, filter or act on in bulk; more than 6 records of one type.
- **Not for:** read-only key-value lists or tables under 50 rows without selection and with at most one link per row (`SimpleTable`), card grids of records (never).

### 7.2 DataTableToolbar
`app/data-table/toolbar.tsx` · V1 · [12 §1](12-tables.md)

Purpose: 48 px bar above the header (the panel title row height; 32 px `h-control-sm` controls, 8 px vertical padding): table search, row count, grouping, density, columns, export; replaced by `BulkActionBar` on selection.

```ts
interface DataTableToolbarProps { search: Slot; countText: string; sortSummary?: string | null; extras?: Slot; density: Slot; columns: Slot; exportMenu: Slot; updating: boolean }
```

- **Variants:** none. **States:** idle, updating (spinner plus "Updating" after 400 ms), new results available (`NewResultsNotice` in this slot).
- **A11y:** search outside the `Toolbar`; view controls inside a `Toolbar` named "{Caption} table actions". **Use:** every `DataTable`. **Not for:** page filters (`FilterBar`), the saved view menu (page header).

### 7.3 BulkActionBar
`app/data-table/bulk-action-bar.tsx` · V1 · [12 §14](12-tables.md), [20 §6.6](20-accessibility.md)

Purpose: replaces the toolbar in place when rows are selected.

```ts
interface BulkActionBarProps<TRow> {
  selectedCount: number; selectedText: string;          // "12 selected"
  matching?: { total: number; text: string; allSelected: boolean; onSelectAll: () => void };   // "Select all 4,812 matching"
  hiddenSelectedText?: string | null;                   // "3 selected rows are hidden by filters"
  actions: ReadonlyArray<RecordAction<TRow>>;           // non-destructive first, destructive last and separated
  onClear: () => void;
}
```

- **Variants:** none (48 px, as the toolbar it replaces). **States:** some selected, all loaded selected (offers matching), all matching selected ("All 4,812 selected. Clear selection"), running action.
- **A11y:** `role="group"` named "Bulk actions, 12 selected"; normal Tab order; selection changes announced debounced 250 ms; destructive bulk actions confirm with the exact count; any bulk operation over 100 rows confirms (section 23, item 27). Maximum scope 10,000 records.
- **Use:** tables with selection. **Not for:** single-row actions (`RowMenu`), floating bars over rows.

### 7.4 ColumnChooser
`app/data-table/column-chooser.tsx` · V1 · [12 §10](12-tables.md), [19 §6.4](19-responsive-behavior.md)

Purpose: popover to show, hide and reorder columns, grouped by domain, with "Reset to default".

```ts
interface ColumnChooserProps {
  groups: ReadonlyArray<{ label: string; columns: ReadonlyArray<{ id: string; label: string; visible: boolean; locked: boolean; hiddenByWidth: boolean }> }>;
  onToggle: (id: string, visible: boolean) => void;
  onShowAnyway: (id: string) => void;       // pins visible at every width
  onMove: (id: string, direction: 'up' | 'down') => void;
  onReset: () => void;
}
```

- **Variants:** none. **States:** default, "Hidden at this width" (description plus "Show anyway"), identity column locked; not offered on touch-primary phones.
- **A11y:** checkbox list; Move up and Move down buttons on each row (visible on hover and focus); Alt+Up and Alt+Down; moves announced ("Volume moved to position 4 of 9").
- **Use:** table toolbar `Columns3` icon button. **Not for:** filtering rows.

### 7.5 ColumnHeaderMenu
`app/data-table/column-header-menu.tsx` · V1 · [12 §10](12-tables.md), [20 §7](20-accessibility.md)

Purpose: per-column options, and the non-drag alternative for resize and reorder.

```ts
interface ColumnHeaderMenuProps {
  column: { id: string; label: string; sortable: boolean; filterFieldId: string | null; pinned: boolean; widthPx: number; minPx: number; maxPx: number };
  onSort: (direction: 'asc' | 'desc' | null) => void;
  onFilter?: () => void;            // adds a chip to the page FilterBar
  onMove: (to: 'left' | 'right' | 'start' | 'end') => void;
  onPin: (pinned: boolean) => void;
  onResize: (widthPx: number | 'fit' | 'reset') => void;   // popover number input, step 8
  onHide: () => void;
}
```

- **Variants:** none. **States:** as `Menu`. **A11y:** opens with Alt+Down on a header or the chevron button "Keyword column options"; resize handle is `role="separator"` for pointers and relies on this menu.
- **Use:** every table header. **Not for:** a second filtering system (it only adds chips).

### 7.6 DensityToggle
`app/data-table/density-toggle.tsx` · V1 · [04 §3](04-spacing-density.md)

Purpose: Compact (32 px rows, the default) or Comfortable (40 px rows), persisted per table in the saved view state (`density`: `default` or `compact`, default `compact`, left out of the URL). Labels "Compact (default)" and "Comfortable".

```ts
interface DensityToggleProps { value: Density; onValueChange: (density: Density) => void }
```

- **Variants:** none (`SegmentedControl size="sm" semantics="view"` with icons and labels). **States:** as SegmentedControl.
- **A11y:** radiogroup named "Density". **Use:** table toolbar. **Not for:** changing font size (density changes row height only).

### 7.7 SavedViewMenu
`app/data-table/saved-view-menu.tsx` · V1 · [12 §11](12-tables.md), [23 §14](23-application-patterns.md)

Purpose: "View: Top 10 losses (edited)" menu next to the page title: workspace views, personal views, Save, Save as new, Rename, Delete, Reset.

```ts
interface SavedViewMenuProps {
  current: { id: string | null; name: string; edited: boolean };
  views: ReadonlyArray<{ id: string; name: string; scope: 'workspace' | 'personal' }>;
  canSaveWorkspace: boolean;
  onApply: (id: string | null) => void;
  onSave: () => void; onSaveAs: (name: string, includeDateWindow: boolean) => void;
  onRename: (id: string, name: string) => void; onDelete: (id: string) => void;
  missingReferencesText?: string | null;   // "1 filter no longer exists"
}
```

- **Variants:** none (32 px secondary `sm`). **States:** default view, named view, edited, missing references.
- **A11y:** menu button with the view name in its name; applying announces "View CRM keywords applied, 3 filters". **Use:** T2, T6, Matrix, Competitors. **Not for:** Overview, detail pages, settings, the table toolbar.

### 7.8 TableFooter
`app/data-table/table-footer.tsx` · V1 · [12 §1](12-tables.md), [24 §4](24-page-templates.md)

Purpose: 48 px sticky footer (32 px controls, 8 px vertical padding): visible count and freshness; `Pagination` in server mode.

```ts
interface TableFooterProps { countText: string; freshness?: Slot; pagination?: Slot }   // "1,000 keywords · Updated 12m ago"
```

- **Variants:** none. **States:** client mode, server mode. **A11y:** plain text; pagination is its own nav. **Use:** every `DataTable`. **Not for:** totals rows (group header rows carry aggregates).

### 7.9 NewResultsNotice
`app/data-table/new-results-notice.tsx` · V1 · [20 §10.4](20-accessibility.md), [23 §12.1](23-application-patterns.md)

Purpose: "New results available. Refresh" in the toolbar slot, so rows never change under the reader.

```ts
interface NewResultsNoticeProps { onRefresh: () => void }
```

- **Variants:** none. **States:** shown until refresh, filter change or navigation. **A11y:** announced once politely; "Refresh" is a `link` button.
- **Use:** tables and pages whose data changed after a run completed. **Not for:** auto-refreshing rows.

### 7.10 DataTableList
`app/data-table/data-table-list.tsx` · V1 · [19 §6.7](19-responsive-behavior.md), [20 §6.8](20-accessibility.md)

Purpose: the mobile rendering of a `DataTable`: virtualized two-line link rows.

```ts
interface DataTableListProps<TRow> {
  rows: readonly TRow[]; getRowId: (row: TRow) => string; label: string;   // "Keywords, 412 results"
  line1: (row: TRow) => { identity: string; value: Slot };
  line2: (row: TRow) => { context: string; delta: Slot };
  onOpen: (row: TRow) => void;      // full-screen inspector sheet
  sortButton: Slot;                 // "Sort: Rank" opens a sort sheet
  tableSwitch?: Slot;               // "List / Table" when the device is not touch-primary
}
```

- **Variants:** none (56 px rows). **States:** as DataTable minus selection and row actions.
- **A11y:** `ul` with `aria-setsize` and `aria-posinset`; each row one link read as identity, value with label, context, delta. **Use:** below 768 px. **Not for:** desktop.

### 7.11 SimpleTable
`app/data-table/simple-table.tsx` · V1 · [12 §15](12-tables.md), [20 §6.1](20-accessibility.md)

Purpose: read-only small tables: inspector lists, chart data tables, import previews under 50 rows, methodology tables.

```ts
interface SimpleTableProps<TRow> {
  caption: string;                  // visible or visually hidden
  columns: ReadonlyArray<{ id: string; header: string; align: 'left' | 'right'; cell: (row: TRow) => Slot; rowHeader?: true }>;
  rows: readonly TRow[];
  getRowId: (row: TRow) => string;
  maxRows?: number;                 // inspector cap, then "View all N"
  viewAll?: { label: string; href: string };
}
```

- **Variants:** none (32 px rows and header, `h-row-compact`, always; `type-table` (12 / 16 px); header labels `type-table-header` (12 px, capitals, tertiary) on `surface-subtle`; every column left aligned; in a ranked mini table the own row is `surface-selected` with its text in `primary-text`). **States:** rows, empty (one sentence row), scrolls horizontally inside panels when wide.
- **A11y:** native `table`, `th scope="col"` and `scope="row"`; no roving focus; inner links are Tab stops. **Use:** fewer than 50 rows, no selection, at most one link per row. **Not for:** anything sortable, selectable or large (`DataTable`).

### 7.12 KeyValueTable
`app/data-table/key-value-table.tsx` · V1 · [19 §12.3](19-responsive-behavior.md), [20 §6.1](20-accessibility.md)

Purpose: label and value pairs (inspector facts, `FactsFooter`), label column 40%.

```ts
interface KeyValueTableProps { caption: string; rows: ReadonlyArray<{ label: string; value: Slot }>; form?: 'table' | 'dl' }   // 'dl' allowed under 8 items
```

- **Variants:** none (32 px rows, `h-row-compact`, always). **States:** container query: stacked below `@xs`, two columns above.
- **A11y:** `th scope="row"` plus `td` ("Search volume, 2,400"); caption names the group. **Use:** facts about one record. **Not for:** lists of records.

### 7.13 Column helpers (`col.*`)
`app/data-table/columns.ts` · V1 · [12 §5](12-tables.md), [12 §19](12-tables.md)

Purpose: typed column factories that apply width, alignment, default sort direction, cell component and priority, so screens never set them by hand.

```ts
type Accessor<TRow, TValue> = (row: TRow) => TValue;
interface ColumnOptions { header?: string; headerTooltip?: string; metricKey?: MetricKey; priority?: 1 | 2 | 3 | 4 }   // widths, alignment and sort come from the type, never from options
declare const col: {
  select<TRow>(): ColumnDef<TRow>;                                                          // 40 px, center
  keyword<TRow>(acc: Accessor<TRow, KeywordCellProps>, o?: ColumnOptions): ColumnDef<TRow>; // 280 / 200 / 480, flex, pinned
  prompt<TRow>(acc: Accessor<TRow, PromptCellProps>, o?: ColumnOptions): ColumnDef<TRow>;   // 360 / 240 / 640, flex, pinned
  domain<TRow>(acc: Accessor<TRow, DomainCellProps>, o?: ColumnOptions): ColumnDef<TRow>;   // 220 / 160 / 360
  url<TRow>(acc: Accessor<TRow, URLCellProps>, o?: ColumnOptions): ColumnDef<TRow>;         // 260 / 180 / 480
  rank<TRow>(acc: Accessor<TRow, RankCellProps>, o?: ColumnOptions): ColumnDef<TRow>;       // 64 / 56 / 80, right, best first
  rankDelta<TRow>(acc: Accessor<TRow, RankDeltaCellProps>, o?: ColumnOptions): ColumnDef<TRow>;   // 88 / 84 / 88 (deviation 144)
  count<TRow>(acc: Accessor<TRow, number | null>, o?: ColumnOptions): ColumnDef<TRow>;      // 88 / 72 / 120
  volume<TRow>(acc: Accessor<TRow, SearchVolumeCellProps>, o?: ColumnOptions): ColumnDef<TRow>;
  rate<TRow>(acc: Accessor<TRow, MetricCellProps>, o?: ColumnOptions): ColumnDef<TRow>;     // 80 / 72 / 120
  rateDelta<TRow>(acc: Accessor<TRow, DeltaCellProps>, o?: ColumnOptions): ColumnDef<TRow>; // 80 / 64 / 96
  currency<TRow>(acc: Accessor<TRow, CostCellProps>, o?: ColumnOptions): ColumnDef<TRow>;   // 96 / 80 / 128
  date<TRow>(acc: Accessor<TRow, DateCellProps>, o?: ColumnOptions): ColumnDef<TRow>;       // 120 / 104 / 160, newest first
  sparkline<TRow>(acc: Accessor<TRow, SparklineCellProps>, o?: ColumnOptions): ColumnDef<TRow>;   // 88 / 88 / 120, not sortable
  badge<TRow>(acc: Accessor<TRow, { label: string; tone?: BadgeProps['tone'] } | null>, o?: ColumnOptions): ColumnDef<TRow>;   // 120 / 88 / 180
  engineGroup<TRow>(engines: readonly EngineCode[], acc: (row: TRow, engine: EngineCode) => EngineMetricCellProps, o?: ColumnOptions): ColumnDef<TRow>;   // 72 each
  status<TRow>(acc: Accessor<TRow, StatusCellProps>, o?: ColumnOptions): ColumnDef<TRow>;   // 120 / 96 / 180, severity first
  features<TRow>(acc: Accessor<TRow, SERPFeatureListProps>, o?: ColumnOptions): ColumnDef<TRow>;  // 140 / 112 / 220
  aiOverview<TRow>(acc: Accessor<TRow, AIOverviewStatusProps>, o?: ColumnOptions): ColumnDef<TRow>;  // 112 / 96 / 140, cited first
  competitor<TRow>(acc: Accessor<TRow, CompetitorCellProps>, o?: ColumnOptions): ColumnDef<TRow>; // 160 / 120 / 240
  actions<TRow>(actions: ReadonlyArray<RecordAction<TRow>>, rowName: (row: TRow) => string): ColumnDef<TRow>;   // 40, pinned right
};
```

- **Rules:** unknown values (beyond depth, insufficient, `n/a`) sort last in both directions; identity columns take the remaining width, at most one flex column per table; priorities follow 19 §6.1 (identity is 1; section 23, item 46); `RankObservation` carries depth, so the `depth` option in the 12 §19 sketch is not needed.
- **Use:** every `DataTable` column. **Not for:** `SimpleTable` (columns are plain definitions).

## 8. Data: table cells

All cells live in `components/app/cells/` (sparklines in `sparkline/`), receive values from the row, never fetch and never format numbers themselves ([12 §6](12-tables.md)). Every cell with a truncated or exact value has a tooltip mounted on hover or focus only. Numeric cells are `num` and right-aligned. Unknown states follow section 11.11 to 11.14.

### 8.1 KeywordCell
`app/cells/keyword-cell.tsx` · V1 · [12 §6](12-tables.md)

Purpose: identity cell of keyword rows.

```ts
interface KeywordCellProps {
  keyword: string;
  location: string; device: 'desktop' | 'mobile'; lang?: string;
  flags?: { targetMismatch?: TargetURLIndicatorProps; cannibalization?: CannibalizationIndicatorProps };
  branded?: boolean;                // micro badge only in prompt-linked views
  isNew?: boolean;                  // "New" info-subtle badge after an add or import
  secondaryLine?: string | null;    // Comfortable density: "US · Desktop · /pricing · 2.4K"
  hoverActions?: ReadonlyArray<RecordAction<string>>;   // up to 2 icon-xs actions
}
```

- **Variants:** density via the table. **States:** default, truncated, flagged, new, stale badge.
- **A11y:** `th role="rowheader"`; flags have names ("Target URL mismatch"); tooltip shows keyword, location, device. **Use:** `col.keyword`. **Not for:** prompts (`PromptCell`).

### 8.2 PromptCell
`app/cells/prompt-cell.tsx` · V1 · [12 §6](12-tables.md)

Purpose: identity cell of prompt rows, one line.

```ts
interface PromptCellProps { text: string; lang?: string; type?: PromptTypeBadgeProps['type']; locked?: boolean; branded?: boolean }
```

- **Variants:** density (type badge hidden in Compact). **States:** default, locked core panel (12 px lock), truncated.
- **A11y:** row header; full prompt in tooltip (320 px, wraps) and inspector; `lang` when not English. **Use:** `col.prompt`. **Not for:** answer text (`ResponsePreview`).

### 8.3 RankCell
`app/cells/rank-cell.tsx` · V1 · [12 §6](12-tables.md), [22 §3](22-content-formatting.md)

Purpose: the organic rank of one check. Text from `formatRankCell`, accessible text from `describeRank`, tooltip from `formatRankInline` and `formatTableDateTime`.

```ts
interface RankCellProps {
  value: RankObservation | null;    // null: not yet collected (renders NotCollected "Pending")
  previous?: RankObservation | null;   // tooltip: "Previous #8"
  checkedAt?: IsoInstant | null;
  timeZone: string;
  stale?: boolean;
  collectionIssue?: string | null;  // CollectionIssue tooltip text
}
```

- **Variants:** none.
- **States:** ranked (`3` in `foreground`), beyond depth (`>20` in `foreground-tertiary`; section 23, item 16), pending, stale badge, collection issue.
- **A11y:** visual text `aria-hidden` plus `sr-only` `describeRank(value)` ("rank 3", "not in top 20"); column header supplies "Rank".
- **Use:** `col.rank`, rank slots in `SEOAIStatus` and `CompetitorRankCell`. **Not for:** average rank (a `NumberCell` preset formatted with `formatDecimal(value, 1)` plus `n_ranked` in the tooltip), AI structured rank (`StructuredRank`).

### 8.4 RankDeltaCell
`app/cells/rank-delta-cell.tsx` · V1 · [12 §6](12-tables.md), [ADR-DS-017](adr/ADR-DS-017-rank-arrows-metric-signs.md)

Purpose: the rank change next to its rank, from `formatRankChange(change)`: `↑5`, `↓3`, `0`, `New`, `Lost`, or empty on first check; tone only from the formatter.

```ts
interface RankDeltaCellProps {
  change: RankChange | null;        // classifyRankChange(previous, current, meanAbsDailyChange)
  previous?: RankObservation | null;
  current?: RankObservation | null; // tooltip "Improved 5 positions (from #8 to #3)"
  normalMovement?: number | null;   // tooltip "Normal movement for this keyword: up to 2 positions"
}
```

- **Variants:** none; color by `TONE_TEXT[display.tone]` (neutral is `foreground-secondary`).
- **States:** emphasized (positive or negative text), within normal movement (neutral), entered and dropped (always toned), unchanged, first check (empty cell, accessible "first check").
- **A11y:** `display.text` `aria-hidden` plus `display.label` in `sr-only`; arrows never carry meaning alone.
- **Use:** `col.rankDelta`, immediately right of the rank column. **Not for:** rates or counts (`DeltaCell`), signed rank numbers (never).

### 8.5 DeltaCell
`app/cells/delta-cell.tsx` · V1 · [12 §6](12-tables.md), [02 §6](02-color-system.md)

Purpose: a metric change as a signed value in its unit, from `formatMetricDelta(input)`: `+5.3 pts`, `+12`, `+12.4%`.

```ts
interface DeltaCellProps {
  input: MetricDeltaInput;          // { value, unit: 'points' | 'relative' | 'count', polarity, isDetectable }
  previousText?: string;            // tooltip "Previous 29.0%"
  intervalText?: string | null;     // "95% interval −1.1 to +4.6 pts" (a points-interval formatter is to be added to `lib/format` with tests before use)
  method?: string | null;           // "Paired, same 243 prompts"
  boundaryText?: string | null;     // version boundary warning icon with tooltip
}
```

- **Variants:** none.
- **States:** detectable (tone by polarity), not detectable (neutral, tooltip adds `display.note` "Within normal variation"), no comparison (`n/a`), version boundary straddled (12 px `GitCommitVertical` in `foreground-muted`, 07 §6).
- **A11y:** the cell composes no text itself: the `sr-only` text is the formatter's `display.label` ("up 5.3 pts") plus `display.note` ("Within normal variation"). The detectable-change phrase is to be added to `formatMetricDelta` (code follow-up) before the cell speaks it.
- **Use:** `col.rateDelta`, gap columns, count changes. **Not for:** ranks (`RankDeltaCell`), cost and volume (neutral polarity still uses this cell and never colors).

### 8.6 MetricCell
`app/cells/metric-cell.tsx` · V1 · [12 §6](12-tables.md), [23 §1.1](23-application-patterns.md)

Purpose: a rate with its denominator: `47.2%`; Comfortable density (40 px rows) adds `612 of 1,296 obs` below in `type-label`; Compact density, the default, and embedded tables show the rate only (the sample is in the tooltip). Formerly called `RateCell` in 19 and 20 (section 23, item 48).

```ts
interface MetricCellProps {
  value: MetricCellValue;           // contract MetricCell: value, numerator, denominator, n_observations, ci, suppressed_reason
  noun: SampleNoun;
  decimals?: 0 | 1;                 // 0 when the interval half-width is at least 2 points
  intervalDisplay?: 'none' | 'bar'; // 'bar' only when "Show intervals" is on in Comfortable density
  density: Density;
}
```

- **Variants:** density.
- **States:** value, insufficient (`suppressed_reason: 'insufficient_data'` renders `InsufficientData`), not applicable (`no_surface` renders `NotApplicable`), not collected, collection issue.
- **A11y:** `sr-only` "34%, 612 of 1,800 observations"; tooltip adds interval, window, method link; CI bar `aria-hidden`.
- **Use:** `col.rate`. **Not for:** counts (`NumberCell`), per-engine groups (`EngineMetricCell`), pooled cross-engine values without an "Equal-weight average" label.

### 8.7 NumberCell
`app/cells/number-cell.tsx` · V1 · [12 §6](12-tables.md)

Purpose: an exact grouped integer (`12,400`) from `formatInteger`.

```ts
interface NumberCellProps { value: number | null; unknown?: UnknownValueKind; estimate?: boolean; tooltip?: string }
```

- **Variants:** none. **States:** value, `n/a` in `foreground-tertiary`, unknown state, estimate (tooltip "Estimate").
- **A11y:** plain text; compact forms elsewhere are expanded for speech. **Use:** `col.count`. **Not for:** search volume (`SearchVolumeCell`), money (`CostCell`), rates (`MetricCell`).

### 8.8 DomainCell
`app/cells/domain-cell.tsx` · V1 · [12 §6](12-tables.md), [07 §5](07-icons.md)

Purpose: registrable domain in `foreground`, subdomain prefix in `foreground-tertiary`, 16 px favicon in domain-first tables, role badge for own and competitor.

```ts
interface DomainCellProps {
  host: string;                     // displayDomain output
  registrable: string;
  role?: DomainRole;
  favicon: 'show' | 'hide';         // show only in Citations, Sources, Competitors tables and when enabled in settings
  unresolvedRedirect?: boolean;
  category?: string;                // tooltip
}
```

- **Variants:** none. **States:** favicon loaded, placeholder square, redirect flag (`TriangleAlert`), truncated subdomain (registrable part always visible).
- **A11y:** favicon `alt=""`; row header when it is the identity column. **Use:** `col.domain`. **Not for:** full URLs (`URLCell`), citation source rows (`SourceDomainCell` preset).

### 8.9 URLCell
`app/cells/url-cell.tsx` · V1 · [12 §6](12-tables.md), [22 §5](22-content-formatting.md)

Purpose: a URL from `displayUrl` in `type-mono` (13/20): host in `foreground-tertiary` (hidden in single-domain tables), path in `foreground`, middle-truncated with `truncatePath` and an ellipsis; hover or focus shows Copy (original URL) and Open. Formerly called `UrlCell` in 19 and 20 (section 23, item 48).

```ts
interface URLCellProps {
  url: DisplayUrl | null;           // null: "Not ranking" text
  hostDisplay: 'show' | 'hide';
  maxChars?: number;
  label?: string;                   // accessible context: "ranking URL"
}
```

- **Variants:** none. **States:** valid, invalid URL (raw string with `warning-text` icon, "Invalid URL" tooltip), empty, focused (widget mode reaches Copy and Open).
- **A11y:** buttons "Copy ranking URL" and "Open /pricing in a new tab" (24 px); tooltip shows the full display URL. **Use:** `col.url`. **Not for:** domains (`DomainCell`), ranking URL with target logic (`RankingURLCell`).

### 8.10 SparklineCell
`app/sparkline/sparkline-cell.tsx` · V1 · [12 §6](12-tables.md), [15 §9](15-data-visualization.md)

Purpose: a 64 x 16 px (Compact density, the default, and embedded tables) or 64 x 20 px (Comfortable density) canvas trend drawn by the shared renderer: 1.5 px, gray, with the own row in cobalt.

```ts
interface SparklineCellProps {
  points: ReadonlyArray<{ date: BusinessDate; value: number | null }>;   // null breaks the line
  scale: { min: number; max: number };   // fixed per table so rows compare
  invert?: boolean;                 // ranks: better is up
  role: 'own' | 'context';          // chart-1 or chart-reference stroke
  summary: string;                  // accessible name "Rank trend over 30 days: from 8 to 3, improving"
  lastSeven: ReadonlyArray<{ dateText: string; valueText: string }>;   // tooltip mini table
}
```

- **Variants:** density (height). **States:** data, gaps, empty (1 px dashed `border` line).
- **A11y:** `role="img"` with `summary`; canvas not focusable. **Use:** `col.sparkline`, metric strip on Overview. **Not for:** anything with axes (`ChartFrame`); red or green lines (never).

### 8.11 EngineCell
`app/cells/engine-cell.tsx` · V1 · [12 §6](12-tables.md)

Purpose: the engine of a row (observation lists, per-engine tables) as an `EngineBadge`.

```ts
interface EngineCellProps { engine: EngineCode; observationClass: 'show' | 'hide' }
```

- **Variants, States:** none. **A11y:** text. **Use:** observation and rate tables with an engine column; in prompt by engine status tables it hosts one `EngineStatusGlyph` per engine (section 15.24, [12 §6](12-tables.md)). **Not for:** per-engine values (`EngineMetricCell`).

### 8.12 EngineMetricCell
`app/cells/engine-metric-cell.tsx` · V1 · [12 §6](12-tables.md)

Purpose: one engine's value inside an `engineGroup` column group ("ChatGPT · Gemini · AI Mode").

```ts
interface EngineMetricCellProps {
  engine: EngineCode;
  value: MetricCellValue | null;    // null with reason 'not_enabled' renders n/a
  reason?: 'not_enabled' | 'not_in_scope' | 'no_linked_prompts' | null;
  noun: SampleNoun;
}
```

- **Variants:** none (72 px). **States:** value (headline rounding), insufficient (hatched, count "3 obs" under 88 px), `n/a` with reason, pending.
- **A11y:** header group names the engine; tooltip gives class, n and interval. **Use:** `col.engineGroup`. **Not for:** pooled values across engines.

### 8.13 StatusCell
`app/cells/status-cell.tsx` · V1 · [12 §6](12-tables.md)

Purpose: `StatusBadge` in a table with detail and time in the tooltip.

```ts
interface StatusCellProps { status: StatusBadgeProps['status']; detail?: string; atText?: string }
```

- **Variants, States:** as `StatusBadge`. **A11y:** word plus icon. **Use:** runs, imports, integrations, alert status. **Not for:** categorical labels (`Badge`).

### 8.14 CitationCell
`app/cells/citation-cell.tsx` · V1 · [12 §6](12-tables.md)

Purpose: a citation fact in a row, rendered by `CitationStatus`.

```ts
interface CitationCellProps { status: CitationStatusProps; citedUrl?: DisplayUrl | null }
```

- **Variants, States, A11y:** as `CitationStatus`; tooltip shows the cited URL and position. **Use:** observation and keyword tables. **Not for:** AI Overview in SERP rows (`AIOverviewStatus`).

### 8.15 CompetitorCell
`app/cells/competitor-cell.tsx` · V1 · [12 §6](12-tables.md)

Purpose: competitor name with its 8 px color swatch and one value (rank or rate).

```ts
interface CompetitorCellProps { entity: EntityRef; value: { kind: 'rank'; rank: RankCellProps } | { kind: 'rate'; rate: MetricCellProps } | null; domains?: readonly string[] }
```

- **Variants:** none. **States:** value, no value (`n/a`), name truncated at 24 characters.
- **A11y:** swatch `aria-hidden` (forced-colors exception with comment); name is text; domains in tooltip. **Use:** `col.competitor`. **Not for:** entity comparison tables (entity columns with swatch headers).

### 8.16 CostCell
`app/cells/cost-cell.tsx` · V1 · [12 §6](12-tables.md)

Purpose: USD from `formatCurrency` (2 decimals; 4 below one cent).

```ts
interface CostCellProps { usd: number | null; unitsText?: string; unitPriceText?: string; source?: 'provider_reported' | 'computed_from_tokens' | 'price_book_estimate' }
```

- **Variants:** none. **States:** value, `n/a`, estimate source. **A11y:** plain text; tooltip units and unit price. **Use:** `col.currency`. **Not for:** summaries (`formatCurrency` with `context: 'summary'` in `CostSummary`).

### 8.17 DateCell
`app/cells/date-cell.tsx` · V1 · [12 §6](12-tables.md), [22 §4](22-content-formatting.md)

Purpose: a timestamp in the project timezone from `formatTableDateTime` (`Sep 29, 18:32`), or a relative time in "Updated" columns.

```ts
interface DateCellProps { at: IsoInstant | null; timeZone: string; form: 'table' | 'relative'; emphasis?: 'primary' | 'secondary'; stale?: boolean }
```

- **Variants:** `emphasis` 2 values (`secondary` is `foreground-tertiary` for context columns). **States:** value, never (`n/a`), stale badge.
- **A11y:** `<time datetime>`; tooltip `formatDetailDateTime` plus the viewer's local time when different. **Use:** `col.date`. **Not for:** business dates (`formatBusinessDate` text).

## 9. Data: metrics and statistics

### 9.1 MetricStrip
`app/metric/metric-strip.tsx` · V1 · [23 §2](23-application-patterns.md), [19 §5](19-responsive-behavior.md)

Purpose: the only summary pattern for a scope: 3 to 6 metrics in one panel (never KPI cards).

```ts
interface MetricStripProps {
  size: 'md' | 'sm';                // md: 76 px panel on pages (3 to 6 items); sm: key-value grid in the inspector and detail header (3 to 4 items, 64 px cells, 84 px with a context line)
  label: string;                    // dl name, "Summary for the filtered keywords"
  groups: ReadonlyArray<{ channel: 'seo' | 'ai' | 'first_party' | 'cost'; items: ReadonlyArray<MetricItemProps> }>;   // 1 px border between groups
  refetching?: boolean;
}
```

- **Variants:** `size` 2 values. `md`: one panel (`surface`, 1 px `border`, radius 8), 76 px (`h-metric-strip`), or 96 px when the items carry context lines; cells share the width equally (min 140 px), split by full-height 1 px `border-subtle` dividers (channel group divider: 1 px `border`); cell padding 12 px top and bottom, 20 px left and right. `sm`: bordered key-value grid (1 px `border-subtle` between cells, 1 px `border-subtle` outline with radius 8), 12 px cell padding; 3 items in 3 columns, 4 items in 2 columns.
- **States:** loading (`SkeletonMetricStrip`, real labels), ready, refetching (values stay at full opacity with `aria-busy`; section 23, item 10), wraps to two rows of `ceil(n / 2)` cells when the container is narrower than `n x 140 + (n - 1)` px (153 px: two 76 px rows plus a 1 px `border-subtle` divider), container-query grids below `@4xl` and `@xl`.
- **A11y:** `dl`; each item is a `div` with `dt` and `dd`; read in the order label, value, denominator, delta.
- **Use:** page summaries on T1, T2, T3; inspector summary (`sm`).
- **Not for:** KPI card grids, more than 6 items (split the scope), pooled AI values without the "Equal-weight average (3 engines)" label, repeating metrics shown elsewhere on the page.

### 9.2 MetricItem (MetricLabel)
`app/metric/metric-item.tsx` · V1 · [23 §2.1](23-application-patterns.md), [23 §2.4](23-application-patterns.md)

Purpose: one strip item: label with optional `MetricInfo`, value, `Delta` or `RankDelta`, context line. `MetricLabel` is its label part, reused in chart titles and inspector sections. Formerly called `MetricTile` in 20 §19 (section 23, item 48).

```ts
interface MetricItemProps {
  metricKey: MetricKey;             // label, short label and definition from the registry
  labelOverride?: string;           // "Mention rate ChatGPT"
  value: { text: string; state?: UnknownValueKind };   // formatted by the caller or a preset (MentionRate, CitationRate)
  delta?: { kind: 'metric'; input: MetricDeltaInput } | { kind: 'rank'; change: RankChange } | null;   // omitted when no comparison
  context?: Slot;                   // SampleCount, "volume-weighted", reason text
  sparkline?: SparklineCellProps;   // Overview only
  estimate?: boolean;
  qualifier?: { kind: 'stale' | 'collection_issue' | 'version_boundary'; text: string; href?: string } | null;
  href?: string | null;             // whole item becomes a link when it lists members
}
```

- **Variants:** none. In `md` strips: label `type-meta`, value `type-metric` (24/32) with the `Delta` inline 8 px to its right (`type-body-strong num`), then the context in `type-meta` on its own line below the value; the context truncates with a tooltip only when it exceeds the cell, the value never does. In `sm` grids: label `type-label` above the value `type-metric-sm` (18/24) with the delta inline; the context line (`type-meta`) sits below the value. Min 140 px in `md` strips and 96 px in `sm` grids, max 280 px (23 §2.2).
- **States:** value, insufficient (`Insufficient` with hatching behind the value, counts in context), not applicable (reason text such as "No AI Overview in window" plus the presence rate), not collected ("First check scheduled for Sep 30, 02:00 CEST", 17 §8; `Pending` is the cell form only), estimate badge, stale or collection issue icon, version boundary glyph, clickable (hover `surface-hover`, focus ring).
- **A11y:** clickable item is an `a` named "Top 10: 301, open keywords"; unknown reads "No data", never 0.
- **Use:** inside `MetricStrip` only. **Not for:** standalone numbers in sections (use text with the formatter), detail header single-metric focus (`MetricCard`).

### 9.3 MetricCard
`app/metric/metric-card.tsx` · V1 · [23 §2.5](23-application-patterns.md)

Purpose: a bordered single-metric panel (`type-metric` value, delta, context, optional 180 px chart) in exactly two places: single-metric focus on a detail page header (max 4, one per channel) and `QuadrantSummary`.

```ts
interface MetricCardProps extends Omit<MetricItemProps, 'sparkline'> { chart?: Slot; onSelect?: () => void; selected?: boolean }
```

- **Variants:** none (8 px radius, 16 px padding, no shadow). **States:** as `MetricItem`; selectable (quadrant filter, `aria-pressed`).
- **A11y:** heading plus value; selectable cards are buttons. **Use:** the two places above. **Not for:** any summary row (`MetricStrip`); nested inside panels.

### 9.4 Delta
`app/metric/delta.tsx` · V1 · [14 §5](14-badges-status.md), [02 §6](02-color-system.md)

Purpose: inline signed metric change outside tables (strips, inspector, sentences), from `formatMetricDelta`.

```ts
interface DeltaProps { input: MetricDeltaInput; size?: 'sm' | 'md'; tooltip?: { previousText?: string; intervalText?: string; method?: string } }   // md: type-body-strong in strips
```

- **Variants:** `size` 2 values. **States:** as `DeltaCell`.
- **A11y:** `display.label` plus detectability in `sr-only`. **Use:** strips, inspector values, change feeds. **Not for:** rank changes (`RankDelta`); arrows on rates (never).

### 9.5 ConfidenceIndicator
`app/metric/confidence-indicator.tsx` · V1 · [23 §8.2](23-application-patterns.md)

Purpose: the 95% interval of a rate as text ("29% to 39%" from `formatInterval`) with an optional 48 x 12 px interval bar on a shared scale.

```ts
interface ConfidenceIndicatorProps {
  estimate: number | null;          // ratio 0 to 1
  low: number | null;
  high: number | null;
  decimals?: 0 | 1;
  form: 'text' | 'text-and-bar' | 'bar';
  scaleMax?: number;                // shared per column or chart; stated in the header tooltip
  insufficient?: { valid: number; required: number } | null;   // renders InsufficientData, no bar
}
```

- **Variants:** none (bar: 1 px `border-strong` axis, 2 px `foreground-secondary` interval, 6 px `foreground` point; no filled track).
- **States:** interval, insufficient, missing (`n/a`).
- **A11y:** accessible name "95% interval 31% to 37%"; bar `aria-hidden` when text is present.
- **Use:** inspector rate tables, Prompt Detail rate table, statistics panel, Comfortable-density rate columns with "Show intervals". **Not for:** Compact rows by default; SEO rank metrics (no interval exists).

### 9.6 SampleCount
`app/metric/sample-count.tsx` · V1 · [23 §8.3](23-application-patterns.md)

Purpose: "612 of 1,296 obs" from `formatSampleCount`, with the noun always present.

```ts
interface SampleCountProps { k: number | null; n: number | null; noun: SampleNoun; form?: 'k-of-n' | 'n-only' }   // 'n-only': "250 prompts"
```

- **Variants:** none (`type-meta num`). **States:** value, `n/a`.
- **A11y:** abbreviation "obs" has a visually hidden "observations". **Use:** strip context lines, the Default-density `MetricCell` second line, inspector rate tables. **Not for:** progress ("412 of 1,000 checks" belongs to `CollectionProgress`).

### 9.7 MetricInfo
`app/metric/metric-info.tsx` · V1 · [22 §10](22-content-formatting.md), [23 §8.1](23-application-patterns.md)

Purpose: the (i) button and 360 px popover that explain a metric's meaning in a fixed order.

```ts
interface MetricInfoProps {
  metricKey: MetricKey;             // definition, formula in words, method link from the registry
  denominatorText?: string;         // for the current view
  aggregation?: 'prompt_weighted' | 'observation_weighted';
  methodVersion?: number;
  onOpenStatistics?: () => void;    // AI rates only
}
```

- **Variants:** none (`IconButton icon-xs`, 14 px `Info`, 4 px after the label).
- **States:** closed, open.
- **A11y:** toggletip named "About {metric}"; "Methodology" link is always the last line (consistent help).
- **Use:** every non-obvious metric label in strips, column headers (inside the header menu area), chart titles, inspector sections. **Not for:** numbers (the value tooltip shows interval and n; the two are never merged).

### 9.8 MetricSwitcher
`app/metric/metric-switcher.tsx` · V1 · [23 §6.1](23-application-patterns.md)

Purpose: a `Select` of registry metrics grouped by channel for comparison tables, engine column groups and charts; writes `metric=`.

```ts
interface MetricSwitcherProps { value: MetricKey; options: ReadonlyArray<{ key: MetricKey; group: 'AI' | 'SEO' }>; onValueChange: (key: MetricKey) => void; label: string }
```

- **Variants:** none (32 px `sm`). **States:** as `Select`. **A11y:** labeled select ("Engine columns", "Metric").
- **Use:** Competitor by-topic table, Prompt Explorer engine columns, Matrix AI metric. **Not for:** switching screens.

### 9.9 StatisticsPanel
`app/metric/statistics-panel.tsx` · V1 · [23 §8.6](23-application-patterns.md), [20-frontend-specification.md](../20-frontend-specification.md) §6

Purpose: estimate, uncertainty, period comparison, movers, version boundaries and panel sizing for one AI rate.

```ts
interface StatisticsPanelProps {
  metric: MetricKey; engine: EngineCode;
  estimate: MetricValue;
  comparison?: MetricComparison | null;
  movers?: ReadonlyArray<{ label: string; delta: MetricDeltaInput; href: string }>;   // BH-filtered
  boundaries: MetricValue['version_boundaries'];
  sizing?: { flipRate: number | null; detectablePoints: number | null } | null;
  placement: 'inspector-tab' | 'inspector-region';   // itab=stats, or stats=<metric>:<engine> at 560 px
  backTo?: { label: string; onBack: () => void } | null;
}
```

- **Variants:** none. **States:** loading per section, sections 1 to 3 and 5 in V1; population inference and bootstrap are Later (phase 14).
- **A11y:** non-modal (the page stays interactive); inspector landmark semantics; charts inside follow `ChartFrame`.
- **Use:** "Statistics" actions on AI rates. **Not for:** SEO rank metrics (no interval), a modal drawer (section 23, item 29).

## 10. Data: charts

All charts render inside `ChartFrame` through `EChart`, with option builders `build<Name>Option(data, theme)` in `components/app/chart/options/` (pure, snapshot-tested). Animation is off; colors come from `useChartTheme()`; every chart has a summary sentence and a table view ([15-data-visualization.md](15-data-visualization.md), [20 §12](20-accessibility.md)).

### 10.1 ChartFrame (ChartLegend)
`app/chart/chart-frame.tsx` · V1 · [15 §2](15-data-visualization.md), [20 §12](20-accessibility.md)

Purpose: the panel around every chart: title, meta line, React legend, actions (Table, Patterns, More), footnote, summary.

```ts
interface ChartLegendItem { id: string; label: string; swatch: { color: `chart-${1 | 2 | 3 | 4 | 5 | 6}` | 'chart-other' | 'chart-reference'; line: 'solid' | 'dashed' | 'dotted' }; valueText?: string; visible: boolean }
interface ChartFrameProps {
  title: string;                    // states metric and split: "Mention rate by engine"
  meta?: string;                    // window, sample, boundary count
  summary: string;                  // one visible sentence, also aria-describedby
  legend?: { items: readonly ChartLegendItem[]; onToggle: (id: string) => void };   // hidden with one series
  view: 'chart' | 'table'; onViewChange: (view: 'chart' | 'table') => void;
  table: Slot;                      // SimpleTable with n and interval columns
  patterns: boolean; onPatternsChange: (on: boolean) => void;
  moreActions?: readonly MenuItemDef[];   // Download PNG (light theme), Download CSV, Copy link, Statistics
  footnote?: Slot;
  height: 140 | 180 | 240 | 280 | 480;
  placement: 'panel' | 'inspector';
  status: 'loading' | 'ready' | 'refetching' | 'empty' | 'error';
  children: Slot;                   // EChart
}
```

- **Variants:** none; `placement` is structural (panel: `surface`, 1 px `border`, radius 8, 16 px padding, 48 px title row with the title in `type-section-title`; inspector: no border, 0 horizontal padding). Legend: 8 px dots at the top right of the panel, or below the chart when values are shown. Plot styling comes from `useChartTheme()` ([15 §4](15-data-visualization.md)): 2 px lines, 1 px dashed gridlines (`chart-grid`, the `border-subtle` value), axis labels `type-label` (12 px tertiary), rank charts with 1 at the top; tooltips use `ChartTooltip` (section 10.12).
- **States:** loading (`SkeletonChart`), ready, refetching (no dimming; spinner and "Updating" in the header after 400 ms), empty (one sentence), error (`InlineError` in the reserved height); legend moves below the plot in narrow containers.
- **A11y:** `figure` with `figcaption`; view switch is a single-choice segmented control; legend items are buttons with `aria-pressed` (the last visible item is `aria-disabled` with a reason); hiding announces "HubSpot hidden".
- **Use:** every chart. **Not for:** sparklines (`SparklineCell`), charts inside dialogs.

### 10.2 EChart
`app/chart/echart.tsx` · V1 · [15 §3](15-data-visualization.md), [ADR-DS-006](adr/ADR-DS-006-echarts-wrapper.md)

Purpose: the about 100-line wrapper: instance lifecycle, `ResizeObserver`, `setTheme` on theme change, `dispose`, event forwarding, aria description.

```ts
import type { EChartsCoreOption } from 'echarts/core';
interface EChartProps {
  option: EChartsCoreOption;        // from build<Name>Option(data, theme); animation false is enforced
  ariaDescription: string;          // structural description: type, axes, units, series, first, last, min, max
  height: number;
  onPointClick?: (params: { seriesId: string; dataIndex: number }) => void;
  group?: string;                   // echarts.connect for small multiples
  interactive?: 'none' | 'focusable';   // focusable only when it offers interactions (matrix selection)
}
```

- **Variants:** none. **States:** mounting (lazy via `next/dynamic`, `ssr: false`), mounted when visible, disposed on unmount.
- **A11y:** canvas container `role="img"` with `ariaDescription`; `forced-color-adjust: none` with the required comment; tooltips `enterable`, escaped text only.
- **Use:** inside `ChartFrame`. **Not for:** direct use in features without a frame, Recharts (banned).

### 10.3 RateTrendChart
`app/chart/rate-trend-chart.tsx` · V1 · [15 §5](15-data-visualization.md)

Purpose: AI rates (or SEO visibility) over time with 95% CI bands, hollow insufficient points and version boundaries.

```ts
interface RateTrendChartProps {
  series: ReadonlyArray<{ id: string; label: string; role: 'entity' | 'engine' | 'reference'; colorIndex: EntityColorIndex | null; points: readonly MetricPoint[]; estimate?: boolean }>;
  kind: 'entity' | 'engine';        // two chart kinds never mix
  boundaries: MetricValue['version_boundaries'];
  previousPeriod?: readonly MetricPoint[] | null;   // dashed chart-reference, named "Previous period"
  timeZone: string;
}
```

- **Variants:** none. **States:** as ChartFrame; partial last point hollow.
- **A11y:** own brand solid 2 px with circle markers labeled "(you)"; competitors by marker shape; reference dashed (section 23, item 56). **Use:** Overview main trend, prompt trends, inspector 180 px trend. **Not for:** ranks (`RankHistoryChart`), dual y-axes (use `SmallMultiples`).

### 10.4 RankHistoryChart (alias RankingHistoryChart)
`app/chart/rank-history-chart.tsx` · V1 · [15 §7](15-data-visualization.md)

Purpose: rank over time on an inverted axis with guide lines at 3, 10 and 20, a hatched depth band per check, deep-check points (series marker shape, 15 §7) and an event strip. "RankingHistoryChart" is an alias; the canonical name is `RankHistoryChart`.

```ts
interface RankHistoryChartProps {
  own: ReadonlyArray<{ date: BusinessDate; obs: RankObservation; deep: boolean }>;
  competitors?: ReadonlyArray<{ entity: EntityRef; points: ReadonlyArray<{ date: BusinessDate; obs: RankObservation }> }>;   // max 5
  absolute?: ReadonlyArray<{ date: BusinessDate; position: number | null }> | null;   // dashed, named
  events?: ReadonlyArray<{ date: BusinessDate; kind: 'url_changed' | 'entered_top_10' | 'aio_appeared' | 'aio_disappeared'; label: string }>;
  axisMax: 20 | 100;                // "Show deep checks" extends to 100
}
```

- **Variants:** none. **States:** beyond-depth checks as hollow markers inside the band, line breaks there; empty window.
- **A11y:** summary sentence from the feature; y axis labeled "Rank (1 = best)"; table view lists date, rank, depth. **Use:** keyword inspector (180 px), Keyword Detail (240 px). **Not for:** distributions (`RankDistributionChart`), colored rank bands behind the line.

### 10.5 RankDistributionChart
`app/chart/rank-distribution-chart.tsx` · V1 · [15 §5](15-data-visualization.md)

Purpose: count of keywords per rank band per date as stacked bars in `rank-band-*` order, unranked hatched on top.

```ts
interface RankDistributionChartProps { weeks: ReadonlyArray<{ date: BusinessDate; counts: Readonly<Record<RankBucket, number>> }>; mode: 'absolute' | 'share' }
```

- **Variants:** none. **States:** as ChartFrame. **A11y:** decals with Patterns; table view. **Use:** Rankings and Overview over time. **Not for:** a single snapshot (`RankDistribution` bar list), pie charts.

### 10.6 OutcomeMixBar
`app/chart/outcome-mix-bar.tsx` · V1 · [15 §5](15-data-visualization.md), [24 §9.6](24-page-templates.md)

Purpose: the four-outcome mix (A4) as a 100% stacked horizontal bar per engine: mentioned and cited, mentioned only, cited only, neither. Mention and citation stay separate facts; this is the only component that shows their joint distribution.

```ts
interface OutcomeMixBarProps {
  engine: EngineCode;
  counts: { mentionedAndCited: number; mentionedOnly: number; citedOnly: number; neither: number };
  size: 'cell' | 'panel';           // cell: 96 x 12 px in rate tables; panel: a StackedBar100 (32 px) with labeled segments and legend table
}
```

- **Variants:** `size` 2 values. The `panel` size renders through `StackedBar100` (section 10.11) with the four outcomes in a fixed order; `OutcomeMixBar` fixes the segments, their order and their names, `StackedBar100` owns the drawing. **States:** data, insufficient (text instead of bar); never collapsed to fewer segments.
- **A11y:** `role="img"` with "Mentioned and cited 4, mentioned only 3, cited only 1, neither 4 of 12"; tooltip counts. **Use:** Prompt Detail rate table, prompt inspector. **Not for:** a merged "visible" rate (never).

### 10.7 Heatmap
`app/chart/heatmap.tsx` · V1 · [15 §5](15-data-visualization.md), [24 §9.4](24-page-templates.md)

Purpose: topic x engine rates, SERP feature presence per check, prompt x week; sequential palette for rates, diverging for changes. Formerly called `HeatmapChart` in 24 (section 23, item 48).

```ts
interface HeatmapProps {
  rows: readonly string[]; columns: readonly string[];
  cells: ReadonlyArray<{ row: number; col: number; value: number | null; state?: 'owned' | 'present' | 'absent' }>;
  scale: 'sequential' | 'diverging' | 'presence';   // presence: owned primary, present chart-reference, absent empty
  cellLabels: 'auto' | 'none';      // text only when cells are at least 36 px wide
}
```

- **Variants:** none. **States:** as ChartFrame. **A11y:** table view is the full description; legend swatches exempt from forced colors. **Use:** Keyword Detail SERP features, topic engine grids. **Not for:** precise lookup (table).

### 10.8 SmallMultiples
`app/chart/small-multiples.tsx` · V1 · [15 §5](15-data-visualization.md)

Purpose: a grid of 140 px charts with shared axes and a synced crosshair (`echarts.connect`).

```ts
interface SmallMultiplesProps { panels: ReadonlyArray<{ id: string; title: string; summary: string; option: EChartsCoreOption }>; sharedY: 'same-scale' | 'own-axis'; group: string }
```

- **Variants:** none (`grid-cols-[repeat(auto-fill,minmax(280px,1fr))]`). **States:** as ChartFrame per panel.
- **A11y:** each panel is its own figure with summary. **Use:** per-engine trends, 7 or more entities after "Show all", two measures over time instead of dual axes. **Not for:** one metric with 1 to 6 series (one chart).

### 10.9 Sparkline (renderer)
`app/sparkline/sparkline.tsx` · V1 · [15 §9](15-data-visualization.md)

Purpose: the shared canvas renderer behind `SparklineCell`, `RankTrend` and strip sparklines: one draw per row, no ECharts.

```ts
interface SparklineRenderInput { width: 64; height: 16 | 20;   // 20 in Default rows and the metric strip, 16 in Compact rows and embedded tables
  points: ReadonlyArray<number | null>; scale: { min: number; max: number }; invert: boolean; stroke: 'chart-1' | 'chart-reference'; baseline?: 'zero' | 'none' }
declare function drawSparkline(ctx: CanvasRenderingContext2D, input: SparklineRenderInput, colors: ChartTheme): void;
```

- **Rules:** 1.5 px stroke, gray (`chart-reference`) by default and cobalt (`chart-1`) for the own or owned row in tables that mix it with others ([15 §9](15-data-visualization.md)), 3 px last-point dot, no area, never red or green, redraw only when data changes. **Use:** through its components. **Not for:** direct use in features.

### 10.10 BarList
`app/chart/bar-list.tsx` · V1 · [15 §5.1](15-data-visualization.md), [visual-spec §5](reference/visual-spec.md)

Purpose: horizontal bars rendered as HTML, not canvas, in two modes. `comparison`: ranked bars that compare the own brand or domain with competitors and other domains, such as share of voice. `distribution`: a one-snapshot categorical distribution, such as rank buckets, where no bar is the own brand.

```ts
type BarListScaleColor = `rank-band-${1 | 2 | 3 | 4 | 5}` | 'rank-band-none' | 'chart-other';
interface BarListItem {
  id: string;
  label: string;                    // domain, entity or category name
  value: number;                    // on a scale shared by all rows
  valueText: string;                // "17.3%", preformatted by the caller
  own: boolean;                     // comparison mode: own brand or owned domain (chart-1 bar, label weight 600); always false in distribution mode
  scaleColor?: BarListScaleColor | null;   // distribution mode only: the category's scale color; rank-band-none is hatched
  accessibleText: string;           // "fieldnote.io: 17.3% share of voice"
  href?: string;                    // opens the entity, domain or filtered list
}
interface BarListProps { caption: string; mode: 'comparison' | 'distribution'; items: readonly BarListItem[]; max?: number; showAllHref?: string }   // max 15, then "Show all" opens the table
```

- **Variants:** `mode` 2 values. Label column `type-body` in `foreground`, the own label in weight 600, truncated with an ellipsis at its maximum width. Bars 24 px tall, `rounded-2xs` (2 px), from a shared zero line. Comparison: own bar `chart-1`, every other bar `chart-bar-neutral`. Distribution: each bar in its `scaleColor` (`chart-other` when a category has none); `chart-1` is never used. Value directly after the bar in `type-meta num` (13 px tertiary). At least 8 px between bars.
- **States:** data (comparison: sorted by value, largest first; distribution: in the scale's fixed order), empty, loading (skeleton bars).
- **A11y:** `ul` with each item's `accessibleText`; bars `aria-hidden`. The neutral bars are 1.4:1 against the panel, which is acceptable only because every bar carries its value as text and its label names it; the value text is never dropped (15 §5.1).
- **Use:** comparison: share of voice, top cited domains, top competitors. Distribution: rank buckets (`RankDistribution`, section 14.3), workload spend side list.
- **Not for:** time series, parts of a whole that must read as 100% (`StackedBar100`), more than 15 items inline.

### 10.11 StackedBar100
`app/chart/stacked-bar-100.tsx` · V1 · [15 §5.2](15-data-visualization.md), [visual-spec §5](reference/visual-spec.md)

Purpose: one 100% stacked horizontal bar with a legend table below: parts of a whole. It replaces pie and donut charts. `OutcomeMixBar` (section 10.6) is the four-outcome preset built on it.

```ts
type StackedBarColor =
  | `chart-${1 | 2 | 3 | 4 | 5 | 6}` | 'chart-other'
  | `rank-band-${1 | 2 | 3 | 4 | 5}` | 'rank-band-none';
interface StackedBar100Segment {
  id: string;
  label: string;                    // "Mentioned and cited"
  count: number;
  countText: string;                // "4"
  shareText: string;                // "33%"
  share: number;                    // ratio 0 to 1; inside label drawn only at 0.06 or more
  color: StackedBarColor;           // palette order; chart-1 only for the own brand, never for a category
}
interface StackedBar100Props { caption: string; segments: readonly StackedBar100Segment[]; denominatorText: string }   // "of 12 answers"
```

- **Variants:** none. Bar 32 px tall, radius 6 on the outer corners only, full panel content width. Segments separated by 1 px gaps that show the panel `surface`. Inside labels: the percentage in `type-micro` (12 px, weight 500) with `num`, `foreground-inverse` (white in the light theme) where the pair meets 4.5:1, otherwise `foreground`, omitted if neither passes (15 §5.2), and only in segments of 6% or more. Legend table below: a `SimpleTable` with an 8 px swatch, name, count and percentage (`num`, right-aligned).
- **States:** data, empty, insufficient (text instead of the bar).
- **A11y:** `role="img"` with a name that lists every segment and the denominator ("Mentioned and cited 4, mentioned only 3, cited only 1, neither 4 of 12"); the legend table carries every value, so no segment depends on its inside label; segment tooltips through `ChartTooltip` give name, count, percentage and denominator.
- **Use:** four-outcome mix (through `OutcomeMixBar`), rank band distribution per week, source share by category (15 §5).
- **Not for:** pie or donut charts (never), a series of stacked bars over dates (`RankDistributionChart`), ranked comparisons of entities (`BarList`).

### 10.12 ChartTooltip
`app/chart/chart-tooltip.tsx` · V1 · [15 §4](15-data-visualization.md), [15 §10](15-data-visualization.md), [visual-spec §5](reference/visual-spec.md)

Purpose: the one tooltip body for charts: a date or segment title, then one row per series. The React component serves HTML charts (`BarList`, `StackedBar100`); the formatter builds the same markup for ECharts.

```ts
interface ChartTooltipRow {
  id: string;
  label: string;                    // series or segment name
  color: ChartLegendItem['swatch']['color'] | StackedBarColor;   // 8 px dot
  valueText: string;                // right-aligned, num
  detailText?: string | null;       // "612 of 1,296 obs" or the interval
}
interface ChartTooltipProps { title: string; rows: readonly ChartTooltipRow[]; moreText?: string | null }   // title "Sep 29, 2026"; above 8 rows: top 7 plus "and 3 more"
declare function chartTooltipFormatter(theme: ChartTheme, toRows: (params: unknown) => ChartTooltipProps): (params: unknown) => string;   // ECharts tooltip.formatter; every collected string escaped with echarts.format.encodeHTML
```

- **Variants:** none. `surface-elevated`, 1 px `border`, `rounded-lg` (8 px), `shadow-popover`, max 320 px wide. Title in `type-subsection-title` (14/20, 600) in `foreground` ([visual-spec §6](reference/visual-spec.md)). Rows: 8 px dot in the series color, name in `type-table` `foreground-secondary`, value right-aligned in `type-table num` `foreground`.
- **States:** follows the pointer; pinned (click to pin, Escape unpins); rows sorted by value, best first (ranks lowest first); more than 8 rows collapse to the top 7 plus "and 3 more".
- **A11y:** supplementary only: the chart's table view carries every value; pinned tooltips are hoverable and dismissible (WCAG 1.4.13); escaped text only.
- **Use:** every chart tooltip: time series (one shared tooltip at the crosshair), scatter points, `StackedBar100` segments.
- **Not for:** text tooltips on controls and cells (`Tooltip`), sparklines (their mini table tooltip, 15 §9), interactive content (`Popover`).

## 11. Data: states and status

### 11.1 EmptyState
`app/status/empty-state.tsx` · V1 · [17 §2](17-empty-loading-error-states.md)

Purpose: says what is missing, why, and the one action that changes it.

```ts
interface EmptyStateProps {
  variant?: 'region' | 'inline';    // inline: inspector sections, strip slots, small panels
  icon?: LucideIcon;                // object glyph, 20 px; omitted inline
  title: string;                    // a fact: "No keywords tracked yet"
  reason: string;                   // exactly one sentence with real numbers, times or names
  primaryAction?: Slot;             // omitted when the user cannot act
  secondaryAction?: Slot;           // text link
  filters?: Slot;                   // read-only FilterChips in the filtered-empty case
  headingLevel: 2 | 3;
}
```

- **Variants:** `variant` 2 values. **States:** empty, filtered empty, no permission (names the permission and who can grant it), not found, feature not available yet, no observations yet (with compact `CollectionProgress` when a run is in progress).
- **A11y:** heading level fits the region; action names the fix. **Use:** any region whose query succeeded with nothing to show (copy catalogue 17 §2.3). **Not for:** errors (`InlineError`), loading (skeletons), illustrations (never).

### 11.2 StatusBadge
`app/status/status-badge.tsx` · V1 · [14 §3](14-badges-status.md), [17 §4.1](17-empty-loading-error-states.md)

Purpose: lifecycle status with icon and word.

```ts
interface StatusBadgeProps {
  status: 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'partial' | 'failed' | 'budget_blocked' | 'cancelled' | 'paused' | 'connected' | 'reauth_required' | 'revoked' | 'not_connected' | 'valid' | 'invalid' | 'held' | 'muted' | 'acknowledged' | 'new';
  label?: string;                   // override for counts: "Completed with errors: 23 of 1,000 failed"
}
```

- **Variants:** none (tone and icon fixed per status: running info with rotating `LoaderCircle`, completed positive `CircleCheck`, failed negative `CircleX`, queued neutral `CalendarClock`, budget blocked warning `Receipt`, partial warning `CircleDashed`; section 23, item 59).
- **States:** as listed. **A11y:** icon plus word; never color alone; transparent border for forced colors.
- **Use:** runs, imports, integrations, schedules, observations validity, alert event status. **Not for:** categories (`Badge`), budget states (`BudgetStatusBadge`, a `Badge` preset).

### 11.3 StatusDot
`app/status/status-dot.tsx` · V1 · [14 §3](14-badges-status.md)

Purpose: 6 px dot for real live state in dense lists, always next to a word.

```ts
interface StatusDotProps { tone: 'positive' | 'negative' | 'warning' | 'info' | 'unread'; label: string }   // unread uses primary
```

- **Variants:** `tone` 5 values. **States:** none. **A11y:** `aria-hidden` when the word is adjacent; otherwise the label is its name.
- **Use:** integration connection in lists, notification unread. **Not for:** decoration.

### 11.4 FreshnessIndicator
`app/status/freshness-indicator.tsx` · V1 · [17 §7](17-empty-loading-error-states.md)

Purpose: how current the data is, with precedence failed, budget blocked, stale, partial, delayed, running, fresh.

```ts
interface FreshnessIndicatorProps {
  state: 'fresh' | 'running' | 'partial' | 'delayed' | 'stale' | 'failed' | 'budget_blocked';
  lastCompletedAt: IsoInstant | null;
  timeZone: string;
  cadence: 'daily' | 'weekly';      // weekly or older than 24 h shows "Last collected Sep 29, 18:30 CEST"
  running?: { done: number; total: number; unit: string } | null;
  tooltipLines: readonly string[];  // workload, last run, next run, viewer local time
  runHref?: string | null;
}
```

- **Variants:** none. **States:** as listed; relative text refreshes every 60 s without announcements; state changes announced once.
- **A11y:** `<time datetime>`; a button when it has a tooltip. **Use:** page meta line, inspector header, tiles from a different source. **Not for:** per-row freshness (stale badge and date column).

### 11.5 CollectionProgress
`app/status/collection-progress.tsx` · V1 · [17 §4](17-empty-loading-error-states.md) (17 wins over 23 §12.1; section 23, item 61)

Purpose: one component for background work (runs, Check now, imports, exports, backfills) in three densities.

```ts
interface CollectionProgressProps {
  density: 'compact' | 'standard' | 'full';
  status: RunStatus | 'partial' | 'delayed';
  title: string;                    // "Rank checks running"
  counts: { done: number; total: number; failed: number; inFlight: number; unit: 'checks' | 'answers' | 'keywords' | 'days' | 'rows' };
  taskBreakdown?: Readonly<Record<'ingested' | 'skipped_cached' | 'failed' | 'dead' | 'pending' | 'submit_unknown' | 'submitted' | 'ready' | 'fetched' | 'cancelled', number>>;   // full only
  cost?: { estimateText: string; actualText: string } | null;
  startedAt?: IsoInstant | null;
  timeZone: string;
  runHref?: string | null;          // only for users who can see runs
}
```

- **Variants:** `density` 3 values (compact 16 px line, standard with 4 px `Progress`, full with every task count).
- **States:** queued, running, completed, completed with errors, partial, failed, budget blocked, cancelled, delayed; no estimated time remaining.
- **A11y:** `Progress` exposes values; only start and finish are announced. **Use:** page meta line, status line under the page header, run inspector and detail. **Not for:** refetches (`RefetchBar`), unknown-duration waits (`Spinner`).

### 11.6 RefetchBar
`app/status/refetch-bar.tsx` · V1 · [17 §3.4](17-empty-loading-error-states.md)

Purpose: a 2 px `primary` bar at the top edge of a region that is refetching with previous data visible.

```ts
interface RefetchBarProps { active: boolean; position: 'under-filter-bar' | 'under-table-header' | 'under-section-heading' }
```

- **Variants:** none. **States:** hidden, shown after 150 ms; static full-width bar with no travelling segment (section 23, item 11).
- **A11y:** `aria-hidden`; the region carries `aria-busy`. **Use:** refetch after filter, window, sort or `data_version` changes. **Not for:** first load (skeleton), dimming values (never).

### 11.7 InlineError
`app/status/inline-error.tsx` · V1 · [17 §5.2](17-empty-loading-error-states.md)

Purpose: replaces a failed section, chart or inspector section while keeping its title and height.

```ts
interface InlineErrorProps { title: string; reason: string; errorId: string | null; onRetry: () => void; retrying: boolean; kind: 'server' | 'network' }
```

- **Variants:** none. **States:** error, retrying (previous data and `RefetchBar` kept), network (auto-retry when online).
- **A11y:** `role="alert"` when the user is working in the region; Retry keeps focus, focus moves to the heading on success; error id in `type-mono` with `CopyButton`.
- **Use:** per-section failures. **Not for:** table failures (`TableErrorRow`), route failures (`ErrorPage`), field errors.

### 11.8 TableErrorRow
`app/data-table/table-error-row.tsx` · V1 · [17 §5.3](17-empty-loading-error-states.md)

Purpose: one 48 px row spanning all columns under the kept header, or appended after loaded pages.

```ts
interface TableErrorRowProps { message: string; partialText?: string | null; errorId: string | null; onRetry: () => void; colSpan: number }   // "Loaded 1,200 of 4,812 rows. Loading stopped: network error."
```

- **Variants, States:** as `InlineError` on one line. **A11y:** row within the grid; Retry resumes from the failed cursor. **Use:** `DataTable` load failures. **Not for:** regions outside tables.

### 11.9 ErrorPage
`app/status/error-page.tsx` · V1 · [17 §5.8](17-empty-loading-error-states.md)

Purpose: `error.tsx` content inside the persistent shell. Formerly called `ErrorState` in 20 §19 (section 23, item 48).

```ts
interface ErrorPageProps { errorId: string | null; onReset: () => void; homeHref: string }
```

- **Variants:** none (`EmptyState` layout, `CircleX` 20 px in `negative-text`). **States:** error; 404 uses `not-found.tsx` with the not-found copy; 401 redirects.
- **A11y:** `h1` title. **Use:** route segment errors. **Not for:** section failures.

### 11.10 Banner
`app/status/banner.tsx` · V1 · [18 §4](18-notifications-alerts.md)

Purpose: a condition of the page, inspector, dialog or panel the user is looking at.

```ts
interface BannerProps {
  tone: 'info' | 'warning' | 'negative';
  placement: 'page' | 'region';     // page: full width, no radius, bottom border; region: rounded-md, border
  lead?: string;                    // "Partial data:"
  message: string;                  // one or two sentences
  actions?: ReadonlyArray<{ label: string; href?: string; onAction?: () => void }>;   // up to 2
  dismissId?: string | null;        // only for non-critical info banners
  liveOnAppear?: boolean;           // role status (info, warning) or alert (negative) when it appears mid-session
  more?: ReadonlyArray<{ tone: BannerProps['tone']; message: string }>;   // "2 more notices" disclosure
}
```

- **Variants:** `tone` 3 values (icons `Info`, `TriangleAlert`, `CircleX`).
- **States:** shown, dismissed (stored per user and condition), collapsed extras; at most 2 page banners, order negative, warning, info.
- **A11y:** banners present at first render have no live role; never dismissed by a timer.
- **Use:** partial data, stale above 5%, provider failure, integration access lost, budget blocked, anomaly hold, read-only role, consequence notices in settings. **Not for:** confirmations (toast), forms or charts inside, field errors.

### 11.11 NotCollected
`app/metric/value-states.tsx` · V1 · [17 §8](17-empty-loading-error-states.md)

Purpose: no run has completed for the scope yet.

```ts
interface NotCollectedProps { form: 'cell' | 'tile' | 'inspector'; firstCheckAt: IsoInstant | null; timeZone: string; cadenceText: string }
```

- **Rendering:** cell "Pending" in `foreground-tertiary`; tile and inspector "First check scheduled for Sep 30, 02:00 CEST". **A11y:** "Not collected yet, first check Sep 30, 02:00". Sorts last; CSV writes empty plus `not_collected`.
- **Use:** any value before its first run. **Not for:** zero results (a real 0 or `EmptyState`).

### 11.12 InsufficientData
`app/metric/value-states.tsx` · V1 · [17 §8](17-empty-loading-error-states.md), [23 §8.4](23-application-patterns.md)

Purpose: the one rendering of "below the minimum sample".

```ts
interface InsufficientDataProps { form: 'cell' | 'tile' | 'inspector'; valid: number; required: number; noun: SampleNoun; cellWidthPx?: number }
```

- **Rendering:** hatched background (1 px diagonal `border-subtle` lines, 4 px apart, on `surface-subtle`; section 23, item 13); cell text "Insufficient", or the count ("3 obs") under 88 px; tile and inspector "Insufficient data" plus the counts line (section 23, item 14).
- **A11y:** "Insufficient data, 3 of 4 required observations"; in forced colors the text remains when hatching disappears. Sorts last. **Not for:** 0 values or grey empty cells.

### 11.13 NotApplicable
`app/metric/value-states.tsx` · V1 · [17 §8](17-empty-loading-error-states.md)

Purpose: the measured surface did not exist (AI Overview citation rate with no AI Overview in window).

```ts
interface NotApplicableProps { form: 'cell' | 'tile' | 'inspector'; shortText: string; reason: string; presenceText?: string }   // "No AIO", "No AI Overview in window", "present in 0 of 28 checks"
```

- **Rendering:** cell `shortText` in `foreground-tertiary` (never a blank cell; section 23, item 15); tile and inspector the reason with presence rate. **A11y:** "Not applicable, no AI Overview in window". Sorts last.
- **Not for:** engines not enabled (`n/a` with reason in `EngineMetricCell`).

### 11.14 BeyondDepth
`app/metric/value-states.tsx` · V1 · [17 §8](17-empty-loading-error-states.md)

Purpose: rank is null at a requested depth.

```ts
interface BeyondDepthProps { form: 'cell' | 'tile' | 'inspector'; obs: RankObservation; checkedAt: IsoInstant | null; timeZone: string }
```

- **Rendering:** cell `formatRankCell(obs)` (`>20`) in `foreground-tertiary`; tile and inspector `formatRankInline(obs)` ("not in top 20") as text (section 23, item 16). **A11y:** `describeRank(obs)`; tooltip "Checked to depth 20 on Sep 29; not found". Sorts after all ranked values.
- **Use:** inside `RankCell` and rank tiles. **Not for:** not-yet-checked keywords (`NotCollected`).

### 11.15 CollectionIssue
`app/metric/value-states.tsx` · V1 · [17 §8.1](17-empty-loading-error-states.md)

Purpose: a qualifier after a value whose valid-observation rate is below 90% or whose stale flag is set; the value stays visible.

```ts
interface CollectionIssueProps { message: string; runHref?: string | null }   // "Only 81% of answers were valid in this run."
```

- **Rendering:** 14 px `TriangleAlert` in `warning-text`; a link to the run for users who can see runs, otherwise a tooltip. **A11y:** named by the message. **Not for:** failed collection of the whole page (`Banner`).

### 11.16 UncertainFootnote
`app/metric/value-states.tsx` · V1 · [17 §8.1](17-empty-loading-error-states.md)

Purpose: `type-meta` line under a tile or section: "12 uncertain mentions excluded", linking to the review list.

```ts
interface UncertainFootnoteProps { count: number; text: string; reviewHref: string }
```

- **A11y:** a link. **Use:** AI rate tiles and sections with excluded uncertain spans. **Not for:** insufficient samples.

## 12. Data: events, alerts and activity

### 12.1 EventTimeline
`app/status/event-timeline.tsx` · V1 · [18 §7](18-notifications-alerts.md) (structure), [23 §9.1](23-application-patterns.md) (section 23, item 62)

Purpose: dated events for one object (keyword, prompt, page, integration, run) with the source that proves each event.

```ts
type TimelineEventKind = 'rank' | 'url' | 'serp_feature' | 'ai_citation' | 'ai_mention' | 'competitor' | 'version' | 'alert';
interface TimelineEvent { id: string; kind: TimelineEventKind; date: BusinessDate; text: string; severity?: Severity; valueTone?: ChangeTone; source: { label: string; href: string } }
interface EventTimelineProps {
  events: readonly TimelineEvent[];
  filter: 'all' | readonly TimelineEventKind[]; onFilterChange: (filter: 'all' | readonly TimelineEventKind[]) => void;
  pageSize: 10 | 50;                // inspector latest 10 with "Open full timeline" (16 §2.4 cap); pages 50 with "Show older events"
  onLoadMore?: () => void;
  highlightId?: string | null;      // event from a notification link
}
```

- **Variants:** none (64 px date column shown on a day's first event, 14 px glyph from 18 §7, `type-body` text with "→" between values, source link right; rows min 28 px; no rail, dots or cards).
- **States:** loading, events, empty ("No events in this window"), loading more, highlighted event.
- **A11y:** one `section` per day with a visually hidden `h4`; `ol` of events; `<time datetime>`; filter toggles are `CountTabs` (section 3.45), a `Toolbar` of toggle items.
- **Use:** keyword inspector Timeline tab, prompt inspector History tab, Keyword Detail, Prompt Detail History, integration sync history. **Not for:** project-wide changes (`ChangeFeed`), alert management (`AlertEventsTable`).

### 12.2 ChangeFeed
`features/overview/components/change-feed.tsx` · V1 · [23 §9.2](23-application-patterns.md)

Purpose: Overview "Key changes": at most 8 items grouped Needs attention, Changes, Notices.

```ts
interface ChangeFeedItem { id: string; group: 'needs_attention' | 'changes' | 'notices'; glyph: LucideIcon; text: string; delta?: { kind: 'metric'; input: MetricDeltaInput } | { kind: 'rank'; change: RankChange }; timeText: string; href: string }
interface ChangeFeedProps { items: readonly ChangeFeedItem[]; totalText: string; viewAllHref: string; windowText: string }
```

- **Variants:** none. Each group (Needs attention, Changes, Notices) has a 48 px header row: name in `type-subsection-title` plus the count in `type-meta` ("Needs attention · 3"). Rows 36 px: time (`type-meta num`), 16 px glyph (`TrendingUp` in `positive-text` or `TrendingDown` in `negative-text` for rank moves, `foreground-tertiary` otherwise), sentence in `type-body` with entity names in weight 500 and links in `primary-text`, neutral type `Badge`, source in `type-meta`, right-aligned "View" link. **States:** items, empty ("No detectable changes in the last 28 days"), anomaly hold notice line.
- **A11y:** group headers with counts; each item a link to its evidence. **Use:** Overview only. **Not for:** per-object history (`EventTimeline`); undetectable AI changes (excluded).

### 12.3 SeverityIcon (SeverityLabel)
`app/status/severity.tsx` · V1 · [18 §2](18-notifications-alerts.md)

Purpose: alert severity as icon plus text: Info (`Info`), Warning (`TriangleAlert`), Critical (`OctagonAlert`).

```ts
interface SeverityIconProps { severity: Severity; form: 'icon' | 'icon-and-label'; size?: 'sm' | 'md' }   // 14 or 16 px
```

- **Variants:** `size` 2 values. **A11y:** icon form carries an accessible name ("Critical"). Sort order critical, warning, info.
- **Use:** notification items, alert event rows, timelines. **Not for:** run status (`StatusBadge`); `OctagonAlert` is reserved for critical severity.

### 12.4 AlertEventsTable
`features/alerts/components/alert-events-table.tsx` · V1 · [18 §6](18-notifications-alerts.md)

Purpose: the Alerts events screen table, grouped by rule and date, with acknowledge.

```ts
interface AlertEventRow { id: string; ruleId: string; ruleName: string; severity: Severity; title: string; valuesText?: string; valueTone?: ChangeTone; entity: { type: InspectorType; id: string; label: string }; project?: string; occurredAt: IsoInstant; status: 'new' | 'acknowledged' | 'held' | 'muted'; statusDetail?: string }
interface AlertEventsTableProps { rows: readonly AlertEventRow[]; canAcknowledge: boolean; onAcknowledge: (ids: readonly string[]) => void; onOpenEntity: (row: AlertEventRow) => void; workspaceWide: boolean; timeZone: string }
```

- **Variants:** a `DataTable` configuration. **States:** grouped (expansion in the URL), held rows in `foreground-secondary`, muted with "until Oct 6", bulk acknowledge (sent in requests of up to 500).
- **A11y:** as `DataTable`; row click opens the entity inspector with the event highlighted in its Timeline tab. **Use:** `alerts/events`. **Not for:** the notification panel.

### 12.5 AnomalyHoldNotice
`app/status/anomaly-hold-notice.tsx` · V1 · [18 §8.3](18-notifications-alerts.md)

Purpose: states that alerts for a day are held after mass rank movement, naming both explanations without guessing.

```ts
interface AnomalyHoldNoticeProps { date: BusinessDate; movedShareText: string; heldCountText: string; surface: 'alerts' | 'rankings' | 'notification'; reviewHref?: string }
```

- **Variants:** none (a warning `Banner` on Alerts, an info `Banner` on Rankings and Overview, a warning `NotificationItem` in the bell). **A11y:** as its host. **Use:** any held day in the window. **Not for:** individual events.

### 12.6 DigestView
`features/alerts/components/digest-view.tsx` · V1 · [18 §8.2](18-notifications-alerts.md)

Purpose: renders a sent digest as it was sent: groups by rule, top 20 items, escaped text, "Sent Sep 29, 09:00 CEST to email (4 recipients) and Slack (#seo-alerts)".

```ts
interface DigestViewProps { sentText: string; anomalyHold: boolean; groups: ReadonlyArray<{ ruleName: string; items: ReadonlyArray<{ text: string; href: string }>; moreHref?: string }> }
```

- **A11y:** headings per group, lists. **Use:** `alerts/digests/[id]`. **Not for:** live events.

### 12.7 TriageToast
`app/status/triage-toast.ts` · V1 · [23 §10.3](23-application-patterns.md)

Purpose: the Undo toast for triage and reversible bulk actions; merges repeated actions of the same kind ("Accepted 3 keywords").

```ts
interface TriageToastOptions { kind: 'accept' | 'reject' | 'snooze' | 'archive' | 'remove_tag'; countText: string; nounText: string; onUndo: () => Promise<void> }
declare function triageToast(options: TriageToastOptions): string;   // returns the toast id
```

- **States:** shown until dismissed or Undo is used (section 23, item 25); failure toast "Could not accept crm pricing tool. Try again.". **A11y:** polite; the Undo button shows no shortcut hint (no Undo shortcut exists, 20 §14); the action remains reversible from status views after the toast closes.
- **Use:** Archive in Rankings, triage in Discover (Later screens). **Not for:** irreversible actions (`ConfirmDialog`).

### 12.8 RuleList
`features/alerts/components/rule-list.tsx` · V1 · [23 §9.4](23-application-patterns.md), [visual-spec §5](reference/visual-spec.md)

Purpose: a panel listing alert rules, each with an immediate on or off `Switch`.

```ts
interface RuleListItem {
  id: string;
  icon: LucideIcon;                 // 16 px, 07 §6 assignment for the rule kind
  title: string;                    // "Lost top 10"
  description: string;              // one line: "Any keyword leaves the top 10 · Email and Slack"
  enabled: boolean;
  busy?: boolean;                   // mutation pending after 400 ms
  href?: string;                    // rule editor
  disabledReason?: string | null;   // "Only admins can change alert rules"
}
interface RuleListProps {
  title: string;                    // "Alert rules", type-inspector-title
  items: readonly RuleListItem[];
  onEnabledChange: (id: string, enabled: boolean) => void;   // saves immediately; optimistic
  action?: Slot;                    // "New rule" button in the title row
}
```

- **Variants:** none. Panel (`surface`, 1 px `border`, radius 8, 16 px padding) with the title in `type-inspector-title` (18/26). Rows: 16 px icon, title 14 px weight 600 (`type-subsection-title`), description `type-meta` (13 px tertiary), `Switch` (36 x 20) on the right.
- **States:** rules, empty (inline `EmptyState` with "New rule"), switch busy, switch failed (reverted, error line under the row), disabled with reason.
- **A11y:** `ul`; each switch is labeled by the rule title and described by its description; the title is a link to the rule editor when `href` is set.
- **Use:** the Alerts screen rule column, alert rule settings.
- **Not for:** settings forms with a save bar (checkboxes, section 4.10), alert events (`AlertEventsTable`), editing a rule (its editor page).

## 13. Data: setup and integrations

### 13.1 SetupChecklist
`features/overview/components/setup-checklist.tsx` · V1 · [23 §13](23-application-patterns.md)

Purpose: compact onboarding checklist on Overview until the project's steps are complete.

```ts
interface SetupChecklistProps {
  steps: ReadonlyArray<{ id: string; name: string; done: boolean; fact?: string; action?: { label: string; href: string } }>;
  progressText: string;             // "Setup: 4 of 9 steps complete"
  expanded: boolean; onExpandedChange: (expanded: boolean) => void;
  onDismiss?: () => void;           // only when complete
  continueHref: string;
}
```

- **Variants:** none. **States:** collapsed 40 px bar with 64 px `Progress`, expanded list of 32 px rows (`CircleCheck` done, `Circle` to do), complete (dismissible, permanent per project).
- **A11y:** disclosure "Show steps"; list. **Use:** Overview only. **Not for:** banners on other pages (their empty states name the missing step), card grids.

### 13.2 ConnectionStatus
`features/integrations/components/connection-status.tsx` · Later · [24 §7](24-page-templates.md)

Purpose: integration connection row: status badge, account, property, connected by, since.

```ts
interface ConnectionStatusProps { status: 'connected' | 'reauth_required' | 'revoked' | 'not_connected'; account?: string; property?: string; connectedBy?: string; sinceText?: string }
```

- **A11y:** `KeyValueTable` semantics with a `StatusBadge`. **Status note:** first-party integrations are phase 12. **Not for:** run status.

### 13.3 ScopeList
`features/integrations/components/scope-list.tsx` · Later · [24 §7](24-page-templates.md)

Purpose: plain-language list of an integration's access, with raw OAuth scope strings only in tooltips.

```ts
interface ScopeListProps { scopes: ReadonlyArray<{ sentence: string; raw: string; used: boolean }> }
```

- **A11y:** list; raw strings in tooltips. **Status note:** phase 12. **Not for:** permissions of workspace roles.

## 14. SEO components

### 14.1 RankDelta
`app/metric/rank-delta.tsx` · V1 · [14 §5](14-badges-status.md), [22 §3](22-content-formatting.md)

Purpose: inline rank change outside tables (strip items, inspector, timelines): `formatRankChange(change)` gives text, label and tone. Ranks use arrows; metrics use signs; never both.

```ts
interface RankDeltaProps {
  change: RankChange;
  size?: 'sm' | 'md';               // md: type-body-strong in strips
  context?: { previous: RankObservation | null; current: RankObservation; normalMovement: number | null };   // tooltip
}
```

- **Variants:** `size` 2 values. **States:** as `RankDeltaCell`; first check renders nothing visible and the accessible text "first check".
- **A11y:** `display.text` `aria-hidden`, `display.label` in `sr-only`. **Use:** keyword strip item, competitor ranks in inspectors, change feeds. **Not for:** table columns (`RankDeltaCell`), rates (`Delta`).

### 14.2 RankTrend
`app/sparkline/rank-trend.tsx` · V1 · [15 §9](15-data-visualization.md), [24 §9.3](24-page-templates.md)

Purpose: `SparklineCell` preset for ranks: 30 checks, inverted, fixed scale 1 to 20 per table, beyond-depth checks break the line.

```ts
interface RankTrendProps { checks: ReadonlyArray<{ date: BusinessDate; obs: RankObservation }>; scaleMax: 20 | 100; density: Density }
```

- **States:** data, gaps, empty. **A11y:** summary "Rank trend, last 30 checks: from 9 to 4, best 3, 2 checks not in top 20". **Use:** Rankings Trend column. **Not for:** rate trends (`SparklineCell` with `invert: false`).

### 14.3 RankDistribution
`app/seo/rank-distribution.tsx` · V1 · [24 §9.2](24-page-templates.md), [15 §5](15-data-visualization.md)

Purpose: one-snapshot distribution of checked keywords across rank buckets as a `BarList` in `distribution` mode with `rank-band-*` bars and counts, "Not in top 20" hatched.

```ts
interface RankDistributionProps { counts: Readonly<Record<RankBucket, number>>; checkedText: string; depthNote?: string; bucketHref: (bucket: RankBucket) => string }   // buckets from RANK_BUCKETS
```

- **States:** data, pending. **A11y:** HTML list with counts; bars `aria-hidden`. **Use:** Overview side list, Rank filter facets. **Not for:** distribution over time (`RankDistributionChart`).

### 14.4 SERPFeatureBadge
`app/seo/serp-feature-badge.tsx` · V1 · [14 §6](14-badges-status.md)

Purpose: one SERP feature with 12 px icon and short label; owned features in `primary-text` with a `primary-border` outline.

```ts
type SerpFeature = 'ai_overview' | 'featured_snippet' | 'paa' | 'local_pack' | 'images' | 'video' | 'top_stories' | 'knowledge_panel' | 'shopping' | 'discussions' | 'sitelinks' | 'ads';
interface SERPFeatureBadgeProps { feature: SerpFeature; owned: boolean; position?: number | null }
```

- **Variants:** none (neutral subtle, or owned). **A11y:** text label; "owned" in text. **Use:** inspector SERP tab, expanded feature lists. **Not for:** table cells (`SERPFeatureList`).

### 14.5 SERPFeatureList
`app/seo/serp-feature-list.tsx` · V1 · [12 §6](12-tables.md), [14 §6](14-badges-status.md)

Purpose: up to 5 fixed-slot 14 px feature icons in a cell (owned in `primary-text`, present in `foreground-muted`), then `+2`; or the expanded labeled form. Formerly called `FeatureIconsCell` in 20 §19 (section 23, item 48).

```ts
interface SERPFeatureListProps { features: ReadonlyArray<{ feature: SerpFeature; owned: boolean; position?: number | null }>; form: 'icons' | 'labels'; max?: 5 }
```

- **States:** none, some, overflow. **A11y:** a list named "SERP features" whose items read "Featured snippet, owned. People also ask. Video"; owned state is in text, not fill alone. **Use:** `col.features`, inspector. **Not for:** single features in prose (`SERPFeatureBadge`).

### 14.6 KeywordIntentBadge
`app/seo/keyword-intent-badge.tsx` · V1 · [14 §2](14-badges-status.md)

Purpose: neutral intent badge (Informational, Commercial, Transactional, Navigational), with a "Manual" marker when overridden.

```ts
interface KeywordIntentBadgeProps { intent: 'informational' | 'commercial' | 'transactional' | 'navigational'; source: 'provider' | 'manual' }
```

- **Variants:** none (always neutral subtle). **A11y:** text; "Manual" in tooltip and accessible name. **Use:** `col.badge` intent, inspector. **Not for:** colored categories (never).

### 14.7 SearchVolumeCell
`app/cells/search-volume-cell.tsx` · V1 · [22 §2](22-content-formatting.md), [24 §9.3](24-page-templates.md)

Purpose: `NumberCell` preset for search volume: exact in tables, `Estimate` in the header tooltip, source and month in the cell tooltip.

```ts
interface SearchVolumeCellProps { volume: number | null; sourceText: string; monthText: string; estimate: true }   // "Google Ads, Aug 2026"
```

- **States:** value, `n/a` (not yet fetched: "Pending"). **A11y:** "12,400, estimated". **Use:** `col.volume`. **Not for:** AI demand estimates (label "AI demand" with `Estimate`, never "volume").

### 14.8 RankingURLCell
`app/cells/ranking-url-cell.tsx` · V1 · [24 §9.3](24-page-templates.md)

Purpose: `URLCell` preset for the ranking URL: host hidden (single domain), `+1` when two owned URLs rank, target mismatch icon.

```ts
interface RankingURLCellProps { url: DisplayUrl | null; additionalOwnedUrls: number; target?: DisplayUrl | null }
```

- **States:** ranking, not ranking ("(none)" as `Not ranking`), mismatch, cannibalization (`+1` with tooltip listing URLs). **A11y:** as `URLCell`. **Use:** Rankings. **Not for:** cited URLs (`URLCell` with host).

### 14.9 TargetURLIndicator
`app/seo/target-url-indicator.tsx` · V1 · [12 §6](12-tables.md), [23 §4.1](23-application-patterns.md)

Purpose: states whether the ranking URL matches the keyword's target URL: a 12 px icon in `KeywordCell`, or "Target /pricing · Mismatch" text in the inspector.

```ts
interface TargetURLIndicatorProps { target: DisplayUrl | null; ranking: DisplayUrl | null; form: 'icon' | 'inline' }
```

- **States:** no target, match, mismatch, not ranking. **A11y:** icon named "Target URL mismatch: ranking /blog/crm, target /pricing". **Use:** keyword rows and inspector. **Not for:** red color (neutral `foreground-muted` icon; it is a fact, not a verdict).

### 14.10 CannibalizationIndicator
`app/seo/cannibalization-indicator.tsx` · V1 · [12 §6](12-tables.md), [24 §9.4](24-page-templates.md)

Purpose: flags a keyword where several owned URLs compete, with evidence labeled as a hypothesis.

```ts
interface CannibalizationIndicatorProps { urls: readonly DisplayUrl[]; evidenceHref: string; form: 'icon' | 'inline' }
```

- **A11y:** icon named "Possible cannibalization: 2 owned URLs"; inline form uses the word "hypothesis". **Use:** keyword rows, Keyword Detail URL section, Pages Cannibalization tab. **Not for:** causal claims.

### 14.11 RankingHistoryChart (alias)

Alias of `RankHistoryChart` (section 10.4). Code, imports and documentation use `RankHistoryChart` only.

### 14.12 CompetitorRankCell
`app/cells/competitor-rank-cell.tsx` · V1 · [24 §9.3](24-page-templates.md)

Purpose: `CompetitorCell` preset whose value is the competitor's rank for the row's keyword (Rankings "Competitor" column, one column per chosen competitor).

```ts
interface CompetitorRankCellProps { entity: EntityRef; rank: RankObservation | null; change?: RankChange | null }
```

- **States:** ranked, beyond depth (`>20`), not checked. **A11y:** "HubSpot rank 1". **Use:** Rankings competitor columns, Matrix "Leader SEO". **Not for:** rates (`CompetitorCell` with a rate).

### 14.13 AIOverviewStatus
`app/seo/ai-overview-status.tsx` · V1 · [12 §6](12-tables.md), [23 §7.1](23-application-patterns.md)

Purpose: AI Overview state measured in the SERP check: `Cited #2` (positive outline badge, own domain only), `Not cited` (neutral outline), `No AIO` (text, tertiary), `Not loaded`.

```ts
interface AIOverviewStatusProps {
  state: 'cited' | 'present_not_cited' | 'absent' | 'not_loaded' | 'pending';
  position?: number | null;         // own citation position
  sourcesCount?: number | null;
  competitorsCited?: readonly string[];
  presenceText?: string;            // "AIO in 0 of 28 checks" for the absent tooltip
}
```

- **States:** as listed. **A11y:** "AI Overview present, cited at position 2". **Use:** `col.aiOverview`, `SEOAIStatus` AIO slot, keyword strip item. **Not for:** AI Overview citation rates over time (`MetricCell` with `NotApplicable` when absent).

### 14.14 SERPPreview
`app/seo/serp-preview.tsx` · V1 · [19 §12.3](19-responsive-behavior.md), [06 §6](06-surfaces-borders-radius.md)

Purpose: preview of one SERP result (title, URL, snippet) in a snapshot viewer; one of the allowed card uses.

```ts
interface SERPPreviewProps { position: number; title: string; url: DisplayUrl; snippet?: string; role?: DomainRole; features?: readonly SerpFeature[] }
```

- **States:** container query: title and URL only in narrow containers. **A11y:** escaped text; external link through `ExternalLinkButton`. **Use:** Keyword Detail SERP snapshots, inspector SERP tab. **Not for:** lists of results to compare (table).

## 15. AI components

Mention and citation are separate facts everywhere: `MentionStatus` and `CitationStatus` (and `MentionRate` and `CitationRate`) are never merged into one component, value or color. Their joint distribution appears only as the four-outcome `OutcomeMixBar` (section 10.6). `EngineStatusGlyph` (section 15.24) draws one engine's latest status as one glyph, and its accessible name and tooltip always state both facts separately. Engine values are per engine; a cross-engine value is always labeled "Equal-weight average (n engines)". `ConfidenceIndicator` (section 9.5) and `SampleCount` (section 9.6) are shared with SEO and cost views and are not repeated here.

### 15.1 EngineBadge
`app/ai/engine-badge.tsx` · V1 · [14 §4](14-badges-status.md), [07 §5](07-icons.md)

Purpose: neutral text badge for an engine, with an optional leading `EngineLogo`; no brand colors. Adds a neutral outline observation class badge ("Consumer UI", "SERP AI", "Official API") where engines of different classes appear together.

```ts
interface EngineBadgeProps {
  engine: EngineCode;
  label?: 'short' | 'full';         // "AI Mode" or "Google AI Mode"
  observationClass: 'show' | 'hide';   // callers pass engineClassesMixed(visibleEngines) ? 'show' : 'hide'
  logo?: boolean;                   // leading EngineLogo; default false in dense tables
}

// app/ai/engine-logo.tsx: the vendor mark, 16 px, decorative because the engine name is always beside it
interface EngineLogoProps { engine: EngineCode; hidden?: boolean }
```

- **Variants:** none (neutral subtle; class badge neutral outline). **States:** none.
- **A11y:** text; class badge read after the engine name. **Use:** headers, cells, evidence headers, legends. **Not for:** chart colors (engines take categorical colors in fixed order only inside engine charts). `EngineLogo` rules (source, size, the monochrome OpenAI mark, the shared Google mark, where it may appear) are in [07 §5](07-icons.md).

### 15.2 MentionStatus
`app/ai/mention-status.tsx` · V1 · [23 §5](23-application-patterns.md), [07 §6](07-icons.md)

Purpose: whether the brand (or an entity) is mentioned in one observation: icon `AtSign` plus word.

```ts
interface MentionStatusProps { mentioned: boolean | null; entity?: EntityRef; uncertainExcluded?: number; form: 'icon-and-word' | 'word' }   // null: extraction pending
```

- **Variants:** none (neutral text; "Mentioned" neutral subtle badge in lists). **States:** mentioned, not mentioned, pending, with uncertain exclusions.
- **A11y:** "Mentioned: yes" or "Mentioned: no". **Use:** observation rows, `FactsFooter`, `ResponsePreview`. **Not for:** citations (`CitationStatus`), rates (`MentionRate`).

### 15.3 CitationStatus
`app/ai/citation-status.tsx` · V1 · [12 §6](12-tables.md)

Purpose: whether an own URL is cited in one observation or answer surface: `Cited #2` (positive outline, own domain only), `Not cited` (neutral), `No AI Overview` or "No citations surface" (text, tertiary). Icon `Link2`.

```ts
interface CitationStatusProps { state: 'cited' | 'not_cited' | 'no_surface' | 'pending'; position?: number | null; subject: 'own' | 'competitor' | 'third_party'; url?: DisplayUrl | null }
```

- **Variants:** none; a competitor or third party being cited is neutral (14 §2 rule 2).
- **A11y:** "Cited at position 2". **Use:** `CitationCell`, observation rows, `FactsFooter`. **Not for:** mention facts, AI Overview in SERP tables (`AIOverviewStatus`).

### 15.4 RecommendationStatus
`app/ai/recommendation-status.tsx` · V1 · [23 §5.5](23-application-patterns.md), [07 §6](07-icons.md)

Purpose: whether the answer presents the brand as a suggested choice, with confidence and method; icon `BadgeCheck`.

```ts
interface RecommendationStatusProps { recommended: boolean | null; confidence?: number | null; method?: 'rule' | 'model'; classified: boolean }   // "Yes (0.85)"
```

- **Variants:** none (neutral). **States:** yes, no, not classified, not mentioned (not applicable). **A11y:** "Recommended: yes, confidence 0.85, rule". **Use:** observation rows, `FactsFooter`. **Not for:** sentiment (separate four-share distribution, never a score).

### 15.5 PromptTypeBadge
`app/ai/prompt-type-badge.tsx` · V1 · [12 §6](12-tables.md), [14 §2](14-badges-status.md)

Purpose: neutral badge for prompt type (Question, Recommendation, Comparison, ...), hidden in Compact rows.

```ts
interface PromptTypeBadgeProps { type: string; label: string }   // type key from the contracts enum
```

- **Variants:** none (neutral subtle). **A11y:** text. **Use:** `PromptCell` (Comfortable density), inspector header meta. **Not for:** panels (neutral `Badge` "Core", "Discovery").

### 15.6 MentionRate
`app/ai/mention-rate.tsx` · V1 · [23 §2](23-application-patterns.md), [24 §9.5](24-page-templates.md)

Purpose: presets of `MetricItem` and `MetricCell` bound to `ai.mention_rate` for one engine, or to `ai.mention_rate.engine_average` with the label "Mention rate (avg of 3)".

```ts
interface MentionRateProps { value: MetricValue | MetricCellValue; engine: EngineCode | 'engine_average'; engines?: readonly EngineCode[]; form: 'item' | 'cell'; comparison?: MetricComparison | null }
```

- **States:** as `MetricCell` and `MetricItem` (insufficient under 4 valid observations). **A11y:** label names the engine. **Use:** strips, Prompt Explorer, engine columns. **Not for:** a pooled value across observation classes (rejected by the API).

### 15.7 CitationRate
`app/ai/citation-rate.tsx` · V1 · [23 §2](23-application-patterns.md), [24 §9.5](24-page-templates.md)

Purpose: as `MentionRate`, bound to `ai.citation_rate` (and AI Overview citation rate with `NotApplicable` when absent).

```ts
interface CitationRateProps { value: MetricValue | MetricCellValue; engine: EngineCode | 'engine_average'; engines?: readonly EngineCode[]; form: 'item' | 'cell'; comparison?: MetricComparison | null }
```

- **Use / Not for:** as `MentionRate`; never combined with mention rate into one number.

### 15.8 ProminenceIndicator
`app/ai/prominence-indicator.tsx` · V1 · [22 §9](22-content-formatting.md), [23 §5.5](23-application-patterns.md)

Purpose: how early the brand is first mentioned in an answer (0 to 1), as `formatDecimal(value, 2)` with a plain-words tooltip.

```ts
interface ProminenceIndicatorProps { value: number | null; firstMentionText?: string }   // "First mentioned in the first sentence"
```

- **States:** value, not mentioned (not applicable). **A11y:** "Prominence 0.92". **Use:** `FactsFooter`, prompt inspector. **Not for:** rank language ("position" is reserved for organic rank).

### 15.9 StructuredRank
`app/ai/structured-rank.tsx` · V1 · [22 §9](22-content-formatting.md), [23 §5.5](23-application-patterns.md)

Purpose: position in an ordered list inside an answer: "1 of 3".

```ts
interface StructuredRankProps { position: number | null; listLength: number | null }
```

- **States:** in list, not in a list (`n/a`). **A11y:** "Position 1 of 3 in the answer's list". **Use:** observation rows, `FactsFooter`. **Not for:** organic rank (`RankCell`); never called "AI rank".

### 15.10 ResponsePreview
`app/evidence/response-preview.tsx` · V1 · [23 §5.1](23-application-patterns.md)

Purpose: compact summary of one observation for lists and the inspector "Latest" tab.

```ts
interface ResponsePreviewProps {
  engine: EngineCode; collectedAt: IsoInstant; timeZone: string; replicateText: string; validity: 'valid' | 'invalid';
  blocks: readonly EvidenceBlock[];   // first 6 lines, line-clamped with an ellipsis, no fade
  mentions: ReadonlyArray<{ entity: EntityRef; count: number }>;
  citationCount: number;
  facts: { mentioned: boolean | null; cited: boolean | null; structuredRankText?: string };
  evidenceHref: string;             // "Open evidence"
  lang?: string;
}
```

- **States:** valid, invalid (greyed with reason, "Excluded from metrics"), loading. **A11y:** article with heading; highlights as in `EvidenceHighlight`. **Use:** prompt inspector, Prompt Detail. **Not for:** answer text in tables (never).

### 15.11 EvidenceViewer
`app/evidence/evidence-viewer.tsx` · V1 · [23 §5.2](23-application-patterns.md), [20 §19](20-accessibility.md)

Purpose: the composition that shows one answer with every extracted fact traceable: header, prompt line, `AnswerViewMode`, `EntityToggleList`, `EvidenceText`, `CitationList`, `FactsFooter`.

```ts
interface EvidenceViewerProps {
  observation: { id: string; engine: EngineCode; collectedAt: IsoInstant; replicateText: string; validity: 'valid' | 'invalid'; invalidReason?: string; promptVersionText: string; promptText: string; lang?: string };
  mode: 'evidence' | 'formatted' | 'raw'; onModeChange: (mode: 'evidence' | 'formatted' | 'raw') => void; canViewRaw: boolean;
  blocks: readonly EvidenceBlock[]; markdown?: string; raw?: string;
  entities: readonly EntityToggleItem[]; citations: readonly CitationListItem[]; facts: FactsFooterProps;
  timeZone: string;
}
```

- **Variants:** none; layout by container query (stacked in the 440 px wide inspector, side column at `@2xl`). **States:** loading (header bars plus 6 paragraph bars), each mode, invalid.
- **A11y:** article with headings and lists; `lang` on the answer; view mode is a radio group. **Use:** answer inspector, Prompt Detail Answers tab. **Not for:** rendering untrusted HTML (never).

### 15.12 EvidenceText
`app/evidence/evidence-text.tsx` · V1 · [23 §5.1](23-application-patterns.md), [23 §5.6](23-application-patterns.md)

Purpose: renders extractor blocks as React elements only, with highlight marks and citation markers.

```ts
type EvidenceBlock =
  | { kind: 'heading' | 'paragraph' | 'list_item'; spans: readonly EvidenceSpan[] }
  | { kind: 'table_row'; cells: ReadonlyArray<readonly EvidenceSpan[]> };
type EvidenceSpan = { kind: 'text'; text: string } | { kind: 'mention'; text: string; mention: EvidenceHighlightProps } | { kind: 'citation'; index: number };
interface EvidenceTextProps { blocks: readonly EvidenceBlock[]; hiddenEntityIds: ReadonlySet<string>; activeCitation?: number | null; onCitation: (index: number) => void; lang?: string; lineClamp?: 6 }
```

- **States:** full, clamped. **A11y:** `type-prose` (14/22), max 720 px line length on the full page. **Use:** inside evidence components. **Not for:** `dangerouslySetInnerHTML` (banned by lint).

### 15.13 EvidenceHighlight
`app/evidence/evidence-highlight.tsx` · V1 · [23 §5.3](23-application-patterns.md)

Purpose: `<mark>` for one entity mention span. Own brand: `primary-subtle` background with the text in `primary-text` weight 500. Competitors and other entities: `--entity-{n}-highlight` background, 2 px left border in `--chart-{n}`, text in `foreground`.

```ts
interface EvidenceHighlightProps { entity: EntityRef; matchType: string; confidence: number; certainty: 'certain' | 'uncertain'; viaProduct?: string }   // uncertain: dashed border, no background
```

- **States:** certain, uncertain ("Uncertain match, excluded from rates"), product mention ("HubSpot via Sales Hub"), hidden entity (plain text), entities beyond 6 (`chart-other`, dashed).
- **A11y:** `aria-label` "Northwind mention, word boundary match, confidence 0.95"; not focusable; the same text is in the entity list; forced colors use `Mark` and `MarkText`. **Not for:** search-term highlighting.

### 15.14 CitationMarker
`app/evidence/citation-marker.tsx` · V1 · [23 §5.4](23-application-patterns.md)

Purpose: superscript `[n]` button linked to the `CitationList` item: `primary-text` on `primary-subtle`, radius 3 (`rounded-xs`).

```ts
interface CitationMarkerProps { index: number; label: string; onActivate: (index: number) => void }   // label "Citation 2: g2.com"
```

- **States:** default, active (list item marked `surface-selected`). **A11y:** button; inline target exception to 24 px; activating scrolls the list item into view (smooth only when motion is allowed). **Not for:** footnotes in product copy.

### 15.15 EntityToggleList
`app/evidence/entity-toggle-list.tsx` · V1 · [23 §5.1](23-application-patterns.md)

Purpose: checkbox list of entities found in the answer with swatch and span count; toggles highlights.

```ts
interface EntityToggleItem { entity: EntityRef; spanCount: number; visible: boolean }
interface EntityToggleListProps { items: readonly EntityToggleItem[]; onToggle: (entityId: string, visible: boolean) => void; shared?: boolean }   // shared above both columns in AnswerCompare
```

- **A11y:** checkbox group with legend "Entities". **Use:** evidence viewer, `AnswerCompare`. **Not for:** entity filters (`FilterBar`).

### 15.16 CitationList
`app/evidence/citation-list.tsx` · V1 · [23 §5.4](23-application-patterns.md), [00 §5](00-design-principles.md)

Purpose: ordered, escaped list of an answer's citations.

```ts
interface CitationListItem { index: number; title: string; url: DisplayUrl; role: DomainRole; category?: string; ad: boolean; flags: ReadonlyArray<'unresolved_redirect' | 'engine_internal'> }
interface CitationListProps { items: readonly CitationListItem[]; activeIndex?: number | null; onShowInAnswer: (index: number) => void }
```

- **States:** default, active item, ad rows (`Ad` neutral outline, `foreground-tertiary`, "Excluded from metrics"), flagged rows; container query shows host, role, category columns from `@md`.
- **A11y:** `ol`; items named "Citation 2: g2.com"; Copy and Open on hover and focus; markers link both ways. **Use:** evidence viewer. **Not for:** citation analytics tables (`DataTable`).

### 15.17 FactsFooter
`app/evidence/facts-footer.tsx` · V1 · [23 §5.5](23-application-patterns.md)

Purpose: `surface-subtle` well with the extracted facts and derivation versions: the link between a rate and its evidence.

```ts
interface FactsFooterProps {
  mention: MentionStatusProps; citation: CitationStatusProps; recommendation: RecommendationStatusProps;
  structuredRank: StructuredRankProps; prominence: ProminenceIndicatorProps;
  sentiment?: 'positive' | 'neutral' | 'negative' | 'mixed' | null;
  extractorVersion: string; entityConfigVersion: string; derivationId: string;
}
```

- **A11y:** `KeyValueTable form="dl"`. **Use:** evidence viewer. **Not for:** aggregate metrics.

### 15.18 AnswerViewMode
`app/evidence/answer-view-mode.tsx` · V1 · [23 §5.1](23-application-patterns.md)

Purpose: `SegmentedControl size="sm"`: Evidence (default), Formatted, Raw (only with `raw:read`); not persisted in the URL.

```ts
interface AnswerViewModeProps { value: 'evidence' | 'formatted' | 'raw'; onValueChange: (mode: 'evidence' | 'formatted' | 'raw') => void; canViewRaw: boolean }
```

- **A11y:** radio group "Answer view". **Not for:** switching observations.

### 15.19 SafeMarkdown
`app/evidence/safe-markdown.tsx` · V1 · [23 §5.6](23-application-patterns.md)

Purpose: Formatted mode renderer: sanitized markdown with raw HTML disabled, unsafe schemes stripped, no images or embeds, no highlights.

```ts
interface SafeMarkdownProps { source: string; lang?: string }
```

- **A11y:** semantic headings and lists; links through `ExternalLinkButton variant="link"` with the host shown. **Not for:** product copy, Evidence mode.

### 15.20 AnswerCompare
`app/evidence/answer-compare.tsx` · Later · [23 §6.3](23-application-patterns.md)

Purpose: two observations of the same prompt side by side with a fact-based difference summary; URL `obs=<idA>&vs=<idB>`.

```ts
interface AnswerCompareProps { a: EvidenceViewerProps; b: EvidenceViewerProps; differenceText: string; syncScroll: boolean; onSyncScrollChange: (on: boolean) => void; onPickB: () => void }
```

- **States:** default B chosen ("latest observation where own brand was mentioned"), sync scroll off by default. **A11y:** two labeled articles ("Answer A", "Answer B").
- **Status note:** not in the phase 9 frontend deliverables of 20-frontend-specification §10; needs 1,000 px, never in the inspector. **Not for:** text diffing.

### 15.21 SourceDomainCell
`app/cells/source-domain-cell.tsx` · V1 · [24 §9.7](24-page-templates.md)

Purpose: `DomainCell` preset for citation and source tables: favicon, registrable domain, role badge (Own, Competitor, Third party), New or Lost outline badge, expandable to cited pages.

```ts
interface SourceDomainCellProps extends DomainCellProps { role: DomainRole; change?: 'new' | 'lost' | null; expandable?: { expanded: boolean; pageCountText: string } }
```

- **A11y:** row header; disclosure "Expand g2.com, 48 pages". **Use:** Citations Domains tab, Sources. **Not for:** keyword tables (no favicons there).

### 15.22 ObservationStatus
`app/ai/observation-status.tsx` · V1 · [23 §5.2](23-application-patterns.md)

Purpose: validity of one observation: `Valid` or `Invalid` with reason (refusal, error, ad-only), which greys the answer and says "Excluded from metrics".

```ts
interface ObservationStatusProps { validity: 'valid' | 'invalid'; reason?: string | null }
```

- **Variants:** `StatusBadge` statuses `valid` and `invalid`. **A11y:** word plus icon. **Use:** evidence header, observation tables. **Not for:** run status.

### 15.23 VolatilityIndicator
`app/ai/volatility-indicator.tsx` · V1 · [24 §9.6](24-page-templates.md)

Purpose: descriptive volatility figures (flip rate, citation Jaccard distance, within-run disagreement, SEO rank volatility) with their sample; never a verdict.

```ts
interface VolatilityIndicatorProps { kind: 'flip_rate' | 'citation_jaccard' | 'within_run_disagreement' | 'rank_volatility'; value: number | null; sampleText: string; minimumMet: boolean }   // below minimum renders InsufficientData
```

- **Variants:** none (neutral text, `formatDecimal`). **A11y:** "Flip rate 0.18 over 12 weeks". **Use:** Prompt Detail History, Rankings chooser column. **Not for:** colored stability judgments.

### 15.24 EngineStatusGlyph
`app/ai/engine-status-glyph.tsx` · V1 · [visual-spec §5](reference/visual-spec.md), [12 §6](12-tables.md) (`EngineCell`)

Purpose: one engine's answer status for a prompt as a small glyph, for prompt by engine tables. The glyph shows the stronger of two separate facts (cited, then mentioned); the accessible name and tooltip always state both facts.

```ts
interface EngineStatusGlyphProps {
  engine: EngineCode;
  mentioned: boolean | null;        // null: extraction pending
  cited: boolean | null;            // own URL cited
  enabled: boolean;                 // false renders n/a
  collectedAtText?: string | null;  // tooltip "Sep 29, 02:14"; null before the first run renders "Pending"
  citedUrl?: DisplayUrl | null;     // tooltip when cited
}
interface EngineStatusLegendProps { label: string }   // "Answer status"; shows the three glyphs with "Cited", "Mentioned", "Not mentioned"
```

- **Variants:** none. Centered in a fixed slot: cited is a 10 px filled `primary` circle; mentioned but not cited is a 10 px circle with a 2 px `primary` ring (`border-2`; there is no 1.5 px border utility, [visual-spec §6](reference/visual-spec.md)); not mentioned is a 6 px `foreground-muted` dot. `EngineStatusLegend` repeats the three glyphs with their labels in the page filter bar.
- **States:** cited, mentioned not cited, not mentioned, not enabled (`n/a`), pending (`Pending` in `foreground-tertiary`).
- **A11y:** `role="img"` with an accessible name per glyph ("ChatGPT: cited, mentioned", "Gemini: mentioned, not cited", "AI Mode: not mentioned, not cited"); the three shapes differ, so the state never depends on color alone.
- **Use:** inside `EngineCell` in prompt by engine status tables (Prompts), with the legend in the filter bar.
- **Not for:** rates (`EngineMetricCell`), presence without mention and citation facts (`EnginePresenceSquare`), a merged mention and citation rate (never).

### 15.25 EnginePresenceSquare
`app/ai/engine-presence-square.tsx` · V1 · [visual-spec §5](reference/visual-spec.md), [12 §6](12-tables.md)

Purpose: whether a cited URL or domain appears in one engine's answers, as one small square per engine in a row.

```ts
interface EnginePresenceSquareProps {
  engine: EngineCode;
  present: boolean | null;          // null: not yet collected
  enabled: boolean;                 // false renders n/a
  countText?: string | null;        // tooltip "Cited in 12 of 40 answers"
}
interface EnginePresenceRowProps { items: readonly EnginePresenceSquareProps[] }   // ENGINE_ORDER, enabled engines only
```

- **Variants:** none. 8 px square, `rounded-2xs` (2 px): `primary` fill when present, `border` fill when absent; squares sit in one row in engine order.
- **States:** present, absent, not enabled (`n/a`), pending.
- **A11y:** each square has an accessible name ("Gemini: present", "Gemini: absent"); the row is a list named "Engines"; presence and absence differ by fill lightness, and the tooltip and table view carry the counts.
- **Use:** per-engine presence columns, for example on Citations and Sources.
- **Not for:** answer status with mention and citation (`EngineStatusGlyph`), rates (`EngineMetricCell`), legends of chart series (`ChartFrame`).

### 15.26 QuoteBox
`app/evidence/quote-box.tsx` · V1 · [23 §4.4](23-application-patterns.md), [visual-spec §5](reference/visual-spec.md)

Purpose: a short excerpt from a collected answer or cited page, shown in an inspector as evidence.

```ts
interface QuoteBoxProps {
  text: string;                     // escaped plain text; rendered in typographic quotes
  source?: { label: string; href?: string } | null;   // "ChatGPT · Sep 29, 02:14" or the cited page
  lang?: string;                    // BCP 47 when the content is not English
}
```

- **Variants:** none. `surface-subtle` fill, 1 px `border-subtle`, `rounded-md` (6 px), 12 px padding (`p-3`), text at 13 / 20 px (the former `type-table` size; `type-table` is 12 / 16 since 2026-10-29 and is for tables only) inside typographic quotes; source line in `type-meta` below.
- **States:** default; long text wraps (no clamp inside the inspector section).
- **A11y:** `blockquote` with the source as `cite` text; `lang` on the quote; untrusted content rules of 23 §5.6 apply (React text only).
- **Use:** the sentence that mentions the brand, the citation context, a short answer excerpt in prompt, citation and answer inspectors.
- **Not for:** full answers (`EvidenceText`), highlighted mentions (`EvidenceHighlight` inside `EvidenceText`), product copy.

### 15.27 DomainChip
`app/ai/domain-chip.tsx` · V1 · [23 §4.4](23-application-patterns.md), [visual-spec §5](reference/visual-spec.md)

Purpose: cited source domains as a row of static chips, with a "+2" overflow chip.

```ts
interface DomainChipProps { domain: string; href?: string }   // displayDomain output; href opens the domain inspector
interface DomainChipListProps {
  label: string;                    // list name: "Cited sources"
  domains: readonly DomainChipProps[];
  max: number;                      // visible chips; the rest collapse into "+{n}" (formatInteger)
}
```

- **Variants:** none. Neutral badge style: 22 px (`h-badge`), `neutral-subtle` fill, `neutral-text` label in `type-micro`, `rounded-sm` (4 px), 8 px horizontal padding; the overflow chip has the same style.
- **States:** default, link hover and focus (underline, as `TextLink`), overflow.
- **A11y:** `ul` named by `label`; chips with `href` are links; the overflow chip is a button named "2 more cited domains" that opens a `Popover` listing them.
- **Use:** cited sources in the prompt and answer inspectors and in evidence headers.
- **Not for:** filters (`FilterChip`), removable values (`Tag`), table cells (`DomainCell`), categorical metadata (`Badge`).

## 16. Cross-channel components

Channels stay separate ([00-design-principles.md](00-design-principles.md) P9). No component in this section computes, displays or colors a combined SEO and AI score.

### 16.1 SEOAIStatus
`app/cross/seo-ai-status.tsx` · V1 · [23 §7.1](23-application-patterns.md)

Purpose: organic rank, AI Overview status and per-engine AI presence for one keyword or page, side by side, descriptive only.

```ts
interface SEOAIStatusProps {
  form: 'columns' | 'inline';       // columns: 5 sub-columns under a 24 px group header; inline: one type-body line
  rank: RankCellProps | { state: 'not_tracked'; reason: string };
  aio: AIOverviewStatusProps;
  engines: ReadonlyArray<{ engine: EngineCode; value: MetricCellValue | null; reason?: 'not_in_scope' | 'not_enabled' | 'no_linked_prompts' | 'pending' | null }>;   // fixed order, in scope only
  metric: MetricKey;                // default ai.mention_rate over linked active prompts
}
```

- **Variants:** none; `form` is structural.
- **States per engine slot:** rate, insufficient per engine (hatched, "3 obs"), `n/a` with reason, pending. Rank slot: ranked, beyond depth, not tracked, pending. AIO slot: cited, not cited, no AIO, not loaded.
- **Rules:** the three slots are never combined into a score, color or quadrant; no slot is colored by value except the own-domain `Cited #n` badge; rank change is not part of it.
- **A11y:** inline form reads "Rank 7, AI Overview cited at position 2, ChatGPT 47%, Gemini 12%, AI Mode not applicable". **Use:** topic and page keyword lists, keyword inspector AI tab, prompt inspector related keywords, Matrix tooltip. **Not for:** the Matrix table (`SEOAIComparisonRow`), quadrant membership (`QuadrantSummary`).

### 16.2 SEOAIComparisonRow
`app/cross/seo-ai-comparison-row.ts` · V1 · [23 §6.2](23-application-patterns.md)

Purpose: the row model and column set for tables that put one keyword's SEO and AI measurements side by side, with group header rows (SEO, AI, Context).

```ts
interface SEOAIComparisonRowData {
  keywordId: string; keyword: KeywordCellProps; volume: SearchVolumeCellProps;
  seo: { rank: RankCellProps; change: RankDeltaCellProps; aio: AIOverviewStatusProps };
  ai: Readonly<Partial<Record<EngineCode, EngineMetricCellProps>>>;
  context: { ownedPageCited: URLCellProps; leaderSeo: CompetitorRankCellProps | null; leaderAi: CompetitorCellProps | null; condition: OpportunityStatusProps | null; quadrant: QuadrantLabel | null };
  otherDevice?: boolean;
}
declare function seoAiComparisonColumns(engines: readonly EngineCode[]): ReadonlyArray<ColumnDef<SEOAIComparisonRowData>>;
```

- **Rules:** column groups render a 24 px group header row; vertical 1 px `border-subtle` dividers only between header cells, none in body rows (as `DataTable`); quadrant is a neutral badge. **A11y:** group headers use `colspan` headers. **Use:** Matrix table, Topic keyword lists, Page Intelligence keyword lists. **Not for:** merged channel columns.

### 16.3 SEOAIMatrix
`app/cross/seo-ai-matrix.tsx` · V1 · [15 §8](15-data-visualization.md), [24 §9.9](24-page-templates.md)

Purpose: the signature composition: definition line, `QuadrantSummary`, `MatrixScatter`, and the linked `SEOAIComparisonRow` table.

```ts
type QuadrantLabel = 'Strong in both' | 'SEO strong, AI weak' | 'AI strong, SEO weak' | 'Weak in both';
type UnclassifiedLabel = 'Near threshold' | 'Insufficient data' | 'Not tracked in location';
interface MatrixThresholds { seoStrongRank: number; seoWeakRank: number; aiStrong: number; aiWeak: number }   // defaults 10, 20, 0.5, 0.1
interface SEOAIMatrixProps {
  definitionText: string;           // always visible, also in exports
  thresholds: MatrixThresholds; onThresholdsChange: (t: MatrixThresholds) => void;   // popover with Slider plus NumberInput
  metric: MetricKey; engines: readonly EngineCode[];
  summary: QuadrantSummaryProps; scatter: MatrixScatterProps; table: Slot;
  quadrantFilter: QuadrantLabel | null; onQuadrantFilterChange: (q: QuadrantLabel | null) => void;   // writes quad= as a chip
}
```

- **States:** loading, ready, below 1024 px (scatter replaced by summary and table), touch phone ("Open on desktop for the matrix chart").
- **A11y:** chart plus quadrant summary table; threshold slider paired with numeric inputs; box selection has the quadrant list and table as alternatives. **Use:** `/matrix`. **Not for:** a combined score, red or green quadrants, evaluative labels ("Dominant", "Opportunity").

### 16.4 MatrixScatter
`app/chart/matrix-scatter.tsx` · V1 · [15 §8](15-data-visualization.md)

Purpose: scatter of organic rank (log ticks 100 to 1, better to the right, 48 px "Not ranking" strip) against AI presence 0 to 100%.

```ts
interface MatrixScatterProps {
  points: ReadonlyArray<{ id: string; label: string; rank: RankObservation; aiPresence: number | null; volume: number; insufficient: boolean }>;
  thresholds: MatrixThresholds;
  selectedIds: ReadonlySet<string>; onSelect: (ids: ReadonlySet<string>) => void;   // box select
  onOpen: (id: string) => void;     // inspector
  height: 400 | 480;
}
```

- **States:** points `chart-reference` at 60%, hovered or selected `chart-1`, insufficient hollow and excluded from counts; threshold lines dashed `border-strong` with "Near threshold" bands on `surface-subtle`.
- **A11y:** container focusable because it offers selection; tooltip gives keyword, rank, AI presence with n and interval, volume, quadrant. **Not for:** colored quadrants.

### 16.5 QuadrantSummary
`app/cross/quadrant-summary.tsx` · V1 · [15 §8](15-data-visualization.md), [23 §2.5](23-application-patterns.md)

Purpose: 2 x 2 `MetricCard` grid (the one justified card grid): count, volume represented and share per quadrant, plus the unclassified groups; clicking filters.

```ts
interface QuadrantSummaryProps {
  quadrants: ReadonlyArray<{ label: QuadrantLabel; countText: string; volumeText: string; shareText: string }>;   // positioned: top-left AI strong SEO weak, top-right Strong in both, bottom-left Weak in both, bottom-right SEO strong AI weak
  unclassified: ReadonlyArray<{ label: UnclassifiedLabel; countText: string }>;
  selected: QuadrantLabel | null; onSelect: (q: QuadrantLabel | null) => void;
  subjectNoun: 'keywords' | 'clusters' | 'pages';
}
```

- **States:** none selected, one selected (`aria-pressed`), empty counts shown as 0 only when classified (unknown groups are separate).
- **A11y:** also exposed as a table "Quadrant summary"; cards are toggle buttons. **Use:** Matrix, Overview S3 (click opens the Matrix filtered). **Not for:** other card grids.

### 16.6 OpportunityStatus
`app/cross/opportunity-status.tsx` · V1 · [23 §7.3](23-application-patterns.md)

Purpose: names the first documented cross-channel condition a keyword, page or prompt meets, as a neutral label linked to its evidence. Descriptive, never causal.

```ts
type OpportunityCondition =
  | 'Top 3, not cited in AIO' | 'Top 10, no AI mentions' | 'Cited, weak rank' | 'Ranks, page not cited'
  | 'Competitor ahead in both' | 'AIO present, not ranking' | 'Near threshold';
interface OpportunityStatusProps {
  condition: OpportunityCondition;
  ruleText: string;                 // the rule with thresholds in plain words
  evidence: ReadonlyArray<{ label: string; valueText: string; href: string }>;   // values that met it, with k of n
  nextStepHypothesis?: string;      // shown on its own line as "Typical next step (hypothesis)"
}
```

- **Variants:** none (`Badge` neutral outline, no icon, at most one per row). **States:** closed, evidence popover open (360 px).
- **Wording:** labels describe observed conditions; "opportunity", "quick win", "losing", "because", "due to", "driving" and "should" are not allowed. Never semantic color. Sorted by volume represented.
- **A11y:** a button opening the popover ("Top 3, not cited in AIO. Show evidence"). **Use:** Matrix Condition column, Overview list, Discover Opportunities (Later). **Not for:** recommendations without evidence.

### 16.7 KeywordPromptLink
`app/cross/keyword-prompt-link.tsx` · V1 · [23 §4.2](23-application-patterns.md), [24 §9.4](24-page-templates.md)

Purpose: one link between a keyword and a prompt with its source and status, and the linked side's values (rank with AIO, or per-engine `k of n`).

```ts
interface KeywordPromptLinkProps {
  direction: 'keyword-to-prompt' | 'prompt-to-keyword';
  target: { id: string; label: string; href: string; lang?: string };
  source: 'manual' | 'cluster' | 'semantic' | 'fanout' | 'template';
  status: 'active' | 'suggested';
  values: SEOAIStatusProps | ReadonlyArray<{ engine: EngineCode; k: number | null; n: number | null }>;
  onActivate?: () => void;          // "Activate" on suggestions, prompts:write
}
```

- **States:** active, suggested (neutral "Suggested" label plus Activate), activating. **A11y:** row in a `SimpleTable`; source in tooltip. **Use:** Keyword Detail related prompts, prompt inspector related keywords. **Not for:** causal claims about the link.

### 16.8 CrossChannelTrend
`app/cross/cross-channel-trend.tsx` · V1 · [24 §9.10](24-page-templates.md), [15 §5](15-data-visualization.md)

Purpose: `SmallMultiples` preset: one 140 px panel per channel (SEO, AI Overview, each engine, GSC when connected) with a shared time axis and its own y axis per channel.

```ts
interface CrossChannelTrendProps { panels: ReadonlyArray<{ channel: 'seo' | 'ai_overview' | EngineCode | 'gsc'; title: string; summary: string; series: MetricSeries }>; timeZone: string }
```

- **Rules:** never one chart with mixed units, never dual axes. **A11y:** figure per panel. **Use:** Page Intelligence, Overview S2 small multiples. **Not for:** one metric across entities (`RateTrendChart`).

### 16.9 PageVisibilitySummary
`app/cross/page-visibility-summary.tsx` · V1 · [24 §9.10](24-page-templates.md)

Purpose: `MetricStrip` preset for one owned URL: one item per channel (SEO keywords and average rank, AI Overview citations, citation units per engine, GSC clicks labeled "Google-reported").

```ts
interface PageVisibilitySummaryProps { seo: MetricItemProps; aiOverview: MetricItemProps; engines: readonly MetricItemProps[]; gsc?: MetricItemProps | null }
```

- **A11y / States:** as `MetricStrip`. **Use:** Page Intelligence header, page inspector strip. **Not for:** a combined page score.

## 17. Cost components

Cost changes are never colored; budget thresholds use warning ([02-color-system.md](02-color-system.md) §6, [23-application-patterns.md](23-application-patterns.md) §11).

### 17.1 CostSummary
`app/metric/cost-summary.tsx` · V1 · [23 §11.1](23-application-patterns.md)

Purpose: `MetricStrip` preset: Month to date, Projected month end (Estimate), Budget (with `BudgetMeter`), Blocked runs (omitted when 0).

```ts
interface CostSummaryProps { monthToDate: MetricValue; projected: MetricValue; budget: BudgetMeterProps | null; blockedRuns: { count: number; href: string } | null; rangeText: string }
```

- **States:** as `MetricStrip`; `formatCurrency` with `context: 'summary'`. **Use:** Costs page, Settings budgets. **Not for:** hero dollar figures, gauges, donuts.

### 17.2 BudgetMeter
`app/metric/budget-meter.tsx` · V1 · [23 §11.2](23-application-patterns.md)

Purpose: `Meter` preset: 6 px outline-track meter, fill `foreground-muted` below the soft limit and `warning-solid` from it, tick at the soft limit, text value always beside it.

```ts
interface BudgetMeterProps { spentUsd: number; limitUsd: number; softLimitPct: number; projectedPct?: number | null; width: 64 | 160 }
```

- **States:** below soft limit, soft limit reached, hard limit reached (whole fill warning), over 100% (text "112%"). **A11y:** "64% of $2,000.00, projected 96%". **Use:** Costs summary and project rows. **Not for:** progress of runs.

### 17.3 BudgetStatusBadge
`app/status/budget-status-badge.tsx` · V1 · [23 §11.5](23-application-patterns.md)

Purpose: `Badge` preset with tone and icon fixed per budget state: Within budget (neutral subtle), Soft limit reached (warning, `TriangleAlert`), Budget blocked (warning, `Receipt`), No budget (neutral outline).

```ts
interface BudgetStatusBadgeProps { status: 'within' | 'soft_limit' | 'blocked' | 'none'; detail?: string }   // "Soft limit reached: 84% of $2,000.00"
```

- **Use:** project spend table, budget settings. **Not for:** green "savings" or red spending.

### 17.4 ProviderCostTable
`features/costs/components/provider-cost-table.tsx` · V1 · [23 §11.3](23-application-patterns.md)

Purpose: the "By provider" `DataTable` configuration: Provider, Endpoints, Requests, Units, Cost (USD, default sort), Share, vs last month (neutral relative change), Cost source badge.

```ts
interface ProviderCostRow { provider: string; endpoints: number; topEndpoints: readonly string[]; requests: number | null; units: number | null; unitName: string; costUsd: number; share: number; vsLastMonth: MetricDeltaInput; source: 'provider_reported' | 'computed_from_tokens' | 'price_book_estimate' }
interface ProviderCostTableProps { rows: readonly ProviderCostRow[] }
```

- **Rules:** `vsLastMonth.polarity` is always `'neutral'`. **Use:** Costs breakdown. **Not for:** project budgets (the "By project" table with `BudgetMeter` cells).

### 17.5 UnitCostList
`features/costs/components/unit-cost-list.tsx` · V1 · [23 §11.4](23-application-patterns.md)

Purpose: `SimpleTable` of unit costs with basis and method link: cost per SERP check, per AI observation, per tracked keyword per month, per prompt per month.

```ts
interface UnitCostListProps { rows: ReadonlyArray<{ unit: string; valueUsd: number; basis: string; metricKey: MetricKey }> }   // 4 decimals below one cent
```

- **Use:** Costs Unit costs tab, onboarding estimate panel. **Not for:** billing invoices.

## 18. Inspector

The inspector frame is specified in [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) §2; its content per object type in [23-application-patterns.md](23-application-patterns.md) §4.2.

### 18.1 Inspector
`app/inspector/inspector.tsx` · V1 · [16 §2](16-drawers-dialogs-popovers.md), [ADR-DS-008](adr/ADR-DS-008-right-inspector.md)

Purpose: the detail panel of one record picked from a list; the list keeps its scroll, filters and selection.

```ts
interface InspectorProps {
  type: InspectorType;
  mode: 'docked' | 'overlay' | 'sheet';     // resolved by the docking rule (16 §2.6)
  widthPx: number;                  // default 400 (`w-inspector`), or 440 (`w-inspector-wide`) for prompt, citation, answer; 360 to 640
  onWidthChange: (widthPx: number) => void;  // snaps to 8 px, persisted per type in localStorage
  titleId: string;
  header: Slot; tabs?: Slot; footer?: Slot;
  children: Slot;                   // InspectorSection list or StatisticsPanel
  onClose: () => void;              // history.back() when this session pushed the entry, else replace
}
```

- **Variants:** none; `mode` is structural. a floating card under the top bar: `background` fill, 1 px `border`, radius 10 px, `shadow-inspector`, 12 px from the top bar and the window edges, 16 px padding, sections as `surface` cards ([16 §2.1, §2.4](16-drawers-dialogs-popovers.md)). **States:** opening (header from list cache via `initialData`, sections skeleton), ready, record switch (instant swap, never previous data under a new title), not found ("This keyword does not exist or you do not have access to it."), hidden by filters notice, dirty edit (discard dialog on leave).
- **A11y:** `aside` labeled by the title (complementary landmark); non-modal when docked or overlaid (F6 reaches it); modal sheet below 768 px; focus to the title on open, back to the originating row on Escape; Escape closes one layer per press.
- **Use:** every record opened from a table, chart point, notification or palette. **Not for:** creating objects, destructive confirmation, multi-record study (full page).

### 18.2 InspectorHeader
`app/inspector/inspector-header.tsx` · V1 · [16 §2.1](16-drawers-dialogs-popovers.md), [23 §4.1](23-application-patterns.md)

Purpose: sticky header: object type, position counter, actions, title, status badges, freshness line.

```ts
interface InspectorHeaderProps {
  typeLabel: string;                // "Keyword"
  positionText?: string | null;     // "12 of 986"; hidden for deep links outside the list
  title: string;                    // h2, type-inspector-title (18/26), clamped to 2 lines (section 23, item 32)
  lang?: string;
  badges?: Slot;                    // at most 4, 8 px below the title
  freshness: Slot;                  // FreshnessIndicator or compact CollectionProgress, type-meta
  frequentAction?: Slot;            // "Check now", "Run now": 32 px secondary `sm` button
  onOpenPage?: () => void;          // Expand: 32 px icon button `Maximize2` named "Open page" (section 23, item 30)
  onPrevious?: () => void; onNext?: () => void;   // ChevronUp and ChevronDown, "Previous keyword (K)", "Next keyword (J)"
  previousDisabledReason?: string; nextDisabledReason?: string;   // "First keyword in this list"
  moreActions: readonly MenuItemDef[];   // includes "Reset width" and "Width: Default, Wide, Maximum"
}
```

- **Variants:** none. Row 1: the title, with 32 px ghost icon buttons Previous, Next, More, Expand (`Maximize2`, tooltip "Open page") and Close at the top right; badges 8 px below the title; the context line (type, position, freshness) with the frequent action right-aligned as a 32 px `sm` secondary button ([16 §2.1](16-drawers-dialogs-popovers.md)); the 44 px underline `InspectorTabs` last. The key-value grid under the header is `MetricStrip size="sm"` (section 9.1). **States:** as `Inspector`; mobile shows "Back to Rankings" instead of Close.
- **A11y:** icon buttons named with shortcuts; J and K respect the single-key setting. **Use:** every inspector. **Not for:** page headers.

### 18.3 InspectorTabs
`app/inspector/inspector-tabs.tsx` · V1 · [16 §2.3](16-drawers-dialogs-popovers.md)

Purpose: 44 px underline `Tabs` (`h-tab`, labels 24 px apart, active label `primary-text` 500 with a 2 px `primary` underline, 1 px `border` bottom across the row); at most 5; first is "Overview"; state in `itab` (replace).

```ts
interface InspectorTabsProps<TValue extends string> { value: TValue; onValueChange: (value: TValue) => void; items: ReadonlyArray<{ value: TValue; label: string }> }
```

- **States:** as `Tabs`; navigation between records preserves the tab. **A11y:** tablist, automatic activation with immediate section skeletons. Keyword tabs: Overview, SERP, AI, Timeline (section 23, item 31). **Not for:** a sixth tab (needs a full page).

### 18.4 InspectorSection
`app/inspector/inspector-section.tsx` · V1 · [16 §2.4](16-drawers-dialogs-popovers.md), [23 §4.1](23-application-patterns.md)

Purpose: a titled block inside the inspector with optional right-aligned action ("View all 20", Edit, `MetricInfo`), separated by `border-subtle`.

```ts
interface InspectorSectionProps {
  title: string;                    // h3, type-subsection-title
  action?: Slot;
  status: 'loading' | 'ready' | 'error' | 'empty';
  error?: InlineErrorProps;
  empty?: EmptyStateProps;          // inline variant
  editing?: { active: boolean; onEdit: () => void };
  children: Slot;
}
```

- **Rules:** own query and error boundary; lists capped at 10 rows then "View all N" (section 23, item 34); charts full width at 180 px (section 23, item 33); tables at most 4 columns, not sortable, never virtualized; not collapsible; nothing uses `type-metric`.
- **A11y:** heading level 3. **Not for:** bordered panels inside the inspector.

### 18.5 InspectorFooter
`app/inspector/inspector-footer.tsx` · V1 · [16 §2.5](16-drawers-dialogs-popovers.md)

Purpose: sticky footer while a section is in edit mode (Cancel, Save), or the triage footer in Discover (Reject, Snooze, Accept).

```ts
interface InspectorFooterProps { secondary?: Slot; primary: Slot; start?: Slot }
```

- **Rules:** one primary; save pessimistic for measurement settings, optimistic for tags and notes; success shown in place (no toast). **Not for:** always-visible actions (header).

### 18.6 InspectorResizeHandle
`app/inspector/inspector-resize-handle.tsx` · V1 · [16 §2.2](16-drawers-dialogs-popovers.md), [20 §5](20-accessibility.md)

Purpose: the window splitter on the inspector's left edge.

```ts
interface InspectorResizeHandleProps { valueNow: number; min: 360; max: number; defaultWidth: number; controlsId: string; onResize: (widthPx: number) => void; onReset: () => void }   // max 640; defaultWidth 400 or 440
```

- **States:** idle (1 px `border`), hover and drag (2 px `border-strong`, reflow on pointer up), focus (ring). **A11y:** `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-valuetext="400 pixels"`; Left widens and Right narrows by 16 px, Shift by 64 px, Home, End, Enter resets; double-click resets; menu alternative in the header.
- **Not for:** the sheet.

## 19. Hooks

Hooks in `components/app` hold UI state only; hooks that fetch live in `features/*/hooks` or `lib/api` ([26-implementation-guidelines.md](26-implementation-guidelines.md) §2 rule 2).

### 19.1 useInspector
`app/inspector/use-inspector.ts` · V1 · [16 §2.7](16-drawers-dialogs-popovers.md)

Reads and writes `inspect=<type>:<id>` and `itab` through `nuqs`; applies the history rules (open pushes; previous, next and tab change replace; close uses `history.back()` when this session pushed the entry).

```ts
interface InspectorTarget { type: InspectorType; id: string }
interface UseInspectorResult {
  target: InspectorTarget | null;
  tab: string;                      // 'overview' when omitted from the URL
  open: (target: InspectorTarget, options?: { tab?: string }) => void;
  close: () => void;
  setTab: (tab: string) => void;
  step: (direction: 'next' | 'previous', orderedIds: readonly string[]) => void;   // follows the list's sort and filters
}
declare function useInspector(): UseInspectorResult;
```

Used by: every `DataTable` `onRowOpen`, `CommandPalette`, `NotificationItem`, chart point clicks, `InspectorHeader`.

### 19.2 useSavedView
`app/data-table/use-saved-view.ts` · V1 · [12 §11](12-tables.md), [23 §14](23-application-patterns.md)

Computes the active view, the "(edited)" state and the merge rule (explicit URL parameters override the view). Persistence is injected, because the hook does not fetch; the query hooks live in `lib/api/saved-views.ts`.

```ts
interface SavedViewState { filters: Readonly<Record<string, string>>; sort: readonly string[]; columns: ReadonlyArray<{ id: string; widthPx: number; pinned: boolean }>; density: Density; grouping: string | null; search: string; dateWindow?: string }
interface UseSavedViewResult { current: { id: string | null; name: string }; edited: boolean; differingFilterKeys: ReadonlySet<string>; apply: (id: string | null) => void; snapshot: () => SavedViewState }
declare function useSavedView(tableId: string, views: ReadonlyArray<{ id: string; name: string; state: SavedViewState }>): UseSavedViewResult;
```

Used by: `SavedViewMenu`, `FilterChip` (primary dot), `DataTable` column state.

### 19.3 useReducedMotion
`lib/design/motion.ts` · V1 · [21 §11.3](21-motion.md)

`declare function useReducedMotion(): boolean;` True when the OS preference or `data-motion="reduced"` asks for it. Used by: programmatic scrolling, the toast stack, drawer swipe settling, the new-row highlight. Components never call `matchMedia` for motion themselves.

### 19.4 useChartTheme and readTokens
`lib/design/read-tokens.ts`, `app/chart/use-chart-theme.ts` · V1 · [26 §8](26-implementation-guidelines.md), [15 §4](15-data-visualization.md)

```ts
interface ChartTheme {
  series: readonly [string, string, string, string, string, string];   // chart-1 to chart-6
  other: string; reference: string; grid: string; axis: string; label: string; band: string;
  positive: string; negative: string;
  rankBands: readonly [string, string, string, string, string, string];   // band 1 to 5 and none
  sequential: readonly string[]; diverging: readonly string[];
  surface: string; surfaceElevated: string; border: string; foreground: string; foregroundTertiary: string;
  fontFamily: string;
}
declare function readTokens(theme: 'light' | 'dark'): ChartTheme;   // cached per theme, reads CSS variables from document.documentElement
declare function useChartTheme(): ChartTheme;                     // re-reads on theme change
```

Used by: `EChart` (applies `setTheme`), every `build<Name>Option`, the sparkline renderer. The only source of colors in JavaScript.

### 19.5 useShortcut
`lib/a11y/use-shortcut.ts` · V1 · [20 §14](20-accessibility.md)

```ts
interface ShortcutOptions { scope: 'global' | 'table' | 'inspector' | 'grid-row'; kind: 'modifier' | 'single-key' | 'sequence'; enabled?: boolean }
declare function useShortcut(keys: readonly string[], handler: (event: KeyboardEvent) => void, options: ShortcutOptions): void;
```

Single-key and sequence shortcuts fire only outside text inputs and comboboxes, without modifiers other than Shift, with no modal open, never during IME composition, and never when the user turned single-key shortcuts off. Components never add `keydown` listeners on `document`. Used by: `CommandPalette` (mod+K), `Sidebar` (`[`), `SearchInput` (`/`), `AddFilterButton` (`f`), `KeyboardShortcutsDialog` (`?`), inspector J and K, triage `a`, `r`, `s`, `e`, `g` sequences.

### 19.6 useViewportClass
`lib/design/use-viewport-class.ts` · V1 · [19 §2](19-responsive-behavior.md)

```ts
type ViewportClass = 'wide' | 'desktop' | 'small-desktop' | 'tablet' | 'mobile';
declare function useViewportClass(): { viewport: ViewportClass; touchPrimary: boolean };
```

Built from the same `rem` breakpoints as `globals.css`; writes the `viewport-class` cookie. Used by: `AppShell`, `DataTable` column tiers and `DataTableList`, `Inspector` mode, `Dialog` sheet mode, `DesktopOnlyNotice` gating. No component reads `window.innerWidth`.

### 19.7 announce()
`lib/a11y/announcer.ts` · V1 · [20 §10](20-accessibility.md)

```ts
declare function announce(message: string, options?: { politeness?: 'polite' | 'assertive'; key?: string; debounceMs?: number }): void;
```

Writes to the two shell live regions (polite and assertive), replaces messages with the same key, clears after 1 s. Used by: result counts, sort changes, selection counts, copy, job completion, column moves, saved view applied. Components never create ad hoc live regions (exceptions: the Toast viewport and form error summaries).

Other helpers referenced above: `applyServerErrors(form, items, { fields, messages }): ValidationItem[]` in `lib/forms/apply-server-errors.ts` ([10 §23](10-forms.md)); `useAutoGrow` in `ui/textarea.tsx` for browsers without `field-sizing`.

## 20. Utilities

### 20.1 Formatters (`@/lib/format`)

The only permitted way to turn a value into display text ([22-content-formatting.md](22-content-formatting.md); lint blocks `Intl.*`, `toFixed`, `toLocaleString` and `toLocaleDateString` elsewhere). Components import from `@/lib/format` only.

| Export | File | Returns | Used by |
|---|---|---|---|
| `MINUS`, `EMPTY_VALUE` | `number.ts` | `"−"` (U+2212), `"n/a"` | Every formatter; `NumberCell`, `MetricCell` missing values |
| `NumberContext`, `FormatOptions` | `number.ts` | types: `'table' \| 'summary' \| 'axis' \| 'tooltip'`, `{ locale }` | All number formatters |
| `formatInteger` | `number.ts` | `"1,240"` | `NumberCell`, `SearchVolumeCell`, button counts, `Pagination` range text, `SaveBar` summary, `SampleCount` (through `formatSampleCount`) |
| `formatCompact` | `number.ts` | `"12.4K"`, exact below 10,000 | `Tabs` counts, `Sidebar` counts, `NotificationBell`, chart axes |
| `formatCount` | `number.ts` | exact in table and tooltip, compact in summary and axis | `MetricItem` values, chart tooltips |
| `formatPercent` | `number.ts` | `"47.2%"`, `decimals: 0` for wide intervals | `MetricCell`, `EngineMetricCell`, `MetricItem`, `SEOAIStatus`, `BudgetMeter`, `QuadrantSummary` share |
| `formatPointsDelta` | `number.ts` | `"+5.3 pts"` | through `formatMetricDelta` (`unit: 'points'`) |
| `formatSignedInteger` | `number.ts` | `"+12"`, `"−3"` | through `formatMetricDelta` (`unit: 'count'`) |
| `formatRelativeChange` | `number.ts` | `"+12.4%"` | through `formatMetricDelta` (`unit: 'relative'`); `ProviderCostTable` |
| `formatCurrency` | `number.ts` | `"$24.18"`, `"$0.0042"`, compact above $100,000 in summaries | `CostCell`, `CostSummary`, `BudgetMeter`, `UnitCostList`, `SaveBar` estimate |
| `formatDecimal` | `number.ts` | `"0.042"` | `ProminenceIndicator`, `VolatilityIndicator`, average rank ("14.2"), `FactsFooter` confidence |
| `formatInterval` | `number.ts` | `"29% to 39%"` | `ConfidenceIndicator`, `MetricCell` tooltip, `StatisticsPanel` |
| `formatSampleCount` | `number.ts` | `"612 of 1,800"` | `SampleCount`, `MetricCell` Default-density second line, `Textarea` counter, `OutcomeMixBar` label, `CollectionProgress` |
| `RankObservation`, `RankBucket`, `RANK_BUCKETS`, `rankBucket` | `rank.ts` | types, bucket table (`1 to 3` ...), bucket of an observation | `FilterEditor` (`rankBucket`), `RankDistribution`, `RankDistributionChart` |
| `formatRankCell` | `rank.ts` | `"3"`, `">20"` | `RankCell`, `BeyondDepth` (cell), `CompetitorRankCell`, `SEOAIStatus` rank slot, `DataTableList` |
| `formatRankInline` | `rank.ts` | `"#3"`, `"not in top 20"` | Tooltips, `EventTimeline` and `NotificationItem` values ("#4 → #11"), `BeyondDepth` (tile), `RankDeltaCell` tooltip |
| `describeRank` | `rank.ts` | `"rank 3"`, `"not in top 20"` | Screen reader text in `RankCell`, `BeyondDepth`, `MatrixScatter` table view |
| `RankChangeKind`, `RankChange`, `classifyRankChange` | `rank.ts` | change classification with the emphasis rule | Features map API rows; `RankDeltaCell`, `RankDelta`, `ChangeFeed` consume the result |
| `ChangeTone`, `RankChangeDisplay`, `formatRankChange` | `rank.ts` | `{ text: "↑5", label: "improved 5 positions", tone }` | `RankDeltaCell`, `RankDelta`, `MetricItem`, `ChangeFeed`, `DataTableList` |
| `Polarity`, `DeltaUnit`, `MetricDeltaInput`, `MetricDeltaDisplay`, `formatMetricDelta` | `delta.ts` | `{ text: "+5.3 pts", label, tone, note }` | `Delta`, `DeltaCell`, `MetricItem`, `ChangeFeed`, `ProviderCostTable` |
| `timeZoneAbbreviation` | `date.ts` | `"CEST"`, `"GMT+5:30"` | `FreshnessIndicator`, `NotCollected`, `CollectionProgress` |
| `formatTableDateTime` | `date.ts` | `"Sep 29, 18:32"` | `DateCell`, `AlertEventsTable`, `RankCell` tooltip |
| `formatDetailDateTime` | `date.ts` | `"Sep 29, 2026 · 18:32 EDT"` | `DateCell` tooltip, `EvidenceViewer` header, `ResponsePreview`, `FreshnessIndicator` tooltip |
| `formatRelative` | `date.ts` | `"12m ago"` | `FreshnessIndicator`, `NotificationItem`, `DateCell` relative form, `ChangeFeed` |
| `formatBusinessDate` | `date.ts` | `"Sep 29, 2026"` | `EventTimeline`, `SmallMultiples` titles, day headings |
| `formatChartDate` | `date.ts` | `"Sep 29"` | `build<Name>Option` axis labels |
| `formatDateRange` | `date.ts` | `"Sep 1 to Sep 28, 2026"` | `DateRangePicker`, `CompareSelect` tooltip, `CostSummary`, `DeltaCell` tooltip periods |
| `DisplayUrl`, `displayDomain` | `url.ts` | `"example.com"` | `DomainCell`, `SourceDomainCell`, `DomainInput` preview |
| `displayUrl` | `url.ts` | `{ host, path, display, original, valid }` | `URLCell`, `RankingURLCell`, `UrlInput` preview, `CitationList`, `SERPPreview`, `TargetURLIndicator` |
| `truncatePath` | `url.ts` | `"/blog/…/how-to-choose-a-crm"` | `URLCell`, `InspectorHeader` titles for URLs |

Gaps to close with the component that needs them (section 23, items 52 to 54): `numberInputFormat(kind)` for `NumberInput`; a duration formatter for "1h 12m" ([22 §4](22-content-formatting.md)).

### 20.2 Metric definitions registry
`lib/metrics/definitions.ts` · V1 · [22 §8](22-content-formatting.md)

One entry per API metric key; tables, charts, tooltips, exports and `MetricInfo` read the same entry, so a metric is named identically everywhere.

```ts
interface MetricDefinition {
  key: MetricKey;                   // 'ai.mention_rate', 'seo.visibility_volume'
  label: string;                    // "Mention rate"
  shortLabel: string;               // "Mention"
  headerAbbreviation?: string;      // "SOV", "AIO" (dense headers only, with tooltip)
  definition: string;               // one sentence
  formula: string;                  // in plain words
  unit: MetricValue['unit'];
  polarity: Polarity;               // feeds MetricDeltaInput
  deltaUnit: DeltaUnit;             // rates: 'points'; counts: 'count'; money and volume: 'relative'
  sampleNoun?: SampleNoun;
  channel: 'seo' | 'ai' | 'first_party' | 'cost';
  methodologyHref: string;
}
declare function getMetric(key: MetricKey): MetricDefinition;   // throws a descriptive error for unknown keys
```

Used by: `MetricItem`, `MetricInfo`, `MetricSwitcher`, `col.*` headers and header tooltips, `ChartFrame` titles, `MentionRate`, `CitationRate`, `UnitCostList`.

### 20.3 Tone map
`app/metric/tone.ts` · V1 · [02 §6](02-color-system.md)

```ts
export const TONE_TEXT = {
  positive: 'text-positive-text',
  negative: 'text-negative-text',
  neutral: 'text-foreground-secondary',
} as const satisfies Record<ChangeTone, string>;
```

The only place a `ChangeTone` becomes a class. Used by: `RankDeltaCell`, `DeltaCell`, `RankDelta`, `Delta`, `EventTimeline` values.

### 20.4 Engine helpers
`lib/metrics/engines.ts` · V1 · [14 §4](14-badges-status.md)

```ts
declare const ENGINE_ORDER: readonly EngineCode[];   // ChatGPT, Gemini, AI Mode, AI Overview, then official APIs
declare function engineLabel(code: EngineCode, length: 'short' | 'full'): string;
declare function engineClass(code: EngineCode): ObservationClass;
declare function engineClassesMixed(codes: readonly EngineCode[]): boolean;   // drives EngineBadge observationClass
declare function engineSeriesIndex(code: EngineCode): 1 | 2 | 3 | 4 | 5 | 6;  // engine charts only
```

Used by: `EngineBadge`, `EngineMetricCell` column order, `col.engineGroup`, `RateTrendChart` (`kind: 'engine'`), `SEOAIStatus`.

## 21. When to create a new component vs a variant

The rule is [26-implementation-guidelines.md](26-implementation-guidelines.md) §5, with the button-specific test in [09-buttons-controls.md](09-buttons-controls.md) §2.10. Summary with examples from this inventory:

| Situation | Decision | Example |
|---|---|---|
| Same element and behavior, different visual emphasis | Variant on an existing axis (`variant` or `tone`, `size`, `density`) | `Button variant="subtle"`, `Badge tone="warning"` |
| Different semantics or accessibility role | New component | `ToggleButton` (not a `Button` variant), `TabNav` (links) vs `Tabs` (tablist) |
| Different content structure | New component | `RankCell` is not a `NumberCell` variant; `SourceDomainCell` adds role and expansion |
| Same component, fixed domain binding (metric key, column type, status set) and no new styling | Preset: a thin named wrapper in `components/app` that fixes props | `MentionRate`, `CitationRate`, `SearchVolumeCell`, `RankTrend`, `BudgetMeter`, `BudgetStatusBadge`, `CostSummary`, `PageVisibilitySummary` |
| A variant axis would exceed 7 values | Stop and review; split the component | `Button` has exactly 7 variants; the next one needs a review |
| Style needed on one screen only | Not allowed; propose a system change | |
| Boolean style prop (`isBold`, `hasBorder`) | Not allowed; use an axis value or a new component | |

Before adding a variant: it is needed on at least three screens, the owning document and this inventory are updated first, it is added to the `/design-system` preview in both themes and densities, and visual regression baselines change in the same pull request ([00-design-principles.md](00-design-principles.md) §7, [27-design-review-checklist.md](27-design-review-checklist.md) §2).

Presets may not add CVA axes or classes of their own; if a preset needs different styling, it is a variant of the base component (documented there) or a new component.

## 22. Component naming rules

1. **Case and files:** components in PascalCase, files in kebab-case (`rank-delta-cell.tsx`), hooks `use` plus PascalCase, utilities camelCase verbs (`formatRankChange`, `readTokens`), option builders `build<Name>Option`, column helpers `col.<type>` ([26-implementation-guidelines.md](26-implementation-guidelines.md) §3).
2. **Acronyms** stay uppercase in new names (`SEOAIStatus`, `URLCell`, `SERPFeatureList`, `AIOverviewStatus`). `UrlInput` keeps its documented spelling (section 23, item 67).
3. **Domain prefix only when ambiguous:** `RankDeltaCell` (vs `DeltaCell`), `KeywordIntentBadge` (intent alone is ambiguous); not `SeoButton`.
4. **Suffixes carry meaning:**

| Suffix | Meaning | Examples |
|---|---|---|
| `Cell` | Renders inside a `DataTable` column, used through `col.*`, lives in `cells/` or `sparkline/` | `RankCell`, `SparklineCell` |
| `Badge` | Non-interactive 22 px label | `EngineBadge`, `StatusBadge` |
| `Status` | Descriptive state of one fact, never a judgment of a metric | `MentionStatus`, `AIOverviewStatus`, `OpportunityStatus` |
| `Indicator` | Compact qualifier next to a value | `FreshnessIndicator`, `ConfidenceIndicator` |
| `Chart` | ECharts-backed, inside `ChartFrame` | `RankHistoryChart`, `RateTrendChart` |
| `Strip`, `Item`, `Card` | Summary metrics (`Card` only in its two allowed places) | `MetricStrip`, `MetricItem`, `MetricCard` |
| `Bar` | A full-width band inside a region | `SaveBar`, `BulkActionBar`, `RefetchBar` |
| `Dialog`, `Sheet`, `Menu`, `Popover`, `Toast`, `Notice` | Container type per [16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) §1 | `ConfirmDialog`, `FilterSheet`, `RowMenu`, `TriageToast`, `DesktopOnlyNotice` |
| `List` | An ordered or unordered HTML list | `CitationList`, `ScopeList`, `EntityToggleList` |

5. **Glossary words only** ([22-content-formatting.md](22-content-formatting.md) §9): keyword, prompt, engine, observation, run, check, mention, citation, source, domain. Never query, scan, model, LLM, publisher (except the entity), score (for AI visibility).
6. **No evaluative or marketing names:** no `Insights`, `Smart`, `Opportunity` for a verdict, `Health` scores. `OpportunityStatus` names a documented condition with evidence.
7. **One name per component.** Aliases found in other documents are recorded in the entry ("also called ...") and in section 23; code, imports and new documents use the canonical name only.
8. **Chip, Tag, Badge are distinct:** `FilterChip` is a removable filter, `Tag` is a removable value in forms, `Badge` is a static label. "Pill" is never a component name.

## 23. Inconsistencies found

Disagreements between documents found while compiling this inventory. The resolution applied above is the stricter or more specific rule; the losing document should be updated to match.

| # | Topic | Documents in conflict | Resolution in this inventory |
|---|---|---|---|
| 1 | Tabs activation | 09 §12 manual activation (`activateOnFocus={false}`); 16 §2.3 and 20 §5 automatic | Automatic (20 is binding on component docs); panels render their skeleton immediately so arrows never wait on a fetch |
| 2 | Single-choice segmented control semantics | 09 §6 `ToggleGroup` with `aria-pressed`; 20 §5 and §19 `radiogroup` | `role="radiogroup"` for single choice; `aria-pressed` only for independent toggles |
| 3 | Maximum page tabs | 09 §12: 7; 11 §6 and 23 §3.1: 6 | 6 |
| 4 | Page tabs as links | 11 §6 "tabs are links"; 09 §12 query-parameter tabs are a tablist, route tabs are `TabNav` | 09: `?tab=` tabs use `Tabs`; path tabs use `TabNav` |
| 5 | Tab indicator motion | 09 §12 150 ms transition on left and width; 21 §5 and §12 instant, sliding indicators prohibited | Instant |
| 6 | Dialog close button size | 09 §2.2 `icon` 32 px; 16 §4.2 28 px | 32 px (`icon-sm` in v2; 09 owns button sizes) |
| 7 | Destructive confirm button colors | 16 §4.5 `negative-solid` fill with `foreground-inverse`; 09 §2.3 `destructive-solid` with `--negative-button*` tokens | 09 (tokens tested for 4.5:1) |
| 8 | Discard dialog copy | 10 §13.2 "Discard unsaved changes?", "Discard changes"; 16 §4.3 "Discard changes?", "Discard"; 24 §6 "Discard 3 unsaved changes?" | 10 (button names the object per 09 §2.5) |
| 9 | Overlay motion | 16 §9 dialogs and palette scale 0.98, docked inspector translates 16 px, overlay inspector 24 px, tooltip enter 100 ms; 21 §2.1 and §4 no scale (8 px or 4 px translate), docked content opacity only, overlay inspector full width, tooltip enter 150 ms | 21 |
| 10 | Dimming during refetch | 17 §3.4 dims to 70% after 400 ms; 23 §2.4 strip at 60%; 12 §7.1 and 21 §6 no dimming (contrast) | No dimming |
| 11 | `RefetchBar` animation | 17 §3.4 indeterminate travelling segment; 21 §1 and §8.3 no indeterminate bars, continuous motion only for spinner and live indicator | Static 2 px bar |
| 12 | Spinner speed | 17 §3.5 once per second; 21 §8.2 and `globals.css` 800 ms | 800 ms |
| 13 | Insufficient data hatching | 12 §7.3 and 23 §8.4 "hatched at 8% foreground"; 17 §8 1 px `border-subtle` lines on `surface-subtle` | 17 (tokens, no opacity color) |
| 14 | Insufficient data text | 12 §7.3 and 23 §2.4 "Insufficient"; 12 §6 and 20 §9.2 "Insufficient data" | "Insufficient" in cells (or the count below 88 px), "Insufficient data" in tiles and inspector (17 §8) |
| 15 | Not applicable in cells | 12 §7.3 empty cell with tooltip; 17 §8 short text ("No AIO") | 17 (unknown is never an empty cell, 17 §1 rule 1) |
| 16 | Beyond depth in cells | 12 §6, 22 §3, 23 §7.1 `>20` text; 17 §8 neutral chip `>20`; 19 §6.2 and 20 §9.2 "Not in top 20" chip | `formatRankCell` text `>20` in cells; "not in top 20" text in tiles, inspector and speech |
| 17 | Field error icon | 10 §2 `CircleX` 12 px; 17 §5.1 14 px | 12 px (10 owns field anatomy) |
| 18 | Search field | 10 §17 `SearchInput`: `border-strong`, 16 or 14 px icon in `foreground-muted`, 24 px clear; 13 §6 `SearchField`: `border`, 14 px icon in `foreground-tertiary`, 20 px clear | 10 (control outline 3:1, 24 px target); one component named `SearchInput` |
| 19 | Filter chip radius and remove target | 13 §2 `rounded-md`, 20 px remove; 06 §3 `rounded-sm` for chips; 19 §10 and 20 §8 24 px remove target | v2: 36 px, `rounded-md` (6 px), `neutral-subtle`, no border ([reference/visual-spec.md](reference/visual-spec.md) §5); 24 px remove target |
| 20 | "Clear all" label | 13 §2 "Clear all"; 19 §4 "Reset" | "Clear all" |
| 21 | `/` shortcut | 10 §17, 12 §9, 13 §7 focus table search; 20 §14 opens the command palette in search mode | Table pages: focus table search; other pages: command palette |
| 22 | Escape in the grid | 12 §9 second Escape clears selection; 20 §6.3 never clears selection | 20 |
| 23 | `aria-colcount` | 12 §9 set when columns hide by priority; 20 §6.2 omitted (hidden columns removed from the DOM) | 20 |
| 24 | Table footer and pagination | 09 §13 40 px bar, sizes 25, 50, 100, 200, no page numbers; 12 §1 32 px footer with "1 of 5" and sizes 100, 200, 500; 24 §4 "1 to 200 of 12,480" | 48 px `TableFooter` with 32 px controls (v2, 12 §1), range text without page numbers, sizes 100, 200, 500 |
| 25 | Toast timing | 18 §3.2 success 4 s, info 6 s, action toasts at least 8 s; 20 §10.5 no-action 6 s, action toasts never auto-dismiss; 23 §10.3 `TriageToast` 6 s | 20: no-action toasts 6 s; toasts with an action and error toasts persist until dismissed |
| 26 | Undo window | 20 §2 (SC 3.3.4) and §17 "10-second Undo window"; 20 §10.5 action toasts persist | Toast persists; the action also stays reversible from status views |
| 27 | Confirming bulk actions | 09 §2.6, 16 §4.5, 23 §10.4 reversible bulk actions need no confirmation (triage up to 10,000); 20 §2 (SC 3.3.4) bulk operations over 100 rows always confirm | 20 (stricter): over 100 rows confirms with the count; 23 §10.4 needs updating |
| 28 | Row removal after triage | 23 §10.3 150 ms height collapse; 21 §5 and §12 height animations prohibited | Instant removal |
| 29 | Statistics container | 16 §8 modal `SideDrawer` (Statistics drawer); 23 §8.6 and §17 non-modal `StatisticsPanel` in the inspector region | 23; `SideDrawer` becomes Later |
| 30 | Inspector header actions | 16 §2.1 "Open page" text button and frequent action in header row 1, footer only in edit mode; 23 §4.1 `Maximize2` icon button, and 23 §4.1 and 24 §9.1 sketches show "Check now" and "Open full page" in a footer | v2: Expand is a 32 px `Maximize2` icon button named "Open page" in header row 1, as the reference screens show ([reference/visual-spec.md](reference/visual-spec.md) §4); frequent action and footer placement follow 16 |
| 31 | Keyword inspector tabs | 16 §1.1 Overview, History, SERP, AI, Timeline; 23 §4.2 and 24 §9.3 Overview, SERP, AI, Events; 18 §10 links use `itab=timeline` | Overview, SERP, AI, Timeline |
| 32 | Inspector title clamp | 16 §2.1 2 lines; 23 §4.1 3 lines | 2 lines, full text in the first section |
| 33 | Inspector chart height | 16 §2.4 at most 160 px; 15 §2 and 23 §4.1 180 px | 180 px |
| 34 | Inspector list cap | 16 §2.4 5 items; 23 §1.1 and §4.1 10 rows | 10 rows (23 is the per-object content specification) |
| 35 | Inspector width at 1920 px | 19 §7 640 px default for all types; 16 §2.6 keyword 480, prompt 640 | 16 (default per type); v2 widths: 400 px default, 440 px for prompt, citation and answer, 360 to 640 px |
| 36 | Inspector object types | 16 §2.7 `source` means a domain; 23 §4.2 and §15 `domain:<id>` for domains and "Source" for a cited URL | `domain` for registrable domains, `source` for a cited URL, plus 16's `citation`, `answer`, `run` |
| 37 | Tab changes in history | ADR-DS-012 inspector and tab changes push; 16 §2.7 and 23 §15 `itab` replaces | 16 and 23 |
| 38 | Top bar search width | 11 §4 280 px; 19 §3.2 320 px at 1440 and up, 240 px at 1280 to 1439 | v2: 440 px at 1680 and up, 360 px at 1440 to 1679 ([reference/visual-spec.md](reference/visual-spec.md) §4 shows 360 to 440 at 1536), 240 px at 1280 to 1439 and an icon button below 1280, so the date range and location buttons fit beside it; collapse order in 19 §3.2 |
| 39 | Theme control | 11 §4 icon button cycling; 19 §3.2 menu that moves into the user menu below 1280 px | 19: a menu; v2 moves it into the user menu below 1440 px to make room for the date range and location buttons |
| 40 | Help menu | Absent from 11 §4; present in 19 §3.2 and 20 §15 | Included (`HelpMenu`); add `CircleHelp` to 07 §6 |
| 41 | Switches in save-bar forms | 09 §8.3 and 10 §8 never; 24 §9.13 (engine Enabled) and §9.12 (Query matching) show switches above a save bar | Checkboxes in save-bar forms |
| 42 | Toast after an immediate switch | 24 §6 "applies immediately with a toast"; 10 §13.3 and 18 §3.3 no toast | No toast |
| 43 | Sidebar item height | 11 §2 28 px; 19 §10 32 px navigation items on desktop | 32 px (`h-sidebar-item`, v2) |
| 44 | Typed confirmation scope | 16 §4.5 only project or workspace deletion; 24 §6 typed confirmations for "delete project, remove member" | 16 |
| 45 | Rank and change column widths | 12 §5 rank 64, change 56; 19 §6.2 72 and 72 | 12 |
| 46 | Column priority numbering and sets | 19 §6.1 identity is priority 1, Volume 2, 1440 hides Updated; 24 §9.3 identity 0, Volume 1, 1440 shows Updated | 19 (owner of breakpoints and tiers) |
| 47 | Rankings change cell | 19 §6.2 `DeltaCell`; 12 §5 and 24 §9.3 `RankDeltaCell` | `RankDeltaCell` |
| 48 | Component aliases | `UrlCell`, `RateCell`, `FeatureIconsCell`, `MetricTile`, `ChartPanel`, `ErrorState` (19, 20); `ObjectHeader`, `HeatmapChart` (24); `SearchField` (13); `RankingHistoryChart` | Canonical: `URLCell`, `MetricCell`, `SERPFeatureList`, `MetricItem`, `ChartFrame`, `ErrorPage`, `DetailPageHeader`, `Heatmap`, `SearchInput`, `RankHistoryChart` |
| 49 | Component folders | 17 `components/app/states/` and `components/metric/`; 18 `components/app/notify/` | 26 §2: `status/` and `app/metric/` |
| 50 | Layer rule for primitives | 10 lists `form-field.tsx` (react-hook-form), `url-input.tsx` (contracts, `@/lib/format`), `date-range-picker.tsx` and `number-input.tsx` (`@/lib/format`) under `components/ui`; 26 §2 rule 1 forbids those imports | 26: `FormField`, `UrlInput`, `DomainInput` in `app/forms/` (new area, add to 26 §2); `DateRangePicker` in `app/filters/` (as 26 §2 lists); `NumberInput` stays in `ui/` and receives its format from the caller; primitives receive display strings |
| 51 | Primitive file names | 09 `radio.tsx`, 10 `form-field.tsx` and `number-input`; 26 `radio-group.tsx`, `field.tsx`, `number-field.tsx`; 26 §2 omits `spinner.tsx`, `icon-button.tsx`, `split-button.tsx`, `toggle-button.tsx`, `segmented-control.tsx`, `toolbar.tsx`, `copy-button.tsx`, `pagination.tsx` | 26 names where given; 09 and 10 names added to 26 §2 |
| 52 | Formatter contract names | 20 §9.2 and §19 `srText`, `formatRank`; code exports `label` (`RankChangeDisplay`, `MetricDeltaDisplay`) and `describeRank` | Code |
| 53 | Formatter labels vs 20 §9.2 | 20: "New" read as "new, entered top 20", "First check" visible text, "0 or neutral dash glyph"; code and 22 §3: "entered the tracked depth", empty text on first check, `0` (dashes are banned) | Code and 22 |
| 54 | Missing formatters | 10 §11 `numberInputFormat` "added with this component"; 22 §4 durations ("1h 12m") without a function | Add both to `lib/format` with tests before use |
| 55 | `MetricCell` name collision | 19-api-specification §2.6 contract type `MetricCell`; 12 §6 component `MetricCell` | Import the contract type as `MetricCellValue` |
| 56 | Chart series encodings | 15 §4 series 1.75 px, reference dash `[4, 3]`; 20 §12.2 own brand 2 px with circle markers, reference `[4, 4]`, other `[8, 4]`, estimates dotted | 20 (binding, more specific) |
| 57 | Menu group label and shortcut | 09 §10 group label `type-meta px-2 py-1`, shortcut as `Kbd`; 16 §5.2 28 px group row, shortcut as `type-kbd` text | 28 px group row; shortcut as `Kbd` |
| 58 | Number of type utilities | 00 §5 "11 composite type utilities"; 03 §2 and `globals.css` define 15 (v2 adds `type-inspector-title`) | 15 |
| 59 | Queued status icon | 14 §3 `Clock`; 17 §4.1 `CalendarClock` (`Clock` means stale in 07 §6) | `CalendarClock` |
| 60 | Metric strip divider height | 06 §5 24 to 32 px; 23 §2.1 32 px | v2: full height of the 76 px strip ([reference/visual-spec.md](reference/visual-spec.md) §4) |
| 61 | `CollectionProgress` bar | 17 §4.2 4 px bar on `surface-subtle`; 23 §12.1 64 px bar with the `BudgetMeter` outline track (23 defers to 17) | 17 |
| 62 | `EventTimeline` rows | 18 §7 64 px date column, rows min 28 px, "Show older events" secondary; 23 §9.1 48 px time column, 28 px day header, 32 px rows, "Load more" subtle | 18 (owning structure and markup) |
| 63 | Result count placement | 13 §2 filter bar or toolbar; 19 §4 table toolbar at 1280 and up; 23 §3.1 right side of the filter bar | Table toolbar on table pages, filter bar on T1 |
| 64 | Keyword location and device | 19 §6.2 chips inline in the keyword cell; 24 §9.3 in the tooltip | Tooltip (badge budget, 14 §2 rule 3) |
| 65 | Prompt column width | 12 §5 360 / 240 / 640; 19 §6.3 320 / 240 / 560 | 12 |
| 66 | Filter bar role and chip keys | 13 §8 `role="toolbar"` with arrow keys between chips; 20 §4.6 and §5 `role="group"`, Tab moves between chip buttons | 20 |
| 67 | Acronym case | `UrlInput` (10) vs `URLCell`, `RankingURLCell` (12, this inventory) | Documented names kept; new names use uppercase acronyms |
| 68 | Workspace switcher name size | [reference/visual-spec.md](reference/visual-spec.md) §4: name 15 px semibold; `globals.css` has no 15 px composite type utility | Resolved by [visual-spec §6](reference/visual-spec.md): `type-subsection-title` (14/20, 600), within the 2 px tolerance; the type scale stays at 15 utilities |
| 69 | Bar list names | 15 §5.1 and this inventory used two names and two sections for one horizontal bar list | Resolved: one component, `BarList` (section 10.10), with a `comparison` mode (own brand against competitors or domains) and a `distribution` mode (rank buckets and other categorical distributions); the earlier name `HorizontalBarList` is retired |
| 70 | `ChangeFeed` grouping | [reference/visual-spec.md](reference/visual-spec.md) §5 one panel per day ("Today · 7 events"); 23 §9.2 groups by severity (Needs attention, Changes, Notices) | 23 §9.2 (content rule); the v2 header row and 36 px row styling apply to each severity group |
| 71 | Icon size names in the `Button` sketch | 09 §2.9 passed `'md'` to `Icon` for the 16 px glyph; in `Icon` (section 3.10) `'md'` is 18 px and 16 px is `'default'` | Section 3.10. 09 §2.9 corrected: `Icon` takes `'sm'` or `'default'`, `Spinner` takes `'sm'` or `'md'` |
| 72 | Navigation buttons | 09 §2.7 and section 3.1 rendered a link through `Button` with `nativeButton={false}`; Base UI then gives the link the button role | `LinkButton` in `ui/link-button.tsx`: the link element with `buttonVariants`. It and `ui/button-variants.ts` have no `'use client'`, so server code can use both. 09 §2.7 corrected |
| 73 | Tooltip and screen readers | Section 3.21 says `role="tooltip"` and `aria-describedby`; Base UI's tooltip sets neither | `Tooltip` has `purpose`. `'description'` (default) points `aria-describedby` at a `hidden` element beside the trigger that holds the text, so the popup mounts only while open and the server HTML already has the target. `'label'` (icon buttons, truncated values) attaches nothing, because the text repeats the accessible name. The popup is `aria-hidden` in both. `content` and `detail` are strings |
| 74 | `IconButton.shortcut` type | Section 3.2 had `string`; `Kbd` and `Tooltip` take key ids | `readonly string[]` everywhere |
| 75 | Neutral badge border | 14 §1 said the 1 px `neutral-border` is optional and always on in table rows; section 3.17 had no prop for it, and a boolean style prop is not allowed (section 1.4 rule 7) | The border is always on, and the fill becomes `surface` inside a selected row through `group-aria-selected`. 14 §1 corrected. Warning and info badges have no outline form, and the props type refuses that combination |
| 76 | `Truncate` on keyboard focus | Section 3.19 promised the tooltip on hover and focus; a truncated `span` is not focusable, and making every truncated cell a tab stop would be worse | Open: the `DataTable` cell that contains a `Truncate` has to own the tooltip for its focus state. Decide with the table task; until then a keyboard-only sighted user reads a truncated value in the inspector. Section 3.19 now says hover only |
| 77 | Tooltip delay on keyboard focus | 16 §6.1 and sections 3.2 and 3.21 said 400 ms on hover and focus; Base UI opens at once on focus (measured 6 ms) | At once on focus is kept: moving focus is deliberate. 16 §6.1 and sections 3.2 and 3.21 corrected |
| 78 | Link underline | Section 3.9 said a text link is underlined on hover and focus; 20 §19 says "underlined in running text". Measured contrast of `link` against `foreground` is 2.92:1 in light and 1.98:1 in dark, below the 3:1 that would let color alone mark a link | 20 §19 wins. `TextLink` has `variant`: `inline` is underlined at rest, `standalone` on hover and focus |
| 79 | Ghost icon button color | Section 3.2 said `foreground-tertiary`, 09 §3 says `foreground-secondary`; the static preview mostly uses tertiary | 09 §3 wins, as the document that owns buttons. Section 3.2 corrected; the static preview still draws its row actions in tertiary |
| 80 | Attributes on primitives | The props in section 3 were closed lists, so a `Tooltip` around a `Badge` or an `Icon` did nothing | Every primitive takes the attributes of its root element and passes them on, with `ref`. `aria-hidden` on the purely decorative ones (`Skeleton`, the decorative `Separator`) is written after them and cannot be overridden. Section 3 lists only the props a primitive adds |
| 81 | `Kbd` name for screen readers | 20 §19 asked for an `aria-label` on the combination | A visually hidden text beside `aria-hidden` key caps: an `aria-label` on a generic element is not read reliably. 20 §19 corrected. Known cost: a Mac sees "Ctrl" become "⌘" when the page hydrates, because the server cannot know the platform |
| 82 | Skeleton phase | 17 §3.1 wants all skeletons to pulse together; skeletons mounted at different times are out of phase | Open: decide with the loading states of the shell (one animation clock on the region, or a negative delay from a shared start time) |
| 83 | `disabledReason` on form controls | Sections 3.5, 4.7, 4.10, 4.12 and 4.13 give `Checkbox`, `Switch`, `RadioGroup`, `Select` options and `SegmentedControl` items a `disabledReason`; none of the first screens has a control that is disabled with a reason | The primitives take `disabled`. `disabledReason` (focusable, with the reason in a tooltip) is added to all of them together by the first screen that needs it. Sections updated |
| 84 | `FieldLabel.optional` | Section 4.1 had `optional?: boolean`; a primitive cannot read the catalog for the word | `optional` is the marker text; `FormField` keeps the boolean and passes the text |
| 85 | Helper text while an error shows | Section 4.1 said the description is hidden while an error shows; a hidden element that `aria-describedby` points at is still read | The description is not rendered then. `FormField` renders one or the other |
| 86 | `SaveBar` save action | Section 4.26 had `onSave`; with a button of type `button`, Enter in a field of a multi-field form would not save | "Save changes" is the form's submit button; `onSave` is gone and `form` names a form the bar sits outside of. Labels are props |
| 87 | Server error helper | 10 §23 had `applyServerErrors(form, error): boolean` for the whole problem, in `lib/forms/server-errors.ts` | Two steps: `applyServerErrors(form, items, { fields, messages })` maps `errors[]` and returns what matched no field; handling by problem `code` is the form's, typed with `ApiProblem`. 10 §23 rewritten |
| 88 | Password and one-time code fields | The inventory had `SecretInput` (Later, for provider tokens) and no field for the user's own password or for a TOTP code | `PasswordInput` (4.30) and `OtpField` (4.31) added. The reveal button is named by its action instead of carrying `aria-pressed` |
| 89 | `ReadOnlyField.copyValue` | Section 4.29 offers a copy button for identifiers; `CopyButton` (3.7) is not built yet | `copyValue` is left out until `CopyButton` exists. `ReadOnlyList` is the `dl` the fields sit in |
| 90 | Required state | 10 §2.1 said `aria-required` is derived from the schema by `FormField` | `FormField` hands the control `required` (true unless `optional`), and the control sets `aria-required`. Marking optional fields is already the rule, so the schema is not read a second time |
| 91 | When a field error appears | 10 §18 said "first blur, if the field has been changed (`isDirty`)"; read literally, a field typed into, blurred and emptied again hides its "enter a value" error, and a field only tabbed through showed its error while the user was still typing later | `FormField` reveals the error at the first blur after a change and keeps following changes until the form is reset. 10 §18 rewritten |
| 92 | Focus after a failed submit on a group control | Section 4.3 said every control forwards `ref`; a radio group has no single element to focus | `RadioGroup` and `SegmentedControl` take `focusRef` (`useRadioFocus`), which focuses the chosen or first enabled option |
| 93 | Segmented control corners | 09 §6 gives the first and last item the outer radius; Base UI puts a hidden input after every radio, so `last:` never matched and the right end was square | Corners use `first-of-type` and `last-of-type`. 09 §6 unchanged |
| 94 | Ids of radios inside a `Field` | Base UI gives every hidden radio input inside one `Field` the id of the field's control, unless each radio sits in a `Field.Item`, which in turn needs a `Field.Root` around every use | Open. The inputs are `aria-hidden` and nothing refers to their id, so nothing breaks today. Revisit when Base UI lets a labelable item exist without a field root |
| 95 | Off switch on hover | 09 §8.3 gives the off track `border-strong` and `foreground-muted` on hover; in the light theme the two are almost the same color, so the hover shows nothing | Open: a token question for 02-color-system (a hover step for `border-strong`). The code follows 09 §8.3 |
| 96 | Names of the one-time code cells | Every cell is named by the field label; Base UI ignores `aria-label` on the first cell and offers no position | Kept as Base UI does it. A screen reader hears the label on each cell and the group once |
| 97 | `ErrorSummary` line | 10 §18 joined label and message with a colon inside the component | The label is heavier and the whole line is the link, so no punctuation is built into a primitive |
| 98 | Text inside overlay primitives | Sections 3.29 to 3.32, 3.43 and 4.8 had the labels of Close, Cancel, the discard question and the toast region built in | Primitives cannot read the catalog, so every label is a prop: `closeLabel`, `cancelLabel`, the `discard` copy of `Dialog`, `label` and `closeLabel` of `Toaster`, `clearLabel` and `openLabel` of `Combobox` |
| 99 | Which toasts show at the limit | 18 §3.1 said further toasts wait until one closes; Base UI shows the three newest and brings an older one back when there is room | Kept as Base UI does it: the newest result is the one the user just caused. 18 §3.1 corrected |
| 100 | Popup collision | 16 §5.1 says flip, then shift; Base UI also falls back to the side of the trigger when neither fits | The side fallback is off for popovers, menus, selects and comboboxes (`POPUP_COLLISION` in `ui/popup-styles.ts`): a popup that does not fit is limited to the available height and scrolls |
| 101 | `Dialog.initialFocus` | Section 3.29 had `initialFocus: 'first-field' | 'title' | 'close'` | No prop: focus goes to the first field of the body, or to Close when the body has none (16 §4.3) |
| 102 | `ConfirmDialog.onConfirm` failing | Section 3.30 listed an error state without saying who shows it | When `onConfirm` rejects, the dialog stays open and the caller passes `error` |
| 103 | `Menu` link items | Section 3.25 had no way to navigate from a menu item | `kind: 'link'` with `link` (the router's link element); the item is a `menuitem` that is an anchor |
| 104 | `Combobox` as a switcher | 11 §8 describes the project switcher as "a combobox menu with search"; section 4.8 only had the text field form | `trigger` puts the search field inside the popup; the button is then a combobox and needs `triggerLabel` |
| 105 | `Tabs.overflow` | Section 3.38 had `overflow?: 'menu'` for a "More tabs" button below 1024 px | Not built: no page in this plan has more tabs than fit. It arrives with the first page that needs it |
| 106 | Pressed look of a button that has opened a popup | 09 §10 says `data-popup-open` keeps the pressed background; `buttonVariants` had no such state | `secondary`, `subtle` and `ghost` take `surface-selected` while `data-popup-open` is set |
| 107 | Highlighted row in popups | 09 §10, 10 §6.2 and 16 §5.2 used `surface-hover`; on `surface-elevated` that is about 1.03:1 in the dark theme, so the row the keyboard is on could not be seen | New token `--surface-elevated-hover` (02): the same as `surface-hover` in light, one step above `surface-elevated` in dark. Rows also show the inset focus ring when they have keyboard focus |
| 108 | Popups inside a dialog or the drawer | Positioners use `--z-dropdown` (60), dialogs 80 and the drawer 70, so a select, menu or popover opened inside one rendered behind it | The portal of `Dialog`, the alert dialogs and `Drawer` sets `--z-dropdown` to its own layer. 16 §5.1 says so |
| 109 | Close button of a dialog | Section 3.29 made it an `IconButton`, whose tooltip opened when a dialog without fields put focus on it, and took the first Escape | A ghost icon button named by `aria-label`, without a tooltip |
| 110 | `toast()` before the provider listens | Base UI's provider subscribes in an effect that runs after the effects of its children, so a toast from a mount effect was lost | `toast()` keeps such toasts and hands them over once the provider listens |
| 111 | Toast restack motion and height | 21 §4.6 animated the restack; 18 §3.1 said 48 px | Toasts are in normal flow and move at once; a toast is 48 px of content plus its border. Both documents corrected |
| 112 | Menu rows on touch | 19 §9 makes menu items 44 px tall when the device is touch-primary | Open: arrives with the mobile layout |
| 113 | Dialog exit | The dialog left with the 8 px move it arrived with | It leaves by fading only, as 21 §4.3 says; scrims leave with `ease-exit` |
| 114 | Reading width | 03 §2 and 05 §4 named the 720 px text column `max-w-prose`, but Tailwind's default theme declares `--max-width-prose: 65ch`, which `max-w-*` reads before `--container-*`, so the class gave about 600 px | The container is `--container-reading` and the class `max-w-reading`. `--max-width-prose` is reset in `globals.css`, so `max-w-prose` no longer exists, and lint refuses `max-w-prose`, `w-prose` and `min-w-prose`. Found by the sizes section of the component preview, which measures each width |
| 115 | Themes in the component preview | 26 §10 asked for every variant in light and dark side by side | One theme at a time, chosen with a switch in the preview. An overlay is portalled to `<body>` and takes the theme of the page, so a dark column could not show a dark dialog, and a section rendered twice repeats every id |
| 116 | Reading a token in the browser | 02 declares every color as `oklch()` | The build writes every color twice: a hex fallback, then `lab()` inside `@supports (color: lab(0% 0 0))`. A current browser reports the `lab()` value, an older one the hex value. Code that reads a token with `getComputedStyle` has to read all three notations (`parseColor` in `src/lib/design/contrast.ts`). Theme values of `@theme` such as `--container-form` are written into the rule and are absent from `:root` unless something refers to them, so they are measured on an element, not read |
| 117 | Labels of `Tag` and `MultiSelect` | Sections 3.18 and 4.9 gave the remove button a default name ("Remove {label}") and left the chip hints unnamed | Primitives cannot read the catalog: `Tag` takes `removeLabel` with `onRemove`; `MultiSelect` takes `removeLabel`, `chipsLabel`, `chipsHint`, `chipHint` and `emptyText` |
| 118 | `MultiSelect.presentation` | Section 4.9 had `'chips' \| 'summary'` | Only chips are built (aliases and tags in forms). The summary form arrives with the first fixed-height control that needs it |
| 119 | `DomainInput.normalize` | Section 4.21 took `normalizeDomain` from `packages/contracts`, which ADR-022 removed with the TypeScript backend | `normalizeDomain` lives in `lib/domains/normalize.ts` and is a preview only: the API canonicalizes (doc 14 section 3) and its answer wins. `DomainInput` shows the helper text or the preview, so it sits in a `FormField` without a description of its own, and passes `invalid` to give the line to an error |
| 120 | `Textarea` counter | Section 4.6 said the counter is part of the description | The counter is a second `Field` description, right-aligned under the control, so `aria-describedby` reads both |
| 121 | `TreeView` | The inventory had no tree; 20 section 5.19.7 asks for a term tree with "Move to..." for keyboard users | `ui/tree-view.tsx`: the WAI-ARIA tree pattern with single selection that follows focus, one tab stop, arrows, Home, End and type-ahead. Items are named by their own label (`aria-labelledby`), not by the items nested in them. No control sits inside an item: actions act on the selected item from outside the tree. Drag to move waits for a later plan |
| 122 | `LocationCombobox` | 10 section 6.3 names location as a server-loaded `Combobox` without a component of its own | `app/forms/location-combobox.tsx` shows a location with its type and country below its name. It does not fetch (components never do): the feature passes the answer of `useLocationSearch` (`lib/locations`), which lists countries before 2 characters are typed |
| 123 | `type-inline-strong` | 23 section 5.3 gives the own brand's mention weight 500 inside answer text; `type-body-strong` would also reset its size and line height | A weight-only utility for spans in running text (03 section 2) |
| 124 | `DataTable` virtualization | Sections 7.1 and 12 section 12 render rows with TanStack Virtual | The lint rule `react-hooks/incompatible-library` flags any component that calls `useVirtualizer`, and lint fails on that warning (the React Compiler itself is not enabled in `next.config.ts`, so the table memoizes its search, sort and selection counts by hand). Rows have one fixed height per density, so `lib/tables/row-window.ts` computes the rendered ranges from the scroll offset, rounded down to 160 px so a scroll renders again only every 160 px: 100 rows and fewer render whole, overscan 10, and the focused row is always rendered, as a range of its own when it is out of view, with spacer rows between. TanStack Table v9 (`useTable`) sorts in client mode, missing values last both ways |
| 125 | `DataTable` props | Section 7.1 typed sort keys as strings (`'-volume'`), took `columns` as TanStack `ColumnDef`s and an `error` object | Sort keys are `{ id, desc }` (`lib/tables/table-state.ts`, which also reads and writes `?sort=-search_volume`); columns are `DataTableColumn`s from `col.*` (identity, priority, `sortValue`, `cell`); `rows` with `total` serve both modes, and `server` adds the paging; `errorState`, `emptyState` and `filteredEmptyState` are slots; `selection.onAllMatchingChange` replaces `onSelectAllMatching`; `server.offset` places a page's rows in `aria-rowindex`; a record action's `onSelect` gets the loaded rows and an `ActionScope` (every selected id, and whether every matching row is selected), so selected rows a filter hides or another page holds are still acted on. `columns`, `getRowId` and `searchText` are expected to keep their identity between renders. The table is a `div` panel, not a region landmark, since a page may hold several |
| 126 | `DataTable` scope, first build | Section 7.1 lists resizing, pinning more columns, reordering by drag, grouping, the right-click menu, new-row highlights and export | Built: sort (two keys), selection with ranges and "Select all N matching", the column chooser with Move up and Move down, the header menu (sort, move, hide), density, search, both modes, row windowing, the grid keyboard map of 20 section 6.3 except full widget mode (a control in a cell hands Escape and the arrows back to the grid, and menus return focus to their cell), focus that follows the row id, and the selection, sort and count announcements. Not yet: column resize, extra pins and the right pin of the actions column (12 section 10), drag, grouping, the context menu, new rows and export, which arrive with the screens that need them. The search sits in the toolbar, which the bulk bar replaces while rows are selected (12 section 14), so the search cannot change during a selection |
| 127 | Column types | 12 section 5 has no plain text type | `text` (160 / 104 / 240, left, A to Z) for short values such as a group path or tags |
| 128 | Filters, first build | Sections 6.1 and 6.4 to 6.6 give `FilterBar` scope and chip slots, `FilterChip` a field and value text, a separate `AddFilterButton` with fields grouped by domain, and editors for eight field types | `FilterBar` takes `fields`, the applied `values` by field id and `onChange`, and builds the chips and "+ Filter" itself (the picker lives in `filter-bar.tsx`, a flat list with a search above 8 fields); `resultCount` shows and announces the count on overview pages, and scope controls or a legend go in its `trailing` slot. Values for fields the screen does not show are kept. A single choice applies on a click, Space or Enter, never while the arrow keys move through the options (WCAG 3.2.2); range ends accept group separators and refuse anything but a whole number in the field's bounds. Values are `FilterValue`s (`lib/filters/filter-values.ts`: enum ids, `min..max` ranges, `operator:text`), and an operator's message key is camel case through `OPERATOR_MESSAGE`. Built: `enum` single and multiple (search above 8 options, Select all, Only, facet counts), `range` (two whole-number fields, refused when the minimum is above the maximum) and `text` with its operator; Apply, Enter, Clear and Escape as 13 section 3; focus to the next chip or "+ Filter" on removal; Delete or Backspace on a remove button. Not yet: `entity`, `tree`, `rankBucket`, `boolean` and range presets, the read-only and saved-view states, the `f` shortcut, the narrow "Filters" button and `FilterSheet`, which arrive with the screens that need them |
| 129 | Inspector, first build | Section 18.1 passes `mode`, `widthPx` and `onWidthChange` in, and takes the header as a slot; 18.2 puts Previous and Next in row 1 | `Inspector` resolves its own mode and width: `InspectorLayout` (`app/inspector/inspector-layout.tsx`) wraps the list page and measures the width beside the sidebar, and `lib/inspector/placement.ts` applies 16 section 2.6 (types, default widths, docking). The width per type lives in `lib/inspector/width-store.ts` (`localStorage`, held in memory when storage is blocked). The header is data (`header` prop), so the inspector adds Close, the sheet's back button and the width items of the More menu itself; Previous and Next sit in the context line as 16 section 2.1 has them. Docked and laid over it is an `aside`; below 768 px a new `ui/sheet.tsx` (Base UI Drawer from the bottom edge) makes it modal. `InspectorTabs` and `InspectorPanel` put the tab row in the header and the panels in the body's scroll container (`Tabs` gained `listClassName`); `InspectorBody` is the body without tabs. The table marks the open row `aria-current`, keeps it in view as J and K step, and takes focus back to its identity cell when the inspector closes. Not yet: the not-found and hidden-by-filters states, "Customize cards", the discard dialog for a dirty edit, F6 between the main column and the inspector, and portaling popups into the overlay card, which arrive with the keyword inspector (Task 5) |
| 130 | StepperDialog, MetricStrip, ChartFrame and CollectionProgress, first build | Sections 3.35, 9.1, 9.2, 10 and 11.5 describe registry-driven metric items, every chart type, chart overflow actions and the full progress density | `StepperDialog` (`ui/stepper-dialog.tsx`) takes its words as `labels` and a `discard` question; on a Continue that passes it calls `onStepChange` with the next step, and it moves focus to the next step's first field or to the first error. `MetricStrip` takes formatted items (`label`, `value`, `unknown`, `delta`, `context`, `labelAddon`) in groups, because the metric registry does not exist yet; its `dl` sits in a named `group`, and it measures itself to wrap. `ChartFrame` draws line and bar charts over categories (`lib/charts/category-chart.ts` builds the option; `app/chart/echart.tsx` is the ECharts wrapper, loaded with `next/dynamic`); colours come from `lib/design/read-tokens.ts`, which reads the oklch tokens back as sRGB hex for ECharts, with the page's font for the canvas; Table and Patterns are pressed buttons (there is no toggle primitive). `CollectionProgress` has the compact and standard densities, with the copy formatted by the caller. The legend shows a dot per series and a dashed line for reference and Other; the canvas reads its colours again when the theme class on `<html>` changes. Not yet: marker-shape swatches in the legend, clickable strip items, `MetricInfo`, sparklines, the strip's two-column grid below 768 px, other chart types, the chart overflow menu (Download PNG, Download CSV, Copy link), the methodology popover, the full progress density and `delayed` |
| 131 | Inspector header and table width, after review of the preview | 16 section 2.1 puts the frequent command beside the title; 12 section 5 caps the keyword column at 480 px | The frequent command sits on the badges row, right-aligned, so in a 400 px card the title keeps the width less More and Close and does not wrap early. The table's flex column takes whatever width the other columns leave, past its 480 px default, so a table with few columns fills its panel instead of leaving an empty strip; it still shrinks to its minimum first when space runs out. The docked card is capped at its container's height less 24 px (`max-h-inspector-docked-max`), which only bites inside a box of fixed height such as the preview |
| 132 | `FilterBar` URL state | 13 §5 keeps one URL key per filter, named as the API names it (`intent_in`, `search_volume_gte`); no hook is specified | `useUrlFilters(fields, { onDropped })` (`app/filters/use-url-filters.ts`, on `nuqs`) keeps each value in the URL under its field's own `id` (`intent`, `grp`, `vol`), in the forms of `lib/filters/filter-values.ts`, written with `replace` so a filter is not a history entry. The screen maps ids to the API's filters (Rankings: `keywordFilters`). A value the field cannot read once its options are known is dropped and `onDropped` reports the fields, so the screen can say so; an enum value is kept as it is while its options load, so a shared link does not lose a group before the groups arrive. `ReadOnlyFilterChips` shows the applied filters inside an empty state |
| 133 | `DataTable`: `col.status`, `rowActions` and `grid-focus` | Section 7.1 and 8 had no column for a run's status, took a record's actions as a list, and had no way to return focus to the table after a dialog | `col.status(id, value, { unknown })` shows the glyph of `CollectionStatusIcon` (`app/status/collection-progress`) in the status color beside its word, and sorts by the word (Runs). `rowActions` is a list or a function of the row, so Cancel is offered only on the rows a member may cancel. `app/data-table/grid-focus.ts` has `gridTabStop()`, the cell the arrow keys start from, and `gridFocus`, a `finalFocus` ref that resolves to it: for a dialog opened from a row's menu or the bulk bar, whose opener is gone when it closes. A screen whose dialog only sometimes should land there builds its own ref over `gridTabStop` (the bulk actions do, once a change was made). `CollectionProgress` is shown in the page header, one per run or import write the page follows |
| 134 | `StepperDialog.finalDisabled` | Section 3.35 let the last step's button always be pressed once Continue passed | `finalDisabled` disables the last button only (the import's Confirm while rows are over the plan's limit). A disabled button names no reason, so the step must say why in text of its own |
| 135 | `MetricStrip.meter` and `ChartFrame.stacked` | 17.1 has a `CostSummary` preset that takes a `BudgetMeterProps`; 10 section 2 has no stacking | `MetricStripItem.meter` is a node under the value, in the context position, left out while the strip loads: Costs builds its strip from items with a meter instead of a `CostSummary`. `ChartFrame.stacked` stacks the bars of a category into one column (series in the legend's order, 2 px corners on the top segment only); lines ignore it. Costs uses it for spend by day by workload, with fixed colors per workload |
| 136 | `KeyValues` and `EntitySwatch` | Not in the inventory | `KeyValues` (`app/inspector/key-values.tsx`) is the read view of an inspector card: a `dl` of `{ id, label, value }` rows, the label in the first two fifths and long values wrapped. It began in Rankings' inspector and moved here to serve the run inspector too. `EntitySwatch` (`app/entity/entity-swatch.tsx`, `colorIndex` and `own`) is the 8 px square of an entity's chart color: chart 1 for the own brand, its `color_index` for the others, a dashed `chart-other` square past the sixth. It is decoration (`aria-hidden`): the name beside it carries the meaning. Used by the entities list |
| 137 | `GroupPicker`, `GroupSelect` and `MultiSelect.commitOnBlur` | Section 4.9 said `MultiSelect` with `creatable` keeps text left in the field as a value when the field loses focus, so an alias typed before Save is not lost; keyword groups need the opposite, since a stray search would make a group | `commitOnBlur` (default `true`, the alias behavior) turns that off: text left in the field is a search, and a value is added by choosing its row or pressing Enter. `GroupPicker` (several groups: `MultiSelect` with `creatable` and `commitOnBlur={false}`) and `GroupSelect` (one group or "No group": a `Combobox` whose list the component filters, offering "Create group" first for a path that names none) are in `features/rankings/groups/group-picker.tsx`, not `components/`, because they read the project's groups. A typed path such as `Blog/Guides` is a choice of kind `new`; the form creates its missing levels, parents first, when it is saved, and Cancel creates nothing. The filter bar keeps its own group editor, since a filter never creates a group |
| 138 | `Menu` items: `detail` and `description` | Section 3.25 gave an item a label, an icon, a shortcut and a `disabledReason` | `detail` is a short fact at the item's end ("14 of 20 left today") that takes the place of a shortcut and gives way to a reason. The reason or detail on show is `aria-hidden` and read as the item's description, so it is not read twice. `description` is a longer sentence for assistive technology only, replacing the reason or detail as the description ("No manual runs left today. The limit resets at 00:00 UTC."). `Menu.header` is text above the items that is not an item |
| 139 | Cost components | 17.1 to 17.4 name `CostSummary`, `BudgetMeter`, `BudgetStatusBadge` and `ProviderCostTable` in `app/metric`, `app/status` and `features/costs/components` | Built in `features/costs/` until a second screen (Settings > Budgets and usage) shares them. `BudgetMeter` takes `pct`, `softLimitPct`, `state` (`ok`, `soft_exceeded`, `hard_exceeded`), `size` (`summary` 160 px, `cell` 64 px) and `label`: a `role="meter"` 6 px bar on a 1 px outline track, neutral up to the soft limit and warning past it, all warning at the hard limit, with a tick at the soft limit; the value stops at the track's end and `aria-valuetext` says the real share. `BudgetStatusBadge` takes `state`: neutral and without an icon within budget, warning with `TriangleAlert` at the soft limit and `Receipt` at the hard limit. `CostTable` is a plain semantic table for a short fixed list (columns of `{ id, header, align, cell }`, a bold footer row, loading, error and empty states), used for By provider, By project, by workload, Unit costs and Budgets, so there is no `ProviderCostTable`. There is no `CostSummary` and no projected month end: the forecast route is not built (see 135) |
| 140 | `FileDropzone` | 4.24 puts it in `ui/file-dropzone.tsx`, with `accept`, `constraints`, `file` and `error` | The import's `FileDropzone` is `features/rankings/import/file-dropzone.tsx`, since it reads its words from the import's message namespace. Props: `accept` (a string: ".csv,text/csv"), `constraints`, `file` (`name` and `sizeText`, or `null`), `onFile`, `onRemove`, `chooseRef`, `error`, `progress` (0 to 100 while uploading) with `progressText`, and `disabled`. A chosen file replaces the box with one row (name, size, Remove file) and a bar shows the upload. The box is not focusable; "Choose file" is a real button opening the hidden input. It moves to `ui/` with labels as props when a second upload needs it. CSV only: no TSV, and no row count, since the browser reads only the file's first 64 KiB |
| 141 | `BulkActionBar` overflow and `RecordAction.tone` | 7.3 draws every action as a button, destructive ones last and separated, and 12 section 14 does not say what happens when they do not fit | The bar clips nothing: each action's width is read from a hidden copy of the bar (`aria-hidden`, `inert`, `invisible`), the room is the actions area observed with a `ResizeObserver`, and `fitCount` (`lib/tables/bulk-fit.ts`) keeps the first actions that fit as buttons. The rest go into a "More actions" `Menu` (a 32 px secondary icon button) in the same order, destructive ones last by the menu's own rule. Until both are known every action is a button. A `RecordAction` also takes `tone` (`default` or `destructive`): the destructive group draws destructive unless the action says `default`, so Archive and Unarchive sit last in the bar but are drawn neutral, as in their confirmation, and only Delete is red. The bar's "Select all N matching" and hidden-selection note truncate before the actions are pushed out. An inspector that lays over the list (below 1440 px) covers the bar's right side, so `InspectorLayout` tells the bar where the card begins (`InspectorOverlayContext`) and the bar stops its content there, which sends more actions into More actions |
| 142 | `DataTable` header and cell tooltips | 3.21 gives a `Tooltip` a trigger that is the element it describes, and 12 section 11 puts a definition on the header | The grid focus sits on the `th` or `td`, so a header's definition and a cell's reason (`DataTableColumn.headerTooltip` and `cellTip`, with `col.keyword`'s `detail` and the `unknown` reason of `col.*`) are on that cell: the cell is the `Tooltip` trigger (`purpose="label"`, so it opens on hover and on keyboard focus), and `aria-describedby` points to a hidden description rendered outside the table, so the cell's text stays its value and its name. `Unknown` and the keyword cell no longer carry a tooltip of their own. A server table's Previous page and Next page use `focusableWhenDisabled`. The count, "Select all N", the load progress and "All N matching selected" choose the noun by ICU plural (`{ one, other }` stays the prop) |
| 143 | `PlainTable`, `MonthSelect`, `useErrorId`, `useMultiSelectHints` and `useDepthLabel` | 4.9 gives `MultiSelect` hints per screen; 17 gives each region its own error id markup; the costs tables, the schedules list and the month selects were written more than once | `PlainTable` (`app/table/plain-table.tsx`, formerly the costs feature's `CostTable`) is the plain table of a short list for Costs and Schedules: a caption, a first column as the row header, right-aligned tabular figures, a hidden header for an actions column and a header `description` that is the header's description and tooltip. `MonthSelect` (`app/filters/month-select.tsx`) is the month of Costs and Runs. `useErrorId` (`lib/api/use-error-id.ts`) gives an `InlineError` the request id of a problem with the words around it. `useMultiSelectHints` (`app/forms/use-multi-select-hints.ts`) gives every `MultiSelect` the same two hints (`common.multiSelect`). `useDepthLabel` (`lib/keywords/use-depth-label.ts`) names a depth profile once for every screen. The one sentence about the plan's keyword limit is `common.quota`, from `quotaFacts` (`lib/keywords/quota.ts`) |
| 144 | `col.rank`, `col.rankDelta` and `col.url` | 7.13 and 12 section 5 give each column type an accessor of the cell's props (`RankCellProps`, `RankDeltaCellProps`, `URLCellProps`) and cells in `app/cells/` | The three types are in `lib/tables/column-types.ts` with the spec's widths (rank 64 / 56 / 80, right, best first; rankDelta 88 / 84 / 88, right, biggest improvement first, where 12 section 5 gives 56 / 48 / 72: the header "Change" beside its sort arrow needs 84 px, and with a lower minimum the width resolver shrank the column to about 75 px at 1680 px; url 260 / 180 / 480, left, A to Z, not the flex column). Because what a rank cell shows depends on the check (a number, `>20`, Pending, a failure) and a change on more than one fact, the builders take the sort value and the screen's own `cell` and `cellTip`: `col.rank(id, sortValue, { cell, cellTip, header, headerTooltip, priority, width, sortable, defaultVisible })`, the same for `col.rankDelta` and `col.url`. A `null` sort value sorts last in both directions, as an unknown one does. `col.date` also takes `unknown` (what a row without a date says, with its reason as the tooltip), `marker` (a word before the date, such as Stale, shown also for a row without a date) and `cellTip`. Beside a marker the date never breaks and the pair wraps (the marker above it) before it spills into the next column, since a table-fixed cell does not clip; a date alone may wrap at its space in a narrow column, as it did before. The table sorts rows that tie on every sort key by row id, ascending whichever way the sort runs, as the API breaks ties, so client and server mode list the same order |
| 145 | `RankCellView`, `RankChangeView`, `RankingUrlView`, `StaleMarker` and `useRankTips` | 12 section 6 puts `RankCell`, `RankDeltaCell` and `URLCell` in `app/cells/` and has them call `formatRankCell`, `formatRankChange` and `describeRank`, which return English | They are in `features/rankings/rank-cells.tsx`, since only Rankings uses them so far. `lib/format/rank-display.ts` (`rankDisplay`, `changeDisplay`, `rowChangeDisplay`, `urlDisplay`) decides what a cell shows from the API's `RankCell`, `RankChange`, `consecutive_failures` and `UrlRef` and returns codes and numbers; the views put the words in through `rankings.rank` messages, with the words for a screen reader in hidden text and the glyph (`>20`, `↑5`, `New`, `+1`, the clock of a stale rank and the warning of a failing check) hidden from speech. `BestRankView` shares the words of the other rank columns ("Pending", "Not ranking", and "n/a" after a failed check, whose tooltip says why). One rule for a failed check: Rank shows the warning, Ranking URL and Best rank "n/a", Updated "Check failed" with its Stale marker, and Change says nothing, as it does before any check. The tone rule is applied with a fixed threshold of 2 places, since the API sends no mean daily change (see 20 section 5.3). `useRankTips(timeZone)` builds the tooltips: the rank's check and depth with the previous rank, a change's own sentence ("Improved 5 positions") with its from and to, the whole address of a ranking URL, Pending, a failed check and the stale marker. A tip's description is the rest of it where the cell's own text already says its first line (a change's words; `>20`, which is spoken as "not in top 20"), so a screen reader does not hear it twice. A long path keeps its last 12 characters (`PATH_END_CHARS`) in view and gives way at its start by CSS. The old `formatRankCell`, `classifyRankChange` and `formatRankChange` in `lib/format/rank.ts` are kept for the places that have the observations and no API state |
| 146 | `CopyButton` and controls in table cells | 3.7 puts `CopyButton` in `ui/copy-button.tsx` with `value`, `label`, `form` and `size`, shows the check for 1.5 s and has the error toast name the field; 12 section 6 and 20 section 6.3 enter widget mode with Enter or F2 | `ui/` may import only React, Base UI, Lucide, cva and `cn`, and the button needs the announcer and the clipboard helper, so it is `app/cells/copy-button.tsx` (`text`, `label`, `announcement`, `placement`), icon only, 24 px, with the clipboard code in `lib/dom/clipboard.ts` (the Clipboard API, then a selected read-only field). The check stays for 2 seconds, the name is "Copied" while it shows, and the failure toast says "Could not copy. Select the text and copy it yourself." (a table has no field to select). Widget mode is built for the controls marked `CELL_CONTROL` and entered with F2 only, since Enter opens the row on every data cell: Tab and Shift+Tab step between the controls round the ends, Escape returns to the cell at once (the table takes it before the tooltip) and the arrows go back to the grid. `col.keyword` takes `copy` and names its row header by the keyword alone (`DataTableColumn.cellLabel`). `RankingUrlView` links its path to the canonical URL (`webHref` allows http and https only, and refuses an address with a user name or password) and has the copy button, which lies over the end of the cell (`placement="overlay"`) unless a `+N` marker is beside the path (`inline`, a place of its own). A column whose cells hold such controls sets `DataTableColumn.hasControls` (`col.keyword` with `copy` does so itself); only then does the grid's hint say that F2 moves into them (`dataTable.hintControls`, otherwise `dataTable.hint`). The link departs from the specs for outbound links ([20-frontend-specification.md](../20-frontend-specification.md) section 7.2 `ExternalLink`, [20-accessibility.md](20-accessibility.md) section 9.1 rule 4, [12-tables.md](12-tables.md) section 6 `URLCell`): it is a `TextLink` in the link color, underlined on hover and focus, with no `ExternalLink` icon and no hover "open" icon, since a 14 px icon would take width from a column that has none to spare; its name says "in a new tab", and `rel` is `noopener noreferrer nofollow` as the spec has it. While a control of a cell has focus the table turns the cell's own tooltip off (`Tooltip` `disabled`, set from the focus handler of the grid), so the control's own tooltip is the one shown. Space on a link in a cell is taken by the table, which clicks it (Space would scroll the table), and widget mode ends when focus lands on the cell itself, not when the window loses focus |
| 147 | `col.features`, `col.aiOverview`, `col.competitor`, `col.sparkline` | Column types in 12 §5 and factories in 25 §7.1 | Added to `col.*` in `components/app/data-table/columns.tsx` and types in `lib/tables/column-types.ts`. None of the four sorts; priorities follow template 9.3 (`features` 3, `aiOverview` 2, `competitor` 4, `sparkline` 2) |
| 148 | `SparklineCell`, `SerpFeatureListView`, `AioStatusView`, `CompetitorRankView` | Cell components in 12 §6 | Implemented in `components/app/sparkline/` and `features/rankings/feature-cells.tsx`. `SparklineCell` renders 64 x 20 px SVG sparkline in both densities. `SerpFeatureListView` renders Lucide icons (owned in `text-primary-text`, present in `text-foreground-muted`) with accessible spoken list. `AioStatusView` renders cited badge, present not cited, absent, and not loaded states. `CompetitorRankView` shows competitor position or beyond-depth check |
| 149 | `marker` and `trailing` on `col.keyword` | Keyword cell decoration in 12 §6 | `col.keyword` accepts `marker` and `trailing` render functions. `TargetMismatchMarker` renders when `target_url_match === false`; `trailing` renders an arrow-up-right link that opens the ranking URL in a new tab without opening the keyword inspector |
| 150 | `ChartFrame.extendOption` and `rankAxis` | Custom chart axes and styling in 15 §7 | `ChartFrame` accepts `extendOption(baseOption, tokens)` callback so features can inject custom ECharts options without modifying internal chart builders. `rankAxis` (`lib/charts/rank-chart.ts`) provides inverted 1 to 20 scale up to the depth shown, guides at 3, 10, 20 with labels in right margin, and hatched depth bands |
| 151 | Merged Rank and Change column | 24 §9.3 shows separate Rank and Change columns | Rank and Change merged into a single Rank column (`col.rank`) with 32 px fixed rank box and fixed change slot to its right. Change column removed from default columns and URL `cols` |
