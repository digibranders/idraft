import { describe, expect, it } from 'vitest';

import { checkRuleValue, MAX_RULES } from './rule-value';

// The grammar of backend/src/idraft/crawl/tiers.py `check_rule_value`, checked in the same order
describe('checkRuleValue (the API grammar of a rule path)', () => {
  it('accepts a path that starts with a slash', () => {
    expect(checkRuleValue('exact', '/pricing')).toBeNull();
    expect(checkRuleValue('prefix', '/services/')).toBeNull();
    expect(checkRuleValue('pattern', '/blog/*/draft/*')).toBeNull();
  });

  it('asks for a path, then for the slash', () => {
    expect(checkRuleValue('prefix', '')).toBe('empty');
    expect(checkRuleValue('prefix', '   ')).toBe('empty');
    expect(checkRuleValue('exact', 'pricing')).toBe('starts_with_slash');
  });

  it('keeps the star for pattern rules, ten at most', () => {
    expect(checkRuleValue('exact', '/a*')).toBe('star_in_exact');
    expect(checkRuleValue('prefix', '/a*')).toBe('star_in_prefix');
    expect(checkRuleValue('pattern', `/${'a*'.repeat(10)}`)).toBeNull();
    expect(checkRuleValue('pattern', `/${'a*'.repeat(11)}`)).toBe('too_many_stars');
  });

  it('allows 500 characters, counted after the spaces at the ends are trimmed', () => {
    expect(checkRuleValue('prefix', `/${'a'.repeat(499)}  `)).toBeNull();
    expect(checkRuleValue('prefix', `/${'a'.repeat(500)}`)).toBe('too_long');
  });

  it('names the limit on the number of rules', () => {
    expect(MAX_RULES).toBe(500);
  });
});
