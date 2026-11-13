import { act, screen, within } from '@testing-library/react';
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
    children: [
      head('tech', 'Technical SEO', {
        path: 'SEO / Technical SEO',
        parent: 'SEO',
        promptCount: 2,
        // 3 answers on ChatGPT is too few for a rate, and Gemini has none
        engines: [engine('chatgpt_web', { mentioned: weighted(2, 3, 2) })],
      }),
    ],
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
  searchIgnored: false,
  toolbarStart: <span>metric control</span>,
  toolbarEnd: <span>view control</span>,
  errorState: <p>The topics failed</p>,
  emptyState: <p>No prompts yet</p>,
  filteredEmptyState: <p>No topic matches</p>,
  ...over,
});

const href = (link: HTMLElement): URL => new URL(link.getAttribute('href') ?? '', 'https://app.test');

describe('TopicHeatmap: the topics by engine as a heat map (CH-04)', () => {
  it('prints every cell value with the counts in its tip', async () => {
    renderWithProviders(<TopicHeatmap {...props()} />);
    const grid = await screen.findByRole('treegrid', { name: 'Mention by topic and engine' });
    const cell = within(grid).getByRole('link', { name: /^SEO on ChatGPT: 37\.5%, 3 of 8 answers/ });
    expect(cell).toHaveTextContent('38%');
    // The prompts it weights are in the words too
    expect(cell.getAttribute('aria-label')).toContain('2 prompts');
    expect(within(grid).getByRole('link', { name: /^SEO on Gemini: 75\.0%, 6 of 8 answers/ })).toHaveTextContent('75%');
    // The Prompts column
    expect(within(grid).getByRole('columnheader', { name: 'Prompts' })).toBeInTheDocument();
  });

  it('says answers and not a count of hits for share of voice', async () => {
    renderWithProviders(<TopicHeatmap {...props({ metric: 'sov' })} />);
    const grid = await screen.findByRole('treegrid', { name: 'Share of voice by topic and engine' });
    expect(
      within(grid).getByRole('link', { name: /^SEO on ChatGPT: 25\.0%, 20 answers, 2 prompts/ }),
    ).toHaveTextContent('25%');
  });

  it('hatches a cell under 4 answers with its answers and says n/a with none', async () => {
    const { user } = renderWithProviders(<TopicHeatmap {...props()} />);
    await user.click(await screen.findByRole('button', { name: 'Expand SEO' }));
    const grid = screen.getByRole('treegrid');
    const thin = within(grid).getByRole('link', { name: /^Technical SEO on ChatGPT/ });
    expect(thin).toHaveTextContent('3 ans');
    expect(thin.getAttribute('aria-label')).not.toContain('%');
    const none = within(grid).getByRole('gridcell', { name: /^Technical SEO on Gemini: No answers/ });
    expect(none).toHaveTextContent('n/a');
    // A cell with no answer has nothing to open
    expect(within(none).queryByRole('link')).toBeNull();
  });

  it('shows the average column only with 2 or more engines and names the engines in its tip', async () => {
    const { unmount } = renderWithProviders(<TopicHeatmap {...props()} />);
    const grid = await screen.findByRole('treegrid');
    expect(within(grid).getByRole('columnheader', { name: 'avg of 2' })).toBeInTheDocument();
    const average = within(grid).getByRole('gridcell', { name: /^SEO, avg of 2: 56%/ });
    expect(average).toHaveTextContent('56%');
    expect(average.getAttribute('aria-label')).toContain(
      'Equal weight average of ChatGPT and Gemini, each engine counting once.',
    );
    unmount();
    const [chatgpt] = BOTH;
    if (chatgpt === undefined) throw new Error('No engine');
    renderWithProviders(<TopicHeatmap {...props({ engines: [chatgpt] })} />);
    const single = await screen.findByRole('treegrid');
    expect(within(single).queryByRole('columnheader', { name: /^avg of/ })).toBeNull();
  });

  it('never says avg of 0: a row with one engine says one engine, a row with none says there is no average', async () => {
    const heads = [
      head('lone', 'Lone', { engines: [engine('chatgpt_web', { mentioned: weighted(3, 8, 2) })] }),
      head('thin', 'Thin', { engines: [engine('chatgpt_web', { mentioned: weighted(2, 3, 2) })] }),
      head('empty', 'Empty'),
    ];
    renderWithProviders(<TopicHeatmap {...props({ heads })} />);
    // No row has topics under it, so the grid is a plain grid
    const grid = await screen.findByRole('grid');
    const lone = within(grid).getByRole('gridcell', {
      name: /^Lone, 1 engine: 38%, ChatGPT 3 of 8 answers\. ChatGPT only/,
    });
    expect(lone).toHaveTextContent('38%');
    expect(
      within(grid).getByRole('gridcell', { name: /^Thin, average of the engines: 3 answers, fewer than 4/ }),
    ).toHaveTextContent('3 ans');
    expect(
      within(grid).getByRole('gridcell', { name: /^Empty, average of the engines: No answers/ }),
    ).toHaveTextContent('n/a');
    expect(within(grid).queryByLabelText(/avg of 0/)).toBeNull();
  });

  it('a cell links to the drawer on Prompts with that engine and keeps the filters', async () => {
    renderWithProviders(<TopicHeatmap {...props()} />);
    const grid = await screen.findByRole('treegrid');
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
    const grid = await screen.findByRole('treegrid');
    const url = href(within(within(grid).getByRole('rowheader', { name: 'Paid Search' })).getByRole('link'));
    expect(url.searchParams.getAll('inspect')).toEqual(['topic:ads']);
    expect(url.searchParams.has('itab')).toBe(false);
    expect(url.searchParams.has('eng')).toBe(false);
    expect(url.searchParams.get('view')).toBe('heatmap');
  });

  it('opens children in place with the chevron and the keyboard', async () => {
    const { user } = renderWithProviders(<TopicHeatmap {...props()} />);
    const grid = await screen.findByRole('treegrid');
    expect(within(grid).queryByRole('rowheader', { name: 'Technical SEO' })).toBeNull();
    await user.click(within(grid).getByRole('button', { name: 'Expand SEO' }));
    expect(within(grid).getByRole('rowheader', { name: 'Technical SEO' })).toBeInTheDocument();
    await user.click(within(grid).getByRole('button', { name: 'Collapse SEO' }));
    expect(within(grid).queryByRole('rowheader', { name: 'Technical SEO' })).toBeNull();
    const header = within(grid).getByRole('rowheader', { name: 'SEO' });
    act(() => header.focus());
    await user.keyboard('{ArrowRight}');
    expect(within(grid).getByRole('rowheader', { name: 'Technical SEO' })).toBeInTheDocument();
  });

  it('orders the rows by the order it is given and offers the three orders', async () => {
    const onOrderChange = vi.fn();
    const { user } = renderWithProviders(<TopicHeatmap {...props({ onOrderChange })} />);
    const grid = await screen.findByRole('treegrid');
    // Paid Search holds 9 prompts and SEO 6
    expect(
      within(grid)
        .getAllByRole('rowheader')
        .map((header) => header.getAttribute('aria-label')),
    ).toEqual(['Paid Search', 'SEO']);
    await user.click(screen.getByRole('combobox', { name: 'Order rows by' }));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'Prompts',
      'Average rate',
      'Engine gap',
    ]);
    await user.click(screen.getByRole('option', { name: 'Average rate' }));
    expect(onOrderChange).toHaveBeenCalledWith('avg_rate');
  });

  it('draws the rows in the order of the average rate when it is asked for', async () => {
    renderWithProviders(<TopicHeatmap {...props({ order: 'avg_rate' })} />);
    const grid = await screen.findByRole('treegrid');
    // SEO averages 56% and Paid Search 25%, the average of 2 engines with a rate each, whatever their prompts
    expect(
      within(grid)
        .getAllByRole('rowheader')
        .map((header) => header.getAttribute('aria-label')),
    ).toEqual(['SEO', 'Paid Search']);
  });

  it('reports the order of its rows, a parent and then the topics below it, for the drawer to step through', async () => {
    const onTopicOrderChange = vi.fn();
    renderWithProviders(<TopicHeatmap {...props({ onTopicOrderChange })} />);
    await screen.findByRole('treegrid');
    expect(onTopicOrderChange).toHaveBeenLastCalledWith(['ads', 'seo', 'tech']);
  });

  it('keeps the controls of the page in the row above the frame', async () => {
    renderWithProviders(<TopicHeatmap {...props()} />);
    await screen.findByRole('treegrid');
    expect(screen.getByText('metric control')).toBeInTheDocument();
    expect(screen.getByText('view control')).toBeInTheDocument();
  });

  it('says the same in words in the Table form', async () => {
    const { user } = renderWithProviders(<TopicHeatmap {...props()} />);
    await screen.findByRole('treegrid');
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getAllByText(/^SEO on ChatGPT: 37\.5%, 3 of 8 answers/).length).toBeGreaterThan(0);
  });

  it('says search does not narrow it when a search is set', async () => {
    const { rerender } = renderWithProviders(<TopicHeatmap {...props()} />);
    await screen.findByRole('treegrid');
    expect(screen.queryByText('Search does not narrow the heat map.')).toBeNull();
    rerender(<TopicHeatmap {...props({ searchIgnored: true })} />);
    expect(screen.getByText('Search does not narrow the heat map.')).toBeInTheDocument();
  });

  it('says topic rows overlap in the footnote', async () => {
    renderWithProviders(<TopicHeatmap {...props()} />);
    await screen.findByRole('treegrid');
    expect(screen.getByText(/Topic rows overlap: a prompt in two topics counts in both\./)).toBeInTheDocument();
    expect(screen.getByText(/fewer than 4 answers shows its answers, not a rate/)).toBeInTheDocument();
  });

  it('shows a skeleton while it loads, and keeps the grid with a refetch bar while it refetches', async () => {
    const loading = renderWithProviders(<TopicHeatmap {...props({ status: 'loading', heads: [] })} />);
    expect(loading.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole('treegrid')).toBeNull();
    loading.unmount();
    const refetching = renderWithProviders(<TopicHeatmap {...props({ status: 'refetching' })} />);
    expect(await screen.findByRole('treegrid')).toBeInTheDocument();
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
