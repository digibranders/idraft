'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { TopicCardFrame, useTopicEmpty } from './card-frame';
import {
  heatFileName,
  heatRows,
  TOPICS_TAB_SORT,
  type HeatLinks,
  type HeatOptions,
  type HeatSort,
  type HeatWords,
} from './heatmap-model';
import { topicDrawerHref, topicEngineHref, topicsTabHref, type LinkContext } from './links';
import type { TopicData } from './model-types';
import { countOf, enumOf, metricOf } from './options';
import { TopicFootnote } from './topic-footnote';
import { overlapCount } from './topic-nodes';
import { useTopicSummary } from './use-topic-reads';
import { useTopicWords } from './use-topic-words';
import { useOverview } from '../../overview-context';
import { SEQUENTIAL_BINS } from '@/components/app/chart/heat-bins';
import { HeatmapGrid, type HeatColumn } from '@/components/app/chart/heatmap-grid';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import type { CardProps } from '@/features/layouts';
import { EMPTY_VALUE, formatInteger, formatList, formatPercent } from '@/lib/format';

const SORTS: readonly HeatSort[] = ['prompts', 'rate', 'gap'];
const LEVELS: readonly HeatOptions['level'][] = ['top', 'all'];
const DEFAULT_ROWS = 10;

/**
 * The topic heat map (CH-04, CH-40, WB-TPE-01): a row per topic, a column per asked engine for one metric and, from
 * two engines, their equal weight average. A cell is the topic's value on that engine over the window with its counts
 * in its words, hatched under 4 answers and n/a with none; it opens the topic's prompts on that engine. Engines are
 * never pooled but in the average, which says how many took part. Topics overlap, which the footnote says.
 */
export default function TopicHeatmapCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.topics.heatmap');
  const common = useTranslations('aiOverview.topics.common');
  const chart = useTranslations('chart.heatmap');
  const words = useTopicWords();
  const empties = useTopicEmpty();
  const { workspaceSlug, project, scope } = useOverview();
  const loaded = useTopicSummary({ subscribed: live });
  // Without the vocabulary trees every topic is a top level row: the card waits for them, so rows do not regroup
  const data: TopicData =
    loaded.tree.pending && (loaded.phase === 'ready' || loaded.phase === 'refetching')
      ? { ...loaded, phase: 'loading' }
      : loaded;

  const metric = metricOf(options.metric ?? '');
  const level = enumOf(options.level ?? '', LEVELS, 'top');
  const sort = enumOf(options.sort ?? '', SORTS, 'prompts');
  const rows = countOf(options.rows ?? '', DEFAULT_ROWS);

  const context = useMemo(
    (): LinkContext => ({ workspaceSlug, projectSlug: project.slug, scope }),
    [workspaceSlug, project.slug, scope],
  );
  // A link carries the engine filter of the scope, and the Prompts page cannot show an engine that is off
  const holdsOffEngine =
    scope.engines !== null && scope.engines.some((code) => !data.engines.some((e) => e.code === code));
  const links = useMemo(
    (): HeatLinks => ({
      row: (key) => (holdsOffEngine ? null : topicDrawerHref(context, key)),
      cell: (key, code) => topicEngineHref(context, key, code),
    }),
    [context, holdsOffEngine],
  );

  const heatWords = useMemo(
    (): HeatWords => ({
      noTopic: common('noTopic'),
      rowHeader: t('rowHeader'),
      promptsHeader: t('promptsHeader'),
      averageHead: (count) => common('avg', { count }),
      avgLabel: (count) => t('avgLabel', { count }),
      percent: (value) => (value === null ? EMPTY_VALUE : formatPercent(value, { decimals: 0 })),
      integer: (count) => formatInteger(count),
      cellTip: words.cellTip,
      cellSubject: (topic, engine, value) => t('cellSubject', { topic, engine, value }),
      averageSubject: (topic, average, value) => t('averageSubject', { topic, average, value }),
      averageNone: (topic, value) => t('averageNone', { topic, value }),
      averageValue: (percent, counts, note) => t('averageValue', { percent, counts, note }),
      averageNote: (engines) => t('averageNote', { engines }),
      averageOnly: (engines) => t('averageOnly', { engines }),
      engineCount: (engine, value, counted) =>
        t('engineCount', {
          engine,
          count:
            counted && value.successes !== null
              ? t('countOf', { successes: value.successes, answers: value.answers })
              : words.answers(value.answers),
        }),
      noAnswers: words.rateTip.noAnswers,
      thin: words.rateTip.thin,
      list: (items) => formatList(items),
    }),
    [t, common, words],
  );

  const { nodes, engines } = data;
  const model = useMemo(
    () => heatRows({ nodes, engines }, { metric, level, sort, rows }, heatWords, links),
    [nodes, engines, metric, level, sort, rows, heatWords, links],
  );

  const metricLabel = words.metricLabel(metric);
  const title = t('title', { metric: metricLabel });
  const columns = useMemo(
    (): HeatColumn[] =>
      model.columns.map((column) => ({
        id: column.id,
        label:
          column.engine === null ? column.label : <EngineLogo engine={column.engine} name={column.label} truncate />,
      })),
    [model.columns],
  );

  const empty =
    data.nodes.length === 0
      ? empties.noTopics
      : model.answered
        ? null
        : empties.noAnswers(
            data.engines.map((engine) => engine.label),
            scope.range.days,
          );
  const grid = (form: 'grid' | 'table'): ReactElement => (
    <HeatmapGrid
      caption={title}
      rowHeader={t('rowHeader')}
      promptsHeader={t('promptsHeader')}
      columns={columns}
      rows={model.rows}
      scale="sequential"
      density="compact"
      form={form}
    />
  );
  const showAll =
    model.total > model.shown && !holdsOffEngine
      ? topicsTabHref(context, { view: 'heatmap', metric, ...sortOf(sort) })
      : null;

  return (
    <TopicCardFrame
      cardKey="ai.topic_heatmap"
      title={title}
      meta={
        data.summary === undefined
          ? null
          : t('meta', {
              topics: model.total,
              engines: data.engines.length,
              prompts: data.prompts.length,
              window: words.window(scope.range),
            })
      }
      summary={t('summary', { metric: metricLabel, topics: model.total, engines: data.engines.length })}
      data={data}
      empty={empty}
      partialEngines={model.answered ? model.unanswered : []}
      footnote={
        <TopicFootnote
          overlapPrompts={data.promptsRead ? overlapCount(data.prompts, data.nodes) : null}
          pooled={false}
          weighting="prompt"
          extra={
            <>
              {t('footnoteBins', { bins: SEQUENTIAL_BINS.map((bin) => chart(`bins.${bin.key}`)).join(', ') })}{' '}
              {t('footnoteAverage')}
            </>
          }
        />
      }
      body={grid('grid')}
      table={grid('table')}
      menu={{ fileName: heatFileName(metric), csv: model.csv }}
      exportBlock={{ id: item.id, build: () => ({ id: item.id, ...model.exportTable }) }}
      link={showAll === null ? null : { href: showAll, label: t('showAll', { total: model.total }) }}
    />
  );
}

/** The `sort` of the Topics tab for an order of this card; the default order writes none. */
function sortOf(sort: HeatSort): { sort?: string } {
  const text = TOPICS_TAB_SORT[sort];
  return text === undefined ? {} : { sort: text };
}
