import { describe, expect, it } from 'vitest';

import { slugFromName, slugProblem } from './slug';

describe('slugProblem', () => {
  it('takes what the API takes', () => {
    expect(slugProblem('fynix', 'project')).toBeNull();
    expect(slugProblem('eventus-security', 'project')).toBeNull();
    expect(slugProblem('a1b', 'workspace')).toBeNull();
  });

  it.each([
    ['ab', 'string_pattern_mismatch'],
    ['-fynix', 'string_pattern_mismatch'],
    ['Fynix', 'string_pattern_mismatch'],
    ['a'.repeat(41), 'string_pattern_mismatch'],
    ['0192d1a8-9a01-7b44-8c2d-1f0e9d8c7b01', 'slug_is_id'],
    ['settings', 'slug_reserved'],
  ] as const)('refuses %s as a project slug (%s)', (slug, reason) => {
    expect(slugProblem(slug, 'project')).toBe(reason);
  });

  it('checks each kind against its own reserved words', () => {
    expect(slugProblem('login', 'workspace')).toBe('slug_reserved');
    expect(slugProblem('login', 'project')).toBeNull();
    expect(slugProblem('members', 'project')).toBe('slug_reserved');
  });
});

describe('slugFromName', () => {
  it.each([
    ['Eventus Security', 'eventus-security'],
    ['  Café Müller & Co.  ', 'cafe-muller-co'],
    ['Oyechats!!', 'oyechats'],
    ['a'.repeat(39) + ' b', 'a'.repeat(39)],
  ])('suggests a slug for %s', (name, slug) => {
    expect(slugFromName(name)).toBe(slug);
  });
});
