import { describe, expect, it } from 'vitest';

import { buildRows, domainRowId, PAGES_PER_DOMAIN, type ChildPagesRead } from './domain-rows';
import type { MetricCell, SourceDomainRow, SourcePagePage, SourcePageRow } from '@/lib/citations/types';

const cell = (units: number): MetricCell => ({
  value: units / 200,
  numerator: units,
  denominator: 200,
  n_observations: 24,
});

const domainOf = (overrides: Partial<SourceDomainRow> = {}): SourceDomainRow => ({
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 20,
  observations: 9,
  prompts: 4,
  engines: [{ engine_code: 'chatgpt_web', citation_units: 20 }],
  source_share: cell(20),
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  ...overrides,
});

const pageOf = (urlId: number, overrides: Partial<SourcePageRow> = {}): SourcePageRow => ({
  url_id: urlId,
  url: `https://g2.com/products/${urlId}`,
  title: `Product ${urlId}`,
  host: 'g2.com',
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 5,
  observations: 3,
  prompts: 2,
  engines: [{ engine_code: 'chatgpt_web', citation_units: 5 }],
  source_share: cell(5),
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  ...overrides,
});

const pagesOf = (count: number, total: number = count): SourcePagePage => ({
  data: Array.from({ length: count }, (_, index) => pageOf(index + 1)),
  meta: {
    window: { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' },
    include_branded: false,
    engine_codes: ['chatgpt_web'],
    answers: 24,
    answers_citing: 20,
    citation_units: 200,
    by_role: [],
  },
  page: { limit: 10, offset: 0, total },
});

const ready = (data: SourcePagePage): ChildPagesRead => ({ status: 'ready', data });
const loading: ChildPagesRead = { status: 'loading', data: undefined };
const failed: ChildPagesRead = { status: 'error', data: undefined };

const G2 = domainOf();
const OWN = domainOf({ registrable_domain: 'northwind.com', domain_role: 'own', role_entity_id: 'ent-1' });
const G2_ID = domainRowId(G2);

describe('domainRowId', () => {
  it('is the registrable domain, the role and the entity', () => {
    expect(domainRowId(G2)).toBe('g2.com|third_party|');
    expect(domainRowId(OWN)).toBe('northwind.com|own|ent-1');
  });
});

describe('buildRows', () => {
  it('keeps one row per registrable domain, role and entity with distinct ids', () => {
    const asCompetitor = domainOf({ domain_role: 'competitor', role_entity_id: 'ent-2' });
    const { rows } = buildRows([G2, asCompetitor, OWN], new Set(), new Map());
    expect(rows.map((row) => row.kind)).toEqual(['domain', 'domain', 'domain']);
    const ids = rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('g2.com|third_party|');
    expect(ids[1]).toBe('g2.com|competitor|ent-2');
  });

  it('puts the pages of an expanded domain right under it at level 2', () => {
    const { rows, tree } = buildRows([G2, OWN], new Set([G2_ID]), new Map([[G2_ID, ready(pagesOf(3))]]));
    expect(rows.map((row) => row.kind)).toEqual(['domain', 'page', 'page', 'page', 'domain']);
    expect(tree.get(rows[0]?.id ?? '')).toMatchObject({ level: 1, expanded: true });
    expect(tree.get(rows[1]?.id ?? '')?.level).toBe(2);
    expect(tree.get(rows[3]?.id ?? '')?.level).toBe(2);
    expect(tree.get(rows[4]?.id ?? '')).toMatchObject({ level: 1, expanded: false });
    const page = rows[1];
    expect(page?.kind === 'page' && page.parentId).toBe(G2_ID);
  });

  it('adds View all N pages when the domain has more than 10', () => {
    const read = ready(pagesOf(PAGES_PER_DOMAIN, 48));
    const { rows } = buildRows([G2], new Set([G2_ID]), new Map([[G2_ID, read]]));
    const last = rows.at(-1);
    expect(rows).toHaveLength(1 + PAGES_PER_DOMAIN + 1);
    expect(last).toMatchObject({ kind: 'more', registrable: 'g2.com', total: 48, parentId: G2_ID });
  });

  it('adds no View all row for a domain with 10 pages or fewer', () => {
    const { rows } = buildRows([G2], new Set([G2_ID]), new Map([[G2_ID, ready(pagesOf(PAGES_PER_DOMAIN))]]));
    expect(rows.some((row) => row.kind === 'more')).toBe(false);
  });

  it('adds a loading row and a failed row for a child read that is pending or failed', () => {
    const other = domainOf({ registrable_domain: 'capterra.com' });
    const otherId = domainRowId(other);
    const pending = buildRows([G2], new Set([G2_ID]), new Map([[G2_ID, loading]]));
    expect(pending.rows.map((row) => row.kind)).toEqual(['domain', 'pages-loading']);
    // A read that has not started is on its way too
    expect(buildRows([G2], new Set([G2_ID]), new Map()).rows.map((row) => row.kind)).toEqual([
      'domain',
      'pages-loading',
    ]);
    const broken = buildRows([G2, other], new Set([G2_ID, otherId]), new Map([[G2_ID, failed]]));
    expect(broken.rows.map((row) => row.kind)).toEqual(['domain', 'pages-failed', 'domain', 'pages-loading']);
    const row = broken.rows[1];
    expect(row?.kind === 'pages-failed' && row.parentId).toBe(G2_ID);
  });

  it('keeps the pages it has when a later read failed', () => {
    const stale: ChildPagesRead = { status: 'error', data: pagesOf(2) };
    const { rows } = buildRows([G2], new Set([G2_ID]), new Map([[G2_ID, stale]]));
    expect(rows.map((row) => row.kind)).toEqual(['domain', 'page', 'page']);
  });

  it('a collapsed domain has no children', () => {
    const { rows, tree } = buildRows([G2], new Set(), new Map([[G2_ID, ready(pagesOf(3))]]));
    expect(rows.map((row) => row.kind)).toEqual(['domain']);
    expect(tree.get(G2_ID)?.expanded).toBe(false);
  });

  it('setSize and posInSet follow the level', () => {
    const { rows, tree } = buildRows(
      [G2, OWN],
      new Set([G2_ID]),
      new Map([[G2_ID, ready(pagesOf(PAGES_PER_DOMAIN, 48))]]),
    );
    const ids = rows.map((row) => row.id);
    // Two domains at level 1
    expect(tree.get(ids[0] ?? '')).toMatchObject({ setSize: 2, posInSet: 1 });
    expect(tree.get(ids.at(-1) ?? '')).toMatchObject({ setSize: 2, posInSet: 2 });
    // Ten pages and the View all row make 11 in the group
    expect(tree.get(ids[1] ?? '')).toMatchObject({ level: 2, setSize: PAGES_PER_DOMAIN + 1, posInSet: 1 });
    expect(tree.get(ids[PAGES_PER_DOMAIN] ?? '')).toMatchObject({ posInSet: PAGES_PER_DOMAIN });
    expect(tree.get(ids[PAGES_PER_DOMAIN + 1] ?? '')).toMatchObject({ posInSet: PAGES_PER_DOMAIN + 1 });
  });

  it('is not selectable on the rows that are not pages', () => {
    const { rows, tree } = buildRows([G2], new Set([G2_ID]), new Map([[G2_ID, ready(pagesOf(PAGES_PER_DOMAIN, 48))]]));
    const more = rows.at(-1);
    expect(tree.get(more?.id ?? '')?.selectable).toBe(false);
    expect(tree.get(rows[1]?.id ?? '')?.selectable).not.toBe(false);
    const waiting = buildRows([G2], new Set([G2_ID]), new Map([[G2_ID, loading]]));
    expect(tree.get(waiting.rows[0]?.id ?? '')?.selectable).not.toBe(false);
    expect(waiting.tree.get(waiting.rows[1]?.id ?? '')?.selectable).toBe(false);
    const broken = buildRows([G2], new Set([G2_ID]), new Map([[G2_ID, failed]]));
    expect(broken.tree.get(broken.rows[1]?.id ?? '')?.selectable).toBe(false);
  });

  it('has a tree fact for every row and no row twice', () => {
    const { rows, tree } = buildRows([G2, OWN], new Set([G2_ID]), new Map([[G2_ID, ready(pagesOf(4, 4))]]));
    expect(tree.size).toBe(rows.length);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });
});
