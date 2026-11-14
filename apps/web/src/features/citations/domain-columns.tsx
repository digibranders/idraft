'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useMemo, type MouseEvent, type ReactElement } from 'react';

import type { CitationTableRow } from './domain-rows';
import { engineCell, type EngineInScope, type TableTranslate } from './engine-share';
import { DomainCell, DomainRoleBadge, type FaviconMode } from '@/components/app/cells/domain-cell';
import { URLCell } from '@/components/app/cells/url-cell';
import { col } from '@/components/app/data-table/columns';
import type { CellTip, DataTableColumn } from '@/components/app/data-table/types';
import { byEngineOrder } from '@/components/app/engine/order';
import { DeltaCell } from '@/components/app/metric/delta-cell';
import { SparklineCell } from '@/components/app/sparkline/sparkline-cell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TextLink } from '@/components/ui/text-link';
import { Truncate } from '@/components/ui/truncate';
import type { EntityRef } from '@/lib/api/types';
import { engineTotals, isNewSource, shareChange, unitShare, weeklyShare } from '@/lib/citations/share-model';
import type { SourceDomainRow, SourcePageRow, SourcesMeta } from '@/lib/citations/types';
import { EMPTY_VALUE, formatPercent } from '@/lib/format';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';
import type { Density } from '@/lib/tables/table-state';

/**
 * The columns of the Domains table (DS 9.7, plan T4a): Domain (a domain, one of its pages, "View all N pages"),
 * Role, Category, Units, Share, Change in share, one share column per engine, Answers, Prompts, Cited with, Status
 * and Trend. Every share carries its units (the tooltip says "1,912 of 18,420 units"), an unknown figure is n/a with
 * its reason and never 0, and the change in a share is never coloured: no test of it exists.
 */

/** One entity the project tracks, for the name behind "Cited with". */
export interface NamedEntity {
  entity: Pick<EntityRef, 'entity_id' | 'canonical_name'>;
}

export interface DomainColumnOptions {
  /** The engines in scope; with one the engine group collapses and Share is that engine's value. */
  engines: readonly EngineInScope[];
  /** `meta` of the scope read: the totals every share is of. */
  meta: SourcesMeta | undefined;
  /** `meta` of the period before, or `undefined` with the comparison off: the total a share change needs. */
  previousMeta: SourcesMeta | undefined;
  /** The project's entities, `undefined` while they load. */
  entities: readonly NamedEntity[] | undefined;
  density: Density;
  t: TableTranslate;
  locale: string;
  /** Where "View all N pages" goes: the Pages tab filtered to the domain, with the page's other keys kept. */
  moreHref: (registrable: string) => Route;
  /** Where a domain's name leads: its inspector. Without it the name is text (a page with no inspector). */
  domainHref?: ((registrable: string) => Route) | undefined;
  /** Where a page's path leads: its source inspector. Without it the path is the outbound link. */
  pageHref?: ((urlId: number) => Route) | undefined;
  /** Retry on the row that says a domain's pages could not be loaded; `parentId` is the domain's row id. */
  onRetryPages?: ((parentId: string) => void) | undefined;
}

// shortcut: the project setting for favicons does not exist yet (D16), so they always show; read it here when it does
const FAVICON: FaviconMode = 'show';

type Figures = SourceDomainRow | SourcePageRow;

/** The figures of a domain or a page row; `null` for a row that stands in for pages. */
const figuresOf = (row: CitationTableRow): Figures | null =>
  row.kind === 'domain' ? row.domain : row.kind === 'page' ? row.page : null;

/** What a row is called, for the table's names and its identity cell. */
export function rowNameOf(row: CitationTableRow, t: TableTranslate): string {
  switch (row.kind) {
    case 'domain':
      return row.domain.registrable_domain;
    case 'page':
      return row.page.url;
    case 'more':
      return t('viewAll', { count: row.total });
    case 'pages-loading':
      return t('pagesLoading');
    case 'pages-failed':
      return t('pagesFailed');
  }
}

/** A column that says nothing on the rows `keep` refuses: a share of "View all 48 pages" would be a lie. */
const onlyRows = (
  column: DataTableColumn<CitationTableRow>,
  keep: (row: CitationTableRow) => boolean,
): DataTableColumn<CitationTableRow> => ({
  ...column,
  cell: (row) => (keep(row) ? column.cell(row) : null),
  cellTip: (row) => (keep(row) ? column.cellTip?.(row) : undefined),
});
const onFigures = (column: DataTableColumn<CitationTableRow>): DataTableColumn<CitationTableRow> =>
  onlyRows(column, (row) => figuresOf(row) !== null);
const onDomains = (column: DataTableColumn<CitationTableRow>): DataTableColumn<CitationTableRow> =>
  onlyRows(column, (row) => row.kind === 'domain');

const stop = (event: MouseEvent): void => event.stopPropagation();
/** In a grid a link is a cell control, and a click on it is its own: the row does not open. */
const GRID_LINK = { ...CELL_CONTROL, onClick: stop, onAuxClick: stop };

const Missing = ({ children = EMPTY_VALUE }: { children?: string }): ReactElement => (
  <span className="text-foreground-tertiary">{children}</span>
);

/**
 * One row's weekly share. Its points are worked out again only when the series change, so the canvas is drawn
 * again only when the data does, not each time the table draws the row.
 */
function TrendCell({
  figures,
  metaSeries,
  label,
  density,
}: {
  figures: Figures;
  metaSeries: SourcesMeta['series'];
  label: string;
  density: Density;
}): ReactElement | null {
  const { series, domain_role: role } = figures;
  const values = useMemo(
    () => weeklyShare(series, metaSeries)?.map((week) => week.value) ?? null,
    [series, metaSeries],
  );
  if (values === null) return null;
  return (
    <SparklineCell
      values={values}
      label={label}
      kind="rate"
      tone={role === 'own' ? 'own' : 'reference'}
      density={density}
    />
  );
}

/** The columns of the Domains table. The caller keeps `moreHref`, `domainHref`, `pageHref` and `onRetryPages` stable between renders. */
export function useDomainColumns({
  engines,
  meta,
  previousMeta,
  entities,
  density,
  t,
  locale,
  moreHref,
  domainHref,
  pageHref,
  onRetryPages,
}: DomainColumnOptions): readonly DataTableColumn<CitationTableRow>[] {
  return useMemo(() => {
    const totals = meta === undefined ? null : engineTotals(meta);
    const names =
      entities === undefined ? null : new Map(entities.map(({ entity }) => [entity.entity_id, entity.canonical_name]));
    const percent = (value: number | null): string => formatPercent(value, { locale });

    const shareTip = (figures: Figures): string => {
      const { units, total } = unitShare(figures.source_share);
      return t('shareCell', { units, total });
    };
    const changeOf = (figures: Figures): ReturnType<typeof shareChange> =>
      meta === undefined ? null : shareChange(figures, meta, previousMeta);
    // Rows below the minimum are left out by the server, so a row's units always reach it
    const isNew = (figures: Figures): boolean => meta !== undefined && isNewSource(figures, meta, 0) === true;

    const identity = col.keyword<CitationTableRow>('domain', (row) => rowNameOf(row, t), {
      header: t('domain'),
      width: 280,
      minWidth: 200,
      sortable: false,
    });
    const domain: DataTableColumn<CitationTableRow> = {
      ...identity,
      // A page's copy and open buttons, "View all" and Retry: F2 reaches them from the cell
      hasControls: true,
      cellLabel: (row) => rowNameOf(row, t),
      cell: (row): ReactElement | null => {
        switch (row.kind) {
          case 'domain':
            return (
              <DomainCell
                host={row.domain.registrable_domain}
                registrable={row.domain.registrable_domain}
                favicon={FAVICON}
                href={domainHref?.(row.domain.registrable_domain)}
              />
            );
          case 'page':
            return (
              <URLCell
                url={row.page.url}
                hostDisplay="hide"
                label={t('urlLabel')}
                title={row.page.title}
                inspectorHref={pageHref?.(row.page.url_id)}
              />
            );
          case 'more':
            return (
              <TextLink render={<Link href={moreHref(row.registrable)} />} {...GRID_LINK}>
                {t('viewAll', { count: row.total })}
              </TextLink>
            );
          case 'pages-loading':
            return <Missing>{t('pagesLoading')}</Missing>;
          case 'pages-failed':
            return (
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-foreground-secondary">{t('pagesFailed')}</span>
                {onRetryPages === undefined ? null : (
                  <Button {...CELL_CONTROL} variant="link" size="sm" onClick={() => onRetryPages(row.parentId)}>
                    {t('retry')}
                  </Button>
                )}
              </span>
            );
        }
      },
    };

    // The role is a word in a badge. The value is only for the column's own bookkeeping: the cell draws the badge
    const role = onDomains({
      ...col.badge<CitationTableRow>(
        'role',
        (row) => (row.kind === 'domain' ? { label: row.domain.domain_role } : null),
        {
          header: t('role'),
          priority: 1,
          sortable: false,
        },
      ),
      cell: (row) => (row.kind === 'domain' ? <DomainRoleBadge role={row.domain.domain_role} /> : null),
    });

    const category = onDomains(
      col.text<CitationTableRow>('category', (row) => (row.kind === 'domain' ? (row.domain.category ?? null) : null), {
        header: t('category'),
        priority: 3,
        defaultVisible: false,
        sortable: false,
        unknown: () => ({ label: EMPTY_VALUE, tooltip: t('categoryNone') }),
      }),
    );

    const units = onFigures(
      col.count<CitationTableRow>('units', (row) => figuresOf(row)?.citation_units ?? null, {
        header: t('unitsShort'),
        headerTooltip: t('units'),
        priority: 1,
        sortable: false,
      }),
    );

    const share = onFigures(
      col.volumeTrend<CitationTableRow>(
        'share',
        (row) => {
          const figures = figuresOf(row);
          return figures === null ? null : unitShare(figures.source_share).value;
        },
        {
          header: t('shareShort'),
          ...(meta === undefined
            ? {}
            : { headerTooltip: t('shareScope', { units: meta.citation_units, answers: meta.answers }) }),
          priority: 1,
          sortable: false,
          unknown: (row) => {
            const figures = figuresOf(row);
            return { label: EMPTY_VALUE, ...(figures === null ? {} : { tooltip: shareTip(figures) }) };
          },
          known: (row, value) => <span className="num">{percent(value)}</span>,
          knownTip: (row): CellTip | undefined => {
            const figures = figuresOf(row);
            return figures === null ? undefined : { content: shareTip(figures) };
          },
        },
      ),
    );

    const change = onFigures(
      col.rankDelta<CitationTableRow>('change', () => null, {
        header: t('changeShort'),
        headerTooltip: t('change'),
        priority: 2,
        sortable: false,
        cell: (row) => {
          const figures = figuresOf(row);
          const moved = figures === null ? null : changeOf(figures);
          // No test of a source share's change exists, so it is never coloured; no comparison is n/a, never 0
          return (
            <DeltaCell
              input={{ value: moved?.delta ?? null, unit: 'points', polarity: 'neutral', isDetectable: null }}
              tip={false}
            />
          );
        },
        cellTip: (row): CellTip | undefined => {
          const figures = figuresOf(row);
          const moved = figures === null ? null : changeOf(figures);
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
      }),
    );

    // One engine in scope: the rows are already that engine's, so Share is its value and no group is drawn
    const engineColumns =
      engines.length < 2
        ? []
        : byEngineOrder(engines, (engine) => engine.code).map((engine) =>
            onFigures({
              ...col.count<CitationTableRow>(`engine-${engine.code}`, () => null, {
                header: engine.label,
                priority: 3,
                width: 112,
                sortable: false,
                group: { id: 'engines', label: t('engineGroup') },
              }),
              cell: (row) => {
                const figures = figuresOf(row);
                if (figures === null) return null;
                const cell = engineCell(figures, engine, totals, t, locale);
                return cell.state === 'share' ? <span className="num">{cell.text}</span> : <Missing />;
              },
              cellTip: (row): CellTip | undefined => {
                const figures = figuresOf(row);
                return figures === null ? undefined : { content: engineCell(figures, engine, totals, t, locale).tip };
              },
            }),
          );

    const answers = onFigures(
      col.count<CitationTableRow>('answers', (row) => figuresOf(row)?.observations ?? null, {
        header: t('answers'),
        priority: 4,
        defaultVisible: false,
        sortable: false,
      }),
    );
    const prompts = onFigures(
      col.count<CitationTableRow>('prompts', (row) => figuresOf(row)?.prompts ?? null, {
        header: t('prompts'),
        priority: 4,
        defaultVisible: false,
        sortable: false,
      }),
    );

    const namedOf = (row: SourceDomainRow): { name: string; count: number } | 'none' | 'unknown' => {
      const { cited_with: named } = row;
      if (named === undefined || named === null) return 'none';
      const name = names?.get(named.entity_id);
      return name === undefined ? 'unknown' : { name, count: named.observations };
    };
    const citedWith = onDomains({
      ...col.text<CitationTableRow>('citedWith', () => null, {
        header: t('citedWith'),
        priority: 3,
        width: 160,
        sortable: false,
      }),
      cell: (row) => {
        if (row.kind !== 'domain') return null;
        const named = namedOf(row.domain);
        if (named === 'none') return <Missing>{t('citedWithNone')}</Missing>;
        return named === 'unknown' ? <Missing /> : <Truncate text={named.name} />;
      },
      cellTip: (row): CellTip | undefined => {
        if (row.kind !== 'domain') return undefined;
        const named = namedOf(row.domain);
        if (named === 'none') return undefined;
        return {
          content:
            named === 'unknown' ? t('citedWithUnknown') : t('citedWithCell', { name: named.name, count: named.count }),
        };
      },
    });

    const status = onFigures({
      ...col.badge<CitationTableRow>('status', () => null, { header: t('status'), priority: 2, sortable: false }),
      cell: (row) => {
        const figures = figuresOf(row);
        return figures !== null && isNew(figures) ? <Badge variant="outline">{t('new')}</Badge> : null;
      },
      cellTip: (row): CellTip | undefined => {
        const figures = figuresOf(row);
        return figures !== null && isNew(figures)
          ? { content: t('newTip', { answers: meta?.previous_answers ?? 0 }) }
          : undefined;
      },
    });

    const trend = onFigures(
      col.sparkline<CitationTableRow>('trend', {
        header: t('trend'),
        priority: 2,
        width: 96,
        cell: (row) => {
          const figures = figuresOf(row);
          return figures === null ? null : (
            <TrendCell
              figures={figures}
              metaSeries={meta?.series}
              // The ten pages of a domain are told apart by their address, not by the domain they share
              label={
                row.kind === 'page'
                  ? t('trendLabelPage', { url: row.page.url })
                  : t('trendLabel', { domain: figures.registrable_domain })
              }
              density={density}
            />
          );
        },
      }),
    );

    return [domain, role, category, units, share, change, ...engineColumns, answers, prompts, citedWith, status, trend];
  }, [engines, meta, previousMeta, entities, density, t, locale, moreHref, domainHref, pageHref, onRetryPages]);
}
