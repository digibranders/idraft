import type { QueryClient } from '@tanstack/react-query';

import { formatLocaleDate } from '@/lib/format';
import { isLinksDropped } from '@/lib/internal-links/contract-states';
import type { CrawlInView } from '@/lib/internal-links/crawl-choice';
import {
  changeLinksQuery,
  changesSummaryQuery,
  crawlsQuery,
  CRAWL_SCREEN_LIMIT,
  isChangeLinkPage,
  tierFlowQuery,
  worklistsQuery,
} from '@/lib/internal-links/queries';
import {
  clientSummaryHtml,
  type ClientSummaryInput,
  type ClientSummaryWords,
  type LostReason,
} from '@/lib/internal-links/client-summary';
import { tierLabel, tierPosition } from '@/lib/internal-links/tiers';
import type { LinksScope, TierRef, Worklists } from '@/lib/internal-links/types';

/** The most lost links one read takes (the API's limit for this list). */
const LOST_READ_LIMIT = 200;

/** The worklists the summary counts, in its order; each is a count of pages or links of the crawl. */
export const SUMMARY_WORKLISTS = [
  'under_linked_t1',
  'orphans',
  'editorial_orphans',
  'deep_only_through_auto',
  'broken_and_redirected',
  'links_to_non_indexable',
  'weak_outlinks',
] as const satisfies readonly (keyof Worklists)[];
export type SummaryWorklist = (typeof SUMMARY_WORKLISTS)[number];
/** The counts that read pages and links of a crawl whose refused pages are unknown (the API's `may_be_incomplete`). */
const INCOMPLETE_WORKLISTS: readonly SummaryWorklist[] = [
  'under_linked_t1',
  'orphans',
  'editorial_orphans',
  'deep_only_through_auto',
  'weak_outlinks',
];

export interface SummaryLabels {
  untiered: string;
  worklist: (key: SummaryWorklist) => string;
}

export interface BuildClientSummaryOptions {
  client: QueryClient;
  scope: LinksScope;
  /** The crawl in view: the summary is of that crawl, never of another. */
  view: CrawlInView;
  host: string;
  timeZone: string;
  locale: string;
  words: ClientSummaryWords;
  labels: SummaryLabels;
}

const keyOf = (tier: TierRef | null): string => tier?.tier_id ?? 'none';

/**
 * The client summary page (spec 7.10) of the crawl in view. Every read is made again (`staleTime` 0), so the page
 * is of the data now. A failed read rejects; a lost links read the API answers `links_dropped` to, and a crawl whose
 * links are not stored, build the page without that section and say so.
 */
export async function buildClientSummary(options: BuildClientSummaryOptions): Promise<string> {
  const { client, scope, view, words, labels } = options;
  const { run } = view;
  const fresh = { staleTime: 0 } as const;
  const [flow, worklists, changes] = await Promise.all([
    client.fetchQuery({ ...tierFlowQuery(scope, 'editorial', run), ...fresh }),
    client.fetchQuery({ ...worklistsQuery(scope, run), ...fresh }),
    client.fetchQuery({ ...changesSummaryQuery(scope, run), ...fresh }),
  ]);
  const summary = changes.data;
  const crawl = view.crawl;

  let lost: ClientSummaryInput['lost'] = null;
  let lostReason: LostReason = 'no-comparison';
  let lostTotal: number | undefined;
  if (summary.state === 'ready' || summary.state === 'pending') {
    lostReason = 'dropped';
    let previousStored = view.linksAvailable;
    if (previousStored && summary.previous_run_id !== null) {
      const crawls = await client.fetchQuery({ ...crawlsQuery(scope, CRAWL_SCREEN_LIMIT), ...fresh });
      previousStored = crawls.data.find((item) => item.run_id === summary.previous_run_id)?.links_available ?? false;
    }
    if (previousStored) {
      try {
        const page: unknown = await client.fetchQuery({
          ...changeLinksQuery(
            scope,
            { change: 'lost', linkScope: 'editorial', only: 'top', offset: 0, limit: LOST_READ_LIMIT },
            run,
          ),
          ...fresh,
        });
        if (!isChangeLinkPage(page)) throw new Error('The changes answer is not a page of links');
        lost = page.data.map((link) => ({ from: link.source.path, to: link.target.path, anchor: link.anchor }));
        lostTotal = page.meta.total;
      } catch (error) {
        if (!isLinksDropped(error)) throw error;
      }
    }
  }

  const stats = [...flow.data.tiers].sort((a, b) => tierPosition(a.tier) - tierPosition(b.tier));
  const sums = new Map<string, number>();
  for (const cell of flow.data.cells) {
    const key = `${keyOf(cell.from_tier)}>${keyOf(cell.to_tier)}`;
    sums.set(key, (sums.get(key) ?? 0) + cell.links);
  }
  const finished = crawl?.finished_at ?? crawl?.created_at ?? null;
  return clientSummaryHtml(
    {
      host: options.host,
      crawledOn: finished === null ? '' : formatLocaleDate(new Date(finished), options.locale, options.timeZone),
      pages: stats.reduce((sum, stat) => sum + stat.pages, 0),
      tiers: stats.map((stat) => ({
        label: tierLabel(stat.tier, labels.untiered),
        code: stat.tier?.code ?? labels.untiered,
        pages: stat.pages,
        depth: stat.average_depth,
      })),
      matrix: stats.map((from) => stats.map((to) => sums.get(`${keyOf(from.tier)}>${keyOf(to.tier)}`) ?? 0)),
      worklists: SUMMARY_WORKLISTS.map((key) => ({
        label: labels.worklist(key),
        count: worklists.data[key],
        incomplete: worklists.data.may_be_incomplete && INCOMPLETE_WORKLISTS.includes(key),
      })),
      pagesBlocked: crawl?.pages_blocked ?? null,
      lost,
      lostReason,
      ...(lostTotal === undefined ? {} : { lostTotal }),
      older: view.older,
      importantMaxPosition: summary.important_max_position,
      locale: options.locale,
    },
    words,
  );
}
