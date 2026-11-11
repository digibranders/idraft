import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enginesKey } from './prompt-queries';
import { PromptsScreen, type PromptsProject } from './prompts-screen';
import { TopBarSlotProvider, TopBarSlotTarget } from '@/components/app/shell/top-bar-slot';
import type { Prompt, Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { MOCK_TERM_IDS } from '@/mocks/entity-fixtures';
import { NO_COUNTS, promptCells, type Counts } from '@/mocks/prompt-summary';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

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

describe('Topics & Prompts', () => {
  it('lists the active prompts with their topic and country, and the window in the top bar', async () => {
    const { container } = renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts' });
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
    renderWithProviders(promptsAs('editor', asProject(cleanstart, 'US')));
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
    renderWithProviders(promptsAs('viewer'));
    expect(
      await screen.findByText(
        'No data yet. Each prompt is asked twice a week, on Monday and Thursday, and its first answers arrive after the next run.',
      ),
    ).toBeInTheDocument();
  });

  it('offers a retry when the prompts do not load', async () => {
    server.use(http.get(mswPath(`${P}/prompts`), () => HttpResponse.json({ code: 'boom' }, { status: 500 })));
    renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts' });
    expect(await screen.findByText('The prompts could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says so to a member who cannot read the data', async () => {
    renderWithProviders(promptsAs('billing'));
    expect(
      await screen.findByRole('heading', { name: 'You cannot see the prompts of this project' }),
    ).toBeInTheDocument();
  });

  it('gives an editor Add prompts, which opens the dialog', async () => {
    const { user } = renderWithProviders(promptsAs('editor'), { searchParams: '?tab=prompts' });
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
    const { user } = renderWithProviders(promptsAs('editor'));
    expect(await screen.findByRole('heading', { name: 'No prompts yet' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add prompts' }));
    expect(await screen.findByRole('dialog', { name: 'Add prompts' })).toBeInTheDocument();
  });

  it('does not offer Add prompts to a viewer', async () => {
    renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts' });
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
    renderWithProviders(promptsAs('viewer'));
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
    const { user } = renderWithProviders(promptsAs('viewer'));
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
    renderWithProviders(promptsAs('viewer'));
    expect(await screen.findByText('The engines of this project could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('keeps the page when a later read of the engines fails', async () => {
    const { queryClient } = renderWithProviders(promptsAs('viewer'));
    await grid();
    server.use(http.get(ENGINES_PATH, () => HttpResponse.json({ code: 'boom' }, { status: 500 })));
    await queryClient.refetchQueries({
      queryKey: enginesKey({ workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynixProject.id }),
    });
    expect(screen.queryByText('The engines of this project could not be loaded.')).toBeNull();
    expect(await grid()).toBeInTheDocument();
  });

  it('says no prompt matches a search that finds none', async () => {
    renderWithProviders(promptsAs('viewer'), { searchParams: '?q=zzzznothing' });
    expect(await screen.findByRole('heading', { name: NO_MATCH_TITLE })).toBeInTheDocument();
  });

  it('says there are no prompts yet when every prompt of the project is branded', async () => {
    server.use(
      http.get(LIST_PATH, () => HttpResponse.json(pageOf([promptOf(1, true), promptOf(2, true)], null))),
      http.get(SUMMARY_PATH, () => HttpResponse.json(EMPTY_SUMMARY)),
    );
    renderWithProviders(promptsAs('editor'));
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
    renderWithProviders(promptsAs('viewer'), { searchParams: '?window=7' });
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
    const { user } = renderWithProviders(withTopBar(promptsAs('viewer')));
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
    renderWithProviders(promptsAs('editor'));
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
    renderWithProviders(promptsAs('editor'));
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
    renderWithProviders(promptsAs('viewer'));
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
    const { user } = renderWithProviders(promptsAs('viewer'));
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
    renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts' });
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
  });

  it('leaves branded prompts out until the Branded filter includes them, and asks the summary the same', async () => {
    const asked: string[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/ai/prompts-summary')) asked.push(url.searchParams.get('include_branded') ?? '');
    });
    const first = renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts' });
    await within(await grid()).findByText(FIRST_TEXT);
    expect(within(await grid()).queryByText(BRANDED_TEXT)).toBeNull();
    first.unmount();
    renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts&branded=include' });
    const table = await grid();
    expect(await within(table).findByText(BRANDED_TEXT)).toBeInTheDocument();
    expect(within(table).getByText('Branded')).toBeInTheDocument();
    expect(asked).toContain('false');
    expect(asked).toContain('true');
    server.events.removeAllListeners();
  });

  it('filters by topic and country from the URL, and sorts by an engine column', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'), {
      searchParams: `?tab=prompts&topic=${encodeURIComponent(MOCK_TERM_IDS.technicalSeo)}&country=DE`,
    });
    const table = await grid();
    expect(await within(table).findByText('How do I run a technical SEO audit on a large site?')).toBeInTheDocument();
    expect(within(table).queryByText('Which tools track local rankings by city?')).toBeNull();
    expect(within(table).queryByText(FIRST_TEXT)).toBeNull();
    await user.click(within(table).getByRole('button', { name: 'ChatGPT mentioned' }));
    expect(within(table).getByRole('columnheader', { name: /^ChatGPT mentioned/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('shows only the engines the Engine filter names', async () => {
    renderWithProviders(promptsAs('viewer'), { searchParams: '?tab=prompts&engine=gemini_web' });
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
    const { user } = renderWithProviders(promptsAs('viewer'), {
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
    renderWithProviders(promptsAs('viewer'), { searchParams: '?engine=google_ai_mode' });
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
    /** Prompt 1 ChatGPT 1 of 4, prompt 2 2 of 4, prompt 3 1 of 10, prompt 4 no answer, prompt 5 two answers, none valid. */
    const CHATGPT: readonly Counts[] = [counted(4, 1), counted(4, 2), counted(10, 1), NO_COUNTS, counted(0, 0, 2)];
    const SUMMARY = {
      data: {
        ...EMPTY_SUMMARY.data,
        engine_codes: [...ENGINES],
        prompts: CHATGPT.map((counts, index) => ({
          prompt_id: idOf(1, index + 1),
          text: `Question number ${String(index + 1)}?`,
          is_branded: false,
          topic_term_ids: [],
          engines: [promptCells('chatgpt_web', counts), promptCells('gemini_web', NO_COUNTS)],
        })),
      },
    };
    const serve = (): void =>
      server.use(
        http.get(LIST_PATH, () =>
          HttpResponse.json(
            pageOf(
              CHATGPT.map((_, index) => promptOf(index + 1)),
              null,
            ),
          ),
        ),
        http.get(SUMMARY_PATH, () => HttpResponse.json(SUMMARY)),
      );
    const order = async (): Promise<string[]> => {
      const table = await grid();
      await within(table).findByText('Question number 1?');
      return within(table)
        .getAllByText(/^Question number \d\?$/)
        .map((node) => node.textContent ?? '');
    };

    it('reads a rate by its value, not its text, with no answers last either way', async () => {
      serve();
      const up = renderWithProviders(promptsAs('viewer'), { searchParams: '?sort=chatgpt_web_mentioned' });
      expect(await order()).toEqual([
        'Question number 3?',
        'Question number 1?',
        'Question number 2?',
        'Question number 4?',
        'Question number 5?',
      ]);
      up.unmount();
      renderWithProviders(promptsAs('viewer'), { searchParams: '?sort=-chatgpt_web_mentioned' });
      expect(await order()).toEqual([
        'Question number 2?',
        'Question number 1?',
        'Question number 3?',
        'Question number 4?',
        'Question number 5?',
      ]);
    });

    it('shows the count, and says why a cell has none: no answer, or none valid', async () => {
      serve();
      renderWithProviders(promptsAs('viewer'));
      const table = await grid();
      expect(await within(table).findByText('1 of 4')).toBeInTheDocument();
      expect(within(table).getByText('2 of 4')).toBeInTheDocument();
      expect(within(table).getByText('1 of 10')).toBeInTheDocument();
      // Prompt 4 has no answer on ChatGPT, nor have any on Gemini; prompt 5's two answers are all invalid
      expect(within(table).getAllByText('No answers').length).toBeGreaterThanOrEqual(2);
      expect(within(table).getAllByText('n/a').length).toBeGreaterThanOrEqual(1);
      expect(within(table).queryByText(/^0 of 0$/)).toBeNull();
    });
  });
});
