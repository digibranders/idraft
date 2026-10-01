import { describe, expect, it } from 'vitest';

import { otherNames } from './aliases';

describe('otherNames', () => {
  it('keeps each other name once, whatever its case, and leaves out the name itself', () => {
    expect(otherNames(' HubSpot ', ['hubspot', 'HubSpot CRM', ' ', 'hubspot crm'])).toEqual(['HubSpot CRM']);
  });
});
