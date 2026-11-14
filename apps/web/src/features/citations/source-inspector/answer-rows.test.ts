import { describe, expect, it } from 'vitest';

import { answerRows, promptRows } from './answer-rows';
import type { CitationRow, EngineCode } from '@/lib/citations/types';

const idOf = (index: number): string => `0c1f4e7b-0000-4000-8000-${String(index).padStart(12, '0')}`;

const rowOf = (overrides: Partial<CitationRow> = {}): CitationRow => ({
  citation_index: 1,
  citation_kind: 'link',
  domain_role: 'third_party',
  engine_code: 'chatgpt_web',
  host: 'g2.com',
  observation_id: '1001',
  observed_at: '2026-11-10T08:00:00Z',
  occurrences: 1,
  prompt_id: idOf(1),
  raw_url: 'https://g2.com/products/crm',
  registrable_domain: 'g2.com',
  role_entity_id: null,
  title: 'Best CRM software',
  url: 'https://g2.com/products/crm',
  url_id: 7,
  ...overrides,
});

describe('promptRows', () => {
  it('groups by prompt: the engines once each in the engine order, the answers as distinct observation ids', () => {
    const rows = [
      rowOf({ observation_id: '1', engine_code: 'google_ai_mode' }),
      rowOf({ observation_id: '2', engine_code: 'chatgpt_web' }),
      rowOf({ observation_id: '3', engine_code: 'chatgpt_web' }),
      // The same answer lists the page twice: one answer
      rowOf({ observation_id: '3', engine_code: 'chatgpt_web', citation_index: 5 }),
      rowOf({ observation_id: '4', engine_code: 'gemini_web', prompt_id: idOf(2) }),
    ];
    const found = promptRows(rows);
    const first = found.find((row) => row.promptId === idOf(1));
    expect(first).toEqual({
      promptId: idOf(1),
      engines: ['chatgpt_web', 'google_ai_mode'] satisfies EngineCode[],
      answers: 3,
      lastAnswerAt: '2026-11-10T08:00:00Z',
    });
    expect(found.find((row) => row.promptId === idOf(2))?.answers).toBe(1);
  });

  it('gives the date of the newest answer of each prompt', () => {
    const rows = [
      rowOf({ observation_id: '1', observed_at: '2026-11-01T08:00:00Z' }),
      rowOf({ observation_id: '2', observed_at: '2026-11-09T08:00:00Z' }),
      rowOf({ observation_id: '3', observed_at: '2026-11-05T08:00:00Z' }),
    ];
    expect(promptRows(rows)[0]?.lastAnswerAt).toBe('2026-11-09T08:00:00Z');
  });

  it('keeps the 10 prompts with the most answers, a tie going to the newest answer', () => {
    // Prompt n has n answers, so 12 prompts have 1 to 12; two more tie at 3 answers
    const rows: CitationRow[] = [];
    let observation = 0;
    for (let prompt = 1; prompt <= 12; prompt += 1) {
      for (let answer = 0; answer < prompt; answer += 1) {
        observation += 1;
        rows.push(rowOf({ prompt_id: idOf(prompt), observation_id: String(observation) }));
      }
    }
    const found = promptRows(rows);
    expect(found).toHaveLength(10);
    expect(found.map((row) => row.answers)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);

    const tied = promptRows(
      [
        rowOf({ prompt_id: idOf(1), observation_id: '1', observed_at: '2026-11-01T08:00:00Z' }),
        rowOf({ prompt_id: idOf(2), observation_id: '2', observed_at: '2026-11-08T08:00:00Z' }),
      ],
      10,
    );
    expect(tied.map((row) => row.promptId)).toEqual([idOf(2), idOf(1)]);
  });

  it('is empty for no rows', () => {
    expect(promptRows([])).toEqual([]);
  });
});

describe('answerRows', () => {
  it('lists distinct observation ids, the newest first, at most the limit', () => {
    const rows = Array.from({ length: 14 }, (_, index) =>
      rowOf({
        observation_id: String(100 + index),
        observed_at: `2026-11-${String(index + 1).padStart(2, '0')}T08:00:00Z`,
      }),
    );
    const found = answerRows(rows, 10);
    expect(found).toHaveLength(10);
    expect(found[0]?.observationId).toBe('113');
    expect(found[9]?.observationId).toBe('104');
  });

  it('counts a URL listed twice in one answer as one answer, at its first listing', () => {
    const rows = [
      rowOf({ observation_id: '55', citation_index: 6 }),
      rowOf({ observation_id: '55', citation_index: 2 }),
      rowOf({ observation_id: '56', observed_at: '2026-11-09T08:00:00Z', citation_index: 4 }),
    ];
    const found = answerRows(rows, 10);
    expect(found.map((row) => row.observationId)).toEqual(['55', '56']);
    expect(found[0]?.position).toBe(2);
    expect(found[1]?.position).toBe(4);
  });

  it('carries the engine, the prompt and the time of the answer', () => {
    const [only] = answerRows(
      [
        rowOf({
          observation_id: '9',
          engine_code: 'gemini_web',
          prompt_id: idOf(3),
          observed_at: '2026-11-07T10:30:00Z',
        }),
      ],
      10,
    );
    expect(only).toEqual({
      observationId: '9',
      observedAt: '2026-11-07T10:30:00Z',
      engine: 'gemini_web',
      promptId: idOf(3),
      position: 1,
      host: 'g2.com',
      url: 'https://g2.com/products/crm',
      quote: null,
    });
  });

  it('takes the quote, host and address of the listing the row uses: the first place the page is listed', () => {
    const [only] = answerRows(
      [
        rowOf({ observation_id: '55', citation_index: 6, quote: 'Late quote', host: 'late.example' }),
        rowOf({ observation_id: '55', citation_index: 2, quote: 'First quote', host: 'first.example' }),
        rowOf({ observation_id: '55', citation_index: 9, quote: 'Last quote', host: 'last.example' }),
      ],
      10,
    );
    expect(only).toMatchObject({ position: 2, quote: 'First quote', host: 'first.example' });
  });

  it('keeps a missing quote as null', () => {
    const [only] = answerRows([rowOf({ observation_id: '55' })], 10);
    expect(only?.quote).toBeNull();
  });

  it('is empty for no rows', () => {
    expect(answerRows([], 10)).toEqual([]);
  });
});
