import { describe, expect, it } from 'vitest';

import messages from '../../../messages/en.json';
import { issueCheckIdValues } from '@/lib/api/schema';
import { CATEGORY_IDS, idKey } from './types';

const issues: Readonly<Record<string, unknown>> = messages.issues;
const textOf = (...path: string[]): unknown =>
  path.reduce<unknown>(
    (node, part) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined),
    issues,
  );

describe('idKey', () => {
  it('writes an id as a camelCase message key', () => {
    expect(idKey('status-4xx')).toBe('status4xx');
    expect(idKey('clicks-page-broken')).toBe('clicksPageBroken');
    expect(idKey('earning_pages')).toBe('earningPages');
    expect(idKey('links')).toBe('links');
  });
});

describe('the Issues words (messages/en.json)', () => {
  it.each(issueCheckIdValues.map((id) => [id]))('has a name, a why and a fix for %s', (id) => {
    for (const part of ['name', 'why', 'fix']) {
      const text = textOf('checks', idKey(id), part);
      expect(typeof text === 'string' && text !== '', `issues.checks.${idKey(id)}.${part}`).toBe(true);
    }
  });

  it('has no text for a check the API does not return', () => {
    expect(Object.keys(textOf('checks') as object).sort()).toEqual(issueCheckIdValues.map(idKey).sort());
  });

  it.each(CATEGORY_IDS.map((id) => [id]))('has a label for the category %s', (id) => {
    expect(typeof textOf('categories', idKey(id))).toBe('string');
  });

  it('has a name and a tooltip for every severity and every place a check is found', () => {
    for (const severity of ['error', 'warning', 'notice']) {
      for (const part of ['label', 'many', 'tip']) expect(typeof textOf('severity', severity, part)).toBe('string');
    }
    for (const found of ['crawl', 'ranks', 'gsc', 'ga4', 'ai']) {
      for (const part of ['label', 'tip']) expect(typeof textOf('foundBy', found, part)).toBe('string');
    }
  });
});
