'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { domainLines, type Comparison } from './list-lines';
import { CitationListShell, type ListChrome } from './list-shell';
import { domainRowId } from '../domain-rows';
import type { SourceDomainRow } from '@/lib/citations/types';

export interface DomainListProps extends ListChrome {
  /** The domains the tab lists, searched and in the order the server gave. */
  domains: readonly SourceDomainRow[];
  comparison: Comparison;
  /** Opens the domain's inspector. */
  onOpenDomain: (registrable: string) => void;
}

/**
 * The Domains tab below 768 px (WB-CIT-20): the domains flat, one two line row each. A domain does not expand here,
 * its pages are in its inspector; a tap opens that inspector as a sheet.
 */
export function DomainList({ domains, comparison, onOpenDomain, ...chrome }: DomainListProps): ReactElement {
  const t = useTranslations('citations.mobile');
  const table = useTranslations('citations.table');
  const roles = useTranslations('common.domainCell.roles');
  const locale = useLocale();
  return (
    <CitationListShell<SourceDomainRow>
      {...chrome}
      caption={t('domainsCaption')}
      itemNoun={{ one: table('noun.one'), other: table('noun.other') }}
      searchPlaceholder={table('search')}
      rows={domains}
      getRowId={domainRowId}
      lines={(row) => domainLines(row, comparison, { t, roles, locale })}
      onRowOpen={(row) => onOpenDomain(row.registrable_domain)}
    />
  );
}
