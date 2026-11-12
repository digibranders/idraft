import { screen, waitFor, within } from '@testing-library/react';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptsScreen } from './prompts-screen';
import type { Role } from '@/lib/api/types';
import * as clipboard from '@/lib/dom/clipboard';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
}));
// Nothing is copied: the call is what the test reads
vi.mock('@/lib/dom/clipboard', async (importOriginal) => ({
  ...(await importOriginal<typeof clipboard>()),
  copyText: vi.fn(() => Promise.resolve(true)),
}));

/** Thursday 12 November 2026, noon UTC: the 02:00 run has answered. */
const NOW = new Date('2026-11-12T12:00:00Z');

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');

const FIRST = 'Which SEO agency is best for a SaaS startup in Germany?';
const OTHER_TOPIC = 'Which agencies write content strategies for B2B software?';

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
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

const renderOn = (role: Role, searchParams: string): ProvidedRender =>
  renderWithProviders(promptsAs(role), { searchParams });
const prompts = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Prompts' });
const topics = (): Promise<HTMLElement> => screen.findByRole('treegrid', { name: 'Topics' });
const itemNames = (): string[] => screen.getAllByRole('menuitem').map((item) => item.textContent ?? '');

async function openMenu(user: ProvidedRender['user'], table: HTMLElement, name: string): Promise<void> {
  await user.click(await within(table).findByRole('button', { name: `Actions for ${name}` }));
  await screen.findByRole('menu');
}

describe('the row menu of a prompt', () => {
  it('has Open and Copy prompt for a viewer, and no action that changes anything', async () => {
    const { user } = renderOn('viewer', '?tab=prompts');
    await openMenu(user, await prompts(), FIRST);
    expect(itemNames()).toEqual(['Open', 'Copy prompt']);
  });

  it('has Run now for an analyst, and Archive after the others for an editor', async () => {
    const analyst = renderOn('analyst', '?tab=prompts');
    await openMenu(analyst.user, await prompts(), FIRST);
    expect(itemNames()).toEqual(['Open', 'Run now', 'Copy prompt']);
    analyst.unmount();
    const editor = renderOn('editor', '?tab=prompts');
    await openMenu(editor.user, await prompts(), FIRST);
    expect(itemNames()).toEqual(['Open', 'Run now', 'Copy prompt', 'Archive']);
  });

  it('opens the prompt in the inspector', async () => {
    const { user } = renderOn('viewer', '?tab=prompts');
    await openMenu(user, await prompts(), FIRST);
    await user.click(screen.getByRole('menuitem', { name: 'Open' }));
    expect(await screen.findByRole('complementary', { name: FIRST })).toBeInTheDocument();
  });

  it('copies the text of the prompt and says so', async () => {
    const copy = vi.mocked(clipboard.copyText);
    copy.mockClear();
    const { user } = renderOn('viewer', '?tab=prompts');
    await openMenu(user, await prompts(), FIRST);
    await user.click(screen.getByRole('menuitem', { name: 'Copy prompt' }));
    expect(copy).toHaveBeenCalledExactlyOnceWith(FIRST);
    expect((await screen.findAllByText('Prompt copied')).length).toBeGreaterThan(0);
  });

  it('runs the one prompt at once, with no confirm, and says the run is queued', async () => {
    const { user } = renderOn('editor', '?tab=prompts');
    await openMenu(user, await prompts(), FIRST);
    await user.click(screen.getByRole('menuitem', { name: 'Run now' }));
    expect((await screen.findAllByText('Run queued')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('archives the one prompt with Undo', async () => {
    const { user } = renderOn('editor', '?tab=prompts');
    const table = await prompts();
    await openMenu(user, table, FIRST);
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect((await screen.findAllByText('1 prompt archived')).length).toBeGreaterThan(0);
    await user.click((await screen.findAllByRole('button', { name: 'Undo' }))[0] as HTMLElement);
    expect((await screen.findAllByText('1 prompt restored')).length).toBeGreaterThan(0);
  });
});

describe('the row menu of a topic', () => {
  it('has Open, Show in Prompts and Export CSV for a viewer', async () => {
    const { user } = renderOn('viewer', '');
    await openMenu(user, await topics(), 'SEO');
    expect(itemNames()).toEqual(['Open', 'Show in Prompts', 'Export CSV']);
  });

  it('has Add prompt for a writer and Run now for someone who may run, in the order of the table menus', async () => {
    const { user } = renderOn('editor', '');
    await openMenu(user, await topics(), 'SEO');
    expect(itemNames()).toEqual(['Open', 'Show in Prompts', 'Run now', 'Add prompt', 'Export CSV']);
  });

  it('opens the topic drawer', async () => {
    const { user } = renderOn('viewer', '');
    await openMenu(user, await topics(), 'SEO');
    await user.click(screen.getByRole('menuitem', { name: 'Open' }));
    expect(await screen.findByRole('complementary', { name: 'SEO' })).toBeInTheDocument();
  });

  it('shows the topic in the Prompts tab with the topic as the filter, and the other filters kept', async () => {
    const { user } = renderOn('viewer', '?engine=gemini_web');
    await openMenu(user, await topics(), 'Content Marketing');
    await user.click(screen.getByRole('menuitem', { name: 'Show in Prompts' }));
    const table = await prompts();
    expect(await within(table).findByText(OTHER_TOPIC)).toBeInTheDocument();
    expect(within(table).queryByText(FIRST)).toBeNull();
    const filters = screen.getByRole('group', { name: 'Filters' });
    expect(within(filters).getByRole('button', { name: /^Topic: Content Marketing/ })).toBeInTheDocument();
    expect(within(filters).getByRole('button', { name: /^Engine: / })).toBeInTheDocument();
  });

  it('opens Add prompts with the topic already chosen', async () => {
    const { user } = renderOn('editor', '');
    await openMenu(user, await topics(), 'SEO');
    await user.click(screen.getByRole('menuitem', { name: 'Add prompt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add prompts' });
    expect(within(dialog).getByRole('combobox', { name: /^Topic/ })).toHaveTextContent('SEO');
  });

  it('asks before it runs the prompts of the topic, and names the cap above five', async () => {
    const { user } = renderOn('editor', '');
    await openMenu(user, await topics(), 'SEO');
    await user.click(screen.getByRole('menuitem', { name: 'Run now' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Run 12 prompts now?' });
    expect(within(dialog).getByText(/A project can make 20 manual runs a day/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
});
