'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import type { Connection, ConnectionStatus } from '@/lib/api/types';
import { formatDetailDateTime } from '@/lib/format';

const STATUS_KEYS = {
  active: 'active',
  reauth_required: 'reauthRequired',
  error: 'error',
  revoked: 'revoked',
} as const satisfies Record<ConnectionStatus, string>;
const STATUS_TONES = {
  active: 'positive',
  reauth_required: 'warning',
  error: 'negative',
  revoked: 'neutral',
} as const satisfies Record<ConnectionStatus, 'positive' | 'warning' | 'negative' | 'neutral'>;

export interface ConnectionPanelProps {
  status: ConnectionStatus;
  /** The Google account, or `null` when this member cannot read it. */
  account: string | null;
  /** The connection, when this member may read it: who connected and when. */
  connection: Connection | null;
  /** The project's time zone, where the date is written. */
  timeZone: string;
}

function Fact({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="type-meta text-foreground-tertiary">{label}</dt>
      <dd className="min-w-0 type-body wrap-anywhere text-foreground">{children}</dd>
    </div>
  );
}

/**
 * The Connection region of Integrations (24-page-templates.md section 9.12): status, the Google account, who
 * connected it and since when. One connection serves Search Console and GA4; the property of each product is
 * in a section of its own below. A member who may only read sees the status and the account, which the
 * project's own list carries.
 */
export function ConnectionPanel({ status, account, connection, timeZone }: ConnectionPanelProps): ReactElement {
  const t = useTranslations('integrations');
  const unknown = t('connection.unknown');
  return (
    <section
      aria-labelledby="google-connection-title"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-5 py-4"
    >
      <h2 id="google-connection-title" className="type-section-title">
        {t('connection.title')}
      </h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t('connection.status')}>
          <Badge tone={STATUS_TONES[status]}>{t(`connection.statuses.${STATUS_KEYS[status]}`)}</Badge>
        </Fact>
        <Fact label={t('connection.account')}>{account ?? t('accountUnknown')}</Fact>
        <Fact label={t('connection.connectedBy')}>{connection?.connected_by?.name ?? unknown}</Fact>
        <Fact label={t('connection.since')}>
          {connection === null ? unknown : formatDetailDateTime(connection.connected_at, timeZone)}
        </Fact>
      </dl>
    </section>
  );
}
