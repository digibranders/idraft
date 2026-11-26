'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { CardLegend, CardRowsTable, type CardRow } from './card-rows';
import {
  BarList,
  type BarListProps,
  type BarScaleColor,
  type ComparisonRow,
  type DistributionRow,
} from '@/components/app/chart/bar-list';
import { ChartFrame, type ChartEmpty, type ChartHeight } from '@/components/app/chart/chart-frame';
import { RingsChart } from '@/components/app/chart/rings-chart';
import { StackedShareBar, type ShareColor, type ShareRow } from '@/components/app/chart/stacked-share-bar';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { formatInteger, formatList, formatPercent } from '@/lib/format';
import type { OverviewModel, OverviewRow } from '@/lib/pages/overview-model';

export interface OverviewCardsProps {
  /** `null` while the read loads: every card draws its loading state. */
  model: OverviewModel | null;
  refetching: boolean;
}

type FrameStatus = { status: 'loading' | 'ready' | 'refetching' } | { status: 'empty'; empty: ChartEmpty };

const statusOf = (model: OverviewModel | null, refetching: boolean): FrameStatus => ({
  status: model === null ? 'loading' : refetching ? 'refetching' : 'ready',
});

/** The colours of the status groups, in the order of the ring: tokens of the chart palette only. */
const STATUS_TOKENS = {
  live: 'chart-2',
  variant: 'chart-3',
  redirected: 'chart-4',
  client_error: 'chart-5',
  server_error: 'chart-6',
  blocked: 'chart-other',
  other: 'chart-bar-neutral',
} as const;
const STATUS_RING = 'status';
/** The model's ids are the API's words (`client_error`); the message keys are camelCase. */
const camel = (id: string): string => id.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
const SWATCH: Record<string, string> = {
  'chart-2': 'bg-chart-2',
  'chart-3': 'bg-chart-3',
  'chart-4': 'bg-chart-4',
  'chart-5': 'bg-chart-5',
  'chart-6': 'bg-chart-6',
  'chart-other': 'bg-chart-other',
  'chart-bar-neutral': 'bg-chart-bar-neutral',
};
const SITEMAP_COLORS = {
  in_sitemap_indexable: 'chart-2',
  not_in_sitemap: 'chart-3',
  sitemap_not_live: 'chart-4',
  sitemap_not_indexable: 'chart-5',
} as const satisfies Record<string, ShareColor>;

/** A model row in words: the count, its share, what its hover says and the link its mark opens. */
function useCardRow(): (row: OverviewRow, label: string, swatchToken?: string) => CardRow {
  const t = useTranslations('pages.cards');
  return (row, label, swatchToken) => {
    const countText = formatInteger(row.count);
    const shareText = row.share === null ? '' : formatPercent(row.share);
    return {
      id: row.id,
      label,
      countText,
      shareText,
      tip:
        shareText === ''
          ? undefined
          : t(row.base === 'addresses' ? 'shareOfAddresses' : 'shareOfLive', { share: shareText }),
      href: row.href ?? undefined,
      accessibleText: row.href === null ? `${label}, ${countText}` : t('opens', { label, count: countText }),
      swatch: swatchToken === undefined ? undefined : SWATCH[swatchToken],
    };
  };
}

/** A bar of a list: the count is the length, the share is its context. */
const barOf = (row: OverviewRow, card: CardRow): Omit<ComparisonRow, 'own'> => ({
  id: card.id,
  label: card.label,
  value: {
    kind: 'value',
    value: row.count,
    valueText: card.countText,
    contextText: card.shareText === '' ? null : card.shareText,
  },
  accessibleText: card.accessibleText,
  tip: card.tip,
  href: card.href,
});

interface Pair {
  row: OverviewRow;
  card: CardRow;
}

function useSummary(title: string, pairs: readonly Pair[]): string {
  const t = useTranslations('pages.cards');
  return t('summary', { title, rows: formatList(pairs.map(({ card }) => `${card.label} ${card.countText}`)) });
}

interface BarCardProps extends OverviewCardsProps {
  title: string;
  info: string;
  how: string;
  height: ChartHeight;
  /** The rows a list of this card has room for while it loads. */
  loadingHeight: number;
  pairs: readonly Pair[];
  /** `distribution` gives each row its own colour; `comparison` draws every bar in the neutral one. */
  scales?: Readonly<Record<string, BarScaleColor>> | undefined;
  icons?: Readonly<Record<string, ReactElement>> | undefined;
}

/** One `BarList` card (2 to 5): the frame, the list with its links, and the same rows as a table. */
function BarCard({
  model,
  refetching,
  title,
  info,
  how,
  height,
  loadingHeight,
  pairs,
  scales,
  icons,
}: BarCardProps): ReactElement {
  const t = useTranslations('pages.cards.table');
  const summary = useSummary(title, pairs);
  const base = {
    caption: title,
    labelHeader: t('row'),
    valueHeader: t('pages'),
    contextHeader: t('share'),
    limit: pairs.length,
  };
  const list: BarListProps =
    scales === undefined
      ? {
          ...base,
          mode: 'comparison',
          rows: pairs.map(({ row, card }): ComparisonRow => ({
            ...barOf(row, card),
            own: false,
            icon: icons?.[card.id],
          })),
        }
      : {
          ...base,
          mode: 'distribution',
          rows: pairs.map(({ row, card }): DistributionRow => ({
            ...barOf(row, card),
            scale: scales[card.id] ?? 'seq-5',
            icon: icons?.[card.id],
          })),
        };
  return (
    <ChartFrame
      kind="html"
      variant="panel"
      title={title}
      height={height}
      loadingHeight={loadingHeight}
      fitContent
      info={{ what: info, how }}
      summary={summary}
      body={<BarList {...list} />}
      table={<CardRowsTable caption={title} rows={pairs.map(({ card }) => card)} />}
      {...statusOf(model, refetching)}
    />
  );
}

/** Card 1: one ring of every status group that is not 0, its live count in the middle, and the groups as links. */
export function StatusCard({ model, refetching }: OverviewCardsProps): ReactElement {
  const t = useTranslations('pages.cards');
  const toRow = useCardRow();
  const pairs: Pair[] =
    model === null
      ? []
      : model.status.map((row) => ({
          row,
          card: toRow(
            row,
            t(
              `status.rows.${camel(row.id) as 'live' | 'variant' | 'redirected' | 'clientError' | 'serverError' | 'blocked' | 'other'}`,
            ),
            STATUS_TOKENS[row.id as keyof typeof STATUS_TOKENS],
          ),
        }));
  // A group of 0 has no segment and no legend row; the table keeps it
  const drawn = pairs.filter(({ row }) => row.count > 0);
  const title = t('status.title');
  const live = model?.status.find((row) => row.id === 'live')?.count ?? 0;
  const summary = useSummary(title, pairs);
  return (
    <ChartFrame
      kind="html"
      variant="panel"
      title={title}
      height={180}
      loadingHeight={360}
      info={{ what: t('status.info'), how: t('bases.addresses') }}
      summary={summary}
      body={
        <div className="flex flex-col gap-2">
          <RingsChart
            label={title}
            height={180}
            names={false}
            emphasis
            segments={drawn.map(({ row, card }) => ({
              id: row.id,
              name: card.label,
              token: STATUS_TOKENS[row.id as keyof typeof STATUS_TOKENS],
            }))}
            rows={[
              {
                id: STATUS_RING,
                label: title,
                center: t('status.center', { count: formatInteger(live) }),
                shares: drawn.length === 0 ? null : drawn.map(({ row }) => row.share ?? 0),
                tips: drawn.map(({ card }) => (card.tip === undefined ? card.label : `${card.label}: ${card.tip}`)),
              },
            ]}
          />
          <CardLegend caption={title} rows={drawn.map(({ card }) => card)} />
        </div>
      }
      table={<CardRowsTable caption={title} rows={pairs.map(({ card }) => card)} />}
      {...statusOf(model, refetching)}
    />
  );
}

/** Card 2: addresses, live pages, indexable and, with a sitemap, indexable and in it, on one scale. */
export function FunnelCard(props: OverviewCardsProps): ReactElement {
  const t = useTranslations('pages.cards');
  const toRow = useCardRow();
  const pairs = (props.model?.funnel ?? []).map((row) => ({
    row,
    card: toRow(row, t(`funnel.rows.${camel(row.id) as 'addresses' | 'live' | 'indexable' | 'inSitemapIndexable'}`)),
  }));
  return (
    <BarCard
      {...props}
      title={t('funnel.title')}
      info={t('funnel.info')}
      how={t('bases.mixed')}
      height={180}
      loadingHeight={180}
      pairs={pairs}
    />
  );
}

/** Card 3: the largest sections and the rest folded into one row that opens nothing. */
export function SectionsCard(props: OverviewCardsProps): ReactElement {
  const t = useTranslations('pages.cards');
  const toRow = useCardRow();
  const pairs = (props.model?.sections ?? []).map((row) => ({
    row,
    card: toRow(row, row.folded === undefined ? row.id : t('sections.other', { count: row.folded })),
  }));
  return (
    <BarCard
      {...props}
      title={t('sections.title')}
      info={t('sections.info')}
      how={t('bases.live')}
      height={280}
      loadingHeight={360}
      pairs={pairs}
    />
  );
}

/** Card 4: live pages by tier, each row with its tier badge. */
export function TiersCard(props: OverviewCardsProps): ReactElement {
  const t = useTranslations('pages.cards');
  const badge = useTranslations('tierBadge');
  const toRow = useCardRow();
  const pairs = (props.model?.tiers ?? []).map((row) => ({
    row,
    // The badge beside the row carries the code, so the label is the tier's name
    card: toRow(row, row.tier === null || row.tier === undefined ? badge('untiered') : row.tier.name),
  }));
  const icons = Object.fromEntries(
    (props.model?.tiers ?? []).map((row) => [row.id, <TierBadge key={row.id} tier={row.tier ?? null} />]),
  );
  return (
    <BarCard
      {...props}
      title={t('tiers.title')}
      info={t('tiers.info')}
      how={t('bases.live')}
      height={240}
      loadingHeight={280}
      pairs={pairs}
      icons={icons}
    />
  );
}

/** Card 5: clicks from the home page, then the pages no link reaches in the warning colour. */
export function DepthCard(props: OverviewCardsProps): ReactElement {
  const t = useTranslations('pages.cards');
  const toRow = useCardRow();
  const pairs = (props.model?.depth ?? []).map((row) => ({
    row,
    card: toRow(
      row,
      row.id === 'unreachable'
        ? t('depth.unreachable')
        : t('depth.row', { depth: Number(row.id.replace('depth_', '')) }),
    ),
  }));
  const scales = Object.fromEntries(
    pairs.map(({ row }) => [row.id, row.tone === 'warning' ? 'warning' : 'seq-5']),
  ) as Record<string, BarScaleColor>;
  return (
    <BarCard
      {...props}
      title={t('depth.title')}
      info={t('depth.info')}
      how={t('bases.live')}
      height={280}
      loadingHeight={320}
      pairs={pairs}
      scales={scales}
    />
  );
}

/** Card 6: the four sitemap groups as one stacked bar with its legend; with no sitemap, its empty state. */
export function SitemapCard({ model, refetching }: OverviewCardsProps): ReactElement {
  const t = useTranslations('pages.cards');
  const toRow = useCardRow();
  const title = t('sitemap.title');
  const rows = model?.sitemap ?? null;
  const pairs: Pair[] = (rows ?? []).map((row) => ({
    row,
    card: toRow(
      row,
      t(
        `sitemap.rows.${camel(row.id) as 'inSitemapIndexable' | 'notInSitemap' | 'sitemapNotLive' | 'sitemapNotIndexable'}`,
      ),
      SITEMAP_COLORS[row.id as keyof typeof SITEMAP_COLORS],
    ),
  }));
  const total = pairs.reduce((sum, { row }) => sum + row.count, 0);
  const segments = pairs.map(({ row, card }) => ({
    id: row.id,
    name: card.label,
    color: SITEMAP_COLORS[row.id as keyof typeof SITEMAP_COLORS],
  }));
  const shareRow: ShareRow = {
    id: 'sitemap',
    label: title,
    denominatorText: t('sitemap.bases'),
    value: {
      kind: 'shares',
      // The bar's lengths are the groups' counts side by side; the words are each group's own share and base
      cells: pairs.map(({ row, card }) => ({
        segmentId: row.id,
        share: total === 0 ? 0 : row.count / total,
        shareText: card.shareText === '' ? card.countText : card.shareText,
        countText: card.countText,
      })),
    },
  };
  const summary = useSummary(title, pairs);
  const frame: FrameStatus =
    model !== null && rows === null
      ? { status: 'empty', empty: { title: t('sitemap.emptyTitle'), reason: t('sitemap.emptyReason') } }
      : statusOf(model, refetching);
  return (
    <ChartFrame
      kind="html"
      variant="panel"
      title={title}
      height={180}
      loadingHeight={280}
      keepHeaderWhenEmpty
      info={{ what: t('sitemap.info'), how: t('bases.mixed') }}
      summary={summary}
      patterns
      body={({ patterns }) => (
        <div className="flex flex-col gap-2">
          <StackedShareBar
            caption={title}
            segments={segments}
            rows={[shareRow]}
            segmentHeader={t('table.row')}
            patterns={patterns}
          />
          <CardLegend caption={title} rows={pairs.map(({ card }) => card)} />
        </div>
      )}
      table={<CardRowsTable caption={title} rows={pairs.map(({ card }) => card)} />}
      {...frame}
    />
  );
}

/** The six cards of the Overview, in the order of the spec. */
export function OverviewCards(props: OverviewCardsProps): ReactElement {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-4">
      <StatusCard {...props} />
      <FunnelCard {...props} />
      <SectionsCard {...props} />
      <TiersCard {...props} />
      <DepthCard {...props} />
      <SitemapCard {...props} />
    </div>
  );
}
