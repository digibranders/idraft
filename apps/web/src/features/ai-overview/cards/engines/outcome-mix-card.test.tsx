import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OutcomeMixCard from './outcome-mix-card';
import { cell, engine, promptRow, summaryOf } from '../competitors/model/summary.test-fixtures';
import { CardInfoProvider } from '@/components/app/chart/card-info';
import type { CardProps } from '@/features/layouts';
import type { EngineSummary } from '@/lib/api/types';
import { cardInOverview } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** One platform over `n` valid answers of one prompt, split into the four outcomes. */
function platform(code: string, n: number, split: readonly [number, number, number, number]): EngineSummary {
  const [both, named, cited, neither] = split;
  return engine(code, {
    mentioned: cell(both + named, n),
    cited: cell(both + cited, n),
    outcomes: {
      mentionedAndCited: cell(both, n),
      mentionedOnly: cell(named, n),
      citedOnly: cell(cited, n),
      neither: cell(neither, n),
    },
  });
}

function serve(...engines: EngineSummary[]): void {
  server.use(http.get(SUMMARY, () => HttpResponse.json({ data: summaryOf({ prompts: [promptRow(1, engines)] }) })));
}

function renderCard(searchParams: string) {
  const Card = (props: CardProps): ReactElement => (
    <CardInfoProvider>
      <OutcomeMixCard {...props} />
    </CardInfoProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'ai.outcome_mix', Card, width: 'third' }), { searchParams });
}

describe('the outcome split card', () => {
  it('draws a ring for each platform of the scope, with its visibility rate in the middle, the answers and the four exact shares', async () => {
    serve(platform('chatgpt_web', 50, [6, 5, 4, 35]), platform('gemini_web', 20, [2, 2, 2, 14]));
    renderCard('cmp=off');
    // The rings are one picture that says every platform's four shares in words
    const rings = await screen.findByRole('img', { name: /ChatGPT.*Mentioned and cited 12%.*Neither 70%/ });
    expect(rings).toHaveAccessibleName(/Gemini.*Neither 70%/);
    // Mentioned or cited is 100% minus neither: 30% in the middle of each ring
    expect(within(rings).getAllByText('30%')).toHaveLength(2);
    expect(within(rings).getByText('ChatGPT')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Outcome split by platform' })).toBeInTheDocument();
    // The exact shares and the answers behind them are text under the rings
    expect(screen.getByText('50 answers')).toBeInTheDocument();
    expect(screen.getByText('20 answers')).toBeInTheDocument();
    expect(screen.getAllByText('70%')).toHaveLength(2);
    expect(screen.getByText('12%')).toBeInTheDocument();
  });

  it('draws a fourth ring for Google AI Overview beside the others, with its centre, answers and shares', async () => {
    const requests: URL[] = [];
    server.events.on('request:start', ({ request }) => requests.push(new URL(request.url)));
    serve(
      platform('chatgpt_web', 50, [6, 5, 4, 35]),
      platform('gemini_web', 20, [2, 2, 2, 14]),
      platform('google_ai_mode', 20, [2, 2, 2, 14]),
      platform('google_ai_overview', 12, [3, 1, 2, 6]),
    );
    renderCard('cmp=off');
    const rings = await screen.findByRole('img', { name: /Google AI Overview.*Mentioned and cited 25%.*Neither 50%/ });
    expect(within(rings).getByText('Google AI Overview')).toBeInTheDocument();
    // Mentioned or cited is 100% minus neither: 50% in the middle of the ring
    expect(within(rings).getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('12 answers')).toBeInTheDocument();
    // The ring says what its answers are: one for each prompt with a valid check of its linked keyword
    expect(screen.getByTitle(/one answer for each prompt/i)).toHaveTextContent('12 answers');
    const asked = requests.filter((url) => url.pathname.endsWith('/ai/prompts-summary'));
    expect(asked.some((url) => url.searchParams.get('filter[engine_code_in]')?.includes('google_ai_overview'))).toBe(
      true,
    );
  });

  it('keeps the table view of the platforms with Google AI Overview as a row of its own', async () => {
    serve(platform('chatgpt_web', 50, [6, 5, 4, 35]), platform('google_ai_overview', 12, [3, 1, 2, 6]));
    const { user } = renderCard('cmp=off');
    await user.click((await screen.findAllByRole('button', { name: 'Table' }))[0] as HTMLElement);
    const [table] = await screen.findAllByRole('table', { name: /Share of valid answers by outcome/ });
    expect(within(table as HTMLElement).getByText('Google AI Overview')).toBeInTheDocument();
    expect(within(table as HTMLElement).getByText('25% (3 / 12)')).toBeInTheDocument();
  });

  it('draws the rings as plain rings: no bar of segments is left in the card', async () => {
    serve(platform('chatgpt_web', 50, [6, 5, 4, 35]));
    renderCard('cmp=off&engine=chatgpt_web');
    await screen.findByRole('img', { name: /Neither 70%/ });
    expect(document.querySelector('[data-slot="outcome-segment"]')).toBeNull();
    expect(screen.getByText('50 answers')).toBeInTheDocument();
  });

  it('leaves out a platform with fewer than 4 valid answers instead of drawing an empty ring', async () => {
    serve(platform('chatgpt_web', 50, [6, 5, 4, 35]), platform('gemini_web', 3, [1, 1, 0, 1]));
    renderCard('cmp=off');
    await screen.findByRole('img', { name: /Neither 70%/ });
    expect(screen.queryByText('Gemini')).not.toBeInTheDocument();
    expect(screen.queryByText('3 answers')).not.toBeInTheDocument();
  });

  it('says there is no rate yet when no platform has enough valid answers, and draws no bar', async () => {
    serve(platform('chatgpt_web', 3, [1, 1, 0, 1]));
    renderCard('cmp=off&engine=chatgpt_web');
    expect(await screen.findByText('These prompts have too few valid answers.')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Neither/ })).not.toBeInTheDocument();
  });

  it('puts the pooled answers behind each share in the table view', async () => {
    serve(platform('chatgpt_web', 50, [6, 5, 4, 35]));
    renderCard('cmp=off&engine=chatgpt_web');
    const { user } = renderCard('cmp=off&engine=chatgpt_web');
    await user.click((await screen.findAllByRole('button', { name: 'Table' }))[0] as HTMLElement);
    expect((await screen.findAllByRole('table', { name: /Share of valid answers by outcome/ })).length).toBeGreaterThan(
      0,
    );
  });
});
