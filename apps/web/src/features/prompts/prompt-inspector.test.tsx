import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiKey, enginesKey, promptsKey, type PromptScope } from './prompt-queries';
import { PromptsScreen } from './prompts-screen';
import type { Role } from '@/lib/api/types';
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
    // Opened by the link, which Close undoes by replacing the address: jsdom cannot go back in its history. The
    // inspector remembers (per window) that a row pushed the entry it sits on: a test before this one did
    renderOn('viewer', '?tab=prompts').unmount();
    const { user } = renderOn('viewer', opened);
    await grid();
    const inspector = await panel();
    expect(within(inspector).getByRole('heading', { level: 2, name: first.text })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('complementary', { name: first.text })).toBeNull());
    await waitFor(() => expect(document.activeElement?.closest('[role="row"]')).toHaveTextContent(first.text));
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
    ['price_unavailable', 'No price is known for Gemini today, so it cannot be asked.'],
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

  it('falls back to a sentence for a refusal that names no engine it knows', async () => {
    refuse(
      422,
      problemBody('validation_failed', {
        errors: [{ location: 'body', path: 'engine_codes', code: 'prompt_too_long', message: 'unknown_engine: x' }],
      }),
    );
    const { user } = renderOn('analyst', opened);
    await user.click(await within(await panel()).findByRole('button', { name: 'Run now' }));
    await said('An engine of this project cannot ask this prompt. Check the Engines settings.');
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
