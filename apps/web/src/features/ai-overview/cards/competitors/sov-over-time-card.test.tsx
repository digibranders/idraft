import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cell, competitor, engine, entityCells, own, share, summaryOf, week } from './model/summary.test-fixtures';
import SovOverTimeCard from './sov-over-time-card';
import { CardInfoProvider } from '@/components/app/chart/card-info';
import type { CardProps } from '@/features/layouts';
import type { EngineSummary, SummaryEntity } from '@/lib/api/types';
import { cardInOverview } from '@/test/ai-overview-harness';
import { chartSummaryText } from '@/test/chart-summary';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';
const HUBSPOT = competitor(2, 'HubSpot');
const ENTITIES: SummaryEntity[] = [own(), HUBSPOT];

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A week whose `answers` name a tracked brand, you taking `mine` of them. */
const point = (weekStart: string, mine: number, answers: number) =>
  week(weekStart, {
    share: share(mine, answers),
    entities: [
      entityCells(own(), share(mine, answers), share(mine, answers)),
      entityCells(HUBSPOT, share(answers - mine, answers), share(answers - mine, answers)),
    ],
  });

const WEEKS = ['2026-10-19', '2026-10-26', '2026-11-02'];

function platform(code: string, mine: number): EngineSummary {
  return engine(code, {
    mentioned: cell(mine, 10),
    share: share(mine, 10),
    entities: [
      entityCells(own(), share(mine, 10), share(mine, 10)),
      entityCells(HUBSPOT, share(10 - mine, 10), share(10 - mine, 10)),
    ],
    series: WEEKS.map((weekStart) => point(weekStart, mine, 10)),
  });
}

function serve(...total: EngineSummary[]): void {
  server.use(http.get(SUMMARY, () => HttpResponse.json({ data: summaryOf({ entities: ENTITIES, total }) })));
}

function renderCard(searchParams: string, options: Record<string, string> = {}) {
  const Card = (props: CardProps): ReactElement => (
    <CardInfoProvider>
      <SovOverTimeCard {...props} options={{ ...props.options, ...options }} />
    </CardInfoProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'ai.sov_over_time', Card }), { searchParams });
}

describe('the share of voice over time card follows the page scope', () => {
  it('draws one platform with no engine option, and says it is stacked to 100%', async () => {
    serve(platform('chatgpt_web', 6), platform('gemini_web', 2));
    renderCard('cmp=off&engine=chatgpt_web');
    const heading = await screen.findByRole('heading', { level: 2, name: 'Share of voice over time' });
    expect(await screen.findByText('stacked to 100%')).toBeInTheDocument();
    expect(chartSummaryText(heading)).toMatch(/you hold 60%/);
  });

  it('is the week by week average of the platforms for All platforms, never pooled, and says how many', async () => {
    serve(platform('chatgpt_web', 6), platform('gemini_web', 2));
    renderCard('cmp=off', { engine: 'gemini_web' });
    const heading = await screen.findByRole('heading', { level: 2, name: 'Share of voice over time' });
    expect(await screen.findByText('average of 2 platforms, stacked to 100%')).toBeInTheDocument();
    // (60% + 20%) / 2
    expect(chartSummaryText(heading)).toMatch(/you hold 40%/);
  });

  it('says a trend needs two weeks, and draws no zero, when only one week has answers', async () => {
    const one = engine('chatgpt_web', {
      mentioned: cell(6, 10),
      share: share(6, 10),
      entities: [entityCells(own(), share(6, 10), share(6, 10)), entityCells(HUBSPOT, share(4, 10), share(4, 10))],
      series: [point('2026-10-19', 6, 10)],
    });
    serve(one);
    renderCard('cmp=off&engine=chatgpt_web');
    expect(await screen.findByText('A trend needs two weeks of answers')).toBeInTheDocument();
  });
});

describe('the share of voice over time card without its weekly cells', () => {
  it('says Not collected yet, with its reason and no Retry, when the API sends no per-brand weekly cells', async () => {
    // The totals are read, but no platform carries a weekly series (backend request 10)
    const bare = (code: string): EngineSummary =>
      engine(code, {
        mentioned: cell(6, 10),
        share: share(6, 10),
        entities: [entityCells(own(), share(6, 10), share(6, 10)), entityCells(HUBSPOT, share(4, 10), share(4, 10))],
      });
    serve(bare('chatgpt_web'), bare('gemini_web'));
    renderCard('cmp=off');
    expect(await screen.findByRole('heading', { level: 2, name: 'Share of voice over time' })).toBeInTheDocument();
    expect(await screen.findByText('Not collected yet')).toBeInTheDocument();
    expect(screen.getByText(/weekly share of voice of each tracked brand is not collected yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Could not load/)).not.toBeInTheDocument();
  });

  it('says Not collected yet too when the weekly series is there but no week carries a cell for a tracked brand', async () => {
    const withoutCells = (code: string): EngineSummary =>
      engine(code, {
        mentioned: cell(6, 10),
        share: share(6, 10),
        entities: [entityCells(own(), share(6, 10), share(6, 10)), entityCells(HUBSPOT, share(4, 10), share(4, 10))],
        series: WEEKS.map((weekStart) => week(weekStart, { share: share(6, 10) })),
      });
    serve(withoutCells('chatgpt_web'));
    renderCard('cmp=off&engine=chatgpt_web');
    expect(await screen.findByText('Not collected yet')).toBeInTheDocument();
    expect(screen.queryByText('Could not load share of voice over time')).not.toBeInTheDocument();
  });

  it('still shows the error with Try again when the read itself fails', async () => {
    server.use(
      http.get(SUMMARY, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: 'req-sov' },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    renderCard('cmp=off');
    expect(await screen.findByText('Could not load share of voice over time')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText('Not collected yet')).not.toBeInTheDocument();
  });
});
