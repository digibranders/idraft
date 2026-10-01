import { act, renderHook, waitFor } from '@testing-library/react';
import { withNuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import { StrictMode, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { FilterField } from './types';
import { useUrlFilters } from './use-url-filters';

const INTENT: FilterField = {
  id: 'intent',
  kind: 'enum',
  label: 'Intent',
  multi: true,
  options: [
    { value: 'commercial', label: 'Commercial' },
    { value: 'local', label: 'Local' },
  ],
};
const DIFFICULTY: FilterField = { id: 'kd', kind: 'range', label: 'KD', ends: 'max', bounds: { min: 0, max: 100 } };
const VOLUME: FilterField = { id: 'vol', kind: 'range', label: 'Volume', ends: 'min', bounds: { min: 0, max: 1_000 } };
const FIELDS: readonly FilterField[] = [INTENT, DIFFICULTY, VOLUME];

/** The hook under Strict Mode, as in development, with the URL updates it makes. */
function setup(searchParams: string, fields: readonly FilterField[] = FIELDS) {
  const updates: UrlUpdateEvent[] = [];
  const onDropped = vi.fn();
  const Adapter = withNuqsTestingAdapter({
    searchParams,
    hasMemory: true,
    onUrlUpdate: (event) => updates.push(event),
  });
  const hook = renderHook(({ current }) => useUrlFilters(current, { onDropped }), {
    initialProps: { current: fields },
    wrapper: ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <Adapter>{children}</Adapter>
      </StrictMode>
    ),
  });
  const latest = (): URLSearchParams => new URLSearchParams(updates.at(-1)?.queryString ?? '');
  return { ...hook, updates, onDropped, latest };
}

describe('useUrlFilters', () => {
  it('reads each field from its URL key', () => {
    const { result } = setup('?intent=local,commercial&kd=..40&vol=200..');
    expect(result.current[0]).toEqual({
      intent: { kind: 'enum', values: ['local', 'commercial'] },
      kd: { kind: 'range', min: null, max: 40 },
      vol: { kind: 'range', min: 200, max: null },
    });
  });

  it('drops an unknown id and an end outside the bounds, rewrites the URL, and reports it once', async () => {
    const { result, onDropped, latest } = setup('?intent=local,bogus&kd=..500&vol=-5..');
    expect(result.current[0]).toEqual({ intent: { kind: 'enum', values: ['local'] } });
    await waitFor(() => expect(latest().get('intent')).toBe('local'));
    expect(latest().has('kd')).toBe(false);
    expect(latest().has('vol')).toBe(false);
    expect(onDropped).toHaveBeenCalledTimes(1);
    expect(onDropped.mock.calls[0]?.[0]).toEqual([INTENT, DIFFICULTY, VOLUME]);
  });

  it('keeps the end a one-ended field takes, and reports the other as lost', async () => {
    const { result, onDropped, latest } = setup('?kd=10..40');
    expect(result.current[0]).toEqual({ kd: { kind: 'range', min: null, max: 40 } });
    await waitFor(() => expect(latest().get('kd')).toBe('..40'));
    expect(onDropped).toHaveBeenCalledWith([DIFFICULTY]);
  });

  it('tidies a repeated id without a word', async () => {
    const { onDropped, latest } = setup('?intent=local,local');
    await waitFor(() => expect(latest().get('intent')).toBe('local'));
    expect(onDropped).not.toHaveBeenCalled();
  });

  it('keeps an enum value as it is while the options load, and judges it once they have', async () => {
    const loading: FilterField = { ...INTENT, options: [], optionsLoading: true };
    const { result, rerender, onDropped, updates, latest } = setup('?intent=local,bogus', [loading]);
    expect(result.current[0]).toEqual({ intent: { kind: 'enum', values: ['local', 'bogus'] } });
    expect(updates).toHaveLength(0);
    rerender({ current: [INTENT] });
    await waitFor(() => expect(latest().get('intent')).toBe('local'));
    expect(onDropped).toHaveBeenCalledTimes(1);
  });

  it('writes the values set, and removes the keys of the ones cleared', async () => {
    const { result, latest } = setup('?kd=..40');
    act(() => result.current[1]({ intent: { kind: 'enum', values: ['commercial'] } }));
    await waitFor(() => expect(latest().get('intent')).toBe('commercial'));
    expect(latest().has('kd')).toBe(false);
  });
});
