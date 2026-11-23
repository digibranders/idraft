'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';

import { buildClientSummary, type SummaryWorklist } from './client-summary-action';
import { toast } from '@/components/ui/toast';
import { downloadHtml } from '@/lib/api/download';
import type { ClientSummaryWords } from '@/lib/internal-links/client-summary';
import type { CrawlInView } from '@/lib/internal-links/crawl-choice';
import { reasonOf } from '@/lib/internal-links/problem-reason';
import type { LinksScope } from '@/lib/internal-links/types';

export const SUMMARY_FILE_NAME = 'internal-links-summary.html';

const WORKLIST_KEY = {
  under_linked_t1: 'underLinkedT1',
  orphans: 'orphans',
  editorial_orphans: 'editorialOrphans',
  deep_only_through_auto: 'deepOnlyThroughAuto',
  broken_and_redirected: 'brokenAndRedirected',
  links_to_non_indexable: 'linksToNonIndexable',
  weak_outlinks: 'weakOutlinks',
} as const satisfies Record<SummaryWorklist, string>;

export interface ClientSummaryControl {
  /** Builds the page and saves it; ignored while one is being made. */
  run: () => void;
  preparing: boolean;
}

/** The Export menu's "Client summary (HTML)": one at a time, a toast for the result, the failure in its own words. */
export function useClientSummary(options: {
  scope: LinksScope;
  view: CrawlInView;
  host: string;
  timeZone: string;
}): ClientSummaryControl {
  const { scope, view, host, timeZone } = options;
  const t = useTranslations('internalLinks.summary');
  const header = useTranslations('internalLinks.header');
  const lists = useTranslations('internalLinks.worklists');
  const context = useTranslations('internalLinks.context');
  const untiered = useTranslations('internalLinks.filters')('untiered');
  const locale = useLocale();
  const client = useQueryClient();
  const [preparing, setPreparing] = useState(false);
  const busy = useRef(false);

  const run = useCallback((): void => {
    if (busy.current) return;
    busy.current = true;
    setPreparing(true);
    const words: ClientSummaryWords = {
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
    };
    const labels = { untiered, worklist: (key: SummaryWorklist): string => lists(WORKLIST_KEY[key]) };
    buildClientSummary({ client, scope, view, host, timeZone, locale, words, labels })
      .then((html) => {
        downloadHtml(html, SUMMARY_FILE_NAME);
        toast({ type: 'success', title: header('summaryReady'), description: header('summaryReadyText') });
      })
      .catch((error: unknown) => {
        toast({
          type: 'error',
          title: header('summaryFailed'),
          description: reasonOf(error) || header('summaryFailedReason'),
        });
      })
      .finally(() => {
        busy.current = false;
        setPreparing(false);
      });
  }, [t, header, lists, context, untiered, locale, client, scope, view, host, timeZone]);

  return { run, preparing };
}
