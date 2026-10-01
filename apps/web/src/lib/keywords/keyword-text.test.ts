import { describe, expect, it } from 'vitest';

import { cleanKeyword, keywordTextProblem, normalizeKeyword } from './keyword-text';

describe('keyword text', () => {
  it('keeps the casing of the text but not of its identity', () => {
    expect(cleanKeyword('  CRM­   Software ')).toBe('CRM Software');
    expect(normalizeKeyword('  CRM­   Software ')).toBe('crm software');
    expect(normalizeKeyword('ﬁle compression')).toBe('file compression');
  });

  it('refuses what the API refuses, in its order', () => {
    expect(keywordTextProblem('crm\u0007tools')).toBe('keyword_invalid');
    expect(keywordTextProblem('  ​ ')).toBe('keyword_missing');
    expect(keywordTextProblem('a'.repeat(701))).toBe('keyword_too_long');
    expect(keywordTextProblem('site:fynix.digital seo')).toBe('search_operator_not_allowed');
    expect(keywordTextProblem('seo agency -berlin')).toBe('search_operator_not_allowed');
    expect(keywordTextProblem('"seo agency"')).toBe('search_operator_not_allowed');
    expect(keywordTextProblem('allintitle: crm')).toBe('search_operator_not_allowed');
  });

  it('lets ordinary keywords through, hyphens and numbers included', () => {
    expect(keywordTextProblem('e-commerce seo')).toBeNull();
    expect(keywordTextProblem('seo -2 years')).toBeNull();
    expect(keywordTextProblem('site audit')).toBeNull();
    expect(keywordTextProblem('crm\tsoftware')).toBeNull();
  });
});
