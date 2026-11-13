import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, useState, type ComponentType, type ReactElement } from 'react';

import { OverviewProvider } from '@/features/ai-overview';
import type { ExportBlock } from '@/features/ai-overview/export/export-model';
import { ExportProvider, useExportBlocks } from '@/features/ai-overview/export/export-registry';
import type { CardProps } from '@/features/layouts';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { overviewProject, type OverviewWorld } from '@/test/ai-overview-harness';
import { server } from '@/test/msw';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

/*
 * What the tests of the activity cards (WP-37 T6, T7) share: one card inside the real `OverviewProvider` and export
 * registry without the layout grid, so a card that the catalog would hide from a role (AI spend) still renders and
 * its own guard is what a test sees. Not a test file.
 */

/** An en-dash or an em-dash, built from code points so no source file holds the characters themselves. */
export const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

/** The layout item id the card is rendered under, and so the id of its export block. */
export const ITEM_ID = 'card-under-test';

function ExportProbe(): ReactElement {
  const read = useExportBlocks();
  const [blocks, setBlocks] = useState<readonly ExportBlock[]>([]);
  return (
    <>
      <button type="button" onClick={() => setBlocks(read().blocks)}>
        Read export
      </button>
      <pre data-testid="export-blocks">{JSON.stringify(blocks)}</pre>
    </>
  );
}

export interface RenderActivityOptions {
  role?: Role;
  world?: OverviewWorld;
  searchParams?: string;
  /** `customize` puts the card in an `inert` body, as the layout's card frame does: it is arranged, not used. */
  mode?: CardProps['mode'];
  /** The `live` prop of the card: `false` pauses its reads, as customize mode does in the grid. */
  live?: boolean;
}

/** One card of the activity family, signed in as `role`, on a project of the mock world. */
export function renderActivityCard(
  type: string,
  Card: ComponentType<CardProps>,
  { role = 'admin', world = 'fynix', searchParams = 'cmp=off', mode = 'view', live = true }: RenderActivityOptions = {},
): ProvidedRender {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  const card = <Card item={{ id: ITEM_ID, type, width: 'half' }} options={{}} width="half" mode={mode} live={live} />;
  return renderWithProviders(
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <OverviewProvider
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={overviewProject(world)}
        >
          <ExportProvider>
            {mode === 'customize' ? <div inert>{card}</div> : card}
            <ExportProbe />
          </ExportProvider>
        </OverviewProvider>
      </Suspense>
    </PermissionProvider>,
    { searchParams },
  );
}

/** The blocks the export registry holds now, after the probe's button is pressed. */
export async function readExport(user: ProvidedRender['user']): Promise<ExportBlock[]> {
  await user.click(screen.getByRole('button', { name: 'Read export' }));
  return JSON.parse(screen.getByTestId('export-blocks').textContent) as ExportBlock[];
}

/** The URLs of the requests the server sees from now on; call `stopRecording` in `afterEach`. */
const listeners: ((info: { request: Request }) => void)[] = [];
export function recordRequests(): URL[] {
  const seen: URL[] = [];
  const listener = ({ request }: { request: Request }): void => {
    seen.push(new URL(request.url));
  };
  listeners.push(listener);
  server.events.on('request:start', listener);
  return seen;
}
export function stopRecording(): void {
  for (const listener of listeners) server.events.removeListener('request:start', listener);
  listeners.length = 0;
}

/** A 500 problem answer with a request id, for the error state. */
export const failing = (requestId: string): Response =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: requestId },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

export const PROJECT = '*/api/v1/workspaces/:w/projects/:p';
export const WORKSPACE = '*/api/v1/workspaces/:w';

/** Serves a list answer on `url`, as a page with no further pages. */
export function serveList<T>(url: string, rows: readonly T[]): void {
  server.use(
    http.get(url, () =>
      HttpResponse.json({ data: rows, page: { offset: 0, limit: rows.length, total: rows.length }, meta: {} }),
    ),
  );
}
