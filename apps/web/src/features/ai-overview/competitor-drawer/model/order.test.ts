import { describe, expect, it } from 'vitest';

import { competitorOrder } from './order';
import type { CompetitorLead, LeadRead } from '../../cards/competitors/model/lead-rule';

const lead = (name: string, they: number, compared = 10): CompetitorLead => ({
  entity: { entityId: name, name, role: 'competitor', colorIndex: null, addedAt: null },
  they,
  you: 0,
  close: compared - they,
  compared,
  prompts: [],
});

describe('competitorOrder', () => {
  it('is the order of the Competitor gap card: they lead most first, then by name, with the uncompared left out', () => {
    const read: LeadRead = {
      status: 'read',
      tooFew: 0,
      competitors: [lead('Zoho', 2), lead('HubSpot', 5), lead('Apple', 2), lead('Nobody', 0, 0)],
    };
    expect(competitorOrder(read).map((entry) => entry.entity.name)).toEqual(['HubSpot', 'Apple', 'Zoho']);
  });

  it('is empty without a read', () => {
    expect(competitorOrder(null)).toEqual([]);
    expect(competitorOrder({ status: 'unread' })).toEqual([]);
  });
});
