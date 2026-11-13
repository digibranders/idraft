import { screen, within } from '@testing-library/react';
import type { Route } from 'next';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DomainPagesTab, type DomainPagesTabProps } from './domain-pages-tab';
import type { DomainDetailRead } from './domain-reads';
import type { SourceDomainDetail, SourcePageRow } from '@/lib/citations/types';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const PAGES_HREF =
  '/digibranders/fynix/ai/citations?from=2026-10-16&to=2026-11-12&engine=chatgpt_web&tab=pages&domain=equals%3Ag2.com' as Route;
const sourceHrefOf = (urlId: number): Route => `/digibranders/fynix/ai/citations?inspect=source%3A${urlId}` as Route;

const pageOf = (index: number, overrides: Partial<SourcePageRow> = {}): SourcePageRow => ({
  url: `https://g2.com/page-${index}`,
  url_id: 100 + index,
  title: `Page title ${index}`,
  host: 'g2.com',
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 1000 - index * 10,
  observations: 200 - index,
  prompts: 5,
  engines: [],
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  source_share: { value: 0.01, numerator: 1, denominator: 100, n_observations: 100 },
  ...overrides,
});
const pages = (count: number): SourcePageRow[] => Array.from({ length: count }, (_, index) => pageOf(index + 1));

const dataOf = (topPages: SourcePageRow[]): NonNullable<DomainDetailRead['data']>['data'] => ({
  registrable_domain: 'g2.com',
  rows: [],
  engines: [],
  top_pages: topPages,
  prompts: [],
  cited_with: [],
});

const readOf = (status: DomainDetailRead['status'], data: SourceDomainDetail['data'] | null): DomainDetailRead => ({
  status,
  data: data === null ? undefined : { data, meta: {} as SourceDomainDetail['meta'] },
  errorId: null,
  retry: vi.fn(),
  retrying: false,
  notFound: false,
});

function Tab(props: Partial<DomainPagesTabProps> & { topPages?: SourcePageRow[] } = {}): ReactElement {
  const { topPages = pages(10), ...rest } = props;
  const data = dataOf(topPages);
  return (
    <DomainPagesTab
      domain="g2.com"
      data={data}
      read={readOf('ready', data)}
      refetching={false}
      pagesHref={PAGES_HREF}
      sourceHrefOf={sourceHrefOf}
      {...rest}
    />
  );
}

const table = (): HTMLElement => screen.getByRole('table', { name: 'Most cited pages of g2.com' });

describe('the Pages tab of the domain inspector', () => {
  it('lists at most 10 pages with their units and answers, most cited first as the read gives them', () => {
    renderWithProviders(<Tab topPages={pages(12)} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Top cited pages' })).toBeInTheDocument();
    const rows = within(table()).getAllByRole('row');
    // The header row and ten pages
    expect(rows).toHaveLength(11);
    expect(rows[1]).toHaveTextContent('990');
    expect(rows[1]).toHaveTextContent('199');
    expect(rows[10]).toHaveTextContent('900');
    expect(within(table()).queryByRole('link', { name: 'g2.com/page-11' })).toBeNull();
  });

  it('opens the source inspector from each page (a real link to inspect=source:id)', () => {
    renderWithProviders(<Tab />);
    const link = within(table()).getByRole('link', { name: 'g2.com/page-3' });
    expect(link).toHaveAttribute('href', '/digibranders/fynix/ai/citations?inspect=source%3A103');
    expect(within(table()).getAllByRole('link', { name: /^g2\.com\/page-/ })).toHaveLength(10);
  });

  it('shows the title the answers gave as text, never as markup', () => {
    renderWithProviders(<Tab topPages={[pageOf(1, { title: '<img src=x onerror=alert(1)> Best CRM' })]} />);
    expect(screen.getByText('<img src=x onerror=alert(1)> Best CRM')).toBeInTheDocument();
    expect(table().querySelector('img')).toBeNull();
  });

  it("View all pages goes to the Pages tab filtered to the domain and keeps the scope's keys", () => {
    renderWithProviders(<Tab />);
    const link = screen.getByRole('link', { name: 'View all pages' });
    expect(link).toHaveAttribute('href', PAGES_HREF);
    const query = new URL(String(link.getAttribute('href')), 'https://example.test').searchParams;
    expect(query.get('tab')).toBe('pages');
    expect(query.get('domain')).toBe('equals:g2.com');
    expect(query.get('from')).toBe('2026-10-16');
    expect(query.get('engine')).toBe('chatgpt_web');
  });

  it('has no View all pages under 10 pages, where the list is the whole', () => {
    renderWithProviders(<Tab topPages={pages(9)} />);
    expect(within(table()).getAllByRole('row')).toHaveLength(10);
    expect(screen.queryByRole('link', { name: 'View all pages' })).toBeNull();
  });

  it('says so, with the reason, when no page of the domain is cited', () => {
    renderWithProviders(<Tab topPages={[]} />);
    expect(screen.getByText('No cited pages')).toBeInTheDocument();
    expect(screen.getByText('No page of this domain is cited in this window.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('link', { name: 'View all pages' })).toBeNull();
  });

  it('shows skeleton rows while the domain is read', () => {
    renderWithProviders(<Tab data={null} read={readOf('loading', null)} />);
    const section = screen.getByRole('heading', { level: 3, name: 'Top cited pages' }).closest('section');
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No cited pages')).toBeNull();
    expect(screen.queryByRole('link', { name: 'View all pages' })).toBeNull();
  });

  it('shows an error with Retry that asks again', async () => {
    const read = readOf('error', null);
    const { user } = renderWithProviders(<Tab data={null} read={read} />);
    expect(screen.getByText('The cited pages could not be loaded.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(read.retry).toHaveBeenCalledTimes(1);
  });

  it('keeps its rows and says it is busy while a new window is read', () => {
    renderWithProviders(<Tab refetching />);
    expect(within(table()).getAllByRole('row')).toHaveLength(11);
    expect(table().closest('[aria-busy="true"]')).not.toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<Tab />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
