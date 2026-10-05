'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { isCostWorkload, WORKLOAD_KEYS } from './cost-model';

/** A workload's name from the catalog; a code this client does not know yet is shown as the API sent it. */
export function useWorkloadName(): (workload: string) => string {
  const t = useTranslations('costs.workloads');
  return useCallback((workload) => (isCostWorkload(workload) ? t(WORKLOAD_KEYS[workload]) : workload), [t]);
}
