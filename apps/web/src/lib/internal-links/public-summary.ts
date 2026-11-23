import { formatLocaleDate } from '@/lib/format';
import type { ClientSummaryInput } from './client-summary';
import type { ClientSummary } from './types';

/** The worklists the summary counts, in its order (the same seven the downloaded file lists). */
export const SUMMARY_WORKLIST_KEYS = [
  'under_linked_t1',
  'orphans',
  'editorial_orphans',
  'deep_only_through_auto',
  'broken_and_redirected',
  'links_to_non_indexable',
  'weak_outlinks',
] as const satisfies readonly ClientSummary['worklists'][number]['key'][];
export type SummaryWorklistKey = (typeof SUMMARY_WORKLIST_KEYS)[number];

export interface PublicSummaryLabels {
  untiered: string;
  worklist: (key: SummaryWorklistKey) => string;
}

export interface PublicSummaryOptions {
  locale: string;
  /** The payload carries no time zone: the date is read in the viewer's own. */
  timeZone: string;
  labels: PublicSummaryLabels;
}

/** Important tiers when the API leaves the limit out: T1 and T2, as the project settings default. */
const DEFAULT_IMPORTANT_MAX_POSITION = 2;

const keyOf = (code: string | null): string => code ?? 'none';

/**
 * The public payload as the input of the page the download builds, so a shared link and the saved file read the
 * same. Tiers come in the API's order (T1 first, no tier last); a flow cell the API leaves out is 0, and the
 * worklists are listed in the file's order.
 */
export function summaryInputOf(summary: ClientSummary, options: PublicSummaryOptions): ClientSummaryInput {
  const { locale, timeZone, labels } = options;
  const sums = new Map<string, number>();
  for (const cell of summary.flow) {
    const key = `${keyOf(cell.from_code)}>${keyOf(cell.to_code)}`;
    sums.set(key, (sums.get(key) ?? 0) + cell.links);
  }
  const codes = summary.tiers.map((tier) => keyOf(tier.code));
  const lists = new Map(summary.worklists.map((list) => [list.key, list]));
  const { lost } = summary;
  const available = lost.state === 'available';
  return {
    host: summary.host ?? '',
    crawledOn: summary.crawled_at === null ? '' : formatLocaleDate(new Date(summary.crawled_at), locale, timeZone),
    pages: summary.pages,
    tiers: summary.tiers.map((tier) => ({
      label: tier.code === null ? labels.untiered : tier.name === null ? tier.code : `${tier.code} ${tier.name}`,
      code: tier.code ?? labels.untiered,
      pages: tier.pages,
      depth: tier.average_depth,
    })),
    matrix: codes.map((from) => codes.map((to) => sums.get(`${from}>${to}`) ?? 0)),
    worklists: SUMMARY_WORKLIST_KEYS.map((key) => ({
      label: labels.worklist(key),
      count: lists.get(key)?.count ?? 0,
      incomplete: lists.get(key)?.may_be_incomplete === true,
    })),
    pagesBlocked: summary.pages_blocked,
    lost: available
      ? lost.links.map((link) => ({ from: link.from_path, to: link.to_path, anchor: link.anchor }))
      : null,
    ...(available ? {} : { lostReason: lost.state === 'dropped' ? ('dropped' as const) : ('no-comparison' as const) }),
    ...(available && lost.total !== null ? { lostTotal: lost.total } : {}),
    importantMaxPosition: summary.important_max_position ?? DEFAULT_IMPORTANT_MAX_POSITION,
    locale,
  };
}
