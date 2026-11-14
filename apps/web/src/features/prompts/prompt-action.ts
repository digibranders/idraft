import type { LucideIcon } from 'lucide-react';

import type { RecordAction } from '@/components/app/data-table/types';

/**
 * An action of a menu or of the bulk bar of Topics & Prompts, already bound to what it acts on (a prompt, a topic's
 * prompts, the chosen prompts). Each table draws it as the `RecordAction` of its own rows.
 */
export interface PromptAction {
  id: string;
  label: string;
  icon?: LucideIcon | undefined;
  group: RecordAction<unknown>['group'];
  tone?: RecordAction<unknown>['tone'];
  /** Shown in place of a shortcut; the item stays focusable. */
  disabledReason?: string | null | undefined;
  run: () => void;
}

/** The actions as the table's `RecordAction`s: the rows it hands over are not needed, the action knows its prompts. */
export const asRecordActions = <TRow>(actions: readonly PromptAction[]): RecordAction<TRow>[] =>
  actions.map(({ run, ...action }) => ({ ...action, onSelect: () => run() }));
