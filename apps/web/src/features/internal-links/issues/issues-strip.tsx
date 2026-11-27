'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { MetricStrip, type MetricStripGroup, type MetricStripItem } from '@/components/app/metric/metric-strip';
import { EMPTY_VALUE, formatInteger, formatPercent } from '@/lib/format';
import type { IssueSummary } from '@/lib/issues/types';

export interface IssuesStripProps {
  /** The totals of the list; `null` while it loads. */
  summary: IssueSummary | null;
  status: 'loading' | 'ready' | 'refetching';
}

/**
 * The six measures of a crawl (spec 7.2) in the page's one 76 px MetricStrip: the pages, the pages by severity and
 * the checks that passed. A page with several issues counts once. Each measure has its definition in a tooltip.
 */
export function IssuesStrip({ summary, status }: IssuesStripProps): ReactElement {
  const t = useTranslations('issues.strip');
  const measures = useTranslations('issues.labels');
  const figure = (value: number | undefined): string => (summary === null ? '' : formatInteger(value));
  const share =
    summary === null || summary.pages_crawled === 0
      ? EMPTY_VALUE
      : formatPercent(summary.pages_with_issue / summary.pages_crawled, { decimals: 0 });
  const items: MetricStripItem[] = [
    {
      id: 'pages-crawled',
      label: t('pagesCrawled.label'),
      value: figure(summary?.pages_crawled),
      tip: t('pagesCrawled.hint'),
    },
    {
      id: 'pages-with-issue',
      label: t('pagesWithIssue.label'),
      value: figure(summary?.pages_with_issue),
      tip: t('pagesWithIssue.hint', { share }),
    },
    {
      id: 'pages-with-error',
      label: t('pagesWithError.label'),
      value: figure(summary?.pages_with_error),
      tip: t('pagesWithError.hint'),
    },
    {
      id: 'pages-with-warning',
      label: t('pagesWithWarning.label'),
      value: figure(summary?.pages_with_warning),
      tip: t('pagesWithWarning.hint'),
    },
    {
      id: 'pages-with-notice',
      label: t('pagesWithNotice.label'),
      value: figure(summary?.pages_with_notice),
      tip: t('pagesWithNotice.hint'),
    },
    {
      id: 'checks-passed',
      label: t('checksPassed.label'),
      value:
        summary === null
          ? ''
          : t('checksPassed.value', {
              passed: formatInteger(summary.checks_passed),
              total: formatInteger(summary.checks_ran),
            }),
      tip: t('checksPassed.hint'),
    },
  ];
  const groups: MetricStripGroup[] = [{ id: 'measures', items }];
  return <MetricStrip size="md" label={measures('measures')} groups={groups} status={status} />;
}
