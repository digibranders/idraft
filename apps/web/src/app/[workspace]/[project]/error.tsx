'use client';

import type { ReactNode } from 'react';

import { RouteError } from '@/features/shell/route-status';

/** A page of the project that failed: the error inside the shell, with Try again. */
export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactNode {
  return <RouteError error={error} reset={reset} />;
}
