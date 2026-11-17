import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PageDrawer, type PageDrawerProps } from './page-drawer';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { CITATIONS_FIXTURE } from '@/mocks/citations-v2-fixture';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');
const TOP = CITATIONS_FIXTURE.expected.chatgpt.pages.topOwn;
// The mock model numbers the fixture's pages from 1, in the order of `urls`
const TOP_ID = CITATIONS_FIXTURE.urls.findIndex((url) => url.role === 'own' && url.path === TOP.path) + 1;

const tooltip = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="tooltip"]');

const propsOf = (overrides: Partial<PageDrawerProps> = {}): PageDrawerProps => ({
  project: { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id },
  scope: { runs: 4, engines: ['chatgpt_web'], term: null },
  urlId: TOP_ID,
  engines: [{ code: 'chatgpt_web', label: 'ChatGPT' }],
  scopeParts: ['ChatGPT', 'All groups', 'Last 4 runs'],
  scopeText: 'ChatGPT, All groups, Last 4 runs',
  stepping: { positionText: '1 of 13', navigation: null, onStep: undefined },
  tab: 'overview',
  onTabChange: vi.fn(),
  onClose: vi.fn(),
  onOpenPrompt: vi.fn(),
  timeZone: 'Europe/Berlin',
  ...overrides,
});

function setup(overrides: Partial<PageDrawerProps> = {}) {
  const props = propsOf(overrides);
  return {
    props,
    ...renderWithProviders(
      <InspectorLayout inspector={<PageDrawer {...props} />}>
        <main />
      </InspectorLayout>,
    ),
  };
}

beforeEach(() => {
  stubWideScreen();
  // jsdom has no canvas: the trend draws on a stub
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

afterEach(() => {
  restoreWideScreen();
  vi.restoreAllMocks();
});

describe('the page drawer (I 71 to 207)', () => {
  it('heads the page with its owner, the scope and its citations, on the Prompts tab', async () => {
    const { container } = setup();
    const drawer = await screen.findByRole('complementary');
    expect(await within(drawer).findByText('Your page')).toBeVisible();
    for (const part of ['ChatGPT', 'All groups', 'Last 4 runs']) {
      expect(within(drawer).getAllByText(part).length).toBeGreaterThan(0);
    }
    expect(within(drawer).getByText('Cited page')).toBeVisible();
    expect(within(drawer).getByText('1 of 13')).toBeVisible();
    expect(within(drawer).getByText(`${String(TOP.citations)} citations`)).toBeVisible();
    expect(within(drawer).getByRole('tab', { name: 'Prompts' })).toHaveAttribute('aria-selected', 'true');
    expect(await within(drawer).findByRole('heading', { name: 'Prompts that cite this page' })).toBeVisible();
    expect(
      within(drawer).getByText(`${String(TOP.prompts)} prompts · cited in ${String(TOP.citations)} answers`),
    ).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('opens a prompt with the list of the drawer for J and K', async () => {
    const { user, props } = setup();
    const drawer = await screen.findByRole('complementary');
    const table = await within(drawer).findByRole('table', { name: 'Prompts that cite this page' });
    const buttons = within(table).getAllByRole('button');
    const first = buttons[0];
    if (first === undefined) throw new Error('The page has no prompt');
    await user.click(first);
    expect(props.onOpenPrompt).toHaveBeenCalledTimes(1);
    const [promptId, ids] = vi.mocked(props.onOpenPrompt).mock.calls[0] ?? [];
    expect(ids).toHaveLength(buttons.length);
    expect(ids).toContain(promptId);
  });

  it('steps to the next page of the table on J (I 336 to 340)', async () => {
    const onStep = vi.fn();
    const navigation = { onPrevious: vi.fn(), onNext: vi.fn(), atFirst: false, atLast: false };
    const { user } = setup({ stepping: { positionText: '2 of 13', navigation, onStep } });
    await screen.findByRole('complementary');
    await user.keyboard('j');
    expect(onStep).toHaveBeenCalledWith('next');
  });

  it('shows the summary, the address, the trend, the platforms and what is cited alongside on Overview', async () => {
    const { container } = setup({ tab: 'page-overview' });
    const drawer = await screen.findByRole('complementary');
    expect(await within(drawer).findByText('Summary')).toBeVisible();
    expect(within(drawer).getByRole('button', { name: 'Copy address' })).toBeVisible();
    expect(within(drawer).getByRole('button', { name: 'Open the page in a new tab' })).toBeVisible();
    expect(within(drawer).getByText('Citations per run')).toBeVisible();
    expect(within(drawer).getByText('last 8 weekly runs')).toBeVisible();
    expect(within(drawer).getByText('citations · share')).toBeVisible();
    expect(within(drawer).getByRole('heading', { name: 'Cited alongside' })).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keeps the preview tooltip on the open button apart from its name (I 148)', async () => {
    const { user } = setup({ tab: 'page-overview' });
    const drawer = await screen.findByRole('complementary');
    await user.hover(await within(drawer).findByRole('button', { name: 'Open the page in a new tab' }));
    await waitFor(() => expect(tooltip()).toHaveTextContent('Open the page'));
    expect(tooltip()).not.toHaveTextContent('in a new tab');
  });

  it('copies the address and says so (I 138 to 143)', async () => {
    // user-event gives the page a clipboard of its own
    const { user } = setup({ tab: 'page-overview' });
    const drawer = await screen.findByRole('complementary');
    await user.click(await within(drawer).findByRole('button', { name: 'Copy address' }));
    expect(await screen.findByText('Address copied')).toBeVisible();
    expect(await navigator.clipboard.readText()).toMatch(/^https?:\/\//);
  });

  it('says so, and where to copy it from, when the address cannot be copied', async () => {
    const { user } = setup({ tab: 'page-overview' });
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('refused'));
    const drawer = await screen.findByRole('complementary');
    await user.click(await within(drawer).findByRole('button', { name: 'Copy address' }));
    // The toast is announced and drawn, so its words are on the page twice
    expect((await screen.findAllByText('Could not copy the address')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Copy it from the field instead.').length).toBeGreaterThan(0);
  });

  it('says the page is not cited in this scope on a 404, on both tabs', async () => {
    const { unmount } = setup({ urlId: 999_999 });
    expect(await screen.findByText('Not cited in this scope')).toBeVisible();
    expect(
      screen.getByText('No answer in ChatGPT, All groups, Last 4 runs cites this page.', { exact: false }),
    ).toBeVisible();
    unmount();
    setup({ urlId: 999_999, tab: 'page-overview' });
    expect(await screen.findByText('Not cited in this scope')).toBeVisible();
  });
});
