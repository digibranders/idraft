/** URL values a view sets for the screen's view keys; a key it does not list is cleared. */
export type ViewParams = Readonly<Record<string, string>>;

export interface SavedView {
  /** `default` for the built-in default (no params); a slug for a preset; the API id for a stored view. */
  id: string;
  name: string;
  kind: 'preset' | 'stored';
  /** Stored views only (WP-49): the menu groups them under Workspace views and Your views. */
  scope?: 'workspace' | 'personal' | undefined;
  params: ViewParams;
}

export const DEFAULT_VIEW_ID = 'default';

/** The current values of the view keys, as nuqs gives them (`null` for absent). */
export type ViewState = Readonly<Record<string, string | null>>;

/** The URL key that names the view. It is written with the view keys, and is never one of them. */
export const VIEW_KEY = 'view';

/**
 * Keys that belong to other things than a view: the inspector and the date window (23-application-patterns
 * section 14). A preset never sets or clears them, whatever it lists.
 */
const NEVER_VIEW_KEYS: ReadonlySet<string> = new Set([VIEW_KEY, 'inspect', 'itab', 'win', 'from', 'to']);

/** The view keys that a view governs on a screen: the screen's keys without the ones above. */
export function governedKeys(viewKeys: readonly string[]): string[] {
  return viewKeys.filter((key) => !NEVER_VIEW_KEYS.has(key));
}

/** The built-in view with no params. The caller names it, so the name comes from the message catalog. */
export function defaultView(name: string): SavedView {
  return { id: DEFAULT_VIEW_ID, name, kind: 'preset', params: {} };
}

/** An empty value is an absent one when a view is written: `?q=` and no `q` are the same state. */
const present = (value: string | null | undefined): string | null =>
  value === undefined || value === '' ? null : value;

/**
 * A value as a set, for comparing only (a view is written as it is given). The filter bar writes a multi
 * value as `a,b` in the order the person picked (lib/filters/filter-values.ts), so `b,a` is the same state;
 * empty members and an empty value are absent. `matchView` reads every key as a set except `sort`, which is
 * compared in order; give another key whose order matters its own comparison there.
 */
const asSet = (value: string | null | undefined): string | null => {
  if (value === undefined || value === null) return null;
  const members = new Set(
    value
      .split(',')
      .map((member) => member.trim())
      .filter((member) => member !== ''),
  );
  return members.size === 0 ? null : [...members].sort().join(',');
};

/**
 * The view the URL names and whether the view keys differ from it. An absent or unknown id gives the
 * default view; a list without one degrades (the first view, or an empty default named `defaultName`)
 * instead of throwing, because this runs while the page renders.
 */
export function matchView(
  views: readonly SavedView[],
  viewId: string | null,
  state: ViewState,
  viewKeys: readonly string[],
  defaultName: string,
): { view: SavedView; edited: boolean } {
  const fallback = views.find((candidate) => candidate.id === DEFAULT_VIEW_ID) ?? views[0] ?? defaultView(defaultName);
  const view = (viewId === null ? undefined : views.find((candidate) => candidate.id === viewId)) ?? fallback;
  const edited = governedKeys(viewKeys).some((key) => {
    // A sort is an ordered list ("name,volume" differs from "volume,name"); every other key is a set
    if (key === 'sort') return present(state[key]) !== present(view.params[key]);
    return asSet(state[key]) !== asSet(view.params[key]);
  });
  return { view, edited };
}

/** What applying `view` writes: every view key (its value or `null`) and `view` (`null` for the default). */
export function viewParams(view: SavedView, viewKeys: readonly string[]): Record<string, string | null> {
  const written: Record<string, string | null> = {};
  for (const key of governedKeys(viewKeys)) written[key] = present(view.params[key]);
  written[VIEW_KEY] = view.id === DEFAULT_VIEW_ID ? null : view.id;
  return written;
}

/** How many of the screen's governed keys `view` sets to a value: "3 filters" in the announcement. */
export function viewChangeCount(view: SavedView, viewKeys: readonly string[]): number {
  return governedKeys(viewKeys).filter((key) => present(view.params[key]) !== null).length;
}
