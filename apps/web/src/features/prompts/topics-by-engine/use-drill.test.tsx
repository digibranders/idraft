import { act, renderHook, waitFor } from '@testing-library/react';
import { NuqsAdapter } from 'nuqs/adapters/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DRAWER_ENTRY_KEYS } from './drill';
import { useDrill } from './use-drill';
import { useInspector } from '@/components/app/inspector/use-inspector';

// The real adapter writes to the browser's own address and history, so what a drill leaves behind is seen
const wrapper = ({ children }: { children: ReactNode }): ReactNode => <NuqsAdapter>{children}</NuqsAdapter>;
const hooks = () =>
  renderHook(() => ({ drill: useDrill(), inspector: useInspector({ entryKeys: DRAWER_ENTRY_KEYS }) }), { wrapper });

beforeEach(() => {
  window.history.replaceState(null, '', '/?view=engines&metric=sov');
});
afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('useDrill: from an engine cell to the prompts behind it', () => {
  it('opens the topic on its Prompts tab with the engine in one pushed entry, every other key kept', async () => {
    const push = vi.spyOn(window.history, 'pushState');
    const { result } = hooks();
    act(() => result.current.drill('topic-1', 'chatgpt_web'));
    await waitFor(() =>
      expect(window.location.search).toBe(
        '?view=engines&metric=sov&inspect=topic:topic-1&itab=prompts&eng=chatgpt_web',
      ),
    );
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('Close goes back to the page as it was, with no eng left in the address', async () => {
    const { result } = hooks();
    act(() => result.current.drill('topic-1', 'chatgpt_web'));
    await waitFor(() => expect(window.location.search).toContain('eng=chatgpt_web'));
    const back = vi.spyOn(window.history, 'back');
    act(() => result.current.inspector.close());
    expect(back).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(window.location.search).toBe('?view=engines&metric=sov'));
  });

  it('Close takes the drawer away in one step after an engine row of its panel moved it on', async () => {
    const { result } = hooks();
    act(() => result.current.drill('topic-1', 'chatgpt_web'));
    await waitFor(() => expect(window.location.search).toContain('eng=chatgpt_web'));
    // A panel row is a link that replaces the entry (a pushed one would need a second Close): its address, as the router writes it
    act(() =>
      window.history.replaceState(
        null,
        '',
        '/?view=engines&metric=sov&inspect=topic:topic-1&itab=prompts&eng=gemini_web',
      ),
    );
    const back = vi.spyOn(window.history, 'back');
    act(() => result.current.inspector.close());
    expect(back).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(window.location.search).toBe('?view=engines&metric=sov'));
    await waitFor(() => expect(result.current.inspector.target).toBeNull());
  });

  it('Back after a drill leaves the page as it was', async () => {
    const { result } = hooks();
    act(() => result.current.drill('topic-1', 'chatgpt_web'));
    await waitFor(() => expect(window.location.search).toContain('eng=chatgpt_web'));
    act(() => window.history.back());
    await waitFor(() => expect(window.location.search).toBe('?view=engines&metric=sov'));
    await waitFor(() => expect(result.current.inspector.target).toBeNull());
  });

  it('closes a drawer that came with the address by replacing, and drops eng in the same write', async () => {
    window.history.replaceState(null, '', '/?inspect=topic:topic-1&itab=prompts&eng=chatgpt_web&metric=sov');
    const { result } = hooks();
    act(() => result.current.inspector.close());
    await waitFor(() => expect(window.location.search).toBe('?metric=sov'));
  });
});
