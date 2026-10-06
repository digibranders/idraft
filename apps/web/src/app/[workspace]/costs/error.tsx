'use client';

import type { ReactNode } from 'react';

import { RouteError } from '@/features/shell/route-status';

/** Costs failed to load: the error inside the workspace shell, with Try again. */
export default function CostsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactNode {
  return <RouteError error={error} reset={reset} />;
}
