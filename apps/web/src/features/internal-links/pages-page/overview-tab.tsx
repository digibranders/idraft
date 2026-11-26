'use client';

import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { OverviewCards } from './overview-cards';
import { MetricStrip, type MetricStripItem } from '@/components/app/metric/metric-strip';
import { InlineError } from '@/components/app/status/inline-error';
import { formatInteger } from '@/lib/format';
import { overviewQuery } from '@/lib/internal-links/queries';
import type { LinksScope } from '@/lib/internal-links/types';
import { useIssueTotals } from '@/lib/pages/issue-source';
import { overviewModel, type OverviewRow } from '@/lib/pages/overview-model';
import { projectPath } from '@/lib/routes/paths';

const GROUP_ID = 'pages';

export interface OverviewTabProps {
  scope: LinksScope;
  /** The crawl the address chooses, or null for the latest. */
  run: string | null;
  workspaceSlug: string;
  projectSlug: string;
  /** The address of All pages for a query; it carries the crawl in view. */
  allPages: (query: Record<string, string>) => Route;
}

/** The Overview (spec 6.4): the strip of page counts and, under it, the first six cards. */
export function OverviewTab({ scope, run, workspaceSlug, projectSlug, allPages }: OverviewTabProps): ReactElement {
  const t = useTranslations('pages');
  const common = useTranslations('common');
  const read = useQuery(overviewQuery(scope, run));
  const issues = useIssueTotals(scope, run);
  const model = useMemo(
    () => (read.data === undefined ? null : overviewModel(read.data.data, allPages)),
    [read.data, allPages],
  );

  if (read.isError && model === null) {
    return (
      <InlineError
        title={t('overview.loadFailed')}
        reason={t('overview.loadFailedReason')}
        errorId={null}
        onRetry={() => void read.refetch()}
        retrying={read.isFetching}
        retryLabel={common('retry')}
      />
    );
  }

  const label = (id: string): string => {
    switch (id) {
      case 'addresses':
        return t('strip.addresses');
      case 'live':
        return t('strip.live');
      case 'indexable':
        return t('strip.indexable');
      case 'orphans':
        return t('strip.orphans');
      default:
        return t('strip.errors');
    }
  };
  const tip = (row: OverviewRow): string | undefined => {
    if (row.id === 'addresses') return t('strip.addressesTip');
    if (row.id === 'live') return t('strip.liveTip');
    return row.base === 'live' ? t('strip.liveBaseTip') : undefined;
  };
  const items: MetricStripItem[] = (model?.strip ?? [null, null, null, null, null]).map((row, index) =>
    row === null
      ? { id: `loading-${String(index)}`, label: '', value: '' }
      : {
          id: row.id,
          label: label(row.id),
          value: formatInteger(row.count),
          ...(row.href === null ? {} : { href: row.href }),
          ...(tip(row) === undefined ? {} : { tip: tip(row) }),
        },
  );
  if (model !== null && issues.state === 'ready') {
    items.push({
      id: 'withIssue',
      label: t('strip.withIssue'),
      value: formatInteger(issues.data.withIssue),
      href: projectPath(workspaceSlug, projectSlug, '/seo/issues'),
    });
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <MetricStrip
        size="md"
        label={t('strip.label')}
        groups={[{ id: GROUP_ID, items }]}
        status={model === null ? 'loading' : read.isFetching ? 'refetching' : 'ready'}
      />
      <OverviewCards model={model} refetching={read.isFetching} />
    </div>
  );
}
