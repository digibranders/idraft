import { screen, waitFor, within } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineCells, summaryHandler, summaryOf, topicRow, vocabularyHandlers } from './topic-card-test-kit';
import TopicExtremesCard from './topic-extremes-card';
import { CardInfoProvider } from '@/components/app/chart/card-info';
import type { CardProps } from '@/features/layouts';
import type { PromptsSummary } from '@/lib/api/types';
import { cardInOverview } from '@/test/ai-overview-harness';
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

const id = (place: number): string =>
  `${String(place).repeat(8)}-${String(place).repeat(4)}-4${String(place).repeat(3)}-8${String(place).repeat(3)}-${String(place).repeat(12)}`;
const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
const TERMS = NAMES.map((name, place) => ({ id: id(place + 1), name, parent: null }));

const outcomes = (k: number, n: number) =>
  ({ both: [k, n], named: [0, n], cited: [0, n], neither: [n - k, n] }) as const;

/** Group `place` has a visibility of 90%, 70%, 50%, 30%, 20% and 10% of 10 answers on ChatGPT and the same on Gemini. */
const RATES = [9, 7, 5, 3, 2, 1];
const group = (place: number, thinGemini = false) =>
  topicRow(id(place + 1), NAMES[place] ?? '', place + 3, [
    engineCells('chatgpt_web', {
      mentioned: [RATES[place] ?? 0, 10],
      outcomes: outcomes(RATES[place] ?? 0, 10),
      prompts: place + 3,
    }),
    engineCells('gemini_web', {
      mentioned: thinGemini ? [1, 3] : [RATES[place] ?? 0, 10],
      outcomes: thinGemini ? outcomes(1, 3) : outcomes(RATES[place] ?? 0, 10),
      prompts: place + 3,
    }),
  ]);

const SUMMARY: PromptsSummary = {
  ...summaryOf({ topics: NAMES.map((_, place) => group(place)), prompts: [] }),
  total: {
    prompt_count: 40,
    last_observed_at: null,
    last_valid_at: null,
    engines: [
      engineCells('chatgpt_web', { mentioned: [40, 100], outcomes: outcomes(40, 100), prompts: 40 }),
      engineCells('gemini_web', { mentioned: [30, 100], outcomes: outcomes(30, 100), prompts: 40 }),
    ],
  },
};

function InfoCard(props: CardProps): ReactElement {
  return (
    <CardInfoProvider>
      <TopicExtremesCard {...props} />
    </CardInfoProvider>
  );
}

function render({ summary = SUMMARY, searchParams = '' }: { summary?: PromptsSummary; searchParams?: string } = {}) {
  server.use(...vocabularyHandlers(TERMS), summaryHandler(summary));
  return renderWithProviders(
    cardInOverview({ type: 'ai.topic_extremes', Card: InfoCard as ComponentType<CardProps>, width: 'third' }),
    { searchParams },
  );
}

const list = async (name: RegExp): Promise<HTMLElement> => screen.findByRole('list', { name });
const labels = (items: HTMLElement): string[] =>
  within(items)
    .getAllByRole('listitem')
    .map((item) => /^[A-Za-z]+/.exec(item.textContent)?.[0] ?? '');

describe('the strongest and weakest groups', () => {
  it('lists 3 a side for 6 groups, strongest high to low and weakest low to high, by the platform average', async () => {
    render();
    expect(await screen.findByRole('heading', { name: 'Strongest and weakest groups' })).toBeInTheDocument();
    const strongest = await list(/^Strongest groups by AI visibility rate/);
    expect(labels(strongest)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    const weakest = await list(/^Weakest groups by AI visibility rate/);
    expect(labels(weakest)).toEqual(['Foxtrot', 'Echo', 'Delta']);
    expect(within(strongest).getAllByText('90%').length).toBeGreaterThan(0);
    expect(within(strongest).getByText('3 prompts')).toBeInTheDocument();
  });

  it('names the measure as written in its meta and ranks the average of the platforms that show a rate', async () => {
    render({ summary: { ...SUMMARY, topics: NAMES.map((_, place) => group(place, place === 0)) } });
    await list(/^Strongest groups/);
    expect(screen.getByText('AI visibility rate')).toBeInTheDocument();
    expect(screen.queryByText('ai visibility rate')).not.toBeInTheDocument();
    // Alpha has a rate on ChatGPT only (Gemini has 3 answers): its average is that platform alone
    const tip = (await screen.findAllByText(/Alpha: 90%, equal weight average of ChatGPT\. ChatGPT 9 of 10 answers$/))
      .length;
    expect(tip).toBeGreaterThan(0);
  });

  it('reads the measure of the page', async () => {
    render({ searchParams: 'metric=mention' });
    await list(/^Strongest groups by Mention rate/);
  });

  it('says there are not enough groups under 4 with a rate', async () => {
    render({ summary: { ...SUMMARY, topics: [group(0), group(1), group(2)] } });
    expect(await screen.findByText('Not enough groups')).toBeInTheDocument();
    expect(screen.getByText('At least 4 groups with a rate are needed.')).toBeInTheDocument();
  });

  it('keeps the card info behind the i button', async () => {
    const { user } = render();
    await list(/^Strongest groups/);
    await user.click(await screen.findByRole('button', { name: 'About Strongest and weakest groups' }));
    expect(await screen.findByText('The groups where your brand does best and worst.')).toBeInTheDocument();
  });
});

describe('with one group chosen: the group against all groups', () => {
  const GROUP = `topic=${id(1)}`;

  it('is drawn in the same card with the group in its title, never a placeholder', async () => {
    render({ searchParams: GROUP });
    expect(await screen.findByRole('heading', { name: 'Alpha vs all groups' })).toBeInTheDocument();
    expect(screen.queryByText('Strongest')).not.toBeInTheDocument();
  });

  it('has a block per platform and the average, with the rate of all groups', async () => {
    render({ searchParams: GROUP });
    const items = await screen.findAllByRole('listitem');
    const names = items.map((item) => item.querySelector('span')?.textContent);
    expect(names).toEqual(['ChatGPT', 'Gemini', 'Google AI Overview', 'Average']);
    // Alpha 90% on ChatGPT against 40% of all groups
    expect(await screen.findByText('All groups 40%')).toBeInTheDocument();
    expect(screen.getByText('All groups 30%')).toBeInTheDocument();
    expect(screen.getByText('Not collected yet')).toBeInTheDocument();
  });

  it('shows every platform whatever the page platform says', async () => {
    render({ searchParams: `${GROUP}&engine=gemini_web` });
    await screen.findByRole('heading', { name: 'Alpha vs all groups' });
    expect(await screen.findAllByRole('listitem')).toHaveLength(4);
  });

  it('shows no rate for a platform under 4 valid answers in the group and says why', async () => {
    render({ searchParams: GROUP, summary: { ...SUMMARY, topics: NAMES.map((_, place) => group(place, true)) } });
    expect((await screen.findAllByText('Not enough data')).length).toBeGreaterThan(0);
  });

  it('shows the difference as a trend icon: ahead, behind or level, with the figures and the untested note in its words', async () => {
    render({ searchParams: GROUP });
    await screen.findByRole('heading', { name: 'Alpha vs all groups' });
    // Alpha is 90% on ChatGPT against 40% of all groups
    // 9 of 10 answers against all groups' counts: detectable, so the icon is coloured and the words say so
    expect(
      (
        await screen.findAllByText(
          'Alpha is 50.0 pts above all groups: 90% against 40%. Detectable: its 95% interval excludes zero.',
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(document.querySelector('[data-slot="gap-icon"][data-direction="up"]')).not.toBeNull();
  });

  it('has the counts of every rate in its tooltip text for screen readers', async () => {
    render({ searchParams: GROUP });
    await screen.findByRole('heading', { name: 'Alpha vs all groups' });
    expect(await screen.findByText(/ChatGPT: 90%, 9 of 10 answers/)).toBeInTheDocument();
  });

  it('has a Table view with both rates and their counts', async () => {
    const { user } = render({ searchParams: GROUP });
    await screen.findByRole('heading', { name: 'Alpha vs all groups' });
    await user.click(await screen.findByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: 'Alpha against all groups' });
    await waitFor(() => {
      expect(within(table).getAllByRole('row').length).toBe(5);
    });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Platform', 'This group', 'All groups']);
  });
});
