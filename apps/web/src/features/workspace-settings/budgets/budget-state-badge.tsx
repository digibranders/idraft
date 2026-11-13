import { Receipt, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import type { Budget, BudgetStatus } from '@/lib/api/types';

/** The catalog key of a budget state under `costs.states`, the words the Costs page uses for the same states. */
const STATE_KEYS = {
  ok: 'ok',
  soft_exceeded: 'softExceeded',
  hard_exceeded: 'hardExceeded',
} as const satisfies Record<BudgetStatus['state'], string>;

/**
 * A budget's state as a badge (23-application-patterns.md section 11.5): neutral and without an icon within
 * budget, warning at the soft limit and at the hard one, told apart by their icon and words. Never red. A budget
 * that only alerts at its hard limit reads over the limit by spend alone, so its badge says runs continue
 * instead of "Budget blocked".
 */
export function BudgetStateBadge({
  state,
  action,
}: {
  state: BudgetStatus['state'];
  action: Budget['action_on_hard'];
}): ReactElement {
  const costs = useTranslations('costs.states');
  const budgets = useTranslations('budgets.states');
  const label =
    state === 'hard_exceeded' && action === 'alert_only' ? budgets('hardExceededContinues') : costs(STATE_KEYS[state]);
  if (state === 'ok') return <Badge>{label}</Badge>;
  return (
    <Badge tone="warning" icon={state === 'soft_exceeded' ? TriangleAlert : Receipt}>
      {label}
    </Badge>
  );
}
