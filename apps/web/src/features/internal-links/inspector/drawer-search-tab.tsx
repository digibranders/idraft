'use client';

import { Globe } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement, type ReactNode } from 'react';

import type { PageDrawerContext } from './page-drawer-context';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { MetricStrip, type MetricStripGroup, type MetricStripItem } from '@/components/app/metric/metric-strip';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { LinkButton } from '@/components/ui/link-button';
import { formatBusinessDate, formatChartDate, formatInteger } from '@/lib/format';
import type { PageSearchDaily } from '@/lib/internal-links/types';
import { PageSearchDetailSlot } from '@/lib/pages/search-detail-slot';
import { usePageSearchDaily } from '@/lib/pages/search-daily';
import { canManageIntegrations, useMembership } from '@/lib/permissions';

export interface DrawerSearchTabProps {
  context: PageDrawerContext;
  urlId: string;
  /** The address of the page, or null while the page read is pending (the slot then draws nothing). */
  url: string | null;
  /** The tracked keywords card, which the drawer builds from the page read. */
  keywords: ReactNode;
}

/**
 * The Search tab of the page drawer (spec 9.4): the 28 stored days of Search Console, then the slot of the Search
 * Console session, then the tracked keywords.
 */
export function DrawerSearchTab({ context, urlId, url, keywords }: DrawerSearchTabProps): ReactElement {
  const read = usePageSearchDaily(context.scope, context.crawl.run, urlId);
  return (
    <>
      <SearchConsole read={read} integrationsHref={context.hrefs.integrations} />
      {url === null ? null : (
        <PageSearchDetailSlot scope={context.scope} urlId={urlId} url={url} timeZone={context.timeZone} />
      )}
      {keywords}
    </>
  );
}

function SearchConsole({
  read,
  integrationsHref,
}: {
  read: ReturnType<typeof usePageSearchDaily>;
  integrationsHref: PageDrawerContext['hrefs']['integrations'];
}): ReactElement {
  const t = useTranslations('pages.drawer.search');
  const common = useTranslations('common');
  const inspector = useTranslations('internalLinks.inspector');
  const membership = useMembership();
  const title = t('title');
  // A read that is not here yet, or an unavailable seam, draws the card's skeleton
  if (read.state === 'loading' || read.state === 'unavailable') {
    return <InspectorSection title={title} icon={Globe} status="loading" />;
  }
  if (read.state === 'error') {
    return (
      <InspectorSection
        title={title}
        icon={Globe}
        status="error"
        error={
          <InlineError
            title={t('loadFailed')}
            reason={inspector('loadFailedReason')}
            errorId={null}
            onRetry={read.retry}
            retrying={false}
            retryLabel={common('retry')}
          />
        }
      />
    );
  }
  const { data } = read;
  if (data.state === 'not_connected') {
    return (
      <InspectorSection
        title={title}
        icon={Globe}
        status="empty"
        empty={
          <EmptyState
            variant="inline"
            title={t('notConnectedTitle')}
            reason={t('notConnectedReason')}
            headingLevel={3}
            primaryAction={
              canManageIntegrations(membership) ? (
                <LinkButton variant="secondary" size="sm" render={<Link href={integrationsHref} />}>
                  {t('connect')}
                </LinkButton>
              ) : undefined
            }
          />
        }
      />
    );
  }
  if (data.state === 'pending') {
    return (
      <InspectorSection
        title={title}
        icon={Globe}
        status="empty"
        empty={<EmptyState variant="inline" title={t('pendingTitle')} reason={t('pendingReason')} headingLevel={3} />}
      />
    );
  }
  return <Days data={data} />;
}

function Days({ data }: { data: PageSearchDaily }): ReactElement {
  const t = useTranslations('pages.drawer.search');
  const { days } = data;
  const clicks = data.clicks ?? days.reduce((sum, day) => sum + day.clicks, 0);
  const impressions = data.impressions ?? days.reduce((sum, day) => sum + day.impressions, 0);
  const none = clicks === 0 && impressions === 0;
  // Days are business dates of the project: they are written as they come, never moved by a time zone
  const categories = useMemo(() => days.map((day) => formatChartDate(day.date)), [days]);
  const series = useMemo(
    () => [
      { id: 'clicks', name: t('clicks'), role: { kind: 'brand' as const }, values: days.map((day) => day.clicks) },
      {
        id: 'impressions',
        name: t('impressions'),
        role: { kind: 'palette' as const, index: 2 as const },
        values: days.map((day) => day.impressions),
      },
    ],
    [days, t],
  );
  const formatValue = useCallback((value: number) => formatInteger(value), []);
  const first = days[0]?.date ?? data.window_start;
  const last = days.at(-1)?.date ?? data.window_end;
  const items: MetricStripItem[] = [
    { id: 'clicks', label: t('clicks'), value: formatInteger(clicks) },
    { id: 'impressions', label: t('impressions'), value: formatInteger(impressions) },
  ];
  const groups: MetricStripGroup[] = [{ id: 'search', items }];
  const strip = <MetricStrip size="sm" label={t('label')} status="ready" groups={groups} />;
  if (none || first === null || last === null) {
    return (
      <InspectorSection title={t('title')} icon={Globe} status="ready">
        <div className="flex flex-col gap-3">
          {strip}
          <p className="type-body text-foreground-tertiary">{t('none')}</p>
        </div>
      </InspectorSection>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {strip}
      <div className="rounded-lg border border-border bg-surface px-4 pt-3 pb-4">
        <ChartFrame
          title={t('title')}
          variant="inspector"
          kind="line"
          categories={categories}
          categoryHeader={t('day')}
          series={series}
          formatValue={formatValue}
          height={180}
          summary={t('summary', {
            clicks: formatInteger(clicks),
            impressions: formatInteger(impressions),
            start: formatBusinessDate(first),
            end: formatBusinessDate(last),
          })}
          status="ready"
        />
      </div>
    </div>
  );
}
