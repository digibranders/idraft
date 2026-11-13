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
  it('lists the active prompts with their topic and country, under a heading that is read and not drawn', async () => {
    const { container } = renderOnPrompts(promptsAs('viewer'), { searchParams: '?tab=prompts' });
    const table = await grid();
    expect(
      await within(table).findByText('Which SEO agency is best for a SaaS startup in Germany?'),
    ).toBeInTheDocument();
    expect(within(table).getAllByText('Technical SEO').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Germany').length).toBeGreaterThan(0);
    const heading = screen.getByRole('heading', { level: 1, name: 'Topics & Prompts' });
    expect(heading).toHaveClass('sr-only');
    // The dates of the window are not a caption: they are in the tooltip of the window and of the Updated text
    expect(screen.queryByText(/^Answers from /)).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the topic of a prompt as a badge, with where it sits in the tree in a tooltip the keyboard reaches', async () => {
    renderOnPrompts(promptsAs('viewer'), { searchParams: '?tab=prompts' });
    const table = await grid();
    const badge = (await within(table).findAllByText('Technical SEO'))[0] as HTMLElement;
    expect(badge).toHaveAttribute('data-slot', 'badge');
    const cell = badge.closest<HTMLElement>('[role="gridcell"]') as HTMLElement;
    expect(cell).toHaveAccessibleDescription('SEO / Technical SEO');
    // The table puts the tooltip on the cell, which is what takes the keyboard focus, and opens it from there
    expect(cell).toHaveAttribute('data-cell');
    // A topic at the top of the tree sits nowhere else: its name is all there is to say, and the badge may cut it
    const top = within(table).getAllByText('SEO')[0] as HTMLElement;
    expect(top).toHaveAttribute('data-slot', 'badge');
    expect(top.closest('[role="gridcell"]')).toHaveAccessibleDescription('SEO');
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

/** The date range picker of the top bar: a button whose name starts with this. */
const RANGE_NAME = 'Date range:';
const rangeTrigger = (): Promise<HTMLElement> => screen.findByRole('button', { name: /^Date range: / });

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
    // The legacy key of the address: a link made before the date range picker keeps its 7 days
    renderOnPrompts(withTopBar(promptsAs('viewer')), { searchParams: '?window=7' });
    expect(await rangeTrigger()).toHaveAccessibleName(`${RANGE_NAME} Last 7 days (7d), Nov 6 to Nov 12, 2026`);
    await grid();
    expect(asked.map((url) => [url.searchParams.get('from'), url.searchParams.get('to')])).toContainEqual([
      '2026-11-06',
      '2026-11-12',
    ]);
  });

  it('shows the date range picker first in the top bar, on the 28 days of a page opened without a range', async () => {
    const asked: URL[] = [];
    server.use(
      http.get(SUMMARY_PATH, ({ request }) => {
        asked.push(new URL(request.url));
        return HttpResponse.json(EMPTY_SUMMARY);
      }),
    );
    renderOnPrompts(withTopBar(promptsAs('viewer')));
    const trigger = await rangeTrigger();
    expect(trigger).toHaveAccessibleName(`${RANGE_NAME} Last 28 days (28d), Oct 16 to Nov 12, 2026`);
    const country = await screen.findByRole('combobox', { name: /^Country:/ });
    expect(trigger.compareDocumentPosition(country) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await grid();
    expect(asked.map((url) => [url.searchParams.get('from'), url.searchParams.get('to')])).toContainEqual([
      '2026-10-16',
      '2026-11-12',
    ]);
  });

  it('writes win to the address when a preset is chosen, and asks the summary for its days', async () => {
    const asked: URL[] = [];
    server.use(
      http.get(SUMMARY_PATH, ({ request }) => {
        asked.push(new URL(request.url));
        return HttpResponse.json(EMPTY_SUMMARY);
      }),
    );
    const writes: string[] = [];
    const { user } = renderOnPrompts(withTopBar(promptsAs('viewer')), {
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await grid();
    await user.click(await rangeTrigger());
    await user.click(await screen.findByRole('button', { name: 'Last 90 days' }));
    await vi.waitFor(() => expect(new URLSearchParams(writes.at(-1)).get('win')).toBe('90d'));
    await vi.waitFor(() =>
      expect(asked.map((url) => [url.searchParams.get('from'), url.searchParams.get('to')])).toContainEqual([
        '2026-08-15',
        '2026-11-12',
      ]),
    );
  });

  it('writes from and to, and drops the legacy window, when a custom range is applied', async () => {
    const asked: URL[] = [];
    server.use(
      http.get(SUMMARY_PATH, ({ request }) => {
        asked.push(new URL(request.url));
        return HttpResponse.json(EMPTY_SUMMARY);
      }),
    );
    const writes: string[] = [];
    const { user } = renderOnPrompts(withTopBar(promptsAs('viewer')), {
      searchParams: '?window=7',
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await grid();
    await user.click(await rangeTrigger());
    await user.click(await screen.findByRole('button', { name: 'Custom range' }));
    const start = await screen.findByRole('textbox', { name: 'Start date' });
    await user.clear(start);
    await user.type(start, '2026-09-01');
    const end = screen.getByRole('textbox', { name: 'End date' });
    await user.clear(end);
    await user.type(end, '2026-10-31');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await vi.waitFor(() => {
      const written = new URLSearchParams(writes.at(-1));
      expect([written.get('from'), written.get('to'), written.has('window'), written.has('win')]).toEqual([
        '2026-09-01',
        '2026-10-31',
        false,
        false,
      ]);
    });
    await vi.waitFor(() =>
      expect(asked.map((url) => [url.searchParams.get('from'), url.searchParams.get('to')])).toContainEqual([
        '2026-09-01',
        '2026-10-31',
      ]),
    );
    expect(await rangeTrigger()).toHaveAccessibleName(`${RANGE_NAME} Sep 1 to Oct 31, 2026 (61d)`);
  });

  it('reads a custom range of the address, and asks the summary for those dates', async () => {
    const asked: URL[] = [];
    server.use(
      http.get(SUMMARY_PATH, ({ request }) => {
        asked.push(new URL(request.url));
        return HttpResponse.json(EMPTY_SUMMARY);
      }),
    );
    renderOnPrompts(withTopBar(promptsAs('viewer')), { searchParams: '?from=2026-09-01&to=2026-10-31' });
    expect(await rangeTrigger()).toHaveAccessibleName(`${RANGE_NAME} Sep 1 to Oct 31, 2026 (61d)`);
    await grid();
    expect(asked.map((url) => [url.searchParams.get('from'), url.searchParams.get('to')])).toContainEqual([
      '2026-09-01',
      '2026-10-31',
    ]);
    expect(screen.queryByText(/^The link asked for/)).toBeNull();
  });

  it('shows the 28 days and says why when the link asks for a range that is too long', async () => {
    const asked: URL[] = [];
    server.use(
      http.get(SUMMARY_PATH, ({ request }) => {
        asked.push(new URL(request.url));
        return HttpResponse.json(EMPTY_SUMMARY);
      }),
    );
    renderOnPrompts(withTopBar(promptsAs('viewer')), { searchParams: '?from=2026-06-01&to=2026-10-31' });
    expect(
      await screen.findByText('The link asked for more than 91 days, so the last 28 days are shown.'),
    ).toBeInTheDocument();
    expect(await rangeTrigger()).toHaveAccessibleName(`${RANGE_NAME} Last 28 days (28d), Oct 16 to Nov 12, 2026`);
    await grid();
    expect(asked.map((url) => [url.searchParams.get('from'), url.searchParams.get('to')])).toContainEqual([
      '2026-10-16',
      '2026-11-12',
    ]);
  });

  it('says why when the link has dates that cannot be read, or in the future, and not when it has none', async () => {
    const first = renderOnPrompts(withTopBar(promptsAs('viewer')), { searchParams: '?from=abc&to=2026-10-31' });
    expect(
      await screen.findByText('The dates in the link could not be read, so the last 28 days are shown.'),
    ).toBeInTheDocument();
    first.unmount();
    const second = renderOnPrompts(withTopBar(promptsAs('viewer')), { searchParams: '?from=2026-11-01&to=2026-11-30' });
    expect(
      await screen.findByText('The link asked for dates after today, so the last 28 days are shown.'),
    ).toBeInTheDocument();
    second.unmount();
    renderOnPrompts(withTopBar(promptsAs('viewer')));
    await rangeTrigger();
    expect(screen.queryByText(/^The link /)).toBeNull();
  });

  it('refuses a custom range of more than 91 days in the picker: the answers route takes no more', async () => {
    const { user } = renderOnPrompts(withTopBar(promptsAs('viewer')));
    await grid();
    await user.click(await rangeTrigger());
    await user.click(await screen.findByRole('button', { name: 'Custom range' }));
    const start = await screen.findByRole('textbox', { name: 'Start date' });
    await user.clear(start);
    await user.type(start, '2026-08-01');
    const end = screen.getByRole('textbox', { name: 'End date' });
    await user.clear(end);
    await user.type(end, '2026-11-12');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getAllByText(/is longer than the 91 day limit/).length).toBeGreaterThan(0);
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
    await user.click(await rangeTrigger());
    await user.click(await screen.findByRole('button', { name: 'Last 7 days' }));
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: /^Date range: / })).toHaveAccessibleName(
        `${RANGE_NAME} Last 7 days (7d), Nov 6 to Nov 12, 2026`,
      ),
    );
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
  it('shows the Mention of each enabled engine as a percent with its count of valid answers, and only for enabled engines', async () => {
    renderOnPrompts(promptsAs('viewer'), { searchParams: '?tab=prompts' });
    const table = await grid();
    expect(await within(table).findByRole('columnheader', { name: /^ChatGPT mention/ })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /^Gemini mention/ })).toBeInTheDocument();
    // The counts of Mentioned and Cited are columns of the chooser, off until chosen
    expect(within(table).queryByRole('columnheader', { name: /^ChatGPT cited/ })).toBeNull();
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
        // The first cell holds the row's checkbox, the last its menu
        .slice(1, -1)
        .map((cell) => cell.textContent);
    // The empty text is the Trend cell, a sparkline that says its weeks in its accessible name
    expect(rowOf(FIRST_TEXT)).toEqual([
      'SEO',
      'Germany',
      '63% avg of 2',
      '33% avg of 2',
      '',
      '50% 3 of 6',
      '75% 6 of 8',
    ]);
    expect(rowOf('How do I run a technical SEO audit on a large site?')).toEqual([
      'Technical SEO',
      'Germany',
      '79% avg of 2',
      '25% avg of 2',
      '',
      '83% 5 of 6',
      '75% 6 of 8',
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
    await user.click(within(table).getByRole('button', { name: 'ChatGPT mention' }));
    // A rate sorts high to low on the first click
    expect(within(table).getByRole('columnheader', { name: /^ChatGPT mention/ })).toHaveAttribute(
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
      searchParams: `?topic=${idOf(3, 9)}&branded=nope`,
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    // The Branded filter's one option is known at once; the topics are judged when the vocabularies are read too,
    // so each is told when it is judged (a toast gives way to the next). The country is no filter: it is the top bar's
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
    expect(await within(table).findByRole('columnheader', { name: /^Gemini mention/ })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: /^ChatGPT mention/ })).toBeNull();
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
    expect(await within(table).findByRole('columnheader', { name: /^Gemini mention/ })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: /^ChatGPT mention/ })).toBeNull();
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
    expect(await within(await grid()).findByRole('columnheader', { name: /^ChatGPT mention/ })).toBeInTheDocument();
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
      const up = renderOnPrompts(promptsAs('viewer'), { searchParams: '?sort=chatgpt_web_rate' });
      expect(await order()).toEqual([
        'Question number 3?',
        'Question number 1?',
        'Question number 6?',
        'Question number 2?',
        'Question number 4?',
        'Question number 5?',
      ]);
      up.unmount();
      renderOnPrompts(promptsAs('viewer'), { searchParams: '?sort=-chatgpt_web_rate' });
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
      // 2 of 40, 2 of 20, 2 of 8, 4 of 8, 4 of 4: each has the four answers a rate needs
      serve([counted(40, 2), counted(20, 2), counted(8, 2), counted(8, 4), counted(4, 4)]);
      const up = renderOnPrompts(promptsAs('viewer'), { searchParams: '?sort=chatgpt_web_rate' });
      expect(await order()).toEqual([1, 2, 3, 4, 5].map((n) => `Question number ${String(n)}?`));
      up.unmount();
      renderOnPrompts(promptsAs('viewer'), { searchParams: '?sort=-chatgpt_web_rate' });
      expect(await order()).toEqual([5, 4, 3, 2, 1].map((n) => `Question number ${String(n)}?`));
    });

    it('keeps a sort on a hidden engine in the link: the default sort applies, and the sort returns with the engine', async () => {
      serve();
      const writes: string[] = [];
      const { user } = renderOnPrompts(promptsAs('viewer'), {
        searchParams: '?sort=-chatgpt_web_rate&engine=gemini_web',
        onUrlUpdate: ({ queryString }) => writes.push(queryString),
      });
      const table = await grid();
      await within(table).findByText('Question number 1?');
      expect(within(table).queryByRole('columnheader', { name: /^ChatGPT mention/ })).toBeNull();
      expect(within(table).getByRole('columnheader', { name: /^Mention rate/ })).toHaveAttribute(
        'aria-sort',
        'descending',
      );
      expect(writes).toEqual([]);
      await user.click(screen.getByRole('button', { name: 'Clear filters' }));
      expect(await within(table).findByRole('columnheader', { name: /^ChatGPT mention/ })).toHaveAttribute(
        'aria-sort',
        'descending',
      );
      expect(writes.at(-1)).toContain('sort=-chatgpt_web_rate');
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
  /** The topic and prompt names in the tree, in order (a parent row is named by its label, which its count of topics follows). */
  const names = async (): Promise<string[]> =>
    (await within(await treegrid()).findAllByRole('rowheader')).map(
      (cell) => cell.getAttribute('aria-label') ?? cell.textContent ?? '',
    );
  const rowOf = (tree: HTMLElement, name: string): HTMLElement =>
    within(tree).getByText(name).closest('[role="row"]') as HTMLElement;
  const levelOf = (tree: HTMLElement, level: 1 | 2): string[] =>
    [...tree.querySelectorAll(`[role="row"][aria-level="${String(level)}"] [role="rowheader"]`)].map(
      (cell) => cell.getAttribute('aria-label') ?? cell.textContent ?? '',
    );
  const ROLLUP_NOTE = 'A parent row counts every prompt under it, so rows do not add up to the parent.';
  /** What the footer puts between its counts. */
  const MIDDLE_DOT = String.fromCodePoint(0xb7);

  it('opens on Topics: one row per top level topic, the highest Mention rate first, a parent opening onto the topics below it', async () => {
    const { container, user } = renderWithProviders(promptsAs('viewer'));
    const tree = await treegrid();
    // The mock's answers are made from the prompt, the engine and the day, so the rates and this order are the same
    // every run. A topic below another is not a row of the top level: SEO holds its own 5 prompts and the 4 of
    // Technical SEO and 3 of Local SEO (the branded one is out), and its row counts all 12
    expect(await names()).toEqual(['No topic', 'Content Marketing', 'SEO', 'Paid Search']);
    expect(within(tree).queryByText('Technical SEO')).toBeNull();
    expect(within(tree).getByRole('columnheader', { name: /^ChatGPT mentioned/ })).toBeInTheDocument();
    expect(within(tree).getByRole('button', { name: 'Expand SEO, 2 topics' })).toBeInTheDocument();
    expect(within(tree).getByRole('button', { name: 'Expand Content Marketing, 1 topic' })).toBeInTheDocument();
    // A topic without topics below it opens onto its prompts
    expect(within(tree).getByRole('button', { name: 'Expand Paid Search, 2 prompts' })).toBeInTheDocument();
    expect(within(rowOf(tree, 'SEO')).getByText('12')).toBeInTheDocument();
    // A parent opens in place onto the topics under it, one level in, and offers its own prompts
    await user.click(within(tree).getByRole('button', { name: 'Expand SEO, 2 topics' }));
    expect(await names()).toEqual([
      'No topic',
      'Content Marketing',
      'SEO',
      'Technical SEO',
      'Local SEO',
      'Show all 12 prompts of SEO',
      'Paid Search',
    ]);
    expect(levelOf(tree, 1)).toEqual(['No topic', 'Content Marketing', 'SEO', 'Paid Search']);
    expect(levelOf(tree, 2)).toEqual(['Technical SEO', 'Local SEO', 'Show all 12 prompts of SEO']);
    expect(within(tree).queryByText('Which SEO agency is best for a SaaS startup in Germany?')).toBeNull();
    // A child is a row of its own, with its own numbers and no disclosure button, and opens the topic's drawer
    expect(within(rowOf(tree, 'Technical SEO')).getByText('4')).toBeInTheDocument();
    expect(rowOf(tree, 'Technical SEO')).not.toHaveAttribute('aria-expanded');
    expect(within(tree).queryByRole('button', { name: 'Open the topic Technical SEO' })).toBeNull();
    expect(within(tree).getByRole('button', { name: 'Collapse SEO, 2 topics' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('opens a topic without topics below it onto eight of its prompts, and offers the rest', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'));
    const tree = await treegrid();
    await user.click(await within(tree).findByRole('button', { name: 'Expand Paid Search, 2 prompts' }));
    expect(
      await within(tree).findByText('What is the best way to manage paid search on a small budget?'),
    ).toBeInTheDocument();
    expect(levelOf(tree, 2)).toHaveLength(2);
    expect(within(tree).queryByRole('button', { name: /^Show all/ })).toBeNull();
  });

  it('says in a note under the table that a parent row does not add up from the rows below it, while a parent is shown', async () => {
    const first = renderWithProviders(promptsAs('viewer'));
    await treegrid();
    expect(await screen.findByText(ROLLUP_NOTE)).toBeInTheDocument();
    first.unmount();
    renderWithProviders(promptsAs('viewer'), { searchParams: `?topic=${MOCK_TERM_IDS.paidSearch}` });
    await vi.waitFor(async () => expect(await names()).toEqual(['Paid Search']));
    expect(screen.queryByText(ROLLUP_NOTE)).toBeNull();
  });

  it('reads a parent as Rankings reads a group: its name with a muted count of what it opens onto, as "12 keywords" there', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'));
    const tree = await treegrid();
    await within(tree).findByText('Paid Search');
    const count = within(rowOf(tree, 'SEO')).getByText('2 topics');
    // Cut to an ellipsis in a narrow cell, the count says all of itself in a tooltip
    await user.hover(count);
    expect(await screen.findByText('2 topics', { selector: '[data-slot="tooltip"] span' })).toBeInTheDocument();
    await user.unhover(count);
    // The count gives way before the name does: it ends in an ellipsis where the name keeps its room
    expect(count).toHaveClass('text-foreground-tertiary', 'min-w-0', 'truncate');
    expect(within(rowOf(tree, 'SEO')).getByRole('button', { name: 'Open the topic SEO' })).toHaveClass('shrink-0');
    expect(within(rowOf(tree, 'Content Marketing')).getByText('1 topic')).toBeInTheDocument();
    // A topic with none below it opens onto its prompts
    expect(within(rowOf(tree, 'Paid Search')).getByText('2 prompts')).toBeInTheDocument();
    expect(within(tree).getByRole('button', { name: 'Expand SEO, 2 topics' })).toBeInTheDocument();
  });

  it('draws the name of a parent in the text color of a group name, and a topic under it as text that a click on the row opens', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'));
    const tree = await treegrid();
    await user.click(await within(tree).findByRole('button', { name: 'Expand SEO, 2 topics' }));
    const name = within(tree).getByRole('button', { name: 'Open the topic SEO' });
    expect(name).toHaveClass('text-foreground');
    expect(name).not.toHaveClass('text-link');
    // The row's height and type are the table's: no class of the topic rows sets them
    expect(rowOf(tree, 'SEO').className).not.toMatch(/\bh-(9|11)\b/);
    await user.click(within(tree).getByText('Technical SEO'));
    expect(await screen.findByRole('complementary', { name: 'Technical SEO' })).toBeInTheDocument();
  });

  it('counts the topics and the prompts in the footer, each once: the topics shown with those under them, the prompts in scope', async () => {
    const first = renderWithProviders(promptsAs('viewer'));
    await treegrid();
    // Four top level topics and three below them; 23 prompts, the branded one out, each counted once
    expect(await screen.findByText(`7 topics ${MIDDLE_DOT} 23 prompts`)).toBeInTheDocument();
    first.unmount();
    renderWithProviders(promptsAs('viewer'), { searchParams: `?topic=${MOCK_TERM_IDS.seo}` });
    expect(await screen.findByText(`3 topics ${MIDDLE_DOT} 12 prompts`)).toBeInTheDocument();
  });

  it('opens every parent from Expand all and closes them from Collapse all, by the keyboard too', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'));
    const tree = await treegrid();
    const expandAll = await screen.findByRole('button', { name: 'Expand all' });
    await user.click(expandAll);
    await vi.waitFor(() => expect(levelOf(tree, 2)).toContain('Technical SEO'));
    expect(levelOf(tree, 2)).toEqual(
      expect.arrayContaining([
        'Technical SEO',
        'Local SEO',
        'Blog Strategy',
        'Show all 12 prompts of SEO',
        'Show all 7 prompts of Content Marketing',
      ]),
    );
    for (const row of tree.querySelectorAll('[data-group-row]')) expect(row).toHaveAttribute('aria-expanded', 'true');
    const collapseAll = screen.getByRole('button', { name: 'Collapse all' });
    collapseAll.focus();
    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(levelOf(tree, 2)).toEqual([]));
    for (const row of tree.querySelectorAll('[data-group-row]')) expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Expand all' })).toHaveFocus();
    // One parent opened by hand makes the button offer to open the rest
    await user.click(within(tree).getByRole('button', { name: 'Expand SEO, 2 topics' }));
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument();
  });

  it('opens a parent from the keyboard and keeps the focus on its button', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'));
    const tree = await treegrid();
    const open = await within(tree).findByRole('button', { name: 'Expand SEO, 2 topics' });
    open.focus();
    await user.keyboard('{Enter}');
    expect(await within(tree).findByRole('button', { name: 'Collapse SEO, 2 topics' })).toHaveFocus();
    expect(rowOf(tree, 'SEO')).toHaveAttribute('aria-expanded', 'true');
    expect(levelOf(tree, 2)).toEqual(['Technical SEO', 'Local SEO', 'Show all 12 prompts of SEO']);
  });

  it('sorts the top level among itself and the topics under a parent among themselves', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'));
    const tree = await treegrid();
    await user.click(await within(tree).findByRole('button', { name: 'Expand SEO, 2 topics' }));
    await user.click(within(tree).getByRole('button', { name: 'Prompts' }));
    await user.click(within(tree).getByRole('button', { name: 'Prompts' }));
    // Fewest prompts first, a tie by name: the topics of SEO stay under it, Local SEO (3) before Technical SEO (4)
    expect(await names()).toEqual([
      'No topic',
      'Paid Search',
      'Content Marketing',
      'SEO',
      'Local SEO',
      'Technical SEO',
      'Show all 12 prompts of SEO',
    ]);
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

  it('counts the branded prompts in the topics once the Branded filter includes them', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'), { searchParams: '?branded=include' });
    const tree = await treegrid();
    await user.click(await within(tree).findByRole('button', { name: 'Expand SEO, 2 topics' }));
    expect(await within(tree).findByRole('button', { name: 'Show all 13 prompts of SEO' })).toBeInTheDocument();
  });

  it('keeps the chosen topic and the topics below it, as the Prompts tab does', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'), { searchParams: `?topic=${MOCK_TERM_IDS.seo}` });
    await vi.waitFor(async () => expect(await names()).toEqual(['SEO']));
    await user.click(await screen.findByRole('button', { name: 'Expand all' }));
    await vi.waitFor(async () =>
      expect(await names()).toEqual(['SEO', 'Technical SEO', 'Local SEO', 'Show all 12 prompts of SEO']),
    );
  });

  it('shows a child alone at the top level when the filter names it and not its parent', async () => {
    renderWithProviders(promptsAs('viewer'), { searchParams: `?topic=${MOCK_TERM_IDS.localSeo}` });
    await vi.waitFor(async () => expect(await names()).toEqual(['Local SEO']));
    expect(screen.queryByText(ROLLUP_NOTE)).toBeNull();
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
    await user.click(screen.getByRole('radio', { name: 'Prompts' }));
    const table = await grid();
    expect(await within(table).findByText('How do I run a technical SEO audit on a large site?')).toBeInTheDocument();
    expect(within(table).queryByText('Which tools track local rankings by city?')).toBeNull();
    const onPrompts = new URLSearchParams(writes.at(-1));
    expect(onPrompts.get('tab')).toBe('prompts');
    expect(onPrompts.get('topic')).toBe(MOCK_TERM_IDS.technicalSeo);
    expect(onPrompts.get('window')).toBe('7');
    await user.click(screen.getByRole('radio', { name: 'Topics' }));
    expect(await names()).toEqual(['Technical SEO']);
    const back = new URLSearchParams(writes.at(-1));
    expect(back.has('tab')).toBe(false);
    expect(back.get('topic')).toBe(MOCK_TERM_IDS.technicalSeo);
    expect(back.get('window')).toBe('7');
  });

  it('keeps a country of the address on both tabs, and narrows the topics to it too', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts&country=IN' });
    const table = await grid();
    await vi.waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
    await user.click(screen.getByRole('radio', { name: 'Topics' }));
    // The Hindi prompt is the only one in India, and it is given SEO: no other topic has a prompt left
    await vi.waitFor(async () => expect(await names()).toEqual(['SEO']));
    await user.click(screen.getByRole('radio', { name: 'Prompts' }));
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

  describe('searching a parent and its child topic', () => {
    const PARENT = idOf(3, 1);
    const CHILD = idOf(3, 2);
    const serveParentAndChild = (): void => {
      serveVocabulary([treeNode(PARENT, 'Alpha', null, [treeNode(CHILD, 'Zebra', PARENT, [])])]);
      const cells = [topicCells('chatgpt_web', [])];
      server.use(
        http.get(LIST_PATH, () =>
          HttpResponse.json(
            pageOf(
              [
                {
                  ...promptOf(1),
                  terms: [{ term_id: CHILD, name: 'Zebra', path: 'alpha/zebra', vocabulary_kind: 'topic' }],
                },
              ],
              null,
            ),
          ),
        ),
        http.get(SUMMARY_PATH, () =>
          HttpResponse.json({
            data: {
              ...EMPTY_SUMMARY.data,
              prompts: [
                {
                  prompt_id: idOf(1, 1),
                  text: 'Question number 1?',
                  is_branded: false,
                  topic_term_ids: [CHILD],
                  last_observed_at: null,
                  last_valid_at: null,
                  engines: [promptCells('chatgpt_web', NO_COUNTS)],
                },
              ],
              topics: [
                { term_id: PARENT, name: 'Alpha', prompt_count: 1, engines: cells },
                { term_id: CHILD, name: 'Zebra', prompt_count: 1, engines: cells },
              ],
            },
          }),
        ),
      );
    };

    it('finds the parent of a child topic whose own name is searched, and opens onto that child alone', async () => {
      serveParentAndChild();
      const { user } = renderWithProviders(promptsAs('viewer'), { searchParams: '?q=zebra' });
      const tree = await treegrid();
      expect(await names()).toEqual(['Alpha']);
      await user.click(within(tree).getByRole('button', { name: 'Expand Alpha, 1 topic' }));
      expect(await names()).toEqual(['Alpha', 'Zebra', 'Show the prompt of Alpha']);
    });

    it('keeps every topic below a parent whose own name is searched, and finds a parent by the text of a prompt', async () => {
      serveParentAndChild();
      const first = renderWithProviders(promptsAs('viewer'), { searchParams: '?q=alpha' });
      await vi.waitFor(async () => expect(await names()).toEqual(['Alpha']));
      expect(within(await treegrid()).getByRole('button', { name: 'Expand Alpha, 1 topic' })).toBeInTheDocument();
      first.unmount();
      serveParentAndChild();
      renderWithProviders(promptsAs('viewer'), { searchParams: '?q=question' });
      await vi.waitFor(async () => expect(await names()).toEqual(['Alpha']));
    });
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
    await user.click(screen.getByRole('radio', { name: 'Prompts' }));
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
    await user.click(await rangeTrigger());
    await user.click(await screen.findByRole('button', { name: 'Last 7 days' }));
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: /^Date range: / })).toHaveAccessibleName(
        `${RANGE_NAME} Last 7 days (7d), Nov 6 to Nov 12, 2026`,
      ),
    );
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
    const column = await within(await grid()).findByRole('columnheader', { name: /^ChatGPT mention/ });
    expect(column).not.toHaveAccessibleDescription(/Each prompt counts once/);
  });

  it('clears the filters from the empty state and brings the topics back', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'), {
      searchParams: `?topic=${MOCK_TERM_IDS.paidSearch}&q=seo`,
    });
    const heading = await screen.findByRole('heading', { name: NO_MATCH_TITLE });
    await user.click(within(heading.parentElement as HTMLElement).getByRole('button', { name: 'Clear filters' }));
    // The search stays, and finds the topics whose name or prompts say SEO
    await vi.waitFor(async () => expect(await names()).toEqual(['No topic', 'SEO']));
    expect(screen.queryByRole('heading', { name: NO_MATCH_TITLE })).toBeNull();
  });

  it('moves between the two views with the arrow keys, and keeps the focus on the switch when the table is another', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'));
    await treegrid();
    screen.getByRole('radio', { name: 'Topics' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(await grid()).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Prompts' })).toBeChecked();
    // The switch lives in the toolbar of each table, so it is drawn again: the focus follows it
    await vi.waitFor(() => expect(screen.getByRole('radio', { name: 'Prompts' })).toHaveFocus());
    await user.keyboard('{ArrowLeft}');
    expect(await treegrid()).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Topics' })).toBeChecked();
    await vi.waitFor(() => expect(screen.getByRole('radio', { name: 'Topics' })).toHaveFocus());
  });

  it('is a radio group named for the two views, at the end of the toolbar before the density and columns as on Rankings, and the table keeps its own name', async () => {
    renderWithProviders(promptsAs('viewer'));
    const tree = await treegrid();
    const group = screen.getByRole('radiogroup', { name: 'Topics and prompts' });
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
    expect(within(group).getByRole('radio', { name: 'Prompts' })).not.toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Topics' })).toBeChecked();
    const search = screen.getByRole('searchbox');
    expect(search.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const controls = screen.getByRole('toolbar', { name: /Topics table actions/ });
    expect(group.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(controls).not.toContainElement(group);
    expect(tree).toHaveAccessibleName('Topics');
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('makes a history entry of a change of tab, so Back returns to the other one, and none of a search', async () => {
    const writes: { query: string; history: string | undefined }[] = [];
    const { user } = renderWithProviders(promptsAs('viewer'), {
      onUrlUpdate: ({ queryString, options }) => writes.push({ query: queryString, history: options.history }),
    });
    await treegrid();
    await user.click(screen.getByRole('radio', { name: 'Prompts' }));
    expect(writes.at(-1)).toEqual({ query: '?tab=prompts', history: 'push' });
    await user.type(await screen.findByRole('searchbox'), 'seo');
    expect(writes.at(-1)?.history).toBe('replace');
    await user.click(screen.getByRole('radio', { name: 'Topics' }));
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

    it('opens a topic that only a topic below it is given onto that topic, and offers the prompts it rolls up', async () => {
      serveBoth();
      serveTree();
      const { user } = renderWithProviders(promptsAs('viewer'));
      const tree = await treegrid();
      // No prompt is given SEO itself, but the tree tells what is below it: Technical SEO is a row under it, not at the top
      expect(await names()).toEqual(['Paid search', 'SEO']);
      await user.click(await within(tree).findByRole('button', { name: 'Expand SEO, 1 topic' }));
      expect(await names()).toEqual(['Paid search', 'SEO', 'Technical SEO', 'Show all 2 prompts of SEO']);
      expect(within(tree).queryAllByText(/^Question number \d\?$/)).toHaveLength(0);
      expect(within(tree).getByRole('button', { name: 'Show all 2 prompts of SEO' })).toBeInTheDocument();
    });

    it('lists a prompt of two topics under each, and marks the row that was clicked, not the first row of the prompt', async () => {
      serveBoth();
      const { user } = renderWithProviders(promptsAs('viewer'));
      const tree = await treegrid();
      await user.click(await within(tree).findByRole('button', { name: 'Expand Technical SEO, 2 prompts' }));
      await user.click(within(tree).getByRole('button', { name: 'Expand Paid search, 1 prompt' }));
      const text = 'Question number 2?';
      const rows = await within(tree).findAllByText(text);
      expect(rows).toHaveLength(2);
      expect(within(tree).getAllByText('Question number 1?')).toHaveLength(1);
      const rowOfText = (node: HTMLElement): HTMLElement => node.closest<HTMLElement>('[role="row"]') ?? node;
      await user.click(rows[1] ?? tree);
      // The prompt is not one the mock holds, so the inspector says so; the table marks the row that was clicked
      await vi.waitFor(() => {
        const [above, below] = within(tree).getAllByText(text).map(rowOfText);
        expect(above).not.toHaveAttribute('aria-current');
        expect(below).toHaveAttribute('aria-current', 'true');
      });
    });

    it('lists eight prompts of a topic with none below it, offers the rest, and steps through all of them', async () => {
      const members = Array.from({ length: 10 }, (_, index) => index + 1);
      serve(
        members.map((index) => carrying(index, PAID)),
        members.map((index) => promptRow(index, [ids.paid], counted(4, index % 5))),
        [
          topicRow(
            ids.paid,
            'Paid search',
            members.map((index) => counted(4, index % 5)),
          ),
        ],
      );
      const { user } = renderWithProviders(promptsAs('viewer'));
      const tree = await treegrid();
      await user.click(await within(tree).findByRole('button', { name: 'Expand Paid search, 10 prompts' }));
      await vi.waitFor(() => expect(levelOf(tree, 2)).toHaveLength(9));
      expect(within(tree).getByRole('button', { name: 'Show all 10 prompts of Paid search' })).toBeInTheDocument();
      await user.click(within(tree).getAllByText(/^Question number \d+\?$/)[0] ?? tree);
      const inspector = await screen.findByRole('complementary');
      expect(within(inspector).getByText(/^\d+ of 10$/)).toBeInTheDocument();
    });

    it('gives a topic below the second level no row, and counts its prompts in the two topics above it', async () => {
      const deep = { top: idOf(3, 21), middle: idOf(3, 22), low: idOf(3, 23) };
      serveVocabulary([
        treeNode(deep.top, 'Compliance', null, [
          treeNode(deep.middle, 'RBI', deep.top, [treeNode(deep.low, 'Cyber', deep.middle, [])]),
        ]),
      ]);
      serve(
        [carrying(1, termOf(deep.low, 'Cyber', 'compliance/rbi/cyber'))],
        [promptRow(1, [deep.low], counted(4, 2))],
        [
          topicRow(deep.top, 'Compliance', [counted(4, 2)]),
          topicRow(deep.middle, 'RBI', [counted(4, 2)]),
          topicRow(deep.low, 'Cyber', [counted(4, 2)]),
        ],
      );
      const { user } = renderWithProviders(promptsAs('viewer'));
      const tree = await treegrid();
      await user.click(await within(tree).findByRole('button', { name: 'Expand Compliance, 1 topic' }));
      expect(await names()).toEqual(['Compliance', 'RBI', 'Show the prompt of Compliance']);
      expect(within(tree).queryByText('Cyber')).toBeNull();
      expect(within(rowOf(tree, 'Compliance')).getByText('1')).toBeInTheDocument();
      expect(within(rowOf(tree, 'RBI')).getByText('1')).toBeInTheDocument();
      // Compliance and RBI: two rows, though three topics hold the prompt
      expect(screen.getByText(`2 topics ${MIDDLE_DOT} 1 prompt`)).toBeInTheDocument();
    });

    it('keeps a topic no prompt is given and the topics below it under a filter on it', async () => {
      serveBoth();
      serveTree();
      const { user } = renderWithProviders(promptsAs('viewer'), { searchParams: `?topic=${ids.above}` });
      await vi.waitFor(async () => expect(await names()).toEqual(['SEO']));
      await user.click(await screen.findByRole('button', { name: 'Expand all' }));
      await vi.waitFor(async () =>
        expect(await names()).toEqual(['SEO', 'Technical SEO', 'Show all 2 prompts of SEO']),
      );
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

describe('Topics & Prompts: the metric strip', () => {
  const STRIP = 'Summary of the prompts in view';
  const stripOf = (): Promise<HTMLElement> => screen.findByRole('group', { name: STRIP });
  const counted = (
    valid: number,
    mentioned: number,
    cited: number,
    naming: number,
    share: number,
    observations = valid,
  ): Counts => ({
    ...NO_COUNTS,
    n_valid: valid,
    n_observations: observations,
    mentioned,
    cited,
    sov_answers: naming,
    sov_share: share,
  });
  /**
   * Prompts 1 and 2 are in Germany, prompt 3 in the US. ChatGPT: 1 of 4, 3 of 4 and 4 of 4 answers mention the
   * brand; Gemini has two answers on prompt 1 and none on the others.
   */
  const CHATGPT = [counted(4, 1, 2, 3, 1.5), counted(4, 3, 0, 1, 0.5), counted(4, 4, 4, 4, 4)];
  const GEMINI = [counted(2, 1, 0, 0, 0), NO_COUNTS, NO_COUNTS];
  /** Prompts 1 and 2 are given SEO and prompt 3 Paid search: two topics, of which one is left under the German filter. */
  const SEO_TERM = { term_id: idOf(3, 1), name: 'SEO', path: 'seo', vocabulary_kind: 'topic' };
  const PAID_TERM = { term_id: idOf(3, 3), name: 'Paid search', path: 'paid-search', vocabulary_kind: 'topic' };
  const TERMS_OF = [[SEO_TERM], [SEO_TERM], [PAID_TERM]];
  const serveStrip = (): void => {
    serveVocabulary([
      treeNode(SEO_TERM.term_id, 'SEO', null, []),
      treeNode(PAID_TERM.term_id, 'Paid search', null, []),
    ]);
    server.use(
      http.get(LIST_PATH, () =>
        HttpResponse.json(
          pageOf(
            CHATGPT.map((_, index) => ({
              ...promptOf(index + 1),
              country_iso: index === 2 ? 'US' : 'DE',
              terms: TERMS_OF[index] ?? [],
            })),
            null,
          ),
        ),
      ),
      http.get(SUMMARY_PATH, () =>
        HttpResponse.json({
          data: {
            ...EMPTY_SUMMARY.data,
            engine_codes: ['chatgpt_web', 'gemini_web'],
            prompts: CHATGPT.map((counts, index) => ({
              prompt_id: idOf(1, index + 1),
              text: `Question number ${String(index + 1)}?`,
              is_branded: false,
              topic_term_ids: (TERMS_OF[index] ?? []).map((term) => term.term_id),
              engines: [promptCells('chatgpt_web', counts), promptCells('gemini_web', GEMINI[index] ?? NO_COUNTS)],
            })),
            topics: [
              {
                term_id: SEO_TERM.term_id,
                name: 'SEO',
                prompt_count: 2,
                engines: [topicCells('chatgpt_web', CHATGPT.slice(0, 2)), topicCells('gemini_web', GEMINI.slice(0, 2))],
              },
              {
                term_id: PAID_TERM.term_id,
                name: 'Paid search',
                prompt_count: 1,
                engines: [topicCells('chatgpt_web', CHATGPT.slice(2)), topicCells('gemini_web', GEMINI.slice(2))],
              },
            ],
          },
        }),
      ),
    );
  };
  /** The strip once its chips have values: a chip is a definition with the label before it. */
  const cards = async (): Promise<HTMLElement[]> => {
    const strip = await stripOf();
    await vi.waitFor(() => expect(strip).not.toHaveAttribute('aria-busy'));
    return within(strip).getAllByRole('definition');
  };

  it('shows the prompts in view and a chip per engine with its mention rate, in the one row of the toolbar', async () => {
    serveStrip();
    const { container } = renderWithProviders(promptsAs('viewer'));
    const [prompts, chatgpt, gemini] = await cards();
    expect(
      within(await stripOf())
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Prompts', 'ChatGPT', 'Gemini']);
    // The mean of 25%, 75% and 100%: the rest is in the tooltip, not on the chip
    expect(prompts).toHaveTextContent(/^3$/);
    expect(chatgpt).toHaveTextContent(/^67%$/);
    expect(gemini).toHaveTextContent(/^2 answers$/);
    expect(prompts).toHaveAccessibleDescription('Across 2 topics');
    expect(chatgpt).toHaveAccessibleDescription(
      'Mentioned: 8 of 12 answers. Cited: 6 of 12 answers. Over 3 prompts, each counted once. Share of voice: 8 answers that name a brand.',
    );
    // The chips are in the page header's toolbar, with the Filter button, not a panel of their own
    expect(screen.getByRole('group', { name: STRIP }).closest('[data-slot="page-header"]')).not.toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('puts the counts in reach of the keyboard: the chip is a tab stop that opens its tooltip', async () => {
    serveStrip();
    const { user } = renderWithProviders(promptsAs('viewer'));
    const chatgpt = (await cards())[1] as HTMLElement;
    expect(chatgpt).toHaveAttribute('tabindex', '0');
    for (let stops = 0; stops < 30 && document.activeElement !== chatgpt; stops += 1) await user.tab();
    expect(chatgpt).toHaveFocus();
    expect(
      await screen.findByText(/^Mentioned: 8 of 12 answers\./, { selector: '[data-slot="tooltip"] span' }),
    ).toBeInTheDocument();
  });

  it('follows the filters: the prompts and the rates of the prompts left', async () => {
    serveStrip();
    renderOnPrompts(promptsAs('viewer'), { searchParams: `?topic=${idOf(3, 1)}` });
    const [prompts, chatgpt] = await cards();
    expect(prompts).toHaveTextContent(/^2$/);
    expect(prompts).toHaveAccessibleDescription('Across 1 topic');
    expect(chatgpt).toHaveTextContent(/^50%$/);
  });

  it('follows the country of the address too, on either tab, and asks the summary for it', async () => {
    serveStrip();
    const asked: (string | null)[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/ai/prompts-summary')) asked.push(url.searchParams.get('filter[country_iso]'));
    });
    renderWithProviders(promptsAs('viewer'), { searchParams: '?country=DE' });
    const [prompts, chatgpt] = await cards();
    expect(prompts).toHaveTextContent(/^2$/);
    expect(chatgpt).toHaveTextContent(/^50%$/);
    expect(asked).toContain('DE');
    expect(asked).not.toContain(null);
    server.events.removeAllListeners();
  });

  it('does not say how many topics the prompts span until the topic tree is read', async () => {
    serveStrip();
    const held = gate();
    server.use(
      http.get(TERMS_PATH, async () => {
        await held.opened;
        return HttpResponse.json({ data: [] });
      }),
    );
    renderWithProviders(promptsAs('viewer'));
    const prompts = (await cards())[0] as HTMLElement;
    expect(prompts).toHaveTextContent(/^3$/);
    expect(prompts).not.toHaveAttribute('tabindex');
    held.open();
    await vi.waitFor(() => expect(prompts).toHaveAccessibleDescription('Across 2 topics'));
  });

  it('shows the answers there are, hatched, in place of a rate under four valid answers', async () => {
    serveStrip();
    renderWithProviders(promptsAs('viewer'));
    const gemini = (await cards())[2] as HTMLElement;
    expect(gemini).toHaveTextContent(/^2 answers$/);
    expect(within(gemini).getByText('2 answers')).toHaveClass('bg-insufficient');
    expect(gemini).not.toHaveTextContent('%');
    expect(gemini).toHaveAccessibleDescription(
      'Mentioned: 1 of 2 answers, too few for a rate. Cited: 0 of 2 answers, too few for a rate. Over 1 prompt, each counted once. Share of voice: no brand named.',
    );
  });

  it('keeps the labels and shows no values while the summary loads', async () => {
    const held = gate();
    server.use(
      http.get(SUMMARY_PATH, async () => {
        await held.opened;
        return HttpResponse.json(EMPTY_SUMMARY);
      }),
    );
    renderWithProviders(promptsAs('viewer'));
    const strip = await stripOf();
    expect(strip).toHaveAttribute('aria-busy', 'true');
    expect(within(strip).getByText('ChatGPT')).toBeInTheDocument();
    expect(within(strip).queryByText('n/a')).toBeNull();
    held.open();
  });

  it('shows only the Prompts chip when the counts did not load, and leaves the failure to the banner', async () => {
    server.use(http.get(SUMMARY_PATH, () => HttpResponse.json({ code: 'boom' }, { status: 500 })));
    renderOnPrompts(promptsAs('viewer'));
    const strip = await stripOf();
    await vi.waitFor(() => expect(within(strip).getAllByRole('term')).toHaveLength(1));
    expect(within(strip).getByRole('term')).toHaveTextContent('Prompts');
    expect(within(strip).getByRole('definition')).toHaveTextContent(/^\d+$/);
    expect(
      await screen.findAllByText('The answer counts could not be loaded. The prompts are listed without them.'),
    ).toHaveLength(1);
  });

  it('is not there when the page shows no prompts or no engine', async () => {
    server.use(
      http.get(LIST_PATH, () => HttpResponse.json({ data: [], page: { has_more: false, next_cursor: null } })),
    );
    const first = renderWithProviders(promptsAs('viewer'));
    expect(await screen.findByRole('heading', { name: NO_PROMPTS_TITLE })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: STRIP })).toBeNull();
    first.unmount();
    renderWithProviders(promptsAs('editor', asProject(cleanstart, 'US')));
    expect(await screen.findByRole('heading', { name: 'No AI engine is on' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: STRIP })).toBeNull();
  });
});

describe('Topics & Prompts: rate columns, Top engine, sorting and the metric switcher', () => {
  const counted = (
    valid: number,
    mentioned: number,
    { cited = 0, naming = 0, share = 0 }: Partial<Record<string, number>> = {},
  ): Counts => ({
    ...NO_COUNTS,
    n_valid: valid,
    n_observations: valid,
    mentioned,
    cited,
    sov_answers: naming,
    sov_share: share,
  });
  /**
   * Prompt 1: ChatGPT 6 of 8 (75%), Gemini 2 of 8 (25%). Prompt 2: ChatGPT 3 of 8 (38%), Gemini 3 of 4 (75%).
   * Prompt 3: ChatGPT 1 of 2 answers, which is too few for a rate, and no answer on Gemini.
   */
  const CHATGPT = [
    counted(8, 6, { cited: 4, naming: 6, share: 3 }),
    counted(8, 3, { cited: 0, naming: 3, share: 1 }),
    counted(2, 1),
  ];
  const GEMINI = [counted(8, 2, { cited: 7 }), counted(4, 3, { cited: 2 }), NO_COUNTS];
  const SEO_TERM = { term_id: idOf(3, 1), name: 'SEO', path: 'seo', vocabulary_kind: 'topic' };
  const PAID_TERM = { term_id: idOf(3, 3), name: 'Paid search', path: 'paid-search', vocabulary_kind: 'topic' };
  const TERMS_OF = [[SEO_TERM], [SEO_TERM], [PAID_TERM]];
  const serveRates = (): void => {
    serveVocabulary([
      treeNode(SEO_TERM.term_id, 'SEO', null, []),
      treeNode(PAID_TERM.term_id, 'Paid search', null, []),
    ]);
    server.use(
      http.get(LIST_PATH, () =>
        HttpResponse.json(
          pageOf(
            CHATGPT.map((_, index) => ({ ...promptOf(index + 1), terms: TERMS_OF[index] ?? [] })),
            null,
          ),
        ),
      ),
      http.get(SUMMARY_PATH, () =>
        HttpResponse.json({
          data: {
            ...EMPTY_SUMMARY.data,
            engine_codes: ['chatgpt_web', 'gemini_web'],
            prompts: CHATGPT.map((counts, index) => ({
              prompt_id: idOf(1, index + 1),
              text: `Question number ${String(index + 1)}?`,
              is_branded: false,
              topic_term_ids: (TERMS_OF[index] ?? []).map((term) => term.term_id),
              engines: [promptCells('chatgpt_web', counts), promptCells('gemini_web', GEMINI[index] ?? NO_COUNTS)],
            })),
            topics: [
              {
                term_id: SEO_TERM.term_id,
                name: 'SEO',
                prompt_count: 2,
                engines: [topicCells('chatgpt_web', CHATGPT.slice(0, 2)), topicCells('gemini_web', GEMINI.slice(0, 2))],
              },
              {
                term_id: PAID_TERM.term_id,
                name: 'Paid search',
                prompt_count: 1,
                engines: [topicCells('chatgpt_web', CHATGPT.slice(2)), topicCells('gemini_web', GEMINI.slice(2))],
              },
            ],
          },
        }),
      ),
    );
  };
  const rowOf = (table: HTMLElement, name: string): HTMLElement =>
    within(table).getByText(name).closest('[role="row"]') as HTMLElement;
  /** The text of the cells of a row, after its name. */
  const cellsOf = (table: HTMLElement, name: string): (string | null)[] =>
    within(rowOf(table, name))
      .getAllByRole('gridcell')
      // The first cell holds the row's checkbox, the last its menu
      .slice(1, -1)
      .map((cell) => cell.textContent);
  // A parent's name is its row's label, which its muted count ("2 prompts") follows in the cell
  const order = (table: HTMLElement): string[] =>
    within(table)
      .getAllByRole('rowheader')
      .map((cell) => cell.getAttribute('aria-label') ?? cell.textContent ?? '');

  it('shows the Mention rate and Citation rate of the engines in scope, an insufficient one as its answers, highest Mention rate first', async () => {
    serveRates();
    renderOnPrompts(promptsAs('viewer'));
    const table = await grid();
    await within(table).findByText('Question number 1?');
    // The default sort has two keys, Mention rate then the prompt, and a header says which key it is by its number
    expect(
      within(table)
        .getAllByRole('columnheader')
        // The first header holds the checkbox that selects every row, the last is the menus' column
        .slice(1, -1)
        .map((header) => header.textContent?.replace(/\d$/, '')),
    ).toEqual([
      'Prompt',
      'Topic',
      'Country',
      'Mention rate',
      'Citation rate',
      'Trend',
      'ChatGPT mention',
      'Gemini mention',
    ]);
    // The average is over the engines that have a rate, and says how many; the count behind each engine stays.
    // The empty text is the Trend cell, which has no text of its own (and none at all in these summaries)
    expect(cellsOf(table, 'Question number 1?')).toEqual([
      'SEO',
      'Germany',
      '50% avg of 2',
      '69% avg of 2',
      '',
      '75% 6 of 8',
      '25% 2 of 8',
    ]);
    expect(cellsOf(table, 'Question number 2?')).toEqual([
      'SEO',
      'Germany',
      '56% avg of 2',
      '25% avg of 2',
      '',
      '38% 3 of 8',
      '75% 3 of 4',
    ]);
    // Two answers are too few for a rate: the answers there are, hatched, in place of a percent
    expect(cellsOf(table, 'Question number 3?')).toEqual([
      'Paid search',
      'Germany',
      '2 answers',
      '2 answers',
      '',
      '2 answers',
      'No answers',
    ]);
    const third = rowOf(table, 'Question number 3?');
    expect(within(third).getAllByText('2 answers')[0]).toHaveClass('bg-insufficient');
    // An equal weight percent gets the count of each engine, not a pooled count that would read as another rate
    const [, , , mention] = within(rowOf(table, 'Question number 1?')).getAllByRole('gridcell');
    expect(mention).toHaveAccessibleDescription(
      'ChatGPT 6 of 8 and Gemini 2 of 8 Equal weight average of ChatGPT and Gemini, each engine counting once',
    );
    expect(order(table)).toEqual(['Question number 2?', 'Question number 1?', 'Question number 3?']);
    expect(within(table).getByRole('columnheader', { name: /^Mention rate/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('sorts by a header on click, with the rows without a rate last either way, and keeps the sort in the address', async () => {
    serveRates();
    const writes: string[] = [];
    const { user } = renderOnPrompts(promptsAs('viewer'), {
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    const table = await grid();
    await within(table).findByText('Question number 1?');
    await user.click(within(table).getByRole('button', { name: /^Mention rate\d?$/ }));
    expect(order(table)).toEqual(['Question number 1?', 'Question number 2?', 'Question number 3?']);
    expect(new URLSearchParams(writes.at(-1)).get('sort')).toBe('mention');
    await user.click(within(table).getByRole('button', { name: 'ChatGPT mention' }));
    expect(order(table)).toEqual(['Question number 1?', 'Question number 2?', 'Question number 3?']);
    expect(new URLSearchParams(writes.at(-1)).get('sort')).toBe('-chatgpt_web_rate');
    await user.click(within(table).getByRole('button', { name: 'Gemini mention' }));
    expect(order(table)).toEqual(['Question number 2?', 'Question number 1?', 'Question number 3?']);
  });

  it('shows Mention, Citation or Share of voice in the engine columns, and keeps the counts in the column chooser', async () => {
    serveRates();
    const writes: string[] = [];
    const { user } = renderOnPrompts(promptsAs('viewer'), {
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    const table = await grid();
    await within(table).findByText('Question number 1?');
    const metric = screen.getByRole('combobox', { name: 'Metric of the engine columns' });
    await user.click(metric);
    await user.click(await screen.findByRole('option', { name: 'Citation' }));
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent)
        .slice(-3, -1),
    ).toEqual(['ChatGPT citation', 'Gemini citation']);
    expect(cellsOf(table, 'Question number 1?').slice(-2)).toEqual(['50% 4 of 8', '88% 7 of 8']);
    expect(new URLSearchParams(writes.at(-1)).get('metric')).toBe('citation');
    await user.click(screen.getByRole('combobox', { name: 'Metric of the engine columns' }));
    await user.click(await screen.findByRole('option', { name: 'Share of voice' }));
    // Share of voice is a share of the answers that name a brand, not a count of answers that do
    expect(cellsOf(table, 'Question number 1?').slice(-2)).toEqual(['50% 6 answers', 'n/a']);
    expect(new URLSearchParams(writes.at(-1)).get('metric')).toBe('sov');
    // Three answers that name a brand are too few for a share, and the tip says so in those words
    expect(within(rowOf(table, 'Question number 2?')).getAllByRole('gridcell').at(-3)).toHaveAccessibleDescription(
      'Too few answers that name a brand for a share: 3 of the 4 it needs.',
    );
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    expect(await screen.findByRole('checkbox', { name: 'ChatGPT mentioned' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Gemini cited' })).not.toBeChecked();
  });

  it('adds Mention rate, Citation rate and Top engine to the Topics tab, which opens on the highest Mention rate', async () => {
    serveRates();
    const writes: string[] = [];
    const { user } = renderWithProviders(promptsAs('viewer'), {
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    const tree = await screen.findByRole('treegrid', { name: 'Topics' });
    await within(tree).findByText('SEO');
    expect(
      within(tree)
        .getAllByRole('columnheader')
        // The first header holds the checkbox that selects every row, the last is the menus' column
        .slice(1, -1)
        .map((header) => header.textContent),
    ).toEqual([
      'Topic',
      'Prompts',
      'Mention rate',
      'Citation rate',
      'Top engine',
      'Trend',
      'ChatGPT mentioned',
      'ChatGPT cited',
      'Gemini mentioned',
      'Gemini cited',
    ]);
    // Each prompt counts once in a topic's rate; the counts are the answers behind it
    expect(cellsOf(tree, 'SEO')).toEqual([
      '2',
      '53% avg of 2',
      '47% avg of 2',
      'ChatGPT',
      '',
      '9 of 16',
      '4 of 16',
      '5 of 12',
      '9 of 12',
    ]);
    expect(cellsOf(tree, 'Paid search')).toEqual([
      '1',
      '2 answers',
      '2 answers',
      'n/a',
      '',
      '1 of 2',
      '0 of 2',
      'No answers',
      'No answers',
    ]);
    // A pointer to the engine, with the rate of each engine in its tooltip
    expect(within(rowOf(tree, 'SEO')).getByText('ChatGPT').closest('[role="gridcell"]')).toHaveAccessibleDescription(
      /ChatGPT 56% and Gemini 50%/,
    );
    expect(order(tree)).toEqual(['SEO', 'Paid search']);
    await user.click(within(tree).getByRole('button', { name: 'Prompts' }));
    await user.click(within(tree).getByRole('button', { name: 'Prompts' }));
    expect(order(tree)).toEqual(['Paid search', 'SEO']);
    expect(new URLSearchParams(writes.at(-1)).get('sort')).toBe('prompts');
  });

  describe('on three topics of other rates and top engines', () => {
    /** Alpha: ChatGPT 75%, Gemini 50%. Beta: ChatGPT 25%, Gemini 75%. Gamma: too few answers on either engine. */
    const serveTopics = (): void => {
      serveRates();
      const topicOf = (index: number, name: string, chatgpt: Counts, gemini: Counts): object => ({
        term_id: idOf(3, index),
        name,
        prompt_count: 1,
        engines: [topicCells('chatgpt_web', [chatgpt]), topicCells('gemini_web', [gemini])],
      });
      serveVocabulary(['Alpha', 'Beta', 'Gamma'].map((name, index) => treeNode(idOf(3, index + 1), name, null, [])));
      server.use(
        http.get(SUMMARY_PATH, () =>
          HttpResponse.json({
            data: {
              ...EMPTY_SUMMARY.data,
              engine_codes: ['chatgpt_web', 'gemini_web'],
              prompts: [],
              topics: [
                topicOf(1, 'Alpha', counted(8, 6), counted(8, 4)),
                topicOf(2, 'Beta', counted(8, 2), counted(8, 6)),
                topicOf(3, 'Gamma', counted(2, 1), counted(2, 2)),
              ],
            },
          }),
        ),
      );
    };
    const topicNames = (tree: HTMLElement): string[] => order(tree);

    it('sorts by Top engine A to Z and back, a topic without one last either way', async () => {
      serveTopics();
      const { user } = renderWithProviders(promptsAs('viewer'));
      const tree = await screen.findByRole('treegrid', { name: 'Topics' });
      await within(tree).findByText('Alpha');
      await user.click(within(tree).getByRole('button', { name: 'Top engine' }));
      expect(topicNames(tree)).toEqual(['Alpha', 'Beta', 'Gamma']);
      await user.click(within(tree).getByRole('button', { name: 'Top engine' }));
      expect(topicNames(tree)).toEqual(['Beta', 'Alpha', 'Gamma']);
    });

    it('puts a topic whose rates are too few last on Mention rate in both directions', async () => {
      serveTopics();
      const { user } = renderWithProviders(promptsAs('viewer'));
      const tree = await screen.findByRole('treegrid', { name: 'Topics' });
      await within(tree).findByText('Alpha');
      expect(cellsOf(tree, 'Gamma').slice(1, 4)).toEqual(['2 answers', '2 answers', 'n/a']);
      expect(topicNames(tree)).toEqual(['Alpha', 'Beta', 'Gamma']);
      await user.click(within(tree).getByRole('button', { name: 'Mention rate' }));
      expect(topicNames(tree)).toEqual(['Beta', 'Alpha', 'Gamma']);
    });

    it('ignores a sort id of the Prompts tab, such as the topic column, and opens on the Mention rate order', async () => {
      serveTopics();
      renderWithProviders(promptsAs('viewer'), { searchParams: '?sort=-topic' });
      const tree = await screen.findByRole('treegrid', { name: 'Topics' });
      await within(tree).findByText('Alpha');
      expect(within(tree).getByRole('columnheader', { name: /^Mention rate/ })).toHaveAttribute(
        'aria-sort',
        'descending',
      );
      expect(topicNames(tree)).toEqual(['Alpha', 'Beta', 'Gamma']);
    });
  });
});

describe('Topics & Prompts: the compact header and the country in the top bar', () => {
  const treegrid = (): Promise<HTMLElement> => screen.findByRole('treegrid', { name: 'Topics' });
  const topicNames = async (): Promise<string[]> =>
    (await within(await treegrid()).findAllByRole('rowheader')).map(
      (cell) => cell.getAttribute('aria-label') ?? cell.textContent ?? '',
    );
  const countryControl = (name = 'Country: All countries'): Promise<HTMLElement> =>
    screen.findByRole('combobox', { name });
  /** One prompt with an answer read at `observed`, on the ChatGPT engine. */
  const serveObserved = (observed: string | null): void =>
    server.use(
      http.get(SUMMARY_PATH, () =>
        HttpResponse.json({
          data: {
            ...EMPTY_SUMMARY.data,
            prompts: [
              {
                prompt_id: idOf(1, 1),
                text: 'Question number 1?',
                is_branded: false,
                topic_term_ids: [],
                last_observed_at: observed,
                last_valid_at: observed,
                engines: [promptCells('chatgpt_web', NO_COUNTS)],
              },
            ],
          },
        }),
      ),
    );

  it('puts the country in the top bar beside the date range, with all countries and the countries of the prompts', async () => {
    const { user } = renderWithProviders(withTopBar(promptsAs('viewer')));
    await treegrid();
    expect(await countryControl()).toBeInTheDocument();
    expect(screen.getAllByRole('combobox', { name: /^Country:/ })).toHaveLength(1);
    expect(await rangeTrigger()).toBeInTheDocument();
    await user.click(await countryControl());
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'All countries',
      'Germany',
      'India',
    ]);
  });

  it('narrows the strip, the topics and the prompts to the country chosen there, and asks the summary for it', async () => {
    const asked: (string | null)[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/ai/prompts-summary')) asked.push(url.searchParams.get('filter[country_iso]'));
    });
    const writes: string[] = [];
    const { user } = renderWithProviders(withTopBar(promptsAs('viewer')), {
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    expect(await topicNames()).toEqual(['No topic', 'Content Marketing', 'SEO', 'Paid Search']);
    const strip = await screen.findByRole('group', { name: 'Summary of the prompts in view' });
    await vi.waitFor(() => expect(strip).not.toHaveAttribute('aria-busy'));
    expect(within(strip).getAllByRole('definition')[0]).not.toHaveTextContent(/^1$/);
    await user.click(await countryControl());
    await user.click(await screen.findByRole('option', { name: 'India' }));
    // The Hindi prompt is the only one in India, and it is given SEO
    await vi.waitFor(async () => expect(await topicNames()).toEqual(['SEO']));
    await vi.waitFor(() => expect(within(strip).getAllByRole('definition')[0]).toHaveTextContent(/^1$/));
    expect(new URLSearchParams(writes.at(-1)).get('country')).toBe('IN');
    expect(asked).toContain('IN');
    expect(await countryControl('Country: India')).toBeInTheDocument();
    // The Prompts tab keeps to the same country
    await user.click(screen.getByRole('radio', { name: 'Prompts' }));
    await vi.waitFor(async () => expect(within(await grid()).getAllByRole('row')).toHaveLength(2));
    // All countries clears the key from the address
    await user.click(await countryControl('Country: India'));
    await user.click(await screen.findByRole('option', { name: 'All countries' }));
    await vi.waitFor(() => expect(new URLSearchParams(writes.at(-1)).has('country')).toBe(false));
    server.events.removeAllListeners();
  });

  it('keeps the country of a link that the prompts do not have, so the person can leave it for all countries', async () => {
    renderWithProviders(withTopBar(promptsAs('viewer')), { searchParams: '?country=ZZ' });
    expect(await countryControl('Country: ZZ')).toBeInTheDocument();
  });

  it('names a country that matches nothing in the empty state, and Clear filters leaves it for all countries', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'), { searchParams: '?country=ZZ' });
    const heading = await screen.findByRole('heading', { name: NO_MATCH_TITLE });
    const empty = heading.parentElement as HTMLElement;
    expect(within(empty).getByText('Country: ZZ')).toBeInTheDocument();
    await user.click(within(empty).getByRole('button', { name: 'Clear filters' }));
    expect(await topicNames()).toContain('SEO');
    expect(screen.queryByRole('heading', { name: NO_MATCH_TITLE })).toBeNull();
  });

  it('is a label, not a choice, when every prompt is in one country and all of them are shown', async () => {
    server.use(
      http.get(LIST_PATH, () => HttpResponse.json(pageOf([promptOf(1), promptOf(2)], null))),
      http.get(SUMMARY_PATH, () => HttpResponse.json(EMPTY_SUMMARY)),
    );
    renderWithProviders(withTopBar(promptsAs('viewer')));
    await screen.findByRole('radiogroup', { name: 'Topics and prompts' });
    expect(screen.queryByRole('combobox', { name: /^Country:/ })).toBeNull();
    expect(screen.getByText('Country: All countries')).toBeInTheDocument();
  });

  it('has no Country chip: the filter bar offers the topic, the engine and the branded prompts', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'), { searchParams: '?country=IN' });
    await treegrid();
    expect(within(screen.getByRole('group', { name: 'Filters' })).queryByText(/^Country/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add a filter' }));
    const fields = await screen.findAllByRole('button', { name: /^(Topic|Country|Engine|Branded prompts)$/ });
    expect(fields.map((field) => field.textContent)).toEqual(['Topic', 'Engine', 'Branded prompts']);
  });

  it('has no row of chips under the toolbar until a filter is set, and the Filter button is in the toolbar', async () => {
    const first = renderWithProviders(promptsAs('viewer'));
    await treegrid();
    const bar = screen.getByRole('group', { name: 'Filters' });
    expect(
      within(bar)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Filter']);
    first.unmount();
    renderWithProviders(promptsAs('viewer'), { searchParams: '?engine=gemini_web' });
    await treegrid();
    expect(
      within(screen.getByRole('group', { name: 'Filters' })).getByRole('button', {
        name: /^Engine: .*\. Edit filter$/,
      }),
    ).toBeInTheDocument();
  });

  it('says when the answers were last read, from the newest of the summary, with the window in its tooltip', async () => {
    serveObserved('2026-11-12T10:00:00Z');
    const { user } = renderWithProviders(promptsAs('viewer'));
    const updated = await screen.findByText('Updated 2h ago');
    expect(updated).toBeVisible();
    await user.hover(updated);
    expect(
      await screen.findByText('Answers from Oct 16 to Nov 12, 2026', { selector: '[data-slot="tooltip"] span' }),
    ).toBeInTheDocument();
  });

  it('leaves the Updated text out when no answer has been read', async () => {
    serveObserved(null);
    renderWithProviders(promptsAs('viewer'));
    await treegrid();
    expect(screen.queryByText(/^Updated /)).toBeNull();
  });

  it('has a More actions menu with Copy link, which copies the address and says so', async () => {
    serveObserved('2026-11-12T10:00:00Z');
    const { user } = renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts&country=DE' });
    await grid();
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    // The menu keeps the facts the toolbar leaves out on a narrow window
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Updated 2h ago')).toBeInTheDocument();
    expect(within(menu).getByText('Answers from Oct 16 to Nov 12, 2026')).toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: 'Copy link' }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(window.location.href));
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('gives an editor Add prompts as the primary action after the menu, whose label a narrow window hides but keeps', async () => {
    renderWithProviders(promptsAs('editor'));
    await treegrid();
    const add = await screen.findByRole('button', { name: 'Add prompts' });
    expect(add).toHaveTextContent('Add prompts');
    expect(within(add).getByText('Add prompts')).toHaveClass('sr-only', 'sm:not-sr-only');
    const more = screen.getByRole('button', { name: 'More actions' });
    expect(more.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the date range of the top bar as 28d below 640 px, with its dates in the name', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    renderWithProviders(withTopBar(promptsAs('viewer')));
    const trigger = await rangeTrigger();
    expect(trigger).toHaveTextContent('28d');
    expect(trigger).toHaveAccessibleName(`${RANGE_NAME} Last 28 days (28d), Oct 16 to Nov 12, 2026`);
  });

  it('ends a long topic badge in an ellipsis inside its cell, with the whole name in the cell tooltip and no native title', async () => {
    const long = 'A topic with a very long name that does not fit its column';
    server.use(
      http.get(LIST_PATH, () =>
        HttpResponse.json(
          pageOf(
            [
              {
                ...promptOf(1),
                terms: [{ term_id: idOf(3, 1), name: long, path: 'long', vocabulary_kind: 'topic' }],
              },
            ],
            null,
          ),
        ),
      ),
    );
    renderOnPrompts(promptsAs('viewer'));
    const badge = await within(await grid()).findByText(long);
    expect(badge).toHaveClass('truncate', 'min-w-0');
    expect(badge).toHaveAttribute('data-truncate');
    expect(badge).not.toHaveAttribute('title');
    // The cell is the keyboard's stop, and its tooltip holds the whole name
    expect(badge.closest('[role="gridcell"]')).toHaveAccessibleDescription(long);
  });

  it('passes the accessibility checks with the header, the switch and the top bar', async () => {
    serveObserved('2026-11-12T10:00:00Z');
    const { container } = renderWithProviders(withTopBar(promptsAs('editor')));
    await treegrid();
    expect(await axe(container)).toHaveNoViolations();
  });
});
