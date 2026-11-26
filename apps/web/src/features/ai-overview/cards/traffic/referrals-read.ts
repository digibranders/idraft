'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';

import type { ReferralsResponse } from './referrals-model';
import { comparisonWindow } from '../../data/overview-queries';
import { useRead, type Read } from '../../data/read-state';
import { useOverview } from '../../overview-context';
import { apiQuery } from '@/lib/api/query';
import { compareParams } from '@/lib/compare/compare-model';

const REFERRALS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/fp/ai-referrals' as const;

/**
 * `GET {P}/fp/ai-referrals` for the period of the scope: one row per AI platform with both classifiers side by side,
 * and the compared period while the comparison is on (`previous_period` or `previous_year`, as the scope says). The
 * route reads the project's whole GA4 property, so the platform, country, group and brand choices of the scope do not
 * apply. `enabled` is false until the project has a live GA4 property: the read is then `idle` and asks nothing. A scope
 * change keeps the last answer on screen while the new one is read.
 */
export function useAiReferrals(enabled: boolean): Read<ReferralsResponse> {
  const { workspaceId, project, scope } = useOverview();
  const compared = comparisonWindow(scope) !== null;
  const query = useQuery({
    ...apiQuery(REFERRALS, {
      params: {
        path: { workspace_id: workspaceId, project_id: project.id },
        query: {
          from: scope.range.from,
          to: scope.range.to,
          group_by: 'assistant',
          classifier: 'both',
          ...compareParams(compared, scope.compareKind),
        },
      },
    }),
    enabled,
    placeholderData: keepPreviousData,
  });
  return useRead(query, enabled ? 'run' : 'idle');
}
