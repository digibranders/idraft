import { describe, expect, it, vi } from 'vitest';

import { createCardReadinessStore } from './card-readiness';

describe('createCardReadinessStore', () => {
  it('reports and notifies subscribers when status changes', () => {
    const store = createCardReadinessStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(store.statusOf('card-1')).toBeUndefined();
    expect(store.isNotReady('card-1')).toBe(false);

    store.report('card-1', 'loading');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.statusOf('card-1')).toBe('loading');
    expect(store.isNotReady('card-1')).toBe(false);

    store.report('card-1', 'empty');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.statusOf('card-1')).toBe('empty');
    expect(store.isNotReady('card-1')).toBe(true);

    store.report('card-1', 'ready');
    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.statusOf('card-1')).toBe('ready');
    expect(store.isNotReady('card-1')).toBe(false);

    unsubscribe();
    store.report('card-1', 'error');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('ignores duplicate reports of the same status', () => {
    const store = createCardReadinessStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.report('card-1', 'ready');
    expect(listener).toHaveBeenCalledTimes(1);

    store.report('card-1', 'ready');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
