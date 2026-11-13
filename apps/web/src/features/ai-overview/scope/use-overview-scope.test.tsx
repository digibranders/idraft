import { act, renderHook, waitFor } from '@testing-library/react';
import { withNuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useOverviewScope } from './use-overview-scope';

const TOPIC = '3f2b8c1e-5a47-4d0e-9b6a-1c2d3e4f5a6b';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-13T09:00:00Z'), toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(searchParams: string, timeZone = 'Europe/Berlin') {
  const updates: UrlUpdateEvent[] = [];
  const Adapter = withNuqsTestingAdapter({
    searchParams,
    hasMemory: true,
    onUrlUpdate: (event) => updates.push(event),
  });
  const hook = renderHook(() => useOverviewScope({ project: { timeZone } }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <Adapter>{children}</Adapter>
      </StrictMode>
    ),
  });
  const latest = (): URLSearchParams => new URLSearchParams(updates.at(-1)?.queryString ?? '');
  return { ...hook, updates, latest };
}

describe('useOverviewScope', () => {
  it('an empty URL is the default scope', () => {
    const { result, updates } = setup('');
    expect(result.current.scope).toEqual({
      range: { from: '2026-10-17', to: '2026-11-13', days: 28 },
      rangeValue: { kind: 'preset', preset: '28d' },
      compare: true,
      previous: { from: '2026-09-19', to: '2026-10-16' },
      country: null,
      engines: null,
      topic: null,
      branded: 'excluded',
    });
    expect(result.current.dropped).toBeNull();
    expect(updates).toHaveLength(0);
  });

  it('the keys cmp, country, engine, topic and branded are read', () => {
    const { result } = setup(`?cmp=off&country=DE&engine=gemini_web,chatgpt_web&topic=${TOPIC}&branded=only&win=7d`);
    expect(result.current.scope).toMatchObject({
      range: { from: '2026-11-07', to: '2026-11-13', days: 7 },
      compare: false,
      previous: { from: '2026-10-31', to: '2026-11-06' },
      country: 'DE',
      engines: ['gemini_web', 'chatgpt_web'],
      topic: TOPIC,
      branded: 'only',
    });
  });

  it('never trusts a raw value: unknown values fall back to the defaults', () => {
    const { result } = setup('?cmp=maybe&country=germany&engine=bogus&topic=crm&branded=sometimes');
    expect(result.current.scope).toMatchObject({
      compare: true,
      country: null,
      engines: null,
      topic: null,
      branded: 'excluded',
    });
  });

  it('a change is written with replace and defaults are removed from the URL', async () => {
    const { result, updates, latest } = setup(`?cmp=off&country=DE&topic=${TOPIC}&branded=only&q=crm`);
    act(() => {
      result.current.setScope({ compare: false, country: 'US', engines: ['gemini_web'], branded: 'included' });
    });
    await waitFor(() => expect(updates.length).toBeGreaterThan(0));
    expect(latest().get('cmp')).toBe('off');
    expect(latest().get('country')).toBe('US');
    expect(latest().get('engine')).toBe('gemini_web');
    expect(latest().get('branded')).toBe('included');
    // Other keys of the page stay
    expect(latest().get('q')).toBe('crm');
    expect(updates.every((update) => update.options.history === 'replace')).toBe(true);

    act(() => {
      result.current.setScope({ compare: true, country: null, engines: null, topic: null, branded: 'excluded' });
    });
    await waitFor(() => expect(latest().has('country')).toBe(false));
    for (const key of ['cmp', 'country', 'engine', 'topic', 'branded']) expect(latest().has(key)).toBe(false);
    expect(latest().get('q')).toBe('crm');
    expect(updates.every((update) => update.options.history === 'replace')).toBe(true);
  });

  it('an empty engine list is the default and removes the key', async () => {
    const { result, latest } = setup('?engine=gemini_web');
    act(() => {
      result.current.setScope({ engines: [] });
    });
    await waitFor(() => expect(latest().has('engine')).toBe(false));
  });

  it('a range change goes through the picker keys', async () => {
    const { result, latest } = setup('?win=7d');
    act(() => {
      result.current.setScope({ range: { kind: 'custom', from: '2026-09-01', to: '2026-10-31' } });
    });
    await waitFor(() => expect(latest().get('from')).toBe('2026-09-01'));
    expect(latest().get('to')).toBe('2026-10-31');
    expect(latest().has('win')).toBe(false);
  });

  it('a range the picker refuses falls back and reports dropped', () => {
    const { result } = setup('?from=2026-01-01&to=2026-11-13');
    expect(result.current.scope.rangeValue).toEqual({ kind: 'preset', preset: '28d' });
    expect(result.current.scope.range.days).toBe(28);
    expect(result.current.dropped).toEqual({ code: 'too_long', days: 317, max: 92 });
  });

  it('a range of 92 days is allowed', () => {
    const { result } = setup('?from=2026-08-14&to=2026-11-13');
    expect(result.current.scope.range).toEqual({ from: '2026-08-14', to: '2026-11-13', days: 92 });
    expect(result.current.dropped).toBeNull();
  });

  it('today is a day of the project zone', () => {
    // 22:00 UTC is already the next day in Kolkata and still the same day in Berlin
    vi.setSystemTime(new Date('2026-11-13T22:00:00Z'));
    expect(setup('', 'Asia/Kolkata').result.current.today).toBe('2026-11-14');
    expect(setup('', 'Europe/Berlin').result.current.today).toBe('2026-11-13');
    expect(setup('', 'Asia/Kolkata').result.current.scope.range.to).toBe('2026-11-14');
  });
});
