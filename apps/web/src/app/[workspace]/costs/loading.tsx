import type { ReactNode } from 'react';

import { PageSkeleton } from '@/features/shell/page-skeleton';

/** While Costs loads: its header's shape, inside the workspace shell that stays. */
export default function CostsLoading(): ReactNode {
  return <PageSkeleton />;
}
