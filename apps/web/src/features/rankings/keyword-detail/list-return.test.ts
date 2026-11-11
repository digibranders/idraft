import { describe, expect, it } from 'vitest';

import { listReturnHref, rememberListHref } from './list-return';
import { rankingsPath } from '@/lib/routes/paths';

const LIST = rankingsPath('acme', 'fynix');
const OTHER = rankingsPath('acme', 'other');

/** A storage that keeps its items in memory, as `sessionStorage` does for a tab. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

/** A storage like the one of a private window or a blocked site: every access throws. */
function throwingStorage(): Storage {
  const refuse = (): never => {
    throw new DOMException('Blocked', 'SecurityError');
  };
  return {
    get length(): number {
      return refuse();
    },
    clear: refuse,
    getItem: refuse,
    key: refuse,
    removeItem: refuse,
    setItem: refuse,
  };
}

describe('the list the back link returns to', () => {
  it('returns the list with the query the person left it with', () => {
    const storage = memoryStorage();
    rememberListHref(storage, LIST, '?q=seo&sort=-rank');
    expect(listReturnHref(storage, LIST)).toBe(`${LIST}?q=seo&sort=-rank`);
  });

  it('leaves out the keys of the inspector: the page is the keyword', () => {
    const storage = memoryStorage();
    rememberListHref(storage, LIST, '?q=seo&inspect=keyword%3Aabc&itab=history&archived=true');
    expect(listReturnHref(storage, LIST)).toBe(`${LIST}?q=seo&archived=true`);
  });

  it('returns the bare path when nothing was remembered, or the list had no query', () => {
    const storage = memoryStorage();
    expect(listReturnHref(storage, LIST)).toBe(LIST);
    rememberListHref(storage, LIST, '?inspect=keyword%3Aabc');
    expect(listReturnHref(storage, LIST)).toBe(LIST);
    rememberListHref(storage, LIST, '');
    expect(listReturnHref(storage, LIST)).toBe(LIST);
  });

  it('keeps one list per project', () => {
    const storage = memoryStorage();
    rememberListHref(storage, LIST, '?q=seo');
    rememberListHref(storage, OTHER, '?q=shoes');
    expect(listReturnHref(storage, LIST)).toBe(`${LIST}?q=seo`);
    expect(listReturnHref(storage, OTHER)).toBe(`${OTHER}?q=shoes`);
  });

  it('forgets an earlier query when the list is left without one', () => {
    const storage = memoryStorage();
    rememberListHref(storage, LIST, '?q=seo');
    rememberListHref(storage, LIST, '');
    expect(listReturnHref(storage, LIST)).toBe(LIST);
  });

  it('works without storage: the bare path, and no error from a write', () => {
    const storage = throwingStorage();
    expect(() => rememberListHref(storage, LIST, '?q=seo')).not.toThrow();
    expect(listReturnHref(storage, LIST)).toBe(LIST);
  });

  it('works with no storage at all', () => {
    expect(listReturnHref(null, LIST)).toBe(LIST);
    expect(() => rememberListHref(null, LIST, '?q=seo')).not.toThrow();
  });
});
