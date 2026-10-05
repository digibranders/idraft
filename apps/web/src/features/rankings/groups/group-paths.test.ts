import { afterEach, describe, expect, it, vi } from 'vitest';

import { newGroupChoice } from './group-choices';
import { findGroup, missingNames, pathProblem, splitPath } from './group-paths';

const groups = [
  { group_id: 'g-blog', parent_id: null, name: 'Blog', path: 'Blog' },
  { group_id: 'g-guides', parent_id: 'g-blog', name: 'Guides', path: 'Blog/Guides' },
  { group_id: 'g-services', parent_id: null, name: 'Services', path: 'Services' },
];

describe('group paths', () => {
  it('splits a typed path into trimmed names', () => {
    expect(splitPath(' Blog / How to ')).toEqual(['Blog', 'How to']);
    expect(splitPath('Blog')).toEqual(['Blog']);
  });

  it('names what is wrong with a typed path', () => {
    expect(pathProblem('')).toBe('empty');
    expect(pathProblem('Blog//Guides')).toBe('empty');
    expect(pathProblem(`Blog/${'a'.repeat(101)}`)).toBe('too_long');
    expect(pathProblem(Array.from({ length: 11 }, (_, index) => `L${String(index)}`).join('/'))).toBe('too_deep');
    expect(pathProblem('Blog/Guides')).toBeNull();
  });

  it('finds a group by its path in any case', () => {
    expect(findGroup(groups, ['blog', 'GUIDES'])?.group_id).toBe('g-guides');
    expect(findGroup(groups, ['Blog', 'News'])).toBeNull();
  });

  it('lists the names still missing below the deepest group that exists', () => {
    expect(missingNames(groups, ['Blog', 'Guides', 'SEO', 'Local'])).toEqual({
      parentId: 'g-guides',
      names: ['SEO', 'Local'],
    });
    expect(missingNames(groups, ['News'])).toEqual({ parentId: null, names: ['News'] });
    expect(missingNames(groups, ['services'])).toEqual({ parentId: 'g-services', names: [] });
  });

  it('finds a group three levels down, and the level where the path stops', () => {
    const deep = [
      ...groups,
      { group_id: 'g-seo', parent_id: 'g-guides', name: 'SEO', path: 'Blog/Guides/SEO' },
      { group_id: 'g-seo-root', parent_id: null, name: 'SEO', path: 'SEO' },
    ];
    expect(findGroup(deep, ['blog', 'guides', 'seo'])?.group_id).toBe('g-seo');
    expect(findGroup(deep, ['Blog', 'Guides', 'Local'])).toBeNull();
    // A name that exists elsewhere does not stand in for a missing level
    expect(findGroup(deep, ['Blog', 'SEO'])).toBeNull();
    expect(missingNames(deep, ['Blog', 'Guides', 'SEO'])).toEqual({ parentId: 'g-seo', names: [] });
    expect(missingNames(deep, ['Blog', 'Guides', 'SEO', 'Local', 'Maps'])).toEqual({
      parentId: 'g-seo',
      names: ['Local', 'Maps'],
    });
    expect(missingNames(deep, ['Blog', 'News', 'SEO'])).toEqual({ parentId: 'g-blog', names: ['News', 'SEO'] });
  });
});

describe('matching names without a locale', () => {
  const lower = String.prototype.toLocaleLowerCase;
  afterEach(() => vi.restoreAllMocks());

  /** A browser whose language is Turkish lowercases "I" as a dotless i. */
  const inTurkish = (): void => {
    vi.spyOn(String.prototype, 'toLocaleLowerCase').mockImplementation(function (this: string): string {
      return lower.call(this, 'tr');
    });
  };

  it('matches INFO with info, as the server does, in a Turkish browser', () => {
    inTurkish();
    const named = [{ group_id: 'g-info', parent_id: null, name: 'info', path: 'info' }];
    expect(findGroup(named, ['INFO'])?.group_id).toBe('g-info');
    expect(missingNames(named, ['INFO'])).toEqual({ parentId: 'g-info', names: [] });
    expect(newGroupChoice('INFO').key).toBe(newGroupChoice('info').key);
  });

  it('does not match a dotless i with an i, which the server keeps apart', () => {
    inTurkish();
    const named = [{ group_id: 'g-isparta', parent_id: null, name: 'Isparta', path: 'Isparta' }];
    expect(findGroup(named, ['\u0131sparta'])).toBeNull();
    expect(newGroupChoice('Isparta').key).not.toBe(newGroupChoice('\u0131sparta').key);
  });

  it('matches a dotted capital I with itself in any case', () => {
    inTurkish();
    const named = [{ group_id: 'g-istanbul', parent_id: null, name: '\u0130stanbul', path: '\u0130stanbul' }];
    expect(findGroup(named, ['\u0130STANBUL'])?.group_id).toBe('g-istanbul');
  });
});
