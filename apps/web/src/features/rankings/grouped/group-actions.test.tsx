import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MOCK_GROUP_IDS } from '@/mocks/keyword-fixtures';
import { mockId } from '@/mocks/mock-ids';
import { server } from '@/test/msw';
import { fynix, rankingsAs, restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/keywords',
}));

beforeEach(stubWideScreen);
afterEach(() => {
  restoreWideScreen();
  server.events.removeAllListeners();
});

type User = ReturnType<typeof renderWithProviders>['user'];
interface Sent {
  method: string;
  url: string;
  body: unknown;
}

/** Every write the screen sends, with its body. */
function captureWrites(): Sent[] {
  const sent: Sent[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'GET') return;
    const entry: Sent = { method: request.method, url: request.url, body: null };
    sent.push(entry);
    void request
      .clone()
      .text()
      .then((text) => {
        entry.body = text === '' ? null : (JSON.parse(text) as unknown);
      });
  });
  return sent;
}

/** Opens the menu of the Local group row and answers its items. */
async function localMenu(user: User): Promise<HTMLElement> {
  const tree = await screen.findByRole('treegrid', { name: 'Tracked keywords' });
  await user.click(await within(tree).findByRole('button', { name: 'Actions for Local, 10 keywords' }));
  return screen.findByRole('menu');
}

const byGroup = (role: 'editor' | 'viewer' = 'editor'): ReturnType<typeof rankingsAs> =>
  rankingsAs(role, fynix.project_id, { opensOnDefaultView: true });

describe('Group row actions', () => {
  it('lists Open group, Check now, Add keywords, Rename group and Delete group for an editor', async () => {
    const { user } = renderWithProviders(byGroup());
    const menu = await localMenu(user);
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining('Open group'),
      expect.stringContaining('Check now'),
      expect.stringContaining('Add keywords'),
      expect.stringContaining('Rename group'),
      expect.stringContaining('Delete group'),
    ]);
  });

  it('offers a viewer only what changes nothing', async () => {
    const { user } = renderWithProviders(byGroup('viewer'));
    const menu = await localMenu(user);
    expect(within(menu).queryByRole('menuitem', { name: /Rename group/ })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /Delete group/ })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /Add keywords/ })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: /Open group/ })).toBeInTheDocument();
  });

  it('checks the group with the tracked keywords of both devices of every keyword', async () => {
    const sent = captureWrites();
    const { user } = renderWithProviders(byGroup());
    const menu = await localMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: /Check now/ }));
    await waitFor(() => expect(sent.find((entry) => entry.url.endsWith('/seo/check-now'))?.body).toBeTruthy());
    const body = z
      .object({ tracked_keyword_ids: z.array(z.string()) })
      .parse(sent.find((entry) => entry.url.endsWith('/seo/check-now'))?.body);
    // Ten desktop keywords, and "seo agency berlin" on mobile too
    expect(body.tracked_keyword_ids).toHaveLength(11);
    expect(body.tracked_keyword_ids).toEqual(expect.arrayContaining([mockId('tracked', 1), mockId('tracked', 56)]));
  });

  it('opens Add keywords with the group chosen', async () => {
    const { user } = renderWithProviders(byGroup());
    const menu = await localMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: /Add keywords/ }));
    const dialog = await screen.findByRole('dialog', { name: /Add keywords/ });
    expect(within(dialog).getByRole('button', { name: 'Remove Local' })).toBeInTheDocument();
  });

  it('renames the group with its new name', async () => {
    const sent = captureWrites();
    const { user } = renderWithProviders(byGroup());
    const menu = await localMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: /Rename group/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename Local' });
    const field = within(dialog).getByRole('textbox', { name: 'Name' });
    await user.clear(field);
    await user.type(field, 'Local SEO');
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(sent.find((entry) => entry.method === 'PATCH')?.body).toEqual({ name: 'Local SEO' }));
    expect(sent.find((entry) => entry.method === 'PATCH')?.url).toContain(`/keyword-groups/${MOCK_GROUP_IDS.local}`);
    expect(await screen.findByText('Group renamed to Local SEO')).toBeInTheDocument();
  });

  it('asks before it deletes the group, in the words of Manage groups', async () => {
    const sent = captureWrites();
    const { user } = renderWithProviders(byGroup());
    const menu = await localMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: /Delete group/ }));
    const question = await screen.findByRole('alertdialog', { name: 'Delete Local?' });
    expect(within(question).getByText('Keywords in it stay tracked and leave the group.')).toBeInTheDocument();
    expect(sent.filter((entry) => entry.method === 'DELETE')).toHaveLength(0);
    await user.click(within(question).getByRole('button', { name: 'Delete group' }));
    await waitFor(() => expect(sent.filter((entry) => entry.method === 'DELETE')).toHaveLength(1));
    expect(sent.find((entry) => entry.method === 'DELETE')?.url).toContain(`/keyword-groups/${MOCK_GROUP_IDS.local}`);
  });
});
