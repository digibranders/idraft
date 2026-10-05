import { screen, waitFor, within } from '@testing-library/react';
import { delay, getResponse, http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { expect, vi } from 'vitest';
import { z } from 'zod';

import { RankingsScreen, type RankingsScreenProps } from '@/features/rankings/rankings-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { MOCK_LOCATIONS } from '@/mocks/entity-fixtures';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { handlers } from '@/mocks/handlers';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';

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

/** What the route tells the screen about the import dialog. */
type ImportProps = Pick<RankingsScreenProps, 'importOpen' | 'onImportOpenChange'>;

/** Rankings of `projectId` for a member of `role`, signed in through the mock session cookie. */
export function rankingsAs(
  role: Role,
  projectId: string = fynix.project_id,
  importProps: ImportProps = {},
): ReactElement {
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
          {...importProps}
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

const TRACKED = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords';
const PAGE_BODY = z.object({
  data: z.array(z.object({ tracked_keyword_id: z.string() }).loose()),
  page: z.record(z.string(), z.unknown()),
});

/**
 * The list answered by the real mocks, told that it matches `total` keywords over pages of cursors
 * `cursor-1`, `cursor-2` and so on (`pages` of them, or without end): server mode above 10,000. Each page
 * holds the fixture rows, their ids made unique per page. Returns the query of each request, in order.
 */
export function answerTrackedAsMany({
  total,
  pages = Number.POSITIVE_INFINITY,
  failSecond = () => false,
  slow = () => false,
}: {
  total: number;
  pages?: number;
  /** The page after the first fails while this is true. */
  failSecond?: () => boolean;
  /** Pages after the first take 300 ms while this is true, so a test can act while one loads. */
  slow?: () => boolean;
}): URLSearchParams[] {
  const asked: URLSearchParams[] = [];
  server.use(
    http.get(mswPath(TRACKED), async ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get('limit') === '1') return undefined;
      asked.push(new URLSearchParams(url.searchParams));
      const cursor = url.searchParams.get('cursor');
      if (cursor !== null && slow()) await delay(300);
      const index = cursor === null ? 0 : Number(cursor.replace('cursor-', ''));
      if (index === 1 && failSecond()) return problem(request, 'not_found', { detail: 'A page that failed' });
      // The real answer of the first page for the same filters and sort
      url.searchParams.delete('cursor');
      const real = await getResponse([...handlers], new Request(url, { headers: request.headers }));
      const body = PAGE_BODY.parse(await real?.json());
      const more = index + 1 < pages;
      return HttpResponse.json({
        // Each page's rows get ids of their own: the page number goes ahead of the row's (below 1,000), so
        // the first page keeps the real ids and no two rows share one
        data: body.data.map((row) => ({
          ...row,
          tracked_keyword_id: `${row.tracked_keyword_id.slice(0, -6)}${String(index).padStart(3, '0')}${row.tracked_keyword_id.slice(-3)}`,
        })),
        page: { ...body.page, total, has_more: more, next_cursor: more ? `cursor-${String(index + 1)}` : null },
      });
    }),
  );
  return asked;
}

/** The keywords as their cells show them; the cells' tooltips hold the location and device too. */
export const keywordsIn = (grid: HTMLElement): string[] =>
  within(grid)
    .getAllByRole('rowheader')
    .map((cell) => cell.querySelector('.truncate')?.textContent ?? '');
