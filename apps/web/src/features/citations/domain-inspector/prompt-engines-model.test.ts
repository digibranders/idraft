import { describe, expect, it } from 'vitest';

import { enginesByPrompt, topPrompts } from './prompt-engines-model';
import type { CitationRow, DomainPrompt } from '@/lib/citations/types';

const rowOf = (
  prompt_id: string,
  engine_code: CitationRow['engine_code'],
): Pick<CitationRow, 'prompt_id' | 'engine_code'> => ({
  prompt_id,
  engine_code,
});

const promptOf = (prompt_id: string, citation_units: number, observations: number): DomainPrompt => ({
  prompt_id,
  citation_units,
  observations,
});

describe('enginesByPrompt', () => {
  it("lists each prompt's engines once, in engine order", () => {
    const engines = enginesByPrompt([
      rowOf('p-1', 'google_ai_mode'),
      rowOf('p-1', 'chatgpt_web'),
      rowOf('p-1', 'google_ai_mode'),
      rowOf('p-1', 'chatgpt_web'),
      rowOf('p-2', 'gemini_web'),
    ]);
    expect(engines.get('p-1')).toEqual(['chatgpt_web', 'google_ai_mode']);
    expect(engines.get('p-2')).toEqual(['gemini_web']);
  });

  it('has no entry for a prompt absent from the rows, so its cell is n/a', () => {
    const engines = enginesByPrompt([rowOf('p-1', 'chatgpt_web')]);
    expect(engines.has('p-9')).toBe(false);
    expect(engines.get('p-9')).toBeUndefined();
    expect(enginesByPrompt([]).size).toBe(0);
  });
});

describe('topPrompts', () => {
  it('keeps at most the limit, most units first', () => {
    const many = Array.from({ length: 14 }, (_, index) =>
      promptOf(`p-${String(index).padStart(2, '0')}`, index + 1, 1),
    );
    const top = topPrompts(many, 10);
    expect(top).toHaveLength(10);
    expect(top.map((prompt) => prompt.citation_units)).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
  });

  it('breaks ties by answers, then by id', () => {
    const top = topPrompts(
      [promptOf('p-c', 5, 1), promptOf('p-b', 5, 3), promptOf('p-a', 5, 1), promptOf('p-z', 9, 1)],
      10,
    );
    expect(top.map((prompt) => prompt.prompt_id)).toEqual(['p-z', 'p-b', 'p-a', 'p-c']);
  });

  it('does not change the list it is given', () => {
    const given = [promptOf('p-1', 1, 1), promptOf('p-2', 2, 1)];
    topPrompts(given, 1);
    expect(given.map((prompt) => prompt.prompt_id)).toEqual(['p-1', 'p-2']);
  });
});
