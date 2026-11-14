'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, type ReactElement, type ReactNode } from 'react';

import { drillHref, topicHref } from './drill';
import { heatFileName, heatInput, heatOrder, HEAT_ORDERS, showsAverage, type HeatOrder } from './heat-model';
import type { EngineValue } from './engine-values';
import type { TopicHead } from './topic-rows';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { heatmapCsv, type HeatCsvRow } from '@/components/app/chart/heat-bins';
import { HeatmapGrid, type HeatCell, type HeatColumn, type HeatRow } from '@/components/app/chart/heatmap-grid';
import { useRateTipWords } from '@/components/app/chart/use-rate-tip-words';
import type { TableStatus } from '@/components/app/data-table/types';
import { Select } from '@/components/ui/select';
import { CELL_OF_METRIC, type RateMetric } from '@/features/prompts/prompt-model';
import type { ProjectEngine } from '@/lib/api/types';
import { rateTipText, type RateTipWords } from '@/lib/charts/rate-tip';
import { EMPTY_VALUE, formatInteger, formatList, formatPercent } from '@/lib/format';
import type { AverageRate } from '@/lib/rates/rate-model';
import { MIN_OBSERVATIONS, wilsonInterval } from '@/lib/stats';
import type { Density } from '@/lib/tables/table-state';

export interface TopicHeatmapProps {
  /** The topics of the page as the filters leave them; the heat map orders them itself. */
  heads: readonly TopicHead[];
  /** The engines shown, in order. */
  engines: readonly ProjectEngine[];
  metric: RateMetric;
  order: HeatOrder;
  onOrderChange: (order: HeatOrder) => void;
  density: Density;
  /** `empty`, `filtered-empty` and `error` are drawn from the nodes below, as the table draws them. */
  status: TableStatus;
  /** A search is set: it does not narrow the heat map, and the heat map says so. */
  searchIgnored: boolean;
  /** The metric control, at the start of the row above the frame. */
  toolbarStart: ReactNode;
  /** The view switches, at its end. */
  toolbarEnd: ReactNode;
  errorState: ReactNode;
  emptyState: ReactNode;
  filteredEmptyState: ReactNode;
  /** The topics in the order drawn, a parent and then the topics below it: what the topic drawer steps through. */
  onTopicOrderChange?: ((keys: readonly string[]) => void) | undefined;
}

const ORDER_KEY = {
  prompts: 'orderPrompts',
  avg_rate: 'orderRate',
  engine_gap: 'orderGap',
} as const satisfies Record<HeatOrder, string>;

/** The height the frame reserves for the grid while it loads, one of the heights the chart frame offers. */
const FRAME_HEIGHT = 240;

interface Words {
  rateTip: RateTipWords;
  answers: (count: number) => string;
  basis: (successes: number, answers: number) => string;
  /** A percent with its answers and, for a topic, its prompts, in words. */
  share: (value: string, answers: string, prompts: string | null) => string;
}

/**
 * What a cell's tooltip says after the subject: the percent with the answers behind it, the interval of the pooled
 * answers and the prompts the topic cell weights; too few answers say their count and not a percent, none say so.
 * Share of voice has no count of answers that name the brand, so it says the answers that name a brand.
 */
function cellBody(value: EngineValue, counted: boolean, words: Words): string {
  if (value.state === 'none') return words.rateTip.noAnswers;
  if (value.state === 'insufficient') return words.rateTip.thin(value.answers);
  if (counted && value.successes !== null) {
    return rateTipText(
      {
        value: value.value,
        k: value.successes,
        n: value.answers,
        prompts: value.prompts ?? undefined,
        band: wilsonInterval(value.successes, value.answers),
        thin: false,
      },
      words.rateTip,
    );
  }
  return words.share(
    value.value === null ? EMPTY_VALUE : words.rateTip.value(value.value),
    words.answers(value.answers),
    value.prompts === null ? null : words.rateTip.prompts(value.prompts),
  );
}

/** The rows as the CSV takes them: plain names, and each cell's tip with its counts. */
const csvRows = (rows: readonly HeatRow[]): HeatCsvRow[] =>
  rows.map((row) => ({
    label: row.name,
    prompts: row.prompts,
    cells: row.cells.map(({ state, tip }) => ({ state, tip })),
    children: row.children === undefined ? undefined : csvRows(row.children),
  }));

/**
 * The Heat map view of the Topics tab (CH-04, WB-TPE-07): a row per topic, a column per engine shown for the chosen
 * metric and, from 2 engines, the equal weight average. A cell is the topic's value on the engine over the window with
 * its counts in its words, hatched under 4 answers and "n/a" with none; it is a link to the topic's prompts on that
 * engine, and the row's name a link to its Overview. The engines are never pooled but in the average, which says how
 * many took part. The topic rows overlap (a prompt in two topics counts in both), which the footnote says.
 */
export function TopicHeatmap({
  heads,
  engines,
  metric,
  order,
  onOrderChange,
  density,
  status,
  searchIgnored,
  toolbarStart,
  toolbarEnd,
  errorState,
  emptyState,
  filteredEmptyState,
  onTopicOrderChange,
}: TopicHeatmapProps): ReactElement {
  const t = useTranslations('prompts.topicDrawer.heat');
  const prompts = useTranslations('prompts');
  const locale = useLocale();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const rateTip = useRateTipWords();
  const key = CELL_OF_METRIC[metric];
  const metricLabel = prompts(`metric.${metric}`);

  const ordered = useMemo(
    () =>
      heatOrder(
        heads,
        order,
        key,
        engines.map(({ engine }) => engine.engine_code),
      ),
    [heads, order, key, engines],
  );
  const topicKeys = useMemo(
    () => ordered.flatMap((head) => [head.key, ...head.children.map((child) => child.key)]),
    [ordered],
  );
  useEffect(() => onTopicOrderChange?.(topicKeys), [topicKeys, onTopicOrderChange]);

  const columns = useMemo((): HeatColumn[] => {
    const engineColumns = engines.map(({ engine }) => ({ id: engine.engine_code, label: engine.label }));
    return showsAverage(engines.length)
      ? [...engineColumns, { id: 'average', label: t('average', { count: engines.length }) }]
      : engineColumns;
  }, [engines, t]);

  const rows = useMemo((): HeatRow[] => {
    const codes = engines.map(({ engine }) => engine.engine_code);
    const labelOf = (code: string): string =>
      engines.find(({ engine }) => engine.engine_code === code)?.engine.label ?? code;
    const words: Words = {
      rateTip,
      answers: (count) => prompts('rate.basisAnswers', { answers: count }),
      basis: (successes, answers) => prompts('rate.basis', { successes, answers }),
      share: (value, answers, weighted) =>
        weighted === null
          ? t('cellShare', { value, answers })
          : t('cellShareWithPrompts', { value, answers, prompts: weighted }),
    };
    const percent = (value: number | null): string =>
      value === null ? EMPTY_VALUE : formatPercent(value, { decimals: 0 });
    const engineCell = (head: TopicHead, value: EngineValue): HeatCell => {
      const body = cellBody(value, metric !== 'sov', words);
      return {
        value: value.state === 'ok' ? value.value : null,
        answers: value.answers,
        state: value.state,
        text: value.state === 'ok' ? percent(value.value) : '',
        tip: t('cellLink', { topic: head.name, engine: labelOf(value.code), value: body }),
        // A cell with no answer has no prompts to open
        href: value.state === 'none' ? undefined : drillHref(pathname, search, head.key, value.code),
      };
    };
    const averageCell = (head: TopicHead, average: AverageRate, values: readonly EngineValue[]): HeatCell => {
      const base = { value: average.value, answers: average.answers, state: average.state };
      // Without a rate there is no average to count the engines of: the name does not carry "avg of 0"
      if (average.state === 'none') {
        return { ...base, text: '', tip: t('averageLinkNone', { topic: head.name, value: rateTip.noAnswers }) };
      }
      if (average.state === 'insufficient') {
        return {
          ...base,
          text: '',
          tip: t('averageLinkNone', { topic: head.name, value: rateTip.thin(average.answers) }),
        };
      }
      // The count of each engine that counts: a pooled count beside an equal weight percent would read as another rate
      const counting = values.filter((value) => value.state === 'ok');
      const counts = formatList(
        counting.map((value) =>
          prompts('columns.engineCount', {
            engine: labelOf(value.code),
            count:
              metric === 'sov' || value.successes === null
                ? words.answers(value.answers)
                : words.basis(value.successes, value.answers),
          }),
        ),
        locale,
      );
      const engineNames = formatList(
        counting.map((value) => labelOf(value.code)),
        locale,
      );
      // One engine is not an average of engines: it is said as the engine alone, as the table's columns say it
      const note =
        counting.length === 1
          ? prompts('rate.onlyTip', { engines: engineNames })
          : t('averageTip', { engines: engineNames });
      return {
        ...base,
        text: percent(average.value),
        tip: t('averageLink', {
          topic: head.name,
          average: prompts('rate.avgLabel', { count: average.engines }),
          value: t('averageValue', { percent: percent(average.value), counts, note }),
        }),
      };
    };
    const rowOf = (head: TopicHead): HeatRow => {
      const input = heatInput(head, key, codes);
      return {
        id: head.key,
        label: head.name,
        name: head.name,
        prompts: formatInteger(head.promptCount),
        href: topicHref(pathname, search, head.key),
        cells: [
          ...input.values.map((value) => engineCell(head, value)),
          ...(showsAverage(engines.length) ? [averageCell(head, input.average, input.values)] : []),
        ],
        children: head.children.length === 0 ? undefined : head.children.map(rowOf),
      };
    };
    return ordered.map(rowOf);
  }, [ordered, engines, key, metric, pathname, search, rateTip, prompts, t, locale]);

  const csv = useMemo(
    () =>
      heatmapCsv({
        rowHeader: t('rowHeader'),
        promptsHeader: t('promptsHeader'),
        noneText: EMPTY_VALUE,
        columns: columns.map((column) => String(column.label)),
        rows: csvRows(rows),
      }),
    [columns, rows, t],
  );

  const topicCount = topicKeys.length;
  const title = t('title', { metric: metricLabel });
  const grid = (form: 'grid' | 'table'): ReactElement => (
    <HeatmapGrid
      caption={title}
      rowHeader={t('rowHeader')}
      promptsHeader={t('promptsHeader')}
      columns={columns}
      rows={rows}
      scale="sequential"
      density={density}
      form={form}
    />
  );
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {toolbarStart}
      <div className="w-32 min-w-0 sm:w-44">
        <Select<HeatOrder>
          aria-label={t('orderLabel')}
          size="sm"
          value={order}
          onValueChange={onOrderChange}
          placeholder={t('orderLabel')}
          options={HEAT_ORDERS.map((value) => ({ value, label: t(ORDER_KEY[value]) }))}
        />
      </div>
      <div className="ml-auto flex min-w-0 flex-wrap items-center gap-1">{toolbarEnd}</div>
    </div>
  );
  const note = searchIgnored ? <p className="type-meta">{t('searchIgnored')}</p> : null;

  // The states the screen words itself (its retry, its way to add prompts) are drawn as the table draws them
  const stateNodes: Partial<Record<TableStatus, ReactNode>> = {
    error: errorState,
    empty: emptyState,
    'filtered-empty': filteredEmptyState,
  };
  const stateBody = stateNodes[status] ?? null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {toolbar}
      {note}
      {stateBody ?? (
        <ChartFrame
          kind="html"
          title={title}
          variant="panel"
          meta={t('meta', { topics: topicCount, engines: engines.length })}
          footnote={t('footnote', { min: MIN_OBSERVATIONS })}
          height={FRAME_HEIGHT}
          summary={t('summary', { metric: metricLabel, topics: topicCount, engines: engines.length })}
          body={grid('grid')}
          table={grid('table')}
          menu={{ fileName: heatFileName(metric), csv }}
          status={status === 'loading' || status === 'refetching' ? status : 'ready'}
        />
      )}
    </div>
  );
}
