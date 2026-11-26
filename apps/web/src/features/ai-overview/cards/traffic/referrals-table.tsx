'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { assistantName, sessionsOf, type ReferralRow } from './referrals-model';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import type { CsvCell, CsvTable } from '@/lib/csv/csv-write';
import { safeText } from '@/lib/csv/csv-write';
import { formatInteger, formatSignedInteger } from '@/lib/format';

/** The engaged visits of a value; unknown stays unknown. */
const engagedOf = (value: ReferralRow['own_rules']): number | null => (value === null ? null : value.engaged_sessions);

/** The difference between the two ways of counting, `null` when either count is unknown. */
const differenceOf = (row: ReferralRow): number | null => row.difference;

interface ReferralHeaders {
  platform: string;
  ownVisits: string;
  ga4Visits: string;
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
    ga4Visits: t('ga4Visits'),
    difference: t('difference'),
    ownEngaged: t('ownEngaged'),
    ga4Engaged: t('ga4Engaged'),
  };
}

/**
 * The Table view of the card: every platform the answer lists, with the visits and the engaged visits of both ways of
 * counting and the difference between them, so neither is hidden by the one the bars draw. A count the API does not
 * give is "n/a", never 0.
 */
export function ReferralsTable({ rows, caption }: { rows: readonly ReferralRow[]; caption: string }): ReactElement {
  const headers = useReferralHeaders();
  const columns: PlainColumn<ReferralRow>[] = [
    { id: 'platform', header: headers.platform, cell: (row) => assistantName(row.key) },
    {
      id: 'own',
      header: headers.ownVisits,
      cell: (row) => <span className="num">{formatInteger(sessionsOf(row.own_rules))}</span>,
    },
    {
      id: 'ga4',
      header: headers.ga4Visits,
      cell: (row) => <span className="num">{formatInteger(sessionsOf(row.ga4_ai_assistant_channel))}</span>,
    },
    {
      id: 'difference',
      header: headers.difference,
      cell: (row) => <span className="num">{formatSignedInteger(differenceOf(row))}</span>,
    },
    {
      id: 'ownEngaged',
      header: headers.ownEngaged,
      cell: (row) => <span className="num">{formatInteger(engagedOf(row.own_rules))}</span>,
    },
    {
      id: 'ga4Engaged',
      header: headers.ga4Engaged,
      cell: (row) => <span className="num">{formatInteger(engagedOf(row.ga4_ai_assistant_channel))}</span>,
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

/** The same table as a CSV: numbers as numbers, an unknown count as an empty cell. */
export function referralsCsv(rows: readonly ReferralRow[], headers: ReferralHeaders): CsvTable {
  const cell = (value: number | null): CsvCell => value;
  return {
    header: [
      headers.platform,
      headers.ownVisits,
      headers.ga4Visits,
      headers.difference,
      headers.ownEngaged,
      headers.ga4Engaged,
    ].map(safeText),
    rows: rows.map((row) => [
      safeText(assistantName(row.key)),
      cell(sessionsOf(row.own_rules)),
      cell(sessionsOf(row.ga4_ai_assistant_channel)),
      cell(differenceOf(row)),
      cell(engagedOf(row.own_rules)),
      cell(engagedOf(row.ga4_ai_assistant_channel)),
    ]),
  };
}
