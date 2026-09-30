'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/app/status/empty-state';
import { ErrorPage } from '@/components/app/status/error-page';
import { TextLink } from '@/components/ui/text-link';
import { isApiProblem } from '@/lib/api/problem';
import { projectPath } from '@/lib/routes/paths';

/** The project root of the page being shown, from the route's segments. */
function useProjectHome(): ReturnType<typeof projectPath> | null {
  const { workspace, project } = useParams<{ workspace?: string; project?: string }>();
  return typeof workspace === 'string' && typeof project === 'string' ? projectPath(workspace, project) : null;
}

/**
 * What `error.tsx` shows inside the shell (17-empty-loading-error-states.md section 5.8). The error id is
 * the request id of an API problem thrown in the browser, or the digest Next.js gives a server error,
 * which the server log has too.
 */
export function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): ReactNode {
  const t = useTranslations('status');
  const home = useProjectHome();
  const id = isApiProblem(error) ? error.requestId : (error.digest ?? null);
  return (
    <ErrorPage
      title={t('error.title')}
      reason={t('error.reason')}
      retry={{ label: t('error.retry'), onRetry: reset }}
      way={
        home === null ? undefined : (
          <TextLink render={<Link href={home} />} className="type-body">
            {t('error.projectHome')}
          </TextLink>
        )
      }
      errorId={
        id === null
          ? null
          : { id, label: t('error.errorId', { id }), copyLabel: t('error.copyErrorId'), copiedLabel: t('error.copied') }
      }
    />
  );
}

/**
 * What `not-found.tsx` shows inside the shell. It never says whether the object exists: another tenant's
 * project and one that was never there look the same (20-frontend-specification.md section 3.7).
 */
export function RouteNotFound(): ReactNode {
  const t = useTranslations('status.notFound');
  const home = useProjectHome();
  return (
    <div className="px-3 pt-5 pb-8 md:px-4 lg:px-5">
      <EmptyState
        headingLevel={1}
        title={t('title')}
        reason={t('reason')}
        secondaryAction={
          home === null ? undefined : (
            <TextLink render={<Link href={home} />} className="type-body">
              {t('projectHome')}
            </TextLink>
          )
        }
      />
    </div>
  );
}
