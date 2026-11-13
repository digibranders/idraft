'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { TopicCardFrame, useTopicEmpty, type TopicEmpty } from './card-frame';
import { promptHref, promptsTabHref, type LinkContext } from './links';
import type { TopicData } from './model-types';
import { countOf, enumOf } from './options';
import {
  PROMPT_HEAT_FILE_NAME,
  promptHeatRows,
  type PromptHeatRow,
  type PromptHeatSort,
  type PromptHeatWords,
} from './prompt-heat-model';
import { useTopicSummary } from './use-topic-reads';
import { useTopicWords } from './use-topic-words';
import { useOverview } from '../../overview-context';
import { SEQUENTIAL_BINS } from '@/components/app/chart/heat-bins';
import { HeatmapGrid, type HeatColumn, type HeatRow } from '@/components/app/chart/heatmap-grid';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { LinkButton } from '@/components/ui/link-button';
import type { CardProps } from '@/features/layouts';
import { EMPTY_VALUE, formatList, formatPercent, formatTableDate } from '@/lib/format';
import { useVocabularies } from '@/lib/keywords/taxonomy-reads';
import { projectPath } from '@/lib/routes/paths';
import { MIN_OBSERVATIONS } from '@/lib/stats';

const SORTS: readonly PromptHeatSort[] = ['most_named', 'least_named'];
const DEFAULT_ROWS = 10;

/** The prompt as asked and, under it, the place of its first topic. */
function PromptLabel({ text, path }: { text: string; path: string | null }): ReactElement {
  return (
    <span className="flex min-w-0 flex-col py-1">
      <span className="truncate">{text}</span>
      {path === null ? null : (
        <span data-slot="prompt-topic-path" className="truncate type-meta text-foreground-tertiary">
          {path}
        </span>
      )}
    </span>
  );
}

/**
 * The prompts by engine heat map (CH-11): a row per prompt, a column per asked engine for the mention rate and, from
 * two engines, their equal weight average. A cell is the prompt's own rate on that engine with its counts in its
 * words, hatched under 4 answers and n/a with none; it opens the prompt. The rows are ordered, then cut, so the cut
 * never hides the worst. Each prompt is one row whatever its number of topics.
 */
export default function PromptHeatmapCard({ item, options }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.topics.promptHeatmap');
  const common = useTranslations('aiOverview.topics.common');
  const chart = useTranslations('chart.heatmap');
  const words = useTopicWords();
  const empties = useTopicEmpty();
  const { workspaceId, workspaceSlug, project, scope } = useOverview();
  const loaded = useTopicSummary();
  const vocabularies = useVocabularies({ workspaceId, projectId: project.id });
  // Without the vocabulary trees no prompt has its topic path: the card waits for them, so the rows do not change
  const data: TopicData =
    loaded.tree.pending && (loaded.phase === 'ready' || loaded.phase === 'refetching')
      ? { ...loaded, phase: 'loading' }
      : loaded;
  const tree = vocabularies.loaded.filter((entry) => entry.vocabulary.kind === 'topic').flatMap((entry) => entry.terms);

  const sort = enumOf(options.sort ?? '', SORTS, 'least_named');
  const rows = countOf(options.rows ?? '', DEFAULT_ROWS);

  const context: LinkContext = { workspaceSlug, projectSlug: project.slug, scope };
  // A link carries the engine filter of the scope, and the Prompts page cannot show an engine that is off
  const holdsOffEngine =
    scope.engines !== null && scope.engines.some((code) => !data.engines.some((engine) => engine.code === code));
  const promptsHref: Route | null = promptsTabHref(context);

  const heatWords: PromptHeatWords = {
    rowHeader: t('rowHeader'),
    averageHead: (count) => common('avg', { count }),
    avgLabel: (count) => t('avgLabel', { count }),
    percent: (value) => (value === null ? EMPTY_VALUE : formatPercent(value, { decimals: 0 })),
    cellTip: words.cellTip,
    lastValid: (iso) =>
      iso === null ? t('noValidYet') : t('lastValid', { date: formatTableDate(iso, project.timeZone) }),
    rowName: (text, path) => (path === null ? text : t('rowName', { prompt: text, path })),
    cellSubject: (prompt, engine, value, lastValid) => t('cellSubject', { prompt, engine, value, lastValid }),
    averageSubject: (prompt, average, value, lastValid) => t('averageSubject', { prompt, average, value, lastValid }),
    averageNone: (prompt, value, lastValid) => t('averageNone', { prompt, value, lastValid }),
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
  };
  const model = promptHeatRows({ prompts: data.prompts, engines: data.engines, tree }, { sort, rows }, heatWords, {
    prompt: (promptId) => (holdsOffEngine ? null : promptHref(context, promptId)),
  });

  const columns: HeatColumn[] = model.columns.map((column) => ({
    id: column.id,
    label: column.engine === null ? column.label : <EngineLogo engine={column.engine} name={column.label} truncate />,
  }));
  const gridRows: HeatRow[] = model.rows.map(({ text, path, ...row }: PromptHeatRow) => ({
    ...row,
    label: <PromptLabel text={text} path={path} />,
  }));
  const grid = (form: 'grid' | 'table'): ReactElement => (
    <HeatmapGrid
      caption={t('title')}
      rowHeader={t('rowHeader')}
      columns={columns}
      rows={gridRows}
      scale="sequential"
      density="compact"
      form={form}
    />
  );

  const openPrompts: Route = promptsHref ?? projectPath(workspaceSlug, project.slug, '/ai/prompts');
  const noPrompts: TopicEmpty = {
    title: t('noPromptsTitle'),
    reason: t('noPromptsReason'),
    action: (
      <LinkButton variant="secondary" size="sm" render={<Link href={openPrompts} />}>
        {common('openTopics')}
      </LinkButton>
    ),
  };
  const empty =
    data.prompts.length === 0
      ? scope.topic === null
        ? noPrompts
        : empties.noTopics
      : model.answered
        ? null
        : empties.noAnswers(
            data.engines.map((engine) => engine.label),
            scope.range.days,
          );

  const showAll = model.total > model.shown && !holdsOffEngine ? promptsHref : null;

  return (
    <TopicCardFrame
      cardKey="ai.prompt_heatmap"
      title={t('title')}
      meta={
        data.summary === undefined
          ? null
          : t('meta', {
              shown: model.shown,
              total: model.total,
              engines: data.engines.length,
              window: words.window(scope.range),
            })
      }
      summary={t('summary', { shown: model.shown, total: model.total, engines: data.engines.length, sort })}
      data={data}
      empty={empty}
      partialEngines={model.answered ? model.unanswered : []}
      footnote={
        <div>
          <span>{t('footnoteRows')}</span> <span>{common('smallSample', { min: MIN_OBSERVATIONS })}</span>{' '}
          <span>{t('footnoteBins', { bins: SEQUENTIAL_BINS.map((bin) => chart(`bins.${bin.key}`)).join(', ') })}</span>{' '}
          <span>{t('footnoteAverage')}</span>
        </div>
      }
      body={grid('grid')}
      table={grid('table')}
      menu={{ fileName: PROMPT_HEAT_FILE_NAME, csv: model.csv }}
      exportBlock={{ id: item.id, build: () => ({ id: item.id, ...model.exportTable }) }}
      link={showAll === null ? null : { href: showAll, label: t('showAll', { total: model.total }) }}
    />
  );
}
