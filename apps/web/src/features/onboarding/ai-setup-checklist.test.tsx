import { screen, waitFor, within } from '@testing-library/react';
import type { Route } from 'next';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { AiSetupChecklist } from './ai-setup-checklist';
import type { SetupStep } from './setup-steps';
import type { ProjectEngine } from '@/lib/api/types';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { ENGINE_FACTS } from '@/mocks/prompt-fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { gate } from '@/test/gate';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

/**
 * The container of the AI setup checklist (WB-SET-17): the two reads, the three steps, the open or closed state.
 * No page mounts it yet: the Overview owner (WP-33 or WP-40) mounts it later, so these tests are the proof.
 *
 * All five states: loading (a 40 px skeleton bar), error (both reads failed: the bar says so, with Retry and the
 * error id), partial (one read failed: that step says it could not be checked, the others render), stale (a read
 * again keeps what is shown, with the static 2 px bar). Empty does not apply: the steps are always there, and
 * "nothing done yet" is the checklist's own content.
 */

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The fixture projects are missing');

const SCOPE = {
  workspaceId: MOCK_WORKSPACE.workspace_id,
  projectId: fynix.project_id,
  workspaceSlug: MOCK_WORKSPACE.slug,
  projectSlug: fynix.slug,
};
const ENGINES_PATH = mswPath(`/api/v1/workspaces/${SCOPE.workspaceId}/projects/${SCOPE.projectId}/engines`);
const ANSWERS_PATH = mswPath(`/api/v1/workspaces/${SCOPE.workspaceId}/projects/${SCOPE.projectId}/ai/observations`);

type EngineCode = keyof typeof ENGINE_FACTS;
const engineOf = (code: EngineCode, on: boolean, activePrompts: number): ProjectEngine => ({
  engine: ENGINE_FACTS[code],
  is_configured: on,
  is_enabled: on,
  location_ids: on ? [2840] : [],
  replicates: 1,
  provider_code: 'dataforseo',
  active_prompts: activePrompts,
  estimated_monthly_cost_usd: '0.250000',
});
/** The three engines, `on` of them enabled, each with `active` active prompts. */
const enginesOf = (on: number, active: number): ProjectEngine[] =>
  (['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const).map((code, index) => engineOf(code, index < on, active));

const PAGE = { has_more: false, next_cursor: null, limit: 1 };
/** An answers list with `rows` rows: the checklist reads whether there is one, nothing else of it. */
const answersBody = (rows: number): { data: { observation_id: string }[]; page: typeof PAGE } => ({
  data: Array.from({ length: rows }, (_, index) => ({ observation_id: `answer-${String(index)}` })),
  page: PAGE,
});

interface Stub {
  engines?: ProjectEngine[] | 'fail';
  answers?: number | 'fail';
}
/** The two routes as a small API; a test changes `state` to change what the next read returns. */
function stub(state: Stub): void {
  server.use(
    http.get(ENGINES_PATH, ({ request }) =>
      state.engines === 'fail'
        ? problem(request, 'internal_error')
        : HttpResponse.json({ data: state.engines ?? enginesOf(0, 0) }),
    ),
    http.get(ANSWERS_PATH, ({ request }) =>
      state.answers === 'fail'
        ? problem(request, 'internal_error')
        : HttpResponse.json(answersBody(state.answers ?? 0)),
    ),
  );
}

const bar = (): HTMLElement => screen.getByRole('region', { name: 'Project setup' });
const skeleton = (): HTMLElement | null => document.querySelector('[data-slot="setup-skeleton"]');
const refetchBar = (): Element | null => document.querySelector('[data-slot="setup-refetch-bar"]');

describe('AiSetupChecklist, the steps', () => {
  it('starts with nothing done on a project with no engine on and no prompts', async () => {
    stub({ engines: enginesOf(0, 0), answers: 0 });
    const { user } = renderWithProviders(<AiSetupChecklist {...SCOPE} />);
    expect(await screen.findByText('Setup: 0 of 3 steps complete')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show steps' }));
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('To do: Select AI engines');
    expect(rows[0]).toHaveTextContent('0 of 3 engines on');
    expect(rows[1]).toHaveTextContent('To do: Add prompts');
    expect(rows[1]).toHaveTextContent('0 active prompts');
    expect(rows[2]).toHaveTextContent('To do: First answers');
    expect(rows[2]).toHaveTextContent('Needs engines and prompts');
    expect(within(rows[0] as HTMLElement).getByRole('link', { name: 'Open Engines' })).toHaveAttribute(
      'href',
      `/digibranders/${fynix.slug}/settings/engines`,
    );
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: 'Add prompts' })).toHaveAttribute(
      'href',
      `/digibranders/${fynix.slug}/ai/prompts`,
    );
    // Continue setup goes to the first step still to do
    expect(screen.getByRole('link', { name: 'Continue setup' })).toHaveAttribute(
      'href',
      `/digibranders/${fynix.slug}/settings/engines`,
    );
  });

  it('shows engines done and prompts still to do for engines on without prompts', async () => {
    stub({ engines: enginesOf(2, 0), answers: 0 });
    const { user } = renderWithProviders(<AiSetupChecklist {...SCOPE} />);
    expect(await screen.findByText('Setup: 1 of 3 steps complete')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show steps' }));
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Done: Select AI engines');
    expect(rows[0]).toHaveTextContent('2 of 3 engines on');
    expect(rows[1]).toHaveTextContent('To do: Add prompts');
    expect(rows[2]).toHaveTextContent('Needs engines and prompts');
    expect(screen.getByRole('link', { name: 'Continue setup' })).toHaveAttribute(
      'href',
      `/digibranders/${fynix.slug}/ai/prompts`,
    );
  });

  it('says the first answers come with the next run once engines and prompts are done', async () => {
    stub({ engines: enginesOf(3, 24), answers: 0 });
    const { user } = renderWithProviders(<AiSetupChecklist {...SCOPE} />);
    expect(await screen.findByText('Setup: 2 of 3 steps complete')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show steps' }));
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    // The same 24 prompts on three engines are 24, not 72
    expect(rows[1]).toHaveTextContent('24 active prompts');
    expect(rows[2]).toHaveTextContent('First answers arrive after the next Monday or Thursday run');
  });

  it('is complete with an engine, a prompt and an answer, and offers Dismiss only when the page handles it', async () => {
    stub({ engines: enginesOf(2, 24), answers: 1 });
    const onDismiss = vi.fn();
    const { user, unmount } = renderWithProviders(<AiSetupChecklist {...SCOPE} />);
    expect(await screen.findByText('Setup complete')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    unmount();
    renderWithProviders(<AiSetupChecklist {...SCOPE} onDismiss={onDismiss} />);
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('counts the extra steps of the page with its own, and lists them with the rest', async () => {
    stub({ engines: enginesOf(3, 24), answers: 1 });
    const extraSteps: SetupStep[] = [
      { id: 'domain', name: 'Verify the domain', done: true, fact: 'fynix.digital' },
      {
        id: 'alerts',
        name: 'Create an alert rule',
        done: false,
        action: { label: 'Add alert rule', href: '/digibranders/fynix/settings/alert-rules' as Route },
      },
    ];
    const { user } = renderWithProviders(<AiSetupChecklist {...SCOPE} extraSteps={extraSteps} />);
    expect(await screen.findByText('Setup: 4 of 5 steps complete')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('aria-valuemax', '5');
    await user.click(screen.getByRole('button', { name: 'Show steps' }));
    expect(screen.getByText('Verify the domain')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add alert rule' })).toBeInTheDocument();
  });

  it('reads the real mock engines of a project: two of three on, with their active prompts', async () => {
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    const { user } = renderWithProviders(<AiSetupChecklist {...SCOPE} />);
    await screen.findByRole('button', { name: 'Show steps' });
    await user.click(screen.getByRole('button', { name: 'Show steps' }));
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('2 of 3 engines on');
    expect(rows[1]).toHaveTextContent('24 active prompts');
  });
});

describe('AiSetupChecklist, reads and their keys', () => {
  it('reads the engines and the first answer under the keys the prompts refresh reaches', async () => {
    stub({ engines: enginesOf(1, 24), answers: 1 });
    const { queryClient } = renderWithProviders(<AiSetupChecklist {...SCOPE} />);
    await screen.findByText('Setup complete');
    const project = ['ws', SCOPE.workspaceId, 'p', SCOPE.projectId];
    // Spelled out, as the keys of the prompts feature are: features do not import each other
    const cache = queryClient.getQueryCache();
    expect(cache.findAll({ queryKey: [...project, 'engines'] })).toHaveLength(1);
    const answers = cache.findAll({ queryKey: [...project, 'ai'] });
    expect(answers).toHaveLength(1);
    expect(answers[0]?.queryKey.slice(0, project.length + 2)).toEqual([...project, 'ai', 'observations']);
  });

  it('asks for one answer only', async () => {
    const urls: string[] = [];
    server.events.on('request:start', ({ request }) => urls.push(request.url));
    stub({ engines: enginesOf(1, 24), answers: 1 });
    renderWithProviders(<AiSetupChecklist {...SCOPE} />);
    await screen.findByText('Setup complete');
    server.events.removeAllListeners();
    const asked = urls.filter((url) => url.includes('/ai/observations'));
    expect(asked).toHaveLength(1);
    expect(new URL(asked[0] ?? '').searchParams.get('limit')).toBe('1');
  });
});

describe('AiSetupChecklist, loading', () => {
  it('shows a 40 px skeleton bar with no steps and nothing done, until both reads have answered', async () => {
    const hold = gate();
    server.use(
      http.get(ENGINES_PATH, async () => {
        await hold.promise;
        return HttpResponse.json({ data: enginesOf(3, 24) });
      }),
      http.get(ANSWERS_PATH, () => HttpResponse.json(answersBody(1))),
    );
    const { container } = renderWithProviders(<AiSetupChecklist {...SCOPE} />);
    expect(skeleton()).not.toBeNull();
    expect(screen.getByRole('status', { name: 'Checking setup' })).toBeInTheDocument();
    expect(screen.queryByText(/Setup: /)).not.toBeInTheDocument();
    expect(screen.queryByText('Setup complete')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    hold.open();
    expect(await screen.findByText('Setup complete')).toBeInTheDocument();
    expect(skeleton()).toBeNull();
  });
});

describe('AiSetupChecklist, one read failed (partial)', () => {
  it('shows the first answers as could not be checked and renders the other steps', async () => {
    stub({ engines: enginesOf(3, 24), answers: 'fail' });
    const { user, container } = renderWithProviders(<AiSetupChecklist {...SCOPE} />);
    expect(await screen.findByText('Setup: 2 of 3 steps complete')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show steps' }));
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Done: Select AI engines');
    expect(rows[1]).toHaveTextContent('Done: Add prompts');
    expect(rows[2]).toHaveTextContent('To do: First answers');
    expect(rows[2]).toHaveTextContent('Could not be checked');
    expect(screen.queryByText('Setup complete')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the engine steps as could not be checked, never done, when the engines read failed', async () => {
    stub({ engines: 'fail', answers: 0 });
    const { user } = renderWithProviders(<AiSetupChecklist {...SCOPE} />);
    expect(await screen.findByText('Setup: 0 of 3 steps complete')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show steps' }));
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    for (const row of rows) {
      expect(row).toHaveTextContent('To do:');
      expect(row).toHaveTextContent('Could not be checked');
    }
  });

  it('counts a done step from the read that did succeed when the other failed', async () => {
    stub({ engines: 'fail', answers: 1 });
    renderWithProviders(<AiSetupChecklist {...SCOPE} />);
    expect(await screen.findByText('Setup: 1 of 3 steps complete')).toBeInTheDocument();
  });
});

describe('AiSetupChecklist, a read that fails after it succeeded', () => {
  const PROJECT_KEY = ['ws', SCOPE.workspaceId, 'p', SCOPE.projectId];

  it('shows the engine steps as could not be checked, not done, when the engines read fails later', async () => {
    const state: Stub = { engines: enginesOf(3, 24), answers: 1 };
    stub(state);
    const { user, queryClient } = renderWithProviders(<AiSetupChecklist {...SCOPE} />);
    expect(await screen.findByText('Setup complete')).toBeInTheDocument();
    state.engines = 'fail';
    void queryClient.invalidateQueries({ queryKey: [...PROJECT_KEY, 'engines'] });
    // The cached engines are still in the cache, and still not shown as done
    expect(await screen.findByText('Setup: 1 of 3 steps complete')).toBeInTheDocument();
    expect(screen.queryByText('Setup complete')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show steps' }));
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    for (const row of [rows[0], rows[1]]) {
      expect(row).toHaveTextContent('To do:');
      expect(row).toHaveTextContent('Could not be checked');
    }
    expect(rows[2]).toHaveTextContent('Done: First answers');
  });

  it('shows the first answers as could not be checked, not done, when the answers read fails later', async () => {
    const state: Stub = { engines: enginesOf(3, 24), answers: 1 };
    stub(state);
    const { user, queryClient } = renderWithProviders(<AiSetupChecklist {...SCOPE} />);
    expect(await screen.findByText('Setup complete')).toBeInTheDocument();
    state.answers = 'fail';
    void queryClient.invalidateQueries({ queryKey: [...PROJECT_KEY, 'ai'] });
    expect(await screen.findByText('Setup: 2 of 3 steps complete')).toBeInTheDocument();
    expect(screen.queryByText('Setup complete')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show steps' }));
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Done: Select AI engines');
    expect(rows[1]).toHaveTextContent('Done: Add prompts');
    expect(rows[2]).toHaveTextContent('To do: First answers');
    expect(rows[2]).toHaveTextContent('Could not be checked');
  });

  it('shows the error bar, not Setup complete, when both reads fail later', async () => {
    const state: Stub = { engines: enginesOf(3, 24), answers: 1 };
    stub(state);
    const { queryClient } = renderWithProviders(<AiSetupChecklist {...SCOPE} />);
    expect(await screen.findByText('Setup complete')).toBeInTheDocument();
    state.engines = 'fail';
    state.answers = 'fail';
    void queryClient.invalidateQueries({ queryKey: PROJECT_KEY });
    expect(await screen.findByText('Setup could not be checked')).toBeInTheDocument();
    expect(screen.queryByText('Setup complete')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

describe('AiSetupChecklist, both reads failed (error)', () => {
  it('says setup could not be checked, with the error id and Retry, and shows no step as done', async () => {
    stub({ engines: 'fail', answers: 'fail' });
    const { container } = renderWithProviders(<AiSetupChecklist {...SCOPE} />);
    expect(await screen.findByText('Setup could not be checked')).toBeInTheDocument();
    expect(within(bar()).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect((await screen.findAllByText(/^Error ID /)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Setup: /)).not.toBeInTheDocument();
    expect(screen.queryByText('Setup complete')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('reads again on Retry and shows the steps when the reads now answer', async () => {
    const state: Stub = { engines: 'fail', answers: 'fail' };
    stub(state);
    const { user } = renderWithProviders(<AiSetupChecklist {...SCOPE} />);
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    // Still failing: the bar stays, it does not flash to a skeleton
    expect(await screen.findByText('Setup could not be checked')).toBeInTheDocument();
    state.engines = enginesOf(3, 24);
    state.answers = 1;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Setup complete')).toBeInTheDocument();
    expect(screen.queryByText('Setup could not be checked')).not.toBeInTheDocument();
  });
});

describe('AiSetupChecklist, a later read (stale)', () => {
  it('updates after the prompts or engines change, keeping what it shows: no skeleton and a 2 px bar', async () => {
    const state: Stub = { engines: enginesOf(0, 0), answers: 0 };
    stub(state);
    const { queryClient } = renderWithProviders(<AiSetupChecklist {...SCOPE} />);
    expect(await screen.findByText('Setup: 0 of 3 steps complete')).toBeInTheDocument();
    expect(refetchBar()).toBeNull();

    const hold = gate();
    server.use(
      http.get(ENGINES_PATH, async () => {
        await hold.promise;
        return HttpResponse.json({ data: enginesOf(3, 24) });
      }),
    );
    // What `refreshPrompts` of the prompts feature invalidates: the project's engines
    void queryClient.invalidateQueries({ queryKey: ['ws', SCOPE.workspaceId, 'p', SCOPE.projectId, 'engines'] });
    await waitFor(() => expect(refetchBar()).not.toBeNull());
    expect(skeleton()).toBeNull();
    // The old count stays at full strength while the new one is read
    expect(screen.getByText('Setup: 0 of 3 steps complete')).toBeInTheDocument();
    hold.open();
    expect(await screen.findByText('Setup: 2 of 3 steps complete')).toBeInTheDocument();
    await waitFor(() => expect(refetchBar()).toBeNull());
    expect(skeleton()).toBeNull();
  });

  it('updates after the answers change too: the invalidation of the project AI reads', async () => {
    const state: Stub = { engines: enginesOf(3, 24), answers: 0 };
    stub(state);
    const { queryClient } = renderWithProviders(<AiSetupChecklist {...SCOPE} />);
    expect(await screen.findByText('Setup: 2 of 3 steps complete')).toBeInTheDocument();
    state.answers = 1;
    void queryClient.invalidateQueries({ queryKey: ['ws', SCOPE.workspaceId, 'p', SCOPE.projectId, 'ai'] });
    expect(await screen.findByText('Setup complete')).toBeInTheDocument();
  });
});

describe('AiSetupChecklist, keyboard and axe', () => {
  it('opens with Enter on Show steps and tabs bar, Continue setup, Show steps, then the links of the rows', async () => {
    stub({ engines: enginesOf(0, 0), answers: 0 });
    const { user, container } = renderWithProviders(<AiSetupChecklist {...SCOPE} />);
    await screen.findByText('Setup: 0 of 3 steps complete');
    await user.tab();
    expect(screen.getByRole('link', { name: 'Continue setup' })).toHaveFocus();
    await user.tab();
    const toggle = screen.getByRole('button', { name: 'Show steps' });
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Hide steps' })).toHaveAttribute('aria-expanded', 'true');
    await user.tab();
    expect(screen.getByRole('link', { name: 'Open Engines' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Add prompts' })).toHaveFocus();
    expect(await axe(container)).toHaveNoViolations();
  });
});
