import { describe, expect, it } from 'vitest';

import { DAY_COLUMNS, columnOf, dayAnswers, readingOf, changesOf, type DayColumn } from './day-compare-model';
import type { MentionOut, ObservationDetail, ObservationSummary } from '@/lib/api/types';

const CHATGPT = 'chatgpt_web';
const GEMINI = 'gemini_web';

/** An answer of the list: only the members the model reads. */
const answer = (id: string, day: string, engine: string, valid = true, time = '09:00:00'): ObservationSummary =>
  ({
    observation_id: id,
    observed_date: day,
    observed_at: `${day}T${time}Z`,
    engine_code: engine,
    facts: valid ? { is_valid: true } : { is_valid: false },
  }) as unknown as ObservationSummary;

const mention = (
  id: string,
  name: string,
  role: MentionOut['role'],
  order: number | null,
  status: MentionOut['mention_status'] = 'accepted',
  offset = 0,
): MentionOut =>
  ({
    entity_id: id,
    name,
    role,
    mention_order: order,
    mention_status: status,
    first_char_offset: offset,
  }) as unknown as MentionOut;

const citation = (
  host: string,
  role: 'own' | 'competitor' | 'third_party',
  index: number,
  flags: string[] = [],
): unknown => ({
  host,
  domain_role: role,
  citation_index: index,
  flags,
});

const detail = (
  id: string,
  day: string,
  mentions: readonly MentionOut[],
  citations: readonly unknown[] = [],
): ObservationDetail =>
  ({
    observation_id: id,
    observed_date: day,
    observed_at: `${day}T09:00:00Z`,
    mentions,
    citations,
  }) as unknown as ObservationDetail;

describe('the answers a comparison picks', () => {
  it('takes the newest valid answer of each day of the engine, the last four days, oldest first', () => {
    const rows = [
      answer('9', '2026-11-10', CHATGPT, true, '18:00:00'),
      answer('8', '2026-11-10', CHATGPT, true, '09:00:00'),
      answer('7', '2026-11-07', CHATGPT),
      answer('6', '2026-11-05', CHATGPT),
      answer('5', '2026-11-03', CHATGPT),
      answer('4', '2026-11-01', CHATGPT),
      answer('3', '2026-11-07', GEMINI),
    ];
    expect(dayAnswers(rows, CHATGPT).map((row) => row.observation_id)).toEqual(['5', '6', '7', '9']);
    expect(DAY_COLUMNS).toBe(4);
  });

  it('skips an answer that is not valid, so a day with only a failed answer has no column', () => {
    const rows = [answer('3', '2026-11-10', CHATGPT, false), answer('2', '2026-11-07', CHATGPT)];
    expect(dayAnswers(rows, CHATGPT).map((row) => row.observation_id)).toEqual(['2']);
  });

  it('does not rely on the order the list came in', () => {
    const rows = [
      answer('1', '2026-11-01', CHATGPT),
      answer('3', '2026-11-09', CHATGPT),
      answer('2', '2026-11-05', CHATGPT),
    ];
    expect(dayAnswers(rows, CHATGPT).map((row) => row.observation_id)).toEqual(['1', '2', '3']);
  });

  it('is empty for an engine with no answer', () => {
    expect(dayAnswers([answer('1', '2026-11-01', CHATGPT)], GEMINI)).toEqual([]);
  });
});

describe('a column of one answer', () => {
  it('lists the accepted brands in the order the answer named them, the ones with no order last', () => {
    const column = columnOf(
      detail('1', '2026-11-07', [
        mention('c', 'Pipedrive', 'competitor', null, 'accepted', 40),
        mention('b', 'Northwind', 'own', 2),
        mention('a', 'HubSpot', 'competitor', 1),
        mention('d', 'Zoho', 'competitor', null, 'accepted', 10),
      ]),
    );
    expect(column.brands.map((brand) => brand.name)).toEqual(['HubSpot', 'Northwind', 'Zoho', 'Pipedrive']);
  });

  it('leaves out a mention the match is unsure of and lists a brand once', () => {
    const column = columnOf(
      detail('1', '2026-11-07', [
        mention('a', 'HubSpot', 'competitor', 1),
        mention('a', 'HubSpot', 'competitor', 3),
        mention('b', 'Zoho', 'competitor', 2, 'uncertain'),
      ]),
    );
    expect(column.brands.map((brand) => brand.name)).toEqual(['HubSpot']);
  });

  it('lists each cited site once, in the order of its first citation', () => {
    const column = columnOf(
      detail(
        '1',
        '2026-11-07',
        [],
        [
          citation('g2.com', 'third_party', 2),
          citation('northwind.com', 'own', 1),
          citation('g2.com', 'third_party', 3),
        ],
      ),
    );
    expect(column.sources.map((source) => source.host)).toEqual(['northwind.com', 'g2.com']);
    expect(column.ownCited).toBe(true);
  });

  it('leaves out redirect and engine-internal citations and treats www and the bare host as one site', () => {
    const column = columnOf(
      detail(
        '1',
        '2026-11-07',
        [],
        [
          citation('vertexaisearch.cloud.google.com', 'third_party', 1, ['unresolved_redirect']),
          citation('northwind.com', 'own', 2, ['engine_internal']),
          citation('www.g2.com', 'third_party', 3),
          citation('g2.com', 'third_party', 4),
        ],
      ),
    );
    expect(column.sources.map((source) => source.host)).toEqual(['g2.com']);
    expect(column.ownCited).toBe(false);
  });

  it('knows whether the own brand was named', () => {
    expect(columnOf(detail('1', '2026-11-07', [mention('b', 'Northwind', 'own', 1)])).ownNamed).toBe(true);
    expect(columnOf(detail('1', '2026-11-07', [mention('a', 'HubSpot', 'competitor', 1)])).ownNamed).toBe(false);
  });
});

const column = (names: readonly string[], ownNamed = false, ownCited = false): DayColumn => ({
  observationId: 'x',
  observedDate: '2026-11-07',
  observedAt: '2026-11-07T09:00:00Z',
  brands: names.map((name) => ({ entityId: name, name, role: 'competitor' })),
  sources: [],
  ownNamed,
  ownCited,
});

describe('what changed since the column before', () => {
  it('has no change for the first column', () => {
    expect(changesOf(null, column(['A']))).toEqual({ entered: new Set(), left: [] });
  });

  it('names the brands that entered and the ones that left', () => {
    const change = changesOf(column(['A', 'B', 'C']), column(['B', 'D']));
    expect([...change.entered]).toEqual(['D']);
    expect(change.left.map((brand) => brand.name)).toEqual(['A', 'C']);
  });
});

describe('the reading of a day', () => {
  it('says named and cited, named only, cited only, or neither', () => {
    expect(readingOf(column([], true, true))).toBe('namedAndCited');
    expect(readingOf(column([], true, false))).toBe('namedOnly');
    expect(readingOf(column([], false, true))).toBe('citedOnly');
    expect(readingOf(column([], false, false))).toBe('neither');
  });
});
