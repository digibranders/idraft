'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition, type ReactNode } from 'react';

import { PROJECT_LIST_FRAME } from './project-list';
import { PageHeader } from '@/components/app/shell/page-header';
import { InlineError } from '@/components/app/status/inline-error';

/**
 * The list when the API could not give it (17-empty-loading-error-states.md section 5.2): the header stays,
 * and the list's place says what failed, with Try again (which renders the page again) and the error id.
 */
export function ProjectListError({ errorId }: Readonly<{ errorId: string | null }>): ReactNode {
  const t = useTranslations('projects');
  const status = useTranslations('status.error');
  const common = useTranslations('common');
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  return (
    <div className={PROJECT_LIST_FRAME}>
      <PageHeader title={t('title')} />
      <div className="rounded-lg border border-border bg-surface">
        <InlineError
          title={t('error.title')}
          reason={t('error.reason')}
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
          onRetry={() => startRetry(() => router.refresh())}
          retrying={retrying}
          retryLabel={common('retry')}
        />
      </div>
    </div>
  );
}
