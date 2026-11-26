'use client';

import { Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactElement } from 'react';

import { NoteEditor, type NoteSuggestSource } from './note-editor';
import { Avatar } from '@/components/ui/avatar';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { browserTimeZone, formatDetailDateTime } from '@/lib/format';
import type { PageNote } from '@/lib/internal-links/types';
import type { NoteMention } from '@/lib/pages/note-mentions';

export interface NoteItemProps {
  note: PageNote;
  /** This note is the one in edit. */
  editing: boolean;
  /** A write is running. */
  pending: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (body: string, mentions: readonly NoteMention[]) => void;
  onDelete: () => void;
  /** Hands the Edit button to the list, which moves the focus back to it when an edit ends. */
  editButtonRef: (element: HTMLButtonElement | null) => void;
  /** What the box of an edit offers to mention. */
  source: NoteSuggestSource;
}

/** The text of a note in edit starts from the saved text each time the edit opens, so it lives in a part of its own. */
function NoteEdit({
  note,
  pending,
  onCancel,
  onSave,
  source,
}: Pick<NoteItemProps, 'note' | 'pending' | 'onCancel' | 'onSave' | 'source'>): ReactElement {
  const t = useTranslations('pages.drawer.notes');
  const [text, setText] = useState(note.body);
  // The note's own mentions: the ones whose label stays in the text are sent again
  const [mentions, setMentions] = useState<readonly NoteMention[]>(note.mentions);
  const area = useRef<HTMLTextAreaElement | null>(null);
  return (
    <div className="pl-10">
      <NoteEditor
        label={t('editLabel')}
        value={text}
        onChange={setText}
        mentions={mentions}
        onMentionsChange={setMentions}
        source={source}
        onSave={() => onSave(text, mentions)}
        onCancel={onCancel}
        saveLabel={t('save')}
        pending={pending}
        focusOnOpen
        area={area}
      />
    </div>
  );
}

/**
 * One note of the list: who wrote it and when (in the viewer's time zone), the text as text only, and the controls
 * the API grants (`can_edit`, `can_delete`).
 */
export function NoteItem({
  note,
  editing,
  pending,
  onEdit,
  onCancel,
  onSave,
  onDelete,
  editButtonRef,
  source,
}: NoteItemProps): ReactElement {
  const t = useTranslations('pages.drawer.notes');
  const timeZone = browserTimeZone();
  const editedAt =
    note.edited_at === null ? '' : t('editedAt', { when: formatDetailDateTime(note.edited_at, timeZone) });
  return (
    <li data-note-id={note.id} tabIndex={-1} className="flex flex-col gap-2 py-3 outline-none">
      <div className="flex items-center gap-2">
        <Avatar name={note.author.name} />
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <span className="type-body-strong text-foreground">{note.author.name}</span>
          <time dateTime={note.created_at} className="num type-meta text-foreground-secondary">
            {formatDetailDateTime(note.created_at, timeZone)}
          </time>
          {note.edited_at === null ? null : (
            // The time is read from the hidden text in the flow of the page; the tooltip is for the pointer only
            <>
              <Tooltip content={editedAt} purpose="label">
                <span aria-hidden="true" className="type-meta text-foreground-tertiary">
                  {t('edited')}
                </span>
              </Tooltip>
              <span className="sr-only">{editedAt}</span>
            </>
          )}
        </div>
        {editing ? null : (
          <div className="flex shrink-0 items-center gap-1">
            {note.can_edit ? <IconButton icon={Pencil} label={t('edit')} onClick={onEdit} ref={editButtonRef} /> : null}
            {note.can_delete ? <IconButton icon={Trash2} label={t('delete')} onClick={onDelete} /> : null}
          </div>
        )}
      </div>
      {editing ? (
        <NoteEdit note={note} pending={pending} onCancel={onCancel} onSave={onSave} source={source} />
      ) : (
        <p className="pl-10 type-body break-words whitespace-pre-wrap text-foreground">{note.body}</p>
      )}
    </li>
  );
}
