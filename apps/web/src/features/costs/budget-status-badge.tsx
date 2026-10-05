import { Receipt, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { STATE_KEYS } from './cost-model';
import { Badge } from '@/components/ui/badge';
import type { BudgetStatus } from '@/lib/api/types';

/**
 * The state of a budget as a badge (23-application-patterns.md section 11.5): within budget is neutral
 * with no icon; the soft limit and the hard limit are both warning, told apart by their icon and words.
 */
export function BudgetStatusBadge({ state }: { state: BudgetStatus['state'] }): ReactElement {
  const t = useTranslations('costs.states');
  const label = t(STATE_KEYS[state]);
  if (state === 'ok') return <Badge>{label}</Badge>;
  return (
    <Badge tone="warning" icon={state === 'soft_exceeded' ? TriangleAlert : Receipt}>
      {label}
    </Badge>
  );
}
