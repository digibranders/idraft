'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { SHAPE_OPTIONS, useTrackedSet } from './data/use-competitor-reads';
import { shareAcrossPlatforms, type ScopeShareRead } from './model/scope-share';
import { colorSlots } from './model/tracked-set';
import { unreadWhy, type TrackedSet } from './model/types';
import { useCardPlatforms } from './parts/card-engine';
import { CompetitorBars, type CompetitorBarRow } from './parts/competitor-bars';
import { frameSummary, useFrameState, type DataSituation, type FrameState } from './parts/frame-state';
import { TrackedFootnote } from './parts/tracked-footnote';
import { loadingBodyHeight } from './skeletons';
import { useCardExport } from '../engines/use-card-seams';
import { useOpenCompetitor } from '../../competitor-drawer/open-competitor';
import { useOverviewSummary } from '../../overview-context';
import { useScopeUnavailable } from '../../states/scope-unavailable';
import { BarListTable, barListCsv, type BarListProps, type ComparisonRow } from '@/components/app/chart/bar-list';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import type { CardProps } from '@/features/layouts';
import { formatList, formatPercent } from '@/lib/format';
import { engineLabel } from '@/lib/layouts';

/** The `rows` option: the brands drawn before the own brand is added (catalog 5 or 10, default 10). */
const ROW_OPTIONS = [5, 10] as const;
const DEFAULT_ROWS = 10;
const LOADING_HEIGHT = loadingBodyHeight('ai.share_of_voice');

function rowsOf(option: string | undefined): number {
  const rows = Number(option);
  return ROW_OPTIONS.find((candidate) => candidate === rows) ?? DEFAULT_ROWS;
}

/** What the answers say, once read: the first of these that holds, so nothing is drawn from too little. */
function situationOf(read: ScopeShareRead | null, set: TrackedSet | null): DataSituation {
  if (read === null || set === null) return { kind: 'ready' };
  if (read.status === 'unread' || read.validAnswers === 0) return { kind: 'no_answers' };
  if (!set.entities.some((entity) => entity.role === 'competitor')) return { kind: 'no_competitor' };
  return { kind: 'ready' };
}

/**
 * CH-02 and OV-SOV: the tracked brands ranked by share of voice over the platforms of the page scope, you in
 * `chart-1`. One platform is its own shares; All platforms is the equal-weight average of the platforms that have a
 * share, said in the meta line ("avg of 3 platforms"), never a ratio of pooled counts (R3). A competitor's name opens
 * its drawer. A share is over the answers that mention a tracked brand, and that count is in every tooltip (R1).
 */
export default function ShareOfVoiceCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.competitors.scopeShare');
  const insufficient = useTranslations('common.insufficient');
  const platforms = useCardPlatforms();
  const open = useOpenCompetitor();
  const unavailable = useScopeUnavailable(t('title'));
  // One read: this card draws no change, so the previous period is not asked
  const summaryRead = useOverviewSummary({ ...SHAPE_OPTIONS.totals, subscribed: live });
  const current = summaryRead.data;
  const set = useTrackedSet(current);
  const share: ScopeShareRead | null =
    current !== undefined && set !== null && platforms.codes.length > 0
      ? shareAcrossPlatforms(current, platforms.codes, set, platforms.average)
      : null;
  const base = useFrameState({
    subject: t('subject'),
    read: summaryRead,
    previous: null,
    previousEmpty: false,
    engine: null,
    situation: situationOf(share, set),
  });
  const tooFew = share?.status === 'read' && share.state !== 'ok';
  const frame: FrameState =
    platforms.codes.length === 0
      ? { status: 'empty', empty: unavailable }
      : share?.status === 'unread' &&
          (base.status === 'ready' || base.status === 'refetching' || base.status === 'empty')
        ? // No counts to read a share from: not collected, or more than 20 tracked brands (backend request 24)
          {
            status: 'empty',
            empty: {
              title: t(`${unreadWhy(share)}.title`),
              reason: t(`${unreadWhy(share)}.reason`),
            },
          }
        : tooFew && (base.status === 'ready' || base.status === 'refetching')
          ? { status: 'empty', empty: { title: t('emptyTitle'), reason: t('emptyReason') } }
          : base;

  const read = share?.status === 'read' && share.state === 'ok' ? share : null;
  const slots = set === null ? null : colorSlots(set);
  const tableRows: ComparisonRow[] = (read === null ? [] : [...read.entities])
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
    .map((entry): ComparisonRow => {
      const label = entry.entity.role === 'own' ? t('you', { name: entry.entity.name }) : entry.entity.name;
      const base = { id: entry.entity.entityId, label, own: entry.entity.role === 'own' };
      if (entry.value === null) {
        return { ...base, value: { kind: 'none' }, accessibleText: t('rowTextUnknown', { name: label }) };
      }
      const value = formatPercent(entry.value, { decimals: 0 });
      return {
        ...base,
        // One platform: x of y brand mentions beside the percent (D17). An average has no pooled count: its tip has each platform's
        value: {
          kind: 'value',
          value: entry.value,
          valueText: value,
          contextText:
            platforms.average || entry.counts[0] === undefined
              ? null
              : t('ofBrandMentions', { k: entry.counts[0].k, n: entry.counts[0].n }),
        },
        accessibleText: t('rowText', { name: label, value }),
        // x of y brand mentions of each platform (D17); an average has no pooled count beside it
        tip: platforms.average
          ? t('rowTipAverage', {
              name: entry.entity.name,
              value,
              count: read?.used.length ?? 0,
              counts: formatList(
                entry.counts.map((each) =>
                  t('platformCount', { platform: engineLabel(each.code), k: each.k, n: each.n }),
                ),
              ),
            })
          : t('rowTipOne', {
              name: entry.entity.name,
              value,
              k: entry.counts[0]?.k ?? 0,
              n: entry.counts[0]?.n ?? 0,
            }),
      };
    });
  const notes = new Map<string, string>();
  if (read !== null && !platforms.average) {
    for (const entry of read.entities) {
      const counts = entry.counts[0];
      if (entry.value !== null && counts !== undefined) {
        notes.set(entry.entity.entityId, t('noteOf', { k: counts.k, n: counts.n }));
      }
    }
  }
  const limit = rowsOf(options.rows);
  const shown = tableRows.filter((row, index) => index < limit || row.own);
  const bars: CompetitorBarRow[] = shown.map((row) => ({
    id: row.id,
    label: row.label,
    own: row.own,
    value: row.value.kind === 'value' ? row.value.value : null,
    valueText: row.value.kind === 'value' ? row.value.valueText : t('unknownValue'),
    // "29 of 65" beside the percent for one platform; the meta line above says what the 65 is. An average has none
    note: notes.get(row.id) ?? null,
    slot: slots?.get(row.id) ?? null,
    tip: row.tip ?? row.accessibleText,
    openLabel: t('open', { name: row.label }),
  }));

  const tableProps: BarListProps = {
    mode: 'comparison',
    rows: tableRows,
    caption: t('caption'),
    labelHeader: t('labelHeader'),
    valueHeader: t('valueHeader'),
    contextHeader: t('contextHeader'),
  };
  const csv = barListCsv(tableProps, (count) => insufficient('answers', { count }));
  useCardExport(item.id, () => {
    if (frame.status === 'loading' || frame.status === 'error') return null;
    return {
      id: item.id,
      header: [...csv.header, t('statusHeader')],
      rows: csv.rows.map((row, index) => [
        ...row,
        tableRows[index]?.value.kind === 'value' ? t('statusRead') : t('statusUnknown'),
      ]),
    };
  });

  const leaders = formatList(
    tableRows.slice(0, 3).map((row) => `${row.label} ${row.value.kind === 'value' ? row.value.valueText : ''}`.trim()),
  );
  const hidden = tableRows.length - shown.length;
  return (
    <ChartFrame
      kind="html"
      keepHeaderWhenEmpty
      variant="panel"
      height={240}
      loadingHeight={LOADING_HEIGHT}
      title={t('title')}
      meta={
        read === null
          ? null
          : platforms.average
            ? t('metaAverage', { count: read.used.length })
            : t('metaOne', { count: read.answers })
      }
      info={{ what: t('info.what'), how: t('info.how') }}
      summary={frameSummary(frame, t('summary', { list: leaders }))}
      footnote={
        set === null ? undefined : (
          <>
            <TrackedFootnote set={set} />
            {hidden > 0 ? <p>{t('moreRows', { count: hidden })}</p> : null}
          </>
        )
      }
      body={<CompetitorBars rows={bars} caption={t('caption')} onOpen={open} />}
      table={<BarListTable {...tableProps} />}
      menu={{ fileName: t('fileName'), csv }}
      {...frame}
    />
  );
}
