'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { useCardMeta } from './card-meta';
import { engineLabel } from './engine-role';
import type { CardData } from './use-card-data';
import { useCardExport } from './use-card-seams';
import { useFrameState } from './use-frame-state';
import {
  buildTrend,
  panelsOf,
  trendExport,
  trendSummary,
  TREND_METRICS,
  type SummaryItem,
  type TrendMetric,
  type TrendModel,
  type TrendWords,
} from './trend-model';
import { useOverviewSchedule } from '../../overview-context';
import type { ChartEmpty } from '@/components/app/chart/chart-frame';
import { SmallMultiples } from '@/components/app/chart/small-multiples';
import { useRateTipWords } from '@/components/app/chart/use-rate-tip-words';
import { Select } from '@/components/ui/select';
import type { EngineCode } from '@/lib/api/types';
import {
  formatBusinessDate,
  formatChartDate,
  formatPercent,
  formatPointsDelta,
  formatTableDateTime,
} from '@/lib/format';

/** The message key of a metric in `aiOverview.engines.trend` (`metricMention`, `titleMention`, ...). */
const KEY = { mention: 'Mention', citation: 'Citation', share_of_voice: 'ShareOfVoice' } as const satisfies Record<
  TrendMetric,
  string
>;

type Translate = ReturnType<typeof useTranslations<'aiOverview.engines.trend'>>;

/** What a card of the trend family says when it cannot draw: set by the card that knows why (an engine that is off). */
export interface TrendGate {
  title: string;
  reason: string;
  action?: ReactNode | undefined;
}

export interface TrendFrameProps {
  /** The layout item id of the card: the export block is registered under it. */
  itemId: string;
  data: CardData;
  /** The engines drawn, in the order to draw them. */
  engines: readonly EngineCode[];
  /** The metric the card is saved with; the Series menu starts from it. */
  metric: TrendMetric;
  /** The viewer may switch the metric of every panel (it is kept in this component and is not saved). */
  switchable: boolean;
  height: 140 | 180;
  /** Set when the card cannot draw the engine it was asked for: shown as its empty state. */
  gate?: TrendGate | null | undefined;
  fileName: string;
}

function summaryOf(
  items: readonly SummaryItem[],
  metric: TrendMetric,
  label: (code: EngineCode) => string,
  t: Translate,
): string {
  const sentences = items.map((item) => {
    const engine = label(item.engineCode);
    if (item.state === 'none') return t('summaryNone', { engine });
    if (item.state === 'insufficient') return t('summaryThin', { engine, count: item.n });
    const change =
      item.change === null
        ? ''
        : t('summaryChange', {
            points: formatPointsDelta(item.change.delta),
            test:
              item.change.detectable === true ? 'detectable' : item.change.detectable === false ? 'within' : 'other',
          });
    const value = formatPercent(item.value);
    return item.k === null
      ? t('summaryShare', { engine, value, n: item.n, change })
      : t('summaryRate', { engine, value, k: item.k, n: item.n, change });
  });
  const intro = t('summaryIntro', {
    metric: t(`metric${KEY[metric]}`),
    engines: items.map((item) => label(item.engineCode)).join(', '),
  });
  return [intro, ...sentences].join(' ');
}

function footnoteOf(model: TrendModel, comparing: boolean, t: Translate): string {
  const own =
    model.source === 'total' &&
    model.series.every((series) => series.points.every((point) => point.pooledWeeks === null));
  const rate =
    model.metric === 'share_of_voice'
      ? [t('footnoteShare'), t('footnoteNoBand')]
      : [own ? t('footnoteOwnWeek') : t('footnotePooled'), t('footnoteBand')];
  return [
    ...rate,
    t('footnoteThin'),
    comparing ? t('footnotePrevious') : null,
    model.metric === 'share_of_voice' && model.entitiesChanged ? t('footnoteEntities') : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' ');
}

/**
 * The frame of the two trend cards (CH-01, WB-OV-05): one `SmallMultiples` with a panel for each engine drawn, the
 * Series menu when the viewer may switch it, the weekly Table view and the same table as an export block. The
 * model, the words and the frame states are the shared helpers of the family; this holds only the viewer's choice.
 */
export function TrendFrame({
  itemId,
  data,
  engines,
  metric: saved,
  switchable,
  height,
  gate = null,
  fileName,
}: TrendFrameProps): ReactElement {
  const t = useTranslations('aiOverview.engines.trend');
  const common = useTranslations('aiOverview.engines.common');
  const tipWords = useRateTipWords();
  const meta = useCardMeta();
  const schedule = useOverviewSchedule();
  const [choice, setChoice] = useState<TrendMetric | null>(null);
  const metric = switchable ? (choice ?? saved) : saved;
  const { scope, project } = data;

  const label = useMemo(
    () =>
      (code: EngineCode): string =>
        engineLabel(code) ?? common('unknownEngine'),
    [common],
  );
  const words = useMemo<TrendWords>(
    () => ({
      rate: tipWords,
      share: (value, n) => t('shareTip', { value: formatPercent(value), count: n }),
      partial: t('partialWeek'),
    }),
    [tipWords, t],
  );

  const currentData = data.current.data;
  const previousData = data.previous?.data ?? null;
  const model = useMemo(
    () =>
      currentData === undefined || engines.length === 0
        ? null
        : buildTrend({ current: currentData, previous: previousData, asked: engines, metric, range: scope.range }),
    [currentData, previousData, engines, metric, scope.range],
  );
  const panels = useMemo(() => (model === null ? [] : panelsOf(model, label, words)), [model, label, words]);
  const categories = useMemo(
    () =>
      (model?.weeks ?? []).map((week, index, weeks) =>
        formatChartDate(week, index === 0 || week.slice(0, 4) !== weeks[index - 1]?.slice(0, 4)),
      ),
    [model],
  );
  const titles = useMemo(
    () => (model?.weeks ?? []).map((week) => t('weekOf', { date: formatBusinessDate(week) })),
    [model, t],
  );

  const title = switchable ? t(`title${KEY[metric]}`) : t('titleSingle');
  const shortOfWeeks = model !== null && model.weeksWithAnswers < 2;
  const phase =
    gate !== null && data.phase !== 'loading' && data.phase !== 'error'
      ? 'empty'
      : data.phase === 'ready' && shortOfWeeks
        ? 'empty'
        : data.phase;

  const nextRun = schedule.data?.nextRunAt ?? null;
  const empty = ((): ChartEmpty => {
    if (gate !== null) return { title: gate.title, reason: gate.reason, action: gate.action };
    if (engines.length === 0) return { title: t('emptyNoEngineTitle'), reason: t('emptyNoEngineReason') };
    return {
      title: t('emptyWeeksTitle'),
      reason:
        nextRun === null
          ? t('emptyWeeksReason')
          : t('emptyWeeksReasonNext', { time: formatTableDateTime(nextRun, project.timeZone) }),
    };
  })();
  const frame = useFrameState({ ...data, phase }, { name: title, empty });

  const aggregates = data.aggregates;
  const items = useMemo(
    () => (aggregates === null ? [] : trendSummary(aggregates, engines, metric)),
    [aggregates, engines, metric],
  );
  const answers = items.length === 0 ? null : items.reduce((total, item) => total + item.n, 0);
  const comparing = model?.series.some((series) => series.previous !== null) ?? false;

  useCardExport(itemId, () => {
    if (model === null || phase === 'loading' || phase === 'error') return null;
    const block = trendExport(model, label);
    return { id: itemId, header: block.header, rows: block.rows };
  });

  const controls = switchable ? (
    <div className="w-44 min-w-0">
      <Select<TrendMetric>
        aria-label={t('series')}
        size="sm"
        value={metric}
        onValueChange={setChoice}
        placeholder={t('series')}
        options={TREND_METRICS.map((entry) => ({ value: entry, label: t(`metric${KEY[entry]}`) }))}
      />
    </div>
  ) : undefined;

  return (
    <SmallMultiples
      {...frame}
      title={title}
      variant="panel"
      meta={meta({
        range: scope.range,
        prompts: aggregates?.promptCount ?? null,
        answers,
        branded: scope.branded,
        promptWeighted: metric !== 'share_of_voice',
      })}
      footnote={model === null ? undefined : footnoteOf(model, comparing, t)}
      controls={controls}
      categories={categories}
      categoryHeader={t('week')}
      titles={titles}
      panels={panels}
      height={height}
      summary={summaryOf(items, metric, label, t)}
      menu={{ fileName }}
    />
  );
}
