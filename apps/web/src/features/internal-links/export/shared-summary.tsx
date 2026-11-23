'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useSummaryWords } from './use-summary-words';
import { EmptyState } from '@/components/app/status/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiProblem, retryMinutes } from '@/lib/api/problem';
import { browserTimeZone } from '@/lib/format';
import { clientSummaryHtml } from '@/lib/internal-links/client-summary';
import { summaryInputOf } from '@/lib/internal-links/public-summary';
import { publicSummaryQuery } from '@/lib/internal-links/queries';

/**
 * The page a shared link opens: the client summary, read-only, with no way into the app. It is the same page the
 * download saves, shown in a frame with no scripts and no origin (`sandbox=""`), so the file and the link read
 * alike. Unknown, expired and revoked links all answer 404 and read the same here: the page never says which.
 */
export function SharedSummary({ token }: { token: string }): ReactElement {
  const t = useTranslations('internalLinks.sharedSummary');
  const common = useTranslations('common');
  const locale = useLocale();
  const { words, labels } = useSummaryWords();
  const read = useQuery(publicSummaryQuery(token));
  const html = useMemo(
    () =>
      read.data === undefined
        ? null
        : clientSummaryHtml(summaryInputOf(read.data.data, { locale, timeZone: browserTimeZone(), labels }), words),
    [read.data, locale, labels, words],
  );

  if (html !== null) {
    return <iframe title={t('frameTitle')} sandbox="" srcDoc={html} className="min-h-dvh w-full flex-1 border-0" />;
  }
  if (read.isPending) {
    return (
      <div role="status" aria-label={t('loading')} className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-6">
        <Skeleton shape="block" height="row" />
        <Skeleton shape="block" height="row" />
        <Skeleton shape="block" height="row" />
      </div>
    );
  }
  const error = read.error;
  if (isApiProblem(error, 'not_found')) {
    return (
      <div className="m-auto p-6">
        <EmptyState title={t('goneTitle')} reason={t('goneText')} headingLevel={1} />
      </div>
    );
  }
  const busy = isApiProblem(error) && error.status === 429;
  return (
    <div className="m-auto p-6">
      <EmptyState
        title={busy ? t('busyTitle') : t('failedTitle')}
        reason={
          busy
            ? error.retryAfterSeconds === null
              ? t('busyText')
              : t('busyTextWait', { minutes: retryMinutes(error) })
            : t('failedText')
        }
        primaryAction={
          <Button variant="secondary" loading={read.isFetching} onClick={() => void read.refetch()}>
            {common('retry')}
          </Button>
        }
        headingLevel={1}
      />
    </div>
  );
}
