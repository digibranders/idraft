'use client';

import { parseAsString, useQueryStates } from 'nuqs';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';

import { governedKeys, matchView, VIEW_KEY, viewParams, type SavedView } from './views-model';

export interface UseSavedViewOptions {
  /** Every view the screen offers, the default view included. */
  views: readonly SavedView[];
  /**
   * The URL keys a view governs on this screen; never `inspect`, `itab`, `win`, `from`, `to`. Pass a STABLE
   * array (a module constant, or memoised): the parsers are memoised on its identity, so a new array on every
   * render rebuilds them on every render.
   */
  viewKeys: readonly string[];
}

export interface SavedViewState {
  view: SavedView;
  edited: boolean;
  /** Writes `viewParams` through nuqs: `view` with history push, the view keys in the same update. */
  apply: (view: SavedView) => void;
  /** Applies the current view again (Reset to {view}), replacing the history entry. */
  reset: () => void;
}

/**
 * The saved view of a screen, kept in the URL (23-application-patterns.md section 14): `view` names it
 * and is a history entry, the view keys hold its state and are replaced. "Edited" is read from the URL,
 * so a shared link shows the same state.
 *
 * A `view` id the screen does not offer reads as the default view. The id stays in the address until a view
 * is applied; cleaning it from the address on load is a follow-up.
 */
export function useSavedView({ views, viewKeys }: UseSavedViewOptions): SavedViewState {
  const t = useTranslations('common.savedViewMenu');
  const keys = useMemo(() => governedKeys(viewKeys), [viewKeys]);
  const parsers = useMemo(
    () => ({
      [VIEW_KEY]: parseAsString.withOptions({ history: 'push' }),
      ...Object.fromEntries(keys.map((key) => [key, parseAsString])),
    }),
    [keys],
  );
  const [state, setState] = useQueryStates(parsers, { history: 'replace' });
  const { view, edited } = matchView(views, state[VIEW_KEY] ?? null, state, keys, t('default'));

  const apply = useCallback(
    (next: SavedView): void => {
      void setState(viewParams(next, keys));
    },
    [keys, setState],
  );
  const reset = useCallback((): void => {
    void setState(viewParams(view, keys), { history: 'replace' });
  }, [keys, setState, view]);

  return { view, edited, apply, reset };
}
