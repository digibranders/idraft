'use client';

import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { StatChip } from '@/components/app/page-toolbar/stat-chip';
import { EMPTY_VALUE, formatDecimal, formatInteger } from '@/lib/format';
import { tierFlowQuery, worklistsQuery } from '@/lib/internal-links/queries';
import { tierPosition } from '@/lib/internal-links/tiers';
import type { LinksScope } from '@/lib/internal-links/types';

/**
 * The summary above the tabs (mock `il.js` `strip`): pages, how many are tiered (a link to the Untiered filter while
 * some are not), T1 pages and their average depth, and the pages no editorial link reaches. Hidden below `md`, as
 * in the mock. No equity figure (decision W4). It shows nothing until both reads have answered.
 */
export function SummaryStrip({ scope, untieredHref }: { scope: LinksScope; untieredHref: Route }): ReactElement | null {
  const t = useTranslations('internalLinks.strip');
  const flow = useQuery(tierFlowQuery(scope, 'editorial'));
  const lists = useQuery(worklistsQuery(scope));
  const tiers = flow.data?.data.tiers;
  const worklists = lists.data?.data;
  if (tiers === undefined || worklists === undefined) return null;
  const total = tiers.reduce((sum, stat) => sum + stat.pages, 0);
  const untiered = tiers.find((stat) => stat.tier === null)?.pages ?? 0;
  const t1 = tiers.find((stat) => stat.tier !== null && tierPosition(stat.tier) === 1);
  const t1Depth = t1?.average_depth ?? null;
  return (
    <div role="group" aria-label={t('label')} className="hidden items-center gap-4 md:flex">
      <StatChip label={t('pages')} value={formatInteger(total)} />
      <StatChip
        label={t('tiered')}
        value={t('tieredValue', { tiered: formatInteger(total - untiered), total: formatInteger(total) })}
        {...(untiered > 0 ? { href: untieredHref, tooltip: t('tieredTip') } : {})}
      />
      <StatChip label={t('t1Pages')} value={formatInteger(t1?.pages ?? 0)} />
      <StatChip label={t('t1Depth')} value={t1Depth === null ? EMPTY_VALUE : formatDecimal(t1Depth, 1)} />
      <StatChip label={t('noEditorial')} value={formatInteger(worklists.orphans + worklists.editorial_orphans)} />
    </div>
  );
}
