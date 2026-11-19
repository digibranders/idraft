import { describe, expect, it } from 'vitest';

import { reasonOf } from './problem-reason';
import { problemFrom } from '@/lib/api/problem';

const problem = (status: number, body: unknown): unknown => problemFrom(new Response(null, { status }), body);

describe('reasonOf', () => {
  it('prefers the first field error: the API puts the real reason there and a count in the detail', () => {
    const error = problem(422, {
      type: 'about:blank',
      title: 'Validation failed',
      status: 422,
      code: 'validation_failed',
      detail: '1 field is invalid.',
      errors: [
        { location: 'body', path: 'position', code: 'rule_limit', message: 'At most 500 rules.' },
        { location: 'body', path: 'value', code: 'x', message: 'Second.' },
      ],
    });
    expect(reasonOf(error)).toBe('At most 500 rules.');
  });

  it('falls back to the detail, then the title, then nothing', () => {
    expect(reasonOf(problem(409, { title: 'Conflict', detail: 'Changed meanwhile.', code: 'conflict' }))).toBe(
      'Changed meanwhile.',
    );
    expect(reasonOf(problem(500, { title: 'Server error', code: 'internal' }))).toBe('Server error');
    expect(reasonOf(new TypeError('Failed to fetch'))).toBe('');
  });
});
