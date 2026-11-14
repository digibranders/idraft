import { describe, expect, it } from 'vitest';

import { promptTextsById, promptTextsQuery } from './prompt-texts-query';
import type { SourceScope } from './types';

const scope: SourceScope = { workspaceId: 'w-1', projectId: 'p-1' };

describe('promptTextsQuery', () => {
  it('reads one page of 200 prompts under the project, in the prompts family of keys', () => {
    const { queryKey } = promptTextsQuery(scope);
    expect(queryKey.slice(0, 5)).toEqual(['ws', 'w-1', 'p', 'p-1', 'prompts']);
    expect(queryKey.at(-1)).toEqual({ limit: 200 });
  });
});

describe('promptTextsById', () => {
  it('maps each prompt id to the text the engines receive', () => {
    const page = {
      data: [
        { prompt_id: 'a', current_version: { text: 'Best CRM for startups' } },
        { prompt_id: 'b', current_version: { text: 'How to pick a CRM' } },
      ],
    };
    expect(promptTextsById(page)).toEqual(
      new Map([
        ['a', 'Best CRM for startups'],
        ['b', 'How to pick a CRM'],
      ]),
    );
  });

  it('is empty while the read has no page', () => {
    expect(promptTextsById(undefined).size).toBe(0);
  });
});
