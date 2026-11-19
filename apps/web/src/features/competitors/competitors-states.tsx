'use client';

import { Plus, Power, Users } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { TextLink } from '@/components/ui/text-link';
import { projectPath } from '@/lib/routes/paths';

/**
 * The page's own empty and error states, in one place so every section says them alike (plan section 3.18): the
 * engines say what the page can count, the tracked set says whether there is anything to compare.
 */

/** No engine of the project is on: there are no answers to read, and Engines turns one on. */
export function NoEngine({
  workspaceSlug,
  projectSlug,
  canManage,
}: {
  workspaceSlug: string;
  projectSlug: string;
  /** The member may turn engines on (`projects:write`); otherwise the state says whom to ask and links nowhere. */
  canManage: boolean;
}): ReactElement {
  const t = useTranslations('competitors');
  return (
    <EmptyState
      icon={Power}
      title={t('noEngineTitle')}
      reason={canManage ? t('noEngineReason') : t('noEngineAdmin')}
      headingLevel={2}
      {...(canManage
        ? {
            secondaryAction: (
              <TextLink render={<Link href={projectPath(workspaceSlug, projectSlug, '/settings/engines')} />}>
                {t('noEngineAction')}
              </TextLink>
            ),
          }
        : {})}
    />
  );
}

/** The project has no competitor to compare with: a real zero over a known set, with the one action that changes it. */
export function NoCompetitor({ onAdd }: { onAdd: (() => void) | null }): ReactElement {
  const t = useTranslations('competitors');
  return (
    <EmptyState
      icon={Users}
      title={t('empty.noCompetitorTitle')}
      reason={onAdd === null ? t('empty.noCompetitorAdmin') : t('empty.noCompetitorReason')}
      headingLevel={2}
      {...(onAdd === null
        ? {}
        : {
            primaryAction: (
              <Button variant="primary" icon={Plus} onClick={onAdd}>
                {t('header.addCompetitor')}
              </Button>
            ),
          })}
    />
  );
}

/** A read failed with nothing to show: Retry asks again, and the error id is there to quote. */
export function ReadFailed({
  title,
  reason,
  errorId,
  onRetry,
  retrying = false,
}: {
  title: string;
  reason: string;
  /** The request id of the failure, or `null` when it has none (a lost connection). */
  errorId: string | null;
  onRetry: () => void;
  retrying?: boolean;
}): ReactElement {
  const common = useTranslations('common');
  const status = useTranslations('status.error');
  return (
    <InlineError
      title={title}
      reason={reason}
      errorId={
        errorId === null
          ? null
          : {
              id: errorId,
              label: status('errorId', { id: errorId }),
              copyLabel: status('copyErrorId'),
              copiedLabel: status('copied'),
            }
      }
      onRetry={onRetry}
      retrying={retrying}
      retryLabel={common('retry')}
      live
    />
  );
}
