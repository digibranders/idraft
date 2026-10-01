import { act, renderHook, waitFor } from '@testing-library/react';
import { withNuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useInspector } from './use-inspector';

const IDS = ['k1', 'k2', 'k3'];

interface Setup {
  result: { current: ReturnType<typeof useInspector> };
  updates: UrlUpdateEvent[];
  /** Runs an action and waits for the URL update it queues (nuqs writes the URL after a tick). */
  run: (action: (inspector: ReturnType<typeof useInspector>) => void) => Promise<UrlUpdateEvent>;
}

function setup(searchParams = ''): Setup {
  const updates: UrlUpdateEvent[] = [];
  const { result } = renderHook(() => useInspector(), {
    // With memory, each update starts from the URL the last one left, as a browser's would
    wrapper: withNuqsTestingAdapter({ searchParams, hasMemory: true, onUrlUpdate: (event) => updates.push(event) }),
  });
  const run: Setup['run'] = async (action) => {
    const before = updates.length;
    act(() => action(result.current));
    await waitFor(() => {
      expect(updates.length).toBeGreaterThan(before);
    });
    const last = updates.at(-1);
    if (last === undefined) throw new Error('no URL update');
    return last;
  };
  return { result, updates, run };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useInspector', () => {
  it('reads the target and the tab, defaulting to Overview, and ignores a bad target', () => {
    expect(setup('?inspect=keyword:k2&itab=serp').result.current).toMatchObject({
      target: { type: 'keyword', id: 'k2' },
      tab: 'serp',
    });
    expect(setup('?inspect=keyword:k2').result.current.tab).toBe('overview');
    expect(setup('?inspect=nonsense').result.current.target).toBeNull();
  });

  it('pushes an entry to open, and replaces it to switch records or tabs', async () => {
    const { run } = setup();
    let update = await run((inspector) => inspector.open({ type: 'keyword', id: 'k1' }));
    expect(update.queryString).toBe('?inspect=keyword:k1');
    expect(update.options.history).toBe('push');

    update = await run((inspector) => inspector.setTab('serp'));
    expect(update.queryString).toBe('?inspect=keyword:k1&itab=serp');
    expect(update.options.history).toBe('replace');

    update = await run((inspector) => inspector.step('next', IDS));
    expect(update.queryString).toBe('?inspect=keyword:k2&itab=serp');
    expect(update.options.history).toBe('replace');

    update = await run((inspector) => inspector.open({ type: 'keyword', id: 'k3' }));
    expect(update.options.history).toBe('replace');
  });

  it('goes back to close what it pushed, and replaces to close an inspector that came with the URL', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const pushed = setup();
    await pushed.run((inspector) => inspector.open({ type: 'keyword', id: 'k1' }));
    act(() => pushed.result.current.close());
    expect(back).toHaveBeenCalledTimes(1);

    const linked = setup('?inspect=keyword:k1&itab=serp');
    const update = await linked.run((inspector) => inspector.close());
    expect(back).toHaveBeenCalledTimes(1);
    expect(update.queryString).toBe('');
    expect(update.options.history).toBe('replace');
  });

  it('places the record in the list, and stops at its ends', () => {
    const { result, updates } = setup('?inspect=keyword:k3');
    expect(result.current.position(IDS)).toEqual({ index: 2, count: 3 });
    act(() => result.current.step('next', IDS));
    expect(updates).toHaveLength(0);
    expect(result.current.position(['k1'])).toBeNull();
  });
});
