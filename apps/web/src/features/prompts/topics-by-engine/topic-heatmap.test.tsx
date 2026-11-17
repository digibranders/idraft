import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { engine, head, projectEngine, weighted } from './cells-fixtures';
import { TopicHeatmap, type TopicHeatmapProps } from './topic-heatmap';
import type { TopicHead } from './topic-rows';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams('view=heatmap&metric=sov&country=DE&inspect=topic:old&itab=history'),
}));

const BOTH = [projectEngine('chatgpt_web'), projectEngine('gemini_web')];

const HEADS: TopicHead[] = [
  head('seo', 'SEO', {
    promptCount: 6,
    engines: [
      engine('chatgpt_web', { mentioned: weighted(3, 8, 2), share_of_voice: weighted(5, 20, 2) }),
      engine('gemini_web', { mentioned: weighted(6, 8, 2), share_of_voice: weighted(2, 5, 2) }),
    ],
  }),
  head('tech', 'Technical SEO', {
    promptCount: 2,
    // 3 answers on ChatGPT is too few for a rate, and Gemini has none
    engines: [engine('chatgpt_web', { mentioned: weighted(2, 3, 2) })],
  }),
  head('ads', 'Paid Search', {
    promptCount: 9,
    engines: [
      engine('chatgpt_web', { mentioned: weighted(1, 10, 3) }),
      engine('gemini_web', { mentioned: weighted(4, 10, 3) }),
    ],
  }),
];

const props = (over: Partial<TopicHeatmapProps> = {}): TopicHeatmapProps => ({
  heads: HEADS,
  engines: BOTH,
  metric: 'mention',
  order: 'prompts',
  onOrderChange: () => undefined,
  density: 'default',
  status: 'ready',
  search: '',
  onSearchChange: () => undefined,
  toolbarEnd: <span>view control</span>,
  errorState: <p>The topics failed</p>,
  emptyState: <p>No prompts yet</p>,
  filteredEmptyState: <p>No topic matches</p>,
  ...over,
});

const href = (link: HTMLElement): URL => new URL(link.getAttribute('href') ?? '', 'https://app.test');

describe('TopicHeatmap: the groups by platform as a heat map (CH-04)', () => {
  it('prints every cell value with the counts in its tip', async () => {
    renderWithProviders(<TopicHeatmap {...props()} />);
    const grid = await screen.findByRole('grid', { name: 'Mention by group and platform' });
    // The percent is the mean of the prompts' rates: it says so, and the pooled answers carry their own percent
    const cell = within(grid).getByRole('link', {
      name: /^SEO on ChatGPT: 37\.5%, average of 2 prompts, each counting once\. All answers pooled: 37\.5%, 3 of 8 answers/,
    });
    expect(cell).toHaveTextContent('38%');
    expect(
      within(grid).getByRole('link', {
        name: /^SEO on Gemini: 75\.0%, average of 2 prompts, each counting once\. All answers pooled: 75\.0%, 6 of 8 answers/,
      }),
    ).toHaveTextContent('75%');
    // The Prompts column
    expect(within(grid).getByRole('columnheader', { name: 'Prompts' })).toBeInTheDocument();
  });

  it('says answers and not a count of hits for share of voice', async () => {
    renderWithProviders(<TopicHeatmap {...props({ metric: 'sov' })} />);
    const grid = await screen.findByRole('grid', { name: 'Share of voice by group and platform' });
    expect(
      within(grid).getByRole('link', { name: /^SEO on ChatGPT: 25\.0%, 20 answers, 2 prompts/ }),
    ).toHaveTextContent('25%');
  });

  it('hatches a cell under 4 answers with its answers and says n/a with none', async () => {
    renderWithProviders(<TopicHeatmap {...props()} />);
    const grid = await screen.findByRole('grid');
    const thin = within(grid).getByRole('link', { name: /^Technical SEO on ChatGPT/ });
    expect(thin).toHaveTextContent('3 ans');
    expect(thin.getAttribute('aria-label')).not.toContain('%');
    const none = within(grid).getByRole('gridcell', { name: /^Technical SEO on Gemini: No answers/ });
    expect(none).toHaveTextContent('n/a');
    // A cell with no answer has nothing to open
    expect(within(none).queryByRole('link')).toBeNull();
  });

  it('shows the average column only with 2 or more platforms and names the platforms in its tip', async () => {
    const { unmount } = renderWithProviders(<TopicHeatmap {...props()} />);
    const grid = await screen.findByRole('grid');
    expect(within(grid).getByRole('columnheader', { name: 'Average of 2' })).toBeInTheDocument();
    const average = within(grid).getByRole('gridcell', { name: /^SEO, average of 2: 56%/ });
    expect(average).toHaveTextContent('56%');
    expect(average.getAttribute('aria-label')).toContain(
      'Equal weight average of ChatGPT and Gemini, each platform and each prompt counting once.',
    );
    unmount();
    const [chatgpt] = BOTH;
    if (chatgpt === undefined) throw new Error('No platform');
    renderWithProviders(<TopicHeatmap {...props({ engines: [chatgpt] })} />);
    const single = await screen.findByRole('grid');
    expect(within(single).queryByRole('columnheader', { name: /^Average of/ })).toBeNull();
  });

  it('never says average of 0: a row with one platform says one platform, a row with none says there is no average', async () => {
    const heads = [
      head('lone', 'Lone', { engines: [engine('chatgpt_web', { mentioned: weighted(3, 8, 2) })] }),
      head('thin', 'Thin', { engines: [engine('chatgpt_web', { mentioned: weighted(2, 3, 2) })] }),
      head('empty', 'Empty'),
    ];
    renderWithProviders(<TopicHeatmap {...props({ heads })} />);
    // No row has topics under it, so the grid is a plain grid
    const grid = await screen.findByRole('grid');
    const lone = within(grid).getByRole('gridcell', {
      name: /^Lone, 1 platform: 38%, ChatGPT 3 of 8 answers\. ChatGPT only/,
    });
    expect(lone).toHaveTextContent('38%');
    expect(
      within(grid).getByRole('gridcell', { name: /^Thin, average of the platforms: 3 answers, fewer than 4/ }),
    ).toHaveTextContent('3 ans');
    expect(
      within(grid).getByRole('gridcell', { name: /^Empty, average of the platforms: No answers/ }),
    ).toHaveTextContent('n/a');
    expect(within(grid).queryByLabelText(/average of 0/)).toBeNull();
  });

  it('a cell links to the drawer on Prompts with that platform and keeps the filters', async () => {
    renderWithProviders(<TopicHeatmap {...props()} />);
    const grid = await screen.findByRole('grid');
    const url = href(within(grid).getByRole('link', { name: /^Paid Search on Gemini/ }));
    expect(url.pathname).toBe('/digibranders/fynix/ai/prompts');
    expect(url.searchParams.getAll('inspect')).toEqual(['topic:ads']);
    expect(url.searchParams.get('itab')).toBe('prompts');
    expect(url.searchParams.get('eng')).toBe('gemini_web');
    expect(url.searchParams.get('view')).toBe('heatmap');
    expect(url.searchParams.get('metric')).toBe('sov');
    expect(url.searchParams.get('country')).toBe('DE');
  });

  it('a row opens the drawer on Overview', async () => {
    renderWithProviders(<TopicHeatmap {...props()} />);
    const grid = await screen.findByRole('grid');
    const url = href(within(within(grid).getByRole('rowheader', { name: 'Paid Search' })).getByRole('link'));
    expect(url.searchParams.getAll('inspect')).toEqual(['topic:ads']);
    expect(url.searchParams.has('itab')).toBe(false);
    expect(url.searchParams.has('eng')).toBe(false);
    expect(url.searchParams.get('view')).toBe('heatmap');
  });

  it('has one flat level of groups: no chevron and no parent row', async () => {
    renderWithProviders(<TopicHeatmap {...props()} />);
    const grid = await screen.findByRole('grid');
    expect(within(grid).getByRole('rowheader', { name: 'Technical SEO' })).toBeInTheDocument();
    expect(within(grid).queryByRole('button', { name: /^Expand/ })).toBeNull();
  });

  it('orders the rows by the order it is given and offers the three orders', async () => {
    const onOrderChange = vi.fn();
    const { user } = renderWithProviders(<TopicHeatmap {...props({ onOrderChange })} />);
    const grid = await screen.findByRole('grid');
    // Paid Search holds 9 prompts, SEO 6 and Technical SEO 2
    expect(
      within(grid)
        .getAllByRole('rowheader')
        .map((header) => header.getAttribute('aria-label')),
    ).toEqual(['Paid Search', 'SEO', 'Technical SEO']);
    await user.click(screen.getByRole('combobox', { name: 'Order rows by' }));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'Prompts',
      'Average rate',
      'Platform gap',
    ]);
    await user.click(screen.getByRole('option', { name: 'Average rate' }));
    expect(onOrderChange).toHaveBeenCalledWith('avg_rate');
  });

  it('draws the rows in the order of the average rate when it is asked for', async () => {
    renderWithProviders(<TopicHeatmap {...props({ order: 'avg_rate' })} />);
    const grid = await screen.findByRole('grid');
    // SEO averages 56% and Paid Search 25%, the average of 2 engines with a rate each, whatever their prompts
    expect(
      within(grid)
        .getAllByRole('rowheader')
        .map((header) => header.getAttribute('aria-label')),
    ).toEqual(['SEO', 'Paid Search', 'Technical SEO']);
  });

  it('reports the order of its rows for the drawer to step through', async () => {
    const onTopicOrderChange = vi.fn();
    renderWithProviders(<TopicHeatmap {...props({ onTopicOrderChange })} />);
    await screen.findByRole('grid');
    expect(onTopicOrderChange).toHaveBeenLastCalledWith(['ads', 'seo', 'tech']);
  });

  it('keeps the controls of the page in the row above the frame', async () => {
    renderWithProviders(<TopicHeatmap {...props()} />);
    await screen.findByRole('grid');
    expect(screen.getByText('view control')).toBeInTheDocument();
  });

  it('has the table search in its toolbar and writes what is typed (the groups are narrowed by the caller)', async () => {
    const onSearchChange = vi.fn();
    const { user } = renderWithProviders(<TopicHeatmap {...props({ onSearchChange })} />);
    await user.type(await screen.findByRole('searchbox'), 'p');
    expect(onSearchChange).toHaveBeenLastCalledWith('p');
  });

  it('says the same in words in the Table form', async () => {
    const { user } = renderWithProviders(<TopicHeatmap {...props()} />);
    await screen.findByRole('grid');
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(
      screen.getAllByText(/^SEO on ChatGPT: 37\.5%, average of 2 prompts, each counting once\. All answers pooled/)
        .length,
    ).toBeGreaterThan(0);
  });

  it('says group rows overlap in the footnote', async () => {
    renderWithProviders(<TopicHeatmap {...props()} />);
    await screen.findByRole('grid');
    expect(screen.getByText(/Group rows overlap: a prompt in two groups counts in both\./)).toBeInTheDocument();
    expect(screen.getByText(/fewer than 4 answers shows its answers, not a rate/)).toBeInTheDocument();
  });

  it('shows a skeleton while it loads, and keeps the grid with a refetch bar while it refetches', async () => {
    const loading = renderWithProviders(<TopicHeatmap {...props({ status: 'loading', heads: [] })} />);
    expect(loading.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole('grid')).toBeNull();
    loading.unmount();
    const refetching = renderWithProviders(<TopicHeatmap {...props({ status: 'refetching' })} />);
    expect(await screen.findByRole('grid')).toBeInTheDocument();
    expect(refetching.container.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
  });

  it('shows the empty states and the error of the screen, whose retry is its own', async () => {
    const empty = renderWithProviders(<TopicHeatmap {...props({ status: 'empty', heads: [] })} />);
    expect(screen.getByText('No prompts yet')).toBeInTheDocument();
    empty.unmount();
    const filtered = renderWithProviders(<TopicHeatmap {...props({ status: 'filtered-empty', heads: [] })} />);
    expect(screen.getByText('No topic matches')).toBeInTheDocument();
    filtered.unmount();
    renderWithProviders(<TopicHeatmap {...props({ status: 'error', heads: [] })} />);
    expect(screen.getByText('The topics failed')).toBeInTheDocument();
    // The controls stay, so the person can leave the view
    expect(screen.getByText('view control')).toBeInTheDocument();
  });
});
