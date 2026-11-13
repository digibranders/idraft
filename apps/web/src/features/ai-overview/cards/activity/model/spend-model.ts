import type { BudgetStatus } from '@/lib/api/types';
import { money } from '@/lib/format/money';

/**
 * The AI budget the spend card shows (WP-37 plan D10): ONE budget, never several added up. In this order: the
 * project's `ai_prompt` budget, the workspace's `ai_prompt` budget, the project's `all` budget, the workspace's
 * `all` budget. A budget of another project, or of another group of work, is not the AI spend of this one.
 *
 * Money is the API's decimal string read as a number, or `null` when it is not one: unknown is never `$0`. The
 * share `pct` is what the API counted (`pct_used`, in percent, and it may pass 100); it is not worked out here.
 */
export interface SpendFacts {
  scope: 'project' | 'workspace';
  workload: 'ai_prompt' | 'all';
  spentUsd: number | null;
  limitUsd: number | null;
  /** What runs under way are still expected to spend this month. */
  committedUsd: number | null;
  /** Share of the limit used, in percent, as the API counted it. */
  pct: number;
  softLimitPct: number;
  state: BudgetStatus['state'];
  actionOnHard: BudgetStatus['budget']['action_on_hard'];
  blockedRuns: number;
}

const ORDER: readonly { scope: SpendFacts['scope']; workload: SpendFacts['workload'] }[] = [
  { scope: 'project', workload: 'ai_prompt' },
  { scope: 'workspace', workload: 'ai_prompt' },
  { scope: 'project', workload: 'all' },
  { scope: 'workspace', workload: 'all' },
];

export function chooseSpend(statuses: readonly BudgetStatus[], projectId: string): SpendFacts | null {
  for (const { scope, workload } of ORDER) {
    const found = statuses.find(
      ({ budget }) =>
        budget.period === 'month' &&
        budget.workload === workload &&
        (scope === 'project' ? budget.project_id === projectId : budget.project_id === null),
    );
    if (found !== undefined) {
      return {
        scope,
        workload,
        spentUsd: money(found.spent_usd),
        limitUsd: money(found.budget.limit_usd),
        committedUsd: money(found.committed_estimate_usd),
        pct: found.pct_used,
        softLimitPct: found.budget.soft_limit_pct,
        state: found.state,
        actionOnHard: found.budget.action_on_hard,
        blockedRuns: found.blocked_runs,
      };
    }
  }
  return null;
}
