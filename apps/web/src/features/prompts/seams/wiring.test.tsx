import { screen, within } from '@testing-library/react';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptsScreen } from '../prompts-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { MOCK_TERM_IDS } from '@/mocks/entity-fixtures';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { FIXTURE_PROMPTS } from '@/mocks/prompt-fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender } from '@/test/render';
// A topic drawer reads the entities and the tracked keywords: the harness answers both with none
import '@/test/topic-drawer-harness';

// Each seam's entries constant is replaced by one fake entry: what the screens show of it proves they read the seam
vi.mock('./inspector-tabs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./inspector-tabs')>()),
  PROMPT_TAB_ENTRIES: [{ id: 'fake', label: () => 'Fake tab', after: 'history', render: () => 'Fake panel' }],
}));
vi.mock('./topic-tabs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./topic-tabs')>()),
  TOPIC_TAB_ENTRIES: [{ id: 'fake-topic', label: () => 'Fake topic tab', render: () => 'Fake topic panel' }],
}));
vi.mock('./actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./actions')>()),
  PROMPT_ACTION_ENTRIES: [
    {
      id: 'fake-action',
      surfaces: ['promptRow', 'topicRow', 'bulk', 'inspectorMore'],
      permission: null,
      build: () => ({ id: 'fake-action', label: 'Fake action', group: 'copy', run: () => undefined }),
    },
  ],
}));
vi.mock('./columns', async (importOriginal) => {
  const { col } = await import('@/components/app/data-table/columns');
  return {
    ...(await importOriginal<typeof import('./columns')>()),
    PROMPT_COLUMN_ENTRIES: [
      {
        id: 'fake-columns',
        after: 'citation',
        build: () => [col.text('fake_column', () => 'Fake cell', { header: 'Fake column', defaultVisible: false })],
      },
    ],
  };
});
vi.mock('./toolbar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./toolbar')>()),
  PROMPTS_TOOLBAR_ENTRIES: [
    {
      id: 'fake-more',
      slot: 'more',
      permission: null,
      item: () => ({ id: 'fake-more', label: 'Fake more', onSelect: () => undefined }),
    },
    { id: 'fake-control', slot: 'actions', permission: null, render: () => <span>Fake control</span> },
  ],
}));
// jsdom has no canvas: a topic drawer's charts are drawn as an empty box
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(''),
}));

/** Thursday 12 November 2026, noon UTC: the 02:00 run has answered. */
const NOW = new Date('2026-11-12T12:00:00Z');

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const [first] = FIXTURE_PROMPTS.get(fynix.project_id) ?? [];
if (first === undefined) throw new Error('The fixture prompts are missing');

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
/** The place of each named tab in the tab row, which holds no others. */
const tabPlaces = (panel: HTMLElement, names: readonly string[]): number[] => {
  const row = within(panel).getAllByRole('tab');
  return [row.length, ...names.map((name) => row.indexOf(within(panel).getByRole('tab', { name })))];
};
const inspect = (target: string, tab?: string): string =>
  `?tab=prompts&inspect=${encodeURIComponent(target)}${tab === undefined ? '' : `&itab=${tab}`}`;

async function openMenu(user: ProvidedRender['user'], table: HTMLElement, name: string): Promise<void> {
  await user.click(await within(table).findByRole('button', { name: `Actions for ${name}` }));
  await screen.findByRole('menu');
}

describe('the prompt inspector reads the tab seam', () => {
  it('lists an entry after the tab it names, and shows its panel when chosen', async () => {
    const { user } = renderOn('viewer', inspect(`prompt:${first.prompt_id}`));
    const panel = await screen.findByRole('complementary', { name: first.text });
    expect(tabPlaces(panel, ['Latest', 'History', 'Fake tab', 'Competitors', 'Stats'])).toEqual([5, 0, 1, 2, 3, 4]);
    await user.click(within(panel).getByRole('tab', { name: 'Fake tab' }));
    expect(await within(panel).findByText('Fake panel')).toBeInTheDocument();
  });

  it('opens on the entry when the address names it', async () => {
    renderOn('viewer', inspect(`prompt:${first.prompt_id}`, 'fake'));
    const panel = await screen.findByRole('complementary', { name: first.text });
    expect(within(panel).getByRole('tab', { name: 'Fake tab' })).toHaveAttribute('aria-selected', 'true');
    expect(within(panel).getByText('Fake panel')).toBeInTheDocument();
  });
});

describe('the topic drawer reads the tab seam', () => {
  it('lists an entry after the built-in tabs, and shows its panel when chosen', async () => {
    const { user } = renderOn('viewer', `?inspect=${encodeURIComponent(`topic:${MOCK_TERM_IDS.paidSearch}`)}`);
    const panel = await screen.findByRole('complementary', { name: 'Paid Search' });
    expect(tabPlaces(panel, ['Overview', 'Prompts', 'Fake topic tab'])).toEqual([3, 0, 1, 2]);
    await user.click(within(panel).getByRole('tab', { name: 'Fake topic tab' }));
    expect(await within(panel).findByText('Fake topic panel')).toBeInTheDocument();
  });
});

describe('the menus read the action seam', () => {
  it('adds the entry to the row menu of a prompt', async () => {
    const { user } = renderOn('viewer', '?tab=prompts');
    await openMenu(user, await prompts(), first.text);
    expect(itemNames()).toEqual(['Open', 'Copy prompt', 'Fake action']);
  });

  it('adds the entry to the row menu of a topic', async () => {
    const { user } = renderOn('viewer', '');
    await openMenu(user, await topics(), 'SEO');
    expect(itemNames()).toEqual(['Open', 'Show in Prompts', 'Export CSV', 'Fake action']);
  });

  it('adds the entry to the bulk bar', async () => {
    const { user } = renderOn('viewer', '?tab=prompts');
    await user.click(await within(await prompts()).findByRole('checkbox', { name: `Select ${first.text}` }));
    const bar = screen.getByRole('group', { name: /^Bulk actions/ });
    expect(within(bar).getByRole('button', { name: 'Fake action' })).toBeInTheDocument();
  });

  it('adds the entry to the More menu of the prompt inspector', async () => {
    const { user } = renderOn('viewer', inspect(`prompt:${first.prompt_id}`));
    const panel = await screen.findByRole('complementary', { name: first.text });
    await user.click(await within(panel).findByRole('button', { name: /^More actions/ }));
    expect(await screen.findByRole('menuitem', { name: 'Fake action' })).toBeInTheDocument();
  });
});

describe('the table reads the column seam', () => {
  it('offers the columns of an entry in the column chooser', async () => {
    const { user } = renderOn('viewer', '?tab=prompts');
    await prompts();
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    expect(await screen.findByRole('checkbox', { name: 'Fake column' })).not.toBeChecked();
  });
});

describe('the header reads the toolbar seam', () => {
  it('draws the control of an entry before More actions, and its item in the menu after Copy link', async () => {
    const { user } = renderOn('viewer', '?tab=prompts');
    await prompts();
    const more = screen.getByRole('button', { name: /^More actions/ });
    const control = screen.getByText('Fake control');
    expect(control.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(more);
    await screen.findByRole('menu');
    expect(itemNames()).toEqual(['Copy link', 'Fake more']);
  });
});
