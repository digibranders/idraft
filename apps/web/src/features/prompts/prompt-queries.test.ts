import { describe, expect, it } from 'vitest';

import { summaryQuery, type PromptScope } from './prompt-queries';

const SCOPE: PromptScope = {
  workspaceId: '11111111-0000-4000-8000-000000000001',
  projectId: '22222222-0000-4000-8000-000000000001',
};
const RANGE = { from: '2026-10-16', to: '2026-11-12' };

/** The key follows the query the read sends, so what it holds is what is asked. */
const keyOf = (compare: boolean | undefined): string =>
  JSON.stringify(summaryQuery(SCOPE, RANGE, false, compare === undefined ? {} : { compare }).queryKey);

describe('summaryQuery compare', () => {
  it('asks compare=previous_period only when compare is true', () => {
    expect(keyOf(true)).toContain('"compare":"previous_period"');
    expect(keyOf(false)).not.toContain('compare');
    expect(keyOf(undefined)).not.toContain('compare');
  });

  it('has a key that differs from the one without, so a toggle is a new read', () => {
    expect(keyOf(true)).not.toEqual(keyOf(false));
    expect(keyOf(false)).toEqual(keyOf(undefined));
  });
});
