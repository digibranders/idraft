import { Receipt, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import type { BudgetStatus } from '@/lib/api/types';

/** The catalog key of a budget state under `costs.states`, the words the Costs page uses for the same states. */
const STATE_KEYS = {
  ok: 'ok',
  soft_exceeded: 'softExceeded',
  hard_exceeded: 'hardExceeded',
} as const satisfies Record<BudgetStatus['state'], string>;

/**
 * A budget's state as a badge (23-application-patterns.md section 11.5): neutral and without an icon within
 * budget, warning at the soft limit and at the hard one, told apart by their icon and words. Never red.
 */
export function BudgetStateBadge({ state }: { state: BudgetStatus['state'] }): ReactElement {
  const t = useTranslations('costs.states');
  const label = t(STATE_KEYS[state]);
  if (state === 'ok') return <Badge>{label}</Badge>;
  return (
    <Badge tone="warning" icon={state === 'soft_exceeded' ? TriangleAlert : Receipt}>
      {label}
    </Badge>
  );
}
