# WP-07 detailed task plan: App components A (Delta, EngineLogo, Meter, Banner variants, statistics parts)

Brief: [docs/ai-visibility/work-packages/WP-07-app-parts-a.md](../../ai-visibility/work-packages/WP-07-app-parts-a.md).
Branch `ai/wp-07-app-parts-a`, worktree `.claude/worktrees/wp-07`, cut from `origin/develop` at `bc954394`.
Rows: SC-01, SC-02, SC-10, SC-15, SC-19, WB-A11Y-11 (6). Kind: web, component only. Contract: none (no route,
no MSW handler; WP-02 created no handler module for WP-07, and none is needed).

## 1. What exists, and what this plan decides from it

| Fact found in the code | Consequence |
|---|---|
| `lib/format/delta.ts` has `formatMetricDelta(input)` returning `{ text, label, tone, note }`; tone is `positive` or `negative` only when `isDetectable === true`, direction is not flat and polarity is not `neutral` | `Delta` never computes a tone itself; it maps `display.tone` to a class. `lib/format` is not touched |
| `lib/format/number.ts` has `formatSampleCount(k, n)` ("612 of 1,800", no noun), `formatInterval`, `formatInteger`, `EMPTY_VALUE = 'n/a'` | `SampleCount` adds the noun through messages; unknown renders `n/a`, never 0 |
| `lib/stats` has `MIN_OBSERVATIONS`, `isDetectableChange` (unpaired Newcombe, the "interim test" of D-2), `detectableChange` (panel sizing) | The interim label is a prop of `Delta`; the panel reuses these and adds no maths |
| `components/app/metric/` has `MetricStrip` (its `delta` and `meter` slots take a ReactNode), `ConfidenceIndicator` (`form`, `label`), `InsufficientPill` (`common.insufficient`) | New parts plug into those slots; `StatisticsPanel` uses `ConfidenceIndicator` and the hatched `bg-insufficient` ground |
| `features/costs/budget-meter.tsx` already implements the 23 section 11.2 meter (props `pct, softLimitPct, state, size, label`), used by `cost-breakdown.tsx`, `costs-screen.tsx`, tested in `costs.test.tsx` | `BudgetMeter` in `metric/meter.tsx` keeps that exact API on top of a generic `Meter`; the costs file becomes a re-export only under lease L3 |
| `components/app/status/banner.tsx`: `tone: info, warning, negative`, `placement: page, region`, `lead`, `message`, `actions`, `live`; tested in `status/status.test.tsx`; used by about 10 screens | Variants are additive (no prop renamed, no default changed); new tests go in a new `banner.test.tsx` |
| `@lobehub/icons-static-svg@1.95.1` is a dependency of `apps/web`; the approved preview (`design-preview/vendor.mjs`) uses `openai.svg`, `gemini-color.svg`, `google-color.svg`; `openai.svg` uses `fill="currentColor"` | `EngineLogo` imports those three files only; the OpenAI mark gets `dark:invert` as in `design-preview/interactions.js` (the approved visual) |
| Next types `*.svg` imports as `any` (`next/image-types/global`); Vitest resolves them to a URL string | One guard `markSrc(asset: unknown): string` handles both (`string`, or `{ src: string }`); no `any` flows into our code |
| API `EngineCode` is `chatgpt_web, gemini_web, google_ai_mode`; `lib/layouts/types.ts` also has `google_ai_overview` | `EngineLogo` takes the code as a string and shows the name alone for a code without a mark (07 section 5 rule 5) |
| No metric registry (`MetricKey`) and no stats API exist yet (WP-58 is wave 5) | `MetricInfo` and `StatisticsPanel` take their content as typed props; consumers map API data. 25 sections 9.7 and 9.9 name `metricKey`; recorded as a departure in As built |
| No `RefetchBar` component exists (17 section 3.4 names it) | `StatisticsPanel` keeps previous data at full opacity with `aria-busy` while refetching; the 2 px bar is the consuming inspector's, recorded as deferred |
| The `/design-system` gallery (`components/design-system/registry.ts`, `section-slugs.ts`) is where a new component is registered (AI_DEVELOPMENT_UI_RULES rule 19); `e2e/flows/design-system.spec.ts` runs axe on every section in both themes | Design-system entries are a new gallery section (lease L4); it is also the page the browser checks and the e2e flow use |
| `messages/en.json`: shared app components use `common.<part>` (`common.insufficient`, `common.copy`); WP-02 pre-created no namespace for WP-07 | Copy needs lease L1 (new sub-objects under `common`) |

Paths: the brief's owned paths win over 25-component-inventory.md (`ui/meter.tsx`, `cells/delta-cell.tsx`,
`ai/engine-badge.tsx`, `metric/budget-meter.tsx`). `DeltaCell` goes to `metric/delta-cell.tsx` (inside the brief's
`metric/delta*.tsx`), `Meter` and `BudgetMeter` to `metric/meter.tsx`, engines to `components/app/engine/`. Task 6
records each departure in 25.

## 2. Leases and questions for the coordinator (settle before Task 1)

| # | Path | Scope | Needed by |
|---|---|---|---|
| L1 | `apps/web/messages/en.json` | new sub-objects only: `common.delta`, `common.sampleCount`, `common.metricInfo`, `common.statistics` | Tasks 1 and 5 (blocking) |
| L2 | `apps/web/src/components/app/metric/sample-count.tsx` (+ test) | new file; the brief builds `SampleCount` but lists no file for it | Task 5. Fallback: export `SampleCount` from `statistics-panel.tsx` |
| L3 | `apps/web/src/features/costs/budget-meter.tsx` | body replaced by `export { BudgetMeter, type BudgetMeterProps } from '@/components/app/metric/meter';` so one meter exists; `costs.test.tsx` passes unchanged | Task 3. Without it the costs copy stays and As built records the duplicate for a follow-up |
| L4 | `apps/web/src/components/design-system/registry.ts`, `section-slugs.ts` | one entry each (slug `metric-parts`, title "Metrics and engines"), plus the new file `metric-parts-section.tsx` | Task 6 |
| L5 | `apps/web/e2e/flows/ai-app-parts-a.spec.ts` | new file (MASTER-PLAN 3.6 convention, as WP-09's lease) | Task 6 |
| L6 | `docs/design-system/25-component-inventory.md` | one "As built (WP-07)" line under 3.42, 8.5, 9.4, 9.6, 9.7, 9.9, 11.10, 15.1, 17.2 | Task 6 |

Question Q1 for the lead: the inspector citation banner (WB-PI-21, "Cited in 3 of 8 answers; last answer Nov 11,
09:05; 13 pages cited"). This plan gives "cited" the `info` tone and "not cited" a new `neutral` tone, so not being
cited reads as a fact, not a warning. No approved preview shows this banner; confirm or name the tones.

## Task 0: environment (no commit)

1. `git -C .claude/worktrees/wp-07 status -sb` shows `ai/wp-07-app-parts-a`, clean. Report
   `infra/dev/wp-status WP-07 planning "plan written" --rows 0/6 --tasks 0/7`.
2. The fresh worktree has no `node_modules` (checked: neither the root nor `apps/web`). From the worktree root:
   `infra/dev/heavy --lane medium --label wp-07-install -- pnpm install --frozen-lockfile`.
3. One test file during development (light, no lock), from the worktree root:
   `pnpm --dir apps/web exec vitest run src/components/app/metric/delta.test.tsx`.
   A folder or several files go through the medium lane:
   `infra/dev/heavy --lane medium --label wp-07-metric -- bash -c 'cd apps/web && pnpm exec vitest run src/components/app/metric --maxWorkers=2'`.
4. Prettier on changed files (light): `pnpm --dir apps/web exec prettier --check <paths relative to apps/web>`.
   Messages after any `en.json` edit (light): `pnpm --dir apps/web exec vitest run src/i18n/messages.test.ts`.
5. Never run `pnpm test`, `pnpm build`, `pnpm lint`, `pnpm typecheck` or `pnpm e2e` outside `infra/dev/heavy`.

## Rules for every task

- Tests first: write the test file, run it, see it fail for the right reason, then implement.
- File tools only (no heredocs, `sed` or replace scripts). Edit only the task's files.
- Strict types, explicit return types (`ReactElement` or `ReactElement | null`), no `any`, `readonly` arrays.
  Formatting only through `@/lib/format`; tones only from `formatMetricDelta`.
- Token and type utilities only (`type-meta`, `type-body-strong`, `num`, `text-foreground-secondary`), spacing
  scale only, no arbitrary values. Every visible string from messages (lease L1) or from props. ASCII copy, no
  em or en dashes in strings or comments (`src/test/source-text.test.ts` reads comments). The minus sign U+2212
  produced by `formatPointsDelta` is a minus, not a dash, and stays.
- Tests: `renderWithProviders` from `@/test/render`, `axe` from `@/test/axe`
  (`expect(await axe(container)).toHaveNoViolations()`), `user` from the render result. Test files sit beside the
  component as `<name>.test.tsx`. Tests assert tone classes; contrast in both themes is the Task 6 e2e axe run.
- Commit: `git add <the task's paths>` then `git commit -m "WP-07: <task title>"`. No attribution lines, no dashes.
- Review: a fresh Sonnet reviewer reads the task, this plan and the diff, runs the targeted tests, checks the house
  rules and the task's checklist, and returns PASS or a numbered fix list. For each guard marked "bites", the
  reviewer weakens it in a scratch change that is never committed, sees the named test fail, and restores it.

## Task 1: Delta and DeltaCell (SC-01)

Files: create `apps/web/src/components/app/metric/delta.tsx`, `delta.test.tsx`, `delta-cell.tsx`,
`delta-cell.test.tsx`. Edit `messages/en.json` `common.delta` only (L1).

API:

```ts
import type { MetricDeltaInput } from '@/lib/format';
export type DeltaTest = 'paired' | 'interim';
export interface DeltaTip {
  previousText?: string | undefined;   // "Previous 29.0%"
  intervalText?: string | undefined;   // "95% interval -1.1 to +4.6 pts", made by the caller (no points-interval formatter exists)
  method?: string | undefined;         // "paired, 243 prompts"
}
export interface DeltaProps {
  input: MetricDeltaInput;
  size?: 'sm' | 'md' | undefined;      // md: type-body-strong (strips); sm: type-meta
  test?: DeltaTest | undefined;        // 'interim' while the API sends no is_detectable (D-2); default 'paired'
  tip?: DeltaTip | false | undefined;  // false: the cell or strip item carries the tooltip
}
export function Delta(props: DeltaProps): ReactElement | null;
export interface DeltaCellProps extends Omit<DeltaProps, 'size'> { boundaryText?: string | null | undefined }
export function DeltaCell(props: DeltaCellProps): ReactElement;
// delta.tsx also exports useDeltaTip(input, test, tip): string, the tooltip text shared by Delta and DeltaCell
```

Behaviour:
- `display = formatMetricDelta(input)`. Tone class map, the only one: `positive: text-positive-text`,
  `negative: text-negative-text`, `neutral: text-foreground-secondary` (23 section 8.5: not detectable reads
  `foreground-secondary`). Visible `display.text` in `num` with `aria-hidden`; `sr-only` reads `display.label` plus
  the detectability words.
- `Delta` with `input.value` null or not finite returns `null` (renders nothing, never `0` or `n/a`; the strip leaves
  the slot out). `DeltaCell` with no comparison renders `n/a` (`EMPTY_VALUE`) in `text-foreground-tertiary`, since a
  table cell needs a value.
- Tooltip text, in order: `previousText`; then for `isDetectable === true` "Detectable change: the 95% interval of
  the change excludes 0" plus `method`; for `false` "Within normal variation" plus `intervalText`; for `null` no
  claim; then, when `test === 'interim'` and `isDetectable !== null`, "Interim test: unpaired, may understate
  uncertainty". With a tooltip the delta is a tab stop that opens it on focus (20 section 6.2 rule 6), as
  `MetricStrip` does.
- `DeltaCell`: right aligned, `type-table num`, carries its own tooltip unless `tip === false`; `boundaryText` adds
  the 12 px `GitCommitVertical` icon in `text-foreground-muted` with that text in the tooltip (07 section 6). Follow
  how `features/rankings/rank-cells.tsx` places tooltips in grid cells. No arrows on rates, ever.
- Messages `common.delta`: `detectable`, `withinVariation`, `interim`, `detectableTip`, `withinTip`, `interimTip`,
  `boundary` (Haiku writes the copy from 23 section 8.5 and doc 20 section 6).

Tests first (`delta.test.tsx`):
1. `never colours a change that is not detectable` (acceptance, bites): for every polarity, every sign (+5.3, -5.3,
   0) and `isDetectable` of `false` and `null`, the value has `text-foreground-secondary` and neither
   `text-positive-text` nor `text-negative-text`.
2. `colours a detectable change by its polarity`: up with `higher_is_better` is positive, up with `lower_is_better`
   negative, down mirrors, `neutral` polarity stays neutral, flat stays neutral.
3. `renders nothing when there is no comparison`: `value: null` and `value: NaN` leave the container empty.
4. `says the change and its detectability to a screen reader`: accessible text "up 5.3 pts" plus the detectable
   words; the visible text is `aria-hidden`.
5. `says within normal variation in the tooltip with the interval`; `labels the interim test` (focus opens the
   tooltip; the interim sentence appears only with `test="interim"`).
6. `leaves the tooltip to its container when tip is false`: no tab stop, no description.
7. axe clean for detectable, not detectable and interim.

`delta-cell.test.tsx`: `shows n/a, never 0, without a comparison`; `never colours a change that is not detectable`
(one case per polarity); `shows the version boundary icon with its text`; axe clean.

States: value, not detectable, no test, no comparison (nothing, or `n/a` in a cell), version boundary. Loading is the
container's skeleton (the strip and the table draw it already).

Checks: the two test files (light); prettier on the four files. Commit `WP-07: Delta and DeltaCell`.

Reviewer checklist: tone only from `formatMetricDelta`; one tone map; null renders nothing in `Delta`; the acceptance
test covers `null` detectability too; tooltip only on a focusable element; no `Intl` or `toFixed`; messages only
under `common.delta`; prove it bites on the tone map (make it use the sign of the value).

## Task 2: EngineLogo and EngineBadge with text alternatives (SC-02, WB-A11Y-11)

Files: create `apps/web/src/components/app/engine/marks.ts`, `engine-logo.tsx`, `engine-logo.test.tsx`,
`engine-badge.tsx`, `engine-badge.test.tsx`, `order.ts`, `order.test.ts`. No messages (the name is a prop).

API:

```ts
// marks.ts: the only importer of @lobehub/icons-static-svg in the app (ADR-DS-020 rule 2)
import openai from '@lobehub/icons-static-svg/icons/openai.svg';
export interface EngineMark { src: string; followsText: boolean }   // followsText: the monochrome OpenAI mark
export function markSrc(asset: unknown): string;                    // string (Vitest) or { src } (Next); else Error('Unexpected SVG import shape')
export function engineMark(engine: string): EngineMark | null;      // chatgpt_web, gemini_web, google_ai_mode, google_ai_overview
// order.ts: the fixed engine order (SC-02), the one list
export const ENGINE_ORDER: readonly string[];                       // chatgpt_web, gemini_web, google_ai_mode, google_ai_overview
export function byEngineOrder<T>(items: readonly T[], code: (item: T) => string): T[];   // unknown codes last, stable
// engine-logo.tsx
export interface EngineLogoProps { engine: string; name: string; hidden?: boolean | undefined; truncate?: boolean | undefined }
export function EngineLogo(props: EngineLogoProps): ReactElement;
// engine-badge.tsx
export interface EngineBadgeProps { engine: string; name: string; logo?: boolean | undefined }   // logo defaults to false (dense tables)
export function EngineBadge(props: EngineBadgeProps): ReactElement;
```

Behaviour:
- "Never logo only" is structural: `EngineLogo` renders the mark and the name together (`inline-flex items-center
  gap-2`); no export renders a mark alone. The mark is `<img src alt="" width={16} height={16}
  className="size-icon shrink-0">` (decorative, the name is the label; a fixed box so rows never shift), with
  `dark:invert` when `followsText`. Both Google surfaces use the Google mark.
- `hidden` (ADR rule 6) or a code without a mark: the name alone. `truncate` wraps the name in `Truncate`.
- `EngineBadge`: neutral subtle `Badge` (`components/ui/badge.tsx`) holding `EngineLogo` when `logo`, else the name.
  No brand colours. The observation class badge of 25 section 15.1 is out of scope (no wave 1 consumer).
- Name source: callers pass the API's `engine.label`, as `answer-inspector.tsx` does today.
- `markSrc` contains the risk that Next types the import as `any`: the value is typed `unknown` at once.

Tests first:
1. `engine-logo.test.tsx`, `logos have accessible names` (acceptance, WB-A11Y-11): for each of the four codes the
   image has `alt=""` (role `presentation`), the name is visible text, and a button wrapping it takes the engine
   name as its accessible name.
2. `shows the name alone for an engine without a mark, and when hidden`: no `img`.
3. `gives the mark a fixed 16 px box`: `width` and `height` are 16.
4. `lets the OpenAI mark follow the text colour`: `dark:invert` on ChatGPT only.
5. `uses the Google mark for AI Mode and AI Overview`: same `src`.
6. axe clean in a list of four engines.

`engine-badge.test.tsx`: `reads as the engine name with or without its logo`; axe clean.
`order.test.ts`: `puts engines in the fixed order with unknown codes last`; `markSrc` accepts a string and `{ src }`
and throws otherwise.

Checks: the three test files; prettier; then one medium lane typecheck now, because the SVG import typing is this
task's risk: `infra/dev/heavy --lane medium --label wp-07-types -- bash -c 'cd apps/web && pnpm typecheck'`. The
build side of the import shape is proven in Task 6 (`pnpm build`). Commit `WP-07: EngineLogo and EngineBadge`.

Reviewer checklist: no import of the package outside `marks.ts`; only three SVG files imported; `alt=""` always
present; no way to render a mark without a name; no recolouring other than the OpenAI invert; explicit width and
height; no `any` (check `markSrc`).

## Task 3: Meter and BudgetMeter (SC-15)

Files: create `apps/web/src/components/app/metric/meter.tsx`, `meter.test.tsx`. Under lease L3 only: replace the body
of `apps/web/src/features/costs/budget-meter.tsx` with the re-export.

API:

```ts
export interface MeterProps {
  value: number;                          // may exceed max; the fill stops at the track end
  max: number;                            // must be > 0, else a named Error
  warnFrom?: number | null | undefined;   // the fill turns warning from here; null: muted until the value passes max
  allWarning?: boolean | undefined;       // the hard limit was reached: the whole fill is warning
  tick?: number | null | undefined;       // the soft limit marker, in the value's unit
  label: string;                          // accessible name: "Active prompts"
  valueText: string;                      // "120 of 150 active prompts", "64% of $2,000.00"
  width: 'summary' | 'cell';              // 160 px or 64 px
}
export function Meter(props: MeterProps): ReactElement;
export interface BudgetMeterProps { pct: number; softLimitPct: number; state: BudgetStatus['state']; size: 'summary' | 'cell'; label: string }
export function BudgetMeter(props: BudgetMeterProps): ReactElement;   // same API and behaviour as the costs one
```

Behaviour (23 section 11.2, 25 section 3.42): 6 px tall (`h-1.5`), 1 px `border-border-strong` outline track,
`rounded-sm`, transparent inside; fill `bg-foreground-muted` below `warnFrom` and `bg-warning-solid` from it, the
whole fill warning with `allWarning`; tick 2 px by 10 px `bg-foreground-secondary`, `aria-hidden`. `role="meter"`,
`aria-valuemin=0`, `aria-valuemax=100`, `aria-valuenow` the clamped share, `aria-valuetext={valueText}` (the real
share, so 112% is said). The visible text value stays the caller's, next to the meter (the meter never carries the
number alone). A quota meter (WB-TPH-14, WB-SET-15) passes `warnFrom = max`: no warning until over, never red (cost
and quota are never coloured negative, 02 section 6). `BudgetMeter` maps `pct, softLimitPct, state` onto `Meter`
(`hard_exceeded` sets `allWarning`) and keeps `aria-valuetext` from `formatPercent` as today. Non-finite input is
treated as 0 (the costs rule `within`).

Tests first (`meter.test.tsx`):
1. `states its real share in words when the fill stops at the end`: value 168 of 150, `aria-valuenow` 100,
   `aria-valuetext` the caller's text, fill width 100%.
2. `stays muted until the quota is passed` (bites): with `warnFrom = max`, 149 of 150 has no warning fill and 151 has.
3. `turns warning from the soft limit, and wholly at the hard limit` (BudgetMeter 90 with soft 80; `hard_exceeded`).
4. `marks the soft limit with a tick hidden from screen readers`.
5. `refuses a max that is not positive` (named error).
6. `keeps the costs meter behaviour`: the four cases of `costs.test.tsx` `describe('BudgetMeter')` against the shared
   component.
7. axe clean, both widths.

After L3: `pnpm --dir apps/web exec vitest run src/features/costs/costs.test.tsx` passes unchanged.

States: below threshold, above threshold, over 100%, hard limit. Loading is the container's (the strip hides the meter
while loading).

Checks: `meter.test.tsx` and, with L3, `costs.test.tsx` (light, one file each). Commit `WP-07: Meter and BudgetMeter`.

Reviewer checklist: no red anywhere; the number is always in text; one implementation (or the duplicate recorded);
`costs.test.tsx` untouched; widths are tokens, not arbitrary values; prove it bites on `warnFrom`.

## Task 4: Banner variants for inspector headers (SC-19)

Files: edit `apps/web/src/components/app/status/banner.tsx`; create `banner.test.tsx` beside it. `status.test.tsx` is
not edited and must still pass.

API change (additive):

```ts
export type BannerTone = 'info' | 'warning' | 'negative' | 'neutral';   // neutral: a fact with no judgement (Q1)
placement: 'page' | 'region' | 'inspector';
// inspector: full width under InspectorHeader, no radius, border-b, px-4 py-2 (the inspector body gutter)
```

Behaviour: `neutral` uses `border-border-subtle bg-surface-subtle` with the `Info` icon in `text-foreground-tertiary`;
the live role rule is unchanged (`status` for every tone except `negative`). Inspector use (WB-PI-21): cited is
`tone="info"`, lead "Cited", message "Cited in 3 of 8 answers; last answer Nov 11, 09:05; 13 pages cited"; not cited
is `tone="neutral"`, "Not cited in any of the 8 answers". Every count shows its denominator; with no answers the
consumer shows no banner (unknown is never "0 of 0"). The copy itself belongs to WP-25 (inspector completion); the
gallery and tests pass sample strings as props.

Tests first (`banner.test.tsx`):
1. `sits under the inspector header without a radius`: `placement="inspector"` has `border-b`, no `rounded-md`.
2. `states a neutral fact without a warning colour`: no `warning`, `negative` or `info` class on `neutral`.
3. `announces a neutral banner politely when it appears`: `live` gives `role="status"`.
4. `keeps the page and region variants as they were`: their classes are unchanged.
5. axe clean for cited and not cited inside an inspector-like region.

Checks: `banner.test.tsx` and `status.test.tsx` (light). Grep the callers (`grep -rn "<Banner" apps/web/src`) and
confirm none needs a change. Commit `WP-07: Banner variants for inspector headers`.
Reviewer checklist: additive only; tokens only; icons still follow 18 section 4; no copy hard coded in `banner.tsx`.

## Task 5: StatisticsPanel, MetricInfo, SampleCount (SC-10)

Files: create `apps/web/src/components/app/metric/metric-info.tsx`, `metric-info.test.tsx`, `statistics-panel.tsx`,
`statistics-panel.test.tsx`; `sample-count.tsx` and `sample-count.test.tsx` under L2. Edit `messages/en.json`
`common.sampleCount`, `common.metricInfo`, `common.statistics` (L1).

API:

```ts
export type SampleNoun = 'observations' | 'answers' | 'checks' | 'prompts' | 'keywords';
export interface SampleCountProps { k: number | null; n: number | null; noun: SampleNoun; form?: 'k-of-n' | 'n-only' | undefined }
export function SampleCount(props: SampleCountProps): ReactElement;

export interface MetricInfoProps {
  name: string;                                  // "Mention rate"; the trigger reads "About Mention rate"
  definition: string;                            // one sentence
  formula: string;                               // in words
  denominatorText?: string | undefined;          // for the current view: "250 prompts, 1,800 valid answers"
  aggregation?: 'prompt_weighted' | 'observation_weighted' | undefined;
  methodVersion?: number | undefined;
  onOpenStatistics?: (() => void) | undefined;   // AI rates only
  methodologyHref: string;                       // always the last line
}
export function MetricInfo(props: MetricInfoProps): ReactElement;

export interface StatisticsContent {
  metricName: string; engine: { code: string; name: string }; scopeText: string;   // "core panel, 28 days"
  definition: string;
  estimate: { value: number | null; numerator: number | null; denominator: number | null; noun: SampleNoun;
    prompts: number | null; observationWeighted: number | null; insufficient: { valid: number; required: number } | null };
  interval: { low: number; high: number; methodText: string } | null;
  comparison: { delta: MetricDeltaInput; test: DeltaTest; periodText: string; designText: string;
    intervalText: string | null; gained: number | null; lost: number | null } | null;
  boundaries: ReadonlyArray<{ id: string; text: string }>;
}
export type StatisticsState =
  | { kind: 'loading' }
  | { kind: 'error'; title: string; reason: string; onRetry: () => void; retrying: boolean; errorId: InlineErrorProps['errorId'] }
  | { kind: 'empty'; reason: string; action?: ReactNode }
  | { kind: 'ready' | 'refetching'; data: StatisticsContent; partial?: string | undefined; stale?: string | undefined };
export interface StatisticsPanelProps {
  state: StatisticsState;
  placement: 'inspector-tab' | 'inspector-region';
  backTo?: { label: string; onBack: () => void } | null | undefined;
}
export function StatisticsPanel(props: StatisticsPanelProps): ReactElement;
```

Behaviour:
- `SampleCount`: `type-meta num`; `k-of-n` is `formatSampleCount(k, n)` plus the noun ("612 of 1,296 obs"); `n-only`
  is `formatInteger(n)` plus the plural noun ("250 prompts"). "obs" is visible and `aria-hidden`, with
  "observations" in `sr-only`. A null `k` or `n` renders `n/a`, never 0.
- `MetricInfo` (23 section 8.1, 22 section 10): `IconButton size="icon-xs"` with the 14 px `Info` icon, label "About
  {name}"; it opens `Popover width="max" padding="text"` (360 px, non-modal, Escape returns focus). Content in this
  fixed order, each line only when given: definition, formula, denominator and sample, aggregation, method version,
  an "Open statistics" button, and the "Methodology" `TextLink` always last. It explains meaning and never repeats
  the value's numbers (those stay in the value tooltip).
- `StatisticsPanel` (doc 20 section 6 as superseded by 23 section 8.6): non-modal content for the inspector; it
  never traps focus. Header line: metric name, `EngineLogo` with the engine name (one engine per panel: engines are
  never pooled silently), scope, and "Back to {record}" when `backTo`. Sections as `InspectorSection` (h3):
  1 Estimate (the percent through `formatPercent` with its `SampleCount` beside it, the prompts count, prompt and
  observation weighted side by side when both exist; `insufficient` draws the hatched `bg-insufficient` "Insufficient
  data" with "{valid} valid answers; {required} needed", never a percent or 0); 2 Uncertainty
  (`ConfidenceIndicator form="text-and-bar"` with `methodText`; a null interval says why in words); 3 Period
  comparison (`Delta size="md"` with `test`, the period, the design, gained and lost counts; the result sentence,
  "detectable" or "within normal variation", comes only from `isDetectable`); 5 Version boundaries (a list; none
  reads "No version change in this window"). Claims name the sample ("in 34% of responses to our 250 tracked
  prompts"). Movers (4) and panel sizing (6) wait for WP-58 and the panels packages: not rendered, not stubbed.
- States: `loading` keeps the section titles and draws `Skeleton` bars in each (no spinner); `error` is `InlineError`
  with Retry; `empty` is `EmptyState variant="inline"` with the reason and the optional action; `partial` and `stale`
  add a region `Banner` above the sections (`warning` with lead "Partial data:", `info` for stale); `refetching`
  keeps the data at full opacity with `aria-busy="true"` on the panel.

Tests first:
- `sample-count.test.tsx`: `always names the noun`; `reads obs as observations to a screen reader`; `shows n/a, never
  0, for an unknown count`; `n-only counts in the plural`.
- `metric-info.test.tsx`: `is a button named About {metric}`; `opens with the content in the fixed order and
  Methodology last` (DOM order); `leaves out lines it was not given`; `offers Open statistics only for AI rates and
  calls back`; `Escape closes and returns focus to the button`; axe clean open and closed.
- `statistics-panel.test.tsx`: `every percent shows its count` (each rendered percent has a `SampleCount` beside it);
  `unknown is never zero` (bites: a null value and an insufficient estimate render "Insufficient data" or `n/a`, no
  "0%"); `colour only for a detectable change` (a not detectable comparison has no tone class); `names the one engine
  it describes`; `labels the interim test`; `draws skeletons while loading and keeps data while refetching`; `offers
  Retry on error`; `explains an empty panel`; `shows partial and stale banners`; `is not a dialog and traps no focus`
  (no `role="dialog"`, Tab leaves it); `goes back to the record`; axe clean in every state.

Checks: the three test files (light), or the folder through the medium lane; `messages.test.ts` after the `en.json`
edit. Commit `WP-07: StatisticsPanel, MetricInfo and SampleCount`.

Reviewer checklist: the fixed popover order; no numbers in `MetricInfo`; the panel uses `Delta`,
`ConfidenceIndicator`, `EngineLogo` and `SampleCount` (no copies); every state rendered; no focus trap; movers and
sizing not faked; copy only in the L1 objects; prove it bites on the insufficient branch (render the percent anyway).

## Task 6: design-system entries, As built, rebase, final checks, push, report

1. Gallery (L4; Haiku writes it, Sonnet reviews): `components/design-system/metric-parts-section.tsx` with one
   `SpecimenGroup` per part: Delta (detectable up and down, not detectable, interim, null); DeltaCell in two small
   tables at `h-row-compact` (32 px, Compact) and `h-row` (40 px, Default), so both densities are seen; EngineLogo
   and EngineBadge (four engines, hidden, an unknown code); Meter (quota under, at and over; summary and cell);
   BudgetMeter (ok, soft, hard); Banner (inspector cited and not cited); SampleCount; MetricInfo; StatisticsPanel in
   each state (loading, ready, interim comparison, insufficient, empty, error, partial, stale) inside a 560 px region.
   Register slug `metric-parts` in `section-slugs.ts` and `registry.ts`. Sample strings in the gallery follow the
   other sections. Run `registry.test.tsx` and `section-nav.test.tsx` (light). Commit
   `WP-07: design system entries for the metric parts`.
2. E2E (L5): `apps/web/e2e/flows/ai-app-parts-a.spec.ts` runs against the production build with
   `NEXT_PUBLIC_API_MOCKING=all` (the Playwright `webServer` sets it). For each width (390, 768, 1024, 1280) and theme
   (`localStorage` key `idraft.theme`, as `design-system.spec.ts` does): open `/design-system/metric-parts`, run
   `expectAccessible(page)` (no serious or critical), and assert no horizontal page scroll. Keyboard path: Tab to a
   Delta with a tooltip and see it open; Tab to "About Mention rate", Enter opens the popover, Methodology is the
   last link, Escape closes it and focus is back on the button; the StatisticsPanel Retry and Back buttons are
   reachable and act on Enter. `design-system.spec.ts` covers the new slug in both themes with no change.
   Commit `WP-07: e2e flow for the metric parts`.
3. Browser check by hand (the brief's acceptance): follow the Dev Server Policy (first look with
   `lsof -nP -iTCP -sTCP:LISTEN` for this worktree's server), else start
   `NEXT_PUBLIC_API_MOCKING=all pnpm --dir apps/web dev --port <the session's port, 3101 to 3105>`; open
   `/design-system/metric-parts` at 390, 768, 1024 and 1280 px, light and dark, look at both density tables, and
   stop the server after.
4. As built (Haiku drafts, the lead checks): a blockquote "As built (AI visibility app parts A, WP-07, <date>, plan
   `docs/superpowers/plans/2026-11-13-ai-wp-07-app-parts-a.md`)" appended to `docs/20-frontend-specification.md`
   section 6 after the superseded note: the components and their paths, and the departures (paths, `metricKey`
   replaced by content props, no RefetchBar, movers and sizing deferred, the outcome of L3, the Banner tones of Q1);
   plus the L6 lines in 25. Commit `WP-07: As built notes`.
5. Rebase and final checks, from the worktree root, in this order, each through the lock:

```bash
git fetch origin && git rebase origin/develop
infra/dev/heavy --lane medium --label wp-07-lint   -- bash -c 'cd apps/web && pnpm lint'
infra/dev/heavy --lane medium --label wp-07-types  -- bash -c 'cd apps/web && pnpm typecheck'
infra/dev/heavy --lane medium --label wp-07-format -- bash -c 'cd apps/web && pnpm format:check'
infra/dev/heavy --label wp-07-test  -- bash -c 'cd apps/web && pnpm test'
infra/dev/heavy --label wp-07-build -- bash -c 'cd apps/web && pnpm build'
infra/dev/heavy --label wp-07-e2e   -- bash -c 'cd apps/web && E2E_PORT=3107 pnpm exec playwright test --project=e2e e2e/flows/ai-app-parts-a.spec.ts e2e/flows/design-system.spec.ts'
```

   A conflict in `en.json` keeps both sides, then `messages.test.ts`. A failure is fixed in the owning task's files
   and only the failed check is run again.
6. Whole-package review: a second fresh Sonnet reviewer reads the full diff against the brief's acceptance criteria
   and the six rows, opens `/design-system/metric-parts` at the four widths in both themes, and lists the guards it
   weakened with the failing test names (tasks 1, 3, 5). Report `review` with `infra/dev/wp-status` at its start.
7. Push: if develop moved, `git fetch origin && git rebase origin/develop` again and re-run the targeted tests; then
   `git push origin HEAD:develop` (fast forward only; a rejection means rebase again). Never `main`, never
   `infra/ship.sh`.
8. Report: `infra/dev/wp-status WP-07 merged "<note>" --rows 6/6 --tasks 7/7` and the same line to the coordinator,
   naming the leases to release (L1 to L6).

## Deferred to the consuming packages (by design)

| What | Where it lands |
|---|---|
| Delta, DeltaCell and EngineLogo in real pages, strips, legends and columns, with real data and their page-level loading, empty, error, partial and stale states | W3 web packages, WB-OV, WB-CIT, WB-CMP (the inventory's "Needed by") |
| The citation banner copy and data in the prompt inspector (WB-PI-21) | WP-25 inspector completion |
| The quota meter "120 of 150 active prompts" (WB-TPH-14) and the budgets page (WB-SET-15) | Their packages, once the CF-11 limits read exists |
| `itab=stats` and `stats=<metric>:<engine>` URL state, the 560 px region, RefetchBar | The inspector and statistics consumers (WP-25, WP-58 web side) |
| Movers (BH) and panel sizing sections; the paired test and server interval that end the "interim" label | WP-58 and the panels packages |
| Single-key shortcuts | None: these parts register no shortcut, so `useShortcut` is not used |

Rows closed: SC-01 (Task 1), SC-02 and WB-A11Y-11 (Task 2), SC-15 (Task 3), SC-19 (Task 4), SC-10 (Task 5); each by
its named tests plus the gallery entry and the e2e axe run.
