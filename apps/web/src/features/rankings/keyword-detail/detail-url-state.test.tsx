import { act, renderHook, waitFor } from '@testing-library/react';
import { withNuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import { describe, expect, it } from 'vitest';

import { useDetailUrlState } from './detail-url-state';

function setup(searchParams = ''): {
  result: { current: ReturnType<typeof useDetailUrlState> };
  updates: UrlUpdateEvent[];
} {
  const updates: UrlUpdateEvent[] = [];
  const { result } = renderHook(() => useDetailUrlState(), {
    wrapper: withNuqsTestingAdapter({ searchParams, hasMemory: true, onUrlUpdate: (event) => updates.push(event) }),
  });
  return { result, updates };
}

describe('useDetailUrlState', () => {
  it('reads the tab, defaulting to Overview', () => {
    expect(setup().result.current.tab).toBe('overview');
    expect(setup('?tab=snapshots').result.current.tab).toBe('snapshots');
  });

  it('falls back to Overview for a tab it does not know, without throwing', () => {
    expect(setup('?tab=diagnostics').result.current.tab).toBe('overview');
    expect(setup('?tab=').result.current.tab).toBe('overview');
  });

  it('writes a tab as a new history entry, and leaves the default out of the URL', async () => {
    const { result, updates } = setup();
    act(() => void result.current.setTab('snapshots'));
    await waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0]?.queryString).toBe('?tab=snapshots');
    expect(updates[0]?.options.history).toBe('push');

    act(() => void result.current.setTab('overview'));
    await waitFor(() => expect(updates.length).toBe(2));
    expect(updates[1]?.queryString).toBe('');
    expect(result.current.tab).toBe('overview');
  });

  it('keeps the other keys of the address when the tab changes', async () => {
    const { result, updates } = setup('?inspect=keyword:k1');
    act(() => void result.current.setTab('snapshots'));
    await waitFor(() => expect(updates.length).toBe(1));
    expect(new URLSearchParams(updates[0]?.queryString).get('inspect')).toBe('keyword:k1');
    expect(new URLSearchParams(updates[0]?.queryString).get('tab')).toBe('snapshots');
  });
});
