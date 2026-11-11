import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enginesKey } from './prompt-queries';
import { PromptsScreen, type PromptsProject } from './prompts-screen';
import { TopBarSlotProvider, TopBarSlotTarget } from '@/components/app/shell/top-bar-slot';
import type { Prompt, Role, TermNode } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { MOCK_TERM_IDS } from '@/mocks/entity-fixtures';
import { NO_COUNTS, promptCells, topicCells, type Counts } from '@/mocks/prompt-summary';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender, type ProvidedRenderOptions } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
}));

/** Thursday 12 November 2026, noon UTC: the 02:00 run has answered. */
const NOW = new Date('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';

const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixture projects are missing');
const asProject = (project: (typeof MOCK_PROJECTS)[number], country: string): PromptsProject => ({
  id: project.project_id,
  slug: project.slug,
  name: project.name,
  timeZone: project.timezone,
  defaultLanguage: 'en',
  defaultCountryIso: country,
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
});

const fynixProject = asProject(fynix, 'DE');

function promptsAs(role: Role, project: PromptsProject = fynixProject): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <PromptsScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={project}
        />
      </Suspense>
    </PermissionProvider>
  );
}

const grid = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Prompts' });

/** Renders on the Prompts tab, as a link to it does: the page opens on Topics, which has its own tests below. */
function renderOnPrompts(
  ui: ReactElement,
  { searchParams = '', ...options }: ProvidedRenderOptions = {},
): ProvidedRender {
  const query = new URLSearchParams({ tab: 'prompts' });
  for (const [key, value] of new URLSearchParams(searchParams)) if (key !== 'tab') query.append(key, value);
  return renderWithProviders(ui, { ...options, searchParams: `?${query.toString()}` });
}

describe('Topics & Prompts', () => {
  it('lists the active prompts with their topic and country, and the window in the top bar', async () => {
    const { container } = renderOnPrompts(promptsAs('viewer'), { searchParams: '?tab=prompts' });
    const table = await grid();
    expect(
      await within(table).findByText('Which SEO agency is best for a SaaS startup in Germany?'),
    ).toBeInTheDocument();
    expect(within(table).getAllByText('Technical SEO').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Germany').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1, name: 'Topics & Prompts' })).toBeInTheDocument();
    expect(screen.getByText('Answers from Oct 16 to Nov 12, 2026')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says no engine is on, and where to turn one on, for a project without one', async () => {
    renderOnPrompts(promptsAs('editor', asProject(cleanstart, 'US')));
    expect(await screen.findByRole('heading', { name: 'No AI engine is on' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the Engines settings' })).toHaveAttribute(
      'href',
      '/digibranders/cleanstart/settings/engines',
    );
  });

  it('says when the first answers arrive while no prompt has one, so an empty table is not read as a failure', async () => {
    server.use(
      http.get(mswPath(`${P}/ai/prompts-summary`), () =>
        HttpResponse.json({
          data: {
            window: { from: '2026-10-16', to: '2026-11-12', timezone: 'Europe/Berlin' },
            include_branded: false,
            engine_codes: ['chatgpt_web'],
            prompts: [],
            topics: [],
          },
        }),
      ),
    );
    renderOnPrompts(promptsAs('viewer'));
    expect(
      await screen.findByText(
        'No data yet. Each prompt is asked twice a week, on Monday and Thursday, and its first answers arrive after the next run.',
      ),
    ).toBeInTheDocument();
  });

  it('offers a retry when the prompts do not load', async () => {
    server.use(http.get(mswPath(`${P}/prompts`), () => HttpResponse.json({ code: 'boom' }, { status: 500 })));
    renderOnPrompts(promptsAs('viewer'), { searchParams: '?tab=prompts' });
    expect(await screen.findByText('The prompts could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says so to a member who cannot read the data', async () => {
    renderOnPrompts(promptsAs('billing'));
    expect(
      await screen.findByRole('heading', { name: 'You cannot see the prompts of this project' }),
    ).toBeInTheDocument();
  });

  it('gives an editor Add prompts, which opens the dialog', async () => {
    const { user } = renderOnPrompts(promptsAs('editor'), { searchParams: '?tab=prompts' });
    await grid();
    await user.click(await screen.findByRole('button', { name: 'Add prompts' }));
    expect(await screen.findByRole('dialog', { name: 'Add prompts' })).toBeInTheDocument();
  });

  it('gives an editor Add prompts in the empty state of a project without a prompt', async () => {
    server.use(
      http.get(mswPath(`${P}/prompts`), () =>
        HttpResponse.json({ data: [], page: { has_more: false, next_cursor: null } }),
      ),
    );
    const { user } = renderOnPrompts(promptsAs('editor'));
    expect(await screen.findByRole('heading', { name: 'No prompts yet' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add prompts' }));
    expect(await screen.findByRole('dialog', { name: 'Add prompts' })).toBeInTheDocument();
  });

  it('does not offer Add prompts to a viewer', async () => {
    renderOnPrompts(promptsAs('viewer'), { searchParams: '?tab=prompts' });
    await grid();
    expect(screen.queryByRole('button', { name: 'Add prompts' })).toBeNull();
  });
});

const NO_ANSWERS_TEXT =
  'No data yet. Each prompt is asked twice a week, on Monday and Thursday, and its first answers arrive after the next run.';
const NO_MATCH_TITLE = 'No prompts match';
const NO_PROMPTS_TITLE = 'No prompts yet';
const SUMMARY_PATH = mswPath(`${P}/ai/prompts-summary`);
const LIST_PATH = mswPath(`${P}/prompts`);
const ENGINES_PATH = mswPath(`${P}/engines`);
const TOPICS_STALE = 'The topic counts could not be refreshed. The last counts loaded are shown.';
const W = '/api/v1/workspaces/{workspace_id}';
const VOCABULARIES_PATH = mswPath(`${W}/vocabularies`);
const TERMS_PATH = mswPath(`${W}/vocabularies/{vocabulary_id}/terms`);
const treeNode = (term_id: string, name: string, parent_id: string | null, children: TermNode[]): TermNode =>
  ({ term_id, name, parent_id, children }) as TermNode;
/** One topic vocabulary with this tree, in place of the fixture's. */
const serveVocabulary = (nodes: TermNode[]): void =>
  server.use(
    http.get(VOCABULARIES_PATH, () =>
      HttpResponse.json({
        data: [
          {
            vocabulary_id: idOf(4, 1),
            kind: 'topic',
            name: 'Topics',
            is_hierarchical: true,
            is_single_valued: false,
            project_id: null,
            term_count: nodes.length,
          },
        ],
        page: { has_more: false, next_cursor: null },
      }),
    ),
    http.get(TERMS_PATH, () => HttpResponse.json({ data: nodes })),
  );
const EMPTY_SUMMARY = {
  data: {
    window: { from: '2026-10-16', to: '2026-11-12', timezone: 'Europe/Berlin' },
    include_branded: false,
    engine_codes: ['chatgpt_web'],
    prompts: [],
    topics: [],
  },
};

const idOf = (kind: number, index: number): string =>
  `${String(kind).repeat(8)}-0000-4000-8000-${String(index).padStart(12, '0')}`;
const promptOf = (index: number, branded = false): Prompt => ({
  prompt_id: idOf(1, index),
  country_iso: 'DE',
  created_at: NOW.toISOString(),
  created_by: null,
  creation_method: 'human',
  current_version: {
    change_kind: 'initial',
    created_at: NOW.toISOString(),
    prompt_version_id: idOf(2, index),
    text: `Question number ${String(index)}?`,
    text_hash: 'a'.repeat(64),
    version_no: 1,
  },
  funnel_stage: 'unknown',
  importance: 3,
  intent: 'unknown',
  is_active: true,
  is_branded: branded,
  language_code: 'en',
  prompt_type: 'question',
  source: 'manual',
  terms: [],
  updated_at: NOW.toISOString(),
});
const pageOf = (data: Prompt[], next: string | null): { data: Prompt[]; page: object } => ({
  data,
  page: { has_more: next !== null, next_cursor: next },
});

/** A promise a test settles itself, to hold an answer back. */
function gate(): { opened: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60));

const withTopBar = (ui: ReactElement): ReactElement => (
  <TopBarSlotProvider>
    <TopBarSlotTarget />
    {ui}
  </TopBarSlotProvider>
);

describe('Topics & Prompts: what the list and the counts do while they load or fail', () => {
  it('leaves a branded prompt out of the table', async () => {
    renderOnPrompts(promptsAs('viewer'));
    const table = await grid();
    await within(table).findByText('Which SEO agency is best for a SaaS startup in Germany?');
    expect(within(table).queryByText('Is Fynix a good SEO agency for software companies?')).toBeNull();
  });

  it('says the counts did not load, keeps the list, and reads them again on Try again', async () => {
    let calls = 0;
    server.use(
      http.get(SUMMARY_PATH, () => {
        calls += 1;
        return calls === 1 ? HttpResponse.json({ code: 'boom' }, { status: 500 }) : HttpResponse.json(EMPTY_SUMMARY);
      }),
    );
    const { user } = renderOnPrompts(promptsAs('viewer'));
    expect(
      await screen.findByText('The answer counts could not be loaded. The prompts are listed without them.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(NO_ANSWERS_TEXT)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(NO_ANSWERS_TEXT)).toBeInTheDocument();
    expect(
      screen.queryByText('The answer counts could not be loaded. The prompts are listed without them.'),
    ).toBeNull();
  });

  it('offers a retry when the engines do not load', async () => {
    server.use(http.get(ENGINES_PATH, () => HttpResponse.json({ code: 'boom' }, { status: 500 })));
    renderOnPrompts(promptsAs('viewer'));
    expect(await screen.findByText('The engines of this project could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('keeps the page when a later read of the engines fails', async () => {
    const { queryClient } = renderOnPrompts(promptsAs('viewer'));
    await grid();
    server.use(http.get(ENGINES_PATH, () => HttpResponse.json({ code: 'boom' }, { status: 500 })));
    await queryClient.refetchQueries({
      queryKey: enginesKey({ workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynixProject.id }),
    });
    expect(screen.queryByText('The engines of this project could not be loaded.')).toBeNull();
    expect(await grid()).toBeInTheDocument();
  });

  it('says no prompt matches a search that finds none', async () => {
    renderOnPrompts(promptsAs('viewer'), { searchParams: '?q=zzzznothing' });
    expect(await screen.findByRole('heading', { name: NO_MATCH_TITLE })).toBeInTheDocument();
  });

  it('says there are no prompts yet when every prompt of the project is branded', async () => {
    server.use(
      http.get(LIST_PATH, () => HttpResponse.json(pageOf([promptOf(1, true), promptOf(2, true)], null))),
      http.get(SUMMARY_PATH, () => HttpResponse.json(EMPTY_SUMMARY)),
    );
    renderOnPrompts(promptsAs('editor'));
    expect(await screen.findByRole('heading', { name: NO_PROMPTS_TITLE })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: NO_MATCH_TITLE })).toBeNull();
    expect(screen.queryByText(NO_ANSWERS_TEXT)).toBeNull();
  });

  it('asks the summary for the window in the address', async () => {
    const asked: URL[] = [];
    server.use(
      http.get(SUMMARY_PATH, ({ request }) => {
        asked.push(new URL(request.url));
        return HttpResponse.json(EMPTY_SUMMARY);
      }),
    );
    renderOnPrompts(promptsAs('viewer'), { searchParams: '?window=7' });
    expect(await screen.findByText('Answers from Nov 6 to Nov 12, 2026')).toBeInTheDocument();
    await grid();
    expect(asked.map((url) => [url.searchParams.get('from'), url.searchParams.get('to')])).toContainEqual([
      '2026-11-06',
      '2026-11-12',
    ]);
  });

  it('keeps the table on screen while a new window is read', async () => {
    const second = gate();
    let calls = 0;
    server.use(
      http.get(SUMMARY_PATH, async () => {
        calls += 1;
        if (calls > 1) await second.opened;
        return HttpResponse.json(EMPTY_SUMMARY);
      }),
    );
    const { user } = renderOnPrompts(withTopBar(promptsAs('viewer')));
    const table = await grid();
    await within(table).findByText('Which SEO agency is best for a SaaS startup in Germany?');
    await user.click(await screen.findByRole('combobox', { name: 'Window' }));
    await user.click(await screen.findByRole('option', { name: 'Last 7 days' }));
    expect(await screen.findByText('Answers from Nov 6 to Nov 12, 2026')).toBeInTheDocument();
    await settle();
    expect(calls).toBe(2);
    expect(
      within(await grid()).getByText('Which SEO agency is best for a SaaS startup in Germany?'),
    ).toBeInTheDocument();
    second.open();
  });

  it('does not say there are no prompts, nor offer Add prompts, before the engines have answered', async () => {
    const engines = gate();
    server.use(
      http.get(ENGINES_PATH, async () => {
        await engines.opened;
        return HttpResponse.json({ code: 'boom' }, { status: 500 });
      }),
      http.get(LIST_PATH, () => HttpResponse.json(pageOf([], null))),
    );
    renderOnPrompts(promptsAs('editor'));
    await settle();
    expect(screen.queryByRole('heading', { name: NO_PROMPTS_TITLE })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add prompts' })).toBeNull();
    engines.open();
  });

  it('does not offer Add prompts over a list before the engines have answered', async () => {
    const engines = gate();
    server.use(
      http.get(ENGINES_PATH, async () => {
        await engines.opened;
        return HttpResponse.json({ data: [] });
      }),
    );
    renderOnPrompts(promptsAs('editor'));
    await settle();
    expect(screen.queryByRole('button', { name: 'Add prompts' })).toBeNull();
    engines.open();
  });

  it('reads every page of a long list', async () => {
    const cursors: (string | null)[] = [];
    server.use(
      http.get(LIST_PATH, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        cursors.push(cursor);
        return HttpResponse.json(
          cursor === null
            ? pageOf([promptOf(1), promptOf(2), promptOf(3)], 'page-2')
            : pageOf([promptOf(4), promptOf(5)], null),
        );
      }),
    );
    renderOnPrompts(promptsAs('viewer'));
    const table = await grid();
    expect(await within(table).findByText('Question number 5?')).toBeInTheDocument();
    expect(within(table).getByText('Question number 1?')).toBeInTheDocument();
    expect(cursors).toEqual([null, 'page-2']);
  });

  it('says the list may be incomplete when a later page fails, and reads it again on Try again', async () => {
    let failing = true;
    server.use(
      http.get(LIST_PATH, ({ request }) => {
        if (new URL(request.url).searchParams.get('cursor') === null) {
          return HttpResponse.json(pageOf([promptOf(1), promptOf(2)], 'page-2'));
        }
        return failing
          ? HttpResponse.json({ code: 'boom' }, { status: 500 })
          : HttpResponse.json(pageOf([promptOf(3)], null));
      }),
    );
    const { user } = renderOnPrompts(promptsAs('viewer'));
    expect(
      await screen.findByText('Some prompts could not be loaded, so the list may be incomplete.'),
    ).toBeInTheDocument();
    expect(within(await grid()).getByText('Question number 1?')).toBeInTheDocument();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await within(await grid()).findByText('Question number 3?')).toBeInTheDocument();
    expect(screen.queryByText('Some prompts could not be loaded, so the list may be incomplete.')).toBeNull();
  });
});

const BRANDED_TEXT = 'Is Fynix a good SEO agency for software companies?';
const FIRST_TEXT = 'Which SEO agency is best for a SaaS startup in Germany?';

describe('Topics & Prompts: Mentioned and Cited per engine, filters and sort', () => {
  it('shows Mentioned and Cited per enabled engine as counts of valid answers, and only for enabled engines', async () => {
    renderOnPrompts(promptsAs('viewer'), { searchParams: '?tab=prompts' });
    const table = await grid();
    expect(await within(table).findByRole('columnheader', { name: /^ChatGPT mentioned/ })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /^ChatGPT cited/ })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /^Gemini mentioned/ })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /^Gemini cited/ })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: /^Google AI Mode/ })).toBeNull();
    // Eight runs in the 28 days (Monday and Thursday, 16 October to 12 November); an answer that failed, was
    // refused or was empty leaves the denominator, so a count reads "n of 5" to "n of 8"
    const counts = (await within(table).findAllByText(/^\d of \d+$/)).map((node) => node.textContent ?? '');
    expect(counts.length).toBeGreaterThan(20);
    const parts = counts.map((text) => text.split(' of ').map(Number));
    expect(Math.max(...parts.map(([, valid]) => valid ?? 0))).toBe(8);
    expect(parts.every(([hits, valid]) => hits !== undefined && valid !== undefined && hits <= valid)).toBe(true);
    expect(parts.every(([, valid]) => (valid ?? 0) >= 5)).toBe(true);
    // The mock's answers are made from the prompt, the engine and the day, so these are the same every run
    const rowOf = (text: string): (string | null)[] =>
      within(within(table).getByText(text).closest('[role="row"]') as HTMLElement)
        .getAllByRole('gridcell')
        .map((cell) => cell.textContent);
    expect(rowOf(FIRST_TEXT)).toEqual(['SEO', 'Germany', '3 of 6', '4 of 6', '6 of 8', '0 of 8']);
    expect(rowOf('How do I run a technical SEO audit on a large site?')).toEqual([
      'Technical SEO',
      'Germany',
      '5 of 6',
      '0 of 6',
      '6 of 8',
      '4 of 8',
    ]);
  });

  it('leaves branded prompts out until the Branded filter includes them, and asks the summary the same', async () => {
    const asked: string[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/ai/prompts-summary')) asked.push(url.searchParams.get('include_branded') ?? '');
    });
    const first = renderOnPrompts(promptsAs('viewer'), { searchParams: '?tab=prompts' });
    await within(await grid()).findByText(FIRST_TEXT);
    expect(within(await grid()).queryByText(BRANDED_TEXT)).toBeNull();
    first.unmount();
    renderOnPrompts(promptsAs('viewer'), { searchParams: '?tab=prompts&branded=include' });
    const table = await grid();
    expect(await within(table).findByText(BRANDED_TEXT)).toBeInTheDocument();
    expect(within(table).getByText('Branded')).toBeInTheDocument();
    expect(asked).toContain('false');
    expect(asked).toContain('true');
    server.events.removeAllListeners();
  });

  it('filters by topic and country from the URL, and sorts by an engine column', async () => {
    const { user } = renderOnPrompts(promptsAs('viewer'), {
      searchParams: `?tab=prompts&topic=${encodeURIComponent(MOCK_TERM_IDS.technicalSeo)}&country=DE`,
    });
    const table = await grid();
    expect(await within(table).findByText('How do I run a technical SEO audit on a large site?')).toBeInTheDocument();
    expect(within(table).queryByText('Which tools track local rankings by city?')).toBeNull();
    expect(within(table).queryByText(FIRST_TEXT)).toBeNull();
    await user.click(within(table).getByRole('button', { name: 'ChatGPT mentioned' }));
    // A rate sorts high to low on the first click
    expect(within(table).getByRole('columnheader', { name: /^ChatGPT mentioned/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('matches a topic as the summary does: the prompts of the term and of every term below it', async () => {
    renderOnPrompts(promptsAs('viewer'), { searchParams: `?topic=${MOCK_TERM_IDS.seo}` });
    const table = await grid();
    // Technical SEO and Local SEO are below SEO
    expect(await within(table).findByText('How do I run a technical SEO audit on a large site?')).toBeInTheDocument();
    expect(within(table).getByText('Which tools track local rankings by city?')).toBeInTheDocument();
    expect(within(table).getByText(FIRST_TEXT)).toBeInTheDocument();
    expect(within(table).queryByText('How often should a company blog publish new posts?')).toBeNull();
    expect(within(table).queryByText('What is the best way to manage paid search on a small budget?')).toBeNull();
  });

  it('matches any of several topics', async () => {
    renderOnPrompts(promptsAs('viewer'), {
      searchParams: `?topic=${MOCK_TERM_IDS.localSeo},${MOCK_TERM_IDS.paidSearch}`,
    });
    const table = await grid();
    expect(await within(table).findByText('Which tools track local rankings by city?')).toBeInTheDocument();
    expect(
      within(table).getByText('What is the best way to manage paid search on a small budget?'),
    ).toBeInTheDocument();
    expect(within(table).queryByText('How do I run a technical SEO audit on a large site?')).toBeNull();
    expect(within(table).queryByText(FIRST_TEXT)).toBeNull();
  });

  describe('with a topic tree the test sets', () => {
    const ids = { seo: idOf(3, 1), technical: idOf(3, 2), paid: idOf(3, 3), toolsA: idOf(3, 4), toolsB: idOf(3, 5) };
    const termOf = (term_id: string, name: string, path: string): Prompt['terms'][number] => ({
      term_id,
      name,
      path,
      vocabulary_kind: 'topic',
    });
    const withTerms = (index: number, ...terms: Prompt['terms']): Prompt => ({ ...promptOf(index), terms });
    const serveList = (prompts: Prompt[], summary: object = EMPTY_SUMMARY): void =>
      server.use(
        http.get(LIST_PATH, () => HttpResponse.json(pageOf(prompts, null))),
        http.get(SUMMARY_PATH, () => HttpResponse.json(summary)),
      );

    it('finds a prompt given a term below the chosen one, by the tree, and not one whose name only starts alike', async () => {
      serveVocabulary([
        treeNode(ids.seo, 'SEO', null, [treeNode(ids.technical, 'Technical SEO', ids.seo, [])]),
        treeNode(ids.paid, 'SEO tools', null, []),
        treeNode(ids.toolsA, 'Paid search', null, []),
      ]);
      serveList([
        withTerms(1, termOf(ids.seo, 'SEO', 'seo')),
        withTerms(2, termOf(ids.technical, 'Technical SEO', 'seo/technical-seo')),
        withTerms(3, termOf(ids.paid, 'SEO tools', 'seo-tools')),
        withTerms(4, termOf(ids.toolsA, 'Paid search', 'paid-search')),
      ]);
      renderOnPrompts(promptsAs('viewer'), { searchParams: `?topic=${ids.seo}` });
      const table = await grid();
      expect(await within(table).findByText('Question number 1?')).toBeInTheDocument();
      expect(within(table).getByText('Question number 2?')).toBeInTheDocument();
      expect(within(table).queryByText('Question number 3?')).toBeNull();
      expect(within(table).queryByText('Question number 4?')).toBeNull();
    });

    it('names two topics that share a name by their paths, and others by name alone', async () => {
      serveList([
        withTerms(1, termOf(ids.toolsA, 'Tools', 'a/tools')),
        withTerms(2, termOf(ids.toolsB, 'Tools', 'b/tools')),
        withTerms(3, termOf(ids.paid, 'Paid search', 'paid-search')),
      ]);
      const { user } = renderOnPrompts(promptsAs('viewer'), { searchParams: `?topic=${ids.toolsA}` });
      await grid();
      await user.click(await screen.findByRole('button', { name: 'Topic: Tools (a/tools). Edit filter' }));
      expect(await screen.findByRole('checkbox', { name: 'Tools (a/tools)' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Tools (b/tools)' })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Paid search' })).toBeInTheDocument();
    });

    it('keeps a topic from the link while a later page of the list is on its way, and filters once it is in', async () => {
      const second = gate();
      const writes: string[] = [];
      server.use(
        http.get(LIST_PATH, async ({ request }) => {
          if (new URL(request.url).searchParams.get('cursor') === null) {
            return HttpResponse.json(pageOf([promptOf(1)], 'page-2'));
          }
          await second.opened;
          return HttpResponse.json(pageOf([withTerms(2, termOf(ids.seo, 'SEO', 'seo'))], null));
        }),
        http.get(SUMMARY_PATH, () => HttpResponse.json(EMPTY_SUMMARY)),
      );
      renderOnPrompts(promptsAs('viewer'), {
        searchParams: `?topic=${ids.seo}`,
        onUrlUpdate: ({ queryString }) => writes.push(queryString),
      });
      await settle();
      // Page 1 has no such topic: the link is not judged yet, and nothing says there is no match
      expect(screen.queryByText('A filter from the link was left out')).toBeNull();
      expect(screen.queryByRole('heading', { name: NO_MATCH_TITLE })).toBeNull();
      expect(writes).toEqual([]);
      second.open();
      const table = await grid();
      expect(await within(table).findByText('Question number 2?')).toBeInTheDocument();
      expect(within(table).queryByText('Question number 1?')).toBeNull();
      expect(screen.queryByText('A filter from the link was left out')).toBeNull();
      expect(writes).toEqual([]);
    });

    it('shows what is filtered on in the empty state, and passes the accessibility checks there', async () => {
      serveList([
        withTerms(1, termOf(ids.seo, 'SEO', 'seo')),
        { ...withTerms(2, termOf(ids.paid, 'Paid search', 'paid-search')), country_iso: 'AT' },
      ]);
      const { container } = renderOnPrompts(promptsAs('viewer'), {
        searchParams: `?topic=${ids.seo}&country=AT`,
      });
      const heading = await screen.findByRole('heading', { name: NO_MATCH_TITLE });
      const empty = heading.parentElement as HTMLElement;
      expect(within(empty).getByText('Topic: SEO')).toBeInTheDocument();
      // The fixture's country list has no Austria: the code stands for it
      expect(within(empty).getByText('Country: AT')).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it('tells which filters of a link were left out when the project has nothing for them', async () => {
    const writes: string[] = [];
    renderOnPrompts(promptsAs('viewer'), {
      searchParams: `?topic=${idOf(3, 9)}&country=ZZ&branded=nope`,
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    // The Branded filter's one option is known at once; the countries are judged when the list is in and the
    // topics when the vocabularies are read too, so each is told when it is judged (a toast gives way to the next)
    expect(await screen.findByText(/^Branded prompts:/)).toBeInTheDocument();
    await vi.waitFor(() => expect(writes.at(-1)).toBe('?tab=prompts'));
    expect(writes.join(' ')).toMatch(/topic=/);
    const table = await grid();
    expect(await within(table).findByText(FIRST_TEXT)).toBeInTheDocument();
    expect(within(table).queryByText(BRANDED_TEXT)).toBeNull();
  });

  it('keeps an Engine filter of a link while the engines fail to load, and applies it when they do', async () => {
    let failing = true;
    const writes: string[] = [];
    // Answering nothing passes the request on to the mock
    server.use(
      http.get(ENGINES_PATH, () => (failing ? HttpResponse.json({ code: 'boom' }, { status: 500 }) : undefined)),
    );
    const { user } = renderOnPrompts(promptsAs('viewer'), {
      searchParams: '?engine=gemini_web',
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    expect(await screen.findByText('The engines of this project could not be loaded.')).toBeInTheDocument();
    await settle();
    expect(writes).toEqual([]);
    expect(screen.queryByText('A filter from the link was left out')).toBeNull();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const table = await grid();
    expect(await within(table).findByRole('columnheader', { name: /^Gemini mentioned/ })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: /^ChatGPT mentioned/ })).toBeNull();
    expect(writes).toEqual([]);
    expect(screen.queryByText('A filter from the link was left out')).toBeNull();
  });

  it('says there are no prompts yet, not that none match, when only the Engine or Branded filter is set', async () => {
    server.use(
      http.get(LIST_PATH, () => HttpResponse.json(pageOf([promptOf(1, true), promptOf(2, true)], null))),
      http.get(SUMMARY_PATH, () => HttpResponse.json(EMPTY_SUMMARY)),
    );
    const first = renderOnPrompts(promptsAs('editor'), { searchParams: '?engine=gemini_web' });
    expect(await screen.findByRole('heading', { name: NO_PROMPTS_TITLE })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: NO_MATCH_TITLE })).toBeNull();
    first.unmount();
    server.use(http.get(LIST_PATH, () => HttpResponse.json(pageOf([], null))));
    renderOnPrompts(promptsAs('editor'), { searchParams: '?branded=include' });
    expect(await screen.findByRole('heading', { name: NO_PROMPTS_TITLE })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: NO_MATCH_TITLE })).toBeNull();
  });

  it('shows only the engines the Engine filter names', async () => {
    renderOnPrompts(promptsAs('viewer'), { searchParams: '?tab=prompts&engine=gemini_web' });
    const table = await grid();
    expect(await within(table).findByRole('columnheader', { name: /^Gemini mentioned/ })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: /^ChatGPT mentioned/ })).toBeNull();
  });

  it('says no prompt matches the filters together, and Clear filters brings the list back', async () => {
    const termOf = (name: string, termId: string): Prompt['terms'][number] => ({
      name,
      path: name,
      term_id: termId,
      vocabulary_kind: 'topic',
    });
    const german = { ...promptOf(1), terms: [termOf('Pricing', idOf(3, 1))] };
    const austrian = { ...promptOf(2), country_iso: 'AT', terms: [termOf('Tools', idOf(3, 2))] };
    server.use(
      http.get(LIST_PATH, () => HttpResponse.json(pageOf([german, austrian], null))),
      http.get(SUMMARY_PATH, () => HttpResponse.json(EMPTY_SUMMARY)),
    );
    const { user } = renderOnPrompts(promptsAs('viewer'), {
      searchParams: `?topic=${idOf(3, 1)}&country=AT`,
    });
    expect(await screen.findByRole('heading', { name: NO_MATCH_TITLE })).toBeInTheDocument();
    // The filter bar has the same button, above the empty state's
    const clears = screen.getAllByRole('button', { name: 'Clear filters' });
    expect(clears).toHaveLength(2);
    await user.click(clears[1] as HTMLElement);
    const table = await grid();
    expect(await within(table).findByText('Question number 1?')).toBeInTheDocument();
    expect(within(table).getByText('Question number 2?')).toBeInTheDocument();
  });

  it('tells a person a filter from the link was left out when this project has nothing for it', async () => {
    renderOnPrompts(promptsAs('viewer'), { searchParams: '?engine=google_ai_mode' });
    expect(await screen.findByText('A filter from the link was left out')).toBeInTheDocument();
    expect(await within(await grid()).findByRole('columnheader', { name: /^ChatGPT mentioned/ })).toBeInTheDocument();
  });

  describe('with counts the test sets', () => {
    const ENGINES = ['chatgpt_web', 'gemini_web'] as const;
    const counted = (valid: number, mentioned: number, observations = valid): Counts => ({
      ...NO_COUNTS,
      n_valid: valid,
      n_observations: observations,
      mentioned,
    });
    /**
     * Prompt 1 ChatGPT 1 of 4, prompt 2 2 of 4, prompt 3 1 of 10, prompt 4 no answer, prompt 5 two answers, none
     * valid, prompt 6 2 of 5 valid of 7 answers.
     */
    const CHATGPT: readonly Counts[] = [
      counted(4, 1),
      counted(4, 2),
      counted(10, 1),
      NO_COUNTS,
      counted(0, 0, 2),
      counted(5, 2, 7),
    ];
    /** The summary of these counts, for the prompts numbered from 1 and the ones in `skip` left without a row. */
    const summaryOf = (counts: readonly Counts[], skip: readonly number[] = []): object => ({
      data: {
        ...EMPTY_SUMMARY.data,
        engine_codes: [...ENGINES],
        prompts: counts.flatMap((one, index) =>
          skip.includes(index + 1)
            ? []
            : [
                {
                  prompt_id: idOf(1, index + 1),
                  text: `Question number ${String(index + 1)}?`,
                  is_branded: false,
                  topic_term_ids: [],
                  engines: [promptCells('chatgpt_web', one), promptCells('gemini_web', NO_COUNTS)],
                },
              ],
        ),
      },
    });
    const serve = (counts: readonly Counts[] = CHATGPT, summary: object = summaryOf(counts)): void =>
      server.use(
        http.get(LIST_PATH, () =>
          HttpResponse.json(
            pageOf(
              counts.map((_, index) => promptOf(index + 1)),
              null,
            ),
          ),
        ),
        http.get(SUMMARY_PATH, () => HttpResponse.json(summary)),
      );
    /** The cell with this text, in the row of this prompt. */
    const cellOf = (table: HTMLElement, question: number, text: string): HTMLElement => {
      const row = within(table)
        .getByText(`Question number ${String(question)}?`)
        .closest('[role="row"]');
      return within(row as HTMLElement)
        .getAllByText(text)[0]
        ?.closest('[role="gridcell"]') as HTMLElement;
    };
    const order = async (): Promise<string[]> => {
      const table = await grid();
      await within(table).findByText('Question number 1?');
      return within(table)
        .getAllByText(/^Question number \d\?$/)
        .map((node) => node.textContent ?? '');
    };

    it('reads a rate by its value, not its text, with no answers last either way', async () => {
      serve();
      const up = renderOnPrompts(promptsAs('viewer'), { searchParams: '?sort=chatgpt_web_mentioned' });
      expect(await order()).toEqual([
        'Question number 3?',
        'Question number 1?',
        'Question number 6?',
        'Question number 2?',
        'Question number 4?',
        'Question number 5?',
      ]);
      up.unmount();
      renderOnPrompts(promptsAs('viewer'), { searchParams: '?sort=-chatgpt_web_mentioned' });
      expect(await order()).toEqual([
        'Question number 2?',
        'Question number 6?',
        'Question number 1?',
        'Question number 3?',
        'Question number 4?',
        'Question number 5?',
      ]);
    });

    it('sorts rates a text order would get wrong: 5, 10, 25, 50 and 100 percent', async () => {
      // 1 of 20, 1 of 10, 1 of 4, 1 of 2, 3 of 3
      serve([counted(20, 1), counted(10, 1), counted(4, 1), counted(2, 1), counted(3, 3)]);
      const up = renderOnPrompts(promptsAs('viewer'), { searchParams: '?sort=chatgpt_web_mentioned' });
      expect(await order()).toEqual([1, 2, 3, 4, 5].map((n) => `Question number ${String(n)}?`));
      up.unmount();
      renderOnPrompts(promptsAs('viewer'), { searchParams: '?sort=-chatgpt_web_mentioned' });
      expect(await order()).toEqual([5, 4, 3, 2, 1].map((n) => `Question number ${String(n)}?`));
    });

    it('keeps a sort on a hidden engine in the link: the default sort applies, and the sort returns with the engine', async () => {
      serve();
      const writes: string[] = [];
      const { user } = renderOnPrompts(promptsAs('viewer'), {
        searchParams: '?sort=-chatgpt_web_mentioned&engine=gemini_web',
        onUrlUpdate: ({ queryString }) => writes.push(queryString),
      });
      const table = await grid();
      await within(table).findByText('Question number 1?');
      expect(within(table).queryByRole('columnheader', { name: /^ChatGPT mentioned/ })).toBeNull();
      expect(within(table).getByRole('columnheader', { name: /^Prompt/ })).toHaveAttribute('aria-sort', 'ascending');
      expect(writes).toEqual([]);
      await user.click(screen.getByRole('button', { name: 'Clear filters' }));
      expect(await within(table).findByRole('columnheader', { name: /^ChatGPT mentioned/ })).toHaveAttribute(
        'aria-sort',
        'descending',
      );
      expect(writes.at(-1)).toContain('sort=-chatgpt_web_mentioned');
    });

    it('shows the count, and says why a cell has none: no answer, or none valid', async () => {
      serve();
      renderOnPrompts(promptsAs('viewer'));
      const table = await grid();
      expect(await within(table).findByText('1 of 4')).toBeInTheDocument();
      expect(within(table).getByText('2 of 4')).toBeInTheDocument();
      expect(within(table).getByText('1 of 10')).toBeInTheDocument();
      expect(within(table).queryByText(/^0 of 0$/)).toBeNull();
      // Prompt 4 has no answer on ChatGPT, nor have any on Gemini; prompt 5's two answers are all invalid
      expect(cellOf(table, 4, 'No answers')).toHaveAccessibleDescription(
        'No answer in this window yet. Each prompt is asked twice a week.',
      );
      expect(cellOf(table, 5, 'n/a')).toHaveAccessibleDescription('2 answers in this window, none of them valid');
    });

    it('says how many of the answers were valid when some were not, and nothing when all were', async () => {
      serve();
      renderOnPrompts(promptsAs('viewer'));
      const table = await grid();
      await within(table).findByText('2 of 5');
      expect(cellOf(table, 6, '2 of 5')).toHaveAccessibleDescription('5 valid of 7 answers');
      expect(cellOf(table, 1, '1 of 4')).not.toHaveAccessibleDescription();
    });

    it('says the counts are not loaded when they failed, and no answers when the counts have no row for a prompt', async () => {
      serve();
      server.use(http.get(SUMMARY_PATH, () => HttpResponse.json({ code: 'boom' }, { status: 500 })));
      const failed = renderOnPrompts(promptsAs('viewer'));
      const table = await grid();
      await within(table).findAllByText('n/a');
      expect(cellOf(table, 1, 'n/a')).toHaveAccessibleDescription('The counts are not loaded yet.');
      expect(within(table).queryByText('No answers')).toBeNull();
      failed.unmount();
      // The counts of another time have no row for prompt 2: it has no answers, which is a fact
      serve(CHATGPT, summaryOf(CHATGPT, [2]));
      renderOnPrompts(promptsAs('viewer'));
      const loaded = await grid();
      await within(loaded).findByText('1 of 4');
      expect(cellOf(loaded, 2, 'No answers')).toHaveAccessibleDescription(
        'No answer in this window yet. Each prompt is asked twice a week.',
      );
    });
  });
});

describe('Topics & Prompts: the Topics tab', () => {
  const treegrid = (): Promise<HTMLElement> => screen.findByRole('treegrid', { name: 'Topics' });
  /** The topic and prompt names in the tree, in order. */
  const names = async (): Promise<string[]> =>
    (await within(await treegrid()).findAllByRole('rowheader')).map((cell) => cell.textContent ?? '');
  const rowOf = (tree: HTMLElement, name: string): HTMLElement =>
    within(tree).getByText(name).closest('[role="row"]') as HTMLElement;

  it('opens on Topics: one row per topic, the largest first, each counting the prompts of the topics below it', async () => {
    const { container, user } = renderWithProviders(promptsAs('viewer'));
    const tree = await treegrid();
    // SEO holds its own 5 prompts and the 4 of Technical SEO and 3 of Local SEO; the branded one is out
    expect(await names()).toEqual([
      'SEO',
      'Content Marketing',
      'Technical SEO',
      'Blog Strategy',
      'Local SEO',
      // Topics of one size stay in the API's order, which puts the prompts without a topic last
      'Paid Search',
      'No topic',
    ]);
    expect(within(tree).getByRole('columnheader', { name: /^ChatGPT mentioned/ })).toBeInTheDocument();
    expect(within(tree).getByRole('button', { name: 'Expand SEO, 12 prompts' })).toBeInTheDocument();
    expect(within(tree).getByRole('button', { name: 'Expand Content Marketing, 7 prompts' })).toBeInTheDocument();
    expect(within(tree).getByRole('button', { name: 'Expand Local SEO, 3 prompts' })).toBeInTheDocument();
    // A topic opens in place and lists its prompts, those of the topics below it among them
    await user.click(within(tree).getByRole('button', { name: 'Expand SEO, 12 prompts' }));
    expect(
      await within(tree).findByText('Which SEO agency is best for a SaaS startup in Germany?'),
    ).toBeInTheDocument();
    expect(within(tree).getByText('How do I run a technical SEO audit on a large site?')).toBeInTheDocument();
    expect(within(tree).getByText('Which tools track local rankings by city?')).toBeInTheDocument();
    expect(within(tree).queryByText('Is Fynix a good SEO agency for software companies?')).toBeNull();
    expect(within(tree).queryByText('How do I plan a content calendar for a year?')).toBeNull();
    expect(within(tree).getByRole('button', { name: 'Collapse SEO, 12 prompts' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('opens and closes a topic from the keyboard and keeps the focus on its button', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'));
    const tree = await treegrid();
    const open = await within(tree).findByRole('button', { name: 'Expand Paid Search, 2 prompts' });
    open.focus();
    await user.keyboard('{Enter}');
    const close = await within(tree).findByRole('button', { name: 'Collapse Paid Search, 2 prompts' });
    expect(close).toHaveFocus();
    expect(rowOf(tree, 'Paid Search')).toHaveAttribute('aria-expanded', 'true');
    expect(within(tree).getByText('What is the best way to manage paid search on a small budget?')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(await within(tree).findByRole('button', { name: 'Expand Paid Search, 2 prompts' })).toHaveFocus();
    expect(within(tree).queryByText('What is the best way to manage paid search on a small budget?')).toBeNull();
  });

  it('lists the branded prompts under their topic once the Branded filter includes them', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'), { searchParams: '?branded=include' });
    const tree = await treegrid();
    await user.click(await within(tree).findByRole('button', { name: 'Expand SEO, 13 prompts' }));
    expect(await within(tree).findByText('Is Fynix a good SEO agency for software companies?')).toBeInTheDocument();
  });

  it('keeps the chosen topic and the topics below it, as the Prompts tab does', async () => {
    renderWithProviders(promptsAs('viewer'), { searchParams: `?topic=${MOCK_TERM_IDS.seo}` });
    await vi.waitFor(async () => expect(await names()).toEqual(['SEO', 'Technical SEO', 'Local SEO']));
  });

  it('keeps only a leaf topic when that is the one chosen, and any of several', async () => {
    renderWithProviders(promptsAs('viewer'), {
      searchParams: `?topic=${MOCK_TERM_IDS.technicalSeo},${MOCK_TERM_IDS.paidSearch}`,
    });
    await vi.waitFor(async () => expect(await names()).toEqual(['Technical SEO', 'Paid Search']));
  });

  it('switches to the Prompts tab and back, keeping the filters and the window in the address', async () => {
    const writes: string[] = [];
    const { user } = renderWithProviders(promptsAs('viewer'), {
      searchParams: `?topic=${MOCK_TERM_IDS.technicalSeo}&window=7`,
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await vi.waitFor(async () => expect(await names()).toEqual(['Technical SEO']));
    await user.click(screen.getByRole('tab', { name: 'Prompts' }));
    const table = await grid();
    expect(await within(table).findByText('How do I run a technical SEO audit on a large site?')).toBeInTheDocument();
    expect(within(table).queryByText('Which tools track local rankings by city?')).toBeNull();
    const onPrompts = new URLSearchParams(writes.at(-1));
    expect(onPrompts.get('tab')).toBe('prompts');
    expect(onPrompts.get('topic')).toBe(MOCK_TERM_IDS.technicalSeo);
    expect(onPrompts.get('window')).toBe('7');
    await user.click(screen.getByRole('tab', { name: 'Topics' }));
    expect(await names()).toEqual(['Technical SEO']);
    const back = new URLSearchParams(writes.at(-1));
    expect(back.has('tab')).toBe(false);
    expect(back.get('topic')).toBe(MOCK_TERM_IDS.technicalSeo);
    expect(back.get('window')).toBe('7');
  });

  it('keeps a country chosen on the Prompts tab for when the person returns to it', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts&country=IN' });
    const table = await grid();
    await vi.waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
    await user.click(screen.getByRole('tab', { name: 'Topics' }));
    // A topic's counts are the API's, for all of its prompts: the country does not narrow the topics
    expect(await names()).toContain('Content Marketing');
    await user.click(screen.getByRole('tab', { name: 'Prompts' }));
    await vi.waitFor(async () => expect(within(await grid()).getAllByRole('row')).toHaveLength(2));
  });

  it('says no prompt matches a search that finds no topic, and no prompts yet when every prompt is branded', async () => {
    const first = renderWithProviders(promptsAs('viewer'), { searchParams: '?q=zzzznothing' });
    expect(await screen.findByRole('heading', { name: NO_MATCH_TITLE })).toBeInTheDocument();
    first.unmount();
    server.use(
      http.get(LIST_PATH, () => HttpResponse.json(pageOf([promptOf(1, true), promptOf(2, true)], null))),
      http.get(SUMMARY_PATH, () => HttpResponse.json(EMPTY_SUMMARY)),
    );
    renderWithProviders(promptsAs('editor'));
    expect(await screen.findByRole('heading', { name: NO_PROMPTS_TITLE })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: NO_MATCH_TITLE })).toBeNull();
  });

  it('finds a topic by the text of one of its prompts', async () => {
    renderWithProviders(promptsAs('viewer'), { searchParams: '?q=fintech' });
    await vi.waitFor(async () => expect(await names()).toEqual(['SEO']));
  });

  it('offers a retry when the topics do not load, while the Prompts tab still lists the prompts', async () => {
    let calls = 0;
    server.use(
      http.get(SUMMARY_PATH, () => {
        calls += 1;
        return calls === 1 ? HttpResponse.json({ code: 'boom' }, { status: 500 }) : HttpResponse.json(EMPTY_SUMMARY);
      }),
    );
    const { user } = renderWithProviders(promptsAs('viewer'));
    expect(await screen.findByText('The topics could not be loaded.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Prompts' }));
    expect(
      await within(await grid()).findByText('Which SEO agency is best for a SaaS startup in Germany?'),
    ).toBeInTheDocument();
  });

  it('keeps the topics on screen while a new window is read', async () => {
    const second = gate();
    let calls = 0;
    server.use(
      http.get(SUMMARY_PATH, async () => {
        calls += 1;
        if (calls > 1) await second.opened;
        return HttpResponse.json({
          data: {
            ...EMPTY_SUMMARY.data,
            topics: [{ term_id: null, name: null, prompt_count: 1, engines: [topicCells('chatgpt_web', [])] }],
          },
        });
      }),
    );
    const { user } = renderWithProviders(withTopBar(promptsAs('viewer')));
    await within(await treegrid()).findByText('No topic');
    await user.click(await screen.findByRole('combobox', { name: 'Window' }));
    await user.click(await screen.findByRole('option', { name: 'Last 7 days' }));
    expect(await screen.findByText('Answers from Nov 6 to Nov 12, 2026')).toBeInTheDocument();
    await settle();
    expect(calls).toBe(2);
    expect(within(await treegrid()).getByText('No topic')).toBeInTheDocument();
    second.open();
  });

  it('gives an editor Add prompts on the Topics tab too, and a viewer none', async () => {
    const editor = renderWithProviders(promptsAs('editor'));
    await names();
    expect(await screen.findByRole('button', { name: 'Add prompts' })).toBeInTheDocument();
    editor.unmount();
    renderWithProviders(promptsAs('viewer'));
    await names();
    expect(screen.queryByRole('button', { name: 'Add prompts' })).toBeNull();
  });

  it('shows only the engines the Engine filter names', async () => {
    renderWithProviders(promptsAs('viewer'), { searchParams: '?engine=gemini_web' });
    const tree = await treegrid();
    expect(await within(tree).findByRole('columnheader', { name: /^Gemini mentioned/ })).toBeInTheDocument();
    expect(within(tree).queryByRole('columnheader', { name: /^ChatGPT mentioned/ })).toBeNull();
  });

  it('says each prompt counts once in the header of a topic count, and not in the Prompts table', async () => {
    const first = renderWithProviders(promptsAs('viewer'));
    const header = await within(await treegrid()).findByRole('columnheader', { name: /^ChatGPT mentioned/ });
    expect(header).toHaveAccessibleDescription(/Each prompt counts once, whatever the number of its answers\.$/);
    first.unmount();
    renderOnPrompts(promptsAs('viewer'));
    const column = await within(await grid()).findByRole('columnheader', { name: /^ChatGPT mentioned/ });
    expect(column).not.toHaveAccessibleDescription(/Each prompt counts once/);
  });

  it('clears the filters from the empty state and brings the topics back', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'), {
      searchParams: `?topic=${MOCK_TERM_IDS.paidSearch}&q=seo`,
    });
    const heading = await screen.findByRole('heading', { name: NO_MATCH_TITLE });
    await user.click(within(heading.parentElement as HTMLElement).getByRole('button', { name: 'Clear filters' }));
    await vi.waitFor(async () => expect(await names()).toContain('Technical SEO'));
    expect(screen.queryByRole('heading', { name: NO_MATCH_TITLE })).toBeNull();
  });

  it('moves between the two tabs with the arrow keys', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'));
    await treegrid();
    screen.getByRole('tab', { name: 'Topics' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(await grid()).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Prompts' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(await treegrid()).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Topics' })).toHaveAttribute('aria-selected', 'true');
  });

  it('makes a history entry of a change of tab, so Back returns to the other one, and none of a search', async () => {
    const writes: { query: string; history: string | undefined }[] = [];
    const { user } = renderWithProviders(promptsAs('viewer'), {
      onUrlUpdate: ({ queryString, options }) => writes.push({ query: queryString, history: options.history }),
    });
    await treegrid();
    await user.click(screen.getByRole('tab', { name: 'Prompts' }));
    expect(writes.at(-1)).toEqual({ query: '?tab=prompts', history: 'push' });
    await user.type(await screen.findByRole('searchbox'), 'seo');
    expect(writes.at(-1)?.history).toBe('replace');
    await user.click(screen.getByRole('tab', { name: 'Topics' }));
    expect(writes.at(-1)).toEqual({ query: '?q=seo', history: 'push' });
  });

  it('says the topic counts could not be refreshed, keeps the last ones, and reads them again on Try again', async () => {
    let calls = 0;
    server.use(
      http.get(SUMMARY_PATH, () => {
        calls += 1;
        return calls === 2
          ? HttpResponse.json({ code: 'boom' }, { status: 500 })
          : HttpResponse.json({
              data: {
                ...EMPTY_SUMMARY.data,
                topics: [{ term_id: null, name: null, prompt_count: 1, engines: [topicCells('chatgpt_web', [])] }],
              },
            });
      }),
    );
    const { queryClient, user } = renderWithProviders(promptsAs('viewer'));
    await within(await treegrid()).findByText('No topic');
    expect(screen.queryByText(TOPICS_STALE)).toBeNull();
    await queryClient.refetchQueries({
      predicate: (query) => JSON.stringify(query.queryKey).includes('prompts-summary'),
    });
    expect(await screen.findByText(TOPICS_STALE)).toBeInTheDocument();
    expect(within(await treegrid()).getByText('No topic')).toBeInTheDocument();
    // The Prompts table says it in its own words
    expect(screen.queryByText('The topics could not be loaded.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await vi.waitFor(() => expect(screen.queryByText(TOPICS_STALE)).toBeNull());
    expect(calls).toBe(3);
  });

  describe('with a topic tree and counts the test sets', () => {
    const ids = { seo: idOf(3, 1), technical: idOf(3, 2), paid: idOf(3, 3), above: idOf(3, 9) };
    const termOf = (term_id: string, name: string, path: string): Prompt['terms'][number] => ({
      term_id,
      name,
      path,
      vocabulary_kind: 'topic',
    });
    const SEO = termOf(ids.seo, 'SEO', 'seo');
    const TECHNICAL = termOf(ids.technical, 'Technical SEO', 'seo/technical-seo');
    const PAID = termOf(ids.paid, 'Paid search', 'paid-search');
    const carrying = (index: number, ...terms: Prompt['terms']): Prompt => ({ ...promptOf(index), terms });
    const counted = (valid: number, mentioned: number, observations = valid): Counts => ({
      ...NO_COUNTS,
      n_valid: valid,
      n_observations: observations,
      mentioned,
    });
    const promptRow = (index: number, topicIds: string[], one: Counts): object => ({
      prompt_id: idOf(1, index),
      text: `Question number ${String(index)}?`,
      is_branded: false,
      topic_term_ids: topicIds,
      engines: [promptCells('chatgpt_web', one), promptCells('gemini_web', NO_COUNTS)],
    });
    const topicRow = (term_id: string, name: string, members: readonly Counts[]): object => ({
      term_id,
      name,
      prompt_count: members.length,
      engines: [topicCells('chatgpt_web', members), topicCells('gemini_web', [])],
    });
    const serve = (prompts: Prompt[], summaryPrompts: object[], topics: object[]): void =>
      server.use(
        http.get(LIST_PATH, () => HttpResponse.json(pageOf(prompts, null))),
        http.get(SUMMARY_PATH, () =>
          HttpResponse.json({
            data: {
              ...EMPTY_SUMMARY.data,
              engine_codes: ['chatgpt_web', 'gemini_web'],
              prompts: summaryPrompts,
              topics,
            },
          }),
        ),
      );
    const cellOf = (row: HTMLElement, text: string): HTMLElement =>
      within(row).getAllByText(text)[0]?.closest('[role="gridcell"]') as HTMLElement;

    it('shows a topic cell as the answers behind it, and says why it has none', async () => {
      const first = [counted(4, 1), counted(4, 2)];
      serve(
        [carrying(1, SEO), carrying(2, SEO), carrying(3, PAID), carrying(4, TECHNICAL)],
        [
          promptRow(1, [ids.seo], first[0] ?? NO_COUNTS),
          promptRow(2, [ids.seo], first[1] ?? NO_COUNTS),
          promptRow(3, [ids.paid], counted(0, 0, 2)),
          promptRow(4, [ids.technical], counted(5, 2, 7)),
        ],
        [
          topicRow(ids.seo, 'SEO', [...first, counted(5, 2, 7)]),
          topicRow(ids.paid, 'Paid search', [counted(0, 0, 2)]),
          topicRow(ids.technical, 'Technical SEO', [counted(5, 2, 7)]),
        ],
      );
      renderWithProviders(promptsAs('viewer'));
      const tree = await treegrid();
      await within(tree).findByText('Paid search');
      // Prompt weighted: the rate is the mean of the prompts' rates, but the count shown is the answers behind it
      expect(cellOf(rowOf(tree, 'SEO'), '5 of 13')).toHaveAccessibleDescription('13 valid of 15 answers');
      expect(within(rowOf(tree, 'Technical SEO')).getAllByText('2 of 5').length).toBeGreaterThan(0);
      expect(cellOf(rowOf(tree, 'Technical SEO'), '2 of 5')).toHaveAccessibleDescription('5 valid of 7 answers');
      // No valid answer is not a rate of 0, and no answer at all is said as such
      expect(cellOf(rowOf(tree, 'Paid search'), 'n/a')).toHaveAccessibleDescription(
        '2 answers in this window, none of them valid',
      );
      expect(within(rowOf(tree, 'Paid search')).queryByText(/^0 of 0$/)).toBeNull();
      expect(cellOf(rowOf(tree, 'SEO'), 'No answers')).toHaveAccessibleDescription(
        'No answer in this window yet. Each prompt is asked twice a week.',
      );
    });

    /** The topic vocabulary as the API sends it: SEO (given to no prompt) above Technical SEO, and Paid search. */
    const serveTree = (): void =>
      serveVocabulary([
        treeNode(ids.above, 'SEO', null, [treeNode(ids.technical, 'Technical SEO', ids.above, [])]),
        treeNode(ids.paid, 'Paid search', null, []),
      ]);
    const serveBoth = (): void =>
      serve(
        [carrying(1, TECHNICAL), carrying(2, TECHNICAL, PAID)],
        [promptRow(1, [ids.technical], counted(4, 1)), promptRow(2, [ids.technical, ids.paid], counted(4, 2))],
        [
          topicRow(ids.above, 'SEO', [counted(4, 1), counted(4, 2)]),
          topicRow(ids.technical, 'Technical SEO', [counted(4, 1), counted(4, 2)]),
          topicRow(ids.paid, 'Paid search', [counted(4, 2)]),
        ],
      );

    it('opens a topic that only a topic below it is given, and lists a prompt of two topics under each', async () => {
      serveBoth();
      serveTree();
      const { user } = renderWithProviders(promptsAs('viewer'));
      const tree = await treegrid();
      // No prompt is given SEO itself, but the tree tells what is below it
      const seo = await within(tree).findByRole('button', { name: 'Expand SEO, 2 prompts' });
      await user.click(seo);
      expect(await within(tree).findAllByText(/^Question number \d\?$/)).toHaveLength(2);
      await user.click(within(tree).getByRole('button', { name: 'Collapse SEO, 2 prompts' }));
      await user.click(within(tree).getByRole('button', { name: 'Expand Technical SEO, 2 prompts' }));
      await user.click(within(tree).getByRole('button', { name: 'Expand Paid search, 1 prompt' }));
      expect(await within(tree).findAllByText('Question number 2?')).toHaveLength(2);
      expect(within(tree).getAllByText('Question number 1?')).toHaveLength(1);
    });

    it('keeps a topic no prompt is given and the topics below it under a filter on it', async () => {
      serveBoth();
      serveTree();
      renderWithProviders(promptsAs('viewer'), { searchParams: `?topic=${ids.above}` });
      await vi.waitFor(async () => expect(await names()).toEqual(['SEO', 'Technical SEO']));
    });

    it('offers a topic no prompt is given in the filter, and filters the Prompts tab by it', async () => {
      serveBoth();
      serveTree();
      const writes: string[] = [];
      renderOnPrompts(promptsAs('viewer'), {
        searchParams: `?topic=${ids.above}`,
        onUrlUpdate: ({ queryString }) => writes.push(queryString),
      });
      const table = await grid();
      expect(await within(table).findByText('Question number 1?')).toBeInTheDocument();
      expect(within(table).getByText('Question number 2?')).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Topic: SEO. Edit filter' })).toBeInTheDocument();
      expect(screen.queryByText('A filter from the link was left out')).toBeNull();
      expect(writes).toEqual([]);
    });

    it('keeps a topic of the link, and matches the prompts that carry it, while the topics are not read', async () => {
      serveBoth();
      server.use(http.get(VOCABULARIES_PATH, () => HttpResponse.json({ code: 'boom' }, { status: 500 })));
      renderOnPrompts(promptsAs('viewer'), { searchParams: `?topic=${ids.paid}` });
      const table = await grid();
      expect(await within(table).findByText('Question number 2?')).toBeInTheDocument();
      expect(within(table).queryByText('Question number 1?')).toBeNull();
      expect(screen.queryByText('A filter from the link was left out')).toBeNull();
    });

    it('keeps a topic from the link while a later page of the list is on its way, and keeps its topics once it is in', async () => {
      const second = gate();
      server.use(
        http.get(LIST_PATH, async ({ request }) => {
          if (new URL(request.url).searchParams.get('cursor') === null) {
            return HttpResponse.json(pageOf([carrying(1, PAID)], 'page-2'));
          }
          await second.opened;
          return HttpResponse.json(pageOf([carrying(2, TECHNICAL)], null));
        }),
        http.get(SUMMARY_PATH, () =>
          HttpResponse.json({
            data: {
              ...EMPTY_SUMMARY.data,
              engine_codes: ['chatgpt_web', 'gemini_web'],
              prompts: [],
              topics: [
                topicRow(ids.paid, 'Paid search', [counted(4, 1)]),
                topicRow(ids.technical, 'Technical SEO', [counted(4, 2)]),
              ],
            },
          }),
        ),
      );
      renderWithProviders(promptsAs('viewer'), { searchParams: `?topic=${ids.technical}` });
      await settle();
      // Page 1 has no such topic: the link is not judged yet, and nothing says there is no match
      expect(screen.queryByRole('heading', { name: NO_MATCH_TITLE })).toBeNull();
      second.open();
      await vi.waitFor(async () => expect(await names()).toEqual(['Technical SEO']));
    });
  });
});
