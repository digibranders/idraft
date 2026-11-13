'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { TopicCardFrame, useTopicEmpty, type TopicEmpty } from './card-frame';
import { promptHref, type LinkContext } from './links';
import { CELL_OF, type TopicData } from './model-types';
import { metricOf } from './options';
import { PromptWeekHeatmap } from './prompt-week/prompt-week-heatmap';
import {
  NO_GRID,
  PROMPT_WEEK_FILE_NAME,
  defaultTopic,
  hasAnyAnswer,
  hasPooledPoint,
  promptWeekCsv,
  promptWeekExport,
  promptWeekGrid,
  promptWeekView,
  topicChoices,
  type PromptWeekWords,
} from './prompt-week/prompt-week-model';
import { TopicFootnote } from './topic-footnote';
import { overlapCount } from './topic-nodes';
import { READ, useTopicSummary } from './use-topic-reads';
import { useTopicWords } from './use-topic-words';
import { useOverview } from '../../overview-context';
import { SEQUENTIAL_BINS } from '@/components/app/chart/heat-bins';
import { Select } from '@/components/ui/select';
import type { CardProps } from '@/features/layouts';
import { formatChartDate, formatPercent } from '@/lib/format';

/**
 * The prompt by week heat map as a card (CH-12): the prompts of one topic on one engine, a column per week. The
 * topic and the engine are chosen here and are view state, never options; the topic is the scope's or the one with
 * the most prompts. It has no catalog key yet, so it is not in `TOPIC_CARDS`; a screen wires it with a key or a
 * topic drawer slot (follow-up L-D).
 */
export default function PromptWeekCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.topics.promptWeek');
  const common = useTranslations('aiOverview.topics.common');
  const chart = useTranslations('chart.heatmap');
  const words = useTopicWords();
  const empties = useTopicEmpty();
  const { workspaceSlug, project, scope } = useOverview();
  const loaded = useTopicSummary({ ...READ.promptSeries, subscribed: live });
  // The topics to choose from and their prompts come from the vocabulary trees: until they are read the card waits
  const data: TopicData =
    loaded.tree.pending && (loaded.phase === 'ready' || loaded.phase === 'refetching')
      ? { ...loaded, phase: 'loading' }
      : loaded;

  const metric = metricOf(options.metric ?? '');
  const cell = CELL_OF[metric];

  // A choice made under another scope topic is the last scope's: the card follows the scope topic again
  const [picked, setPicked] = useState<{ scopeTopic: string | null; topic: string }>({ scopeTopic: null, topic: '' });
  const [pickedEngine, setPickedEngine] = useState<string | null>(null);
  const choices = topicChoices(data.nodes);
  const own = picked.scopeTopic === scope.topic && choices.some((choice) => choice.key === picked.topic);
  const topic = own ? picked.topic : defaultTopic(choices, data.nodes, scope.topic);
  const topicLabel = choices.find((choice) => choice.key === topic)?.label ?? '';
  const engine = data.engines.find((entry) => entry.code === pickedEngine) ?? data.engines[0];

  const grid =
    topic === null || engine === undefined
      ? NO_GRID
      : promptWeekGrid({
          prompts: data.prompts,
          termId: topic,
          descendants: data.descendants,
          code: engine.code,
          metric: cell,
        });

  const context: LinkContext = { workspaceSlug, projectSlug: project.slug, scope };
  // A link carries the engine filter of the scope, and the Prompts page cannot show an engine that is off
  const holdsOffEngine =
    scope.engines !== null && scope.engines.some((code) => !data.engines.some((entry) => entry.code === code));
  const weekWords: PromptWeekWords = {
    rateTip: words.rateTip,
    percent: (value) => formatPercent(value, { decimals: 0 }),
    date: (iso) => formatChartDate(iso),
    pooledTitle: (weeks, date) => t('pooledTitle', { weeks, date }),
    weekTitle: (date) => t('weekTitle', { date }),
    share: (percent, answers) => common('tipShare', { value: percent, count: answers }),
    subject: (prompt, title, value) => t('cellSubject', { prompt, title, value }),
  };
  const view = promptWeekView(grid, cell, weekWords, (promptId): Route | null =>
    holdsOffEngine ? null : promptHref(context, promptId),
  );

  const empty: TopicEmpty | null =
    choices.length === 0 || grid.rows.length === 0
      ? empties.noTopics
      : hasAnyAnswer(grid)
        ? null
        : empties.noAnswers(engine === undefined ? [] : [engine.label], scope.range.days);

  const controls =
    choices.length === 0 ? undefined : (
      <>
        <div className="w-56 min-w-0">
          <Select<string>
            aria-label={t('topicLabel')}
            size="sm"
            value={topic}
            onValueChange={(next) => {
              setPicked({ scopeTopic: scope.topic, topic: next });
            }}
            placeholder={t('topicLabel')}
            options={choices.map((choice) => ({ value: choice.key, label: choice.label }))}
          />
        </div>
        {data.engines.length > 1 ? (
          <div className="w-40 min-w-0">
            <Select<string>
              aria-label={t('engineLabel')}
              size="sm"
              value={engine?.code ?? null}
              onValueChange={setPickedEngine}
              placeholder={t('engineLabel')}
              options={data.engines.map((entry) => ({ value: entry.code, label: entry.label }))}
            />
          </div>
        ) : null}
      </>
    );

  const heatmap = (form: 'grid' | 'table'): ReactElement => (
    <PromptWeekHeatmap grid={view} caption={t('title')} rowHeader={t('rowHeader')} density="compact" form={form} />
  );

  return (
    <TopicCardFrame
      // CH-12 has no key of its own; this is the height (280) it was planned at
      cardKey="ai.prompt_heatmap"
      title={t('title')}
      meta={
        data.summary === undefined || engine === undefined
          ? null
          : t('meta', {
              topic: topicLabel,
              prompts: grid.rows.length,
              engine: engine.label,
              window: words.window(scope.range),
            })
      }
      summary={t('summary', {
        metric: words.metricLabel(metric),
        topic: topicLabel,
        engine: engine?.label ?? '',
      })}
      data={data}
      empty={empty}
      partialEngines={[]}
      controls={controls}
      footnote={
        <TopicFootnote
          overlapPrompts={data.promptsRead ? overlapCount(data.prompts, data.nodes) : null}
          pooled={hasPooledPoint(grid)}
          weighting="answer"
          extra={t('footnoteColumns', { bins: SEQUENTIAL_BINS.map((bin) => chart(`bins.${bin.key}`)).join(', ') })}
        />
      }
      body={heatmap('grid')}
      table={heatmap('table')}
      menu={{ fileName: PROMPT_WEEK_FILE_NAME, csv: promptWeekCsv(view, t('rowHeader')) }}
      exportBlock={{ id: item.id, build: () => ({ id: item.id, ...promptWeekExport(grid) }) }}
    />
  );
}
