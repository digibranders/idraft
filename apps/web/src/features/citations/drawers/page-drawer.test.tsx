import { act, screen, waitFor, within } from '@testing-library/react';
import { getResponse, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PageDrawer, type PageDrawerProps } from './page-drawer';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import type { CitedPageDetail } from '@/lib/citations/board-queries';
import { CITATIONS_FIXTURE } from '@/mocks/citations-v2-fixture';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { handlers } from '@/mocks/handlers';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
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

const CITED_PAGE = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/cited-pages/{url_id}');
const TWO_ENGINES = [
  { code: 'chatgpt_web', label: 'ChatGPT' },
  { code: 'gemini_web', label: 'Gemini' },
] as const;
const TWO_ENGINE_PROPS: Partial<PageDrawerProps> = {
  scope: { runs: 4, engines: ['chatgpt_web', 'gemini_web'], term: null },
  engines: TWO_ENGINES,
};

/**
 * Serves the real mock detail changed by `change`. `gate` holds each answer until it resolves, so a test sees the
 * drawer while a read is under way.
 */
function serve(change: (detail: CitedPageDetail) => void, gate?: () => Promise<void>): void {
  server.use(
    http.get(CITED_PAGE, async ({ request }) => {
      if (gate !== undefined) await gate();
      const detail = (await (await getResponse([...handlers], request))?.json()) as CitedPageDetail;
      change(detail);
      return HttpResponse.json(detail);
    }),
  );
}

/** The slot of a run, a week apart, from 1 September. */
const slotOf = (index: number): CitedPageDetail['window']['trend'][number] => ({
  slot: index + 1,
  answers: 4,
  first_at: new Date(Date.UTC(2026, 8, 1 + 7 * index, 2)).toISOString(),
  last_at: new Date(Date.UTC(2026, 8, 1 + 7 * index, 3)).toISOString(),
});

const promptRow = (
  text: string,
  cited: number,
  answers: number,
  engines: CitedPageDetail['prompts'][number]['engines'],
): CitedPageDetail['prompts'][number] => ({
  prompt_id: `00000000-0000-4000-8000-${String(text.length).padStart(12, '0')}`,
  text,
  cited,
  answers,
  last_cited_at: '2026-10-20T02:00:00Z',
  engines,
});

/** A promise and the function that settles it. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('the page drawer, its states and values', () => {
  it('says the page could not be loaded, and loads it on Try again', async () => {
    server.use(http.get(CITED_PAGE, ({ request }) => problem(request, 'internal_error')));
    const { user } = setup();
    const drawer = await screen.findByRole('complementary');
    expect(await within(drawer).findByText('Could not load this page')).toBeVisible();
    expect(within(drawer).getByText('The server returned an error. Your scope is unchanged.')).toBeVisible();
    expect(within(drawer).queryByRole('table')).toBeNull();
    // The next answer is the page
    serve(() => undefined);
    await user.click(within(drawer).getByRole('button', { name: 'Try again' }));
    expect(await within(drawer).findByRole('table', { name: 'Prompts that cite this page' })).toBeVisible();
    expect(within(drawer).queryByText('Could not load this page')).toBeNull();
  });

  it('says the page could not be loaded on Overview too, with one Try again for the tab', async () => {
    server.use(http.get(CITED_PAGE, ({ request }) => problem(request, 'internal_error')));
    setup({ tab: 'page-overview' });
    const drawer = await screen.findByRole('complementary');
    expect(await within(drawer).findByText('Could not load this page')).toBeVisible();
    expect(within(drawer).getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
    expect(within(drawer).queryByRole('heading', { name: 'Summary' })).toBeNull();
  });

  it('shows a skeleton in each card while the page loads, and the cards when it has loaded', async () => {
    const gate = deferred();
    serve(
      () => undefined,
      () => gate.promise,
    );
    setup({ tab: 'page-overview' });
    const drawer = await screen.findByRole('complementary');
    await waitFor(() => expect(drawer.querySelectorAll('section[aria-busy="true"]')).toHaveLength(4));
    expect(within(drawer).getByRole('heading', { name: 'Summary' })).toBeVisible();
    expect(within(drawer).getByRole('heading', { name: 'By platform' })).toBeVisible();
    expect(within(drawer).queryByRole('table')).toBeNull();
    gate.release();
    expect(await within(drawer).findByRole('table', { name: 'By platform' })).toBeVisible();
    expect(drawer.querySelectorAll('section[aria-busy="true"]')).toHaveLength(0);
  });

  it('shows a skeleton in the Prompts card while the page loads', async () => {
    const gate = deferred();
    serve(
      () => undefined,
      () => gate.promise,
    );
    setup();
    const drawer = await screen.findByRole('complementary');
    await waitFor(() => expect(drawer.querySelectorAll('section[aria-busy="true"]')).toHaveLength(1));
    // A skeleton has the card's 16 px edges, a flush table has none
    expect(drawer.querySelector('section[aria-busy="true"] > div:last-child')).toHaveClass('px-4', 'pb-4');
    gate.release();
    expect(await within(drawer).findByRole('table', { name: 'Prompts that cite this page' })).toBeVisible();
  });

  it('keeps the data on screen while it is read again', async () => {
    let reads = 0;
    const gate = deferred();
    serve(
      () => undefined,
      async () => {
        reads += 1;
        if (reads > 1) await gate.promise;
      },
    );
    const { queryClient } = setup();
    const drawer = await screen.findByRole('complementary');
    const table = await within(drawer).findByRole('table', { name: 'Prompts that cite this page' });
    const rows = within(table).getAllByRole('row').length;
    act(() => {
      void queryClient.invalidateQueries();
    });
    await waitFor(() => expect(reads).toBe(2));
    expect(drawer.querySelectorAll('section[aria-busy="true"]')).toHaveLength(0);
    expect(within(drawer).getByRole('table', { name: 'Prompts that cite this page' })).toBe(table);
    expect(within(table).getAllByRole('row')).toHaveLength(rows);
    gate.release();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(within(drawer).getByRole('table', { name: 'Prompts that cite this page' })).toBeVisible();
  });

  it('says no prompt cites the page, in a card without edges of its own, when the list is empty', async () => {
    serve((detail) => {
      detail.prompts = [];
    });
    setup();
    const drawer = await screen.findByRole('complementary');
    const title = await within(drawer).findByText('No prompt cites this page');
    expect(within(drawer).getByText('Nothing in this scope. Choose more runs or another group.')).toBeVisible();
    expect(within(drawer).queryByRole('table')).toBeNull();
    // The empty card pads itself (py-6), so the card body adds nothing
    const body = title.closest('[data-slot="empty-state"]')?.parentElement;
    expect(body?.className ?? '').not.toContain('px-4');
  });

  it('says a page is cited alone when no other domain is cited beside it', async () => {
    serve((detail) => {
      detail.alongside = [];
    });
    setup({ tab: 'page-overview' });
    const drawer = await screen.findByRole('complementary');
    expect(await within(drawer).findByText('Cited alone')).toBeVisible();
    expect(within(drawer).getByText('No other domain is cited in the answers that cite this page.')).toBeVisible();
    expect(within(drawer).queryByRole('table', { name: 'Cited alongside' })).toBeNull();
  });

  describe('the prompts', () => {
    const SERVED_PROMPTS = [
      promptRow('alpha prompt', 2, 3, [
        { engine_code: 'chatgpt_web', answers: 3, cited: 2 },
        { engine_code: 'gemini_web', answers: 0, cited: 0 },
      ]),
      promptRow('beta prompt', 1, 3, [
        { engine_code: 'chatgpt_web', answers: 2, cited: 0 },
        { engine_code: 'gemini_web', answers: 1, cited: 1 },
      ]),
    ];

    const rowOf = async (name: string): Promise<HTMLElement> => {
      const drawer = await screen.findByRole('complementary');
      const table = await within(drawer).findByRole('table', { name: 'Prompts that cite this page' });
      const row = within(table).getByRole('button', { name: name }).closest('tr');
      if (row === null) throw new Error(`No row for ${name}`);
      return row;
    };
    /** The platform marks of a row, in the order of the engines. */
    const marksOf = (row: HTMLElement): HTMLElement[] => [
      ...row.querySelectorAll<HTMLElement>('td:nth-child(2) span.flex > span'),
    ];

    beforeEach(() => {
      serve((detail) => {
        detail.prompts = SERVED_PROMPTS;
      });
    });

    it('draws a platform mark at 25 % where the platform did not cite the prompt', async () => {
      setup(TWO_ENGINE_PROPS);
      const alpha = marksOf(await rowOf('alpha prompt'));
      expect(alpha).toHaveLength(2);
      expect(alpha[0]).not.toHaveClass('opacity-25');
      expect(alpha[1]).toHaveClass('opacity-25');
      const beta = marksOf(await rowOf('beta prompt'));
      // ChatGPT answered twice and cited nothing: as faint as a platform that did not answer
      expect(beta[0]).toHaveClass('opacity-25');
      expect(beta[1]).not.toHaveClass('opacity-25');
    });

    it('says in a tooltip how many answers of each platform cite the page, or that it has none', async () => {
      const { user } = setup(TWO_ENGINE_PROPS);
      const alpha = marksOf(await rowOf('alpha prompt'));
      await user.hover(alpha[0]?.parentElement ?? document.body);
      await waitFor(() => expect(tooltip()).toHaveTextContent('ChatGPT: 2 of 3 answers. Gemini: no answers'));
      await user.unhover(alpha[0]?.parentElement ?? document.body);
      const beta = marksOf(await rowOf('beta prompt'));
      await user.hover(beta[0]?.parentElement ?? document.body);
      await waitFor(() => expect(tooltip()).toHaveTextContent('ChatGPT: 0 of 2 answers. Gemini: 1 of 1 answers'));
    });

    it('shows cited over answers as k/n, with the tooltip in words', async () => {
      const { user } = setup(TWO_ENGINE_PROPS);
      const row = await rowOf('alpha prompt');
      const cell = row.querySelector('td:nth-child(3)');
      expect(cell).toHaveTextContent('2/3');
      const count = cell?.querySelector('span');
      if (count === null || count === undefined) throw new Error('The cited cell is empty');
      await user.hover(count);
      await waitFor(() => expect(tooltip()).toHaveTextContent('Cited in 2 of the prompt’s 3 answers'));
    });
  });

  describe('the overview values', () => {
    beforeEach(() => {
      serve((detail) => {
        detail.page.citations = 8;
        detail.page.previous_citations = 5;
        detail.page.prompts = 3;
        detail.page.last_cited_at = '2026-11-03T02:00:00Z';
        detail.page.engines = [
          { engine_code: 'chatgpt_web', citation_units: 6 },
          { engine_code: 'gemini_web', citation_units: 2 },
        ];
        detail.window.latest_answer_at = '2026-11-10T02:00:00Z';
        detail.window.trend = Array.from({ length: 8 }, (_, index) => slotOf(index));
      });
    });

    it('says the citations with their signed change, the prompts and the day of the last citation', async () => {
      setup({ ...TWO_ENGINE_PROPS, tab: 'page-overview' });
      const drawer = await screen.findByRole('complementary');
      expect(await within(drawer).findByText('Summary')).toBeVisible();
      const value = (term: string): HTMLElement | null =>
        within(drawer).getByText(term, { selector: 'dt' }).nextElementSibling as HTMLElement | null;
      expect(value('Citations')).toHaveTextContent('8+3');
      expect(value('Prompts')).toHaveTextContent('3');
      expect(value('Last cited')).toHaveTextContent('Nov 3');
    });

    it('says a fall as a signed number too', async () => {
      serve((detail) => {
        detail.page.citations = 4;
        detail.page.previous_citations = 9;
        detail.window.trend = Array.from({ length: 8 }, (_, index) => slotOf(index));
      });
      setup({ ...TWO_ENGINE_PROPS, tab: 'page-overview' });
      const drawer = await screen.findByRole('complementary');
      const dd = (await within(drawer).findByText('Citations', { selector: 'dt' })).nextElementSibling;
      expect(dd).toHaveTextContent('4');
      expect(dd?.textContent).toMatch(/4\s*[-−]5$/u);
    });

    it('says each platform’s citations and its share of the page’s, in whole percents', async () => {
      setup({ ...TWO_ENGINE_PROPS, tab: 'page-overview' });
      const drawer = await screen.findByRole('complementary');
      const table = await within(drawer).findByRole('table', { name: 'By platform' });
      const rows = within(table).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(2);
      const cells = (row: HTMLElement): (string | null)[] =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent);
      expect(cells(rows[0] as HTMLElement)).toEqual(['ChatGPT', '6', '75%']);
      expect(cells(rows[1] as HTMLElement)).toEqual(['Gemini', '2', '25%']);
    });

    it('names the first and the last day of the trend under it', async () => {
      setup({ ...TWO_ENGINE_PROPS, tab: 'page-overview' });
      const drawer = await screen.findByRole('complementary');
      expect(await within(drawer).findByText('last 8 weekly runs')).toBeVisible();
      const axis = within(drawer).getByText('Sep 1').parentElement;
      // Run 8 starts on 1 September plus 49 days, and its last answer is that day
      expect(axis?.children[0]).toHaveTextContent('Sep 1');
      expect(axis?.children[1]).toHaveTextContent('Oct 20');
    });

    it('says a share of a page without citations as n/a, not a percent of nothing', async () => {
      serve((detail) => {
        detail.page.citations = 0;
        detail.page.previous_citations = 0;
        detail.page.engines = [];
      });
      setup({ ...TWO_ENGINE_PROPS, tab: 'page-overview' });
      const drawer = await screen.findByRole('complementary');
      const table = await within(drawer).findByRole('table', { name: 'By platform' });
      const rows = within(table).getAllByRole('row').slice(1);
      for (const row of rows) {
        expect(within(row).getAllByRole('cell')[2]).toHaveTextContent(/^n\/a$/u);
        expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('0');
      }
    });
  });

  describe('the address', () => {
    it('opens a web address in a new tab', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      const { user } = setup({ tab: 'page-overview' });
      const drawer = await screen.findByRole('complementary');
      await user.click(await within(drawer).findByRole('button', { name: 'Open the page in a new tab' }));
      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https?:\/\//u), '_blank', 'noopener');
    });

    it('draws no open button for an address that is not a web address, and still copies it', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      serve((detail) => {
        detail.page.url = 'javascript:alert(1)';
        detail.page.title = null;
      });
      setup({ tab: 'page-overview' });
      const drawer = await screen.findByRole('complementary');
      expect(await within(drawer).findByRole('button', { name: 'Copy address' })).toBeVisible();
      expect(within(drawer).queryByRole('button', { name: 'Open the page in a new tab' })).toBeNull();
      expect(within(drawer).getAllByText('javascript:alert(1)').length).toBeGreaterThan(0);
      expect(open).not.toHaveBeenCalled();
    });
  });
});
