'use client';

import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactElement } from 'react';

import { ChangeLinksPanel } from './change-links-panel';
import { ChangesStrip } from './changes-strip';
import { MovedPagesPanel } from './moved-pages-panel';
import { LinksDropped } from '../links-dropped';
import { reasonOf } from '@/lib/internal-links/problem-reason';
import { SkeletonRows } from '../crawl-states';
import type { LinksTabContext } from '../tabs';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { downloadApiFile } from '@/lib/api/download';
import { alertText, alertTierText, sinceText } from '@/lib/internal-links/changes-format';
import {
  CHANGE_LIMIT,
  changeLinksExportQuery,
  changeLinksPath,
  changesSummaryQuery,
} from '@/lib/internal-links/queries';
import type { ChangeKind, ChangeOnly, ChangesSummary } from '@/lib/internal-links/types';

/**
 * The Changes tab (spec 7.10, mock `il-changes.js`): what the crawl in view changed against the one before it. The
 * alert for links lost to the important tiers comes first, then the counts, the lost and new links, and the pages that
 * moved most. Only a worked out comparison shows counts; a pending one still shows the lists that exist, and a first
 * crawl or one that could not be compared says so and offers nothing to retry. Equity is never read or shown.
 */
export function ChangesTab({ context }: { context: LinksTabContext }): ReactElement {
  const c = useTranslations('internalLinks.changes');
  const words = useTranslations('internalLinks.context');
  const common = useTranslations('common');
  const { scope, crawl, timeZone, state, registerExport } = context;
  const summary = useQuery(changesSummaryQuery(scope, crawl.run));
  const [change, setChange] = useState<ChangeKind>('lost');
  // The person's choice belongs to the crawl it was made in: another crawl derives its own default again
  const [chosenOnly, setChosenOnly] = useState<ChangeOnly | null>(null);
  const [seenRun, setSeenRun] = useState(crawl.run);
  if (seenRun !== crawl.run) {
    setSeenRun(crawl.run);
    setChosenOnly(null);
  }
  const data: ChangesSummary | undefined = summary.data?.data;
  const ready = data?.state === 'ready' ? data : null;
  // The important tiers first when the crawl lost links to them, else everything (mock `render`)
  const only: ChangeOnly = change === 'added' ? 'all' : (chosenOnly ?? ((ready?.lost_to_top ?? 0) > 0 ? 'top' : 'all'));
  const canExport = (data?.state === 'ready' || data?.state === 'pending') && crawl.linksAvailable;

  // The Export menu downloads the table as shown, every row (decision W13)
  useEffect(() => {
    if (!canExport) return undefined;
    const query = changeLinksExportQuery(
      { change, linkScope: state.changesScope, only, offset: 0, limit: CHANGE_LIMIT },
      crawl.run,
    );
    registerExport(() => downloadApiFile(changeLinksPath(scope), query, `internal-links-${change}-links.csv`));
    return () => registerExport(null);
  }, [canExport, registerExport, scope, change, state.changesScope, only, crawl.run]);

  if (summary.isPending) {
    return (
      <div aria-busy="true">
        <span className="sr-only">{c('loading')}</span>
        <SkeletonRows />
      </div>
    );
  }
  if (summary.isError) {
    return (
      <InlineError
        title={c('loadFailed')}
        reason={reasonOf(summary.error) || c('loadFailedReason')}
        errorId={null}
        onRetry={() => void summary.refetch()}
        retrying={summary.isFetching}
        retryLabel={common('retry')}
      />
    );
  }
  if (data === undefined) return <SkeletonRows />;
  if (data.state === 'first_crawl') {
    return <EmptyState icon={History} title={c('firstTitle')} reason={c('firstText')} headingLevel={3} />;
  }
  if (data.state === 'unavailable') {
    return <EmptyState icon={History} title={c('unavailableTitle')} reason={c('unavailableText')} headingLevel={3} />;
  }

  const tierWords = {
    tierPair: (first: string, second: string) => words('tierPair', { first, second }),
    tierRange: (first: string, last: string) => words('tierRange', { first, last }),
  };
  const tiers = alertTierText(data.important_max_position, tierWords);
  const date = sinceText(data.previous_finished_at, timeZone) ?? 'none';
  const since = c('since', { date });
  const alert = ready?.alert ?? null;
  // The link changes were not worked out (the previous crawl's links were dropped): zero would read as "no changes"
  const notCompared = ready !== null && !ready.links_compared;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {alert === null ? null : (
        <Banner
          tone="warning"
          placement="region"
          message={`${alertText(alert, {
            ...tierWords,
            none: () => c('alertNone'),
            lost: (_count, alertTiers) => c('alert', { count: alert.lost_links, tiers: alertTiers, since }),
          })} ${c(alert.delivery_state === 'shown_in_app' ? 'delivery.shownInApp' : 'delivery.channelUnavailable')}`}
          actions={
            context.openAlertSettings === null ? undefined : (
              <Button variant="secondary" size="sm" onClick={context.openAlertSettings}>
                {c('alertAction')}
              </Button>
            )
          }
        />
      )}
      {data.state === 'pending' ? (
        <Banner tone="neutral" placement="region" lead={c('pendingTitle')} message={c('pendingText')} />
      ) : (
        <ChangesStrip summary={data} since={since} tiers={tiers} linkScope={state.changesScope} />
      )}
      {notCompared ? <Banner tone="neutral" placement="region" message={c('previousDropped')} /> : null}
      {crawl.linksAvailable ? (
        <ChangeLinksPanel
          context={context}
          change={change}
          onChange={setChange}
          linkScope={state.changesScope}
          only={only}
          onOnlyChange={setChosenOnly}
          tiers={tiers}
          date={date}
        />
      ) : (
        <LinksDropped />
      )}
      <MovedPagesPanel context={context} since={since} />
    </div>
  );
}
