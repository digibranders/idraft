import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { PENDING_PATHS, type PendingPaths } from './pending';
import type { paths } from './schema';

const OPENAPI = path.join(import.meta.dirname, '../../../../../backend/openapi/v1.json');

describe('the pending endpoints', () => {
  it('are not in the OpenAPI document yet: once one is, delete its hand-written type and pending handler', () => {
    const document = JSON.parse(readFileSync(OPENAPI, 'utf8')) as { paths: Record<string, unknown> };
    const shipped = PENDING_PATHS.filter((pending) => pending in document.paths);
    expect(shipped).toEqual([]);
  });

  it('list every hand-written path, and no generated one', () => {
    expectTypeOf<Exclude<keyof PendingPaths, (typeof PENDING_PATHS)[number]>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof PendingPaths, keyof paths>>().toEqualTypeOf<never>();
  });
});
