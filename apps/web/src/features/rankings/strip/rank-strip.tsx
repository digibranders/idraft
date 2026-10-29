'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { MetricStrip, type MetricStripGroup, type MetricStripItem } from '@/components/app/metric/metric-strip';
import { Banner } from '@/components/app/status/banner';
import { Button } from '@/components/ui/button';
import { formatInteger } from '@/lib/format';
import type { KeywordFilters, ProjectScope } from '../rankings-queries';
import { useStripCounts } from './strip-queries';

export interface RankStripProps {
  scope: ProjectScope;
  filters: KeywordFilters;
  total: number;
}

/**
 * Summary metric strip of the filtered keywords (24-page-templates.md section 9.3).
 * Four counts: Tracked (with checked count), Top 3, Top 10 and Top 20 (each of checked count).
 */
export function RankStrip({ scope, filters, total }: RankStripProps): ReactElement {
  const t = useTranslations('rankings.strip');
  const common = useTranslations('common');
  const { counts, loading, fetching, error, refetch } = useStripCounts(scope, filters, true);

  const status = loading ? 'loading' : fetching ? 'refetching' : 'ready';

  const checkedCount = counts ? counts.ranked + counts.beyond : 0;
  const checkedNote = t('trackedNote', { count: formatInteger(checkedCount) });
  const ofChecked = t('ofChecked', { count: formatInteger(checkedCount) });

  const items: MetricStripItem[] = error
    ? [
        { id: 'tracked', label: t('tracked'), value: 'n/a', unknown: { kind: 'not-applicable' } },
        { id: 'top3', label: t('top3'), value: 'n/a', unknown: { kind: 'not-applicable' } },
        { id: 'top10', label: t('top10'), value: 'n/a', unknown: { kind: 'not-applicable' } },
        { id: 'top20', label: t('top20'), value: 'n/a', unknown: { kind: 'not-applicable' } },
      ]
    : [
        {
          id: 'tracked',
          label: t('tracked'),
          value: formatInteger(total),
          context: checkedNote,
        },
        {
          id: 'top3',
          label: t('top3'),
          value: formatInteger(counts?.top3 ?? 0),
          context: ofChecked,
        },
        {
          id: 'top10',
          label: t('top10'),
          value: formatInteger(counts?.top10 ?? 0),
          context: ofChecked,
        },
        {
          id: 'top20',
          label: t('top20'),
          value: formatInteger(counts?.top20 ?? 0),
          context: ofChecked,
        },
      ];

  const groups: readonly MetricStripGroup[] = [{ id: 'seo', items }];

  return (
    <div className="flex flex-col gap-2">
      <MetricStrip size="md" label={t('label')} groups={groups} status={status} />
      {error ? (
        <Banner
          tone="negative"
          placement="region"
          message={t('failed')}
          actions={
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              {common('retry')}
            </Button>
          }
        />
      ) : null}
    </div>
  );
}
