import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FanoutQueryList, type FanoutQueryListProps } from './query-list';
import { HOSTILE_TITLES, MARKER } from '@/components/app/cells/xss-fixtures';
import { rowKey, type EngineCode, type FanoutQueryRow, type NewVerdict } from '@/lib/fanout';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const row = (over: Partial<FanoutQueryRow> = {}): FanoutQueryRow => ({
  query_text: 'best crm for startups',
  normalized_text: 'best crm for startups',
  engine_code: 'chatgpt_web',
  observations: 6,
  prompts: 2,
  prompt_ids: ['prompt-1', 'prompt-2'],
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  cited_domains: [
    { registrable_domain: 'hubspot.com', domain_role: 'competitor', role_entity_id: 'entity-1', citation_units: 4 },
    { registrable_domain: 'g2.com', domain_role: 'third_party', role_entity_id: null, citation_units: 2 },
  ],
  ...over,
});

const ROWS: readonly FanoutQueryRow[] = [
  row(),
  row({
    query_text: 'crm pricing comparison',
    normalized_text: 'crm pricing comparison',
    observations: 3,
    prompts: 1,
    last_seen_at: '2026-11-08T08:00:00Z',
    cited_domains: [],
  }),
];

const LABELS: Record<EngineCode, string> = { chatgpt_web: 'ChatGPT', gemini_web: 'Gemini', google_ai_mode: 'AI Mode' };

const UNKNOWN: NewVerdict = { kind: 'unknown', reason: 'noPrevious' };

const props = (over: Partial<FanoutQueryListProps> = {}): FanoutQueryListProps => ({
  rows: ROWS,
  total: ROWS.length,
  meta: { answers: 12 },
  labelOf: (code) => LABELS[code],
  timeZone: 'UTC',
  newVerdict: UNKNOWN,
  windowDays: 28,
  showPrompts: true,
  status: 'ready',
  ...over,
});

const list = (): HTMLElement => screen.getByRole('list', { name: 'Fan-out queries, 2 results' });

describe('FanoutQueryList', () => {
  it('is one li per row in a labelled list', () => {
    renderWithProviders(<FanoutQueryList {...props()} />);
    expect(within(list()).getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows the query as text, times used, last seen and the cited domains control', () => {
    renderWithProviders(<FanoutQueryList {...props()} />);
    const [first] = within(list()).getAllByRole('listitem');
    if (first === undefined) throw new Error('no row');
    expect(within(first).getByText('best crm for startups')).toBeInTheDocument();
    expect(within(first).getByText('In 6 of 12 ChatGPT answers')).toBeInTheDocument();
    expect(within(first).getByText('2 prompts')).toBeInTheDocument();
    // The year shows only when it is not the current one
    expect(within(first).getByText(/^Nov 10(, 2026)?$/)).toBeInTheDocument();
    expect(
      within(first).getByRole('button', { name: '2 domains cited in the same answers, show them' }),
    ).toBeInTheDocument();
  });

  it('says None cited in words for a row whose answers cited nothing', () => {
    renderWithProviders(<FanoutQueryList {...props()} />);
    const items = within(list()).getAllByRole('listitem');
    expect(within(items[1] ?? document.body).getByText('None cited')).toBeInTheDocument();
  });

  it('leaves the prompts out when showPrompts is off', () => {
    renderWithProviders(<FanoutQueryList {...props({ showPrompts: false })} />);
    expect(screen.queryByText('2 prompts')).toBeNull();
    expect(screen.queryByText('1 prompt')).toBeNull();
  });

  it('shows the badge only for a new row', () => {
    const verdict: NewVerdict = { kind: 'known', newKeys: new Set([rowKey(row())]) };
    renderWithProviders(<FanoutQueryList {...props({ newVerdict: verdict })} />);
    const items = within(list()).getAllByRole('listitem');
    expect(within(items[0] ?? document.body).getByText('New in window')).toBeInTheDocument();
    expect(within(items[1] ?? document.body).queryByText('New in window')).toBeNull();
  });

  it('shows no badge at all while the verdict is unknown', () => {
    renderWithProviders(<FanoutQueryList {...props()} />);
    expect(screen.queryByText('New in window')).toBeNull();
  });

  it('is no button and no link in a row', () => {
    renderWithProviders(<FanoutQueryList {...props({ rows: [ROWS[1] ?? row()], total: 1 })} />);
    const [item] = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(within(item ?? document.body).queryByRole('button')).toBeNull();
    expect(within(item ?? document.body).queryByRole('link')).toBeNull();
  });

  it('says once that the cited domains are an association, only when a row has some', () => {
    const { unmount } = renderWithProviders(<FanoutQueryList {...props()} />);
    expect(screen.getAllByText(/The data does not say which query found which source\./)).toHaveLength(1);
    unmount();
    renderWithProviders(<FanoutQueryList {...props({ rows: [ROWS[1] ?? row()], total: 1 })} />);
    expect(screen.queryByText(/The data does not say which query found which source\./)).toBeNull();
  });

  it('offers Show more while the list is cut and asks for the next size', async () => {
    const onShowMore = vi.fn();
    const { user } = renderWithProviders(<FanoutQueryList {...props({ total: 57, onShowMore })} />);
    expect(screen.getByText('2 of 57 queries')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show more queries' }));
    expect(onShowMore).toHaveBeenCalledTimes(1);
  });

  it('offers no Show more when every row is listed', () => {
    renderWithProviders(<FanoutQueryList {...props({ onShowMore: vi.fn() })} />);
    expect(screen.queryByRole('button', { name: 'Show more queries' })).toBeNull();
    expect(screen.queryByText(/ of \d+ queries/)).toBeNull();
  });

  it('is skeleton rows with aria-busy while loading, and no row text', () => {
    const { container } = renderWithProviders(
      <FanoutQueryList {...props({ status: 'loading', rows: [], total: 0 })} />,
    );
    const busy = screen.getByRole('status', { name: 'Loading queries' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('keeps the rows and sets aria-busy while refetching', () => {
    renderWithProviders(<FanoutQueryList {...props({ status: 'refetching' })} />);
    expect(list()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('best crm for startups')).toBeInTheDocument();
  });

  it('is not busy when ready', () => {
    renderWithProviders(<FanoutQueryList {...props()} />);
    expect(list()).not.toHaveAttribute('aria-busy');
  });

  it('draws renderExtra under the meta line of its row', () => {
    renderWithProviders(
      <FanoutQueryList {...props({ renderExtra: (queryRow) => <p>{`extra for ${queryRow.query_text}`}</p> })} />,
    );
    const items = within(list()).getAllByRole('listitem');
    expect(within(items[0] ?? document.body).getByText('extra for best crm for startups')).toBeInTheDocument();
    expect(within(items[1] ?? document.body).getByText('extra for crm pricing comparison')).toBeInTheDocument();
  });

  it('keeps provider text with markup as text', () => {
    const hostile = HOSTILE_TITLES.slice(0, 4).map((text, index) =>
      row({ query_text: text, normalized_text: `hostile ${String(index)}`, cited_domains: [] }),
    );
    const { container } = renderWithProviders(<FanoutQueryList {...props({ rows: hostile, total: 4 })} />);
    expect(container.querySelector('img, script, a')).toBeNull();
    expect(container).toHaveTextContent(HOSTILE_TITLES[0] ?? '');
    expect(Reflect.get(window, MARKER)).toBeUndefined();
  });

  it('is axe clean in the light and the dark theme', async () => {
    for (const theme of ['', 'dark']) {
      document.documentElement.className = theme;
      const { container, unmount } = renderWithProviders(<FanoutQueryList {...props({ total: 57 })} />);
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    }
    document.documentElement.className = '';
  });
});
