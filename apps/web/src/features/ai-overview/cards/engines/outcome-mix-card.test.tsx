import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OutcomeMixCard from './outcome-mix-card';
import { cell, engine, promptRow, summaryOf } from '../competitors/model/summary-fixtures';
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

describe('the answer outcomes card', () => {
  it('draws a 100% bar for each platform of the scope, with the answers and the four exact shares', async () => {
    serve(platform('chatgpt_web', 50, [6, 5, 4, 35]), platform('gemini_web', 20, [2, 2, 2, 14]));
    renderCard('cmp=off');
    const bar = await screen.findByRole('img', {
      name: 'Mentioned and cited 12%, Mentioned only 10%, Cited only 8%, Neither 70%',
    });
    const row = bar.closest('[data-slot="outcome-row"]') as HTMLElement;
    expect(within(row).getByText('50 answers')).toBeInTheDocument();
    expect(within(row).getByText('ChatGPT')).toBeInTheDocument();
    expect(screen.getByText('by platform')).toBeInTheDocument();
    expect(
      screen.getAllByRole('img').filter((node) => node.getAttribute('aria-label')?.includes('Neither')),
    ).toHaveLength(2);
  });

  it('keeps the four shares at 100% of the valid answers', async () => {
    serve(platform('chatgpt_web', 50, [6, 5, 4, 35]));
    renderCard('cmp=off&engine=chatgpt_web');
    const bar = await screen.findByRole('img', { name: /Neither 70%/ });
    const segments = bar.querySelectorAll('[data-slot="outcome-segment"]');
    const total = [...segments].reduce((sum, node) => sum + Number.parseFloat((node as HTMLElement).style.width), 0);
    expect(total).toBeCloseTo(100);
    expect(screen.getByText('ChatGPT', { selector: 'span' })).toBeInTheDocument();
  });

  it('leaves out a platform with fewer than 4 valid answers instead of drawing an empty row', async () => {
    serve(platform('chatgpt_web', 50, [6, 5, 4, 35]), platform('gemini_web', 3, [1, 1, 0, 1]));
    renderCard('cmp=off');
    await screen.findByRole('img', { name: /Neither 70%/ });
    expect(
      screen.getAllByRole('img').filter((node) => node.getAttribute('aria-label')?.includes('Neither')),
    ).toHaveLength(1);
    expect(screen.queryByText('Gemini')).not.toBeInTheDocument();
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
