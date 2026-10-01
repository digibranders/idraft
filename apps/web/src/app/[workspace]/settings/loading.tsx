import type { ReactNode } from 'react';

import { PageSkeleton } from '@/features/shell/page-skeleton';

/** While a settings section loads: its header's shape, inside the workspace shell that stays. */
export default function WorkspaceSettingsLoading(): ReactNode {
  return <PageSkeleton />;
}
