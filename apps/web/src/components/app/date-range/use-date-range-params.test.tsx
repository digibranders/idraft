import { act, renderHook, waitFor } from '@testing-library/react';
import { withNuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import { StrictMode, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useDateRangeParams, type UseDateRangeParamsOptions } from './use-date-range-params';

const TODAY = '2026-11-13';

function setup(searchParams: string, options: Partial<UseDateRangeParamsOptions> = {}) {
  const updates: UrlUpdateEvent[] = [];
  const Adapter = withNuqsTestingAdapter({
    searchParams,
    hasMemory: true,
    onUrlUpdate: (event) => updates.push(event),
  });
  const hook = renderHook(() => useDateRangeParams({ today: TODAY, ...options }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <Adapter>{children}</Adapter>
      </StrictMode>
    ),
  });
  const latest = (): URLSearchParams => new URLSearchParams(updates.at(-1)?.queryString ?? '');
  return { ...hook, updates, latest };
}

describe('useDateRangeParams', () => {
  it('gives the last 28 days for an address without a range, and writes nothing', () => {
    const { result, updates } = setup('');
    expect(result.current.value).toEqual({ kind: 'preset', preset: '28d' });
    expect(result.current.range).toEqual({ from: '2026-10-17', to: TODAY, days: 28 });
    expect(result.current.dropped).toBeNull();
    expect(updates).toHaveLength(0);
  });

  it('reads ?win=7d as the 7 day range', () => {
    const { result } = setup('?win=7d');
    expect(result.current.value).toEqual({ kind: 'preset', preset: '7d' });
    expect(result.current.range).toEqual({ from: '2026-11-07', to: TODAY, days: 7 });
  });

  it('reads from and to as a custom range', () => {
    const { result } = setup('?from=2026-09-01&to=2026-10-31');
    expect(result.current.value).toEqual({ kind: 'custom', from: '2026-09-01', to: '2026-10-31' });
    expect(result.current.range).toEqual({ from: '2026-09-01', to: '2026-10-31', days: 61 });
  });

  it('writes from and to for a custom range, removes win, and replaces the history entry', async () => {
    const { result, updates, latest } = setup('?win=7d&q=crm');
    act(() => {
      result.current.onValueChange({ kind: 'custom', from: '2026-09-01', to: '2026-10-31' });
    });
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(latest().get('from')).toBe('2026-09-01');
    expect(latest().get('to')).toBe('2026-10-31');
    expect(latest().has('win')).toBe(false);
    // Other keys of the page stay
    expect(latest().get('q')).toBe('crm');
    expect(updates[0]?.options.history).toBe('replace');
    await waitFor(() => expect(result.current.value).toEqual({ kind: 'custom', from: '2026-09-01', to: '2026-10-31' }));
  });

  it('writes win for a preset, and nothing for the default, removing from and to', async () => {
    const { result, updates, latest } = setup('?from=2026-09-01&to=2026-10-31');
    act(() => {
      result.current.onValueChange({ kind: 'preset', preset: '90d' });
    });
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(latest().get('win')).toBe('90d');
    expect(latest().has('from')).toBe(false);
    expect(latest().has('to')).toBe(false);
    act(() => {
      result.current.onValueChange({ kind: 'preset', preset: '28d' });
    });
    await waitFor(() => expect(updates).toHaveLength(2));
    expect(latest().toString()).toBe('');
  });

  it('reads a legacy key once as win, and removes it with the next change', async () => {
    const { result, updates, latest } = setup('?window=90&q=crm', { legacyWindowKey: 'window' });
    expect(result.current.value).toEqual({ kind: 'preset', preset: '90d' });
    expect(result.current.range.days).toBe(90);
    expect(updates).toHaveLength(0);
    act(() => {
      result.current.onValueChange({ kind: 'preset', preset: '7d' });
    });
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(latest().has('window')).toBe(false);
    expect(latest().get('win')).toBe('7d');
    expect(latest().get('q')).toBe('crm');
  });

  it('removes the legacy key also when the new range is the default', async () => {
    const { result, updates, latest } = setup('?window=7', { legacyWindowKey: 'window' });
    act(() => {
      result.current.onValueChange({ kind: 'preset', preset: '28d' });
    });
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(latest().toString()).toBe('');
    expect(result.current.value).toEqual({ kind: 'preset', preset: '28d' });
  });

  it('prefers win to the legacy key, and ignores a legacy value that is not a preset', () => {
    expect(setup('?window=90&win=7d', { legacyWindowKey: 'window' }).result.current.value).toEqual({
      kind: 'preset',
      preset: '7d',
    });
    const odd = setup('?window=45', { legacyWindowKey: 'window' }).result.current;
    expect(odd.value).toEqual({ kind: 'preset', preset: '28d' });
    expect(odd.dropped).toEqual({ code: 'invalid', field: 'from' });
  });

  it('does not read the legacy key when none is named', () => {
    expect(setup('?window=7').result.current.value).toEqual({ kind: 'preset', preset: '28d' });
  });

  it('reports a link that is too long, falling back to 28 days, until the range is changed', async () => {
    const { result, rerender, updates } = setup('?from=2026-06-01&to=2026-10-31');
    expect(result.current.value).toEqual({ kind: 'preset', preset: '28d' });
    expect(result.current.dropped).toEqual({ code: 'too_long', days: 153, max: 91 });
    // The same problem on every render, not a new one: an effect that depends on it runs once
    const first = result.current;
    rerender();
    rerender();
    expect(result.current.dropped).toBe(first.dropped);
    expect(result.current.value).toBe(first.value);
    expect(result.current.range).toBe(first.range);
    act(() => {
      result.current.onValueChange({ kind: 'preset', preset: '7d' });
    });
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(result.current.dropped).toBeNull();
  });

  it('reports a link that cannot be read', () => {
    const { result } = setup('?from=abc&to=2026-10-31');
    expect(result.current.value).toEqual({ kind: 'preset', preset: '28d' });
    expect(result.current.dropped).toEqual({ code: 'invalid', field: 'from' });
  });

  it('applies the limits it is given', () => {
    const { result } = setup('?from=2026-01-01&to=2026-02-01', { earliest: '2026-03-02' });
    expect(result.current.dropped).toEqual({ code: 'before_start', earliest: '2026-03-02' });
    expect(setup('?win=90d', { maxDays: 60 }).result.current.dropped).toEqual({
      code: 'too_long',
      days: 90,
      max: 60,
    });
  });

  it('keeps a stable onValueChange between renders', () => {
    const { result, rerender } = setup('?win=7d');
    const first = result.current.onValueChange;
    rerender();
    expect(result.current.onValueChange).toBe(first);
  });
});
