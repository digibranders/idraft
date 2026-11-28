import { Suspense, type ReactElement, type ReactNode } from 'react';

import { TopBarSlotProvider, TopBarSlotTarget } from '@/components/app/shell/top-bar-slot';
import { InternalLinksScreen, type InternalLinksProject } from '@/features/internal-links';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';

const project = (slug: string, host: string | null): InternalLinksProject => {
  const seed = MOCK_PROJECTS.find((candidate) => candidate.slug === slug);
  if (seed === undefined) throw new Error(`No fixture project ${slug}`);
  return { id: seed.project_id, slug: seed.slug, name: seed.name, timeZone: seed.timezone, host };
};

/** Eventus Security: the fixture crawl of eventussecurity.com. */
export const EVENTUS_LINKS = project('eventus-security', 'eventussecurity.com');
/** Fynix: a website, and never crawled. */
export const FYNIX_LINKS = project('fynix', 'fynix.digital');
/** Fynix with no website. */
export const NO_WEBSITE = project('fynix', null);

/** The Internal links page as a member of the fixture workspace with `role`, inside the shell's slots. */
export function internalLinksAs(
  role: Role,
  current: InternalLinksProject = EVENTUS_LINKS,
  promptDrawer: ReactNode = <aside aria-label="Prompt drawer stub" />,
): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <TopBarSlotProvider>
      <TopBarSlotTarget />
      <PermissionProvider membership={membershipFactory(role)}>
        <Suspense fallback={null}>
          <InternalLinksScreen
            workspaceId={MOCK_WORKSPACE.workspace_id}
            workspaceSlug={MOCK_WORKSPACE.slug}
            project={current}
            promptDrawer={promptDrawer}
          />
        </Suspense>
      </PermissionProvider>
    </TopBarSlotProvider>
  );
}
