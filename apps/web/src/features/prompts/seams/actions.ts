import type { PromptAction } from '../prompt-action';
import type { PromptScope } from '../prompt-queries';
import { assertUniqueIds, type Translate } from './shared';
import type { MenuItemDef } from '@/components/ui/menu';
import type { Prompt } from '@/lib/api/types';
import { can, type Permission } from '@/lib/permissions/permissions';

// Entries of later packages (MASTER-PLAN 3.4). A package uncomments its own import line and its own slot line and
// edits nothing else in this file; the "WP-NN" line above each stays as it is.

// WP-17 tp-header-filters
// import { copyLinkAction } from '../actions/copy-link-action';

// WP-27 add-dialog
// import { addPromptForTopicsAction } from '../actions/add-prompt-for-topics-action';

// WP-29 edit-archive
// import { bulkEditAction } from '../actions/bulk-edit-action';
// import { editDetailsAction } from '../actions/edit-details-action';
// import { restoreAction } from '../actions/restore-action';

// WP-41 versions
// import { editTextAction } from '../actions/edit-text-action';

// WP-43 panels-web
// import { addToPanelAction } from '../actions/add-to-panel-action';

// WP-52 prompt-detail
// import { openPageAction } from '../actions/open-page-action';

/** Where an action is offered: a prompt's row menu, a topic's row menu, the bulk bar, the prompt inspector's More. */
export type PromptActionSurface = 'promptRow' | 'topicRow' | 'bulk' | 'inspectorMore';

/** What an entry acts on, and what the screen lends it. */
export interface PromptActionContext {
  surface: PromptActionSurface;
  scope: PromptScope;
  /** One for a prompt row and the inspector, a topic's prompts, or the chosen prompts, in the table's order. */
  promptIds: readonly string[];
  /** Those of `promptIds` the screen has read (a topic's may be missing while the list loads). */
  prompts: readonly Prompt[];
  /** The topic of a topic row; `null` on the other surfaces. */
  topicKey: string | null;
  /** Why the built-in Run now and Archive wait (`bulk.busy`); `null` when nothing runs, and in the inspector. */
  busyReason: string | null;
  t: Translate;
}

export interface PromptActionEntry {
  /** Unique, and none of the built-in ids of `BUILT_IN_ACTION_IDS`. */
  id: string;
  surfaces: readonly PromptActionSurface[];
  /** What the role needs; `null` for every member. Without it the entry is absent, not disabled (20 section 3.9). */
  permission: Permission | null;
  /** The action bound to the context, or `null` where it does not apply (an archived prompt, nothing read yet). */
  build: (context: PromptActionContext) => PromptAction | null;
}

/** The ids the screens use for their own items today. */
export const BUILT_IN_ACTION_IDS = [
  'open',
  'show-in-prompts',
  'run-now',
  'add-prompt',
  'copy',
  'export',
  'archive',
] as const;

export const PROMPT_ACTION_ENTRIES: readonly PromptActionEntry[] = [
  // WP-17 tp-header-filters (WB-MNU-08)
  // copyLinkAction,
  // WP-27 add-dialog (WB-BLK-09)
  // addPromptForTopicsAction,
  // WP-29 edit-archive (WB-MNU-05, WB-BLK-11, WB-BLK-12)
  // editDetailsAction,
  // bulkEditAction,
  // restoreAction,
  // WP-41 versions (WB-MNU-06)
  // editTextAction,
  // WP-43 panels-web (WB-BLK-10)
  // addToPanelAction,
  // WP-52 prompt-detail (WB-MNU-07)
  // openPageAction,
];

const isBuiltIn = (id: string): boolean => BUILT_IN_ACTION_IDS.some((builtIn) => builtIn === id);

/**
 * `builtIns`, then the entries offered on `context.surface` that the role may use, built for the context. The
 * tables sort by group (`GROUP_ORDER` in data-table.tsx, `ORDER` in bulk-action-bar.tsx, both stable), so an entry
 * lands after the built-ins of its group. Throws on a repeated id.
 */
export function withActionEntries(
  builtIns: readonly PromptAction[],
  entries: readonly PromptActionEntry[],
  context: PromptActionContext,
  permissions: readonly string[],
): PromptAction[] {
  assertUniqueIds(
    entries.map((entry) => entry.id),
    'action entries',
  );
  const taken = entries.find((entry) => isBuiltIn(entry.id));
  if (taken !== undefined) throw new Error(`action entries: the id "${taken.id}" is a built-in action's`);
  const added = entries.flatMap((entry) => {
    if (!entry.surfaces.includes(context.surface)) return [];
    if (entry.permission !== null && !can(permissions, entry.permission)) return [];
    const action = entry.build(context);
    return action === null ? [] : [action];
  });
  assertUniqueIds(
    [...builtIns, ...added].map((action) => action.id),
    'actions',
  );
  return [...builtIns, ...added];
}

/**
 * Actions as items of a `Menu` (the inspector's More): no `group`, which a `Menu` turns into a section of its own,
 * the destructive tone kept, a `null` reason dropped.
 */
export function asMenuItems(actions: readonly PromptAction[]): MenuItemDef[] {
  return actions.map((action) => ({
    id: action.id,
    label: action.label,
    icon: action.icon,
    tone: action.tone,
    ...(action.disabledReason == null ? {} : { disabledReason: action.disabledReason }),
    onSelect: action.run,
  }));
}
