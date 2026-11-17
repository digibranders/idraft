import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GapsTab, type GapsTabProps } from './gaps-tab';
import type { CitationGapList } from '@/lib/citations/board-queries';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const cell = (answers: number, cited: number) => ({
  answers,
  cited,
  mentioned: cited,
  state: answers === 0 ? ('none' as const) : cited > 0 ? ('cited' as const) : ('not' as const),
});
const brand = (answers: number, cited: number) => ({
  total: cell(answers, cited),
  engines: [{ ...cell(answers, cited), engine_code: 'chatgpt_web' as const }],
  platforms: 1,
  cited_on: cited > 0 ? 1 : 0,
});
const WINDOW = {
  runs: 4,
  timezone: 'Europe/Berlin',
  current: [],
  previous: [],
  trend: [],
  answers: 8,
  prompts: 2,
  latest_answer_at: '2026-09-28T00:10:00.000Z',
  latest_run_number: 48,
};
const LIST: CitationGapList = {
  data: [
    {
      prompt_id: 'p1',
      text: 'Best CRM?',
      topic: { term_id: 't1', name: 'Pricing' },
      you: brand(4, 0),
      competitors: [{ ...brand(4, 2), entity_id: 'c1' }],
      gap: 1,
      lost_on: ['chatgpt_web'],
      lost_to: ['c1'],
      competitor_answers: 2,
    },
    {
      prompt_id: 'p2',
      text: 'CRM for startups',
      topic: null,
      you: brand(4, 3),
      competitors: [{ ...brand(4, 0), entity_id: 'c1' }],
      gap: 0,
      lost_on: [],
      lost_to: [],
      competitor_answers: 0,
    },
  ],
  meta: {
    competitors: [{ entity_id: 'c1', name: 'HubSpot', color_index: 2, domain: 'hubspot.com' }],
    gaps: 1,
    prompts: 2,
    window: WINDOW,
  },
};

const tooltip = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="tooltip"]');

const readOf = (overrides: Partial<GapsTabProps['read']>): GapsTabProps['read'] => ({
  status: 'ready',
  data: LIST,
  refetching: false,
  notFound: false,
  errorId: null,
  retry: vi.fn(),
  retrying: false,
  ...overrides,
});

function setup(overrides: Partial<GapsTabProps> = {}) {
  const props: GapsTabProps = {
    read: {
      status: 'ready',
      data: LIST,
      refetching: false,
      notFound: false,
      errorId: null,
      retry: vi.fn(),
      retrying: false,
    },
    competitors: [{ id: 'c1', name: 'HubSpot', colorIndex: 2, domain: 'hubspot.com' }],
    ownName: 'Fynix',
    engines: [{ code: 'chatgpt_web', label: 'ChatGPT' }],
    gapsOnly: true,
    search: '',
    onGapsOnlyChange: vi.fn(),
    onSearchChange: vi.fn(),
    onResetScope: vi.fn(),
    onChooseCompetitors: vi.fn(),
    tabs: <nav aria-label="Citations views" />,
    scopeText: 'All platforms, All groups, Last 4 runs',
    timeZone: 'Europe/Berlin',
    activeId: null,
    onOpen: vi.fn(),
    onOrderChange: vi.fn(),
    ...overrides,
  };
  return { props, ...renderWithProviders(<GapsTab {...props} />) };
}

describe('the gap analysis tab', () => {
  it('shows only gaps, the summary, the footer and the columns (C 623 to 679)', async () => {
    const { container } = setup();
    const table = screen.getByRole('table', { name: 'Gap analysis' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    // The header's tooltip text is in the cell for screen readers, so the sort button's own text is the name
    const names = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.querySelector('button')?.textContent);
    expect(names).toEqual(['Prompt', 'Group', 'Fynix', 'HubSpot', 'Lost on']);
    expect(screen.getByRole('checkbox', { name: 'Only gaps' })).toBeChecked();
    expect(
      screen.getByText('of 2 prompts lost to a competitor on at least one platform', { exact: false }),
    ).toBeVisible();
    expect(screen.getByText('1 prompt with a gap')).toBeVisible();
    expect(within(table).getByText('to 1 competitor')).toBeVisible();
    expect(within(table).getByText('Not cited')).toHaveClass('sr-only');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows every prompt with Only gaps off, No group in tertiary and None where nothing is lost', () => {
    setup({ gapsOnly: false });
    expect(screen.getByText('No group')).toHaveClass('text-foreground-tertiary');
    expect(screen.getByText('None')).toHaveClass('text-foreground-tertiary');
    expect(screen.getByText('2 prompts')).toBeVisible();
  });

  it('asks for competitors when none is chosen, and opens the picker (C 681)', async () => {
    const { user, props } = setup({
      competitors: [],
      read: {
        status: 'ready',
        data: undefined,
        refetching: false,
        notFound: false,
        errorId: null,
        retry: vi.fn(),
        retrying: false,
      },
    });
    expect(screen.getByRole('heading', { name: 'Choose competitors to compare' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Choose competitors' }));
    expect(props.onChooseCompetitors).toHaveBeenCalled();
  });

  it('says no prompt matches a search, and no gap with Only gaps on', async () => {
    const { unmount } = setup({ search: 'zzz' });
    expect(screen.getByText('No prompt or group contains “zzz”.')).toBeVisible();
    unmount();
    const { user, props } = setup({
      read: {
        status: 'ready',
        data: { ...LIST, data: LIST.data.slice(1) },
        refetching: false,
        notFound: false,
        errorId: null,
        retry: vi.fn(),
        retrying: false,
      },
    });
    expect(screen.getByRole('heading', { name: 'No gaps in this scope' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Show all prompts' }));
    expect(props.onGapsOnlyChange).toHaveBeenCalledWith(false);
  });

  it('shows the skeleton and no table while the first read loads', () => {
    const { container } = setup({ read: readOf({ status: 'loading', data: undefined }) });
    expect(screen.queryByRole('table', { name: 'Gap analysis' })).not.toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"] table')).not.toBeNull();
  });

  it('shows the error and retries from its button', async () => {
    const read = readOf({ status: 'error', data: undefined });
    const { user } = setup({ read });
    expect(screen.getByText('Could not load citations')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(read.retry).toHaveBeenCalledTimes(1);
  });

  it('says there are no answers, and resets the scope (C 682)', async () => {
    const { user, props } = setup({ read: readOf({ data: { ...LIST, data: [] } }) });
    expect(screen.getByRole('heading', { name: 'No answers in this scope' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Reset scope' }));
    expect(props.onResetScope).toHaveBeenCalledTimes(1);
  });

  it('clears the search from the empty state (C 683)', async () => {
    const { user, props } = setup({ search: 'zzz' });
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(props.onSearchChange).toHaveBeenCalledWith('');
  });

  it('re-orders the rows on a header click and reports the order for J and K (C 621)', async () => {
    const { user, props } = setup({ gapsOnly: false });
    const table = screen.getByRole('table', { name: 'Gap analysis' });
    const order = (): (string | null)[] =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.querySelector('button')?.textContent ?? null);
    expect(order()).toEqual(['Best CRM?', 'CRM for startups']);
    expect(props.onOrderChange).toHaveBeenLastCalledWith(['p1', 'p2']);
    await user.click(within(table).getByRole('button', { name: 'Prompt' }));
    expect(order()).toEqual(['CRM for startups', 'Best CRM?']);
    expect(props.onOrderChange).toHaveBeenLastCalledWith(['p2', 'p1']);
    expect(within(table).getByRole('columnheader', { name: /Prompt/ })).toHaveAttribute('aria-sort', 'descending');
  });

  it('gives a competitor header its tip and its colour dot, and your header none (C 631)', async () => {
    const { user } = setup();
    const table = screen.getByRole('table', { name: 'Gap analysis' });
    const header = within(table).getByRole('columnheader', { name: /HubSpot/ });
    expect(header.querySelector('[data-color-index="2"]')).not.toBeNull();
    expect(within(table).getByRole('columnheader', { name: /Fynix/ }).querySelector('[data-color-index]')).toBeNull();
    await user.hover(within(header).getByRole('button', { name: 'HubSpot' }));
    await waitFor(() => expect(tooltip()).toHaveTextContent('Whether answers cite hubspot.com'));
  });

  it('reads a mention without a link as Not cited, with the mark tones of C 596 to 598', () => {
    const [first, second] = LIST.data;
    if (first === undefined || second === undefined) throw new Error('The fixture needs two rows');
    const mentioned = { ...brand(4, 0), total: { answers: 4, cited: 0, mentioned: 2, state: 'mentioned' as const } };
    setup({
      gapsOnly: false,
      read: readOf({ data: { ...LIST, data: [first, { ...second, you: mentioned }] } }),
    });
    // In row order: your lost mark, HubSpot's cited mark, your mention, HubSpot's not cited mark
    const notCited = screen.getAllByText('Not cited');
    expect(notCited).toHaveLength(3);
    expect(notCited[0]?.parentElement).toHaveClass('text-negative-text');
    expect(notCited[1]?.parentElement).toHaveClass('text-foreground-tertiary');
    expect(screen.getByText('Cited').parentElement).toHaveClass('text-foreground');
  });
});
