'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { engineOption, useChangeFrame, type OwnEmpty } from './change-frame';
import { useCardMeta } from './card-meta';
import { engineLabel } from './engine-role';
import { buildMovers, type Mover, type MoverDirection } from './movers-model';
import { pairPrompts } from './prompt-pairs';
import { useCardData } from './use-card-data';
import { useCardDensity } from './use-card-density';
import { useCardDrill, useCardExport } from './use-card-seams';
import type { ExportBlock } from '../../export/export-model';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import {
  IntervalBar,
  changeDomain,
  type DivergingRow,
  type PointsDeltaInput,
} from '@/components/app/chart/interval-bar';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import type { CardProps } from '@/features/layouts';
import { safeText, type CsvCell } from '@/lib/csv/csv-write';
import { formatMetricDelta, formatPercent, formatPointsDelta } from '@/lib/format';

type Translate = ReturnType<typeof useTranslations<'aiOverview.engines.movers'>>;

/** The name of the downloaded file, without its extension. */
const FILE_NAME = 'prompt-movers';

const EXPORT_HEADER = [
  'prompt_id',
  'prompt',
  'engine',
  'before_percent',
  'before_k',
  'before_n',
  'now_percent',
  'now_k',
  'now_n',
  'change_points',
  'interval_low_points',
  'interval_high_points',
  'detectable',
] as const;

const directionOf = (value: string | undefined): MoverDirection =>
  value === 'up' || value === 'down' ? value : 'both';

/** The Rows option of the catalog: 5 or 8, 5 by default. */
const rowsOf = (value: string | undefined): number => (value === '8' ? 8 : 5);

/** A rate on the 0 to 1 scale as a percent number to two places, for a file: float noise does not reach it. */
const percentNumber = (rate: number): number => Math.round(rate * 10000) / 100;

const changeOf = (mover: Mover): PointsDeltaInput => ({
  value: mover.points,
  unit: 'points',
  polarity: 'higher_is_better',
  isDetectable: mover.detectable,
});

const rateText = (side: Mover['now'], t: Translate): string =>
  t('rateText', { value: formatPercent(side.rate), k: side.k, n: side.n });

const intervalTextOf = (mover: Mover, t: Translate): string =>
  t('intervalText', { low: formatPointsDelta(mover.interval.low), high: formatPointsDelta(mover.interval.high) });

/** The words of one row of the Table view and the CSV. */
const cellsOf = (mover: Mover, t: Translate): string[] => [
  mover.text,
  rateText(mover.before, t),
  rateText(mover.now, t),
  formatMetricDelta(changeOf(mover)).text,
  intervalTextOf(mover, t),
];

/**
 * Prompt movers (CH-09): the prompts whose mention rate on one engine changed most against the window before, each as a
 * bar from 0 to its change with the 95 percent interval of the change as a whisker. The windows are unpaired, so a bar
 * is coloured only when the change is larger than normal variation; a prompt with fewer than 4 valid answers in either
 * window is left out and counted in the footnote, and a prompt asked in one window only is not a mover.
 */
export default function PromptMoversCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.engines.movers');
  const common = useTranslations('aiOverview.engines.common');
  const metaOf = useCardMeta();
  const density = useCardDensity();
  const drill = useCardDrill();
  const data = useCardData({ previous: 'required', subscribed: live });
  const { scope, asked, aggregates } = data;
  const engine = engineOption(options.engine);
  const direction = directionOf(options.direction);
  const rows = rowsOf(options.rows);
  const engineName = engineLabel(engine) ?? common('unknownEngine');

  const currentRows = data.current.data?.prompts;
  const previousRows = data.previous?.data?.prompts;
  // No manual memo: the React Compiler keeps the model between renders, and cannot preserve one made from `[engine]`
  const model = buildMovers({
    pairs:
      currentRows === undefined || previousRows === undefined ? null : pairPrompts(currentRows, previousRows, [engine]),
    engine,
    direction,
    rows,
  });
  const movers = model.state === 'ok' ? model.movers : [];
  const leftOut =
    model.state === 'ok' || model.state === 'noneMoved' || model.state === 'nonePaired' ? model.leftOut : 0;

  const own: OwnEmpty = !asked.includes(engine)
    ? { title: t('emptyEngineTitle', { engine: engineName }), reason: t('emptyEngineReason') }
    : model.state === 'ok'
      ? null
      : model.state === 'noPrevious'
        ? 'noPrevious'
        : model.state === 'nonePaired'
          ? { title: t('emptyNonePairedTitle'), reason: t('emptyNonePairedReason', { count: model.leftOut }) }
          : { title: t('emptyNoneMovedTitle'), reason: t('emptyNoneMovedReason') };
  const title = t('title');
  const frame = useChangeFrame(data, title, (key, values) => t(key, values), own);

  const diverging = movers.map((mover): DivergingRow => {
    const change = changeOf(mover);
    const changeText = formatMetricDelta(change).text;
    const intervalText = intervalTextOf(mover, t);
    const href = drill('prompt', { promptId: mover.promptId, engine });
    return {
      id: mover.promptId,
      label: mover.text,
      accessibleText: t('rowText', {
        prompt: mover.text,
        change: changeText,
        interval: intervalText,
        test: mover.detectable === true ? 'detectable' : mover.detectable === false ? 'within' : 'other',
        before: rateText(mover.before, t),
        now: rateText(mover.now, t),
      }),
      tip: t('tip', {
        before: formatPercent(mover.before.rate),
        now: formatPercent(mover.now.rate),
        change: changeText,
        kBefore: mover.before.k,
        nBefore: mover.before.n,
        kNow: mover.now.k,
        nNow: mover.now.n,
      }),
      ...(href === null ? {} : { href }),
      value: {
        kind: 'compare',
        interval: { estimate: mover.points, low: mover.interval.low, high: mover.interval.high },
        change,
        test: 'interim',
        changeText,
        intervalText,
      },
    };
  });
  const domain = changeDomain(
    movers.map((mover) => ({ estimate: mover.points, low: mover.interval.low, high: mover.interval.high })),
  );

  const header = [t('labelHeader'), t('before'), t('now'), t('change'), t('interval')];
  const columns: readonly PlainColumn<Mover>[] = header.map((text, index) => ({
    id: `col-${String(index)}`,
    header: text,
    wrap: true,
    cell: (mover) => cellsOf(mover, t)[index],
  }));

  useCardExport(item.id, (): ExportBlock | null => {
    if (data.phase === 'loading' || data.phase === 'error') return null;
    return {
      id: item.id,
      header: EXPORT_HEADER,
      rows: movers.map((mover): CsvCell[] => [
        mover.promptId,
        mover.text,
        engine,
        percentNumber(mover.before.rate),
        mover.before.k,
        mover.before.n,
        percentNumber(mover.now.rate),
        mover.now.k,
        mover.now.n,
        percentNumber(mover.points),
        percentNumber(mover.interval.low),
        percentNumber(mover.interval.high),
        mover.detectable === null ? null : mover.detectable ? 'true' : 'false',
      ]),
    };
  });

  const [top] = movers;
  const summary =
    top === undefined
      ? t('summaryEmpty', { engine: engineName })
      : t('summaryOk', {
          engine: engineName,
          count: movers.length,
          prompt: top.text,
          change: formatMetricDelta(changeOf(top)).text,
        });

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
      })}
      footnote={[t('footnote'), leftOut > 0 ? t('leftOut', { count: leftOut }) : null]
        .filter((part): part is string => part !== null)
        .join(' ')}
      height={240}
      summary={summary}
      body={
        <IntervalBar
          form="diverging"
          caption={title}
          labelHeader={t('labelHeader')}
          rows={diverging}
          domain={domain}
          density={density}
        />
      }
      table={
        <PlainTable<Mover>
          caption={title}
          columns={columns}
          rows={movers}
          rowKey={(mover) => mover.promptId}
          status="ready"
          errorState={null}
          emptyText={t('summaryEmpty', { engine: engineName })}
        />
      }
      menu={{
        fileName: FILE_NAME,
        csv: { header: header.map(safeText), rows: movers.map((mover) => cellsOf(mover, t).map(safeText)) },
      }}
      {...frame}
    />
  );
}
