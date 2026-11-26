'use client';

import { useEffect, useMemo, useState } from 'react';

import { layoutMap, type LayoutInput, type MapLayout } from '@/lib/internal-links/map-layout';

interface LayoutState {
  /** The input the layout below belongs to: a layout of another input is never shown. */
  of: LayoutInput | null;
  layout: MapLayout | null;
}

const hasWorker = (): boolean => typeof Worker !== 'undefined';

/**
 * The layout of the Link map for `input` (memoise the input: a new object is a new layout). The work runs in a
 * Web Worker, so a big map does not freeze the page; where there is no worker (a test, an old browser) it runs
 * here. `pending` is true from a new input until its layout arrives.
 */
export function useMapLayout(input: LayoutInput | null): { layout: MapLayout | null; pending: boolean } {
  const [state, setState] = useState<LayoutState>({ of: null, layout: null });
  const direct = useMemo(() => (input !== null && !hasWorker() ? layoutMap(input) : null), [input]);

  useEffect(() => {
    if (input === null || !hasWorker()) return undefined;
    const worker = new Worker(new URL('../../../lib/internal-links/map-layout.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', (event: MessageEvent<MapLayout>) => {
      setState({ of: input, layout: event.data });
    });
    // A worker that cannot start (a blocked script) must not leave the map waiting for ever
    worker.addEventListener('error', () => setState({ of: input, layout: layoutMap(input) }));
    worker.postMessage(input);
    return () => worker.terminate();
  }, [input]);

  if (input === null) return { layout: null, pending: false };
  if (direct !== null) return { layout: direct, pending: false };
  return state.of === input ? { layout: state.layout, pending: false } : { layout: null, pending: true };
}
