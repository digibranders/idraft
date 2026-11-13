import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { engine, head, projectEngine, weighted } from './cells-fixtures';
import { TopicsMobileList, type TopicsMobileListProps } from './topics-mobile-list';
import type { TopicHead } from './topic-rows';
import { renderWithProviders } from '@/test/render';

const ENGINES = [projectEngine('chatgpt_web'), projectEngine('gemini_web')];

const HEADS: TopicHead[] = [
  head('seo', 'SEO', {
    promptCount: 6,
    engines: [
      engine('chatgpt_web', { mentioned: weighted(3, 8, 2) }),
      engine('gemini_web', { mentioned: weighted(6, 8, 2) }),
    ],
    children: [
      head('tech', 'Technical SEO', {
        path: 'SEO / Technical SEO',
        parent: 'SEO',
        promptCount: 2,
        // Too few answers for a rate, and Gemini has none
        engines: [engine('chatgpt_web', { mentioned: weighted(2, 3, 2) })],
      }),
    ],
  }),
  head('ads', 'Paid Search', {
    promptCount: 3,
    engines: [engine('chatgpt_web', { mentioned: weighted(1, 10, 3) })],
  }),
];

const props = (over: Partial<TopicsMobileListProps> = {}): TopicsMobileListProps => ({
  heads: HEADS,
  engines: ENGINES,
  status: 'ready',
  search: '',
  onSearchChange: () => undefined,
  activeTopicKey: null,
  onOpenTopic: () => undefined,
  onTopicOrderChange: () => undefined,
  toolbarEnd: <span>tab switch</span>,
  errorState: <p>The topics failed</p>,
  emptyState: <p>No prompts yet</p>,
  filteredEmptyState: <p>No topic matches</p>,
  ...over,
});

describe('TopicsMobileList: the Topics tab on a phone (WB-TPE-17)', () => {
  it('renders two line rows: the topic and its mention rate, then the best engine and the engines with a rate', async () => {
    renderWithProviders(<TopicsMobileList {...props()} />);
    const list = await screen.findByRole('list', { name: /^Topics, 3 results/ });
    const rows = within(list).getAllByRole('button');
    // The children follow their parent, named by their path
    expect(rows.map((row) => row.textContent?.split('Mention rate')[0]?.trim())).toEqual([
      'SEO',
      'SEO / Technical SEO',
      'Paid Search',
    ]);
    const [seo, tech, ads] = rows;
    // The average of the two engines, and the best engine with the answers behind its rate
    expect(seo).toHaveTextContent('56%');
    expect(seo).toHaveTextContent('Best on Gemini 75% (6 of 8 answers), 2 engines');
    // A rate over too few answers says its answers and never a percent
    expect(tech).toHaveTextContent('No engine has a rate yet');
    expect(tech).toHaveTextContent('3 answers');
    expect(tech).not.toHaveTextContent('%');
    // One engine with a rate is said as one engine
    expect(ads).toHaveTextContent('Best on ChatGPT 10% (1 of 10 answers), 1 engine');
  });

  it('says the first line is an average over the engines that have a rate', async () => {
    renderWithProviders(<TopicsMobileList {...props()} />);
    const list = await screen.findByRole('list', { name: /^Topics, 3 results/ });
    const [seo, tech, ads] = within(list).getAllByRole('button');
    // SEO has a rate on 2 engines, Paid Search on 1, Technical SEO on none
    expect(seo).toHaveTextContent('Mention rate, avg of 2');
    expect(ads).toHaveTextContent('Mention rate, 1 engine');
    expect(tech).not.toHaveTextContent('avg of 0');
    expect(tech).toHaveTextContent('Mention rate, no engine has a rate');
  });

  it('opens the topic drawer on Overview', async () => {
    const onOpenTopic = vi.fn();
    const { user } = renderWithProviders(<TopicsMobileList {...props({ onOpenTopic })} />);
    await user.click(await screen.findByRole('button', { name: /^Paid Search/ }));
    expect(onOpenTopic).toHaveBeenCalledWith('ads');
  });

  it("keeps the topic order for the drawer's Previous and Next", async () => {
    const onTopicOrderChange = vi.fn();
    renderWithProviders(<TopicsMobileList {...props({ onTopicOrderChange })} />);
    await screen.findByRole('list');
    await waitFor(() => expect(onTopicOrderChange).toHaveBeenLastCalledWith(['seo', 'tech', 'ads']));
  });

  it('marks the open topic', async () => {
    renderWithProviders(<TopicsMobileList {...props({ activeTopicKey: 'ads' })} />);
    expect(await screen.findByRole('button', { name: /^Paid Search/ })).toHaveAttribute('aria-current', 'true');
  });

  it('writes the search the person types and keeps the tab switch in its toolbar', async () => {
    const onSearchChange = vi.fn();
    const { user } = renderWithProviders(<TopicsMobileList {...props({ onSearchChange })} />);
    await user.type(await screen.findByRole('searchbox'), 'p');
    expect(onSearchChange).toHaveBeenLastCalledWith('p');
    expect(screen.getByText('tab switch')).toBeInTheDocument();
  });

  it('shows the empty states and the error of the screen', async () => {
    const empty = renderWithProviders(<TopicsMobileList {...props({ status: 'empty', heads: [] })} />);
    expect(await screen.findByText('No prompts yet')).toBeInTheDocument();
    empty.unmount();
    renderWithProviders(<TopicsMobileList {...props({ status: 'error', heads: [] })} />);
    expect(await screen.findByText('The topics failed')).toBeInTheDocument();
  });
});
