import type { ReactNode } from 'react';

import { PageSkeleton } from '@/features/shell/page-skeleton';

/** While a page of the project loads: its header's shape, inside the shell that stays. */
export default function ProjectLoading(): ReactNode {
  return <PageSkeleton />;
}
