import { describe, expect, it } from 'vitest';

import { quotaFacts } from './quota';
import { problemFrom } from '@/lib/api/problem';

const problem = (body: Record<string, unknown>): ReturnType<typeof problemFrom> =>
  problemFrom(new Response(null, { status: 422 }), { code: 'quota_exceeded', ...body });

describe('quotaFacts', () => {
  it('reads the limit, what is used and what the change asks for, and the room that is left', () => {
    expect(quotaFacts(problem({ limit: 60, used: 59, requested: 2 }), 1)).toEqual({
      room: 1,
      used: 59,
      limit: 60,
      requested: 2,
    });
  });

  it('has no negative room, and uses what the caller knows when the problem does not say how many', () => {
    expect(quotaFacts(problem({ limit: 60, used: 63 }), 4)).toEqual({ room: 0, used: 63, limit: 60, requested: 4 });
  });

  it('counts a problem without numbers as zero', () => {
    expect(quotaFacts(problem({}), 1)).toEqual({ room: 0, used: 0, limit: 0, requested: 1 });
  });
});
