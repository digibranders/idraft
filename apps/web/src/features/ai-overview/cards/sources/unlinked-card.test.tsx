import { screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import UnlinkedMentionsCard from './unlinked-card';
import {
  engineCells,
  promptRow,
  summaryHandler,
  summaryOf,
  topicRow,
  vocabularyHandlers,
  type TermSpec,
} from '../topics/topic-card-test-kit';
import { CardInfoProvider } from '@/components/app/chart/card-info';
import type { CardProps } from '@/features/layouts';
import type { PromptSummaryRow } from '@/lib/api/types';
import { cardInOverview } from '@/test/ai-overview-harness';
import { axe } from '@/test/axe';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const PRICING = '22222222-2222-4222-8222-222222222222';
const TERMS: TermSpec[] = [{ id: PRICING, name: 'Pricing', parent: null }];

/** A prompt on ChatGPT: `n` valid answers, `named` of them mention the brand and cite none of its pages. */
const prompt = (id: string, text: string, n: number, named: number): PromptSummaryRow =>
  promptRow(
    id,
    text,
    [PRICING],
    [
      engineCells('chatgpt_web', {
        mentioned: [named + 1, n],
        outcomes: { both: [1, n], named: [named, n], cited: [0, n], neither: [n - named - 1, n] },
      }),
    ],
  );

function render(prompts: PromptSummaryRow[]): ReturnType<typeof renderWithProviders> {
  server.use(
    ...vocabularyHandlers(TERMS),
    summaryHandler(summaryOf({ prompts, topics: [topicRow(PRICING, 'Pricing', prompts.length, [])] })),
  );
  const Card = (props: CardProps): ReactElement => (
    <CardInfoProvider>
      <UnlinkedMentionsCard {...props} />
    </CardInfoProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'ai.unlinked_mentions', Card, width: 'half' }), {
    searchParams: 'cmp=off',
  });
}

describe('the mentioned, not cited card', () => {
  it('lists the prompts with a mention and no citation, the largest share first, with the counts and the group', async () => {
    render([
      prompt('p1', 'Pricing compared', 8, 3),
      prompt('p2', 'Best tool for teams', 10, 6),
      prompt('p3', 'All cited', 10, 0),
    ]);
    const list = await screen.findByRole('list', {
      name: 'Prompts that mention your brand without citing your site, by the share of their answers',
    });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByText('Best tool for teams')).toBeInTheDocument();
    expect(within(items[0] as HTMLElement).getByText('6 of 10 answers')).toBeInTheDocument();
    expect(within(items[0] as HTMLElement).getByText('Pricing')).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText('3 of 8 answers')).toBeInTheDocument();
    const bar = items[0]?.querySelector('[data-slot="unlinked-bar"]') as HTMLElement;
    expect(bar.style.width).toBe('60%');
    expect(screen.getByText('prompts that mention you without citing you')).toBeInTheDocument();
  });

  it('links View prompts to the Prompts page and each prompt to its inspector', async () => {
    render([prompt('p1', 'Pricing compared', 8, 3)]);
    const view = await screen.findByRole('link', { name: 'View prompts' });
    expect(view.getAttribute('href')).toContain('/ai/prompts');
    const row = await screen.findByRole('link', { name: 'Pricing compared' });
    expect(row.getAttribute('href')).toContain('p1');
  });

  it('keeps its header and says the preview reason when no prompt mentions without a citation', async () => {
    render([prompt('p1', 'All cited', 10, 0)]);
    expect(await screen.findByRole('heading', { name: 'Mentioned, not cited' })).toBeInTheDocument();
    expect(await screen.findByText('No mentions without a citation')).toBeInTheDocument();
    expect(
      screen.getByText('Every answer that mentions the brand also cites it, or there are too few answers.'),
    ).toBeInTheDocument();
  });

  it('does not list a prompt with fewer than 4 valid answers', async () => {
    render([prompt('p1', 'Too few', 3, 2), prompt('p2', 'Enough', 5, 1)]);
    await screen.findByText('Enough');
    await waitFor(() => expect(screen.queryByText('Too few')).not.toBeInTheDocument());
  });

  it('has the preview info text and passes axe', async () => {
    const { container } = render([prompt('p1', 'Pricing compared', 8, 3)]);
    await screen.findByText('Pricing compared');
    expect(
      screen.getByText(/Counted per prompt, from the answers that mention your brand without citing your site\./),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
