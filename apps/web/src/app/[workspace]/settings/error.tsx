'use client';

import type { ReactNode } from 'react';

import { RouteError } from '@/features/shell/route-status';

/** A settings section that failed: the error inside the workspace shell, with Try again. */
export default function WorkspaceSettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactNode {
  return <RouteError error={error} reset={reset} />;
}
