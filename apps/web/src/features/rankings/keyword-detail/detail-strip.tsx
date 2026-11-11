'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { aioHistoryQuery } from './detail-queries';
import { detailStateOf } from './detail-state';
import { useDetailUrlState } from './detail-url-state';
import { windowDates } from './detail-window';
import { stripCells, type StripCells } from './strip-model';
import { usePageRankHistory } from './use-page-rank-history';
import { volumeStripItem } from '../keyword-inspector/demand-section';
import type { KeywordDetail, KeywordScope } from '../keyword-inspector/inspector-queries';
import { SectionError } from '../keyword-inspector/section-error';
import { RankChangeView } from '../rank-cells';
import { MetricStrip, type MetricStripGroup, type MetricStripItem } from '@/components/app/metric/metric-strip';
import {
  formatDecimal,
  formatInteger,
  formatIsoDate,
  formatRankCell,
  formatTableDate,
  formatTableDateTime,
  type AioDisplay,
} from '@/lib/format';

export interface DetailStripProps {
  scope: KeywordScope;
  detail: KeywordDetail;
  /** The project's time zone, for the days of the window and the times of the checks. */
  timeZone: string;
}

type StripTranslate = ReturnType<typeof useTranslations<'keywordDetail.strip'>>;
type AioTranslate = ReturnType<typeof useTranslations<'rankings.aio'>>;

/** A figure that is not there, in the strip's one word for it. */
const unavailable = (id: string, label: string, t: StripTranslate, context?: string): MetricStripItem => ({
  id,
  label,
  value: t('unavailable'),
  unknown: { kind: 'not-applicable' },
  context: context ?? null,
});

function rankItem(cell: StripCells['rank'], t: StripTranslate, timeZone: string): MetricStripItem {
  const id = 'rank';
  const label = t('rank');
  switch (cell.kind) {
    case 'pending':
      return { id, label, value: t('rankPending'), unknown: { kind: 'pending' } };
    case 'failed':
      return { id, label, value: t('rankFailed'), unknown: { kind: 'not-applicable' } };
    case 'value':
    case 'beyond': {
      const time = cell.observedAt === null ? null : formatTableDateTime(cell.observedAt, timeZone);
      const context =
        time === null
          ? t('rankBeyond', { depth: cell.kind === 'beyond' ? cell.depth : 0 })
          : cell.stale
            ? t('rankStale', { time })
            : cell.failing
              ? t('rankFailing', { time })
              : cell.kind === 'beyond'
                ? t('rankBeyondChecked', { depth: cell.depth, time })
                : t('rankChecked', { time });
      return {
        id,
        label,
        value: cell.kind === 'value' ? formatInteger(cell.rank) : formatRankCell({ rank: null, depth: cell.depth }),
        delta: cell.change.kind === 'blank' ? undefined : <RankChangeView display={cell.change} />,
        context,
      };
    }
  }
}

function bestItem(cell: StripCells['best'], t: StripTranslate, timeZone: string): MetricStripItem {
  const id = 'best';
  const label = t('best');
  switch (cell.kind) {
    case 'unavailable':
      return unavailable(id, label, t);
    case 'none':
      return { id, label, value: t('bestNone'), unknown: { kind: 'not-applicable' } };
    case 'value':
      return {
        id,
        label,
        value: formatInteger(cell.rank),
        context: cell.at === null ? null : t('bestAt', { date: formatTableDate(cell.at, timeZone) }),
      };
  }
}

function averageItem(cell: StripCells['average'], t: StripTranslate): MetricStripItem {
  const id = 'average';
  const label = t('average');
  switch (cell.kind) {
    case 'unavailable':
      return unavailable(id, label, t);
    case 'none':
      return unavailable(id, label, t, t('averageNone', { checks: cell.checks }));
    case 'value':
      return {
        id,
        label,
        value: formatDecimal(cell.value, 1),
        context: t('averageOf', { ranked: formatInteger(cell.ranked), checks: cell.checks }),
      };
  }
}

function topTenItem(cell: StripCells['topTen'], t: StripTranslate): MetricStripItem {
  const id = 'topTen';
  const label = t('topTen');
  return cell.kind === 'unavailable'
    ? unavailable(id, label, t)
    : { id, label, value: formatInteger(cell.days), context: t('topTenOf', { days: cell.of }) };
}

/** The AI Overview as the table cell words it, as a word answer rather than a figure. */
function aioText(display: AioDisplay, t: StripTranslate, aio: AioTranslate): string | null {
  switch (display.kind) {
    case 'cited':
      // The table cell shows only "#3" beside a check mark; the strip has no mark, so it says "Cited"
      return display.position === null ? t('aioCited') : t('aioCitedAt', { position: display.position });
    case 'notCited':
      return aio('states.presentNotCited');
    case 'absent':
      return aio('absent');
    case 'notLoaded':
      return aio('notLoaded');
    case 'unknown':
    case 'pending':
      return null;
  }
}

function aioItem(
  cell: StripCells['aio'],
  t: StripTranslate,
  aio: AioTranslate,
  countsFailed: boolean,
): MetricStripItem {
  const id = 'aio';
  const label = t('aio');
  const text = aioText(cell.display, t, aio);
  if (text === null) return unavailable(id, label, t);
  const context =
    cell.counts === null
      ? countsFailed
        ? t('unavailable')
        : null
      : cell.counts.of === 0
        ? t('aioNoChecks')
        : t('aioChecks', { present: formatInteger(cell.counts.present), of: cell.counts.of });
  const answered = cell.display.kind === 'cited' || cell.display.kind === 'notCited';
  return {
    id,
    label,
    value: text,
    text: true,
    // A word that is not an answer ("Not loaded", "No AIO") reads like the other missing values
    unknown: answered ? null : { kind: 'not-applicable' },
    context,
  };
}

/**
 * The six cells of the page (24-page-templates.md section 9.4): the rank and its change, the best rank, the
 * average and the days in the top 10 of the window, the volume and the AI Overview. The rank facts come from
 * the keyword, the window's figures from the page's history (one request, shared with the chart) and the AI
 * Overview checks of the window. A read that fails leaves its figures as n/a under one notice, and Try again
 * reads only what failed.
 */
export function DetailStrip({ scope, detail, timeZone }: DetailStripProps): ReactElement {
  const t = useTranslations('keywordDetail.strip');
  const aioT = useTranslations('rankings.aio');
  const metricsT = useTranslations('rankings.inspector.metrics');
  const { win } = useDetailUrlState();
  const { entities, history } = usePageRankHistory(scope, detail, win);
  const days = windowDates(win, formatIsoDate(new Date(), timeZone));
  const aio = useQuery({ ...aioHistoryQuery(scope, days), placeholderData: keepPreviousData });

  const historyFailed = entities.isError || history.isError;
  const failed = historyFailed || aio.isError;
  const loading = (history.data === undefined && !historyFailed) || (aio.data === undefined && !aio.isError);
  const cells = stripCells({
    state: detailStateOf(detail.state, detail.is_active),
    tracked: detail.state,
    history: history.data?.data,
    aio: aio.data?.data,
  });
  const items = [
    rankItem(cells.rank, t, timeZone),
    bestItem(cells.best, t, timeZone),
    averageItem(cells.average, t),
    topTenItem(cells.topTen, t),
    volumeStripItem(detail, metricsT),
    aioItem(cells.aio, t, aioT, aio.isError),
  ];

  const groups: MetricStripGroup[] = [{ id: 'keyword', items }];
  const retry = (): void => {
    if (entities.isError) void entities.refetch();
    if (history.isError) void history.refetch();
    if (aio.isError) void aio.refetch();
  };

  return (
    <div className="flex flex-col gap-3">
      {failed ? (
        <SectionError
          title={t('partialError')}
          error={entities.error ?? history.error ?? aio.error}
          onRetry={retry}
          retrying={entities.isFetching || history.isFetching || aio.isFetching}
        />
      ) : null}
      <MetricStrip
        size="md"
        label={t('label')}
        groups={groups}
        status={loading ? 'loading' : history.isPlaceholderData || aio.isPlaceholderData ? 'refetching' : 'ready'}
      />
    </div>
  );
}
