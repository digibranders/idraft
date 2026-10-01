import { afterEach, describe, expect, it, vi } from 'vitest';

import { readInspectorWidth, subscribeInspectorWidth, writeInspectorWidth } from './width-store';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('the inspector width store', () => {
  it('keeps a width per type, forgets it on reset, and tells its readers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeInspectorWidth(listener);
    writeInspectorWidth('keyword', 480);
    expect(readInspectorWidth('keyword')).toBe(480);
    expect(readInspectorWidth('prompt')).toBeNull();
    writeInspectorWidth('keyword', null);
    expect(readInspectorWidth('keyword')).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('ignores a stored value outside the limits', () => {
    window.localStorage.setItem('inspector-width:keyword', '9000');
    expect(readInspectorWidth('keyword')).toBeNull();
  });

  it('holds the width in memory when storage is full but still readable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    writeInspectorWidth('page', 456);
    expect(readInspectorWidth('page')).toBe(456);
  });

  it('holds the width in memory while storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    writeInspectorWidth('run', 520);
    expect(readInspectorWidth('run')).toBe(520);
  });
});
