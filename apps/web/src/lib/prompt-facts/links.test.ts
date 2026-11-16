import { describe, expect, it } from 'vitest';

import { citedLinksOf } from './links';
import { engine, rowOf } from './test-helpers';
import type { TopLink } from './types';

const link = (url: string, answers: number, role: TopLink['domain_role'] = 'third_party'): TopLink => ({
  url,
  domain: new URL(url).hostname,
  domain_role: role,
  answers,
});

describe('citedLinksOf', () => {
  it('ranks the pages one engine cited, most cited first, then by address, and marks the own pages', () => {
    const row = rowOf(
      engine('chatgpt_web', {
        valid: 10,
        top_links: [link('https://b.com/x', 2), link('https://a.com/x', 2), link('https://northwind.com/p', 5, 'own')],
      }),
      engine('gemini_web', { valid: 10, top_links: [link('https://g.com/', 9)] }),
    );
    const reading = citedLinksOf([row], 'chatgpt_web');
    expect(reading.state).toBe('ok');
    expect(reading.shown.map((entry) => [entry.place, entry.url, entry.own, entry.answers])).toEqual([
      [1, 'https://northwind.com/p', true, 5],
      [2, 'https://a.com/x', false, 2],
      [3, 'https://b.com/x', false, 2],
    ]);
    expect(reading.answers).toBe(10);
  });

  it('adds the answers that cited a page over the rows and cuts at ten', () => {
    const many = Array.from({ length: 12 }, (_, i) => link(`https://site${String(i)}.com/`, 1 + (i % 3)));
    const rows = [
      rowOf(engine('chatgpt_web', { valid: 5, top_links: many })),
      rowOf(engine('chatgpt_web', { valid: 5, top_links: [link('https://site0.com/', 4)] })),
    ];
    const reading = citedLinksOf(rows, 'chatgpt_web');
    expect(reading.shown).toHaveLength(10);
    expect(reading.total).toBe(12);
    expect(reading.shown[0]).toMatchObject({ url: 'https://site0.com/', answers: 5 });
    expect(reading.answers).toBe(10);
  });

  it('is an empty list, not unknown, for an engine with answers and no link', () => {
    expect(citedLinksOf([rowOf(engine('chatgpt_web', { valid: 6, top_links: [] }))], 'chatgpt_web')).toMatchObject({
      state: 'ok',
      shown: [],
      total: 0,
    });
  });

  it('is unknown with a reason', () => {
    expect(citedLinksOf([rowOf(engine('chatgpt_web', { valid: 6 }))], 'chatgpt_web')).toMatchObject({
      state: 'unknown',
      reason: 'not_collected',
    });
    expect(citedLinksOf([rowOf(engine('chatgpt_web', { valid: 0, top_links: [] }))], 'chatgpt_web')).toMatchObject({
      state: 'unknown',
      reason: 'unobserved',
    });
    expect(
      citedLinksOf([rowOf(engine('gemini_web', { top_links: [link('https://a.com/', 1)] }))], 'chatgpt_web'),
    ).toMatchObject({ state: 'unknown', reason: 'not_collected' });
  });
});
