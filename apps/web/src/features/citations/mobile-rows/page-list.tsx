'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { pageLines, type Comparison } from './list-lines';
import { CitationListShell, type ListChrome } from './list-shell';
import { pageRowId } from '../page-columns';
import type { SourcePageRow } from '@/lib/citations/types';

export interface PageListProps extends ListChrome {
  /** The pages the tab lists, searched and in the order the server gave. */
  pages: readonly SourcePageRow[];
  comparison: Comparison;
  /** Opens the page's source inspector. */
  onOpenPage: (urlId: number) => void;
}

/**
 * The Pages tab below 768 px (WB-CIT-20): one two line row per page, named by its title or its address. A tap opens
 * the source inspector as a sheet, where the address and its links are.
 */
export function PageList({ pages, comparison, onOpenPage, ...chrome }: PageListProps): ReactElement {
  const t = useTranslations('citations.mobile');
  const table = useTranslations('citations.table');
  const roles = useTranslations('common.domainCell.roles');
  const locale = useLocale();
  return (
    <CitationListShell<SourcePageRow>
      {...chrome}
      caption={t('pagesCaption')}
      itemNoun={{ one: table('pageNoun.one'), other: table('pageNoun.other') }}
      searchPlaceholder={table('searchPages')}
      rows={pages}
      getRowId={pageRowId}
      lines={(row) => pageLines(row, comparison, { t, roles, locale })}
      onRowOpen={(row) => onOpenPage(row.url_id)}
    />
  );
}
