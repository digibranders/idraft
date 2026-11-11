import { screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiKey, enginesKey, promptsKey, type PromptScope } from './prompt-queries';
import { PromptsScreen } from './prompts-screen';
import type { ObservationSummary, Role } from '@/lib/api/types';
import { projectKey } from '@/lib/api/keys';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { FIXTURE_PROMPTS, promptId } from '@/mocks/prompt-fixtures';
import { promptsOf } from '@/mocks/prompts-state';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
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
const RUN_NOW = mswPath(`${P}/prompts/{prompt_id}/run-now`);
const PROMPT = mswPath(`${P}/prompts/{prompt_id}`);

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const fixtures = FIXTURE_PROMPTS.get(fynix.project_id) ?? [];
const [first] = fixtures;
if (first === undefined) throw new Error('The fixture prompts are missing');
/** The prompts the Prompts tab lists: the branded one is out until the Branded filter includes it. */
const LISTED = fixtures.filter((prompt) => !prompt.is_branded).length;
const SCOPE: PromptScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };

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

const inspectOf = (id: string): string => `inspect=${encodeURIComponent(`prompt:${id}`)}`;
const opened = `?tab=prompts&${inspectOf(first.prompt_id)}`;
const panel = (name: string = first.text): Promise<HTMLElement> => screen.findByRole('complementary', { name });
const grid = (): Promise<HTMLElement> => screen.findByRole('grid', { name: 'Prompts' });
const treegrid = (): Promise<HTMLElement> => screen.findByRole('treegrid', { name: 'Topics' });

/** Renders with the options a link to the Prompts tab or the Topics tab has. */
const renderOn = (role: Role, searchParams: string): ProvidedRender =>
  renderWithProviders(promptsAs(role), { searchParams } satisfies ProvidedRenderOptions);

/** The body of a refusal as the API writes it (RFC 9457 problem JSON). */
const problemBody = (code: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: `https://api.idraft.ai/problems/${code}`,
  title: code,
  status: 0,
  code,
  ...extra,
});
const refuse = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): void =>
  server.use(http.post(RUN_NOW, () => HttpResponse.json({ ...body, status }, { status, headers })));

/** An error toast is also written for assistive technology, so its text is found more than once. */
const said = async (text: string): Promise<void> => {
  expect(await screen.findAllByText(text)).not.toHaveLength(0);
};

describe('the prompt inspector: what it shows', () => {
  it('shows the facts of the prompt, its counts per engine and its answers in the window', async () => {
    const { container } = renderOn('viewer', opened);
    const inspector = await panel();
    expect(await within(inspector).findByText('SEO')).toBeInTheDocument();
    expect(within(inspector).getByText('English')).toBeInTheDocument();
    expect(within(inspector).getByText('Germany')).toBeInTheDocument();
    // The mock's answers are made from the prompt, the engine and the day: the same counts as the Prompts table
    expect(await within(inspector).findByText('Mentioned 3 of 6, cited 4 of 6')).toBeInTheDocument();
    expect(within(inspector).getByText('Mentioned 6 of 8, cited 0 of 8')).toBeInTheDocument();
    const answers = await within(inspector).findByRole('table', { name: 'Answers to this prompt' });
    // Eight runs in the 28 days (Monday and Thursday, 16 October to 12 November) on two engines, and a header row
    await waitFor(() => expect(within(answers).getAllByRole('row')).toHaveLength(17));
    expect(within(answers).getAllByText('Complete').length).toBeGreaterThan(0);
    expect(within(answers).getAllByText(/^Mentioned|^Cited|^Neither|^Not counted/).length).toBe(16);
    expect(within(answers).getAllByText('ChatGPT')).toHaveLength(8);
    expect(within(answers).getAllByText('Gemini')).toHaveLength(8);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('asks for the answers of this prompt in the window of the page, 200 at most', async () => {
    const asked: URL[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/ai/observations')) asked.push(url);
    });
    renderOn('viewer', `${opened}&window=7`);
    const inspector = await panel();
    await within(inspector).findByRole('table', { name: 'Answers to this prompt' });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.searchParams.get('filter[prompt_id]')).toBe(first.prompt_id);
    expect(asked[0]?.searchParams.get('from')).toBe('2026-11-06');
    expect(asked[0]?.searchParams.get('to')).toBe('2026-11-12');
    expect(asked[0]?.searchParams.get('limit')).toBe('200');
  });

  it('says a window without an answer has none, and the counts have none either', async () => {
    server.use(
      http.get(mswPath(`${P}/ai/observations`), () =>
        HttpResponse.json({ data: [], page: { has_more: false, next_cursor: null, limit: 200 } }),
      ),
    );
    renderOn('viewer', opened);
    const inspector = await panel();
    expect(await within(inspector).findByText('No answers in this window')).toBeInTheDocument();
  });

  it('says the answers could not be loaded and reads them again on Try again', async () => {
    let failing = true;
    server.use(
      http.get(mswPath(`${P}/ai/observations`), () =>
        failing ? HttpResponse.json({ code: 'boom' }, { status: 500 }) : undefined,
      ),
    );
    const { user } = renderOn('viewer', opened);
    const inspector = await panel();
    expect(await within(inspector).findByText('The answers could not be loaded.')).toBeInTheDocument();
    failing = false;
    await user.click(within(inspector).getByRole('button', { name: 'Try again' }));
    expect(await within(inspector).findByRole('table', { name: 'Answers to this prompt' })).toBeInTheDocument();
  });

  it('says there are no counts for a branded prompt, which the counts leave out unless it is included', async () => {
    const branded = fixtures.find((prompt) => prompt.is_branded);
    if (branded === undefined) throw new Error('The branded fixture prompt is missing');
    renderOn('viewer', `?tab=prompts&${inspectOf(branded.prompt_id)}`);
    const inspector = await panel(branded.text);
    expect(await within(inspector).findByText('No counts for this window')).toBeInTheDocument();
    expect(
      within(inspector).getByText('Branded prompts stay out of the counts until the Branded filter includes them.'),
    ).toBeInTheDocument();
    expect(within(inspector).getByText('Branded')).toBeInTheDocument();
  });

  it('says so when the counts could not be loaded, and the rest of the inspector stays', async () => {
    server.use(
      http.get(mswPath(`${P}/ai/prompts-summary`), () => HttpResponse.json({ code: 'boom' }, { status: 500 })),
    );
    renderOn('viewer', opened);
    const inspector = await panel();
    expect(await within(inspector).findByText('The counts could not be loaded.')).toBeInTheDocument();
    expect(within(inspector).getByText('English')).toBeInTheDocument();
    expect(await within(inspector).findByRole('table', { name: 'Answers to this prompt' })).toBeInTheDocument();
  });

  it('says the prompt does not exist for a link to one the project has not got', async () => {
    renderOn('viewer', `?tab=prompts&${inspectOf(promptId(999))}`);
    expect(await screen.findByText('This prompt does not exist or you do not have access to it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull();
  });

  it('offers a retry when the prompt does not load, and shows it once it does', async () => {
    server.use(http.get(PROMPT, () => HttpResponse.json({ code: 'boom' }, { status: 500 }), { once: true }));
    const { user } = renderOn('viewer', opened);
    const inspector = await screen.findByRole('complementary', { name: 'Prompt' });
    expect(await within(inspector).findByText('The prompt could not be loaded.')).toBeInTheDocument();
    await user.click(within(inspector).getByRole('button', { name: 'Try again' }));
    expect(await within(await panel()).findByText('English')).toBeInTheDocument();
  });
});

describe('the prompt inspector: opening and stepping', () => {
  it('opens from a row of the Prompts tab, and puts the prompt in the address', async () => {
    const { user } = renderOn('viewer', '?tab=prompts');
    const table = await grid();
    await user.click(await within(table).findByText(first.text));
    expect(await panel()).toBeInTheDocument();
  });

  it('opens from a prompt under a topic of the Topics tab, which opens with the prompt, not the row', async () => {
    const { user } = renderOn('viewer', '');
    const tree = await treegrid();
    await user.click(await within(tree).findByRole('button', { name: 'Expand Paid Search, 2 prompts' }));
    await user.click(await within(tree).findByText('What is the best way to manage paid search on a small budget?'));
    const inspector = await panel('What is the best way to manage paid search on a small budget?');
    expect(await within(inspector).findByText('Paid Search')).toBeInTheDocument();
    // The topic's own row opens no inspector
    await user.click(within(tree).getByText('Content Marketing'));
    expect(
      screen.getByRole('complementary', { name: 'What is the best way to manage paid search on a small budget?' }),
    ).toBeInTheDocument();
  });

  it('steps to the previous and the next prompt in the order of the Prompts table', async () => {
    const { user } = renderOn('viewer', opened);
    const inspector = await panel();
    const position = within(inspector).getByText(new RegExp(`^\\d+ of ${String(LISTED)}$`));
    const at = Number(position.textContent?.split(' of ')[0]);
    expect(at).toBeGreaterThan(1);
    await user.click(within(inspector).getByRole('button', { name: 'Previous prompt' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: first.text })).toBeNull());
    const earlier = await screen.findByRole('complementary');
    expect(within(earlier).getByText(`${String(at - 1)} of ${String(LISTED)}`)).toBeInTheDocument();
    await user.click(within(earlier).getByRole('button', { name: 'Next prompt' }));
    expect(await panel()).toBeInTheDocument();
    expect(within(await panel()).getByText(`${String(at)} of ${String(LISTED)}`)).toBeInTheDocument();
  });

  it('steps between the prompts of the open topics on the Topics tab', async () => {
    const { user } = renderOn('viewer', '');
    const tree = await treegrid();
    await user.click(await within(tree).findByRole('button', { name: 'Expand Paid Search, 2 prompts' }));
    const one = 'What is the best way to manage paid search on a small budget?';
    const other = 'How do I lower the cost per click of search ads?';
    await user.click(await within(tree).findByText(one));
    const inspector = await panel(one);
    const position = within(inspector).getByText(/^[12] of 2$/);
    const forward = position.textContent === '1 of 2';
    await user.click(within(inspector).getByRole('button', { name: forward ? 'Next prompt' : 'Previous prompt' }));
    expect(await panel(other)).toBeInTheDocument();
    expect(within(await panel(other)).getByText(forward ? '2 of 2' : '1 of 2')).toBeInTheDocument();
  });

  it('gives focus back to the row of the prompt when the inspector closes', async () => {
    // Opened by the link, which Close undoes by replacing the address: jsdom cannot go back in its history
    const { user } = renderOn('viewer', opened);
    await grid();
    const inspector = await panel();
    expect(within(inspector).getByRole('heading', { level: 2, name: first.text })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('complementary', { name: first.text })).toBeNull());
    await waitFor(() => expect(document.activeElement?.closest('[role="row"]')).toHaveTextContent(first.text));
  });

  it('keeps focus on Next and Previous while they step, so they can be pressed again', async () => {
    const { user } = renderOn('viewer', opened);
    const inspector = await panel();
    const position = (): string => screen.getByRole('complementary').textContent ?? '';
    const before = position();
    await user.click(within(inspector).getByRole('button', { name: 'Previous prompt' }));
    await waitFor(() => expect(position()).not.toBe(before));
    expect(screen.getByRole('button', { name: 'Previous prompt' })).toHaveFocus();
    // Again from the keyboard: the button still has focus, since the inspector was not made again
    const middle = position();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(position()).not.toBe(middle));
    expect(screen.getByRole('button', { name: 'Previous prompt' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Next prompt' }));
    expect(screen.getByRole('button', { name: 'Next prompt' })).toHaveFocus();
  });

  it('steps with J from the list without taking focus out of it', async () => {
    const { user } = renderOn('viewer', opened);
    const table = await grid();
    const inspector = await panel();
    const title = within(inspector).getByRole('heading', { level: 2 }).textContent;
    const cell = (await within(table).findByText(first.text)).closest<HTMLElement>('[data-cell]');
    if (cell === null) throw new Error('The row has no cell');
    cell.focus();
    await user.keyboard('j');
    await waitFor(() =>
      expect(within(screen.getByRole('complementary')).getByRole('heading', { level: 2 }).textContent).not.toBe(title),
    );
    expect(screen.getByRole('complementary').contains(document.activeElement)).toBe(false);
  });

  it('does not carry a Run now still on its way to the prompt it steps to', async () => {
    server.use(
      http.post(RUN_NOW, async () => {
        await delay(3000);
        return undefined;
      }),
    );
    const { user } = renderOn('analyst', opened);
    await user.click(await within(await panel()).findByRole('button', { name: 'Run now' }));
    expect(screen.getByRole('button', { name: 'Run now' })).toHaveAttribute('aria-busy', 'true');
    await user.click(screen.getByRole('button', { name: 'Previous prompt' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: first.text })).toBeNull());
    expect(await screen.findByRole('button', { name: 'Run now' })).not.toHaveAttribute('aria-busy');
  });
});

describe('the prompt inspector: a prompt under two topics', () => {
  it('marks, and returns focus to, the row that was clicked, not the first row of the prompt', async () => {
    const { user } = renderOn('viewer', '');
    const tree = await treegrid();
    const text = 'How do I run a technical SEO audit on a large site?';
    await user.click(await within(tree).findByRole('button', { name: /^Expand Technical SEO/ }));
    await user.click(await within(tree).findByRole('button', { name: /^Expand SEO,/ }));
    const rows = await within(tree).findAllByText(text);
    expect(rows).toHaveLength(2);
    const rowOf = (node: HTMLElement): HTMLElement => node.closest<HTMLElement>('[role="row"]') ?? node;
    // The tree lists SEO before Technical SEO: the second row is the one under Technical SEO
    await user.click(rows[1] ?? tree);
    await panel(text);
    const [above, below] = (await within(tree).findAllByText(text)).map(rowOf);
    expect(above).not.toHaveAttribute('aria-current');
    expect(below).toHaveAttribute('aria-current', 'true');
  });
});

describe('the prompt inspector: the address and the answers', () => {
  it('says a prompt that is no prompt id does not exist, and asks for nothing', async () => {
    const asked: string[] = [];
    server.events.on('request:start', ({ request }) => asked.push(new URL(request.url).pathname));
    renderOn('viewer', '?tab=prompts&inspect=prompt%3Aabc');
    expect(await screen.findByText('This prompt does not exist or you do not have access to it.')).toBeInTheDocument();
    expect(asked.some((path) => path.endsWith('/prompts/abc'))).toBe(false);
    expect(asked.some((path) => path.endsWith('/ai/observations'))).toBe(false);
  });

  it('says a prompt the API refuses to look up does not exist either', async () => {
    server.use(http.get(PROMPT, () => HttpResponse.json(problemBody('validation_failed'), { status: 422 })));
    renderOn('viewer', opened);
    expect(await screen.findByText('This prompt does not exist or you do not have access to it.')).toBeInTheDocument();
  });

  it('does not read the answers of a prompt that does not exist', async () => {
    const asked: string[] = [];
    server.events.on('request:start', ({ request }) => asked.push(new URL(request.url).pathname));
    renderOn('viewer', `?tab=prompts&${inspectOf(promptId(999))}`);
    await screen.findByText('This prompt does not exist or you do not have access to it.');
    // One read may be on its way before the 404 is known, but none follows it
    const before = asked.filter((path) => path.endsWith('/ai/observations')).length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(asked.filter((path) => path.endsWith('/ai/observations')).length).toBe(before);
    expect(screen.queryByRole('table', { name: 'Answers to this prompt' })).toBeNull();
  });

  const answer = (overrides: Partial<ObservationSummary>): ObservationSummary => ({
    answer_char_count: 100,
    citation_count: 0,
    device: null,
    engine_code: 'chatgpt_web',
    facts: null,
    fanout_count: 0,
    language_code: 'en',
    location_id: 2276,
    model_reported: null,
    observation_class: 'consumer_ui',
    observation_id: '2000000',
    observed_at: '2026-11-12T02:00:00Z',
    observed_date: '2026-11-12',
    query_text: first.text,
    replicate_index: 1,
    run_id: null,
    served_from_cache: false,
    status: 'complete',
    subject: { type: 'prompt', prompt_id: first.prompt_id, prompt_version_id: first.version_id, version_no: 1 },
    ...overrides,
  });
  const serveAnswers = (data: ObservationSummary[], hasMore = false): void =>
    server.use(
      http.get(mswPath(`${P}/ai/observations`), () =>
        HttpResponse.json({ data, page: { has_more: hasMore, next_cursor: hasMore ? 'next' : null, limit: 200 } }),
      ),
    );

  it('says an answer that has no facts yet is being read, and keeps Not counted for one that is not valid', async () => {
    serveAnswers([
      answer({ observation_id: '2000001', facts: null }),
      answer({ observation_id: '2000002', status: 'refused', facts: null }),
    ]);
    renderOn('viewer', opened);
    const answers = await within(await panel()).findByRole('table', { name: 'Answers to this prompt' });
    expect(within(answers).getAllByText('Being read')).toHaveLength(1);
    expect(within(answers).getAllByText('Not counted')).toHaveLength(1);
  });

  it('says only the latest answers are listed when the API has more', async () => {
    // A full page, as the API sends it when it has more
    serveAnswers(
      Array.from({ length: 200 }, (_, index) => answer({ observation_id: String(2_000_000 + index) })),
      true,
    );
    renderOn('viewer', opened);
    expect(
      await within(await panel()).findByText('Only the latest 200 answers of this window are listed.'),
    ).toBeInTheDocument();
  });

  it('does not say so when the list is whole', async () => {
    renderOn('viewer', opened);
    await within(await panel()).findByRole('table', { name: 'Answers to this prompt' });
    expect(screen.queryByText(/Only the latest/)).toBeNull();
  });
});

describe('the prompt inspector: the counts', () => {
  it('does not say there are no counts while the engines are still loading', async () => {
    server.use(
      http.get(mswPath(`${P}/engines`), async () => {
        await delay(1200);
        return undefined;
      }),
    );
    renderOn('viewer', opened);
    const inspector = await panel();
    await within(inspector).findByText('English');
    expect(within(inspector).queryByText('No counts for this window')).toBeNull();
    expect(
      await within(inspector).findByText('Mentioned 3 of 6, cited 4 of 6', undefined, { timeout: 4000 }),
    ).toBeInTheDocument();
  });

  it('says an archived prompt is not in the counts', async () => {
    const stored = promptsOf(fynix.project_id).prompts.find((prompt) => prompt.prompt_id === first.prompt_id);
    if (stored === undefined) throw new Error('The stored prompt is missing');
    stored.is_active = false;
    renderOn('viewer', opened);
    expect(await within(await panel()).findByText('An archived prompt is not in the counts.')).toBeInTheDocument();
  });

  it('does not say branded prompts stay out of the counts when they are included', async () => {
    const branded = fixtures.find((prompt) => prompt.is_branded);
    if (branded === undefined) throw new Error('The branded fixture prompt is missing');
    server.use(
      http.get(mswPath(`${P}/ai/prompts-summary`), () =>
        HttpResponse.json({
          data: {
            window: { from: '2026-10-16', to: '2026-11-12', timezone: 'Europe/Berlin' },
            include_branded: true,
            engine_codes: ['chatgpt_web', 'gemini_web'],
            prompts: [],
            topics: [],
          },
        }),
      ),
    );
    renderOn('viewer', `?tab=prompts&branded=include&${inspectOf(branded.prompt_id)}`);
    const inspector = await panel(branded.text);
    expect(await within(inspector).findByText('No counts for this window')).toBeInTheDocument();
    expect(within(inspector).queryByText(/stay out of the counts/)).toBeNull();
  });
});

describe('the prompt inspector: Run now and Archive are for those who may', () => {
  it.each([
    ['viewer', false, false],
    ['analyst', true, false],
    ['editor', true, true],
  ] as const)('gives a %s Run now: %s, Archive: %s', async (role, runNow, archive) => {
    const { user } = renderOn(role, opened);
    const inspector = await panel();
    await within(inspector).findByText('English');
    expect(within(inspector).queryByRole('button', { name: 'Run now' }) !== null).toBe(runNow);
    await user.click(within(inspector).getByRole('button', { name: /^More actions/ }));
    expect((await screen.findAllByRole('menuitem')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('menuitem', { name: 'Archive' }) !== null).toBe(archive);
  });
});

describe('the prompt inspector: Run now', () => {
  // In the mocks a run is not kept: its answers never arrive and it is not in GET .../runs, so the screen's
  // refresh of both is read from the calls the screen makes, not from what the lists then show
  it('runs the prompt now on every enabled engine, refreshes the prompts and the runs, and says an answer is on its way when asked again', async () => {
    const bodies: unknown[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/run-now')) {
        void request
          .clone()
          .json()
          .then((body: unknown) => bodies.push(body));
      }
    });
    const { user, queryClient } = renderOn('analyst', opened);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const inspector = await panel();
    await user.click(await within(inspector).findByRole('button', { name: 'Run now' }));
    expect(await screen.findByText('Run queued')).toBeInTheDocument();
    await waitFor(() => expect(bodies).toEqual([{ engine_codes: ['chatgpt_web', 'gemini_web'] }]));
    for (const queryKey of [
      [...projectKey(SCOPE.workspaceId, SCOPE.projectId), 'runs'],
      promptsKey(SCOPE),
      aiKey(SCOPE),
      enginesKey(SCOPE),
    ]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
    await user.click(within(inspector).getByRole('button', { name: 'Run now' }));
    await said('An answer is already on its way on ChatGPT and Gemini. Try again once it has arrived.');
  });

  it('names only the engines that have an answer on its way', async () => {
    refuse(409, problemBody('check_pending', { engine_codes: ['gemini_web'] }));
    const { user } = renderOn('analyst', opened);
    await user.click(await within(await panel()).findByRole('button', { name: 'Run now' }));
    await said('An answer is already on its way on Gemini. Try again once it has arrived.');
  });

  it('says in words, with the numbers, that the day of manual runs is used up', async () => {
    refuse(429, problemBody('manual_run_limit', { limit: 20 }));
    const { user } = renderOn('analyst', opened);
    await user.click(await within(await panel()).findByRole('button', { name: 'Run now' }));
    await said('All 20 manual runs of today (UTC) are used, keyword refreshes included. Try again tomorrow.');
  });

  it('says in words, with the numbers, that the month of AI answers is used up', async () => {
    refuse(
      422,
      problemBody('quota_exceeded', {
        limit: 20000,
        used: 19999,
        requested: 2,
        quota: 'max_ai_observations_per_month',
      }),
    );
    const { user } = renderOn('analyst', opened);
    await user.click(await within(await panel()).findByRole('button', { name: 'Run now' }));
    await said('The workspace has used 19,999 of 20,000 AI answers this month. This run needs 2 more.');
  });

  it('says collection is paused, and when to try again', async () => {
    refuse(503, problemBody('provider_paused'), { 'retry-after': '300' });
    const { user } = renderOn('analyst', opened);
    await user.click(await within(await panel()).findByRole('button', { name: 'Run now' }));
    await said('Collection from the provider is paused. Try again in 5 minutes.');
  });

  it.each([
    ['engine_not_enabled', 'Gemini is not turned on for this project.'],
    ['prompt_too_long', 'Gemini does not take a prompt this long.'],
    ['location_not_enabled', 'Gemini has no location in the country of this prompt.'],
  ])('says why an engine was refused with %s, naming the engine', async (code, words) => {
    refuse(
      422,
      problemBody('validation_failed', {
        errors: [{ location: 'body', path: 'engine_codes', code, message: `gemini_web: ${code}` }],
      }),
    );
    const { user } = renderOn('analyst', opened);
    await user.click(await within(await panel()).findByRole('button', { name: 'Run now' }));
    await said(words);
  });

  it('words a missing price for every engine asked: the API sends it with no engine in the message', async () => {
    // backend api/operations/runs.py `_ai_subjects`: the price book is read for the whole run
    refuse(
      422,
      problemBody('validation_failed', {
        errors: [
          {
            location: 'body',
            path: 'engine_codes',
            code: 'price_unavailable',
            message: 'The price book has no price for these engines today.',
          },
        ],
      }),
    );
    const { user } = renderOn('analyst', opened);
    await user.click(await within(await panel()).findByRole('button', { name: 'Run now' }));
    await said('No price is known for ChatGPT and Gemini today, so they cannot be asked.');
  });

  it('tells each engine refused for the same reason in one sentence, and each other reason in its own', async () => {
    refuse(
      422,
      problemBody('validation_failed', {
        errors: [
          { location: 'body', path: 'engine_codes', code: 'prompt_too_long', message: 'chatgpt_web: x' },
          { location: 'body', path: 'engine_codes', code: 'prompt_too_long', message: 'gemini_web: x' },
        ],
      }),
    );
    const { user } = renderOn('analyst', opened);
    await user.click(await within(await panel()).findByRole('button', { name: 'Run now' }));
    await said('ChatGPT and Gemini do not take a prompt this long.');
  });

  it('keeps one sentence for each reason when engines are refused for different ones', async () => {
    refuse(
      422,
      problemBody('validation_failed', {
        errors: [
          { location: 'body', path: 'engine_codes', code: 'prompt_too_long', message: 'chatgpt_web: x' },
          { location: 'body', path: 'engine_codes', code: 'location_not_enabled', message: 'gemini_web: x' },
        ],
      }),
    );
    const { user } = renderOn('analyst', opened);
    await user.click(await within(await panel()).findByRole('button', { name: 'Run now' }));
    await said('ChatGPT does not take a prompt this long. Gemini has no location in the country of this prompt.');
  });

  it('applies a known reason that names no engine we know to every engine asked', async () => {
    refuse(
      422,
      problemBody('validation_failed', {
        errors: [{ location: 'body', path: 'engine_codes', code: 'prompt_too_long', message: 'unknown_engine: x' }],
      }),
    );
    const { user } = renderOn('analyst', opened);
    await user.click(await within(await panel()).findByRole('button', { name: 'Run now' }));
    await said('ChatGPT and Gemini do not take a prompt this long.');
  });

  it('falls back to a sentence for a refusal reason it does not know', async () => {
    refuse(
      422,
      problemBody('validation_failed', {
        errors: [{ location: 'body', path: 'engine_codes', code: 'something_new', message: 'gemini_web: x' }],
      }),
    );
    const { user } = renderOn('analyst', opened);
    await user.click(await within(await panel()).findByRole('button', { name: 'Run now' }));
    await said('An engine of this project cannot ask this prompt. Check the Engines settings.');
  });

  it.each([
    [404, 'not_found', 'This prompt is no longer asked: it was archived or removed.'],
    [403, 'forbidden', 'You do not have permission to run prompts in this project.'],
  ])('gives a %s its own sentence', async (status, code, words) => {
    refuse(status, problemBody(code));
    const { user } = renderOn('analyst', opened);
    await user.click(await within(await panel()).findByRole('button', { name: 'Run now' }));
    await said(words);
  });

  it('says when to try again after too many requests, from Retry-After', async () => {
    refuse(429, problemBody('rate_limited'), { 'retry-after': '120' });
    const { user } = renderOn('analyst', opened);
    await user.click(await within(await panel()).findByRole('button', { name: 'Run now' }));
    await said('Too many requests. Try again in 2 minutes.');
  });

  it('asks only the engines that have a location in the country of the prompt', async () => {
    const bodies: unknown[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/run-now')) {
        void request
          .clone()
          .json()
          .then((body: unknown) => bodies.push(body));
      }
    });
    // The prompt is German; Gemini keeps only India
    const gemini = promptsOf(fynix.project_id).engines.find((engine) => engine.engine_code === 'gemini_web');
    if (gemini === undefined) throw new Error('The Gemini fixture is missing');
    gemini.location_ids = [2356];
    const { user } = renderOn('analyst', opened);
    await user.click(await within(await panel()).findByRole('button', { name: 'Run now' }));
    await screen.findByText('Run queued');
    await waitFor(() => expect(bodies).toEqual([{ engine_codes: ['chatgpt_web'] }]));
  });

  it('says why there is no Run now when no engine has a location in the country of the prompt', async () => {
    for (const engine of promptsOf(fynix.project_id).engines) engine.location_ids = [2356];
    renderOn('analyst', opened);
    const inspector = await panel();
    expect(
      await within(inspector).findByText(
        'No enabled engine can ask this prompt: it is too long for them, or they have no location in its country.',
      ),
    ).toBeInTheDocument();
    expect(within(inspector).queryByRole('button', { name: 'Run now' })).toBeNull();
  });

  it('shows neither Run now nor its reason to a member who may not run', async () => {
    for (const engine of promptsOf(fynix.project_id).engines) engine.location_ids = [2356];
    renderOn('viewer', opened);
    const inspector = await panel();
    await within(inspector).findByText('English');
    expect(within(inspector).queryByText(/^No enabled engine can ask this prompt/)).toBeNull();
  });

  it('says the run was not queued for an answer it does not know', async () => {
    refuse(500, problemBody('internal_error'));
    const { user } = renderOn('analyst', opened);
    await user.click(await within(await panel()).findByRole('button', { name: 'Run now' }));
    await said('The run was not queued. Try again in a moment.');
    expect(screen.queryByText('Run queued')).toBeNull();
  });
});

describe('the prompt inspector: Archive', () => {
  it('archives the prompt, closes the inspector, and brings the prompt back with Undo', async () => {
    const { user } = renderOn('editor', opened);
    const inspector = await panel();
    await user.click(await within(inspector).findByRole('button', { name: /^More actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    expect(await screen.findByText('Prompt archived')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('complementary', { name: first.text })).toBeNull());
    const table = await grid();
    await waitFor(() => expect(within(table).queryByText(first.text)).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await within(table).findByText(first.text)).toBeInTheDocument();
    expect(await screen.findByText('Prompt restored')).toBeInTheDocument();
  });

  it('shows the toast with Undo without waiting for the lists to be read again', async () => {
    const { user } = renderOn('editor', opened);
    const inspector = await panel();
    await within(inspector).findByRole('table', { name: 'Answers to this prompt' });
    server.use(
      http.get(mswPath(`${P}/prompts`), async () => {
        await delay(4000);
        return undefined;
      }),
    );
    await user.click(within(inspector).getByRole('button', { name: /^More actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('keeps the inspector open and says so when the archive fails', async () => {
    server.use(http.delete(PROMPT, () => HttpResponse.json({ code: 'boom' }, { status: 500 })));
    const { user } = renderOn('editor', opened);
    const inspector = await panel();
    await user.click(await within(inspector).findByRole('button', { name: /^More actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await said('The prompt was not archived. Try again in a moment.');
    expect(screen.getByRole('complementary', { name: first.text })).toBeInTheDocument();
    expect(screen.queryByText('Prompt archived')).toBeNull();
  });

  it('says so when Undo does not bring the prompt back, and names the quota when that is why', async () => {
    const { user } = renderOn('editor', opened);
    const inspector = await panel();
    await user.click(await within(inspector).findByRole('button', { name: /^More actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await screen.findByText('Prompt archived');
    server.use(
      http.patch(PROMPT, () =>
        HttpResponse.json(problemBody('quota_exceeded', { limit: 150, used: 150, requested: 1 }), { status: 422 }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await said('The workspace has 150 of 150 active prompts. Archive another one to bring this one back.');
  });

  it('says a prompt that is archived is archived, and offers neither Run now nor Archive for it', async () => {
    // A link to an archived prompt still opens it: the API serves it, with its answers
    const stored = promptsOf(fynix.project_id).prompts.find((prompt) => prompt.prompt_id === first.prompt_id);
    if (stored === undefined) throw new Error('The stored prompt is missing');
    stored.is_active = false;
    const { user } = renderOn('editor', opened);
    const inspector = await panel();
    expect(await within(inspector).findByText('Archived')).toBeInTheDocument();
    expect(within(inspector).queryByRole('button', { name: 'Run now' })).toBeNull();
    await user.click(within(inspector).getByRole('button', { name: /^More actions/ }));
    expect((await screen.findAllByRole('menuitem')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).toBeNull();
    expect(await within(inspector).findByRole('table', { name: 'Answers to this prompt' })).toBeInTheDocument();
  });
});
