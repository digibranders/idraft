'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { assistantName, sessionsOf, valueChange, type ReferralRow } from './referrals-model';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import type { CsvCell, CsvTable } from '@/lib/csv/csv-write';
import { safeText } from '@/lib/csv/csv-write';
import { formatInteger, formatMetricDelta, formatSignedInteger } from '@/lib/format';

/** The engaged visits of a value; unknown stays unknown. */
const engagedOf = (value: ReferralRow['own_rules']): number | null => (value === null ? null : value.engaged_sessions);

/** The change against the compared period as the bars write it; "n/a" when either count is unknown, never 0. */
function changeText(value: ReferralRow['own_rules']): string {
  const input = valueChange(value);
  return input === null ? formatInteger(null) : formatMetricDelta(input).text;
}

interface ReferralHeaders {
  platform: string;
  ownVisits: string;
  ownChange: string;
  ga4Visits: string;
  ga4Change: string;
  difference: string;
  ownEngaged: string;
  ga4Engaged: string;
}

/** The headers of the Table view and the CSV, from the card's messages. */
export function useReferralHeaders(): ReferralHeaders {
  const t = useTranslations('aiOverview.sourcesTracking.referrals.headers');
  return {
    platform: t('platform'),
    ownVisits: t('ownVisits'),
    ownChange: t('ownChange'),
    ga4Visits: t('ga4Visits'),
    ga4Change: t('ga4Change'),
    difference: t('difference'),
    ownEngaged: t('ownEngaged'),
    ga4Engaged: t('ga4Engaged'),
  };
}

const number = (text: string): ReactElement => <span className="num">{text}</span>;

/**
 * The Table view of the card: every platform the answer lists, with the visits, the change against the compared period
 * and the engaged visits of both ways of counting, and the difference between them, so neither is hidden by the one
 * the bars draw. A count the API does not give is "n/a", never 0.
 */
export function ReferralsTable({ rows, caption }: { rows: readonly ReferralRow[]; caption: string }): ReactElement {
  const headers = useReferralHeaders();
  const columns: PlainColumn<ReferralRow>[] = [
    { id: 'platform', header: headers.platform, cell: (row) => assistantName(row.key) },
    { id: 'own', header: headers.ownVisits, cell: (row) => number(formatInteger(sessionsOf(row.own_rules))) },
    { id: 'ownChange', header: headers.ownChange, cell: (row) => number(changeText(row.own_rules)) },
    {
      id: 'ga4',
      header: headers.ga4Visits,
      cell: (row) => number(formatInteger(sessionsOf(row.ga4_ai_assistant_channel))),
    },
    { id: 'ga4Change', header: headers.ga4Change, cell: (row) => number(changeText(row.ga4_ai_assistant_channel)) },
    { id: 'difference', header: headers.difference, cell: (row) => number(formatSignedInteger(row.difference)) },
    { id: 'ownEngaged', header: headers.ownEngaged, cell: (row) => number(formatInteger(engagedOf(row.own_rules))) },
    {
      id: 'ga4Engaged',
      header: headers.ga4Engaged,
      cell: (row) => number(formatInteger(engagedOf(row.ga4_ai_assistant_channel))),
    },
  ];
  return (
    <PlainTable<ReferralRow>
      caption={caption}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.key}
      status="ready"
      errorState={null}
      emptyText={formatInteger(null)}
    />
  );
}

/** The same table as a CSV: numbers as numbers, an unknown count or change as an empty cell. */
export function referralsCsv(rows: readonly ReferralRow[], headers: ReferralHeaders): CsvTable {
  const cell = (value: number | null): CsvCell => value;
  return {
    header: [
      headers.platform,
      headers.ownVisits,
      headers.ownChange,
      headers.ga4Visits,
      headers.ga4Change,
      headers.difference,
      headers.ownEngaged,
      headers.ga4Engaged,
    ].map(safeText),
    rows: rows.map((row) => [
      safeText(assistantName(row.key)),
      cell(sessionsOf(row.own_rules)),
      cell(valueChange(row.own_rules)?.value ?? null),
      cell(sessionsOf(row.ga4_ai_assistant_channel)),
      cell(valueChange(row.ga4_ai_assistant_channel)?.value ?? null),
      cell(row.difference),
      cell(engagedOf(row.own_rules)),
      cell(engagedOf(row.ga4_ai_assistant_channel)),
    ]),
  };
}
