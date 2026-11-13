import { screen, waitFor, within } from '@testing-library/react';
import { getResponse, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handlers } from '@/mocks/handlers';
import { mswPath } from '@/mocks/respond';
import { overviewAs } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { gate } from '@/test/gate';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

/*
 * The states of the AI visibility page that the notices, the empty states and the freshness add (WP-33 T9): which
 * one the page shows for which project, and that the page keeps its shape while it refetches.
 */

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));

const NOW = new Date('2026-11-12T12:00:00Z');
const ENGINES = mswPath('/api/v1/workspaces/:w/projects/:p/engines');
const SUMMARY = mswPath('/api/v1/workspaces/:w/projects/:p/ai/prompts-summary');
const SCHEDULES = mswPath('/api/v1/workspaces/:w/projects/:p/schedules');
const STRIP = /^AI visibility numbers for /;
const CARDS = 'AI visibility cards';

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The answer of the default handlers to the same request, to change a part of it. */
async function defaultJson(request: Request): Promise<Record<string, unknown>> {
  const response = await getResponse([...handlers], new Request(request.url, { headers: request.headers }));
  if (response === undefined) throw new Error('No default handler answers this request');
  return (await response.json()) as Record<string, unknown>;
}

/** Every call of the freshness read (one row `total`, no rows) answered with `total` changed by `patch`. */
function freshnessIs(patch: { last_observed_at: string | null; last_valid_at: string | null }): void {
  server.use(
    http.get(SUMMARY, async ({ request }) => {
      if (new URL(request.url).searchParams.get('rows') !== 'none') return undefined;
      const body = await defaultJson(request);
      const data = body.data as { total?: Record<string, unknown> };
      return HttpResponse.json({ ...body, data: { ...data, total: { ...data.total, ...patch } } });
    }),
  );
}

/**
 * The summary of the window with every answer valid, so the notice for answers that are not valid has nothing to
 * say (the Fynix world has some, as a real project does).
 */
function withoutInvalidAnswers(): void {
  server.use(
    http.get(SUMMARY, async ({ request }) => {
      if (new URL(request.url).searchParams.get('rows') === 'none') return undefined;
      const body = await defaultJson(request);
      const data = body.data as { prompts: { engines: { mentioned: { denominator: number } }[] }[] };
      const prompts = data.prompts.map((prompt) => ({
        ...prompt,
        engines: prompt.engines.map((engine) => ({
          ...engine,
          mentioned: { ...engine.mentioned, n_observations: engine.mentioned.denominator },
        })),
      }));
      return HttpResponse.json({ ...body, data: { ...data, prompts } });
    }),
  );
}

const precedes = (first: Element, second: Element): boolean =>
  (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('the setup slot of the AI visibility page', () => {
  it('renders without the slot', async () => {
    renderWithProviders(overviewAs('admin'));
    expect(await screen.findByRole('group', { name: STRIP })).toBeInTheDocument();
    expect(screen.queryByText('Setup slot')).not.toBeInTheDocument();
  });

  it('renders the slot between the header and the numbers strip', async () => {
    renderWithProviders(overviewAs('admin', { setupSlot: <p>Setup slot</p> }));
    const strip = await screen.findByRole('group', { name: STRIP });
    const slot = screen.getByText('Setup slot');
    expect(precedes(screen.getByRole('heading', { level: 1 }), slot)).toBe(true);
    expect(precedes(slot, strip)).toBe(true);
  });

  it('is not drawn where the empty state already says the same step: no engine on', async () => {
    renderWithProviders(overviewAs('admin', { world: 'cleanstart', setupSlot: <p>Setup slot</p> }));
    expect(await screen.findByRole('heading', { name: 'No AI engine is on' })).toBeInTheDocument();
    expect(screen.queryByText('Setup slot')).not.toBeInTheDocument();
  });

  it('is not drawn where the empty state already says the same step: no prompts', async () => {
    server.use(
      http.get(ENGINES, async ({ request }) => {
        const body = await defaultJson(request);
        const list = body.data as Record<string, unknown>[];
        return HttpResponse.json({ ...body, data: list.map((engine) => ({ ...engine, active_prompts: 0 })) });
      }),
    );
    renderWithProviders(overviewAs('admin', { setupSlot: <p>Setup slot</p> }));
    expect(await screen.findByRole('heading', { name: 'No prompts are asked yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Topics and prompts' })).toBeInTheDocument();
    expect(screen.queryByText('Setup slot')).not.toBeInTheDocument();
  });
});

describe('the empty states of the AI visibility page', () => {
  it('Cleanstart shows the no engine state and no strip, scope bar or grid, and keeps Customize', async () => {
    renderWithProviders(overviewAs('admin', { world: 'cleanstart' }));
    expect(await screen.findByRole('heading', { name: 'No AI engine is on' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: STRIP })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Scope' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: CARDS })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Customize' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="banner"]')).toHaveLength(0);
  });

  it('a project with engines on and no prompts shows the no prompts state, with no strip and no scope bar', async () => {
    server.use(
      http.get(ENGINES, async ({ request }) => {
        const body = await defaultJson(request);
        const list = body.data as Record<string, unknown>[];
        return HttpResponse.json({ ...body, data: list.map((engine) => ({ ...engine, active_prompts: 0 })) });
      }),
    );
    renderWithProviders(overviewAs('admin'));
    expect(await screen.findByRole('heading', { name: 'No prompts are asked yet' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: STRIP })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Scope' })).not.toBeInTheDocument();
  });

  it('a country with no prompts says so and keeps the scope bar, with Clear location', async () => {
    server.use(
      http.get(SUMMARY, async ({ request }) => {
        if (new URL(request.url).searchParams.get('rows') === 'none') return undefined;
        const body = await defaultJson(request);
        const data = body.data as Record<string, unknown>;
        return HttpResponse.json({ ...body, data: { ...data, prompts: [], topics: [], total: undefined } });
      }),
    );
    renderWithProviders(overviewAs('admin'), { searchParams: '?country=NZ' });
    expect(await screen.findByRole('heading', { name: /^No prompts ask in .+\.$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear location' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Scope' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: STRIP })).not.toBeInTheDocument();
  });
});

describe('the notice region and the freshness of the AI visibility page', () => {
  it('says the scheduled runs are paused, with no other notice', async () => {
    server.use(
      http.get(SCHEDULES, () =>
        HttpResponse.json({
          data: [{ is_active: false, next_run_at: '2026-11-16T00:00:00Z' }],
          page: { offset: 0, limit: 10, total: 1 },
        }),
      ),
    );
    renderWithProviders(overviewAs('admin'));
    expect(await screen.findByText('Scheduled AI runs are paused for this project')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="banner"]')).toHaveLength(1);
  });

  it('names the next run of the schedule before the first answers arrive', async () => {
    freshnessIs({ last_observed_at: null, last_valid_at: null });
    server.use(
      http.get(SCHEDULES, () =>
        HttpResponse.json({
          data: [{ is_active: true, next_run_at: '2026-11-13T02:00:00Z' }],
          page: { offset: 0, limit: 10, total: 1 },
        }),
      ),
    );
    renderWithProviders(overviewAs('admin'));
    // In the project's zone (Berlin)
    expect(await screen.findByText('First answers arrive after Nov 13, 03:00')).toBeInTheDocument();
    expect(screen.getByText('No AI answers yet')).toBeInTheDocument();
  });

  it('says so without a time when no run is scheduled', async () => {
    freshnessIs({ last_observed_at: null, last_valid_at: null });
    renderWithProviders(overviewAs('admin'));
    expect(await screen.findByText(/^No AI answers have been collected yet/)).toBeInTheDocument();
  });

  it('names the engine with the most answers not valid, once, with its counts', async () => {
    renderWithProviders(overviewAs('admin'));
    expect(
      await screen.findByText(/^\d+ of \d+ answers were not valid on (ChatGPT|Gemini) in these 28 days$/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View runs' })).toHaveAttribute('href', '/digibranders/fynix/ops/runs');
    expect(document.querySelectorAll('[data-slot="banner"]')).toHaveLength(1);
  });

  it('warns that the newest valid answer is stale, in the header and in one banner', async () => {
    withoutInvalidAnswers();
    freshnessIs({ last_observed_at: '2026-11-06T02:10:00Z', last_valid_at: '2026-11-06T02:10:00Z' });
    renderWithProviders(overviewAs('admin'));
    expect(await screen.findByText('The newest valid answer is 6 days old')).toBeInTheDocument();
    expect(screen.getByText('Last answer 6 days ago')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="banner"]')).toHaveLength(1);
  });

  it('does not say stale for an answer exactly 5 days old', async () => {
    freshnessIs({ last_observed_at: '2026-11-07T12:00:00Z', last_valid_at: '2026-11-07T12:00:00Z' });
    renderWithProviders(overviewAs('admin'));
    await waitFor(() => {
      expect(screen.getByText(/^AI updated Nov 7, /)).toBeInTheDocument();
    });
    expect(screen.queryByText(/newest valid answer/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Last answer/)).not.toBeInTheDocument();
  });

  it('keeps "AI updated" a fact of the project: an older window does not move it', async () => {
    renderWithProviders(overviewAs('admin'), { searchParams: '?from=2026-10-01&to=2026-10-20' });
    const updated = await screen.findByText(/^AI updated /);
    expect(updated).toHaveTextContent(/^AI updated Nov \d+, \d\d:\d\d$/);
    expect(updated).not.toHaveTextContent('Oct 20');
  });

  it('leaves the freshness out when its read fails, without a banner about it', async () => {
    server.use(
      http.get(SUMMARY, async ({ request }) => {
        if (new URL(request.url).searchParams.get('rows') !== 'none') return undefined;
        return HttpResponse.json(
          { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: 'req-3' },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        );
      }),
    );
    renderWithProviders(overviewAs('admin'));
    await screen.findByRole('group', { name: STRIP });
    await waitFor(() => {
      expect(screen.getByText(/ prompts · 2 engines$/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/^AI updated /)).not.toBeInTheDocument();
    expect(screen.queryByText('No AI answers yet')).not.toBeInTheDocument();
  });
});

describe('the page while it loads and refetches', () => {
  it('holds the shape of the finished page while the engines load: strip, scope bar and grid at their heights', async () => {
    const release = gate();
    server.use(
      http.get(ENGINES, async ({ request }) => {
        await release.promise;
        return getResponse([...handlers], new Request(request.url, { headers: request.headers }));
      }),
    );
    const { container } = renderWithProviders(overviewAs('admin'));
    expect(container.querySelector('.h-metric-strip[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelector('.h-control[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('status', { name: 'Loading AI visibility' })).toBeInTheDocument();
    release.open();
    expect(await screen.findByRole('group', { name: STRIP })).toBeInTheDocument();
  });

  it('keeps the values at full opacity with aria-busy and the bar while a scope change refetches', async () => {
    const { user, container } = renderWithProviders(overviewAs('admin'));
    const strip = await screen.findByRole('group', { name: STRIP });
    await waitFor(() => {
      expect(strip).not.toHaveAttribute('aria-busy');
    });
    const release = gate();
    server.use(
      http.get(SUMMARY, async ({ request }) => {
        await release.promise;
        return getResponse([...handlers], new Request(request.url, { headers: request.headers }));
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'vs previous period' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'No comparison' }));
    await user.click(await screen.findByRole('button', { name: 'Engines: 2 of 2' }));
    await user.click(await screen.findByRole('checkbox', { name: 'ChatGPT' }));
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(container.querySelector('[data-slot="refetch-bar"]')).not.toBeNull();
    });
    const busy = screen.getByRole('group', { name: STRIP });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy.className).not.toMatch(/opacity/);
    expect(container.querySelector('[data-slot="refetch-bar"]')).toHaveAttribute('aria-hidden', 'true');
    // The figures of the scope before are still there while the new ones are read
    expect(within(busy).getAllByRole('definition')[2]).toHaveTextContent(/\d+%/);
    release.open();
    await waitFor(() => {
      expect(container.querySelector('[data-slot="refetch-bar"]')).toBeNull();
    });
    expect(screen.getByRole('region', { name: CARDS })).toBeInTheDocument();
  });
});
