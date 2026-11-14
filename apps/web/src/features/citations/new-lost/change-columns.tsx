'use client';

import type { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import type { ChangeKind } from '../citation-scope';
import { DomainCell, DomainRoleBadge } from '@/components/app/cells/domain-cell';
import { col } from '@/components/app/data-table/columns';
import type { CellTip, DataTableColumn } from '@/components/app/data-table/types';
import type { SourceChangeRow } from '@/lib/citations/types';
import { formatDateRange } from '@/lib/format';

/**
 * The columns of the New and lost table (DS 9.7, plan T2): the domain, its role, then for New the units in the
 * window and the first and last time it was cited, and for Lost the units it had before it went quiet. Counts
 * only, with no share and no change: a source that has just started or stopped has no earlier or later share to
 * compare, and no test of such a change exists.
 */

/** The translator of `citations.newLost`, as `useTranslations('citations.newLost')` and `createTranslator` give it. */
export type ChangeTranslate = ReturnType<typeof useTranslations<'citations.newLost'>>;

export interface ChangeColumnOptions {
  kind: ChangeKind;
  t: ChangeTranslate;
  /** The project's time zone: the dates of a New row are its days. */
  timeZone: string;
  /** The window the Lost units were counted in (`meta.compare_window`), for the tip. `null` while not read. */
  supportWindow: { from: string; to: string } | null;
}

// shortcut: the project setting for favicons does not exist yet (D16 of WP-21), so they always show; read it here when it does
const FAVICON = 'show';

/** The columns for `kind`. Keep `supportWindow` stable between renders that change nothing, so they are not rebuilt. */
export function useChangeColumns({
  kind,
  t,
  timeZone,
  supportWindow,
}: ChangeColumnOptions): readonly DataTableColumn<SourceChangeRow>[] {
  return useMemo(() => {
    const domain: DataTableColumn<SourceChangeRow> = {
      ...col.keyword<SourceChangeRow>('domain', (row) => row.registrable_domain, {
        header: t('columns.domain'),
        width: 280,
        minWidth: 200,
        sortable: false,
      }),
      // The own row is marked by its tint and the Role column, so the cell draws no badge of its own
      cell: (row) => (
        <DomainCell host={row.registrable_domain} registrable={row.registrable_domain} favicon={FAVICON} />
      ),
    };

    // The value is only for the column's own bookkeeping: the cell draws the badge
    const role: DataTableColumn<SourceChangeRow> = {
      ...col.badge<SourceChangeRow>('role', (row) => ({ label: row.domain_role }), {
        header: t('columns.role'),
        priority: 1,
        sortable: false,
      }),
      cell: (row) => <DomainRoleBadge role={row.domain_role} />,
    };

    if (kind === 'lost') {
      const unitsBefore: DataTableColumn<SourceChangeRow> = {
        ...col.count<SourceChangeRow>('unitsBefore', (row) => row.previous_units, {
          header: t('columns.unitsBefore'),
          priority: 1,
          sortable: false,
        }),
        cellTip: (row): CellTip | undefined =>
          supportWindow === null
            ? undefined
            : {
                content: t('unitsBeforeTip', {
                  units: row.previous_units,
                  range: formatDateRange(supportWindow.from, supportWindow.to),
                }),
              },
      };
      return [domain, role, unitsBefore];
    }

    const units = col.count<SourceChangeRow>('units', (row) => row.current_units, {
      header: t('columns.units'),
      priority: 1,
      sortable: false,
    });
    const firstCited = col.date<SourceChangeRow>('firstCited', (row) => row.first_seen_at, {
      header: t('columns.firstCited'),
      priority: 3,
      sortable: false,
      timeZone,
    });
    const lastCited = col.date<SourceChangeRow>('lastCited', (row) => row.last_seen_at, {
      header: t('columns.lastCited'),
      priority: 2,
      sortable: false,
      timeZone,
    });
    return [domain, role, units, firstCited, lastCited];
  }, [kind, t, timeZone, supportWindow]);
}
