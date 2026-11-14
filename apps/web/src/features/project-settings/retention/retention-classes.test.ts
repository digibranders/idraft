import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RETENTION_CLASSES } from './retention-classes';

const daysOf = (key: string): number | null | undefined => RETENTION_CLASSES.find((rule) => rule.key === key)?.days;

describe('the raw data classes and how long each is kept (doc 23 section 9.2)', () => {
  it('keeps search results 400 days, AI answers for ever, first-party imports 90 days and errors 30 days', () => {
    expect(RETENTION_CLASSES.map((rule) => [rule.key, rule.days])).toEqual([
      ['serp_raw', 400],
      ['ai_raw', null],
      ['first_party_raw', 90],
      ['error', 30],
    ]);
  });

  // Drift guard: `RETENTION` in backend/src/idraft/storage/raw.py is what the platform really does. The page
  // states it as fixed values, so a change there must change this list, or this test fails.
  it('states what backend/src/idraft/storage/raw.py RETENTION keeps', () => {
    const source = readFileSync(resolve(process.cwd(), '../../backend/src/idraft/storage/raw.py'), 'utf8');
    const block = /RETENTION:[^=]*=\s*MappingProxyType\(\s*\{([^}]*)\}/.exec(source)?.[1];
    if (block === undefined) throw new Error('RETENTION was not found in storage/raw.py');
    const backend = [...block.matchAll(/"(\w+)":\s*(None|timedelta\(days=(\d+)\))/g)].map((match) => [
      match[1],
      match[3] === undefined ? null : Number(match[3]),
    ]);
    expect(backend).toHaveLength(RETENTION_CLASSES.length);
    for (const [key, days] of backend) expect(daysOf(String(key))).toBe(days);
  });
});
