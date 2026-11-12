'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { SpecimenGroup, SpecimenRow } from './specimen';
import { TableScroll } from './table-scroll';
import { ChartFrame, type CategoryFrameProps } from '@/components/app/chart/chart-frame';
import { ChartLegend, type LegendItem } from '@/components/app/chart/chart-legend';
import { SmallSampleMarker } from '@/components/app/chart/small-sample-marker';
import { useRateTipWords } from '@/components/app/chart/use-rate-tip-words';
import { SparklineCell, type SparklineCellProps } from '@/components/app/sparkline/sparkline-cell';
import { useSparklineTip, type SparkTipPoint } from '@/components/app/sparkline/sparkline-tip';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import { SegmentedControl, type SegmentedControlItem } from '@/components/ui/segmented-control';
import type { ChartBoundary } from '@/lib/charts/boundaries';
import type { CategorySeries, SeriesRole } from '@/lib/charts/category-chart';
import { rateBandOption, type RateBandPoint } from '@/lib/charts/rate-band-chart';
import { rateTipText, type RateTipWords } from '@/lib/charts/rate-tip';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { formatInteger, formatInterval, formatPercent, formatRankInline, formatSampleCount } from '@/lib/format';
import { rateState, wilsonInterval } from '@/lib/stats';
import { DEFAULT_DENSITY, type Density } from '@/lib/tables/table-state';
import { cn } from '@/lib/utils';

/*
 * Every value on this page is fixed (no clock, no random numbers), so the preview and its visual test look the
 * same each time. Counts sit beside every percent and an unknown value is never a zero (rules R1 and R6).
 */

const formatRate = (value: number): string => formatPercent(value, { decimals: 0 });

const BRAND: SeriesRole = { kind: 'brand' };
const GEMINI_ROLE: SeriesRole = { kind: 'palette', index: 2 };
const AI_MODE_ROLE: SeriesRole = { kind: 'palette', index: 3 };
const REFERENCE: SeriesRole = { kind: 'reference' };

const DENSITY_ITEMS: readonly SegmentedControlItem<Density>[] = [
  { value: 'default', label: 'Default' },
  { value: 'compact', label: 'Compact' },
];

/* ---------- 1. ChartFrame, line with rate bands ---------- */

const WEEKS: readonly string[] = [
  'Aug 24',
  'Aug 31',
  'Sep 7',
  'Sep 14',
  'Sep 21',
  'Sep 28',
  'Oct 5',
  'Oct 12',
  'Oct 19',
  'Oct 26',
  'Nov 2',
  'Nov 9',
];

/** The valid answers of one engine in one week: `k` name the brand, out of `n`, over `prompts` prompts. */
interface Answers {
  k: number;
  n: number;
  prompts: number;
}

const answersOf = (prompts: number, n: number, ks: readonly number[]): Answers[] => ks.map((k) => ({ k, n, prompts }));

const CHATGPT = answersOf(40, 80, [22, 24, 23, 26, 27, 29, 31, 30, 33, 35, 34, 36]);
const GEMINI = answersOf(40, 80, [18, 17, 19, 18, 20, 19, 21, 22, 20, 23, 22, 24]);
const CHATGPT_PREVIOUS = answersOf(40, 80, [20, 21, 22, 21, 23, 24, 23, 25, 24, 26, 27, 26]);
/** AI Mode is asked on 10 prompts: two thin weeks (3 answers each) and one week with no answers at all. */
const AI_MODE_COUNTS: readonly (readonly [number, number])[] = [
  [2, 8],
  [1, 3],
  [3, 9],
  [0, 0],
  [3, 10],
  [2, 10],
  [4, 10],
  [5, 9],
  [1, 3],
  [6, 10],
  [5, 8],
  [6, 10],
];
const AI_MODE: Answers[] = AI_MODE_COUNTS.map(([k, n]) => ({ k, n, prompts: 10 }));

const MENTION_LINK = 'https://app.idraft.test/design-system/charts#mention-rate';
const BOUNDARIES: readonly ChartBoundary[] = [{ at: 'Oct 5', label: 'Extractor v4' }];

function ratePoint({ k, n, prompts }: Answers, withBand: boolean, words: RateTipWords): RateBandPoint {
  const state = rateState(n);
  const value = n === 0 ? null : k / n;
  const band = withBand && state === 'ok' ? wilsonInterval(k, n) : null;
  const thin = state === 'insufficient';
  return { value, band, thin, tip: rateTipText({ value, k, n, prompts, band, thin }, words) };
}

interface RateEntry {
  id: string;
  name: string;
  role: SeriesRole;
  answers: readonly Answers[];
  /** The previous period has no band. */
  withBand: boolean;
}

const RATE_ENTRIES: readonly RateEntry[] = [
  { id: 'chatgpt', name: 'ChatGPT', role: BRAND, answers: CHATGPT, withBand: true },
  { id: 'gemini', name: 'Gemini', role: GEMINI_ROLE, answers: GEMINI, withBand: true },
  { id: 'ai-mode', name: 'AI Mode', role: AI_MODE_ROLE, answers: AI_MODE, withBand: true },
  // One engine's own earlier weeks: engines are never pooled into one "previous period"
  { id: 'previous', name: 'ChatGPT, previous period', role: REFERENCE, answers: CHATGPT_PREVIOUS, withBand: false },
];

interface RateModel {
  series: CategorySeries[];
  points: Record<string, RateBandPoint[]>;
  ceiling: number;
}

function rateModel(words: RateTipWords): RateModel {
  const built = RATE_ENTRIES.map((entry) => ({
    entry,
    points: entry.answers.map((answers) => ratePoint(answers, entry.withBand, words)),
  }));
  const highest = built
    .flatMap(({ points }) => points)
    .reduce((top, point) => Math.max(top, point.band?.high ?? 0, point.value ?? 0), 0);
  return {
    series: built.map(({ entry, points }) => ({
      id: entry.id,
      name: entry.name,
      role: entry.role,
      values: points.map((point) => point.value),
    })),
    points: Object.fromEntries(built.map(({ entry, points }) => [entry.id, points])),
    // The next tenth above the highest value or band, as the prompt inspector's chart does
    ceiling: Math.min(1, Math.ceil(highest * 10 - 1e-9) / 10),
  };
}

function MentionRateSpecimen(): ReactElement {
  const words = useRateTipWords();
  const model = useMemo(() => rateModel(words), [words]);
  const cellText = useCallback(
    (seriesId: string, index: number): string | null => model.points[seriesId]?.[index]?.tip ?? null,
    [model],
  );
  const extendOption = useCallback(
    (option: Record<string, unknown>, tokens: ChartTokens): Record<string, unknown> =>
      rateBandOption(option, tokens, {
        points: model.points,
        ceiling: model.ceiling,
        // The theme is a class of the page, as in the prompt inspector
        dark: document.documentElement.classList.contains('dark'),
        previousId: 'previous',
        boundaries: BOUNDARIES,
      }),
    [model],
  );
  return (
    <div id="mention-rate">
      <ChartFrame
        title="Mention rate by engine"
        variant="panel"
        meta="Last 12 weeks, 40 prompts, 1 version boundary"
        footnote="Method: prompt weighted, 95% Wilson intervals. Excludes branded prompts."
        kind="line"
        categories={WEEKS}
        categoryHeader="Week"
        series={model.series}
        formatValue={formatRate}
        cellText={cellText}
        extendOption={extendOption}
        menu={{ fileName: 'mention-rate', link: MENTION_LINK, png: true, csv: true }}
        height={240}
        summary="ChatGPT rises from 22 of 80 answers to 36 of 80 answers over the 12 weeks and Gemini from 18 of 80 to 24 of 80. AI Mode is asked on 10 prompts: its weeks of Aug 31 and Oct 19 have 3 answers each, too few for a rate, and its week of Sep 14 has no answers."
        status="ready"
      />
    </div>
  );
}

/* ---------- 2. ChartFrame, stacked bars ---------- */

const RECENT_WEEKS = WEEKS.slice(-8);
/** The valid answers of the line chart's last 8 weeks, so both charts tell the same story. */
const recentAnswers = (answers: readonly Answers[]): number[] => answers.slice(-RECENT_WEEKS.length).map(({ n }) => n);
const ANSWER_SERIES: readonly CategorySeries[] = [
  { id: 'chatgpt', name: 'ChatGPT', role: BRAND, values: recentAnswers(CHATGPT) },
  { id: 'gemini', name: 'Gemini', role: GEMINI_ROLE, values: recentAnswers(GEMINI) },
  { id: 'ai-mode', name: 'AI Mode', role: AI_MODE_ROLE, values: recentAnswers(AI_MODE) },
];

/* ---------- 3. ChartFrame, html body ---------- */

const DOMAIN_ANSWERS = 160;

interface DomainRow {
  domain: string;
  cited: number;
  own: boolean;
}

/** Largest first, as a ranked list is. */
const DOMAINS: readonly DomainRow[] = [
  { domain: 'hubspot.com', cited: 71, own: false },
  { domain: 'idraft.ai', cited: 52, own: true },
  { domain: 'zapier.com', cited: 38, own: false },
  { domain: 'reddit.com', cited: 33, own: false },
  { domain: 'g2.com', cited: 27, own: false },
];
const MOST_CITED = DOMAINS.reduce((top, row) => Math.max(top, row.cited), 0);

const citedText = (row: DomainRow): string => `${formatSampleCount(row.cited, DOMAIN_ANSWERS)} answers`;

const DOMAIN_LEGEND: readonly LegendItem[] = [
  { id: 'own', name: 'Your domain', role: BRAND, swatch: 'dot', pressed: true },
  { id: 'other', name: 'Other domains', role: { kind: 'other' }, swatch: 'dot', pressed: true },
];

const DOMAIN_COLUMNS: readonly PlainColumn<DomainRow>[] = [
  { id: 'domain', header: 'Domain', cell: (row) => row.domain },
  { id: 'cited', header: 'Cited in', cell: (row) => <span className="num">{citedText(row)}</span> },
  {
    id: 'share',
    header: 'Share of answers',
    cell: (row) => <span className="num">{formatRate(row.cited / DOMAIN_ANSWERS)}</span>,
  },
  {
    id: 'interval',
    header: '95% interval',
    cell: (row) => {
      const band = wilsonInterval(row.cited, DOMAIN_ANSWERS);
      return <span className="num">{band === null ? 'n/a' : formatInterval(band.low, band.high)}</span>;
    },
  },
];

/** Bars in HTML: a ranked list, the own domain in the brand colour and the rest neutral, hatched under Patterns. */
function DomainBars({ patterns }: { patterns: boolean }): ReactElement {
  return (
    <ul aria-label="Cited domains" className="flex flex-col gap-3">
      {DOMAINS.map((row) => (
        <li key={row.domain} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <span className={row.own ? 'type-body-strong' : 'type-body'}>{row.domain}</span>
            <span className="num type-meta">{`${formatRate(row.cited / DOMAIN_ANSWERS)}, ${citedText(row)}`}</span>
          </div>
          <div
            aria-hidden="true"
            className={cn(
              'h-2 rounded-xs',
              row.own ? 'bg-chart-1' : patterns ? 'bg-insufficient' : 'bg-chart-bar-neutral',
            )}
            style={{ width: `${String((row.cited / MOST_CITED) * 100)}%` }}
          />
        </li>
      ))}
    </ul>
  );
}

const DOMAIN_TABLE = (
  <PlainTable<DomainRow>
    caption="Citations by domain"
    columns={DOMAIN_COLUMNS}
    rows={DOMAINS}
    rowKey={(row) => row.domain}
    status="ready"
    errorState={null}
    emptyText="No domains were cited"
  />
);

const DOMAIN_CSV = {
  header: ['Domain', 'Cited in', 'Share of answers'],
  rows: DOMAINS.map((row) => [row.domain, citedText(row), formatRate(row.cited / DOMAIN_ANSWERS)]),
};

/* ---------- 4. ChartFrame states ---------- */

const STATE_WEEKS: readonly string[] = ['Oct 19', 'Oct 26', 'Nov 2', 'Nov 9'];
const STATE_SERIES: readonly CategorySeries[] = [
  { id: 'answers', name: 'Answers collected', role: BRAND, values: [80, 80, 77, 80] },
];
/** What every state specimen shares: one line of counts, so no percent needs its own count here. */
const STATE_CHART: Omit<CategoryFrameProps, 'title'> = {
  kind: 'line',
  variant: 'panel',
  meta: 'Last 4 weeks, 40 prompts',
  categories: STATE_WEEKS,
  categoryHeader: 'Week',
  series: STATE_SERIES,
  formatValue: formatInteger,
  height: 180,
  summary: 'Answers collected each week, between 77 and 80.',
};

function RefetchSpecimen(): ReactElement {
  const [refetching, setRefetching] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Button size="sm" className="self-start" onClick={() => setRefetching((on) => !on)}>
        {refetching ? 'Stop refetch' : 'Start refetch'}
      </Button>
      <ChartFrame {...STATE_CHART} title="Answers collected, refetching" status={refetching ? 'refetching' : 'ready'} />
    </div>
  );
}

function ErrorSpecimen(): ReactElement {
  const [retrying, setRetrying] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const retry = (): void => {
    setRetrying(true);
    timer.current = window.setTimeout(() => setRetrying(false), 1000);
  };
  return (
    <ChartFrame
      {...STATE_CHART}
      title="Answers collected, error"
      status="error"
      error={{
        title: 'Could not load the trend',
        reason: 'The server returned an error. Your filters are unchanged.',
        errorId: {
          id: 'req_7f3a91c2',
          label: 'Error ID req_7f3a91c2',
          copyLabel: 'Copy error ID',
          copiedLabel: 'Error ID copied',
        },
        onRetry: retry,
        retrying,
        retryLabel: 'Retry',
      }}
    />
  );
}

function StatesSpecimen(): ReactElement {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="min-w-0">
        <ChartFrame {...STATE_CHART} title="Answers collected, loading" status="loading" />
      </div>
      <RefetchSpecimen />
      <div className="min-w-0">
        <ChartFrame
          {...STATE_CHART}
          title="Answers collected, empty"
          status="empty"
          empty={{
            title: 'Trends need at least 2 weeks',
            reason: 'Prompts are asked on Mondays and Thursdays; the next answers arrive Thu Nov 19.',
            action: (
              <LinkButton size="sm" render={<Link href="/design-system/charts" />}>
                Open schedules
              </LinkButton>
            ),
          }}
        />
      </div>
      <div className="min-w-0">
        <ErrorSpecimen />
      </div>
      <div className="min-w-0">
        <ChartFrame
          {...STATE_CHART}
          title="Answers collected, stale"
          status="ready"
          notice={{ kind: 'stale', text: 'Stale: last collected Nov 9, 18:30 CET' }}
        />
      </div>
      <div className="min-w-0">
        <ChartFrame
          {...STATE_CHART}
          title="Answers collected, partial"
          status="ready"
          notice={{ kind: 'partial', text: 'Partial data: 31 of 40 prompts asked this week' }}
        />
      </div>
    </div>
  );
}

/* ---------- 5. ChartLegend ---------- */

type LegendEntry = Omit<LegendItem, 'pressed'>;

const SWATCH_LEGEND: readonly LegendEntry[] = [
  { id: 'chatgpt', name: 'ChatGPT', role: BRAND },
  { id: 'gemini', name: 'Gemini', role: GEMINI_ROLE },
  { id: 'previous', name: 'ChatGPT, previous period', role: REFERENCE },
  { id: 'other', name: 'Other engines', role: { kind: 'other' } },
];
const MARKER_LEGEND: readonly LegendEntry[] = [
  { id: 'chatgpt', name: 'ChatGPT', role: BRAND, swatch: { marker: 'circle' } },
  { id: 'gemini', name: 'Gemini', role: GEMINI_ROLE, swatch: { marker: 'rect' } },
  { id: 'ai-mode', name: 'AI Mode', role: AI_MODE_ROLE, swatch: { marker: 'triangle' } },
  { id: 'perplexity', name: 'Perplexity', role: { kind: 'palette', index: 4 }, swatch: { marker: 'diamond' } },
];

/** A legend that toggles its series, with the ones in `off` turned off to start. */
function ToggleLegend({
  title,
  items,
  off,
}: {
  title: string;
  items: readonly LegendEntry[];
  off: string;
}): ReactElement | null {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set([off]));
  const toggle = (id: string): void =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <ChartLegend
      title={title}
      items={items.map((item) => ({ ...item, pressed: !hidden.has(item.id) }))}
      onToggle={toggle}
    />
  );
}

/* ---------- 6. Tooltip words ---------- */

function TooltipWordsSpecimen(): ReactElement {
  const words = useRateTipWords();
  const rows: readonly { label: string; text: string }[] = [
    {
      label: 'Full row',
      text: rateTipText(
        { value: 27 / 80, k: 27, n: 80, prompts: 40, band: wilsonInterval(27, 80), thin: false },
        words,
      ),
    },
    {
      label: 'Pooled, prompt weighted',
      text: rateTipText(
        { value: 96 / 320, k: 96, n: 320, prompts: 40, band: wilsonInterval(96, 320), thin: false, pooledWeeks: 4 },
        words,
      ),
    },
    { label: 'Thin row', text: rateTipText({ value: 1 / 3, k: 1, n: 3, band: null, thin: true }, words) },
    { label: 'No answers', text: rateTipText({ value: null, k: null, n: 0, band: null, thin: false }, words) },
  ];
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <SpecimenRow key={row.label} label={row.label}>
          <span className="num type-table">{row.text}</span>
        </SpecimenRow>
      ))}
    </div>
  );
}

/* ---------- 7. SmallSampleMarker ---------- */

const rowHeight = (density: Density): string => (density === 'compact' ? 'h-row-compact' : 'h-row');

function SmallSampleSpecimen({ density }: { density: Density }): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <p className="type-body">
        {'AI Mode in the week of Aug 31: '}
        <SmallSampleMarker answers={3} form="text" />
        {', so no rate is shown.'}
      </p>
      <SpecimenRow label="Cell, with tip">
        <div className={cn('flex items-center', rowHeight(density))}>
          <SmallSampleMarker answers={3} form="cell" />
        </div>
      </SpecimenRow>
      <SpecimenRow label="Cell, tip on the table cell">
        <div className={cn('flex items-center', rowHeight(density))}>
          <SmallSampleMarker answers={2} form="cell" tip={false} />
        </div>
      </SpecimenRow>
    </div>
  );
}

/* ---------- 8. SparklineCell ---------- */

const MONTHS: readonly string[] = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
const VOLUMES: readonly (number | null)[] = [6600, 7400, 5400, 8100, 8100, 9900, 8100, 8100, 6600, null, 8100, 9900];
const SPARK_WEEKS: readonly string[] = ['Sep 21', 'Sep 28', 'Oct 5', 'Oct 12', 'Oct 19', 'Oct 26', 'Nov 2', 'Nov 9'];
/** Answers that name the brand out of 80 each week; `null` is a week with no answers. */
const COMPETITOR_RATE: readonly (number | null)[] = [25, 26, 26, null, 27, 28, 28, 29];
const OWN_RATE: readonly (number | null)[] = [28, 30, 31, 33, 34, 36, 38, 40];
const RATE_ANSWERS = 80;
const RANK_DEPTH = 20;
/** 26 is past the tracked depth: the cell breaks its line there and the words say "not in top 20", never "#26". */
const UNRANKED_WEEK_RANK = 26;
const UNRANKED_WEEK = SPARK_WEEKS[3] ?? '';
const RANKS: readonly number[] = [8, 7, 9, UNRANKED_WEEK_RANK, 6, 5, 4, 3];

/** A rank past the tracked depth is unknown, not a number. */
const rankText = (rank: number | undefined): string =>
  formatRankInline({ rank: rank === undefined || rank > RANK_DEPTH ? null : rank, depth: RANK_DEPTH });

interface SparkRowSpec {
  id: string;
  kind: string;
  /** The tooltip's first line. */
  title: string;
  label: string;
  cell: Pick<SparklineCellProps, 'values' | 'kind' | 'tone' | 'rankDepth'>;
  points: readonly SparkTipPoint[];
}

function rateRow(
  spec: { id: string; kind: string; title: string; tone: 'reference' | 'own' },
  counts: readonly (number | null)[],
  words: RateTipWords,
): SparkRowSpec {
  const share = (k: number): string => `${formatRate(k / RATE_ANSWERS)} (${words.answers(k, RATE_ANSWERS)})`;
  const known = counts.filter((k): k is number => k !== null);
  const first = known[0];
  const last = known.at(-1);
  return {
    ...spec,
    label:
      first === undefined || last === undefined
        ? `${spec.title}: no answers`
        : `${spec.title}: from ${share(first)} to ${share(last)}`,
    cell: { values: counts.map((k) => (k === null ? null : k / RATE_ANSWERS)), kind: 'rate', tone: spec.tone },
    points: counts.map((k, index) => ({
      dateText: SPARK_WEEKS[index] ?? '',
      valueText: k === null ? words.noAnswers : `${formatRate(k / RATE_ANSWERS)}, ${words.answers(k, RATE_ANSWERS)}`,
    })),
  };
}

function sparkRows(words: RateTipWords): SparkRowSpec[] {
  return [
    {
      id: 'count',
      kind: 'Count (search volume)',
      title: 'Search volume, last 12 months',
      label: `Search volume, last 12 months: from ${formatInteger(VOLUMES[0] ?? 0)} to ${formatInteger(VOLUMES.at(-1) ?? 0)} searches a month, no volume in Jul`,
      cell: { values: VOLUMES, kind: 'count', tone: 'reference' },
      points: VOLUMES.map((volume, index) => ({
        dateText: MONTHS[index] ?? '',
        valueText: volume === null ? 'No volume' : formatInteger(volume),
      })),
    },
    rateRow(
      { id: 'rate', kind: 'Rate (mention rate)', title: 'Mention rate, last 8 weeks', tone: 'reference' },
      COMPETITOR_RATE,
      words,
    ),
    rateRow(
      { id: 'own', kind: 'Rate, own brand', title: 'Mention rate of idraft.ai, last 8 weeks', tone: 'own' },
      OWN_RATE,
      words,
    ),
    {
      id: 'rank',
      kind: `Rank (1 at the top, 1 to ${formatInteger(RANK_DEPTH)})`,
      title: 'Rank, last 8 weeks',
      label: `Rank, last 8 weeks: from ${rankText(RANKS[0])} to ${rankText(RANKS.at(-1))}, ${rankText(UNRANKED_WEEK_RANK)} in the week of ${UNRANKED_WEEK}`,
      cell: { values: RANKS, kind: 'rank', tone: 'reference', rankDepth: RANK_DEPTH },
      points: RANKS.map((rank, index) => ({
        dateText: SPARK_WEEKS[index] ?? '',
        valueText: rankText(rank),
      })),
    },
    {
      id: 'empty',
      kind: 'No data',
      title: 'Mention rate, last 8 weeks',
      label: 'Mention rate, last 8 weeks: no answers',
      cell: { values: [], kind: 'rate', tone: 'reference' },
      points: [],
    },
  ];
}

function SparklineSpecimen({ density }: { density: Density }): ReactElement {
  const words = useRateTipWords();
  const tip = useSparklineTip();
  const rows = useMemo(() => sparkRows(words), [words]);
  const headerClass = cn('h-row-compact px-4 text-left type-table-header');
  return (
    <TableScroll label="Sparkline kinds, scrollable">
      <table className="w-full border-collapse type-table">
        <caption className="sr-only">Sparkline kinds</caption>
        <thead>
          <tr className="bg-surface-subtle">
            <th scope="col" className={headerClass}>
              Kind
            </th>
            <th scope="col" className={headerClass}>
              Trend
            </th>
            <th scope="col" className={headerClass}>
              Last 7 points
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={cn('border-t border-border-subtle', rowHeight(density))}>
              <th scope="row" className="px-4 text-left font-normal whitespace-nowrap text-foreground-secondary">
                {row.kind}
              </th>
              <td className="px-4">
                <SparklineCell {...row.cell} label={row.label} density={density} />
              </td>
              <td className="px-4 py-1 text-foreground-secondary">
                {tip(row.title, row.points)?.detail ?? 'No points, so no tooltip'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

/* ---------- The section ---------- */

/** The chart parts of the AI visibility package (WP-04), each in both themes and both densities. */
export function ChartsSection(): ReactNode {
  const [density, setDensity] = useState<Density>(DEFAULT_DENSITY);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SegmentedControl<Density>
          semantics="view"
          size="sm"
          label="Density"
          value={density}
          onValueChange={setDensity}
          items={DENSITY_ITEMS}
        />
        <p className="type-meta">Density sets the height of the sparklines and of the rows below them.</p>
      </div>
      <SpecimenGroup
        title="ChartFrame, line with intervals"
        note="15 sections 2 and 4. A band for each engine, hollow points for two thin weeks, a gap, a version boundary and the previous period. Every tooltip row and Table cell carries its counts."
      >
        <MentionRateSpecimen />
      </SpecimenGroup>
      <SpecimenGroup
        title="ChartFrame, stacked bars"
        note="15 section 4. Counts stack only because their total means something: all valid answers of the week."
      >
        <ChartFrame
          title="Answers collected by week"
          variant="panel"
          meta="Last 8 weeks, valid answers only"
          footnote="Counts of valid answers. Failed and refused answers are not counted."
          kind="bar"
          stacked
          categories={RECENT_WEEKS}
          categoryHeader="Week"
          series={ANSWER_SERIES}
          formatValue={formatInteger}
          menu={{
            fileName: 'answers-collected',
            link: 'https://app.idraft.test/design-system/charts#answers',
            png: true,
            csv: true,
          }}
          height={240}
          summary="ChatGPT and Gemini return 80 valid answers every week. AI Mode is asked on 10 prompts and returns 3 to 10 a week, 3 in the week of Oct 19."
          status="ready"
        />
      </SpecimenGroup>
      <SpecimenGroup
        title="ChartFrame, HTML body"
        note="15 section 5.1. A ranked list drawn in HTML inside the same frame: a plain key, a Table view, Patterns and a menu with CSV."
      >
        <ChartFrame
          title="Citations by domain"
          variant="panel"
          meta="Last 4 weeks, 160 answers"
          footnote="Method: a domain counts once for each answer. Excludes branded prompts."
          kind="html"
          legend={DOMAIN_LEGEND}
          body={({ patterns }) => <DomainBars patterns={patterns} />}
          table={DOMAIN_TABLE}
          patterns
          menu={{
            fileName: 'citations-by-domain',
            link: 'https://app.idraft.test/design-system/charts#citations',
            csv: DOMAIN_CSV,
          }}
          height={180}
          summary="hubspot.com is cited in 71 of 160 answers, idraft.ai in 52, zapier.com in 38, reddit.com in 33 and g2.com in 27."
          status="ready"
        />
      </SpecimenGroup>
      <SpecimenGroup
        title="ChartFrame, states"
        note="17 sections 2, 5 and 7. Loading, refetching, empty, error, stale and partial keep the title and the reserved height."
      >
        <StatesSpecimen />
      </SpecimenGroup>
      <SpecimenGroup
        title="ChartLegend"
        note="15 section 2. A dot, a dashed line or the 8 px marker shape of the series; one item is turned off. Without a toggle it is a plain key."
      >
        <div className="flex flex-col gap-3">
          <SpecimenRow label="Dot and line swatches">
            <ToggleLegend title="swatches" items={SWATCH_LEGEND} off="other" />
          </SpecimenRow>
          <SpecimenRow label="Marker swatches">
            <ToggleLegend title="markers" items={MARKER_LEGEND} off="perplexity" />
          </SpecimenRow>
          <SpecimenRow label="Plain key">
            <ChartLegend
              title="plain key"
              items={MARKER_LEGEND.map((item) => ({ ...item, pressed: item.id !== 'perplexity' }))}
            />
          </SpecimenRow>
        </div>
      </SpecimenGroup>
      <SpecimenGroup
        title="Rate tooltip words"
        note="15 section 4. What a tooltip row says after the engine name: the percent only beside its answers, a thin week says its answers, an unknown week is never 0."
      >
        <TooltipWordsSpecimen />
      </SpecimenGroup>
      <SpecimenGroup
        title="SmallSampleMarker"
        note="15 section 4. Too few answers for a rate: the answers in words, or the hatched pill in a table cell."
      >
        <SmallSampleSpecimen density={density} />
      </SpecimenGroup>
      <SpecimenGroup
        title="SparklineCell"
        note="15 section 9. The scale follows the kind: the row's own range for counts, at least 20 points for rates, a fixed 1 to 20 with 1 at the top for ranks. The third column is the tooltip, written out."
      >
        <SparklineSpecimen density={density} />
      </SpecimenGroup>
    </div>
  );
}
