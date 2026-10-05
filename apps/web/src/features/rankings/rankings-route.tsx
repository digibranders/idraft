'use client';

import { useRouter, useSearchParams, useSelectedLayoutSegment } from 'next/navigation';
import { useEffect, type ReactElement, type ReactNode } from 'react';

import { RankingsScreen, type RankingsScreenProps } from './rankings-screen';
import { useCan } from '@/lib/permissions';
import { rankingsImportPath, rankingsPath, withQuery } from '@/lib/routes/paths';

const IMPORT_SEGMENT = 'import';

export interface RankingsRouteProps extends Omit<RankingsScreenProps, 'importOpen' | 'onImportOpenChange'> {
  /** The slugs of the workspace and the project in the URL, for the paths of the page and of the import. */
  workspaceSlug: string;
  projectSlug: string;
  children: ReactNode;
}

/**
 * Rankings as its route renders it: `/seo/rankings/import` opens the import dialog over the same mounted
 * screen, so the table, its scroll and a write in progress stay as they are. The filters and the view in the
 * query string go along when the dialog opens and closes. A member who may not import has no dialog at that
 * address, so it is replaced by the page itself.
 */
export function RankingsRoute({ children, workspaceSlug, projectSlug, ...props }: RankingsRouteProps): ReactElement {
  const segment = useSelectedLayoutSegment();
  const { replace } = useRouter();
  const search = useSearchParams().toString();
  const canImport = useCan('imports:write');
  const atImport = segment === IMPORT_SEGMENT;
  const page = rankingsPath(workspaceSlug, projectSlug);

  useEffect(() => {
    if (atImport && !canImport) replace(withQuery(page, search), { scroll: false });
  }, [atImport, canImport, replace, page, search]);

  return (
    <>
      <RankingsScreen
        {...props}
        importOpen={atImport && canImport}
        onImportOpenChange={(open) =>
          replace(withQuery(open ? rankingsImportPath(workspaceSlug, projectSlug) : page, search), { scroll: false })
        }
      />
      {children}
    </>
  );
}
