'use client';

import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { StatChip } from '@/components/app/page-toolbar/stat-chip';
import { EMPTY_VALUE, formatDecimal, formatInteger } from '@/lib/format';
import { alertTierText, sinceText } from '@/lib/internal-links/changes-format';
import { contextStats } from '@/lib/internal-links/context-stats';
import { changesSummaryQuery, tierFlowQuery, worklistsQuery } from '@/lib/internal-links/queries';
import type { LinksScope } from '@/lib/internal-links/types';

export interface ContextLineProps {
  scope: LinksScope;
  /** The crawl the numbers are of: `null` for the latest. */
  run: string | null;
  timeZone: string;
  untieredHref: Route;
  /** The Changes tab, once it is registered; the lost figure is plain text until then. */
  changesHref: Route | null;
}

/**
 * Line 2 of the page header after the crawl picker (spec 7.1, mock `statItems`): how many pages are tiered, the T1
 * pages and their depth, the pages no editorial link reaches, the editorial links lost to the important tiers, and
 * what changed against the previous crawl. One line that scrolls sideways and never wraps; no equity figure. It shows
 * nothing until the tier strip and the worklist counts have answered; the comparison waits for its own read.
 */
export function ContextLine({
  scope,
  run,
  timeZone,
  untieredHref,
  changesHref,
}: ContextLineProps): ReactElement | null {
  const t = useTranslations('internalLinks.context');
  const flow = useQuery(tierFlowQuery(scope, 'editorial', run));
  const lists = useQuery(worklistsQuery(scope, run));
  const summary = useQuery(changesSummaryQuery(scope, run)).data?.data;
  const tiers = flow.data?.data.tiers;
  const worklists = lists.data?.data;
  if (tiers === undefined || worklists === undefined) return null;
  const ready = summary?.state === 'ready' ? summary : null;
  const stats = contextStats({
    tiers,
    noEditorial: worklists.orphans + worklists.editorial_orphans,
    lostToTop: ready?.lost_to_top ?? 0,
  });
  const comparison = ((): string | null => {
    if (summary === undefined) return null;
    switch (summary.state) {
      case 'pending':
        return t('changesPending');
      case 'first_crawl':
        return t('changesFirst');
      case 'unavailable':
        return t('changesUnavailable');
      case 'ready': {
        const counts = {
          since: sinceText(summary.previous_finished_at, timeZone) ?? t('sinceFallback'),
          pagesAdded: summary.pages_added,
          pagesLost: summary.pages_lost,
          linksAdded: summary.all_added,
          linksLost: summary.all_lost,
        };
        // A previous crawl whose links were dropped has no link changes to report: zero would read as "none"
        return summary.all_added + summary.all_lost > 0 ? t('changesReadyLinks', counts) : t('changesReady', counts);
      }
    }
  })();
  const importantTiers = alertTierText(ready?.important_max_position ?? 1, {
    tierPair: (first, second) => t('tierPair', { first, second }),
    tierRange: (first, last) => t('tierRange', { first, last }),
  });
  return (
    // A region the keyboard can reach: it scrolls sideways, and when nothing inside takes focus it would be out of reach
    <div
      role="region"
      aria-label={t('label')}
      tabIndex={0}
      className="scrollbar-none flex min-h-control-sm min-w-0 flex-1 items-center gap-4 overflow-x-auto rounded-sm whitespace-nowrap outline-none focus-visible:focus-ring-inset"
    >
      <StatChip
        label={t('tiered')}
        value={t('tieredValue', {
          tiered: formatInteger(stats.tiered.tiered),
          total: formatInteger(stats.tiered.total),
        })}
        {...(stats.tiered.untiered > 0 ? { href: untieredHref, tooltip: t('tieredTip') } : {})}
      />
      <StatChip label={t('t1Pages')} value={formatInteger(stats.t1Pages)} />
      <StatChip label={t('t1Depth')} value={stats.t1Depth === null ? EMPTY_VALUE : formatDecimal(stats.t1Depth, 1)} />
      <StatChip label={t('noEditorial')} value={formatInteger(stats.noEditorial)} />
      {stats.lost === null ? null : (
        <StatChip
          label={t('lost', { tiers: importantTiers })}
          value={formatInteger(stats.lost)}
          tone="negative"
          {...(changesHref === null ? {} : { href: changesHref, tooltip: t('lostTip') })}
        />
      )}
      {comparison === null ? null : <span className="shrink-0 type-meta text-foreground-secondary">{comparison}</span>}
    </div>
  );
}
