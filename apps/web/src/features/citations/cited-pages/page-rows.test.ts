import { describe, expect, it } from 'vitest';

import { apiSort, ownerRole, PAGE_SORT_DEFAULT, pageText } from './page-rows';
import type { CitedPageRow } from '@/lib/citations/board-queries';

const ROW: CitedPageRow = {
  url_id: 7,
  url: 'https://g2.com/categories/crm/pricing',
  host: 'g2.com',
  path: '/categories/crm/pricing',
  registrable_domain: 'g2.com',
  title: null,
  domain_role: 'third_party',
  entity_id: null,
  entity_name: null,
  color_index: null,
  citations: 12,
  previous_citations: 0,
  prompts: 3,
  top_prompts: [{ prompt_id: 'p1', text: 'Best CRM?', citations: 6 }],
  engines: [{ engine_code: 'chatgpt_web', citation_units: 12 }],
  trend: [0, 0, 1, 2, 3, 2, 2, 2],
  last_cited_at: '2026-09-28T00:10:00.000Z',
};

describe('the Cited pages rows', () => {
  it('sends the sort to the API: descending first by citations (C 32, C 451)', () => {
    expect(PAGE_SORT_DEFAULT).toEqual({ key: 'citations', dir: 'desc' });
    expect(apiSort(PAGE_SORT_DEFAULT)).toBe('-citations');
    expect(apiSort({ key: 'last', dir: 'asc' })).toBe('last_cited');
    expect(apiSort({ key: 'page', dir: 'desc' })).toBe('-page');
    expect(apiSort({ key: 'unknown', dir: 'desc' })).toBe('-citations');
  });

  it('maps the owner filter onto the API role', () => {
    expect(ownerRole('own')).toBe('own');
    expect(ownerRole('third')).toBe('third_party');
    expect(ownerRole('all')).toBeNull();
  });

  it('writes the address as the preview does: host then path, the address without its scheme', () => {
    expect(pageText(ROW)).toEqual({
      host: 'g2.com',
      path: '/categories/crm/pricing',
      display: 'g2.com/categories/crm/pricing',
    });
  });
});
