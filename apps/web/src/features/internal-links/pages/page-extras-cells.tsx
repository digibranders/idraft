import type { ReactNode } from 'react';

import type { LinksTranslate } from '../tabs';
import type { CellTip, DataTableColumn } from '@/components/app/data-table/types';
import { Badge } from '@/components/ui/badge';
import { EMPTY_VALUE, formatDecimal, formatInteger, formatPercent } from '@/lib/format';
import { changeParts, type Comparison, type DepthPart } from '@/lib/internal-links/page-extras';
import type { PageRow } from '@/lib/internal-links/types';
import { cn } from '@/lib/utils';

type Column = DataTableColumn<PageRow>;

/** What the cells of the extra columns need beyond the row. */
export interface ExtrasContext {
  comparison: Comparison;
  /** False for a crawl past the last four: its anchors are not stored. */
  linksAvailable: boolean;
  /** The date of the crawl in view when it is not the latest, for the note under the Today columns; otherwise `null`. */
  olderCrawlDate?: string | null;
}

/** The header tip of a Today column: what it measures, and when the crawl in view is older, that its date differs. */
function todayTip(t: LinksTranslate, tip: string, context: ExtrasContext): string {
  const date = context.olderCrawlDate ?? null;
  return date === null ? tip : `${tip} ${t('columns.olderCrawlNote', { date })}`;
}

/** More than half of the editorial anchors generic reads as a warning, as the flag does. */
const GENERIC_WARN_SHARE = 0.5;
const TONE_CLASS = {
  positive: 'text-positive-text',
  negative: 'text-negative-text',
  warning: 'text-warning-text',
  neutral: 'text-foreground-tertiary',
} as const;

const muted = (text: string): ReactNode => <span className="type-table text-foreground-tertiary">{text}</span>;
const numeric = (text: string, tone: keyof typeof TONE_CLASS | null = null): ReactNode => (
  <span className={cn('num type-table', tone === null ? 'text-foreground' : TONE_CLASS[tone])}>{text}</span>
);

function depthText(t: LinksTranslate, depth: DepthPart): string {
  switch (depth.state) {
    case 'lost':
      return t('columns.depthLost');
    case 'found':
      return t('columns.depthFound');
    case 'closer':
      return t('columns.depthCloser', { count: depth.levels });
    case 'deeper':
      return t('columns.depthDeeper', { count: depth.levels });
  }
}

/** The Change column's cell: links in with a sign, a new page, the depth move, or why there is no figure. */
function changeCell(t: LinksTranslate, row: PageRow, context: ExtrasContext): ReactNode {
  const change = row.extras?.change;
  // The part was not asked for or has not arrived: nothing is drawn, and never a zero
  if (change === undefined) return null;
  if (change === null) {
    if (context.comparison === 'updating') return muted(t('columns.changeUpdating'));
    return muted(EMPTY_VALUE);
  }
  const parts = changeParts(change);
  if (parts.kind === 'none') return null;
  if (parts.kind === 'new') return <Badge tone="neutral">{t('columns.changeNew')}</Badge>;
  if (parts.links !== null) return numeric(parts.links.text, parts.links.tone);
  return parts.depth === null ? null : (
    <span className="truncate type-table text-foreground-secondary">{depthText(t, parts.depth)}</span>
  );
}

function changeTip(t: LinksTranslate, row: PageRow, context: ExtrasContext): CellTip | undefined {
  const change = row.extras?.change;
  if (change === undefined) return undefined;
  if (change === null) {
    if (context.comparison === 'first_crawl') return { content: t('columns.changeNoEarlier') };
    if (context.comparison === 'updating') return { content: t('columns.changeUpdatingTip') };
    return { content: t('columns.changeUnavailableTip') };
  }
  const parts = changeParts(change);
  if (parts.kind !== 'moved') return undefined;
  const lines = [
    parts.links === null ? null : t('columns.changeLinksTip', { text: parts.links.text }),
    parts.depth === null ? null : depthText(t, parts.depth),
  ].filter((line): line is string => line !== null);
  const [first, ...rest] = lines;
  return first === undefined
    ? undefined
    : { content: first, ...(rest.length === 0 ? {} : { detail: rest.join('. ') }) };
}

/** A Search Console figure: the number, or why there is none. */
function gscCell(t: LinksTranslate, row: PageRow, field: 'clicks' | 'impressions'): ReactNode {
  const gsc = row.extras?.gsc;
  if (gsc === undefined || gsc === null) return null;
  if (gsc.state === 'pending') return muted(t('columns.syncing'));
  if (gsc.state === 'not_connected') return muted(t('columns.notConnected'));
  const value = gsc[field];
  return value === null ? muted(EMPTY_VALUE) : numeric(formatInteger(value));
}

function gscTip(t: LinksTranslate, row: PageRow): CellTip | undefined {
  const state = row.extras?.gsc?.state;
  if (state === 'pending') return { content: t('columns.syncingTip') };
  if (state === 'not_connected') return { content: t('columns.notConnectedTip') };
  return undefined;
}

/** The anchors extras are null or have no distinct count when the crawl no longer holds its links. */
const asked = (row: PageRow): boolean => row.extras?.anchors !== undefined;
const anchorsStored = (row: PageRow, context: ExtrasContext): boolean =>
  context.linksAvailable && row.extras?.anchors !== null && row.extras?.anchors?.distinct !== null;

function anchorsCell(t: LinksTranslate, row: PageRow, context: ExtrasContext): ReactNode {
  // The part is not in the row yet (the chooser just turned it on): nothing is drawn
  if (!asked(row)) return null;
  const anchors = row.extras?.anchors;
  if (!anchorsStored(row, context) || anchors === null || anchors === undefined || anchors.distinct === null) {
    return muted(t('columns.notStored'));
  }
  if (anchors.total === 0) return muted(EMPTY_VALUE);
  return (
    <span
      className={cn(
        'truncate num type-table',
        anchors.generic_share > GENERIC_WARN_SHARE ? 'text-warning-text' : 'text-foreground',
      )}
    >
      {t('columns.anchorsValue', {
        count: anchors.distinct,
        share: formatPercent(anchors.generic_share, { decimals: 0 }),
      })}
    </span>
  );
}

function matchesCell(t: LinksTranslate, row: PageRow, context: ExtrasContext): ReactNode {
  if (!asked(row)) return null;
  if (!anchorsStored(row, context)) return muted(t('columns.notStored'));
  const match = row.extras?.anchors?.matches_keyword;
  if (match === null || match === undefined) return muted(t('columns.noKeywords'));
  return <span className="type-table text-foreground">{match ? t('columns.yes') : t('columns.no')}</span>;
}

/**
 * The optional columns that read a row's `extras`: Change (on by default), tracked keywords, average rank, AI
 * citations, anchors, anchor match and the Search Console figures. No column shows link strength or equity.
 * Only Change sorts, because the API sorts by it alone.
 */
export function extraColumns(
  t: LinksTranslate,
  context: ExtrasContext,
  custom: (
    id: string,
    type: Column['type'],
    header: string,
    cell: (row: PageRow) => ReactNode,
    extra?: Partial<Column>,
  ) => Column,
): { change: Column; optional: Column[] } {
  const hidden = { defaultVisible: false };
  const googleTip = t('columns.googleTip');
  const change = custom('change', 'count', t('columns.change'), (row) => changeCell(t, row, context), {
    headerTooltip: t('columns.changeTip'),
    width: 144,
    sortValue: (row) => row.extras?.change?.editorial_in_delta ?? null,
    cellTip: (row) => changeTip(t, row, context),
  });
  const optional = [
    custom(
      'keywords',
      'count',
      t('columns.keywords'),
      (row) => (row.extras?.keywords ? numeric(formatInteger(row.extras.keywords.tracked)) : null),
      { ...hidden, headerTooltip: t('columns.keywordsTip'), width: 128 },
    ),
    custom(
      'rank',
      'count',
      t('columns.rank'),
      (row) => {
        const keywords = row.extras?.keywords;
        if (keywords === undefined || keywords === null) return null;
        return keywords.average_rank === null ? muted(EMPTY_VALUE) : numeric(formatDecimal(keywords.average_rank, 1));
      },
      {
        ...hidden,
        headerTooltip: todayTip(t, t('columns.rankTip'), context),
        width: 128,
        sortValue: (row) => row.extras?.keywords?.average_rank ?? null,
      },
    ),
    custom(
      'citations',
      'count',
      t('columns.citations'),
      (row) => (row.extras?.citations ? numeric(formatInteger(row.extras.citations.total)) : null),
      {
        ...hidden,
        headerTooltip: todayTip(t, t('columns.citationsTip'), context),
        width: 120,
        sortValue: (row) => row.extras?.citations?.total ?? null,
        cellTip: (row) => {
          const citations = row.extras?.citations;
          return citations === undefined || citations === null
            ? undefined
            : {
                content: t('columns.citationsBreakdown', {
                  chatgpt: citations.chatgpt,
                  gemini: citations.gemini,
                  aiMode: citations.ai_mode,
                }),
              };
        },
      },
    ),
    custom('anchors', 'text', t('columns.anchors'), (row) => anchorsCell(t, row, context), {
      ...hidden,
      headerTooltip: t('columns.anchorsTip'),
      width: 192,
      sortValue: (row) => row.extras?.anchors?.distinct ?? null,
      cellTip: (row) =>
        asked(row) && !anchorsStored(row, context) ? { content: t('columns.notStoredTip') } : undefined,
    }),
    custom('matches', 'text', t('columns.matches'), (row) => matchesCell(t, row, context), {
      ...hidden,
      headerTooltip: t('columns.matchesTip'),
      width: 168,
    }),
    custom('clicks', 'count', t('columns.clicks'), (row) => gscCell(t, row, 'clicks'), {
      ...hidden,
      headerTooltip: googleTip,
      width: 120,
      sortValue: (row) => row.extras?.gsc?.clicks ?? null,
      cellTip: (row) => gscTip(t, row),
    }),
    custom('impressions', 'count', t('columns.impressions'), (row) => gscCell(t, row, 'impressions'), {
      ...hidden,
      headerTooltip: googleTip,
      width: 136,
      cellTip: (row) => gscTip(t, row),
    }),
  ];
  return { change, optional };
}
