import { afterEach, describe, expect, it, vi } from 'vitest';

import { inspectorPlacement } from './placement';
import { readInspectorWidth, subscribeInspectorWidth, writeInspectorWidth } from './width-store';
import { clearPreferences } from '@/lib/preferences/storage';

const KEY = 'idraft.pref.u1.inspector-width';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  // A width a failing storage left in the module's memory must not reach the next test
  writeInspectorWidth('u1', null);
  writeInspectorWidth(null, null);
});

describe('the inspector width store', () => {
  it('keeps one width per user under the preference prefix, and tells its readers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeInspectorWidth(listener);
    writeInspectorWidth('u1', 720);
    expect(window.localStorage.getItem(KEY)).toBe('720');
    expect(readInspectorWidth('u1')).toBe(720);
    expect(readInspectorWidth('u2')).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    writeInspectorWidth('u1', null);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(readInspectorWidth('u1')).toBeNull();
    unsubscribe();
  });

  it.each(['9000', '479', '640.5', 'abc', ''])(
    'ignores a stored value that is not an integer from 480 to 960: %j',
    (value) => {
      window.localStorage.setItem(KEY, value);
      expect(readInspectorWidth('u1')).toBeNull();
    },
  );

  it('leaves the stored value alone when a smaller window narrows it', () => {
    window.localStorage.setItem(KEY, '960');
    const { width } = inspectorPlacement({ viewportWidth: 1280, preferred: readInspectorWidth('u1') ?? 640 });
    expect(width).toBe(768);
    expect(window.localStorage.getItem(KEY)).toBe('960');
  });

  it('goes with the other preferences at sign-out', () => {
    writeInspectorWidth('u1', 720);
    clearPreferences();
    expect(readInspectorWidth('u1')).toBeNull();
  });

  it('keeps the width in memory without a user id and writes nothing', () => {
    writeInspectorWidth(null, 720);
    expect(readInspectorWidth(null)).toBe(720);
    // The test setup keeps an MSW cookie store in the same storage, so look for the width's own keys only
    expect(Object.keys(window.localStorage).filter((key) => key.includes('inspector-width'))).toEqual([]);
  });

  it('holds the width in memory when storage is full but still readable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    writeInspectorWidth('u1', 560);
    expect(readInspectorWidth('u1')).toBe(560);
  });

  it('holds the width in memory while storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    writeInspectorWidth('u1', 520);
    expect(readInspectorWidth('u1')).toBe(520);
  });

  it('never reads the old per-type keys, and removes them on a write', () => {
    window.localStorage.setItem('inspector-width:keyword', '520');
    expect(readInspectorWidth('u1')).toBeNull();
    writeInspectorWidth('u1', 640);
    expect(window.localStorage.getItem('inspector-width:keyword')).toBeNull();
  });

  it('tells its readers about a write in another tab', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeInspectorWidth(listener);
    window.dispatchEvent(new StorageEvent('storage'));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
