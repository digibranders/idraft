import type { ReactNode } from 'react';

import type { PromptScope } from '../prompt-queries';
import type { PromptsProject } from '../prompts-screen';
import { assertUniqueIds, type Translate } from './shared';
import type { MenuItemDef } from '@/components/ui/menu';
import { can, type Permission } from '@/lib/permissions/permissions';

// Entries of later packages (MASTER-PLAN 3.4). A package uncomments its own import line and its own slot line and
// edits nothing else in this file; the "WP-NN" line above each stays as it is.

// WP-27 add-dialog
// import { limitsMeter } from '../toolbar/limits-meter';

// WP-28 import-csv
// import { importEntry } from '../toolbar/import-entry';

// WP-43 panels-web
// import { panelsEntry } from '../toolbar/panels-entry';

// WP-44 links-generate
// import { generateEntry } from '../toolbar/generate-entry';

// WP-49 saved-views
// import { savedViewsEntry } from '../toolbar/saved-views-entry';

export interface PromptsToolbarContext {
  scope: PromptScope;
  project: PromptsProject;
  t: Translate;
}

/** `more`: an item of the header's More actions menu, after Copy link. `actions`: a control before More actions. */
export type PromptsToolbarEntry =
  | {
      id: string;
      slot: 'more';
      permission: Permission | null;
      item: (context: PromptsToolbarContext) => MenuItemDef | null;
    }
  | {
      id: string;
      slot: 'actions';
      permission: Permission | null;
      render: (context: PromptsToolbarContext) => ReactNode;
    };

/** The ids the header uses itself. */
export const BUILT_IN_TOOLBAR_IDS = ['copy-link', 'add-prompts', 'export-csv', 'export-xlsx'] as const;

export const PROMPTS_TOOLBAR_ENTRIES: readonly PromptsToolbarEntry[] = [
  // WP-27 add-dialog (WB-TPH-14, WB-TPH-18)
  // limitsMeter,
  // WP-28 import-csv (WB-TPH-10, WB-TPH-11)
  // importEntry,
  // WP-43 panels-web (WB-TPH-05, WB-TPH-16)
  // panelsEntry,
  // WP-44 links-generate (WB-TPH-12)
  // generateEntry,
  // WP-49 saved-views (WB-TPH-06)
  // savedViewsEntry,
];

export interface PromptsToolbarItems {
  more: MenuItemDef[];
  actions: { id: string; node: ReactNode }[];
}

/** The entries the role may use, by slot, in order. Throws on a repeated id or a built-in one. */
export function promptsToolbarItems(
  entries: readonly PromptsToolbarEntry[],
  context: PromptsToolbarContext,
  permissions: readonly string[],
): PromptsToolbarItems {
  const ids = [...BUILT_IN_TOOLBAR_IDS, ...entries.map((entry) => entry.id)];
  assertUniqueIds(ids, 'toolbar entries');
  const items: PromptsToolbarItems = { more: [], actions: [] };
  for (const entry of entries) {
    if (entry.permission !== null && !can(permissions, entry.permission)) continue;
    if (entry.slot === 'more') {
      const item = entry.item(context);
      if (item !== null) items.more.push(item);
    } else {
      items.actions.push({ id: entry.id, node: entry.render(context) });
    }
  }
  return items;
}
