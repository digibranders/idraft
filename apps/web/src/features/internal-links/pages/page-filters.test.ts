import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import {
  capTags,
  MAX_TAGS,
  pageExportQuery,
  pageFilterFields,
  pageQueryOf,
  UNTIERED_QUERY,
  UNTIERED_VALUE,
} from './page-filters';
import { parseLinksSearch } from '../url-state';
import { DEFAULT_PAGE_QUERY } from '@/lib/internal-links/queries';
import type { PageTier } from '@/lib/internal-links/types';
import messages from '../../../../messages/en.json';

const t = createTranslator({ locale: 'en', messages, namespace: 'internalLinks' });

const TIER = '0192e4a0-2000-7000-8000-000000000001';
const TAG = '0192e4a0-4000-7000-8000-000000000001';

const tier = (position: number): PageTier => ({
  tier_id: `0192e4a0-2000-7000-8000-00000000000${String(position)}`,
  code: `T${String(position)}`,
  name: `Name ${String(position)}`,
  label: `T${String(position)} Name ${String(position)}`,
  description: '',
  position,
  page_count: 0,
  rule_count: 0,
  updated_at: '2026-11-14T03:12:00Z',
});

describe('pageQueryOf', () => {
  it('reads the filter bar values, the worklist, the scope, the sort and the search into one query', () => {
    const state = parseLinksSearch({ scope: 'all', view: 'orphans', sort: 'path', q: '/blog' });
    const query = pageQueryOf(
      state,
      {
        tier: { kind: 'enum', values: [UNTIERED_VALUE] },
        status: { kind: 'enum', values: ['4xx', '9xx'] },
        idx: { kind: 'enum', values: ['no'] },
        flag: { kind: 'enum', values: ['orphan', 'unknown_flag'] },
        tag: { kind: 'enum', values: [TAG] },
      },
      'c1',
      200,
    );
    expect(query).toEqual({
      scope: 'all',
      tierIds: ['none'],
      tagIds: [TAG],
      status: ['4xx'],
      indexable: false,
      flags: ['orphan'],
      worklist: 'orphans',
      q: '/blog',
      sort: 'path',
      include: [],
      cursor: 'c1',
      limit: 200,
    });
  });

  it('is the default read for an address with no filters', () => {
    expect(pageQueryOf(parseLinksSearch({}), {}, null, 100)).toEqual(DEFAULT_PAGE_QUERY);
  });

  it('keeps only ids the API takes, so a hand-edited tier or tag in the address never makes a 422', () => {
    const query = pageQueryOf(
      parseLinksSearch({}),
      {
        tier: { kind: 'enum', values: [TIER, 'none', 'T1', 'NONE', '../x'] },
        tag: { kind: 'enum', values: ['t', TAG] },
      },
      null,
      100,
    );
    expect(query.tierIds).toEqual([TIER, 'none']);
    expect(query.tagIds).toEqual([TAG]);
  });

  it('reads the yes of Indexable as true and anything else as no choice', () => {
    expect(pageQueryOf(parseLinksSearch({}), { idx: { kind: 'enum', values: ['yes'] } }, null, 100).indexable).toBe(
      true,
    );
    expect(pageQueryOf(parseLinksSearch({}), { idx: { kind: 'enum', values: ['maybe'] } }, null, 100).indexable).toBe(
      null,
    );
  });
});

describe('the Untiered filter', () => {
  it('is the value the summary strip links to: the link and the filter bar agree', () => {
    expect(UNTIERED_QUERY).toBe(`tier=${UNTIERED_VALUE}`);
    const fields = pageFilterFields(t, [tier(1), tier(2)], [], false);
    const tierField = fields.find((field) => field.id === 'tier');
    expect(tierField?.kind).toBe('enum');
    if (tierField?.kind !== 'enum') return;
    expect(tierField.options.map((option) => option.value)).toEqual([tier(1).tier_id, tier(2).tier_id, 'none']);
  });
});

describe('pageFilterFields', () => {
  it('offers only the allow-listed statuses and flags, and no equity anywhere', () => {
    const fields = pageFilterFields(t, [tier(1)], [{ termId: TAG, name: 'Launch' }], false);
    const options = fields.flatMap((field) => (field.kind === 'enum' ? field.options.map((o) => o.value) : []));
    expect(fields.map((field) => field.id)).toEqual(['tier', 'tag', 'status', 'idx', 'flag']);
    expect(options).toEqual(
      expect.arrayContaining([
        '2xx',
        '3xx',
        '4xx',
        '5xx',
        'orphan',
        'editorial_orphan',
        'deep_only_through_auto',
        'generic_anchors',
      ]),
    );
    const flag = fields.find((field) => field.id === 'flag');
    expect(flag?.kind === 'enum' ? flag.options.map((option) => option.label) : []).toContain('Mostly generic anchors');
    expect(JSON.stringify(fields)).not.toMatch(/equity/i);
  });

  it('keeps a value from the address while the tiers or tags have not loaded', () => {
    const fields = pageFilterFields(t, [], [], true);
    const byId = new Map(fields.map((field) => [field.id, field]));
    expect(byId.get('tier')).toMatchObject({ optionsLoading: true });
    expect(byId.get('tag')).toMatchObject({ optionsLoading: true });
  });
});

describe('capTags', () => {
  const tags = (count: number): string[] =>
    Array.from({ length: count }, (_, index) => `0192e4a0-4000-7000-8000-${String(index).padStart(12, '0')}`);

  it('has nothing to cut up to the most the API takes', () => {
    expect(MAX_TAGS).toBe(50);
    expect(capTags({})).toBeNull();
    expect(capTags({ tag: { kind: 'enum', values: tags(MAX_TAGS) } })).toBeNull();
  });

  it('keeps the first tags beyond that, and the other filters as they were', () => {
    const idx = { kind: 'enum', values: ['no'] } as const;
    const capped = capTags({ idx, tag: { kind: 'enum', values: tags(MAX_TAGS + 3) } });
    expect(capped).toEqual({ idx, tag: { kind: 'enum', values: tags(MAX_TAGS) } });
  });
});

describe('pageExportQuery (decision W13)', () => {
  it('is the current filter and sort as CSV, without a cursor or a page size', () => {
    const query = pageQueryOf(
      parseLinksSearch({ scope: 'all', sort: '-outlinks', q: 'x' }),
      { tier: { kind: 'enum', values: ['none'] }, idx: { kind: 'enum', values: ['no'] } },
      'c9',
      200,
    );
    expect(pageExportQuery(query)).toEqual({
      scope: 'all',
      sort: '-outlinks',
      'filter[tier]': ['none'],
      'filter[indexable]': false,
      q: 'x',
      format: 'csv',
    });
  });

  it('leaves the extras out, the CSV has its own columns', () => {
    expect(pageExportQuery({ ...DEFAULT_PAGE_QUERY, include: ['changes', 'gsc'] })).not.toHaveProperty('include');
  });

  it('never names equity', () => {
    expect(JSON.stringify(pageExportQuery(DEFAULT_PAGE_QUERY))).not.toMatch(/equity/i);
  });
});
