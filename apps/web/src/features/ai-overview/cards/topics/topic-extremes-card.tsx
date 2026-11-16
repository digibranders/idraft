'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { TopicCardFrame, useTopicEmpty, type TopicEmpty } from './card-frame';
import {
  EXTREMES_EXPORT_HEADER,
  MIN_GROUPS_TO_RANK,
  extremesExportRow,
  extremesFileName,
  extremesOf,
  type RankedGroup,
} from './extremes-model';
import { groupRows, isCountedMeasure } from './group-rows';
import { GroupVersus, GroupVersusTable } from './group-versus';
import { groupNames } from './heatmap-model';
import type { TopicData } from './model-types';
import { TopicFootnote } from './topic-footnote';
import { useGroupVersus } from './use-group-versus';
import { useChosenGroup } from './use-group-name';
import { useAllGroupsSummary } from './use-topic-reads';
import { useOverview } from '../../overview-context';
import { BarList, type ComparisonRow } from '@/components/app/chart/bar-list';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import type { CardProps } from '@/features/layouts';
import { safeText, type CsvCell, type CsvTable } from '@/lib/csv/csv-write';
import { EMPTY_VALUE, formatList, formatPercent } from '@/lib/format';

/**
 * The card of the `ai.topic_extremes` key: the strongest and weakest groups for All groups, and the chosen group
 * against all groups when the page has one (OV-GRP-12, OV-OPEN-16). The second is part of this card and is not a
 * catalog key of its own: a layout that hides this card hides it too.
 */
export default function TopicExtremesCard(props: CardProps): ReactElement {
  const { scope } = useOverview();
  return scope.topic === null ? <GroupExtremes {...props} /> : <GroupAgainstAll {...props} />;
}

interface TableRow {
  id: string;
  group: string;
  side: string;
  value: string;
}

/** A rate as the cards of the groups print it: a whole percent; an unknown rate is n/a, never 0%. */
const percent = (value: number | null): string =>
  value === null ? EMPTY_VALUE : formatPercent(value, { decimals: 0 });

/** Strongest and weakest groups (OV-GRP-13, `ai.topic_extremes`), by the average over the platforms. */
function GroupExtremes({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.topics.groups');
  const heat = useTranslations('aiOverview.topics.heatmap');
  const common = useTranslations('aiOverview.topics.common');
  const empties = useTopicEmpty();
  const { scope } = useOverview();
  const read = useAllGroupsSummary({ subscribed: live });
  // The groups depend on the vocabulary tree: until it is read, rows would be ranked beside their parents
  const data: TopicData =
    read.tree.pending && (read.phase === 'ready' || read.phase === 'refetching') ? { ...read, phase: 'loading' } : read;
  const measure = scope.metric;
  const measureLabel = t(`measure.${measure}`);
  const { nodes, engines } = data;
  const rows = useMemo(
    () =>
      groupRows(
        nodes,
        engines.map((engine) => engine.code),
        measure,
      ),
    [nodes, engines, measure],
  );
  const extremes = useMemo(() => extremesOf(rows), [rows]);
  const names = useMemo(() => groupNames(rows.map((row) => row.node)), [rows]);
  const nameOf = (entry: RankedGroup): string => names.get(entry.row.node.key) ?? entry.row.node.name;
  const answered = rows.some((row) => row.values.some((value) => value.state !== 'none'));

  const title = t('extremes.title');
  const empty = ((): TopicEmpty | null => {
    if (rows.length === 0) return empties.noTopics;
    if (!answered) {
      return empties.noAnswers(
        engines.map((engine) => engine.label),
        scope.range.days,
      );
    }
    return extremes.enough
      ? null
      : { title: t('extremes.notEnoughTitle'), reason: t('extremes.notEnoughReason'), action: null };
  })();

  const sides = [
    { id: 'strongest', label: t('extremes.strongest'), own: true, entries: extremes.strongest },
    { id: 'weakest', label: t('extremes.weakest'), own: false, entries: extremes.weakest },
  ] as const;
  // One scale for both lists, so one percent is one length
  const max = Math.max(0, ...extremes.strongest.map((entry) => entry.value));

  const tipOf = (entry: RankedGroup): string => {
    const taking = entry.row.values.filter((value) => value.state === 'ok');
    const labelOf = (code: string): string => engines.find((engine) => engine.code === code)?.label ?? code;
    // The answers behind each platform's rate, so the average is never read as a rate of pooled answers (R1)
    const counts = taking.map((value) =>
      heat('engineCount', {
        engine: labelOf(value.code),
        count:
          value.successes !== null && isCountedMeasure(measure)
            ? heat('countOf', { successes: value.successes, answers: value.answers })
            : common('answerCount', { count: value.answers }),
      }),
    );
    return t('extremes.tip', {
      group: nameOf(entry),
      percent: percent(entry.value),
      platforms: formatList(taking.map((value) => labelOf(value.code))),
      counts: formatList(counts),
    });
  };
  const rowOf = (entry: RankedGroup, own: boolean): ComparisonRow => {
    const name = nameOf(entry);
    const tip = tipOf(entry);
    return {
      id: entry.row.node.key,
      label: name,
      own,
      value: {
        kind: 'value',
        value: entry.value,
        valueText: percent(entry.value),
        contextText: t('extremes.context', { count: entry.row.node.promptCount }),
      },
      accessibleText: tip,
      tip,
    };
  };

  const tableRows: TableRow[] = sides.flatMap((side) =>
    side.entries.map((entry) => ({
      id: `${side.id}:${entry.row.node.key}`,
      group: nameOf(entry),
      side: side.label,
      value: tipOf(entry),
    })),
  );
  const columns: PlainColumn<TableRow>[] = [
    { id: 'group', header: t('extremes.tableGroup'), wrap: true, cell: (row) => row.group },
    { id: 'side', header: t('extremes.tableSide'), cell: (row) => row.side },
    { id: 'value', header: t('extremes.tableValue'), wrap: true, cell: (row) => row.value },
  ];
  const csv: CsvTable = {
    header: columns.map((column) => column.header),
    rows: tableRows.map((row): CsvCell[] => [safeText(row.group), row.side, safeText(row.value)]),
  };

  return (
    <TopicCardFrame
      cardKey="ai.topic_extremes"
      title={title}
      meta={data.summary === undefined ? null : t('extremes.meta', { measure: measureLabel })}
      summary={t('extremes.summary', { measure: measureLabel })}
      data={data}
      empty={empty}
      partialEngines={[]}
      info={{ what: t('info.extremes.what'), how: t('info.extremes.how') }}
      footnote={
        <TopicFootnote
          overlapPrompts={null}
          pooled={false}
          weighting="prompt"
          extra={t('extremes.ranking', { min: MIN_GROUPS_TO_RANK })}
        />
      }
      menu={{ fileName: extremesFileName(measure), csv }}
      exportBlock={{
        id: item.id,
        build: () => ({
          id: item.id,
          header: EXTREMES_EXPORT_HEADER,
          rows: extremes.all.map(extremesExportRow),
        }),
      }}
      body={
        <div className="@container flex flex-col gap-4">
          {sides.map((side) => (
            <div key={side.id} className="flex min-w-0 flex-col gap-1">
              <h3 className="type-label text-foreground-secondary">{side.label}</h3>
              <BarList
                mode="comparison"
                caption={t('extremes.listCaption', { side: side.label, measure: measureLabel })}
                labelHeader={t('extremes.tableGroup')}
                valueHeader={t('extremes.tableValue')}
                contextHeader={t('extremes.context', { count: 2 })}
                rows={side.entries.map((entry) => rowOf(entry, side.own))}
                max={max}
                limit={side.entries.length}
              />
            </div>
          ))}
        </div>
      }
      table={
        <PlainTable<TableRow>
          caption={t('extremes.tableCaption')}
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

/** The chosen group against all groups, in the slot of the extremes (OV-GRP-12). */
function GroupAgainstAll({ live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.topics.groups');
  const { scope } = useOverview();
  const versus = useGroupVersus(live);
  const chosen = useChosenGroup();
  const group = chosen.name ?? '';
  const measureLabel = t(`measure.${scope.metric}`);
  return (
    <TopicCardFrame
      cardKey="ai.topic_extremes"
      title={chosen.pending ? t('versus.titleLoading') : t('versus.title', { group })}
      meta={versus.data.summary === undefined ? null : t('versus.meta', { measure: measureLabel })}
      summary={t('versus.summary', { group, measure: measureLabel })}
      data={versus.data}
      empty={null}
      partialEngines={[]}
      info={{ what: t('info.versus.what'), how: t('info.versus.how') }}
      footnote={<TopicFootnote overlapPrompts={null} pooled={false} weighting="prompt" />}
      body={
        <GroupVersus
          group={group}
          rows={versus.rows}
          unavailable={versus.unavailable}
          counted={isCountedMeasure(scope.metric)}
        />
      }
      table={
        <GroupVersusTable
          group={group}
          rows={versus.rows}
          unavailable={versus.unavailable}
          counted={isCountedMeasure(scope.metric)}
        />
      }
    />
  );
}
