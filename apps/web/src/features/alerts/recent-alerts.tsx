'use client';

import { BellRing } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { useAlertWords } from './alert-words';
import { MAX_ACKNOWLEDGE, useAlertEvents, type AlertScope } from './alert-queries';
import { useAcknowledgeAlerts } from './use-acknowledge-alerts';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useErrorId } from '@/lib/api/use-error-id';
import type { AlertEvent, AlertRule, Severity } from '@/lib/api/types';
import { formatTableDateTime } from '@/lib/format';

const SEVERITY_TONE = { info: 'info', warning: 'warning', critical: 'negative' } as const satisfies Record<
  Severity,
  'info' | 'warning' | 'negative'
>;

export interface RecentAlertsProps {
  scope: AlertScope;
  rules: readonly AlertRule[];
  /** The project's time zone, which the times are shown in. */
  timeZone: string;
  canWrite: boolean;
  /** The project's brand, which an evidence sentence names when the counts are about it (final list D16). */
  brandName: string;
}

/**
 * The project's recent alerts, newest first: when, what changed (from the evidence), the rule and how serious.
 * A member with `alerts:write` acknowledges one alert, or every open alert shown with one call.
 */
export function RecentAlerts({ scope, rules, timeZone, canWrite, brandName }: RecentAlertsProps): ReactNode {
  const t = useTranslations('alerts.recent');
  const common = useTranslations('common');
  const events = useAlertEvents(scope);
  const errorId = useErrorId(events.error);
  const words = useAlertWords(brandName);
  const { busy, send } = useAcknowledgeAlerts(scope);
  const rows = events.data?.pages.flatMap((page) => page.data) ?? [];
  const open = rows.filter((event) => event.acknowledged_at === null);

  const columns: PlainColumn<AlertEvent>[] = [
    {
      id: 'when',
      header: t('columns.when'),
      cell: (event) => (
        <span className="num whitespace-nowrap text-foreground-secondary">
          {formatTableDateTime(event.occurred_at, timeZone)}
        </span>
      ),
    },
    {
      id: 'what',
      header: t('columns.what'),
      wrap: true,
      cell: (event) => (
        <span className="flex flex-col">
          <span className="text-foreground">{event.subject_label}</span>
          <span className="type-label">{words.evidenceText(event)}</span>
        </span>
      ),
    },
    {
      id: 'rule',
      header: t('columns.rule'),
      wrap: true,
      cell: (event) => rules.find((rule) => rule.id === event.rule_id)?.name ?? null,
    },
    {
      id: 'severity',
      header: t('columns.severity'),
      cell: (event) => <Badge tone={SEVERITY_TONE[event.severity]}>{t(`severity.${event.severity}`)}</Badge>,
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (event) =>
        event.acknowledged_at !== null ? (
          <span className="type-label">{t('acknowledged')}</span>
        ) : canWrite ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            aria-label={t('acknowledgeLabel', { subject: event.subject_label })}
            onClick={() => void send([event.id])}
          >
            {t('acknowledge')}
          </Button>
        ) : null,
    },
  ];

  const hasMore = events.hasNextPage;
  return (
    <section aria-labelledby="recent-alerts-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="recent-alerts-title" className="type-subsection-title">
            {t('title')}
          </h3>
          {events.isSuccess && rows.length > 0 ? (
            <p className="mt-1 type-meta">
              {open.length === 0
                ? t('nothingOpen')
                : t(hasMore ? 'toAcknowledgeMore' : 'toAcknowledge', { count: open.length })}
            </p>
          ) : null}
        </div>
        {canWrite && open.length > 0 ? (
          <Button
            variant="secondary"
            loading={busy}
            onClick={() => void send(open.slice(0, MAX_ACKNOWLEDGE).map((event) => event.id))}
          >
            {t('acknowledgeAll')}
          </Button>
        ) : null}
      </div>
      {events.isError && rows.length === 0 ? (
        <InlineError
          title={t('loadFailed')}
          reason={t('loadFailedReason')}
          errorId={errorId}
          onRetry={() => void events.refetch()}
          retrying={events.isFetching}
          retryLabel={common('retry')}
        />
      ) : events.isSuccess && rows.length === 0 ? (
        <EmptyState icon={BellRing} headingLevel={3} title={t('emptyTitle')} reason={t('emptyReason')} />
      ) : (
        <PlainTable<AlertEvent>
          caption={t('tableLabel')}
          columns={columns}
          rows={rows}
          rowKey={(event) => event.id}
          status={events.isPending ? 'loading' : 'ready'}
          errorState={null}
          emptyText={t('emptyTitle')}
          skeletonRows={3}
        />
      )}
      {hasMore ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" loading={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>
            {t('loadMore')}
          </Button>
          {events.isFetchNextPageError ? (
            <p role="alert" className="type-meta text-negative-text">
              {t('loadMoreFailed')}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
