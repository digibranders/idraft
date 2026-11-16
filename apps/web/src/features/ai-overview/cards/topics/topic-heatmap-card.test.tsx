import { http, type RequestHandler } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetDrill } from './group-drill';
import { engineCells, promptRow, summaryHandler, summaryOf, topicRow, vocabularyHandlers } from './topic-card-test-kit';
import TopicHeatmapCard from './topic-heatmap-card';
import { CardInfoProvider } from '@/components/app/chart/card-info';
import type { CardProps } from '@/features/layouts';
import type { PromptsSummary } from '@/lib/api/types';
import { CARD_ID, cardInOverview } from '@/test/ai-overview-harness';
import { axe } from '@/test/axe';
import { stubViewport } from '@/test/customize-harness';
import { gate } from '@/test/gate';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
  forgetDrill();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const CRM = '11111111-1111-4111-8111-111111111111';
const PRICING = '22222222-2222-4222-8222-222222222222';
const SECURITY = '33333333-3333-4333-8333-333333333333';
const SUPPORT = '44444444-4444-4444-8444-444444444444';

// CRM has Pricing below it: CRM is no row of its own, Pricing is
const TERMS = [
  { id: CRM, name: 'CRM', parent: null },
  { id: PRICING, name: 'Pricing', parent: CRM },
  { id: SECURITY, name: 'Security', parent: null },
  { id: SUPPORT, name: 'Support', parent: null },
];

/** The four outcomes of `k` answers that name or cite the brand in `n`, the rest neither. */
const outcomes = (k: number, n: number) =>
  ({ both: [k, n], named: [0, n], cited: [0, n], neither: [n - k, n] }) as const;

/**
 * Fynix asks ChatGPT and Gemini. Counts are `[k, n]` of valid answers; a topic cell weights prompts. Security on
 * ChatGPT is 80% of 10 answers over 9 prompts; Support on ChatGPT has 3 answers; the prompts without a group have none.
 */
const TOPICS = [
  topicRow(CRM, 'CRM', 17, [
    engineCells('chatgpt_web', { mentioned: [64, 136], outcomes: outcomes(70, 136), prompts: 17 }),
    engineCells('gemini_web', { mentioned: [30, 100], outcomes: outcomes(40, 100), prompts: 17 }),
  ]),
  topicRow(PRICING, 'Pricing', 6, [
    engineCells('chatgpt_web', { mentioned: [30, 60], cited: [6, 60], outcomes: outcomes(33, 60), prompts: 6 }),
    engineCells('gemini_web', { mentioned: [12, 40], outcomes: outcomes(16, 40), prompts: 6 }),
  ]),
  topicRow(SECURITY, 'Security', 9, [
    engineCells('chatgpt_web', { mentioned: [8, 10], outcomes: outcomes(9, 10), prompts: 9 }),
    engineCells('gemini_web', { mentioned: [18, 50], outcomes: outcomes(20, 50), prompts: 9 }),
  ]),
  topicRow(SUPPORT, 'Support', 4, [
    engineCells('chatgpt_web', { mentioned: [2, 3], outcomes: outcomes(2, 3), prompts: 4 }),
    engineCells('gemini_web', { mentioned: [8, 20], outcomes: outcomes(10, 20), prompts: 4 }),
  ]),
  topicRow(null, null, 3, []),
];
const PROMPTS = [
  promptRow(
    'p1',
    'Best CRM for startups',
    [PRICING],
    [
      engineCells('chatgpt_web', { mentioned: [9, 10], cited: [3, 10], outcomes: outcomes(9, 10) }),
      engineCells('gemini_web', { mentioned: [2, 10], cited: [1, 10], outcomes: outcomes(3, 10) }),
    ],
  ),
  promptRow(
    'p2',
    'CRM pricing compared',
    [PRICING, SECURITY],
    [engineCells('chatgpt_web', { mentioned: [1, 10], cited: [0, 10], outcomes: outcomes(1, 10) })],
  ),
  promptRow('p3', 'Thin prompt', [PRICING], [engineCells('chatgpt_web', { mentioned: [2, 3] })]),
  promptRow('p4', 'Unfiled', [], []),
];

/** The summary of every group: the groups with the total of all groups, for the group against all groups. */
const SUMMARY: PromptsSummary = {
  ...summaryOf({ topics: TOPICS, prompts: PROMPTS }),
  total: {
    prompt_count: 40,
    last_observed_at: null,
    last_valid_at: null,
    engines: [
      engineCells('chatgpt_web', { mentioned: [50, 100], outcomes: outcomes(60, 100), prompts: 40 }),
      engineCells('gemini_web', { mentioned: [25, 100], outcomes: outcomes(30, 100), prompts: 40 }),
    ],
  },
};

/** The card as the screen draws it: its footnote behind the i button. */
function InfoCard(props: CardProps): ReactElement {
  return (
    <CardInfoProvider>
      <TopicHeatmapCard {...props} />
    </CardInfoProvider>
  );
}

interface Setup {
  summary?: PromptsSummary;
  searchParams?: string;
  /** Handlers that answer before the ones of the card's data. */
  extra?: RequestHandler[];
}

function render({ summary = SUMMARY, searchParams = '', extra = [] }: Setup = {}) {
  server.use(...vocabularyHandlers(TERMS), summaryHandler(summary), ...extra);
  const urls: string[] = [];
  const view = renderWithProviders(
    cardInOverview({
      type: 'ai.topic_heatmap',
      Card: InfoCard as ComponentType<CardProps>,
      width: 'full',
    }),
    { searchParams, onUrlUpdate: (event) => urls.push(event.queryString) },
  );
  return { ...view, urls };
}

const grid = async (): Promise<HTMLElement> =>
  waitFor(() => {
    const found = document.querySelector<HTMLElement>('table[role="grid"], table[role="treegrid"]');
    if (found === null || within(found).queryAllByRole('rowheader').length === 0) throw new Error('no grid yet');
    return found;
  });
const rowNames = async (): Promise<string[]> =>
  within(await grid())
    .getAllByRole('rowheader')
    .map((header) => header.getAttribute('aria-label') ?? '');
const headers = async (): Promise<string[]> =>
  within(await grid())
    .getAllByRole('columnheader')
    .map((header) => header.textContent);
const cell = async (name: RegExp): Promise<HTMLElement> => within(await grid()).findByRole('gridcell', { name });
const link = async (name: RegExp): Promise<HTMLElement> => within(await grid()).findByRole('link', { name });
const queryOf = (urls: readonly string[]): URLSearchParams => new URLSearchParams(urls.at(-1) ?? '');

describe('the groups heat map', () => {
  it('is one flat level of groups, in tree order, with no row for a group that has groups below it', async () => {
    render();
    expect(await rowNames()).toEqual(['Pricing', 'Security', 'Support']);
  });

  it('has a column per platform in order, the AI Overview column and then the average of the two collected', async () => {
    render();
    expect(await headers()).toEqual(['Group', 'Prompts', 'ChatGPT', 'Gemini', 'AI Overview', 'avg of 2']);
  });

  it('has no average column from one platform', async () => {
    render({ searchParams: 'engine=chatgpt_web' });
    // The page's platform does not narrow the columns: every platform is read
    expect(await headers()).toEqual(['Group', 'Prompts', 'ChatGPT', 'Gemini', 'AI Overview', 'avg of 2']);
  });

  it('says AI Overview is not collected yet in every row and never prints a rate there', async () => {
    render();
    const overview = await cell(/^Security on AI Overview/);
    expect(overview).toHaveTextContent('n/a');
    expect(overview.getAttribute('aria-label')).toBe('Security on AI Overview: not collected yet');
    expect(within(overview).queryByRole('link')).not.toBeInTheDocument();
  });

  it('draws AI visibility from the outcome cells by default, with its counts in the cell name', async () => {
    render();
    const security = await link(/^Security on ChatGPT/);
    expect(security).toHaveTextContent('90%');
    expect(security.getAttribute('aria-label')).toMatch(/90\.0%, 9 of 10 answers/);
  });

  it('hatches a cell under 4 answers, prints its count and no percent', async () => {
    render();
    const thin = (await cell(/^Support on ChatGPT/)).closest('td');
    expect(thin).toHaveClass('bg-insufficient');
    expect(thin).toHaveTextContent('3 ans');
    expect(thin?.textContent).not.toContain('%');
  });

  it('averages the platforms with a rate and names them in the cell', async () => {
    render();
    const security = await link(/^Security, avg of 2/);
    expect(security.getAttribute('aria-label')).toMatch(/Equal weight average of ChatGPT and Gemini/);
    const support = await link(/^Support, 1 platform/);
    expect(support.getAttribute('aria-label')).toMatch(/Gemini only/);
  });

  it('has the four measures as tabs, Visibility first, and a tab writes the page key', async () => {
    const { user, urls } = render();
    await grid();
    const tabs = screen.getByRole('radiogroup', { name: 'Metric' });
    expect(
      within(tabs)
        .getAllByRole('radio')
        .map((radio) => radio.parentElement?.textContent ?? radio.getAttribute('aria-label')),
    ).toHaveLength(4);
    expect(within(tabs).getByRole('radio', { name: 'Visibility' })).toBeChecked();
    await user.click(within(tabs).getByRole('radio', { name: 'Mention' }));
    await waitFor(() => {
      expect(queryOf(urls).get('metric')).toBe('mention');
    });
    // The meta says the label as written
    expect(await screen.findByText('Mention rate')).toBeInTheDocument();
  });

  it('writes the label of the measure as written, not in lower case', async () => {
    render();
    await grid();
    expect(await screen.findByText('AI visibility rate')).toBeInTheDocument();
    expect(screen.queryByText('ai visibility rate')).not.toBeInTheDocument();
  });

  it('reads the mention cells for the mention measure', async () => {
    render({ searchParams: 'metric=mention' });
    expect(await link(/^Security on ChatGPT/)).toHaveTextContent('80%');
  });

  it('keeps its info text behind the i button, and keeps the overlap footnote true', async () => {
    const { user } = render();
    await grid();
    await user.click(await screen.findByRole('button', { name: 'About Groups by platform' }));
    const popover = await screen.findByRole('dialog', { name: 'About Groups by platform' });
    expect(within(popover).getByText('How each group of prompts performs on each platform.')).toBeInTheDocument();
    // A prompt can carry several groups for now: the text says so, and the footnote in the document counts them
    expect(popover).toHaveTextContent('may add up to more than the total');
    const frame = screen.getByRole('heading', { name: 'Groups by platform' }).closest('section');
    expect(frame?.textContent).toContain('Groups overlap');
    expect(frame?.textContent).toMatch(/1 prompt is in more than one group/);
    expect(frame?.textContent).toMatch(/not collected yet/);
  });

  it('says why when there is no group', async () => {
    render({ summary: summaryOf({ topics: [topicRow(null, null, 3, [])], prompts: [] }) });
    expect(await screen.findByText('No groups yet')).toBeInTheDocument();
  });
});

describe('opening a group', () => {
  it('a platform cell sets the group and the platform in one step, and the card becomes the prompts of the group', async () => {
    const { user, urls } = render();
    await user.click(await link(/^Security on Gemini/));
    await waitFor(() => {
      expect(queryOf(urls).get('topic')).toBe(SECURITY);
    });
    expect(queryOf(urls).get('engine')).toBe('gemini_web');
    expect(await screen.findByRole('heading', { name: 'Prompts in Security' })).toBeInTheDocument();
  });

  it('a group name and the average cell set the group and keep the platform', async () => {
    const { user, urls } = render({ searchParams: 'engine=chatgpt_web' });
    await user.click(within(await grid()).getByRole('link', { name: 'Security' }));
    await waitFor(() => {
      expect(queryOf(urls).get('topic')).toBe(SECURITY);
    });
    expect(queryOf(urls).get('engine')).toBe('chatgpt_web');
  });

  it('is also a link to the page with the same keys, so it opens in a new tab with the scope kept', async () => {
    render({ searchParams: 'metric=mention&cmp=off' });
    const href = (await link(/^Security on Gemini/)).getAttribute('href') ?? '';
    const url = new URL(href, 'http://localhost');
    expect(url.pathname).toMatch(/\/ai$/);
    expect(url.searchParams.get('topic')).toBe(SECURITY);
    expect(url.searchParams.get('engine')).toBe('gemini_web');
    expect(url.searchParams.get('metric')).toBe('mention');
    expect(url.searchParams.get('cmp')).toBe('off');
  });

  it('has no accessibility violation', async () => {
    render();
    await grid();
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('the prompts of the chosen group', () => {
  it('does not call the group unknown while the vocabulary is still read', async () => {
    const release = gate();
    // A handler that returns nothing hands the request on to the one under it, once the gate is open
    const held = http.get('*/api/v1/workspaces/:w/vocabularies', async () => {
      await release.promise;
    });
    render({ searchParams: `topic=${PRICING}`, extra: [held] });
    expect(await screen.findByRole('heading', { name: 'Prompts in the chosen group' })).toBeInTheDocument();
    expect(screen.queryByText(/Unknown group/)).not.toBeInTheDocument();
    release.open();
    expect(await screen.findByRole('heading', { name: 'Prompts in CRM / Pricing' })).toBeInTheDocument();
  });

  it('has the group in its title, up to its prompts by mention rate, and no prompt under 4 valid answers', async () => {
    render({ searchParams: `topic=${PRICING}` });
    expect(await screen.findByRole('heading', { name: 'Prompts in CRM / Pricing' })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Prompts in CRM / Pricing' });
    const names = within(table)
      .getAllByRole('rowheader')
      .map((header) => header.textContent);
    // 90% on ChatGPT and 20% on Gemini average 55%; the second prompt is 10%; the third has 3 answers
    expect(names).toEqual(['Best CRM for startups', 'CRM pricing compared']);
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Prompt', 'Visibility', 'Mention', 'Citation', 'Answers']);
    expect(await screen.findByText('2 prompts with a rate, by mention rate')).toBeInTheDocument();
  });

  it('opens a prompt on the Prompts page with the group and the platform carried', async () => {
    render({ searchParams: `topic=${PRICING}&engine=chatgpt_web` });
    const row = await screen.findByRole('link', { name: 'Best CRM for startups' });
    const query = new URL(row.getAttribute('href') ?? '', 'http://localhost').searchParams;
    expect(query.get('inspect')).toBe('prompt:p1');
    expect(query.get('topic')).toBe(PRICING);
    expect(query.get('engine')).toBe('chatgpt_web');
    const all = await screen.findByRole('link', { name: 'View all 2 prompts' });
    const allQuery = new URL(all.getAttribute('href') ?? '', 'http://localhost').searchParams;
    expect(allQuery.get('tab')).toBe('prompts');
    expect(allQuery.get('topic')).toBe(PRICING);
  });

  it('puts the group against all groups beside the prompts, every platform whatever the platform says', async () => {
    render({ searchParams: `topic=${PRICING}&engine=chatgpt_web` });
    expect(await screen.findByText('CRM / Pricing vs all groups')).toBeInTheDocument();
    const list = await screen.findByRole('list', {}, { timeout: 4000 });
    expect(list).toBeInTheDocument();
    expect(await screen.findByText('AI Overview')).toBeInTheDocument();
    expect(await screen.findByText('Not collected yet')).toBeInTheDocument();
    expect(await screen.findAllByText(/^All groups \d+%/)).not.toHaveLength(0);
  });

  it('Back returns to all groups on the platform the person came from', async () => {
    const { user, urls } = render();
    await user.click(await link(/^Security on Gemini/));
    await user.click(await screen.findByRole('button', { name: 'Back to all groups' }));
    await waitFor(() => {
      expect(queryOf(urls).get('topic')).toBeNull();
    });
    expect(queryOf(urls).get('engine')).toBeNull();
    expect(await grid()).toBeInTheDocument();
  });

  it('Back keeps the platform of a link that came straight to the group', async () => {
    const { user, urls } = render({ searchParams: `topic=${SECURITY}&engine=gemini_web` });
    await user.click(await screen.findByRole('button', { name: 'Back to all groups' }));
    await waitFor(() => {
      expect(queryOf(urls).get('topic')).toBeNull();
    });
    expect(queryOf(urls).get('engine')).toBe('gemini_web');
  });

  it('says why when no prompt of the group has a rate, with the way back', async () => {
    render({ searchParams: `topic=${SUPPORT}`, summary: { ...SUMMARY, prompts: PROMPTS.slice(2, 3) } });
    expect(await screen.findByText('No prompt has a rate yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Back to all groups' }).length).toBeGreaterThan(0);
  });

  it('has the card frame under the id the layout gave it', async () => {
    render({ searchParams: `topic=${PRICING}` });
    await screen.findByRole('heading', { name: 'Prompts in CRM / Pricing' });
    expect(document.querySelector(`[data-layout-card="${CARD_ID}"]`)).not.toBeNull();
  });
});
