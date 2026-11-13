import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiRunCoverage } from './ai-run-coverage';
import { RunInspector } from './run-inspector';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import type { Schemas } from '@/lib/api/types';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { RUNS_SCOPE, runFixture } from '@/test/ai-runs-harness';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const COVERAGE = mswPath(`${P}/runs/{run_id}/ai-coverage`);
const ENGINES = mswPath(`${P}/engines`);
const RUN = mswPath(`${P}/runs/{run_id}`);

const RUN_ID = '0192d1a8-aaaa-7b44-8c2d-1f0e9d8c7b01';
const NAMES: Readonly<Record<string, string>> = {
  chatgpt_web: 'ChatGPT',
  gemini_web: 'Gemini',
  google_ai_mode: 'Google AI Mode',
};

type Coverage = Schemas['AiCoverage'];
type EngineRow = Schemas['AiCoverageEngine'];
type MissingRow = Schemas['AiCoverageMissing'];

const engineRow = (engine_code: EngineRow['engine_code'], over: Partial<EngineRow> = {}): EngineRow => ({
  engine_code,
  planned: 150,
  observed: 148,
  valid: 141,
  partial: 3,
  invalid_by_status: { empty: 2, refused: 1, error: 1 },
  valid_rate: { numerator: 141, denominator: 150, n_observations: 148, value: 0.94 },
  ...over,
});

const missingRow = (place: number, over: Partial<MissingRow> = {}): MissingRow => ({
  prompt_id: `0192d1a8-bbbb-7b44-8c2d-${String(place).padStart(12, '0')}`,
  engine_code: 'gemini_web',
  location_id: null,
  replicate_index: 0,
  task_status: 'failed',
  ...over,
});

/** Serves the engines read the names come from. */
function serveEngines(): void {
  server.use(
    http.get(ENGINES, () =>
      HttpResponse.json({
        data: Object.entries(NAMES).map(([code, label]) => ({
          active_prompts: 3,
          engine: {
            engine_code: code,
            exposes_citations: true,
            exposes_fanout: false,
            label,
            max_prompt_chars: 2000,
            observation_class: 'consumer_ui',
            vendor: 'Vendor',
          },
          estimated_monthly_cost_usd: null,
          is_configured: true,
          is_enabled: true,
          location_ids: [],
          provider_code: 'dataforseo',
          replicates: 1,
        })),
      }),
    ),
  );
}

interface ServedCoverage {
  /** How many times the coverage route has been asked. */
  asked: () => number;
  /** What it answers from now on; `null` is a server error. */
  answer: (next: Coverage | null) => void;
}

function serveCoverage(first: Coverage | null): ServedCoverage {
  let current = first;
  let asked = 0;
  server.use(
    http.get(COVERAGE, () => {
      asked += 1;
      return current === null
        ? HttpResponse.json({ code: 'internal_error', title: 'Internal error', status: 500 }, { status: 500 })
        : HttpResponse.json({ data: current });
    }),
  );
  return {
    asked: () => asked,
    answer: (next) => {
      current = next;
    },
  };
}

beforeEach(() => {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  serveEngines();
});

const coverageUi = (open = false): ReactElement => <AiRunCoverage scope={RUNS_SCOPE} runId={RUN_ID} open={open} />;

/** The card of one engine in "Answers by engine". */
async function engineCard(name: string): Promise<HTMLElement> {
  const section = (await screen.findByRole('heading', { name: 'Answers by engine' })).closest('section');
  if (section === null) throw new Error('no section');
  const card = (await within(section).findByText(name, { selector: '[data-slot="badge"]' })).closest('li');
  if (card === null) throw new Error(`no card for ${name}`);
  return card;
}

describe('Answers by engine', () => {
  it('answers by engine shows valid of planned with the percent and the count', async () => {
    serveCoverage({ by_engine: [engineRow('chatgpt_web')], missing: [] });
    renderWithProviders(coverageUi());
    const card = await engineCard('ChatGPT');
    // The planned count is the denominator: 148 observed would read 95 percent
    expect(within(card).getByText('141 of 150 answers valid, 94%')).toBeInTheDocument();
  });

  it('the invalid ones are named by status in words', async () => {
    serveCoverage({ by_engine: [engineRow('chatgpt_web')], missing: [] });
    renderWithProviders(coverageUi());
    const card = await engineCard('ChatGPT');
    const words = card.textContent;
    expect(words).toContain('3 partial counted');
    expect(words).toContain('2 empty');
    expect(words).toContain('1 refused');
    expect(words).toContain('1 error');
  });

  it('partial is counted as valid and said so', async () => {
    serveCoverage({
      by_engine: [
        engineRow('chatgpt_web', {
          planned: 20,
          observed: 20,
          valid: 20,
          partial: 5,
          invalid_by_status: { empty: 0, refused: 0, error: 0 },
        }),
      ],
      missing: [],
    });
    renderWithProviders(coverageUi());
    const card = await engineCard('ChatGPT');
    // The five partial answers are inside the 20 valid ones, and the line says they were counted
    expect(within(card).getByText('20 of 20 answers valid, 100%')).toBeInTheDocument();
    expect(within(card).getByText('5 partial counted')).toBeInTheDocument();
    expect(within(card).queryByText(/empty|refused|error/)).toBeNull();
  });

  it('an engine with nothing planned says n/a with a reason, never 0', async () => {
    serveCoverage({
      by_engine: [
        engineRow('google_ai_mode', {
          planned: 0,
          observed: 0,
          valid: 0,
          partial: 0,
          invalid_by_status: { empty: 0, refused: 0, error: 0 },
          valid_rate: { numerator: 0, denominator: 0, n_observations: 0, value: null },
        }),
      ],
      missing: [],
    });
    renderWithProviders(coverageUi());
    const card = await engineCard('Google AI Mode');
    expect(within(card).getByText('n/a')).toBeInTheDocument();
    expect(within(card).getByText('No answers were planned on this engine in this run.')).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/0 of 0|0%/);
  });

  it('under 10 planned shows the counts and no tone', async () => {
    serveCoverage({
      by_engine: [
        engineRow('gemini_web', {
          planned: 8,
          observed: 8,
          valid: 2,
          partial: 0,
          invalid_by_status: { empty: 6, refused: 0, error: 0 },
        }),
      ],
      missing: [],
    });
    renderWithProviders(coverageUi());
    const card = await engineCard('Gemini');
    expect(within(card).getByText('2 of 8 answers valid')).toBeInTheDocument();
    expect(within(card).getByText('8 planned, too few for a rate')).toBeInTheDocument();
    // 25 percent of 8 would be a verdict on a handful of answers: no percent, no warning colour
    expect(card.textContent).not.toContain('%');
    expect(card.querySelector('[class*="warning"]')).toBeNull();
  });

  it('a rate below 90 percent of at least 10 planned is warned, one at 90 is not', async () => {
    serveCoverage({
      by_engine: [
        engineRow('chatgpt_web', { planned: 100, observed: 100, valid: 90, partial: 0 }),
        engineRow('gemini_web', { planned: 100, observed: 100, valid: 89, partial: 0 }),
      ],
      missing: [],
    });
    renderWithProviders(coverageUi());
    const healthy = await engineCard('ChatGPT');
    const degraded = await engineCard('Gemini');
    expect(healthy.querySelector('[class*="warning"]')).toBeNull();
    expect(degraded.querySelector('[class*="warning"]')).not.toBeNull();
  });

  it('engines are listed one by one and no total pools them', async () => {
    serveCoverage({
      by_engine: [
        engineRow('gemini_web', { valid: 132 }),
        engineRow('chatgpt_web', { valid: 147 }),
        engineRow('google_ai_mode', { valid: 141 }),
      ],
      missing: [],
    });
    renderWithProviders(coverageUi());
    await engineCard('ChatGPT');
    const items = screen.getAllByRole('listitem').filter((item) => item.querySelector('[data-slot="badge"]'));
    // One row per engine, in the fixed engine order whatever order the API used
    expect(items.map((item) => item.querySelector('[data-slot="badge"]')?.textContent)).toEqual([
      'ChatGPT',
      'Gemini',
      'Google AI Mode',
    ]);
    expect(screen.getByText('147 of 150 answers valid, 98%')).toBeInTheDocument();
    expect(screen.getByText('132 of 150 answers valid, 88%')).toBeInTheDocument();
    // 420 of 450 is the pooled figure: it hides Gemini's 88 percent, so it is never shown
    expect(screen.queryByText(/450|\b93\.?\d*%/)).toBeNull();
  });

  it('a run that planned nothing says so, and has no missing answers section', async () => {
    serveCoverage({ by_engine: [], missing: [] });
    renderWithProviders(coverageUi());
    expect(await screen.findByText('No answers planned')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Missing answers' })).toBeNull();
  });
});

describe('Missing answers', () => {
  it('missing answers list prompt, engine and task status and show the first 50 with Show all N', async () => {
    const missing = Array.from({ length: 73 }, (_, place) =>
      missingRow(place, { task_status: place === 0 ? 'dead' : 'failed' }),
    );
    serveCoverage({ by_engine: [engineRow('gemini_web')], missing });
    const view = renderWithProviders(coverageUi());
    // The prompts page was open before: its summary holds the text of the first prompt
    view.queryClient.setQueryData(
      [
        'ws',
        MOCK_WORKSPACE.workspace_id,
        'p',
        RUNS_SCOPE.projectId,
        'ai',
        'prompts-summary',
        { from: '2026-10-17', to: '2026-11-13' },
      ],
      { data: { prompts: [{ prompt_id: missing[0]?.prompt_id, text: 'Best CRM for a small agency' }] } },
    );
    const table = await screen.findByRole('table', { name: 'Planned answers that have not arrived' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual(['Prompt', 'Engine', 'Task status']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(50);
    // The text of a prompt already read, else its id: never blank
    expect(within(rows[0] as HTMLElement).getByText('Best CRM for a small agency')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('Gemini')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('Dead')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText(missing[1]?.prompt_id ?? '')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('Failed')).toBeInTheDocument();

    const { user } = view;
    await user.click(screen.getByRole('button', { name: 'Show all 73' }));
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(73);
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });

  it('every planned answer arrived shows the empty state', async () => {
    serveCoverage({ by_engine: [engineRow('chatgpt_web', { valid: 150, partial: 0 })], missing: [] });
    renderWithProviders(coverageUi());
    expect(await screen.findByText('Every planned answer arrived')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('the read', () => {
  it('shows skeletons while the answer is on its way', async () => {
    serveCoverage({ by_engine: [engineRow('chatgpt_web')], missing: [] });
    const { container } = renderWithProviders(coverageUi());
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(2);
    await engineCard('ChatGPT');
  });

  it('a failed poll after a good read keeps the data and says so', async () => {
    const served = serveCoverage({ by_engine: [engineRow('chatgpt_web')], missing: [] });
    const view = renderWithProviders(coverageUi(true));
    await engineCard('ChatGPT');
    expect(screen.queryByText(/Could not refresh/)).toBeNull();

    served.answer(null);
    await view.queryClient.refetchQueries();
    expect(await screen.findByText('Could not refresh. These are the last figures read.')).toBeInTheDocument();
    // What was on screen stays; the error view is for a first read that fails
    expect(screen.getByText('141 of 150 answers valid, 94%')).toBeInTheDocument();
    expect(screen.queryByText('Answers per engine did not load')).toBeNull();

    served.answer({ by_engine: [engineRow('chatgpt_web', { valid: 150, partial: 0 })], missing: [] });
    await view.queryClient.refetchQueries();
    await waitFor(() => expect(screen.queryByText(/Could not refresh/)).toBeNull());
    expect(await screen.findByText('150 of 150 answers valid, 100%')).toBeInTheDocument();
  });

  describe('polling', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('asks again every 10 seconds while the run is open', async () => {
      const served = serveCoverage({ by_engine: [engineRow('chatgpt_web')], missing: [] });
      renderWithProviders(coverageUi(true));
      await engineCard('ChatGPT');
      expect(served.asked()).toBe(1);
      await vi.advanceTimersByTimeAsync(10_000);
      await waitFor(() => expect(served.asked()).toBe(2));
    });

    it('reads a run that has ended once and leaves it', async () => {
      const served = serveCoverage({ by_engine: [engineRow('chatgpt_web')], missing: [] });
      renderWithProviders(coverageUi(false));
      await engineCard('ChatGPT');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(served.asked()).toBe(1);
    });
  });

  it('passes axe', async () => {
    serveCoverage({
      by_engine: [engineRow('chatgpt_web'), engineRow('gemini_web', { planned: 0, observed: 0, valid: 0, partial: 0 })],
      missing: [missingRow(1), missingRow(2, { task_status: 'dead' })],
    });
    const { container } = renderWithProviders(coverageUi());
    await screen.findByRole('table', { name: 'Planned answers that have not arrived' });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('in the run inspector', () => {
  beforeEach(stubWideScreen);
  afterEach(restoreWideScreen);

  const inspectorOf = (workload: 'ai_prompt' | 'keyword_metrics'): ReactElement => (
    <InspectorLayout
      inspector={
        <RunInspector
          scope={RUNS_SCOPE}
          runId={RUN_ID}
          row={runFixture({ run_id: RUN_ID, workload })}
          timeZone="UTC"
          positionText={null}
          navigation={null}
          onStep={undefined}
          onClose={() => undefined}
        />
      }
    >
      <p>Runs</p>
    </InspectorLayout>
  );

  const detailIsGone = (): void => {
    server.use(http.get(RUN, ({ request }) => problem(request, 'not_found')));
  };

  it('an AI run shows both sections after Tasks by status', async () => {
    detailIsGone();
    serveCoverage({ by_engine: [engineRow('chatgpt_web')], missing: [missingRow(1)] });
    renderWithProviders(inspectorOf('ai_prompt'));
    const headings = await screen.findAllByRole('heading', { level: 3 });
    const names = headings.map((heading) => heading.textContent);
    expect(names).toEqual(['Summary', 'Tasks by status', 'Answers by engine', 'Missing answers']);
  });

  it('a keyword run shows neither section', async () => {
    detailIsGone();
    const served = serveCoverage({ by_engine: [engineRow('chatgpt_web')], missing: [] });
    renderWithProviders(inspectorOf('keyword_metrics'));
    expect(await screen.findByRole('heading', { name: 'Tasks by status' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Answers by engine' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Missing answers' })).toBeNull();
    // The workload check is also what keeps the page from asking a keyword run for answers: the API refuses with 422
    expect(served.asked()).toBe(0);
  });

  it('a coverage error shows Retry and keeps the summary', async () => {
    detailIsGone();
    const served = serveCoverage(null);
    const view = renderWithProviders(inspectorOf('ai_prompt'));
    expect(await screen.findByText('Answers per engine did not load')).toBeInTheDocument();
    // The run's own sections stay
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByText('Trigger')).toBeInTheDocument();
    // One error for the one read, not one per section (the detail read of this test fails too, in its own section)
    expect(screen.getAllByText('Answers per engine did not load')).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Missing answers' })).toBeNull();
    const section = screen.getByRole('heading', { name: 'Answers by engine' }).closest('section');
    if (section === null) throw new Error('no section');
    expect(within(section).getAllByRole('button', { name: 'Try again' })).toHaveLength(1);

    served.answer({ by_engine: [engineRow('chatgpt_web')], missing: [] });
    await view.user.click(within(section).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('141 of 150 answers valid, 94%')).toBeInTheDocument();
    expect(screen.queryByText('Answers per engine did not load')).toBeNull();
  });
});
