'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { MetricValueCell } from './metric-value-cell';
import { queriesChange } from './monitoring-rows';
import type { PageQueries } from '../types';
import { Skeleton } from '@/components/ui/skeleton';
import { formatInteger } from '@/lib/format';

export interface QueriesCellProps {
  /** `null`: no count is stored for the period, which is not 0. */
  queries: PageQueries | null;
  /** The page's history is not fetched yet. */
  loading: boolean;
}

/** The number of different queries of the period, and its change against the period before (spec D21). */
export function QueriesCell({ queries, loading }: QueriesCellProps): ReactElement {
  const t = useTranslations('monitoring');
  const words = useTranslations('pageSearch.states');
  if (loading) return <Skeleton shape="text-12" widthPct={64} />;
  if (queries === null) return <span className="text-foreground-tertiary">{words('notCollected')}</span>;
  const change = queriesChange(queries);
  const value = formatInteger(queries.value);
  return (
    <MetricValueCell
      value={queries.capped ? `${value}+` : value}
      valueTip={queries.capped ? t('queries.capped') : undefined}
      change={
        change === null || queries.previous === null
          ? null
          : {
              text: change.text,
              tone: change.tone,
              tip: t('queries.previous', { count: queries.previous }),
            }
      }
    />
  );
}
