import type { PromptScope } from '../prompt-queries';
import type { PromptsProject } from '../prompts-screen';
import { assertUniqueIds, type Translate } from '../seams/shared';
import type { MenuItemDef } from '@/components/ui/menu';
import { can, type Permission } from '@/lib/permissions/permissions';

/**
 * The ways to add prompts besides the default, which the header's split button lists in its menu and the empty states
 * show beside Add prompts (prompt-dialogs 3, PD-ADD-02). A package that brings one adds one entry here and nothing
 * else: WP-28 "Import CSV", WP-44 "Generate from keywords", WP-46 "Review suggestions". With no entry the header is a
 * plain button, because a menu that only repeats the default action is not allowed (25-component-inventory 3.3).
 *
 * An entry says who may use it (`permission`, `null` for every member who may add), and builds its `MenuItemDef` for
 * the context: its `onSelect` opens its own dialog. It returns `null` where it has nothing to offer. Do not give an
 * entry the id `add-prompts`, which is the default action's.
 *
 * `item` is a plain function called on every render, not a hook: it reads nothing but its context. The registry only
 * lists the menu item. The dialog it opens is mounted by its own package, through that package's toolbar seam entry:
 * the item's `onSelect` (or its `link`, for a page) opens it through a store or URL state. An item with a `link` is
 * drawn as a link in the empty states, and a `disabledReason` shows there as a tooltip.
 */
export interface AddMenuEntry {
  id: string;
  permission: Permission | null;
  item: (context: AddMenuContext) => MenuItemDef | null;
}

export interface AddMenuContext {
  scope: PromptScope;
  project: PromptsProject;
  t: Translate;
}

const DEFAULT_ACTION_ID = 'add-prompts';

export const ADD_MENU_ENTRIES: readonly AddMenuEntry[] = [
  // WP-28 import-csv: importCsvEntry
  // WP-44 links-generate: generateEntry
  // WP-46 suggestions: reviewSuggestionsEntry
];

/** The entries the role may use that have something to offer, in order. Throws on a repeated id or the default's. */
export function addMenuItems(
  entries: readonly AddMenuEntry[],
  context: AddMenuContext,
  permissions: readonly string[],
): MenuItemDef[] {
  assertUniqueIds(
    [DEFAULT_ACTION_ID, ...entries.map((entry) => entry.id)],
    'add menu entries (the default action is one)',
  );
  return entries.flatMap((entry) => {
    if (entry.permission !== null && !can(permissions, entry.permission)) return [];
    const item = entry.item(context);
    return item === null ? [] : [item];
  });
}
