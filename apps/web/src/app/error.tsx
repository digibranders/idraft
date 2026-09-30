'use client';

import type { ReactNode } from 'react';

import { RouteError } from '@/features/shell/route-status';

/** A page outside a project that failed: the auth pages and the workspace root. */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactNode {
  return (
    <main className="flex min-h-dvh flex-col items-center bg-background px-4 pt-6 pb-12 sm:pt-12">
      <RouteError error={error} reset={reset} />
    </main>
  );
}
