'use client';

import type { ReactNode } from 'react';

import { ApplyPreferences } from './apply-preferences';
import { FreshSessionProvider } from './fresh-session';
import { CardInfoProvider } from '@/components/app/chart/card-info';
import type { MeMembership } from '@/lib/api/types';
import { FaviconWorkspaceContext } from '@/lib/favicon';
import { LeaveGuardProvider } from '@/lib/navigation/use-leave-guard';
import { PermissionProvider } from '@/lib/permissions';

/**
 * What every page of a workspace can rely on (20-frontend-specification.md section 3.3): the caller's
 * membership, for what they may do, the dialog that confirms it is them before a sensitive change, the
 * guard that asks before an unsaved form is left, the workspace whose icon route draws site icons, and their
 * preferences put into effect. Charts keep their method behind an "i" button on every page, as on the AI overview.
 */
export function WorkspaceProviders({
  membership,
  children,
}: Readonly<{ membership: MeMembership; children: ReactNode }>): ReactNode {
  return (
    <PermissionProvider membership={membership}>
      <FaviconWorkspaceContext value={membership.workspace.workspace_id}>
        <FreshSessionProvider>
          <LeaveGuardProvider>
            <ApplyPreferences>
              <CardInfoProvider>{children}</CardInfoProvider>
            </ApplyPreferences>
          </LeaveGuardProvider>
        </FreshSessionProvider>
      </FaviconWorkspaceContext>
    </PermissionProvider>
  );
}
