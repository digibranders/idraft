'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useOverview } from '../../overview-context';
import { TopicCardFrame, useTopicEmpty, type TopicEmpty } from './card-frame';
import type { EngineValue } from './engine-values';
import { EXTREMES_EXPORT_HEADER, extremesFileName, extremesModel, type RankedTopic } from './extremes-model';
import { topicEngineHref } from './links';
import { CELL_OF, MIN_PROMPTS_TO_RANK, type TopicData, type TopicMetric } from './model-types';
import { countOf, metricOf } from './options';
import { TopicFootnote } from './topic-footnote';
import { leavesOf, overlapCount } from './topic-nodes';
import { exportCells } from './topic-rows';
import { useTopicSummary } from './use-topic-reads';
import { useTopicWords } from './use-topic-words';
import { BarList, type ComparisonRow } from '@/components/app/chart/bar-list';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import type { CardProps } from '@/features/layouts';
import { safeText, type CsvCell, type CsvTable } from '@/lib/csv/csv-write';
import { EMPTY_VALUE, formatList } from '@/lib/format';
import { MIN_OBSERVATIONS } from '@/lib/stats';

const GROUPS = ['strongest', 'weakest'] as const;
type Group = (typeof GROUPS)[number];

interface TableRow {
  id: string;
  engine: string;
  group: string;
  topic: string;
  value: string;
}

/** A rate is a count of answers unless the metric is share of voice or the count is not whole. */
const isCounted = (metric: TopicMetric, value: EngineValue): boolean =>
  metric !== 'share_of_voice' && value.successes !== null;

/** One row of the export: an unknown rate is an empty cell and its status says why, never 0. */
function exportRow(code: string, group: string, topic: string, value: EngineValue): CsvCell[] {
  const [rate, answers, status] = exportCells(value);
  return [code, group, safeText(topic), rate, answers, value.prompts, status];
}

/** Strongest and weakest topics of every asked engine (CH-41, `ai.topic_extremes`). */
export default function TopicExtremesCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.topics.extremes');
  const words = useTopicWords();
  const empties = useTopicEmpty();
  const { workspaceSlug, project } = useOverview();
  const read = useTopicSummary({ subscribed: live });
  // The leaf topics depend on the vocabulary tree: until it is read, rows would be ranked beside their parents
  const data: TopicData =
    read.tree.pending && (read.phase === 'ready' || read.phase === 'refetching') ? { ...read, phase: 'loading' } : read;
  const metric = metricOf(options.metric ?? '');
  const count = countOf(options.rows ?? '', 5);
  const { engines, scope } = data;
  const labels = engines.map((engine) => engine.label);

  const models = engines.map((engine) => ({
    engine,
    model: extremesModel(data.nodes, engine.code, CELL_OF[metric], count),
  }));

  const empty = ((): TopicEmpty | null => {
    if (leavesOf(data.nodes).length === 0) return empties.noTopics;
    return models.some(({ model }) => model.answered) ? null : empties.noAnswers(labels, scope.range.days);
  })();

  const groupLabel = (group: Group): string => t(group);
  const hrefOf = (code: string, entry: RankedTopic): Route | undefined =>
    topicEngineHref({ workspaceSlug, projectSlug: project.slug, scope }, entry.row.node.key, code) ?? undefined;

  const rowOf = (code: string, entry: RankedTopic): ComparisonRow => {
    const { value, row } = entry;
    const counted = isCounted(metric, value);
    const prompts = value.prompts ?? 0;
    const tip = words.cellTip(value, counted);
    return {
      id: `${code}:${row.node.key}`,
      label: row.node.name,
      own: false,
      value: {
        kind: 'value',
        value: value.value ?? 0,
        valueText: words.percent(value.value),
        contextText: counted
          ? t('context', { k: value.successes ?? 0, n: value.answers, prompts })
          : t('contextShare', { n: value.answers, prompts }),
      },
      accessibleText: `${row.node.name}: ${tip}`,
      tip,
      href: hrefOf(code, entry),
    };
  };

  const shown = models.flatMap(({ engine, model }) =>
    GROUPS.flatMap((group) => model[group].map((entry) => ({ engine, group, entry }))),
  );
  // One scale for every list of the card, so one percent is one length
  const max = Math.max(0, ...shown.map(({ entry }) => entry.value.value ?? 0));

  const tableRows: TableRow[] = shown.map(({ engine, group, entry }) => ({
    id: `${engine.code}:${group}:${entry.row.node.key}`,
    engine: engine.label,
    group: groupLabel(group),
    topic: entry.row.node.name,
    value: words.cellTip(entry.value, isCounted(metric, entry.value)),
  }));
  const headers = {
    engine: t('table.engine'),
    group: t('table.group'),
    topic: t('table.topic'),
    value: t('table.value'),
    context: t('table.context'),
  };
  const csv: CsvTable = {
    header: [headers.engine, headers.group, headers.topic, headers.value],
    rows: tableRows.map((row): CsvCell[] => [row.engine, row.group, safeText(row.topic), safeText(row.value)]),
  };
  const columns: PlainColumn<TableRow>[] = [
    { id: 'engine', header: headers.engine, cell: (row) => row.engine },
    { id: 'group', header: headers.group, cell: (row) => row.group },
    { id: 'topic', header: headers.topic, wrap: true, cell: (row) => row.topic },
    { id: 'value', header: headers.value, wrap: true, cell: (row) => row.value },
  ];

  const exportRows = (): CsvCell[][] =>
    models.flatMap(({ engine, model }) => [
      ...GROUPS.flatMap((group) =>
        model[group].map((entry) => exportRow(engine.code, group, entry.row.node.name, entry.value)),
      ),
      ...model.unranked.flatMap((row) => {
        const [value] = row.values;
        return value === undefined ? [] : [exportRow(engine.code, 'not_ranked', row.node.name, value)];
      }),
    ]);

  return (
    <TopicCardFrame
      cardKey="ai.topic_extremes"
      title={t('title')}
      meta={words.window(scope.range)}
      summary={t('summary', { metric: words.metricLabel(metric), engines: formatList(labels) })}
      data={data}
      empty={empty}
      partialEngines={models.filter(({ model }) => model.rated === 0).map(({ engine }) => engine.label)}
      footnote={
        <TopicFootnote
          overlapPrompts={data.promptsRead ? overlapCount(data.prompts, data.nodes) : null}
          pooled={false}
          weighting="prompt"
          extra={
            <>
              <span>{t('ranking', { answers: MIN_OBSERVATIONS, prompts: MIN_PROMPTS_TO_RANK })}</span>
              {models
                .filter(({ model }) => model.notRanked > 0)
                .map(({ engine, model }) => (
                  <span key={engine.code}> {t('notRanked', { engine: engine.label, count: model.notRanked })}</span>
                ))}
            </>
          }
        />
      }
      menu={{ fileName: extremesFileName(metric), csv }}
      exportBlock={{
        id: item.id,
        build: () => ({
          id: item.id,
          header: EXTREMES_EXPORT_HEADER,
          rows: exportRows(),
        }),
      }}
      body={
        <div className="@container flex flex-col gap-5">
          {models.map(({ engine, model }) => (
            <div key={engine.code} className="flex flex-col gap-2">
              <h3 className="type-body-strong">
                <EngineLogo engine={engine.code} name={engine.label} />
              </h3>
              {model.strongest.length === 0 && model.weakest.length === 0 ? (
                <p className="type-meta">
                  {t('noneRanked', { engine: engine.label, answers: MIN_OBSERVATIONS, prompts: MIN_PROMPTS_TO_RANK })}
                </p>
              ) : (
                <div className="grid gap-4 @lg:grid-cols-2">
                  {GROUPS.map((group) => (
                    <div key={group} className="flex min-w-0 flex-col gap-1">
                      <h4 className="type-meta">{groupLabel(group)}</h4>
                      {model[group].length === 0 ? (
                        <p className="type-meta">
                          {group === 'strongest' ? t('noStrongest', { engine: engine.label }) : t('noWeakest')}
                        </p>
                      ) : (
                        <BarList
                          mode="comparison"
                          caption={t('listCaption', {
                            group: groupLabel(group),
                            engine: engine.label,
                            metric: words.metricLabel(metric),
                          })}
                          labelHeader={headers.topic}
                          valueHeader={headers.value}
                          contextHeader={headers.context}
                          rows={model[group].map((entry) => rowOf(engine.code, entry))}
                          max={max}
                          limit={count}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      }
      table={
        <PlainTable<TableRow>
          caption={t('tableCaption')}
          columns={columns}
          rows={tableRows}
          rowKey={(row) => row.id}
          status="ready"
          errorState={null}
          emptyText={EMPTY_VALUE}
        />
      }
    />
  );
}
