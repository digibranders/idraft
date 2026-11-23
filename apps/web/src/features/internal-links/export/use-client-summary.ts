'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';

import { buildClientSummary } from './client-summary-action';
import { useSummaryWords } from './use-summary-words';
import { toast } from '@/components/ui/toast';
import { downloadHtml } from '@/lib/api/download';
import type { CrawlInView } from '@/lib/internal-links/crawl-choice';
import { reasonOf } from '@/lib/internal-links/problem-reason';
import type { LinksScope } from '@/lib/internal-links/types';

export const SUMMARY_FILE_NAME = 'internal-links-summary.html';

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
  const header = useTranslations('internalLinks.header');
  const { words, labels } = useSummaryWords();
  const locale = useLocale();
  const client = useQueryClient();
  const [preparing, setPreparing] = useState(false);
  const busy = useRef(false);

  const run = useCallback((): void => {
    if (busy.current) return;
    busy.current = true;
    setPreparing(true);
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
  }, [header, words, labels, locale, client, scope, view, host, timeZone]);

  return { run, preparing };
}
