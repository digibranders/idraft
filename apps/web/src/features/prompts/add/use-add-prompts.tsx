'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';

import { AddEmptyAlternatives, AddEmptyPrimary, AddEntry } from './add-entry';
import { ADD_MENU_ENTRIES, addMenuItems, type AddMenuEntry } from './add-menu-entries';
import { AddPromptsDialog } from '../add-prompts-dialog';
import type { PromptScope } from '../prompt-queries';
import type { PromptsProject } from '../prompts-screen';
import { usePageShortcuts } from '@/components/app/shell/page-shortcuts';
import type { ProjectEngine, Prompt } from '@/lib/api/types';
import { useShortcut } from '@/lib/a11y/use-shortcut';
import { useMembership } from '@/lib/permissions';

export interface UseAddPromptsInput {
  scope: PromptScope;
  project: PromptsProject;
  /** The project's enabled engines; `undefined` until the engines have answered, which keeps every entry away. */
  engines: readonly ProjectEngine[] | undefined;
  /** Whether the role has `prompts:write`. */
  canWrite: boolean;
  /** The project's loaded active prompts, which the dialog leaves out while the lint cannot say what is tracked. */
  existing: readonly Prompt[];
  /** The alternatives to the default add; the registry unless a test brings its own. */
  menuEntries?: readonly AddMenuEntry[];
}

export interface AddPrompts {
  /** Opens the dialog, with a topic chosen when a topic's own menu or drawer asks. The header and `N` give none. */
  openAdd: (termId?: string | null) => void;
  /** Whether the role may add and the engines are known: the topic row menu and the topic drawer follow it too. */
  canAdd: boolean;
  /** The header's Add prompts (a split button when an alternative exists); `null` where it must not be drawn. */
  entry: ReactNode;
  /** For an empty state: Add prompts as its primary action and the alternatives as its text actions; none for a viewer. */
  emptyActions: { primary: ReactNode; secondary: ReactNode };
  /** The dialog, mounted once by the screen; `null` for a role that cannot add. */
  dialog: ReactNode;
}

/**
 * Everything the prompts screen needs of "Add prompts": the open state and the topic the dialog starts on, `N`, the
 * header entry, the empty-state actions and the dialog. The form is made once, so a new topic is a new dialog.
 */
export function useAddPrompts({
  scope,
  project,
  engines,
  canWrite,
  existing,
  menuEntries = ADD_MENU_ENTRIES,
}: UseAddPromptsInput): AddPrompts {
  const t = useTranslations();
  const { permissions } = useMembership();
  const [open, setOpen] = useState(false);
  const [termId, setTermId] = useState<string | null>(null);
  // Not before the engines are known: the dialog takes the enabled ones
  const canAdd = canWrite && engines !== undefined;
  const openAdd = (topic: string | null = null): void => {
    // The role and the engines decide, whoever asks: a topic menu or the drawer may be drawn a moment too long
    if (!canAdd) return;
    setTermId(topic);
    setOpen(true);
  };
  // Shift+N is the import's (WP-28): `key` is the lower-case letter only
  useShortcut('n', () => openAdd(null), { kind: 'single-key', enabled: canAdd && !open });
  // Only the sheet's line: the key is taken above, so it is listed once and only where it does something
  const shortcutEntries = useMemo(
    () => (canAdd ? [{ id: 'prompts-add', label: t('prompts.add.shortcut'), keys: ['n'] }] : []),
    [canAdd, t],
  );
  usePageShortcuts(shortcutEntries);

  const alternatives = canAdd ? addMenuItems(menuEntries, { scope, project, t }, permissions) : [];
  return {
    openAdd,
    canAdd,
    entry: canAdd ? <AddEntry onAdd={() => openAdd(null)} alternatives={alternatives} /> : null,
    emptyActions: {
      primary: canAdd ? <AddEmptyPrimary onAdd={() => openAdd(null)} /> : undefined,
      secondary: alternatives.length > 0 ? <AddEmptyAlternatives alternatives={alternatives} /> : undefined,
    },
    dialog: canWrite ? (
      <AddPromptsDialog
        key={termId ?? 'no-topic'}
        scope={scope}
        open={open}
        onOpenChange={setOpen}
        engines={engines ?? []}
        existing={existing}
        defaults={{ languageCode: project.defaultLanguage, countryIso: project.defaultCountryIso, termId }}
      />
    ) : null,
  };
}
