import { screen, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptsScreen } from './prompts-screen';
import type { Role } from '@/lib/api/types';
import * as csv from '@/lib/csv/csv-write';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { promptView } from '@/mocks/handlers/prompts';
import { promptsOf } from '@/mocks/prompts-state';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
}));
// The file is not written: the call is what the test reads
vi.mock('@/lib/csv/csv-write', async (importOriginal) => ({
  ...(await importOriginal<typeof csv>()),
  downloadBlob: vi.fn(),
}));

/** Thursday 12 November 2026, noon UTC: the 02:00 run has answered. */
const NOW = new Date('2026-11-12T12:00:00Z');
const LIST = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts');

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');

const FIRST = 'Which SEO agency is best for a SaaS startup in Germany?';

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
  server.events.removeAllListeners();
});

function promptsAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <PromptsScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={{
            id: fynix?.project_id ?? '',
            slug: 'fynix',
            name: 'Fynix',
            timeZone: 'Europe/Berlin',
            defaultLanguage: 'en',
            defaultCountryIso: 'DE',
          }}
        />
      </Suspense>
    </PermissionProvider>
  );
}

const renderOn = (role: Role): ProvidedRender => renderWithProviders(promptsAs(role), { searchParams: '' });
const active = () => promptsOf(fynix?.project_id ?? '').prompts.filter((prompt) => prompt.is_active);

async function openSeoMenu(user: ProvidedRender['user']): Promise<void> {
  const tree = await screen.findByRole('treegrid', { name: 'Topics' });
  await user.click(await within(tree).findByRole('button', { name: 'Actions for SEO' }));
  await screen.findByRole('menu');
}

describe('the menu of a topic while the prompt list is not whole', () => {
  it('waits for the list before it runs or exports the prompts of a topic, and says why', async () => {
    // The first page arrives and the second never does: the topic counts are there, the prompts of the topic are not
    server.use(
      http.get(LIST, async ({ request }) => {
        if (new URL(request.url).searchParams.has('cursor')) await delay('infinite');
        return HttpResponse.json({
          data: active().slice(0, 5).map(promptView),
          page: { limit: 200, next_cursor: 'more', has_more: true },
        });
      }),
    );
    const { user } = renderOn('editor');
    await openSeoMenu(user);
    for (const name of ['Run now', 'Export CSV']) {
      const item = screen.getByRole('menuitem', { name: new RegExp(name) });
      expect(item).toHaveAttribute('aria-disabled', 'true');
      expect(item).toHaveTextContent('The prompts are still loading.');
    }
    // What does not read the list stays open
    expect(screen.getByRole('menuitem', { name: 'Show in Prompts' })).not.toHaveAttribute('aria-disabled', 'true');
  });
});

describe('Run now from the menu of a topic', () => {
  it('sends the prompts of the topic in one request, after the confirm, and says what started', async () => {
    const bodies: { prompt_ids: string[]; engine_codes?: string[] }[] = [];
    const singles: string[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.method !== 'POST') return;
      if (request.url.endsWith('/ai/runs')) bodies.push((await request.clone().json()) as (typeof bodies)[number]);
      if (request.url.endsWith('/run-now')) singles.push(request.url);
    });
    const { user } = renderOn('editor');
    await openSeoMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Run now' }));
    await user.click(await screen.findByRole('button', { name: 'Run 12 prompts' }));
    expect((await screen.findAllByText(/^Run started: 12 prompts on \d engines?$/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/^About \$/)).length).toBeGreaterThan(0);
    // One request with the 12 prompts, and the engines left to the API; none of the single prompt route
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.prompt_ids).toHaveLength(12);
    expect(bodies[0]?.engine_codes).toBeUndefined();
    expect(singles).toEqual([]);
  });
});

describe('the menu of a topic for prompts the list does not hold', () => {
  it('exports only the prompts it holds and says how many it does not, and never writes a file of a header alone', async () => {
    const download = vi.mocked(csv.downloadBlob);
    download.mockClear();
    // A list without the first prompt, whole: the summary still counts it in its topic
    server.use(
      http.get(LIST, () =>
        HttpResponse.json({
          data: active()
            .filter((prompt) => prompt.text !== FIRST)
            .map(promptView),
          page: { limit: 200, next_cursor: null, has_more: false },
        }),
      ),
    );
    const { user } = renderOn('editor');
    await openSeoMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Export CSV' }));
    expect(download).toHaveBeenCalledOnce();
    const text = await ((download.mock.calls[0]?.[0] as Blob | undefined)?.text() ?? Promise.resolve(''));
    // The header and the SEO prompts of the list: 12 in the topic, one of them not in the list
    expect(text.trim().split('\r\n')).toHaveLength(12);
    expect((await screen.findAllByText('11 prompts exported')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('1 prompt is not loaded yet.')).length).toBeGreaterThan(0);
  });

  it('asks about the prompts it holds when it runs a topic, and counts only those', async () => {
    server.use(
      http.get(LIST, () =>
        HttpResponse.json({
          data: active()
            .filter((prompt) => prompt.text !== FIRST)
            .map(promptView),
          page: { limit: 200, next_cursor: null, has_more: false },
        }),
      ),
    );
    const { user } = renderOn('editor');
    await openSeoMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Run now' }));
    expect(await screen.findByRole('alertdialog', { name: 'Run 11 prompts now?' })).toBeInTheDocument();
  });
});
