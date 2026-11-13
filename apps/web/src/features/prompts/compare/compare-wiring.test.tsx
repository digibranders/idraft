import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptsScreen, type PromptsProject } from '@/features/prompts/prompts-screen';
import type { EngineSummary, Prompt, Schemas } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { NO_COUNTS, promptCells, topicCells, type Counts } from '@/mocks/prompt-summary';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender, type ProvidedRenderOptions } from '@/test/render';
// A topic drawer reads the entities and the tracked keywords: the harness answers both with none
import '@/test/topic-drawer-harness';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(''),
}));

/** Thursday 12 November 2026, noon UTC. */
const NOW = new Date('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const SUMMARY_PATH = mswPath(`${P}/ai/prompts-summary`);
const LIST_PATH = mswPath(`${P}/prompts`);
const PREVIOUS_WINDOW = { from: '2026-09-18', to: '2026-10-15', timezone: 'Europe/Berlin' };

const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixture projects are missing');
const asProject = (project: (typeof MOCK_PROJECTS)[number]): PromptsProject => ({
  id: project.project_id,
  slug: project.slug,
  name: project.name,
  timeZone: project.timezone,
  defaultLanguage: 'en',
  defaultCountryIso: 'DE',
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
});

function screenFor(project: PromptsProject): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory('viewer')}>
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

interface Wrote {
  queryString: string;
  history: string | undefined;
}

const FYNIX = asProject(fynix);
const CLEANSTART = asProject(cleanstart);

function render(searchParams: string, project = FYNIX): ProvidedRender & { writes: Wrote[] } {
  const writes: Wrote[] = [];
  const options: ProvidedRenderOptions = {
    searchParams,
    onUrlUpdate: ({ queryString, options: update }) => writes.push({ queryString, history: update.history }),
  };
  return { ...renderWithProviders(screenFor(project), options), writes };
}

const idOf = (kind: number, index: number): string =>
  `${String(kind).repeat(8)}-0000-4000-8000-${String(index).padStart(12, '0')}`;
const promptOf = (index: number): Prompt => ({
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
  is_branded: false,
  is_branded_source: 'computed',
  language_code: 'en',
  prompt_type: 'question',
  prompt_type_source: 'rule',
  source: 'manual',
  terms: [],
  updated_at: NOW.toISOString(),
});

const counted = (valid: number, mentioned: number): Counts => ({
  ...NO_COUNTS,
  n_valid: valid,
  n_observations: valid,
  mentioned,
});

/** Three prompts on one engine: 30 of 60 against 12 of 60 (detectable), 31 of 60 against 27 of 60 (within), no previous. */
const NOW_COUNTS = [counted(60, 30), counted(60, 31), counted(60, 20)];
const BEFORE_COUNTS = [counted(60, 12), counted(60, 27), null];
const ENGINE = 'chatgpt_web';

const withPrevious = (now: EngineSummary, before: EngineSummary | null): EngineSummary => ({
  ...now,
  previous:
    before === null
      ? null
      : {
          mentioned: before.mentioned,
          cited: before.cited,
          share_of_voice: before.share_of_voice,
          outcomes: before.outcomes,
        },
});

/** The answer of the summary: with `previous` and the window only for a read that asked to compare. */
function summaryAnswer(compared: boolean, only: readonly number[] = [0, 1, 2]): { data: Schemas['PromptsSummary'] } {
  const prompt = (index: number): object => {
    const before = BEFORE_COUNTS[index];
    return {
      prompt_id: idOf(1, index + 1),
      text: `Question number ${String(index + 1)}?`,
      is_branded: false,
      topic_term_ids: [],
      engines: [
        compared
          ? withPrevious(
              promptCells(ENGINE, NOW_COUNTS[index] ?? NO_COUNTS),
              before === null || before === undefined ? null : promptCells(ENGINE, before),
            )
          : promptCells(ENGINE, NOW_COUNTS[index] ?? NO_COUNTS),
      ],
    };
  };
  const topic = (termId: string, name: string, indexes: number[]): object => ({
    term_id: termId,
    name,
    prompt_count: indexes.length,
    engines: [
      compared
        ? withPrevious(
            topicCells(
              ENGINE,
              indexes.map((index) => NOW_COUNTS[index] ?? NO_COUNTS),
            ),
            indexes.every((index) => BEFORE_COUNTS[index] !== null)
              ? topicCells(
                  ENGINE,
                  indexes.map((index) => BEFORE_COUNTS[index] ?? NO_COUNTS),
                )
              : null,
          )
        : topicCells(
            ENGINE,
            indexes.map((index) => NOW_COUNTS[index] ?? NO_COUNTS),
          ),
    ],
  });
  return {
    data: {
      window: { from: '2026-10-16', to: '2026-11-12', timezone: 'Europe/Berlin' },
      include_branded: false,
      engine_codes: [ENGINE],
      prompts: only.map(prompt),
      topics: [
        topic(idOf(5, 1), 'Detectable topic', [0]),
        topic(idOf(5, 2), 'Quiet topic', [1]),
        topic(idOf(5, 3), 'New topic', [2]),
      ],
      ...(compared ? { compare_window: PREVIOUS_WINDOW, previous_answers: 180 } : {}),
    } as unknown as Schemas['PromptsSummary'],
  };
}

/** Serves the three prompts and the summary; `asked` collects the query of each summary read. */
function serve(asked: URL[] = []): void {
  server.use(
    http.get(LIST_PATH, () =>
      HttpResponse.json({
        data: [promptOf(1), promptOf(2), promptOf(3)],
        page: { has_more: false, next_cursor: null },
      }),
    ),
    http.get(SUMMARY_PATH, ({ request }) => {
      const url = new URL(request.url);
      asked.push(url);
      return HttpResponse.json(summaryAnswer(url.searchParams.get('compare') === 'previous_period'));
    }),
  );
}

const grid = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Prompts' });
const treegrid = (): Promise<HTMLElement> => screen.findByRole('treegrid', { name: 'Topics' });
const promptTexts = (table: HTMLElement): string[] =>
  within(table)
    .queryAllByText(/^Question number \d\?$/)
    .map((node) => node.textContent ?? '');
const stripPromptCount = async (): Promise<string | null> => {
  const strip = await screen.findByRole('group', { name: 'Summary of the prompts in view' });
  await waitFor(() => expect(strip).not.toHaveAttribute('aria-busy'));
  return (
    within(strip)
      .getAllByRole('definition')
      .map((node) => node.textContent)[0] ?? null
  );
};

const chooseDetectable = async (user: ProvidedRender['user']): Promise<void> => {
  await user.click(screen.getByRole('button', { name: 'Add a filter' }));
  await user.click(await screen.findByRole('button', { name: 'Show' }));
  await user.click(await screen.findByRole('radio', { name: 'Detectable changes only' }));
};

describe('Topics & Prompts: compare, the read and the address', () => {
  it('asks the summary for the previous period by default', async () => {
    const asked: URL[] = [];
    serve(asked);
    render('?tab=prompts');
    await grid();
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(asked.every((url) => url.searchParams.get('compare') === 'previous_period')).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Compare with' })).toHaveTextContent('vs previous period');
  });

  it('asks without compare for cmp=off and the select says No comparison', async () => {
    const asked: URL[] = [];
    serve(asked);
    render('?tab=prompts&cmp=off');
    await grid();
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(asked.some((url) => url.searchParams.has('compare'))).toBe(false);
    expect(screen.getByRole('combobox', { name: 'Compare with' })).toHaveTextContent('No comparison');
  });

  it('names the previous window the response was compared with', async () => {
    serve();
    render('?tab=prompts');
    await grid();
    const trigger = screen.getByRole('combobox', { name: 'Compare with' });
    await waitFor(() => expect(trigger).toHaveAccessibleDescription('Previous period: Sep 18 to Oct 15, 2026'));
  });

  it('names the previous window in the strip chip and in a Mention cell tooltip, and not while comparison is off', async () => {
    serve();
    const tooltip = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="tooltip"]');
    const chipOf = async (): Promise<HTMLElement> => {
      const strip = await screen.findByRole('group', { name: 'Summary of the prompts in view' });
      await waitFor(() => expect(strip).not.toHaveAttribute('aria-busy'));
      const chip = within(strip).getByText('ChatGPT', { selector: 'dt' }).parentElement;
      if (chip === null) throw new Error('The ChatGPT chip is missing');
      return within(chip).getByRole('definition');
    };
    // The Topics tab, whose table builds its columns under the page's provider of the compared window
    const mentionOf = async (): Promise<HTMLElement> => {
      const table = await treegrid();
      const row = (await within(table).findByText('Detectable topic')).closest('[role="row"]');
      if (!(row instanceof HTMLElement)) throw new Error('The first row is missing');
      const mention = within(row)
        .getAllByRole('gridcell')
        .find((node) => node.textContent?.includes('1 engine'));
      if (mention === undefined) throw new Error('The Mention rate cell is missing');
      return mention;
    };

    const on = render('');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Compare with' })).toHaveAccessibleDescription(
        'Previous period: Sep 18 to Oct 15, 2026',
      ),
    );
    await on.user.hover(await chipOf());
    await waitFor(() => expect(tooltip()).toHaveTextContent('Previous period, Sep 18 to Oct 15, 2026'));
    await waitFor(async () =>
      expect(await mentionOf()).toHaveAccessibleDescription(/Previous period: Sep 18 to Oct 15, 2026/),
    );
    on.unmount();

    const off = render('?cmp=off');
    await off.user.hover(await chipOf());
    await waitFor(() => expect(tooltip()).toHaveTextContent('Mentioned'));
    expect(tooltip()?.textContent).not.toMatch(/Previous period/);
    expect(await mentionOf()).not.toHaveAccessibleDescription(/Previous period/);
  });

  it('names the previous window in the Mention cell tooltip of the Prompts tab, and not while comparison is off', async () => {
    serve();
    // The Prompts tab builds its columns in the body of the screen, above the provider of the compared window
    const mentionOf = async (): Promise<HTMLElement> => {
      const table = await grid();
      const row = (await within(table).findByText('Question number 1?')).closest('[role="row"]');
      if (!(row instanceof HTMLElement)) throw new Error('The first prompt row is missing');
      const mention = within(row)
        .getAllByRole('gridcell')
        .find((node) => node.textContent?.includes('1 engine'));
      if (mention === undefined) throw new Error('The Mention rate cell is missing');
      return mention;
    };

    const on = render('?tab=prompts');
    await waitFor(async () =>
      expect(await mentionOf()).toHaveAccessibleDescription(/Previous period: Sep 18 to Oct 15, 2026/),
    );
    on.unmount();

    render('?tab=prompts&cmp=off');
    expect(await mentionOf()).not.toHaveAccessibleDescription(/Previous period/);
  });

  it('writes cmp=off for No comparison with history replace, and reads again without compare', async () => {
    const asked: URL[] = [];
    serve(asked);
    const { user, writes } = render('?tab=prompts');
    await grid();
    await user.click(screen.getByRole('combobox', { name: 'Compare with' }));
    await user.click(await screen.findByRole('option', { name: 'No comparison' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).toContain('cmp=off'));
    expect(writes.at(-1)?.history).toBe('replace');
    await waitFor(() => expect(asked.some((url) => !url.searchParams.has('compare'))).toBe(true));
  });

  it('reads nothing while no engine is on', async () => {
    const asked: URL[] = [];
    server.use(
      http.get(SUMMARY_PATH, ({ request }) => {
        asked.push(new URL(request.url));
        return HttpResponse.json({});
      }),
    );
    const { queryClient } = render('', CLEANSTART);
    expect(await screen.findByRole('heading', { name: 'No AI engine is on' })).toBeInTheDocument();
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(asked).toEqual([]);
  });

  it('surfaces a read that fails after the toggle, keeps the prompts listed and reads again on Try again', async () => {
    serve();
    let failing = false;
    server.use(
      http.get(SUMMARY_PATH, ({ request }) => {
        const url = new URL(request.url);
        if (failing && !url.searchParams.has('compare')) return HttpResponse.json({ code: 'boom' }, { status: 500 });
        return HttpResponse.json(summaryAnswer(url.searchParams.get('compare') === 'previous_period'));
      }),
    );
    const { user } = render('?tab=prompts');
    const table = await grid();
    await within(table).findByText('Question number 1?');
    failing = true;
    await user.click(screen.getByRole('combobox', { name: 'Compare with' }));
    await user.click(await screen.findByRole('option', { name: 'No comparison' }));
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(
      screen.getByText('The answer counts could not be loaded. The prompts are listed without them.'),
    ).toBeInTheDocument();
    expect(promptTexts(await grid())).toHaveLength(3);
    failing = false;
    await user.click(retry);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull());
  });
});

describe('Topics & Prompts: the change column of an engine', () => {
  it('waits in the column chooser, off by default, and shows its change once chosen', async () => {
    serve();
    const { user } = render('?tab=prompts');
    const table = await grid();
    expect(within(table).queryByRole('columnheader', { name: /ChatGPT change/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    const choice = screen.getByRole('checkbox', { name: 'ChatGPT change' });
    expect(choice).not.toBeChecked();
    await user.click(choice);
    expect(within(table).getByRole('columnheader', { name: /ChatGPT change/ })).toBeInTheDocument();
    const row = (await within(table).findByText('Question number 1?')).closest('[role="row"]');
    if (!(row instanceof HTMLElement)) throw new Error('The first prompt row is missing');
    // The Mention rate cell and the new column both show this prompt's rise of 30 points on ChatGPT
    expect(within(row).getAllByText('+30.0 pts')).toHaveLength(2);
  });

  it('gives its tip to the focused cell of the table and adds no tab stop inside it', async () => {
    serve();
    render('?tab=prompts&cols=prompt,mention,change_chatgpt_web');
    const table = await grid();
    expect(await within(table).findByRole('columnheader', { name: /ChatGPT change/ })).toBeInTheDocument();
    const row = (await within(table).findByText('Question number 1?')).closest('[role="row"]');
    if (!(row instanceof HTMLElement)) throw new Error('The first prompt row is missing');
    // The Mention rate cell says "1 engine"; the change column is the other cell with this prompt's 30 points
    const changeCell = (): HTMLElement | undefined =>
      within(row)
        .getAllByRole('gridcell')
        .find((node) => node.textContent?.includes('30.0 pts') && !node.textContent.includes('engine'));
    await waitFor(() => expect(changeCell()).toBeDefined());
    const cell = changeCell();
    if (cell === undefined) throw new Error('The change cell is missing');
    expect(cell).toHaveAccessibleDescription(/Previous 20%, 12 of 60 answers.*Previous period: Sep 18 to Oct 15, 2026/);
    expect(cell).toHaveAccessibleDescription(/Detectable change/);
    expect(cell.querySelectorAll('[tabindex]')).toHaveLength(0);
  });

  it('can be shown from the address, and says Comparison is off with cmp=off', async () => {
    serve();
    const on = render('?tab=prompts&cols=prompt,mention,change_chatgpt_web');
    const table = await grid();
    // The engines load after the table: the column appears with them
    expect(await within(table).findByRole('columnheader', { name: /ChatGPT change/ })).toBeInTheDocument();
    await waitFor(() => expect(within(table).getAllByText('+30.0 pts').length).toBeGreaterThan(0));
    on.unmount();

    render('?tab=prompts&cmp=off&cols=prompt,mention,change_chatgpt_web');
    const off = await grid();
    expect(await within(off).findByRole('columnheader', { name: /ChatGPT change/ })).toBeInTheDocument();
    await waitFor(() => expect(within(off).getAllByText('n/a').length).toBeGreaterThan(0));
    expect(within(off).queryByText('+30.0 pts')).toBeNull();
  });
});

describe('Topics & Prompts: the Detectable changes only chip', () => {
  it('is in the address as detectable=only and narrows the Prompts rows and the strip', async () => {
    serve();
    const { user, writes } = render('?tab=prompts');
    const table = await grid();
    await waitFor(() => expect(promptTexts(table)).toHaveLength(3));
    expect(await stripPromptCount()).toBe('3');
    await chooseDetectable(user);
    await waitFor(() => expect(writes.at(-1)?.queryString).toContain('detectable=only'));
    expect(writes.at(-1)?.history).toBe('replace');
    await waitFor(() => expect(promptTexts(table)).toEqual(['Question number 1?']));
    expect(await stripPromptCount()).toBe('1');
    expect(screen.getByRole('button', { name: /^Show: Detectable changes only/ })).toBeInTheDocument();
  });

  it('narrows the Topics rows to the topics whose change is detectable', async () => {
    serve();
    render('?detectable=only');
    const tree = await treegrid();
    expect(await within(tree).findByText('Detectable topic')).toBeInTheDocument();
    await waitFor(() => expect(within(tree).queryByText('Quiet topic')).toBeNull());
    expect(within(tree).queryByText('New topic')).toBeNull();
  });

  it('narrows the Heat map too', async () => {
    serve();
    render('?detectable=only&view=heatmap');
    expect(await screen.findByText('Detectable topic')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Quiet topic')).toBeNull());
  });

  it('leaves no row with comparison off, says why, and Compare with previous period brings the rows back', async () => {
    serve();
    const { user, writes } = render('?tab=prompts&detectable=only&cmp=off');
    expect(await screen.findByRole('heading', { name: 'No comparison to read changes from' })).toBeInTheDocument();
    expect(screen.queryByText('Question number 1?')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Compare with previous period' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).not.toContain('cmp'));
    expect(await screen.findByText('Question number 1?')).toBeInTheDocument();
    expect(screen.queryByText('Question number 2?')).toBeNull();
  });

  it('says how many rows were compared when none changed by more than normal variation', async () => {
    server.use(
      http.get(LIST_PATH, () =>
        HttpResponse.json({ data: [promptOf(2)], page: { has_more: false, next_cursor: null } }),
      ),
      http.get(SUMMARY_PATH, ({ request }) =>
        HttpResponse.json(summaryAnswer(new URL(request.url).searchParams.get('compare') === 'previous_period', [1])),
      ),
    );
    render('?tab=prompts&detectable=only');
    expect(await screen.findByRole('heading', { name: 'No detectable change in these rows' })).toBeInTheDocument();
    expect(
      screen.getByText('1 row was compared with the previous period and none changed by more than normal variation.'),
    ).toBeInTheDocument();
  });

  it('says the previous period has no answers only when it has none', async () => {
    server.use(
      http.get(LIST_PATH, () =>
        HttpResponse.json({ data: [promptOf(3)], page: { has_more: false, next_cursor: null } }),
      ),
      http.get(SUMMARY_PATH, ({ request }) => {
        const compared = new URL(request.url).searchParams.get('compare') === 'previous_period';
        const answer = summaryAnswer(compared, [2]);
        return HttpResponse.json(compared ? { data: { ...answer.data, previous_answers: 0 } } : answer);
      }),
    );
    render('?tab=prompts&detectable=only');
    expect(await screen.findByRole('heading', { name: 'No detectable change in these rows' })).toBeInTheDocument();
    expect(screen.getByText('The previous period has no answers, so no change can be told.')).toBeInTheDocument();
  });

  it('says no row has enough answers in both periods when the previous period has answers but not for the rows', async () => {
    server.use(
      http.get(LIST_PATH, () =>
        HttpResponse.json({ data: [promptOf(3)], page: { has_more: false, next_cursor: null } }),
      ),
      http.get(SUMMARY_PATH, ({ request }) =>
        HttpResponse.json(summaryAnswer(new URL(request.url).searchParams.get('compare') === 'previous_period', [2])),
      ),
    );
    render('?tab=prompts&detectable=only');
    expect(await screen.findByRole('heading', { name: 'No detectable change in these rows' })).toBeInTheDocument();
    expect(screen.getByText('No row has enough answers in both periods to tell a change.')).toBeInTheDocument();
    expect(screen.queryByText(/previous period has no answers/)).toBeNull();
  });

  it('leaves the rows and the banner when the read fails, and does not say there is nothing to compare', async () => {
    server.use(
      http.get(LIST_PATH, () =>
        HttpResponse.json({
          data: [promptOf(1), promptOf(2), promptOf(3)],
          page: { has_more: false, next_cursor: null },
        }),
      ),
      http.get(SUMMARY_PATH, () => HttpResponse.json({ code: 'boom' }, { status: 500 })),
    );
    render('?tab=prompts&detectable=only');
    expect(
      await screen.findByText('The answer counts could not be loaded. The prompts are listed without them.'),
    ).toBeInTheDocument();
    expect(promptTexts(await grid())).toHaveLength(3);
    expect(screen.queryByRole('heading', { name: 'No detectable change in these rows' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'No comparison to read changes from' })).toBeNull();
  });

  it('keeps the rows on screen between turning the comparison on and the new read, and then narrows them', async () => {
    let held = false;
    let release = (): void => undefined;
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    serve();
    server.use(
      http.get(SUMMARY_PATH, async ({ request }) => {
        const compared = new URL(request.url).searchParams.get('compare') === 'previous_period';
        if (compared && held) await opened;
        return HttpResponse.json(summaryAnswer(compared));
      }),
    );
    const { user } = render('?tab=prompts&detectable=only&cmp=off');
    expect(await screen.findByRole('heading', { name: 'No comparison to read changes from' })).toBeInTheDocument();
    held = true;
    await user.click(screen.getByRole('button', { name: 'Compare with previous period' }));
    // Synchronously after the click: the new read is held, and the table is neither empty nor an empty state
    expect(screen.queryByRole('heading', { name: /^No (detectable change|comparison)/ })).toBeNull();
    expect(promptTexts(await grid())).toHaveLength(3);
    release();
    await waitFor(() =>
      expect(promptTexts(screen.getByRole('grid', { name: 'Prompts' }))).toEqual(['Question number 1?']),
    );
  });

  it('says No prompts match, not that no change was detected, for a search that finds nothing', async () => {
    serve();
    render('?tab=prompts&detectable=only&q=zzzznothing');
    expect(await screen.findByRole('heading', { name: 'No prompts match' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No detectable change in these rows' })).toBeNull();
  });

  it('keeps the compare choice when Clear filters clears the chip', async () => {
    serve();
    const { user, writes } = render('?tab=prompts&detectable=only&cmp=off');
    await user.click(await screen.findByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(writes.some((write) => !write.queryString.includes('detectable'))).toBe(true));
    expect(writes.at(-1)?.queryString).toContain('cmp=off');
    expect(await screen.findByText('Question number 1?')).toBeInTheDocument();
    expect(screen.getByText('Question number 2?')).toBeInTheDocument();
  });
});
