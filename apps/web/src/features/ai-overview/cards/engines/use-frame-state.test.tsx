import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MissingEmptyStateError, useFrameState, type FrameStateData } from './use-frame-state';
import messages from '../../../../../messages/en.json';
import type { ChartEmpty } from '@/components/app/chart/chart-frame';

const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
    {children}
  </NextIntlClientProvider>
);

const DATA: FrameStateData = { phase: 'ready', stale: false, partialPrevious: false, errorId: null, retry: vi.fn() };
const EMPTY: ChartEmpty = { title: 'No valid answers in these 28 days', reason: '12 answers were not valid.' };

function stateOf(
  data: Partial<FrameStateData>,
  options: { empty?: ChartEmpty | null; retrying?: boolean } = {},
): ReturnType<typeof useFrameState> {
  return renderHook(() => useFrameState({ ...DATA, ...data }, { name: 'AI by engine', ...options }), { wrapper }).result
    .current;
}

describe('useFrameState', () => {
  it('loading and refetching pass through', () => {
    expect(stateOf({ phase: 'loading' })).toEqual({ status: 'loading' });
    expect(stateOf({ phase: 'refetching' })).toEqual({ status: 'refetching' });
    expect(stateOf({ phase: 'ready' })).toEqual({ status: 'ready' });
  });

  it('empty carries title, reason and action', () => {
    const action = <a href="/runs">View runs</a>;
    const state = stateOf({ phase: 'empty' }, { empty: { ...EMPTY, action } });
    expect(state).toEqual({ status: 'empty', empty: { ...EMPTY, action } });
  });

  it('an empty card without the words of its empty state is an error of the card, named', () => {
    expect(() => stateOf({ phase: 'empty' })).toThrow(MissingEmptyStateError);
  });

  it('error carries Retry, the error id words and retrying while the read runs', () => {
    const retry = vi.fn();
    const state = stateOf({ phase: 'error', errorId: 'req-77', retry }, { retrying: true });
    expect(state.status).toBe('error');
    if (state.status !== 'error') return;
    expect(state.error).toMatchObject({
      title: 'Could not load AI by engine',
      reason: 'The server returned an error. The rest of the page is unchanged.',
      retryLabel: 'Try again',
      retrying: true,
      errorId: { id: 'req-77', label: 'Error ID req-77', copyLabel: 'Copy error ID', copiedLabel: 'Error ID copied' },
    });
    state.error.onRetry();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('an error without an id (a lost connection) has no error id', () => {
    const state = stateOf({ phase: 'error', errorId: null });
    expect(state.status === 'error' && state.error.errorId).toBeNull();
    expect(state.status === 'error' && state.error.retrying).toBe(false);
  });

  it('stale and partial become notices with the words of aiOverview.engines.common', () => {
    expect(stateOf({ stale: true })).toEqual({
      status: 'ready',
      notice: { kind: 'stale', text: 'Stale: these are the last figures read' },
    });
    expect(stateOf({ partialPrevious: true })).toEqual({
      status: 'ready',
      notice: { kind: 'partial', text: 'Partial data: the previous window could not be read' },
    });
    expect(stateOf({ phase: 'refetching', stale: true }).notice?.kind).toBe('stale');
  });

  it('says stale before partial when both hold, and no notice on a state that shows no figures', () => {
    expect(stateOf({ stale: true, partialPrevious: true }).notice?.kind).toBe('stale');
    expect(stateOf({ phase: 'loading', stale: true }).notice).toBeUndefined();
    expect(stateOf({ phase: 'empty', stale: true }, { empty: EMPTY }).notice).toBeUndefined();
  });
});
