'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { UnavailablePlatform } from './heatmap-model';
import type { Reading, VersusRow } from './group-versus-model';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Tooltip } from '@/components/ui/tooltip';
import { EMPTY_VALUE, formatPercent, formatPointsDelta } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The fill of each platform's bar, in the fixed order of the platforms (14-badges-status.md section 4); the average is neutral. */
const FILL: Readonly<Record<string, string>> = {
  chatgpt_web: 'bg-chart-1',
  gemini_web: 'bg-chart-2',
  google_ai_mode: 'bg-chart-3',
};
const FILL_AVERAGE = 'bg-chart-other';
const FILL_OTHER = 'bg-chart-bar-neutral';

export interface GroupVersusProps {
  rows: readonly VersusRow[];
  /** Platforms the API does not collect yet: a row that says so, in the place of the platform. */
  unavailable: readonly UnavailablePlatform[];
  /** Whether a rate is a count of answers (not share of voice), which decides how its counts are worded. */
  counted: boolean;
}

const percent = (value: number): string => formatPercent(value, { decimals: 0 });

/**
 * The chosen group against all groups (OV-GRP-12), one block per platform and the average: the group's rate and a bar
 * for it, a tick for the rate of all groups on the same scale, and a note with the gap in points. A platform with fewer
 * than 4 valid answers in the group has no rate and no bar (R2); the counts of each rate are in its tooltip and in
 * text for screen readers (R1).
 */
function useVersusText(counted: boolean): {
  ownText: (reading: Reading) => string;
  noteOf: (row: VersusRow) => { note: string; against: string };
} {
  const t = useTranslations('aiOverview.topics.groups.versus');
  const countsOf = (reading: Reading): string => {
    if (reading.used !== null) return t('averageCounts', { count: reading.used });
    return counted && reading.successes !== null
      ? t('ownAnswers', { successes: reading.successes, answers: reading.answers })
      : t('ownAnswersOnly', { answers: reading.answers });
  };
  const ownText = (reading: Reading): string =>
    reading.value === null ? t('tipNone') : t('tipValue', { rate: percent(reading.value), counts: countsOf(reading) });

  const noteOf = (row: VersusRow): { note: string; against: string } => {
    const { all, gap } = row;
    if (all.value === null) return { note: t('againstNone'), against: t('againstNone') };
    const rate = percent(all.value);
    const against =
      gap === null || gap === 0
        ? t('against', { rate })
        : t('againstGap', { rate, gap: formatPointsDelta(gap / 100, { decimals: 0 }) });
    return { note: row.group.value === null ? t('tooFew') : against, against };
  };
  return { ownText, noteOf };
}

export function GroupVersus({ rows, unavailable, counted }: GroupVersusProps): ReactElement {
  const t = useTranslations('aiOverview.topics.groups.versus');
  const { ownText, noteOf } = useVersusText(counted);

  // One scale for every row, so the bars and the ticks can be compared
  const top = Math.max(0.01, ...rows.flatMap((row) => [row.group.value ?? 0, row.all.value ?? 0])) * 1.1;
  // The platforms in their order, then the ones not collected, then the average
  const items = [
    ...rows.filter((row) => !row.average).map((row) => ({ kind: 'platform' as const, row })),
    ...unavailable.map((platform) => ({ kind: 'unavailable' as const, platform })),
    ...rows.filter((row) => row.average).map((row) => ({ kind: 'platform' as const, row })),
  ];

  return (
    <ul className="flex flex-col gap-3 pt-1">
      {items.map((item) => {
        if (item.kind === 'unavailable') {
          return (
            <li key={item.platform.code} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="type-body text-foreground-secondary">{item.platform.label}</span>
                <span className="num type-body-strong text-foreground-tertiary">{t('valueNone')}</span>
              </div>
              <span className="type-micro text-foreground-tertiary">{t('notCollected')}</span>
            </li>
          );
        }
        const { row } = item;
        const { note, against } = noteOf(row);
        const label = row.average ? t('average') : row.label;
        const tip = t('tip', { label, value: ownText(row.group), against });
        const fill = row.average ? FILL_AVERAGE : (FILL[row.id] ?? FILL_OTHER);
        return (
          <li key={row.id} className="flex flex-col gap-1">
            <Tooltip content={tip} purpose="label">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate type-body text-foreground-secondary">{label}</span>
                <span
                  className={cn(
                    'num type-body-strong',
                    row.group.value === null ? 'text-foreground-tertiary' : 'text-foreground',
                  )}
                >
                  {row.group.value === null ? t('valueNone') : percent(row.group.value)}
                </span>
              </div>
            </Tooltip>
            {/* The bar is the group; the tick is all groups */}
            <div className="relative h-2" aria-hidden="true">
              {row.group.value === null ? null : (
                <div
                  className={cn('h-2 rounded-2xs', fill)}
                  style={{ width: `${String(Math.max(1, (row.group.value / top) * 100))}%` }}
                />
              )}
              {row.all.value === null ? null : (
                <div
                  className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-foreground"
                  style={{ left: `${String((row.all.value / top) * 100)}%` }}
                />
              )}
            </div>
            <span className="num type-micro text-foreground-tertiary">{note}</span>
            <span className="sr-only">{`${label}: ${row.group.value === null ? EMPTY_VALUE : ownText(row.group)}`}</span>
          </li>
        );
      })}
    </ul>
  );
}

interface TableRow {
  id: string;
  platform: string;
  group: string;
  all: string;
}

/** The Table view of the same numbers: the group's rate and the rate of all groups, each with its counts. */
export function GroupVersusTable({
  group,
  rows,
  unavailable,
  counted,
}: GroupVersusProps & { group: string }): ReactElement {
  const t = useTranslations('aiOverview.topics.groups.versus');
  const { ownText } = useVersusText(counted);
  const notCollected = t('notCollected');
  const tableRows: TableRow[] = [
    ...rows
      .filter((row) => !row.average)
      .map((row) => ({ id: row.id, platform: row.label, group: ownText(row.group), all: ownText(row.all) })),
    ...unavailable.map((platform) => ({
      id: platform.code,
      platform: platform.label,
      group: notCollected,
      all: notCollected,
    })),
    ...rows
      .filter((row) => row.average)
      .map((row) => ({ id: row.id, platform: t('average'), group: ownText(row.group), all: ownText(row.all) })),
  ];
  const columns: PlainColumn<TableRow>[] = [
    { id: 'platform', header: t('tablePlatform'), cell: (row) => row.platform },
    { id: 'group', header: t('tableThis'), wrap: true, cell: (row) => row.group },
    { id: 'all', header: t('tableAll'), wrap: true, cell: (row) => row.all },
  ];
  return (
    <PlainTable<TableRow>
      caption={t('tableCaption', { group })}
      columns={columns}
      rows={tableRows}
      rowKey={(row) => row.id}
      status="ready"
      errorState={null}
      emptyText={EMPTY_VALUE}
    />
  );
}
