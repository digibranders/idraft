'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ReactElement, type RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { formatInteger } from '@/lib/format';
import { NOTE_COUNT_FROM, NOTE_MAX } from '@/lib/pages/notes';

export interface NoteEditorProps {
  /** The name of the box. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  /** Given for an edit: Escape and a Cancel button then leave it. The box that adds a note has none. */
  onCancel?: (() => void) | undefined;
  saveLabel: string;
  /** A write is running. */
  pending: boolean;
  /** The text area takes the focus when the editor mounts. */
  focusOnOpen?: boolean | undefined;
  /** The caller's handle on the text area: it moves the focus there, and the key listener reads it. */
  area: RefObject<HTMLTextAreaElement | null>;
}

/**
 * The text box of a note, for a new one and for an edit: a named text area with its count from 1,800 characters, its
 * hint, and Save (or Add note) and Cancel under it.
 */
export function NoteEditor({
  label,
  value,
  onChange,
  onSave,
  onCancel,
  saveLabel,
  pending,
  focusOnOpen = false,
  area,
}: NoteEditorProps): ReactElement {
  const t = useTranslations('pages.drawer.notes');
  const empty = value.trim() === '';
  // The key handler is bound once and reads what is current through this ref
  const latest = useRef({ onSave, onCancel, blocked: empty || pending });
  useEffect(() => {
    latest.current = { onSave, onCancel, blocked: empty || pending };
  });

  // Native, not React's `onKeyDown`: the drawer closes on Escape from a native listener on its card, which runs
  // before a React handler. A listener on the text area itself runs first and can stop the event there.
  useEffect(() => {
    const element = area.current;
    if (element === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) return;
      const { onSave: save, onCancel: cancel, blocked } = latest.current;
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (!blocked) save();
      } else if (event.key === 'Escape' && cancel !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    element.addEventListener('keydown', onKeyDown);
    return () => element.removeEventListener('keydown', onKeyDown);
  }, [area]);

  // The box of an edit takes the focus when it opens
  useEffect(() => {
    if (focusOnOpen) area.current?.focus();
  }, [focusOnOpen, area]);

  return (
    <Field>
      <FieldLabel display="visually-hidden">{label}</FieldLabel>
      <Textarea
        ref={area}
        value={value}
        maxLength={NOTE_MAX}
        placeholder={t('placeholder')}
        counter={
          value.length >= NOTE_COUNT_FROM
            ? t('count', { count: formatInteger(value.length), max: formatInteger(NOTE_MAX) })
            : null
        }
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={empty || pending} onClick={onSave}>
          {saveLabel}
        </Button>
        {onCancel === undefined ? null : (
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {t('cancel')}
          </Button>
        )}
        <FieldDescription>{t('hint')}</FieldDescription>
      </div>
    </Field>
  );
}
