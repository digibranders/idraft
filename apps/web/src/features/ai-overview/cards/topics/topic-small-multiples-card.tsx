'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useOverview } from '../../overview-context';
import { TopicCardFrame, useTopicEmpty, type TopicEmpty } from './card-frame';
import type { TopicData } from './model-types';
import {
  MULTIPLES_EXPORT_HEADER,
  multiplesFileName,
  multiplesModel,
  multiplesPanels,
  type MultiplesWords,
} from './multiples-model';
import { countOf, engineOf } from './options';
import { TopicTrellis, TrellisTable, trellisCsv, type TrellisRow } from './parts/topic-trellis';
import { TopicFootnote } from './topic-footnote';
import { overlapCount, topLevelOf } from './topic-nodes';
import { ceilingOf, hasAnyRate, hasPooledPoint, trendExportRows, weekLabels, type TrendModel } from './trend-model';
import { READ, useTopicSummary } from './use-topic-reads';
import { useTopicWords } from './use-topic-words';
import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import type { CardProps } from '@/features/layouts';
import { ENGINES } from '@/lib/layouts/catalog';
import { formatBusinessDate, formatChartDate, formatPercent } from '@/lib/format';
import { projectPath } from '@/lib/routes/paths';

/** Charts in a row of the grid. */
const PER_ROW = 3;
const NO_HIDDEN: ReadonlySet<string> = new Set();
const NO_TREND: TrendModel = { weeks: [], rows: [], total: 0 };

/** The weekly mention rate of the leading topics on one engine, one small chart each (CH-33, `ai.topic_small_multiples`). */
export default function TopicSmallMultiplesCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.topics.multiples');
  const common = useTranslations('aiOverview.topics.common');
  const chart = useTranslations('chart');
  const words = useTopicWords();
  const empties = useTopicEmpty();
  const { workspaceSlug, project, setScope, enabledEngines, canManageEngines } = useOverview();
  const read = useTopicSummary({ ...READ.topicSeries, subscribed: live });
  // The top level topics depend on the vocabulary tree: until it is read, a subtopic would stand among them
  const data: TopicData =
    read.tree.pending && (read.phase === 'ready' || read.phase === 'refetching') ? { ...read, phase: 'loading' } : read;
  const code = engineOf(options.engine ?? '');
  const count = countOf(options.topics ?? '', 6);
  const { scope } = data;
  const engineLabel = ENGINES.find((engine) => engine.code === code)?.label ?? code;

  const model = multiplesModel({ nodes: data.nodes, engines: data.engines, code, count });
  const trend = model.state === 'ok' ? model.trend : NO_TREND;
  const multiplesWords: MultiplesWords = {
    rateTip: words.rateTip,
    share: (value, answers) => common('tipShare', { value: words.percent(value), count: answers }),
    pooledTo: (weeks, to) => t('pooledTo', { weeks, date: formatChartDate(to) }),
    panelName: (topic, prompts) => t('panelName', { topic, count: prompts }),
  };
  const panels = model.state === 'ok' ? multiplesPanels(model, multiplesWords) : [];
  const ceiling = ceilingOf(panels);
  const categories = weekLabels(trend.weeks);
  const titles = trend.weeks.map((week) => t('weekOf', { date: formatBusinessDate(week) }));
  // Every chart is in one group, so one crosshair runs over the whole grid
  const rows: TrellisRow[] = Array.from({ length: Math.ceil(panels.length / PER_ROW) }, (_, index) => ({
    id: `row-${String(index)}`,
    label: null,
    meta: null,
    group: 'all',
    cells: panels.slice(index * PER_ROW, (index + 1) * PER_ROW).map((entry) => ({
      panel: entry.panel,
      column: entry.cell.engine.code,
      caption: entry.panel.name,
      hasSeries: entry.hasSeries,
    })),
  }));

  const engineOut = (): TopicEmpty => {
    const title = t('engineOutTitle', { engine: engineLabel });
    if (scope.engines !== null && enabledEngines.some((enabled) => enabled === code)) {
      return {
        title,
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
    if (!canManageEngines) return { title, reason: t('engineOutAdmin', { engine: engineLabel }), action: null };
    return {
      title,
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
  const empty = ((): TopicEmpty | null => {
    if (data.phase === 'idle') return null;
    if (model.state === 'not_asked') return engineOut();
    if (topLevelOf(data.nodes).length === 0) return empties.noTopics;
    return hasAnyRate(model.trend) ? null : empties.noAnswers([engineLabel], scope.range.days);
  })();

  const trellisWords = {
    noWeekly: t('noWeekly'),
    noValue: chart('noValue'),
    latest: (date: string, text: string): string => t('latest', { date, text }),
  };
  const footnoteExtra = [
    t('band'),
    t('scale', { ceiling: formatPercent(ceiling, { decimals: 0 }) }),
    trend.total > trend.rows.length ? t('cut', { shown: trend.rows.length, total: trend.total }) : null,
  ]
    .filter((sentence) => sentence !== null)
    .join(' ');

  return (
    <TopicCardFrame
      cardKey="ai.topic_small_multiples"
      title={t('title', { engine: engineLabel })}
      meta={words.window(scope.range)}
      summary={t('summary', { topics: trend.rows.length, engine: engineLabel })}
      data={data}
      empty={empty}
      partialEngines={[]}
      footnote={
        <TopicFootnote
          overlapPrompts={data.promptsRead ? overlapCount(data.prompts, data.nodes) : null}
          pooled={hasPooledPoint(trend)}
          weighting="prompt"
          extra={footnoteExtra}
        />
      }
      menu={{
        fileName: multiplesFileName(code),
        csv: trellisCsv({ rows, categories, categoryHeader: t('weekHeader'), failedText: chart('failed') }),
      }}
      exportBlock={{
        id: item.id,
        build: () => ({ id: item.id, header: MULTIPLES_EXPORT_HEADER, rows: trendExportRows(trend) }),
      }}
      body={
        <TopicTrellis
          rows={rows}
          categories={categories}
          titles={titles}
          ceiling={ceiling}
          hidden={NO_HIDDEN}
          words={trellisWords}
        />
      }
      table={
        <TrellisTable
          rows={rows}
          categories={categories}
          categoryHeader={t('weekHeader')}
          caption={t('tableCaption', { engine: engineLabel })}
          hidden={NO_HIDDEN}
          words={trellisWords}
        />
      }
    />
  );
}
