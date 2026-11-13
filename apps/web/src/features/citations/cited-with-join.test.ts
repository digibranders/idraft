import { describe, expect, it } from 'vitest';

import { joinCitedWith } from './cited-with-join';
import type { SourceDomainRow } from '@/lib/citations/types';

const share = { value: 0.1, numerator: 1, denominator: 10, n_observations: 5 };

const domainOf = (overrides: Partial<SourceDomainRow> = {}): SourceDomainRow => ({
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 10,
  observations: 5,
  prompts: 2,
  engines: [],
  source_share: share,
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  ...overrides,
});

const NAMED = { entity_id: 'ent-hubspot', observations: 7 };

describe('joinCitedWith', () => {
  it('joins by registrable domain and role entity', () => {
    const rows = [
      domainOf({ role_entity_id: 'ent-a', cited_with: { entity_id: 'ent-x', observations: 1 } }),
      domainOf({ role_entity_id: 'ent-b', cited_with: NAMED }),
      domainOf({
        registrable_domain: 'other.com',
        role_entity_id: 'ent-b',
        cited_with: { entity_id: 'ent-y', observations: 2 },
      }),
    ];
    expect(joinCitedWith({ registrable_domain: 'g2.com', role_entity_id: 'ent-b' }, rows)).toEqual({
      state: 'found',
      citedWith: NAMED,
    });
  });

  it('joins a row with no role entity to the row of the same domain with none', () => {
    const rows = [domainOf({ role_entity_id: 'ent-a' }), domainOf({ role_entity_id: null, cited_with: NAMED })];
    expect(joinCitedWith({ registrable_domain: 'g2.com', role_entity_id: null }, rows)).toEqual({
      state: 'found',
      citedWith: NAMED,
    });
  });

  it('says outside when the domain is not among the loaded ones', () => {
    const rows = [domainOf({ cited_with: NAMED })];
    expect(joinCitedWith({ registrable_domain: 'elsewhere.com', role_entity_id: null }, rows)).toEqual({
      state: 'outside',
    });
    // The same domain under another role entity is another row
    expect(joinCitedWith({ registrable_domain: 'g2.com', role_entity_id: 'ent-z' }, rows)).toEqual({
      state: 'outside',
    });
    expect(joinCitedWith({ registrable_domain: 'g2.com', role_entity_id: null }, [])).toEqual({ state: 'outside' });
  });

  it('says none when the domain names no entity', () => {
    expect(
      joinCitedWith({ registrable_domain: 'g2.com', role_entity_id: null }, [domainOf({ cited_with: null })]),
    ).toEqual({ state: 'none' });
    expect(joinCitedWith({ registrable_domain: 'g2.com', role_entity_id: null }, [domainOf()])).toEqual({
      state: 'none',
    });
  });
});
