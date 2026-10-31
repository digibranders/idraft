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
  const { counts, itemErrors, loading, fetching, error, refetch } = useStripCounts(scope, filters, true);

  const status = loading ? 'loading' : fetching ? 'refetching' : 'ready';

  const checkedCount =
    counts && counts.ranked !== null && counts.beyond !== null ? counts.ranked + counts.beyond : null;
  const checkedNote = checkedCount !== null ? t('trackedNote', { count: formatInteger(checkedCount) }) : undefined;
  const ofChecked = checkedCount !== null ? t('ofChecked', { count: formatInteger(checkedCount) }) : undefined;

  const itemOf = (
    id: string,
    label: string,
    val: number | null | undefined,
    isErr: boolean,
    context?: string,
  ): MetricStripItem => {
    if (isErr || val === null || val === undefined) {
      return { id, label, value: t('unavailable'), unknown: { kind: 'not-applicable' } };
    }
    return {
      id,
      label,
      value: formatInteger(val),
      context,
    };
  };

  // The strip ignores rows without a check date for rank counts (24-page-templates.md section 9.3).
  // Tracked count is the total tracked keywords matching the active filters.
  const items: MetricStripItem[] = [
    {
      id: 'tracked',
      label: t('tracked'),
      value: formatInteger(total),
      context: checkedNote,
    },
    itemOf('top3', t('top3'), counts?.top3, itemErrors.top3, ofChecked),
    itemOf('top10', t('top10'), counts?.top10, itemErrors.top10, ofChecked),
    itemOf('top20', t('top20'), counts?.top20, itemErrors.top20, ofChecked),
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
