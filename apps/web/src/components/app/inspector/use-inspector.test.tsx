import { act, renderHook, waitFor } from '@testing-library/react';
import { parseAsString, useQueryState, useQueryStates } from 'nuqs';
import { NuqsAdapter } from 'nuqs/adapters/react';
import { withNuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('forgets the entry it pushed when its page goes away, so a later inspector from the URL closes by replacing', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const page = renderHook(() => useInspector(), {
      wrapper: withNuqsTestingAdapter({ searchParams: '', hasMemory: true }),
    });
    act(() => page.result.current.open({ type: 'keyword', id: 'k1' }));
    page.unmount();

    const linked = setup('?inspect=keyword:k1');
    const update = await linked.run((inspector) => inspector.close());
    expect(back).not.toHaveBeenCalled();
    expect(update.options.history).toBe('replace');
  });

  describe('with the browser’s own history', () => {
    // The real adapter writes to window.location and the history, so what a close does to the URL is seen
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => <NuqsAdapter>{children}</NuqsAdapter>;
    const hooks = () =>
      renderHook(() => ({ inspector: useInspector(), filters: useQueryStates({ prio: parseAsString }) }), { wrapper });
    const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 150));

    beforeEach(() => {
      window.history.replaceState(null, '', '/?intent=commercial');
    });
    afterEach(() => {
      window.history.replaceState(null, '', '/');
    });

    it('goes back to the entry it was opened from when the page did not change the query', async () => {
      const { result } = hooks();
      act(() => result.current.inspector.open({ type: 'keyword', id: 'k1' }));
      await waitFor(() => expect(window.location.search).toBe('?intent=commercial&inspect=keyword:k1'));
      act(() => result.current.inspector.close());
      await waitFor(() => expect(window.location.search).toBe('?intent=commercial'));
      await settled();
      expect(window.location.search).toBe('?intent=commercial');
    });

    it('keeps a filter changed while it was open: closing does not go back to the old query string', async () => {
      const { result } = hooks();
      act(() => result.current.inspector.open({ type: 'keyword', id: 'k1' }));
      await waitFor(() => expect(window.location.search).toContain('inspect='));
      // A filter chip, the sort or the archived view rewrite the entry the inspector sits on
      act(() => void result.current.filters[1]({ prio: '..3' }, { history: 'replace' }));
      await waitFor(() => expect(window.location.search).toContain('prio='));
      act(() => result.current.inspector.close());
      await waitFor(() => expect(window.location.search).not.toContain('inspect='));
      await settled();
      expect(new URLSearchParams(window.location.search).get('prio')).toBe('..3');
      expect(new URLSearchParams(window.location.search).get('intent')).toBe('commercial');
      expect(result.current.inspector.target).toBeNull();
    });

    it('closes an inspector opened after an earlier one was closed the same way', async () => {
      const { result } = hooks();
      act(() => result.current.inspector.open({ type: 'keyword', id: 'k1' }));
      await waitFor(() => expect(window.location.search).toContain('inspect='));
      act(() => void result.current.filters[1]({ prio: '..3' }, { history: 'replace' }));
      await waitFor(() => expect(window.location.search).toContain('prio='));
      act(() => result.current.inspector.close());
      await waitFor(() => expect(window.location.search).not.toContain('inspect='));
      // Opened again with the filter in place, then closed with nothing else changed: back to that entry
      act(() => result.current.inspector.open({ type: 'keyword', id: 'k2' }));
      await waitFor(() => expect(window.location.search).toContain('inspect='));
      act(() => result.current.inspector.close());
      await waitFor(() => expect(window.location.search).not.toContain('inspect='));
      await settled();
      expect(new URLSearchParams(window.location.search).get('prio')).toBe('..3');
    });
  });

  describe('with the engine of a topic drawer beside it (entryKeys: eng)', () => {
    // The topic drawer's drill-down opens the inspector and writes `eng` in the same tick, as `useDrill` does
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => <NuqsAdapter>{children}</NuqsAdapter>;
    const hooks = () =>
      renderHook(
        () => ({ inspector: useInspector({ entryKeys: ['eng'] }), engine: useQueryState('eng', parseAsString) }),
        { wrapper },
      );
    const search = (): URLSearchParams => new URLSearchParams(window.location.search);

    beforeEach(() => {
      window.history.replaceState(null, '', '/?metric=citation');
    });
    afterEach(() => {
      window.history.replaceState(null, '', '/');
      vi.restoreAllMocks();
    });

    const drill = async (result: ReturnType<typeof hooks>['result']): Promise<void> => {
      act(() => {
        result.current.inspector.open({ type: 'topic', id: 't1' }, { tab: 'prompts' });
        void result.current.engine[1]('chatgpt_web');
      });
      await waitFor(() => expect(search().get('eng')).toBe('chatgpt_web'));
    };

    it('writes the drill as one pushed entry, and Back leaves the page as it was', async () => {
      const { result } = hooks();
      const push = vi.spyOn(window.history, 'pushState');
      await drill(result);
      expect(window.location.search).toBe('?metric=citation&inspect=topic:t1&itab=prompts&eng=chatgpt_web');
      // One entry for the inspector and the engine together, not two
      expect(push).toHaveBeenCalledTimes(1);
      act(() => window.history.back());
      await waitFor(() => expect(window.location.search).toBe('?metric=citation'));
      await waitFor(() => expect(result.current.inspector.target).toBeNull());
      expect(result.current.engine[0]).toBeNull();
    });

    it('goes back to close a drill it pushed, which takes eng with it', async () => {
      const { result } = hooks();
      await drill(result);
      const back = vi.spyOn(window.history, 'back');
      act(() => result.current.inspector.close());
      expect(back).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(window.location.search).toBe('?metric=citation'));
    });

    it('drops eng in the same write as the close when it closes by replacing', async () => {
      window.history.replaceState(null, '', '/?metric=citation&inspect=topic:t1&itab=prompts&eng=chatgpt_web');
      const { result } = hooks();
      const back = vi.spyOn(window.history, 'back');
      act(() => result.current.inspector.close());
      await waitFor(() => expect(window.location.search).toBe('?metric=citation'));
      expect(back).not.toHaveBeenCalled();
    });

    it('drops eng when the tab changes, and when another record opens', async () => {
      window.history.replaceState(null, '', '/?inspect=topic:t1&itab=prompts&eng=chatgpt_web');
      const { result } = hooks();
      act(() => result.current.inspector.setTab('related'));
      await waitFor(() => expect(window.location.search).toBe('?inspect=topic:t1&itab=related'));

      window.history.replaceState(null, '', '/?inspect=topic:t1&itab=prompts&eng=chatgpt_web');
      const again = hooks();
      act(() => again.result.current.inspector.open({ type: 'prompt', id: 'p1' }));
      // The tab of the open record carries over to the next, as it always did; the engine does not
      await waitFor(() => expect(window.location.search).toBe('?inspect=prompt:p1&itab=prompts'));
    });

    it('keeps eng when it steps to the next topic', async () => {
      window.history.replaceState(null, '', '/?inspect=topic:t1&itab=prompts&eng=chatgpt_web');
      const { result } = hooks();
      act(() => result.current.inspector.step('next', ['t1', 't2']));
      await waitFor(() => expect(window.location.search).toBe('?inspect=topic:t2&itab=prompts&eng=chatgpt_web'));
    });
  });

  describe('by default (no entryKeys)', () => {
    // `eng` is a documented scope key of other pages: an inspector that was not told it owns it leaves it alone
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => <NuqsAdapter>{children}</NuqsAdapter>;
    const OPEN = '/?inspect=topic:t1&itab=prompts&eng=chatgpt_web';
    afterEach(() => {
      window.history.replaceState(null, '', '/');
    });

    it('leaves eng alone on open, setTab and close', async () => {
      window.history.replaceState(null, '', OPEN);
      const { result } = renderHook(() => useInspector(), { wrapper });
      act(() => result.current.open({ type: 'prompt', id: 'p1' }));
      await waitFor(() => expect(window.location.search).toBe('?inspect=prompt:p1&itab=prompts&eng=chatgpt_web'));
      act(() => result.current.setTab('history'));
      await waitFor(() => expect(window.location.search).toBe('?inspect=prompt:p1&itab=history&eng=chatgpt_web'));
      act(() => result.current.close());
      await waitFor(() => expect(window.location.search).toBe('?eng=chatgpt_web'));
    });

    it('counts eng as page query: a close after it changed replaces, like after any filter', async () => {
      window.history.replaceState(null, '', '/?metric=citation');
      const back = vi.spyOn(window.history, 'back');
      const { result } = renderHook(
        () => ({ inspector: useInspector(), engine: useQueryState('eng', parseAsString) }),
        {
          wrapper,
        },
      );
      act(() => {
        result.current.inspector.open({ type: 'topic', id: 't1' });
        void result.current.engine[1]('chatgpt_web');
      });
      await waitFor(() => expect(window.location.search).toContain('eng=chatgpt_web'));
      act(() => result.current.inspector.close());
      // The page's query changed while the inspector was open (eng is a page key here): close replaces, as for any filter
      expect(back).not.toHaveBeenCalled();
      back.mockRestore();
    });
  });

  it('places the record in the list, and stops at its ends', () => {
    const { result, updates } = setup('?inspect=keyword:k3');
    expect(result.current.position(IDS)).toEqual({ index: 2, count: 3 });
    act(() => result.current.step('next', IDS));
    expect(updates).toHaveLength(0);
    expect(result.current.position(['k1'])).toBeNull();
  });
});
