'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { SHAPE_OPTIONS, useTrackedSet } from './data/use-competitor-reads';
import { leadsOf, type CompetitorLead, type LeadRead } from './model/lead-rule';
import { colorSlots } from './model/tracked-set';
import type { TrackedSet } from './model/types';
import { useCardPlatforms } from './parts/card-engine';
import { CompetitorDot } from './parts/competitor-bars';
import { frameSummary, useFrameState, type DataSituation, type FrameState } from './parts/frame-state';
import { loadingBodyHeight } from './skeletons';
import { useCardExport } from '../engines/use-card-seams';
import { useOpenCompetitor, type CompetitorLead as LeadKind } from '../../competitor-drawer/open-competitor';
import { useOverviewSummary } from '../../overview-context';
import { useScopeUnavailable } from '../../states/scope-unavailable';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import type { CardProps } from '@/features/layouts';
import { safeText, type CsvTable } from '@/lib/csv/csv-write';
import { formatInteger, formatList } from '@/lib/format';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/** The `rows` option (catalog 5 or 10, default 5): the competitors drawn in the card; the Table view holds them all. */
const ROW_OPTIONS = [5, 10] as const;
const DEFAULT_ROWS = 5;
const LOADING_HEIGHT = loadingBodyHeight('ai.lost_to_competitor');

function rowsOf(option: string | undefined): number {
  const rows = Number(option);
  return ROW_OPTIONS.find((candidate) => candidate === rows) ?? DEFAULT_ROWS;
}

function situationOf(read: LeadRead | null, set: TrackedSet | null): DataSituation {
  if (read === null || set === null) return { kind: 'ready' };
  if (read.status === 'unread') return { kind: 'no_answers' };
  if (!set.entities.some((entity) => entity.role === 'competitor')) return { kind: 'no_competitor' };
  return { kind: 'ready' };
}

/** The competitors that could be compared on a prompt, the ones that lead on most prompts first. */
const rowsFrom = (read: LeadRead | null): CompetitorLead[] =>
  read?.status === 'read'
    ? read.competitors
        .filter((lead) => lead.compared > 0)
        .sort((a, b) => b.they - a.they || a.entity.name.localeCompare(b.entity.name))
    : [];

/**
 * CH-05 and OV-GAP: for each competitor, the prompts where it leads and the prompts where you lead, over the
 * platforms of the page scope (no engine option). The rule is `leadsOf`: decided on each platform and combined
 * without pooling answers, the same counts the competitor drawer reads (R12). A name opens its drawer, a count opens it
 * on the prompts behind that count.
 */
export default function LostToCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.competitors.scopeGap');
  const platforms = useCardPlatforms();
  const open = useOpenCompetitor();
  const unavailable = useScopeUnavailable(t('title'));
  // One read: this card draws no comparison, so the previous window is not asked
  const summaryRead = useOverviewSummary({ ...SHAPE_OPTIONS['prompt-rows'], subscribed: live });
  const current = summaryRead.data;
  const set = useTrackedSet(current);
  const read: LeadRead | null =
    current !== undefined && set !== null && platforms.codes.length > 0 ? leadsOf(current, platforms.codes, set) : null;
  const base = useFrameState({
    subject: t('subject'),
    read: summaryRead,
    previous: null,
    previousEmpty: false,
    engine: null,
    situation: situationOf(read, set),
  });
  const all = rowsFrom(read);
  const frame: FrameState =
    platforms.codes.length === 0
      ? { status: 'empty', empty: unavailable }
      : read?.status === 'read' && all.length === 0 && (base.status === 'ready' || base.status === 'refetching')
        ? { status: 'empty', empty: { title: t('emptyTitle'), reason: t('emptyReason') } }
        : base;
  const limit = rowsOf(options.rows);
  const shown = all.slice(0, limit);
  const slots = set === null ? null : colorSlots(set);
  const tooFew = read?.status === 'read' ? read.tooFew : 0;

  const columns: PlainColumn<CompetitorLead>[] = [
    { id: 'name', header: t('competitor'), cell: (lead) => lead.entity.name },
    { id: 'they', header: t('theyLead'), cell: (lead) => formatInteger(lead.they) },
    { id: 'you', header: t('youLead'), cell: (lead) => formatInteger(lead.you) },
    { id: 'close', header: t('close'), cell: (lead) => formatInteger(lead.close) },
    { id: 'compared', header: t('compared'), cell: (lead) => formatInteger(lead.compared) },
  ];
  const csv: CsvTable = {
    header: columns.map((column) => safeText(column.header)),
    rows: all.map((lead) => [safeText(lead.entity.name), lead.they, lead.you, lead.close, lead.compared]),
  };
  useCardExport(item.id, () => {
    if (frame.status === 'loading' || frame.status === 'error') return null;
    return { id: item.id, header: csv.header, rows: csv.rows };
  });

  const countCell = (lead: CompetitorLead, kind: LeadKind, count: number, last: boolean): ReactElement => (
    <td className={last ? 'pr-4 pl-3 text-right num' : 'px-3 text-right num'}>
      <button
        type="button"
        aria-label={
          kind === 'they'
            ? t('theyLabel', { name: lead.entity.name, count, compared: lead.compared })
            : t('youLabel', { count, compared: lead.compared })
        }
        onClick={(event) => open(lead.entity.entityId, event.currentTarget, { lead: kind })}
        className="rounded-sm outline-none hover:underline focus-visible:focus-ring"
      >
        {t('count', { count, compared: lead.compared })}
      </button>
    </td>
  );
  const notes = [
    tooFew > 0 ? t('tooFewNote', { count: tooFew, min: MIN_OBSERVATIONS }) : null,
    all.length > shown.length ? t('moreRows', { count: all.length - shown.length }) : null,
  ].filter((note): note is string => note !== null);

  return (
    <ChartFrame
      kind="html"
      variant="panel"
      height={240}
      loadingHeight={LOADING_HEIGHT}
      title={t('title')}
      meta={read?.status === 'read' && all.length > 0 ? t('meta') : null}
      info={{ what: t('info.what'), how: t('info.how') }}
      summary={frameSummary(
        frame,
        t('summary', {
          list: formatList(
            shown
              .slice(0, 3)
              .map((lead) =>
                t('summaryRow', { name: lead.entity.name, they: lead.they, you: lead.you, compared: lead.compared }),
              ),
          ),
        }),
      )}
      footnote={
        notes.length === 0 ? undefined : (
          <>
            {notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </>
        )
      }
      body={
        <div className="-mx-4 overflow-x-auto">
          <table aria-label={t('caption')} className="w-full type-table">
            <thead>
              <tr className="h-row-header border-t border-border-subtle bg-surface-subtle">
                <th scope="col" className="pr-3 pl-4 text-left type-table-header whitespace-nowrap">
                  {t('competitor')}
                </th>
                <th scope="col" className="px-3 text-right type-table-header whitespace-nowrap">
                  {t('theyLead')}
                </th>
                <th scope="col" className="pr-4 pl-3 text-right type-table-header whitespace-nowrap">
                  {t('youLead')}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((lead) => (
                <tr key={lead.entity.entityId} className="h-row-compact border-t border-border-subtle">
                  <th scope="row" className="pr-3 pl-4 text-left font-normal whitespace-nowrap text-foreground">
                    <button
                      type="button"
                      aria-label={t('open', { name: lead.entity.name })}
                      onClick={(event) => open(lead.entity.entityId, event.currentTarget)}
                      className="inline-flex items-center gap-2 rounded-sm outline-none hover:underline focus-visible:focus-ring"
                    >
                      <CompetitorDot slot={slots?.get(lead.entity.entityId) ?? null} />
                      {lead.entity.name}
                    </button>
                  </th>
                  {countCell(lead, 'they', lead.they, false)}
                  {countCell(lead, 'you', lead.you, true)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
      table={
        <PlainTable<CompetitorLead>
          caption={t('caption')}
          columns={columns}
          rows={all}
          rowKey={(lead) => lead.entity.entityId}
          status="ready"
          errorState={null}
          emptyText={t('emptyTitle')}
        />
      }
      menu={{ fileName: t('fileName'), csv }}
      {...frame}
    />
  );
}
