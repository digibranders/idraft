'use client';

import { Bell, Info, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, type ReactElement } from 'react';

import { MAX_ACKNOWLEDGE, useAlertEvents, type AlertScope } from './alert-queries';
import { useAlertWords } from './alert-words';
import { useAcknowledgeAlerts } from './use-acknowledge-alerts';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { Popover } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import { useErrorId } from '@/lib/api/use-error-id';
import type { AlertEvent, Severity } from '@/lib/api/types';
import { formatRelative } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';

/** The badge shows at most this many; more reads "99+". */
const BADGE_CAP = 99;
/** The alerts are read again this often while the tab is visible (18 section 5.1), and when the window regains focus. */
const REFRESH_MS = 60_000;

const SEVERITY_ICON: Readonly<Record<Severity, LucideIcon>> = {
  info: Info,
  warning: TriangleAlert,
  critical: OctagonAlert,
};
const SEVERITY_TEXT: Readonly<Record<Severity, string>> = {
  info: cn('text-info-text'),
  warning: cn('text-warning-text'),
  critical: cn('text-negative-text'),
};

export interface NotificationBellProps {
  scope: AlertScope;
  /** The project's time zone, which the times are shown in. */
  timeZone: string;
  /** The project's brand, which an evidence sentence names when the counts are about it. */
  brandName: string;
  /** Settings > Alert rules of the project. */
  rulesHref: Route;
}

/**
 * The notification bell of the project's top bar (18-notifications-alerts.md section 5): the open alerts as a
 * count on the button, and the newest alerts in a popover. The API has no total, so the count is of the first
 * page of alerts and reads "12+" when more exist. Acknowledging needs `alerts:write`.
 */
export function NotificationBell({ scope, timeZone, brandName, rulesHref }: NotificationBellProps): ReactElement {
  const t = useTranslations('alerts.bell');
  const recent = useTranslations('alerts.recent');
  const common = useTranslations('common');
  const canWrite = useCan('alerts:write');
  const [open, setOpen] = useState(false);
  const events = useAlertEvents(scope, REFRESH_MS);
  const errorId = useErrorId(events.error);
  const words = useAlertWords(brandName);
  const { busy, send } = useAcknowledgeAlerts(scope);
  const rows = events.data?.pages.flatMap((page) => page.data) ?? [];
  const unread = rows.filter((event) => event.acknowledged_at === null);
  const more = events.hasNextPage;
  const critical = unread.some((event) => event.severity === 'critical');

  const label =
    unread.length === 0
      ? t('label', { count: 0 })
      : more
        ? t('labelMore', { count: unread.length })
        : t('label', { count: unread.length });
  const badge =
    unread.length > BADGE_CAP ? t('badgeCap') : more ? t('badgeMore', { count: unread.length }) : String(unread.length);

  const severityLabel = (severity: Severity): string => recent(`severity.${severity}`);

  const row = (event: AlertEvent): ReactElement => {
    const isUnread = event.acknowledged_at === null;
    return (
      <li key={event.id}>
        <Link
          href={rulesHref}
          onClick={() => setOpen(false)}
          className="flex items-start gap-2 px-3 py-2 hover:bg-surface-hover focus-visible:focus-ring-inset"
        >
          <span aria-hidden="true" className="mt-2 flex w-1.5 shrink-0 justify-center">
            {isUnread ? <span className="size-1.5 rounded-full bg-primary" /> : null}
          </span>
          <Icon
            icon={SEVERITY_ICON[event.severity]}
            size="sm"
            label={severityLabel(event.severity)}
            className={cn('mt-0.5', SEVERITY_TEXT[event.severity])}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-baseline justify-between gap-2">
              <span className={cn('min-w-0 truncate', isUnread ? 'type-body-strong' : 'type-body')}>
                {isUnread ? <span className="sr-only">{t('unread')} </span> : null}
                {event.subject_label}
              </span>
              <span className="shrink-0 num type-meta">{formatRelative(event.occurred_at, timeZone)}</span>
            </span>
            <span className="type-meta">{words.evidenceText(event)}</span>
          </span>
        </Link>
      </li>
    );
  };

  return (
    // The button is the popover's trigger (it carries aria-haspopup); the count sits beside it, in the same frame
    <span className="relative inline-flex">
      <Popover
        open={open}
        onOpenChange={setOpen}
        align="end"
        padding="none"
        width="notifications"
        aria-label={t('title')}
        trigger={<IconButton icon={Bell} label={label} size="icon" iconSize="md" tooltipSide="bottom" />}
        footer={
          <div className="flex w-full px-3 py-2">
            <TextLink render={<Link href={rulesHref} onClick={() => setOpen(false)} />}>{t('rulesLink')}</TextLink>
          </div>
        }
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <h2 className="type-subsection-title">{t('title')}</h2>
          {canWrite && unread.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              loading={busy}
              onClick={() => void send(unread.slice(0, MAX_ACKNOWLEDGE).map((event) => event.id))}
            >
              {recent('acknowledgeAll')}
            </Button>
          ) : null}
        </div>
        {events.isError && rows.length === 0 ? (
          <InlineError
            title={recent('loadFailed')}
            reason={recent('loadFailedReason')}
            errorId={errorId}
            onRetry={() => void events.refetch()}
            retrying={events.isFetching}
            retryLabel={common('retry')}
          />
        ) : events.isPending ? (
          <div role="status" aria-label={common('loading')} className="flex flex-col gap-3 px-3 py-2">
            <Skeleton shape="text-14" widthPct={72} />
            <Skeleton shape="text-14" widthPct={100} />
            <Skeleton shape="text-14" widthPct={56} />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-3 py-6 text-center type-body text-foreground-secondary">{t('empty')}</p>
        ) : (
          <ul aria-label={t('list')} className="flex flex-col pb-1">
            {rows.map(row)}
          </ul>
        )}
      </Popover>
      {unread.length === 0 ? null : (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-sm px-1 num type-micro',
            critical ? 'bg-negative-solid text-foreground-inverse' : 'bg-primary text-primary-foreground',
          )}
        >
          {badge}
        </span>
      )}
    </span>
  );
}
