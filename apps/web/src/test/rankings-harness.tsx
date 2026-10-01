import { screen, waitFor, within } from '@testing-library/react';
import { Suspense, type ReactElement } from 'react';
import { expect, vi } from 'vitest';

import { RankingsScreen } from '@/features/rankings/rankings-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { MOCK_LOCATIONS } from '@/mocks/entity-fixtures';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';

/**
 * What the tests of Rankings share: the screen for a signed-in role, a viewport wide enough for every
 * column and a docked inspector, and readers for the grid.
 */

function fixtureProject(index: number): (typeof MOCK_PROJECTS)[number] {
  const project = MOCK_PROJECTS[index];
  if (project === undefined) throw new Error(`The fixture project ${String(index)} is missing`);
  return project;
}
/** The project with tracked keywords, and the one that tracks none. */
export const fynix = fixtureProject(0);
export const cleanstart = fixtureProject(1);

/** Rankings of `projectId` for a member of `role`, signed in through the mock session cookie. */
export function rankingsAs(role: Role, projectId: string = fynix.project_id): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  const locationId = MOCK_PROJECTS.find((candidate) => candidate.project_id === projectId)?.location_id ?? null;
  const location = MOCK_LOCATIONS.find((candidate) => candidate.location_id === locationId) ?? null;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <RankingsScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          projectId={projectId}
          timeZone="Europe/Berlin"
          defaults={{
            location:
              location === null
                ? null
                : {
                    location_id: location.location_id,
                    name: location.name,
                    location_type: location.location_type,
                    country_iso: location.country_iso,
                  },
            languageCode: 'en',
          }}
        />
      </Suspense>
    </PermissionProvider>
  );
}

/** Every column shows: a wide viewport and a wide table region. */
class WideResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    const entry = { target, contentRect: { width: 1600, height: 640 } };
    this.callback([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve(): void {}
  disconnect(): void {}
}

/** Stubs the browser for a 1680 px window: call in `beforeEach`, and `restoreWideScreen` in `afterEach`. */
export function stubWideScreen(): void {
  vi.stubGlobal('ResizeObserver', WideResizeObserver);
  vi.stubGlobal('innerWidth', 1680);
  Object.defineProperty(Element.prototype, 'getAnimations', { value: () => [], configurable: true, writable: true });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

export function restoreWideScreen(): void {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, 'getAnimations');
}

/** The grid once its rows have loaded. */
export async function loadedGrid(): Promise<HTMLElement> {
  const grid = await screen.findByRole('grid', { name: 'Tracked keywords' });
  await waitFor(() => expect(within(grid).queryAllByRole('rowheader').length).toBeGreaterThan(0));
  return grid;
}

/** The keywords as their cells show them; the cells' tooltips hold the location and device too. */
export const keywordsIn = (grid: HTMLElement): string[] =>
  within(grid)
    .getAllByRole('rowheader')
    .map((cell) => cell.querySelector('.truncate')?.textContent ?? '');
