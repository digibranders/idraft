'use client';

import { Power } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactElement } from 'react';

import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { TextLink } from '@/components/ui/text-link';
import type { ErrorIdWords } from '@/lib/api/use-error-id';
import { projectPath } from '@/lib/routes/paths';

/**
 * The empty and error states of the Citations page, in one place so the screen and both tabs say them alike
 * (plan section 5, `citations.empty.*`). The table states are the ones `citation-table-states` holds.
 */
export { CitationFilteredEmptyState as FilteredEmpty, NoAnswers, NoCiting } from './citation-table-states';

/** No engine of the project is on: there are no answers to read, and Engines turns one on. */
export function NoEngine({ workspaceSlug, projectSlug }: { workspaceSlug: string; projectSlug: string }): ReactElement {
  const t = useTranslations('citations');
  return (
    <EmptyState
      icon={Power}
      title={t('empty.noEngineTitle')}
      reason={t('empty.noEngineReason')}
      headingLevel={2}
      secondaryAction={
        <TextLink render={<Link href={projectPath(workspaceSlug, projectSlug, '/settings/engines')} />}>
          {t('empty.toEngines')}
        </TextLink>
      }
    />
  );
}

/** A read of the page failed with nothing to show: Retry asks again, and the error id is there to quote. */
export function LoadFailed({
  errorId,
  onRetry,
  retrying,
}: {
  /** `null` when there is none, such as a lost connection. */
  errorId: ErrorIdWords | null;
  onRetry: () => void;
  retrying: boolean;
}): ReactElement {
  const t = useTranslations('citations');
  const common = useTranslations('common');
  return (
    <InlineError
      title={t('empty.failedTitle')}
      reason={t('empty.failedReason')}
      errorId={errorId}
      onRetry={onRetry}
      retrying={retrying}
      retryLabel={common('retry')}
      live
    />
  );
}
