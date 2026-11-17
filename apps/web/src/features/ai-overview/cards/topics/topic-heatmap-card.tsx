'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { TopicCardFrame, useTopicEmpty } from './card-frame';
import { groupCoverage } from './group-rows';
import { GroupPromptsCard } from './group-prompts-card';
import { heatFileName, heatRows, type HeatWords, type UnavailablePlatform } from './heatmap-model';
import type { TopicData } from './model-types';
import { TopicFootnote } from './topic-footnote';
import { useAllGroupsSummary } from './use-topic-reads';
import { useGroupOpen } from './use-group-open';
import { AI_OVERVIEW_PLATFORM } from './use-group-versus';
import { useTopicWords } from './use-topic-words';
import { useOverview } from '../../overview-context';
import { SCOPE_METRICS, singlePlatform, type ScopeMetric } from '../../scope/scope-model';
import { SEQUENTIAL_BINS } from '@/components/app/chart/heat-bins';
import { HeatmapGrid, type HeatColumn } from '@/components/app/chart/heatmap-grid';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { SegmentedControl, type SegmentedControlItem } from '@/components/ui/segmented-control';
import type { CardProps } from '@/features/layouts';
import { EMPTY_VALUE, formatInteger, formatList, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The card of the `ai.topic_heatmap` key: the groups heat map for All groups, and the prompts of the group when the
 * page has one chosen (OV-KEEP-10). The two are one slot of the layout, so they are one card here.
 */
export default function TopicHeatmapCard(props: CardProps): ReactElement {
  const { scope } = useOverview();
  return scope.topic === null ? <GroupsHeatmap {...props} /> : <GroupPromptsCard {...props} />;
}

/**
 * The groups heat map (CH-04, CH-40, OV-GRP-01 to OV-GRP-08): a row per group, one flat level, a column per platform
 * and, from two platforms, their equal weight average. A cell is the group's value on that platform over the window
 * with its counts in its words, hatched under 4 answers and n/a with none; a click opens the group (and the platform of
 * the cell) in this page. Platforms are never pooled but in the average, which says how many took part.
 */
function GroupsHeatmap({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.topics.groups');
  const heat = useTranslations('aiOverview.topics.heatmap');
  const common = useTranslations('aiOverview.topics.common');
  const chart = useTranslations('chart.heatmap');
  const shell = useTranslations('aiOverview.shell');
  const words = useTopicWords();
  const empties = useTopicEmpty();
  const { scope, setScope } = useOverview();
  const loaded = useAllGroupsSummary({ subscribed: live });
  // Without the vocabulary trees every topic is a top level row: the card waits for them, so rows do not regroup
  const data: TopicData =
    loaded.tree.pending && (loaded.phase === 'ready' || loaded.phase === 'refetching')
      ? { ...loaded, phase: 'loading' }
      : loaded;
  const { links, onClickCapture } = useGroupOpen();

  const measure = scope.metric;
  const measureLabel = t(`measure.${measure}`);
  const chosen = singlePlatform(scope);
  const unavailable = useMemo(
    (): UnavailablePlatform[] => [{ code: AI_OVERVIEW_PLATFORM, label: shell('platformAiOverview') }],
    [shell],
  );

  const heatWords = useMemo(
    (): HeatWords => ({
      rowHeader: heat('rowHeader'),
      promptsHeader: heat('promptsHeader'),
      averageHead: (count) => common('avg', { count }),
      avgLabel: (count) => heat('avgLabel', { count }),
      percent: (value) => (value === null ? EMPTY_VALUE : formatPercent(value, { decimals: 0 })),
      integer: (count) => formatInteger(count),
      cellTip: words.cellTip,
      cellSubject: (group, platform, value) => heat('cellSubject', { topic: group, engine: platform, value }),
      averageSubject: (group, average, value) => heat('averageSubject', { topic: group, average, value }),
      averageNone: (group, value) => heat('averageNone', { topic: group, value }),
      averageValue: (percent, counts, note) => heat('averageValue', { percent, counts, note }),
      averageNote: (platforms) => heat('averageNote', { engines: platforms }),
      averageOnly: (platforms) => heat('averageOnly', { engines: platforms }),
      engineCount: (platform, value, counted) =>
        heat('engineCount', {
          engine: platform,
          count:
            value.successes === null
              ? words.answers(value.answers)
              : heat(counted ? 'countOf' : 'mentionsOf', { successes: value.successes, answers: value.answers }),
        }),
      noAnswers: words.rateTip.noAnswers,
      thin: words.rateTip.thin,
      list: (items) => formatList(items),
      notCollected: (group, platform) => t('heatmap.notCollected', { group, platform }),
    }),
    [heat, common, words, t],
  );

  const { nodes, engines } = data;
  const model = useMemo(
    () => heatRows({ nodes, engines }, { measure }, heatWords, links, unavailable),
    [nodes, engines, measure, heatWords, links, unavailable],
  );

  const columns = useMemo(
    (): HeatColumn[] =>
      model.columns.map((column) => ({
        id: column.id,
        label:
          column.engine === null ? (
            column.label
          ) : (
            <span className={cn('inline-flex min-w-0', column.engine === chosen && 'text-primary-text')}>
              <EngineLogo engine={column.engine} name={column.label} truncate />
            </span>
          ),
      })),
    [model.columns, chosen],
  );

  const title = t('heatmap.title');
  const empty =
    model.total === 0
      ? empties.noTopics
      : model.answered
        ? null
        : empties.noAnswers(
            // The columns are every platform that is on; with one chosen, the empty state names that one
            engines.filter((engine) => chosen === null || engine.code === chosen).map((engine) => engine.label),
            scope.range.days,
          );
  const grid = (form: 'grid' | 'table'): ReactElement => (
    <HeatmapGrid
      caption={title}
      rowHeader={heat('rowHeader')}
      promptsHeader={heat('promptsHeader')}
      columns={columns}
      rows={model.rows}
      scale="sequential"
      density="compact"
      columnWidth="wide"
      form={form}
    />
  );
  const coverage = data.promptsRead ? groupCoverage(data.prompts, nodes) : null;
  const binNames = SEQUENTIAL_BINS.map((bin) => chart(`bins.${bin.key}`)).join(', ');
  const tabs: SegmentedControlItem<ScopeMetric>[] = SCOPE_METRICS.map((key) => ({
    value: key,
    label: t(`tab.${key}`),
  }));

  return (
    <TopicCardFrame
      cardKey="ai.topic_heatmap"
      title={title}
      meta={data.summary === undefined ? null : t('heatmap.meta', { measure: measureLabel })}
      summary={t('heatmap.summary', {
        measure: measureLabel,
        groups: model.total,
        platforms: formatList(engines.map((engine) => engine.label)),
      })}
      data={data}
      empty={empty}
      partialEngines={model.answered ? model.unanswered : []}
      info={{ what: t('info.heatmap.what'), how: t('info.heatmap.how') }}
      footnote={
        <TopicFootnote
          overlapPrompts={coverage?.overlapping ?? null}
          pooled={false}
          weighting="prompt"
          extra={
            <>
              {heat('footnoteBins', { bins: binNames })} {heat('footnoteAverage')}{' '}
              {t('heatmap.footnoteNotCollected', { platform: unavailable[0]?.label ?? '' })}
              {coverage === null || coverage.outside === 0 ? null : (
                <> {t('heatmap.outsideGroups', { count: coverage.outside })}</>
              )}
            </>
          }
        />
      }
      controls={
        <SegmentedControl<ScopeMetric>
          semantics="view"
          label={t('heatmap.metricLabel')}
          size="sm"
          value={measure}
          onValueChange={(next) => {
            setScope({ metric: next });
          }}
          items={tabs}
        />
      }
      body={<div onClickCapture={onClickCapture}>{grid('grid')}</div>}
      table={<div onClickCapture={onClickCapture}>{grid('table')}</div>}
      menu={{ fileName: heatFileName(measure), csv: model.csv }}
      exportBlock={{ id: item.id, build: () => ({ id: item.id, ...model.exportTable }) }}
    />
  );
}
