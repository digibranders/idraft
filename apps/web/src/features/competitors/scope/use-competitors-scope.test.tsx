import { act, renderHook, waitFor } from '@testing-library/react';
import { withNuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCompetitorsScope } from './use-competitors-scope';

const TOPIC = '3f2b8c1e-5a47-4d0e-9b6a-1c2d3e4f5a6b';
const ENGINES = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-13T09:00:00Z'), toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(searchParams: string) {
  const updates: UrlUpdateEvent[] = [];
  const Adapter = withNuqsTestingAdapter({
    searchParams,
    hasMemory: true,
    onUrlUpdate: (event) => updates.push(event),
  });
  const hook = renderHook(() => useCompetitorsScope('Europe/Berlin', ENGINES), {
    wrapper: ({ children }: { children: ReactNode }) => <Adapter>{children}</Adapter>,
  });
  const latest = (): URLSearchParams => new URLSearchParams(updates.at(-1)?.queryString ?? '');
  return { ...hook, updates, latest };
}

describe('useCompetitorsScope', () => {
  it('an empty address is the default scope and writes nothing', () => {
    const { result, updates } = setup('');
    expect(result.current.scope).toMatchObject({ tab: 'comparison', compare: true, eng: 'chatgpt_web' });
    expect(result.current.range).toEqual({ from: '2026-10-17', to: '2026-11-13' });
    expect(updates).toHaveLength(0);
  });

  it('setting a value that is the default removes its key', async () => {
    const { result, updates, latest } = setup(
      `?cmp=off&tab=ai&engine=gemini_web&metric=sov&branded=only&topic=${TOPIC}&country=DE`,
    );
    act(() => {
      result.current.setScope({
        tab: 'comparison',
        compare: true,
        engines: null,
        metric: 'mention',
        branded: 'excluded',
        topic: null,
        country: null,
      });
    });
    await waitFor(() => expect(updates.length).toBeGreaterThan(0));
    expect(latest().toString()).toBe('');
  });

  it('writes a value that is not the default, with replace', async () => {
    const { result, updates, latest } = setup('');
    act(() => {
      result.current.setScope({
        compare: false,
        engines: ['gemini_web', 'chatgpt_web'],
        metric: 'sov',
        eng: 'gemini_web',
      });
    });
    await waitFor(() => expect(updates.length).toBeGreaterThan(0));
    expect(latest().get('cmp')).toBe('off');
    expect(latest().get('engine')).toBe('gemini_web,chatgpt_web');
    expect(latest().get('metric')).toBe('sov');
    expect(latest().get('eng')).toBe('gemini_web');
    expect(updates.at(-1)?.options.history).toBe('replace');
  });

  it('changing tab pushes history and clears cols, q and sort', async () => {
    const { result, updates, latest } = setup('?cols=topic,gap&q=crm&sort=-gap&density=default&metric=sov');
    act(() => {
      result.current.setScope({ tab: 'ai' });
    });
    await waitFor(() => expect(updates.length).toBeGreaterThan(0));
    expect(updates.at(-1)?.options.history).toBe('push');
    expect(latest().get('tab')).toBe('ai');
    for (const key of ['cols', 'q', 'sort']) expect(latest().has(key)).toBe(false);
    // The other keys of the page stay
    expect(latest().get('density')).toBe('default');
    expect(latest().get('metric')).toBe('sov');
  });

  it('going back to Comparison removes the tab key', async () => {
    const { result, updates, latest } = setup('?tab=seo');
    act(() => {
      result.current.setScope({ tab: 'comparison' });
    });
    await waitFor(() => expect(updates.length).toBeGreaterThan(0));
    expect(latest().has('tab')).toBe(false);
  });

  it('the range comes from the picker and is at most 92 days', () => {
    const { result } = setup('?from=2026-06-01&to=2026-11-01');
    // 154 days is refused: the default window shows and the reason is kept for the banner
    expect(result.current.range).toEqual({ from: '2026-10-17', to: '2026-11-13' });
    expect(result.current.picked.dropped).toMatchObject({ code: 'too_long', max: 92 });
    const ok = setup('?from=2026-09-01&to=2026-11-01');
    expect(ok.result.current.range).toEqual({ from: '2026-09-01', to: '2026-11-01' });
    expect(ok.result.current.picked.dropped).toBeNull();
  });
});
