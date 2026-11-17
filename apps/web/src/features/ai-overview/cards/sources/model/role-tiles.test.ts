import { describe, expect, it } from 'vitest';

import { roleTiles } from './role-tiles';
import type { SourcesMeta } from '@/lib/citations/types';

const roles = (own: number, competitor: number, thirdParty: number): Pick<SourcesMeta, 'by_role'> => ({
  // The API's order is not the card's: third party first
  by_role: [
    { domain_role: 'third_party', citation_units: thirdParty, observations: 0 },
    { domain_role: 'own', citation_units: own, observations: 0 },
    { domain_role: 'competitor', citation_units: competitor, observations: 0 },
  ],
});

describe('roleTiles', () => {
  it('lists the roles in a fixed order, whatever order the API sends them in, with shares that add up to 1', () => {
    const { total, tiles } = roleTiles(roles(90, 210, 700));
    expect(total).toBe(1000);
    expect(tiles.map((tile) => tile.role)).toEqual(['own', 'competitor', 'third_party']);
    expect(tiles.map((tile) => tile.share)).toEqual([0.09, 0.21, 0.7]);
  });

  it('keeps a role with no unit as a tile of 0 and has no tiles when the scope has no unit', () => {
    expect(roleTiles(roles(0, 40, 60)).tiles[0]).toEqual({ role: 'own', units: 0, share: 0 });
    expect(roleTiles(roles(0, 0, 0))).toEqual({ total: 0, tiles: [] });
  });
});
