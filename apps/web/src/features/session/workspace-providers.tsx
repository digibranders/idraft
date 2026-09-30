'use client';

import type { ReactNode } from 'react';

import { FreshSessionProvider } from './fresh-session';
import type { MeMembership } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';

/**
 * What every page of a workspace can rely on (20-frontend-specification.md section 3.3): the caller's
 * membership, for what they may do, and the dialog that confirms it is them before a sensitive change.
 */
export function WorkspaceProviders({
  membership,
  children,
}: Readonly<{ membership: MeMembership; children: ReactNode }>): ReactNode {
  return (
    <PermissionProvider membership={membership}>
      <FreshSessionProvider>{children}</FreshSessionProvider>
    </PermissionProvider>
  );
}
