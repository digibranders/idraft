'use client';

import type { Route } from 'next';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useOverview } from '../../overview-context';
import { CARD_HEIGHT } from './card-heights';
import { TopicCardFrame, useTopicEmpty, type TopicEmpty } from './card-frame';
import type { EngineValue } from './engine-values';
import { topicDrawerHref, topicsTabHref } from './links';
import type { TopicData } from './model-types';
import { engineOf } from './options';
import {
  SCATTER_EXPORT_HEADER,
  SCATTER_PLOTTED,
  scatterFileName,
  scatterModel,
  type ScatterModel,
  type ScatterRow,
} from './scatter-model';
import { scatterOption } from './scatter-option';
import { TopicFootnote } from './topic-footnote';
import { overlapCount } from './topic-nodes';
import { exportCells } from './topic-rows';
import { useTopicSummary } from './use-topic-reads';
import { useTopicWords, type TopicWords } from './use-topic-words';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import type { CardProps } from '@/features/layouts';
import { formatList, EMPTY_VALUE, formatPercent } from '@/lib/format';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { safeText, type CsvCell, type CsvTable } from '@/lib/csv/csv-write';
import { ENGINES } from '@/lib/layouts/catalog';
import { projectPath } from '@/lib/routes/paths';
import { MIN_OBSERVATIONS } from '@/lib/stats';

// The canvas is its own chunk, loaded on the client after the page: never a static import of the scatter module
const ScatterEChart = dynamic(
  () => import('@/components/app/chart/echart-scatter').then((module) => module.ScatterEChart),
  { ssr: false, loading: () => <Skeleton shape="block" className="h-full w-full" /> },
);

const PLOT_HEIGHT = CARD_HEIGHT['ai.citation_vs_mention'];
const NO_ROWS: ScatterModel = { rows: [], points: [], unplotted: 0, ceiling: 1, leaders: [], answered: false };

/** A rate with the answers behind it, or what stands in for it: a percent is never written without its count (R1). */
const valueTextOf =
  (words: TopicWords) =>
  (value: EngineValue): string => {
    if (value.state !== 'ok' || value.value === null) return words.cellTip(value, true);
    const percent = words.rateTip.value(value.value);
    return value.successes === null
      ? `${percent}, ${words.answers(value.answers)}`
      : `${percent}, ${words.rateTip.answers(value.successes, value.answers)}`;
  };

/** Cited as often as named? (CH-15, `ai.citation_vs_mention`): each leaf topic as a point, mention rate across and citation rate up. */
export default function CitationVsMentionCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.topics.scatter');
  const common = useTranslations('aiOverview.topics.common');
  const words = useTopicWords();
  const empties = useTopicEmpty();
  const { workspaceSlug, project, setScope, enabledEngines, canManageEngines } = useOverview();
  const read = useTopicSummary({ subscribed: live });
  // The leaf topics depend on the vocabulary tree: until it is read, a parent would be drawn beside its own subtopics
  const data: TopicData =
    read.tree.pending && (read.phase === 'ready' || read.phase === 'refetching') ? { ...read, phase: 'loading' } : read;
  const code = engineOf(options.engine ?? '');
  const engineLabel = ENGINES.find((engine) => engine.code === code)?.label ?? code;
  const { scope } = data;
  const asked = data.engines.some((engine) => engine.code === code);
  const model = asked ? scatterModel(data.nodes, code) : NO_ROWS;
  const context = { workspaceSlug, projectSlug: project.slug, scope };
  const valueText = valueTextOf(words);
  const gapText = (row: ScatterRow): string =>
    row.gap === null ? EMPTY_VALUE : t('points', { points: Math.round(row.gap) || 0 });
  const title = t('title', { engine: engineLabel });

  // Plain computation: the React Compiler keeps the function (and so the canvas) steady while its inputs are
  const option = (tokens: ChartTokens): Record<string, unknown> =>
    scatterOption({ points: model.points, ceiling: model.ceiling }, tokens, {
      series: t('series'),
      mention: words.metricLabel('mention'),
      citation: words.metricLabel('citation'),
      reference: t('reference'),
      rate: (ratio) => formatPercent(ratio, { decimals: 0 }),
      value: valueText,
      prompts: words.prompts,
    });

  const engineOut = (): TopicEmpty => {
    const heading = t('engineOutTitle', { engine: engineLabel });
    if (scope.engines !== null && enabledEngines.some((enabled) => enabled === code)) {
      return {
        title: heading,
        reason: t('engineOutFiltered', { engine: engineLabel }),
        action: (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setScope({ engines: null });
            }}
          >
            {common('useAllEngines')}
          </Button>
        ),
      };
    }
    if (!canManageEngines)
      return { title: heading, reason: t('engineOutAdmin', { engine: engineLabel }), action: null };
    return {
      title: heading,
      reason: t('engineOutOff', { engine: engineLabel }),
      action: (
        <LinkButton
          variant="secondary"
          size="sm"
          render={<Link href={projectPath(workspaceSlug, project.slug, '/settings/engines')} />}
        >
          {common('turnOnEngines')}
        </LinkButton>
      ),
    };
  };
  const topicsHref: Route =
    topicsTabHref(context, { view: 'engines', metric: 'citation' }) ??
    projectPath(workspaceSlug, project.slug, '/ai/prompts');
  const empty = ((): TopicEmpty | null => {
    if (data.phase === 'idle') return null;
    if (!asked) return engineOut();
    if (model.rows.length === 0) return empties.noTopics;
    if (!model.answered) return empties.noAnswers([engineLabel], scope.range.days);
    if (model.points.length > 0) return null;
    return {
      title: t('noPointsTitle'),
      reason: t('noPointsReason', { min: MIN_OBSERVATIONS }),
      action: (
        <LinkButton variant="secondary" size="sm" render={<Link href={topicsHref} />}>
          {common('openTopics')}
        </LinkButton>
      ),
    };
  })();

  const columns: PlainColumn<ScatterRow>[] = [
    {
      id: 'topic',
      header: t('table.topic'),
      cell: (row) => {
        const href = topicDrawerHref(context, row.node.key);
        return href === null ? row.node.name : <TextLink render={<Link href={href} />}>{row.node.name}</TextLink>;
      },
    },
    { id: 'mention', header: t('table.mention'), wrap: true, cell: (row) => valueText(row.mention) },
    { id: 'citation', header: t('table.citation'), wrap: true, cell: (row) => valueText(row.citation) },
    { id: 'prompts', header: t('table.prompts'), cell: (row) => words.prompts(row.node.promptCount) },
    { id: 'gap', header: t('table.gap'), cell: gapText },
  ];
  const csv: CsvTable = {
    header: columns.map((column) => column.header),
    rows: model.rows.map((row): CsvCell[] => [
      safeText(row.node.name),
      valueText(row.mention),
      valueText(row.citation),
      words.prompts(row.node.promptCount),
      gapText(row),
    ]),
  };

  const summary = [
    t('summary', { engine: engineLabel, count: model.points.length }),
    model.leaders.length === 0
      ? null
      : t('summaryLeaders', { topics: formatList(model.leaders.map((row) => row.node.name)) }),
  ]
    .filter((sentence) => sentence !== null)
    .join(' ');
  const footnoteExtra = [
    t('scope', { ceiling: formatPercent(model.ceiling, { decimals: 0 }) }),
    model.unplotted > 0 ? t('excluded', { count: model.unplotted }) : null,
  ]
    .filter((sentence) => sentence !== null)
    .join(' ');

  return (
    <TopicCardFrame
      cardKey="ai.citation_vs_mention"
      title={title}
      meta={words.window(scope.range)}
      summary={summary}
      data={data}
      empty={empty}
      partialEngines={[]}
      footnote={
        <TopicFootnote
          overlapPrompts={data.promptsRead ? overlapCount(data.prompts, data.nodes) : null}
          pooled={false}
          weighting="prompt"
          extra={footnoteExtra}
        />
      }
      menu={{ fileName: scatterFileName(code), csv }}
      exportBlock={{
        id: item.id,
        build: () => ({
          id: item.id,
          header: SCATTER_EXPORT_HEADER,
          rows: model.rows.map((row): CsvCell[] => [
            safeText(row.node.name),
            ...exportCells(row.mention),
            ...exportCells(row.citation),
            row.node.promptCount,
            row.gap === null ? null : Math.round(row.gap * 100) / 100,
            row.plotted ? SCATTER_PLOTTED.yes : SCATTER_PLOTTED.no,
          ]),
        }),
      }}
      body={
        // The canvas cannot be reached with a keyboard: the Table form is the way in
        <div role="img" aria-label={title} style={{ height: PLOT_HEIGHT }}>
          <ScatterEChart option={option} height={PLOT_HEIGHT} />
        </div>
      }
      table={
        <PlainTable<ScatterRow>
          caption={t('tableCaption', { engine: engineLabel })}
          columns={columns}
          rows={model.rows}
          rowKey={(row) => row.node.key}
          status="ready"
          errorState={null}
          emptyText={EMPTY_VALUE}
        />
      }
    />
  );
}
