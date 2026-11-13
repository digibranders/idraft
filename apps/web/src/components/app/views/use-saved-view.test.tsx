import { act, renderHook, waitFor } from '@testing-library/react';
import { withNuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import { NextIntlClientProvider } from 'next-intl';
import { StrictMode, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useSavedView } from './use-saved-view';
import { defaultView, type SavedView } from './views-model';
import messages from '../../../../messages/en.json';

const BRANDED: SavedView = { id: 'branded', name: 'Branded prompts', kind: 'preset', params: { branded: 'only' } };
const UNCITED: SavedView = {
  id: 'uncited',
  name: 'Uncited',
  kind: 'preset',
  params: { cited: 'no', sort: '-mention' },
};
const VIEWS: readonly SavedView[] = [defaultView('Default'), BRANDED, UNCITED];
const KEYS = ['branded', 'cited', 'sort', 'q', 'cols', 'density'] as const;

function setup(searchParams: string, views: readonly SavedView[] = VIEWS) {
  const updates: UrlUpdateEvent[] = [];
  const Adapter = withNuqsTestingAdapter({
    searchParams,
    hasMemory: true,
    onUrlUpdate: (event) => updates.push(event),
  });
  const hook = renderHook(() => useSavedView({ views, viewKeys: KEYS }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <Adapter>{children}</Adapter>
        </NextIntlClientProvider>
      </StrictMode>
    ),
  });
  const latest = (): URLSearchParams => new URLSearchParams(updates.at(-1)?.queryString ?? '');
  return { ...hook, updates, latest };
}

describe('useSavedView', () => {
  it('reads the view and the edited state from the URL', () => {
    expect(setup('').result.current).toMatchObject({ view: { id: 'default' }, edited: false });
    expect(setup('?view=branded&branded=only').result.current).toMatchObject({ view: BRANDED, edited: false });
    expect(setup('?view=branded&branded=only&q=crm').result.current).toMatchObject({ view: BRANDED, edited: true });
  });

  it('falls back to Default for an unknown view id, which stays in the address until a view is applied', () => {
    // Follow-up: clearing the unknown id from the address is not done here; applying any view replaces it
    const { result, updates } = setup('?view=gone');
    expect(result.current).toMatchObject({ view: { id: 'default' }, edited: false });
    expect(updates).toHaveLength(0);
  });

  it('reads a list of values in another order as the same view', () => {
    const intent: SavedView = { id: 'intent', name: 'Intent', kind: 'preset', params: { q: 'a,b' } };
    expect(setup('?view=intent&q=b,a', [...VIEWS, intent]).result.current).toMatchObject({
      view: intent,
      edited: false,
    });
  });

  it('degrades without a Default view in the list, with the first view or a Default of its own', () => {
    expect(setup('?view=gone', [BRANDED]).result.current.view).toBe(BRANDED);
    expect(setup('', []).result.current.view).toEqual(defaultView('Default'));
  });

  it('does not take the inspector or the date window for an edit', () => {
    const { result } = setup(
      '?view=branded&branded=only&inspect=keyword:1&itab=serp&win=7d&from=2026-01-01&to=2026-01-31',
    );
    expect(result.current.edited).toBe(false);
  });

  it('writes the view and its params in one update and removes the other view keys, with a history entry', async () => {
    const { result, updates, latest } = setup('?q=crm&density=compact');
    act(() => {
      result.current.apply(BRANDED);
    });
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(latest().get('view')).toBe('branded');
    expect(latest().get('branded')).toBe('only');
    expect(latest().has('q')).toBe(false);
    expect(latest().has('density')).toBe(false);
    expect(updates[0]?.options.history).toBe('push');
    expect(result.current).toMatchObject({ view: BRANDED, edited: false });
  });

  it('leaves the inspector and the date window as they are when a view is applied', async () => {
    const { result, latest } = setup('?inspect=keyword:1&itab=serp&win=7d&from=2026-01-01&to=2026-01-31&q=crm');
    act(() => {
      result.current.apply(UNCITED);
    });
    await waitFor(() => expect(latest().get('view')).toBe('uncited'));
    expect(Object.fromEntries(latest())).toMatchObject({
      inspect: 'keyword:1',
      itab: 'serp',
      win: '7d',
      from: '2026-01-01',
      to: '2026-01-31',
      cited: 'no',
      sort: '-mention',
    });
    expect(latest().has('q')).toBe(false);
  });

  it('removes view when Default is applied', async () => {
    const { result, latest } = setup('?view=branded&branded=only');
    act(() => {
      result.current.apply(VIEWS[0] ?? BRANDED);
    });
    await waitFor(() => expect(latest().has('view')).toBe(false));
    expect(latest().has('branded')).toBe(false);
    expect(result.current).toMatchObject({ view: { id: 'default' }, edited: false });
  });

  it('applies the current view again: the same state, not edited, nothing left over', async () => {
    const { result } = setup('?view=branded&branded=only');
    act(() => {
      result.current.apply(BRANDED);
    });
    await waitFor(() => expect(result.current).toMatchObject({ view: BRANDED, edited: false }));
  });

  it('applies the edited Default view again: the view keys are cleared and it reads as not edited', async () => {
    const { result, latest } = setup('?q=crm&density=compact&inspect=keyword:1');
    expect(result.current).toMatchObject({ view: { id: 'default' }, edited: true });
    act(() => {
      result.current.apply(VIEWS[0] ?? BRANDED);
    });
    await waitFor(() => expect(result.current.edited).toBe(false));
    expect(latest().has('q')).toBe(false);
    expect(latest().has('density')).toBe(false);
    expect(latest().get('inspect')).toBe('keyword:1');
    expect(result.current.view.id).toBe('default');
  });

  it('restores the params of the view on reset, without another history entry', async () => {
    const { result, updates, latest } = setup('?view=branded&branded=only&q=crm');
    expect(result.current.edited).toBe(true);
    act(() => {
      result.current.reset();
    });
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(latest().get('view')).toBe('branded');
    expect(latest().get('branded')).toBe('only');
    expect(latest().has('q')).toBe(false);
    expect(updates[0]?.options.history).toBe('replace');
    expect(result.current.edited).toBe(false);
  });
});
