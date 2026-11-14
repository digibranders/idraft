import { describe, expect, it } from 'vitest';

import { answerRows, ANSWERS_LISTED } from './answer-rows';
import type { ObservationSummary } from '@/lib/api/types';
import { groupByAnswer } from '@/lib/citations/group-answers';
import type { CitationRow, DomainRole } from '@/lib/citations/types';

const observation = (id: string, over: { valid?: boolean; total?: number } = {}): ObservationSummary =>
  ({
    observation_id: id,
    engine_code: 'chatgpt_web',
    observed_at: '2026-11-11T09:05:00Z',
    status: 'complete',
    facts: {
      is_valid: over.valid ?? true,
      total_citation_count: over.total ?? 3,
    },
  }) as unknown as ObservationSummary;

const citation = (
  observationId: string,
  index: number,
  domain: string,
  role: DomainRole,
  over: Partial<CitationRow> = {},
): CitationRow => ({
  citation_index: index,
  citation_kind: 'inline',
  domain_role: role,
  engine_code: 'chatgpt_web',
  host: `www.${domain}`,
  observation_id: observationId,
  observed_at: '2026-11-11T09:05:00Z',
  occurrences: 1,
  prompt_id: '0192d1a8-e000-7a10-8e00-000000000001',
  raw_url: `https://www.${domain}/p${String(index)}`,
  registrable_domain: domain,
  role_entity_id: null,
  title: null,
  url: `https://www.${domain}/p${String(index)}`,
  url_id: index,
  ...over,
});

const groupsOf = (rows: CitationRow[], hasMore = false): ReturnType<typeof groupByAnswer> =>
  groupByAnswer(rows, hasMore);

describe('answerRows', () => {
  it('lists valid answers only, newest first as given, at most ten', () => {
    const observations = Array.from({ length: 12 }, (_, at) => observation(`o${String(at)}`));
    observations.splice(1, 0, observation('bad', { valid: false }));
    const rows = answerRows(observations, groupsOf([]));
    expect(rows).toHaveLength(ANSWERS_LISTED);
    expect(rows.map((row) => row.observation.observation_id)).not.toContain('bad');
    expect(rows[0]?.observation.observation_id).toBe('o0');
  });

  it('takes the first own page by its place in the answer, with its position of the sources listed', () => {
    const rows = answerRows(
      [observation('o1', { total: 4 })],
      groupsOf([
        citation('o1', 1, 'g2.com', 'third_party'),
        citation('o1', 3, 'fynix.io', 'own'),
        citation('o1', 2, 'rival.io', 'competitor'),
        citation('o1', 4, 'fynix.io', 'own', { url: 'https://www.fynix.io/pricing', url_id: 40 }),
      ]),
    );
    const [row] = rows;
    expect(row?.state).toBe('cited');
    expect(row?.ownPage?.row.url_id).toBe(3);
    expect(row?.ownPage?.position).toEqual({ index: 3, count: 4 });
    expect(row?.moreOwn).toBe(1);
  });

  it('counts a page listed twice once among the own pages', () => {
    const [row] = answerRows(
      [observation('o1')],
      groupsOf([
        citation('o1', 1, 'fynix.io', 'own', { url_id: 7 }),
        citation('o1', 2, 'fynix.io', 'own', { url_id: 7 }),
      ]),
    );
    expect(row?.moreOwn).toBe(0);
  });

  it('is not cited when the answer cites sources and none is own', () => {
    const [row] = answerRows(
      [observation('o1')],
      groupsOf([citation('o1', 1, 'g2.com', 'third_party'), citation('o1', 2, 'rival.io', 'competitor')]),
    );
    expect(row?.state).toBe('notCited');
    expect(row?.ownPage).toBeNull();
  });

  it('lists the other domains by their pages in the answer, most first, and never the own domain', () => {
    const [row] = answerRows(
      [observation('o1')],
      groupsOf([
        citation('o1', 1, 'rival.io', 'competitor', { url_id: 1 }),
        citation('o1', 2, 'g2.com', 'third_party', { url_id: 2 }),
        citation('o1', 3, 'g2.com', 'third_party', { url_id: 3 }),
        citation('o1', 4, 'g2.com', 'third_party', { url_id: 3 }),
        citation('o1', 5, 'fynix.io', 'own', { url_id: 5 }),
      ]),
    );
    expect(row?.others.map((entry) => [entry.domain, entry.units])).toEqual([
      ['g2.com', 2],
      ['rival.io', 1],
    ]);
    expect(row?.others[1]?.role).toBe('competitor');
  });

  it('says no source for an answer with a total citation count of 0, which is not Not cited', () => {
    const [row] = answerRows([observation('o1', { total: 0 })], groupsOf([]));
    expect(row?.state).toBe('noSource');
    expect(row?.others).toEqual([]);
  });

  it('is unknown, never 0, for an answer whose citations are not in hand', () => {
    const [loaded] = answerRows(
      [observation('o1', { total: 3 })],
      groupsOf([citation('o2', 1, 'g2.com', 'third_party')]),
    );
    expect(loaded?.state).toBe('unknown');
    const [failed] = answerRows([observation('o1', { total: 3 })], null);
    expect(failed?.state).toBe('unknown');
    expect(failed?.others).toEqual([]);
  });

  it('keeps the no source of an answer even when its citations are not in hand', () => {
    const [row] = answerRows([observation('o1', { total: 0 })], null);
    expect(row?.state).toBe('noSource');
  });

  it('does not take a cut answer for a whole one', () => {
    // The last answer of a page that has more rows may be cut: groupByAnswer drops it, so it reads unknown
    const [row] = answerRows(
      [observation('o1', { total: 9 })],
      groupsOf([citation('o1', 1, 'g2.com', 'third_party')], true),
    );
    expect(row?.state).toBe('unknown');
  });
});
