import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { gapsCsv, pagesCsv } from './board-export';
import messages from '../../../messages/en.json';
import type { CitationGapRow, CitedPageRow } from '@/lib/citations/board-queries';

const t = createTranslator({ locale: 'en', messages, namespace: 'citations' });
const ENGINES = [{ code: 'chatgpt_web' as const, label: 'ChatGPT' }];

describe('the Citations CSV', () => {
  it('writes one line per page with its engines, and a formula-looking title as text', () => {
    const row: CitedPageRow = {
      url_id: 1,
      url: 'https://fynix.digital/pricing',
      host: 'fynix.digital',
      path: '/pricing',
      registrable_domain: 'fynix.digital',
      title: '=Pricing',
      domain_role: 'own',
      entity_id: null,
      entity_name: null,
      color_index: null,
      citations: 76,
      previous_citations: 70,
      prompts: 31,
      top_prompts: [{ prompt_id: 'p1', text: 'Best CRM?', citations: 9 }],
      engines: [{ engine_code: 'chatgpt_web', citation_units: 76 }],
      trend: [],
      last_cited_at: '2026-09-28T00:10:00.000Z',
    };
    const table = pagesCsv([row], ENGINES, 'Europe/Berlin', t);
    expect(table.header).toEqual([
      'URL',
      'Title',
      'Domain type',
      'Brand',
      'Citations',
      'Citations before',
      'Prompts',
      'Top prompt',
      'Last cited',
      'ChatGPT citations',
    ]);
    expect(table.rows[0]).toEqual([
      'https://fynix.digital/pricing',
      "'=Pricing",
      'Your site',
      null,
      76,
      70,
      31,
      'Best CRM?',
      '2026-09-28',
      76,
    ]);
  });

  it('writes one line per prompt with you, each competitor and where it is lost', () => {
    const cell = { answers: 4, cited: 0, mentioned: 1, state: 'mentioned' as const };
    const brand = {
      total: cell,
      engines: [{ ...cell, engine_code: 'chatgpt_web' as const }],
      platforms: 1,
      cited_on: 0,
    };
    const row: CitationGapRow = {
      prompt_id: 'p1',
      text: 'Best CRM?',
      topic: null,
      you: brand,
      competitors: [{ ...brand, entity_id: 'c1', total: { ...cell, cited: 2, state: 'cited' }, cited_on: 1 }],
      gap: 1,
      lost_on: ['chatgpt_web'],
      lost_to: ['c1'],
      competitor_answers: 2,
    };
    const table = gapsCsv(
      [row],
      [{ id: 'c1', name: 'HubSpot', colorIndex: 2, domain: 'hubspot.com' }],
      'Fynix',
      ENGINES,
      t,
    );
    expect(table.header).toEqual([
      'Prompt',
      'Group',
      'Fynix state',
      'Fynix citing answers',
      'HubSpot state',
      'HubSpot citing answers',
      'Lost on',
      'Lost to',
    ]);
    expect(table.rows[0]).toEqual(['Best CRM?', 'No group', 'Not cited', 0, 'Cited', 2, 'ChatGPT', 'HubSpot']);
  });
});
