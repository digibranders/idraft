'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Skeleton } from '@/components/ui/skeleton';
import type { LinksScope } from '@/lib/internal-links/types';
import { usePageHistory } from './data/use-page-history';
import { HistoryFooter, HowDatesAreRead } from './history-notes';
import { HistoryStrip } from './history-strip';
import { HistoryTimeline } from './history-timeline';
import type { PageHistory } from './model/page-history';

export interface HistoryTabProps {
  scope: LinksScope;
  /** The page (a `core.urls` id), as the Pages drawer holds it. */
  urlId: string;
  /** The project time zone, for every date. */
  timeZone: string;
}

function Loading({ label }: { label: string }): ReactElement {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      <Skeleton shape="block" height="row" className="h-16" />
      <Skeleton shape="text-14" widthPct={100} />
      <Skeleton shape="text-14" widthPct={80} />
      <Skeleton shape="text-14" widthPct={64} />
    </div>
  );
}

function Unreadable({ history }: { history: PageHistory }): ReactElement {
  const t = useTranslations('pageHistory.state');
  const redirect = history.why === 'redirect';
  return (
    <EmptyState
      variant="inline"
      title={t(redirect ? 'redirectTitle' : 'errorTitle')}
      reason={
        redirect
          ? t('redirectReason')
          : t('errorReason', { status: history.status === null ? 'none' : String(history.status) })
      }
      headingLevel={3}
    />
  );
}

/**
 * The History tab of the page drawer: four dates, a warning when Google is behind, the crawls of the page, a folded
 * note on how the dates are read, and what the history cannot show. Props only; the drawer host mounts it.
 */
export function HistoryTab({ scope, urlId, timeZone }: HistoryTabProps): ReactElement {
  const t = useTranslations('pageHistory.state');
  const common = useTranslations('common');
  const { read, valid } = usePageHistory(scope, urlId);
  if (!valid || read.isError) {
    return (
      <InlineError
        title={t('loadFailed')}
        reason={t('loadFailedReason')}
        errorId={null}
        onRetry={() => void read.refetch()}
        retrying={read.isFetching}
        retryLabel={common('retry')}
      />
    );
  }
  if (read.data === undefined) return <Loading label={t('loading')} />;
  const history = read.data.data;
  if (!history.readable) return <Unreadable history={history} />;
  if (history.versions.length === 0) {
    return <EmptyState variant="inline" title={t('emptyTitle')} reason={t('emptyReason')} headingLevel={3} />;
  }
  return (
    <div className="flex flex-col gap-3">
      <HistoryStrip history={history} timeZone={timeZone} />
      <HistoryTimeline key={urlId} urlId={urlId} history={history} timeZone={timeZone} />
      <HowDatesAreRead />
      <HistoryFooter history={history} timeZone={timeZone} />
    </div>
  );
}
