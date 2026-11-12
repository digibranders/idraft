'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { Delta, type DeltaTest } from '@/components/app/metric/delta';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Tooltip } from '@/components/ui/tooltip';
import { safeText, type CsvCell, type CsvTable } from '@/lib/csv/csv-write';
import { formatMetricDelta, type ChangeTone, type MetricDeltaInput } from '@/lib/format';
import type { Density } from '@/lib/tables/table-state';
import { cn } from '@/lib/utils';

/** A change in ratio points: the only unit the change axis is drawn in. */
export type PointsDeltaInput = MetricDeltaInput & { unit: 'points' };

/**
 * Ratio points, `low <= estimate <= high`, in the same unit as `change.value`. The domain must cover the intervals
 * (`changeDomain(rows)` is the way to get it): an estimate or interval beyond it is clamped to the track edge, with no
 * marker to say so.
 */
export interface ChangeInterval {
  estimate: number;
  low: number;
  high: number;
}

export type IntervalValue =
  | {
      kind: 'compare';
      interval: ChangeInterval;
      /** The only tone source: the bar is coloured only when `isDetectable` is true (R5). */
      change: PointsDeltaInput;
      /** `interim` while the test is unpaired ("unpaired, pooled counts"). */
      test: DeltaTest;
      /** The change for the table and CSV ("+50.0 pts"): `formatMetricDelta(change).text`. */
      changeText: string;
      /** "+9 to +77 pts", made by the caller (no points interval formatter exists). */
      intervalText: string;
    }
  | { kind: 'thin'; text?: string | undefined } // R2: default `chart.intervalBar.thin`
  | { kind: 'none'; text?: string | undefined }; // R6: default `chart.noValue`

interface IntervalRowBase {
  id: string;
  /** "best crm for startups, ChatGPT": the visible label and the first words of `accessibleText`. */
  label: string;
  /** An engine logo or other mark before the label; decorative, so it is hidden from assistive technology. */
  icon?: ReactNode;
  /** "best crm for startups, ChatGPT: +50 pts, 95% interval +9 to +77 pts, detectable". The row's only accessible content. */
  accessibleText: string;
  /** The hover and focus tooltip's second line: "25% to 75% (+50 pts), 2 of 8 then 6 of 8 answers". */
  tip?: string | undefined;
  href?: Route | undefined;
  value: IntervalValue;
}

export type DivergingRow = IntervalRowBase;

export interface DumbbellRow extends IntervalRowBase {
  /** The rates of the two windows, on the rate axis; null when that window has no rate (R2, R6). */
  previous: number | null;
  current: number | null;
  /** "31.9%, 612 of 1,920": the rate beside its count (R1), for the table and CSV. */
  previousText: string;
  currentText: string;
  /** Engine or entity colour of the current dot. */
  color: `chart-${1 | 2 | 3 | 4 | 5 | 6}` | 'chart-other';
}

export type ChangeDomain = readonly [low: number, high: number];

interface IntervalBarCommon {
  /** Names the list and the table: "Prompt movers". */
  caption: string;
  /** First table and CSV header: "Prompt". */
  labelHeader: string;
  density?: Density | undefined;
}

export type IntervalBarProps =
  | (IntervalBarCommon & { form: 'diverging'; rows: readonly DivergingRow[]; domain: ChangeDomain })
  | (IntervalBarCommon & {
      form: 'dumbbell';
      rows: readonly DumbbellRow[];
      /** `[0, ceiling]`: the next tenth above the highest rate, at least 0.1 (DS 15 section 6). */
      rateDomain: ChangeDomain;
      changeDomain: ChangeDomain;
    });

export interface IntervalCsvWords {
  /** Headers from `chart.intervalBar.*`. */
  change: string;
  interval: string;
  previous: string;
  current: string;
  /** `chart.intervalBar.thin` and `chart.noValue`. */
  thin: string;
  noValue: string;
}

type ChartColor = DumbbellRow['color'];

/** The only way a change gets a colour: the tone of `formatMetricDelta`, which is neutral unless detectable (R5). */
const TONE_FILL: Record<ChangeTone, string> = {
  positive: cn('bg-positive-solid'),
  negative: cn('bg-negative-solid'),
  neutral: cn('bg-chart-reference'),
};
const COLOR_FILL: Record<ChartColor, string> = {
  'chart-1': cn('bg-chart-1'),
  'chart-2': cn('bg-chart-2'),
  'chart-3': cn('bg-chart-3'),
  'chart-4': cn('bg-chart-4'),
  'chart-5': cn('bg-chart-5'),
  'chart-6': cn('bg-chart-6'),
  'chart-other': cn('bg-chart-other'),
};

/** The smallest domain: a tenth either way. */
const MIN_DOMAIN = 0.1;

/** Symmetric around 0: the largest bound up to the next tenth, at least 0.1 (DS 15 section 6). */
export function changeDomain(intervals: readonly ChangeInterval[]): ChangeDomain {
  const largest = Math.max(
    0,
    ...intervals.flatMap(({ low, high }) => [low, high].filter(Number.isFinite).map((bound) => Math.abs(bound))),
  );
  // The small subtraction keeps 0.3 * 10 = 3.0000000000000004 from rounding up to 0.4
  const ceiling = Math.max(MIN_DOMAIN, Math.ceil(largest * 10 - 1e-9) / 10);
  return [-ceiling, ceiling];
}

/** Where a value sits on a domain, in percent of the track, clamped to 0 to 100; 0 for a domain with no width. */
export function trackPercent(value: number, [low, high]: ChangeDomain): number {
  const span = high - low;
  if (!(span > 0) || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, ((value - low) / span) * 100));
}

const isDrawable = ({ estimate, low, high }: ChangeInterval): boolean => [estimate, low, high].every(Number.isFinite);

const percentText = (value: number): string => `${String(value)}%`;

type CompareValue = Extract<IntervalValue, { kind: 'compare' }>;

interface StatusWords {
  thin: string;
  none: string;
}

/** A row is its words (too few answers, unknown) or a drawing; the dumbbell's drawing carries its two rates. */
type Resolved = { kind: 'text'; text: string } | { kind: 'draw'; value: CompareValue };
type ResolvedDumbbell =
  { kind: 'text'; text: string } | { kind: 'draw'; value: CompareValue; previous: number; current: number };

function statusText(value: Exclude<IntervalValue, CompareValue>, words: StatusWords): string {
  return value.text ?? (value.kind === 'thin' ? words.thin : words.none);
}

function resolveDiverging(row: DivergingRow, words: StatusWords): Resolved {
  const { value } = row;
  if (value.kind !== 'compare') return { kind: 'text', text: statusText(value, words) };
  return isDrawable(value.interval) ? { kind: 'draw', value } : { kind: 'text', text: words.none };
}

function resolveDumbbell(row: DumbbellRow, words: StatusWords): ResolvedDumbbell {
  const { value, previous, current } = row;
  if (value.kind !== 'compare') return { kind: 'text', text: statusText(value, words) };
  // A window without a rate cannot be compared (R2), and a change that is not a number is unknown (R6)
  if (previous === null || current === null || !Number.isFinite(previous) || !Number.isFinite(current)) {
    return { kind: 'text', text: words.thin };
  }
  return isDrawable(value.interval) ? { kind: 'draw', value, previous, current } : { kind: 'text', text: words.none };
}

interface TrackProps {
  compact: boolean;
  children: ReactNode;
}

/**
 * One axis of a row. Narrow, it is a band as tall as its bars and as wide as the room its row leaves (`w-full`, which
 * shrinks beside the delta; `flex-1` would give a height basis of 0 inside the dumbbell's column). From 448 px it
 * stretches over the row's full height so the zero lines of neighbouring rows meet, and the band sits in the middle.
 */
function Track({ compact, children }: TrackProps): ReactElement {
  return (
    <div
      className={cn(
        'relative w-full min-w-0',
        compact ? 'h-4' : 'h-6',
        '@md:h-auto @md:w-auto @md:flex-1 @md:self-stretch',
      )}
    >
      {children}
    </div>
  );
}

function Band({ compact, children }: TrackProps): ReactElement {
  return (
    <div
      data-slot="interval-band"
      className={cn('absolute inset-x-0 top-1/2 -translate-y-1/2', compact ? 'h-4' : 'h-6')}
    >
      {children}
    </div>
  );
}

function ZeroLine({ domain }: { domain: ChangeDomain }): ReactElement {
  return (
    <div
      data-slot="interval-zero"
      className="absolute inset-y-0 w-px bg-border-strong"
      style={{ left: percentText(trackPercent(0, domain)) }}
    />
  );
}

/** The 95% interval of the change: a 1 px line with a 1 px cap at each end. */
function Whisker({ interval, domain }: { interval: ChangeInterval; domain: ChangeDomain }): ReactElement {
  const low = trackPercent(interval.low, domain);
  const high = trackPercent(interval.high, domain);
  return (
    <>
      <div
        data-slot="interval-whisker"
        className="absolute top-1/2 h-px bg-foreground-tertiary"
        style={{ left: percentText(Math.min(low, high)), width: percentText(Math.abs(high - low)) }}
      />
      {[low, high].map((position, index) => (
        <div
          key={index === 0 ? 'low' : 'high'}
          data-slot="interval-cap"
          className="absolute inset-y-1 w-px bg-foreground-tertiary"
          style={{ left: percentText(position) }}
        />
      ))}
    </>
  );
}

/** The words that stand in place of the drawing: tertiary text, cut with an ellipsis rather than overflowing. */
function StatusText({ text }: { text: string }): ReactElement {
  return (
    <div title={text} className="min-w-0 truncate @md:flex-1 @md:self-center">
      <span className="type-meta whitespace-nowrap text-foreground-tertiary">{text}</span>
    </div>
  );
}

/** The change in signed points, in a column of its own so every row's axis ends at the same place. */
function ChangeText({ value }: { value: CompareValue }): ReactElement {
  return (
    <div data-slot="interval-delta" className="w-20 shrink-0 @md:self-center">
      <Delta input={value.change} size="sm" test={value.test} tip={false} />
    </div>
  );
}

interface RowShellProps {
  row: IntervalRowBase;
  density: Density;
  children: ReactNode;
}

/**
 * One row. The visual part is hidden from assistive technology and the row is read once, from `accessibleText`. Below
 * 448 px the label has its own line and the axes run under it; from there on the label takes a 160 px column.
 */
function RowShell({ row, density, children }: RowShellProps): ReactElement {
  const compact = density === 'compact';
  const content = (
    <>
      <span className="sr-only">{row.accessibleText}</span>
      <div
        aria-hidden="true"
        className="flex flex-1 flex-col gap-1 py-1 @md:flex-row @md:items-stretch @md:gap-3 @md:py-0"
      >
        <div className="flex min-w-0 items-center gap-2 @md:w-40 @md:shrink-0 @md:self-center">
          {row.icon}
          <span className="min-w-0 flex-1 truncate type-body text-foreground">{row.label}</span>
        </div>
        {children}
      </div>
    </>
  );
  // A linked row is at least 32 px tall, above the 24 px minimum target
  const box = cn('flex flex-col', compact ? 'min-h-row-compact' : 'min-h-row');
  const trigger =
    row.href === undefined ? (
      <div className={box}>{content}</div>
    ) : (
      <Link
        href={row.href}
        className={cn(box, 'rounded-sm outline-none hover:bg-surface-hover focus-visible:focus-ring')}
      >
        {content}
      </Link>
    );
  return (
    <li>
      {/* The accessible text already says what the tooltip says: it is for the eye, and shows a cut label whole */}
      <Tooltip content={row.label} detail={row.tip} purpose="label">
        {trigger}
      </Tooltip>
    </li>
  );
}

/** The change axis: the 0 line, the 95% interval and the bar from 0 to the estimate or a dot at it. */
function ChangeAxis({
  value,
  domain,
  compact,
  mark,
}: {
  value: CompareValue;
  domain: ChangeDomain;
  compact: boolean;
  mark: 'bar' | 'dot';
}): ReactElement {
  const { estimate } = value.interval;
  const fill = TONE_FILL[formatMetricDelta(value.change).tone];
  const zero = trackPercent(0, domain);
  const at = trackPercent(estimate, domain);
  return (
    <Track compact={compact}>
      <ZeroLine domain={domain} />
      <Band compact={compact}>
        {mark === 'bar' ? (
          <div
            data-slot="interval-bar"
            className={cn('absolute inset-y-0 rounded-2xs', fill)}
            style={{ left: percentText(Math.min(zero, at)), width: percentText(Math.abs(at - zero)) }}
          />
        ) : (
          <div
            data-slot="interval-change-dot"
            className={cn('absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full', fill)}
            style={{ left: percentText(at) }}
          />
        )}
        <Whisker interval={value.interval} domain={domain} />
      </Band>
    </Track>
  );
}

function DivergingRowView({
  row,
  domain,
  density,
}: {
  row: DivergingRow;
  domain: ChangeDomain;
  density: Density;
}): ReactElement {
  const t = useTranslations('chart');
  const resolved = resolveDiverging(row, { thin: t('intervalBar.thin'), none: t('noValue') });
  return (
    <RowShell row={row} density={density}>
      {resolved.kind === 'text' ? (
        <StatusText text={resolved.text} />
      ) : (
        <div className="flex items-center gap-2 @md:flex-1 @md:items-stretch">
          <ChangeAxis value={resolved.value} domain={domain} compact={density === 'compact'} mark="bar" />
          <ChangeText value={resolved.value} />
        </div>
      )}
    </RowShell>
  );
}

function DumbbellRowView({
  row,
  rateDomain,
  changeDomain: domain,
  density,
}: {
  row: DumbbellRow;
  rateDomain: ChangeDomain;
  changeDomain: ChangeDomain;
  density: Density;
}): ReactElement {
  const t = useTranslations('chart');
  const compact = density === 'compact';
  const resolved = resolveDumbbell(row, { thin: t('intervalBar.thin'), none: t('noValue') });
  if (resolved.kind === 'text') {
    return (
      <RowShell row={row} density={density}>
        <StatusText text={resolved.text} />
      </RowShell>
    );
  }
  const from = trackPercent(resolved.previous, rateDomain);
  const to = trackPercent(resolved.current, rateDomain);
  // When the two rates are equal the filled current dot fully covers the hollow previous one (accepted)
  return (
    <RowShell row={row} density={density}>
      <div className="flex flex-col gap-1 @md:flex-1 @md:flex-row @md:items-stretch @md:gap-3">
        {/* The rates: two dots and a line, never two bars, which would invite reading the gap as precise */}
        <Track compact={compact}>
          <Band compact={compact}>
            <div
              data-slot="interval-link"
              className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-border-strong"
              style={{ left: percentText(Math.min(from, to)), width: percentText(Math.abs(to - from)) }}
            />
            <div
              data-slot="interval-dot-previous"
              className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-chart-reference bg-surface"
              style={{ left: percentText(from) }}
            />
            <div
              data-slot="interval-dot-current"
              className={cn(
                'absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full',
                COLOR_FILL[row.color],
              )}
              style={{ left: percentText(to) }}
            />
          </Band>
        </Track>
        {/* The difference, on its own aligned axis; under the rates when the row is narrow */}
        <div className="flex items-center gap-2 @md:flex-1 @md:items-stretch">
          <ChangeAxis value={resolved.value} domain={domain} compact={compact} mark="dot" />
          <ChangeText value={resolved.value} />
        </div>
      </div>
    </RowShell>
  );
}

/**
 * The change between two windows as HTML (CH-09, CH-10, CH-42). `diverging`: a bar from 0 to the change with its
 * 95% interval as a whisker. `dumbbell`: the two rates as dots on one axis and the change with its interval on a second,
 * aligned one. A change is coloured only when the test found it detectable, by the tone of `formatMetricDelta` and
 * nothing else (R5). A row keeps the order it is given.
 */
export function IntervalBar(props: IntervalBarProps): ReactElement {
  const density = props.density ?? 'default';
  return (
    <div className="@container">
      <ul aria-label={props.caption} className="flex flex-col">
        {props.form === 'diverging'
          ? props.rows.map((row) => <DivergingRowView key={row.id} row={row} domain={props.domain} density={density} />)
          : props.rows.map((row) => (
              <DumbbellRowView
                key={row.id}
                row={row}
                rateDomain={props.rateDomain}
                changeDomain={props.changeDomain}
                density={density}
              />
            ))}
      </ul>
    </div>
  );
}

const changeCell = (resolved: Resolved): string =>
  resolved.kind === 'text' ? resolved.text : resolved.value.changeText;
const intervalCell = (resolved: Resolved): string => (resolved.kind === 'text' ? '' : resolved.value.intervalText);

/** The Table view: label, previous and current (dumbbell), the change and its 95% interval; one row per row. */
export function IntervalBarTable(props: IntervalBarProps): ReactElement {
  const t = useTranslations('chart');
  const words: StatusWords = { thin: t('intervalBar.thin'), none: t('noValue') };
  const label: PlainColumn<IntervalRowBase> = { id: 'label', header: props.labelHeader, cell: (row) => row.label };
  const change = t('intervalBar.change');
  const interval = t('intervalBar.interval');
  if (props.form === 'diverging') {
    const columns: PlainColumn<DivergingRow>[] = [
      label,
      { id: 'change', header: change, cell: (row) => changeCell(resolveDiverging(row, words)) },
      { id: 'interval', header: interval, cell: (row) => intervalCell(resolveDiverging(row, words)) },
    ];
    return (
      <PlainTable<DivergingRow>
        caption={props.caption}
        columns={columns}
        rows={props.rows}
        rowKey={(row) => row.id}
        status="ready"
        errorState={null}
        emptyText={t('noValue')}
      />
    );
  }
  const columns: PlainColumn<DumbbellRow>[] = [
    label,
    {
      id: 'previous',
      header: t('intervalBar.previous'),
      cell: (row) => (row.previous === null ? '' : row.previousText),
    },
    {
      id: 'current',
      header: t('intervalBar.current'),
      cell: (row) => (row.current === null ? '' : row.currentText),
    },
    { id: 'change', header: change, cell: (row) => changeCell(resolveDumbbell(row, words)) },
    { id: 'interval', header: interval, cell: (row) => intervalCell(resolveDumbbell(row, words)) },
  ];
  return (
    <PlainTable<DumbbellRow>
      caption={props.caption}
      columns={columns}
      rows={props.rows}
      rowKey={(row) => row.id}
      status="ready"
      errorState={null}
      emptyText={t('noValue')}
    />
  );
}

/**
 * Every text cell and every header through `safeText`, so "+50.0 pts" is written as `'+50.0 pts`. A window without a
 * rate and an interval that is not known are empty cells (never 0); the change cell says why instead. Built at once,
 * so a click in the menu cannot throw.
 */
export function intervalBarCsv(props: IntervalBarProps, words: IntervalCsvWords): CsvTable {
  const status: StatusWords = { thin: words.thin, none: words.noValue };
  const changeCsv = (resolved: Resolved): CsvCell => safeText(changeCell(resolved));
  const intervalCsv = (resolved: Resolved): CsvCell =>
    resolved.kind === 'text' ? null : safeText(resolved.value.intervalText);
  if (props.form === 'diverging') {
    return {
      header: [props.labelHeader, words.change, words.interval].map(safeText),
      rows: props.rows.map((row) => {
        const resolved = resolveDiverging(row, status);
        return [safeText(row.label), changeCsv(resolved), intervalCsv(resolved)];
      }),
    };
  }
  return {
    header: [props.labelHeader, words.previous, words.current, words.change, words.interval].map(safeText),
    rows: props.rows.map((row) => {
      const resolved = resolveDumbbell(row, status);
      return [
        safeText(row.label),
        row.previous === null ? null : safeText(row.previousText),
        row.current === null ? null : safeText(row.currentText),
        changeCsv(resolved),
        intervalCsv(resolved),
      ];
    }),
  };
}
