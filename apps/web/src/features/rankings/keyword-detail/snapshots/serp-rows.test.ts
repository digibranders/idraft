import { describe, expect, it } from 'vitest';

import { serpRows } from './serp-rows';
import type { EntityRef, SerpOrganicItem, SerpResult } from '@/lib/api/types';

const entity = (role: NonNullable<EntityRef['role']>): EntityRef => ({
  entity_id: `0192f0a1-3c44-7e10-9b1d-${role.padEnd(12, '0')}`,
  canonical_name: `${role} entity`,
  entity_type: 'organization',
  role,
  color_index: null,
});

function item(
  rank: number,
  host: string,
  who: EntityRef | null,
  extra: Partial<SerpResult & SerpOrganicItem> = {},
): SerpResult {
  return {
    organic_rank: rank,
    absolute_rank: rank,
    url: {
      url_id: String(rank),
      canonical_url: `https://${host}/page-${String(rank)}`,
      host,
      path: `/page-${String(rank)}`,
      registrable_domain: host,
    },
    domain: { domain_id: rank, host, registrable_domain: host },
    title: `Title ${String(rank)}`,
    snippet: `Snippet ${String(rank)}`,
    entity: who,
    ...extra,
  };
}

describe('serpRows', () => {
  it('orders by organic rank and names the kind of each row from its entity role', () => {
    const rows = serpRows([
      item(3, 'hubspot.com', entity('competitor')),
      item(1, 'fynix.digital', entity('own')),
      item(2, 'g2.com', null),
      item(4, 'zapier.com', entity('watch')),
    ]);
    expect(rows.map((r) => [r.rank, r.kind])).toEqual([
      [1, 'own'],
      [2, 'other'],
      [3, 'competitor'],
      [4, 'watch'],
    ]);
  });

  it('keeps two results of one domain as two rows', () => {
    expect(serpRows([item(1, 'a.com', null), item(2, 'a.com', null)]).map((r) => r.key)).toEqual(['1', '2']);
  });

  it('keeps the absolute rank when it differs from the organic rank', () => {
    expect(serpRows([item(1, 'a.com', null, { absolute_rank: 3 })])[0]?.absolute).toBe(3);
  });

  it('does not guess the kind from the domain: a result with no entity is other, whatever it is called', () => {
    expect(serpRows([item(1, 'fynix.digital', null)])[0]?.kind).toBe('other');
  });

  it('carries title, snippet, host, address and the entity of the result', () => {
    const who = entity('competitor');
    const [row] = serpRows([item(5, 'hubspot.com', who)]);
    expect(row).toMatchObject({
      rank: 5,
      title: 'Title 5',
      snippet: 'Snippet 5',
      host: 'hubspot.com',
      path: '/page-5',
      address: 'https://hubspot.com/page-5',
      entity: who,
    });
  });

  it('keeps a result without a title or a snippet as null, not as an empty string', () => {
    const [row] = serpRows([item(1, 'a.com', null, { title: null, snippet: null })]);
    expect(row?.title).toBeNull();
    expect(row?.snippet).toBeNull();
  });

  it('is empty for no results', () => {
    expect(serpRows([])).toEqual([]);
  });
});
