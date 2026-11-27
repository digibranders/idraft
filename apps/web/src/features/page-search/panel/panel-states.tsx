'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Banner } from '@/components/app/status/banner';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import { isApiProblem } from '@/lib/api/problem';
import { formatBusinessDate } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { integrationsPath } from '@/lib/routes/paths';

export interface ProjectRef {
  workspaceSlug: string;
  projectSlug: string;
}

/** A page that does not answer 200 has no search data, so nothing is asked. */
export function NotLive(): ReactElement {
  const t = useTranslations('pageSearch');
  return <p className="type-body text-foreground-secondary">{t('notLive')}</p>;
}

function IntegrationsLink({ workspaceSlug, projectSlug }: ProjectRef): ReactElement {
  const t = useTranslations('pageSearch');
  return (
    <LinkButton size="sm" render={<Link href={integrationsPath(workspaceSlug, projectSlug)} />}>
      {t('openIntegrations')}
    </LinkButton>
  );
}

/** Search Console is not linked to the project: the way to link it for a member who can, else who to ask. */
export function NotConnected(props: ProjectRef): ReactElement {
  const t = useTranslations('pageSearch');
  const canManage = useCan('integrations:manage');
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="type-body text-foreground-secondary">
        {canManage ? t('states.notConnected') : t('states.askAdmin')}
      </p>
      {canManage ? <IntegrationsLink {...props} /> : null}
    </div>
  );
}

/** Connected, and the first days are not stored yet. */
export function Pending(): ReactElement {
  const t = useTranslations('pageSearch');
  return <p className="type-body text-foreground-secondary">{t('states.pending')}</p>;
}

/** The stored numbers are still shown; the banner says they stop at the last final day. */
export function StaleBanner({
  state,
  finalThrough,
  ...project
}: ProjectRef & { state: 'reauth_required' | 'no_access'; finalThrough: string | null }): ReactElement {
  const t = useTranslations('pageSearch');
  const canManage = useCan('integrations:manage');
  const date = finalThrough === null ? '' : formatBusinessDate(finalThrough);
  return (
    <Banner
      tone="warning"
      placement="region"
      message={t(state === 'reauth_required' ? 'states.reauth' : 'states.noAccess', { date })}
      actions={canManage ? <IntegrationsLink {...project} /> : null}
    />
  );
}

/** Google could not be reached for the page's history: when to ask again, and a way to ask now. */
export function Busy({ seconds, onRetry }: { seconds: number; onRetry: () => void }): ReactElement {
  const t = useTranslations('pageSearch');
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="type-body text-foreground-secondary">{t('states.busy', { seconds })}</p>
      <Button size="sm" onClick={onRetry}>
        {t('states.retry')}
      </Button>
    </div>
  );
}

/** The read failed: the error id when the API gave one, and Retry. */
export function LoadError({
  error,
  retrying,
  onRetry,
}: {
  error: Error | null;
  retrying: boolean;
  onRetry: () => void;
}): ReactElement {
  const t = useTranslations('pageSearch');
  const status = useTranslations('status.error');
  const id = isApiProblem(error) ? error.requestId : null;
  return (
    <InlineError
      title={t('states.errorTitle')}
      reason={t('states.unavailable')}
      errorId={
        id === null
          ? null
          : { id, label: status('errorId', { id }), copyLabel: status('copyErrorId'), copiedLabel: status('copied') }
      }
      onRetry={onRetry}
      retrying={retrying}
      retryLabel={t('states.retry')}
    />
  );
}
