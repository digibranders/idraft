'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useOverview } from '../../overview-context';
import { TopicCardFrame, useTopicEmpty, type TopicEmpty } from './card-frame';
import type { EngineValue } from './engine-values';
import { gapExportHeader, gapFileName, gapRows, verdictOf, type GapRow, type Verdict } from './gap-model';
import { topicDrawerHref, topicsTabHref } from './links';
import { CELL_OF, type TopicData, type TopicMetric } from './model-types';
import { countOf, metricOf } from './options';
import { EngineRangePlot, EngineRangeTable, markerOf, type RangePlotRow } from './parts/engine-range-plot';
import { engineRole } from './engine-role';
import { TopicFootnote } from './topic-footnote';
import { leavesOf, overlapCount } from './topic-nodes';
import { exportCells, topicEngineRows } from './topic-rows';
import { useTopicSummary } from './use-topic-reads';
import { useTopicWords } from './use-topic-words';
import type { LegendItem } from '@/components/app/chart/chart-legend';
import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import type { CardProps } from '@/features/layouts';
import { safeText, type CsvCell, type CsvTable } from '@/lib/csv/csv-write';
import { EMPTY_VALUE } from '@/lib/format';
import { projectPath } from '@/lib/routes/paths';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/** The words of a verdict (messages) and the machine word the export writes. */
const VERDICT_MESSAGE = {
  within: 'verdict.within',
  detectable: 'verdict.detectable',
  tooFew: 'verdict.tooFew',
  share: 'verdict.share',
  equal: 'verdict.equal',
  zero: 'verdict.zero',
} as const satisfies Record<Verdict, string>;
const VERDICT_EXPORT: Readonly<Record<Verdict, string>> = {
  within: 'within',
  detectable: 'detectable',
  tooFew: 'too_few',
  share: 'share_no_test',
  equal: 'equal',
  zero: 'zero',
};

const isCounted = (metric: TopicMetric, value: EngineValue): boolean =>
  metric !== 'share_of_voice' && value.successes !== null;

/** Where engines disagree (CH-43, `ai.topic_engine_gap`): the topics whose engines differ most, on one axis. */
export default function TopicEngineGapCard({ item, options }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.topics.gap');
  const common = useTranslations('aiOverview.topics.common');
  const words = useTopicWords();
  const empties = useTopicEmpty();
  const { workspaceSlug, project, enabledEngines, canManageEngines, setScope } = useOverview();
  const read = useTopicSummary();
  // The leaf topics depend on the vocabulary tree: until it is read, rows would be compared beside their parents
  const data: TopicData =
    read.tree.pending && (read.phase === 'ready' || read.phase === 'refetching') ? { ...read, phase: 'loading' } : read;
  const metric = metricOf(options.metric ?? '');
  const count = countOf(options.rows ?? '', 10);
  const { engines, scope } = data;
  const codes = useMemo(() => engines.map((engine) => engine.code), [engines]);
  const labels = engines.map((engine) => engine.label);
  const nameOf = (code: string): string => engines.find((engine) => engine.code === code)?.label ?? code;
  const context = { workspaceSlug, projectSlug: project.slug, scope };

  const model = useMemo(() => gapRows(data.nodes, codes, CELL_OF[metric], count), [data.nodes, codes, metric, count]);
  // Every leaf topic, to tell an engine with no rate anywhere (a partial notice) from a window with no answer at all
  const all = useMemo(() => topicEngineRows(leavesOf(data.nodes), codes, CELL_OF[metric]), [data.nodes, codes, metric]);
  const silent = engines.filter((_engine, place) => all.every((row) => row.values[place]?.state !== 'ok'));
  const answered = all.some((row) => row.values.some((value) => value.answers > 0));

  const topicsHref: Route =
    topicsTabHref(context, { view: 'engines', metric }) ?? projectPath(workspaceSlug, project.slug, '/ai/prompts');
  const empty = ((): TopicEmpty | null => {
    if (engines.length < 2) {
      const title = t('needsTwoTitle');
      if (scope.engines !== null && enabledEngines.length > 1) {
        return {
          title,
          reason: t('needsTwoReason'),
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
      if (!canManageEngines) return { title, reason: t('needsTwoAdmin'), action: null };
      return {
        title,
        reason: t('needsTwoReason'),
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
    }
    if (all.length === 0) return empties.noTopics;
    if (!answered) return empties.noAnswers(labels, scope.range.days);
    if (model.rows.length > 0) return null;
    return {
      title: t('noGapTitle'),
      reason: t('noGapReason', { min: MIN_OBSERVATIONS }),
      action: (
        <LinkButton variant="secondary" size="sm" render={<Link href={topicsHref} />}>
          {common('openTopics')}
        </LinkButton>
      ),
    };
  })();

  const dotText = (value: EngineValue): string => {
    if (value.state === 'ok') return words.cellTip(value, isCounted(metric, value));
    return value.state === 'insufficient' ? words.answers(value.answers) : EMPTY_VALUE;
  };
  const plotRowOf = (gap: GapRow): RangePlotRow => {
    const { node } = gap.row;
    const verdict = verdictOf(gap.comparison);
    const verdictText = t(VERDICT_MESSAGE[verdict]);
    const spreadText = t('points', { points: Math.round(gap.points) });
    const dots = gap.engines.map((entry) => ({
      code: entry.code,
      name: nameOf(entry.code),
      position: entry.position,
      text: dotText(entry.value),
    }));
    const values = dots.map((dot) => t('valueLine', { engine: dot.name, text: dot.text })).join('; ');
    const { comparison } = gap;
    return {
      id: node.key,
      label: node.name,
      href: topicDrawerHref(context, node.key) ?? undefined,
      dots,
      spreadText,
      verdict: verdictText,
      accessibleText:
        comparison.kind === 'gap'
          ? t('rowText', {
              topic: node.name,
              points: spreadText,
              best: nameOf(comparison.best.code),
              worst: nameOf(comparison.worst.code),
              verdict: verdictText,
              values,
            })
          : t('rowTextFlat', { topic: node.name, verdict: verdictText, values }),
      detail: values,
    };
  };
  const rows = model.rows.map(plotRowOf);

  const labelsOf = { topic: t('table.topic'), spread: t('table.spread'), verdict: t('table.reading') };
  const csv: CsvTable = {
    header: [labelsOf.topic, ...engines.map((engine) => engine.label), labelsOf.spread, labelsOf.verdict],
    rows: rows.map((row): CsvCell[] => [
      safeText(row.label),
      ...row.dots.map((dot) => safeText(dot.text)),
      row.spreadText,
      row.verdict,
    ]),
  };
  const legend: LegendItem[] = engines.map((engine) => ({
    id: engine.code,
    name: engine.label,
    role: engineRole(engine.code),
    swatch: { marker: markerOf(engine.code) },
    pressed: true,
  }));
  const metricLabel = words.metricLabel(metric);

  return (
    <TopicCardFrame
      cardKey="ai.topic_engine_gap"
      title={t('title')}
      meta={words.window(scope.range)}
      summary={t('summary', { metric: metricLabel, count: rows.length })}
      data={data}
      empty={empty}
      partialEngines={silent.map((engine) => engine.label)}
      footnote={
        <TopicFootnote
          overlapPrompts={data.promptsRead ? overlapCount(data.prompts, data.nodes) : null}
          pooled={false}
          weighting="prompt"
          extra={<span>{t('scope')}</span>}
        />
      }
      legend={legend}
      menu={{ fileName: gapFileName(metric), csv }}
      exportBlock={{
        id: item.id,
        build: () => ({
          id: item.id,
          header: gapExportHeader(codes),
          rows: model.rows.map((gap): CsvCell[] => [
            safeText(gap.row.node.name),
            ...gap.engines.flatMap((entry) => exportCells(entry.value)),
            Math.round(gap.points * 100) / 100,
            VERDICT_EXPORT[verdictOf(gap.comparison)],
          ]),
        }),
      }}
      body={<EngineRangePlot rows={rows} caption={t('plotCaption', { metric: metricLabel })} />}
      table={<EngineRangeTable rows={rows} caption={t('tableCaption', { metric: metricLabel })} labels={labelsOf} />}
    />
  );
}
