'use client';

import { useRouter, useSearchParams, useSelectedLayoutSegment } from 'next/navigation';
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';

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
 * query string go along when the dialog opens and closes. The dialog opens on a history entry of its own, so
 * the browser's Back button closes it and stays on Rankings (the dialog stops what it had going, as when it
 * is closed); closing it with its own button goes back too, and a dialog that came with the address closes by
 * replacing it. A member who may not import has no dialog at that address, so it is replaced by the page itself.
 */
export function RankingsRoute({ children, workspaceSlug, projectSlug, ...props }: RankingsRouteProps): ReactElement {
  const segment = useSelectedLayoutSegment();
  const { push, replace, back } = useRouter();
  const search = useSearchParams().toString();
  const canImport = useCan('imports:write');
  const atImport = segment === IMPORT_SEGMENT;
  const page = rankingsPath(workspaceSlug, projectSlug);

  useEffect(() => {
    if (atImport && !canImport) replace(withQuery(page, search), { scroll: false });
  }, [atImport, canImport, replace, page, search]);

  // Whether the dialog sits on a history entry this page pushed. Closing it then goes back, so Back and
  // Forward stay clean; a dialog that came with the address (a link) closes by replacing instead.
  const pushed = useRef(false);
  useEffect(() => {
    // Gone by the browser's Back button: its entry went with it
    if (!atImport) pushed.current = false;
  }, [atImport]);
  const onImportOpenChange = (open: boolean): void => {
    if (open) {
      pushed.current = true;
      push(withQuery(rankingsImportPath(workspaceSlug, projectSlug), search), { scroll: false });
    } else if (pushed.current) {
      pushed.current = false;
      back();
    } else {
      replace(withQuery(page, search), { scroll: false });
    }
  };

  return (
    <>
      <RankingsScreen {...props} importOpen={atImport && canImport} onImportOpenChange={onImportOpenChange} />
      {children}
    </>
  );
}
