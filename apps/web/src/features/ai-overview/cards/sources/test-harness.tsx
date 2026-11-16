import type { ReactElement } from 'react';

import { OverviewProvider } from '../../overview-context';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { overviewProject } from '@/test/ai-overview-harness';
import { renderWithProviders } from '@/test/render';

/**
 * A card of the sources family on a project with no platform turned on (the mock project "cleanstart"), as an admin:
 * the card says why it has nothing and asks the API for nothing.
 */
export function renderWithoutPlatform(card: ReactElement): ReturnType<typeof renderWithProviders> {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return renderWithProviders(
    <PermissionProvider membership={membershipFactory('admin')}>
      <OverviewProvider
        workspaceId={MOCK_WORKSPACE.workspace_id}
        workspaceSlug={MOCK_WORKSPACE.slug}
        project={overviewProject('cleanstart')}
      >
        {card}
      </OverviewProvider>
    </PermissionProvider>,
    { searchParams: 'cmp=off' },
  );
}

/** The 500 problem answer the API gives for a failed read. */
export const failing = (requestId: string): Response =>
  Response.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: requestId },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );
