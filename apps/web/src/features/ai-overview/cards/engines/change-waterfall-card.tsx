'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { engineOption, useChangeFrame, type OwnEmpty } from './change-frame';
import { useCardMeta } from './card-meta';
import { engineLabel } from './engine-role';
import { pairPrompts } from './prompt-pairs';
import { useCardData } from './use-card-data';
import { useCardDensity } from './use-card-density';
import { useCardExport } from './use-card-seams';
import { WaterfallBody, type BarTone, type WaterfallRow } from './waterfall-body';
import {
  buildWaterfall,
  waterfallDomain,
  type BarId,
  type WaterfallBar,
  type WaterfallMetric,
  type WaterfallModel,
} from './waterfall-model';
import type { ExportBlock } from '../../export/export-model';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import type { CardProps } from '@/features/layouts';
import { safeText, type CsvCell } from '@/lib/csv/csv-write';
import { EMPTY_VALUE, formatMetricDelta, formatPercent, formatPointsDelta } from '@/lib/format';

type Translate = ReturnType<typeof useTranslations<'aiOverview.engines.waterfall'>>;

/** The name of the downloaded file, without its extension. */
const FILE_NAME = 'what-moved-the-rate';

const EXPORT_HEADER = [
  'engine',
  'metric',
  'step',
  'rate_percent',
  'change_points',
  'prompts',
  'largest_prompt',
  'largest_change_points',
] as const;

const BAR_WORDS = {
  start: 'barStart',
  rose: 'barRose',
  fell: 'barFell',
  tooFew: 'barTooFew',
  setChanged: 'barSetChanged',
  end: 'barEnd',
} as const satisfies Record<BarId, string>;

/** The Metric option of the catalog: mention or citation, mention by default; the model reads the cell it names. */
const metricOf = (value: string | undefined): { option: 'mention' | 'citation'; cell: WaterfallMetric } =>
  value === 'citation' ? { option: 'citation', cell: 'cited' } : { option: 'mention', cell: 'mentioned' };

/** A rate on the 0 to 1 scale as a percent number to two places, for a file: float noise does not reach it. */
const percentNumber = (rate: number): number => Math.round(rate * 10000) / 100;

const isEnd = (bar: WaterfallBar): boolean => bar.id === 'start' || bar.id === 'end';

const valueText = (bar: WaterfallBar): string => (isEnd(bar) ? formatPercent(bar.value) : formatPointsDelta(bar.value));

function detailText(bar: WaterfallBar, model: Extract<WaterfallModel, { state: 'ok' }>, t: Translate): string {
  if (bar.answers !== null) return t('detailEnds', { k: bar.answers.k, n: bar.answers.n, count: bar.prompts });
  if (bar.id === 'rose') return t('detailRose', { count: bar.prompts });
  if (bar.id === 'fell') return t('detailFell', { count: bar.prompts });
  if (bar.id === 'tooFew') return t('detailTooFew', { count: bar.prompts });
  return t('detailSetChanged', { added: model.added, left: model.left });
}

const largestText = (bar: WaterfallBar, t: Translate): string | null =>
  bar.top === null ? null : t('largest', { prompt: bar.top.text, change: formatPointsDelta(bar.top.points) });

/**
 * What moved the rate (CH-13): the change in one engine's mention or citation rate between the window before and this
 * one, split into the prompts that rose, those that fell, those with too few answers to say, and the change of the
 * prompt set, as bars that add up exactly (`waterfall-model.ts`). The ends are the strip's own rates; the contribution
 * bars take a colour only when the total change is larger than normal variation.
 */
export default function ChangeWaterfallCard({ item, options }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.engines.waterfall');
  const common = useTranslations('aiOverview.engines.common');
  const metaOf = useCardMeta();
  const density = useCardDensity();
  const data = useCardData({ previous: 'required' });
  const { scope, asked, aggregates } = data;
  const engine = engineOption(options.engine);
  const metric = metricOf(options.metric);
  const engineName = engineLabel(engine) ?? common('unknownEngine');

  const figures = aggregates?.engines.find((entry) => entry.engineCode === engine);
  const figure = metric.cell;
  const detectable = figures?.change[figure].detectable ?? null;
  const currentRows = data.current.data?.prompts;
  const previousRows = data.previous?.data?.prompts;
  const start = figures?.previous?.[figure].value ?? null;
  const end = figures?.[figure].value ?? null;
  // No manual memo: the React Compiler keeps the model between renders, and cannot preserve one made from `[engine]`
  const model = buildWaterfall({
    pairs:
      currentRows === undefined || previousRows === undefined ? null : pairPrompts(currentRows, previousRows, [engine]),
    engine,
    metric: figure,
    start,
    end,
  });

  const own: OwnEmpty = !asked.includes(engine)
    ? { title: t('emptyEngineTitle', { engine: engineName }), reason: t('emptyEngineReason') }
    : model.state === 'ok'
      ? null
      : { title: t('emptyUnknownTitle'), reason: t('emptyUnknownReason') };
  const title = t('title');
  const frame = useChangeFrame(data, title, (key, values) => t(key, values), own);

  const bars = model.state === 'ok' ? model.bars : [];
  const toneOf = (bar: WaterfallBar): BarTone =>
    isEnd(bar)
      ? 'reference'
      : formatMetricDelta({ value: bar.value, unit: 'points', polarity: 'higher_is_better', isDetectable: detectable })
          .tone;
  const rows =
    model.state === 'ok'
      ? bars.map((bar): WaterfallRow => {
          const label = t(BAR_WORDS[bar.id]);
          const detail = detailText(bar, model, t);
          const largest = largestText(bar, t);
          return {
            id: bar.id,
            label,
            valueText: valueText(bar),
            detailText: detail,
            accessibleText: t('rowText', { label, value: valueText(bar), detail }),
            ...(largest === null ? {} : { tip: largest }),
            from: bar.from,
            to: bar.to,
            tone: toneOf(bar),
          };
        })
      : [];

  const header = [t('stepHeader'), t('valueHeader'), t('promptsHeader'), t('largestHeader')];
  const cellsOf = (row: WaterfallRow, bar: WaterfallBar): string[] => [
    row.label,
    row.valueText,
    row.detailText,
    largestText(bar, t) ?? EMPTY_VALUE,
  ];
  const tableRows = rows.flatMap((row, index) => {
    const bar = bars[index];
    return bar === undefined ? [] : [{ row, cells: cellsOf(row, bar) }];
  });
  const columns: readonly PlainColumn<(typeof tableRows)[number]>[] = header.map((text, index) => ({
    id: `col-${String(index)}`,
    header: text,
    wrap: true,
    cell: (entry) => entry.cells[index],
  }));

  useCardExport(item.id, (): ExportBlock | null => {
    if (model.state !== 'ok' || data.phase === 'loading' || data.phase === 'error') return null;
    return {
      id: item.id,
      header: EXPORT_HEADER,
      rows: bars.map((bar): CsvCell[] => [
        engine,
        metric.option,
        bar.id,
        isEnd(bar) ? percentNumber(bar.value) : null,
        isEnd(bar) ? null : percentNumber(bar.value),
        bar.prompts,
        bar.top?.text ?? null,
        bar.top === null ? null : percentNumber(bar.top.points),
      ]),
    };
  });

  const barOf = (id: BarId): WaterfallBar | undefined => bars.find((bar) => bar.id === id);
  const points = (id: BarId): string => formatPointsDelta(barOf(id)?.value ?? null);
  const summary =
    model.state === 'ok'
      ? t('summary', {
          engine: engineName,
          metric: t(metric.option === 'citation' ? 'metricCitation' : 'metricMention'),
          start: formatPercent(barOf('start')?.value ?? null),
          end: formatPercent(barOf('end')?.value ?? null),
          rose: points('rose'),
          fell: points('fell'),
          tooFew: points('tooFew'),
          setChanged: points('setChanged'),
        })
      : t('summaryEmpty', { engine: engineName });

  return (
    <ChartFrame
      kind="html"
      variant="panel"
      title={title}
      meta={metaOf({
        range: scope.range,
        prompts: aggregates?.promptCount ?? null,
        answers: null,
        branded: scope.branded,
        promptWeighted: true,
      })}
      footnote={t('footnote', {
        metric: t(metric.option === 'citation' ? 'metricCitation' : 'metricMention'),
        engine: engineName,
      })}
      height={240}
      summary={summary}
      body={<WaterfallBody caption={title} rows={rows} domain={waterfallDomain(bars)} density={density} />}
      table={
        <PlainTable<(typeof tableRows)[number]>
          caption={title}
          columns={columns}
          rows={tableRows}
          rowKey={(entry) => entry.row.id}
          status="ready"
          errorState={null}
          emptyText={t('summaryEmpty', { engine: engineName })}
        />
      }
      menu={{
        fileName: FILE_NAME,
        csv: { header: header.map(safeText), rows: tableRows.map((entry) => entry.cells.map(safeText)) },
      }}
      {...frame}
    />
  );
}
