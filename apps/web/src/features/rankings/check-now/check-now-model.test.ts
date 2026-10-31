import { describe, expect, it } from 'vitest';

import { MAX_CHECK_NOW, checkNowRefusal, checkNowTarget } from './check-now-model';
import { ApiProblem } from '@/lib/api/problem';
import type { ValidationItem } from '@/lib/api/types';

const problem = (status: number, code: string, body: Record<string, unknown> = {}, errors: ValidationItem[] = []) =>
  new ApiProblem({
    status,
    code,
    title: code,
    detail: null,
    requestId: null,
    errors,
    retryAfterSeconds: null,
    body,
  });

describe('checkNowTarget', () => {
  it('checks the chosen keywords, each once, in a stable order', () => {
    expect(checkNowTarget({ ids: new Set(['b', 'a']), allMatching: false }, false)).toEqual({
      kind: 'ids',
      ids: ['a', 'b'],
    });
  });

  it('refuses a selection by filter, more than 100 keywords, none, or the Archived view', () => {
    expect(checkNowTarget({ ids: new Set(['a']), allMatching: true }, false)).toEqual({
      kind: 'blocked',
      reason: 'allMatching',
    });
    const many = new Set(Array.from({ length: MAX_CHECK_NOW + 1 }, (_, index) => String(index)));
    expect(checkNowTarget({ ids: many, allMatching: false }, false)).toEqual({
      kind: 'blocked',
      reason: 'tooMany',
    });
    expect(checkNowTarget({ ids: new Set(), allMatching: false }, false)).toEqual({
      kind: 'blocked',
      reason: 'none',
    });
    expect(checkNowTarget({ ids: new Set(['a']), allMatching: false }, true)).toEqual({
      kind: 'blocked',
      reason: 'archived',
    });
  });
});

describe('checkNowRefusal', () => {
  it('reads each refusal the route declares', () => {
    expect(checkNowRefusal(problem(429, 'manual_run_limit', { limit: 20 }))).toEqual({
      kind: 'limit',
      limit: 20,
    });
    expect(checkNowRefusal(problem(422, 'quota_exceeded', { limit: 500, used: 499, requested: 3 }), 3)).toEqual({
      kind: 'quota',
      limit: 500,
      used: 499,
      requested: 3,
    });
    expect(checkNowRefusal(problem(503, 'provider_paused'))).toEqual({ kind: 'paused' });
    expect(
      checkNowRefusal(
        problem(422, 'validation_failed', {}, [
          { location: 'body', path: 'tracked_keyword_ids', code: 'keyword_unknown', message: 'x' },
        ]),
      ),
    ).toEqual({ kind: 'unknownKeyword' });
    expect(checkNowRefusal(new Error('network'))).toEqual({ kind: 'other' });
  });
});
