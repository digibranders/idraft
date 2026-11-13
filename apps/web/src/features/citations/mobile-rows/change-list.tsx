'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { changeLines } from './list-lines';
import { CitationListShell, type ListChrome } from './list-shell';
import type { ChangeKind } from '../citation-scope';
import { changeRowId } from '../new-lost/change-model';
import type { SourceChangeRow } from '@/lib/citations/types';

export interface ChangeListProps extends ListChrome {
  kind: ChangeKind;
  /** The sources the tab lists, searched and in the order the server gave. */
  sources: readonly SourceChangeRow[];
  /** The project's time zone: the date a source was first cited is its day. */
  timeZone: string;
  /** Opens the domain's inspector. */
  onOpenDomain: (registrable: string) => void;
}

/**
 * The New and lost tab below 768 px (WB-CIT-20): the New or the Lost list, one two line row per domain with its units
 * and, for New, the date it was first cited. A tap opens the domain's inspector as a sheet.
 */
export function ChangeList({ kind, sources, timeZone, onOpenDomain, ...chrome }: ChangeListProps): ReactElement {
  const mobile = useTranslations('citations.mobile');
  const t = useTranslations('citations.newLost');
  const table = useTranslations('citations.table');
  const roles = useTranslations('common.domainCell.roles');
  const locale = useLocale();
  return (
    <CitationListShell<SourceChangeRow>
      {...chrome}
      caption={kind === 'new' ? mobile('newCaption') : mobile('lostCaption')}
      itemNoun={{ one: t(`noun.${kind}.one`), other: t(`noun.${kind}.other`) }}
      searchPlaceholder={table('search')}
      rows={sources}
      getRowId={changeRowId}
      lines={(row) => changeLines(kind, row, { t: mobile, roles, locale, timeZone })}
      onRowOpen={(row) => onOpenDomain(row.registrable_domain)}
    />
  );
}
