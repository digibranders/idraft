import { describe, expect, it } from 'vitest';

import { countsOf, segmentsOf, type AliasTestResult } from './alias-test-segments';

type Mention = AliasTestResult['mentions'][number];

const mention = (name: string, spans: Mention['spans'], status: Mention['status'] = 'accepted'): Mention => ({
  entity: { entity_id: name, canonical_name: name, entity_type: 'brand', role: 'competitor', color_index: 2 },
  spans,
  confidence: 0.95,
  status,
});
const span = (start: number, end: number, status: Mention['status'] = 'accepted'): Mention['spans'][number] => ({
  start,
  end,
  alias_id: null,
  match_method: 'alias_word',
  score: 0.95,
  status,
});

describe('segmentsOf', () => {
  it('cuts the text at the spans, in order, whatever order the mentions come in', () => {
    const text = 'Try Northwind or Fynix today';
    const segments = segmentsOf(text, [mention('Fynix', [span(17, 22)]), mention('Northwind', [span(4, 13)])]);
    expect(segments.map((segment) => [segment.kind, segment.text])).toEqual([
      ['text', 'Try '],
      ['mention', 'Northwind'],
      ['text', ' or '],
      ['mention', 'Fynix'],
      ['text', ' today'],
    ]);
  });

  it('indexes the text in UTF-16 code units, so emoji and accents before a span keep it in place', () => {
    const text = '🚀 Café Fynix';
    const start = text.indexOf('Fynix');
    expect(start).toBe(8);
    const [, found] = segmentsOf(text, [mention('Fynix', [span(start, start + 5)])]);
    expect(found).toMatchObject({ kind: 'mention', text: 'Fynix' });
  });

  it('leaves discarded, overlapping and out-of-range spans as plain text', () => {
    const text = 'Northwind Studio';
    const segments = segmentsOf(text, [
      mention('A', [span(0, 9), span(5, 12), span(10, 99)]),
      mention('B', [span(10, 16, 'discarded')], 'discarded'),
    ]);
    expect(segments.map((segment) => segment.kind)).toEqual(['mention', 'text']);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
  });
});

describe('countsOf', () => {
  it('counts mentions by status and the matches negative aliases dropped', () => {
    expect(
      countsOf({
        mentions: [mention('A', []), mention('B', [], 'uncertain'), mention('C', [], 'discarded')],
        negatives_applied: [{ start: 0, end: 3, alias_id: 'x' }],
        skipped_alias_ids: [],
      }),
    ).toEqual({ accepted: 1, uncertain: 1, dropped: 1 });
  });
});
