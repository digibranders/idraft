import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * A page loading inside the shell (17-empty-loading-error-states.md section 3): the shape of its header,
 * a title and the meta line, and one block below. The screens that come later replace it with skeletons
 * of their own content.
 */
export function PageSkeleton(): ReactNode {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 px-3 pt-5 pb-8 md:px-4 lg:px-5">
      <div className="flex w-60 flex-col gap-2">
        <Skeleton shape="text-14" widthPct={80} />
        <Skeleton shape="text-12" widthPct={56} />
      </div>
      <Skeleton shape="block" height="chart-180" />
    </div>
  );
}
