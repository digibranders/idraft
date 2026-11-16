'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import { useSourceDomains } from './data/source-reads';
import { roleTiles, type RoleTiles } from './model/role-tiles';
import { useFrameState, type DataSituation } from './parts/frame-state';
import { footnoteLines, metaLine } from './parts/source-meta';
import { treemapOption, type TreemapTile } from './parts/treemap-option';
import { useCardExport } from '../engines/use-card-seams';
import type { Say } from '../say';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { EChart } from '@/components/app/chart/echart';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import type { CardProps } from '@/features/layouts';
import type { DomainInclude } from '@/lib/citations/source-queries';
import type { DomainRole } from '@/lib/citations/types';
import { safeText, type CsvTable } from '@/lib/csv/csv-write';
import { formatInteger, formatList, formatPercent } from '@/lib/format';
import type { ChartTokens } from '@/lib/design/read-tokens';

const ROLE_KEY = { own: 'own', competitor: 'competitor', third_party: 'thirdParty' } as const satisfies Record<
  DomainRole,
  string
>;

/** `chart-1` is the own brand's alone; a competitor takes `chart-2` and the rest the neutral colour (DS 15 5.2). */
const ROLE_SLOT: Readonly<Record<DomainRole, number | 'other'>> = { own: 0, competitor: 1, third_party: 'other' };

const NO_TILES: RoleTiles = { total: 0, tiles: [] };
const TREEMAP_HEIGHT = 232;
/** The read needs one row only: the units of each role are in the meta of any read. */
const NO_ROLES_INCLUDE: readonly DomainInclude[] = [];

/**
 * CH-16 and OV-CIT-03: how the citation units of the scope divide between your site, competitors and other sites, as
 * a treemap whose areas add up to all of them. The units of the platforms in scope are one pool (the API aggregates
 * them), so the footnote names the platforms. The preview's finer domain types (review sites, publishers, community)
 * need a type per domain that the API does not return yet (WP-60), so the areas are the roles.
 */
export default function RoleShareCard({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.sourcesTracking.domainTypes');
  const say = useTranslations('aiOverview.sources.common') as Say;
  const roleWords = useTranslations('common.domainCell.roles');
  const reads = useSourceDomains({ limit: 1, include: NO_ROLES_INCLUDE, subscribed: live });
  const page = reads.current.data;
  const { total, tiles } = useMemo((): RoleTiles => (page === undefined ? NO_TILES : roleTiles(page.meta)), [page]);

  const situation = ((): DataSituation => {
    if (reads.askable !== 'ok') return { kind: reads.askable };
    if (page === undefined) return { kind: 'ready' };
    if (page.meta.answers === 0) return { kind: 'no_answers' };
    return total === 0 ? { kind: 'no_citations', answers: page.meta.answers } : { kind: 'ready' };
  })();
  const state = useFrameState({
    subject: t('subject'),
    read: reads.current,
    previous: null,
    previousEmpty: false,
    situation,
  });
  // The preview's reason for a scope without a citation, in place of the family's wording of that one case
  const frame =
    state.status === 'empty' && situation.kind === 'no_citations'
      ? { ...state, empty: { title: t('emptyTitle'), reason: t('emptyReason') } }
      : state;

  const roleName = (role: DomainRole): string => roleWords(ROLE_KEY[role]);
  const shareText = (share: number): string => formatPercent(share, { decimals: 0 });
  const areas = useMemo(
    (): TreemapTile[] =>
      tiles
        .filter((tile) => tile.units > 0)
        .map((tile) => ({
          name: roleName(tile.role),
          value: tile.units,
          slot: ROLE_SLOT[tile.role],
          label: `${roleName(tile.role)}\n${shareText(tile.share)}`,
          tip: {
            title: roleName(tile.role),
            detail: t('tip', { units: tile.units, total, share: formatPercent(tile.share) }),
          },
        })),
    // `roleName` and `t` change with the language only
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tiles, total],
  );
  const option = useCallback((tokens: ChartTokens): Record<string, unknown> => treemapOption(areas, tokens), [areas]);

  const listed = formatList(tiles.map((tile) => `${roleName(tile.role)} ${shareText(tile.share)}`));
  const columns: PlainColumn<(typeof tiles)[number]>[] = [
    { id: 'type', header: t('typeHeader'), cell: (tile) => roleName(tile.role) },
    { id: 'units', header: t('unitsHeader'), cell: (tile) => formatInteger(tile.units) },
    { id: 'share', header: t('shareHeader'), cell: (tile) => formatPercent(tile.share) },
  ];
  const csv: CsvTable = {
    header: [t('typeHeader'), t('unitsHeader'), t('shareHeader')].map(safeText),
    rows: tiles.map((tile) => [safeText(roleName(tile.role)), tile.units, formatPercent(tile.share)]),
  };
  useCardExport(item.id, () =>
    frame.status === 'loading' || frame.status === 'error' ? null : { id: item.id, ...csv },
  );

  const shown = frame.status === 'ready' || frame.status === 'refetching';
  return (
    <ChartFrame
      kind="html"
      keepHeaderWhenEmpty
      variant="panel"
      height={240}
      title={t('title')}
      meta={shown ? t('meta') : null}
      info={{ what: t('infoWhat'), how: t('infoHow') }}
      summary={t('summary', { list: listed })}
      footnote={
        <div className="flex flex-col gap-1">
          <p>{t('footnote')}</p>
          {page === undefined ? null : <p>{metaLine(page.meta, say)}</p>}
          {/* The pooling and the flagged citations apply; the minimum of the domain list does not */}
          {page === undefined
            ? null
            : footnoteLines(page.meta, say, 0)
                .slice(0, 2)
                .map((line) => <p key={line}>{line}</p>)}
        </div>
      }
      menu={{ fileName: t('fileName'), csv }}
      body={
        <div role="img" aria-label={t('ariaLabel', { list: listed })} data-slot="domain-type-treemap">
          <EChart option={option} height={TREEMAP_HEIGHT} />
        </div>
      }
      table={
        <PlainTable<(typeof tiles)[number]>
          caption={t('caption')}
          columns={columns}
          rows={tiles}
          rowKey={(tile) => tile.role}
          status="ready"
          errorState={null}
          emptyText={t('emptyTitle')}
        />
      }
      {...frame}
    />
  );
}
