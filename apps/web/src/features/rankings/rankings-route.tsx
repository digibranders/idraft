'use client';

import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams, useSelectedLayoutSegment } from 'next/navigation';
import type { ReactElement, ReactNode } from 'react';

import { RankingsScreen, type RankingsScreenProps } from './rankings-screen';

const IMPORT_SEGMENT = 'import';
const IMPORT_SUFFIX = /\/import$/;

/**
 * Rankings as its route renders it: `/seo/rankings/import` opens the import dialog over the same mounted
 * screen, so the table, its scroll and a write in progress stay as they are. The filters and the view in the
 * query string go along when the dialog opens and closes.
 */
export function RankingsRoute({
  children,
  ...props
}: Omit<RankingsScreenProps, 'importOpen' | 'onImportOpenChange'> & { children: ReactNode }): ReactElement {
  const segment = useSelectedLayoutSegment();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const importOpen = segment === IMPORT_SEGMENT;
  const base = importOpen ? pathname.replace(IMPORT_SUFFIX, '') : pathname;
  const go = (path: string): void => {
    // The path is this page's own or the import under it, so it is one of the app's routes
    router.replace(`${path}${search === '' ? '' : `?${search}`}` as Route, { scroll: false });
  };
  return (
    <>
      <RankingsScreen
        {...props}
        importOpen={importOpen}
        onImportOpenChange={(open) => go(open ? `${base}/${IMPORT_SEGMENT}` : base)}
      />
      {children}
    </>
  );
}
