import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMapLayout } from './use-map-layout';
import { layoutMap, type LayoutInput } from '@/lib/internal-links/map-layout';

const input: LayoutInput = {
  nodes: [
    { id: 'a', links: 1, group: 1 },
    { id: 'b', links: 1, group: 1 },
    { id: 'c', links: 0, group: 2 },
  ],
  edges: [{ from: 'a', to: 'b' }],
  below: false,
};

describe('useMapLayout', () => {
  it('has no layout for no input', () => {
    const { result } = renderHook(() => useMapLayout(null));

    expect(result.current).toEqual({ layout: null, pending: false });
  });

  it('gives the layout of its input, here without a worker (the test environment has none)', async () => {
    const { result } = renderHook(() => useMapLayout(input));

    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.layout).toEqual(layoutMap(input));
  });

  it('lays out a new input in place of the old one', async () => {
    const { result, rerender } = renderHook(({ value }) => useMapLayout(value), { initialProps: { value: input } });
    await waitFor(() => expect(result.current.pending).toBe(false));

    const next = { ...input, below: true };
    rerender({ value: next });

    await waitFor(() => expect(result.current.layout).toEqual(layoutMap(next)));
  });

  describe('with a worker', () => {
    class FakeWorker {
      static made: FakeWorker[] = [];
      terminated = false;
      posted: unknown[] = [];
      private handlers = new Map<string, ((event: unknown) => void)[]>();
      constructor() {
        FakeWorker.made.push(this);
      }
      addEventListener(type: string, handler: (event: unknown) => void): void {
        this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
      }
      postMessage(message: unknown): void {
        this.posted.push(message);
      }
      terminate(): void {
        this.terminated = true;
      }
      emit(type: string, event: unknown = {}): void {
        for (const handler of this.handlers.get(type) ?? []) handler(event);
      }
    }

    afterEach(() => {
      FakeWorker.made = [];
      vi.unstubAllGlobals();
    });

    it('waits for the worker, shows its answer, and ends the worker with the input', () => {
      vi.stubGlobal('Worker', FakeWorker);
      const { result, unmount } = renderHook(() => useMapLayout(input));
      const worker = FakeWorker.made[0];

      expect(result.current).toEqual({ layout: null, pending: true });
      expect(worker?.posted).toEqual([input]);

      const answer = layoutMap(input);
      act(() => worker?.emit('message', { data: answer }));
      expect(result.current).toEqual({ layout: answer, pending: false });

      unmount();
      expect(worker?.terminated).toBe(true);
    });

    it('ignores an answer that arrives from the worker of an old input', () => {
      vi.stubGlobal('Worker', FakeWorker);
      const { result, rerender } = renderHook(({ value }) => useMapLayout(value), { initialProps: { value: input } });
      const next = { ...input, below: true };
      rerender({ value: next });
      const [old, current] = FakeWorker.made;

      act(() => old?.emit('message', { data: layoutMap(input) }));
      expect(result.current).toEqual({ layout: null, pending: true });
      act(() => current?.emit('message', { data: layoutMap(next) }));
      expect(result.current).toEqual({ layout: layoutMap(next), pending: false });
    });

    it('lays out here when the worker cannot start', () => {
      vi.stubGlobal('Worker', FakeWorker);
      const { result } = renderHook(() => useMapLayout(input));

      act(() => FakeWorker.made[0]?.emit('error'));

      expect(result.current).toEqual({ layout: layoutMap(input), pending: false });
    });
  });
});
