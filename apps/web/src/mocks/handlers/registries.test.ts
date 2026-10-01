import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MOCK_LOCATIONS } from '../entity-fixtures';
import type { Location } from '@/lib/api/types';
import { TEST_API_ORIGIN } from '@/test/api-server';
import { CURSOR_PAGE, DOMAIN_CATEGORY, LOCATION } from '@/test/api-shapes';
import { dataOf, fieldCodes, mockBrowser, pageOf, type Answer } from '@/test/mock-api';

const locations = (answer: Answer): Location[] => dataOf(answer, z.array(LOCATION));
const names = (rows: readonly Location[]): string[] => rows.map((row) => row.name);

describe('locations', () => {
  it('needs a session, and nothing more', async () => {
    expect((await fetch(`${TEST_API_ORIGIN}/api/v1/locations`)).status).toBe(401);
    expect((await mockBrowser('billing').call('GET', '/api/v1/locations')).status).toBe(200);
  });

  it('lists every location by name in cursor pages', async () => {
    const viewer = mockBrowser('viewer');
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const answer = await viewer.call('GET', `/api/v1/locations?limit=5${cursor === null ? '' : `&cursor=${cursor}`}`);
      seen.push(...names(locations(answer)));
      cursor = pageOf(answer, CURSOR_PAGE).next_cursor;
    } while (cursor !== null);
    expect(seen).toHaveLength(MOCK_LOCATIONS.length);
    expect(seen).toEqual([...seen].sort((a, b) => a.localeCompare(b)));
  });

  it('filters by text, country, type and surface', async () => {
    const viewer = mockBrowser('viewer');
    const list = async (query: string): Promise<string[]> =>
      names(locations(await viewer.call('GET', `/api/v1/locations?${query}`)));
    expect(await list('filter[q]=LON')).toEqual(['London,England,United Kingdom']);
    expect(await list('filter[country_iso]=us')).toEqual([
      'Los Angeles,California,United States',
      'New York,New York,United States',
      'United States',
    ]);
    const countries = await list('filter[location_type]=Country&limit=200');
    expect(countries).toHaveLength(12);
    expect(countries[0]).toBe('Australia');
    expect(await list('filter[supports]=ai_mode')).toEqual([]);
    const london = locations(await viewer.call('GET', '/api/v1/locations?filter[q]=london'));
    expect(london[0]).toEqual({
      location_id: 1006886,
      name: 'London,England,United Kingdom',
      country_iso: 'GB',
      location_type: 'City',
      parent_id: 2826,
      supports: ['serp'],
    });
  });

  it('refuses what the API refuses', async () => {
    const viewer = mockBrowser('viewer');
    expect(fieldCodes(await viewer.call('GET', '/api/v1/locations?filter[supports]=maps'))).toEqual([
      'filter[supports]:enum',
    ]);
    expect(fieldCodes(await viewer.call('GET', '/api/v1/locations?filter[country_iso]=USA'))).toEqual([
      'filter[country_iso]:string_pattern_mismatch',
    ]);
    expect(fieldCodes(await viewer.call('GET', '/api/v1/locations?limit=500'))).toEqual(['limit:value_error']);
    expect(fieldCodes(await viewer.call('GET', '/api/v1/locations?country=US'))).toEqual(['country:extra_forbidden']);
    expect((await viewer.call('GET', '/api/v1/locations?cursor=nonsense')).code).toBe('invalid_cursor');
    expect(fieldCodes(await viewer.call('GET', '/api/v1/locations?filter[q]='))).toEqual([
      'filter[q]:string_too_short',
    ]);
    expect(fieldCodes(await viewer.call('GET', '/api/v1/locations?filter[location_type]='))).toEqual([
      'filter[location_type]:string_too_short',
    ]);
  });
});

describe('domain categories', () => {
  it('lists the 15 categories of doc 14 by code', async () => {
    const categories = dataOf(
      await mockBrowser('viewer').call('GET', '/api/v1/domain-categories'),
      z.array(DOMAIN_CATEGORY),
    );
    const codes = categories.map((category) => category.code);
    expect(codes).toHaveLength(15);
    expect(codes).toContain('review_aggregator');
    expect(codes).toEqual([...codes].sort());
    expect((await fetch(`${TEST_API_ORIGIN}/api/v1/domain-categories`)).status).toBe(401);
  });
});
