'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { TopicCardFrame, useTopicEmpty, type TopicEmpty } from './card-frame';
import { engineRole } from './engine-role';
import { CELL_OF, type TopicData } from './model-types';
import { countOf, metricOf } from './options';
import { TopicTrellis, TrellisTable, trellisCsv, type TrellisRow } from './parts/topic-trellis';
import { TopicFootnote } from './topic-footnote';
import { overlapCount, topLevelOf } from './topic-nodes';
import {
  buildTrend,
  ceilingOf,
  enginesWithoutRate,
  hasAnyRate,
  hasPooledPoint,
  trendExportRows,
  trendFileName,
  trendPanels,
  TREND_EXPORT_HEADER,
  weekLabels,
  type TrendWords,
} from './trend-model';
import { READ, useTopicSummary } from './use-topic-reads';
import { useTopicWords } from './use-topic-words';
import type { LegendItem } from '@/components/app/chart/chart-legend';
import type { CardProps } from '@/features/layouts';
import { announce } from '@/lib/a11y/announcer';
import { formatBusinessDate, formatChartDate, formatList, formatPercent } from '@/lib/format';

/** The weekly rate of the leading topics on each engine, one small chart each (CH-45, `ai.topic_trends`). */
export default function TopicTrendsCard({ item, options }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.topics.trends');
  const common = useTranslations('aiOverview.topics.common');
  const chart = useTranslations('chart');
  const words = useTopicWords();
  const empties = useTopicEmpty();
  const read = useTopicSummary(READ.topicSeries);
  // The top level topics depend on the vocabulary tree: until it is read, a subtopic would stand among them
  const data: TopicData =
    read.tree.pending && (read.phase === 'ready' || read.phase === 'refetching') ? { ...read, phase: 'loading' } : read;
  const metric = metricOf(options.metric ?? '');
  const cell = CELL_OF[metric];
  const count = countOf(options.topics ?? '', 6);
  const { engines, scope } = data;
  const labels = engines.map((engine) => engine.label);
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());

  const model = buildTrend({ nodes: data.nodes, engines, metric: cell, count });
  const trendWords: TrendWords = {
    rateTip: words.rateTip,
    share: (value, answers) => common('tipShare', { value: words.percent(value), count: answers }),
    pooledTo: (weeks, to) => t('pooledTo', { weeks, date: formatChartDate(to) }),
  };
  const panels = trendPanels(model, cell, trendWords, (row, column) =>
    t('panelName', { topic: row.node.name, engine: column.engine.label }),
  );
  const ceiling = ceilingOf(panels);
  const categories = weekLabels(model.weeks);
  const titles = model.weeks.map((week) => t('weekOf', { date: formatBusinessDate(week) }));
  const rows: TrellisRow[] = model.rows.map((row) => ({
    id: row.node.key,
    label: row.node.name,
    meta: words.prompts(row.node.promptCount),
    group: row.node.key,
    cells: panels
      .filter((entry) => entry.row === row)
      .map((entry) => ({
        panel: entry.panel,
        column: entry.cell.engine.code,
        caption: entry.cell.engine.label,
        hasSeries: entry.hasSeries,
      })),
  }));

  const title = t('title', { metric: words.metricLabel(metric) });
  const legendItems: LegendItem[] = engines.map((engine) => ({
    id: engine.code,
    name: engine.label,
    role: engineRole(engine.code),
    pressed: !off.has(engine.code),
  }));
  const toggle = (code: string): void => {
    const engine = engines.find((entry) => entry.code === code);
    if (engine === undefined) return;
    if (!off.has(code) && engines.filter((entry) => !off.has(entry.code)).length <= 1) {
      // The legend has already said it is hidden; this says what really happened, after it. A key of its own,
      // because the legend's announcement has none and a keyless one cancels a waiting keyless message.
      announce(t('keepOne', { name: engine.label }), { debounceMs: 100, key: 'trend-keep-one' });
      return;
    }
    setOff((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const empty = ((): TopicEmpty | null => {
    if (topLevelOf(data.nodes).length === 0) return empties.noTopics;
    return hasAnyRate(model) ? null : empties.noAnswers(labels, scope.range.days);
  })();

  const trellisWords = {
    noWeekly: t('noWeekly'),
    noValue: chart('noValue'),
    latest: (date: string, text: string): string => t('latest', { date, text }),
  };
  const footnoteExtra = [
    t('band'),
    t('scale', { ceiling: formatPercent(ceiling, { decimals: 0 }) }),
    model.total > model.rows.length ? t('cut', { shown: model.rows.length, total: model.total }) : null,
  ]
    .filter((sentence) => sentence !== null)
    .join(' ');

  return (
    <TopicCardFrame
      cardKey="ai.topic_trends"
      title={title}
      meta={words.window(scope.range)}
      summary={t('summary', {
        metric: words.metricLabel(metric),
        topics: model.rows.length,
        engines: formatList(labels),
      })}
      data={data}
      empty={empty}
      partialEngines={enginesWithoutRate(model, engines).map((engine) => engine.label)}
      footnote={
        <TopicFootnote
          overlapPrompts={data.promptsRead ? overlapCount(data.prompts, data.nodes) : null}
          pooled={hasPooledPoint(model)}
          weighting="prompt"
          extra={footnoteExtra}
        />
      }
      menu={{
        fileName: trendFileName(metric),
        csv: trellisCsv({ rows, categories, categoryHeader: t('weekHeader'), failedText: chart('failed') }),
      }}
      exportBlock={{
        id: item.id,
        build: () => ({ id: item.id, header: TREND_EXPORT_HEADER, rows: trendExportRows(model) }),
      }}
      body={
        <TopicTrellis
          rows={rows}
          categories={categories}
          titles={titles}
          ceiling={ceiling}
          hidden={off}
          words={trellisWords}
          legend={{ title, items: legendItems, onToggle: toggle }}
        />
      }
      table={
        <TrellisTable
          rows={rows}
          categories={categories}
          categoryHeader={t('weekHeader')}
          caption={t('tableCaption', { metric: words.metricLabel(metric) })}
          hidden={off}
          words={trellisWords}
        />
      }
    />
  );
}
