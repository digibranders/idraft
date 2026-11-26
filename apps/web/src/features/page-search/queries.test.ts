import { describe, expect, it } from 'vitest';

import {
  breakdownQuery,
  pageSearchKeys,
  pageSearchQuery,
  suggestionsQuery,
  trackedIdsQuery,
  trackedPagesQuery,
} from './queries';

const scope = { workspaceId: 'w1', projectId: 'p1' };
const october = { from: '2026-10-01', to: '2026-10-31', compare: 'previous_period' } as const;

const startsWith = (key: readonly unknown[], prefix: readonly unknown[]): boolean =>
  prefix.every((part, index) => JSON.stringify(key[index]) === JSON.stringify(part));

describe('page search reads', () => {
  it('keys every read by the project, so one invalidation reaches them all', () => {
    for (const options of [
      trackedPagesQuery(scope, october),
      trackedIdsQuery(scope),
      suggestionsQuery(scope),
      pageSearchQuery(scope, '812', october),
      breakdownQuery(scope, '812', 'country', october),
    ]) {
      expect(JSON.stringify(options.queryKey)).toContain('p1');
      expect(pageSearchKeys(scope).some((prefix) => startsWith(options.queryKey, prefix))).toBe(true);
    }
  });

  it('gives each period, page and dimension its own entry', () => {
    const other = { ...october, compare: 'none' } as const;
    expect(trackedPagesQuery(scope, october).queryKey).not.toEqual(trackedPagesQuery(scope, other).queryKey);
    expect(pageSearchQuery(scope, '812', october).queryKey).not.toEqual(
      pageSearchQuery(scope, '813', october).queryKey,
    );
    expect(breakdownQuery(scope, '812', 'country', october).queryKey).not.toEqual(
      breakdownQuery(scope, '812', 'device', october).queryKey,
    );
  });

  it('leaves out the dates when the period is the last full month', () => {
    const options = trackedPagesQuery(scope, { compare: 'none' });
    expect(JSON.stringify(options.queryKey)).not.toContain('from');
  });
});
