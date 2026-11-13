import { renderHook, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { pageRowId, usePageColumns, type PageColumnOptions } from './page-columns';
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
};
const PREVIOUS: SourcesMeta = { ...META, citation_units: 13280 };

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
  engines: [{ engine_code: 'chatgpt_web', citation_units: 700 }],
  source_share: share(300, 18420),
  previous: { citation_units: 100, observations: 50 },
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T22:30:00Z',
  ...overrides,
});

const domainOf = (overrides: Partial<SourceDomainRow> = {}): SourceDomainRow => ({
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 1912,
  observations: 640,
  prompts: 48,
  engines: [],
  source_share: share(1912, 18420),
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  ...overrides,
});
const NAMED = domainOf({ cited_with: { entity_id: 'ent-hubspot', observations: 12 } });

const OPTIONS: PageColumnOptions = {
  engines: ENGINES,
  meta: META,
  previousMeta: PREVIOUS,
  entities: [{ entity: { entity_id: 'ent-hubspot', canonical_name: 'HubSpot' } }],
  citedWith: { rows: [NAMED], failed: false },
  timeZone: 'UTC',
  t,
  locale: 'en',
};

const columnsFor = (overrides: Partial<PageColumnOptions> = {}): readonly DataTableColumn<SourcePageRow>[] =>
  renderHook(() => usePageColumns({ ...OPTIONS, ...overrides })).result.current;

function columnOf(id: string, overrides: Partial<PageColumnOptions> = {}): DataTableColumn<SourcePageRow> {
  const column = columnsFor(overrides).find((entry) => entry.id === id);
  if (column === undefined) throw new Error(`No column ${id}`);
  return column;
}

function renderCell(
  id: string,
  row: SourcePageRow,
  overrides: Partial<PageColumnOptions> = {},
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(<div>{columnOf(id, overrides).cell(row)}</div>);
}

const shown = (columns: readonly DataTableColumn<SourcePageRow>[]): string[] =>
  columns.filter((column) => column.defaultVisible !== false).map((column) => column.id);

describe('usePageColumns', () => {
  it('has URL with host, role, units, share, change, engines, first seen and last seen in order', () => {
    expect(shown(columnsFor())).toEqual([
      'page',
      'role',
      'units',
      'share',
      'change',
      'engine-chatgpt_web',
      'engine-gemini_web',
      'engine-google_ai_mode',
      'status',
      'firstSeen',
      'lastSeen',
      'citedWith',
    ]);
    expect(columnOf('page').identity).toBe(true);
    expect(columnOf('page').header).toBe('Page');
  });

  it('keeps the engines in the fixed engine order whatever order they come in', () => {
    expect(shown(columnsFor({ engines: [...ENGINES].reverse() })).filter((id) => id.startsWith('engine-'))).toEqual([
      'engine-chatgpt_web',
      'engine-gemini_web',
      'engine-google_ai_mode',
    ]);
  });

  it('puts the engine group header on the engine columns and nowhere else', () => {
    const grouped = columnsFor()
      .filter((column) => column.group !== undefined)
      .map((column) => column.id);
    expect(grouped).toEqual(['engine-chatgpt_web', 'engine-gemini_web', 'engine-google_ai_mode']);
    expect(columnOf('engine-chatgpt_web').group).toEqual({ id: 'engines', label: 'Share by engine' });
  });

  it('with one engine the engine group collapses', () => {
    const columns = columnsFor({ engines: [ENGINES[1] as (typeof ENGINES)[number]] });
    expect(columns.some((column) => column.group !== undefined)).toBe(false);
    expect(shown(columns)).toEqual([
      'page',
      'role',
      'units',
      'share',
      'change',
      'status',
      'firstSeen',
      'lastSeen',
      'citedWith',
    ]);
  });

  it('tiers the columns so a phone shows Page, Role, Units and Share', () => {
    const always = columnsFor()
      .filter((column) => column.defaultVisible !== false && column.priority === 1)
      .map((column) => column.id);
    expect(always).toEqual(['page', 'role', 'units', 'share']);
  });

  it('Answers and Prompts are in the chooser and hidden by default', () => {
    for (const id of ['answers', 'prompts']) {
      const column = columnOf(id);
      expect(column.defaultVisible).toBe(false);
      expect(column.priority).toBe(4);
    }
    renderCell('answers', pageOf());
    expect(screen.getByText('120')).toBeInTheDocument();
    renderCell('prompts', pageOf());
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('does not sort: the server gave the order', () => {
    expect(columnsFor().filter((column) => column.sortValue !== undefined)).toEqual([]);
  });

  it('gives each page row an id that holds its role and entity', () => {
    expect(pageRowId(pageOf())).not.toBe(pageRowId(pageOf({ role_entity_id: 'ent-a' })));
    expect(pageRowId(pageOf())).not.toBe(pageRowId(pageOf({ url_id: 8 })));
  });
});

describe('the page cell', () => {
  it('shows the host even beside a title', () => {
    const { container } = renderCell('page', pageOf());
    expect(container).toHaveTextContent('g2.com');
    expect(container).toHaveTextContent('/products/hubspot/reviews');
    expect(container).toHaveTextContent('HubSpot reviews');
  });

  it('shows the host for a page with no title', () => {
    const { container } = renderCell('page', pageOf({ title: null }));
    expect(container).toHaveTextContent('g2.com');
  });

  it('a hostile title is text', () => {
    const { container } = renderCell('page', pageOf({ title: '<img src=x onerror=alert(1)><b>Bold</b>' }));
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)><b>Bold</b>');
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    for (const element of container.querySelectorAll('*')) {
      expect(element.getAttributeNames().filter((name) => name.startsWith('on'))).toEqual([]);
    }
  });

  it('a hostile address is never a link', () => {
    const { container } = renderCell('page', pageOf({ url: 'javascript:alert(1)', host: 'javascript' }));
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it('names the row by its address', () => {
    expect(columnOf('page').cellLabel?.(pageOf())).toBe('https://g2.com/products/hubspot/reviews');
  });
});

describe('the figure cells', () => {
  it('the share cell shows the percent and its tooltip says of N units', () => {
    const { container } = renderCell('share', pageOf());
    expect(container).toHaveTextContent('1.6%');
    expect(columnOf('share').cellTip?.(pageOf())?.content).toBe('300 of 18,420 units');
    expect(columnOf('share').headerTooltip).toBe('Shares are of 18,420 citation units in 4,812 answers.');
  });

  it('shows the units as a number', () => {
    expect(renderCell('units', pageOf()).container).toHaveTextContent('300');
  });

  it('shows the Role badge in words', () => {
    expect(renderCell('role', pageOf({ domain_role: 'competitor' })).container).toHaveTextContent('Competitor');
  });

  it('the change cell is neutral and says the previous share and that no test exists', () => {
    const { container } = renderCell('change', pageOf());
    // 1.6% now, 0.8% before (100 of 13,280 units): +0.9 pts, in no colour
    expect(container).toHaveTextContent('+0.9 pts');
    expect(container.querySelector('.text-positive-text, .text-negative-text')).toBeNull();
    const tip = columnOf('change').cellTip?.(pageOf());
    expect(tip?.content).toBe('Previous 0.8% (100 of 13,280 units)');
    expect(tip?.detail).toBe('No test of this change exists, so it is not coloured.');
  });

  it('the change cell is n/a without a comparison, never 0', () => {
    const row = pageOf({ previous: null });
    const { container } = renderCell('change', row, { previousMeta: undefined });
    expect(container).toHaveTextContent('n/a');
    expect(container).not.toHaveTextContent('0 pts');
    expect(columnOf('change').cellTip?.(row)?.content).toBe('No comparison');
  });

  it('an engine cell shows its share and says of N units on the engine', () => {
    const { container } = renderCell('engine-chatgpt_web', pageOf());
    // 700 of 7,000
    expect(container).toHaveTextContent('10.0%');
    expect(columnOf('engine-chatgpt_web').cellTip?.(pageOf())?.content).toBe('700 of 7,000 units on ChatGPT');
  });

  it('an engine cell is n/a for an engine with no citation, never 0%', () => {
    const none = renderCell('engine-google_ai_mode', pageOf());
    expect(none.container).toHaveTextContent('n/a');
    expect(none.container).not.toHaveTextContent('0.0%');
    expect(columnOf('engine-google_ai_mode').cellTip?.(pageOf())?.content).toBe(
      'AI Mode has no citation in this window.',
    );
  });

  it('an engine cell is n/a, with its reason, while the engine totals are not known', () => {
    const { container } = renderCell('engine-chatgpt_web', pageOf(), { meta: undefined });
    expect(container).toHaveTextContent('n/a');
    expect(columnOf('engine-chatgpt_web', { meta: undefined }).cellTip?.(pageOf())?.content).toBe(
      'The citations on ChatGPT are not known yet.',
    );
  });

  it('the New badge shows only with previous 0 and answers in the previous period', () => {
    const fresh = pageOf({ previous: { citation_units: 0, observations: 0 } });
    expect(renderCell('status', fresh).container).toHaveTextContent('New');
    expect(columnOf('status').cellTip?.(fresh)?.content).toBe(
      'Not cited in the previous period, when 4,500 answers were read.',
    );
    expect(renderCell('status', pageOf()).container).not.toHaveTextContent('New');
    expect(renderCell('status', pageOf({ previous: null })).container).not.toHaveTextContent('New');
    expect(renderCell('status', fresh, { meta: { ...META, previous_answers: 0 } }).container).not.toHaveTextContent(
      'New',
    );
  });
});

describe('first and last seen', () => {
  it('are in the project time zone', () => {
    const utc = renderCell('firstSeen', pageOf());
    expect(utc.container).toHaveTextContent('Oct 20, 08:00');
    utc.unmount();
    const india = renderCell('firstSeen', pageOf(), { timeZone: 'Asia/Kolkata' });
    expect(india.container).toHaveTextContent('Oct 20, 13:30');
    india.unmount();
    // 22:30 UTC is the next day in Kolkata
    expect(renderCell('lastSeen', pageOf(), { timeZone: 'Asia/Kolkata' }).container).toHaveTextContent('Nov 11, 04:00');
  });

  it('have their own headers', () => {
    expect(columnOf('firstSeen').header).toBe('First seen');
    expect(columnOf('lastSeen').header).toBe('Last seen');
  });
});

describe('Cited with', () => {
  it('says it is the domain and not the page in its header and its tooltip', () => {
    expect(columnOf('citedWith').header).toBe('Cited with (domain)');
    expect(columnOf('citedWith').headerTooltip).toBe(
      'The entity named most often beside the domain of this page. It is a figure of the domain, not of the page.',
    );
    expect(columnOf('citedWith').cellTip?.(pageOf())?.content).toBe(
      'HubSpot, named in 12 answers that cite this domain, not only this page',
    );
  });

  it('names the entity of the domain of the page', () => {
    expect(renderCell('citedWith', pageOf()).container).toHaveTextContent('HubSpot');
  });

  it('says None named when the domain names no entity', () => {
    const { container } = renderCell('citedWith', pageOf(), { citedWith: { rows: [domainOf()], failed: false } });
    expect(container).toHaveTextContent('None named');
  });

  it('says in words that the domain is outside the 200 most cited ones', () => {
    const row = pageOf({ registrable_domain: 'elsewhere.org', host: 'elsewhere.org' });
    const { container } = renderCell('citedWith', row);
    expect(container).toHaveTextContent('Outside the 200 most cited domains');
    expect(container).not.toHaveTextContent('None named');
    expect(columnOf('citedWith').cellTip?.(row)?.content).toBe('Outside the 200 most cited domains');
  });

  it('is n/a, with its reason, while the domains are read', () => {
    const { container } = renderCell('citedWith', pageOf(), { citedWith: { rows: undefined, failed: false } });
    expect(container).toHaveTextContent('n/a');
    expect(container).not.toHaveTextContent('None named');
    expect(container).not.toHaveTextContent('Outside');
    expect(columnOf('citedWith', { citedWith: { rows: undefined, failed: false } }).cellTip?.(pageOf())?.content).toBe(
      'Cited with is still loading.',
    );
  });

  it('is n/a, with its reason, when the domains could not be read', () => {
    const none = { rows: undefined, failed: true };
    const { container } = renderCell('citedWith', pageOf(), { citedWith: none });
    expect(container).toHaveTextContent('n/a');
    expect(columnOf('citedWith', { citedWith: none }).cellTip?.(pageOf())?.content).toBe(
      'Cited with could not be loaded. The other columns are complete.',
    );
  });

  it('is n/a, with its reason, while the name of the entity is not known', () => {
    const { container } = renderCell('citedWith', pageOf(), { entities: undefined });
    expect(container).toHaveTextContent('n/a');
    expect(columnOf('citedWith', { entities: undefined }).cellTip?.(pageOf())?.content).toBe(
      'The name of this entity is not loaded yet.',
    );
  });
});

describe('across the cells of a page row', () => {
  it('is axe clean', async () => {
    const columns = columnsFor();
    const { container } = renderWithProviders(
      <ul>
        {columns.map((column) => (
          <li key={column.id}>{column.cell(pageOf())}</li>
        ))}
      </ul>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
