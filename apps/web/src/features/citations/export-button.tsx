'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, type ReactElement } from 'react';

import type { DateWindow } from './citation-scope';
import { buildCitationsExport, citationsExportFileName, type ExportSource } from './citations-export';
import type { EngineInScope } from './engine-share';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { entitiesQuery } from '@/lib/citations/entities-query';
import type { DomainRole, SourceScope, SourcesMeta } from '@/lib/citations/types';
import { csvBlob, downloadBlob } from '@/lib/csv/csv-write';

/** The message key of each role's name, the one `DomainRoleBadge` says. */
const ROLE_KEY = { own: 'own', competitor: 'competitor', third_party: 'thirdParty' } as const satisfies Record<
  DomainRole,
  string
>;

/**
 * A tab's way to hand the page's Export button its rows: they are given while it is shown and taken back when it
 * is left or while it reads again. Keep `source` stable between renders that change nothing, or the page would
 * render without end.
 */
export function useRegisterExport(
  register: ((source: ExportSource | null) => void) | undefined,
  source: ExportSource | null,
): void {
  useEffect(() => {
    register?.(source);
    return () => register?.(null);
  }, [register, source]);
}

export interface ExportButtonProps {
  /** The rows of the tab that is shown, or `null` while they are not loaded. */
  source: ExportSource | null;
  /** The project, for the names of the entities behind Cited with. */
  scope: SourceScope;
  /** `meta` of the period before: `undefined` with the comparison off, which leaves Change in share out. */
  previousMeta: SourcesMeta | undefined;
  /** The engines in scope, in order: a column of units for each. */
  engines: readonly EngineInScope[];
  range: DateWindow;
}

/**
 * Export CSV (WB-CIT-16, plan D13): the rows the tab has loaded, written on this side. The toast says how many of
 * how many rows the file holds, so a list cut at 200 is never taken for the whole scope. Without rows the button
 * says why it cannot be used.
 */
export function ExportButton({ source, scope, previousMeta, engines, range }: ExportButtonProps): ReactElement {
  const t = useTranslations('citations');
  const tt = useTranslations('citations.table');
  const columns = useTranslations('citations.exportColumns');
  const roles = useTranslations('common.domainCell.roles');
  const entities = useQuery({ ...entitiesQuery(scope), placeholderData: keepPreviousData });
  // The Domains file names the entity behind Cited with, so it waits for the names; a read that failed is not waited for
  // and the names are left blank. The Pages file has no such column.
  const namesPending = source?.rows.tab === 'domains' && entities.isPending;
  const reason =
    source === null
      ? t('exportLoading')
      : source.rows.rows.length === 0
        ? t('exportNone')
        : namesPending
          ? t('exportLoading')
          : null;

  const exportRows = (): void => {
    if (source === null || reason !== null) return;
    const names = new Map((entities.data?.data ?? []).map(({ entity }) => [entity.entity_id, entity.canonical_name]));
    const { tab, rows } = source.rows;
    try {
      const table = buildCitationsExport(source.rows, source.meta, previousMeta, engines, {
        domain: tt('domain'),
        url: columns('url'),
        title: columns('title'),
        role: tt('role'),
        roleName: (role) => roles(ROLE_KEY[role]),
        units: tt('units'),
        share: columns('share'),
        total: columns('total'),
        answers: tt('answers'),
        prompts: tt('prompts'),
        engineUnits: (engine) => columns('engineUnits', { engine }),
        change: columns('change'),
        citedWith: tt('citedWith'),
        noneNamed: tt('citedWithNone'),
        firstSeen: tt('firstSeen'),
        lastSeen: tt('lastSeen'),
        entityName: (id) => names.get(id),
      });
      downloadBlob(csvBlob(table), citationsExportFileName(tab, range));
      // The noun and its number are the message's: it chooses the plural from the total
      toast({
        type: 'success',
        title: t('exported', { count: rows.length, total: Math.max(source.total, rows.length), tab }),
      });
    } catch {
      toast({ type: 'error', title: t('exportFailed') });
    }
  };

  return (
    <Tooltip content={reason ?? ''} disabled={reason === null}>
      <Button variant="secondary" icon={Download} disabled={reason !== null} focusableWhenDisabled onClick={exportRows}>
        {t('export')}
      </Button>
    </Tooltip>
  );
}
