'use client';

import type { ReactNode } from 'react';

import { ApplyPreferences } from './apply-preferences';
import { FreshSessionProvider } from './fresh-session';
import type { MeMembership } from '@/lib/api/types';
import { LeaveGuardProvider } from '@/lib/navigation/use-leave-guard';
import { PermissionProvider } from '@/lib/permissions';

/**
 * What every page of a workspace can rely on (20-frontend-specification.md section 3.3): the caller's
 * membership, for what they may do, the dialog that confirms it is them before a sensitive change, the
 * guard that asks before an unsaved form is left, and their preferences put into effect.
 */
export function WorkspaceProviders({
  membership,
  children,
}: Readonly<{ membership: MeMembership; children: ReactNode }>): ReactNode {
  return (
    <PermissionProvider membership={membership}>
      <FreshSessionProvider>
        <LeaveGuardProvider>
          <ApplyPreferences>{children}</ApplyPreferences>
        </LeaveGuardProvider>
      </FreshSessionProvider>
    </PermissionProvider>
  );
}
