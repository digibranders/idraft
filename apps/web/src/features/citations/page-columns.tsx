'use client';

import { useMemo, type ReactElement } from 'react';

import { joinCitedWith } from './cited-with-join';
import type { NamedEntity } from './domain-columns';
import { engineCell, type EngineInScope, type TableTranslate } from './engine-share';
import { DomainRoleBadge, type FaviconMode } from '@/components/app/cells/domain-cell';
import { URLCell } from '@/components/app/cells/url-cell';
import { col } from '@/components/app/data-table/columns';
import type { CellTip, DataTableColumn } from '@/components/app/data-table/types';
import { byEngineOrder } from '@/components/app/engine/order';
import { DeltaCell } from '@/components/app/metric/delta-cell';
import { Badge } from '@/components/ui/badge';
import { Truncate } from '@/components/ui/truncate';
import { engineTotals, isNewSource, shareChange, unitShare } from '@/lib/citations/share-model';
import type { SourceDomainRow, SourcePageRow, SourcesMeta } from '@/lib/citations/types';
import { EMPTY_VALUE, formatPercent } from '@/lib/format';

/**
 * The columns of the Pages table (DS 9.7, plan T5a): Page (the address with its host always drawn, and the title),
 * Role, Units, Share, Change in share, the share on each engine, New, First seen, Last seen and Cited with. Every
 * share carries its units (the tooltip says "300 of 18,420 units"), an unknown figure is n/a with its reason and
 * never 0, and the change in a share is never coloured: no test of it exists. Cited with is the DOMAIN's, since the
 * pages route has no such block: the header and the tooltip say so.
 */

export interface PageColumnOptions {
  /** The engines in scope; with one the engine group collapses. */
  engines: readonly EngineInScope[];
  /** `meta` of the scope read: the totals every share is of. */
  meta: SourcesMeta | undefined;
  /** `meta` of the period before, or `undefined` with the comparison off: the total a share change needs. */
  previousMeta: SourcesMeta | undefined;
  /** The project's entities, `undefined` while they load. */
  entities: readonly NamedEntity[] | undefined;
  /** The domains read that Cited with is joined from: `rows` are `undefined` while it loads or after it failed. */
  citedWith: { rows: readonly SourceDomainRow[] | undefined; failed: boolean };
  /** The project's time zone: first and last seen are in it. */
  timeZone: string;
  t: TableTranslate;
  locale: string;
}

// shortcut: the project setting for favicons does not exist yet (D16), so they always show; read it here when it does
const FAVICON: FaviconMode = 'show';

/** A page's row id: its URL, and the role and entity of the domain it was matched to. */
export const pageRowId = (row: SourcePageRow): string =>
  `${String(row.url_id)}|${row.domain_role}|${row.role_entity_id ?? ''}`;

const Missing = ({ children = EMPTY_VALUE }: { children?: string }): ReactElement => (
  <span className="text-foreground-tertiary">{children}</span>
);

/** The columns of the Pages table. The caller keeps `engines` and the options' lists stable between renders. */
export function usePageColumns({
  engines,
  meta,
  previousMeta,
  entities,
  citedWith: { rows: citedRows, failed: citedFailed },
  timeZone,
  t,
  locale,
}: PageColumnOptions): readonly DataTableColumn<SourcePageRow>[] {
  return useMemo(() => {
    const totals = meta === undefined ? null : engineTotals(meta);
    const names =
      entities === undefined ? null : new Map(entities.map(({ entity }) => [entity.entity_id, entity.canonical_name]));
    const percent = (value: number | null): string => formatPercent(value, { locale });

    const shareTip = (row: SourcePageRow): string => {
      const { units, total } = unitShare(row.source_share);
      return t('shareCell', { units, total });
    };
    const changeOf = (row: SourcePageRow): ReturnType<typeof shareChange> =>
      meta === undefined ? null : shareChange(row, meta, previousMeta);
    // Rows below the minimum are left out by the server, so a row's units always reach it
    const isNew = (row: SourcePageRow): boolean => meta !== undefined && isNewSource(row, meta, 0) === true;

    const page: DataTableColumn<SourcePageRow> = {
      ...col.keyword<SourcePageRow>('page', (row) => row.url, {
        header: t('page'),
        width: 320,
        minWidth: 200,
        sortable: false,
      }),
      // The copy and open buttons: F2 reaches them from the cell
      hasControls: true,
      cellLabel: (row) => row.url,
      // The host stays drawn beside the path and the title, so neither can hide where the page is
      cell: (row) => (
        <URLCell url={row.url} hostDisplay="show" label={t('urlLabel')} title={row.title} favicon={FAVICON} />
      ),
    };

    // The role is a word in a badge. The value is only for the column's own bookkeeping: the cell draws the badge
    const role: DataTableColumn<SourcePageRow> = {
      ...col.badge<SourcePageRow>('role', (row) => ({ label: row.domain_role }), {
        header: t('role'),
        priority: 1,
        sortable: false,
      }),
      cell: (row) => <DomainRoleBadge role={row.domain_role} />,
    };

    const units = col.count<SourcePageRow>('units', (row) => row.citation_units, {
      header: t('unitsShort'),
      headerTooltip: t('units'),
      priority: 1,
      sortable: false,
    });

    const share = col.volumeTrend<SourcePageRow>('share', (row) => unitShare(row.source_share).value, {
      header: t('shareShort'),
      ...(meta === undefined
        ? {}
        : { headerTooltip: t('shareScope', { units: meta.citation_units, answers: meta.answers }) }),
      priority: 1,
      sortable: false,
      unknown: (row) => ({ label: EMPTY_VALUE, tooltip: shareTip(row) }),
      known: (row, value) => <span className="num">{percent(value)}</span>,
      knownTip: (row): CellTip => ({ content: shareTip(row) }),
    });

    const change = col.rankDelta<SourcePageRow>('change', () => null, {
      header: t('changeShort'),
      headerTooltip: t('change'),
      priority: 2,
      sortable: false,
      // No test of a source share's change exists, so it is never coloured; no comparison is n/a, never 0
      cell: (row) => (
        <DeltaCell
          input={{ value: changeOf(row)?.delta ?? null, unit: 'points', polarity: 'neutral', isDetectable: null }}
          tip={false}
        />
      ),
      cellTip: (row): CellTip => {
        const moved = changeOf(row);
        if (moved === null) return { content: t('changeNone') };
        return {
          content: t('changePrevious', {
            share: percent(moved.previous.value),
            units: moved.previous.units,
            total: moved.previous.total,
          }),
          detail: t('changeNoTest'),
        };
      },
    });

    // One engine in scope: the rows are already that engine's, so Share is its value and no group is drawn
    const engineColumns =
      engines.length < 2
        ? []
        : byEngineOrder(engines, (engine) => engine.code).map((engine): DataTableColumn<SourcePageRow> => ({
            ...col.count<SourcePageRow>(`engine-${engine.code}`, () => null, {
              header: engine.label,
              priority: 3,
              width: 112,
              sortable: false,
              group: { id: 'engines', label: t('engineGroup') },
            }),
            cell: (row) => {
              const cell = engineCell(row, engine, totals, t, locale);
              return cell.state === 'share' ? <span className="num">{cell.text}</span> : <Missing />;
            },
            cellTip: (row): CellTip => ({ content: engineCell(row, engine, totals, t, locale).tip }),
          }));

    const status: DataTableColumn<SourcePageRow> = {
      ...col.badge<SourcePageRow>('status', () => null, { header: t('status'), priority: 2, sortable: false }),
      cell: (row) => (isNew(row) ? <Badge variant="outline">{t('new')}</Badge> : null),
      cellTip: (row): CellTip | undefined =>
        isNew(row) ? { content: t('newTip', { answers: meta?.previous_answers ?? 0 }) } : undefined,
    };

    const firstSeen = col.date<SourcePageRow>('firstSeen', (row) => row.first_seen_at, {
      header: t('firstSeen'),
      priority: 3,
      sortable: false,
      timeZone,
    });
    const lastSeen = col.date<SourcePageRow>('lastSeen', (row) => row.last_seen_at, {
      header: t('lastSeen'),
      priority: 2,
      sortable: false,
      timeZone,
    });

    // The domain's entity, joined from the domains read: its absence is told apart (not loaded, not in the 200, none)
    const citedOf = (
      row: SourcePageRow,
    ):
      | { state: 'name'; name: string; count: number }
      | { state: 'none' | 'outside' | 'loading' | 'failed' | 'unknown' } => {
      if (citedRows === undefined) return { state: citedFailed ? 'failed' : 'loading' };
      const joined = joinCitedWith(row, citedRows);
      if (joined.state !== 'found') return { state: joined.state };
      const name = names?.get(joined.citedWith.entity_id);
      return name === undefined ? { state: 'unknown' } : { state: 'name', name, count: joined.citedWith.observations };
    };
    const citedWith: DataTableColumn<SourcePageRow> = {
      ...col.text<SourcePageRow>('citedWith', () => null, {
        header: t('citedWithPage'),
        headerTooltip: t('citedWithPageTip'),
        priority: 3,
        width: 160,
        sortable: false,
      }),
      cell: (row) => {
        const cited = citedOf(row);
        switch (cited.state) {
          case 'name':
            return <Truncate text={cited.name} />;
          case 'none':
            return <Missing>{t('citedWithNone')}</Missing>;
          case 'outside':
            return (
              <span className="text-foreground-tertiary">
                <Truncate text={t('citedWithOutside')} />
              </span>
            );
          default:
            return <Missing />;
        }
      },
      cellTip: (row): CellTip | undefined => {
        const cited = citedOf(row);
        switch (cited.state) {
          case 'name':
            return { content: t('citedWithPageCell', { name: cited.name, count: cited.count }) };
          case 'none':
            return undefined;
          case 'outside':
            return { content: t('citedWithOutside') };
          case 'loading':
            return { content: t('citedWithLoading') };
          case 'failed':
            return { content: t('citedWithFailed') };
          case 'unknown':
            return { content: t('citedWithUnknown') };
        }
      },
    };

    const answers = col.count<SourcePageRow>('answers', (row) => row.observations, {
      header: t('answers'),
      priority: 4,
      defaultVisible: false,
      sortable: false,
    });
    const prompts = col.count<SourcePageRow>('prompts', (row) => row.prompts, {
      header: t('prompts'),
      priority: 4,
      defaultVisible: false,
      sortable: false,
    });

    return [
      page,
      role,
      units,
      share,
      change,
      ...engineColumns,
      status,
      firstSeen,
      lastSeen,
      citedWith,
      answers,
      prompts,
    ];
  }, [engines, meta, previousMeta, entities, citedRows, citedFailed, timeZone, t, locale]);
}
