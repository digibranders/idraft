import { Suspense, type ReactElement, type ReactNode } from 'react';

import { TopBarSlotProvider, TopBarSlotTarget } from '@/components/app/shell/top-bar-slot';
import { PagesScreen, type InternalLinksProject } from '@/features/internal-links';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { EVENTUS_LINKS } from '@/test/internal-links-harness';

/** The Pages screen as a member of the fixture workspace with `role`, inside the shell's slots. */
export function pagesAs(
  role: Role,
  tab: 'overview' | 'all',
  current: InternalLinksProject = EVENTUS_LINKS,
  promptDrawer: ReactNode = <aside aria-label="Prompt drawer stub" />,
): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <TopBarSlotProvider>
      <TopBarSlotTarget />
      <PermissionProvider membership={membershipFactory(role)}>
        <Suspense fallback={null}>
          <PagesScreen
            workspaceId={MOCK_WORKSPACE.workspace_id}
            workspaceSlug={MOCK_WORKSPACE.slug}
            project={current}
            tab={tab}
            promptDrawer={promptDrawer}
          />
        </Suspense>
      </PermissionProvider>
    </TopBarSlotProvider>
  );
}
