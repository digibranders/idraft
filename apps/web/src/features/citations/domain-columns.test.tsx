import { renderHook, screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { createTranslator } from 'next-intl';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { CitationTableRow } from './domain-rows';
import { rowNameOf, useDomainColumns, type DomainColumnOptions } from './domain-columns';
import messages from '../../../messages/en.json';
import type { DataTableColumn } from '@/components/app/data-table/types';
import type {
  EngineCode,
  EngineRoleUnits,
  MetricCell,
  SourceDomainRow,
  SourcePageRow,
  SourcesMeta,
} from '@/lib/citations/types';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

// The canvas of the real sparkline draws nothing in jsdom: its props are what the cell decides
vi.mock('@/components/app/sparkline/sparkline-cell', () => ({
  SparklineCell: ({
    values,
    label,
    tone,
    kind,
  }: {
    values: readonly (number | null)[];
    label: string;
    tone?: string;
    kind?: string;
  }): ReactElement => (
    <span role="img" aria-label={label} data-values={JSON.stringify(values)} data-tone={tone} data-kind={kind} />
  ),
}));

const t = createTranslator({ locale: 'en', messages, namespace: 'citations.table' });
const WINDOW = { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' };
const ENGINES = [
  { code: 'chatgpt_web' as EngineCode, label: 'ChatGPT' },
  { code: 'gemini_web' as EngineCode, label: 'Gemini' },
  { code: 'google_ai_mode' as EngineCode, label: 'AI Mode' },
];
const share = (units: number, total: number): MetricCell => ({
  value: total === 0 ? null : units / total,
  numerator: units,
  denominator: total,
  n_observations: 4812,
});
const block = (code: EngineCode, thirdParty: number): EngineRoleUnits => ({
  engine_code: code,
  own: { citation_units: 0, answers_citing: 0 },
  competitor: { citation_units: 0, answers_citing: 0 },
  third_party: { citation_units: thirdParty, answers_citing: 0 },
});

const META: SourcesMeta = {
  window: WINDOW,
  include_branded: false,
  engine_codes: ['chatgpt_web', 'gemini_web', 'google_ai_mode'],
  answers: 4812,
  answers_citing: 4000,
  citation_units: 18420,
  by_role: [{ domain_role: 'third_party', citation_units: 18420, observations: 4000 }],
  // ChatGPT 7,000 units, Gemini 6,000, AI Mode none at all
  by_role_by_engine: [block('chatgpt_web', 7000), block('gemini_web', 6000), block('google_ai_mode', 0)],
  previous_answers: 4500,
  series: [
    { week_start: '2026-10-19', answers: 1200, citation_units: 4000, distinct_domains: 300 },
    { week_start: '2026-10-26', answers: 1200, citation_units: 0, distinct_domains: 0 },
    { week_start: '2026-11-02', answers: 1200, citation_units: 4500, distinct_domains: 310 },
  ],
};
const PREVIOUS: SourcesMeta = { ...META, citation_units: 13280 };

const domainOf = (overrides: Partial<SourceDomainRow> = {}): SourceDomainRow => ({
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 1912,
  observations: 640,
  prompts: 48,
  engines: [
    { engine_code: 'chatgpt_web', citation_units: 700 },
    { engine_code: 'gemini_web', citation_units: 540 },
    { engine_code: 'google_ai_mode', citation_units: 0 },
  ],
  source_share: share(1912, 18420),
  previous: { citation_units: 1102, observations: 400 },
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  series: [
    { week_start: '2026-10-19', citation_units: 400, observations: 100 },
    { week_start: '2026-11-02', citation_units: 900, observations: 200 },
  ],
  ...overrides,
});

const pageOf = (overrides: Partial<SourcePageRow> = {}): SourcePageRow => ({
  url_id: 7,
  url: 'https://g2.com/products/hubspot/reviews',
  title: 'HubSpot reviews',
  host: 'g2.com',
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 300,
  observations: 120,
  prompts: 20,
  engines: [{ engine_code: 'chatgpt_web', citation_units: 300 }],
  source_share: share(300, 18420),
  previous: { citation_units: 100, observations: 50 },
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  ...overrides,
});

const domainRow = (domain: SourceDomainRow = domainOf()): CitationTableRow => ({
  kind: 'domain',
  id: `${domain.registrable_domain}|${domain.domain_role}|${domain.role_entity_id ?? ''}`,
  domain,
});

const OPTIONS: DomainColumnOptions = {
  engines: ENGINES,
  meta: META,
  previousMeta: PREVIOUS,
  entities: [{ entity: { entity_id: 'ent-hubspot', canonical_name: 'HubSpot' } }],
  density: 'default',
  t,
  locale: 'en',
  moreHref: (registrable) => `/ws/p/ai/citations?tab=pages&domain=equals:${registrable}` as Route,
};

const columnsFor = (overrides: Partial<DomainColumnOptions> = {}): readonly DataTableColumn<CitationTableRow>[] =>
  renderHook(() => useDomainColumns({ ...OPTIONS, ...overrides })).result.current;

function columnOf(id: string, overrides: Partial<DomainColumnOptions> = {}): DataTableColumn<CitationTableRow> {
  const column = columnsFor(overrides).find((entry) => entry.id === id);
  if (column === undefined) throw new Error(`No column ${id}`);
  return column;
}

/** The cell of a row in a column, rendered with the providers a table gives it. */
function renderCell(
  id: string,
  row: CitationTableRow,
  overrides: Partial<DomainColumnOptions> = {},
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(<div>{columnOf(id, overrides).cell(row)}</div>);
}

const shown = (columns: readonly DataTableColumn<CitationTableRow>[]): string[] =>
  columns.filter((column) => column.defaultVisible !== false).map((column) => column.id);

describe('useDomainColumns', () => {
  it('has Domain, Role, Units, Share, Change in share, one column per engine, Cited with, Status and Trend in DS order', () => {
    expect(shown(columnsFor())).toEqual([
      'domain',
      'role',
      'units',
      'share',
      'change',
      'engine-chatgpt_web',
      'engine-gemini_web',
      'engine-google_ai_mode',
      'citedWith',
      'status',
      'trend',
    ]);
    expect(columnOf('domain').identity).toBe(true);
  });

  it('keeps the engines in the fixed engine order whatever order they come in', () => {
    const reversed = [...ENGINES].reverse();
    expect(shown(columnsFor({ engines: reversed })).filter((id) => id.startsWith('engine-'))).toEqual([
      'engine-chatgpt_web',
      'engine-gemini_web',
      'engine-google_ai_mode',
    ]);
  });

  it('tiers the columns so a phone shows Domain, Role, Units and Share', () => {
    const always = columnsFor()
      .filter((column) => column.defaultVisible !== false && column.priority === 1)
      .map((column) => column.id);
    expect(always).toEqual(['domain', 'role', 'units', 'share']);
  });

  it('Observations and Prompts are in the chooser and hidden by default', () => {
    const columns = columnsFor();
    for (const id of ['answers', 'prompts']) {
      const column = columns.find((entry) => entry.id === id);
      expect(column?.defaultVisible).toBe(false);
      expect(column?.priority).toBe(4);
    }
    expect(columnOf('answers').header).toBe('Answers');
    expect(columnOf('prompts').header).toBe('Prompts');
    renderCell('answers', domainRow());
    expect(screen.getByText('640')).toBeInTheDocument();
    renderCell('prompts', domainRow());
    expect(screen.getByText('48')).toBeInTheDocument();
  });

  it('puts the group header on the engine columns and nowhere else', () => {
    const grouped = columnsFor()
      .filter((column) => column.group !== undefined)
      .map((column) => column.id);
    expect(grouped).toEqual(['engine-chatgpt_web', 'engine-gemini_web', 'engine-google_ai_mode']);
    expect(columnOf('engine-chatgpt_web').group).toEqual({ id: 'engines', label: 'Share by engine' });
  });

  it('with one engine the engine group collapses and Share is that engine value', () => {
    const columns = columnsFor({ engines: [ENGINES[1] as (typeof ENGINES)[number]] });
    expect(columns.some((column) => column.group !== undefined)).toBe(false);
    expect(shown(columns)).toEqual(['domain', 'role', 'units', 'share', 'change', 'citedWith', 'status', 'trend']);
    // The read is already of that engine: its source share is the engine's share
    const { container } = renderCell('share', domainRow(domainOf({ source_share: share(540, 6000) })), {
      engines: [ENGINES[1] as (typeof ENGINES)[number]],
    });
    expect(container).toHaveTextContent('9.0%');
  });

  it('Category is in the chooser, hidden, and says why it is n/a', () => {
    const category = columnOf('category');
    expect(category.defaultVisible).toBe(false);
    const { container } = renderCell('category', domainRow());
    expect(container).toHaveTextContent('n/a');
    expect(category.cellTip?.(domainRow())?.content).toBe('Categories arrive with the Sources work.');
  });

  it('shows a category when the API sends one', () => {
    const { container } = renderCell('category', domainRow(domainOf({ category: 'Review site' })));
    expect(container).toHaveTextContent('Review site');
  });

  it('the share cell shows the percent and its tooltip says of N units', () => {
    const { container } = renderCell('share', domainRow());
    expect(container).toHaveTextContent('10.4%');
    expect(columnOf('share').cellTip?.(domainRow())?.content).toBe('1,912 of 18,420 units');
  });

  it('says in the share header which units the shares are of', () => {
    expect(columnOf('share').headerTooltip).toBe('Shares are of 18,420 citation units in 4,812 answers.');
  });

  it('shows the units as a number', () => {
    const { container } = renderCell('units', domainRow());
    expect(container).toHaveTextContent('1,912');
  });

  it('the change cell is neutral and says there is no test', () => {
    const { container } = renderCell('change', domainRow());
    // 10.4% now, 8.3% before: +2.1 pts, in no colour
    expect(container).toHaveTextContent('+2.1 pts');
    expect(container.querySelector('.text-positive-text, .text-negative-text')).toBeNull();
    const tip = columnOf('change').cellTip?.(domainRow());
    expect(tip?.content).toBe('Previous 8.3% (1,102 of 13,280 units)');
    expect(tip?.detail).toBe('No test of this change exists, so it is not coloured.');
  });

  it('the change cell stays neutral for a fall', () => {
    const falling = domainRow(domainOf({ previous: { citation_units: 4000, observations: 900 } }));
    const { container } = renderCell('change', falling);
    expect(container).toHaveTextContent('pts');
    expect(container.querySelector('.text-positive-text, .text-negative-text')).toBeNull();
  });

  it('the change cell is n/a without a comparison, never 0', () => {
    const { container } = renderCell('change', domainRow(domainOf({ previous: null })), { previousMeta: undefined });
    expect(container).toHaveTextContent('n/a');
    expect(container).not.toHaveTextContent('0 pts');
    expect(columnOf('change').cellTip?.(domainRow(domainOf({ previous: null })))?.content).toBe('No comparison');
  });

  it('the change cell is n/a when the previous period has no answers', () => {
    const { container } = renderCell('change', domainRow(), { meta: { ...META, previous_answers: 0 } });
    expect(container).toHaveTextContent('n/a');
  });

  it('an engine cell is n/a for an engine with no citation, never 0%', () => {
    const none = renderCell('engine-google_ai_mode', domainRow());
    expect(none.container).toHaveTextContent('n/a');
    expect(none.container).not.toHaveTextContent('0.0%');
    expect(columnOf('engine-google_ai_mode').cellTip?.(domainRow())?.content).toBe(
      'AI Mode has no citation in this window.',
    );
  });

  it('an engine cell shows its share and says of N units on the engine', () => {
    const { container } = renderCell('engine-chatgpt_web', domainRow());
    // 700 of 7,000
    expect(container).toHaveTextContent('10.0%');
    expect(columnOf('engine-chatgpt_web').cellTip?.(domainRow())?.content).toBe('700 of 7,000 units on ChatGPT');
    expect(columnOf('engine-chatgpt_web').header).toBe('ChatGPT');
  });

  it('Cited with names the entity and says None named without one', () => {
    const named = renderCell(
      'citedWith',
      domainRow(domainOf({ cited_with: { entity_id: 'ent-hubspot', observations: 12 } })),
    );
    expect(named.container).toHaveTextContent('HubSpot');
    expect(
      columnOf('citedWith').cellTip?.(
        domainRow(domainOf({ cited_with: { entity_id: 'ent-hubspot', observations: 12 } })),
      )?.content,
    ).toBe('HubSpot, named in 12 answers that cite it');
    named.unmount();
    const none = renderCell('citedWith', domainRow());
    expect(none.container).toHaveTextContent('None named');
  });

  it('Cited with is n/a, with its reason, while the entity is not known', () => {
    const row = domainRow(domainOf({ cited_with: { entity_id: 'ent-missing', observations: 3 } }));
    const { container } = renderCell('citedWith', row, { entities: undefined });
    expect(container).toHaveTextContent('n/a');
    expect(container).not.toHaveTextContent('None named');
    expect(columnOf('citedWith').cellTip?.(row)?.content).toBe('The name of this entity is not loaded yet.');
  });

  it('the New badge shows only with previous 0 and answers in the previous period', () => {
    const fresh = domainRow(domainOf({ previous: { citation_units: 0, observations: 0 } }));
    const shownNew = renderCell('status', fresh);
    expect(shownNew.container).toHaveTextContent('New');
    expect(columnOf('status').cellTip?.(fresh)?.content).toBe(
      'Not cited in the previous period, when 4,500 answers were read.',
    );
    shownNew.unmount();
    // Cited before: not new
    expect(renderCell('status', domainRow()).container).not.toHaveTextContent('New');
    // The period before had no answers: nothing is marked
    const nothing = renderCell('status', fresh, { meta: { ...META, previous_answers: 0 } });
    expect(nothing.container).not.toHaveTextContent('New');
  });

  it('marks nothing New without a comparison', () => {
    const { container } = renderCell('status', domainRow(domainOf({ previous: null })));
    expect(container).not.toHaveTextContent('New');
  });

  it('the trend sparkline has a text alternative and a gap for a week with no units', () => {
    renderCell('trend', domainRow());
    const graph = screen.getByRole('img', { name: 'Weekly share of g2.com' });
    // 10 percent in the first week, no point at all for the week of 26 October (a gap), 20 percent in the third week
    expect(JSON.parse(graph.getAttribute('data-values') ?? '[]')).toEqual([0.1, null, 0.2]);
    expect(graph).toHaveAttribute('data-kind', 'rate');
    expect(graph).toHaveAttribute('data-tone', 'reference');
  });

  it('draws the trend of an own row in the own colour', () => {
    renderCell('trend', domainRow(domainOf({ registrable_domain: 'northwind.com', domain_role: 'own' })));
    expect(screen.getByRole('img')).toHaveAttribute('data-tone', 'own');
  });

  it('draws no trend for a row without a series', () => {
    const { container } = renderCell('trend', domainRow(domainOf({ series: null })));
    expect(container.querySelector('[role="img"]')).toBeNull();
  });

  it('the domain cell is text and never markup for a hostile host', () => {
    const host = 'evil.com"><img src=x onerror=alert(1)>';
    const { container } = renderCell('domain', domainRow(domainOf({ registrable_domain: host })));
    expect(container.querySelector('script')).toBeNull();
    for (const element of container.querySelectorAll('*')) {
      expect(element.getAttributeNames().filter((name) => name.startsWith('on'))).toEqual([]);
    }
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('the page cell is the path with its escaped title, without a host', () => {
    const page = pageOf({ title: '<b>Bold</b> title' });
    const { container } = renderCell('domain', {
      kind: 'page',
      id: 'g2.com|third_party||page|7',
      parentId: 'g2.com|third_party|',
      page,
    });
    expect(container).toHaveTextContent('/products/hubspot/reviews');
    expect(container).toHaveTextContent('<b>Bold</b> title');
    expect(container.querySelector('b')).toBeNull();
    expect(container).not.toHaveTextContent('g2.com/products');
  });

  it('a page row shows its share of the same total with the same tooltip', () => {
    const row: CitationTableRow = { kind: 'page', id: 'p', parentId: 'd', page: pageOf() };
    const { container } = renderCell('share', row);
    expect(container).toHaveTextContent('1.6%');
    expect(columnOf('share').cellTip?.(row)?.content).toBe('300 of 18,420 units');
  });

  it('the View all row is a link to the Pages tab with the count', () => {
    const row: CitationTableRow = { kind: 'more', id: 'm', parentId: 'd', registrable: 'g2.com', total: 48 };
    renderCell('domain', row);
    const link = screen.getByRole('link', { name: 'View all 48 pages' });
    expect(link).toHaveAttribute('href', '/ws/p/ai/citations?tab=pages&domain=equals:g2.com');
  });

  it('says Loading pages while the pages of a domain load', () => {
    renderCell('domain', { kind: 'pages-loading', id: 'l', parentId: 'd' });
    expect(screen.getByText('Loading pages')).toBeInTheDocument();
  });

  it('says the pages could not be loaded and offers Retry', async () => {
    const onRetryPages = vi.fn();
    const { user } = renderCell(
      'domain',
      { kind: 'pages-failed', id: 'f', parentId: 'g2.com|third_party|' },
      { onRetryPages },
    );
    expect(screen.getByText('The pages of this domain could not be loaded.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetryPages).toHaveBeenCalledWith('g2.com|third_party|');
  });

  it('leaves every other column blank on the rows that are not a domain or a page', () => {
    const more: CitationTableRow = { kind: 'more', id: 'm', parentId: 'd', registrable: 'g2.com', total: 48 };
    for (const id of [
      'role',
      'units',
      'share',
      'change',
      'engine-chatgpt_web',
      'answers',
      'citedWith',
      'status',
      'trend',
    ]) {
      const { container, unmount } = renderCell(id, more);
      expect(container.textContent).toBe('');
      expect(columnOf(id).cellTip?.(more)).toBeUndefined();
      unmount();
    }
  });

  it('shows the Role badge on a domain row only', () => {
    const own = renderCell('role', domainRow(domainOf({ domain_role: 'own' })));
    expect(own.container).toHaveTextContent('Own');
    own.unmount();
    const competitor = renderCell('role', domainRow(domainOf({ domain_role: 'competitor' })));
    expect(competitor.container).toHaveTextContent('Competitor');
    competitor.unmount();
    expect(renderCell('role', { kind: 'page', id: 'p', parentId: 'd', page: pageOf() }).container.textContent).toBe('');
  });

  it('does not sort: the tree shows its rows in the order the server gave', () => {
    expect(columnsFor().filter((column) => column.sortValue !== undefined)).toEqual([]);
  });

  it('names each row for the table', () => {
    expect(rowNameOf(domainRow(), t)).toBe('g2.com');
    expect(rowNameOf({ kind: 'page', id: 'p', parentId: 'd', page: pageOf() }, t)).toBe(
      'https://g2.com/products/hubspot/reviews',
    );
    expect(rowNameOf({ kind: 'more', id: 'm', parentId: 'd', registrable: 'g2.com', total: 48 }, t)).toBe(
      'View all 48 pages',
    );
    expect(rowNameOf({ kind: 'pages-loading', id: 'l', parentId: 'd' }, t)).toBe('Loading pages');
    expect(rowNameOf({ kind: 'pages-failed', id: 'f', parentId: 'd' }, t)).toBe(
      'The pages of this domain could not be loaded.',
    );
  });

  it('is axe clean across the cells of a domain row', async () => {
    const row = domainRow(domainOf({ cited_with: { entity_id: 'ent-hubspot', observations: 12 } }));
    const columns = columnsFor();
    const { container } = renderWithProviders(
      <ul>
        {columns.map((column) => (
          <li key={column.id}>{column.cell(row)}</li>
        ))}
        <li>{columns[0]?.cell({ kind: 'more', id: 'm', parentId: 'd', registrable: 'g2.com', total: 48 })}</li>
      </ul>,
    );
    expect(within(container).getAllByRole('listitem').length).toBeGreaterThan(10);
    expect(await axe(container)).toHaveNoViolations();
  });
});
