import { describe, expect, it } from 'vitest';

import { chunkKeywords } from './add-plan';
import { createInChunks, type AddPair, type BulkAnswer } from './add-submit';
import { ApiProblem } from '@/lib/api/problem';

const GERMANY = { location_id: 2276, name: 'Germany' };
const US = { location_id: 2840, name: 'United States' };
type Place = typeof GERMANY;

/** A `send` that creates every item, and remembers what each request held. */
function recorder(answer: (items: readonly AddPair<Place>[], call: number) => BulkAnswer = created): {
  calls: AddPair<Place>[][];
  send: (items: readonly AddPair<Place>[]) => Promise<BulkAnswer>;
} {
  const calls: AddPair<Place>[][] = [];
  return {
    calls,
    send: (items) => {
      calls.push([...items]);
      return Promise.resolve(answer(items, calls.length));
    },
  };
}

function created(items: readonly AddPair<Place>[], call: number): BulkAnswer {
  return {
    created: items.map((_, index) => `${String(call)}-${String(index)}`),
    restored: [],
    skipped: [],
    rejected: [],
  };
}

const quotaProblem = (): ApiProblem =>
  new ApiProblem({
    status: 422,
    code: 'quota_exceeded',
    title: 'Over the plan',
    detail: null,
    requestId: null,
    retryAfterSeconds: null,
    errors: [],
    body: { limit: 5, used: 3, requested: 6 },
  });

describe('createInChunks', () => {
  it('sends one item per keyword and country, keyword by keyword', async () => {
    const { calls, send } = recorder();
    const result = await createInChunks({ chunks: [['a', 'b']], countries: [GERMANY, US], send });
    expect(calls).toEqual([
      [
        { keyword: 'a', country: GERMANY },
        { keyword: 'a', country: US },
        { keyword: 'b', country: GERMANY },
        { keyword: 'b', country: US },
      ],
    ]);
    expect(result.created).toHaveLength(4);
    expect(result.stoppedBy).toBeNull();
  });

  it('sends the chunks one after another, each within the request limit', async () => {
    const keywords = Array.from({ length: 250 }, (_, index) => `k${String(index)}`);
    const countries = Array.from({ length: 10 }, (_, index) => ({ location_id: index, name: `C${String(index)}` }));
    const { calls, send } = recorder();
    const result = await createInChunks({ chunks: chunkKeywords(keywords, countries.length), countries, send });
    expect(calls.map((items) => items.length)).toEqual([1000, 1000, 500]);
    expect(result.created).toHaveLength(2500);
  });

  it('names the keyword and the country of a skipped or refused item in a later chunk', async () => {
    const { send } = recorder((items, call) =>
      call === 2
        ? {
            created: [],
            restored: [],
            skipped: [{ index: 1, existing_id: 'old' }],
            rejected: [{ index: 2, code: 'keyword_too_long', message: 'Too long.' }],
          }
        : created(items, call),
    );
    const result = await createInChunks({ chunks: [['a'], ['b', 'c']], countries: [GERMANY, US], send });
    expect(result.created).toHaveLength(2);
    expect(result.skipped).toEqual([{ id: 'old', keyword: 'b', country: US }]);
    expect(result.rejected).toEqual([
      { keyword: 'c', country: GERMANY, code: 'keyword_too_long', message: 'Too long.' },
    ]);
  });

  it('stops at the first quota refusal and keeps what earlier chunks added', async () => {
    const problem = quotaProblem();
    const { calls, send } = recorder((items, call) => {
      if (call === 2) throw problem;
      return created(items, call);
    });
    const result = await createInChunks({ chunks: [['a'], ['b'], ['c']], countries: [GERMANY], send });
    expect(calls).toHaveLength(2);
    expect(result.created).toEqual(['1-0']);
    expect(result.stoppedBy).toBe(problem);
  });

  it('lets any other failure through', async () => {
    const failure = new Error('offline');
    const { send } = recorder(() => {
      throw failure;
    });
    await expect(createInChunks({ chunks: [['a']], countries: [GERMANY], send })).rejects.toBe(failure);
  });
});
