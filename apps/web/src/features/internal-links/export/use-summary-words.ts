'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import type { ClientSummaryWords } from '@/lib/internal-links/client-summary';
import type { PublicSummaryLabels, SummaryWorklistKey } from '@/lib/internal-links/public-summary';

const WORKLIST_KEY = {
  under_linked_t1: 'underLinkedT1',
  orphans: 'orphans',
  editorial_orphans: 'editorialOrphans',
  deep_only_through_auto: 'deepOnlyThroughAuto',
  broken_and_redirected: 'brokenAndRedirected',
  links_to_non_indexable: 'linksToNonIndexable',
  weak_outlinks: 'weakOutlinks',
} as const satisfies Record<SummaryWorklistKey, string>;

export interface SummaryWords {
  words: ClientSummaryWords;
  labels: PublicSummaryLabels;
}

/** Everything the client summary page says, from the catalog: shared by the saved file and the shared link. */
export function useSummaryWords(): SummaryWords {
  const t = useTranslations('internalLinks.summary');
  const lists = useTranslations('internalLinks.worklists');
  const context = useTranslations('internalLinks.context');
  const untiered = useTranslations('internalLinks.filters')('untiered');
  return useMemo(
    () => ({
      words: {
        title: (name) => t('title', { host: name }),
        crawlLine: (when, pages) => t('crawlLine', { when, pages }),
        olderNote: t('olderNote'),
        lostUnavailable: (reason) => t(reason === 'dropped' ? 'lostDropped' : 'lostNoComparison'),
        tiersHeading: t('tiersHeading'),
        tiersHead: [t('tierColumn'), t('pagesColumn'), t('shareColumn'), t('depthColumn')],
        flowHeading: t('flowHeading'),
        flowNote: t('flowNote'),
        flowFrom: t('flowFrom'),
        flowTo: (code) => t('flowTo', { code }),
        worklistsHeading: t('worklistsHeading'),
        worklistsHead: [t('worklistColumn'), t('countColumn')],
        worklistsNone: t('worklistsNone'),
        lostHeading: (tiers) => t('lostHeading', { tiers }),
        lostHead: [t('sourceColumn'), t('targetColumn'), t('anchorColumn')],
        lostNone: (tiers) => t('lostNone', { tiers }),
        lostMore: (count) => t('lostMore', { count }),
        footer: t('footer'),
        notAvailable: t('notAvailable'),
        tierPair: (first, second) => context('tierPair', { first, second }),
        tierRange: (first, last) => context('tierRange', { first, last }),
      },
      labels: { untiered, worklist: (key) => lists(WORKLIST_KEY[key]) },
    }),
    [t, lists, context, untiered],
  );
}
