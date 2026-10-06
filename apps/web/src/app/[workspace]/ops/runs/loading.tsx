import type { ReactNode } from 'react';

import { PageSkeleton } from '@/features/shell/page-skeleton';

/** While Runs loads: its header's shape, inside the workspace shell that stays. */
export default function RunsLoading(): ReactNode {
  return <PageSkeleton />;
}
