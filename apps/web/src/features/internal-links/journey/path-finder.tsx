'use client';

import { useQuery } from '@tanstack/react-query';
import { Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { RouteChain } from './route-chain';
import { LinksDropped } from '../links-dropped';
import type { LinksTabContext } from '../tabs';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiProblem } from '@/lib/api/problem';
import { isLinksDropped } from '@/lib/internal-links/contract-states';
import { reasonOf } from '@/lib/internal-links/problem-reason';
import { routesQuery } from '@/lib/internal-links/queries';
import { closerNote } from '@/lib/internal-links/route-format';
import type { PageRow, Routes } from '@/lib/internal-links/types';

/**
 * The sentence under the chains, from how the two routes compare (spec 7.10). A null route means the page cannot be
 * reached: a crawl without a start page makes the API start from the site's template-link roots, so it never means
 * "no start page" and the one "cannot be reached" message covers it.
 */
function Note({ routes }: { routes: Routes }): ReactElement | null {
  const t = useTranslations('internalLinks.paths');
  const note = closerNote({ any: routes.any?.clicks ?? null, editorial: routes.editorial?.clicks ?? null });
  if (note === null) return null;
  let text: string;
  if (note.kind === 'menus') text = t('menus', { count: note.difference });
  else if (note.kind === 'noEditorial') text = t('noEditorial');
  else text = t('unreachable');
  return <p className="max-w-reading type-body text-foreground-secondary">{text}</p>;
}

/**
 * The Path finder (spec 7.10, mock `il-journey.js` path view): the shortest way from the home page to the focus
 * page, over any link and over editorial links only. The page is the focus page of the address, chosen with the
 * toolbar's one picker; the crawl in view is part of the read.
 */
export function PathFinder({ context, page }: { context: LinksTabContext; page: PageRow }): ReactElement {
  const t = useTranslations('internalLinks.paths');
  const common = useTranslations('common');
  const read = useQuery(routesQuery(context.scope, page.url_id, context.crawl.run));

  if (read.isError) {
    if (isLinksDropped(read.error)) return <LinksDropped />;
    if (isApiProblem(read.error, 'not_found')) {
      return <EmptyState title={t('notFoundTitle')} reason={t('notFoundReason')} headingLevel={3} />;
    }
    return (
      <InlineError
        title={t('loadFailed')}
        reason={reasonOf(read.error) || t('loadFailedReason')}
        errorId={null}
        onRetry={() => void read.refetch()}
        retrying={read.isFetching}
        retryLabel={common('retry')}
      />
    );
  }
  if (!read.isSuccess) {
    return (
      <div className="flex flex-col gap-2 p-4" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} shape="block" height="row" />
        ))}
      </div>
    );
  }

  const routes = read.data.data;
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Note routes={routes} />
        <Button variant="secondary" size="sm" icon={Workflow} onClick={() => openInCanvas(context, page.url_id)}>
          {t('openInCanvas')}
        </Button>
      </div>
      {routes.any === null ? null : (
        <div className="grid gap-6 md:grid-cols-2">
          <RouteChain title={t('any')} route={routes.any} />
          {routes.editorial === null ? null : <RouteChain title={t('editorial')} route={routes.editorial} />}
        </div>
      )}
    </div>
  );
}

/** The focus page in the canvas view: the journey opens on it (as everywhere) and the Path finder view leaves the address. */
function openInCanvas(context: LinksTabContext, urlId: string): void {
  context.openJourney(urlId);
  context.setSearch({ jv: null });
}
