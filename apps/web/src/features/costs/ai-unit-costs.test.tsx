import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UnitCostRow } from './cost-model';
import { CostsScreen } from './costs-screen';
import type { Price, Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

// jsdom has no canvas: the chart of the page is tested with a stand-in
vi.mock('@/components/app/chart/echart', () => ({
  EChart: () => <div data-testid="echart-canvas" />,
}));

const W = '/api/v1/workspaces/{workspace_id}';
const UNIT_COSTS = `${W}/costs/unit-costs`;
const PRICE_BOOK = `${W}/price-book`;
const ENGINES = `${W}/projects/{project_id}/engines`;

const NOW = new Date('2026-09-29T12:00:00Z');
const projects = MOCK_PROJECTS.map((project) => ({ id: project.project_id, slug: project.slug, name: project.name }));
const [fynix, cleanstart] = projects;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixtures have fewer than two projects');

beforeEach(() => {
  vi.setSystemTime(NOW);
  Object.defineProperty(Element.prototype, 'getAnimations', { value: () => [], configurable: true, writable: true });
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(Element.prototype, 'getAnimations');
  server.events.removeAllListeners();
});

function costsAs(role: Role = 'admin'): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <CostsScreen
        workspaceId={MOCK_WORKSPACE.workspace_id}
        workspaceSlug={MOCK_WORKSPACE.slug}
        workspaceName={MOCK_WORKSPACE.name}
        projectSlug="fynix"
        projects={projects}
      />
    </PermissionProvider>
  );
}

/** The unit costs of a project: per engine, the cost of an answer (`null` for none) and the answers counted. */
function unitRow(projectId: string, engines: Readonly<Record<string, readonly [string | null, number]>>): UnitCostRow {
  return {
    project_id: projectId,
    per_tracked_keyword_month: null,
    per_serp_check: null,
    per_active_prompt_month: null,
    per_ai_observation: null,
    extraction_llm_usd: null,
    per_engine: Object.fromEntries(Object.entries(engines).map(([code, [cost]]) => [code, cost])),
    ai_answers_by_engine: Object.fromEntries(Object.entries(engines).map(([code, [, count]]) => [code, count])),
  };
}

const EVENTUS_LIKE = {
  chatgpt_web: ['0.001500', 148],
  gemini_web: ['0.000900', 40],
  google_ai_mode: [null, 0],
} as const;

/** Serves the unit costs: `rows` for the request's query. */
function serveUnitCosts(rows: (query: URLSearchParams) => readonly UnitCostRow[]): URLSearchParams[] {
  const asked: URLSearchParams[] = [];
  server.use(
    http.get(mswPath(UNIT_COSTS), ({ request }) => {
      const query = new URL(request.url).searchParams;
      asked.push(query);
      return HttpResponse.json({ data: rows(query) });
    }),
  );
  return asked;
}

let priceCount = 0;
const aiPrice = (endpoint: string, queue: string, usd: string): Price => ({
  price_id: `0192d1a8-bbbb-7b44-8c2d-${String((priceCount += 1)).padStart(12, '0')}`,
  provider_code: 'dataforseo',
  endpoint,
  price_unit: 'task',
  unit_price_usd: usd,
  conditions: { queue },
  valid_from: '2026-07-01',
  valid_to: null,
  verified_at: '2026-07-01',
  source_url: 'https://dataforseo.com/pricing',
});

/** Serves a price book with the AI endpoints; the requests it gets are returned. */
function servePrices(prices: readonly Price[]): URLSearchParams[] {
  const asked: URLSearchParams[] = [];
  server.use(
    http.get(mswPath(PRICE_BOOK), ({ request }) => {
      asked.push(new URL(request.url).searchParams);
      return HttpResponse.json({ data: prices, page: { limit: 100, offset: 0, total: prices.length } });
    }),
  );
  return asked;
}

async function openTable(): Promise<HTMLElement> {
  return screen.findByRole('table', { name: 'Cost per AI answer' });
}

const cells = (row: HTMLElement): string[] =>
  Array.from(row.querySelectorAll('th, td'), (cell) => cell.textContent ?? '');

describe('Unit costs tab, cost per AI answer', () => {
  it('the unit costs tab lists cost per answer per engine with the answers counted', async () => {
    const asked = serveUnitCosts(() => [unitRow(fynix.id, EVENTUS_LIKE)]);
    renderWithProviders(costsAs(), { searchParams: '?tab=units&project=' + fynix.id });
    const table = await openTable();
    const chatgpt = await within(table).findByRole('row', { name: /ChatGPT/ });
    // The count sits in the figure's cell, under it, so a phone that scrolls the later columns away still shows it
    expect(cells(chatgpt)).toEqual(['ChatGPT', '$0.0015148 answers', 'n/a']);
    expect(within(chatgpt).getByText('148 answers')).toBeVisible();
    expect(cells(within(table).getByRole('row', { name: /Gemini/ }))).toEqual(['Gemini', '$0.000940 answers', 'n/a']);
    expect(within(table).getByRole('row', { name: /Gemini/ })).toHaveTextContent('40 answers');
    // The engines keep the fixed order of every engine list
    expect(
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) => cells(row)[0]),
    ).toEqual(['ChatGPT', 'Gemini', 'Google AI Mode']);
    for (const name of ['Engine', 'Cost per answer and answers counted', 'Provider price']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument();
    }
    expect(within(table).queryByRole('columnheader', { name: 'Answers counted' })).toBeNull();
    expect(within(table).getAllByRole('columnheader')).toHaveLength(3);
    // It sits above the price book table, and says what the figures are
    const prices = await screen.findByRole('table', { name: 'Unit costs' });
    expect(table.compareDocumentPosition(prices) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/Averages of the cost the provider reported/)).toBeInTheDocument();
    // The month is the page's month
    expect(asked.every((query) => query.get('month') === '2026-09')).toBe(true);
  });

  it('lists the engines in the fixed order whatever order the API sent them', async () => {
    serveUnitCosts(() => [
      unitRow(fynix.id, {
        google_ai_mode: ['0.002000', 5],
        gemini_web: ['0.000900', 40],
        chatgpt_web: ['0.001500', 148],
      }),
    ]);
    renderWithProviders(costsAs(), { searchParams: `?tab=units&project=${fynix.id}` });
    const table = await openTable();
    await within(table).findByRole('row', { name: /ChatGPT/ });
    expect(
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) => cells(row)[0]),
    ).toEqual(['ChatGPT', 'Gemini', 'Google AI Mode']);
  });

  it('a project filter narrows the rows and no filter lists one row per project and engine', async () => {
    const asked = serveUnitCosts((query) =>
      [unitRow(fynix.id, EVENTUS_LIKE), unitRow(cleanstart.id, EVENTUS_LIKE)].filter(
        (row) => query.get('filter[project_id]') === null || row.project_id === query.get('filter[project_id]'),
      ),
    );
    const all = renderWithProviders(costsAs(), { searchParams: '?tab=units' });
    const table = await openTable();
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(7));
    expect(within(table).getByRole('columnheader', { name: 'Project' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row', { name: /^Fynix/ })).toHaveLength(3);
    expect(within(table).getAllByRole('row', { name: /^Cleanstart/ })).toHaveLength(3);
    expect(asked.every((query) => !query.has('filter[project_id]'))).toBe(true);
    all.unmount();

    asked.length = 0;
    renderWithProviders(costsAs(), { searchParams: `?tab=units&project=${cleanstart.id}` });
    const narrowed = await openTable();
    await waitFor(() => expect(within(narrowed).getAllByRole('row')).toHaveLength(4));
    // The named project is the scope, so the column that names it is not drawn
    expect(within(narrowed).queryByRole('columnheader', { name: 'Project' })).toBeNull();
    expect(asked.every((query) => query.get('filter[project_id]') === cleanstart.id)).toBe(true);
  });

  it('an engine with no answers reads n/a with the reason, never $0.00', async () => {
    serveUnitCosts(() => [unitRow(fynix.id, EVENTUS_LIKE)]);
    renderWithProviders(costsAs(), { searchParams: `?tab=units&project=${fynix.id}` });
    const table = await openTable();
    const mode = await within(table).findByRole('row', { name: /Google AI Mode/ });
    // The reason is text in the row, not a tooltip
    const [engine, cost, price] = cells(mode);
    expect([engine, price]).toEqual(['Google AI Mode', 'n/a']);
    expect(cost).toMatch(/^n\/a/);
    // No count line for an engine with no answers
    expect(cost).not.toMatch(/answers?$/);
    expect(within(mode).queryByText(/^\d+ answers?$/)).toBeNull();
    expect(within(mode).getByText('No answers with a cost this month')).toBeVisible();
    // No dollar amount that is zero, at any number of places
    expect(table.textContent).not.toMatch(/\$0(\.0+)?(?![\d.])/);
  });

  it('the figures are USD from the micro-dollar string with no float drift', async () => {
    serveUnitCosts(() => [
      unitRow(fynix.id, {
        chatgpt_web: ['0.001200', 3],
        gemini_web: ['0.001234', 7],
        google_ai_mode: ['0.000001', 1],
        google_ai_overview: ['0.300000', 2],
      }),
    ]);
    renderWithProviders(costsAs(), { searchParams: `?tab=units&project=${fynix.id}` });
    const table = await openTable();
    // The figure itself, without the count line under it
    const figure = (name: RegExp): string | undefined =>
      within(within(table).getByRole('row', { name })).getByText(/^\$/).textContent ?? undefined;
    await within(table).findByRole('row', { name: /ChatGPT/ });
    expect(figure(/ChatGPT/)).toBe('$0.0012');
    expect(figure(/Gemini/)).toBe('$0.001234');
    expect(figure(/Google AI Mode/)).toBe('$0.000001');
    expect(figure(/google_ai_overview/)).toBe('$0.30');
  });

  it('the provider price column comes from the price book already read', async () => {
    serveUnitCosts(() => [unitRow(fynix.id, EVENTUS_LIKE)]);
    const asked = servePrices([
      aiPrice('ai_optimization/chat_gpt/llm_scraper', 'priority', '0.002400'),
      aiPrice('ai_optimization/chat_gpt/llm_scraper', 'standard', '0.001200'),
      aiPrice('serp/google/ai_mode', 'standard', '0.001250'),
      aiPrice('serp/google/organic', 'standard', '0.000600'),
    ]);
    renderWithProviders(costsAs(), { searchParams: `?tab=units&project=${fynix.id}` });
    const table = await openTable();
    await waitFor(() => expect(cells(within(table).getByRole('row', { name: /ChatGPT/ }))[2]).toBe('$0.0012'));
    expect(cells(within(table).getByRole('row', { name: /Google AI Mode/ }))[2]).toBe('$0.00125');
    // The book has no price for the Gemini endpoint: n/a, not a guess
    expect(cells(within(table).getByRole('row', { name: /Gemini/ }))[2]).toBe('n/a');
    // No read of its own: the tab asked for the price book once, and for no endpoint of it
    expect(asked).toHaveLength(1);
    expect(asked.every((query) => !query.has('filter[endpoint]'))).toBe(true);
  });

  it('loading shows a skeleton table, error shows Retry and keeps the price table', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fail = false;
    server.use(
      http.get(mswPath(UNIT_COSTS), async () => {
        await gate;
        return fail
          ? HttpResponse.json({ code: 'internal_error', title: 'Internal error', status: 500 }, { status: 500 })
          : HttpResponse.json({ data: [unitRow(fynix.id, EVENTUS_LIKE)] });
      }),
    );
    const loading = renderWithProviders(costsAs(), { searchParams: `?tab=units&project=${fynix.id}` });
    const pending = await openTable();
    expect(pending.querySelector('tbody')).toHaveAttribute('aria-busy', 'true');
    expect(within(pending).queryByRole('row', { name: /ChatGPT/ })).toBeNull();
    release();
    expect(await within(pending).findByRole('row', { name: /ChatGPT/ })).toBeInTheDocument();
    loading.unmount();

    fail = true;
    const { user } = renderWithProviders(costsAs(), { searchParams: `?tab=units&project=${fynix.id}` });
    const section = (await screen.findByRole('heading', { name: 'Cost per AI answer' })).closest('section');
    if (section === null) throw new Error('The unit cost section is missing');
    expect(await within(section).findByText('The costs could not be loaded')).toBeInTheDocument();
    // The price table does not go with it
    expect(await screen.findByRole('table', { name: 'Unit costs' })).toBeInTheDocument();
    fail = false;
    await user.click(within(section).getByRole('button', { name: 'Try again' }));
    expect(await within(section).findByRole('row', { name: /ChatGPT/ })).toBeInTheDocument();
    expect(within(section).queryByText('The costs could not be loaded')).toBeNull();
  });

  it('says there are no AI answers with a cost, and why, when no engine has a figure', async () => {
    serveUnitCosts(() => [
      unitRow(fynix.id, { chatgpt_web: [null, 0], gemini_web: [null, 0], google_ai_mode: [null, 0] }),
    ]);
    renderWithProviders(costsAs(), { searchParams: `?tab=units&project=${fynix.id}` });
    const table = await openTable();
    expect(
      await within(table).findByText(
        'No AI answers with a cost in September 2026. A figure appears once an AI run has collected answers.',
      ),
    ).toBeInTheDocument();
    expect(within(table).queryByText('n/a')).toBeNull();
  });

  it('keeps the rows on screen while another month loads, and marks the region busy', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(mswPath(UNIT_COSTS), async ({ request }) => {
        if (new URL(request.url).searchParams.get('month') === '2026-08') await gate;
        return HttpResponse.json({ data: [unitRow(fynix.id, EVENTUS_LIKE)] });
      }),
    );
    const { user } = renderWithProviders(costsAs(), { searchParams: `?tab=units&project=${fynix.id}` });
    const table = await openTable();
    await within(table).findByRole('row', { name: /ChatGPT/ });
    await user.click(screen.getByRole('combobox', { name: 'Month' }));
    await user.click(await screen.findByRole('option', { name: 'August 2026' }));
    const section = (await screen.findByRole('heading', { name: 'Cost per AI answer' })).closest('section');
    await waitFor(() => expect(section).toHaveAttribute('aria-busy', 'true'));
    // The previous rows stay, at full opacity
    expect(within(table).getByRole('row', { name: /ChatGPT/ })).toBeInTheDocument();
    release();
    await waitFor(() => expect(section).not.toHaveAttribute('aria-busy', 'true'));
  });

  it('keeps the rows and says the refresh failed when a read after a good one fails', async () => {
    let fail = false;
    server.use(
      http.get(mswPath(UNIT_COSTS), () =>
        fail
          ? HttpResponse.json({ code: 'internal_error', title: 'Internal error', status: 500 }, { status: 500 })
          : HttpResponse.json({ data: [unitRow(fynix.id, EVENTUS_LIKE)] }),
      ),
    );
    const { queryClient } = renderWithProviders(costsAs(), { searchParams: `?tab=units&project=${fynix.id}` });
    const table = await openTable();
    await within(table).findByRole('row', { name: /ChatGPT/ });
    fail = true;
    await act(async () => {
      await queryClient.refetchQueries({ predicate: (query) => JSON.stringify(query.queryKey).includes('unit-costs') });
    });
    expect(
      await screen.findByText('These figures could not be refreshed. They are the last ones read.'),
    ).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /ChatGPT/ })).toBeInTheDocument();
  });

  it('names an engine by its code, and asks for no engine list, for a member who cannot read the data', async () => {
    serveUnitCosts(() => [unitRow(fynix.id, EVENTUS_LIKE)]);
    const engineReads: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (new URL(request.url).pathname.endsWith('/engines')) engineReads.push(request.url);
    });
    renderWithProviders(costsAs('billing'), { searchParams: `?tab=units&project=${fynix.id}` });
    const table = await openTable();
    expect(await within(table).findByRole('row', { name: /chatgpt_web/ })).toBeInTheDocument();
    expect(engineReads).toEqual([]);
  });

  it('names the engines from the engine list of a project the member can open', async () => {
    serveUnitCosts(() => [unitRow(fynix.id, { chatgpt_web: ['0.001500', 1] })]);
    server.use(
      http.get(mswPath(ENGINES), () =>
        HttpResponse.json({
          data: [
            {
              engine: {
                engine_code: 'chatgpt_web',
                label: 'ChatGPT (web)',
                observation_class: 'consumer_ui',
                vendor: 'openai',
                exposes_citations: true,
                exposes_fanout: true,
                max_prompt_chars: 2000,
              },
              is_enabled: true,
              location_ids: [],
            },
          ],
        }),
      ),
    );
    renderWithProviders(costsAs(), { searchParams: '?tab=units' });
    const table = await openTable();
    expect(await within(table).findByRole('row', { name: /ChatGPT \(web\)/ })).toBeInTheDocument();
  });

  it('has no accessibility violations at the tab', async () => {
    serveUnitCosts(() => [unitRow(fynix.id, EVENTUS_LIKE), unitRow(cleanstart.id, EVENTUS_LIKE)]);
    const { container } = renderWithProviders(costsAs(), { searchParams: '?tab=units' });
    const table = await openTable();
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(7));
    await screen.findByRole('table', { name: 'Unit costs' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
