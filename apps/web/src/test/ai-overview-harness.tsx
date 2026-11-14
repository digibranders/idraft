import { Suspense, type ComponentType, type ReactElement, type ReactNode } from 'react';

import { TopBarSlotProvider, TopBarSlotTarget } from '@/components/app/shell/top-bar-slot';
import { AiOverviewScreen, OverviewProvider, type OverviewProject } from '@/features/ai-overview';
import { ExportProvider } from '@/features/ai-overview/export/export-registry';
import {
  CustomizableGrid,
  CustomizableScreen,
  defineCards,
  useLayoutCapabilities,
  type CardProps,
  type LayoutPreset,
} from '@/features/layouts';
import type { Role } from '@/lib/api/types';
import type { Width } from '@/lib/layouts';
import { PermissionProvider, type Permission } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { projectFactory } from '@/mocks/factories/project';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { serveLayouts } from '@/test/customize-harness';

/*
 * What the tests of the AI visibility Overview and of its cards share (WP-33 plan section 5, item 11): the page
 * for a signed-in role on a project of the mock world, and one card inside the real provider, screen and grid.
 * Fynix has three engines and 24 prompts, Cleanstart has its engines off, and `setAiSeeded(true)` makes
 * Eventus Security the project with 92 days of answers. A test that renders the screen needs
 * `vi.mock('next/navigation', ...)` with `@/test/next-navigation` and a viewport from `stubViewport`.
 */

export type OverviewWorld = 'fynix' | 'cleanstart' | 'eventus-security';

/** The project of the mock world, as the route gives it to the screen. */
export function overviewProject(world: OverviewWorld): OverviewProject {
  const seed = MOCK_PROJECTS.find((candidate) => candidate.slug === world);
  if (seed === undefined) throw new Error(`The fixture project ${world} is missing`);
  const project = projectFactory(seed);
  return {
    id: project.project_id,
    slug: project.slug,
    name: project.name,
    timeZone: project.timezone,
    defaultLanguage: project.default_language_code,
    defaultCountryIso: project.default_location?.country_iso ?? null,
  };
}

/** Signs `role` in through the mock session cookie, and gives the membership the tests render under. */
function membershipOf(role: Role, withoutPermissions: readonly Permission[]): ReturnType<typeof membershipFactory> {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  const membership = membershipFactory(role);
  const without = new Set<string>(withoutPermissions);
  return { ...membership, permissions: membership.permissions.filter((key) => !without.has(key)) };
}

export interface OverviewAsOptions {
  world?: OverviewWorld;
  /** Permissions the role holds that this member is not given. */
  withoutPermissions?: readonly Permission[];
  /** The presets of the Start from menu; none by default. */
  presets?: readonly LayoutPreset[];
  /** What the route passes as the setup checklist; nothing by default. */
  setupSlot?: ReactNode;
}

/** The page of the Overview for a member of `role`, with a top bar that holds the controls the page portals. */
export function overviewAs(
  role: Role,
  { world = 'fynix', withoutPermissions = [], presets, setupSlot }: OverviewAsOptions = {},
): ReactElement {
  return (
    <PermissionProvider membership={membershipOf(role, withoutPermissions)}>
      <TopBarSlotProvider>
        <header>
          <TopBarSlotTarget />
        </header>
        <Suspense fallback={null}>
          <AiOverviewScreen
            workspaceId={MOCK_WORKSPACE.workspace_id}
            workspaceSlug={MOCK_WORKSPACE.slug}
            project={overviewProject(world)}
            {...(presets === undefined ? {} : { presets })}
            {...(setupSlot === undefined ? {} : { setupSlot })}
          />
        </Suspense>
      </TopBarSlotProvider>
    </PermissionProvider>
  );
}

export interface CardInOverviewOptions {
  /** The catalog key of the card, which must be a type of the `ai_overview` screen. */
  type: string;
  Card: ComponentType<CardProps>;
  width?: Width;
  world?: OverviewWorld;
  role?: Role;
}

/** The one card of the personal layout this harness serves, so a test can find its frame. */
export const CARD_ID = 'card-under-test';

function ScreenWithCard({
  type,
  Card,
  workspaceId,
  projectId,
}: CardInOverviewOptions & {
  workspaceId: string;
  projectId: string;
}): ReactElement {
  const { capabilities } = useLayoutCapabilities({ workspaceId, projectId });
  return (
    <CustomizableScreen
      screen="ai_overview"
      workspaceId={workspaceId}
      workspaceName={MOCK_WORKSPACE.name}
      capabilities={capabilities}
      registry={defineCards({ [type]: { load: () => Promise.resolve({ default: Card }) } })}
    >
      <CustomizableGrid label="Card under test" />
    </CustomizableScreen>
  );
}

/**
 * One card of a card package inside the real `OverviewProvider` (its scope from the URL, the engines of the
 * project), `CustomizableScreen` and grid, as a layout with only that card. It serves that layout, so call it
 * once per test before rendering.
 */
export function cardInOverview({
  type,
  Card,
  width = 'half',
  world = 'fynix',
  role = 'admin',
}: CardInOverviewOptions): ReactElement {
  serveLayouts({
    layout: { source: 'personal', document: { schema: 1, numbers: [], cards: [{ id: CARD_ID, type, width }] } },
  });
  const project = overviewProject(world);
  return (
    <PermissionProvider membership={membershipOf(role, [])}>
      <Suspense fallback={null}>
        <OverviewProvider
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={project}
        >
          <ExportProvider>
            <ScreenWithCard type={type} Card={Card} workspaceId={MOCK_WORKSPACE.workspace_id} projectId={project.id} />
          </ExportProvider>
        </OverviewProvider>
      </Suspense>
    </PermissionProvider>
  );
}
