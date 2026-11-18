'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { CitedDomains, NewBadge, TimesUsed } from './query-parts';
import { RefetchBar } from '@/components/app/status/refetch-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  rowKey,
  timesUsedOf,
  type EngineCode,
  type FanoutMeta,
  type FanoutQueryRow,
  type NewVerdict,
} from '@/lib/fanout';
import { formatTableDate } from '@/lib/format';

const SKELETON_ROWS = 4;
/** Widths of the query line of the skeleton rows, so they do not read as a table. */
const SKELETON_WIDTHS = [80, 64, 72, 56] as const;

export interface FanoutQueryListProps {
  rows: readonly FanoutQueryRow[];
  /** The queries the route counted: more than `rows` when the list is cut. */
  total: number;
  /** `answers` is the denominator of "times used": the valid answers read on the rows' engine. */
  meta: Pick<FanoutMeta, 'answers'>;
  labelOf: (code: EngineCode) => string;
  timeZone: string;
  /** Which rows are new; while it is unknown no row carries the badge. */
  newVerdict: NewVerdict;
  /** The days of the window, for the tip of the badge. */
  windowDays: number;
  /** The prompts count of a row; left out where the list is already of one prompt. */
  showPrompts: boolean;
  status: 'loading' | 'ready' | 'refetching';
  /** Under the meta line of a row: where WP-57 adds its retrieval columns, without editing this list (plan D9). */
  renderExtra?: ((row: FanoutQueryRow) => ReactNode) | undefined;
  /** The domain's inspector, where the page has one. */
  hrefOf?: ((registrable: string) => Route | undefined) | undefined;
  /** Asks for the next size. Offered only while the list is cut. */
  onShowMore?: (() => void) | undefined;
}

/**
 * The fan-out queries as a stacked list (plan D7): a 440 px aside cannot hold four columns of provider text, so each
 * query is a row of three lines (the query, how often it was used, its prompts and last seen with the domains cited
 * beside it). A row has no action of its own: a query has no inspector to open, so it is no button and no link. The
 * list sorts and searches nothing: the route orders it by the answers that issued each query.
 */
export function FanoutQueryList({
  rows,
  total,
  meta,
  labelOf,
  timeZone,
  newVerdict,
  windowDays,
  showPrompts,
  status,
  renderExtra,
  hrefOf,
  onShowMore,
}: FanoutQueryListProps): ReactElement {
  const t = useTranslations('fanout');
  const list = useTranslations('common.dataTableList');
  if (status === 'loading') {
    return (
      <div role="status" aria-busy="true" aria-label={list('loading', { caption: t('itemNoun.other') })}>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div key={index} aria-hidden="true" className="flex flex-col gap-1.5 border-b border-border-subtle py-3">
            <Skeleton shape="text-14" widthPct={SKELETON_WIDTHS[index] ?? 64} />
            <Skeleton shape="text-13" widthPct={48} />
          </div>
        ))}
      </div>
    );
  }
  const cut = total > rows.length;
  const anyCited = rows.some((row) => row.cited_domains.length > 0);
  return (
    <div className="relative flex flex-col gap-2">
      <RefetchBar active={status === 'refetching'} position="under-section-heading" />
      {/* The sentence is the same for every row, so it is said once. It is not in the popover, which has no room for it */}
      {anyCited ? <p className="type-meta text-foreground-secondary">{t('citedAssociation')}</p> : null}
      <ul
        aria-label={list('label', { caption: t('caption'), count: rows.length })}
        aria-busy={status === 'refetching' ? true : undefined}
        className="flex flex-col divide-y divide-border-subtle"
      >
        {rows.map((row) => {
          const used = timesUsedOf(row, meta);
          const engineLabel = labelOf(used.engine);
          const isNew = newVerdict.kind === 'known' && newVerdict.newKeys.has(rowKey(row));
          return (
            <li key={rowKey(row)} className="flex flex-col gap-1 py-3">
              {/* Provider text: React text, never markup or a link, and its own direction */}
              <p dir="auto" className="type-body wrap-anywhere">
                {row.query_text}
              </p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 type-meta">
                <TimesUsed count={used.count} total={used.total} engineLabel={engineLabel} />
                {isNew ? <NewBadge firstSeen={row.first_seen_at} days={windowDays} timeZone={timeZone} /> : null}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 type-meta text-foreground-secondary">
                {showPrompts ? <span className="num">{t('promptsCount', { count: row.prompts })}</span> : null}
                <span className="flex items-center gap-1">
                  <span>{t('columns.lastSeen')}</span>
                  <time dateTime={row.last_seen_at} className="num">
                    {formatTableDate(row.last_seen_at, timeZone)}
                  </time>
                </span>
                <span className="flex items-center gap-1">
                  {row.cited_domains.length === 0 ? null : <span>{t('columns.cited')}</span>}
                  <CitedDomains domains={row.cited_domains} context="list" hrefOf={hrefOf} />
                </span>
              </div>
              {renderExtra?.(row)}
            </li>
          );
        })}
      </ul>
      {cut ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="num type-meta">{t('showing', { shown: rows.length, total })}</p>
          {onShowMore === undefined ? null : (
            <Button variant="secondary" size="sm" onClick={onShowMore}>
              {t('showMore')}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
