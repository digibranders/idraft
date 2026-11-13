import { createTranslator } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { changeLines, domainLines, pageLines, type ChangeWords, type Comparison } from './list-lines';
import messages from '../../../../messages/en.json';
import type { DomainRole, MetricCell, SourceChangeRow, SourceDomainRow, SourcePageRow } from '@/lib/citations/types';

const words: ChangeWords = {
  t: createTranslator({ locale: 'en', messages, namespace: 'citations.mobile' }),
  roles: createTranslator({ locale: 'en', messages, namespace: 'common.domainCell.roles' }),
  locale: 'en',
  timeZone: 'UTC',
};

const share = (units: number, total: number): MetricCell => ({
  value: total === 0 ? null : units / total,
  numerator: units,
  denominator: total,
  n_observations: 40,
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
  previous: { citation_units: 1102, observations: 400 },
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  series: [],
  ...overrides,
});

const pageOf = (overrides: Partial<SourcePageRow> = {}): SourcePageRow => ({
  url_id: 7,
  url: 'https://g2.com/products/crm',
  title: 'Best CRM tools',
  host: 'g2.com',
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 300,
  observations: 120,
  prompts: 20,
  engines: [],
  source_share: share(300, 18420),
  previous: { citation_units: 150, observations: 60 },
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  series: [],
  ...overrides,
});

const changeOf = (overrides: Partial<SourceChangeRow> = {}): SourceChangeRow => ({
  registrable_domain: 'agency-radar.example',
  domain_role: 'third_party',
  role_entity_id: null,
  current_units: 14,
  previous_units: 0,
  first_seen_at: '2026-11-03T08:15:00Z',
  last_seen_at: '2026-11-10T09:00:00Z',
  ...overrides,
});

const COMPARED: Comparison = { meta: { previous_answers: 4500 }, previousMeta: { citation_units: 13280 } };
const NOT_COMPARED: Comparison = { meta: { previous_answers: 0 }, previousMeta: undefined };

beforeEach(() => vi.setSystemTime(new Date('2026-11-12T12:00:00Z')));
afterEach(() => vi.useRealTimers());

describe('list lines: Domains', () => {
  it('line 1 is the registrable domain and its share, line 2 the role and "N of M units"', () => {
    const lines = domainLines(domainOf(), COMPARED, words);
    expect(lines.identity).toBe('g2.com');
    expect(lines.value).toBe('10.4%');
    expect(lines.valueLabel).toBe('Source share');
    expect(lines.context).toBe('Third party, 1,912 of 18,420 units');
  });

  it('the share is never shown without its counts', () => {
    const rows = [
      domainOf(),
      domainOf({ source_share: share(4, 18420), domain_role: 'own' }),
      domainOf({ source_share: share(800, 18420), domain_role: 'competitor' }),
    ];
    for (const row of rows) {
      const lines = domainLines(row, COMPARED, words);
      expect(lines.value).not.toBeNull();
      expect(lines.context).toContain(`${row.source_share.numerator.toLocaleString('en')} of 18,420 units`);
    }
  });

  it('an unknown share is n/a, not 0%', () => {
    const lines = domainLines(domainOf({ source_share: share(0, 0) }), COMPARED, words);
    expect(lines.value).toBeNull();
    expect(lines.valueLabel).toBe('Share n/a');
    expect(JSON.stringify(lines)).not.toContain('0%');
    // The counts stay, so the reader sees what the share would have been of
    expect(lines.context).toBe('Third party, 0 of 0 units');
  });

  it('a share of zero units over a known total is 0.0%, a real share and not n/a', () => {
    const lines = domainLines(domainOf({ source_share: share(0, 18420) }), COMPARED, words);
    expect(lines.value).toBe('0.0%');
    expect(lines.context).toBe('Third party, 0 of 18,420 units');
  });

  it('the change is a neutral points delta or nothing without a comparison', () => {
    const moved = domainLines(domainOf(), COMPARED, words).delta;
    expect(moved).toMatchObject({ unit: 'points', polarity: 'neutral', isDetectable: null });
    expect(moved?.value).toBeCloseTo(0.0208, 3);
    // The period before has no answers, the comparison is off, or the row has no earlier block
    expect(domainLines(domainOf(), NOT_COMPARED, words).delta).toBeNull();
    expect(domainLines(domainOf(), { meta: COMPARED.meta, previousMeta: undefined }, words).delta).toBeNull();
    expect(domainLines(domainOf({ previous: null }), COMPARED, words).delta).toBeNull();
    expect(domainLines(domainOf(), { meta: undefined, previousMeta: undefined }, words).delta).toBeNull();
  });

  it('names the Own role in words, and the other two', () => {
    const roleOf = (role: DomainRole): string => domainLines(domainOf({ domain_role: role }), COMPARED, words).context;
    expect(roleOf('own')).toMatch(/^Own, /);
    expect(roleOf('competitor')).toMatch(/^Competitor, /);
    expect(roleOf('third_party')).toMatch(/^Third party, /);
  });
});

describe('list lines: Pages', () => {
  it("a page's identity is its title or its address as text", () => {
    expect(pageLines(pageOf(), COMPARED, words).identity).toBe('Best CRM tools');
    // No title, or a blank one: the address, as sent
    expect(pageLines(pageOf({ title: null }), COMPARED, words).identity).toBe('https://g2.com/products/crm');
    expect(pageLines(pageOf({ title: '   ' }), COMPARED, words).identity).toBe('https://g2.com/products/crm');
    // Provider text is data: markup stays characters
    expect(pageLines(pageOf({ title: '<img src=x onerror=alert(1)>' }), COMPARED, words).identity).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('line 1 carries the share and line 2 the role and its units, never one without the other', () => {
    const lines = pageLines(pageOf(), COMPARED, words);
    expect(lines.value).toBe('1.6%');
    expect(lines.context).toBe('Third party, 300 of 18,420 units');
    const unknown = pageLines(pageOf({ source_share: share(0, 0) }), COMPARED, words);
    expect(unknown.value).toBeNull();
    expect(unknown.valueLabel).toBe('Share n/a');
  });

  it('the change is a neutral points delta, and nothing without a comparison', () => {
    expect(pageLines(pageOf(), COMPARED, words).delta).toMatchObject({ unit: 'points', polarity: 'neutral' });
    expect(pageLines(pageOf(), NOT_COMPARED, words).delta).toBeNull();
  });
});

describe('list lines: New and lost', () => {
  it('a new row says its units and the date it was first cited', () => {
    const lines = changeLines('new', changeOf(), words);
    expect(lines.identity).toBe('agency-radar.example');
    expect(lines.valueLabel).toBe('Citation units');
    expect(lines.value).toBe('14');
    expect(lines.context).toBe('Third party, first cited Nov 3, 08:15');
    expect(lines.delta).toBeNull();
  });

  it('a new row with no date says n/a, never today', () => {
    expect(changeLines('new', changeOf({ first_seen_at: null }), words).context).toBe('Third party, first cited n/a');
  });

  it('a lost row says the units it had before it went quiet, and how long it was quiet', () => {
    const lines = changeLines('lost', changeOf({ current_units: 0, previous_units: 31, first_seen_at: null }), words);
    expect(lines.valueLabel).toBe('Units before it went quiet');
    expect(lines.value).toBe('31');
    expect(lines.context).toBe('Third party, quiet for 2 windows');
    expect(lines.delta).toBeNull();
  });

  it('names the Own role in words', () => {
    expect(changeLines('new', changeOf({ domain_role: 'own' }), words).context).toMatch(/^Own, first cited /);
    expect(changeLines('lost', changeOf({ domain_role: 'competitor' }), words).context).toMatch(/^Competitor, quiet/);
  });
});
