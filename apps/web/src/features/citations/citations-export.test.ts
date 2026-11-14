import { describe, expect, it } from 'vitest';

import {
  buildCitationsExport,
  citationsExportFileName,
  type CitationsExportLabels,
  type ExportRows,
} from './citations-export';
import type { EngineInScope } from './engine-share';
import type { MetricCell, SourceDomainRow, SourcePageRow, SourcesMeta } from '@/lib/citations/types';

const TOTAL = 18420;
const share = (units: number, total = TOTAL): MetricCell => ({
  value: total === 0 ? null : units / total,
  numerator: units,
  denominator: total,
  n_observations: 4812,
});

const META: SourcesMeta = {
  window: { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' },
  include_branded: false,
  engine_codes: ['chatgpt_web', 'gemini_web'],
  answers: 4812,
  answers_citing: 4000,
  citation_units: TOTAL,
  by_role: [{ domain_role: 'third_party', citation_units: TOTAL, observations: 4000 }],
  previous_answers: 4500,
};
const PREVIOUS: SourcesMeta = { ...META, citation_units: 15000 };

const ENGINES: readonly EngineInScope[] = [
  { code: 'chatgpt_web', label: 'ChatGPT' },
  { code: 'gemini_web', label: 'Gemini' },
];

const LABELS: CitationsExportLabels = {
  domain: 'Domain',
  url: 'URL',
  title: 'Title',
  role: 'Role',
  roleName: (role) => ({ own: 'Own', competitor: 'Competitor', third_party: 'Third party' })[role],
  units: 'Citation units',
  share: 'Source share (%)',
  total: 'Total citation units in scope',
  answers: 'Answers',
  prompts: 'Prompts',
  engineUnits: (engine) => `Citation units on ${engine}`,
  change: 'Change in share (points)',
  citedWith: 'Cited with',
  noneNamed: 'None named',
  firstSeen: 'First seen',
  lastSeen: 'Last seen',
  entityName: (id) => (id === 'ent-hubspot' ? 'HubSpot' : undefined),
};

const domain = (overrides: Partial<SourceDomainRow> = {}): SourceDomainRow => ({
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 1912,
  observations: 640,
  prompts: 48,
  engines: [
    { engine_code: 'chatgpt_web', citation_units: 1000 },
    { engine_code: 'gemini_web', citation_units: 912 },
  ],
  source_share: share(1912),
  previous: { citation_units: 1000, observations: 400 },
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  cited_with: { entity_id: 'ent-hubspot', observations: 12 },
  ...overrides,
});

const page = (overrides: Partial<SourcePageRow> = {}): SourcePageRow => ({
  url_id: 1,
  url: 'https://g2.com/products/crm',
  title: 'Best CRM software',
  host: 'g2.com',
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 300,
  observations: 120,
  prompts: 20,
  engines: [{ engine_code: 'chatgpt_web', citation_units: 300 }],
  source_share: share(300),
  previous: { citation_units: 100, observations: 40 },
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  ...overrides,
});

const domains = (rows: readonly SourceDomainRow[]): ExportRows => ({ tab: 'domains', rows });
const pages = (rows: readonly SourcePageRow[]): ExportRows => ({ tab: 'pages', rows });

describe('buildCitationsExport, Domains', () => {
  it('writes numbers as numbers and shares as percents with the units and the total beside them', () => {
    const file = buildCitationsExport(domains([domain()]), META, undefined, ENGINES, LABELS);
    expect(file.header).toEqual([
      'Domain',
      'Role',
      'Citation units',
      'Source share (%)',
      'Total citation units in scope',
      'Answers',
      'Prompts',
      'Citation units on ChatGPT',
      'Citation units on Gemini',
      'Cited with',
    ]);
    expect(file.rows).toEqual([['g2.com', 'Third party', 1912, 10.38, 18420, 640, 48, 1000, 912, 'HubSpot']]);
  });

  it('writes the domain, the role and the entity name as text a spreadsheet will not run', () => {
    const file = buildCitationsExport(
      domains([domain({ registrable_domain: '=cmd|calc', cited_with: { entity_id: 'ent-evil', observations: 1 } })]),
      META,
      undefined,
      ENGINES,
      { ...LABELS, roleName: () => '=x', entityName: () => '@SUM(A1)' },
    );
    const [row] = file.rows;
    expect(row?.[0]).toBe("'=cmd|calc");
    expect(row?.[1]).toBe("'=x");
    expect(row?.at(-1)).toBe("'@SUM(A1)");
  });

  it('has one column per engine, in the order given, and 0 units for an engine the row has no citation on', () => {
    const file = buildCitationsExport(
      domains([domain({ engines: [{ engine_code: 'gemini_web', citation_units: 40 }] })]),
      META,
      undefined,
      [...ENGINES].reverse(),
      LABELS,
    );
    expect(file.header.slice(7, 9)).toEqual(['Citation units on Gemini', 'Citation units on ChatGPT']);
    expect(file.rows[0]?.slice(7, 9)).toEqual([40, 0]);
  });

  it('leaves out Change in share when the comparison is off and writes it in points when it is on', () => {
    const off = buildCitationsExport(domains([domain()]), META, undefined, ENGINES, LABELS);
    expect(off.header).not.toContain('Change in share (points)');
    const on = buildCitationsExport(domains([domain()]), META, PREVIOUS, ENGINES, LABELS);
    const at = on.header.indexOf('Change in share (points)');
    expect(at).toBeGreaterThan(0);
    // 10.38% now, 1,000 of 15,000 units before (6.67%)
    expect(on.rows[0]?.[at]).toBe(3.71);
  });

  it('leaves the change of a row with no previous block empty, never 0', () => {
    const file = buildCitationsExport(domains([domain({ previous: null })]), META, PREVIOUS, ENGINES, LABELS);
    expect(file.rows[0]?.[file.header.indexOf('Change in share (points)')]).toBeNull();
  });

  it('says None named for a domain that names no entity and leaves a name that is not known empty', () => {
    const none = buildCitationsExport(domains([domain({ cited_with: null })]), META, undefined, ENGINES, LABELS);
    expect(none.rows[0]?.at(-1)).toBe('None named');
    const unknown = buildCitationsExport(
      domains([domain({ cited_with: { entity_id: 'ent-other', observations: 3 } })]),
      META,
      undefined,
      ENGINES,
      LABELS,
    );
    expect(unknown.rows[0]?.at(-1)).toBeNull();
  });

  it('leaves the share empty when the scope has no unit, never 0', () => {
    const file = buildCitationsExport(
      domains([domain({ source_share: share(0, 0) })]),
      META,
      undefined,
      ENGINES,
      LABELS,
    );
    expect(file.rows[0]?.slice(3, 5)).toEqual([null, 0]);
  });

  it('has no category column, whatever the row carries', () => {
    const file = buildCitationsExport(domains([domain({ category: 'Review site' })]), META, undefined, ENGINES, LABELS);
    expect(file.header).not.toContain('Category');
    expect(file.rows[0]).not.toContain('Review site');
  });
});

describe('buildCitationsExport, Pages', () => {
  it('writes the address, the title and the domain as text, the figures as numbers and the days as the API sent them', () => {
    const file = buildCitationsExport(pages([page()]), META, undefined, ENGINES.slice(0, 1), LABELS);
    expect(file.header).toEqual([
      'URL',
      'Title',
      'Domain',
      'Role',
      'Citation units',
      'Source share (%)',
      'Total citation units in scope',
      'Answers',
      'Prompts',
      'Citation units on ChatGPT',
      'First seen',
      'Last seen',
    ]);
    expect(file.rows).toEqual([
      [
        'https://g2.com/products/crm',
        'Best CRM software',
        'g2.com',
        'Third party',
        300,
        1.63,
        18420,
        120,
        20,
        300,
        '2026-10-20T08:00:00Z',
        '2026-11-10T08:00:00Z',
      ],
    ]);
  });

  it('writes the address, title, domain and role as text a spreadsheet will not run, and leaves a missing title empty', () => {
    const file = buildCitationsExport(
      pages([
        page({
          url: '=cmd|calc',
          title: '=HYPERLINK("http://evil.example")',
          registrable_domain: '+SUM(A1)',
        }),
        page({ url_id: 2, title: null }),
      ]),
      META,
      undefined,
      ENGINES,
      { ...LABELS, roleName: () => '=x' },
    );
    expect(file.rows[0]?.slice(0, 4)).toEqual(["'=cmd|calc", `'=HYPERLINK("http://evil.example")`, "'+SUM(A1)", "'=x"]);
    expect(file.rows[1]?.[1]).toBeNull();
  });

  it('writes Change in share before the days when it is compared', () => {
    const file = buildCitationsExport(pages([page()]), META, PREVIOUS, ENGINES, LABELS);
    const change = file.header.indexOf('Change in share (points)');
    expect(change).toBeGreaterThan(0);
    expect(change).toBeLessThan(file.header.indexOf('First seen'));
    // 1.63% now, 100 of 15,000 units before (0.67%)
    expect(file.rows[0]?.[change]).toBe(0.96);
  });
});

describe('citationsExportFileName', () => {
  it('names the tab and the window', () => {
    const range = { from: '2026-10-16', to: '2026-11-12' };
    expect(citationsExportFileName('domains', range)).toBe('citations-domains-2026-10-16-to-2026-11-12.csv');
    expect(citationsExportFileName('pages', range)).toBe('citations-pages-2026-10-16-to-2026-11-12.csv');
  });
});
