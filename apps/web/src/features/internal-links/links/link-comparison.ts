'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { readChangeLinks } from '../changes/change-links-panel';
import type { LinksTabContext } from '../tabs';
import { sinceText } from '@/lib/internal-links/changes-format';
import { changeLinksQuery, changesSummaryQuery, crawlsQuery, CRAWL_SCREEN_LIMIT } from '@/lib/internal-links/queries';

/** The added links one read takes (the API's limit for this list). */
export const ADDED_READ_LIMIT = 200;

export interface LinkComparison {
  /** `loading` until the summary answers; `none` for a first crawl, a comparison that failed, or a failed read. */
  state: 'loading' | 'none' | 'compares';
  /** Whether the earlier crawl kept its links; `null` when the crawl list has not said. */
  previousStored: boolean | null;
  /** The earlier crawl's date as the Changes tab words it ("7 Nov"), "none" when it has none. */
  previousDate: string;
}

/**
 * Whether the crawl in view has an earlier crawl to compare its links with (the changes summary: `ready` and `pending`
 * compare) and whether that crawl still holds its links (the crawl list). The Status menu, the Added column and the
 * Lost view exist only for a comparison.
 */
export function useLinkComparison(context: LinksTabContext): LinkComparison {
  const { scope, crawl } = context;
  const summary = useQuery(changesSummaryQuery(scope, crawl.run));
  // The crawl list is the screen's own read, so it is one request
  const crawls = useQuery(crawlsQuery(scope, CRAWL_SCREEN_LIMIT));
  const data = summary.data?.data;
  if (summary.isPending) return { state: 'loading', previousStored: null, previousDate: 'none' };
  if (data === undefined || (data.state !== 'ready' && data.state !== 'pending')) {
    return { state: 'none', previousStored: null, previousDate: 'none' };
  }
  const previous = crawls.data?.data.find((run) => run.run_id === data.previous_run_id);
  return {
    state: 'compares',
    previousStored: previous?.links_available ?? null,
    previousDate: sinceText(data.previous_finished_at, context.timeZone) ?? 'none',
  };
}

export interface AddedMarks {
  /** `source>target` of the added links read, by url ids. */
  pairs: ReadonlySet<string>;
  /** Added links the API holds in all. */
  total: number;
  /** More added links exist than were read: a link missing from `pairs` may still be new. */
  capped: boolean;
  failed: boolean;
}

const NONE: AddedMarks = { pairs: new Set(), total: 0, capped: false, failed: false };
export const pairOf = (sourceId: string, targetId: string): string => `${sourceId}>${targetId}`;

/**
 * The first `ADDED_READ_LIMIT` added links of the crawl (the edge rows carry no added flag), to mark the rows of the
 * Links table. A row not in the list is never called "not added": the header says when the list was cut short.
 */
export function useAddedMarks(context: LinksTabContext, enabled: boolean): AddedMarks {
  const { scope, crawl } = context;
  const read = useQuery({
    ...changeLinksQuery(
      scope,
      { change: 'added', linkScope: 'all', only: 'all', offset: 0, limit: ADDED_READ_LIMIT },
      crawl.run,
    ),
    enabled,
    select: readChangeLinks,
  });
  const page = read.data;
  return useMemo(() => {
    if (!enabled) return NONE;
    if (page === undefined) return { ...NONE, failed: read.isError };
    return {
      pairs: new Set(page.data.map((link) => pairOf(link.source.url_id, link.target.url_id))),
      total: page.meta.total,
      capped: page.meta.total > page.data.length,
      failed: false,
    };
  }, [enabled, page, read.isError]);
}
