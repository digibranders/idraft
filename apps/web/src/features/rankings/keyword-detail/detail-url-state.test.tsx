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

  it('reads the window, defaulting to 90 days, and falls back for one it does not know', () => {
    expect(setup().result.current.win).toBe('90d');
    expect(setup('?win=30d').result.current.win).toBe('30d');
    expect(setup('?win=365d').result.current.win).toBe('365d');
    expect(setup('?win=14d').result.current.win).toBe('90d');
  });

  it('writes a window by replacing the history entry, and leaves the default out of the URL', async () => {
    const { result, updates } = setup();
    act(() => void result.current.setWin('7d'));
    await waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0]?.queryString).toBe('?win=7d');
    expect(updates[0]?.options.history).toBe('replace');
    act(() => void result.current.setWin('90d'));
    await waitFor(() => expect(updates.length).toBe(2));
    expect(updates[1]?.queryString).toBe('');
  });

  it('reads the chosen competitors, keeps uuids only and at most five', () => {
    const ids = [1, 2, 3, 4, 5, 6].map((n) => `0192f0a1-3c44-7e10-9b1d-1f2a3b4c5d0${String(n)}`);
    expect(setup().result.current.comp).toBeNull();
    expect(setup(`?comp=${ids[0] ?? ''},not-a-uuid,${ids[1] ?? ''}`).result.current.comp).toEqual([ids[0], ids[1]]);
    expect(setup(`?comp=${ids.join(',')}`).result.current.comp).toEqual(ids.slice(0, 5));
  });

  it('tells no competitors from the default set: an empty choice is written as none', async () => {
    expect(setup('?comp=none').result.current.comp).toEqual([]);
    const { result, updates } = setup();
    act(() => void result.current.setComp([]));
    await waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0]?.queryString).toBe('?comp=none');
    expect(updates[0]?.options.history).toBe('replace');
    act(() => void result.current.setComp(null));
    await waitFor(() => expect(updates.length).toBe(2));
    expect(updates[1]?.queryString).toBe('');
  });

  it('writes at most five competitors', async () => {
    const ids = [1, 2, 3, 4, 5, 6].map((n) => `0192f0a1-3c44-7e10-9b1d-1f2a3b4c5d0${String(n)}`);
    const { result, updates } = setup();
    act(() => void result.current.setComp(ids));
    await waitFor(() => expect(updates.length).toBe(1));
    expect(new URLSearchParams(updates[0]?.queryString).get('comp')).toBe(ids.slice(0, 5).join(','));
  });

  it('reads the snapshot shown (obs) and the one it is compared with (vs) as decimal integer text', () => {
    expect(setup().result.current.obs).toBeNull();
    expect(setup().result.current.vs).toBeNull();
    expect(setup('?obs=812').result.current.obs).toBe('812');
    expect(setup('?obs=812&vs=790').result.current.vs).toBe('790');
  });

  it('drops an obs or vs that is not a decimal integer, or too large to be sent exactly', () => {
    for (const bad of ['abc', '0', '-5', '08', '1.5', '1e3', '12ab', '', '9007199254740993']) {
      expect(setup(`?obs=${bad}`).result.current.obs, `obs=${bad}`).toBeNull();
      expect(setup(`?vs=${bad}`).result.current.vs, `vs=${bad}`).toBeNull();
    }
  });

  it('writes obs as a new history entry, so Back returns to the latest check, and clears it with null', async () => {
    const { result, updates } = setup('?tab=snapshots');
    act(() => void result.current.setObs('812'));
    await waitFor(() => expect(updates.length).toBe(1));
    expect(new URLSearchParams(updates[0]?.queryString).get('obs')).toBe('812');
    expect(new URLSearchParams(updates[0]?.queryString).get('tab')).toBe('snapshots');
    expect(updates[0]?.options.history).toBe('push');
    act(() => void result.current.setObs(null));
    await waitFor(() => expect(updates.length).toBe(2));
    expect(updates[1]?.queryString).toBe('?tab=snapshots');
    expect(updates[1]?.options.history).toBe('push');
  });

  it('writes vs as a new history entry', async () => {
    const { result, updates } = setup();
    act(() => void result.current.setVs('790'));
    await waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0]?.queryString).toBe('?vs=790');
    expect(updates[0]?.options.history).toBe('push');
  });

  it('reads the chart layers, drops unknown ones, and omits an empty choice', async () => {
    expect(setup().result.current.show).toEqual([]);
    expect(setup('?show=absolute,bogus,deep').result.current.show).toEqual(['absolute', 'deep']);
    expect(setup('?show=events').result.current.show).toEqual(['events']);
    const { result, updates } = setup('?show=deep');
    act(() => void result.current.setShow(['absolute', 'deep']));
    await waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0]?.queryString).toBe('?show=absolute,deep');
    expect(updates[0]?.options.history).toBe('replace');
    act(() => void result.current.setShow([]));
    await waitFor(() => expect(updates.length).toBe(2));
    expect(updates[1]?.queryString).toBe('');
  });

  it('keeps an id once when the address names it twice, and counts the five after the duplicates are gone', () => {
    const ids = [1, 2, 3, 4, 5, 6].map((n) => `0192f0a1-3c44-7e10-9b1d-1f2a3b4c5d0${String(n)}`);
    const [a, b] = ids;
    expect(setup(`?comp=${a ?? ''},${a ?? ''}`).result.current.comp).toEqual([a]);
    expect(setup(`?comp=${a ?? ''},${b ?? ''},${a ?? ''}`).result.current.comp).toEqual([a, b]);
    expect(setup(`?comp=${[...ids, ...ids].join(',')}`).result.current.comp).toEqual(ids.slice(0, 5));
  });
});
