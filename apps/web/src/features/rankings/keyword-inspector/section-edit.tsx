'use client';

import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ReactElement, type RefObject } from 'react';

import { Button } from '@/components/ui/button';

/** The controls of a form that can take focus, in order. */
const FIELDS = 'input:not([type="hidden"]), textarea, select, [role="combobox"], [role="checkbox"]';

export type EditableSection = 'links' | 'tracking' | 'competitors';

/**
 * A section's part in the inspector's edit mode (16-drawers-dialogs-popovers.md section 2.5): one section
 * edits at a time, as a form whose Save is the inspector footer's primary button.
 */
export interface SectionEdit {
  /** This section is the one editing. */
  active: boolean;
  /** Whether the section may offer Edit: the person may write, and no other section is editing. */
  available: boolean;
  start: () => void;
  /** Back to read mode, the changes dropped or saved. */
  stop: () => void;
  /** The `id` of the section's form, which the footer's Save submits. */
  formId: string;
  setDirty: (dirty: boolean) => void;
  setSaving: (saving: boolean) => void;
}

/**
 * Keeps focus with the person through edit mode (10-forms.md section 13.2: focus is never lost to the
 * page): Edit moves it to the form's first field, and Save or Cancel returns it to the section's Edit
 * button. Focus that has moved elsewhere meanwhile, such as to the list after J, stays there.
 */
export function useEditFocus(active: boolean): {
  form: RefObject<HTMLFormElement | null>;
  edit: RefObject<HTMLButtonElement | null>;
} {
  const form = useRef<HTMLFormElement>(null);
  const edit = useRef<HTMLButtonElement>(null);
  const was = useRef(active);
  useEffect(() => {
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (active && !was.current) form.current?.querySelector<HTMLElement>(FIELDS)?.focus();
    if (!active && was.current && lost) edit.current?.focus();
    was.current = active;
  }, [active]);
  return { form, edit };
}

/** "Edit" in a section header: a 32 px secondary button that names its section for screen readers. */
export function EditButton({
  section,
  edit,
  buttonRef,
}: {
  section: string;
  edit: SectionEdit;
  buttonRef: RefObject<HTMLButtonElement | null>;
}): ReactElement | null {
  const t = useTranslations('rankings.inspector');
  if (!edit.available) return null;
  return (
    <Button
      ref={buttonRef}
      variant="secondary"
      size="sm"
      icon={Pencil}
      aria-label={t('editLabel', { section })}
      onClick={edit.start}
    >
      {t('edit')}
    </Button>
  );
}
